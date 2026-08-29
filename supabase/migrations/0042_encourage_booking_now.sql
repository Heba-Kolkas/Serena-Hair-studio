-- extensions_status_for's arrival/on-its-way branches described the earliest
-- date the client could book, but never told her outright that she could go
-- book it now - a client skimming the message could read "fittings are
-- available from 12.09.2026" as informational rather than as "go pick a
-- time". Adds the explicit "you can book your spot now" framing to both the
-- arrived-but-unpaid branch and the still-on-its-way branch.
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
         else 'Your hair has arrived - you can book your spot now. Please settle your deposit before your fitting.' end)::text;
    return;
  end if;

  v_earliest := coalesce(v_order.ordered_at, now())::date + 18;
  return query select true, v_earliest,
    (format('Your hair is on its way - you can book your spot now. Fittings are available from %s.', to_char(v_earliest, 'DD.MM.YYYY'))
      || case when not v_order.deposit_paid then ' Please settle your deposit before your fitting.' else '' end)::text;
end; $$;
grant execute on function extensions_status_for to anon;
