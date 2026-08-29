-- ── THE SAME THROTTLE FAULT, IN THE OTHER LOOKUP ──
--
-- 0048 fixed the extensions lookup and left this one alone on purpose,
-- because changing a second security path is a decision to make knowingly
-- rather than something to slip in alongside. Made knowingly now.
--
-- get_my_bookings had the identical two problems, from the identical cause -
-- auth_failures recording a kind and a timestamp but never WHO:
--
--   WEAK    - "delete from auth_failures where kind = 'client_lookup'" on
--             any success cleared every client's failures at once, so anyone
--             with one working email+phone pair could reset the counter
--             whenever they liked and carry on guessing.
--   FRAGILE - twenty honest mistakes in fifteen minutes, spread across
--             twenty different real clients, locked every client out of
--             looking up their own appointments.
--
-- The machinery is already here from 0048 - throttle_identity and
-- auth_failure_count_for - so this is the same shape of fix, keyed on the
-- phone number, with the count kept where it was and a global ceiling added
-- underneath it.
--
-- 20 per client per 15 minutes is unchanged: it was never the number that
-- was wrong, only what it was counting. 200 globally in the same window is
-- the circuit-breaker the per-client limit cannot be, since someone walking
-- a list presents a different number every time and never accumulates
-- failures against any single one. It sits far above any believable real
-- quarter-hour and only ever bites bulk guessing - which already has to
-- guess a matching email as well.
create or replace function get_my_bookings(p_email text, p_phone text)
returns table(
  id uuid, booking_ref text, date date,
  start_time time without time zone, end_time time without time zone,
  status booking_status, service_name text, staff_name text, addons text,
  notes text, expected_total numeric, expected_total_is_estimate boolean,
  amount_charged numeric, is_past boolean,
  cancellation_fee numeric, late_cancellation boolean
) language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_phone text := phone_key(p_phone);
  v_id text;
  v_found int;
begin
  if v_email = '' or length(v_phone) < 8 then
    raise exception 'Both the email address and the full phone number are required';
  end if;

  v_id := throttle_identity(v_phone);

  if auth_failure_count_for('client_lookup', interval '15 minutes', v_id) >= 20 then
    raise exception 'Too many lookups for this number. Please wait 15 minutes and try again.';
  end if;
  if auth_failure_count('client_lookup', interval '15 minutes') >= 200 then
    raise exception 'We cannot look that up right now. Please ring the salon and we will help.';
  end if;

  select count(*) into v_found from bookings b
   where lower(b.customer_email) = v_email
     and phone_key(b.customer_phone) = v_phone;

  if v_found = 0 then
    insert into auth_failures (kind, identity) values ('client_lookup', v_id);
    return;
  end if;

  -- Hers only. Getting it right is not a reason to forgive everyone else's
  -- attempts, which was the whole of the old bug.
  delete from auth_failures where kind = 'client_lookup' and identity = v_id;

  return query
    select b.id, b.booking_ref, b.date, b.start_time, b.end_time, b.status,
           sv.name, st.name,
           booking_addons_label(b.id),
           b.notes, b.expected_total, b.expected_total_is_estimate, b.amount_charged,
           ((b.date + b.start_time) at time zone 'Europe/Oslo') < now(),
           b.cancellation_fee, b.late_cancellation
    from bookings b
    join services sv on sv.id = b.service_id
    join staff st on st.id = b.staff_id
     where lower(b.customer_email) = v_email
       and phone_key(b.customer_phone) = v_phone
     order by b.date desc, b.start_time desc;
end; $$;
grant execute on function get_my_bookings to anon;

-- Rows written before 0048 have identity null, so they count towards the
-- global ceiling and towards nobody's personal limit. Left in place rather
-- than backfilled with a guess: there is no way to know now whose they were,
-- and inventing an owner for them would put real failures against the wrong
-- client. They age out of both windows within the hour regardless.
--
-- verify_staff_pin and is_owner_pin still count and clear globally, for the
-- reason 0014 gave and 0048 restated: there is no identity behind a PIN box,
-- and locking the salon for fifteen minutes under sustained guessing is the
-- intended answer rather than a fault.
