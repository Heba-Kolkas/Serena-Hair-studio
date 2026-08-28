-- ── THE GRID COULD NOT SEE WHAT WAS PAID ──
-- The appointment popup shows "Paid 3 750 kr" when an amount is recorded and a
-- warning when it is not. It never showed the first, because the query feeding
-- the grid did not return amount_charged at all - so every completed booking
-- read as unpaid, and the warning meant to catch takings that slipped through
-- fired on takings that had not.
--
-- Worse than useless: a warning that cries wolf on every completed booking is
-- one the salon learns to scroll past, and then it will not be read on the day
-- it is true.
--
-- Marking it paid did set it - the revenue figures were right all along - and
-- the popup even showed it correctly for a moment, because the browser updated
-- its own copy. The next refresh replaced that copy with the server's, which
-- had no such column, and the warning came back.
--
-- rejected_at comes along for the same reason: the grid labels a rejected
-- request differently from a cancellation, and could not see that either.
drop function if exists get_staff_schedule(text, date, date, uuid);
create or replace function get_staff_schedule(
  p_pin text, p_date_from date, p_date_to date, p_staff_id uuid default null
) returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_phone text, notes text,
  service_name text, service_color text, staff_id uuid, staff_name text,
  addons text, expected_total numeric, expected_total_is_estimate boolean,
  amount_charged numeric, rejected_at timestamptz, service_id uuid,
  customer_email text
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_phone, b.notes,
           s.name, s.color, st.id, st.name,
           booking_addons_label(b.id), b.expected_total, b.expected_total_is_estimate,
           b.amount_charged, b.rejected_at, b.service_id, b.customer_email
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where b.date between p_date_from and p_date_to
      and b.status not in ('cancelled', 'pending')
    order by b.date, b.start_time;
end; $$;
grant execute on function get_staff_schedule to anon;
