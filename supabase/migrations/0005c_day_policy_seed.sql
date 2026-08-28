insert into staff_day_policy (
  staff_id, weekday, max_limited_per_day, allow_other_services, max_other_per_day,
  open_time, close_time, other_open_time, other_split_at, close_after_early, open_before_late,
  late_fill_days, colour_hold_days
)
-- Mon / Wed / Fri
select s.id, w.weekday, 1, true, 2,
       '11:00'::time, '17:00'::time, '12:00'::time, '15:00'::time, '17:30'::time, '12:00'::time,
       null::int, 1
from staff s cross join (values (1), (3), (5)) as w(weekday)
where s.name = 'Kani M.'
union all
-- Tue / Thu
select s.id, w.weekday, 2, false, null::int,
       '11:00'::time, '17:00'::time, '12:00'::time, '15:00'::time, '18:00'::time, '11:00'::time,
       3, 1
from staff s cross join (values (2), (4)) as w(weekday)
where s.name = 'Kani M.';

alter table staff_day_policy enable row level security;
create policy "public read staff_day_policy" on staff_day_policy for select using (true);
create policy "admin manage staff_day_policy" on staff_day_policy for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create or replace function get_staff_day_policies()
returns setof staff_day_policy language sql stable security definer set search_path = public as $$
  select * from staff_day_policy;
$$;
grant execute on function get_staff_day_policies to anon;
