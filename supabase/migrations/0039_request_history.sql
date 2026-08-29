-- ── ANSWERED REQUESTS SHOULDN'T VANISH ──
--
-- Confirming or rejecting an extensions request removed it from view
-- entirely - correct for "what still needs an answer", wrong for "what did I
-- decide last week". There was no way to look back at a rejection to recall
-- what was said, or confirm a client's fitting really had been approved.
--
-- No new column for this. "Was this ever a request" is already fully
-- determined by the same test book_appointment_core uses to decide pending
-- vs confirmed at the moment of booking - the service or an addon on it has
-- requires_confirmation set - so a rejected one (rejected_at is not null) or
-- a confirmed one on such a service is provably a former request, not a
-- guess. Ordinary bookings that were never pending share none of these
-- traits and are correctly excluded.
create or replace function admin_get_request_history(p_pin text, p_limit int default 100)
returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_phone text, customer_email text,
  service_name text, staff_name text, rejected_at timestamptz, notes text
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_phone, b.customer_email,
           s.name, st.name, b.rejected_at, b.notes
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where b.status <> 'pending'
      and (
        b.rejected_at is not null
        or s.requires_confirmation
        or exists (
          select 1 from booking_addons ba join addons a on a.id = ba.addon_id
          where ba.booking_id = b.id and a.requires_confirmation
        )
      )
    order by b.date desc, b.start_time desc
    limit p_limit;
end; $$;
grant execute on function admin_get_request_history to anon;
