set check_function_bodies = off;

-- ═══════════════════════════════════════════════════════════════════
--  PART 1 — EXTERNALLY BOOKED SERVICES
-- ═══════════════════════════════════════════════════════════════════
alter table services add column external_booking_url text;
alter table services add column external_booking_label text;

alter table staff add column external_booking_label text;
update staff set external_booking_label = 'Book on Timma' where name = 'Pati';

update staff
  set bookable = false,
      external_booking_url = 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu',
      external_booking_label = 'Book on Instagram'
  where name = 'Taniya S.';

delete from staff_services
  where staff_id in (select id from staff where name = 'Taniya S.');

update services
  set external_booking_url = 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu',
      external_booking_label = 'Book on Instagram'
  where category = 'Keratin & Hair Treatments';

-- ═══════════════════════════════════════════════════════════════════
--  PART 2 — ADD-ONS & COMBOS
-- ═══════════════════════════════════════════════════════════════════
create table addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_no text,
  price numeric(10,2) not null,
  price_is_from boolean not null default false,
  price_on_consultation boolean not null default false,
  kind text not null default 'addon' check (kind in ('addon', 'combo')),
  requires_confirmation boolean not null default false,
  exclusive_group text,
  requires_service_id uuid references services(id) on delete set null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table service_addons (
  service_id uuid not null references services(id) on delete cascade,
  addon_id uuid not null references addons(id) on delete cascade,
  sort_order int not null default 0,
  primary key (service_id, addon_id)
);

create table booking_addons (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  addon_id uuid references addons(id) on delete set null,
  name_at_booking text not null,
  price_at_booking numeric(10,2) not null,
  price_is_from boolean not null default false,
  created_at timestamptz not null default now()
);
create index booking_addons_booking_idx on booking_addons(booking_id);

alter table services add column requires_confirmation boolean not null default false;
update services set requires_confirmation = true where name like 'Hair Extensions%';

alter table bookings add column expected_total numeric(10,2);
alter table bookings add column expected_total_is_estimate boolean not null default false;

-- ── SEED: the add-ons ──
insert into addons (name, name_no, price, price_is_from, price_on_consultation, kind, sort_order) values
  ('Haircut',       'Klipp',           500,  false, false, 'addon', 1),
  ('Grey Coverage', 'Grådekking',      1000, false, false, 'addon', 2),
  ('Toner',         'Toner',           1250, true,  false, 'combo', 3),
  ('Extensions (50g)',        'Extensions (50g)',        0, false, true, 'combo', 4),
  ('Extensions (100-150g)',   'Extensions (100-150g)',   0, false, true, 'combo', 5);

update addons set exclusive_group = 'extensions', requires_confirmation = true
  where name like 'Extensions%';

update addons a set requires_service_id = sv.id
from services sv
where a.name = 'Extensions (50g)' and sv.name = 'Hair Extensions (50g)';
update addons a set requires_service_id = sv.id
from services sv
where a.name = 'Extensions (100-150g)' and sv.name = 'Hair Extensions (100-150g)';

-- ── SEED: which service offers which add-on ──
insert into service_addons (service_id, addon_id, sort_order)
select sv.id, a.id, a.sort_order
from services sv join addons a on true
where
  (a.name = 'Haircut' and sv.name in (
     'Balayage / Highlights', 'Half Head Foil', 'Full Head Foil',
     'Root Touch-Up', 'All-Over Color', 'Reverse Balayage', 'Toner'))
  or (a.name = 'Grey Coverage' and sv.name in (
     'Balayage / Highlights', 'Half Head Foil', 'Full Head Foil', 'Reverse Balayage'))
  or (a.name = 'Toner' and sv.name in ('Root Touch-Up', 'All-Over Color'))
  or (a.name like 'Extensions%' and sv.name in (
     'Balayage / Highlights', 'Half Head Foil', 'Full Head Foil', 'Reverse Balayage',
     'Root Touch-Up', 'All-Over Color'));

-- 0001's book_appointment took eight arguments; this one takes nine.
drop function if exists book_appointment(uuid, uuid, date, time, text, text, text, text);

-- Public wizard: every rule applies.
create or replace function book_appointment(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null
) returns bookings language sql security definer set search_path = public as $$
  select book_appointment_core(
    p_service_id, p_staff_id, p_date, p_start_time,
    p_customer_name, p_customer_email, p_customer_phone,
    p_notes, p_addon_ids, false, true);
$$;
grant execute on function book_appointment to anon;

create or replace function staff_book_appointment(
  p_pin text, p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_manual_overlap boolean;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  -- Overlapping by hand is granted per stylist, not to whoever holds the PIN.
  -- A stylist without it still books here (skipping the horizon and the day
  -- policy), but their bookings can't collide.
  select coalesce(allow_manual_overlap, false) into v_manual_overlap
    from staff where id = p_staff_id;
  return book_appointment_core(
    p_service_id, p_staff_id, p_date, p_start_time,
    p_customer_name, p_customer_email, p_customer_phone,
    p_notes, p_addon_ids, coalesce(v_manual_overlap, false), false);
end; $$;
grant execute on function staff_book_appointment to anon;

-- ═══════════════════════════════════════════════════════════════════
--  PART 4 — SURFACE ADD-ONS WHEREVER BOOKINGS ARE READ
-- ═══════════════════════════════════════════════════════════════════
create or replace function booking_addons_label(p_booking_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select nullif(string_agg(name_at_booking, ', ' order by created_at, name_at_booking), '')
  from booking_addons where booking_id = p_booking_id;
$$;

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
      and (p_staff_id is null or b.staff_id = p_staff_id)
      and b.status <> 'cancelled'
    order by b.date, b.start_time;
end; $$;
grant execute on function get_staff_schedule to anon;

drop function if exists search_staff_bookings(text, text);
create or replace function search_staff_bookings(p_pin text, p_query text)
returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_phone text, notes text,
  service_name text, service_color text, staff_id uuid, staff_name text,
  addons text, expected_total numeric, expected_total_is_estimate boolean
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  if length(trim(p_query)) < 2 then raise exception 'Search term too short'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_phone, b.notes,
           s.name, s.color, st.id, st.name,
           booking_addons_label(b.id), b.expected_total, b.expected_total_is_estimate
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where b.status <> 'cancelled'
      and (
        b.customer_name ilike '%' || p_query || '%'
        or b.customer_phone ilike '%' || p_query || '%'
        or b.customer_email ilike '%' || p_query || '%'
      )
    order by b.date desc, b.start_time desc
    limit 100;
end; $$;
grant execute on function search_staff_bookings to anon;

drop function if exists admin_get_bookings(text, date, text);
create or replace function admin_get_bookings(p_pin text, p_date_from date default null, p_status text default null)
returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_email text, customer_phone text, notes text,
  booking_ref text, service_name text, staff_id uuid, staff_name text, amount_charged numeric,
  addons text, expected_total numeric, expected_total_is_estimate boolean
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_email, b.customer_phone, b.notes, b.booking_ref,
           s.name, st.id, st.name, b.amount_charged,
           booking_addons_label(b.id), b.expected_total, b.expected_total_is_estimate
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where (p_date_from is null or b.date >= p_date_from)
      and (p_status is null or p_status = '' or b.status = p_status::booking_status)
    order by b.date desc, b.start_time desc
    limit 300;
end; $$;
grant execute on function admin_get_bookings to anon;
