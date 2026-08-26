-- Seed data for the booking schema (0001_booking_schema.sql).
-- NOT YET APPLIED — see note at the top of 0001. Run this once, right after 0001.

-- ── BUSINESS HOURS (real data — Mon-Fri 11:00-17:30, Sat/Sun closed) ──
insert into business_hours (weekday, open_time, close_time, closed) values
  (0, null, null, true),        -- Sunday
  (1, '11:00', '17:30', false), -- Monday
  (2, '11:00', '17:30', false), -- Tuesday
  (3, '11:00', '17:30', false), -- Wednesday
  (4, '11:00', '17:30', false), -- Thursday
  (5, '11:00', '17:30', false), -- Friday
  (6, null, null, true);        -- Saturday

-- ── STAFF (migrated from the existing team/members.json + hardcoded team cards) ──
-- Hassan is the only stylist with allow_overlap_booking — see the note on
-- that column in 0001 and the Balayage schedule block further down.
insert into staff (name, role, role_no, bio, bio_no, photo_url, instagram, bookable, external_booking_url, allow_overlap_booking, allow_manual_overlap, sort_order) values
(
  'Hassan K.', 'Founder & Master Stylist', 'Grunnlegger & Mesterstylisten',
  '25+ years of luxury experience across Oslo and Lebanon. A master of balayage and extensions, with an expert touch across every discipline.',
  '25+ års luksuserfaring fra Oslo og Libanon. En mester innen balayage og extensions, med et ekspertblikk på alle faglige disipliner.',
  './html/Pics/Team/Hassan.jpeg', 'https://www.instagram.com/studioserena.hair?igsh=YnZhMmU2ZDRhNDI2&utm_source=qr',
  true, null, true, true, 1
),
(
  'Kani M.', 'Senior Stylist & Makeup Artist', 'Senior Stylisten & Makeup Artist',
  '8+ years of experience. Specialist in balayage, bridal artistry, makeup, and styling for all—including hijabis.',
  '8+ års erfaring. Spesialist på balayage brudestyling, makeup, og styling for alle – inkludert hijabis.',
  './html/Pics/Team/Kani.jpeg', 'https://www.instagram.com/hairgasmofficial?igsh=b3poaWo2dTZwOXo4',
  true, null, false, true, 2
),
(
  'Taniya S.', 'Keratin & Hair Treatment Specialist', 'Keratin & Hårbehandlingsspesialist',
  'Extensive luxury experience. A highly talented specialist in Keratin and restorative hair treatments for all clients—including hijabis.',
  'Omfattende luksuserfaring. En svært talentfull spesialist på Keratin og gjenoppbyggende hårbehandlinger for alle – inkludert hijabis.',
  './html/Pics/Team/Taniya.jpeg', 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu',
  true, null, false, false, 3
),
(
  'Heba K.', 'Creative Lead & Communications', 'Creative Lead & Kommunikasjon',
  'Specializing in digital artistry and high-end client relations. The architect of our online world and the voice behind every appointment.',
  'Spesialist innen digital kreativitet og førsteklasses kunderelasjoner. Arkitekten bak vår digitale verden og stemmen bak hver timebestilling.',
  './html/Pics/Team/Heba.jpeg', 'https://www.instagram.com/studioserena.hair?igsh=YnZhMmU2ZDRhNDI2&utm_source=qr',
  false, null, false, false, 4
),
(
  'Pati', 'Nail Artist', 'Neglekunstner',
  'Our talented nail artist, specializing in gel, nail extensions, and creative nail art. Book your appointment directly through Timma.',
  'Vår talentfulle neglekunstner, spesialist på gele, neglforlengelse og kreativ neglekunst. Bestill time direkte via Timma.',
  null, 'https://www.instagram.com/studio.serena.nailsbypati?igsh=amFoY2Y2bTAzbTZq',
  false, 'https://timma.no/salong/patrycja-neglebar', false, false, 5
);
-- NOTE: Pati's photo_url is left null here — it currently lives as a Supabase
-- Storage object (gallery/team/*Pati*), fetch its public URL and update this row
-- once the project is restored, e.g.:
--   update staff set photo_url = '<public storage url>' where name = 'Pati';

-- ── SERVICES ──
-- Transcribed line for line from the owner's printed price list (the
-- authoritative source — every figure here appears on it verbatim, in kr).
--
-- Prices marked price_is_from on the list ("from 3,750 kr") use price_from
-- with price_to left null: it's a floor, not a range. Reverse balayage is the
-- one colour service quoted as an exact figure. Bridal carries BOTH a
-- 4,000 guideline and price_on_consultation, per the owner: the card on the
-- list sends people to a consultation, but they still want a number shown.
--
-- Durations come from the owner's own rule, not the list (which omits them):
--   · anything in the balayage/highlight family — 4 hours, and add-ons never
--     extend it (duration_with_addons_minutes stays null)
--   · root touch-up / all-over colour — 90 minutes, but 120 the moment any
--     add-on is attached (see duration_with_addons_minutes)
--   · haircuts 60 · styling 60 · toner 60 · updos 90 · bridal 240
--
-- fixed_times is set on nothing, because 13:00 and 16:30 were never a
-- salon-wide rule. They are HASSAN'S two slots — the times he takes anything
-- that isn't a four-hour colour, every day, whether or not a colour is
-- running. They line up with his overlap pairing by design: a second client
-- at 13:00 while an 11:00 colour processes, 16:30 while a 15:00 one does.
-- Those rows live in staff_service_schedule below, so they apply to him and
-- not to Kani, whose day is shaped by her own hours instead.
insert into services (name, name_no, category, price_from, price_to, price_on_consultation, price_is_from, daily_limited, duration_minutes, duration_with_addons_minutes, fixed_times, image_url, color, featured, sort_order) values
-- Balayage & Highlights — 4 hours each, times set per stylist below.
('Balayage / Highlights', 'Balayage / Striper', 'Balayage & Highlights', 3750, null, false, true, true, 240, null, null, './html/Pics/Covers/balayage-and-highlights.jpeg', '#C9A96E', true, 1),
('Half Head Foil', 'Halv Folie', 'Balayage & Highlights', 3000, null, false, true, true, 240, null, null, './html/Pics/Covers/balayage-and-highlights.jpeg', '#D4B87E', false, 2),
('Full Head Foil', 'Hel Folie', 'Balayage & Highlights', 3750, null, false, true, true, 240, null, null, './html/Pics/Covers/balayage-and-highlights.jpeg', '#BF9A5E', false, 3),
-- Colour — root touch-up and all-over stretch to 120 min with any add-on.
('Root Touch-Up', 'Ansatsfarge', 'Color', 1600, null, false, true, false, 90, 120, null, './html/Pics/Covers/color.jpeg', '#E0A458', false, 4),
('All-Over Color', 'Helfarge', 'Color', 2100, null, false, true, false, 90, 120, null, './html/Pics/Covers/color.jpeg', '#D68C3E', false, 5),
-- Reverse balayage is going darker, but it's still 4 hours of colour work.
('Reverse Balayage', 'Omvendt Balayage', 'Color', 3000, null, false, false, true, 240, null, null, './html/Pics/Covers/color.jpeg', '#A8763E', false, 6),
('Toner', 'Toner', 'Color', 1250, null, false, true, false, 60, null, null, './html/Pics/Covers/color.jpeg', '#EAC17E', false, 7),
-- Haircuts — every combination on the list is its own priced line, so there
-- are no wash/styling add-ons to bolt on. All 60 minutes.
('Haircut + Blowdry (without wash)', 'Klipp + Føn (uten vask)', 'Haircuts & Styling', 950, null, false, false, false, 60, null, null, './html/Pics/Covers/haircuts-and-styling.jpeg', '#3D7A94', true, 8),
('Haircut + Wash + Blowdry', 'Klipp + Vask + Føn', 'Haircuts & Styling', 1150, null, false, false, false, 60, null, null, './html/Pics/Covers/haircuts-and-styling.jpeg', '#4A88A2', false, 9),
('Haircut + Wash + Blowdry + Styling', 'Klipp + Vask + Føn + Styling', 'Haircuts & Styling', 1250, null, false, false, false, 60, null, null, './html/Pics/Covers/haircuts-and-styling.jpeg', '#5796B0', false, 10),
('Haircut + Wash + Mask + Blowdry', 'Klipp + Vask + Maske + Føn', 'Haircuts & Styling', 1350, null, false, false, false, 60, null, null, './html/Pics/Covers/haircuts-and-styling.jpeg', '#2F6B84', false, 11),
-- Styling — normal 15-minute grid, 60 minutes each.
('Blowdry / Light Styling', 'Føn / Lett Styling', 'Styling', 680, null, false, false, false, 60, null, null, './html/Pics/Covers/styling.jpeg', '#7FB3C9', false, 12),
('Wash + Blowdry', 'Vask + Føn', 'Styling', 750, null, false, false, false, 60, null, null, './html/Pics/Covers/styling.jpeg', '#8FC0D4', false, 13),
('Wash + Blowdry + Wavy Styling', 'Vask + Føn + Bølgestyling', 'Styling', 890, null, false, false, false, 60, null, null, './html/Pics/Covers/styling.jpeg', '#6FA5BC', false, 14),
-- Special occasions — 90 minutes.
('Half Updo', 'Halv Oppsett', 'Special Occasions', 1500, null, false, true, false, 90, null, null, './html/Pics/Covers/bridal-and-updos.jpeg', '#D98CA8', false, 15),
('Full Updo', 'Helt Oppsett', 'Special Occasions', 2500, null, false, true, false, 90, null, null, './html/Pics/Covers/bridal-and-updos.jpeg', '#C46E8C', false, 16),
-- Bridal — 4 hours, quoted at consultation with ~4,000 shown as a guideline.
('Bridal Hair', 'Brudehår', 'Bridal', 4000, null, true, false, false, 240, null, array['11:00']::time[], './html/Pics/Covers/bridal-and-updos.jpeg', '#A8506E', false, 17),
-- Hair Extensions are not on the printed price list but the studio still
-- books them here, unchanged, at the owner's instruction.
('Hair Extensions (50g)', 'Extensions (50g)', 'Hair Extensions', 3000, null, false, false, false, 180, null, null, './html/Pics/Covers/hair-extensions.jpeg', '#A97FC9', true, 18),
('Hair Extensions (100-150g)', 'Extensions (100-150g)', 'Hair Extensions', null, null, true, false, false, 240, null, null, './html/Pics/Covers/hair-extensions.jpeg', '#8C5EAD', false, 19),
-- Keratin & Hair Botox stay listed but book through Taniya's Instagram —
-- migration 0005 sets external_booking_url on this whole category.
('Keratin Treatment', 'Keratinbehandling', 'Keratin & Hair Treatments', null, null, true, false, false, 150, null, null, './html/Pics/Covers/keratin-and-treatments.jpeg', '#6FAF7A', false, 20),
('Hair Botox', 'Hår Botox', 'Keratin & Hair Treatments', null, null, true, false, false, 120, null, null, './html/Pics/Covers/keratin-and-treatments.jpeg', '#549260', false, 21),
-- Consultation — free, 10 minutes, special-cased throughout book_appointment.
('Consultation', 'Konsultasjon', 'Consultation', 0, null, false, false, false, 10, null, null, './html/Pics/Covers/haircuts-and-styling.jpeg', '#9a9aa2', false, 22);

-- ── STAFF x SERVICES ──
-- Taniya's two specialties are handled in 0005, which takes her out of the
-- booking system entirely and empties her staff_services rows. Hassan and
-- Kani cover everything that still books here.
insert into staff_services (staff_id, service_id)
select s.id, sv.id from staff s cross join services sv
where s.name = 'Taniya S.' and sv.category = 'Keratin & Hair Treatments';

-- Hassan covers everything that still books here.
insert into staff_services (staff_id, service_id)
select s.id, sv.id from staff s cross join services sv
where s.name = 'Hassan K.' and sv.category <> 'Keratin & Hair Treatments';

-- Kani the same, minus extensions — fitting those is Hassan's work.
insert into staff_services (staff_id, service_id)
select s.id, sv.id from staff s cross join services sv
where s.name = 'Kani M.'
  and sv.category not in ('Keratin & Hair Treatments', 'Hair Extensions');

-- ── 4-HOUR LIGHTENING SCHEDULE (per-stylist, per-weekday fixed times) ──
-- Balayage / Highlights, both foil services and Reverse balayage all run 240
-- minutes, so they can only start at the two slots that fit a working day.
-- Hassan: 11:00 and 15:00, every weekday.
insert into staff_service_schedule (staff_id, service_id, weekday, start_time)
select s.id, sv.id, w.weekday, t.start_time
from staff s
cross join services sv
cross join (values (1),(2),(3),(4),(5)) as w(weekday)
cross join (values ('11:00'::time), ('15:00'::time)) as t(start_time)
where s.name = 'Hassan K.'
  and sv.name in ('Balayage / Highlights', 'Half Head Foil', 'Full Head Foil', 'Reverse Balayage');

-- Kani: 11:00 and 15:00, every weekday — same pattern as Hassan.
--
-- Either start leaves a clear four-hour window on the other side of the day,
-- which is what lets a second client book around the colour without any
-- overlap: an 11:00 balayage runs to 15:00 and leaves the afternoon (the
-- 16:30 fixed slot, or the open grid up to her 18:00 close on Mon/Wed/Fri);
-- a 15:00 balayage leaves the whole 11:00-15:00 morning (the 13:00 fixed
-- slot, or the open grid). Kani doesn't take overlapping bookings online, so
-- the second appointment has to sit entirely outside the colour — which is
-- exactly what those two fixed times already arrange.
insert into staff_service_schedule (staff_id, service_id, weekday, start_time)
select s.id, sv.id, w.weekday, t.start_time
from staff s
cross join services sv
cross join (values (1),(2),(3),(4),(5)) as w(weekday)
cross join (values ('11:00'::time), ('15:00'::time)) as t(start_time)
where s.name = 'Kani M.'
  and sv.name in ('Balayage / Highlights', 'Half Head Foil', 'Full Head Foil', 'Reverse Balayage');

-- ── HASSAN'S TWO SLOTS ──
-- Everything he does other than the four-hour colours runs at 13:00 or 16:30,
-- every weekday, empty day or not. The same two times are what his overlap
-- pairing uses, which is why a second client fits alongside a colour without
-- any of this needing a special case.
insert into staff_service_schedule (staff_id, service_id, weekday, start_time)
select s.id, sv.id, w.weekday, t.start_time
from staff s
cross join services sv
cross join (values (1), (2), (3), (4), (5)) as w(weekday)
cross join (values ('13:00'::time), ('16:30'::time)) as t(start_time)
where s.name = 'Hassan K.'
  and sv.name in ('Toner',
                  'Root Touch-Up',
                  'All-Over Color',
                  'Haircut + Blowdry (without wash)',
                  'Haircut + Wash + Blowdry',
                  'Haircut + Wash + Blowdry + Styling',
                  'Haircut + Wash + Mask + Blowdry',
                  'Blowdry / Light Styling',
                  'Wash + Blowdry',
                  'Wash + Blowdry + Wavy Styling',
                  -- Fitting or repairing extensions slots the same way.
                  'Hair Extensions (50g)',
                  'Hair Extensions (100-150g)');

-- Updos start at 11:00 for him. Ninety minutes there leaves the rest of the
-- day open for a colour touch-up, haircut, toner or blowdry, and still leaves
-- the 15:00 balayage bookable — the same shape as everything else: take the
-- morning and the afternoon colour survives.
insert into staff_service_schedule (staff_id, service_id, weekday, start_time)
select s.id, sv.id, w.weekday, '11:00'::time
from staff s
cross join services sv
cross join (values (1), (2), (3), (4), (5)) as w(weekday)
where s.name = 'Hassan K.'
  and sv.name in ('Half Updo', 'Full Updo');

-- Kani has no fixed times of her own, updos included. Ninety minutes of updo
-- is ordinary shorter work for her, so it goes wherever her day policy allows
-- it — which already keeps a colour start alive and packs against whatever is
-- booked. Pinning it to one hour would only cost bookings.

-- ── KANI'S HOURS OVERRIDE ──
-- Kani takes clients until 18:00 on Mon/Wed/Fri, later than the salon's
-- general 17:30 close on those days.
insert into staff_hours_override (staff_id, weekday, close_time)
select s.id, w.weekday, '18:00'::time
from staff s
cross join (values (1),(3),(5)) as w(weekday)
where s.name = 'Kani M.';

-- ── PINS ──
-- Both PLACEHOLDERS — change these from schedule.html's own PIN-management
-- screen (owner mode) before sharing the link with the team. staff_pin is
-- the everyday shared PIN; owner_pin unlocks the extra owner-only tabs in
-- the same app (see verify_staff_pin() / is_owner_pin() in 0001). Keep them
-- different values, or anyone with the staff PIN gets owner access too.
insert into app_settings (key, value) values
  ('staff_pin', '1234'),
  ('owner_pin', '9999');
