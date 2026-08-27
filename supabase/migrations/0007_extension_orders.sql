-- ── THE EXTENSIONS ORDER BOOK ──
-- APPLIED 27-28 August 2026 to the studio-serena project.

create table extension_orders (
  id uuid primary key default gen_random_uuid(),

  -- Copied rather than referenced: she may have no booking yet, and the order
  -- has to survive a retention purge anonymising her old bookings.
  customer_name text not null,
  customer_phone text not null,
  customer_email text,

  -- Who took the consultation, so the delivery does not depend on that person
  -- being in that day.
  staff_id uuid references staff(id) on delete set null,

  colour text,
  length_cm text,
  quantity text,
  supplier text,
  notes text,

  -- What the whole job was quoted at, and what she put down. Checked before an
  -- extensions booking request is confirmed, which is exactly why it lives
  -- where the person doing the confirming will see it.
  total_agreed numeric(10,2),
  deposit_amount numeric(10,2),
  deposit_paid boolean not null default false,

  -- The fitting, when it is already booked. Null is normal and expected:
  -- plenty of clients order first and book once the hair lands.
  booking_id uuid references bookings(id) on delete set null,

  -- ordered  : placed with the supplier, waiting
  -- arrived  : in the salon, client not yet told
  -- notified : client has been told it is here
  -- fitted   : done. Kept, not deleted — it is her colour history.
  -- cancelled: she changed her mind, or it could not be sourced
  status text not null default 'ordered'
    check (status in ('ordered', 'arrived', 'notified', 'fitted', 'cancelled')),

  ordered_at timestamptz not null default now(),
  arrived_at timestamptz,
  notified_at timestamptz
);

create index extension_orders_status_idx on extension_orders(status, ordered_at);
create index extension_orders_phone_idx on extension_orders(customer_phone);

alter table extension_orders enable row level security;
-- No anon policy at all. Everything below is SECURITY DEFINER behind the staff
-- PIN, so a client can never read another client's order.
create policy "admin manage extension_orders" on extension_orders for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── ADD AN ORDER ──
-- Staff PIN, not owner: whoever does the consultation writes the order, which
-- is the only way it gets written while the details are still fresh.
create or replace function staff_add_extension_order(
  p_pin text,
  p_customer_name text, p_customer_phone text, p_customer_email text,
  p_staff_id uuid,
  p_colour text, p_length_cm text, p_quantity text, p_supplier text,
  p_total_agreed numeric, p_deposit_amount numeric, p_deposit_paid boolean,
  p_notes text default null, p_booking_id uuid default null
) returns extension_orders language plpgsql security definer set search_path = public as $$
declare v_order extension_orders;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'A name is needed so the order can be matched to a client';
  end if;
  if coalesce(trim(p_customer_phone), '') = '' then
    raise exception 'A phone number is needed so she can be told when it arrives';
  end if;

  insert into extension_orders (
    customer_name, customer_phone, customer_email, staff_id,
    colour, length_cm, quantity, supplier,
    total_agreed, deposit_amount, deposit_paid, notes, booking_id
  ) values (
    trim(p_customer_name), trim(p_customer_phone), nullif(trim(coalesce(p_customer_email, '')), ''),
    p_staff_id,
    nullif(trim(coalesce(p_colour, '')), ''), nullif(trim(coalesce(p_length_cm, '')), ''),
    nullif(trim(coalesce(p_quantity, '')), ''), nullif(trim(coalesce(p_supplier, '')), ''),
    p_total_agreed, p_deposit_amount, coalesce(p_deposit_paid, false),
    nullif(trim(coalesce(p_notes, '')), ''), p_booking_id
  ) returning * into v_order;
  return v_order;
end; $$;
grant execute on function staff_add_extension_order to anon;

-- ── THE LIST ──
-- Joined with the stylist and with the fitting, if one is booked, because the
-- question asked while holding a delivery box is "whose is this, and is she
-- already coming in?" — and that should not need a second lookup.
create or replace function staff_list_extension_orders(
  p_pin text, p_status text default null
) returns table (
  id uuid,
  customer_name text, customer_phone text, customer_email text,
  staff_name text,
  colour text, length_cm text, quantity text, supplier text, notes text,
  total_agreed numeric, deposit_amount numeric, deposit_paid boolean,
  balance_due numeric,
  status text,
  booking_id uuid, booking_date date, booking_time time, booking_staff text,
  ordered_at timestamptz, arrived_at timestamptz, notified_at timestamptz,
  days_waiting int,
  -- Whether anyone needs to pick up the phone. True only when the hair is here
  -- AND she has no fitting booked — a client who is already coming in has
  -- nothing to act on, so telling her is a message that changes nothing.
  -- Computed here rather than in the panel so the list, the sorting and the
  -- button can never disagree about it.
  needs_telling boolean
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query
  select o.id,
         o.customer_name, o.customer_phone, o.customer_email,
         st.name,
         o.colour, o.length_cm, o.quantity, o.supplier, o.notes,
         o.total_agreed, o.deposit_amount, o.deposit_paid,
         case when o.total_agreed is null then null
              else o.total_agreed - coalesce(o.deposit_amount, 0) end,
         o.status,
         o.booking_id, b.date, b.start_time, bst.name,
         o.ordered_at, o.arrived_at, o.notified_at,
         -- How long she has been waiting. The number that turns a list into a
         -- priority order.
         (((now() at time zone 'Europe/Oslo')::date - o.ordered_at::date))::int,
         (o.status = 'arrived' and b.id is null)
  from extension_orders o
  left join staff st on st.id = o.staff_id
  -- Only a fitting that is still ahead of her counts. A booking she already
  -- attended, or one that was cancelled, leaves her needing to be told.
  left join bookings b on b.id = o.booking_id
    and b.status not in ('cancelled', 'completed')
    and b.date >= (now() at time zone 'Europe/Oslo')::date
  left join staff bst on bst.id = b.staff_id
  where p_status is null or o.status = p_status
  order by
    -- What actually needs doing, first. An order that has arrived with nobody
    -- told is the only one asking for action; one that has arrived with her
    -- already booked is simply ready, and sits quietly below.
    case
      when o.status = 'arrived' and b.id is null then 0  -- tell her
      when o.status = 'ordered' then 1                   -- chase the supplier
      when o.status = 'arrived' then 2                   -- ready, she is booked
      when o.status = 'notified' then 3                  -- told, waiting on her
      else 4                                             -- fitted or cancelled
    end,
    o.ordered_at;
end; $$;
grant execute on function staff_list_extension_orders to anon;

create or replace function staff_update_extension_order(
  p_pin text, p_order_id uuid,
  p_colour text, p_length_cm text, p_quantity text, p_supplier text,
  p_total_agreed numeric, p_deposit_amount numeric, p_deposit_paid boolean,
  p_notes text default null, p_booking_id uuid default null
) returns extension_orders language plpgsql security definer set search_path = public as $$
declare v_order extension_orders;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  update extension_orders set
    colour = nullif(trim(coalesce(p_colour, '')), ''),
    length_cm = nullif(trim(coalesce(p_length_cm, '')), ''),
    quantity = nullif(trim(coalesce(p_quantity, '')), ''),
    supplier = nullif(trim(coalesce(p_supplier, '')), ''),
    total_agreed = p_total_agreed,
    deposit_amount = p_deposit_amount,
    deposit_paid = coalesce(p_deposit_paid, false),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    booking_id = p_booking_id
  where id = p_order_id
  returning * into v_order;
  if v_order is null then raise exception 'Order not found'; end if;
  return v_order;
end; $$;
grant execute on function staff_update_extension_order to anon;

-- ── IT ARRIVED ──
-- Returns whether she already has a fitting booked, because that decides
-- whether there is anything to send at all. If she is booked, the order is
-- simply ready and nobody is contacted — the news changes nothing she does.
-- If she is not, the returned details are what the message is built from.
create or replace function staff_mark_extensions_arrived(
  p_pin text, p_order_id uuid
) returns table (
  id uuid,
  customer_name text, customer_phone text, customer_email text,
  order_detail text,
  balance_due numeric,
  booking_date date, booking_time time, booking_staff text
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;

  update extension_orders set status = 'arrived', arrived_at = now()
  where extension_orders.id = p_order_id and status = 'ordered';
  if not found then
    raise exception 'That order is not waiting on a delivery';
  end if;

  return query
  select o.id, o.customer_name, o.customer_phone, o.customer_email,
         -- One readable line for the message, built from whatever was filled
         -- in. An order with only a colour still reads properly.
         nullif(concat_ws(', ', o.colour, o.length_cm, o.quantity), ''),
         case when o.total_agreed is null then null
              else o.total_agreed - coalesce(o.deposit_amount, 0) end,
         b.date, b.start_time, bst.name
  from extension_orders o
  left join bookings b on b.id = o.booking_id
    and b.status not in ('cancelled', 'completed')
    and b.date >= (now() at time zone 'Europe/Oslo')::date
  left join staff bst on bst.id = b.staff_id
  where o.id = p_order_id;
end; $$;
grant execute on function staff_mark_extensions_arrived to anon;

-- Recorded separately from arriving, so a delivery can be logged the moment
-- the box is opened and the client told afterwards — and so a message that
-- failed to send does not leave the order looking handled.
create or replace function staff_mark_extensions_notified(
  p_pin text, p_order_id uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  update extension_orders set status = 'notified', notified_at = now()
  where id = p_order_id and status = 'arrived';
end; $$;
grant execute on function staff_mark_extensions_notified to anon;

create or replace function staff_set_extension_order_status(
  p_pin text, p_order_id uuid, p_status text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  if p_status not in ('ordered', 'arrived', 'notified', 'fitted', 'cancelled') then
    raise exception 'Unknown status';
  end if;
  update extension_orders set status = p_status where id = p_order_id;
end; $$;
grant execute on function staff_set_extension_order_status to anon;

-- ── HER HISTORY ──
-- What she had last time. Asked at every consultation, and currently answered
-- by memory or not at all.
--
-- One search box, matched against name or phone, because at a consultation you
-- have whichever the client happened to give you. Digits and spacing in phone
-- numbers are stripped from both sides before comparing: nobody writes a number
-- the same way twice, and "+47 453 97 631" must find "45397631".
create or replace function staff_extension_history(
  p_pin text, p_query text
) returns setof extension_orders language plpgsql security definer set search_path = public as $$
declare v_q text; v_digits text;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  v_q := trim(coalesce(p_query, ''));
  if v_q = '' then return; end if;
  v_digits := regexp_replace(v_q, '\D', '', 'g');

  return query
  select * from extension_orders o
  where o.customer_name ilike '%' || v_q || '%'
     or (v_digits <> '' and regexp_replace(o.customer_phone, '\D', '', 'g') like '%' || v_digits || '%')
  order by o.ordered_at desc;
end; $$;
grant execute on function staff_extension_history to anon;

-- ── FITTINGS WITH NO HAIR ──
-- The warning that replaces the message we decided not to send.
--
-- Telling a client her extensions arrived when she is already booked changes
-- nothing she does. The opposite case changes a great deal: a four-hour fitting
-- on Thursday with the order still sitting at the supplier. That is a lost
-- afternoon, a lost slot and an angry client, and nothing in the system
-- currently notices it.
--
-- NOTHING IS SENT TO THE CLIENT FROM HERE, EVER. She has done nothing wrong
-- and there is nothing for her to act on; telling her the salon may not be
-- ready would only worry her about an appointment that will probably go ahead
-- fine. This is a warning for the salon, so someone can chase the supplier
-- while there is still time, and it is the salon's call whether she ever needs
-- to hear about it.
--
-- Surfaced at the top of the orders screen, and counted on the menu button, so
-- it is seen without being looked for.
create or replace function staff_extension_orders_at_risk(
  p_pin text, p_within_days int default 7
) returns table (
  id uuid,
  customer_name text, customer_phone text, customer_email text,
  colour text, length_cm text, quantity text, supplier text,
  status text,
  booking_id uuid, booking_date date, booking_time time, booking_staff text,
  days_until_fitting int,
  days_since_ordered int
) language plpgsql security definer set search_path = public as $$
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  return query
  select o.id, o.customer_name, o.customer_phone, o.customer_email,
         o.colour, o.length_cm, o.quantity, o.supplier,
         o.status,
         o.booking_id, b.date, b.start_time, bst.name,
         (b.date - (now() at time zone 'Europe/Oslo')::date)::int,
         (((now() at time zone 'Europe/Oslo')::date - o.ordered_at::date))::int
  from extension_orders o
  join bookings b on b.id = o.booking_id
  left join staff bst on bst.id = b.staff_id
  where o.status = 'ordered'
    and b.status not in ('cancelled', 'completed')
    and b.date >= (now() at time zone 'Europe/Oslo')::date
    and b.date <= (now() at time zone 'Europe/Oslo')::date + p_within_days
  -- Soonest fitting first: that is the one there is least time to do
  -- anything about.
  order by b.date, b.start_time;
end; $$;
grant execute on function staff_extension_orders_at_risk to anon;
