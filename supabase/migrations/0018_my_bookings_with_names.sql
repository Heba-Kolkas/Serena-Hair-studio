-- ── SHE SHOULD SEE WHAT SHE BOOKED, AND WITH WHOM ──
-- get_my_bookings returned raw booking rows, which carry service_id and
-- staff_id and no names. The appointments page reads b.services.name and
-- b.staff.name - nested objects that never existed on the result - so every
-- card read "Appointment" with no service and no stylist against it.
--
-- Returns the names now, plus the add-ons, the price and the cancellation
-- position, so the page can show the whole booking without a second lookup
-- and without the client having to remember what she chose.
--
-- The identity check is unchanged: both email and phone, matched on
-- phone_key, throttled. Widening what a caller sees is only safe because
-- proving who you are did not get any easier.
drop function if exists get_my_bookings(text, text);

create or replace function get_my_bookings(p_email text, p_phone text)
returns table (
  id uuid,
  booking_ref text,
  date date,
  start_time time,
  end_time time,
  status booking_status,
  service_name text,
  staff_name text,
  addons text,
  notes text,
  expected_total numeric,
  expected_total_is_estimate boolean,
  amount_charged numeric,
  is_past boolean,
  cancellation_fee numeric,
  late_cancellation boolean
) language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
        v_phone text := phone_key(p_phone);
        v_found int;
begin
  if v_email = '' or length(v_phone) < 8 then
    raise exception 'Both the email address and the full phone number are required';
  end if;
  if auth_failure_count('client_lookup', interval '15 minutes') >= 20 then
    raise exception 'Too many lookups. Please wait 15 minutes and try again.';
  end if;

  select count(*) into v_found from bookings b
   where lower(b.customer_email) = v_email
     and phone_key(b.customer_phone) = v_phone;

  if v_found = 0 then
    insert into auth_failures (kind) values ('client_lookup');
    return;
  end if;

  delete from auth_failures where kind = 'client_lookup';

  return query
    select b.id, b.booking_ref, b.date, b.start_time, b.end_time, b.status,
           sv.name, st.name,
           booking_addons_label(b.id),
           b.notes, b.expected_total, b.expected_total_is_estimate, b.amount_charged,
           ((b.date + b.start_time) at time zone 'Europe/Oslo') < now(),
           b.cancellation_fee, b.late_cancellation
    from bookings b
    join services sv on sv.id = b.service_id
    join staff st on st.id = b.staff_id
     where lower(b.customer_email) = v_email
       and phone_key(b.customer_phone) = v_phone
     order by b.date desc, b.start_time desc;
end; $$;
grant execute on function get_my_bookings to anon;
