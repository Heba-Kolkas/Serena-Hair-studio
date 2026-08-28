-- ── A FULL NAME, AND AN INSTAGRAM IF SHE HAS ONE ──
-- One free-text name field gets "Ada", "ada n", and "Ada Nordmann Hansen" in
-- equal measure, which makes the same client look like three people in the
-- history search. Asked as two fields now.
--
-- customer_name is kept and still written, as "First Last", because the
-- schedule grid, the exports, the messages and every existing query read it.
-- Nothing downstream has to change to keep working.
--
-- Instagram is optional and always will be: plenty of clients do not have one,
-- and a booking must never depend on it. Stored bare - no @, no URL - so the
-- salon can build either.
alter table bookings add column customer_first_name text;
alter table bookings add column customer_last_name text;
alter table bookings add column customer_instagram text;

-- Strips @, a full profile URL, and any trailing slash down to the handle.
create or replace function instagram_handle(p_raw text)
returns text language sql immutable set search_path = public as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(p_raw, ''))),
                     '^(https?://)?(www\.)?instagram\.com/', ''),
      '[^a-z0-9._]', '', 'g'),
    '');
$$;

drop function if exists book_appointment(uuid, uuid, date, time, text, text, text, text, uuid[], int);

create or replace function book_appointment(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null,
  p_terms_version int default null,
  p_first_name text default null, p_last_name text default null,
  p_instagram text default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_current int; v_booking bookings; v_full text;
begin
  if client_must_call(p_customer_phone, p_service_id) then
    raise exception 'Please call the salon to book this service';
  end if;

  select version into v_current from get_current_booking_terms();
  if p_terms_version is null then
    raise exception 'Please accept the cancellation policy before booking';
  end if;
  if v_current is not null and p_terms_version <> v_current then
    raise exception 'The cancellation policy has changed - please reload and read it again';
  end if;

  -- Both halves are required when the two-field form is used. Falls back to
  -- the single field so an older page, or the salon booking by hand, still
  -- works rather than failing on a form it never knew about.
  if coalesce(trim(p_first_name), '') <> '' or coalesce(trim(p_last_name), '') <> '' then
    if coalesce(trim(p_first_name), '') = '' then raise exception 'Please give your first name'; end if;
    if coalesce(trim(p_last_name), '') = '' then raise exception 'Please give your last name'; end if;
    v_full := trim(p_first_name) || ' ' || trim(p_last_name);
  else
    v_full := trim(coalesce(p_customer_name, ''));
    if v_full = '' then raise exception 'Please give your name'; end if;
  end if;

  v_booking := book_appointment_core(
    p_service_id, p_staff_id, p_date, p_start_time,
    v_full, p_customer_email, p_customer_phone,
    p_notes, p_addon_ids, false, true);

  update bookings set
    terms_version = p_terms_version,
    terms_accepted_at = now(),
    customer_first_name = nullif(trim(coalesce(p_first_name, '')), ''),
    customer_last_name  = nullif(trim(coalesce(p_last_name, '')), ''),
    customer_instagram  = instagram_handle(p_instagram)
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end; $$;
grant execute on function book_appointment to anon;

-- The salon booking by hand gets the same three fields.
drop function if exists staff_book_appointment(text, uuid, uuid, date, time, text, text, text, text, uuid[]);

create or replace function staff_book_appointment(
  p_pin text, p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null,
  p_first_name text default null, p_last_name text default null,
  p_instagram text default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_manual_overlap boolean; v_booking bookings; v_full text;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  select coalesce(allow_manual_overlap, false) into v_manual_overlap
    from staff where id = p_staff_id;

  v_full := case
    when coalesce(trim(p_first_name), '') <> '' or coalesce(trim(p_last_name), '') <> ''
      then trim(coalesce(trim(p_first_name), '') || ' ' || coalesce(trim(p_last_name), ''))
    else trim(coalesce(p_customer_name, '')) end;
  if v_full = '' then raise exception 'A name is required'; end if;

  v_booking := book_appointment_core(
    p_service_id, p_staff_id, p_date, p_start_time,
    v_full, p_customer_email, p_customer_phone,
    p_notes, p_addon_ids, coalesce(v_manual_overlap, false), false);

  update bookings set
    customer_first_name = nullif(trim(coalesce(p_first_name, '')), ''),
    customer_last_name  = nullif(trim(coalesce(p_last_name, '')), ''),
    customer_instagram  = instagram_handle(p_instagram)
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end; $$;
grant execute on function staff_book_appointment to anon;
