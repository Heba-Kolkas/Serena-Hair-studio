-- ── A FULLY VERIFIED EXTENSIONS BOOKING NO LONGER WAITS FOR A CLICK ──
--
-- Every extensions booking went to 'pending' regardless of how much the
-- automated gate had already confirmed - consultation done, hair ordered,
-- deposit genuinely paid. The manual Confirm step existed to catch exactly
-- those three things; once the gate has already verified all of them, a
-- second human click checks nothing the gate did not already check, and
-- only adds a wait the client has no reason to be given.
--
-- The one case that still goes to Requests: the owner's own
-- booking_allowed_before_deposit override. That is a judgment call about
-- trusting a specific client to pay later, made once, in general - not a
-- decision about the specific date and time she has now picked. A final
-- look at that one still adds something the gate has not verified.
--
-- Superseded by 0044 and 0045 - see those for the overload-ambiguity fix
-- and the "override never actually let anyone book" bug this one shipped
-- with. Kept as its own migration because that is what actually ran.
create or replace function book_appointment_core(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text, p_addon_ids uuid[],
  p_allow_overlap boolean, p_enforce_horizon boolean, p_skip_confirmation boolean default false
) returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_duration int; v_end_time time; v_weekday int;
  v_open time; v_close time; v_closed boolean; v_staff_close time;
  v_fixed_times time[]; v_category text; v_service_name text;
  v_conflict int; v_booking bookings;
  v_allow_overlap boolean; v_schedule_count int; v_consult_count int;
  v_external text;
  v_price_from numeric; v_price_to numeric; v_on_consultation boolean;
  v_expected numeric := 0; v_is_estimate boolean := false;
  v_addon_total numeric; v_addon_from boolean;
  v_duration_with_addons int; v_has_addons boolean;
  v_duration_with_extensions int;
  v_day_limit int; v_scheduled_today int; v_daily_limited boolean;
  v_pol staff_day_policy%rowtype; v_has_pol boolean := false;
  v_requires_confirmation boolean;
  v_morning_end time;
  v_gap_boundary time := '15:00';
  v_colour_start time; v_other_today int; v_is_bridal boolean := false;
  v_side_early int; v_side_late int;
  v_colour_hold_over boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext(p_staff_id::text || p_date::text));

  select duration_minutes, duration_with_addons_minutes, duration_with_extensions_minutes,
         fixed_times, category, name,
         external_booking_url, price_from, price_to, price_on_consultation, daily_limited,
         requires_confirmation
    into v_duration, v_duration_with_addons, v_duration_with_extensions,
         v_fixed_times, v_category, v_service_name,
         v_external, v_price_from, v_price_to, v_on_consultation, v_daily_limited,
         v_requires_confirmation
    from services where id = p_service_id and active;
  if v_duration is null then raise exception 'Invalid or inactive service'; end if;
  v_is_bridal := v_category = 'Bridal';

  if v_external is not null then
    raise exception 'This service is booked directly with the specialist, not through this system';
  end if;

  if not exists (select 1 from staff_services where staff_id = p_staff_id and service_id = p_service_id) then
    raise exception 'This stylist does not perform this service';
  end if;

  if p_enforce_horizon then
    if p_date < current_date then
      raise exception 'That date has already passed';
    end if;
    if p_date > current_date + get_booking_horizon_days() then
      raise exception 'We are not taking bookings that far ahead yet';
    end if;
  end if;

  -- ── ADD-ONS ──
  v_has_addons := p_addon_ids is not null and coalesce(array_length(p_addon_ids, 1), 0) > 0;
  if v_has_addons then
    if v_category in ('Bridal', 'Special Occasions') then
      raise exception 'Add-ons are not available on bridal or updo bookings';
    end if;
    if exists (
      select 1 from unnest(p_addon_ids) as sel(id)
      where not exists (
        select 1 from addons a
        join service_addons sa on sa.addon_id = a.id
        where a.id = sel.id and a.active and sa.service_id = p_service_id
      )
    ) then
      raise exception 'One of the selected add-ons is not available for this service';
    end if;

    -- Two tiers of the same thing is a choice, not a combination.
    if exists (
      select a.exclusive_group from addons a
      where a.id = any(p_addon_ids) and a.exclusive_group is not null
      group by a.exclusive_group having count(*) > 1
    ) then
      raise exception 'Only one of those add-ons can be chosen';
    end if;

    -- ...and this stylist has to be able to do it. Extensions are Hassan's.
    if exists (
      select 1 from unnest(p_addon_ids) as sel(id)
      join addons a on a.id = sel.id
      where a.requires_service_id is not null
        and not exists (
          select 1 from staff_services ss
          where ss.staff_id = p_staff_id and ss.service_id = a.requires_service_id
        )
    ) then
      raise exception 'This stylist does not offer one of the selected add-ons';
    end if;
  end if;

  if v_has_addons and v_duration_with_addons is not null then
    v_duration := v_duration_with_addons;
  end if;

  if v_has_addons and exists (
    select 1 from addons a
    where a.id = any(p_addon_ids) and a.exclusive_group = 'extensions'
  ) then
    if v_duration_with_extensions is not null then
      v_duration := v_duration_with_extensions;
    end if;
  end if;

  if v_duration >= 240 then v_daily_limited := true; end if;

  v_end_time := p_start_time + (v_duration || ' minutes')::interval;

  v_weekday := extract(dow from p_date);

  if v_service_name = 'Consultation' then
    if p_start_time > '17:00' then
      raise exception 'Consultations must start by 17:00';
    end if;
    if not consultation_start_allowed(p_start_time) then
      raise exception 'That is when an appointment starts - please pick a time at least half an hour later';
    end if;
    select count(*) into v_consult_count from bookings
      where staff_id = p_staff_id and date = p_date and service_id = p_service_id
        and status <> 'cancelled';
    if v_consult_count >= 4 then
      raise exception 'This stylist already has 4 consultations booked today';
    end if;
  end if;

  select count(*) into v_schedule_count from staff_service_schedule
    where staff_id = p_staff_id and service_id = p_service_id;

  -- ── PER-STYLIST DAY POLICY ──
  select * into v_pol from staff_day_policy
    where staff_id = p_staff_id and weekday = v_weekday;
  v_has_pol := found;

  perform pg_advisory_xact_lock(hashtext(p_staff_id::text || ':' || p_date::text));

  select min(b.start_time) into v_colour_start
    from bookings b
    where b.staff_id = p_staff_id and b.date = p_date
      and b.status <> 'cancelled'
      and (b.end_time - b.start_time) >= interval '240 minutes';

  if v_has_pol and v_colour_start is null then
    if v_pol.colour_hold_days is not null
       and p_date - current_date <= v_pol.colour_hold_days then
      v_colour_hold_over := true;
    end if;
    select not exists (
      select 1 from staff_service_schedule sss
      join services sv6 on sv6.id = sss.service_id and sv6.daily_limited
      where sss.staff_id = p_staff_id and sss.weekday = v_weekday
        and not exists (
          select 1 from bookings b2
          where b2.staff_id = p_staff_id and b2.date = p_date
            and b2.status <> 'cancelled'
            and b2.start_time < sss.start_time + (sv6.duration_minutes * interval '1 minute')
            and b2.end_time > sss.start_time
        )
    ) or v_colour_hold_over into v_colour_hold_over;
  end if;

  if v_has_pol and not p_allow_overlap then
    if v_daily_limited or v_is_bridal then
      if v_pol.max_limited_per_day is not null then
        select count(*) into v_scheduled_today
          from bookings b
          where b.staff_id = p_staff_id and b.date = p_date
            and b.status <> 'cancelled'
            and (b.end_time - b.start_time) >= interval '240 minutes';
        if v_scheduled_today >= v_pol.max_limited_per_day then
          raise exception 'This stylist is already booked for a four-hour appointment that day';
        end if;
      end if;
    else
      if not v_pol.allow_other_services
         and (v_pol.late_fill_days is null
              or p_date - current_date > v_pol.late_fill_days) then
        raise exception 'This stylist only takes colour appointments on this day';
      end if;

      if v_pol.max_other_per_day is not null and not v_colour_hold_over then
        select count(*) into v_other_today
          from bookings b join services sv4 on sv4.id = b.service_id
          where b.staff_id = p_staff_id and b.date = p_date
            and b.status <> 'cancelled' and not sv4.daily_limited;
        if v_other_today >= v_pol.max_other_per_day then
          raise exception 'This stylist is fully booked for shorter appointments that day';
        end if;
      end if;
    end if;
  end if;

  if v_schedule_count > 0 then
    if not v_daily_limited then
      select max(b.end_time) into v_morning_end
        from bookings b join services sv5 on sv5.id = b.service_id
        where b.staff_id = p_staff_id and b.date = p_date
          and b.status <> 'cancelled' and not sv5.daily_limited
          and b.end_time > v_open and b.end_time <= v_gap_boundary;
    end if;

    if not (v_morning_end is not null
            and p_start_time >= v_morning_end
            and v_end_time <= v_gap_boundary
            and (
              extract(epoch from (p_start_time - v_morning_end))::int % (v_duration * 60) = 0
              or v_end_time = v_gap_boundary
            ))
       and not exists (
      select 1 from staff_service_schedule
      where staff_id = p_staff_id and service_id = p_service_id
        and weekday = v_weekday and start_time = p_start_time
    ) then
      raise exception 'This time is not available for this stylist';
    end if;
  elsif v_fixed_times is not null and not (p_start_time = any(v_fixed_times)) then
    raise exception 'This service can only be booked at its fixed times';
  end if;

  select open_time, close_time, closed into v_open, v_close, v_closed
    from business_hours where weekday = v_weekday;

  select close_time into v_staff_close from staff_hours_override
    where staff_id = p_staff_id and weekday = v_weekday;
  if v_staff_close is not null then v_close := v_staff_close; end if;

  if v_has_pol then
    if v_pol.open_time is not null then v_open := v_pol.open_time; end if;
    if v_pol.close_time is not null then v_close := v_pol.close_time; end if;
    if v_colour_start is not null then
      if v_colour_start <= v_open and v_pol.close_after_early is not null then
        v_close := v_pol.close_after_early;
      elsif v_colour_start > v_open and v_pol.open_before_late is not null then
        v_open := v_pol.open_before_late;
      end if;
    elsif not v_daily_limited and not v_is_bridal and not v_colour_hold_over then
      if v_pol.other_open_time is not null then v_open := v_pol.other_open_time; end if;

      if v_pol.other_split_at is not null
         and p_start_time < v_pol.other_split_at
         and v_end_time > v_pol.other_split_at then
        raise exception 'That time would leave no room for a colour appointment - please pick a time that finishes by %, or starts at % or later',
          to_char(v_pol.other_split_at, 'HH24:MI'), to_char(v_pol.other_split_at, 'HH24:MI');
      end if;

      if v_pol.other_split_at is not null and not p_allow_overlap then
        select
          count(*) filter (where b.end_time <= v_pol.other_split_at),
          count(*) filter (where b.start_time >= v_pol.other_split_at)
          into v_side_early, v_side_late
        from bookings b join services sv5 on sv5.id = b.service_id
        where b.staff_id = p_staff_id and b.date = p_date
          and b.status <> 'cancelled'
          and (b.end_time - b.start_time) < interval '240 minutes'
          and sv5.category <> 'Consultation';

        if v_side_early > 0 and p_start_time >= v_pol.other_split_at then
          raise exception 'This stylist already has a shorter appointment before % that day - please pick a time that finishes by %',
            to_char(v_pol.other_split_at, 'HH24:MI'), to_char(v_pol.other_split_at, 'HH24:MI');
        end if;
        if v_side_late > 0 and v_end_time <= v_pol.other_split_at then
          raise exception 'This stylist already has a shorter appointment after % that day - please pick a time that starts at % or later',
            to_char(v_pol.other_split_at, 'HH24:MI'), to_char(v_pol.other_split_at, 'HH24:MI');
        end if;
      end if;
    end if;
  end if;

  if v_closed or v_open is null or p_start_time < v_open
     or (v_schedule_count = 0 and v_fixed_times is null and v_end_time > v_close) then
    raise exception 'Outside business hours';
  end if;

  select count(*) into v_conflict from blocked_slots
    where (staff_id = p_staff_id or staff_id is null) and date = p_date
      and start_time < v_end_time and end_time > p_start_time;
  if v_conflict > 0 then raise exception 'Slot is blocked'; end if;

  select allow_overlap_booking into v_allow_overlap from staff where id = p_staff_id;

  select count(*) into v_conflict from bookings b
    where b.staff_id = p_staff_id and b.date = p_date and b.status <> 'cancelled'
      and b.start_time < v_end_time and b.end_time > p_start_time
      and not (
        (
          coalesce(v_allow_overlap, false)
          and v_category not in ('Bridal', 'Special Occasions')
          and (b.end_time - b.start_time) = interval '240 minutes'
          and b.start_time in ('11:00', '15:00')
          and (
            (b.start_time = '11:00' and p_start_time = '13:00')
            or (b.start_time = '15:00' and p_start_time = '17:00')
          )
        )
        or v_service_name = 'Consultation'
      );
  if v_conflict > 0 and not p_allow_overlap then raise exception 'Slot no longer available'; end if;

  -- ── EXPECTED TOTAL ──
  if coalesce(v_on_consultation, false) then
    v_is_estimate := true;
  else
    v_expected := coalesce(v_price_from, 0);
    if v_price_to is not null then v_is_estimate := true; end if;
  end if;

  select coalesce(sum(a.price), 0),
         coalesce(bool_or(a.price_is_from), false)
    into v_addon_total, v_addon_from
    from addons a
    join service_addons sa on sa.addon_id = a.id and sa.service_id = p_service_id
    where p_addon_ids is not null and a.id = any(p_addon_ids);

  v_expected := v_expected + coalesce(v_addon_total, 0);
  v_is_estimate := v_is_estimate or coalesce(v_addon_from, false);

  insert into bookings (
    service_id, staff_id, customer_name, customer_email, customer_phone,
    date, start_time, end_time, notes, expected_total, expected_total_is_estimate, status
  )
  values (
    p_service_id, p_staff_id, p_customer_name, p_customer_email, p_customer_phone,
    p_date, p_start_time, v_end_time, p_notes, v_expected, v_is_estimate,
    case when (v_requires_confirmation or exists (
           select 1 from addons a
           where p_addon_ids is not null and a.id = any(p_addon_ids)
             and a.requires_confirmation
         )) and not p_skip_confirmation then 'pending'::booking_status
         else 'confirmed'::booking_status end
  )
  returning * into v_booking;

  if v_booking.status = 'pending' then
    update bookings set hold_expires_at = now() + interval '2 days'
      where id = v_booking.id returning * into v_booking;
  end if;

  if v_has_addons then
    insert into booking_addons (booking_id, addon_id, name_at_booking, price_at_booking, price_is_from)
    select v_booking.id, a.id, a.name, a.price, a.price_is_from
    from addons a
    join service_addons sa on sa.addon_id = a.id and sa.service_id = p_service_id
    where a.id = any(p_addon_ids)
    order by a.sort_order;
  end if;

  return v_booking;
end; $$;

-- ── PART TWO: THE PUBLIC WRAPPER COMPUTES THE SKIP FLAG ──
--
-- Looks up the same order the gate itself would find - most recent
-- non-cancelled order for this phone, matched by phone_key - and passes
-- through whether its deposit is genuinely paid. Deliberately deposit_paid
-- only, not booking_allowed_before_deposit: the override is a judgement
-- call about trusting a client to pay later, made once in general, not a
-- decision about the specific date and time she has now picked. That case
-- still goes to Requests for a final look.
create or replace function book_appointment(
  p_service_id uuid, p_staff_id uuid, p_date date, p_start_time time,
  p_customer_name text, p_customer_email text, p_customer_phone text,
  p_notes text default null, p_addon_ids uuid[] default null,
  p_terms_version int default null,
  p_first_name text default null, p_last_name text default null,
  p_instagram text default null, p_sms_consent boolean default false
) returns bookings language plpgsql security definer set search_path = public as $$
declare v_current int; v_booking bookings; v_full text; v_skip_confirm boolean := false;
begin
  if not booking_rate_ok(p_customer_phone) then
    raise exception 'That is a lot of bookings in a short time. Please ring the salon and we will help.';
  end if;
  insert into booking_attempts (phone_key) values (phone_key(p_customer_phone));

  declare v_ext_block text;
  begin
    v_ext_block := extensions_booking_block(p_customer_phone, p_service_id, p_addon_ids, p_date);
    if v_ext_block is not null then raise exception '%', v_ext_block; end if;
  end;

  if client_must_call(p_customer_phone, p_service_id) then
    raise exception 'Please call the salon to book this service';
  end if;

  select version into v_current from get_current_booking_terms();
  if p_terms_version is null then
    raise exception 'Please accept the cancellation policy before booking';
  end if;
  if v_current is not null and p_terms_version <> v_current then
    raise exception 'The cancellation policy has changed - please reload and read it again';
  end if;

  if coalesce(trim(p_first_name), '') <> '' or coalesce(trim(p_last_name), '') <> '' then
    if coalesce(trim(p_first_name), '') = '' then raise exception 'Please give your first name'; end if;
    if coalesce(trim(p_last_name), '') = '' then raise exception 'Please give your last name'; end if;
    v_full := trim(p_first_name) || ' ' || trim(p_last_name);
  else
    v_full := trim(coalesce(p_customer_name, ''));
    if v_full = '' then raise exception 'Please give your name'; end if;
  end if;

  select coalesce(o.deposit_paid, false) into v_skip_confirm
    from extension_orders o
   where phone_key(o.customer_phone) = phone_key(p_customer_phone)
     and coalesce(o.status, '') <> 'cancelled'
   order by o.ordered_at desc nulls last
   limit 1;

  v_booking := book_appointment_core(
    p_service_id, p_staff_id, p_date, p_start_time,
    v_full, p_customer_email, p_customer_phone,
    p_notes, p_addon_ids, false, true, coalesce(v_skip_confirm, false));

  update bookings set
    terms_version = p_terms_version,
    terms_accepted_at = now(),
    customer_first_name = nullif(trim(coalesce(p_first_name, '')), ''),
    customer_last_name  = nullif(trim(coalesce(p_last_name, '')), ''),
    customer_instagram  = instagram_handle(p_instagram),
    sms_consent         = coalesce(p_sms_consent, false)
  where id = v_booking.id
  returning * into v_booking;

  return v_booking;
end; $$;
grant execute on function book_appointment to anon;
