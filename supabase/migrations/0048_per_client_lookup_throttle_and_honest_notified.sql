-- ══════════════════════════════════════════════════════════════════
--  TWO THINGS THAT REPORTED SUCCESS THEY HAD NOT EARNED
-- ══════════════════════════════════════════════════════════════════

-- ── 1. "TOLD HER" WHEN NOBODY WAS TOLD ──
--
-- staff_mark_extensions_notified only moves an order that is currently
-- 'arrived'. Anything else - already notified, already fitted, cancelled,
-- or a second click landing a moment after the first - matched no row and
-- the function returned quietly. It returns void, so the panel had nothing
-- to check: it saw no error and printed "✓ Told her."
--
-- Returns whether it actually changed the row rather than raising. An
-- exception here would put an error dialog in front of a stylist who has
-- done nothing wrong, mid-job, on the commonest case (a double click) -
-- which is worse than the silence it replaces. A boolean lets the panel say
-- the true thing calmly and lets a double click stay a non-event.
--
-- DROP first, not CREATE OR REPLACE: the return type changes, and Postgres
-- refuses to replace a function's return type in place. Dropping is also
-- what keeps this from becoming a second overload - the trap 0044 and 0046
-- were both written to clean up.
drop function if exists staff_mark_extensions_notified(text, uuid);

create or replace function staff_mark_extensions_notified(
  p_pin text, p_order_id uuid
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  update extension_orders set status = 'notified', notified_at = now()
  where id = p_order_id and status = 'arrived';
  -- FOUND, not GET DIAGNOSTICS ... row_count: the latter yields an integer
  -- and there is no assignment cast from integer to boolean, so it would
  -- have thrown at runtime on the first click. FOUND is the same fact in the
  -- form this needs, and is what 0007 already uses beside it.
  return found;
end; $$;
grant execute on function staff_mark_extensions_notified to anon;


-- ── 2. THE LOOKUP THROTTLE COUNTED EVERYONE AS ONE PERSON ──
--
-- auth_failures records only a kind and a timestamp - no notion of WHO
-- failed. That is right for the staff PIN, where there is no identity to
-- key on and locking the whole salon out for fifteen minutes is the
-- intended, correct response to sustained guessing.
--
-- It is wrong for the extensions lookup, where every attempt arrives with a
-- phone number attached, and it produced a throttle that was weak and
-- fragile at the same time:
--
--   WEAK    - a success cleared the failures of every client at once, so
--             anyone holding one valid phone+email pair could reset the
--             counter at will and go straight back to guessing.
--   FRAGILE - twelve honest typos in an hour, spread across twelve
--             different real clients, locked out every client in the salon.
--
-- Both come from the same missing fact. Recording it fixes both: the limit
-- becomes per client, so one person's mistakes are their own, and a success
-- clears only that person's history rather than wiping the slate for
-- everybody.
--
-- Stored as a hash, never the number itself. The whole point of this table
-- is to make bulk phone-number guessing expensive; a plaintext column of
-- every number anyone has tried would be a far better list to steal than
-- anything the throttle protects. Hashing groups attempts exactly as well
-- and leaves nothing worth reading. Nullable, so every existing caller -
-- the PIN, the client lookup - keeps writing rows exactly as before.
alter table auth_failures add column if not exists identity text;
create index if not exists auth_failures_kind_identity_at_idx
  on auth_failures (kind, identity, at desc);

create or replace function throttle_identity(p_value text)
returns text language sql immutable security definer set search_path = public as $$
  select case
    when coalesce(trim(p_value), '') = '' then null
    else encode(sha256(convert_to(lower(trim(p_value)), 'UTF8')), 'hex')
  end;
$$;

-- A SEPARATE NAME, not a third parameter on auth_failure_count. Adding
-- p_identity with a default would create an overload that every existing
-- two-argument call - including verify_staff_pin, which runs on every
-- schedule fetch - could match ambiguously, and Postgres would refuse to
-- choose. That is precisely the failure 0044 spent a migration undoing, and
-- 0046 hit again. The two-argument version below is left exactly as it is.
create or replace function auth_failure_count_for(
  p_kind text, p_window interval, p_identity text
) returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from auth_failures
  where kind = p_kind and identity = p_identity and at > now() - p_window;
$$;

-- ── THE LOOKUP, THROTTLED ON TWO LEVELS ──
--
-- PER CLIENT (12 an hour) is the real limit and the one a person can hit.
-- It stops someone working through guesses at a number they already know,
-- and it costs an honest client nothing: she types her own details once and
-- they match.
--
-- GLOBALLY (240 an hour) is the ceiling that the per-client limit alone
-- cannot provide, because someone enumerating phone numbers presents a
-- different number every time and so never accumulates failures against any
-- single one. Set high on purpose - roughly twenty times any plausible real
-- salon hour - so it is unreachable by ordinary use and only ever bites bulk
-- guessing. It caps enumeration at a few thousand numbers a day against a
-- lookup that also demands the matching email, which is no longer a
-- practical way to map anybody's client list.
--
-- Everything else - the phone+email pairing, the wording, the arrived and
-- on-its-way branches, the deposit terms from 0047 - is unchanged.
create or replace function extensions_status_for(p_phone text, p_email text)
returns table(allowed boolean, earliest_date date, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_key text := phone_key(p_phone);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id text;
  v_order extension_orders;
  v_earliest date;
begin
  if v_email = '' or length(coalesce(v_key, '')) < 8 then
    return query select false, null::date,
      'Please give both the mobile number and the email address you booked with.'::text;
    return;
  end if;

  v_id := throttle_identity(v_key);

  if auth_failure_count_for('extensions_lookup', interval '1 hour', v_id) >= 12 then
    raise exception 'Too many attempts for this number. Please wait an hour, or ring the salon and we will book it for you.';
  end if;
  if auth_failure_count('extensions_lookup', interval '1 hour') >= 240 then
    raise exception 'We cannot check that right now. Please ring the salon and we will book it for you.';
  end if;

  select * into v_order
    from extension_orders o
   where phone_key(o.customer_phone) = v_key
     and lower(coalesce(o.customer_email, '')) = v_email
     and coalesce(o.status, '') <> 'cancelled'
   order by o.ordered_at desc nulls last
   limit 1;

  if v_order.id is null then
    insert into auth_failures (kind, identity) values ('extensions_lookup', v_id);
    return query select false, null::date,
      'We could not find an extensions order for those details. Extensions start with a consultation - we match your colour, order the hair and take a deposit, and then you can book the fitting. The deposit is non-refundable: it pays for hair ordered in your colour, which we cannot use for anyone else.'::text;
    return;
  end if;

  -- Hers only. Getting it right is not a reason to forgive everyone else's
  -- attempts, which was the whole of the old bug.
  delete from auth_failures where kind = 'extensions_lookup' and identity = v_id;

  if not (v_order.deposit_paid or v_order.booking_allowed_before_deposit) then
    return query select false, null::date,
      'Your order is on file, but the deposit is still open. Please pay your deposit, or if there is something else, message us on Instagram @studioserena.hair. The deposit is non-refundable - your hair is ordered in your colour and cannot be used for anyone else.'::text;
    return;
  end if;

  if v_order.arrived_at is not null then
    return query select true, current_date,
      (case when v_order.deposit_paid
         then 'Your hair has arrived. Choose any time that suits you.'
         else 'Your hair has arrived - you can book your spot now. Please settle your deposit before your fitting; deposits are non-refundable.' end)::text;
    return;
  end if;

  v_earliest := coalesce(v_order.ordered_at, now())::date + 18;
  return query select true, v_earliest,
    (format('Your hair is on its way - you can book your spot now. Fittings are available from %s.', to_char(v_earliest, 'DD.MM.YYYY'))
      || case when not v_order.deposit_paid then ' Please settle your deposit before your fitting; deposits are non-refundable.' else '' end)::text;
end; $$;
grant execute on function extensions_status_for to anon;

-- ── DELIBERATELY NOT TOUCHED HERE ──
--
-- verify_staff_pin / is_owner_pin keep counting and clearing globally. There
-- is no identity behind a PIN box to key on, and a salon-wide fifteen-minute
-- lock under sustained guessing is the behaviour that file chose on purpose.
--
-- client_lookup has the same shape as the extensions lookup did - phone and
-- email, one global tally - and the same two weaknesses. Left alone here
-- because changing a second security path is the owner's call to make
-- knowingly, not something to slip in alongside a fix that was asked for.
-- It was asked for straight afterwards: see 0050, which applies exactly this
-- treatment to get_my_bookings using the two functions above.
