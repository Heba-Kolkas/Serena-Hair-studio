-- ── "PLEASE CALL US TO BOOK" ──
-- NOT YET APPLIED — run after 0001-0009.
--
-- The one piece of leverage that survives after a client has gone home is
-- access to the calendar. Money cannot be taken from someone who has left, but
-- a booking she wants can be made conditional.
--
-- DELIBERATELY MANUAL. The obvious version flips automatically after two
-- no-shows, and it would be wrong: the owner knows which client had a genuinely
-- terrible fortnight and which is taking the mickey, and a database counting to
-- two knows neither. So the panel shows who the candidates are and the owner
-- decides. The report suggests; a person judges.
--
-- Scoped to the long services only. A client who no-showed a four-hour colour
-- can still book a blowdry online — the point is to stop the salon losing whole
-- afternoons, not to punish her out of the business.

create table gated_clients (
  -- Phone, because it is the one thing a client keeps across email addresses
  -- and spellings of her name, and it is what the salon has to hand.
  customer_phone text primary key,
  -- Kept for the panel; the phone is the key that actually matches.
  customer_name text,
  reason text,
  gated_by uuid references staff(id) on delete set null,
  gated_at timestamptz not null default now()
);

alter table gated_clients enable row level security;
-- No anon policy. A client must never be able to read this list — it is a
-- judgement about people, and being on it is not something to be discoverable.
create policy "admin manage gated_clients" on gated_clients for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Which services the gate covers: the ones where a no-show costs an afternoon
-- rather than an hour.
create or replace function service_is_long(p_service_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select sv.daily_limited
        or sv.category in ('Bridal', 'Hair Extensions')
        or sv.duration_minutes >= 180
    from services sv where sv.id = p_service_id
  ), false);
$$;

-- Asked by the wizard as soon as it knows her phone number — at the details
-- step, before she picks anything else. Being told "please call us" after
-- filling in a whole form is a worse experience than being told early, and the
-- message is friendlier than a booking that fails at the last moment.
--
-- Returns false for anyone not on the list, which is almost everybody, and
-- never says why. The reason is the salon's business, not something to be
-- served to the public API.
create or replace function client_must_call(p_phone text, p_service_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from gated_clients g
    where g.customer_phone = trim(coalesce(p_phone, ''))
  ) and service_is_long(p_service_id);
$$;
grant execute on function client_must_call to anon;

-- ── OWNER PANEL ──
-- The candidates, with everything needed to judge them: how often, how
-- recently, how much is unpaid, and whether they are already gated.
create or replace function admin_gate_candidates(p_pin text, p_min int default 1)
returns table (
  customer_name text,
  customer_phone text,
  late_cancellations int,
  no_shows int,
  unpaid_fees numeric,
  last_offence date,
  total_visits int,
  is_gated boolean,
  gate_reason text
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
  select max(b.customer_name),
         b.customer_phone,
         -- A no-show now carries late_cancellation too (the fee trigger sets
         -- it), so late cancellations are counted as the ones that are NOT
         -- no-shows. Otherwise the same booking appears in both columns.
         count(*) filter (where b.late_cancellation and b.status <> 'no_show')::int,
         count(*) filter (where b.status = 'no_show')::int,
         coalesce(sum(b.cancellation_fee) filter (
           where not b.cancellation_fee_waived and not b.cancellation_fee_settled
         ), 0),
         max(b.date) filter (where b.late_cancellation or b.status = 'no_show'),
         -- Context that changes the decision: two no-shows out of three visits
         -- is a different person from two out of forty.
         (select count(*) from bookings b3
          where b3.customer_phone = b.customer_phone
            and b3.status = 'completed')::int,
         (g.customer_phone is not null),
         g.reason
  from bookings b
  left join gated_clients g on g.customer_phone = b.customer_phone
  where b.late_cancellation or b.status = 'no_show'
  group by b.customer_phone, g.customer_phone, g.reason
  having count(*) filter (where b.late_cancellation or b.status = 'no_show') >= p_min
  order by count(*) filter (where b.late_cancellation or b.status = 'no_show') desc,
           max(b.date) desc;
end; $$;
grant execute on function admin_gate_candidates to anon;

create or replace function admin_set_client_gate(
  p_pin text, p_phone text, p_name text, p_gated boolean, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if coalesce(trim(p_phone), '') = '' then raise exception 'A phone number is required'; end if;

  if p_gated then
    insert into gated_clients (customer_phone, customer_name, reason)
    values (trim(p_phone), p_name, nullif(trim(coalesce(p_reason, '')), ''))
    on conflict (customer_phone) do update
      set customer_name = excluded.customer_name,
          reason = excluded.reason,
          gated_at = now();
  else
    delete from gated_clients where customer_phone = trim(p_phone);
  end if;
end; $$;
grant execute on function admin_set_client_gate to anon;

-- ── AND THE BOOKING ITSELF REFUSES ──
-- The wizard asks early so the client gets a kind message rather than a failure
-- at the last step. This is the version that cannot be talked past: the RPC is
-- reachable with the public key, so a crafted call must hit the same wall.
--
-- Only the public path. staff_book_appointment is untouched — when she rings,
-- which is the entire point of the gate, the salon books her by hand.
create or replace function book_appointment(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null,
  p_terms_version int default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_current int; v_booking bookings;
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

  v_booking := book_appointment_core(
    p_service_id, p_staff_id, p_date, p_start_time,
    p_customer_name, p_customer_email, p_customer_phone,
    p_notes, p_addon_ids, false, true);

  update bookings set
    terms_version = p_terms_version,
    terms_accepted_at = now()
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end; $$;
grant execute on function book_appointment to anon;
