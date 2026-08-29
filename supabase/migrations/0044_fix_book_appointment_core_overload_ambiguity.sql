-- ── URGENT: THE 11-ARG book_appointment_core WAS LEFT DANGLING ──
--
-- create or replace with a different parameter list creates a new overload,
-- not a replacement, exactly as it has every time this has happened before
-- this session (0023's own comment says as much). staff_book_appointment
-- calls with 11 positional arguments, which now matches BOTH the old 11-arg
-- signature and the new 12-arg one (whose 12th parameter defaults), so
-- Postgres cannot choose - every staff booking through the panel had been
-- failing with "function ... is not unique" since 0043 landed. Confirmed
-- live before writing this, not assumed:
--
--   select book_appointment_core(<11 args>);
--   ERROR: function book_appointment_core(...) is not unique
--
-- The 11-arg version is dropped, not kept: its entire body is identical to
-- the 12-arg one's fallback (p_skip_confirmation defaults to false), so
-- nothing is lost - and staff_book_appointment's call already matches the
-- 12-arg signature's first 11 parameters exactly, so it needs no changes
-- of its own.
drop function if exists book_appointment_core(
  uuid, uuid, date, time, text, text, text, text, uuid[], boolean, boolean
);

-- Confirmed after: the same 11-arg call now resolves and succeeds.
