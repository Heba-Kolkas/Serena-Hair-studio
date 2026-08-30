-- ── NOTHING WAS EMPTYING THE OUTBOX ──
-- APPLIED 30 August 2026 to the studio-serena project.
--
-- Messages the salon sends on a button press - the no-show notice, an
-- invoice, "your extensions arrived" - call send-message directly and were
-- always going to work. The automatic ones cannot: a database trigger has no
-- way to send an email, so booking confirmations, day-before reminders,
-- cancellations and reschedules are written into message_outbox instead and
-- something has to come along and empty it.
--
-- Nothing ever did. Thirteen messages had been sitting in the queue since
-- 28 August, every one with last_error null - not tried and failed, never
-- attempted. They were all addressed to the owner@warehouse.com test address,
-- so no real client was owed anything, and they were cancelled rather than
-- released in a burst.
--
-- send-message has had a 'drain' action all along, guarded by an x-outbox-key
-- header. It had no secret to check against and nothing scheduled to call it.
-- This is both halves.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── SECRETS GO IN THE VAULT, NOT IN THE CRON COMMAND ──
--
-- cron.job is an ordinary table readable by anyone who can read the catalog,
-- so a drain key pasted into its command sits there in plain sight for the
-- life of the project. The vault keeps it encrypted and the function below
-- reads it at call time.
--
-- THE VALUES BELOW ARE PLACEHOLDERS. This repository is public. The real
-- secrets were passed directly when this ran and are deliberately not written
-- here. To rebuild this from scratch:
--
--   outbox_anon_key  - the project's anon JWT (already public; it is in
--                      supabase-config.js). Needed because send-message has
--                      verify_jwt on.
--   outbox_secret    - must match OUTBOX_SECRET in the edge function secrets,
--                      or every drain is refused with 403. Generate a fresh
--                      one; do not reuse anything.
--
-- select vault.create_secret('<anon jwt>',      'outbox_anon_key', '...');
-- select vault.create_secret('<random string>', 'outbox_secret',   '...');

create or replace function drain_message_outbox()
returns void language plpgsql security definer set search_path = public as $$
declare v_anon text; v_key text;
begin
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'outbox_anon_key';
  select decrypted_secret into v_key  from vault.decrypted_secrets where name = 'outbox_secret';
  -- A warning rather than an exception: a missing secret is a setup problem,
  -- and a cron job that throws every five minutes buries the one log line
  -- that says what is actually wrong.
  if v_anon is null or v_key is null then
    raise warning 'outbox drain secrets missing from vault - skipping';
    return;
  end if;

  perform net.http_post(
    url := 'https://drejwxijygwwhnfpgxvl.supabase.co/functions/v1/send-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'x-outbox-key', v_key
    ),
    body := '{"action":"drain"}'::jsonb
  );
end; $$;

-- Not reachable from the browser. It carries no arguments an attacker could
-- steer, but it is a scheduled internal job and has no business being in the
-- public API surface.
revoke execute on function drain_message_outbox from anon, authenticated;

-- Every five minutes. The queue holds confirmations and cancellations, which
-- are messages a client is actively waiting on - an hourly drain would make a
-- booking confirmation feel broken. Reminders carry their own send_after, so
-- draining often does not make them arrive early.
select cron.schedule('drain-message-outbox', '*/5 * * * *', 'select drain_message_outbox()');

-- ── VERIFIED AFTER APPLYING, NOT ASSUMED ──
--
-- Calling the endpoint by hand is what exposed the real fault: the deployed
-- send-message was a placeholder returning "shared-import-resolved" with HTTP
-- 200 to every request, including one with a deliberately wrong outbox key.
-- The real function had never been deployed, so NOTHING could send - not the
-- queue, not the button-press messages either. Redeployed from source with
-- `supabase functions deploy send-message`, after which:
--
--   wrong key   -> {"error":"Not authorised"}      403
--   correct key -> {"ok":true,"claimed":0,"sent":0} 200
--
-- claimed:0 because the stale queue had already been cleared.
