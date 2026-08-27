-- ── MOVING AN APPOINTMENT CAN ALSO CHANGE WHAT IT IS ──
-- A move is often not only a new time. The client rings to say she cannot make
-- Thursday, and while she is on the phone she decides to have a toner as well
-- as the colour. Before this, the owner had to move the booking and then edit
-- the service separately - two operations, and if the second was forgotten the
-- appointment sat in the calendar at the wrong length, quietly overrunning
-- whatever was booked after it.
--
-- p_service_id is optional and defaults to leaving the service alone, so every
-- existing caller behaves exactly as it did.
--
-- The end time is always recomputed from whichever service ends up on the
-- booking, because the length is a fact about the service and must never be
-- carried over from the old one.
--
-- APPLIED 27-28 August 2026 to the studio-serena project.
-- 0004's version took five arguments; this takes six. That is an overload,
-- not a replacement, so the bare GRANT below would be ambiguous with both
-- present. The old signature goes first.
drop function if exists admin_reschedule_booking(text, uuid, date, time, uuid);

create or replace function admin_reschedule_booking(
  p_pin text,
  p_booking_id uuid,
  p_date date,
  p_start_time time,
  p_staff_id uuid default null,
  p_service_id uuid default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings;
  v_service_id uuid;
  v_duration int;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;

  -- Whichever service the booking will have once this is done: the new one if
  -- one was named, otherwise the one it already had.
  select coalesce(p_service_id, b.service_id) into v_service_id
    from bookings b where b.id = p_booking_id;
  if v_service_id is null then raise exception 'Booking not found'; end if;

  select s.duration_minutes into v_duration
    from services s where s.id = v_service_id;
  if v_duration is null then raise exception 'Service not found'; end if;

  update bookings set
    date = p_date,
    start_time = p_start_time,
    end_time = p_start_time + (v_duration || ' minutes')::interval,
    staff_id = coalesce(p_staff_id, staff_id),
    service_id = v_service_id
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end; $$;

grant execute on function admin_reschedule_booking to anon;
