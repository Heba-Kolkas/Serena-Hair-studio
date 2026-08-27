-- REPAIRED ORDERING, 27 August 2026.
-- book_appointment_core was split in two: it opened, ran as far as the
-- staff_service_schedule count, and then stopped dead, while the whole of its
-- remaining body - the per-stylist day policy, the colour hold, the split-day
-- rule, the expected total and the insert - sat 800 lines earlier as bare
-- statements belonging to no function at all. That is a syntax error, which
-- is why this migration had never once run. The block has been moved back to
-- where it belongs; not a line of logic was changed.
--
-- check_function_bodies is off because book_appointment (language sql) is
-- defined before the core it calls.
set check_function_bodies = off;

-- Two changes, both driven by the owner:
--
--   1. Taniya is out of the booking system entirely. Keratin Treatment and
--      Hair Botox stay visible on the site (they're still services the studio
--      offers) but route straight to her Instagram instead of into the
--      wizard — the same pattern Pati already uses for nails via Timma,
--      lifted from staff-level to service-level so a *service* can be
--      externally booked, not just a person.
--
--   2. Add-ons and combos get a real home. They used to exist only as
--      hardcoded objects in js/booking.js that were flattened into the
--      booking's free-text `notes` at confirm time — so they were invisible
--      to SQL, contributed nothing to any price, and could never be
--      reconciled against amount_charged. Now they're a catalog, a
--      per-service offer list, and a snapshot line-item table, plus an
--      expected_total on the booking itself.
--
-- NOT YET APPLIED — same status as 0001-0004, run this once those are in.

-- ═══════════════════════════════════════════════════════════════════
--  PART 1 — EXTERNALLY BOOKED SERVICES
-- ═══════════════════════════════════════════════════════════════════

-- When set, the booking wizard shows the service in its category list as
-- normal but replaces the "Next" step with a link out — the studio does the
-- service, just not through this system. Null (the default) means the
-- service books normally, which is every other row.
alter table services add column external_booking_url text;
alter table services add column external_booking_label text;

-- staff.external_booking_url already existed (it's how Pati's team card
-- links to Timma) but the button text was hardcoded to "Book on Timma" in
-- js/team.js. Now that a second person books somewhere else entirely, the
-- wording has to travel with the row.
alter table staff add column external_booking_label text;
update staff set external_booking_label = 'Book on Timma' where name = 'Pati';

-- Taniya still works here and still appears on the team page; she simply
-- takes her own bookings via Instagram DM now. bookable = false keeps her
-- out of the stylist picker, the "who's in today" grid, and the Revenue tab
-- roster (admin_get_revenue already filters on bookable).
update staff
  set bookable = false,
      external_booking_url = 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu',
      external_booking_label = 'Book on Instagram'
  where name = 'Taniya S.';

-- She was the only stylist assigned to the Keratin category, so this empties
-- it — which is exactly what makes book_appointment reject those services
-- even if someone crafts the RPC call by hand.
delete from staff_services
  where staff_id in (select id from staff where name = 'Taniya S.');

update services
  set external_booking_url = 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu',
      external_booking_label = 'Book on Instagram'
  where category = 'Keratin & Hair Treatments';

-- ═══════════════════════════════════════════════════════════════════
--  PART 2 — ADD-ONS & COMBOS
-- ═══════════════════════════════════════════════════════════════════

-- The catalog. One row per thing that can be attached to a booking.
create table addons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_no text,
  price numeric(10,2) not null,
  -- true when `price` is a floor rather than an exact figure (One Color
  -- "from 1,500"). Any booking carrying one of these is flagged as an
  -- estimate — see bookings.expected_total_is_estimate below.
  price_is_from boolean not null default false,
  -- true when there is no figure to quote at all: extensions are priced at
  -- the consultation, once the client has chosen colour and length, so the
  -- number is already agreed before they book. Stores 0 in `price` and
  -- contributes nothing to expected_total, but marks it an estimate.
  price_on_consultation boolean not null default false,
  -- 'addon' = a small extra bolted onto the service (Wash, Wavy Styling)
  -- 'combo' = a second full service done in the same visit (Toner, Balayage)
  -- Purely a labelling distinction for the wizard; pricing is identical.
  kind text not null default 'addon' check (kind in ('addon', 'combo')),
  -- Extensions have to be checked before the booking stands, whether they're
  -- the service or an add-on on a colour, so the flag lives on both.
  requires_confirmation boolean not null default false,
  -- Add-ons sharing a group are alternatives, not extras: the two extensions
  -- tiers are a choice of one, so picking the larger replaces the smaller
  -- rather than adding to it.
  exclusive_group text,
  -- When set, only a stylist who performs THIS service may take the add-on.
  -- The extensions add-ons are the extensions service under another name, and
  -- only Hassan fits those — without this a client could put them on Kani's
  -- balayage, and she doesn't do them.
  requires_service_id uuid references services(id) on delete set null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Which add-ons are offered with which service. An add-on not listed here
-- for a service can't be attached to a booking of that service — enforced
-- in book_appointment, not just in the UI.
create table service_addons (
  service_id uuid not null references services(id) on delete cascade,
  addon_id uuid not null references addons(id) on delete cascade,
  sort_order int not null default 0,
  primary key (service_id, addon_id)
);

-- The line items actually attached to a booking. Name and price are
-- SNAPSHOTS: repricing Wash from 100 to 150, or retiring an add-on
-- entirely, must never silently rewrite what a past booking said it would
-- cost. That's the whole point of being able to reconcile against
-- amount_charged months later.
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

-- What the booking is expected to cost: the service's own price plus every
-- attached add-on, computed once at booking time. This is the figure
-- amount_charged gets compared against when the owner completes a booking.
-- Extensions are only booked after a consultation and a deposit, and neither
-- of those lives in this system. So an extensions booking arrives as
-- 'pending' rather than 'confirmed', and the salon confirms it in the Owner
-- Panel once they've checked the client did come in and pay. Every other
-- service still confirms straight away.
alter table services add column requires_confirmation boolean not null default false;
update services set requires_confirmation = true where name like 'Hair Extensions%';

alter table bookings add column expected_total numeric(10,2);

-- expected_total can't always be exact, and pretending otherwise would make
-- the comparison misleading. It's an estimate when any component has no
-- firm number: a consultation-priced service (Keratin), a service priced as
-- a range (Highlights/Balayage 3,500-4,000), or a "from" add-on. In those
-- cases expected_total holds the known FLOOR — the real figure is >= it.
alter table bookings add column expected_total_is_estimate boolean not null default false;

-- ── SEED: the add-ons ──
-- The printed price list names exactly two extras, both in the colour
-- sections, plus toner which the owner confirmed can also ride along on
-- another colour service at its standalone rate:
--
--   "A haircut added to a color service is an additional 500 kr."
--   "Covering grey hair in addition to balayage is an additional 1,200 kr."
--   (since reduced to 1,000 by the owner)
--
-- Everything the old catalog carried as an add-on (wash, wavy styling, and
-- the colour combos) is gone: the new list prices every one of those
-- combinations as its own service line instead, so there is nothing left to
-- bolt on. That also retires the per-service price override those extras
-- used to need — no add-on costs a different amount depending on what it's
-- attached to any more.
insert into addons (name, name_no, price, price_is_from, price_on_consultation, kind, sort_order) values
  ('Haircut',       'Klipp',           500,  false, false, 'addon', 1),
  ('Grey Coverage', 'Grådekking',      1000, false, false, 'addon', 2),
  ('Toner',         'Toner',           1250, true,  false, 'combo', 3),
  -- Extensions fitted during the same visit as the colour. The colour's own
  -- length doesn't change: the fitting happens while it processes and after
  -- it's rinsed, so these add price but not time. Both tiers are quoted at
  -- the consultation, where the client picks colour and length, so no figure
  -- is shown here.
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
  -- A haircut can be added to any colour service, per the list's note.
  (a.name = 'Haircut' and sv.name in (
     'Balayage / Highlights', 'Half Head Foil', 'Full Head Foil',
     'Root Touch-Up', 'All-Over Color', 'Reverse Balayage', 'Toner'))
  -- Grey coverage goes with the four colour-lightening services.
  or (a.name = 'Grey Coverage' and sv.name in (
     'Balayage / Highlights', 'Half Head Foil', 'Full Head Foil', 'Reverse Balayage'))
  -- Toner rides along on the colour services where it is a real choice.
  -- Deliberately NOT on balayage or the foils: toning is part of how that
  -- lightening is finished, so charging for it as an extra sold the client a
  -- step that was happening regardless.
  or (a.name = 'Toner' and sv.name in ('Root Touch-Up', 'All-Over Color'))
  -- Extensions go alongside any colour work, lightening or not. Fitting them
  -- takes the afternoon whatever is underneath, so a root touch-up with
  -- extensions on it is a four-hour appointment and is scheduled as one - see
  -- the duration and daily-limit handling in book_appointment_core.
  or (a.name like 'Extensions%' and sv.name in (
     'Balayage / Highlights', 'Half Head Foil', 'Full Head Foil', 'Reverse Balayage',
     'Root Touch-Up', 'All-Over Color'));
-- Haircuts, styling, updos, bridal, extensions and consultation deliberately
-- offer none — the price list covers each of those as a complete service.


-- 0001's book_appointment took eight arguments; this one takes nine
-- (p_addon_ids). That is an overload, not a replacement, so both would exist
-- and "grant execute on function book_appointment" becomes ambiguous - the
-- second reason this migration could never have run. The old signature goes
-- first.
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

-- Schedule tool: PIN-gated, and allowed to overlap. Any stylist can do it —
-- it's their own day and they can see what's already in it — so this needs
-- the everyday staff PIN, not the owner's. The booking horizon doesn't apply
-- either: it exists to stop clients booking past the owner's holiday notice,
-- which is not a problem the salon has when entering a booking itself.
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

-- One place to build the "Wash, Wavy Styling" label, so the staff grid, the
-- search results and the Owner Panel can't drift apart.
--
-- Deliberately NOT granted to anon: it's only ever called from inside the
-- PIN-gated SECURITY DEFINER readers below, which run as this function's
-- owner. Granting it directly would hand anyone holding the public anon key
-- a booking's add-ons for any id, with no PIN check in front of it.
create or replace function booking_addons_label(p_booking_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select nullif(string_agg(name_at_booking, ', ' order by created_at, name_at_booking), '')
  from booking_addons where booking_id = p_booking_id;
$$;

-- The three readers below gain addons/expected_total columns. Return-type
-- changes can't be done with CREATE OR REPLACE, so each is dropped first
-- (and re-granted afterwards).
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

-- ═══════════════════════════════════════════════════════════════════
--  PART 5 — RLS
-- ═══════════════════════════════════════════════════════════════════

-- The catalog and the offer list are public reads, exactly like services —
-- the wizard needs them before anyone has booked anything.
alter table addons enable row level security;
create policy "public read active addons" on addons for select using (active = true);
create policy "admin manage addons" on addons for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table service_addons enable row level security;
create policy "public read service_addons" on service_addons for select using (true);
create policy "admin manage service_addons" on service_addons for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table booking_addons enable row level security;
create policy "admin full access to booking_addons" on booking_addons for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
-- Deliberately no anon policy, matching bookings itself — these rows carry
-- what a named client is paying, and are only ever reached through the
-- SECURITY DEFINER RPCs above.

-- ═══════════════════════════════════════════════════════════════════
--  PART 6 — OWNER PANEL: MANAGE ADD-ONS, AND THE HAND-OFF BUTTON TEXT
-- ═══════════════════════════════════════════════════════════════════

-- Without these the add-on catalog would be seed-only: repricing Wash from
-- 100 to 150 would mean opening the Supabase dashboard. Same shape as the
-- admin_*_service functions the Services tab already uses.

create or replace function admin_get_addons(p_pin text)
returns setof addons language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query select * from addons order by sort_order, name;
end; $$;
grant execute on function admin_get_addons to anon;

create or replace function admin_upsert_addon(
  p_pin text, p_id uuid default null, p_name text default null, p_name_no text default null,
  p_price numeric default null, p_price_is_from boolean default false,
  p_kind text default 'addon', p_sort_order int default 0, p_active boolean default true
) returns addons language plpgsql security definer set search_path = public as $$
declare v_addon addons;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'Name is required'; end if;
  if p_price is null or p_price < 0 then raise exception 'Enter a valid price'; end if;
  if p_kind not in ('addon', 'combo') then raise exception 'Invalid kind'; end if;
  if p_id is null then
    insert into addons (name, name_no, price, price_is_from, kind, sort_order, active)
    values (trim(p_name), p_name_no, p_price, p_price_is_from, p_kind, p_sort_order, p_active)
    returning * into v_addon;
  else
    -- Editing an add-on never touches booking_addons: those rows hold their
    -- own name/price snapshot precisely so past bookings keep the figures
    -- they were quoted. Only future bookings pick up the new price.
    update addons set
      name = trim(p_name), name_no = p_name_no, price = p_price,
      price_is_from = p_price_is_from, kind = p_kind,
      sort_order = p_sort_order, active = p_active
    where id = p_id
    returning * into v_addon;
    if v_addon.id is null then raise exception 'Add-on not found'; end if;
  end if;
  return v_addon;
end; $$;
grant execute on function admin_upsert_addon to anon;

-- Deleting an add-on drops it from every service's offer list (cascade) but
-- leaves booking_addons rows standing, with addon_id nulled and the name and
-- price they were booked at intact — a deleted add-on must not erase itself
-- from last month's takings.
create or replace function admin_delete_addon(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  delete from addons where id = p_id;
end; $$;
grant execute on function admin_delete_addon to anon;

create or replace function admin_get_service_addons(p_pin text)
returns table (service_id uuid, addon_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query select sa.service_id, sa.addon_id from service_addons sa;
end; $$;
grant execute on function admin_get_service_addons to anon;

-- Replaces the FULL service list for one add-on in one call — matches the
-- checkbox-list UI ("which services offer this?"), same as
-- admin_set_staff_services does for a stylist's services.
create or replace function admin_set_addon_services(p_pin text, p_addon_id uuid, p_service_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  -- Insert what's newly ticked and remove only what's actually been
  -- unticked, rather than clearing the lot and rebuilding it -- that keeps
  -- each row's sort_order intact across a routine save.
  -- Bridal and updo services are filtered out rather than rejected: the
  -- Owner Panel never offers them, so an id arriving here means a stale or
  -- hand-built call, and silently declining to attach it is kinder than
  -- failing the whole save.
  if p_service_ids is not null and array_length(p_service_ids, 1) > 0 then
    insert into service_addons (service_id, addon_id, sort_order)
      select sv.id, p_addon_id, 0 from services sv
      where sv.id = any(p_service_ids)
        and sv.category not in ('Bridal', 'Special Occasions')
      on conflict (service_id, addon_id) do nothing;
    delete from service_addons
      where addon_id = p_addon_id and service_id <> all(p_service_ids);
  else
    delete from service_addons where addon_id = p_addon_id;
  end if;
end; $$;
grant execute on function admin_set_addon_services to anon;

-- ── STAFF FORM: external_booking_label ──
-- The column added in Part 1 needs to reach the Owner Panel's staff form,
-- otherwise the button text stays whatever the migration seeded. Adding a
-- parameter changes the signature, so the old one is dropped rather than
-- replaced — leaving both would make every existing call ambiguous.
drop function if exists admin_upsert_staff(text, uuid, text, text, text, text, text, text, text, boolean, text, boolean, int, boolean);

create or replace function admin_upsert_staff(
  p_pin text, p_id uuid default null, p_name text default null, p_role text default null, p_role_no text default null,
  p_bio text default null, p_bio_no text default null, p_photo_url text default null, p_instagram text default null,
  p_bookable boolean default true, p_external_booking_url text default null, p_allow_overlap_booking boolean default false,
  p_sort_order int default 0, p_active boolean default true, p_external_booking_label text default null
) returns staff language plpgsql security definer set search_path = public as $$
declare v_staff staff;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_id is null then
    insert into staff (name, role, role_no, bio, bio_no, photo_url, instagram, bookable, external_booking_url, external_booking_label, allow_overlap_booking, sort_order, active)
    values (p_name, p_role, p_role_no, p_bio, p_bio_no, p_photo_url, p_instagram, p_bookable, p_external_booking_url, p_external_booking_label, p_allow_overlap_booking, p_sort_order, p_active)
    returning * into v_staff;
  else
    update staff set
      name = p_name, role = p_role, role_no = p_role_no, bio = p_bio, bio_no = p_bio_no,
      photo_url = p_photo_url, instagram = p_instagram, bookable = p_bookable,
      external_booking_url = p_external_booking_url, external_booking_label = p_external_booking_label,
      allow_overlap_booking = p_allow_overlap_booking,
      sort_order = p_sort_order, active = p_active
    where id = p_id
    returning * into v_staff;
  end if;
  return v_staff;
end; $$;
grant execute on function admin_upsert_staff to anon;

-- ── SERVICE FORM: price_is_from and duration_with_addons_minutes ──
-- Both columns are new in this round (0001 defines them), and the Owner
-- Panel's Services tab has to be able to set them: the printed price list
-- distinguishes "from 3,750 kr" from a flat "950 kr", and a root touch-up
-- runs longer the moment an add-on is attached. Dropped and recreated rather
-- than replaced, because adding parameters changes the signature.
drop function if exists admin_upsert_service(text, uuid, text, text, text, numeric, numeric, boolean, int, text, text, boolean, boolean);

create or replace function admin_upsert_service(
  p_pin text, p_id uuid default null, p_name text default null, p_name_no text default null,
  p_category text default null, p_price_from numeric default null, p_price_to numeric default null,
  p_price_on_consultation boolean default false, p_duration_minutes int default null,
  p_color text default null, p_image_url text default null, p_featured boolean default false,
  p_active boolean default true, p_price_is_from boolean default false,
  p_duration_with_addons_minutes int default null
) returns services language plpgsql security definer set search_path = public as $$
declare v_service services;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_id is null then
    insert into services (name, name_no, category, price_from, price_to, price_on_consultation, price_is_from,
                          duration_minutes, duration_with_addons_minutes, color, image_url, featured, active)
    values (p_name, p_name_no, p_category, p_price_from, p_price_to, p_price_on_consultation, p_price_is_from,
            p_duration_minutes, p_duration_with_addons_minutes, p_color, p_image_url, p_featured, p_active)
    returning * into v_service;
  else
    update services set
      name = p_name, name_no = p_name_no, category = p_category,
      price_from = p_price_from, price_to = p_price_to,
      price_on_consultation = p_price_on_consultation, price_is_from = p_price_is_from,
      duration_minutes = p_duration_minutes,
      duration_with_addons_minutes = p_duration_with_addons_minutes,
      color = p_color, image_url = p_image_url,
      featured = p_featured, active = p_active
    where id = p_id
    returning * into v_service;
  end if;
  return v_service;
end; $$;
grant execute on function admin_upsert_service to anon;

-- ── MONTH-AT-A-TIME AVAILABILITY (booking calendar) ──
-- get_busy_slots answers "what's taken on this one date", which is all the
-- slot grid ever needed. The calendar has to grey out and mark every fully
-- booked day in the month it's showing, so asking per day would mean ~31
-- round trips each time the month changes. Same shape, same security model,
-- just bounded by a range and carrying the date back with each row.
create or replace function get_busy_slots_range(p_staff_id uuid, p_date_from date, p_date_to date)
returns table(date date, start_time time, end_time time)
language sql security definer set search_path = public as $$
  select b.date, b.start_time, b.end_time from bookings b
  where b.staff_id = p_staff_id
    and b.date between p_date_from and p_date_to
    and b.status <> 'cancelled';
$$;
grant execute on function get_busy_slots_range to anon;

-- ═══════════════════════════════════════════════════════════════════
--  PART 7 — ROLLING BOOKING HORIZON, AND VACATION CLASH CHECKING
-- ═══════════════════════════════════════════════════════════════════

-- How far ahead clients may book. A rolling window, not a fixed end date:
-- "today + N days" advances by itself every day, so there is nothing to renew.
--
-- The number matters operationally. The owner learns about holidays roughly
-- two months out, so a window any longer than that lets someone book into a
-- week that hasn't been blocked yet — and the fix is a phone call. Keeping
-- the horizon at or under the notice period makes that impossible by
-- construction. Hence 60 days, set by the owner in the Owner Panel.
--
-- js/booking.js previously hardcoded 60 days in the browser only, which no
-- more than hid the dates: a crafted RPC call could still book two years out.
insert into app_settings (key, value) values ('booking_horizon_days', '60')
  on conflict (key) do nothing;

-- Public: the wizard needs it to know how far its calendar may run. Unlike
-- the PINs in this table, the horizon isn't a secret.
create or replace function get_booking_horizon_days()
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select value::int from app_settings where key = 'booking_horizon_days'), 60);
$$;
grant execute on function get_booking_horizon_days to anon;

create or replace function admin_set_booking_horizon(p_pin text, p_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Booking horizon must be between 1 and 365 days';
  end if;
  insert into app_settings (key, value, updated_at) values ('booking_horizon_days', p_days::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end; $$;
grant execute on function admin_set_booking_horizon to anon;

-- Bookings that fall inside a date range — what the Owner Panel shows before
-- blocking a holiday, so the owner can ring those clients rather than
-- discovering the clash later. Deliberately read-only: blocking time never
-- cancels anything on the client's behalf.
create or replace function admin_get_bookings_in_range(
  p_pin text, p_date_from date, p_date_to date, p_staff_id uuid default null
) returns table (
  id uuid, date date, start_time time, end_time time,
  customer_name text, customer_phone text, service_name text, staff_name text
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time,
           b.customer_name, b.customer_phone, s.name, st.name
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where b.date between p_date_from and p_date_to
      and b.status not in ('cancelled', 'completed')
      and (p_staff_id is null or b.staff_id = p_staff_id)
    order by b.date, b.start_time;
end; $$;
grant execute on function admin_get_bookings_in_range to anon;

-- ── HOLIDAYS AS A DATE RANGE ──
-- blocked_slots is one row per day, which is right for the table (the booking
-- checks scan by date) but wrong as a thing to type: a fortnight off meant
-- fourteen trips through the form. This takes the range once and writes the
-- rows, skipping days the salon is closed anyway so a two-week holiday
-- doesn't litter the table with blocked Sundays.
--
-- Idempotent by design: re-running for an overlapping range won't duplicate
-- rows, because an identical (staff, date, times) block is skipped.
create or replace function admin_add_blocked_range(
  p_pin text, p_staff_id uuid, p_date_from date, p_date_to date,
  p_start_time time default '00:00', p_end_time time default '23:59',
  p_reason text default null
) returns int language plpgsql security definer set search_path = public as $$
declare v_day date; v_count int := 0; v_weekday int;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_date_to < p_date_from then raise exception 'The end date is before the start date'; end if;
  if p_date_to - p_date_from > 180 then raise exception 'That range is longer than six months'; end if;
  if p_end_time <= p_start_time then raise exception 'End time must be after start time'; end if;

  v_day := p_date_from;
  while v_day <= p_date_to loop
    v_weekday := extract(dow from v_day);
    -- Skip days with no opening hours: blocking a Sunday changes nothing and
    -- only makes the list harder to read later.
    if exists (select 1 from business_hours where weekday = v_weekday and not closed and open_time is not null) then
      if not exists (
        select 1 from blocked_slots
        where date = v_day and start_time = p_start_time and end_time = p_end_time
          and staff_id is not distinct from p_staff_id
      ) then
        insert into blocked_slots (staff_id, date, start_time, end_time, reason)
        values (p_staff_id, v_day, p_start_time, p_end_time, p_reason);
        v_count := v_count + 1;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;

  return v_count;
end; $$;
grant execute on function admin_add_blocked_range to anon;

-- ── PER-STYLIST DAY POLICY ──
-- Kani's days don't follow the salon's shape, and the differences are real
-- business rules rather than quirks, so they live in a table the owner can
-- change instead of being spelled into the booking code.
--
-- What it expresses, using her actual rules as the example:
--
--   Mon/Wed/Fri  one four-hour colour a day, at 11:00 or 15:00. Around it she
--                takes at most two shorter appointments, and her own hours
--                move with the colour: an 11:00 colour means she works to
--                17:30, a 15:00 colour means she doesn't start until 12:00,
--                and a day with no colour at all ends at 17:00.
--
--   Tue/Thu      colours only, two a day, while the date is more than three
--                days off. Inside three days the colour probably isn't
--                coming, so the day takes the Mon/Wed/Fri shape — with two
--                colours still allowed, an early colour keeping her to
--                18:00 rather than 17:30, and a late colour leaving her
--                start at 11:00 rather than pushing it to 12:00 — on a
--                colour day she is in from 11:00 regardless. No limit on
--                shorter appointments either: the finish-by-15:00 rule
--                already stops them eating the afternoon colour, so a count
--                would only leave hours empty.
--
-- A stylist with no row here (Hassan) is governed entirely by business_hours
-- and staff_hours_override, exactly as before.
create table staff_day_policy (
  staff_id uuid not null references staff(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),

  -- Cap on services flagged services.daily_limited (the four-hour colours).
  -- Null means no cap.
  max_limited_per_day int,

  -- Whether she takes anything OTHER than those that day, and how many.
  allow_other_services boolean not null default true,
  max_other_per_day int,

  -- A late exception to allow_other_services = false. Held for colour while
  -- the date is far off; once it is within this many days the colour probably
  -- isn't coming, and the day simply becomes an ordinary mixed day — the
  -- other columns here (other_open_time, other_split_at, max_other_per_day,
  -- the shifting hours) start applying exactly as they do on her mixed days.
  -- Widen or narrow it to move the line. Null = never opens up.
  late_fill_days int,

  -- How close to the date the day keeps holding room for a four-hour
  -- appointment. Beyond this the protections above apply; at or inside it,
  -- with nothing booked, the colour isn't coming and every hour still held
  -- for it is an hour that can no longer be sold to anyone — so the hold
  -- lapses and the day opens end to end. A colour can still book if one
  -- turns up. Null = hold to the last minute.
  colour_hold_days int,

  -- Her hours on a day with no colour booked. Null falls back to
  -- business_hours (and staff_hours_override).
  open_time time,
  close_time time,

  -- On a day with no colour booked, the earliest a NON-colour service may
  -- start. She only comes in at open_time when a colour needs her there;
  -- otherwise her shorter work starts later.
  other_open_time time,

  -- ...and such a service must fall entirely on one side of this time. A
  -- booking straddling it would rule out both colour starts at once and cost
  -- her the day's most valuable slot; landing either side leaves one intact.
  other_split_at time,

  -- Her hours once a colour IS booked. A colour starting at open_time is
  -- "early" and pushes her finish to close_after_early; anything later is
  -- "late" and pushes her start to open_before_late.
  close_after_early time,
  open_before_late time,

  primary key (staff_id, weekday)
);

insert into staff_day_policy (
  staff_id, weekday, max_limited_per_day, allow_other_services, max_other_per_day,
  open_time, close_time, other_open_time, other_split_at, close_after_early, open_before_late,
  late_fill_days, colour_hold_days
)
-- Mon / Wed / Fri
-- Cast explicitly: inside a UNION the bare literals resolve as text and
-- Postgres refuses to write them into a time column.
select s.id, w.weekday, 1, true, 2,
       '11:00'::time, '17:00'::time, '12:00'::time, '15:00'::time, '17:30'::time, '12:00'::time,
       null::int, 1
from staff s cross join (values (1), (3), (5)) as w(weekday)
where s.name = 'Kani M.'
union all
-- Tue / Thu — colours only until the date is within three days, at which
-- point the day takes the same shape as a Mon/Wed/Fri one. It keeps two
-- differences: two colours fit rather than one, and an early colour keeps
-- her to 18:00 rather than 17:30.
select s.id, w.weekday, 2, false, null::int,
       '11:00'::time, '17:00'::time, '12:00'::time, '15:00'::time, '18:00'::time, '11:00'::time,
       3, 1
from staff s cross join (values (2), (4)) as w(weekday)
where s.name = 'Kani M.';

alter table staff_day_policy enable row level security;
create policy "public read staff_day_policy" on staff_day_policy for select using (true);
create policy "admin manage staff_day_policy" on staff_day_policy for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- The wizard needs the same rules to draw the right slots, rather than
-- offering times the RPC would then refuse.
create or replace function get_staff_day_policies()
returns setof staff_day_policy language sql stable security definer set search_path = public as $$
  select * from staff_day_policy;
$$;
grant execute on function get_staff_day_policies to anon;

-- ═══════════════════════════════════════════════════════════════════
--  PART 3 — book_appointment: validate add-ons, price them, store them
-- ═══════════════════════════════════════════════════════════════════

-- Dropped rather than replaced: adding p_addon_ids would otherwise create a
-- second overload and make every existing 8-argument call ambiguous.
drop function if exists book_appointment(uuid, uuid, date, time, text, text, text, text);

-- The booking rules live here once. Two callers wrap it: book_appointment
-- for the public wizard, and staff_book_appointment for the schedule tool.
-- Deliberately NOT granted to anon — the switches below would be a way to
-- book straight past the overlap rule if a client could set them.
-- ── A DELIBERATE DEAD BRANCH, DO NOT "FIX" ──
-- Inside this function, the gap-fill lookup that sets v_morning_end reads
-- v_open, which is not assigned until further down. v_open is therefore null,
-- the comparison never matches, and the branch never fires.
--
-- That reads like a bug and is not being treated as one. Its only effect is on
-- Hassan, the one stylist with fixed times for short work (13:00 and 16:30,
-- plus 11:00 for updos): were it live, the hour between a finished appointment
-- and the 15:00 colour - say 14:00 after a 13:00 haircut - would become
-- bookable. Kani has no fixed times for short work, so her day is untouched
-- either way.
--
-- Asked and answered by the owner on 27 August 2026: leave it. The gap is
-- breathing space between clients, not lost revenue. Anyone tempted to move
-- the v_open assignment above this block should know they are changing how
-- hard Hassan's day runs, not correcting a typo.

create or replace function book_appointment_core(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text, p_addon_ids uuid[],
  p_allow_overlap boolean, p_enforce_horizon boolean
) returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_duration int; v_end_time time; v_weekday int;
  v_open time; v_close time; v_closed boolean; v_staff_close time;
  v_fixed_times time[]; v_category text; v_service_name text;
  v_conflict int; v_booking bookings;
  v_allow_overlap boolean; v_schedule_count int; v_consult_count int;
  v_external text;
  v_price_from numeric; v_price_to numeric; v_on_consultation boolean;
  v_expected numeric := 0; v_is_estimate boolean := false;
  v_addon_total numeric; v_addon_from boolean;
  v_duration_with_addons int; v_has_addons boolean;
  v_duration_with_extensions int;
  v_day_limit int; v_scheduled_today int; v_daily_limited boolean;
  v_pol staff_day_policy%rowtype; v_has_pol boolean := false;
  v_requires_confirmation boolean;
  v_morning_end time;
  v_gap_boundary time := '15:00';
  v_colour_start time; v_other_today int; v_is_bridal boolean := false;
  v_side_early int; v_side_late int;
  v_colour_hold_over boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext(p_staff_id::text || p_date::text));

  select duration_minutes, duration_with_addons_minutes, duration_with_extensions_minutes,
         fixed_times, category, name,
         external_booking_url, price_from, price_to, price_on_consultation, daily_limited,
         requires_confirmation
    into v_duration, v_duration_with_addons, v_duration_with_extensions,
         v_fixed_times, v_category, v_service_name,
         v_external, v_price_from, v_price_to, v_on_consultation, v_daily_limited,
         v_requires_confirmation
    from services where id = p_service_id and active;
  if v_duration is null then raise exception 'Invalid or inactive service'; end if;
  -- Bridal is four hours at a fixed time — the same shape as a colour, not
  -- the shape of short work — so the day policy leaves it alone.
  v_is_bridal := v_category = 'Bridal';

  -- Externally booked services (Keratin/Hair Botox → Taniya's Instagram)
  -- are never bookable here, no matter what the client sends.
  if v_external is not null then
    raise exception 'This service is booked directly with the specialist, not through this system';
  end if;

  if not exists (select 1 from staff_services where staff_id = p_staff_id and service_id = p_service_id) then
    raise exception 'This stylist does not perform this service';
  end if;

  -- The booking window is a rolling "today + N days". Checked here rather
  -- than only in the wizard, which merely stopped drawing the dates — the
  -- RPC is reachable with the public key, so a crafted call could otherwise
  -- book years out, straight past every holiday the owner hasn't set yet.
  if p_enforce_horizon then
    if p_date < current_date then
      raise exception 'That date has already passed';
    end if;
    if p_date > current_date + get_booking_horizon_days() then
      raise exception 'We are not taking bookings that far ahead yet';
    end if;
  end if;

  -- ── ADD-ONS ──
  -- Validated here, before the end time is worked out, because whether any
  -- add-on is attached can change how long the appointment runs.
  --
  -- Reject anything not actively offered for THIS service. The wizard already
  -- filters the list, but this RPC is reachable with the public anon key, so
  -- the offer list is enforced here too — otherwise a hand-crafted call could
  -- attach a 1,200 NOK grey coverage to a 680 NOK blowdry, or attach a retired
  -- add-on at its old price.
  v_has_addons := p_addon_ids is not null and coalesce(array_length(p_addon_ids, 1), 0) > 0;
  if v_has_addons then
    -- Bridal and updo work never carries add-ons: a client can't tack an updo
    -- onto a balayage, or bolt extras onto a bridal booking. The wizard
    -- doesn't offer them there and the Owner Panel can't configure them
    -- there, but this is the check that actually holds.
    if v_category in ('Bridal', 'Special Occasions') then
      raise exception 'Add-ons are not available on bridal or updo bookings';
    end if;
    if exists (
      select 1 from unnest(p_addon_ids) as sel(id)
      where not exists (
        select 1 from addons a
        join service_addons sa on sa.addon_id = a.id
        where a.id = sel.id and a.active and sa.service_id = p_service_id
      )
    ) then
      raise exception 'One of the selected add-ons is not available for this service';
    end if;

    -- Two tiers of the same thing is a choice, not a combination.
    if exists (
      select a.exclusive_group from addons a
      where a.id = any(p_addon_ids) and a.exclusive_group is not null
      group by a.exclusive_group having count(*) > 1
    ) then
      raise exception 'Only one of those add-ons can be chosen';
    end if;

    -- ...and this stylist has to be able to do it. Extensions are Hassan's.
    if exists (
      select 1 from unnest(p_addon_ids) as sel(id)
      join addons a on a.id = sel.id
      where a.requires_service_id is not null
        and not exists (
          select 1 from staff_services ss
          where ss.staff_id = p_staff_id and ss.service_id = a.requires_service_id
        )
    ) then
      raise exception 'This stylist does not offer one of the selected add-ons';
    end if;
  end if;

  -- A service can declare a longer length that applies the moment ANY add-on
  -- is picked — flat, not one delta per add-on. A root touch-up is 90 minutes
  -- alone and 120 with a haircut and/or a toner attached. Services that leave
  -- duration_with_addons_minutes null never stretch: balayage is 4 hours
  -- whatever goes with it.
  if v_has_addons and v_duration_with_addons is not null then
    v_duration := v_duration_with_addons;
  end if;

  -- ...except extensions, which take the afternoon whatever is underneath.
  -- A root touch-up with extensions on it is a four-hour appointment, not a
  -- two-hour one, and from here on it is treated as a colour: fixed to the
  -- stylist's four-hour start times, counted against the day's one-four-hour
  -- allowance, and never offered as the second client of an overlap pairing.
  --
  -- v_daily_limited is deliberately overwritten rather than checked alongside,
  -- so every rule further down that already asks "is this a four-hour job?"
  -- gets the right answer without being touched.
  if v_has_addons and exists (
    select 1 from addons a
    where a.id = any(p_addon_ids) and a.exclusive_group = 'extensions'
  ) then
    -- How long depends on what they go over, so the service says its own
    -- figure. Fitted during a colour they take the whole afternoon; fitted
    -- over a toner the toner is nearly done before the fitting starts, so the
    -- visit is two hours and is not a four-hour appointment at all.
    if v_duration_with_extensions is not null then
      v_duration := v_duration_with_extensions;
    end if;
  end if;

  -- One definition of "four-hour", applied to the length the booking actually
  -- works out to. Everything downstream - the start times, the one-a-day
  -- allowance, the overlap pairing - keys off this, so a toner with extensions
  -- is correctly not one and a root touch-up with extensions correctly is.
  if v_duration >= 240 then v_daily_limited := true; end if;

  v_end_time := p_start_time + (v_duration || ' minutes')::interval;

  v_weekday := extract(dow from p_date);

  -- Consultation is a special case: any open slot works (handled by the
  -- overlap exemption below), but capped at 17:00, four per stylist per day,
  -- and never in the half hour after an appointment starts.
  if v_service_name = 'Consultation' then
    if p_start_time > '17:00' then
      raise exception 'Consultations must start by 17:00';
    end if;
    if not consultation_start_allowed(p_start_time) then
      raise exception 'That is when an appointment starts - please pick a time at least half an hour later';
    end if;
    select count(*) into v_consult_count from bookings
      where staff_id = p_staff_id and date = p_date and service_id = p_service_id
        and status <> 'cancelled';
    if v_consult_count >= 4 then
      raise exception 'This stylist already has 4 consultations booked today';
    end if;
  end if;

  -- Per-staff schedule override (e.g. Balayage's per-stylist/weekday times)
  -- takes precedence over the service's own generic fixed_times.
  select count(*) into v_schedule_count from staff_service_schedule
    where staff_id = p_staff_id and service_id = p_service_id;
-- ── PER-STYLIST DAY POLICY ──
  -- Skipped wholesale on the manual path: a stylist entering a booking by
  -- hand has already decided it fits, and these rules exist to shape what
  -- the public wizard offers.
  select * into v_pol from staff_day_policy
    where staff_id = p_staff_id and weekday = v_weekday;
  v_has_pol := found;

  -- ── ONE BOOKING AT A TIME, PER STYLIST PER DAY ──
  -- Everything below reads the day's bookings and then writes a new one. Two
  -- clients confirming at the same moment would both read a free slot and
  -- both write into it — the checks are correct in isolation and useless in
  -- parallel. This lock makes them run one after the other for that stylist
  -- and date; the second one re-reads the day and finds the slot gone.
  --
  -- It is held until the transaction ends, so it cannot be left behind, and
  -- it is scoped to one stylist-day, so bookings elsewhere never wait on it.
  perform pg_advisory_xact_lock(hashtext(p_staff_id::text || ':' || p_date::text));

  -- Where the day's four-hour appointment sits, if one is booked. Drives both
  -- the caps below and the working hours further down. Bridal counts: it is
  -- four hours of her day exactly as a colour is.
  -- Measured from the booking's own length rather than looked up from its
  -- service. A root touch-up with extensions is four hours long and occupies
  -- the day exactly as a balayage does, but its service row still says ninety
  -- minutes, so the service is the wrong thing to ask.
  select min(b.start_time) into v_colour_start
    from bookings b
    where b.staff_id = p_staff_id and b.date = p_date
      and b.status <> 'cancelled'
      and (b.end_time - b.start_time) >= interval '240 minutes';

  -- Every protection on a policy stylist's day — short work not starting
  -- until other_open_time, the other_split_at rule, max_other_per_day —
  -- exists for one purpose: keep a four-hour colour start alive. Each costs
  -- bookable hours, and that price is only worth paying while a colour can
  -- still actually happen.
  --
  -- Once every colour start is blocked, they are guarding an empty room. A
  -- 12:00 booking rules out an 11:00 colour and a 16:00 booking rules out a
  -- 15:00 one; hold the rules after that and the middle of the day is
  -- unsellable for nothing. So when no colour can start any more, the
  -- protections drop and her day opens end to end.
  if v_has_pol and v_colour_start is null then
    -- The hold also has a deadline, not just a condition.
    if v_pol.colour_hold_days is not null
       and p_date - current_date <= v_pol.colour_hold_days then
      v_colour_hold_over := true;
    end if;
    select not exists (
      select 1 from staff_service_schedule sss
      join services sv6 on sv6.id = sss.service_id and sv6.daily_limited
      where sss.staff_id = p_staff_id and sss.weekday = v_weekday
        and not exists (
          select 1 from bookings b2
          where b2.staff_id = p_staff_id and b2.date = p_date
            and b2.status <> 'cancelled'
            and b2.start_time < sss.start_time + (sv6.duration_minutes * interval '1 minute')
            and b2.end_time > sss.start_time
        )
    ) or v_colour_hold_over into v_colour_hold_over;
  end if;

  if v_has_pol and not p_allow_overlap then
    -- Bridal is four hours of her day just as a colour is, so it counts
    -- against the same allowance: Mon/Wed/Fri hold one four-hour
    -- appointment, not one colour plus a bride.
    if v_daily_limited or v_is_bridal then
      if v_pol.max_limited_per_day is not null then
        select count(*) into v_scheduled_today
          from bookings b
          where b.staff_id = p_staff_id and b.date = p_date
            and b.status <> 'cancelled'
            and (b.end_time - b.start_time) >= interval '240 minutes';
        if v_scheduled_today >= v_pol.max_limited_per_day then
          raise exception 'This stylist is already booked for a four-hour appointment that day';
        end if;
      end if;
    else
      -- Colours only, until the date is close enough that the colour
      -- probably isn't coming — from then on the day is an ordinary mixed
      -- one and the rules below apply unchanged.
      if not v_pol.allow_other_services
         and (v_pol.late_fill_days is null
              or p_date - current_date > v_pol.late_fill_days) then
        raise exception 'This stylist only takes colour appointments on this day';
      end if;

      if v_pol.max_other_per_day is not null and not v_colour_hold_over then
        select count(*) into v_other_today
          from bookings b join services sv4 on sv4.id = b.service_id
          where b.staff_id = p_staff_id and b.date = p_date
            and b.status <> 'cancelled' and not sv4.daily_limited;
        if v_other_today >= v_pol.max_other_per_day then
          raise exception 'This stylist is fully booked for shorter appointments that day';
        end if;
      end if;
    end if;
  end if;

  if v_schedule_count > 0 then
    -- A stylist's scheduled slots leave gaps once part of the morning is
    -- already booked. When a NON-colour appointment ends inside the morning,
    -- anything from its end up to the afternoon colour hour is allowed too,
    -- so the leftover time gets used rather than sitting idle. Slots at or
    -- after that hour are untouched. Colours are excluded: their early slot
    -- is the overlap pairing, not a gap to fill.
    if not v_daily_limited then
      select max(b.end_time) into v_morning_end
        from bookings b join services sv5 on sv5.id = b.service_id
        where b.staff_id = p_staff_id and b.date = p_date
          and b.status <> 'cancelled' and not sv5.daily_limited
          and b.end_time > v_open and b.end_time <= v_gap_boundary;
    end if;

    -- Back-to-back from the end of the morning, or flush against the colour
    -- hour. Anything in between would strand a quarter of an hour that can
    -- never be filled.
    if not (v_morning_end is not null
            and p_start_time >= v_morning_end
            and v_end_time <= v_gap_boundary
            and (
              extract(epoch from (p_start_time - v_morning_end))::int % (v_duration * 60) = 0
              or v_end_time = v_gap_boundary
            ))
       and not exists (
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

  -- A policy stylist's hours are her own, and they move with the colour: an
  -- early colour extends her finish, a late one delays her start.
  if v_has_pol then
    if v_pol.open_time is not null then v_open := v_pol.open_time; end if;
    if v_pol.close_time is not null then v_close := v_pol.close_time; end if;
    if v_colour_start is not null then
      if v_colour_start <= v_open and v_pol.close_after_early is not null then
        v_close := v_pol.close_after_early;
      elsif v_colour_start > v_open and v_pol.open_before_late is not null then
        v_open := v_pol.open_before_late;
      end if;
    elsif not v_daily_limited and not v_is_bridal and not v_colour_hold_over then
      -- A colour can still happen today, so the day has to leave room for one.
      if v_pol.other_open_time is not null then v_open := v_pol.other_open_time; end if;

      -- Nothing may straddle the split: a booking sitting across it rules out
      -- both colour starts on its own.
      if v_pol.other_split_at is not null
         and p_start_time < v_pol.other_split_at
         and v_end_time > v_pol.other_split_at then
        raise exception 'That time would leave no room for a colour appointment - please pick a time that finishes by %, or starts at % or later',
          to_char(v_pol.other_split_at, 'HH24:MI'), to_char(v_pol.other_split_at, 'HH24:MI');
      end if;

      -- ...and once one shorter booking exists, every later one stays on the
      -- SAME side of it.
      --
      -- One short booking always leaves a colour start alive: before the split
      -- leaves the afternoon colour, after it leaves the morning one. Two on
      -- opposite sides leave none, and the day is left with no four-hour start
      -- and several unsellable hours stranded between the two small bookings.
      -- So the first booking of the day chooses the side and the rest follow.
      --
      -- Consultations do not count - they nest inside other bookings. Bridal
      -- does not either: it is four hours and is counted with the colours.
      -- The owner booking by hand (p_allow_overlap) has already decided.
      if v_pol.other_split_at is not null and not p_allow_overlap then
        select
          count(*) filter (where b.end_time <= v_pol.other_split_at),
          count(*) filter (where b.start_time >= v_pol.other_split_at)
          into v_side_early, v_side_late
        from bookings b join services sv5 on sv5.id = b.service_id
        where b.staff_id = p_staff_id and b.date = p_date
          and b.status <> 'cancelled'
          and (b.end_time - b.start_time) < interval '240 minutes'
          and sv5.category <> 'Consultation';

        if v_side_early > 0 and p_start_time >= v_pol.other_split_at then
          raise exception 'This stylist already has a shorter appointment before % that day - please pick a time that finishes by %',
            to_char(v_pol.other_split_at, 'HH24:MI'), to_char(v_pol.other_split_at, 'HH24:MI');
        end if;
        if v_side_late > 0 and v_end_time <= v_pol.other_split_at then
          raise exception 'This stylist already has a shorter appointment after % that day - please pick a time that starts at % or later',
            to_char(v_pol.other_split_at, 'HH24:MI'), to_char(v_pol.other_split_at, 'HH24:MI');
        end if;
      end if;
    end if;
  end if;

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
          and v_category not in ('Bridal', 'Special Occasions')
          and (b.end_time - b.start_time) = interval '240 minutes'
          and b.start_time in ('11:00', '15:00')
          and (
            (b.start_time = '11:00' and p_start_time = '13:00')
            or (b.start_time = '15:00' and p_start_time = '16:30')
          )
        )
        or v_service_name = 'Consultation'
      );
  -- Skipped for a booking entered by hand in the schedule tool: a stylist
  -- looking at their own day can see exactly what they're doubling up on and
  -- may have good reason to. The unique index on (staff, date, start_time)
  -- still holds, so an overlap has to start at a different minute — two
  -- bookings can never occupy the identical slot.
  if v_conflict > 0 and not p_allow_overlap then raise exception 'Slot no longer available'; end if;

  -- ── EXPECTED TOTAL ──
  -- Start from the service itself. A consultation-priced service contributes
  -- nothing but forces the estimate flag; a range price contributes its
  -- floor and does the same.
  if coalesce(v_on_consultation, false) then
    v_is_estimate := true;
  else
    v_expected := coalesce(v_price_from, 0);
    if v_price_to is not null then v_is_estimate := true; end if;
  end if;

  select coalesce(sum(a.price), 0),
         coalesce(bool_or(a.price_is_from), false)
    into v_addon_total, v_addon_from
    from addons a
    join service_addons sa on sa.addon_id = a.id and sa.service_id = p_service_id
    where p_addon_ids is not null and a.id = any(p_addon_ids);

  v_expected := v_expected + coalesce(v_addon_total, 0);
  v_is_estimate := v_is_estimate or coalesce(v_addon_from, false);

  insert into bookings (
    service_id, staff_id, customer_name, customer_email, customer_phone,
    date, start_time, end_time, notes, expected_total, expected_total_is_estimate, status
  )
  values (
    p_service_id, p_staff_id, p_customer_name, p_customer_email, p_customer_phone,
    p_date, p_start_time, v_end_time, p_notes, v_expected, v_is_estimate,
    case when v_requires_confirmation or exists (
           select 1 from addons a
           where p_addon_ids is not null and a.id = any(p_addon_ids)
             and a.requires_confirmation
         ) then 'pending'::booking_status
         else 'confirmed'::booking_status end
  )
  returning * into v_booking;

  -- A pending request holds its slot for two days, then the time is released.
  if v_booking.status = 'pending' then
    update bookings set hold_expires_at = now() + interval '2 days'
      where id = v_booking.id returning * into v_booking;
  end if;

  -- Snapshot each add-on onto the booking.
  if v_has_addons then
    insert into booking_addons (booking_id, addon_id, name_at_booking, price_at_booking, price_is_from)
    select v_booking.id, a.id, a.name, a.price, a.price_is_from
    from addons a
    join service_addons sa on sa.addon_id = a.id and sa.service_id = p_service_id
    where a.id = any(p_addon_ids)
    order by a.sort_order;
  end if;

  return v_booking;
end; $$;

  -- ── BUSY SLOTS NOW CARRY THE SERVICE ──
-- Counting how many four-hour colours a stylist already has that day needs to
-- know WHICH service each booking is, not just when it runs. Both readers
-- gain service_id; return-type changes mean dropping first.
drop function if exists get_busy_slots(uuid, date);
create or replace function get_busy_slots(p_staff_id uuid, p_date date)
returns table(start_time time, end_time time, service_id uuid)
language sql security definer set search_path = public as $$
  select b.start_time, b.end_time, b.service_id from bookings b
  where b.staff_id = p_staff_id and b.date = p_date and b.status <> 'cancelled';
$$;
grant execute on function get_busy_slots to anon;

drop function if exists get_busy_slots_range(uuid, date, date);
create or replace function get_busy_slots_range(p_staff_id uuid, p_date_from date, p_date_to date)
returns table(date date, start_time time, end_time time, service_id uuid)
language sql security definer set search_path = public as $$
  select b.date, b.start_time, b.end_time, b.service_id from bookings b
  where b.staff_id = p_staff_id
    and b.date between p_date_from and p_date_to
    and b.status <> 'cancelled';
$$;
grant execute on function get_busy_slots_range to anon;

-- ═══════════════════════════════════════════════════════════════════
--  PART 8 — PENDING BOOKINGS: A HOLD, A DECISION, AND A MESSAGE
-- ═══════════════════════════════════════════════════════════════════

-- A pending extensions booking holds its slot for two days. If the salon
-- hasn't confirmed by then the hold lapses and the time goes back on sale —
-- otherwise an unanswered request would quietly block a chair for weeks.
--
-- Nothing deletes the row when it lapses: the booking stays visible in the
-- Owner Panel so it can still be confirmed late (which re-books the slot if
-- it's still free) or rejected. Only its claim on the time expires.
alter table bookings add column hold_expires_at timestamptz;

create or replace function booking_hold_is_live(b bookings)
returns boolean language sql immutable as $$
  select b.status <> 'pending' or b.hold_expires_at is null or b.hold_expires_at > now();
$$;

-- A lapsed hold stops occupying the day, everywhere availability is worked out.
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

-- Confirm or reject in one call, and hand back everything the email needs so
-- the caller doesn't have to fetch the booking again. Rejecting cancels the
-- booking; confirming clears the hold, since the slot is now really taken.
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

-- Everything still awaiting a decision, newest request first, with how long
-- is left on each hold so the owner can see what's about to lapse.
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
-- Over a colour the fitting fills the afternoon. Over a toner the colour work
-- is nearly finished before it starts, so the visit is two hours and stays at
-- the stylist's ordinary times rather than taking a four-hour slot.
update services set duration_with_extensions_minutes = 240
  where name in ('Balayage / Highlights', 'Half Head Foil', 'Full Head Foil',
                 'Reverse Balayage', 'Root Touch-Up', 'All-Over Color');
update services set duration_with_extensions_minutes = 120 where name = 'Toner';

-- Toner joins the services extensions can be added to.
insert into service_addons (service_id, addon_id, sort_order)
select sv.id, a.id, a.sort_order
from services sv join addons a on a.name like 'Extensions%'
where sv.name = 'Toner'
on conflict do nothing;

-- ── A HAIRCUT DURING AN EXTENSIONS FITTING ──
-- Offered on both extensions tiers. Deliberately no
-- duration_with_addons_minutes on those two services, so the appointment does
-- not get longer: the cut is done while the fitting is already under way, and
-- shaping the new length is part of the job rather than an extra sitting.
insert into service_addons (service_id, addon_id, sort_order)
select sv.id, a.id, a.sort_order
from services sv join addons a on a.name = 'Haircut'
where sv.name in ('Hair Extensions (50g)', 'Hair Extensions (100-150g)')
on conflict do nothing;

-- A haircut alongside a toner runs to an hour and a half. Extensions on a
-- toner is a different figure again (two hours) and is set above - the
-- extensions length wins where both are chosen.
update services set duration_with_addons_minutes = 90 where name = 'Toner';

-- ── CONSULTATIONS: FOUR A DAY, AND NEVER ON THE HOUR AN APPOINTMENT STARTS ──
-- Replaces the two-a-day rule and the bare 17:00 cut-off from 0001.
--
-- A consultation is ten minutes and nests happily inside another booking - but
-- not at the moment one begins. 11:00, 13:00, 15:00 and 16:30 are when a
-- client is being greeted, gowned and taken to the chair; a conversation on
-- top of that delays the very appointment it is sitting inside. Half an hour
-- later the colour is going on and the stylist is free to talk, so the thirty
-- minutes after each of those four times is kept clear.
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

-- Owner's revisions, 26 August 2026: grey coverage down to 1,000, and toner
-- taken off the three lightening services.
update addons set price = 1000 where name = 'Grey Coverage';
delete from service_addons sa
using addons a, services sv
where sa.addon_id = a.id and sa.service_id = sv.id
  and a.name = 'Toner'
  and sv.name in ('Balayage / Highlights', 'Half Head Foil', 'Full Head Foil',
                  'Reverse Balayage');
