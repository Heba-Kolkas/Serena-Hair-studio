-- ── DEPOSIT INFO ON EVERY REQUEST ──
--
-- The owner reviewing a booking request had no way to see whether her
-- deposit was paid without leaving to check the separate Extensions screen -
-- exactly the confusion behind merging the two into one panel. Each request
-- now carries its matching order's deposit state alongside it, found the
-- same way the booking gate itself finds it: by phone_key, most recent order
-- first. No order on file simply returns nulls - a request can exist before
-- any order does, if she booked before her consultation somehow got skipped.
drop function if exists admin_get_pending_bookings(text);
create or replace function admin_get_pending_bookings(p_pin text)
returns table (
  id uuid, date date, start_time time, customer_name text, customer_email text,
  customer_phone text, service_name text, staff_name text, booking_ref text,
  hold_expires_at timestamptz, hold_hours_left numeric,
  order_id uuid, deposit_paid boolean, deposit_amount numeric,
  booking_allowed_before_deposit boolean, order_arrived_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.customer_name, b.customer_email,
           b.customer_phone, s.name, st.name, b.booking_ref, b.hold_expires_at,
           round(extract(epoch from (b.hold_expires_at - now())) / 3600.0, 1),
           eo.id, eo.deposit_paid, eo.deposit_amount, eo.booking_allowed_before_deposit, eo.arrived_at
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    left join lateral (
      select * from extension_orders o
      where phone_key(o.customer_phone) = phone_key(b.customer_phone)
        and coalesce(o.status, '') <> 'cancelled'
      order by o.ordered_at desc nulls last
      limit 1
    ) eo on true
    where b.status = 'pending'
    order by b.hold_expires_at nulls last, b.date;
end; $$;
grant execute on function admin_get_pending_bookings to anon;

drop function if exists admin_get_request_history(text, int);
create or replace function admin_get_request_history(p_pin text, p_limit int default 100)
returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_phone text, customer_email text,
  service_name text, staff_name text, rejected_at timestamptz, notes text,
  order_id uuid, deposit_paid boolean, deposit_amount numeric,
  booking_allowed_before_deposit boolean, order_arrived_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_phone, b.customer_email,
           s.name, st.name, b.rejected_at, b.notes,
           eo.id, eo.deposit_paid, eo.deposit_amount, eo.booking_allowed_before_deposit, eo.arrived_at
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    left join lateral (
      select * from extension_orders o
      where phone_key(o.customer_phone) = phone_key(b.customer_phone)
        and coalesce(o.status, '') <> 'cancelled'
      order by o.ordered_at desc nulls last
      limit 1
    ) eo on true
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
