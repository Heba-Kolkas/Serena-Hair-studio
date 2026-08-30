-- ── EDITING A BOOKING, AND REMEMBERING THE CLIENT ──
--
-- Two things the panel could not do.
--
-- CHANGING THE SERVICE. It was possible only inside Move, which needs a date
-- and a time and an OWNER pin - so a stylist who simply had the service wrong
-- ("she is having a toner too") had to move the appointment to the time it
-- already had, and could not do it at all without the owner. The service is a
-- fact about the appointment, not about when it is, and it now edits on its
-- own.
--
-- NOTES. Nothing could write a booking's notes after it was made. The panel
-- has always DISPLAYED them - the amber strip on the block - so a stylist
-- could read a note the client left and never add to it.

-- ── WHAT THE SALON KNOWS ABOUT HER ──
--
-- Separate from the booking's own note, because they answer different
-- questions. A booking note is about that visit ("running 10 min late",
-- "allergic to the usual toner"). This is about HER, and it should still be
-- there in four months when she comes back: the colour formula, the
-- development time, that she wants more length at the front next time.
--
-- Keyed on phone_key - the last eight digits - like everything else that
-- identifies a client here. She books as "Heba" and "Heba Kolkas" and types
-- her number three different ways; the number is the only stable thing.
--
-- Not attached to a booking on purpose: it has to outlive them. Bookings get
-- cancelled, completed and eventually anonymised by the retention purge, and
-- a colour formula that disappeared with the appointment it was written at
-- would be worth nothing.
create table if not exists client_notes (
  phone_key text primary key,
  note text not null,
  -- Kept for display only. The key is what matches; this is what to show the
  -- stylist so she can tell she is looking at the right person.
  display_phone text,
  client_name text,
  updated_at timestamptz not null default now(),
  updated_by uuid references staff(id) on delete set null
);

alter table client_notes enable row level security;
-- No anon policy at all. Everything below is SECURITY DEFINER behind the staff
-- PIN, so a client can never read what the salon has written about her - or
-- about anyone else.
create policy "admin manage client_notes" on client_notes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create or replace function staff_get_client_note(p_pin text, p_phone text)
returns table (note text, updated_at timestamptz, updated_by_name text)
language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  v_key := phone_key(p_phone);
  if length(coalesce(v_key, '')) < 8 then return; end if;
  return query
  select cn.note, cn.updated_at, st.name
    from client_notes cn
    left join staff st on st.id = cn.updated_by
   where cn.phone_key = v_key;
end; $$;
grant execute on function staff_get_client_note to anon;

-- Writing an empty note deletes the row rather than storing a blank. A note
-- that says nothing should not sit on her file looking like something.
create or replace function staff_set_client_note(
  p_pin text, p_phone text, p_note text,
  p_staff_id uuid default null, p_client_name text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_key text; v_note text;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;
  v_key := phone_key(p_phone);
  if length(coalesce(v_key, '')) < 8 then
    raise exception 'A phone number is needed to keep a note against a client';
  end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');

  if v_note is null then
    delete from client_notes where phone_key = v_key;
    return;
  end if;

  insert into client_notes (phone_key, note, display_phone, client_name, updated_at, updated_by)
  values (v_key, v_note, trim(p_phone), nullif(trim(coalesce(p_client_name, '')), ''), now(), p_staff_id)
  on conflict (phone_key) do update
    set note = excluded.note,
        display_phone = coalesce(excluded.display_phone, client_notes.display_phone),
        client_name = coalesce(excluded.client_name, client_notes.client_name),
        updated_at = now(),
        updated_by = excluded.updated_by;
end; $$;
grant execute on function staff_set_client_note to anon;

-- ── EDIT THE APPOINTMENT ITSELF ──
--
-- Staff, not owner. Getting the service right is the stylist's job and she is
-- the one who knows; making her fetch the owner to correct a mistake is how
-- the calendar ends up wrong instead.
--
-- Both arguments are optional and null means "leave alone", so this can
-- change the service, the note, or both, and adding a third editable field
-- later does not disturb any caller.
--
-- NO OVERLAP CHECK, deliberately. A longer service can now run into whatever
-- is booked after it and nothing objects. That is the salon's choice: the
-- stylist is looking at her own day when she does this and usually knows the
-- next client is her 10-minute fringe trim. The cost of being wrong is an
-- overrun she can see coming; the cost of refusing is a stylist unable to
-- record what is actually happening.
create or replace function staff_update_booking(
  p_pin text, p_booking_id uuid,
  p_service_id uuid default null,
  p_notes text default null
) returns bookings language plpgsql security definer set search_path = public as $$
declare
  v_b bookings; v_duration int; v_dur_addons int; v_dur_ext int;
  v_has_addons boolean; v_has_ext boolean;
  v_price_from numeric; v_price_to numeric; v_on_consultation boolean;
  v_expected numeric := 0; v_is_estimate boolean := false;
  v_addon_total numeric; v_addon_from boolean;
  v_external text;
begin
  if not verify_staff_pin(p_pin) then raise exception 'Invalid PIN'; end if;

  select * into v_b from bookings where id = p_booking_id;
  if v_b.id is null then raise exception 'Booking not found'; end if;
  if v_b.status in ('cancelled', 'completed') then
    raise exception 'That appointment is already cancelled or completed';
  end if;

  -- Notes on their own: nothing else has to be recomputed.
  if p_service_id is null then
    update bookings set notes = nullif(trim(coalesce(p_notes, '')), '')
     where id = p_booking_id returning * into v_b;
    return v_b;
  end if;

  select duration_minutes, duration_with_addons_minutes, duration_with_extensions_minutes,
         price_from, price_to, price_on_consultation, external_booking_url
    into v_duration, v_dur_addons, v_dur_ext,
         v_price_from, v_price_to, v_on_consultation, v_external
    from services where id = p_service_id and active;
  if v_duration is null then raise exception 'Invalid or inactive service'; end if;
  if v_external is not null then
    raise exception 'That service is booked directly with the specialist, not through this system';
  end if;

  -- The stylist on the booking has to actually perform the new service, or
  -- the calendar says something that cannot happen.
  if not exists (
    select 1 from staff_services
     where staff_id = v_b.staff_id and service_id = p_service_id
  ) then
    raise exception 'This stylist does not perform that service';
  end if;

  -- Add-ons already on the booking decide the length, the same way they do
  -- when it is first made. They are kept: changing a colour from a root
  -- touch-up to an all-over does not mean she no longer wants the haircut.
  select count(*) > 0,
         bool_or(a.exclusive_group = 'extensions')
    into v_has_addons, v_has_ext
    from booking_addons ba join addons a on a.id = ba.addon_id
   where ba.booking_id = p_booking_id;

  if coalesce(v_has_ext, false) and v_dur_ext is not null then
    v_duration := v_dur_ext;
  elsif coalesce(v_has_addons, false) and v_dur_addons is not null then
    v_duration := v_dur_addons;
  end if;

  -- The price is a fact about the service, so it is recomputed rather than
  -- carried over. Leaving the old expected_total would put the wrong figure
  -- into the revenue report and into any cancellation fee worked out from it.
  if coalesce(v_on_consultation, false) then
    v_is_estimate := true;
  else
    v_expected := coalesce(v_price_from, 0);
    if v_price_to is not null then v_is_estimate := true; end if;
  end if;

  select coalesce(sum(a.price), 0), coalesce(bool_or(a.price_is_from), false)
    into v_addon_total, v_addon_from
    from booking_addons ba
    join addons a on a.id = ba.addon_id
    join service_addons sa on sa.addon_id = a.id and sa.service_id = p_service_id
   where ba.booking_id = p_booking_id;

  v_expected := v_expected + coalesce(v_addon_total, 0);
  v_is_estimate := v_is_estimate or coalesce(v_addon_from, false);

  update bookings set
    service_id = p_service_id,
    end_time = (v_b.start_time + make_interval(mins => v_duration)),
    expected_total = v_expected,
    expected_total_is_estimate = v_is_estimate,
    notes = case when p_notes is null then notes
                 else nullif(trim(p_notes), '') end
  where id = p_booking_id
  returning * into v_b;

  return v_b;
end; $$;
grant execute on function staff_update_booking to anon;
