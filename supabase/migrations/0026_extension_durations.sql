-- Extensions were being reserved for far longer than they take: 50g held
-- three hours for ninety minutes' work, and 100-150g held four.
--
-- The four-hour figure did more damage than just idle time. isFourHourBooking
-- treats anything >= 240 minutes as one of the day's big colour jobs, so
-- Extensions (100-150g) was counting against the one-four-hour-a-day cap and
-- being offered the balayage hours, when its own schedule rows say 13:00 and
-- 16:30. Two hours puts it back among the ordinary services where it belongs.
--
-- Bookings already taken keep the times they were made with - the one live
-- 50g booking stays 13:00-16:00. This changes what is offered from here on.
update services set duration_minutes = 90  where name = 'Hair Extensions (50g)';
update services set duration_minutes = 120 where name = 'Hair Extensions (100-150g)';
