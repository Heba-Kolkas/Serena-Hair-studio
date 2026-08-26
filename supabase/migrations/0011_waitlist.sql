-- ── THE WAITING LIST ──
-- NOT YET APPLIED — run after 0001-0010.
--
-- Two jobs, and the second one is the bigger money.
--
--   1. A cancellation frees a slot. Somebody wants it.
--   2. A four-hour block is still unsold two days out, or an hour-long gap is
--      still unsold the day before. Nobody cancelled — it simply never sold,
--      and without a list there is nobody to offer it to.
--
-- HOW AN OFFER WORKS, AND WHAT IT IS NOT
-- Three people are told at a time, and two hours later three more, and so on.
-- Nobody is ever locked out: an earlier batch can still book the slot for as
-- long as it is free. The slot is NOT held for anyone — first to book gets it,
-- and the messages say so plainly, because a client who thinks a time is
-- reserved for her and finds it gone is angrier than one who was told it was a
-- race.
--
-- WHO IS SKIPPED
-- Anyone with a confirmed booking within seven days of the open slot. Moving a
-- client from Thursday to Tuesday earns the salon nothing — it relocates the
-- same money and leaves a Thursday hole to refill at short notice. Clients
-- booked further out are kept: bringing one forward fills an urgent gap and
-- frees a distant slot that has weeks to resell.
--
-- WHO IS OFFERED FIRST
-- Whoever fills the most of the gap. A four-hour cancellation goes to someone
-- wanting colour before it goes to someone wanting a blowdry — otherwise a 680
-- NOK booking swallows a 3 750 NOK hole. Ties break on who has waited longest.

create table waitlist_entries (
  id uuid primary key default gen_random_uuid(),

  customer_name text not null,
  customer_phone text not null,
  customer_email text,

  -- What she is waiting for. The service is required: without it there is no
  -- way to know whether an open slot is long enough for her.
  service_id uuid not null references services(id) on delete cascade,
  -- Null means she does not mind who does it, which makes her matchable
  -- against both stylists and is the better outcome for everyone.
  staff_id uuid references staff(id) on delete set null,

  -- The window she would accept. Null latest_date means "any time from
  -- earliest onward".
  earliest_date date not null default (now() at time zone 'Europe/Oslo')::date,
  latest_date date,

  notes text,

  -- CONSENT. Norwegian marketing law treats an unsolicited electronic message
  -- as marketing needing prior consent; a message she asked for is not that.
  -- The difference is provable only if the asking was recorded — so the exact
  -- wording she agreed to, and when, is stored on the row. Without this the
  -- list is a liability rather than an asset.
  consent_text text not null,
  consent_at timestamptz not null default now(),
  -- She may want the email but not the text. Asked separately, never assumed.
  consent_sms boolean not null default false,

  lang text not null default 'no' check (lang in ('no', 'en')),

  -- Unsubscribing must not require logging in to anything. This goes in every
  -- message as a one-click link.
  unsubscribe_token text not null unique
    default replace(gen_random_uuid()::text, '-', ''),

  active boolean not null default true,
  removed_at timestamptz,
  removed_reason text,

  created_at timestamptz not null default now()
);

create index waitlist_active_idx on waitlist_entries(active, service_id);
create index waitlist_phone_idx on waitlist_entries(customer_phone);

alter table waitlist_entries enable row level security;
-- No anon policy: a client must never be able to read the list. It is names,
-- phone numbers and emails of other people.
create policy "admin manage waitlist" on waitlist_entries for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Who has been told about which slot. Stops the same person being offered the
-- same time twice when a sweep runs again, and is what makes "three at a time,
-- two hours apart" possible at all.
create table waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references waitlist_entries(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  date date not null,
  start_time time not null,
  batch int not null default 1,
  sent_at timestamptz not null default now(),
  -- Set if she booked something after being told. Not proof she took THIS
  -- slot, but close enough to measure whether the list is working.
  booked_after boolean not null default false
);

create unique index waitlist_offer_once
  on waitlist_offers (entry_id, staff_id, date, start_time);
create index waitlist_offer_slot_idx on waitlist_offers(staff_id, date, start_time, sent_at);

alter table waitlist_offers enable row level security;
create policy "admin manage waitlist_offers" on waitlist_offers for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── JOINING ──
-- The wording she agreed to is passed in and stored verbatim, rather than
-- looked up here. If the form ever changes, old rows keep the text those
-- clients actually saw.
create or replace function join_waitlist(
  p_name text, p_phone text, p_email text,
  p_service_id uuid, p_staff_id uuid,
  p_earliest date, p_latest date,
  p_consent_text text, p_consent_sms boolean,
  p_lang text default 'no', p_notes text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Please tell us your name'; end if;
  if coalesce(trim(p_phone), '') = '' then raise exception 'Please give us a phone number'; end if;
  if coalesce(trim(p_consent_text), '') = '' then
    raise exception 'Consent wording is required';
  end if;
  if not exists (select 1 from services where id = p_service_id and active) then
    raise exception 'Unknown service';
  end if;

  -- One live entry per person per service. Asking twice should refresh what she
  -- wants, not create a second row that gets messaged twice.
  update waitlist_entries set active = false, removed_at = now(),
         removed_reason = 'replaced by a newer request'
  where customer_phone = trim(p_phone) and service_id = p_service_id and active;

  insert into waitlist_entries (
    customer_name, customer_phone, customer_email, service_id, staff_id,
    earliest_date, latest_date, notes, consent_text, consent_sms, lang
  ) values (
    trim(p_name), trim(p_phone), nullif(trim(coalesce(p_email, '')), ''),
    p_service_id, p_staff_id,
    coalesce(p_earliest, (now() at time zone 'Europe/Oslo')::date), p_latest,
    nullif(trim(coalesce(p_notes, '')), ''),
    trim(p_consent_text), coalesce(p_consent_sms, false),
    case when p_lang = 'en' then 'en' else 'no' end
  ) returning unsubscribe_token into v_token;

  return v_token;
end; $$;
grant execute on function join_waitlist to anon;

-- One click, no login. Deliberately forgiving: an unknown token succeeds
-- silently rather than erroring, because someone clicking twice should see
-- "you're off the list", not a failure.
create or replace function leave_waitlist(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update waitlist_entries
  set active = false, removed_at = now(), removed_reason = 'unsubscribed'
  where unsubscribe_token = p_token and active;
end; $$;
grant execute on function leave_waitlist to anon;

-- ── WHO TO TELL ABOUT AN OPEN SLOT ──
-- Everything above expressed as one query. Deliberately not a loop in a
-- script: these are business rules, and they belong where they can be read and
-- checked without deploying anything.
create or replace function waitlist_candidates(
  p_staff_id uuid, p_date date, p_start_time time, p_minutes int,
  p_batch_size int default 3
) returns table (
  entry_id uuid,
  customer_name text,
  customer_phone text,
  customer_email text,
  consent_sms boolean,
  lang text,
  unsubscribe_token text,
  service_id uuid,
  service_name text,
  service_minutes int,
  fills_minutes int,
  days_waiting int
) language plpgsql security definer set search_path = public as $$
begin
  return query
  select w.id, w.customer_name, w.customer_phone, w.customer_email,
         w.consent_sms, w.lang, w.unsubscribe_token,
         sv.id, sv.name, sv.duration_minutes,
         least(sv.duration_minutes, p_minutes),
         (((now() at time zone 'Europe/Oslo')::date - w.created_at::date))::int
  from waitlist_entries w
  join services sv on sv.id = w.service_id
  where w.active
    -- It has to actually fit.
    and sv.duration_minutes <= p_minutes
    -- Her stylist, or she does not mind.
    and (w.staff_id is null or w.staff_id = p_staff_id)
    and exists (
      select 1 from staff_services ss
      where ss.staff_id = p_staff_id and ss.service_id = w.service_id
    )
    -- Inside the window she asked for.
    and p_date >= w.earliest_date
    and (w.latest_date is null or p_date <= w.latest_date)
    -- Not already told about this exact slot.
    and not exists (
      select 1 from waitlist_offers o
      where o.entry_id = w.id and o.staff_id = p_staff_id
        and o.date = p_date and o.start_time = p_start_time
    )
    -- Skipped if she already has a booking within seven days of it: moving her
    -- relocates the same money and leaves a hole somewhere else.
    and not exists (
      select 1 from bookings b
      where b.customer_phone = w.customer_phone
        and b.status in ('confirmed', 'arrived', 'pending')
        and abs(b.date - p_date) <= 7
    )
  -- Fills the most of the gap first, then whoever has waited longest.
  order by least(sv.duration_minutes, p_minutes) desc, w.created_at
  limit p_batch_size;
end; $$;
-- Not granted to anon: this returns other people's contact details. Called by
-- the scheduled job and by the Owner Panel only.

create or replace function record_waitlist_offer(
  p_entry_id uuid, p_staff_id uuid, p_date date, p_start_time time, p_batch int
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into waitlist_offers (entry_id, staff_id, date, start_time, batch)
  values (p_entry_id, p_staff_id, p_date, p_start_time, p_batch);
  return true;
exception when unique_violation then
  return false;
end; $$;

-- How many batches have already gone out for a slot, and how long ago the last
-- one was. The job uses it to decide whether the two hours are up.
create or replace function waitlist_slot_progress(
  p_staff_id uuid, p_date date, p_start_time time
) returns table (batches int, last_sent timestamptz, minutes_since numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(max(o.batch), 0),
         max(o.sent_at),
         round(extract(epoch from (now() - max(o.sent_at))) / 60.0, 0)
  from waitlist_offers o
  where o.staff_id = p_staff_id and o.date = p_date and o.start_time = p_start_time;
$$;

-- ── THE OWNER'S VIEW ──
create or replace function admin_waitlist(p_pin text)
returns table (
  id uuid,
  customer_name text, customer_phone text, customer_email text,
  service_name text, staff_name text,
  earliest_date date, latest_date date,
  notes text,
  consent_sms boolean,
  days_waiting int,
  times_offered int,
  last_offered timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query
  select w.id, w.customer_name, w.customer_phone, w.customer_email,
         sv.name, st.name,
         w.earliest_date, w.latest_date, w.notes, w.consent_sms,
         (((now() at time zone 'Europe/Oslo')::date - w.created_at::date))::int,
         (select count(*) from waitlist_offers o where o.entry_id = w.id)::int,
         (select max(o.sent_at) from waitlist_offers o where o.entry_id = w.id)
  from waitlist_entries w
  join services sv on sv.id = w.service_id
  left join staff st on st.id = w.staff_id
  where w.active
  order by w.created_at;
end; $$;
grant execute on function admin_waitlist to anon;

create or replace function admin_remove_from_waitlist(p_pin text, p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  update waitlist_entries
  set active = false, removed_at = now(),
      removed_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'removed by the salon')
  where id = p_id;
end; $$;
grant execute on function admin_remove_from_waitlist to anon;

-- ── WHAT IS STILL UNSOLD ──
-- The proactive half, and the reason the list is worth having even in a week
-- when nobody cancels.
--
-- Two thresholds, because the two gaps are not the same problem. A four-hour
-- block needs a client to arrange half a day off, so it is surfaced two days
-- out. An hour-long gap can be filled the same afternoon, so it waits until
-- the day before — which is also when the colour hold lapses and the day opens
-- up anyway.
create or replace function unsold_gaps(p_days_ahead int default 2)
returns table (
  staff_id uuid,
  staff_name text,
  date date,
  gap_start time,
  gap_end time,
  gap_minutes int,
  days_until int
) language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with days as (
    select ((now() at time zone 'Europe/Oslo')::date + d) as day, d as offset_days
    from generate_series(0, p_days_ahead) d
  ),
  hours as (
    select st.id as sid, st.name as sname, dd.day, dd.offset_days,
           coalesce(sho.close_time, bh.close_time) as close_time,
           bh.open_time
    from staff st
    cross join days dd
    join business_hours bh on bh.weekday = extract(dow from dd.day)::int and not bh.closed
    left join staff_hours_override sho
      on sho.staff_id = st.id and sho.weekday = extract(dow from dd.day)::int
    where st.active and st.bookable
  ),
  busy as (
    select b.staff_id, b.date, b.start_time, b.end_time
    from bookings b where b.status <> 'cancelled'
    union all
    select bs.staff_id, bs.date, bs.start_time, bs.end_time
    from blocked_slots bs where bs.staff_id is not null
  ),
  -- The end of the previous booking, or the start of the day, paired with the
  -- start of the next. Anything between the two is unsold.
  edges as (
    select h.sid, h.sname, h.day, h.offset_days, h.open_time as gs,
           coalesce(min(bz.start_time), h.close_time) as ge
    from hours h
    left join busy bz on bz.staff_id = h.sid and bz.date = h.day
    group by h.sid, h.sname, h.day, h.offset_days, h.open_time, h.close_time
    union all
    select h.sid, h.sname, h.day, h.offset_days, bz.end_time,
           coalesce((select min(b2.start_time) from busy b2
                     where b2.staff_id = h.sid and b2.date = h.day
                       and b2.start_time >= bz.end_time), h.close_time)
    from hours h
    join busy bz on bz.staff_id = h.sid and bz.date = h.day
  )
  select e.sid, e.sname, e.day, e.gs, e.ge,
         (extract(epoch from (e.ge - e.gs)) / 60)::int,
         e.offset_days::int
  from edges e
  where e.ge > e.gs
    and extract(epoch from (e.ge - e.gs)) / 60 >= 60
    -- Four-hour blocks surface two days out; shorter gaps only the day before.
    and (e.offset_days <= 1 or extract(epoch from (e.ge - e.gs)) / 60 >= 240)
  order by e.day, e.gs, e.sname;
end; $$;

-- setof record would force every caller to declare the column list; spelling
-- it out here keeps the PostgREST call a plain rpc().
create or replace function admin_unsold_gaps(p_pin text, p_days_ahead int default 2)
returns table (
  staff_id uuid,
  staff_name text,
  date date,
  gap_start time,
  gap_end time,
  gap_minutes int,
  days_until int
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query select * from unsold_gaps(p_days_ahead);
end; $$;
grant execute on function admin_unsold_gaps to anon;
