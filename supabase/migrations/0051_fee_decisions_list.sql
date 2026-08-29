-- ── NOBODY IS CHARGED UNTIL SOMEONE DECIDES TO CHARGE THEM ──
--
-- The fee was already manual, but only by omission: staff_cancel_booking
-- records late_cancellation and cancellation_fee and stops there, and the
-- whole invoice system from 0012 - the table, create, send, mark paid,
-- waive - has never been connected to the panel. So a late cancellation
-- produced a number in a column that nobody ever saw and nothing ever acted
-- on. The money was neither charged nor forgiven; it was just lost.
--
-- This is the missing half: the list of people the salon COULD invoice, so
-- someone can look at each one and decide. Deliberately a decision and not a
-- default, because the salon does not want to charge everyone - a regular
-- whose child was ill and a stranger who has done it three times are the
-- same row in the database and completely different situations, and only a
-- person knows which is which.
--
-- No-shows share the list. They are the same decision, they already write
-- the same columns through apply_no_show_fee, and 0012's staff_create_invoice
-- already accepts both reasons. The prompt when marking a no-show stays as it
-- is; anything skipped there falls into this list rather than vanishing,
-- which is the fault this fixes rather than a second way to make it.
create or replace function staff_fee_decisions(
  p_pin text, p_view text default 'pending'
) returns table (
  booking_id uuid,
  customer_name text, customer_phone text, customer_email text, sms_consent boolean,
  service_name text, staff_name text,
  appointment_date date, start_time time,
  reason text,
  -- How much warning she gave. Null for a no-show, where the honest answer is
  -- "none" rather than a number, and where showing 0.0 would read as a
  -- measurement rather than an absence.
  hours_notice numeric,
  cancellation_fee numeric,
  fee_is_estimate boolean,
  expected_total numeric,
  fee_waived boolean,
  invoice_id uuid, invoice_status text, invoice_amount numeric, invoice_sent_at timestamptz,
  cancelled_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  -- Staff, not owner. Sending the invoice the policy already provides for is
  -- ordinary work, and 0012 set that level for staff_create_invoice. Forgiving
  -- the money is the owner's call and stays on the owner-only
  -- admin_waive_cancellation_fee - the panel hides that button accordingly.
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;

  return query
  select
    b.id,
    b.customer_name, b.customer_phone, b.customer_email, coalesce(b.sms_consent, false),
    sv.name, st.name,
    b.date, b.start_time,
    case when b.status = 'no_show' then 'no_show' else 'late_cancellation' end,
    case when b.status = 'no_show' or b.cancelled_at is null then null
         else round(extract(epoch from (
                ((b.date + b.start_time) at time zone 'Europe/Oslo') - b.cancelled_at
              )) / 3600.0, 1)
    end,
    b.cancellation_fee,
    coalesce(b.expected_total_is_estimate, false),
    b.expected_total,
    coalesce(b.cancellation_fee_waived, false),
    i.id, i.status, i.amount, i.sent_at,
    b.cancelled_at
  from bookings b
  join services sv on sv.id = b.service_id
  join staff st on st.id = b.staff_id
  -- Only an invoice that still stands. One that was cancelled or waived
  -- leaves the booking needing a decision again rather than looking settled.
  left join invoices i on i.booking_id = b.id and i.status in ('unpaid', 'paid')
  where (b.late_cancellation or b.status = 'no_show')
    and case
          when p_view = 'history' then (coalesce(b.cancellation_fee_waived, false) or i.id is not null)
          else (not coalesce(b.cancellation_fee_waived, false) and i.id is null)
        end
  -- Most recent appointment first: the decision is freshest, the client is
  -- still reachable about it, and an old one nobody acted on has effectively
  -- been decided by the silence.
  order by b.date desc, b.start_time desc;
end; $$;
grant execute on function staff_fee_decisions to anon;

-- ── HOW MANY ARE WAITING ──
-- For the badge on the menu button, so the list is seen without being looked
-- for. Its own function rather than counting the list client-side: the badge
-- is drawn on every panel load and pulling every row with names and phone
-- numbers attached, to render a number, is more personal data over the wire
-- than the number is worth.
create or replace function staff_fee_decisions_count(p_pin text)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  select count(*)::int into v_n
  from bookings b
  left join invoices i on i.booking_id = b.id and i.status in ('unpaid', 'paid')
  where (b.late_cancellation or b.status = 'no_show')
    and not coalesce(b.cancellation_fee_waived, false)
    and i.id is null;
  return coalesce(v_n, 0);
end; $$;
grant execute on function staff_fee_decisions_count to anon;

-- ── CREATE AND SEND IN ONE PRESS ──
--
-- 0012 splits creating an invoice from marking it sent, which is right when
-- the two really are separate acts. Here they are not: the panel creates the
-- record and emails it in the same press, and a stamp that says "sent" while
-- nothing was sent would be worse than no stamp at all.
--
-- So the marking is NOT done here. The panel calls this, sends the mail, and
-- only then calls staff_mark_invoice_sent - which means a failed send leaves
-- a real invoice with sent_at still null, and the row goes on saying it needs
-- sending. That is the honest state, and it is recoverable: the invoice
-- exists, the amount is fixed, and pressing again resends rather than
-- creating a second one.
--
-- Wraps 0012's two creators so the panel does not have to choose between
-- them. A booking with a fixed price has its half worked out already; a
-- "from" price has no exact half until somebody names one, and passing that
-- amount is the only difference.
create or replace function staff_invoice_for_fee(
  p_pin text, p_booking_id uuid, p_amount numeric default null
) returns invoices language plpgsql security definer set search_path = public as $$
declare v_existing invoices; v_inv invoices;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;

  -- Pressing send twice must not bill her twice. Returns the invoice that is
  -- already there so the caller can go on and send it again, which is the
  -- thing someone pressing a second time is actually trying to do.
  select * into v_existing from invoices
   where booking_id = p_booking_id and status in ('unpaid', 'paid')
   order by created_at desc limit 1;
  if v_existing.id is not null then return v_existing; end if;

  if p_amount is not null then
    v_inv := staff_create_invoice_manual(p_pin, p_booking_id, p_amount);
  else
    v_inv := staff_create_invoice(p_pin, p_booking_id);
  end if;
  return v_inv;
end; $$;
grant execute on function staff_invoice_for_fee to anon;
