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
insert into staff (name, role, role_no, bio, bio_no, photo_url, instagram, bookable, external_booking_url, allow_overlap_booking, sort_order) values
(
  'Hassan K.', 'Founder & Master Stylist', 'Grunnlegger & Mesterstylisten',
  '25+ years of luxury experience across Oslo and Lebanon. A master of balayage and extensions, with an expert touch across every discipline.',
  '25+ års luksuserfaring fra Oslo og Libanon. En mester innen balayage og extensions, med et ekspertblikk på alle faglige disipliner.',
  './html/Pics/Team/Hasan.jpg', 'https://www.instagram.com/studioserena.hair?igsh=YnZhMmU2ZDRhNDI2&utm_source=qr',
  true, null, true, 1
),
(
  'Kani M.', 'Senior Stylist & Makeup Artist', 'Senior Stylisten & Makeup Artist',
  '8+ years of experience. Specialist in balayage, bridal artistry, makeup, and styling for all—including hijabis.',
  '8+ års erfaring. Spesialist på balayage brudestyling, makeup, og styling for alle – inkludert hijabis.',
  './html/Pics/Team/Kani.jpg', 'https://www.instagram.com/hairgasmofficial?igsh=b3poaWo2dTZwOXo4',
  true, null, false, 2
),
(
  'Taniya S.', 'Keratin & Hair Treatment Specialist', 'Keratin & Hårbehandlingsspesialist',
  'Extensive luxury experience. A highly talented specialist in Keratin and restorative hair treatments for all clients—including hijabis.',
  'Omfattende luksuserfaring. En svært talentfull spesialist på Keratin og gjenoppbyggende hårbehandlinger for alle – inkludert hijabis.',
  './html/Pics/Team/Taniya.jpg', 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu',
  true, null, false, 3
),
(
  'Heba K.', 'Creative Lead & Communications', 'Creative Lead & Kommunikasjon',
  'Specializing in digital artistry and high-end client relations. The architect of our online world and the voice behind every appointment.',
  'Spesialist innen digital kreativitet og førsteklasses kunderelasjoner. Arkitekten bak vår digitale verden og stemmen bak hver timebestilling.',
  './html/Pics/Team/Heba.jpg', 'https://www.instagram.com/studioserena.hair?igsh=YnZhMmU2ZDRhNDI2&utm_source=qr',
  false, null, false, 4
),
(
  'Pati', 'Nail Artist', 'Neglekunstner',
  'Our talented nail artist, specializing in gel, nail extensions, and creative nail art. Book your appointment directly through Timma.',
  'Vår talentfulle neglekunstner, spesialist på gele, neglforlengelse og kreativ neglekunst. Bestill time direkte via Timma.',
  null, 'https://www.instagram.com/studio.serena.nailsbypati?igsh=amFoY2Y2bTAzbTZq',
  false, 'https://timma.no/salong/patrycja-neglebar', false, 5
);
-- NOTE: Pati's photo_url is left null here — it currently lives as a Supabase
-- Storage object (gallery/team/*Pati*), fetch its public URL and update this row
-- once the project is restored, e.g.:
--   update staff set photo_url = '<public storage url>' where name = 'Pati';

-- ── SERVICES ──
-- Real prices, taken directly from /pricelist.html (the authoritative price
-- list the owner confirmed). Highlights and Balayage are the same service on
-- the real price list ("Highlights / Balayage", 3,500-4,000 NOK) so they're
-- seeded as one merged line, not two — see price_to for the range, and
-- price_on_consultation for Keratin/the 100g+ extensions tier which have no
-- fixed number at all.
-- color: default per-category palette shown on schedule.html's appointment
-- blocks (owner can change any of these later via the Owner Panel's Services tab).
insert into services (name, name_no, category, price_from, price_to, price_on_consultation, duration_minutes, fixed_times, image_url, color, featured, sort_order) values
-- Color Services — haircuts/toner/one-color only run at 13:00 & 16:30.
-- Balayage's fixed_times is left null here on purpose: its actual times
-- differ per stylist/weekday (Hassan vs. Kani), so it's driven entirely by
-- staff_service_schedule below instead of this generic column.
('One Color (Roots)', 'Én Farge (Røtter)', 'Color Services', 1500, null, false, 90, array['13:00','16:30']::time[], './html/Pics/Farge/Farge1.jpeg', '#E0A458', false, 1),
('One Color (All Hair)', 'Én Farge (Alt Hår)', 'Color Services', 2000, null, false, 90, array['13:00','16:30']::time[], './html/Pics/Farge/Farge1.jpeg', '#D68C3E', false, 2),
('Highlights / Balayage', 'Striper / Balayage', 'Color Services', 3500, 4000, false, 240, null, './html/Pics/Balayage/Blayage12.jpeg', '#C9A96E', true, 3),
('Toner', 'Toner', 'Color Services', 1000, null, false, 45, array['13:00','16:30']::time[], './html/Pics/Farge/Farge1.jpeg', '#EAC17E', false, 4),
-- Haircuts & Styling — just these two; Wash/Wavy Styling are priced add-ons
-- selected in the booking wizard, not separate services (matches the
-- simplified model actually live in js/booking.js's FALLBACK_SERVICES).
('Blowdry', 'Føn', 'Haircuts & Styling', 600, null, false, 30, null, './html/Pics/Styling/styling4.jpeg', '#7FB3C9', false, 5),
('Haircut + Blowdry', 'Klipp + Føn', 'Haircuts & Styling', 850, null, false, 60, array['13:00','16:30']::time[], './html/Pics/Haircut/Haircut5.jpeg', '#3D7A94', true, 6),
-- Hair Extensions
('Hair Extensions (50g)', 'Extensions (50g)', 'Hair Extensions', 3000, null, false, 180, null, './html/Pics/Extensions/cover.jpeg', '#A97FC9', true, 7),
('Hair Extensions (100-150g)', 'Extensions (100-150g)', 'Hair Extensions', null, null, true, 240, null, './html/Pics/Extensions/cover.jpeg', '#8C5EAD', false, 8),
-- Keratin & Hair Treatments (Taniya's specialties — price depends on length/thickness/type/product, no fixed number)
('Keratin Treatment', 'Keratinbehandling', 'Keratin & Hair Treatments', null, null, true, 150, null, './html/Pics/Treatment/cover.jpeg', '#6FAF7A', true, 9),
('Hair Botox', 'Hår Botox', 'Keratin & Hair Treatments', null, null, true, 120, null, './html/Pics/Treatment/cover.jpeg', '#549260', false, 10),
-- Bridal & Special Occasion
('Half Updo', 'Halv Oppsett', 'Bridal & Special Occasion', 1500, null, false, 45, null, './html/Pics/Brides/Bride5.jpeg', '#D98CA8', false, 11),
('Full Updo', 'Helt Oppsett', 'Bridal & Special Occasion', 2000, null, false, 75, null, './html/Pics/Brides/Bride5.jpeg', '#C46E8C', false, 12),
('Bridal Hair', 'Brudehår', 'Bridal & Special Occasion', 4000, null, false, 120, null, './html/Pics/Brides/Bride5.jpeg', '#A8506E', false, 13),
-- Consultation — its own category, free, 10 minutes, handled entirely as a
-- special case in book_appointment (not via fixed_times): bookable any open
-- slot up to 17:00, allowed to nest inside another booking as long as it
-- doesn't start at that booking's exact start time, capped at 2 per stylist
-- per day. See the "Consultation is a special case" block in the RPC.
('Consultation', 'Konsultasjon', 'Consultation', 0, null, false, 10, null, './html/Pics/Haircut/Haircut5.jpeg', '#9a9aa2', false, 14);

-- ── STAFF x SERVICES ──
-- Taniya is scoped to just her two specialties (Keratin Treatment, Hair Botox).
-- Hassan and Kani cover everything else between them.
insert into staff_services (staff_id, service_id)
select s.id, sv.id from staff s cross join services sv
where s.name = 'Taniya S.' and sv.category = 'Keratin & Hair Treatments';

insert into staff_services (staff_id, service_id)
select s.id, sv.id from staff s cross join services sv
where s.name in ('Hassan K.', 'Kani M.') and sv.category <> 'Keratin & Hair Treatments';

-- ── BALAYAGE SCHEDULE (per-stylist, per-weekday fixed times) ──
-- Hassan: bookable at 11:00 and 15:00, every weekday.
insert into staff_service_schedule (staff_id, service_id, weekday, start_time)
select s.id, sv.id, w.weekday, t.start_time
from staff s
cross join services sv
cross join (values (1),(2),(3),(4),(5)) as w(weekday)
cross join (values ('11:00'::time), ('15:00'::time)) as t(start_time)
where s.name = 'Hassan K.' and sv.name = 'Highlights / Balayage';

-- Kani: Tuesday & Thursday, both 11:00 and 15:00...
insert into staff_service_schedule (staff_id, service_id, weekday, start_time)
select s.id, sv.id, w.weekday, t.start_time
from staff s
cross join services sv
cross join (values (2),(4)) as w(weekday)
cross join (values ('11:00'::time), ('15:00'::time)) as t(start_time)
where s.name = 'Kani M.' and sv.name = 'Highlights / Balayage';

-- ...Monday/Wednesday/Friday, 11:00 only (no 15:00 slot those days).
insert into staff_service_schedule (staff_id, service_id, weekday, start_time)
select s.id, sv.id, w.weekday, '11:00'::time
from staff s
cross join services sv
cross join (values (1),(3),(5)) as w(weekday)
where s.name = 'Kani M.' and sv.name = 'Highlights / Balayage';

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
