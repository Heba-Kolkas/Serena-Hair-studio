-- ── PART 5: RLS ──
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

-- ── PART 6: OWNER PANEL ──
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

create or replace function admin_set_addon_services(p_pin text, p_addon_id uuid, p_service_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
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

-- ── SERVICE FORM ──
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

-- ── MONTH-AT-A-TIME AVAILABILITY ──
create or replace function get_busy_slots_range(p_staff_id uuid, p_date_from date, p_date_to date)
returns table(date date, start_time time, end_time time)
language sql security definer set search_path = public as $$
  select b.date, b.start_time, b.end_time from bookings b
  where b.staff_id = p_staff_id
    and b.date between p_date_from and p_date_to
    and b.status <> 'cancelled';
$$;
grant execute on function get_busy_slots_range to anon;

-- ── PART 7: ROLLING BOOKING HORIZON ──
insert into app_settings (key, value) values ('booking_horizon_days', '60')
  on conflict (key) do nothing;

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
create table staff_day_policy (
  staff_id uuid not null references staff(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),
  max_limited_per_day int,
  allow_other_services boolean not null default true,
  max_other_per_day int,
  late_fill_days int,
  colour_hold_days int,
  open_time time,
  close_time time,
  other_open_time time,
  other_split_at time,
  close_after_early time,
  open_before_late time,
  primary key (staff_id, weekday)
);
