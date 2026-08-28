-- The one function in the schema without a pinned search_path. Every other
-- function sets it; this one was written without and the advisor flagged it.
-- Not SECURITY DEFINER, so the exposure is small, but a function whose name
-- resolution depends on the caller's search_path is a loose end either way.
create or replace function booking_hold_is_live(b bookings)
returns boolean language sql immutable set search_path = public as $$
  select b.status <> 'pending' or b.hold_expires_at is null or b.hold_expires_at > now();
$$;
