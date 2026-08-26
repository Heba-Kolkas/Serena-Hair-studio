-- ── EXPORTING THE BOOKS ──
-- NOT YET APPLIED — run after 0001-0005.
--
-- Two exports, not one, and the split is deliberate.
--
-- The export the owner reaches for every month is the accounting one, and
-- bookkeeping needs no names: what was sold, when, by whom, for how much. So
-- that file carries no personal data at all, which means a copy sitting in a
-- Downloads folder or emailed to an accountant is not a personal-data
-- incident waiting to happen. It is the safest file precisely because it is
-- the one that gets handled most.
--
-- The client export exists because occasionally it is genuinely needed. It
-- carries names, phone numbers and emails, so it writes a line to
-- activity_log every time it runs — not to police the owner, but so that if
-- a client ever asks "who has my data and when was it touched", there is an
-- answer.

-- activity_log's action list is a closed check constraint, so the new action
-- has to be admitted before it can be written.
alter table activity_log drop constraint activity_log_action_check;
alter table activity_log add constraint activity_log_action_check
  check (action in (
    'arrived', 'no_show', 'confirmed', 'block_created', 'block_removed',
    'data_export', 'client_data_deleted'
  ));

-- ── ACCOUNTING EXPORT ──
-- No customer_name, no customer_email, no customer_phone, no notes. If a
-- column is ever added here, it must survive the question: does the
-- bookkeeping actually need it?
--
-- expected_total is what the booking said it would cost when it was made;
-- amount_charged is what was rung up. Both are returned so the two can be
-- compared — a row where they differ is where a mistake will be.
create or replace function admin_export_accounting(
  p_pin text, p_from date, p_to date
) returns table (
  booking_ref text,
  date date,
  start_time time,
  end_time time,
  duration_minutes int,
  staff_name text,
  service_name text,
  addons text,
  status booking_status,
  expected_total numeric,
  expected_is_estimate boolean,
  amount_charged numeric,
  difference numeric,
  booked_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_from is null or p_to is null then raise exception 'A date range is required'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;

  return query
  select b.booking_ref,
         b.date,
         b.start_time,
         b.end_time,
         (extract(epoch from (b.end_time - b.start_time)) / 60)::int,
         st.name,
         sv.name,
         coalesce((
           select string_agg(ba.name_at_booking, ' + ' order by ba.created_at)
           from booking_addons ba where ba.booking_id = b.id
         ), ''),
         b.status,
         b.expected_total,
         b.expected_total_is_estimate,
         b.amount_charged,
         -- Null rather than a misleading zero while the booking is unpaid:
         -- "not charged yet" and "charged exactly as expected" are different
         -- things and must not look the same in a spreadsheet.
         case when b.amount_charged is null then null
              else b.amount_charged - coalesce(b.expected_total, 0) end,
         b.created_at
  from bookings b
  join staff st on st.id = b.staff_id
  join services sv on sv.id = b.service_id
  where b.date between p_from and p_to
  order by b.date, b.start_time, st.name;
end; $$;
grant execute on function admin_export_accounting to anon;

-- ── DAILY RECONCILIATION ──
-- One number a day against the card terminal's own end-of-day total. Checking
-- per booking misses the errors that matter, because a mistyped amount looks
-- perfectly reasonable on its own row; a day total that is 200 kroner out
-- does not.
--
-- overridden_count is the number of bookings where what was charged differs
-- from what was expected. On a normal day that is zero or close to it, and
-- when the totals disagree it is the shortlist to look at.
create or replace function admin_daily_totals(
  p_pin text, p_from date, p_to date
) returns table (
  date date,
  bookings_completed int,
  expected_total numeric,
  charged_total numeric,
  difference numeric,
  overridden_count int
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
  select b.date,
         count(*)::int,
         sum(coalesce(b.expected_total, 0)),
         sum(coalesce(b.amount_charged, 0)),
         sum(coalesce(b.amount_charged, 0)) - sum(coalesce(b.expected_total, 0)),
         count(*) filter (
           where b.amount_charged is not null
             and b.amount_charged <> coalesce(b.expected_total, 0)
         )::int
  from bookings b
  where b.date between p_from and p_to
    and b.status = 'completed'
  group by b.date
  order by b.date;
end; $$;
grant execute on function admin_daily_totals to anon;

-- ── CLIENT EXPORT ──
-- Personal data. Logged every time.
create or replace function admin_export_clients(
  p_pin text, p_from date, p_to date
) returns table (
  booking_ref text,
  date date,
  start_time time,
  staff_name text,
  service_name text,
  customer_name text,
  customer_phone text,
  customer_email text,
  notes text,
  status booking_status,
  amount_charged numeric,
  booked_at timestamptz
) language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_from is null or p_to is null then raise exception 'A date range is required'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;

  select count(*) into v_count from bookings b where b.date between p_from and p_to;

  insert into activity_log (action, detail)
  values ('data_export',
          format('Client export: %s bookings, %s to %s', v_count, p_from, p_to));

  return query
  select b.booking_ref, b.date, b.start_time, st.name, sv.name,
         b.customer_name, b.customer_phone, b.customer_email, b.notes,
         b.status, b.amount_charged, b.created_at
  from bookings b
  join staff st on st.id = b.staff_id
  join services sv on sv.id = b.service_id
  where b.date between p_from and p_to
  order by b.date, b.start_time;
end; $$;
grant execute on function admin_export_clients to anon;

-- ── RETENTION ──
-- Norwegian bookkeeping law wants the sales record kept five years; GDPR
-- wants personal data gone once it is no longer needed. Both are satisfied by
-- keeping the booking and erasing the person: after five years the row still
-- says a Balayage was sold on that date for that amount, and no longer says
-- to whom.
--
-- Deliberately not a delete. Deleting the row would take the sale with it and
-- break the very books the five years exist to protect.
create or replace function purge_old_customer_data()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update bookings set
    customer_name = 'Slettet',
    customer_email = '',
    customer_phone = '',
    notes = null
  where date < (now() at time zone 'Europe/Oslo')::date - interval '5 years'
    and customer_name <> 'Slettet';
  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into activity_log (action, detail)
    values ('client_data_deleted', format('Retention purge: %s bookings anonymised', v_count));
  end if;
  return v_count;
end; $$;
-- Not granted to anon: this runs on a schedule, never from a browser.

-- A client asking to be forgotten, under GDPR Article 17. Same reasoning as
-- above — the sale stays, the person goes. Matched on email so every booking
-- they ever made is covered, not just the one they mentioned.
create or replace function admin_forget_client(p_pin text, p_email text)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'An email address is required'; end if;

  update bookings set
    customer_name = 'Slettet',
    customer_email = '',
    customer_phone = '',
    notes = null
  where lower(customer_email) = lower(trim(p_email))
    and customer_name <> 'Slettet';
  get diagnostics v_count = row_count;

  insert into activity_log (action, detail)
  values ('client_data_deleted', format('Erasure request: %s bookings anonymised', v_count));
  return v_count;
end; $$;
grant execute on function admin_forget_client to anon;
