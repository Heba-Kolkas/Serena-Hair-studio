-- ── THE PANEL HAD NO WAY TO FIX A DEPOSIT AFTER THE FACT ──
--
-- Found live: an order existed for a real client, but her extensions gate
-- search said "no order found" - because deposit_paid was false on the row
-- and the panel had no way to change that once the order was created. The
-- only action on an order card was "It arrived". A deposit taken in cash
-- after the order was logged, or a box left unchecked by mistake, could
-- never be corrected without editing the database directly.
--
-- staff_update_extension_order exists but is the wrong tool for this: it
-- overwrites colour, length, quantity, supplier, total and deposit amount
-- unconditionally on every call, with no coalesce against what is already
-- there. A "just flip the deposit" button built on it would have to resend
-- every other field correctly or silently wipe them - exactly the kind of
-- foot-gun that causes a real order to lose its colour and length one day.
-- A single-purpose function, the same shape as staff_mark_extensions_arrived
-- beside it, touches only what it says it touches.
create or replace function staff_mark_deposit_paid(p_pin text, p_order_id uuid, p_paid boolean default true)
returns extension_orders language plpgsql security definer set search_path = public as $$
declare v_order extension_orders;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  update extension_orders set deposit_paid = coalesce(p_paid, true)
  where id = p_order_id
  returning * into v_order;
  if v_order.id is null then raise exception 'Order not found'; end if;
  return v_order;
end; $$;
grant execute on function staff_mark_deposit_paid to anon;
