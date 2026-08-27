-- ── MESSAGES: THE LEDGER AND THE REMINDER QUEUE ──
-- APPLIED 27-28 August 2026 to the studio-serena project.

create table sent_messages (
  id uuid primary key default gen_random_uuid(),

  -- What it was about. Exactly one of these is set for a booking message or an
  -- extensions message; both null is allowed for a waitlist blast that belongs
  -- to neither.
  booking_id uuid references bookings(id) on delete cascade,
  extension_order_id uuid references extension_orders(id) on delete cascade,

  -- Matches MessageKey in supabase/functions/_shared/messages.ts.
  message_key text not null,
  channel text not null check (channel in ('email', 'sms')),

  -- Where it went. Kept so a bounce can be traced to an address, and so a
  -- client asking "you never told me" can be answered.
  recipient text not null,
  lang text not null default 'no' check (lang in ('no', 'en')),

  -- The provider's message id (Resend or the SMS gateway), for chasing a
  -- delivery failure.
  provider_id text,
  -- Null while in flight, then 'sent' or a failure reason.
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text,

  -- What it cost, where the provider tells us. SMS only, in øre, so a month's
  -- spend can be totalled without guessing.
  cost_ore int,

  created_at timestamptz not null default now()
);

-- The guard. One booking gets one reminder, on one channel, ever — however
-- many times the job runs. Failures are excluded so a genuine retry is still
-- possible after something went wrong.
create unique index sent_messages_once
  on sent_messages (booking_id, message_key, channel)
  where booking_id is not null and status = 'sent';

create unique index sent_messages_once_extensions
  on sent_messages (extension_order_id, message_key, channel)
  where extension_order_id is not null and status = 'sent';

create index sent_messages_created_idx on sent_messages(created_at desc);

alter table sent_messages enable row level security;
-- No anon policy: written only by the SECURITY DEFINER functions below and
-- read only by the owner. It contains every client's email and phone.
create policy "admin manage sent_messages" on sent_messages for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── WHO NEEDS REMINDING TOMORROW ──
-- Deliberately a query, not a loop in a script: the rules about who to skip
-- belong next to the data, and this way they can be read and checked without
-- deploying anything.
--
-- Skipped, and why:
--   * booked within 24 hours of the appointment — she booked it this morning,
--     she does not need telling. This is the single biggest saving on the SMS
--     bill and costs nothing in no-shows.
--   * already reminded — the unique index would refuse the insert anyway, but
--     filtering here means the job does not waste a provider call to find out.
--   * cancelled, completed, or still pending — a pending request is not a
--     booking yet, and reminding someone about one would be a promise the
--     salon has not made.
create or replace function bookings_needing_reminder(p_channel text default 'sms')
returns table (
  booking_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  service_name text,
  staff_name text,
  date date,
  start_time time,
  booking_ref text
) language sql stable security definer set search_path = public as $$
  select b.id, b.customer_name, b.customer_email, b.customer_phone,
         sv.name, st.name, b.date, b.start_time, b.booking_ref
  from bookings b
  join services sv on sv.id = b.service_id
  join staff st on st.id = b.staff_id
  where b.date = (now() at time zone 'Europe/Oslo')::date + 1
    and b.status in ('confirmed', 'arrived')
    -- The appointment time is a naive date+time and has to be anchored to Oslo
    -- before it can be compared with created_at, which is timestamptz. Left to
    -- Postgres to coerce, it would use whatever the session timezone happens to
    -- be — UTC on Supabase — and the comparison would drift by an hour or two,
    -- silently skipping reminders for early bookings near the boundary.
    and ((b.date + b.start_time) at time zone 'Europe/Oslo') - b.created_at
        >= interval '24 hours'
    and not exists (
      select 1 from sent_messages m
      where m.booking_id = b.id
        and m.message_key = 'reminder'
        and m.channel = p_channel
        and m.status = 'sent'
    )
  order by b.start_time;
$$;
-- Not granted to anon: this is a scheduled job's query, not a browser's.

-- ── RECORDING A SEND ──
-- Returns false rather than raising when the message has already gone out, so
-- a job that races itself simply does nothing the second time instead of
-- falling over halfway through a batch and leaving the rest unsent.
create or replace function record_sent_message(
  p_booking_id uuid, p_extension_order_id uuid,
  p_message_key text, p_channel text, p_recipient text, p_lang text,
  p_provider_id text default null, p_status text default 'sent',
  p_error text default null, p_cost_ore int default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into sent_messages (
    booking_id, extension_order_id, message_key, channel, recipient, lang,
    provider_id, status, error, cost_ore
  ) values (
    p_booking_id, p_extension_order_id, p_message_key, p_channel, p_recipient,
    coalesce(p_lang, 'no'), p_provider_id, coalesce(p_status, 'sent'), p_error, p_cost_ore
  );
  return true;
exception when unique_violation then
  return false;
end; $$;

-- ── WHAT THE MESSAGES COST ──
-- So the SMS bill is a number the owner can see rather than a surprise on a
-- card statement.
create or replace function admin_message_costs(p_pin text, p_from date, p_to date)
returns table (
  month text,
  channel text,
  message_key text,
  sent int,
  failed int,
  cost_nok numeric
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
  select to_char(m.created_at at time zone 'Europe/Oslo', 'YYYY-MM'),
         m.channel,
         m.message_key,
         count(*) filter (where m.status = 'sent')::int,
         count(*) filter (where m.status = 'failed')::int,
         round(coalesce(sum(m.cost_ore) filter (where m.status = 'sent'), 0) / 100.0, 2)
  from sent_messages m
  where (m.created_at at time zone 'Europe/Oslo')::date between p_from and p_to
  group by 1, 2, 3
  order by 1 desc, 2, 3;
end; $$;
grant execute on function admin_message_costs to anon;

-- ── WHAT WAS SENT TO ONE CLIENT ──
-- For "you never told me". Answers it in one look.
create or replace function staff_booking_messages(p_pin text, p_booking_id uuid)
returns table (
  message_key text, channel text, recipient text,
  status text, error text, created_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query
  select m.message_key, m.channel, m.recipient, m.status, m.error, m.created_at
  from sent_messages m
  where m.booking_id = p_booking_id
  order by m.created_at;
end; $$;
grant execute on function staff_booking_messages to anon;
