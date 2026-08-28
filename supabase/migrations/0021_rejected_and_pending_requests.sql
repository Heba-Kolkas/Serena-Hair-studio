-- ── A REJECTED REQUEST IS NOT A CANCELLATION ──
-- Rejecting stores status = 'cancelled', so the panel and the client both call
-- it cancelled. They are different things: she cancelled, or the salon could
-- not take it. Recorded separately rather than added to the status enum -
-- roughly forty queries key off status <> 'cancelled' for availability, and a
-- rejected booking must go on being excluded by every one of them. A new enum
-- value would have to be added to all of them or it would quietly hold a slot.
alter table bookings add column rejected_at timestamptz;

create or replace function admin_decide_booking(
  p_pin text, p_booking_id uuid, p_decision text, p_reason text default null
) returns table (
  id uuid, decision text, customer_name text, customer_email text, customer_phone text,
  service_name text, staff_name text, date date, start_time time, booking_ref text
) language plpgsql security definer set search_path = public as $$
declare v_booking bookings;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_decision not in ('confirmed', 'rejected') then raise exception 'Invalid decision'; end if;

  update bookings set
    status = case when p_decision = 'confirmed' then 'confirmed'::booking_status
                  else 'cancelled'::booking_status end,
    hold_expires_at = null,
    rejected_at = case when p_decision = 'rejected' then now() else rejected_at end,
    notes = case when p_decision = 'rejected' and p_reason is not null
                 then coalesce(notes || ' — ', '') || 'Rejected: ' || p_reason
                 else notes end
  where bookings.id = p_booking_id
  returning * into v_booking;
  if v_booking.id is null then raise exception 'Booking not found'; end if;

  return query
    select v_booking.id, p_decision, v_booking.customer_name, v_booking.customer_email,
           v_booking.customer_phone, s.name, st.name, v_booking.date, v_booking.start_time,
           v_booking.booking_ref
    from services s, staff st
    where s.id = v_booking.service_id and st.id = v_booking.staff_id;
end; $$;
grant execute on function admin_decide_booking to anon;

-- ── A REQUEST IS NOT AN APPOINTMENT YET ──
-- A pending extensions request holds its slot - that is the whole point of the
-- two-day hold - but it should not sit on the day's grid as though it were
-- booked. The stylist would arrange her day around a client who has not been
-- accepted. It appears once it is confirmed; until then it lives in Requests.
drop function if exists get_staff_schedule(text, date, date, uuid);
create or replace function get_staff_schedule(
  p_pin text, p_date_from date, p_date_to date, p_staff_id uuid default null
) returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_phone text, notes text,
  service_name text, service_color text, staff_id uuid, staff_name text,
  addons text, expected_total numeric, expected_total_is_estimate boolean
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_phone, b.notes,
           s.name, s.color, st.id, st.name,
           booking_addons_label(b.id), b.expected_total, b.expected_total_is_estimate
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where b.date between p_date_from and p_date_to
      and b.status not in ('cancelled', 'pending')
    order by b.date, b.start_time;
end; $$;
grant execute on function get_staff_schedule to anon;

-- How many requests are waiting, for the badge. Staff PIN, not owner: every
-- stylist needs to know one is sitting there, even though only the owner
-- decides it.
create or replace function staff_pending_count(p_pin text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  select count(*) into n from bookings where status = 'pending';
  return n;
end; $$;
grant execute on function staff_pending_count to anon;
