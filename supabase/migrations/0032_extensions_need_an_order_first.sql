-- ── EXTENSIONS CANNOT BE BOOKED OUT OF NOWHERE ──
--
-- A fitting is only real once the hair exists. Until now anyone could book one
-- cold: no consultation, no order, no deposit, and no hair - and Hassan found
-- out on the day.
--
-- Three conditions, enforced as one fact rather than three rules: is there an
-- extension order for this phone, with the deposit paid? Everything else
-- follows from that row, because it cannot exist unless she came in.
--
-- THE WAIT. Hair takes about two and a half weeks to come. Rather than making
-- her wait for Hassan to tick "arrived" - which he will sometimes forget,
-- leaving a paying client locked out - the fitting can be booked from 18 days
-- after the order. If the hair lands early and he does tick it, the wait is
-- waived and she can book straight away.
--
-- Returns the reason as text rather than a boolean: the client needs telling
-- WHICH of these she is missing, and "you cannot book this" on its own sends
-- her to the phone.
create or replace function extensions_booking_block(
  p_phone text, p_service_id uuid, p_addon_ids uuid[], p_date date
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_is_ext boolean;
  v_key text;
  v_order extension_orders;
  v_earliest date;
begin
  -- Extensions as the service itself, or as an add-on on a colour. Both are a
  -- fitting and both need the hair.
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

  -- Matched on the last eight digits, like everything else that identifies a
  -- client: the number she books with is rarely typed the same way twice.
  select * into v_order
    from extension_orders o
   where phone_key(o.customer_phone) = v_key
     and o.deposit_paid
     and coalesce(o.status, '') <> 'cancelled'
   order by o.ordered_at desc nulls last
   limit 1;

  if v_order.id is null then
    return 'Extensions are fitted once your hair has been ordered for you. Please book a consultation first - we will match your colour, order the hair and take a deposit, and then you can book the fitting.';
  end if;

  if v_order.arrived_at is not null then
    return null; -- it is here; book any time that suits
  end if;

  v_earliest := coalesce(v_order.ordered_at, now())::date + 18;
  if p_date < v_earliest then
    return format(
      'Your hair is on its way. Fittings can be booked from %s - about two and a half weeks after it was ordered.',
      to_char(v_earliest, 'DD.MM.YYYY'));
  end if;

  return null;
end; $$;
grant execute on function extensions_booking_block to anon;

-- What the booking page asks so it can say all this BEFORE she picks a time,
-- rather than refusing her at the last step. Deliberately says nothing about
-- anyone else: given a phone number it answers only about that number, and
-- reveals no name, no order detail and no colour.
create or replace function extensions_status_for(p_phone text)
returns table (allowed boolean, earliest_date date, message text)
language plpgsql stable security definer set search_path = public as $$
declare v_key text; v_order extension_orders;
begin
  v_key := phone_key(p_phone);
  if length(coalesce(v_key, '')) < 8 then
    return query select false, null::date, 'Extensions begin with a consultation.'::text;
    return;
  end if;
  select * into v_order from extension_orders o
   where phone_key(o.customer_phone) = v_key and o.deposit_paid
     and coalesce(o.status, '') <> 'cancelled'
   order by o.ordered_at desc nulls last limit 1;

  if v_order.id is null then
    return query select false, null::date,
      'Extensions are fitted once your hair has been ordered for you. Please book a consultation first.'::text;
  elsif v_order.arrived_at is not null then
    return query select true, current_date, 'Your hair has arrived - book whenever suits you.'::text;
  else
    return query select true, (coalesce(v_order.ordered_at, now())::date + 18),
      'Your hair is on its way.'::text;
  end if;
end; $$;
grant execute on function extensions_status_for to anon;
