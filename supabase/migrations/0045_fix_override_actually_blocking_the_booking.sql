-- ── THE OVERRIDE NEVER ACTUALLY LET ANYONE BOOK ──
--
-- extensions_booking_block is read by book_appointment as binary: null means
-- allowed, any text means refuse the booking and raise that text as the
-- error. Three of its branches returned a friendly REMINDER string ("you can
-- book now, please settle your deposit before your fitting") for cases that
-- were supposed to be ALLOWED - the owner's booking_allowed_before_deposit
-- override, specifically. The wrapper doesn't know the difference between a
-- reminder and a refusal; any non-null text blocks the booking outright.
--
-- So a client whose owner had explicitly said "let her book before the
-- deposit" would see the calendar unlock correctly (extensions_status_for is
-- a separate, correctly-behaving function), pick a time, fill in her
-- details - and be refused at the very last step, with the reminder text
-- itself shown to her as though it were the reason she was being turned
-- away. The override had not worked for a real booking since it was built.
-- Caught by testing this exact path directly against the live database
-- before trusting it, not by reading the code and assuming it was right.
--
-- Fixed by making every ALLOWED case return null, full stop. The reminder
-- wording stays in extensions_status_for, which only ever informs, never
-- blocks - that one was correct all along.
create or replace function extensions_booking_block(
  p_phone text, p_service_id uuid, p_addon_ids uuid[], p_date date
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_is_ext boolean;
  v_key text;
  v_order extension_orders;
  v_earliest date;
begin
  select exists (select 1 from services s
                  where s.id = p_service_id and s.category = 'Hair Extensions')
      or exists (select 1 from addons a
                  where p_addon_ids is not null and a.id = any(p_addon_ids)
                    and a.exclusive_group = 'extensions')
    into v_is_ext;
  if not v_is_ext then return null; end if;

  v_key := phone_key(p_phone);
  if length(coalesce(v_key, '')) < 8 then
    return 'Extensions begin with a consultation. Please book a consultation and we will take it from there.';
  end if;

  select * into v_order
    from extension_orders o
   where phone_key(o.customer_phone) = v_key
     and coalesce(o.status, '') <> 'cancelled'
   order by o.ordered_at desc nulls last
   limit 1;

  if v_order.id is null then
    return 'Extensions are fitted once your hair has been ordered for you. Please book a consultation first - we will match your colour, order the hair and take a deposit, and then you can book the fitting.';
  end if;

  if not (v_order.deposit_paid or v_order.booking_allowed_before_deposit) then
    return 'Your order is on file, but the deposit is still open. Please pay your deposit, or if there is something else, message us on Instagram @studioserena.hair.';
  end if;

  -- The hair-arrival wait is the only thing left to check once she is
  -- allowed through at all - it applies the same way whether she got here on
  -- a paid deposit or the owner's override, because it is about the hair
  -- existing, not about the money.
  if v_order.arrived_at is null then
    v_earliest := coalesce(v_order.ordered_at, now())::date + 18;
    if p_date < v_earliest then
      return format(
        'Your hair is on its way - you can book your spot from %s, about two and a half weeks after it was ordered.',
        to_char(v_earliest, 'DD.MM.YYYY'));
    end if;
  end if;

  return null;
end; $$;
grant execute on function extensions_booking_block to anon;

-- ── Verified against the live database before trusting this file:
--     no order at all                        -> blocked
--     unpaid, no override                    -> blocked
--     unpaid, override granted, date valid   -> ALLOWED (was blocked before this fix)
--     paid deposit, date genuinely too early -> still blocked (hair-arrival wait applies regardless)
--     paid deposit, date valid               -> allowed
