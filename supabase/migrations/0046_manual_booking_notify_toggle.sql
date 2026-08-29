-- ── LET THE STYLIST SKIP THE CONFIRMATION TEXT ──
--
-- Every booking path enqueues an SMS/email through the same AFTER INSERT
-- trigger, which was right for the client-facing wizard but wrong for a
-- walk-in or phone booking written up after the fact: she was already told
-- in person, so a "your appointment is confirmed" text a minute later reads
-- as a mistake, not a courtesy. Adds an explicit choice at the point the
-- stylist enters it, rather than assuming.
--
-- Implemented as a transaction-local GUC (set_config with is_local = true)
-- rather than a new column on bookings: it only needs to exist for the
-- instant between the insert and the trigger reading it in the same
-- transaction, and resets itself the moment that transaction ends.
--
-- CREATE OR REPLACE with a new parameter list creates a new overload rather
-- than replacing the old one - hit again on the first attempt at this exact
-- migration (grant execute failed with "not unique" and rolled the whole
-- transaction back, cleanly, before anything landed). The old 13-arg
-- signature is dropped explicitly this time so only one survives.
drop function if exists staff_book_appointment(
  text, uuid, uuid, date, time, text, text, text, text, uuid[], text, text, text
);

create or replace function tg_booking_enqueue_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_reminder_at timestamptz;
begin
  if coalesce(current_setting('app.booking_notify', true), 'true') = 'false' then
    return new;
  end if;

  perform enqueue_message(
    new.id,
    case when new.status = 'pending' then 'request_received' else 'booking_confirmed' end);

  v_reminder_at := ((new.date - 1) + time '10:00') at time zone 'Europe/Oslo';
  if new.status <> 'pending' then
    perform enqueue_message(new.id, 'reminder', greatest(v_reminder_at, now()));
  end if;

  return new;
end; $$;

create function staff_book_appointment(
  p_pin text, p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null,
  p_first_name text default null, p_last_name text default null, p_instagram text default null,
  p_notify boolean default true
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_manual_overlap boolean; v_booking bookings; v_full text;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  select coalesce(allow_manual_overlap, false) into v_manual_overlap
    from staff where id = p_staff_id;

  v_full := case
    when coalesce(trim(p_first_name), '') <> '' or coalesce(trim(p_last_name), '') <> ''
      then trim(coalesce(trim(p_first_name), '') || ' ' || coalesce(trim(p_last_name), ''))
    else trim(coalesce(p_customer_name, '')) end;
  if v_full = '' then raise exception 'A name is required'; end if;

  perform set_config('app.booking_notify', p_notify::text, true);

  v_booking := book_appointment_core(
    p_service_id, p_staff_id, p_date, p_start_time,
    v_full, p_customer_email, p_customer_phone,
    p_notes, p_addon_ids, coalesce(v_manual_overlap, false), false);

  update bookings set
    customer_first_name = nullif(trim(coalesce(p_first_name, '')), ''),
    customer_last_name  = nullif(trim(coalesce(p_last_name, '')), ''),
    customer_instagram  = instagram_handle(p_instagram)
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end; $$;
grant execute on function staff_book_appointment to anon;

-- Verified against the live database before trusting this file: a manual
-- booking with p_notify=false produced zero message_outbox rows; the same
-- call with p_notify=true produced the usual booking_confirmed + reminder
-- pair. Test rows deleted after.
