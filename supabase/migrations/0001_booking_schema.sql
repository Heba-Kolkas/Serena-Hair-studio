-- Studio Serena booking system schema.
-- NOT YET APPLIED — the studio-serena Supabase project is paused pending a Pro
-- upgrade. Apply via Supabase MCP `apply_migration` (or `supabase db push`)
-- once the project is restored. Seed data lives in 0002_seed_data.sql.

-- ── SERVICES ──
create table services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_no text,
  description text,
  description_no text,
  -- price_from is null only when price_on_consultation is true (e.g. Keratin
  -- Treatment, which has no fixed price — it depends on hair length/type).
  -- price_to is set when the real price is a range (e.g. Highlights/Balayage,
  -- 3,500-4,000 NOK) — null means a single fixed price.
  price_from numeric(10,2),
  price_to numeric(10,2),
  price_on_consultation boolean not null default false,
  -- Whether price_from is a floor ("from 3,750 kr") or the actual figure
  -- ("950 kr"). The printed price list draws this distinction explicitly and
  -- it can't be inferred: a service with no price_to may be either. It also
  -- decides whether a booking's expected_total counts as an estimate.
  price_is_from boolean not null default false,
  duration_minutes int not null,
  -- How long the appointment runs when the client picks ANY add-on. Flat, not
  -- additive: a root touch-up is 90 minutes alone and 120 with a haircut or a
  -- toner attached — 120 either way, not 90 + one delta per add-on. Null (the
  -- usual case) means add-ons don't change the length at all, which is how
  -- balayage works: 4 hours whatever is added to it.
  duration_with_addons_minutes int,
  -- Counts toward a stylist's per-day cap (staff_scheduled_service_limit).
  -- True for the four-hour lightening family only: Kani takes one of those a
  -- day on Mon/Wed/Fri, but any number of the shorter services around it.
  daily_limited boolean not null default false,
  -- Set only for services that run at fixed times instead of the normal
  -- 15-minute grid across business hours (e.g. Balayage: 11:00 & 15:00 only).
  -- Null means "generate the normal dynamic grid."
  fixed_times time[],
  category text not null,
  image_url text,
  -- Hex color shown for this service's appointment blocks on schedule.html
  -- (the stylist-facing "who's in today" grid) — owner-editable via the
  -- Owner Panel's Services tab. Falls back to a neutral grey when unset.
  color text,
  featured boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint services_price_check check (price_on_consultation or price_from is not null)
);

-- ── STAFF (replaces the gallery/team/members.json blob) ──
create table staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  role_no text,
  bio text,
  bio_no text,
  photo_url text,
  instagram text,
  bookable boolean not null default true,
  external_booking_url text,
  -- Hassan-only today: while this stylist has a Balayage client processing
  -- (11:00 or 15:00, 180min), a second client can book a different
  -- non-Bridal service with them at the paired time (13:00 or 16:30) —
  -- a deliberate, real overlap, not a scheduling bug. See book_appointment.
  allow_overlap_booking boolean not null default false,
  -- Whether a booking entered BY HAND in the schedule tool may overlap this
  -- stylist's existing ones. Separate from allow_overlap_booking above, which
  -- is about the public wizard's balayage pairing: this is the stylist
  -- judging their own day, and it's granted per person rather than to anyone
  -- holding the staff PIN.
  allow_manual_overlap boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ── STAFF <-> SERVICES ──
create table staff_services (
  staff_id uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  primary key (staff_id, service_id)
);

-- ── PER-STAFF FIXED-TIME OVERRIDES ──
-- Overrides services.fixed_times for a specific (staff, service) pair, when
-- the fixed times differ by stylist and/or weekday — e.g. Balayage is
-- bookable at 11:00 & 15:00 for Hassan every weekday, but for Kani only on
-- Tuesday/Thursday (Monday/Wednesday/Friday she's 11:00-only). If a pair has
-- no rows here, book_appointment falls back to services.fixed_times.
create table staff_service_schedule (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  start_time time not null,
  unique (staff_id, service_id, weekday, start_time)
);

-- ── PER-STAFF HOURS OVERRIDE ──
-- Extends (or shortens) a specific stylist's closing time on a specific
-- weekday beyond the salon's general business_hours — e.g. Kani takes
-- clients until 18:00 on Mon/Wed/Fri even though the salon's general close
-- is 17:30. No row for a (staff, weekday) means "use the general hours."
create table staff_hours_override (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  close_time time not null,
  unique (staff_id, weekday)
);

-- ── BUSINESS HOURS ──
create table business_hours (
  weekday int primary key check (weekday between 0 and 6), -- 0=Sun..6=Sat (JS Date.getDay())
  open_time time,
  close_time time,
  closed boolean not null default false
);

-- ── BLOCKED SLOTS / TIME OFF ──
create table blocked_slots (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff(id) on delete cascade, -- null = whole-salon closure
  date date not null,
  start_time time not null,
  end_time time not null,
  reason text,
  created_at timestamptz not null default now()
);

-- ── ACTIVITY LOG (owner-facing, Owner Panel "Activity" tab) ──
-- Attributes actions taken through the shared-PIN schedule.html tool to a
-- specific stylist. actor_staff_id is self-reported (a stylist picks their
-- own name once per device after entering the PIN — see verify_staff_pin) —
-- not real per-user auth, just enough for "who marked this no-show?" Rows
-- are only ever written by the SECURITY DEFINER RPCs below, never directly
-- by a client, so a stylist can't fabricate someone else's entry.
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_staff_id uuid references staff(id), -- who performed the action
  subject_staff_id uuid references staff(id), -- whose booking/time it affects
  action text not null check (action in ('arrived', 'no_show', 'confirmed', 'block_created', 'block_removed')),
  detail text,
  created_at timestamptz not null default now()
);
create index activity_log_created_at_idx on activity_log(created_at desc);

-- ── BOOKINGS ──
-- 'arrived'/'no_show' are set only by staff_schedule's update_booking_status_staff
-- RPC below (the stylist-facing "who's in today" view) — never by book_appointment.
-- New bookings default straight to 'confirmed', not 'pending': book_appointment
-- already enforces every booking rule (fixed times, business hours, staff
-- availability, no double-booking) before the row is ever inserted, so there's
-- nothing left for a human to manually confirm afterward. 'pending' stays in
-- the enum for flexibility, it's just never the default anymore.
create type booking_status as enum ('pending','confirmed','arrived','no_show','cancelled','completed');

create table bookings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references services(id),
  staff_id uuid not null references staff(id),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  status booking_status not null default 'confirmed',
  notes text,
  -- What the client actually paid, captured when the booking is marked
  -- Completed (see admin_complete_booking) — not derived from services.price,
  -- since several services are consultation-priced (no fixed number) or
  -- priced as a range. Null until completed. This is also the exact field a
  -- future POS-terminal integration would fill in automatically instead of
  -- a manual entry, so no rework needed once that's connected.
  amount_charged numeric,
  booking_ref text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,8),
  created_at timestamptz not null default now()
);

create index bookings_staff_date_idx on bookings(staff_id, date);
create index bookings_email_idx on bookings(lower(customer_email));
create index bookings_phone_idx on bookings(customer_phone);

-- Hard backstop: identical (staff, date, start_time) can never both commit,
-- even if the advisory-lock RPC below is somehow bypassed.
create unique index bookings_staff_slot_unique
  on bookings (staff_id, date, start_time) where status <> 'cancelled';

-- ── APP SETTINGS (generic key/value store) ──
-- First use: the shared PIN stylists enter to open schedule.html. RLS below
-- gives this table NO anon policy at all — the real value is only ever read
-- by the SECURITY DEFINER verify_staff_pin() RPC, never fetched by a client.
create table app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ── ATOMIC BOOKING RPC ──
-- Takes an advisory lock on (staff_id, date) so two concurrent requests for the
-- same stylist/day can't both pass the availability check before either commits.
create or replace function book_appointment(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null
) returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_duration int; v_end_time time; v_weekday int;
  v_open time; v_close time; v_closed boolean; v_staff_close time;
  v_fixed_times time[]; v_category text; v_service_name text;
  v_conflict int; v_booking bookings;
  v_allow_overlap boolean; v_schedule_count int; v_consult_count int;
begin
  perform pg_advisory_xact_lock(hashtext(p_staff_id::text || p_date::text));

  select duration_minutes, fixed_times, category, name
    into v_duration, v_fixed_times, v_category, v_service_name
    from services where id = p_service_id and active;
  if v_duration is null then raise exception 'Invalid or inactive service'; end if;
  v_end_time := p_start_time + (v_duration || ' minutes')::interval;

  if not exists (select 1 from staff_services where staff_id = p_staff_id and service_id = p_service_id) then
    raise exception 'This stylist does not perform this service';
  end if;

  v_weekday := extract(dow from p_date);

  -- Consultation is a special case: any open slot works (handled by the
  -- overlap exemption below), but capped at 17:00 and 2 per stylist/day.
  if v_service_name = 'Consultation' then
    if p_start_time > '17:00' then
      raise exception 'Consultations must start by 17:00';
    end if;
    select count(*) into v_consult_count from bookings
      where staff_id = p_staff_id and date = p_date and service_id = p_service_id
        and status <> 'cancelled';
    if v_consult_count >= 2 then
      raise exception 'This stylist already has 2 consultations booked today';
    end if;
  end if;

  -- Per-staff schedule override (e.g. Balayage's per-stylist/weekday times)
  -- takes precedence over the service's own generic fixed_times.
  select count(*) into v_schedule_count from staff_service_schedule
    where staff_id = p_staff_id and service_id = p_service_id;
  if v_schedule_count > 0 then
    if not exists (
      select 1 from staff_service_schedule
      where staff_id = p_staff_id and service_id = p_service_id
        and weekday = v_weekday and start_time = p_start_time
    ) then
      raise exception 'This time is not available for this stylist';
    end if;
  elsif v_fixed_times is not null and not (p_start_time = any(v_fixed_times)) then
    raise exception 'This service can only be booked at its fixed times';
  end if;

  select open_time, close_time, closed into v_open, v_close, v_closed
    from business_hours where weekday = v_weekday;

  -- Per-staff closing-time override (e.g. Kani takes clients until 18:00 on
  -- Mon/Wed/Fri, later than the salon's general 17:30 close).
  select close_time into v_staff_close from staff_hours_override
    where staff_id = p_staff_id and weekday = v_weekday;
  if v_staff_close is not null then v_close := v_staff_close; end if;

  -- Fixed-time bookings (Balayage's per-stylist schedule, or a service's own
  -- fixed_times) are owner-curated and allowed to run past closing — e.g. a
  -- 15:00 Balayage (240min) legitimately finishes at 19:00 even though the
  -- salon stops taking new arrivals at 17:30. Only the dynamic open-grid
  -- case must fit entirely before v_close.
  if v_closed or v_open is null or p_start_time < v_open
     or (v_schedule_count = 0 and v_fixed_times is null and v_end_time > v_close) then
    raise exception 'Outside business hours';
  end if;

  select count(*) into v_conflict from blocked_slots
    where (staff_id = p_staff_id or staff_id is null) and date = p_date
      and start_time < v_end_time and end_time > p_start_time;
  if v_conflict > 0 then raise exception 'Slot is blocked'; end if;

  select allow_overlap_booking into v_allow_overlap from staff where id = p_staff_id;

  -- Two separate exemptions from the usual "no time overlap" rule:
  -- 1) Overlap-eligible stylists can take a second, non-Bridal client at
  --    13:00 while an 11:00 Balayage is processing (16:30 for a 15:00
  --    Balayage) — that specific pairing only.
  -- 2) A Consultation can nest inside any other booking's time block —
  --    it just can't share that booking's exact start time, which the
  --    bookings_staff_slot_unique index already guarantees on its own.
  select count(*) into v_conflict from bookings b
    where b.staff_id = p_staff_id and b.date = p_date and b.status <> 'cancelled'
      and b.start_time < v_end_time and b.end_time > p_start_time
      and not (
        (
          coalesce(v_allow_overlap, false)
          and v_category <> 'Bridal & Special Occasion'
          and (b.end_time - b.start_time) = interval '240 minutes'
          and b.start_time in ('11:00', '15:00')
          and (
            (b.start_time = '11:00' and p_start_time = '13:00')
            or (b.start_time = '15:00' and p_start_time = '16:30')
          )
        )
        or v_service_name = 'Consultation'
      );
  if v_conflict > 0 then raise exception 'Slot no longer available'; end if;

  insert into bookings (service_id, staff_id, customer_name, customer_email, customer_phone, date, start_time, end_time, notes)
  values (p_service_id, p_staff_id, p_customer_name, p_customer_email, p_customer_phone, p_date, p_start_time, v_end_time, p_notes)
  returning * into v_booking;
  return v_booking;
end; $$;
grant execute on function book_appointment to anon;

-- ── PUBLIC-SAFE LOOKUP RPCs (bookings itself has no anon policy — see below) ──
create or replace function get_busy_slots(p_staff_id uuid, p_date date)
returns table(start_time time, end_time time) language sql security definer set search_path = public as $$
  select start_time, end_time from bookings
  where staff_id = p_staff_id and date = p_date and status <> 'cancelled';
$$;
grant execute on function get_busy_slots to anon;

create or replace function get_my_bookings(p_email text, p_phone text)
returns setof bookings language sql security definer set search_path = public as $$
  select * from bookings
  where lower(customer_email) = lower(p_email) or customer_phone = p_phone
  order by date desc, start_time desc;
$$;
grant execute on function get_my_bookings to anon;

create or replace function cancel_my_booking(p_booking_id uuid, p_email text, p_phone text)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings;
begin
  update bookings set status = 'cancelled'
  where id = p_booking_id
    and (lower(customer_email) = lower(p_email) or customer_phone = p_phone)
    and status not in ('cancelled','completed')
  returning * into v_booking;
  if v_booking is null then raise exception 'Booking not found or already cancelled/completed'; end if;
  return v_booking;
end; $$;
grant execute on function cancel_my_booking to anon;

-- ── STAFF SCHEDULE (stylist-facing "who's in today" view, schedule.html) ──
-- All three are gated by a single shared PIN (see app_settings.staff_pin),
-- checked server-side here so it can't be bypassed by calling the RPC
-- directly with the anon key — the client-side gate alone would be theater.
-- Accepts either the everyday shared staff_pin or the owner_pin — the owner
-- signs into the exact same schedule.html with the same PIN field, just a
-- different value, and is_owner_pin (below) determines whether the extra
-- owner-only tabs unlock. There's no separate admin login anymore.
create or replace function verify_staff_pin(p_pin text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from app_settings where key in ('staff_pin', 'owner_pin') and value = p_pin);
$$;
grant execute on function verify_staff_pin to anon;

create or replace function is_owner_pin(p_pin text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from app_settings where key = 'owner_pin' and value = p_pin);
$$;
grant execute on function is_owner_pin to anon;

create or replace function get_staff_schedule(
  p_pin text, p_date_from date, p_date_to date, p_staff_id uuid default null
) returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_phone text, notes text,
  service_name text, service_color text, staff_id uuid, staff_name text
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_phone, b.notes,
           s.name, s.color, st.id, st.name
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where b.date between p_date_from and p_date_to
      and (p_staff_id is null or b.staff_id = p_staff_id)
      and b.status <> 'cancelled'
    order by b.date, b.start_time;
end; $$;
grant execute on function get_staff_schedule to anon;

create or replace function update_booking_status_staff(p_pin text, p_booking_id uuid, p_status text, p_actor_staff_id uuid default null)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings; v_service_name text;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  -- Intentionally narrow: this RPC can only check clients in/out (or undo a
  -- mis-click back to Confirmed), never cancel or reschedule — those stay
  -- owner-only, via the admin_* RPCs (Owner Panel's Bookings tab).
  if p_status not in ('arrived', 'no_show', 'confirmed') then
    raise exception 'Invalid status';
  end if;
  update bookings set status = p_status::booking_status
    where id = p_booking_id
    returning * into v_booking;
  if v_booking.id is null then raise exception 'Booking not found'; end if;
  select name into v_service_name from services where id = v_booking.service_id;
  insert into activity_log (actor_staff_id, subject_staff_id, action, detail)
  values (p_actor_staff_id, v_booking.staff_id, p_status, v_booking.customer_name || coalesce(' · ' || v_service_name, ''));
  return v_booking;
end; $$;
grant execute on function update_booking_status_staff to anon;

-- Lets a stylist block their own time off (sick, break, personal) straight
-- from schedule.html — inserts into the same blocked_slots table
-- book_appointment already checks, so it takes effect immediately for new
-- bookings. Always scoped to one staff_id: a stylist can never create a
-- staff_id IS NULL row (that's a whole-salon closure, owner-only via
-- admin_add_blocked_slot / the Owner Panel's Hours tab).
create or replace function add_staff_unavailable(
  p_pin text, p_staff_id uuid, p_date date, p_start_time time, p_end_time time, p_reason text default null, p_actor_staff_id uuid default null
) returns blocked_slots language plpgsql security definer set search_path = public as $$
declare v_slot blocked_slots;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  if p_staff_id is null then raise exception 'A stylist is required'; end if;
  if p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;
  insert into blocked_slots (staff_id, date, start_time, end_time, reason)
  values (p_staff_id, p_date, p_start_time, p_end_time, p_reason)
  returning * into v_slot;
  insert into activity_log (actor_staff_id, subject_staff_id, action, detail)
  values (
    p_actor_staff_id, p_staff_id, 'block_created',
    to_char(p_date, 'YYYY-MM-DD') || ' · ' ||
    (case when p_start_time = '00:00' and p_end_time = '23:59' then 'All day' else to_char(p_start_time,'HH24:MI') || '–' || to_char(p_end_time,'HH24:MI') end) ||
    coalesce(' · ' || p_reason, '')
  );
  return v_slot;
end; $$;
grant execute on function add_staff_unavailable to anon;

create or replace function remove_staff_unavailable(p_pin text, p_blocked_slot_id uuid, p_actor_staff_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_slot blocked_slots;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  -- staff_id is not null guards against a stylist ever removing an
  -- owner-set whole-salon closure (those have staff_id is null).
  delete from blocked_slots where id = p_blocked_slot_id and staff_id is not null
    returning * into v_slot;
  if v_slot.id is not null then
    insert into activity_log (actor_staff_id, subject_staff_id, action, detail)
    values (
      p_actor_staff_id, v_slot.staff_id, 'block_removed',
      to_char(v_slot.date, 'YYYY-MM-DD') || ' · ' ||
      (case when v_slot.start_time = '00:00' and v_slot.end_time = '23:59' then 'All day' else to_char(v_slot.start_time,'HH24:MI') || '–' || to_char(v_slot.end_time,'HH24:MI') end) ||
      coalesce(' · ' || v_slot.reason, '')
    );
  end if;
end; $$;
grant execute on function remove_staff_unavailable to anon;

-- Client lookup by name/phone/email, across all time (not date-bounded like
-- get_staff_schedule) — powers schedule.html's search bar and the "Check
-- history" button on an appointment's detail popup.
create or replace function search_staff_bookings(p_pin text, p_query text)
returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_phone text, notes text,
  service_name text, service_color text, staff_id uuid, staff_name text
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  if length(trim(p_query)) < 2 then raise exception 'Search term too short'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_phone, b.notes,
           s.name, s.color, st.id, st.name
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

-- Lets any stylist pick per-service colors from schedule.html — deliberately
-- narrow: only the color column, nothing else about a service, so this
-- can't be used to rename services or change prices. (Full service editing
-- is owner-only — see admin_upsert_service below.)
create or replace function update_service_color(p_pin text, p_service_id uuid, p_color text)
returns services language plpgsql security definer set search_path = public as $$
declare v_service services;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  if p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid color'; end if;
  update services set color = p_color where id = p_service_id returning * into v_service;
  if v_service.id is null then raise exception 'Service not found'; end if;
  return v_service;
end; $$;
grant execute on function update_service_color to anon;

-- ── OWNER-ONLY MANAGEMENT (schedule.html's "Owner" tabs — no more separate
-- admin.html / Supabase Auth login. Everything below requires the owner_pin
-- specifically, checked via is_owner_pin, not just any valid staff_pin. ──

create or replace function admin_get_all_services(p_pin text)
returns setof services language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query select * from services order by sort_order;
end; $$;
grant execute on function admin_get_all_services to anon;

create or replace function admin_upsert_service(
  p_pin text, p_id uuid default null, p_name text default null, p_name_no text default null,
  p_category text default null, p_price_from numeric default null, p_price_to numeric default null,
  p_price_on_consultation boolean default false, p_duration_minutes int default null,
  p_color text default null, p_image_url text default null, p_featured boolean default false,
  p_active boolean default true
) returns services language plpgsql security definer set search_path = public as $$
declare v_service services;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_id is null then
    insert into services (name, name_no, category, price_from, price_to, price_on_consultation, duration_minutes, color, image_url, featured, active)
    values (p_name, p_name_no, p_category, p_price_from, p_price_to, p_price_on_consultation, p_duration_minutes, p_color, p_image_url, p_featured, p_active)
    returning * into v_service;
  else
    update services set
      name = p_name, name_no = p_name_no, category = p_category,
      price_from = p_price_from, price_to = p_price_to, price_on_consultation = p_price_on_consultation,
      duration_minutes = p_duration_minutes, color = p_color, image_url = p_image_url,
      featured = p_featured, active = p_active
    where id = p_id
    returning * into v_service;
  end if;
  return v_service;
end; $$;
grant execute on function admin_upsert_service to anon;

create or replace function admin_delete_service(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  delete from services where id = p_id;
end; $$;
grant execute on function admin_delete_service to anon;

create or replace function admin_get_all_staff(p_pin text)
returns setof staff language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query select * from staff order by sort_order;
end; $$;
grant execute on function admin_get_all_staff to anon;

create or replace function admin_upsert_staff(
  p_pin text, p_id uuid default null, p_name text default null, p_role text default null, p_role_no text default null,
  p_bio text default null, p_bio_no text default null, p_photo_url text default null, p_instagram text default null,
  p_bookable boolean default true, p_external_booking_url text default null, p_allow_overlap_booking boolean default false,
  p_sort_order int default 0, p_active boolean default true
) returns staff language plpgsql security definer set search_path = public as $$
declare v_staff staff;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_id is null then
    insert into staff (name, role, role_no, bio, bio_no, photo_url, instagram, bookable, external_booking_url, allow_overlap_booking, sort_order, active)
    values (p_name, p_role, p_role_no, p_bio, p_bio_no, p_photo_url, p_instagram, p_bookable, p_external_booking_url, p_allow_overlap_booking, p_sort_order, p_active)
    returning * into v_staff;
  else
    update staff set
      name = p_name, role = p_role, role_no = p_role_no, bio = p_bio, bio_no = p_bio_no,
      photo_url = p_photo_url, instagram = p_instagram, bookable = p_bookable,
      external_booking_url = p_external_booking_url, allow_overlap_booking = p_allow_overlap_booking,
      sort_order = p_sort_order, active = p_active
    where id = p_id
    returning * into v_staff;
  end if;
  return v_staff;
end; $$;
grant execute on function admin_upsert_staff to anon;

create or replace function admin_get_bookings(p_pin text, p_date_from date default null, p_status text default null)
returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_email text, customer_phone text, notes text,
  booking_ref text, service_name text, staff_id uuid, staff_name text, amount_charged numeric
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_email, b.customer_phone, b.notes, b.booking_ref,
           s.name, st.id, st.name, b.amount_charged
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where (p_date_from is null or b.date >= p_date_from)
      and (p_status is null or p_status = '' or b.status = p_status::booking_status)
    order by b.date desc, b.start_time desc
    limit 300;
end; $$;
grant execute on function admin_get_bookings to anon;

-- Broader than update_booking_status_staff (arrived/no_show only) — the
-- owner can also confirm/cancel, the actions that used to live in
-- admin.html's Bookings tab. 'completed' is deliberately NOT allowed here —
-- completing a booking must go through admin_complete_booking below, which
-- requires an amount_charged, so a booking can never be marked done without
-- a revenue figure attached.
create or replace function admin_update_booking_status(p_pin text, p_booking_id uuid, p_status text)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_status not in ('pending','confirmed','arrived','no_show','cancelled') then
    raise exception 'Invalid status';
  end if;
  update bookings set status = p_status::booking_status where id = p_booking_id returning * into v_booking;
  if v_booking.id is null then raise exception 'Booking not found'; end if;
  return v_booking;
end; $$;
grant execute on function admin_update_booking_status to anon;

-- Marks a booking Completed AND records what the client actually paid, in
-- one step — see the amount_charged column comment above for why this is
-- separate from admin_update_booking_status.
create or replace function admin_complete_booking(p_pin text, p_booking_id uuid, p_amount_charged numeric)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_amount_charged is null or p_amount_charged < 0 then raise exception 'Enter a valid amount charged'; end if;
  update bookings set status = 'completed', amount_charged = p_amount_charged
    where id = p_booking_id returning * into v_booking;
  if v_booking.id is null then raise exception 'Booking not found'; end if;
  return v_booking;
end; $$;
grant execute on function admin_complete_booking to anon;

-- Revenue by stylist for a date range — every active, BOOKABLE stylist is
-- always included (even with 0 kr in the period) via the left join, so the
-- Revenue tab reads as a clear roster. Non-bookable staff (e.g. Heba/Pati,
-- who don't take appointments through this system) are excluded entirely —
-- they'd otherwise just clutter the list at a permanent 0 kr.
create or replace function admin_get_revenue(p_pin text, p_date_from date, p_date_to date)
returns table (staff_id uuid, staff_name text, total_revenue numeric, booking_count int)
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select st.id, st.name,
           coalesce(sum(b.amount_charged), 0)::numeric,
           count(b.id)::int
    from staff st
    left join bookings b on b.staff_id = st.id and b.status = 'completed'
      and b.date between p_date_from and p_date_to and b.amount_charged is not null
    where st.active = true and st.bookable = true
    group by st.id, st.name
    order by coalesce(sum(b.amount_charged), 0) desc, st.name;
end; $$;
grant execute on function admin_get_revenue to anon;

-- ── STAFF ⇄ SERVICE ASSIGNMENT (owner-editable) ──
create or replace function admin_get_staff_services(p_pin text)
returns table (staff_id uuid, service_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query select ss.staff_id, ss.service_id from staff_services ss;
end; $$;
grant execute on function admin_get_staff_services to anon;

-- Replaces the FULL service list for one stylist in one call — matches a
-- checkbox-list UI (owner ticks which services that stylist performs, saves
-- once) better than adding/removing one row at a time.
create or replace function admin_set_staff_services(p_pin text, p_staff_id uuid, p_service_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  delete from staff_services where staff_id = p_staff_id;
  if p_service_ids is not null and array_length(p_service_ids, 1) > 0 then
    insert into staff_services (staff_id, service_id)
      select p_staff_id, unnest(p_service_ids);
  end if;
end; $$;
grant execute on function admin_set_staff_services to anon;

-- ── PER-STYLIST HOUR OVERRIDES (owner-editable) ──
create or replace function admin_get_staff_hours_overrides(p_pin text)
returns table (id uuid, staff_id uuid, staff_name text, weekday int, close_time time)
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select o.id, o.staff_id, s.name, o.weekday, o.close_time
    from staff_hours_override o join staff s on s.id = o.staff_id
    order by s.name, o.weekday;
end; $$;
grant execute on function admin_get_staff_hours_overrides to anon;

create or replace function admin_upsert_staff_hours_override(p_pin text, p_staff_id uuid, p_weekday int, p_close_time time)
returns staff_hours_override language plpgsql security definer set search_path = public as $$
declare v_row staff_hours_override;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  insert into staff_hours_override (staff_id, weekday, close_time)
  values (p_staff_id, p_weekday, p_close_time)
  on conflict (staff_id, weekday) do update set close_time = excluded.close_time
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function admin_upsert_staff_hours_override to anon;

create or replace function admin_delete_staff_hours_override(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  delete from staff_hours_override where id = p_id;
end; $$;
grant execute on function admin_delete_staff_hours_override to anon;

create or replace function admin_upsert_business_hours(p_pin text, p_weekday int, p_open_time time, p_close_time time, p_closed boolean)
returns business_hours language plpgsql security definer set search_path = public as $$
declare v_row business_hours;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  insert into business_hours (weekday, open_time, close_time, closed)
  values (p_weekday, p_open_time, p_close_time, p_closed)
  on conflict (weekday) do update set open_time = excluded.open_time, close_time = excluded.close_time, closed = excluded.closed
  returning * into v_row;
  return v_row;
end; $$;
grant execute on function admin_upsert_business_hours to anon;

create or replace function admin_get_blocked_slots(p_pin text, p_date_from date default null)
returns table (id uuid, staff_id uuid, staff_name text, date date, start_time time, end_time time, reason text)
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select bs.id, bs.staff_id, st.name, bs.date, bs.start_time, bs.end_time, bs.reason
    from blocked_slots bs
    left join staff st on st.id = bs.staff_id
    where p_date_from is null or bs.date >= p_date_from
    order by bs.date;
end; $$;
grant execute on function admin_get_blocked_slots to anon;

-- Owner version of add_staff_unavailable — staff_id can be null (whole-salon
-- closure), which a stylist is never allowed to create.
create or replace function admin_add_blocked_slot(p_pin text, p_staff_id uuid, p_date date, p_start_time time, p_end_time time, p_reason text default null)
returns blocked_slots language plpgsql security definer set search_path = public as $$
declare v_slot blocked_slots;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;
  insert into blocked_slots (staff_id, date, start_time, end_time, reason)
  values (p_staff_id, p_date, p_start_time, p_end_time, p_reason)
  returning * into v_slot;
  return v_slot;
end; $$;
grant execute on function admin_add_blocked_slot to anon;

create or replace function admin_remove_blocked_slot(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  delete from blocked_slots where id = p_id;
end; $$;
grant execute on function admin_remove_blocked_slot to anon;

create or replace function admin_get_activity_log(p_pin text, p_date_from date default null, p_staff_id uuid default null)
returns table (
  id uuid, actor_name text, subject_name text, action text, detail text, created_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select al.id, actor.name, subject.name, al.action, al.detail, al.created_at
    from activity_log al
    left join staff actor on actor.id = al.actor_staff_id
    left join staff subject on subject.id = al.subject_staff_id
    where (p_date_from is null or al.created_at >= p_date_from)
      and (p_staff_id is null or al.actor_staff_id = p_staff_id or al.subject_staff_id = p_staff_id)
    order by al.created_at desc
    limit 200;
end; $$;
grant execute on function admin_get_activity_log to anon;

create or replace function admin_set_pin(p_pin text, p_key text, p_new_value text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_key not in ('staff_pin', 'owner_pin') then raise exception 'Invalid setting'; end if;
  insert into app_settings (key, value, updated_at) values (p_key, p_new_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end; $$;
grant execute on function admin_set_pin to anon;

-- ── RLS ──
alter table services enable row level security;
create policy "public read active services" on services for select using (active = true);
create policy "admin manage services" on services for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

alter table staff enable row level security;
create policy "public read active staff" on staff for select using (active = true);
create policy "admin manage staff" on staff for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

alter table staff_services enable row level security;
create policy "public read staff_services" on staff_services for select using (true);
create policy "admin manage staff_services" on staff_services for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

alter table staff_service_schedule enable row level security;
create policy "public read staff_service_schedule" on staff_service_schedule for select using (true);
create policy "admin manage staff_service_schedule" on staff_service_schedule for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

alter table staff_hours_override enable row level security;
create policy "public read staff_hours_override" on staff_hours_override for select using (true);
create policy "admin manage staff_hours_override" on staff_hours_override for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

alter table business_hours enable row level security;
create policy "public read business_hours" on business_hours for select using (true);
create policy "admin manage business_hours" on business_hours for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

alter table blocked_slots enable row level security;
create policy "public read blocked_slots" on blocked_slots for select using (true);
create policy "admin manage blocked_slots" on blocked_slots for all using (auth.role()='authenticated') with check (auth.role()='authenticated');

alter table bookings enable row level security;
create policy "admin full access to bookings" on bookings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- Deliberately no anon policy on bookings — the public only ever touches it via
-- the SECURITY DEFINER RPCs above (book_appointment / get_busy_slots /
-- get_my_bookings / cancel_my_booking / get_staff_schedule / update_booking_status_staff).

alter table app_settings enable row level security;
create policy "admin manage app_settings" on app_settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- Deliberately no anon policy at all — the PIN value is only ever read by the
-- SECURITY DEFINER verify_staff_pin() RPC, never fetched directly by a client.

alter table activity_log enable row level security;
create policy "admin read activity_log" on activity_log for select
  using (auth.role() = 'authenticated');
-- No anon policy, no insert/update/delete policy for anyone — rows are only
-- ever written by the SECURITY DEFINER RPCs (update_booking_status_staff /
-- add_staff_unavailable / remove_staff_unavailable), which bypass RLS.
