-- The deposit-unpaid message told a client to "pay your deposit" and
-- stopped there, with no way to reach the salon about anything else (wrong
-- amount, already paid by bank transfer, a question about the order). Adds
-- a pointer to the salon's Instagram (@studioserena.hair) as the fallback
-- contact channel, in both places this message is generated: the lookup
-- status (extensions_status_for) and the booking-time hard block
-- (extensions_booking_block).
create or replace function extensions_status_for(p_phone text, p_email text)
returns table(allowed boolean, earliest_date date, message text)
language plpgsql security definer set search_path = public as $$
declare
  v_key text := phone_key(p_phone);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_order extension_orders;
  v_earliest date;
begin
  if v_email = '' or length(coalesce(v_key, '')) < 8 then
    return query select false, null::date,
      'Please give both the mobile number and the email address you booked with.'::text;
    return;
  end if;

  if auth_failure_count('extensions_lookup', interval '1 hour') >= 12 then
    raise exception 'Too many attempts. Please wait an hour, or ring the salon and we will book it for you.';
  end if;

  select * into v_order
    from extension_orders o
   where phone_key(o.customer_phone) = v_key
     and lower(coalesce(o.customer_email, '')) = v_email
     and coalesce(o.status, '') <> 'cancelled'
   order by o.ordered_at desc nulls last
   limit 1;

  if v_order.id is null then
    insert into auth_failures (kind) values ('extensions_lookup');
    return query select false, null::date,
      'We could not find an extensions order for those details. Extensions start with a consultation - we match your colour, order the hair and take a deposit, and then you can book the fitting.'::text;
    return;
  end if;

  delete from auth_failures where kind = 'extensions_lookup';

  if not (v_order.deposit_paid or v_order.booking_allowed_before_deposit) then
    return query select false, null::date,
      'Your order is on file, but the deposit is still open. Please pay your deposit, or if there is something else, message us on Instagram @studioserena.hair.'::text;
    return;
  end if;

  if v_order.arrived_at is not null then
    return query select true, current_date,
      (case when v_order.deposit_paid
         then 'Your hair has arrived. Choose any time that suits you.'
         else 'Your hair has arrived. Please settle your deposit before your fitting.' end)::text;
    return;
  end if;

  v_earliest := coalesce(v_order.ordered_at, now())::date + 18;
  return query select true, v_earliest,
    (format('Fittings are available from %s.', to_char(v_earliest, 'DD.MM.YYYY'))
      || case when not v_order.deposit_paid then ' Please settle your deposit before your fitting.' else '' end)::text;
end; $$;
grant execute on function extensions_status_for to anon;

create or replace function extensions_booking_block(
  p_phone text, p_service_id uuid, p_addon_ids uuid[], p_date date
) returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_is_ext boolean;
  v_key text;
  v_order extension_orders;
  v_earliest date;
begin
  select exists (select 1 from services s
                  where s.id = p_service_id and s.category = 'Hair Extensions')
      or exists (select 1 from addons a
                  where p_addon_ids is not null and a.id = any(p_addon_ids)
                    and a.exclusive_group = 'extensions')
    into v_is_ext;
  if not v_is_ext then return null; end if;

  v_key := phone_key(p_phone);
  if length(coalesce(v_key, '')) < 8 then
    return 'Extensions begin with a consultation. Please book a consultation and we will take it from there.';
  end if;

  select * into v_order
    from extension_orders o
   where phone_key(o.customer_phone) = v_key
     and coalesce(o.status, '') <> 'cancelled'
   order by o.ordered_at desc nulls last
   limit 1;

  if v_order.id is null then
    return 'Extensions are fitted once your hair has been ordered for you. Please book a consultation first - we will match your colour, order the hair and take a deposit, and then you can book the fitting.';
  end if;

  if not v_order.deposit_paid then
    return 'Your order is on file, but the deposit is still open. Please pay your deposit, or if there is something else, message us on Instagram @studioserena.hair.';
  end if;

  if v_order.arrived_at is null then
    v_earliest := coalesce(v_order.ordered_at, now())::date + 18;
    if p_date < v_earliest then
      return format(
        'Your hair is on its way - fittings are available from %s, about two and a half weeks after it was ordered.',
        to_char(v_earliest, 'DD.MM.YYYY'));
    end if;
  end if;

  return null;
end; $$;
grant execute on function extensions_booking_block to anon;
