-- ── THE REFERENCE THE SALON ASKS HER TO QUOTE, WHICH THE SALON COULD NOT SEE ──
--
-- Every booking carries an eight-character reference. The client sees it on
-- her confirmation, on her appointment card, in the calendar invite, and -
-- the one that matters - on the invoice, where the wording is:
--
--   "Easiest with Vipps to <number> - put F3FB0D15 in the message so we know
--    it is you."
--
-- So a payment arrives quoting a reference, and until now there was no way to
-- find out whose it was. The panel never displayed it and the search never
-- matched it: search_staff_bookings looked at name, phone and email only, and
-- neither it nor get_staff_schedule returned the column at all.
--
-- That is the whole point of the reference defeated. A stylist holding a Vipps
-- notification had to guess from the amount and the time.
--
-- Both functions gain the column, and the search learns to match it. DROP
-- first: a RETURNS TABLE cannot gain a column through CREATE OR REPLACE, and
-- leaving the old signature behind would be the "function is not unique" trap
-- 0044 and 0046 both had to undo.

drop function if exists get_staff_schedule(text, date, date, uuid);

create or replace function get_staff_schedule(
  p_pin text, p_date_from date, p_date_to date, p_staff_id uuid default null
) returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_phone text, notes text,
  service_name text, service_color text, staff_id uuid, staff_name text,
  addons text, expected_total numeric, expected_total_is_estimate boolean,
  amount_charged numeric, rejected_at timestamptz, service_id uuid,
  customer_email text, booking_ref text
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_phone, b.notes,
           s.name, s.color, st.id, st.name,
           booking_addons_label(b.id), b.expected_total, b.expected_total_is_estimate,
           b.amount_charged, b.rejected_at, b.service_id, b.customer_email,
           b.booking_ref
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where b.date between p_date_from and p_date_to
      and b.status not in ('cancelled', 'pending')
    order by b.date, b.start_time;
end; $$;
grant execute on function get_staff_schedule to anon;

drop function if exists search_staff_bookings(text, text);

create or replace function search_staff_bookings(p_pin text, p_query text)
returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_phone text, notes text,
  service_name text, service_color text, staff_id uuid, staff_name text,
  addons text, expected_total numeric, expected_total_is_estimate boolean,
  service_id uuid, customer_email text, amount_charged numeric, booking_ref text
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  if length(trim(p_query)) < 2 then raise exception 'Search term too short'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_phone, b.notes,
           s.name, s.color, st.id, st.name,
           booking_addons_label(b.id), b.expected_total, b.expected_total_is_estimate,
           b.service_id, b.customer_email, b.amount_charged, b.booking_ref
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where b.status <> 'cancelled'
      and (
        b.customer_name ilike '%' || p_query || '%'
        or b.customer_phone ilike '%' || p_query || '%'
        or b.customer_email ilike '%' || p_query || '%'
        -- Case-insensitive on purpose: it is stored lower-case and shown
        -- upper-case everywhere the client sees it, so she will quote it back
        -- in capitals and somebody will type it in capitals.
        or b.booking_ref ilike '%' || p_query || '%'
      )
    order by b.date desc, b.start_time desc
    limit 100;
end; $$;
grant execute on function search_staff_bookings to anon;
