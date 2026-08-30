-- ── EVERY READ IN THE APPLICATION WAS ALSO A WRITE ──
-- APPLIED 30 August 2026 to the studio-serena project.
--
-- verify_staff_pin runs inside every single RPC the panel makes, and on
-- success it ran "delete from auth_failures where kind = 'pin'"
-- unconditionally. Almost always there is nothing to delete - the salon types
-- its PIN correctly - so this turned every read in the whole application into
-- a write transaction: locks taken, WAL written, for no row.
--
-- Guarded by an exists() first, which on the (kind, at) index is a cheap
-- read. The clearing behaviour is unchanged: a stylist who fat-fingers it
-- twice and then gets it right still wipes the failures, which is the point
-- of it being there.
--
-- Honest about the size of this: it is NOT the main cost of a slow panel.
-- Measured against the live project, a trivial RPC round-trips in 200-400ms
-- while the query inside it executes in 0.2ms - so the time is network and
-- PostgREST, and the fix for that is fewer and more parallel calls, not
-- database tuning. This was simply the one part that was free to remove.
create or replace function verify_staff_pin(p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if auth_failure_count('pin', interval '15 minutes') >= 8 then
    raise exception 'Too many incorrect PIN attempts. Please wait 15 minutes and try again.';
  end if;
  select exists (
    select 1 from app_settings
    where key in ('staff_pin', 'owner_pin') and value = p_pin
  ) into v_ok;
  if v_ok then
    if exists (select 1 from auth_failures where kind = 'pin') then
      delete from auth_failures where kind = 'pin';
    end if;
  else
    insert into auth_failures (kind) values ('pin');
  end if;
  return v_ok;
end; $$;
grant execute on function verify_staff_pin to anon;

create or replace function is_owner_pin(p_pin text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if auth_failure_count('pin', interval '15 minutes') >= 8 then
    raise exception 'Too many incorrect PIN attempts. Please wait 15 minutes and try again.';
  end if;
  select exists (
    select 1 from app_settings where key = 'owner_pin' and value = p_pin
  ) into v_ok;
  -- Only a wrong PIN counts. A staff PIN reaching here is a stylist opening a
  -- screen that happens to ask whether they are the owner - a correct answer
  -- of "no", not a failed guess.
  if v_ok then
    if exists (select 1 from auth_failures where kind = 'pin') then
      delete from auth_failures where kind = 'pin';
    end if;
  elsif not exists (
    select 1 from app_settings where key = 'staff_pin' and value = p_pin
  ) then
    insert into auth_failures (kind) values ('pin');
  end if;
  return v_ok;
end; $$;
grant execute on function is_owner_pin to anon;
