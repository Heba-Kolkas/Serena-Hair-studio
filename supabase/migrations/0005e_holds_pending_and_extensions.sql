-- ── PART 8: PENDING BOOKINGS, HOLDS, DECISIONS ──
alter table bookings add column hold_expires_at timestamptz;

create or replace function booking_hold_is_live(b bookings)
returns boolean language sql immutable as $$
  select b.status <> 'pending' or b.hold_expires_at is null or b.hold_expires_at > now();
$$;

drop function if exists get_busy_slots(uuid, date);
create or replace function get_busy_slots(p_staff_id uuid, p_date date)
returns table(start_time time, end_time time, service_id uuid)
language sql security definer set search_path = public as $$
  select b.start_time, b.end_time, b.service_id from bookings b
  where b.staff_id = p_staff_id and b.date = p_date
    and b.status <> 'cancelled'
    and (b.status <> 'pending' or b.hold_expires_at is null or b.hold_expires_at > now());
$$;
grant execute on function get_busy_slots to anon;

drop function if exists get_busy_slots_range(uuid, date, date);
create or replace function get_busy_slots_range(p_staff_id uuid, p_date_from date, p_date_to date)
returns table(date date, start_time time, end_time time, service_id uuid)
language sql security definer set search_path = public as $$
  select b.date, b.start_time, b.end_time, b.service_id from bookings b
  where b.staff_id = p_staff_id
    and b.date between p_date_from and p_date_to
    and b.status <> 'cancelled'
    and (b.status <> 'pending' or b.hold_expires_at is null or b.hold_expires_at > now());
$$;
grant execute on function get_busy_slots_range to anon;

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

create or replace function admin_get_pending_bookings(p_pin text)
returns table (
  id uuid, date date, start_time time, customer_name text, customer_email text,
  customer_phone text, service_name text, staff_name text, booking_ref text,
  hold_expires_at timestamptz, hold_hours_left numeric
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.customer_name, b.customer_email,
           b.customer_phone, s.name, st.name, b.booking_ref, b.hold_expires_at,
           round(extract(epoch from (b.hold_expires_at - now())) / 3600.0, 1)
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where b.status = 'pending'
    order by b.hold_expires_at nulls last, b.date;
end; $$;
grant execute on function admin_get_pending_bookings to anon;

-- ── HOW LONG EXTENSIONS TAKE, PER SERVICE ──
update services set duration_with_extensions_minutes = 240
  where name in ('Balayage / Highlights', 'Half Head Foil', 'Full Head Foil',
                 'Reverse Balayage', 'Root Touch-Up', 'All-Over Color');
update services set duration_with_extensions_minutes = 120 where name = 'Toner';

insert into service_addons (service_id, addon_id, sort_order)
select sv.id, a.id, a.sort_order
from services sv join addons a on a.name like 'Extensions%'
where sv.name = 'Toner'
on conflict do nothing;

-- ── A HAIRCUT DURING AN EXTENSIONS FITTING ──
insert into service_addons (service_id, addon_id, sort_order)
select sv.id, a.id, a.sort_order
from services sv join addons a on a.name = 'Haircut'
where sv.name in ('Hair Extensions (50g)', 'Hair Extensions (100-150g)')
on conflict do nothing;

update services set duration_with_addons_minutes = 90 where name = 'Toner';

-- ── CONSULTATIONS ──
create or replace function consultation_start_allowed(p_start time)
returns boolean language sql immutable set search_path = public as $$
  select not exists (
    select 1 from (values
      (time '11:00'), (time '13:00'), (time '15:00'), (time '16:30')
    ) as anchors(t)
    where p_start >= anchors.t
      and p_start < anchors.t + interval '30 minutes'
  );
$$;
grant execute on function consultation_start_allowed to anon;

-- Owner's revisions, 26 August 2026.
update addons set price = 1000 where name = 'Grey Coverage';
delete from service_addons sa
using addons a, services sv
where sa.addon_id = a.id and sa.service_id = sv.id
  and a.name = 'Toner'
  and sv.name in ('Balayage / Highlights', 'Half Head Foil', 'Full Head Foil',
                  'Reverse Balayage');
