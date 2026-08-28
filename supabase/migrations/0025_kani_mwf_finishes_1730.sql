-- Kani finishes at 17:30 on Monday, Wednesday and Friday - full stop, whether
-- or not the 11:00 colour was taken. The table held three different answers
-- for the same day: close_time 17:00, close_after_early 17:30, and a
-- staff_hours_override saying 18:00. Whichever one a given query happened to
-- read decided what the client was offered, which is why the same service
-- showed different last-slots depending on what else was booked.
update staff_day_policy p
   set close_time = time '17:30', close_after_early = time '17:30'
  from staff s
 where s.id = p.staff_id and s.name = 'Kani M.' and p.weekday in (1,3,5);

update staff_hours_override o
   set close_time = time '17:30'
  from staff s
 where s.id = o.staff_id and s.name = 'Kani M.' and o.weekday in (1,3,5);
