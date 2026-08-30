-- ── THE WAITLIST CONFIRMATION HAD NEVER BEEN SENT ──
-- APPLIED 30 August 2026 to the studio-serena project.
--
-- join_waitlist wrote the row and returned the token, and that was all it had
-- ever done. Nothing enqueued waitlist_joined, so a client put her name down
-- and heard nothing back: no confirmation it had worked, no note of what she
-- had asked for, and no way off the list.
--
-- enqueue_message could not have done it even if something had called it. It
-- begins by loading a booking and returns early when there is none, and the
-- entire point of a waiting list is that there is no booking yet. Hence a
-- second, small enqueuer that builds its context from the waitlist entry.
create or replace function enqueue_waitlist_message(p_entry_id uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare v_e waitlist_entries; v_service text; v_staff text; v_window text;
begin
  select * into v_e from waitlist_entries where id = p_entry_id;
  if v_e.id is null then return; end if;

  select name into v_service from services where id = v_e.service_id;
  select name into v_staff   from staff    where id = v_e.staff_id;

  v_window := case
    when v_e.latest_date is null
      then to_char(v_e.earliest_date, 'DD.MM.YYYY')
    else to_char(v_e.earliest_date, 'DD.MM') || ' - ' || to_char(v_e.latest_date, 'DD.MM.YYYY')
  end;

  insert into message_outbox (booking_id, message_key, lang, email, phone, sms_consent,
                              context, send_after, status)
  values (
    null, p_key, v_e.lang,
    nullif(trim(coalesce(v_e.customer_email, '')), ''),
    nullif(trim(coalesce(v_e.customer_phone, '')), ''),
    coalesce(v_e.consent_sms, false),
    jsonb_build_object(
      'customerName',    coalesce(split_part(v_e.customer_name, ' ', 1), v_e.customer_name),
      'serviceName',     coalesce(v_service, ''),
      'staffName',       coalesce(v_staff, ''),
      -- The templates read date and startTime even where they do not show
      -- them; giving them the window start keeps every helper safe rather
      -- than having each guard against a missing date.
      'date',            to_char(v_e.earliest_date, 'YYYY-MM-DD'),
      'startTime',       '12:00',
      'waitlistWindow',  v_window,
      'bookUrl',         get_site_url() || '/book.html',
      -- The whole reason this exists: one click off the list, rather than
      -- "reply to this email" and somebody doing it by hand.
      'leaveUrl',        get_site_url() || '/waitlist-leave.html?t=' || v_e.unsubscribe_token
    ),
    now(),
    case when coalesce(v_e.customer_email, '') = '' and coalesce(v_e.customer_phone, '') = ''
         then 'cancelled' else 'pending' end
  )
  on conflict do nothing;
end; $$;

-- Same body as before, with the one line that tells her it worked.
create or replace function join_waitlist(
  p_name text, p_phone text, p_email text, p_service_id uuid, p_staff_id uuid,
  p_earliest date, p_latest date, p_consent_text text, p_consent_sms boolean,
  p_lang text default 'no', p_notes text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_token text; v_id uuid;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Please tell us your name'; end if;
  if coalesce(trim(p_phone), '') = '' then raise exception 'Please give us a phone number'; end if;
  if coalesce(trim(p_consent_text), '') = '' then
    raise exception 'Consent wording is required';
  end if;
  if not exists (select 1 from services where id = p_service_id and active) then
    raise exception 'Unknown service';
  end if;

  update waitlist_entries set active = false, removed_at = now(),
         removed_reason = 'replaced by a newer request'
  where phone_key(customer_phone) = phone_key(p_phone) and service_id = p_service_id and active;

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
  ) returning id, unsubscribe_token into v_id, v_token;

  perform enqueue_waitlist_message(v_id, 'waitlist_joined');

  return v_token;
end; $$;
grant execute on function join_waitlist to anon;

-- ── VERIFIED END TO END AFTER APPLYING ──
--   join_waitlist            -> token returned, row written
--   drain                    -> {"claimed":1,"sent":1,"failed":0}
--   leave_waitlist(token)    -> 204, row active=false, reason 'unsubscribed'
