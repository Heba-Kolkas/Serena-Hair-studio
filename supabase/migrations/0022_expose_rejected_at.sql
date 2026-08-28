-- The panel needs rejected_at to say "Rejected" instead of "Cancelled".
drop function if exists admin_get_bookings(text, date, text);
create or replace function admin_get_bookings(p_pin text, p_date_from date default null, p_status text default null)
returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_email text, customer_phone text, notes text,
  booking_ref text, service_name text, staff_id uuid, staff_name text, amount_charged numeric,
  addons text, expected_total numeric, expected_total_is_estimate boolean,
  late_cancellation boolean, cancellation_fee numeric,
  cancellation_fee_waived boolean, cancellation_fee_settled boolean,
  cancelled_at timestamptz, hours_notice numeric, rejected_at timestamptz,
  customer_instagram text
) language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  return query
    select b.id, b.date, b.start_time, b.end_time, b.status,
           b.customer_name, b.customer_email, b.customer_phone, b.notes, b.booking_ref,
           s.name, st.id, st.name, b.amount_charged,
           booking_addons_label(b.id), b.expected_total, b.expected_total_is_estimate,
           b.late_cancellation, b.cancellation_fee,
           b.cancellation_fee_waived, b.cancellation_fee_settled,
           b.cancelled_at,
           case when b.cancelled_at is null then null
                else round(extract(epoch from (
                  ((b.date + b.start_time) at time zone 'Europe/Oslo') - b.cancelled_at
                )) / 3600.0, 1) end,
           b.rejected_at, b.customer_instagram
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where (p_date_from is null or b.date >= p_date_from)
      and (p_status is null or p_status = '' or b.status = p_status::booking_status)
    order by b.date desc, b.start_time desc
    limit 300;
end; $$;
grant execute on function admin_get_bookings to anon;
