alter table bookings add column sms_consent boolean not null default false;

create table booking_attempts (
  id bigserial primary key,
  phone_key text not null,
  at timestamptz not null default now()
);
create index booking_attempts_idx on booking_attempts (phone_key, at desc);
alter table booking_attempts enable row level security;

create or replace function booking_rate_ok(p_phone text)
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) < 6 from booking_attempts
  where phone_key = phone_key(p_phone) and at > now() - interval '1 hour';
$$;

-- The previous signature took thirteen arguments; this takes fourteen. That is
-- an overload, not a replacement, so the GRANT below would be ambiguous with
-- both present.
drop function if exists book_appointment(uuid, uuid, date, time, text, text, text, text, uuid[], int, text, text, text);

create or replace function book_appointment(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null,
  p_terms_version int default null,
  p_first_name text default null, p_last_name text default null,
  p_instagram text default null, p_sms_consent boolean default false
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_current int; v_booking bookings; v_full text;
begin
  if not booking_rate_ok(p_customer_phone) then
    raise exception 'That is a lot of bookings in a short time. Please ring the salon and we will help.';
  end if;
  insert into booking_attempts (phone_key) values (phone_key(p_customer_phone));

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
    customer_instagram  = instagram_handle(p_instagram),
    sms_consent         = coalesce(p_sms_consent, false)
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end; $$;
grant execute on function book_appointment to anon;

create or replace function purge_booking_attempts()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from booking_attempts where at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end; $$;
