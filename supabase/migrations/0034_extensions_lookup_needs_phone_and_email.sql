-- ── FINDING YOUR OWN ORDER ──
--
-- Asked before the calendar, so a client is never offered a date her hair
-- cannot make and only finds out when she confirms.
--
-- Both the phone number AND the email address, matched together. With the
-- phone alone this is a public endpoint that answers "does this number have
-- extensions on order, and when is the hair due" for any number anyone cares
-- to type - enough, tried in bulk, to map out who the salon's extensions
-- clients are. Requiring the pair means knowing the client already.
--
-- The same standard the client's own booking lookup uses, deliberately: these
-- two endpoints expose the same kind of thing and should not have two
-- different answers about how much proof is enough.
--
-- Throttled underneath that. The pair is the real defence; the throttle means
-- a wrong guess cannot be repeated thousands of times while someone works
-- through a list. It costs a real client nothing - she types her own details
-- once and they match.
--
-- VOLATILE, not stable: it records a missed attempt and clears the count on a
-- hit, and Postgres refuses writes inside a non-volatile function. Declared
-- stable, the throttle threw on the very first miss and a client who simply
-- had not been in yet saw a raw database error instead of "book a
-- consultation first" - the commonest case turned into the most alarming one.
drop function if exists extensions_status_for(text);

create or replace function extensions_status_for(p_phone text, p_email text)
returns table (allowed boolean, earliest_date date, message text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_key text := phone_key(p_phone);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_order extension_orders;
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
     and o.deposit_paid
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

  if v_order.arrived_at is not null then
    return query select true, current_date,
      'Your hair has arrived. Choose any time that suits you.'::text;
  else
    return query select true, (coalesce(v_order.ordered_at, now())::date + 18),
      format('Your hair is on its way. Fittings can be booked from %s.',
             to_char(coalesce(v_order.ordered_at, now())::date + 18, 'DD.MM.YYYY'))::text;
  end if;
end; $$;
grant execute on function extensions_status_for to anon;

-- auth_failures.kind is a whitelist - 'pin' and 'client_lookup' - so recording
-- a missed extensions lookup violated it and the whole call threw. Kept as a
-- whitelist rather than opened up: it is there so a typo in a new throttle
-- cannot silently record under a name nothing counts, leaving an endpoint that
-- looks protected and is not.
alter table auth_failures drop constraint auth_failures_kind_check;
alter table auth_failures add constraint auth_failures_kind_check
  check (kind = any (array['pin'::text, 'client_lookup'::text, 'extensions_lookup'::text]));
