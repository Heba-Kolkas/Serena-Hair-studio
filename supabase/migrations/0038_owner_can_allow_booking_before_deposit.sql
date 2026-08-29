-- ── THE OWNER DECIDES, NOT THE SYSTEM ──
--
-- Until now the rule was fixed: deposit paid, or no booking. That is right
-- for most clients, but the owner is the one who actually knows whether a
-- particular client can be trusted to pay at the fitting - a regular, a
-- friend, someone paying by bank transfer that is still clearing. This adds
-- one per-order switch he controls, rather than any automatic exception.
--
-- Owner-only, the same permission level as waiving a cancellation fee: this
-- is a financial-risk call about a specific client, not routine bookkeeping
-- like "It arrived" or "deposit received", which any staff member handles.
alter table extension_orders
  add column booking_allowed_before_deposit boolean not null default false;

create or replace function staff_set_booking_before_deposit(
  p_pin text, p_order_id uuid, p_allowed boolean default true
) returns extension_orders language plpgsql security definer set search_path = public as $$
declare v_order extension_orders;
begin
  if not is_owner_pin(p_pin) then raise exception 'Invalid owner PIN'; end if;
  update extension_orders set booking_allowed_before_deposit = coalesce(p_allowed, true)
  where id = p_order_id
  returning * into v_order;
  if v_order.id is null then raise exception 'Order not found'; end if;
  return v_order;
end; $$;
grant execute on function staff_set_booking_before_deposit to anon;

-- ── THE GATE ITSELF, AND WHAT SHE IS TOLD ──
--
-- Unlocked by deposit_paid OR the owner's override - either is sufficient.
-- The wait for the hair to actually exist still applies either way; the
-- owner's decision is about the money, not about hair that has not arrived.
--
-- Also fixes something dishonest in the old wording: a client whose deposit
-- is simply outstanding was told "we could not find an extensions order for
-- those details" - which is false. She gave the exact phone and email on an
-- order that exists; the deposit being unpaid does not make the order
-- disappear. She now hears the true state and what to do about it, not a
-- generic decline that reads as though the salon has no record of her.
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

  if not (v_order.deposit_paid or v_order.booking_allowed_before_deposit) then
    return 'Your order is on file, but the deposit is still open. Please settle it with us and we will get you booked - call +47 45 39 76 31 and we will help right away.';
  end if;

  if v_order.arrived_at is not null then
    if v_order.deposit_paid then
      return null;
    end if;
    return 'Your hair has arrived - you are set to book. Please settle your deposit before your fitting.';
  end if;

  v_earliest := coalesce(v_order.ordered_at, now())::date + 18;
  if p_date < v_earliest then
    return format(
      'Your hair is on its way. Fittings can be booked from %s - about two and a half weeks after it was ordered.%s',
      to_char(v_earliest, 'DD.MM.YYYY'),
      case when not v_order.deposit_paid then ' Please settle your deposit before your fitting.' else '' end);
  end if;

  if not v_order.deposit_paid then
    return 'You are set to book - please settle your deposit before your fitting.';
  end if;

  return null;
end; $$;
grant execute on function extensions_booking_block to anon;

create or replace function extensions_status_for(p_phone text, p_email text)
returns table (allowed boolean, earliest_date date, message text)
language plpgsql volatile security definer set search_path = public as $$
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
      'Your order is on file, but the deposit is still open. Please settle it with us and we will get you booked - call +47 45 39 76 31.'::text;
    return;
  end if;

  if v_order.arrived_at is not null then
    return query select true, current_date,
      (case when v_order.deposit_paid
         then 'Your hair has arrived. Choose any time that suits you.'
         else 'Your hair has arrived - you are set to book. Please settle your deposit before your fitting.' end)::text;
    return;
  end if;

  v_earliest := coalesce(v_order.ordered_at, now())::date + 18;
  return query select true, v_earliest,
    (format('Your hair is on its way. Fittings can be booked from %s.', to_char(v_earliest, 'DD.MM.YYYY'))
      || case when not v_order.deposit_paid then ' Please settle your deposit before your fitting.' else '' end)::text;
end; $$;
grant execute on function extensions_status_for to anon;
