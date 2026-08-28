-- ── DECIDING WHAT A LATE CANCELLATION ACTUALLY COSTS ──
-- The fee is priced automatically - half the booking - but the decision about
-- whether to charge it, and how much, is a judgement the owner makes about a
-- particular client. Waiving already existed as a function with no button;
-- setting a different figure did not exist at all.
--
-- Both are here, and the panel needs to see the fee to offer either, so
-- admin_get_bookings gains the cancellation columns. Return type changes, so
-- it is dropped first.

create or replace function admin_set_cancellation_fee(
  p_pin text, p_booking_id uuid, p_amount numeric
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter an amount of zero or more'; end if;
  -- Zero and waived are the same decision said two ways, so setting zero
  -- waives it rather than leaving a 0 kr charge sitting on the books.
  update bookings set
    cancellation_fee = case when p_amount = 0 then null else p_amount end,
    cancellation_fee_waived = (p_amount = 0)
  where id = p_booking_id;
end; $$;
grant execute on function admin_set_cancellation_fee to anon;

-- Undo, because waiving is a judgement and judgements get made in a hurry.
create or replace function admin_unwaive_cancellation_fee(p_pin text, p_booking_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pct int; v_b bookings;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  select * into v_b from bookings where id = p_booking_id;
  if v_b.id is null then raise exception 'Booking not found'; end if;
  select fee_percent into v_pct from get_cancellation_policy();
  update bookings set
    cancellation_fee_waived = false,
    cancellation_fee = coalesce(
      cancellation_fee,
      case when v_b.expected_total is null then null
           else round(v_b.expected_total * v_pct / 100.0, 0) end)
  where id = p_booking_id;
end; $$;
grant execute on function admin_unwaive_cancellation_fee to anon;

drop function if exists admin_get_bookings(text, date, text);
create or replace function admin_get_bookings(p_pin text, p_date_from date default null, p_status text default null)
returns table (
  id uuid, date date, start_time time, end_time time, status booking_status,
  customer_name text, customer_email text, customer_phone text, notes text,
  booking_ref text, service_name text, staff_id uuid, staff_name text, amount_charged numeric,
  addons text, expected_total numeric, expected_total_is_estimate boolean,
  late_cancellation boolean, cancellation_fee numeric,
  cancellation_fee_waived boolean, cancellation_fee_settled boolean,
  cancelled_at timestamptz, hours_notice numeric
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
                )) / 3600.0, 1) end
    from bookings b
    join services s on s.id = b.service_id
    join staff st on st.id = b.staff_id
    where (p_date_from is null or b.date >= p_date_from)
      and (p_status is null or p_status = '' or b.status = p_status::booking_status)
    order by b.date desc, b.start_time desc
    limit 300;
end; $$;
grant execute on function admin_get_bookings to anon;
