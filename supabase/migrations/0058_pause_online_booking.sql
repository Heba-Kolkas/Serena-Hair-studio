-- ── ONLINE BOOKING PAUSED ──
-- WRITTEN 1 October 2026. NOT YET APPLIED - run it in the Supabase SQL editor
-- of the studio-serena project (drejwxijygwwhnfpgxvl), then change this line.
--
-- studioserena.no is off the Vercel project, but the site is still served at
-- studio-serena.vercel.app and the code - publishable key included - is in a
-- public repo. book.html now shows a "paused" notice instead of the wizard
-- (ONLINE_BOOKING_PAUSED in js/booking.js), but that only hides the form:
-- book_appointment and join_waitlist stay callable by anyone holding the key.
-- Taking EXECUTE away from the public roles is what actually stops them.
--
-- Staff are unaffected. The schedule books through staff_book_appointment,
-- and every security-definer function runs as its owner, not as anon.
-- Clients can still see and cancel what they already have (get_my_bookings,
-- cancel_my_booking) and leave the waiting list (leave_waitlist).
--
-- PUBLIC as well as anon/authenticated: Postgres grants EXECUTE to PUBLIC on
-- every new function, so revoking from anon alone would change nothing.
revoke execute on function book_appointment from public, anon, authenticated;
revoke execute on function join_waitlist from public, anon, authenticated;

-- ── TO REOPEN ──
-- Run these two lines, and set ONLINE_BOOKING_PAUSED back to false in
-- js/booking.js. Doing only one of the two leaves either a form that fails on
-- every booking, or a hidden form whose database still takes bookings.
--
--   grant execute on function book_appointment to anon;
--   grant execute on function join_waitlist to anon;
