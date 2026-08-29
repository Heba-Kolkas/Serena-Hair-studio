-- ── SAY THAT THE DEPOSIT IS NON-REFUNDABLE, AND SAY IT WHERE SHE READS IT ──
--
-- The deposit was described in four client-facing messages and none of them
-- mentioned that she does not get it back. That is the single most important
-- term of an extensions order and it was never written down anywhere she
-- would see it - the salon knew, and assumed she did.
--
-- Stated with the reason attached, everywhere, in the same words. "The
-- deposit is non-refundable" on its own reads as the salon keeping money
-- because it can; the hair is ordered in her colour and cannot be fitted to
-- anyone else, which is the whole of why the term exists and is the part
-- that makes it land as fair rather than punitive. A client who understands
-- why does not ring up angry about it later.
--
-- The matching line in the booking wizard's own extensions panel is in
-- js/booking.js (EXT_LOOKUP_COPY), in both languages. These are the
-- server-side halves - the messages a blocked or searching client is shown -
-- and they are worded to agree with it.
--
-- NOT added to booking_terms. Those are the universal cancellation terms
-- every client ticks, including someone booking a fifteen-minute fringe trim
-- who will never pay a deposit; a clause about extensions deposits sitting in
-- them would be noise to almost everyone who reads it. The deposit is also
-- taken in person at the consultation, before any of this exists, so the
-- tick-box is not the moment of agreement for it. If the salon wants it
-- recorded as formally accepted, that belongs in a consultation-time
-- agreement, which is a separate piece of work and a decision for the owner.

-- ── ONE DEFINITION OF "THIS IS A FITTING" ──
--
-- Extracted from extensions_booking_block, which had it inline, because
-- book_appointment now needs the same question answered and two copies of
-- this test would drift the first time an add-on group is renamed. Nothing
-- here changes what it decides.
create or replace function is_extensions_booking(
  p_service_id uuid, p_addon_ids uuid[]
) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from services s
                  where s.id = p_service_id and s.category = 'Hair Extensions')
      or exists (select 1 from addons a
                  where p_addon_ids is not null and a.id = any(p_addon_ids)
                    and a.exclusive_group = 'extensions');
$$;

-- ── THE GATE ──
-- Identical to 0045 in what it allows and refuses - every allowed path still
-- returns null, which is the bug that file existed to fix and must not be
-- undone here. Only the "book a consultation first" wording changes, plus
-- the extracted helper.
create or replace function extensions_booking_block(
  p_phone text, p_service_id uuid, p_addon_ids uuid[], p_date date
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_key text;
  v_order extension_orders;
  v_earliest date;
begin
  if not is_extensions_booking(p_service_id, p_addon_ids) then return null; end if;

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
    return 'Extensions are fitted once your hair has been ordered for you. Please book a consultation first - we will match your colour, order the hair and take a deposit, and then you can book the fitting. The deposit is non-refundable: it pays for hair ordered in your colour, which we cannot use for anyone else.';
  end if;

  if not (v_order.deposit_paid or v_order.booking_allowed_before_deposit) then
    return 'Your order is on file, but the deposit is still open. Please pay your deposit, or if there is something else, message us on Instagram @studioserena.hair. The deposit is non-refundable - your hair is ordered in your colour and cannot be used for anyone else.';
  end if;

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

-- ── THE LOOKUP ──
-- 0042's version, with the deposit terms added to the three branches that
-- mention the deposit at all. The arrived/on-its-way wording, the throttle
-- and the phone+email pairing are unchanged.
create or replace function extensions_status_for(p_phone text, p_email text)
returns table(allowed boolean, earliest_date date, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_key text := phone_key(p_phone);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_order extension_orders;
  v_earliest date;
begin
  if v_email = '' or length(coalesce(v_key, '')) < 8 then
    return query select false, null::date,
      'Please give both the mobile number and the email address you booked with.'::text;
    return;
  end if;

  if auth_failure_count('extensions_lookup', interval '1 hour') >= 12 then
    raise exception 'Too many attempts. Please wait an hour, or ring the salon and we will book it for you.';
  end if;

  select * into v_order
    from extension_orders o
   where phone_key(o.customer_phone) = v_key
     and lower(coalesce(o.customer_email, '')) = v_email
     and coalesce(o.status, '') <> 'cancelled'
   order by o.ordered_at desc nulls last
   limit 1;

  if v_order.id is null then
    insert into auth_failures (kind) values ('extensions_lookup');
    return query select false, null::date,
      'We could not find an extensions order for those details. Extensions start with a consultation - we match your colour, order the hair and take a deposit, and then you can book the fitting. The deposit is non-refundable: it pays for hair ordered in your colour, which we cannot use for anyone else.'::text;
    return;
  end if;

  delete from auth_failures where kind = 'extensions_lookup';

  if not (v_order.deposit_paid or v_order.booking_allowed_before_deposit) then
    return query select false, null::date,
      'Your order is on file, but the deposit is still open. Please pay your deposit, or if there is something else, message us on Instagram @studioserena.hair. The deposit is non-refundable - your hair is ordered in your colour and cannot be used for anyone else.'::text;
    return;
  end if;

  if v_order.arrived_at is not null then
    return query select true, current_date,
      (case when v_order.deposit_paid
         then 'Your hair has arrived. Choose any time that suits you.'
         else 'Your hair has arrived - you can book your spot now. Please settle your deposit before your fitting; deposits are non-refundable.' end)::text;
    return;
  end if;

  v_earliest := coalesce(v_order.ordered_at, now())::date + 18;
  return query select true, v_earliest,
    (format('Your hair is on its way - you can book your spot now. Fittings are available from %s.', to_char(v_earliest, 'DD.MM.YYYY'))
      || case when not v_order.deposit_paid then ' Please settle your deposit before your fitting; deposits are non-refundable.' else '' end)::text;
end; $$;
grant execute on function extensions_status_for to anon;

-- ── BUG: THE AUTO-CONFIRM LOOKUP WAS NOT SCOPED TO EXTENSIONS ──
--
-- 0043 decides whether to skip the manual Confirm step by looking up the
-- caller's most recent extension order and reading deposit_paid off it. That
-- lookup ran on EVERY booking, for every service, and its answer was handed
-- to book_appointment_core as p_skip_confirmation - which bypasses
-- requires_confirmation for whatever service was actually booked.
--
-- So a client with a paid extensions order on file would have the manual
-- review skipped on any OTHER service she booked that needed one. It does no
-- damage today only because requires_confirmation is set on nothing but the
-- Hair Extensions services and the extensions add-ons (0005a), so the flag
-- has nothing else it could wrongly skip. It becomes a live bug the day
-- anyone ticks requires_confirmation on a bridal or colour service and finds
-- those bookings quietly auto-confirming for one group of clients and not
-- another - a fault that would be near-impossible to attribute, because the
-- deciding factor is a completely unrelated extensions order.
--
-- Fixed by asking the question the flag is named for: is THIS booking a
-- fitting? Same 14-argument signature, so this is a true replacement and not
-- a new overload - the trap 0044 and 0046 were both written to clean up.
create or replace function book_appointment(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null,
  p_terms_version int default null,
  p_first_name text default null, p_last_name text default null,
  p_instagram text default null, p_sms_consent boolean default false
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_current int; v_booking bookings; v_full text; v_skip_confirm boolean := false;
begin
  if not booking_rate_ok(p_customer_phone) then
    raise exception 'That is a lot of bookings in a short time. Please ring the salon and we will help.';
  end if;
  insert into booking_attempts (phone_key) values (phone_key(p_customer_phone));

  declare v_ext_block text;
  begin
    v_ext_block := extensions_booking_block(p_customer_phone, p_service_id, p_addon_ids, p_date);
    if v_ext_block is not null then raise exception '%', v_ext_block; end if;
  end;

  if client_must_call(p_customer_phone, p_service_id) then
    raise exception 'Please call the salon to book this service';
  end if;

  select version into v_current from get_current_booking_terms();
  if p_terms_version is null then
    raise exception 'Please accept the cancellation policy before booking';
  end if;
  if v_current is not null and p_terms_version <> v_current then
    raise exception 'The cancellation policy has changed - please reload and read it again';
  end if;

  if coalesce(trim(p_first_name), '') <> '' or coalesce(trim(p_last_name), '') <> '' then
    if coalesce(trim(p_first_name), '') = '' then raise exception 'Please give your first name'; end if;
    if coalesce(trim(p_last_name), '') = '' then raise exception 'Please give your last name'; end if;
    v_full := trim(p_first_name) || ' ' || trim(p_last_name);
  else
    v_full := trim(coalesce(p_customer_name, ''));
    if v_full = '' then raise exception 'Please give your name'; end if;
  end if;

  -- Only a fitting can be auto-confirmed by an extensions deposit. Any other
  -- service goes through whatever confirmation its own row asks for.
  if is_extensions_booking(p_service_id, p_addon_ids) then
    select coalesce(o.deposit_paid, false) into v_skip_confirm
      from extension_orders o
     where phone_key(o.customer_phone) = phone_key(p_customer_phone)
       and coalesce(o.status, '') <> 'cancelled'
     order by o.ordered_at desc nulls last
     limit 1;
  end if;

  v_booking := book_appointment_core(
    p_service_id, p_staff_id, p_date, p_start_time,
    v_full, p_customer_email, p_customer_phone,
    p_notes, p_addon_ids, false, true, coalesce(v_skip_confirm, false));

  update bookings set
    terms_version = p_terms_version,
    terms_accepted_at = now(),
    customer_first_name = nullif(trim(coalesce(p_first_name, '')), ''),
    customer_last_name  = nullif(trim(coalesce(p_last_name, '')), ''),
    customer_instagram  = instagram_handle(p_instagram),
    sms_consent         = coalesce(p_sms_consent, false)
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end; $$;
grant execute on function book_appointment to anon;
