-- Lets the Owner Panel "Move" a booking to a new date/time (and optionally a
-- different stylist) instead of only being able to Confirm/Complete/Cancel.
-- APPLIED 27-28 August 2026 to the studio-serena project.
create or replace function admin_reschedule_booking(
  p_pin text, p_booking_id uuid, p_date date, p_start_time time, p_staff_id uuid default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings; v_duration int;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  select s.duration_minutes into v_duration
    from bookings b join services s on s.id = b.service_id
    where b.id = p_booking_id;
  if v_duration is null then raise exception 'Booking not found'; end if;
  update bookings set
    date = p_date,
    start_time = p_start_time,
    end_time = p_start_time + (v_duration || ' minutes')::interval,
    staff_id = coalesce(p_staff_id, staff_id)
  where id = p_booking_id
  returning * into v_booking;
  return v_booking;
end; $$;
grant execute on function admin_reschedule_booking to anon;
