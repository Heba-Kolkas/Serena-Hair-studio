-- ── CANCELLATION POLICY ──
-- NOT YET APPLIED — run after 0001-0008.
--
-- Cancel more than 48 hours ahead and it costs nothing. Inside 48 hours, half
-- the price is owed.
--
-- THE DESIGN DECISION WORTH ARGUING WITH
-- The obvious implementation is to refuse a late cancellation online — "too
-- late, ring the salon". Do that and a good number of people simply do not
-- ring. They say nothing and do not turn up, and the salon loses the whole
-- slot with no warning instead of half of it with two days' notice.
--
-- So a late cancellation is always allowed to go through. What changes is that
-- it is recorded, priced, and the client is told the fee before she confirms.
-- The salon ends up knowing about the empty slot in time to sell it, which is
-- worth more than the fee itself.
--
-- HOW THE FEE IS ACTUALLY COLLECTED
-- Not by invoice. An invoice sent to a consumer after a no-show gets paid by
-- some people and ignored by others, and chasing 1 875 kroner costs about what
-- the debt is worth while turning a client into an enemy.
--
-- Instead the fee becomes an outstanding balance on the client, and the next
-- time she is in the chair it goes on the bill. The salon already has a card
-- terminal and she already comes back — so collection uses the one piece of
-- leverage that still exists after she has gone home, which is her next visit.
-- No payment provider, nothing to integrate, nothing to wait for.
--
-- The salon can waive it in one click. Most of the time it should: the point of
-- the policy is that people stop cancelling late, not that the salon collects
-- fees.

alter table bookings add column cancelled_at timestamptz;
-- Whether it fell inside the notice period. Stored rather than recalculated:
-- the policy may change, and a booking cancelled under the old rules must keep
-- being judged by them.
alter table bookings add column late_cancellation boolean not null default false;
-- Half the expected total, at the moment of cancelling. Null when the price was
-- never a real number — a consultation quote has no half.
alter table bookings add column cancellation_fee numeric(10,2);
-- Set when the salon decides not to pursue it.
alter table bookings add column cancellation_fee_waived boolean not null default false;
-- Set when it has actually been paid — normally added to a later visit's bill.
alter table bookings add column cancellation_fee_settled boolean not null default false;
alter table bookings add column cancellation_fee_settled_at timestamptz;

insert into app_settings (key, value) values ('cancellation_notice_hours', '48')
  on conflict (key) do nothing;
insert into app_settings (key, value) values ('cancellation_fee_percent', '50')
  on conflict (key) do nothing;

create or replace function get_cancellation_policy()
returns table (notice_hours int, fee_percent int)
language sql stable security definer set search_path = public as $$
  select coalesce((select value::int from app_settings where key = 'cancellation_notice_hours'), 48),
         coalesce((select value::int from app_settings where key = 'cancellation_fee_percent'), 50);
$$;
grant execute on function get_cancellation_policy to anon;

-- What cancelling this booking would cost, asked BEFORE she confirms. The
-- wizard shows this on the cancel button, so nobody is charged a fee they were
-- not warned about — which is the difference between a policy and an ambush.
create or replace function cancellation_quote(p_booking_id uuid, p_email text, p_phone text)
returns table (
  is_late boolean,
  hours_notice numeric,
  fee numeric,
  fee_is_estimate boolean
) language plpgsql security definer set search_path = public as $$
declare
  v_b bookings; v_notice int; v_pct int; v_hours numeric;
begin
  select * into v_b from bookings
  where id = p_booking_id
    and lower(customer_email) = lower(coalesce(p_email, ''))
    and customer_phone = coalesce(p_phone, '');
  if v_b.id is null then raise exception 'Booking not found'; end if;

  select notice_hours, fee_percent into v_notice, v_pct from get_cancellation_policy();

  -- Anchored to Oslo: the appointment is a naive date and time, and comparing
  -- it against now() without saying which clock it belongs to would drift by
  -- an hour or two and misjudge bookings near the boundary.
  v_hours := extract(epoch from (
    ((v_b.date + v_b.start_time) at time zone 'Europe/Oslo') - now()
  )) / 3600.0;

  return query select
    v_hours < v_notice,
    round(v_hours, 1),
    case
      when v_hours >= v_notice then 0::numeric
      when v_b.expected_total is null then null
      else round(v_b.expected_total * v_pct / 100.0, 0)
    end,
    -- A "from" price has no exact half. The salon settles the figure.
    coalesce(v_b.expected_total_is_estimate, false);
end; $$;
grant execute on function cancellation_quote to anon;

-- Replaces the version in 0001. Same signature, so nothing calling it changes.
create or replace function cancel_my_booking(p_booking_id uuid, p_email text, p_phone text)
returns bookings language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings; v_notice int; v_pct int; v_hours numeric; v_late boolean; v_fee numeric;
begin
  select * into v_booking from bookings
  where id = p_booking_id
    and lower(customer_email) = lower(coalesce(p_email, ''))
    and customer_phone = coalesce(p_phone, '')
    and status not in ('cancelled', 'completed');
  if v_booking.id is null then
    raise exception 'Booking not found or already cancelled';
  end if;

  select notice_hours, fee_percent into v_notice, v_pct from get_cancellation_policy();
  v_hours := extract(epoch from (
    ((v_booking.date + v_booking.start_time) at time zone 'Europe/Oslo') - now()
  )) / 3600.0;
  v_late := v_hours < v_notice;
  v_fee := case
    when not v_late then null
    when v_booking.expected_total is null then null
    else round(v_booking.expected_total * v_pct / 100.0, 0)
  end;

  update bookings set
    status = 'cancelled',
    cancelled_at = now(),
    late_cancellation = v_late,
    cancellation_fee = v_fee
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end; $$;
grant execute on function cancel_my_booking to anon;

-- ── WHAT LATE CANCELLATIONS ARE COSTING ──
-- Two things the salon cannot see today: who cancels late repeatedly, and how
-- much of the year that costs. Both are decisions about whether to keep taking
-- someone's bookings without a deposit.
create or replace function admin_late_cancellations(p_pin text, p_from date, p_to date)
returns table (
  booking_ref text,
  date date,
  start_time time,
  customer_name text,
  customer_phone text,
  service_name text,
  staff_name text,
  hours_notice numeric,
  fee numeric,
  waived boolean,
  times_cancelled_late int
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
  select b.booking_ref, b.date, b.start_time,
         b.customer_name, b.customer_phone, sv.name, st.name,
         round(extract(epoch from (
           ((b.date + b.start_time) at time zone 'Europe/Oslo') - b.cancelled_at
         )) / 3600.0, 1),
         b.cancellation_fee,
         b.cancellation_fee_waived,
         -- How often this client has done it, ever. One late cancellation is
         -- life; five is a pattern, and the answer to a pattern is a deposit.
         (select count(*) from bookings b2
          where b2.customer_phone = b.customer_phone
            and b2.late_cancellation)::int
  from bookings b
  join services sv on sv.id = b.service_id
  join staff st on st.id = b.staff_id
  where b.late_cancellation
    and b.date between p_from and p_to
  order by b.date desc, b.start_time desc;
end; $$;
grant execute on function admin_late_cancellations to anon;

create or replace function admin_waive_cancellation_fee(p_pin text, p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  update bookings set cancellation_fee_waived = true where id = p_booking_id;
end; $$;
grant execute on function admin_waive_cancellation_fee to anon;

-- NOTE: an earlier version collected the fee at the client's next visit, by
-- putting it on that visit's bill. The owner rejected it, and rightly: it only
-- works on a client who comes back, which is exactly the client least likely
-- to have skipped in the first place. The fee is still recorded and reported;
-- it is simply not pretended to be collectable by the till.

-- ── REPEAT OFFENDERS ──
-- The leverage that still works when money does not: access to the calendar.
-- This does not block anybody by itself — it reports, and the owner decides.
-- A client who has done it three times is one to ask for a deposit from, or to
-- ask to book by phone rather than online.
create or replace function admin_repeat_late_cancellers(p_pin text, p_min int default 2)
returns table (
  customer_name text,
  customer_phone text,
  late_cancellations int,
  no_shows int,
  unpaid_fees numeric,
  last_offence date
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
  select max(b.customer_name),
         b.customer_phone,
         -- Not-a-no-show, so the same booking never lands in both columns:
         -- the fee trigger sets late_cancellation on a no-show too.
         count(*) filter (where b.late_cancellation and b.status <> 'no_show')::int,
         count(*) filter (where b.status = 'no_show')::int,
         coalesce(sum(b.cancellation_fee) filter (
           where not b.cancellation_fee_waived and not b.cancellation_fee_settled
         ), 0),
         max(b.date)
  from bookings b
  where b.late_cancellation or b.status = 'no_show'
  group by b.customer_phone
  having count(*) >= p_min
  order by count(*) desc, max(b.date) desc;
end; $$;
grant execute on function admin_repeat_late_cancellers to anon;

-- ══════════════════════════════════════════════════════════════════
--  AGREEING TO THE POLICY
-- ══════════════════════════════════════════════════════════════════
-- A cancellation fee is only worth anything if she was shown it and actively
-- agreed before booking. Three things make that stand up, and all three matter:
--
--   1. Shown BEFORE the booking, not in a footer or a linked page.
--   2. Actively ticked. Never pre-ticked — a pre-ticked box is not agreement,
--      and in a dispute it is worth nothing.
--   3. Recorded: which wording, and when. "Our terms say so" is weak; "she
--      accepted version 1, on 26 August at 14:02, and here is exactly what it
--      said" is not.
--
-- Hence a VERSION rather than just a timestamp. If the policy is ever reworded,
-- a booking made under the old wording is still judged by the old wording, and
-- the text of it is still here to produce.

alter table bookings add column terms_version int;
alter table bookings add column terms_accepted_at timestamptz;

create table booking_terms (
  version int primary key,
  text_no text not null,
  text_en text not null,
  effective_from timestamptz not null default now()
);

insert into booking_terms (version, text_no, text_en) values (
  1,
  'Avbestilling må skje senest 48 timer før timen. Avbestiller du senere enn '
  || 'dette, eller ikke møter opp, faktureres halve prisen for behandlingen.',
  'Cancellations must be made at least 48 hours before your appointment. If you '
  || 'cancel later than that, or do not turn up, half the price of the service is charged.'
) on conflict (version) do nothing;

alter table booking_terms enable row level security;
create policy "public read booking_terms" on booking_terms for select using (true);
create policy "admin manage booking_terms" on booking_terms for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- The wizard reads this to render the tick-box, so the words she agrees to and
-- the words stored against her booking are the same words, always.
create or replace function get_current_booking_terms()
returns table (version int, text_no text, text_en text)
language sql stable security definer set search_path = public as $$
  select bt.version, bt.text_no, bt.text_en
  from booking_terms bt
  where bt.effective_from <= now()
  order by bt.version desc
  limit 1;
$$;
grant execute on function get_current_booking_terms to anon;

-- What she agreed to, in her own words, for a specific booking. This is the
-- thing to produce if she ever says she was never told.
create or replace function staff_booking_terms(p_pin text, p_booking_id uuid)
returns table (version int, accepted_at timestamptz, text_no text, text_en text)
language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query
  select b.terms_version, b.terms_accepted_at, bt.text_no, bt.text_en
  from bookings b
  left join booking_terms bt on bt.version = b.terms_version
  where b.id = p_booking_id;
end; $$;
grant execute on function staff_booking_terms to anon;

-- ── THE TICK-BOX HAS TO BITE ──
-- Replaces the public wrapper from 0005 with one that takes the accepted terms
-- version and refuses without it.
--
-- Enforced here rather than only in the wizard because the RPC is reachable
-- with the public key. A booking made by a crafted call, with no acceptance
-- recorded, would be exactly the booking a client later disputes — and the
-- salon would have nothing to show. So the database will not create one.
--
-- Dropped rather than replaced: the argument list changes, and leaving the old
-- 9-argument version in place would let a caller pick it and skip the check.
drop function if exists book_appointment(uuid, uuid, date, time, text, text, text, text, uuid[]);

create or replace function book_appointment(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null,
  p_terms_version int default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_current int; v_booking bookings;
begin
  select version into v_current from get_current_booking_terms();

  if p_terms_version is null then
    raise exception 'Please accept the cancellation policy before booking';
  end if;
  -- Must be the wording currently on offer. An old version means the page was
  -- open while the policy changed, and she agreed to something the salon no
  -- longer offers — better to ask again than to record a stale agreement.
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

-- ══════════════════════════════════════════════════════════════════
--  NOT TURNING UP
-- ══════════════════════════════════════════════════════════════════
-- The policy she agreed to says "if you cancel later than that, OR DO NOT TURN
-- UP, half the price is charged". Late cancellation was priced above; not
-- turning up was not, which had it exactly backwards — the client who warns
-- you is charged and the client who says nothing is not.
--
-- A trigger rather than a line in each RPC. Three different functions can set
-- a booking to no_show (the schedule tool, the Owner Panel, and any future
-- one), and a rule that has to be remembered in three places is a rule that
-- will be missed in one. This catches every path into the status, including
-- ones not written yet.
--
-- late_cancellation is reused as the flag for "the policy applied", so a
-- no-show shows up in the same reports and the same unpaid balance as a late
-- cancellation. They are the same charge for the same reason.
create or replace function apply_no_show_fee()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pct int;
begin
  if new.status = 'no_show' and coalesce(old.status, '') <> 'no_show'
     and not new.late_cancellation then
    select fee_percent into v_pct from get_cancellation_policy();
    new.late_cancellation := true;
    new.cancelled_at := coalesce(new.cancelled_at, now());
    -- Null when the price was never a real figure — a consultation quote has
    -- no half, and inventing one would put a number on a bill that nobody can
    -- justify.
    new.cancellation_fee := case
      when new.expected_total is null then null
      else round(new.expected_total * v_pct / 100.0, 0)
    end;
  end if;
  return new;
end; $$;

drop trigger if exists bookings_no_show_fee on bookings;
create trigger bookings_no_show_fee
  before update on bookings
  for each row execute function apply_no_show_fee();
