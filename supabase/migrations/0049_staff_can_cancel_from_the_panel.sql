-- ── THE PANEL COULD NOT CANCEL AN APPOINTMENT ──
--
-- Every other thing you can do to a booking is on the popup - move it, look
-- up the client's history - but not the one a salon does most often. The
-- only cancel that existed was cancel_my_booking, which demands the client's
-- own email AND phone as proof of identity. That is right for a client
-- cancelling her own appointment on the website and useless to the person
-- standing at the desk with her on the phone. So a cancellation meant
-- editing the database by hand, or leaving a dead appointment on the
-- calendar holding a slot that could have been sold.
--
-- Everything this needs already exists and is reused rather than rebuilt:
-- get_cancellation_policy for the 48 hours and the 50%, the Oslo-anchored
-- hours calculation from cancellation_quote, the late_cancellation and
-- cancellation_fee columns, and tg_booking_enqueue_on_update, which already
-- knows how to tell a client her appointment was cancelled and how to pull
-- the day-before reminder out of the queue so it cannot go out afterwards.

-- ── WHAT IT WOULD COST, ASKED BEFORE ANYTHING HAPPENS ──
--
-- The panel shows this in the confirm dialog, so the fee is on screen before
-- the button that charges it - the same rule 0009 set for the client-facing
-- wizard, that a policy shown only after the fact is an ambush.
--
-- Returns notice_hours as well as the verdict so the dialog can say "policy
-- is 48 hours" in the salon's own words without hardcoding a number that
-- app_settings is allowed to change.
create or replace function staff_cancellation_quote(p_pin text, p_booking_id uuid)
returns table (
  is_late boolean,
  hours_notice numeric,
  fee numeric,
  fee_is_estimate boolean,
  notice_hours int,
  already_closed boolean
) language plpgsql security definer set search_path = public as $$
declare v_b bookings; v_notice int; v_pct int; v_hours numeric;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;

  select * into v_b from bookings where id = p_booking_id;
  if v_b.id is null then raise exception 'Booking not found'; end if;

  select gcp.notice_hours, gcp.fee_percent into v_notice, v_pct
    from get_cancellation_policy() gcp;

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
    coalesce(v_b.expected_total_is_estimate, false),
    v_notice,
    v_b.status in ('cancelled', 'completed');
end; $$;
grant execute on function staff_cancellation_quote to anon;

-- ── THE CANCELLATION ──
--
-- p_waive_fee records the fee AND marks it waived, rather than writing no
-- fee at all. What was given up is worth keeping: admin_late_cancellations
-- reads both columns and is the report that answers "who cancels late, and
-- what has it cost us" - and a waived fee written as a null fee is
-- indistinguishable there from a cancellation that was never late. The
-- salon's generosity should be visible to the salon.
--
-- p_notify rides the same transaction-local GUC 0046 introduced for manual
-- bookings, for the same reason: a client who has just been told on the
-- phone does not need a text a minute later saying the same thing.
--
-- p_cancelled_by_staff decides WHICH message goes out - the update trigger
-- picks 'cancelled_by_salon' or 'cancelled_by_client' from the column it
-- writes - and is recorded on the booking either way. Defaulted true because
-- a cancellation entered here is usually the salon's own. See the note at
-- the foot of this file.
create or replace function staff_cancel_booking(
  p_pin text, p_booking_id uuid,
  p_waive_fee boolean default false,
  p_notify boolean default true,
  p_cancelled_by_staff boolean default true
) returns bookings language plpgsql security definer set search_path = public as $$
declare
  v_booking bookings; v_notice int; v_pct int; v_hours numeric;
  v_late boolean; v_fee numeric;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;

  select * into v_booking from bookings
   where id = p_booking_id
     and status not in ('cancelled', 'completed');
  if v_booking.id is null then
    raise exception 'That appointment is already cancelled or completed';
  end if;

  select gcp.notice_hours, gcp.fee_percent into v_notice, v_pct
    from get_cancellation_policy() gcp;

  v_hours := extract(epoch from (
    ((v_booking.date + v_booking.start_time) at time zone 'Europe/Oslo') - now()
  )) / 3600.0;
  v_late := v_hours < v_notice;
  v_fee := case
    when not v_late then null
    when v_booking.expected_total is null then null
    else round(v_booking.expected_total * v_pct / 100.0, 0)
  end;

  perform set_config('app.booking_notify', coalesce(p_notify, true)::text, true);

  update bookings set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by_staff = coalesce(p_cancelled_by_staff, true),
    late_cancellation = v_late,
    cancellation_fee = v_fee,
    -- Only meaningful when there is a fee. Waiving nothing is not a waiver,
    -- and recording it as one would put cancellations in the waived column
    -- of the report that never cost anything to begin with.
    cancellation_fee_waived = (v_fee is not null and coalesce(p_waive_fee, false))
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end; $$;
grant execute on function staff_cancel_booking to anon;

-- ── THE NOTIFY TOGGLE HAD TO REACH THE UPDATE TRIGGER ──
--
-- 0046 taught tg_booking_enqueue_on_INSERT to respect app.booking_notify,
-- but cancellations are an UPDATE and that trigger never learned it, so
-- unticking the box would have cancelled the appointment and texted her
-- anyway.
--
-- Guarded on the cancellation branch ALONE, not around the whole function.
-- The approval, rejection and reschedule branches have no toggle in front of
-- them anywhere in the panel, so wrapping the lot would hand them a
-- behaviour nobody asked for and nothing sets - and the day something did
-- set the GUC for an unrelated reason, a reschedule would silently stop
-- telling the client her appointment had moved. The reminder is still pulled
-- from the queue either way: whether she is told is a choice, but a reminder
-- for an appointment that no longer exists is simply wrong.
create or replace function tg_booking_enqueue_on_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_reminder_at timestamptz;
begin
  if old.status = 'pending' and new.status = 'confirmed' then
    perform enqueue_message(new.id, 'request_approved');
    v_reminder_at := ((new.date - 1) + time '10:00') at time zone 'Europe/Oslo';
    perform enqueue_message(new.id, 'reminder', greatest(v_reminder_at, now()));
  end if;

  if old.rejected_at is null and new.rejected_at is not null then
    perform enqueue_message(new.id, 'request_rejected');
    update message_outbox set status = 'cancelled'
      where booking_id = new.id and status = 'pending' and message_key = 'reminder';
  end if;

  if old.status <> 'cancelled' and new.status = 'cancelled' and new.rejected_at is null then
    if coalesce(current_setting('app.booking_notify', true), 'true') <> 'false' then
      perform enqueue_message(new.id,
        case when new.cancelled_by_staff then 'cancelled_by_salon' else 'cancelled_by_client' end);
    end if;
    update message_outbox set status = 'cancelled'
      where booking_id = new.id and status = 'pending' and message_key = 'reminder';
  end if;

  if (old.date <> new.date or old.start_time <> new.start_time)
     and new.status not in ('cancelled') then
    perform enqueue_message(new.id, 'rescheduled');
    delete from message_outbox
      where booking_id = new.id and message_key = 'reminder' and status = 'pending';
    v_reminder_at := ((new.date - 1) + time '10:00') at time zone 'Europe/Oslo';
    perform enqueue_message(new.id, 'reminder', greatest(v_reminder_at, now()));
  end if;

  return new;
end; $$;

-- ── WHY p_cancelled_by_staff IS A PARAMETER ──
--
-- Because the salon cancelling and the client cancelling are different
-- things to be told, and the update trigger picks the message from this
-- column. Hardcoding it true would have sent a client who rang up to cancel
-- a message saying the salon called her appointment off - the sort of wrong
-- message that costs a client rather than merely confusing one.
--
-- The panel asks outright, in a dropdown next to the notify tick, defaulted
-- to "We cancelled" so an untouched dialog does the common thing. It is
-- deliberately separate from the fee decision above it: who cancelled and
-- whether to charge are different questions, and a screen that answers one
-- by way of the other gets both wrong eventually.
