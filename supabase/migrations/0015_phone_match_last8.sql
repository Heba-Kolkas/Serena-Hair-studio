-- The tightened lookup in 0014 compared full digit strings, which locked real
-- clients out: the salon stores "+47 900 11 222" (4790011222) and a client
-- types "900 11 222" (90011222). Same person, no match. Caught by testing the
-- legitimate path, not just the attack.
--
-- Compared on the last eight digits instead - the length of a Norwegian mobile
-- number - so +47, 0047 and the bare number all agree. No weaker: the whole
-- subscriber number is still required, only the country code is ignored.
create or replace function phone_key(p_phone text)
returns text language sql immutable set search_path = public as $$
  select right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8);
$$;

create or replace function get_my_bookings(p_email text, p_phone text)
returns setof bookings language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
        v_phone text := phone_key(p_phone);
        v_found int;
begin
  if v_email = '' or length(v_phone) < 8 then
    raise exception 'Both the email address and the full phone number are required';
  end if;
  if auth_failure_count('client_lookup', interval '15 minutes') >= 20 then
    raise exception 'Too many lookups. Please wait 15 minutes and try again.';
  end if;

  select count(*) into v_found from bookings b
   where lower(b.customer_email) = v_email
     and phone_key(b.customer_phone) = v_phone;

  if v_found = 0 then
    insert into auth_failures (kind) values ('client_lookup');
    return;
  end if;

  delete from auth_failures where kind = 'client_lookup';
  return query
    select * from bookings b
     where lower(b.customer_email) = v_email
       and phone_key(b.customer_phone) = v_phone
     order by b.date desc, b.start_time desc;
end; $$;
grant execute on function get_my_bookings to anon;

create or replace function cancel_my_booking(p_booking_id uuid, p_email text, p_phone text)
returns bookings language plpgsql security definer set search_path = public as $$
declare v_booking bookings;
        v_email text := lower(trim(coalesce(p_email, '')));
        v_phone text := phone_key(p_phone);
begin
  if v_email = '' or length(v_phone) < 8 then
    raise exception 'Both the email address and the full phone number are required';
  end if;
  update bookings set status = 'cancelled'
  where id = p_booking_id
    and lower(customer_email) = v_email
    and phone_key(customer_phone) = v_phone
    and status not in ('cancelled', 'completed')
  returning * into v_booking;
  if v_booking is null then
    raise exception 'Booking not found, or already cancelled or completed';
  end if;
  return v_booking;
end; $$;
grant execute on function cancel_my_booking to anon;
