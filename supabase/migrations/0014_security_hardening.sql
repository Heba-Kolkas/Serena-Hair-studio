-- ── SECURITY HARDENING ──
-- Three findings from the audit of 27 August 2026, all exploitable with the
-- public anon key that necessarily ships in the site's JavaScript.
--
-- 1. THE PIN WAS BRUTE-FORCEABLE TO OWNER LEVEL.
--    verify_staff_pin and is_owner_pin are callable by anon - they have to be,
--    the schedule tool has no other way in - and a four-digit PIN with no
--    limit is ten thousand guesses, a few seconds of scripted requests. The
--    owner PIN unlocks every admin_* function: all bookings, all client
--    contact details, revenue, and the ability to change the PINs.
--
-- 2. get_my_bookings MATCHED ON email OR phone.
--    Knowing either one returned that client's whole history. Norwegian
--    mobiles are eight digits with a handful of prefixes, so the client list
--    could be harvested by iterating them. A personal-data breach under GDPR
--    art. 32, reportable to Datatilsynet.
--
-- 3. cancel_my_booking HAD THE SAME "OR".
--    One guessed field plus a booking id cancelled a stranger's appointment.

-- ── ATTEMPT LOG ──
-- Only failures are recorded. verify_staff_pin runs on every schedule fetch,
-- so logging successes too would write a row per page load for no benefit.
create table auth_failures (
  id bigserial primary key,
  kind text not null check (kind in ('pin', 'client_lookup')),
  at timestamptz not null default now()
);
create index auth_failures_kind_at_idx on auth_failures (kind, at desc);

alter table auth_failures enable row level security;
-- No policy for anon at all: written only by the SECURITY DEFINER functions
-- below, which bypass RLS. A caller must never be able to clear its own trail.

-- How many failures of this kind are inside the window.
create or replace function auth_failure_count(p_kind text, p_window interval)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from auth_failures
  where kind = p_kind and at > now() - p_window;
$$;

-- ── PIN VERIFICATION, THROTTLED ──
-- Eight wrong guesses in fifteen minutes and everything of that kind is
-- refused until the window passes. Against a six-digit PIN that is 32 guesses
-- an hour into a million-value space: on the order of a thousand years, rather
-- than the few seconds it took before.
--
-- A correct PIN clears the failures, so a stylist who fat-fingers it twice and
-- then gets it right is never held up. The trade is that a sustained attack
-- can lock the salon out for fifteen minutes, which is far better than the
-- attack succeeding.
create or replace function verify_staff_pin(p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if auth_failure_count('pin', interval '15 minutes') >= 8 then
    raise exception 'Too many incorrect PIN attempts. Please wait 15 minutes and try again.';
  end if;
  select exists (
    select 1 from app_settings
    where key in ('staff_pin', 'owner_pin') and value = p_pin
  ) into v_ok;
  if v_ok then
    delete from auth_failures where kind = 'pin';
  else
    insert into auth_failures (kind) values ('pin');
  end if;
  return v_ok;
end; $$;
grant execute on function verify_staff_pin to anon;

create or replace function is_owner_pin(p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if auth_failure_count('pin', interval '15 minutes') >= 8 then
    raise exception 'Too many incorrect PIN attempts. Please wait 15 minutes and try again.';
  end if;
  select exists (
    select 1 from app_settings where key = 'owner_pin' and value = p_pin
  ) into v_ok;
  -- Only a wrong PIN counts. A staff PIN reaching here is a stylist opening a
  -- screen that happens to ask whether they are the owner - a correct answer
  -- of "no", not a failed guess.
  if v_ok then
    delete from auth_failures where kind = 'pin';
  elsif not exists (
    select 1 from app_settings where key = 'staff_pin' and value = p_pin
  ) then
    insert into auth_failures (kind) values ('pin');
  end if;
  return v_ok;
end; $$;
grant execute on function is_owner_pin to anon;

-- ── CLIENT LOOKUP: BOTH, NOT EITHER ──
-- Email AND phone must both be given and both must match the same booking.
-- Knowing one is no longer enough, so the row cannot be reached by walking
-- phone numbers. Throttled as well, because two fields are still guessable
-- for someone who knows the client.
create or replace function get_my_bookings(p_email text, p_phone text)
returns setof bookings language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
        v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
        v_found int;
begin
  if v_email = '' or v_phone = '' then
    raise exception 'Both the email address and the phone number are required';
  end if;
  if auth_failure_count('client_lookup', interval '15 minutes') >= 20 then
    raise exception 'Too many lookups. Please wait 15 minutes and try again.';
  end if;

  select count(*) into v_found from bookings b
   where lower(b.customer_email) = v_email
     and regexp_replace(b.customer_phone, '\D', '', 'g') = v_phone;

  if v_found = 0 then
    insert into auth_failures (kind) values ('client_lookup');
    return;
  end if;

  delete from auth_failures where kind = 'client_lookup';
  return query
    select * from bookings b
     where lower(b.customer_email) = v_email
       and regexp_replace(b.customer_phone, '\D', '', 'g') = v_phone
     order by b.date desc, b.start_time desc;
end; $$;
grant execute on function get_my_bookings to anon;

create or replace function cancel_my_booking(p_booking_id uuid, p_email text, p_phone text)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings;
        v_email text := lower(trim(coalesce(p_email, '')));
        v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if v_email = '' or v_phone = '' then
    raise exception 'Both the email address and the phone number are required';
  end if;
  update bookings set status = 'cancelled'
  where id = p_booking_id
    and lower(customer_email) = v_email
    and regexp_replace(customer_phone, '\D', '', 'g') = v_phone
    and status not in ('cancelled', 'completed')
  returning * into v_booking;
  if v_booking is null then
    raise exception 'Booking not found, or already cancelled or completed';
  end if;
  return v_booking;
end; $$;
grant execute on function cancel_my_booking to anon;

-- ── NEW PINS ──
-- The seed shipped 1234 and 9999. Six digits instead of four takes the search
-- space from ten thousand to a million; with the throttle above that is the
-- difference between seconds and centuries. Still typable on a phone.
-- Change them from the Owner Panel whenever you like - these are a starting
-- point, not a permanent secret.
update app_settings set value = '628413', updated_at = now() where key = 'staff_pin';
update app_settings set value = '907254', updated_at = now() where key = 'owner_pin';
