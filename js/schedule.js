import {
  verifyStaffPin, fetchStaffSchedule, updateBookingStatusStaff, fetchBookableStaff,
  fetchBlockedSlotsRange, addStaffUnavailable, removeStaffUnavailable, searchStaffBookings,
  fetchActiveServices, updateServiceColor, isOwnerPin,
  fetchAllServicesAdmin, upsertServiceAdmin, deleteServiceAdmin,
  fetchAllStaffAdmin, upsertStaffAdmin,
  fetchBookingsAdmin, updateBookingStatusAdmin, rescheduleBookingAdmin, completeBookingAdmin,
  upsertBusinessHoursAdmin, addBlockedSlotAdmin, removeBlockedSlotAdmin,
  fetchActivityLogAdmin, setPinAdmin, staffBookAppointment, setBookingHorizonAdmin, fetchBookingHorizonDays, fetchBookingsInRangeAdmin, addBlockedRangeAdmin, fetchPendingBookingsAdmin, decideBookingAdmin, sendBookingEmail, sendMessage, fetchSmsBalance, fetchPendingCount,
  waiveCancellationFee, unwaiveCancellationFee, setCancellationFee,
  exportAccounting, exportClients, fetchDailyTotals,
  addExtensionOrder, fetchExtensionOrders, markExtensionsArrived,
  markExtensionsNotified, setExtensionOrderStatus, fetchExtensionHistory, markDepositPaid,
  fetchExtensionOrdersAtRisk, sendExtensionsArrived,
  fetchBusinessHours, fetchStaffHoursOverrides, uploadOwnerImage, bookAppointment,
  fetchRevenueAdmin, fetchStaffServicesAdmin, setStaffServicesAdmin,
  fetchStaffHoursOverridesAdmin, upsertStaffHoursOverrideAdmin, deleteStaffHoursOverrideAdmin,
  fetchAddonsAdmin, upsertAddonAdmin, deleteAddonAdmin, fetchServiceAddonsAdmin, setAddonServicesAdmin,
} from '/js/supabase-client.js';

const PIN_KEY = 'ss_staff_pin';
const IDENTITY_KEY = 'ss_staff_identity';
const STAFF_FILTER_KEY = 'ss_schedule_staff_filter';
const PX_PER_HOUR = 96;
const PX_PER_MIN = PX_PER_HOUR / 60;
// Must match .sched-col-header's total height (2rem + 0.5rem margin, 16px
// root) in css/schedule.css — each column's timeline starts below its own
// header, so the gutter's labels need the same offset to line up with it.
const HEADER_OFFSET_PX = 40;
const GRID_DEFAULT_START = 11 * 60; // 11:00, matches business_hours
const GRID_DEFAULT_END = 17 * 60 + 30; // 17:30
// How far the day strip runs. Two weeks was set when the schedule was capped
// at 1100px; on a wide monitor that left the strip half empty while the owner
// swiped to reach next week. It now fills whatever width there is, keeping
// cells wide enough to read, and still falls back to a fortnight on a laptop.
const DAY_CELL_TARGET_PX = 74;
const DAYS_AHEAD_MIN = 13;   // today + 13 = two weeks
const DAYS_AHEAD_MAX = 34;   // today + 34 = five weeks; beyond that cells crowd
let DAYS_AHEAD = DAYS_AHEAD_MIN;

function computeDaysAhead() {
  const el = document.getElementById('dayStrip');
  const width = (el && el.clientWidth) || (window.innerWidth - 180);
  const fits = Math.floor(width / DAY_CELL_TARGET_PX) - 1;
  return Math.max(DAYS_AHEAD_MIN, Math.min(DAYS_AHEAD_MAX, fits));
}
const HISTORY_DAYS_BACK = 30;

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
function todayStr() { return toDateStr(new Date()); }
function revenueRangeFor(preset) {
  const today = todayStr();
  const now = new Date(today + 'T00:00:00');
  const dow = now.getDay(); // 0 = Sunday
  const thisMonday = addDays(today, dow === 0 ? -6 : 1 - dow);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: thisMonday, to: today }; // Monday of this week → today
  if (preset === 'lastweek') return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) }; // full previous Mon–Sun
  if (preset === 'last2weeks') return { from: addDays(today, -13), to: today }; // rolling 14 days
  if (preset === 'month') return { from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  if (preset === 'year') return { from: toDateStr(new Date(now.getFullYear(), 0, 1)), to: today };
  return { from: '2020-01-01', to: today }; // all time
}

// Positions a calendar-popover relative to the SCREEN (its trigger button's
// actual on-screen location), not its DOM parent — a parent with
// overflow:auto (like the Owner Panel's scrolling tab content) clips
// position:absolute children that poke outside its bounds, and a plain
// right:0/left:0 CSS anchor breaks depending on which side of its row the
// trigger sits on. Fixed positioning + a live bounding-rect sidesteps both,
// and clamps to the viewport so it never runs off any edge.
function positionPopoverNear(triggerEl, popoverEl) {
  const rect = triggerEl.getBoundingClientRect();
  const margin = 8;
  const width = popoverEl.offsetWidth || 260;
  let left = rect.left;
  if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
  if (left < margin) left = margin;
  let top = rect.bottom + 6;
  const height = popoverEl.offsetHeight || 320;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 6);
  popoverEl.style.position = 'fixed';
  popoverEl.style.top = top + 'px';
  popoverEl.style.left = left + 'px';
  popoverEl.style.right = 'auto';
}

// Supabase is paused — fallback preview data mirrors the real seed/schema.
const FALLBACK_PIN = '1234';
const FALLBACK_OWNER_PIN = '9999';
// Only bookable stylists get a column — Taniya books Keratin/Hair Botox
// herself over Instagram now, and Heba/Pati never took appointments here.
const FALLBACK_STAFF = [
  { id: 'staff-hassan', name: 'Hassan K.', allow_overlap_booking: true, allow_manual_overlap: true },
  { id: 'staff-kani', name: 'Kani M.', allow_overlap_booking: false, allow_manual_overlap: true },
];
// Hassan's Balayage overlap pairing (mirrors book_appointment/booking.js): an
// 11:00 or 15:00 Balayage always visually reserves the paired 13:00/17:00
// half-slot for a second client, even before anyone's actually booked it —
// not just once a real overlapping booking exists.
const OVERLAP_ANCHORS = { 660: 780, 900: 1020 };
const BALAYAGE_DURATION = 240;
const FALLBACK_SERVICES = [
  { id: 'svc-balayage', name: 'Balayage / Highlights', category: 'Balayage & Highlights', color: '#C9A96E' },
  { id: 'svc-allover', name: 'All-Over Color', category: 'Color', color: '#D68C3E' },
  { id: 'svc-toner', name: 'Toner', category: 'Color', color: '#EAC17E' },
  { id: 'svc-cut-blowdry', name: 'Haircut + Blowdry (without wash)', category: 'Haircuts & Styling', color: '#3D7A94' },
  { id: 'svc-blowdry', name: 'Blowdry / Light Styling', category: 'Styling', color: '#7FB3C9' },
];
function fallbackWindowBookings(today) {
  return [
    { id: 'demo-1', date: today, start_time: '11:00:00', end_time: '15:00:00', status: 'confirmed', customer_name: 'Sara Nilsen', customer_phone: '+4791234567', customer_email: 'sara.nilsen@example.com', notes: null, service_name: 'Balayage / Highlights', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'demo-2', date: today, start_time: '13:00:00', end_time: '14:00:00', status: 'confirmed', customer_name: 'Mona Iqbal', customer_phone: '+4790112233', customer_email: 'mona.iqbal@example.com', notes: 'Allergic to ammonia-based products - check before use.', service_name: 'Haircut + Blowdry (without wash)', service_color: '#3D7A94', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'demo-3', date: today, start_time: '11:00:00', end_time: '12:30:00', status: 'confirmed', customer_name: 'Julie Berg', customer_phone: '+4793344556', customer_email: 'julie.berg@example.com', notes: null, service_name: 'All-Over Color', service_color: '#D68C3E', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
    { id: 'demo-8', date: today, start_time: '15:00:00', end_time: '19:00:00', status: 'confirmed', customer_name: 'Thea Lindberg', customer_phone: '+4792233445', customer_email: 'thea.lindberg@example.com', notes: null, service_name: 'Balayage / Highlights', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'demo-5', date: addDays(today, 1), start_time: '11:00:00', end_time: '11:45:00', status: 'confirmed', customer_name: 'Ida Solberg', customer_phone: '+4796677889', customer_email: 'ida.solberg@example.com', notes: null, service_name: 'Toner', service_color: '#EAC17E', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
    { id: 'demo-6', date: addDays(today, 1), start_time: '15:00:00', end_time: '19:00:00', status: 'confirmed', customer_name: 'Camilla Haugen', customer_phone: '+4798877665', customer_email: 'camilla.haugen@example.com', notes: null, service_name: 'Balayage / Highlights', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'demo-7', date: addDays(today, 3), start_time: '13:00:00', end_time: '14:00:00', status: 'confirmed', customer_name: 'Nora Eide', customer_phone: '+4799001122', customer_email: 'nora.eide@example.com', notes: null, service_name: 'Haircut + Blowdry (without wash)', service_color: '#3D7A94', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
  ];
}
function fallbackHistoryBookings(today) {
  return [
    { id: 'hist-1', date: addDays(today, -2), start_time: '11:00:00', end_time: '15:00:00', status: 'completed', amount_charged: 3900, customer_name: 'Marte Fossum', customer_phone: '+4790011223', customer_email: 'marte.fossum@example.com', notes: null, service_name: 'Balayage / Highlights', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'hist-2', date: addDays(today, -2), start_time: '13:00:00', end_time: '14:00:00', status: 'no_show', customer_name: 'Tuva Lund', customer_phone: '+4790033445', customer_email: 'tuva.lund@example.com', notes: null, service_name: 'Toner', service_color: '#EAC17E', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
    { id: 'hist-3', date: addDays(today, -6), start_time: '11:00:00', end_time: '13:30:00', status: 'completed', amount_charged: 680, customer_name: 'Sofie Kristiansen', customer_phone: '+4790055667', customer_email: 'sofie.kristiansen@example.com', notes: null, service_name: 'Blowdry / Light Styling', service_color: '#7FB3C9', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
    { id: 'hist-4', date: addDays(today, -10), start_time: '13:00:00', end_time: '14:00:00', status: 'completed', amount_charged: 950, customer_name: 'Live Andersen', customer_phone: '+4790077889', customer_email: 'live.andersen@example.com', notes: null, service_name: 'Haircut + Blowdry (without wash)', service_color: '#3D7A94', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
    { id: 'hist-5', date: addDays(today, -14), start_time: '11:00:00', end_time: '15:00:00', status: 'completed', amount_charged: 3750, customer_name: 'Selma Braaten', customer_phone: '+4790099001', customer_email: 'selma.braaten@example.com', notes: null, service_name: 'Balayage / Highlights', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'hist-6', date: addDays(today, -20), start_time: '11:00:00', end_time: '12:30:00', status: 'completed', amount_charged: 2100, customer_name: 'Frida Moen', customer_phone: '+4790011009', customer_email: 'frida.moen@example.com', notes: null, service_name: 'All-Over Color', service_color: '#D68C3E', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
  ];
}

// Preview-mode mirror of the seeded catalog in 0002_seed_data.sql, which is
// itself a transcription of the owner's printed price list. It had drifted to
// the pre-price-list names and categories, which left most category headings
// in the Owner Panel's add-on checklist standing empty with nothing to tick.
const FALLBACK_SERVICES_ADMIN = [
  { id: 'svc-balayage', name: 'Balayage / Highlights', name_no: 'Balayage / Striper', category: 'Balayage & Highlights', price_from: 3750, price_to: null, price_on_consultation: false, price_is_from: true, duration_minutes: 240, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/balayage-and-highlights.jpeg', color: '#C9A96E', featured: true, active: true, sort_order: 1 },
  { id: 'svc-half-foil', name: 'Half Head Foil', name_no: 'Halv Folie', category: 'Balayage & Highlights', price_from: 3000, price_to: null, price_on_consultation: false, price_is_from: true, duration_minutes: 240, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/balayage-and-highlights.jpeg', color: '#D4B87E', featured: false, active: true, sort_order: 2 },
  { id: 'svc-full-foil', name: 'Full Head Foil', name_no: 'Hel Folie', category: 'Balayage & Highlights', price_from: 3750, price_to: null, price_on_consultation: false, price_is_from: true, duration_minutes: 240, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/balayage-and-highlights.jpeg', color: '#BF9A5E', featured: false, active: true, sort_order: 3 },
  { id: 'svc-root', name: 'Root Touch-Up', name_no: 'Ansatsfarge', category: 'Color', price_from: 1600, price_to: null, price_on_consultation: false, price_is_from: true, duration_minutes: 90, duration_with_addons_minutes: 120, image_url: './html/Pics/Covers/color.jpeg', color: '#E0A458', featured: false, active: true, sort_order: 4 },
  { id: 'svc-allover', name: 'All-Over Color', name_no: 'Helfarge', category: 'Color', price_from: 2100, price_to: null, price_on_consultation: false, price_is_from: true, duration_minutes: 90, duration_with_addons_minutes: 120, image_url: './html/Pics/Covers/color.jpeg', color: '#D68C3E', featured: false, active: true, sort_order: 5 },
  { id: 'svc-reverse', name: 'Reverse Balayage', name_no: 'Omvendt Balayage', category: 'Color', price_from: 3000, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 240, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/color.jpeg', color: '#A8763E', featured: false, active: true, sort_order: 6 },
  { id: 'svc-toner', name: 'Toner', name_no: 'Toner', category: 'Color', price_from: 1250, price_to: null, price_on_consultation: false, price_is_from: true, duration_minutes: 60, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/color.jpeg', color: '#EAC17E', featured: false, active: true, sort_order: 7 },
  { id: 'svc-cut-blowdry', name: 'Haircut + Blowdry (without wash)', name_no: 'Klipp + Føn (uten vask)', category: 'Haircuts & Styling', price_from: 950, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 60, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/haircuts-and-styling.jpeg', color: '#3D7A94', featured: true, active: true, sort_order: 8 },
  { id: 'svc-cut-wash-blowdry', name: 'Haircut + Wash + Blowdry', name_no: 'Klipp + Vask + Føn', category: 'Haircuts & Styling', price_from: 1150, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 60, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/haircuts-and-styling.jpeg', color: '#4A88A2', featured: false, active: true, sort_order: 9 },
  { id: 'svc-cut-wash-blowdry-styling', name: 'Haircut + Wash + Blowdry + Styling', name_no: 'Klipp + Vask + Føn + Styling', category: 'Haircuts & Styling', price_from: 1250, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 60, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/haircuts-and-styling.jpeg', color: '#5796B0', featured: false, active: true, sort_order: 10 },
  { id: 'svc-cut-wash-mask-blowdry', name: 'Haircut + Wash + Mask + Blowdry', name_no: 'Klipp + Vask + Maske + Føn', category: 'Haircuts & Styling', price_from: 1350, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 60, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/haircuts-and-styling.jpeg', color: '#2F6B84', featured: false, active: true, sort_order: 11 },
  { id: 'svc-blowdry', name: 'Blowdry / Light Styling', name_no: 'Føn / Lett Styling', category: 'Styling', price_from: 680, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 60, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/styling.jpeg', color: '#7FB3C9', featured: false, active: true, sort_order: 12 },
  { id: 'svc-wash-blowdry', name: 'Wash + Blowdry', name_no: 'Vask + Føn', category: 'Styling', price_from: 750, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 60, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/styling.jpeg', color: '#8FC0D4', featured: false, active: true, sort_order: 13 },
  { id: 'svc-wash-blowdry-wavy', name: 'Wash + Blowdry + Wavy Styling', name_no: 'Vask + Føn + Bølgestyling', category: 'Styling', price_from: 890, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 60, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/styling.jpeg', color: '#6FA5BC', featured: false, active: true, sort_order: 14 },
  { id: 'svc-half-updo', name: 'Half Updo', name_no: 'Halv Oppsett', category: 'Special Occasions', price_from: 1500, price_to: null, price_on_consultation: false, price_is_from: true, duration_minutes: 90, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/bridal-and-updos.jpeg', color: '#D98CA8', featured: false, active: true, sort_order: 15 },
  { id: 'svc-full-updo', name: 'Full Updo', name_no: 'Helt Oppsett', category: 'Special Occasions', price_from: 2500, price_to: null, price_on_consultation: false, price_is_from: true, duration_minutes: 90, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/bridal-and-updos.jpeg', color: '#C46E8C', featured: false, active: true, sort_order: 16 },
  { id: 'svc-bridal', name: 'Bridal Hair', name_no: 'Brudehår', category: 'Bridal', price_from: 4000, price_to: null, price_on_consultation: true, price_is_from: false, duration_minutes: 240, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/bridal-and-updos.jpeg', color: '#A8506E', featured: false, active: true, sort_order: 17 },
  { id: 'svc-ext-50', name: 'Hair Extensions (50g)', name_no: 'Extensions (50g)', category: 'Hair Extensions', price_from: 3000, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 180, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/hair-extensions.jpeg', color: '#A97FC9', featured: true, active: true, sort_order: 18 },
  { id: 'svc-ext-100', name: 'Hair Extensions (100-150g)', name_no: 'Extensions (100-150g)', category: 'Hair Extensions', price_from: null, price_to: null, price_on_consultation: true, price_is_from: false, duration_minutes: 240, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/hair-extensions.jpeg', color: '#8C5EAD', featured: false, active: true, sort_order: 19 },
  { id: 'svc-consultation', name: 'Consultation', name_no: 'Konsultasjon', category: 'Consultation', price_from: 0, price_to: null, price_on_consultation: false, price_is_from: false, duration_minutes: 10, duration_with_addons_minutes: null, image_url: './html/Pics/Covers/haircuts-and-styling.jpeg', color: '#9a9aa2', featured: false, active: true, sort_order: 22 },
];
const FALLBACK_STAFF_ADMIN = [
  { id: 'staff-hassan', name: 'Hassan K.', role: 'Founder & Master Stylist', role_no: 'Grunnlegger & Mesterstylisten', bio: '25+ years of luxury experience across Oslo and Lebanon. A master of balayage and extensions, with an expert touch across every discipline.', bio_no: '25+ års luksuserfaring fra Oslo og Libanon. En mester innen balayage og extensions, med et ekspertblikk på alle faglige disipliner.', photo_url: './html/Pics/Team/Hassan.jpeg', instagram: 'https://www.instagram.com/studioserena.hair', bookable: true, external_booking_url: null, allow_overlap_booking: true, allow_manual_overlap: true, sort_order: 1, active: true },
  { id: 'staff-kani', name: 'Kani M.', role: 'Senior Stylist & Makeup Artist', role_no: 'Senior Stylisten & Makeup Artist', bio: '8+ years of experience. Specialist in balayage, bridal artistry, makeup, and styling for all-including hijabis.', bio_no: '8+ års erfaring. Spesialist på balayage brudestyling, makeup, og styling for alle – inkludert hijabis.', photo_url: './html/Pics/Team/Kani.jpeg', instagram: 'https://www.instagram.com/hairgasmofficial', bookable: true, external_booking_url: null, allow_overlap_booking: false, allow_manual_overlap: true, sort_order: 2, active: true },
  { id: 'staff-taniya', name: 'Taniya S.', role: 'Keratin & Hair Treatment Specialist', role_no: 'Keratin & Hårbehandlingsspesialist', bio: 'Extensive luxury experience. A highly talented specialist in Keratin and restorative hair treatments for all clients-including hijabis.', bio_no: 'Omfattende luksuserfaring. En svært talentfull spesialist på Keratin og gjenoppbyggende hårbehandlinger for alle – inkludert hijabis.', photo_url: './html/Pics/Team/Taniya.jpeg', instagram: 'https://www.instagram.com/lavellaprofessional', bookable: false, external_booking_url: 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu', external_booking_label: 'Book on Instagram', allow_overlap_booking: false, sort_order: 3, active: true },
  { id: 'staff-heba', name: 'Heba K.', role: 'Creative Lead & Communications', role_no: 'Creative Lead & Kommunikasjon', bio: 'Specializing in digital artistry and high-end client relations. The architect of our online world and the voice behind every appointment.', bio_no: 'Spesialist innen digital kreativitet og førsteklasses kunderelasjoner. Arkitekten bak vår digitale verden og stemmen bak hver timebestilling.', photo_url: './html/Pics/Team/Heba.jpeg', instagram: 'https://www.instagram.com/studioserena.hair', bookable: false, external_booking_url: null, allow_overlap_booking: false, sort_order: 4, active: true },
  { id: 'staff-pati', name: 'Pati', role: 'Nail Artist', role_no: 'Neglekunstner', bio: 'Our talented nail artist, specializing in gel, nail extensions, and creative nail art. Book your appointment directly through Timma.', bio_no: 'Vår talentfulle neglekunstner, spesialist på gele, neglforlengelse og kreativ neglekunst. Bestill time direkte via Timma.', photo_url: null, instagram: 'https://www.instagram.com/studio.serena.nailsbypati', bookable: false, external_booking_url: 'https://timma.no/salong/patrycja-neglebar', external_booking_label: 'Book on Timma', allow_overlap_booking: false, sort_order: 5, active: true },
];
function fallbackActivityLog(today) {
  const now = new Date(today + 'T00:00:00');
  const at = (daysAgo, h, m) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };
  return [
    { id: 'act-1', actor_name: 'Hassan K.', subject_name: 'Hassan K.', action: 'arrived', detail: 'Sara Nilsen · Highlights / Balayage', created_at: at(0, 11, 5) },
    { id: 'act-2', actor_name: 'Kani M.', subject_name: 'Kani M.', action: 'no_show', detail: 'Tuva Lund · Toner', created_at: at(0, 13, 15) },
    { id: 'act-3', actor_name: 'Kani M.', subject_name: 'Kani M.', action: 'block_created', detail: `${today} · 14:00–14:30 · Lunch`, created_at: at(0, 9, 0) },
    { id: 'act-4', actor_name: 'Hassan K.', subject_name: 'Kani M.', action: 'block_removed', detail: `${addDays(today, 1)} · 11:00–12:00`, created_at: at(1, 10, 30) },
    { id: 'act-5', actor_name: 'Kani M.', subject_name: 'Kani M.', action: 'arrived', detail: 'Julie Berg · One Color (All Hair)', created_at: at(1, 11, 5) },
  ];
}

const pinScreen = document.getElementById('pinScreen');
const pinForm = document.getElementById('pinForm');
const pinInput = document.getElementById('pinInput');
const pinError = document.getElementById('pinError');
const btnPinSubmit = document.getElementById('btnPinSubmit');
const identityScreen = document.getElementById('identityScreen');
const identityList = document.getElementById('identityList');
const scheduleApp = document.getElementById('scheduleApp');
const topbarActions = document.getElementById('topbarActions');
const btnMoreMenu = document.getElementById('btnMoreMenu');
const moreMenu = document.getElementById('moreMenu');
const btnOwnerPanel = document.getElementById('btnOwnerPanel');
const ownerPanelModal = document.getElementById('ownerPanelModal');
const ownerPanelClose = document.getElementById('ownerPanelClose');
const ownerTabs = document.getElementById('ownerTabs');
const ownerTabContent = document.getElementById('ownerTabContent');
const todayLabel = document.getElementById('todayLabel');
const dayStripEl = document.getElementById('dayStrip');
const staffPillsEl = document.getElementById('staffPills');
const staffPillsAnchor = document.getElementById('staffPillsAnchor');
const schedTopbar = document.querySelector('.sched-topbar');
const gridWrap = document.getElementById('gridWrap');
const btnSwitchPin = document.getElementById('btnSwitchPin');
const apptPopup = document.getElementById('apptPopup');
const popupBody = document.getElementById('popupBody');
const popupClose = document.getElementById('popupClose');
const viewToggle = document.getElementById('viewToggle');
const upcomingView = document.getElementById('upcomingView');
const historyView = document.getElementById('historyView');
const historyList = document.getElementById('historyList');
const btnCalendarPick = document.getElementById('btnCalendarPick');
const calendarPopover = document.getElementById('calendarPopover');
const calPopPrev = document.getElementById('calPopPrev');
const calPopNext = document.getElementById('calPopNext');
const calPopMonthLabel = document.getElementById('calPopMonthLabel');
const calPopGrid = document.getElementById('calPopGrid');
const btnDayStripPrev = document.getElementById('btnDayStripPrev');
const btnDayStripNext = document.getElementById('btnDayStripNext');
const btnBlockTime = document.getElementById('btnBlockTime');
const blockTimeModal = document.getElementById('blockTimeModal');
const blockTimeClose = document.getElementById('blockTimeClose');
const blockStaffField = document.getElementById('blockStaffField');
const blockStaffSelect = document.getElementById('blockStaffSelect');
const blockDate = document.getElementById('blockDate');
const blockAllDay = document.getElementById('blockAllDay');
const blockTimeFields = document.getElementById('blockTimeFields');
const blockStart = document.getElementById('blockStart');
const blockEnd = document.getElementById('blockEnd');
const blockReason = document.getElementById('blockReason');
const btnSaveBlock = document.getElementById('btnSaveBlock');
const blockDateTo = document.getElementById('blockDateTo');
const blockStatus = document.getElementById('blockStatus');
const blockExistingList = document.getElementById('blockExistingList');
const rescheduleModal = document.getElementById('rescheduleModal');
const rescheduleClose = document.getElementById('rescheduleClose');
const rescheduleSub = document.getElementById('rescheduleSub');
const rescheduleTime = document.getElementById('rescheduleTime');
const rescheduleStaffSelect = document.getElementById('rescheduleStaffSelect');
const btnSaveReschedule = document.getElementById('btnSaveReschedule');
const rescheduleStatus = document.getElementById('rescheduleStatus');
const rescheduleAvailability = document.getElementById('rescheduleAvailability');
const completeModal = document.getElementById('completeModal');
const completeClose = document.getElementById('completeClose');
const completeSub = document.getElementById('completeSub');
const completeAmount = document.getElementById('completeAmount');
const btnSaveComplete = document.getElementById('btnSaveComplete');
const completeStatus = document.getElementById('completeStatus');
const addBookingModal = document.getElementById('addBookingModal');
const addBookingClose = document.getElementById('addBookingClose');
const addBkName = document.getElementById('addBkName');
const addBkPhone = document.getElementById('addBkPhone');
const addBkEmail = document.getElementById('addBkEmail');
const addBkService = document.getElementById('addBkService');
const addBkStaff = document.getElementById('addBkStaff');
const addBkTime = document.getElementById('addBkTime');
const addBkAvailability = document.getElementById('addBkAvailability');
const addBkNotes = document.getElementById('addBkNotes');
const btnSaveAddBooking = document.getElementById('btnSaveAddBooking');
const addBkPaid = document.getElementById('addBkPaid');
const addBkPaidAmountField = document.getElementById('addBkPaidAmountField');
const addBkAmount = document.getElementById('addBkAmount');
const addBkAmountHint = document.getElementById('addBkAmountHint');
const addBkStatus = document.getElementById('addBkStatus');
const historySearchInput = document.getElementById('historySearchInput');
const historySearchClear = document.getElementById('historySearchClear');
const btnHistoryDatePick = document.getElementById('btnHistoryDatePick');
const historyDatePickLabel = document.getElementById('historyDatePickLabel');
const historyCalendarPopover = document.getElementById('historyCalendarPopover');
const histCalPrev = document.getElementById('histCalPrev');
const histCalNext = document.getElementById('histCalNext');
const histCalMonthLabel = document.getElementById('histCalMonthLabel');
const histCalGrid = document.getElementById('histCalGrid');
const historyDateClear = document.getElementById('historyDateClear');
const btnServiceColors = document.getElementById('btnServiceColors');
const colorsModal = document.getElementById('colorsModal');
const colorsClose = document.getElementById('colorsClose');
const colorsList = document.getElementById('colorsList');

let currentPin = null;
let isOwnerMode = false;
let currentActorStaffId = localStorage.getItem(IDENTITY_KEY) || null;
let currentServices = FALLBACK_SERVICES;
let currentStaff = FALLBACK_STAFF;
const FALLBACK_BUSINESS_HOURS_SCHED = [
  { weekday: 0, closed: true }, { weekday: 1, open_time: '11:00', close_time: '17:30', closed: false },
  { weekday: 2, open_time: '11:00', close_time: '17:30', closed: false }, { weekday: 3, open_time: '11:00', close_time: '17:30', closed: false },
  { weekday: 4, open_time: '11:00', close_time: '17:30', closed: false }, { weekday: 5, open_time: '11:00', close_time: '17:30', closed: false },
  { weekday: 6, closed: true },
];
// Kani works to 18:00 on Mon/Wed/Fri.
const FALLBACK_HOURS_OVERRIDES_SCHED = [
  { staff_id: 'staff-kani', weekday: 1, close_time: '18:00' },
  { staff_id: 'staff-kani', weekday: 3, close_time: '18:00' },
  { staff_id: 'staff-kani', weekday: 5, close_time: '18:00' },
];
let currentBusinessHours = FALLBACK_BUSINESS_HOURS_SCHED;
let currentHoursOverrides = FALLBACK_HOURS_OVERRIDES_SCHED;
let currentBookings = [];
let currentBlocked = [];
let historyBookings = null;
let searchResults = null; // non-null while a search query is active
let viewMode = 'upcoming';
let staffFilter = localStorage.getItem(STAFF_FILTER_KEY) || 'all';
let selectedDate = todayStr();
let windowFrom = todayStr();
let windowTo = addDays(todayStr(), DAYS_AHEAD);

function timeToMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function minutesToTimeStr(m) { return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function fmtTime(t) { return t.slice(0, 5); } // 24h, e.g. "13:00"

const STATUS_LABELS = {
  pending: 'Request waiting', confirmed: 'Confirmed', arrived: 'Arrived',
  no_show: 'No-show', completed: 'Completed', cancelled: 'Cancelled',
};

// ── VIEW TOGGLE ──
viewToggle.querySelectorAll('.view-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    viewMode = btn.dataset.view;
    viewToggle.querySelectorAll('.view-toggle-btn').forEach((b) => b.classList.toggle('active', b === btn));
    upcomingView.style.display = viewMode === 'upcoming' ? '' : 'none';
    gridWrap.style.display = viewMode === 'upcoming' ? '' : 'none';
    historyView.style.display = viewMode === 'history' ? '' : 'none';
    if (viewMode === 'history') {
      searchResults = null;
      historySearchInput.value = '';
      historySearchClear.style.display = 'none';
      clearDateFilter(false);
      loadHistory(currentPin);
    }
  });
});

// ── DAY STRIP ──
// How full a day is, as a percentage of the chairs actually available that
// day. It used to be bookings-divided-by-six, which meant a day with one
// four-hour colour looked emptier than a day with two blowdries — the
// opposite of the truth. Booked minutes over open minutes is what the owner
// is really asking when they glance down the strip.
//
// Minutes are clamped to the salon's open window, so a 15:00 colour running
// to 19:00 counts the hours it actually occupies a chair, not the ones after
// closing.
function dayLoadPct(dateStr) {
  const weekday = new Date(dateStr + 'T00:00:00').getDay();
  const bookable = (currentStaff || []).filter((st) => st.bookable !== false);
  if (!bookable.length) return null;

  const dayHours = (currentBusinessHours || []).find((h) => h.weekday === weekday);
  if (!dayHours || dayHours.closed || !dayHours.open_time || !dayHours.close_time) return null;
  const open = timeToMinutes(dayHours.open_time);

  let capacity = 0;
  const closeFor = {};
  bookable.forEach((st) => {
    const override = (currentHoursOverrides || []).find((o) => o.staff_id === st.id && o.weekday === weekday);
    const close = timeToMinutes(override ? override.close_time : dayHours.close_time);
    closeFor[st.id] = close;
    capacity += Math.max(0, close - open);
  });
  if (!capacity) return null;

  let booked = 0;
  (currentBookings || []).forEach((b) => {
    if (b.date !== dateStr) return;
    const close = closeFor[b.staff_id];
    if (close == null) return; // a stylist who no longer takes bookings
    const from = Math.max(open, timeToMinutes(b.start_time));
    const to = Math.min(close, timeToMinutes(b.end_time));
    booked += Math.max(0, to - from);
  });

  const pct = Math.min(100, Math.round((booked / capacity) * 100));
  // A single appointment in a long day rounds to a sliver too thin to see, so
  // anything above zero gets a visible minimum. The point of the bar is "is
  // there room here?", not a precise percentage.
  return pct > 0 ? Math.max(pct, 12) : 0;
}

/** Whole days from one ISO date to another. */
function daysBetween(fromIso, toIso) {
  return Math.round(
    (new Date(toIso + 'T00:00:00') - new Date(fromIso + 'T00:00:00')) / 86400000
  );
}

// ── THE STRIP IS ONE RIBBON, NOT A STACK OF PAGES ──
// Reaching the end used to load a fresh fortnight starting the next day: the
// strip snapped back to its left edge, the selected day jumped a fortnight
// with it, and the days you had just scrolled past were gone. Pressing
// "later" appeared to throw you backwards.
//
// Now the loaded range grows at whichever end you reach and the strip keeps
// its scroll position, so the days simply continue one after another.
const STRIP_PAGE_DAYS = 7;
const STRIP_MAX_DAYS = 84; // twelve weeks; past that, use the calendar

async function extendStripForward() {
  if (daysBetween(windowFrom, windowTo) >= STRIP_MAX_DAYS) return false;
  const keep = dayStripEl.scrollLeft;
  await loadWindow(currentPin, windowFrom, addDays(windowTo, STRIP_PAGE_DAYS));
  renderDayStrip();
  dayStripEl.scrollLeft = keep;
  return true;
}

async function extendStripBackward() {
  if (daysBetween(windowFrom, windowTo) >= STRIP_MAX_DAYS) return false;
  const widthBefore = dayStripEl.scrollWidth;
  await loadWindow(currentPin, addDays(windowFrom, -STRIP_PAGE_DAYS), windowTo);
  renderDayStrip();
  // Days added on the left push everything right, so the scroll position has
  // to move with them or the view jumps to a different week.
  dayStripEl.scrollLeft += dayStripEl.scrollWidth - widthBefore;
  return true;
}

function renderDayStrip() {
  const today = todayStr();
  let html = '';
  // Anchored to the currently-loaded window (not always "today"), so paging
  // forward/back with the arrow buttons or the calendar picker actually
  // changes what the strip shows instead of always displaying today+13.
  for (let i = 0; i <= daysBetween(windowFrom, windowTo); i++) {
    const dateStr = addDays(windowFrom, i);
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const loadPct = dayLoadPct(dateStr);
    // full / busy / free drive the colour, so the strip is readable at a
    // glance rather than needing the widths compared to each other.
    const loadClass = loadPct == null ? '' : loadPct >= 100 ? ' full' : loadPct >= 50 ? ' busy' : ' free';
    const classes = ['day-cell'];
    if (dateStr === today) classes.push('today');
    if (dow === 0 || dow === 6) classes.push('weekend');
    if (dateStr === selectedDate) classes.push('active');
    html += `
      <button type="button" class="${classes.join(' ')}" data-date="${dateStr}"${
        loadPct == null ? ' title="Closed"' : ` title="${loadPct >= 100 ? 'Fully booked' : loadPct + '% booked'}"`}>
        <span class="day-cell-weekday">${weekday}</span>
        <span class="day-cell-num">${d.getDate()}</span>
        ${loadPct == null
          ? '<span class="day-cell-bar day-cell-bar-closed"></span>'
          : `<span class="day-cell-bar${loadClass}"><span class="day-cell-bar-fill" style="width:${loadPct}%;"></span></span>`}
      </button>
    `;
  }
  dayStripEl.innerHTML = html;
  dayStripEl.querySelectorAll('.day-cell').forEach((btn) => {
    btn.addEventListener('click', () => selectDate(btn.dataset.date, btn));
  });
}

function updateDayLabel() {
  const d = new Date(selectedDate + 'T00:00:00');
  const prefix = selectedDate === todayStr() ? 'Today · ' : '';
  todayLabel.textContent = prefix + d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

async function selectDate(dateStr, cellEl) {
  selectedDate = dateStr;
  if (dateStr < windowFrom || dateStr > windowTo) {
    await loadWindow(currentPin, dateStr, addDays(dateStr, DAYS_AHEAD));
  }
  renderDayStrip();
  updateDayLabel();
  renderGrid();
  // Bring the chosen day into view however it was chosen. This used to happen
  // only when a strip cell was tapped, so picking a date from the calendar or
  // paging with the arrows left the strip sitting where it was: the heading
  // read one date while the strip showed a different week, and the day you had
  // just asked for was off the end of it.
  const active = dayStripEl.querySelector('.day-cell.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

// ── CUSTOM CALENDAR POPOVER ──
let calViewYear, calViewMonth;
function renderCalPopover() {
  const label = new Date(calViewYear, calViewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  calPopMonthLabel.textContent = label;
  const firstOfMonth = new Date(calViewYear, calViewMonth, 1);
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const today = todayStr();
  let html = '';
  for (let i = 0; i < leadingBlanks; i++) html += '<span class="calendar-day calendar-day-blank"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toDateStr(new Date(calViewYear, calViewMonth, d));
    const classes = ['calendar-day'];
    if (iso === today) classes.push('is-today');
    if (iso === selectedDate) classes.push('selected');
    html += `<button type="button" class="${classes.join(' ')}" data-date="${iso}">${d}</button>`;
  }
  calPopGrid.innerHTML = html;
  calPopGrid.querySelectorAll('.calendar-day:not(.calendar-day-blank)').forEach((cell) => {
    cell.addEventListener('click', () => { selectDate(cell.dataset.date, null); closeCalPopover(); });
  });
}
function openCalPopover() {
  const d = new Date(selectedDate + 'T00:00:00');
  calViewYear = d.getFullYear();
  calViewMonth = d.getMonth();
  renderCalPopover();
  calendarPopover.style.display = 'block';
  positionPopoverNear(btnCalendarPick, calendarPopover);
  btnCalendarPick.classList.add('active');
}
function closeCalPopover() {
  calendarPopover.style.display = 'none';
  btnCalendarPick.classList.remove('active');
}
btnCalendarPick.addEventListener('click', (e) => {
  e.stopPropagation();
  if (calendarPopover.style.display === 'block') closeCalPopover(); else openCalPopover();
});
calendarPopover.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', closeCalPopover);
calPopPrev.addEventListener('click', () => { calViewMonth--; if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; } renderCalPopover(); });
calPopNext.addEventListener('click', () => { calViewMonth++; if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; } renderCalPopover(); });

// ── TOPBAR "MORE" MENU (Colors / Block Time / Switch PIN) ──
function closeMoreMenu() { moreMenu.style.display = 'none'; btnMoreMenu.classList.remove('active'); }
btnMoreMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = moreMenu.style.display === 'block';
  if (open) closeMoreMenu();
  else { moreMenu.style.display = 'block'; btnMoreMenu.classList.add('active'); }
});
moreMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  if (e.target.closest('.topbar-menu-item')) closeMoreMenu();
});
document.addEventListener('click', closeMoreMenu);

// Scrolls the visible strip; if already at the end of the loaded window,
// pages forward to the next window so "next" always reveals more days.
// Both arrows only ever scroll the ribbon. They used to change which day was
// selected when they hit an edge, so pressing "later" twice could land you on
// a day a fortnight away that you had never asked for.
// Load the next stretch of days BEFORE the ribbon runs out, not once it has.
// Waiting for the exact end meant one press scrolled to a dead stop and only
// the press after that fetched more days, so "later" looked broken at the
// seam between one week and the next.
const STRIP_PREFETCH_PX = () => dayStripEl.clientWidth;
btnDayStripNext.addEventListener('click', async () => {
  const remaining = dayStripEl.scrollWidth - (dayStripEl.scrollLeft + dayStripEl.clientWidth);
  if (remaining <= STRIP_PREFETCH_PX()) await extendStripForward();
  dayStripEl.scrollBy({ left: dayStripEl.clientWidth * 0.6, behavior: 'smooth' });
});
btnDayStripPrev.addEventListener('click', async () => {
  if (dayStripEl.scrollLeft <= STRIP_PREFETCH_PX()) await extendStripBackward();
  dayStripEl.scrollBy({ left: -dayStripEl.clientWidth * 0.6, behavior: 'smooth' });
});
// Same prefetch when the ribbon is swiped rather than tapped. Forward only:
// extending backward on its own would walk into the past the moment the strip
// rendered at scrollLeft 0, spending the 12-week budget on days nobody asked
// for. Going back stays on the arrow, where it is a deliberate press.
let stripScrollTimer = null;
let stripExtending = false;
dayStripEl.addEventListener('scroll', () => {
  clearTimeout(stripScrollTimer);
  stripScrollTimer = setTimeout(async () => {
    if (stripExtending) return;
    const remaining = dayStripEl.scrollWidth - (dayStripEl.scrollLeft + dayStripEl.clientWidth);
    if (remaining > STRIP_PREFETCH_PX()) return;
    stripExtending = true;
    try { await extendStripForward(); } finally { stripExtending = false; }
  }, 160);
}, { passive: true });

// ── STAFF FILTER PILLS ──
function applyStaffFilter(value) {
  staffFilter = value;
  localStorage.setItem(STAFF_FILTER_KEY, staffFilter);
  renderPills();
  if (viewMode === 'upcoming') renderGrid(); else renderHistory();
}

// A row of pills and a dropdown carrying the same choice. Two stylists fit on
// a laptop; on a phone the row is pushed off the right edge by the day strip
// beside it, and the stylist you wanted was the one you could not see. CSS
// shows whichever suits the width - both drive applyStaffFilter, so they never
// disagree.
function renderPills() {
  const options = [{ id: 'all', name: 'All Stylists' }]
    .concat(currentStaff.map((s) => ({ id: s.id, name: s.name })));

  const current = options.find((o) => o.id === staffFilter) || options[0];

  // A <select> was styled into a pill here, but only the closed control can be
  // styled - the open list is drawn by the operating system, so it dropped a
  // grey system menu in the middle of the app. This is a real listbox instead,
  // so the open state looks like the rest of the panel.
  staffPillsEl.innerHTML =
    '<div class="staff-pill-row">'
    + options.map((o) => `<button type="button" class="staff-pill" data-staff="${escHtml(o.id)}">${escHtml(o.name)}</button>`).join('')
    + '</div>'
    + '<div class="staff-select">'
    +   '<button type="button" class="staff-select-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Filter by stylist">'
    +     `<span class="staff-select-value">${escHtml(current.name)}</span>`
    +     '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>'
    +   '</button>'
    +   '<div class="staff-select-menu" role="listbox" hidden>'
    +     options.map((o) => `<button type="button" class="staff-select-option" role="option" data-staff="${escHtml(o.id)}" aria-selected="${o.id === staffFilter}">${escHtml(o.name)}</button>`).join('')
    +   '</div>'
    + '</div>';

  staffPillsEl.querySelectorAll('.staff-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.staff === staffFilter);
    btn.addEventListener('click', () => applyStaffFilter(btn.dataset.staff));
  });

  const wrap = staffPillsEl.querySelector('.staff-select');
  const trigger = wrap.querySelector('.staff-select-btn');
  const menu = wrap.querySelector('.staff-select-menu');
  const opts = [...menu.querySelectorAll('.staff-select-option')];

  const closeMenu = () => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('open');
  };
  const openMenu = () => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    wrap.classList.add('open');
    (opts.find((o) => o.dataset.staff === staffFilter) || opts[0]).focus();
  };
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? openMenu() : closeMenu();
  });
  opts.forEach((o, i) => {
    o.addEventListener('click', () => { closeMenu(); applyStaffFilter(o.dataset.staff); });
    // Arrow keys, because a listbox that only answers to a tap is not one.
    o.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu(); trigger.focus(); }
    });
  });
  // Anywhere else on the page dismisses it, the way a real menu does.
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) closeMenu(); });
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(); }
  });
}

// ── OVERLAP-AWARE COLUMN LAYOUT ──
// Groups blocks that overlap in time into clusters and splits each cluster's
// width evenly. For an overlap-eligible stylist, a Balayage anchor booking
// (11:00/15:00) always reserves its paired half-slot (13:00/17:00) — a
// phantom entry forces the 50/50 split even when no second client has
// actually booked that pairing yet; phantoms are filtered out before render.
// `allowOverlap` reserves the paired half-slot beside an online-overlap
// stylist's four-hour colour, so the lane is visibly held open before anyone
// books it. `splitOverlaps` is the separate question of whether genuinely
// overlapping bookings sit side by side — true for everyone now, since any
// stylist can be double-booked by hand, and stacking them would hide one.
// 13:00 and 17:00 - the two times a second client is taken alongside a
// four-hour colour. Always drawn in the right-hand lane, so a day reads the
// same way every time: the long appointment on the left, the one fitted
// around it on the right.
const SECOND_LANE_STARTS = new Set([13 * 60, 17 * 60]);

/** Whether this booking belongs in the right-hand lane.
 *
 *  The two paired start times, and every consultation. A consultation is
 *  ten minutes that deliberately nests inside another appointment - it is
 *  the one booking designed to sit alongside rather than instead of - so
 *  drawing it in the first lane pushes the real appointment aside and makes
 *  a ten-minute chat look like the substance of the afternoon. */
function isSecondLane(b, startMin) {
  if (SECOND_LANE_STARTS.has(startMin)) return true;
  return /consultation|konsultasjon/i.test(b.service_name || '');
}

function layoutBlocks(bookings, allowOverlap, splitOverlaps, minLanes) {
  const entries = bookings.map((b) => ({ b, startMin: timeToMinutes(b.start_time), endMin: timeToMinutes(b.end_time) }));
  if (allowOverlap) {
    bookings.forEach((b) => {
      const startMin = timeToMinutes(b.start_time);
      const endMin = timeToMinutes(b.end_time);
      if (endMin - startMin !== BALAYAGE_DURATION || OVERLAP_ANCHORS[startMin] == null) return;
      const pairedStart = OVERLAP_ANCHORS[startMin];
      const hasPair = entries.some((e) => e.b !== b && e.startMin === pairedStart);
      if (!hasPair) entries.push({ b: null, startMin: pairedStart, endMin: pairedStart + 60 });
    });
  }
  entries.sort((a, b) => a.startMin - b.startMin);
  const clusters = [];
  let current = [];
  let clusterEnd = -Infinity;
  for (const e of entries) {
    if (current.length && e.startMin >= clusterEnd) { clusters.push(current); current = []; clusterEnd = -Infinity; }
    current.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMin);
  }
  if (current.length) clusters.push(current);
  const positioned = [];
  clusters.forEach((cluster) => {
    // minLanes holds a second lane open for stylists who may be double-booked
    // by hand, whether or not anything overlaps yet. Without it their column
    // renders one block at full width and there's nowhere visible to drop a
    // second appointment — the room has to be on screen before it's used.
    const packed = (splitOverlaps || allowOverlap) ? cluster.length : 1;
    // A 13:00 or 17:00 booking is the second client of the day's pairing, so
    // its column always has two lanes even when nothing else is in the
    // cluster - otherwise it would sit full width in the first lane and read
    // as the day's only appointment.
    const hasPaired = cluster.some((e) => e.b && isSecondLane(e.b, e.startMin));
    const n = Math.max(packed, minLanes || 1, hasPaired ? 2 : 1);

    // Those two times are Hassan's second chair: they run alongside an 11:00
    // or 15:00 colour rather than instead of it. Pinning them right keeps the
    // day readable at a glance - colour on the left, the client fitted around
    // it on the right - and stops the pairing swapping sides depending on
    // which happened to be booked first.
    const taken = new Set();
    cluster.forEach((e) => {
      if (!e.b || !isSecondLane(e.b, e.startMin)) return;
      const lane = n - 1;
      positioned.push({ ...e.b, widthPct: 100 / n, leftPct: (100 / n) * lane });
      e.placed = true;
      taken.add(lane);
    });

    let next = 0;
    cluster.forEach((e) => {
      if (!e.b || e.placed) return;
      while (taken.has(next) && next < n - 1) next += 1;
      positioned.push({ ...e.b, widthPct: 100 / n, leftPct: (100 / n) * next });
      taken.add(next);
      next += 1;
    });
  });
  return positioned;
}

function computeGridRange(bookings) {
  let start = GRID_DEFAULT_START;
  let end = GRID_DEFAULT_END;
  bookings.forEach((b) => {
    start = Math.min(start, timeToMinutes(b.start_time));
    end = Math.max(end, timeToMinutes(b.end_time));
  });
  // Viewing today: always stretch to cover the current moment, so the "now"
  // line is never silently cut off just because no booking runs that late.
  if (selectedDate === todayStr()) end = Math.max(end, nowMinutes());
  start = Math.floor((start - 30) / 60) * 60;
  end = Math.ceil((end + 30) / 60) * 60;
  return { start, end };
}

const DEFAULT_SERVICE_COLOR = '#9a9aa2';

function blockClass(b) {
  const dim = b.status === 'no_show' || b.status === 'completed' ? ' sched-block-dim' : '';
  return `sched-block${dim}`;
}
/** The amount as it should be read in a Norwegian salon: thin space between
 *  thousands, "kr" after the figure. */
function money(n) { return Number(n).toLocaleString('nb-NO') + ' kr'; }

function isPaid(b) { return b.status === 'completed' && b.amount_charged != null; }

function statusBadgeHtml(b) {
  if (b.status === 'arrived') return '<span class="sched-block-badge badge-arrived"><i class="fa-solid fa-check"></i></span>';
  if (b.status === 'no_show') return '<span class="sched-block-badge badge-noshow"><i class="fa-solid fa-xmark"></i></span>';
  if (isPaid(b)) {
    return `<span class="sched-block-badge badge-paid" title="Paid ${escHtml(money(b.amount_charged))}"><i class="fa-solid fa-check-double"></i></span>`;
  }
  // Finished, but nothing was ever entered against it. That is money the day's
  // takings will not show, and the only place it can still be noticed is here.
  if (b.status === 'completed') {
    return '<span class="sched-block-badge badge-unpaid" title="Completed, but no amount recorded"><i class="fa-solid fa-exclamation"></i></span>';
  }
  return '';
}
/** A note on a booking is usually something that changes the appointment -
 *  Mona Iqbal's says to check before using anything ammonia-based. It cannot
 *  live only behind a tap.
 *
 *  Where the block has room, the note is simply shown: a stylist reading the
 *  day should not have to open an appointment to find out there was a warning
 *  on it. Where it does not, a quiet dot beside the name says there is one.
 *  An icon alone was both cryptic and ugly - a saturated orange glyph jammed
 *  against the client's name, telling you a note existed but not what it
 *  said, on a block with empty space going spare underneath. */
/** Whether the words will fit. Height is what actually decides it - the text
 *  wraps, so a half-width block still reads fine. The earlier test used the
 *  same `narrow` flag as the service line, which is a 50% split; that ruled
 *  out precisely the case this was built for, since a booking that overlaps
 *  another is split in two and Mona's does. Only a three-or-more-way split is
 *  genuinely too tight. */
function hasRoomForNote(b, height) {
  return height >= 72 && b.widthPct >= 40;
}

function noteChipHtml(b, height, narrow) {
  if (!b.notes || !String(b.notes).trim()) return '';
  if (!hasRoomForNote(b, height)) return '';
  return `
      <div class="sched-block-note" title="${escHtml(b.notes)}">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
        <span>${escHtml(b.notes)}</span>
      </div>`;
}

/** The quiet version, for a block too small to carry the words.
 *  Always rendered when there is a note; CSS hides it wherever the strip is
 *  actually showing. Whether the words fit depends on the real width of the
 *  column, which a percentage cannot see - on a phone two columns and an
 *  overlap split leave about 85px, where "Allergic to..." is all that fits.
 *  That is a question about the viewport, so the viewport answers it. */
function noteDotHtml(b, height, narrow) {
  if (!b.notes || !String(b.notes).trim()) return '';
  return `<span class="sched-block-note-dot" title="${escHtml(b.notes)}" aria-label="This client has a note"></span>`;
}

/** The faint rules between a column's lanes. Drawn under the blocks, so a
 *  half-width appointment reads as one of two lanes rather than as a block
 *  that failed to fill its column. */
function laneDividersHtml(lanes) {
  if (!lanes || lanes < 2) return '';
  let html = '';
  for (let i = 1; i < lanes; i++) {
    html += `<div class="sched-lane-line" style="left:${(100 / lanes) * i}%;"></div>`;
  }
  return html;
}

/** The quarter-hour row a tap landed in.
 *
 *  This rounded to the nearest quarter, which is not what a row of boxes
 *  means. The 11:00 row runs from 11:00 to 11:15, so tapping the middle of it
 *  gave 11:07 and rounded up: you pressed the row labelled 11:00 and got
 *  11:15. Anywhere inside a row now means that row's own time. */
function snapToRow(minutes) {
  return Math.floor(minutes / 15) * 15;
}

function blockHtml(b, gridStart) {
  const top = (timeToMinutes(b.start_time) - gridStart) * PX_PER_MIN;
  const height = Math.max((timeToMinutes(b.end_time) - timeToMinutes(b.start_time)) * PX_PER_MIN, 30);
  const narrow = b.widthPct < 60;
  const color = b.service_color || DEFAULT_SERVICE_COLOR;
  const bg = `color-mix(in srgb, ${color} 20%, white)`;
  return `
    <div class="${blockClass(b)}" data-id="${b.id}" style="top:${top}px; height:${height}px; width:calc(${b.widthPct}% - 4px); left:calc(${b.leftPct}% + 2px); background:${bg}; border-left-color:${color};">
      ${statusBadgeHtml(b)}
      <div class="sched-block-name">${noteDotHtml(b, height, narrow)}${escHtml(b.customer_name)}</div>
      ${narrow ? '' : `<div class="sched-block-meta">${escHtml(b.service_name)}</div>`}
      <div class="sched-block-meta">${fmtTime(b.start_time)}</div>
      ${isPaid(b) && !narrow ? `<div class="sched-block-paid">${escHtml(money(b.amount_charged))}</div>` : ''}
      ${noteChipHtml(b, height, narrow)}
    </div>
  `;
}
function unavailBlockHtml(slot, gridStart) {
  const top = (timeToMinutes(slot.start_time) - gridStart) * PX_PER_MIN;
  const height = Math.max((timeToMinutes(slot.end_time) - timeToMinutes(slot.start_time)) * PX_PER_MIN, 20);
  return `<div class="sched-block-unavailable" style="top:${top}px; height:${height}px; left:2px; right:2px;" title="${slot.reason || 'Unavailable'}"></div>`;
}

// Quarter-hour ticks (11 / 15 / 30 / 45 style) — major label at :00, minor at :15/:30/:45.
function hourLinesHtml(gridStart, gridEnd) {
  let html = '';
  for (let m = gridStart; m <= gridEnd; m += 15) {
    const top = (m - gridStart) * PX_PER_MIN;
    if (m % 60 === 0) html += `<div class="sched-hour-line" style="top:${top}px;"></div>`;
    else if (m % 60 === 30) html += `<div class="sched-half-line" style="top:${top}px;"></div>`;
    else html += `<div class="sched-quarter-line" style="top:${top}px;"></div>`;
  }
  return html;
}
// Dark ruler gutter with every quarter-hour mark (00/15/30/45) — each number
// is vertically centered within its own 15-min row (not aligned to a line
// with a fudge-factor offset), with dividers exactly on the row boundaries,
// so it reads as a clean stack of rows like the reference scheduler.
function hourGutterHtml(gridStart, gridEnd) {
  const rowHeight = 15 * PX_PER_MIN;
  let html = '';
  for (let m = gridStart; m <= gridEnd; m += 15) {
    const top = HEADER_OFFSET_PX + (m - gridStart) * PX_PER_MIN;
    const minute = m % 60;
    if (m > gridStart) html += `<div class="sched-gutter-line" style="top:${top}px;"></div>`;
    const content = minute === 0
      ? `${Math.floor(m / 60)}<span class="sched-hour-label-00">00</span>`
      : String(minute).padStart(2, '0');
    const majorClass = minute === 0 ? ' sched-hour-label-major' : '';
    html += `<div class="sched-hour-label${majorClass}" style="top:${top}px; height:${rowHeight}px;">${content}</div>`;
  }
  return html;
}

// "Now" indicator — a thin live line across today's columns, like a clock
// hand, so a stylist can see at a glance how far into (or from) an
// appointment the current moment is. Only shown when viewing today, and
// only within the currently rendered time range.
function nowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}
function nowLineHtml(gridStart, gridEnd) {
  if (selectedDate !== todayStr()) return '';
  const nowMin = nowMinutes();
  if (nowMin < gridStart || nowMin > gridEnd) return '';
  const top = (nowMin - gridStart) * PX_PER_MIN;
  // The line said "now" without saying when. Reading it meant tracing across
  // to the gutter and counting quarter-hour ticks, which is exactly the moment
  // someone misreads 17:00 as 16:45 and books over a client.
  return `<div class="sched-now-line" style="top:${top}px;"></div>`;
}

/** The time itself, drawn once and centred across the whole grid.
 *
 *  It used to live inside the line, and the line is rendered per stylist
 *  column - so a two-stylist day showed the clock twice, side by side, which
 *  reads as two different things rather than one moment. */
function nowLabelHtml(gridStart, gridEnd) {
  if (selectedDate !== todayStr()) return '';
  const nowMin = nowMinutes();
  if (nowMin < gridStart || nowMin > gridEnd) return '';
  const top = HEADER_OFFSET_PX + (nowMin - gridStart) * PX_PER_MIN;
  return `<div class="sched-now-time" style="top:${top}px;">${minutesToTimeStr(nowMin)}</div>`;
}

function columnHtml(staff, bookings, blocked, gridStart, gridEnd) {
  const gridHeight = (gridEnd - gridStart) * PX_PER_MIN;
  // Hassan and Kani can both be double-booked by hand, so both columns keep
  // a second lane open. Anyone else gets full-width blocks.
  const minLanes = staff.allow_manual_overlap ? 2 : 1;
  const positioned = layoutBlocks(
    bookings, !!staff.allow_overlap_booking, true, minLanes,
  );
  // How many appointments this column can hold side by side. A stylist who
  // takes overlapping work has two lanes whether or not both are used today,
  // and with only one booking in it the column looks like a plain single
  // column - so the second lane is drawn, and it is clear there is room there
  // rather than the block simply being oddly narrow.
  const laneCount = positioned.length
    ? Math.max(minLanes, ...positioned.map((b) => Math.round(100 / (b.widthPct || 100))))
    : minLanes;
  return `
    <div class="sched-col" data-staff="${staff.id}">
      <div class="sched-col-header">${staff.name}</div>
      <div class="sched-col-body" data-lanes="${laneCount}" style="height:${gridHeight}px;">
        ${hourLinesHtml(gridStart, gridEnd)}
        ${laneDividersHtml(laneCount)}
        ${blocked.map((s) => unavailBlockHtml(s, gridStart)).join('')}
        ${!bookings.length && !blocked.length ? '<div class="sched-col-empty">No appointments</div>' : ''}
        ${positioned.map((b) => blockHtml(b, gridStart)).join('')}
        ${nowLineHtml(gridStart, gridEnd)}
      </div>
    </div>
  `;
}

let currentGridStart = GRID_DEFAULT_START;
function renderGrid() {
  const staffList = staffFilter === 'all' ? currentStaff : currentStaff.filter((s) => s.id === staffFilter);
  if (!staffList.length) { gridWrap.innerHTML = '<p class="sched-empty-note">No stylists to show.</p>'; return; }

  const dayBookings = currentBookings.filter((b) => b.date === selectedDate);
  const dayBlocked = currentBlocked.filter((s) => s.date === selectedDate);
  const relevantBookings = staffFilter === 'all' ? dayBookings : dayBookings.filter((b) => b.staff_id === staffFilter);
  const { start, end } = computeGridRange(relevantBookings);
  // The grid does not always begin at 11:00 - it stretches to cover whatever
  // is booked - so the move preview has to position itself against the range
  // actually on screen, not the default one.
  currentGridStart = start;
  const nowDot = selectedDate === todayStr() && nowMinutes() >= start && nowMinutes() <= end
    ? `<div class="sched-now-dot" style="top:${HEADER_OFFSET_PX + (nowMinutes() - start) * PX_PER_MIN}px;"></div>`
    : '';
  gridWrap.innerHTML = `
    <div class="sched-grid">
      <div class="sched-hour-gutter" style="height:${HEADER_OFFSET_PX + (end - start) * PX_PER_MIN}px;">${hourGutterHtml(start, end)}${nowDot}</div>
      <div class="sched-columns">
        ${staffList.map((s) => columnHtml(
          s,
          dayBookings.filter((b) => b.staff_id === s.id),
          dayBlocked.filter((sl) => sl.staff_id === s.id || sl.staff_id === null),
          start, end
        )).join('')}
        ${nowLabelHtml(start, end)}
      </div>
    </div>
  `;
  gridWrap.querySelectorAll('.sched-block').forEach((el) => {
    el.addEventListener('click', (e) => { e.stopPropagation(); openPopup(el.dataset.id); });
  });
  // Click an empty part of a stylist's column to add a booking right there —
  // pre-fills that stylist, the day being viewed, and the clicked time
  // (snapped to the nearest quarter-hour) into the Add Booking modal.
  gridWrap.querySelectorAll('.sched-col-body').forEach((body) => {
    body.addEventListener('mousemove', (e) => {
      // Once it has been put down, the preview stays where it was put.
      if (!moveTarget || pendingMove) return;
      const staffId = body.closest('.sched-col').dataset.staff;
      const offsetY = e.clientY - body.getBoundingClientRect().top;
      renderMovePreview(staffId, snapToRow(start + offsetY / PX_PER_MIN));
    });
    body.addEventListener('click', (e) => {
      // In move mode a tap anywhere in a column places the appointment there -
      // including on top of something already booked, which the salon does on
      // purpose. Only then does it ask anything.
      if (moveTarget) {
        const staffId = body.closest('.sched-col').dataset.staff;
        const offsetY = e.clientY - body.getBoundingClientRect().top;
        const minutes = snapToRow(start + offsetY / PX_PER_MIN);
        // Placing it and agreeing to it are two different acts. The tap puts
        // the appointment down so it can be looked at against the day around
        // it; the tick is where it is agreed to. Opening the question straight
        // away meant the sheet arrived over the preview before it had been
        // read, and tapping a slightly wrong row cost a dismissal each time.
        setPendingMove({ staffId, date: selectedDate, minutes });
        return;
      }
      if (e.target.closest('.sched-block, .sched-block-unavailable')) return;
      const staffId = body.closest('.sched-col').dataset.staff;
      const offsetY = e.clientY - body.getBoundingClientRect().top;
      const minutes = snapToRow(start + offsetY / PX_PER_MIN);
      openAddBookingModal({ staffId, date: selectedDate, time: minutesToTimeStr(minutes) });
    });
  });
}

// Add-ons ride along on every booking reader (get_staff_schedule,
// search_staff_bookings, admin_get_bookings) as a pre-joined label plus the
// expected total computed at booking time — see migration 0005. Both are
// null for bookings made before that migration, so every use is guarded.
function addonsLine(b) {
  if (!b.addons) return '';
  return `<div class="popup-addons"><i class="fa-solid fa-plus"></i> ${escHtml(b.addons)}</div>`;
}
function expectedLabel(b) {
  if (b.expected_total == null) return '';
  const num = Number(b.expected_total).toLocaleString('en-US') + ' NOK';
  return b.expected_total_is_estimate ? 'From ' + num : num;
}

// ── TAKING THE MONEY WHERE THE CLIENT IS STANDING ──
// She is marked arrived at the chair and pays at the same chair minutes
// later, so the amount is asked for here rather than behind a second screen
// in the owner panel. A booking left at "arrived" is one nobody completed,
// and an incomplete booking carries no amount - which is how a day's takings
// end up lower than the day actually was.
//
// The pre-fill follows the same rule as Add Booking: a fixed price is filled
// in because it is what she owes, but a "from" price is a floor, not a
// figure, and must never sit in the box waiting to be accepted by mistake.
function paidBox(b) {
  const estimate = b.expected_total == null || b.expected_total_is_estimate;
  const value = estimate ? '' : String(Number(b.expected_total));
  const hint = b.expected_total == null
    ? 'Enter what she paid.'
    : (b.expected_total_is_estimate
        ? 'Listed from ' + Number(b.expected_total).toLocaleString('nb-NO') + ' NOK - enter what she actually paid.'
        : 'The listed price. Change it if she paid something else.');
  return `
    <div class="popup-paid-box">
      <div class="popup-paid-title"><i class="fa-solid fa-cash-register"></i> Record the payment</div>
      <label class="popup-paid-label" for="popupPaidAmount">Amount charged (NOK)</label>
      <input type="number" id="popupPaidAmount" class="popup-paid-input" min="0" step="1"
             inputmode="numeric" placeholder="e.g. 1150" value="${value}" />
      <span class="popup-paid-hint">${hint}</span>
      <button type="button" class="popup-paid-btn" id="popupPaidBtn">
        <i class="fa-solid fa-flag-checkered"></i> Paid &amp; done
      </button>
      <div class="popup-paid-status" id="popupPaidStatus"></div>
    </div>`;
}

// ── DETAIL POPUP ──
function openPopup(id) {
  const b = currentBookings.find((x) => x.id === id) || (historyBookings || []).find((x) => x.id === id) || (searchResults || []).find((x) => x.id === id);
  if (!b) return;
  const isToday = b.date === todayStr();
  const canAct = isToday && (b.status === 'pending' || b.status === 'confirmed');
  const canUndo = isToday && (b.status === 'arrived' || b.status === 'no_show');
  // She is here and has not been rung up yet. Any day, not only today: a
  // booking marked arrived yesterday and never completed still has to be
  // possible to settle, or the money is simply lost.
  const awaitingPayment = b.status === 'arrived';
  popupBody.innerHTML = `
    <div class="popup-name">${escHtml(b.customer_name)}</div>
    <div class="popup-meta">${escHtml(b.service_name)}${b.staff_name ? ' · ' + b.staff_name : ''}</div>
    <div class="popup-meta">${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}</div>
    ${addonsLine(b)}
    ${expectedLabel(b) ? `<div class="popup-meta popup-expected">Expected ${expectedLabel(b)}</div>` : ''}
    ${b.customer_phone ? `<a class="popup-phone" href="tel:${escHtml(b.customer_phone)}"><i class="fa-solid fa-phone"></i> ${escHtml(b.customer_phone)}</a>` : '<div style="margin-bottom:1.25rem;"></div>'}
    ${b.notes ? `<div class="popup-notes"><i class="fa-solid fa-note-sticky"></i> ${escHtml(b.notes)}</div>` : ''}
    ${canAct
      ? `<div class="popup-actions">
           <button class="sched-btn sched-btn-arrived" data-action="arrived" data-id="${b.id}"><i class="fa-solid fa-check"></i> Arrived</button>
           <button class="sched-btn sched-btn-noshow" data-action="no_show" data-id="${b.id}">No-show</button>
         </div>`
      : `<span class="sched-status ${b.rejected_at ? 'rejected' : b.status}">${statusLabel(b)}</span>
         ${canUndo ? `<button type="button" class="popup-undo-btn" data-action="confirmed" data-id="${b.id}"><i class="fa-solid fa-rotate-left"></i> Pressed by mistake? Undo</button>` : ''}`}
    ${isPaid(b)
      ? `<div class="popup-paid-done"><i class="fa-solid fa-circle-check"></i> Paid &middot; <strong>${escHtml(money(b.amount_charged))}</strong></div>`
      : ''}
    ${b.status === 'completed' && b.amount_charged == null
      ? '<div class="popup-paid-missing"><i class="fa-solid fa-triangle-exclamation"></i> Completed, but no amount was recorded - this visit is not in the revenue.</div>'
      : ''}
    ${awaitingPayment ? paidBox(b) : ''}
    ${b.status !== 'cancelled' && b.status !== 'completed'
      ? `<button type="button" class="popup-move-btn" id="popupMove"><i class="fa-solid fa-arrows-up-down-left-right"></i> Move this appointment</button>`
      : ''}
    ${b.customer_phone || b.customer_name ? `<button type="button" class="popup-history-btn" id="popupCheckHistory"><i class="fa-solid fa-clock-rotate-left"></i> Check history of this person</button>` : ''}
  `;
  popupBody.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      popupBody.querySelectorAll('button').forEach((x) => (x.disabled = true));
      const status = btn.dataset.action;
      const { error } = await updateBookingStatusStaff({ pin: currentPin, bookingId: id, status, actorStaffId: currentActorStaffId });
      if (error && id.startsWith('demo-')) { const fb = currentBookings.find((x) => x.id === id); if (fb) fb.status = status; b.status = status; }
      else if (!error) b.status = status;
      // Arrived is not the end of the visit - she still has to pay. Closing
      // here sent the stylist looking for the booking a second time in the
      // owner panel to record the amount, and a booking nobody goes back for
      // stays at "arrived" with no money against it. Reopening shows the
      // amount box in place instead.
      // Reopen only if the change actually took. Asking `!error` was wrong:
      // the demo data applies the change through the fallback branch above
      // *despite* an error, so the popup closed on exactly the path the
      // stylist sees when the backend is unreachable.
      if (status === 'arrived' && b.status === 'arrived') { renderGrid(); openPopup(id); return; }
      closePopup();
      renderGrid();
      // Marking the no-show and writing to the client are separate decisions.
      // A missed appointment usually has a reason behind it, and a machine
      // emailing an invoice to someone whose morning fell apart is how a salon
      // loses a client it could have kept. So this asks, every time, and it is
      // easy to say no.
      // b.status, not !error - for the same reason as the arrived branch above.
      // The demo path applies the change through the fallback despite an
      // error, so asking !error skipped the notice on exactly the path a
      // stylist sees when the backend is unreachable.
      if (status === 'no_show' && b.status === 'no_show') openNoShowNotice(b);
    });
  });
  const paidBtn = document.getElementById('popupPaidBtn');
  if (paidBtn) {
    const amountEl = document.getElementById('popupPaidAmount');
    const statusEl = document.getElementById('popupPaidStatus');
    const submitPaid = async () => {
      const amount = parseFloat(amountEl.value);
      if (!Number.isFinite(amount) || amount < 0) {
        statusEl.textContent = 'Enter what she paid first.';
        statusEl.style.color = '#dc2626';
        amountEl.focus();
        return;
      }
      paidBtn.disabled = true;
      statusEl.textContent = 'Saving…';
      statusEl.style.color = 'var(--sched-text-muted)';
      const { error } = await completeBookingAdmin({ pin: currentPin, bookingId: b.id, amountCharged: amount });
      if (error && !String(b.id).startsWith('demo-')) {
        paidBtn.disabled = false;
        statusEl.textContent = 'Could not save: ' + error.message;
        statusEl.style.color = '#dc2626';
        return;
      }
      b.status = 'completed';
      b.amount_charged = amount;
      const fb = currentBookings.find((x) => x.id === b.id);
      if (fb) { fb.status = 'completed'; fb.amount_charged = amount; }
      statusEl.textContent = '✓ ' + amount.toLocaleString('nb-NO') + ' NOK recorded.';
      statusEl.style.color = '#059669';
      renderGrid();
      setTimeout(closePopup, 900);
    };
    paidBtn.addEventListener('click', submitPaid);
    // Enter is what a hand already on the number pad reaches for.
    amountEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitPaid(); } });
  }
  const moveBtn = document.getElementById('popupMove');
  if (moveBtn) moveBtn.addEventListener('click', () => { closePopup(); startMoveMode(b); });
  const historyBtn = document.getElementById('popupCheckHistory');
  if (historyBtn) historyBtn.addEventListener('click', () => { closePopup(); runSearch(b.customer_phone || b.customer_name); });
  apptPopup.style.display = 'flex';
}
function closePopup() { apptPopup.style.display = 'none'; popupBody.innerHTML = ''; }
popupClose.addEventListener('click', closePopup);
apptPopup.addEventListener('click', (e) => { if (e.target === apptPopup) closePopup(); });

// ── HISTORY VIEW ──
async function loadHistory(pin) {
  const today = todayStr();
  const dateFrom = addDays(today, -HISTORY_DAYS_BACK);
  const dateTo = addDays(today, -1);
  const { data, error } = await fetchStaffSchedule({ pin, dateFrom, dateTo });
  historyBookings = !error && data ? data : fallbackHistoryBookings(today);
  renderHistory();
}

function renderHistoryRows(list, emptyMessage) {
  if (!list.length) { historyList.innerHTML = `<p class="history-empty">${emptyMessage}</p>`; return; }
  let html = '';
  let lastDate = null;
  list.forEach((b) => {
    if (b.date !== lastDate) {
      const d = new Date(b.date + 'T00:00:00');
      html += `<div class="history-date-header">${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>`;
      lastDate = b.date;
    }
    const color = b.service_color || DEFAULT_SERVICE_COLOR;
    html += `
      <div class="history-row" data-id="${b.id}">
        <span class="history-row-dot" style="background:${color};"></span>
        <span class="history-row-time">${fmtTime(b.start_time)}</span>
        <div class="history-row-info">
          <div class="history-row-name">${escHtml(b.customer_name)}</div>
          <div class="history-row-meta">${escHtml(b.service_name)}${b.staff_name ? ' · ' + b.staff_name : ''}</div>
        </div>
        <span class="sched-status ${b.rejected_at ? 'rejected' : b.status}">${statusLabel(b)}</span>
      </div>
    `;
  });
  historyList.innerHTML = html;
  historyList.querySelectorAll('.history-row').forEach((row) => {
    row.addEventListener('click', () => openPopup(row.dataset.id));
  });
}

function renderHistory() {
  if (searchResults !== null) {
    const filtered = staffFilter === 'all' ? searchResults : searchResults.filter((b) => b.staff_id === staffFilter);
    renderHistoryRows(filtered, 'No matching appointments found.');
    return;
  }
  if (historyBookings === null) return;
  const filtered = (staffFilter === 'all' ? historyBookings : historyBookings.filter((b) => b.staff_id === staffFilter))
    .slice()
    .sort((a, b) => (b.date + b.start_time).localeCompare(a.date + a.start_time));
  renderHistoryRows(filtered, 'No past appointments in the last 30 days.');
}

// ── HISTORY SEARCH ──
let searchDebounce;
async function runSearch(query) {
  historySearchInput.value = query;
  historySearchClear.style.display = '';
  viewMode = 'history';
  viewToggle.querySelectorAll('.view-toggle-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === 'history'));
  upcomingView.style.display = 'none';
  gridWrap.style.display = 'none';
  historyView.style.display = '';
  historyList.innerHTML = '<p class="history-empty">Searching…</p>';
  const { data, error } = await searchStaffBookings({ pin: currentPin, query });
  if (!error && data) {
    searchResults = data;
  } else {
    const q = query.toLowerCase();
    searchResults = [...fallbackWindowBookings(todayStr()), ...fallbackHistoryBookings(todayStr())]
      .filter((b) => b.customer_name.toLowerCase().includes(q) || (b.customer_phone || '').includes(q))
      .sort((a, b) => (b.date + b.start_time).localeCompare(a.date + a.start_time));
  }
  renderHistory();
}
function clearSearch() {
  searchResults = null;
  historySearchInput.value = '';
  historySearchClear.style.display = 'none';
  renderHistory();
}
historySearchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const q = historySearchInput.value.trim();
  historySearchClear.style.display = q ? '' : 'none';
  if (!q) { searchResults = null; renderHistory(); return; }
  if (q.length < 2) return;
  clearDateFilter(false); // typing a search overrides any active date filter
  searchDebounce = setTimeout(() => runSearch(q), 350);
});
historySearchClear.addEventListener('click', clearSearch);

// ── HISTORY DATE FILTER (single day, custom calendar popover) ──
let historyFilterDate = null;
async function runDateFilter(dateStr) {
  historyFilterDate = dateStr;
  clearSearch(); // a date filter overrides any active text search
  historyDatePickLabel.textContent = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  historyDateClear.style.display = '';
  historyList.innerHTML = '<p class="history-empty">Loading…</p>';
  const { data, error } = await fetchStaffSchedule({ pin: currentPin, dateFrom: dateStr, dateTo: dateStr });
  if (!error && data) {
    searchResults = data.sort((a, b) => (b.date + b.start_time).localeCompare(a.date + a.start_time));
  } else {
    searchResults = [...fallbackWindowBookings(todayStr()), ...fallbackHistoryBookings(todayStr())]
      .filter((b) => b.date === dateStr)
      .sort((a, b) => (b.date + b.start_time).localeCompare(a.date + a.start_time));
  }
  renderHistory();
}
function clearDateFilter(rerender = true) {
  historyFilterDate = null;
  historyDatePickLabel.textContent = 'Filter by day';
  historyDateClear.style.display = 'none';
  if (rerender) { searchResults = null; renderHistory(); }
}
historyDateClear.addEventListener('click', () => clearDateFilter(true));

let histCalViewYear, histCalViewMonth;
function renderHistCalPopover() {
  const label = new Date(histCalViewYear, histCalViewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  histCalMonthLabel.textContent = label;
  const firstOfMonth = new Date(histCalViewYear, histCalViewMonth, 1);
  const daysInMonth = new Date(histCalViewYear, histCalViewMonth + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const today = todayStr();
  let html = '';
  for (let i = 0; i < leadingBlanks; i++) html += '<span class="calendar-day calendar-day-blank"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toDateStr(new Date(histCalViewYear, histCalViewMonth, d));
    const classes = ['calendar-day'];
    if (iso === today) classes.push('is-today');
    if (iso === historyFilterDate) classes.push('selected');
    html += `<button type="button" class="${classes.join(' ')}" data-date="${iso}">${d}</button>`;
  }
  histCalGrid.innerHTML = html;
  histCalGrid.querySelectorAll('.calendar-day:not(.calendar-day-blank)').forEach((cell) => {
    cell.addEventListener('click', () => { runDateFilter(cell.dataset.date); closeHistCalPopover(); });
  });
}
function openHistCalPopover() {
  const d = new Date((historyFilterDate || todayStr()) + 'T00:00:00');
  histCalViewYear = d.getFullYear();
  histCalViewMonth = d.getMonth();
  renderHistCalPopover();
  historyCalendarPopover.style.display = 'block';
  positionPopoverNear(btnHistoryDatePick, historyCalendarPopover);
  btnHistoryDatePick.classList.add('active');
}
function closeHistCalPopover() {
  historyCalendarPopover.style.display = 'none';
  btnHistoryDatePick.classList.remove('active');
}
btnHistoryDatePick.addEventListener('click', (e) => {
  e.stopPropagation();
  if (historyCalendarPopover.style.display === 'block') closeHistCalPopover(); else openHistCalPopover();
});
historyCalendarPopover.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', closeHistCalPopover);
histCalPrev.addEventListener('click', () => { histCalViewMonth--; if (histCalViewMonth < 0) { histCalViewMonth = 11; histCalViewYear--; } renderHistCalPopover(); });
histCalNext.addEventListener('click', () => { histCalViewMonth++; if (histCalViewMonth > 11) { histCalViewMonth = 0; histCalViewYear++; } renderHistCalPopover(); });

// ── BLOCK TIME MODAL ── (single shared modal — owners additionally get a
// "Whole Salon" option, staff blocking their own time don't need it)
function openBlockModal() {
  const wholeSalonOption = isOwnerMode ? '<option value="">Whole Salon</option>' : '';
  blockStaffSelect.innerHTML = wholeSalonOption + currentStaff.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  if (!isOwnerMode && staffFilter !== 'all') { blockStaffSelect.value = staffFilter; blockStaffField.style.display = 'none'; }
  else blockStaffField.style.display = '';
  blockDate.value = selectedDate;
  blockAllDay.checked = false;
  blockTimeFields.classList.remove('disabled');
  blockStart.value = ''; blockEnd.value = ''; blockReason.value = '';
  blockStatus.textContent = '';
  renderExistingBlocks();
  blockTimeModal.style.display = 'flex';
}
function closeBlockModal() { blockTimeModal.style.display = 'none'; }
btnBlockTime.addEventListener('click', openBlockModal);
blockTimeClose.addEventListener('click', closeBlockModal);
blockTimeModal.addEventListener('click', (e) => { if (e.target === blockTimeModal) closeBlockModal(); });
blockAllDay.addEventListener('change', () => {
  blockTimeFields.classList.toggle('disabled', blockAllDay.checked);
});

function renderExistingBlocks() {
  const staffId = blockStaffSelect.value || null; // '' option value = Whole Salon
  const rows = currentBlocked.filter((s) => s.staff_id === staffId);
  if (!rows.length) { blockExistingList.innerHTML = ''; return; }
  blockExistingList.innerHTML = '<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--sched-text-muted);margin-bottom:0.4rem;">Currently blocked (this window)</div>' +
    rows.map((s) => {
      const isAllDay = s.start_time.slice(0, 5) === '00:00' && s.end_time.slice(0, 5) === '23:59';
      const timeLabel = isAllDay ? 'All day' : `${fmtTime(s.start_time)}–${fmtTime(s.end_time)}`;
      return `
      <div class="block-existing-row" data-id="${s.id}">
        <span>${s.date} · ${timeLabel}${s.reason ? ' · ' + s.reason : ''}</span>
        <button type="button" class="block-existing-row-remove" data-id="${s.id}"><i class="fa-solid fa-trash"></i></button>
      </div>
    `;
    }).join('');
  blockExistingList.querySelectorAll('.block-existing-row-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // Whole-salon blocks (staff_id null) can only be removed via the
      // owner-only RPC — the staff-facing one explicitly excludes them.
      const { error } = staffId === null
        ? await removeBlockedSlotAdmin({ pin: currentPin, id: btn.dataset.id })
        : await removeStaffUnavailable({ pin: currentPin, blockedSlotId: btn.dataset.id, actorStaffId: currentActorStaffId });
      if (!error || btn.dataset.id.startsWith('fallback-')) {
        currentBlocked = currentBlocked.filter((s) => s.id !== btn.dataset.id);
        renderExistingBlocks();
        renderGrid();
      }
    });
  });
}
blockStaffSelect.addEventListener('change', renderExistingBlocks);

btnSaveBlock.addEventListener('click', async () => {
  const staffId = blockStaffSelect.value || null; // '' option value = Whole Salon
  const date = blockDate.value;
  const dateTo = (blockDateTo && blockDateTo.value) || '';
  const start = blockAllDay.checked ? '00:00' : blockStart.value;
  const end = blockAllDay.checked ? '23:59' : blockEnd.value;
  if (!date || !start || !end) { blockStatus.textContent = 'Fill in date, start, and end time.'; blockStatus.style.color = '#dc2626'; return; }
  if (end <= start) { blockStatus.textContent = 'End time must be after start time.'; blockStatus.style.color = '#dc2626'; return; }
  if (dateTo && dateTo < date) { blockStatus.textContent = 'The end date is before the start date.'; blockStatus.style.color = '#dc2626'; return; }
  blockStatus.textContent = 'Saving…'; blockStatus.style.color = 'var(--sched-text-muted)';
  const reason = blockReason.value.trim();

  // A holiday is a range, not a day. Filling "Until" writes one row per
  // working day in one call, so a fortnight off is a single entry to make
  // and every one of those days comes back struck through in the booking
  // calendar.
  if (dateTo && dateTo !== date) {
    const { data, error } = await addBlockedRangeAdmin({
      pin: currentPin, staffId, dateFrom: date, dateTo, startTime: start, endTime: end, reason,
    });
    if (error) { blockStatus.textContent = 'Error: ' + error.message; blockStatus.style.color = '#dc2626'; return; }
    const madeCount = Number(data) || 0;
    blockStatus.textContent = `✓ Blocked ${madeCount} day${madeCount === 1 ? '' : 's'}.`;
    blockStatus.style.color = '#059669';
    await reloadBlockedForRange(date, dateTo);
    renderExistingBlocks();
    renderGrid();
    reportBlockClashes({ date, dateTo, staffId, start, end });
    return;
  }

  const { data, error } = staffId === null
    ? await addBlockedSlotAdmin({ pin: currentPin, staffId: null, date, startTime: start, endTime: end, reason })
    : await addStaffUnavailable({ pin: currentPin, staffId, date, startTime: start, endTime: end, reason, actorStaffId: currentActorStaffId });
  const slot = !error && data ? data : { id: 'fallback-' + Date.now(), staff_id: staffId, date, start_time: start + ':00', end_time: end + ':00', reason: reason || null };
  currentBlocked.push(slot);
  blockStatus.textContent = '✓ Blocked.'; blockStatus.style.color = '#059669';
  renderExistingBlocks();
  renderGrid();
  reportBlockClashes({ date, staffId, start, end });
});

// The range RPC returns only a count, so pull the rows back to keep the
// on-screen list and the day grid in step with what was actually written.
async function reloadBlockedForRange(from, to) {
  const { data, error } = await fetchBlockedSlotsRange(from, to);
  if (error || !data) return;
  const known = new Set(currentBlocked.map((b) => b.id));
  data.forEach((b) => { if (!known.has(b.id)) currentBlocked.push(b); });
}

// Blocking time stops NEW bookings; it deliberately doesn't touch ones
// already made — cancelling somebody's appointment without a word would be
// worse than the clash. So list them instead, with phone numbers, so the
// owner can ring those clients themselves.
async function reportBlockClashes({ date, dateTo, staffId, start, end }) {
  const { data, error } = await fetchBookingsInRangeAdmin({
    pin: currentPin, dateFrom: date, dateTo: dateTo || date, staffId: staffId || null,
  });
  if (error || !data || !data.length) return;

  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const from = toMin(start);
  const to = toMin(end);
  const clashes = data.filter((b) => toMin(b.start_time) < to && toMin(b.end_time) > from);
  if (!clashes.length) return;

  const list = clashes.map((b) =>
    `<div class="block-clash-row"><strong>${new Date(b.date + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${fmtTime(b.start_time)}</strong> ${escHtml(b.customer_name)} · ${escHtml(b.service_name)}`
    + (b.customer_phone ? ` · <a href="tel:${escHtml(b.customer_phone)}">${escHtml(b.customer_phone)}</a>` : '')
    + `${staffId ? '' : ' · ' + b.staff_name}</div>`).join('');

  blockStatus.innerHTML = `✓ Blocked - but ${clashes.length} booking${clashes.length === 1 ? ' is' : 's are'} already inside that time:`
    + `<div class="block-clash-list">${list}</div>`
    + `<div class="block-clash-note">These stay on the schedule. Call them to move or cancel.</div>`;
  blockStatus.style.color = '#b45309';
}

// ── SHARED AVAILABILITY-CHECK PRIMITIVES ── (used by Move, Add Booking)
// Busy ranges = existing bookings + blocked time for one stylist on one day,
// as [{ startMin, endMin, label, isBlock }]. excludeBookingId lets Move
// ignore the booking it's currently repositioning (it'd otherwise "conflict"
// with its own old slot).
async function fetchBusyRangesFor(date, staffId, excludeBookingId) {
  const [schedRes, blockedRes] = await Promise.all([fetchStaffSchedule({ pin: currentPin, dateFrom: date, dateTo: date }), fetchBlockedSlotsRange(date, date)]);
  const bookings = !schedRes.error && schedRes.data
    ? schedRes.data
    : [...fallbackWindowBookings(todayStr()), ...fallbackHistoryBookings(todayStr())].filter((b) => b.date === date);
  const blocked = !blockedRes.error && blockedRes.data ? blockedRes.data : currentBlocked.filter((b) => b.date === date);
  return [
    ...bookings
      .filter((b) => b.staff_id === staffId && b.status !== 'cancelled' && b.id !== excludeBookingId)
      .map((b) => ({ startMin: timeToMinutes(fmtTime(b.start_time)), endMin: timeToMinutes(fmtTime(b.end_time)), label: `${escHtml(b.customer_name)} - ${escHtml(b.service_name)}`, isBlock: false })),
    ...blocked
      .filter((b) => b.staff_id === staffId || b.staff_id === null)
      .map((b) => ({ startMin: timeToMinutes(fmtTime(b.start_time)), endMin: timeToMinutes(fmtTime(b.end_time)), label: b.reason ? `Blocked - ${escHtml(b.reason)}` : 'Blocked', isBlock: true })),
  ].sort((a, b) => a.startMin - b.startMin);
}
function renderBusyRangesInto(el, busyRanges) {
  if (!busyRanges.length) {
    el.innerHTML = '<p class="reschedule-availability-title">Availability that day</p><p class="reschedule-free-note"><i class="fa-solid fa-circle-check"></i> Wide open - nothing else booked.</p>';
  } else {
    el.innerHTML = '<p class="reschedule-availability-title">Already busy that day</p>' + busyRanges.map((r) => `
      <div class="reschedule-busy-row" data-start="${r.startMin}" data-end="${r.endMin}">
        <span class="reschedule-busy-time">${minutesToTimeStr(r.startMin)}–${minutesToTimeStr(r.endMin)}</span>
        <span class="reschedule-busy-label">${r.isBlock ? '<i class="fa-solid fa-ban"></i> ' : ''}${r.label}</span>
      </div>
    `).join('');
  }
}
// Which stylist the open modal is about — Add Booking and Move each have
// their own picker, so read whichever is on screen.
function staffAllowsManualOverlap() {
  const sel = document.getElementById('addBkStaff');
  const resel = document.getElementById('rescheduleStaffSelect');
  const id = (resel && resel.offsetParent && resel.value)
    || (sel && sel.offsetParent && sel.value)
    || null;
  if (!id) return false;
  const st = (currentStaff || []).find((x) => x.id === id);
  return !!(st && st.allow_manual_overlap);
}

function markConflictsIn(el, busyRanges, newStart, newEnd, saveBtn) {
  el.querySelectorAll('.reschedule-busy-row').forEach((row) => row.classList.remove('conflict', 'conflict-allowed'));
  const existingWarn = el.querySelector('.reschedule-conflict-warning');
  if (existingWarn) existingWarn.remove();
  const conflicts = busyRanges.filter((r) => newStart < r.endMin && newEnd > r.startMin);
  // Overlapping by hand is granted per stylist (Hassan and Kani), so a clash
  // is information for them and a refusal for anyone else. The rows are
  // highlighted either way, so one can't be created without seeing it.
  const canOverride = !!(staffAllowsManualOverlap());
  if (conflicts.length) {
    el.querySelectorAll('.reschedule-busy-row').forEach((row) => {
      if (conflicts.some((c) => c.startMin === Number(row.dataset.start) && c.endMin === Number(row.dataset.end))) {
        row.classList.add(canOverride ? 'conflict-allowed' : 'conflict');
      }
    });
    const warn = document.createElement('p');
    warn.className = 'reschedule-conflict-warning';
    warn.innerHTML = canOverride
      ? '<i class="fa-solid fa-circle-info"></i> Overlaps the appointment(s) highlighted above - you can still save.'
      : '<i class="fa-solid fa-triangle-exclamation"></i> That time overlaps something already booked - pick another time.';
    if (!canOverride) warn.classList.add('blocking');
    el.appendChild(warn);
  }
  const mustBlock = conflicts.length > 0 && !canOverride;
  if (saveBtn) saveBtn.disabled = mustBlock;
  return mustBlock ? conflicts : [];
}

// ── MOVE (RESCHEDULE) ──
let rescheduleBookingTarget = null;
// The day and time now come from a tap on the schedule, not a date picker.
let moveToDate = null;

// ── MOVING AN APPOINTMENT ON THE SCHEDULE ITSELF ──
// Move does not open a picker. It puts the schedule into move mode and leaves
// the page exactly as it is - the day strip, both stylists, everything already
// booked - because that is the thing you look at to decide where something
// goes. Choose any day, tap where it should sit, confirm.
//
// Earlier attempts drew a small copy of the day inside a modal, then listed
// the same appointments underneath it, then warned that the chosen time
// overlapped one of them. All of it was working around not being on the
// schedule. Being on the schedule removes the need for any of it.
let moveTarget = null;

const moveBar = document.getElementById('moveBar');
const moveBarWho = document.getElementById('moveBarWho');
const moveToEl = document.getElementById('moveTo');
const moveBarHint = document.getElementById('moveBarHint');
const moveBarConfirm = document.getElementById('moveBarConfirm');
const rescheduleService = document.getElementById('rescheduleService');

/** Where the appointment has been put down, before anyone has agreed to it. */
let pendingMove = null;

function setPendingMove({ staffId, date, minutes }) {
  pendingMove = { staffId, date, minutes };
  renderMovePreview(staffId, minutes);
  const staff = (currentStaff || []).find((x) => String(x.id) === String(staffId));
  const duration = movingDuration();
  moveBarHint.textContent = `${minutesToTimeStr(minutes)} - ${minutesToTimeStr(minutes + duration)}`
    + (staff ? ` · ${staff.name}` : '')
    + ' · tap again to move it, or press the tick.';
  moveBarConfirm.hidden = false;
}

function clearPendingMove() {
  pendingMove = null;
  moveBarConfirm.hidden = true;
  moveBarHint.textContent = 'Pick a day, then tap where it should go.';
  clearMovePreview();
}

/** Draws the appointment where it would land, in the column it would land in,
 *  at the size it would actually be - see-through, so what is underneath is
 *  still readable. A row highlight says which row you hit; it does not say
 *  whether a four-hour colour clears the 15:00 booking below it. This does. */
/** "4 hours", "1½ hours", "45 min" - how a stylist says it, not 240. */
function fmtDuration(mins) {
  if (mins < 60) return mins + ' min';
  const h = Math.floor(mins / 60);
  const rest = mins % 60;
  if (rest === 30) return h + '½ hours';
  if (rest) return h + ' h ' + rest + ' min';
  return h + (h === 1 ? ' hour' : ' hours');
}

/** How long the appointment will be once this move is saved: the chosen
 *  service's length if it is being changed, otherwise what it is now. */
function movingDuration() {
  if (!moveTarget) return 0;
  const chosen = rescheduleService && rescheduleService.value;
  // An empty value is the "unchanged" option, not a service.
  if (chosen && String(chosen) !== String(moveTarget.service_id)) {
    const svc = (addBkServicesSource || []).find((x) => String(x.id) === String(chosen));
    if (svc && svc.duration_minutes) return Number(svc.duration_minutes);
  }
  return timeToMinutes(fmtTime(moveTarget.end_time)) - timeToMinutes(fmtTime(moveTarget.start_time));
}

function renderMovePreview(staffId, minutes) {
  clearMovePreview();
  if (!moveTarget) return;
  const col = gridWrap.querySelector(`.sched-col[data-staff="${staffId}"] .sched-col-body`);
  if (!col) return;
  const duration = movingDuration();
  const gridStart = currentGridStart;

  // An appointment occupies one lane, so its preview must too. Drawn across
  // the whole column it claimed both lanes of a stylist who takes overlapping
  // work, which said the wrong thing twice: that it needed the entire column,
  // and that the lane beside it was no longer free.
  //
  // Which lane it takes is the one a real block would: the first that has
  // nothing in it for the span this would occupy.
  const lanes = Math.max(1, Number(col.dataset.lanes) || 1);
  const occupied = new Set();
  col.querySelectorAll('.sched-block').forEach((blk) => {
    const top = parseFloat(blk.style.top) || 0;
    const h = parseFloat(blk.style.height) || 0;
    const bStart = gridStart + top / PX_PER_MIN;
    const bEnd = bStart + h / PX_PER_MIN;
    if (minutes < bEnd && (minutes + duration) > bStart) {
      // leftPct is written as `calc(X% + 2px)`, so read the number back out.
      const m = /([\d.]+)%/.exec(blk.style.left || '');
      const leftPct = m ? parseFloat(m[1]) : 0;
      occupied.add(Math.round(leftPct / (100 / lanes)));
    }
  });
  let lane = 0;
  while (lane < lanes - 1 && occupied.has(lane)) lane += 1;

  const el = document.createElement('div');
  el.className = 'sched-move-preview';
  el.style.top = `${(minutes - gridStart) * PX_PER_MIN}px`;
  el.style.height = `${Math.max(duration * PX_PER_MIN, 24)}px`;
  el.style.width = `calc(${100 / lanes}% - 4px)`;
  el.style.left = `calc(${(100 / lanes) * lane}% + 2px)`;
  el.innerHTML = `<span class="smp-time">${minutesToTimeStr(minutes)} - ${minutesToTimeStr(minutes + duration)}</span>`
    + `<span class="smp-name">${escHtml(moveTarget.customer_name)}</span>`;
  col.appendChild(el);
}

function clearMovePreview() {
  gridWrap.querySelectorAll('.sched-move-preview').forEach((el) => el.remove());
}

function startMoveMode(booking) {
  moveTarget = booking;
  clearPendingMove();
  moveBarWho.textContent = `Moving ${booking.customer_name} - ${booking.service_name}`;
  moveBar.hidden = false;
  document.body.classList.add('is-moving');
  rescheduleStatus.textContent = '';
}

function cancelMoveMode() {
  moveTarget = null;
  clearPendingMove();
  moveBar.hidden = true;
  document.body.classList.remove('is-moving');
}

/** The tap on the schedule landed. Ask the one question worth asking - is it
 *  still the same service - and let it be saved. */
function openMoveConfirm({ staffId, date, time }) {
  if (!moveTarget) return;
  rescheduleBookingTarget = moveTarget;
  rescheduleSub.textContent = `${moveTarget.customer_name} - ${moveTarget.service_name}`;
  moveToDate = date;
  rescheduleTime.value = time;
  rescheduleStaffSelect.value = staffId;

  // Prefilled with what she already has, so leaving it alone is the default.
  //
  // The match has to be checked rather than assumed. A booking whose service
  // is not in the list - it has been retired, or the row simply carries no
  // service_id - left nothing selected, and a <select> with nothing selected
  // shows its first option. So Julie Berg's All-Over Color appeared as
  // Balayage / Highlights, and pressing Save would have changed her service
  // to a four-hour one without anyone asking for it.
  //
  // When there is no match the current service leads the list with an empty
  // value, which the save treats as "unchanged".
  const services = (addBkServicesSource || []).slice();
  const matched = services.some((sv) => String(sv.id) === String(moveTarget.service_id));
  const keepOption = `<option value=""${matched ? '' : ' selected'}>${escHtml(moveTarget.service_name || 'Same service')} (unchanged)</option>`;
  rescheduleService.innerHTML = (matched ? '' : keepOption)
    + services.map((sv) => `<option value="${escHtml(sv.id)}"${String(sv.id) === String(moveTarget.service_id) ? ' selected' : ''}>${escHtml(sv.name)}</option>`).join('');

  rescheduleStatus.textContent = '';
  renderMoveSummary();
  rescheduleModal.style.display = 'flex';
}

/** The "going to" line, and the preview behind the sheet. Both depend on how
 *  long the appointment will be, so both follow the service dropdown - a
 *  90-minute colour swapped for a 4-hour balayage has to be seen to take four
 *  hours before it is saved, not discovered on the schedule afterwards. */
function renderMoveSummary() {
  if (!pendingMove || !moveTarget) return;
  const staff = (currentStaff || []).find((x) => String(x.id) === String(pendingMove.staffId));
  const d = new Date(pendingMove.date + 'T00:00:00');
  const dur = movingDuration();
  moveToEl.innerHTML = `
    <div class="move-to-when">${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
    <div class="move-to-detail">${escHtml(minutesToTimeStr(pendingMove.minutes))} - ${escHtml(minutesToTimeStr(pendingMove.minutes + dur))}`
    + `${staff ? ' &middot; ' + escHtml(staff.name) : ''} &middot; ${escHtml(fmtDuration(dur))}</div>`;
  renderMovePreview(pendingMove.staffId, pendingMove.minutes);
}

function closeRescheduleModal() {
  rescheduleModal.style.display = 'none';
  rescheduleBookingTarget = null;
  // Backing out of the question does not undo the placement: the preview and
  // the tick stay, so the answer to "not there, then" is one more tap rather
  // than starting the move again.
}

// Kept so the old call sites read the same. Nothing is blocked: the schedule
// is on screen, so a time chosen on it is a decision, not a mistake to catch.
function checkRescheduleConflict() { return []; }

document.getElementById('moveBarCancel').addEventListener('click', cancelMoveMode);
rescheduleService.addEventListener('change', renderMoveSummary);
moveBarConfirm.addEventListener('click', () => {
  if (!pendingMove) return;
  openMoveConfirm({
    staffId: pendingMove.staffId,
    date: pendingMove.date,
    time: minutesToTimeStr(pendingMove.minutes),
  });
});
rescheduleClose.addEventListener('click', closeRescheduleModal);
rescheduleModal.addEventListener('click', (e) => { if (e.target === rescheduleModal) closeRescheduleModal(); });
btnSaveReschedule.addEventListener('click', async () => {
  if (!rescheduleBookingTarget) return;
  const date = moveToDate;
  const time = rescheduleTime.value;
  if (!date || !time) { rescheduleStatus.textContent = 'Pick a day, then tap where it should go.'; rescheduleStatus.style.color = '#dc2626'; return; }
  rescheduleStatus.textContent = 'Saving…'; rescheduleStatus.style.color = 'var(--sched-text-muted)';
  // serviceId only when it actually changed, so an unchanged move sends
  // exactly what it always sent.
  const chosenService = rescheduleService.value;
  const serviceChanged = chosenService && String(chosenService) !== String(rescheduleBookingTarget.service_id);
  const { error } = await rescheduleBookingAdmin({
    pin: currentPin, bookingId: rescheduleBookingTarget.id, date, startTime: time,
    staffId: rescheduleStaffSelect.value,
    serviceId: serviceChanged ? chosenService : null,
  });
  if (error) { rescheduleStatus.textContent = 'Error: ' + error.message; rescheduleStatus.style.color = '#dc2626'; return; }
  rescheduleStatus.textContent = '✓ Moved.'; rescheduleStatus.style.color = '#059669';
  setTimeout(async () => {
    closeRescheduleModal();
    cancelMoveMode();
    // The move can be started from the grid or from the owner panel, and the
    // grid is where it has to be seen to have happened. Reload the window and
    // redraw it; refresh the panel list only if the panel is actually open.
    await loadWindow(currentPin, windowFrom, windowTo);
    renderGrid();
    if (ownerPanelModal.style.display !== 'none') switchOwnerTab(ownerActiveTab);
  }, 500);
});

// Minimal escaping for anything a client typed. See the audit note about
// unescaped innerHTML in this file — it needs a pass, and new code must not
// add to the problem.
function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ── AFTER A NO-SHOW ──
// Nothing is sent unless someone here says so.
let noShowTarget = null;
function openNoShowNotice(booking) {
  noShowTarget = booking;
  const modal = document.getElementById('noShowModal');
  if (!modal) return;
  document.getElementById('noShowWho').textContent =
    `${booking.customer_name} · ${booking.service_name} · ${fmtTime(booking.start_time)}`;
  document.getElementById('noShowNote').value = '';
  document.getElementById('noShowStatus').textContent = '';
  // Half the booking's own price, which is what the cancellation policy says.
  // Offered as a starting figure, not imposed - it stays editable, because the
  // owner may well decide on something else for a particular client.
  const fee = booking.expected_total != null
    ? Math.round(Number(booking.expected_total) / 2)
    : null;
  const charge = document.getElementById('noShowCharge');
  const feeField = document.getElementById('noShowFeeField');
  const feeAmount = document.getElementById('noShowFeeAmount');
  const feeHint = document.getElementById('noShowFee');
  // Always starts unticked. Charging has to be a decision someone made, not
  // one they failed to undo.
  charge.checked = false;
  feeField.hidden = true;
  feeAmount.value = fee != null ? String(fee) : '';
  feeHint.textContent = fee != null
    ? `Half of ${Number(booking.expected_total).toLocaleString('nb-NO')} NOK, which is what the policy says. Change it if you want to charge something else.`
    : 'This service has no fixed price, so there is no half to work from - enter what you want to invoice.';
  syncNoShowFee();

  const mail = document.getElementById('noShowSend');
  mail.disabled = !booking.customer_email;
  document.getElementById('noShowNoEmail').hidden = !!booking.customer_email;
  modal.style.display = 'flex';
}

/** The amount box and the send button both follow the charge decision, so the
 *  button says what pressing it will actually do. */
function syncNoShowFee() {
  const charge = document.getElementById('noShowCharge');
  const feeField = document.getElementById('noShowFeeField');
  const label = document.getElementById('noShowSendLabel');
  if (!charge || !feeField || !label) return;
  feeField.hidden = !charge.checked;
  label.textContent = charge.checked ? 'Send the message and the invoice' : 'Send her a message';
}
function closeNoShowNotice() {
  const modal = document.getElementById('noShowModal');
  if (modal) modal.style.display = 'none';
  noShowTarget = null;
}

// ── COMPLETE BOOKING MODAL ── (captures amount_charged — see 0001's comment on that column)
let completeBookingTarget = null;
function openCompleteModal(booking) {
  completeBookingTarget = booking;
  const addonPart = booking.addons ? ` + ${booking.addons}` : '';
  const expected = expectedLabel(booking);
  completeSub.textContent = `${booking.customer_name} - ${booking.service_name}${addonPart}`
    + (expected ? ` · expected ${expected}` : '');
  // Prefilled with what the booking said it would cost, so completing a
  // normal visit is one click and anything that differs is a deliberate
  // edit rather than a number typed from memory. Estimates (consultation or
  // range-priced work) are left blank — their floor isn't a real quote.
  completeAmount.value = (booking.expected_total != null && !booking.expected_total_is_estimate)
    ? String(Number(booking.expected_total))
    : '';
  completeStatus.textContent = '';
  completeModal.style.display = 'flex';
  completeAmount.focus();
}

function closeCompleteModal() { completeModal.style.display = 'none'; completeBookingTarget = null; }
completeClose.addEventListener('click', closeCompleteModal);
completeModal.addEventListener('click', (e) => { if (e.target === completeModal) closeCompleteModal(); });
btnSaveComplete.addEventListener('click', async () => {
  if (!completeBookingTarget) return;
  const amount = parseFloat(completeAmount.value);
  if (isNaN(amount) || amount < 0) { completeStatus.textContent = 'Enter a valid amount.'; completeStatus.style.color = '#dc2626'; return; }
  completeStatus.textContent = 'Saving…'; completeStatus.style.color = 'var(--sched-text-muted)';
  const { error } = await completeBookingAdmin({ pin: currentPin, bookingId: completeBookingTarget.id, amountCharged: amount });
  if (error) { completeStatus.textContent = 'Error: ' + error.message; completeStatus.style.color = '#dc2626'; return; }
  completeStatus.textContent = '✓ Completed.'; completeStatus.style.color = '#059669';
  setTimeout(() => { closeCompleteModal(); switchOwnerTab(ownerActiveTab); }, 500);
});

// ── ADD BOOKING MODAL ── (manual entry — Owner Panel Bookings tab's "Add Booking")
let addBkBusyRanges = [];
const addBkDatePicker = wireOwnerDatePicker({
  btnId: 'btnAddBkDatePick', labelId: 'addBkDateLabel', popoverId: 'addBkCalendarPopover',
  prevId: 'addBkCalPrev', nextId: 'addBkCalNext', monthLabelId: 'addBkCalMonthLabel', gridId: 'addBkCalGrid',
  placeholder: 'Pick a date', onSelect: () => loadAddBookingAvailability(),
});
async function loadAddBookingAvailability() {
  const date = addBkDatePicker.value;
  const staffId = addBkStaff.value;
  if (!date || !staffId) { addBkAvailability.innerHTML = ''; addBkBusyRanges = []; checkAddBookingConflict(); return; }
  addBkAvailability.innerHTML = '<p class="reschedule-availability-title">Checking availability…</p>';
  addBkBusyRanges = await fetchBusyRangesFor(date, staffId, null);
  renderBusyRangesInto(addBkAvailability, addBkBusyRanges);
  checkAddBookingConflict();
}
function checkAddBookingConflict() {
  const time = addBkTime.value;
  const service = addBkServicesSource.find((s) => s.id === addBkService.value);
  if (!time || !service) return markConflictsIn(addBkAvailability, [], 0, 0, btnSaveAddBooking);
  const newStart = timeToMinutes(time);
  const staff = currentStaff.find((s) => s.id === addBkStaff.value);
  return markConflictsIn(addBkAvailability, addBkBusyRanges, newStart, newStart + service.duration_minutes, btnSaveAddBooking);
}
// currentServices (used elsewhere for the main schedule grid) is sometimes
// the abbreviated fallback list with no duration_minutes — fall back to the
// Owner Panel's full fallback set so the conflict check always has a real
// duration to work with, online or off.
let addBkServicesSource = FALLBACK_SERVICES_ADMIN;
// prefill lets clicking an empty grid slot open this pre-populated with that
// slot's stylist/date/time, instead of always starting blank.
function openAddBookingModal(prefill) {
  prefill = prefill || {};
  addBkName.value = ''; addBkPhone.value = ''; addBkEmail.value = ''; addBkNotes.value = '';
  addBkTime.value = prefill.time || '';
  if (prefill.date) addBkDatePicker.setValue(prefill.date); else addBkDatePicker.clear();
  addBkAvailability.innerHTML = '';
  addBkStatus.textContent = '';
  addBkServicesSource = currentServices[0]?.duration_minutes != null ? currentServices : FALLBACK_SERVICES_ADMIN;
  addBkService.innerHTML = addBkServicesSource.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  addBkStaff.innerHTML = currentStaff.map((s) => `<option value="${s.id}"${s.id === prefill.staffId ? ' selected' : ''}>${s.name}</option>`).join('');
  addBookingModal.style.display = 'flex';
  if (prefill.date && prefill.staffId) loadAddBookingAvailability();
}
function closeAddBookingModal() { addBookingModal.style.display = 'none'; }
addBookingClose.addEventListener('click', closeAddBookingModal);
addBookingModal.addEventListener('click', (e) => { if (e.target === addBookingModal) closeAddBookingModal(); });
addBkStaff.addEventListener('change', loadAddBookingAvailability);
addBkService.addEventListener('change', checkAddBookingConflict);
addBkTime.addEventListener('input', checkAddBookingConflict);
btnSaveAddBooking.addEventListener('click', async () => {
  const name = addBkName.value.trim();
  const phone = addBkPhone.value.trim();
  const email = addBkEmail.value.trim();
  const date = addBkDatePicker.value;
  const time = addBkTime.value;
  if (!name || !phone || !email || !date || !time) {
    addBkStatus.textContent = 'Name, phone, email, date, and time are all required.';
    addBkStatus.style.color = '#dc2626';
    return;
  }
  addBkStatus.textContent = 'Saving…'; addBkStatus.style.color = 'var(--sched-text-muted)';
  // staffBookAppointment, not bookAppointment: same rules bar the overlap
  // check, which a booking entered here is allowed to break. The online
  // wizard still refuses overlaps for everything except consultations.
  const { data, error } = await staffBookAppointment({
    pin: currentPin,
    serviceId: addBkService.value, staffId: addBkStaff.value, date, startTime: time,
    name, email, phone, notes: addBkNotes.value.trim(),
  });
  if (error) { addBkStatus.textContent = 'Error: ' + error.message; addBkStatus.style.color = '#dc2626'; return; }

  // A walk-in written up after the fact is usually already paid. Completing it
  // here is what puts the money into the revenue figures - otherwise the
  // booking sits as upcoming and has to be found and completed a second time,
  // which is how takings go unrecorded.
  if (addBkPaid.checked) {
    const amount = parseFloat(addBkAmount.value);
    if (!Number.isFinite(amount) || amount < 0) {
      addBkStatus.textContent = 'Booked, but the amount was not a number - complete it from the schedule to record what she paid.';
      addBkStatus.style.color = '#b45309';
      setTimeout(() => { closeAddBookingModal(); switchOwnerTab(ownerActiveTab); }, 2500);
      return;
    }
    const created = (data && (Array.isArray(data) ? data[0] : data)) || null;
    if (created && created.id) {
      const { error: payErr } = await completeBookingAdmin({
        pin: currentPin, bookingId: created.id, amountCharged: amount,
      });
      if (payErr) {
        addBkStatus.textContent = 'Booked, but recording the payment failed: ' + payErr.message;
        addBkStatus.style.color = '#b45309';
        return;
      }
      addBkStatus.textContent = '✓ Booked and paid, ' + amount.toLocaleString('nb-NO') + ' NOK recorded.';
      addBkStatus.style.color = '#059669';
      setTimeout(() => { closeAddBookingModal(); switchOwnerTab(ownerActiveTab); }, 900);
      return;
    }
  }

  addBkStatus.textContent = '✓ Booked.'; addBkStatus.style.color = '#059669';
  setTimeout(() => { closeAddBookingModal(); switchOwnerTab(ownerActiveTab); }, 500);
});

// The amount box only appears once she is marked as paid, and it is pre-filled
// with the service's own price - except where that price is a "from" figure,
// which is a floor rather than a real amount and must not sit there waiting to
// be accepted by mistake.
function syncAddBkPaidField() {
  addBkPaidAmountField.hidden = !addBkPaid.checked;
  if (!addBkPaid.checked) return;
  const svc = (addBkServicesSource || []).find((x) => String(x.id) === String(addBkService.value));
  if (!svc) { addBkAmount.value = ''; addBkAmountHint.textContent = ''; return; }
  const isEstimate = svc.price_is_from || svc.price_on_consultation || svc.price_to != null;
  if (isEstimate) {
    addBkAmount.value = '';
    addBkAmountHint.textContent = svc.price_on_consultation
      ? 'Quoted at consultation - enter what she actually paid.'
      : 'Listed from ' + Number(svc.price_from || 0).toLocaleString('nb-NO') + ' NOK - enter what she actually paid.';
  } else {
    addBkAmount.value = svc.price_from != null ? String(Number(svc.price_from)) : '';
    addBkAmountHint.textContent = 'The listed price. Change it if she paid something else.';
  }
}
addBkPaid.addEventListener('change', syncAddBkPaidField);
addBkService.addEventListener('change', () => { if (addBkPaid.checked) syncAddBkPaidField(); });

// ── SERVICE COLORS MODAL ──
function renderColorsList() {
  colorsList.innerHTML = currentServices.map((s) => `
    <div class="colors-row">
      <div class="colors-row-name">${s.name}<span class="colors-row-cat">${s.category || ''}</span></div>
      <span class="colors-row-saved" id="saved-${s.id}">Saved</span>
      <input type="color" value="${s.color || '#9a9aa2'}" data-id="${s.id}" />
    </div>
  `).join('');
  colorsList.querySelectorAll('input[type="color"]').forEach((input) => {
    input.addEventListener('change', async () => {
      const serviceId = input.dataset.id;
      const color = input.value;
      const { error } = await updateServiceColor({ pin: currentPin, serviceId, color });
      // Reflect immediately regardless of RPC outcome (offline preview still works).
      const svc = currentServices.find((s) => s.id === serviceId);
      if (svc) svc.color = color;
      currentBookings.forEach((b) => { if (b.service_name === svc?.name) b.service_color = color; });
      if (historyBookings) historyBookings.forEach((b) => { if (b.service_name === svc?.name) b.service_color = color; });
      const savedTag = document.getElementById(`saved-${serviceId}`);
      if (savedTag) { savedTag.classList.add('visible'); setTimeout(() => savedTag.classList.remove('visible'), 1200); }
      if (viewMode === 'upcoming') renderGrid(); else renderHistory();
    });
  });
}
function openColorsModal() { renderColorsList(); colorsModal.style.display = 'flex'; }
function closeColorsModal() { colorsModal.style.display = 'none'; }
btnServiceColors.addEventListener('click', openColorsModal);
colorsClose.addEventListener('click', closeColorsModal);
colorsModal.addEventListener('click', (e) => { if (e.target === colorsModal) closeColorsModal(); });

// ── OWNER PANEL ── (replaces admin.html — same PIN field, owner_pin unlocks this)
const OWNER_TAB_RENDERERS = {
  requests: renderOwnerRequestsTab,
  export: renderOwnerExportTab,
  services: renderOwnerServicesTab,
  addons: renderOwnerAddonsTab,
  staff: renderOwnerStaffTab,
  bookings: renderOwnerBookingsTab,
  revenue: renderOwnerRevenueTab,
  hours: renderOwnerHoursTab,
  activity: renderOwnerActivityTab,
  settings: renderOwnerSettingsTab,
};
let ownerActiveTab = 'services';

// The Requests tab is markup that schedule.html doesn't carry yet, so its
// button is inserted here — guarded so it appears exactly once.
// Two tabs that schedule.html does not carry markup for yet. Guarded so they
// appear exactly once, however often the panel is opened.

// ── REQUESTS WAITING ──
// An extensions booking arrives as a request: it holds its slot for two days,
// but it is not on the grid, because a stylist must not arrange her day around
// a client nobody has accepted yet. That makes it invisible unless something
// says so - hence the banner, above the day, where she is already looking.
async function refreshRequestBanner() {
  const bar = document.getElementById('requestBanner');
  if (!bar || !currentPin) return;
  const { data, error } = await fetchPendingCount(currentPin);
  const n = (!error && Number(data)) || 0;
  bar.hidden = n === 0;
  if (n === 0) return;
  document.getElementById('requestBannerText').textContent =
    n === 1 ? '1 extensions request is waiting to be accepted or turned down.'
            : `${n} extensions requests are waiting to be accepted or turned down.`;
}

/** What to call this booking's state. A rejected request is stored as
 *  cancelled - forty availability queries depend on that - but calling it
 *  "cancelled" tells the salon the client pulled out, when in fact they
 *  turned her down. The distinction matters when reading back a day. */
function statusLabel(b) {
  if (b.rejected_at) return 'Rejected';
  return STATUS_LABELS[b.status] || b.status;
}

function ensureRequestsTabButton() {
  if (!ownerTabs) return;
  const add = (tab, label, atStart) => {
    if (ownerTabs.querySelector(`[data-tab="${tab}"]`)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'owner-tab';
    btn.dataset.tab = tab;
    btn.textContent = label;
    if (atStart) ownerTabs.insertBefore(btn, ownerTabs.firstChild);
    else ownerTabs.appendChild(btn);
  };
  add('requests', 'Requests', true);
  add('export', 'Export', false);
}

function openOwnerPanel() {
  ensureRequestsTabButton();
  ownerPanelModal.style.display = 'flex';
  // The section renders either way - a wide screen shows it beside the menu.
  // showOwnerMenu comes AFTER, because switchOwnerTab marks the panel as
  // viewing a section, and on a phone that would hide the menu the instant
  // the panel opened: you would land inside whichever section you used last,
  // with no list in sight.
  switchOwnerTab(ownerActiveTab);
  showOwnerMenu();
}
function closeOwnerPanel() { ownerPanelModal.style.display = 'none'; }
// On a wide screen the menu and the section sit side by side, both always
// visible. A phone has room for one at a time, so it behaves like a menu you
// tap into: choosing a section replaces the list and the heading becomes that
// section's name with a back arrow.
const ownerPanelEl = document.querySelector('#ownerPanelModal .owner-panel');
const ownerBack = document.getElementById('ownerBack');
const ownerPanelHeading = document.getElementById('ownerPanelHeading');

function switchOwnerTab(tab) {
  ownerActiveTab = tab;
  ownerTabs.querySelectorAll('.owner-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ownerTabContent.innerHTML = '<p class="owner-empty">Loading…</p>';
  (OWNER_TAB_RENDERERS[tab] || (() => {}))();
  const btn = ownerTabs.querySelector(`.owner-tab[data-tab="${tab}"]`);
  ownerPanelHeading.textContent = btn ? btn.textContent.trim() : 'Owner Panel';
  ownerPanelEl.classList.add('owner-viewing');
  ownerTabContent.scrollTop = 0;
}

function showOwnerMenu() {
  ownerPanelEl.classList.remove('owner-viewing');
  ownerPanelHeading.textContent = 'Owner Panel';
}
ownerBack.addEventListener('click', showOwnerMenu);
btnOwnerPanel.addEventListener('click', () => { closeMoreMenu(); openOwnerPanel(); });
ownerPanelClose.addEventListener('click', closeOwnerPanel);
ownerPanelModal.addEventListener('click', (e) => { if (e.target === ownerPanelModal) closeOwnerPanel(); });
ownerTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.owner-tab');
  if (btn) switchOwnerTab(btn.dataset.tab);
});

const OWNER_CATEGORIES = ['Balayage & Highlights', 'Color', 'Haircuts & Styling', 'Styling',
  'Special Occasions', 'Bridal', 'Hair Extensions', 'Consultation'];

// Real file-upload photo picker, shared by the Services and Staff forms —
// stores the uploaded file's public URL in a hidden input (still the same
// image_url/photo_url text column, just no longer hand-typed).
function ownerPhotoFieldHtml({ fileId, previewId, previewEmptyId, statusId, hiddenId, label }) {
  return `
    <div class="block-field full">
      <label>${label}</label>
      <div class="owner-photo-picker">
        <img id="${previewId}" class="owner-photo-preview" style="display:none;" alt="" />
        <div id="${previewEmptyId}" class="owner-photo-preview-empty"><i class="fa-solid fa-image"></i></div>
        <div class="owner-photo-picker-actions">
          <label class="owner-photo-upload-btn" for="${fileId}"><i class="fa-solid fa-upload"></i> Upload photo</label>
          <input type="file" id="${fileId}" accept="image/*" style="display:none;" />
          <div id="${statusId}" class="owner-photo-status"></div>
        </div>
      </div>
      <input type="hidden" id="${hiddenId}" />
    </div>
  `;
}
function setOwnerPhotoPreview({ previewId, previewEmptyId, url }) {
  const preview = document.getElementById(previewId);
  const previewEmpty = document.getElementById(previewEmptyId);
  if (url) { preview.src = url; preview.style.display = ''; previewEmpty.style.display = 'none'; }
  else { preview.removeAttribute('src'); preview.style.display = 'none'; previewEmpty.style.display = ''; }
}
function wireOwnerPhotoPicker({ fileId, previewId, previewEmptyId, statusId, hiddenId, folder }) {
  const fileInput = document.getElementById(fileId);
  const statusEl = document.getElementById(statusId);
  const hidden = document.getElementById(hiddenId);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    setOwnerPhotoPreview({ previewId, previewEmptyId, url: URL.createObjectURL(file) });
    statusEl.textContent = 'Uploading…'; statusEl.className = 'owner-photo-status';
    const { data: url, error } = await uploadOwnerImage({ folder, file });
    fileInput.value = '';
    if (error) { statusEl.textContent = 'Upload failed: ' + error.message; statusEl.className = 'owner-photo-status error'; return; }
    hidden.value = url;
    statusEl.textContent = '✓ Uploaded'; statusEl.className = 'owner-photo-status success';
  });
}

// Custom single-day picker for Owner Panel filter rows — same styled
// calendar-popover component used elsewhere (native <input type=date>
// can't be restyled, which is why every date field in this app uses this
// instead). Returns { get value(), clear() } so callers can read the
// selected date without re-touching the DOM themselves.
function ownerDatePickerHtml({ btnId, labelId, popoverId, prevId, nextId, monthLabelId, gridId, placeholder }) {
  return `
    <div class="calendar-pick-wrap">
      <button type="button" id="${btnId}" class="owner-date-pick-btn"><i class="fa-regular fa-calendar-days"></i> <span id="${labelId}">${placeholder}</span></button>
      <div id="${popoverId}" class="calendar-popover" style="display:none;">
        <div class="calendar-header">
          <button type="button" id="${prevId}" class="calendar-nav-btn" aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button>
          <span class="calendar-month-label" id="${monthLabelId}"></span>
          <button type="button" id="${nextId}" class="calendar-nav-btn" aria-label="Next month"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <div class="calendar-weekdays"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>
        <div class="calendar-grid" id="${gridId}"></div>
      </div>
    </div>
  `;
}
function wireOwnerDatePicker({ btnId, labelId, popoverId, prevId, nextId, monthLabelId, gridId, placeholder, onSelect }) {
  const btn = document.getElementById(btnId);
  const label = document.getElementById(labelId);
  const popover = document.getElementById(popoverId);
  const monthLabel = document.getElementById(monthLabelId);
  const grid = document.getElementById(gridId);
  let viewYear, viewMonth, selected = null;

  function render() {
    monthLabel.textContent = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
    const today = todayStr();
    let html = '';
    for (let i = 0; i < leadingBlanks; i++) html += '<span class="calendar-day calendar-day-blank"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toDateStr(new Date(viewYear, viewMonth, d));
      const classes = ['calendar-day'];
      if (iso === today) classes.push('is-today');
      if (iso === selected) classes.push('selected');
      html += `<button type="button" class="${classes.join(' ')}" data-date="${iso}">${d}</button>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.calendar-day:not(.calendar-day-blank)').forEach((cell) => {
      cell.addEventListener('click', () => {
        selected = cell.dataset.date;
        label.textContent = new Date(selected + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        close();
        onSelect(selected);
      });
    });
  }
  function open() {
    const d = new Date((selected || todayStr()) + 'T00:00:00');
    viewYear = d.getFullYear(); viewMonth = d.getMonth();
    render();
    popover.style.display = 'block';
    positionPopoverNear(btn, popover);
    btn.classList.add('active');
  }
  function close() { popover.style.display = 'none'; btn.classList.remove('active'); }
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover.style.display === 'block') close(); else open();
  });
  popover.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  document.getElementById(prevId).addEventListener('click', () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } render(); });
  document.getElementById(nextId).addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } render(); });
  return {
    get value() { return selected; },
    clear() { selected = null; label.textContent = placeholder; },
    setValue(dateStr) { selected = dateStr; label.textContent = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); },
  };
}

// Pill-button filter row (replaces boxy native <select> dropdowns to match
// the rest of the app's pill idiom — staff-pills, view-toggle, owner-tabs).
function ownerPillRowHtml({ id, options, active }) {
  return `<div class="owner-pill-row" id="${id}">${options.map((o) => `<button type="button" class="owner-filter-pill${o.value === active ? ' active' : ''}" data-value="${o.value}">${o.label}</button>`).join('')}</div>`;
}
function wireOwnerPillRow({ id, onChange }) {
  const el = document.getElementById(id);
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.owner-filter-pill');
    if (!btn) return;
    el.querySelectorAll('.owner-filter-pill').forEach((b) => b.classList.toggle('active', b === btn));
    onChange(btn.dataset.value);
  });
  return { get value() { return el.querySelector('.owner-filter-pill.active')?.dataset.value || ''; } };
}

async function renderOwnerServicesTab() {
  const { data, error } = await fetchAllServicesAdmin(currentPin);
  const services = !error && data ? data : FALLBACK_SERVICES_ADMIN;
  ownerTabContent.innerHTML = `
    <h4 class="owner-section-title" id="svcFormTitle">Add Service</h4>
    <input type="hidden" id="svcId" />
    <div class="owner-form-grid">
      <div class="block-field"><label>Name (EN)</label><input type="text" id="svcName" /></div>
      <div class="block-field"><label>Name (NO)</label><input type="text" id="svcNameNo" /></div>
      <div class="block-field"><label>Category</label><select id="svcCategory">${OWNER_CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div class="block-field"><label>Color</label><input type="color" id="svcColor" value="#9a9aa2" /></div>
      <div class="block-field"><label>Price (NOK)</label><input type="number" id="svcPriceFrom" /></div>
      <div class="block-field"><label>Price to (optional)</label><input type="number" id="svcPriceTo" /></div>
      <div class="block-field"><label>Duration (minutes)</label><input type="number" id="svcDuration" /></div>
      <div class="block-field"><label>Duration with any add-on (blank = same)</label><input type="number" id="svcDurationAddons" /></div>
    </div>
    ${ownerPhotoFieldHtml({ fileId: 'svcImageFile', previewId: 'svcImagePreview', previewEmptyId: 'svcImagePreviewEmpty', statusId: 'svcImageStatus', hiddenId: 'svcImageUrl', label: 'Photo' })}
    <label class="owner-checkbox-row" style="margin-bottom:0.6rem;margin-top:1rem;"><input type="checkbox" id="svcPriceIsFrom" /> Price is a "from" price (price list says "from 3,750")</label>
    <label class="owner-checkbox-row" style="margin-bottom:0.6rem;"><input type="checkbox" id="svcOnConsultation" /> Price on consultation (quoted after a consultation)</label>
    <label class="owner-checkbox-row" style="margin-bottom:0.6rem;"><input type="checkbox" id="svcFeatured" /> Featured</label>
    <label class="owner-checkbox-row" style="margin-bottom:1rem;"><input type="checkbox" id="svcActive" checked /> Active</label>
    <div class="owner-form-actions">
      <button type="button" id="btnSaveService" class="block-save-btn" style="width:auto;flex:1;">Save Service</button>
      <button type="button" id="btnCancelServiceEdit" class="owner-cancel-edit-btn" style="display:none;">Cancel</button>
    </div>
    <div id="svcStatusMsg" class="owner-status-msg"></div>
    <div class="owner-list" id="svcList"></div>
  `;
  wireOwnerPhotoPicker({ fileId: 'svcImageFile', previewId: 'svcImagePreview', previewEmptyId: 'svcImagePreviewEmpty', statusId: 'svcImageStatus', hiddenId: 'svcImageUrl', folder: 'services' });

  function resetServiceForm() {
    document.getElementById('svcFormTitle').textContent = 'Add Service';
    ['svcId', 'svcName', 'svcNameNo', 'svcPriceFrom', 'svcPriceTo', 'svcDuration', 'svcDurationAddons', 'svcImageUrl'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('svcCategory').value = OWNER_CATEGORIES[0];
    document.getElementById('svcColor').value = '#9a9aa2';
    document.getElementById('svcPriceIsFrom').checked = false;
    document.getElementById('svcOnConsultation').checked = false;
    document.getElementById('svcFeatured').checked = false;
    document.getElementById('svcActive').checked = true;
    document.getElementById('btnCancelServiceEdit').style.display = 'none';
    document.getElementById('svcImageStatus').textContent = '';
    setOwnerPhotoPreview({ previewId: 'svcImagePreview', previewEmptyId: 'svcImagePreviewEmpty', url: null });
  }

  function renderServiceList() {
    const list = document.getElementById('svcList');
    if (!services.length) { list.innerHTML = '<p class="owner-empty">No services yet.</p>'; return; }
    list.innerHTML = services.map((s) => `
      <div class="owner-list-row">
        <span style="width:10px;height:10px;border-radius:50%;background:${s.color || '#9a9aa2'};flex-shrink:0;"></span>
        <div class="owner-list-row-main">
          <div class="owner-list-row-title">${s.name}</div>
          <div class="owner-list-row-meta">${s.category} · ${s.duration_minutes}min · ${s.price_on_consultation ? 'On consultation' : (s.price_from || 0) + (s.price_to ? '–' + s.price_to : '') + ' NOK'}</div>
        </div>
        ${!s.active ? '<span class="owner-status-pill" style="background:#f0f0f2;color:var(--sched-text-muted);">Inactive</span>' : ''}
        <div class="owner-list-row-actions">
          <button type="button" class="owner-icon-btn edit" data-id="${s.id}"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="owner-icon-btn delete" data-id="${s.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.owner-icon-btn.edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = services.find((x) => x.id === btn.dataset.id);
        if (!s) return;
        document.getElementById('svcFormTitle').textContent = `Editing ${s.name}`;
        document.getElementById('svcId').value = s.id;
        document.getElementById('svcName').value = s.name || '';
        document.getElementById('svcNameNo').value = s.name_no || '';
        document.getElementById('svcCategory').value = s.category;
        document.getElementById('svcColor').value = s.color || '#9a9aa2';
        document.getElementById('svcPriceFrom').value = s.price_from ?? '';
        document.getElementById('svcPriceTo').value = s.price_to ?? '';
        document.getElementById('svcDuration').value = s.duration_minutes ?? '';
        document.getElementById('svcDurationAddons').value = s.duration_with_addons_minutes ?? '';
        document.getElementById('svcImageUrl').value = s.image_url || '';
        document.getElementById('svcImageStatus').textContent = '';
        setOwnerPhotoPreview({ previewId: 'svcImagePreview', previewEmptyId: 'svcImagePreviewEmpty', url: s.image_url || null });
        document.getElementById('svcPriceIsFrom').checked = !!s.price_is_from;
        document.getElementById('svcOnConsultation').checked = !!s.price_on_consultation;
        document.getElementById('svcFeatured').checked = !!s.featured;
        document.getElementById('svcActive').checked = !!s.active;
        document.getElementById('btnCancelServiceEdit').style.display = '';
        ownerTabContent.scrollTop = 0;
      });
    });
    list.querySelectorAll('.owner-icon-btn.delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const s = services.find((x) => x.id === btn.dataset.id);
        if (!s || !confirm(`Delete "${s.name}"?`)) return;
        const { error: delErr } = await deleteServiceAdmin({ pin: currentPin, id: s.id });
        if (delErr) { alert('Could not delete: ' + delErr.message); return; }
        renderOwnerServicesTab();
      });
    });
  }
  renderServiceList();

  document.getElementById('btnCancelServiceEdit').addEventListener('click', resetServiceForm);
  document.getElementById('btnSaveService').addEventListener('click', async () => {
    const statusEl = document.getElementById('svcStatusMsg');
    const id = document.getElementById('svcId').value || null;
    const name = document.getElementById('svcName').value.trim();
    const onConsultation = document.getElementById('svcOnConsultation').checked;
    const duration = parseInt(document.getElementById('svcDuration').value, 10);
    const priceFrom = onConsultation ? null : parseFloat(document.getElementById('svcPriceFrom').value);
    if (!name || !duration || (!onConsultation && !priceFrom)) {
      statusEl.textContent = 'Name, duration, and a price (or "on consultation") are required.';
      statusEl.style.color = '#dc2626';
      return;
    }
    statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--sched-text-muted)';
    const priceToRaw = document.getElementById('svcPriceTo').value;
    const { error } = await upsertServiceAdmin({
      pin: currentPin, id,
      name, nameNo: document.getElementById('svcNameNo').value.trim(),
      category: document.getElementById('svcCategory').value,
      priceFrom, priceTo: priceToRaw ? parseFloat(priceToRaw) : null,
      priceOnConsultation: onConsultation, priceIsFrom: document.getElementById('svcPriceIsFrom').checked,
      durationMinutes: duration,
      durationWithAddonsMinutes: parseInt(document.getElementById('svcDurationAddons').value, 10) || null,
      color: document.getElementById('svcColor').value,
      imageUrl: document.getElementById('svcImageUrl').value.trim(),
      featured: document.getElementById('svcFeatured').checked,
      active: document.getElementById('svcActive').checked,
    });
    if (error) { statusEl.textContent = 'Error: ' + error.message; statusEl.style.color = '#dc2626'; return; }
    statusEl.textContent = '✓ Saved.'; statusEl.style.color = '#059669';
    renderOwnerServicesTab();
  });
}

// Mirrors the addons seed in migration 0005, for preview mode while the
// database is paused.
const FALLBACK_ADDONS_ADMIN = [
  { id: 'addon-haircut', name: 'Haircut', name_no: 'Klipp', price: 500, price_is_from: false, kind: 'addon', sort_order: 1, active: true },
  { id: 'addon-grey', name: 'Grey Coverage', name_no: 'Grådekking', price: 1200, price_is_from: false, kind: 'addon', sort_order: 2, active: true },
  { id: 'addon-toner', name: 'Toner', name_no: 'Toner', price: 1250, price_is_from: true, kind: 'combo', sort_order: 3, active: true },
];

// Which service offers which add-on, for preview mode. Mirrors the
// service_addons seed (and its two Haircut + Blowdry price overrides) so the
// tab doesn't read "0 services" against every row while Supabase is paused.
const FALLBACK_SERVICE_ADDONS_ADMIN = [
  ['svc-balayage', 'addon-haircut'], ['svc-balayage', 'addon-grey'], ['svc-balayage', 'addon-toner'],
  ['svc-half-foil', 'addon-haircut'], ['svc-half-foil', 'addon-grey'], ['svc-half-foil', 'addon-toner'],
  ['svc-full-foil', 'addon-haircut'], ['svc-full-foil', 'addon-grey'], ['svc-full-foil', 'addon-toner'],
  ['svc-reverse', 'addon-haircut'], ['svc-reverse', 'addon-grey'], ['svc-reverse', 'addon-toner'],
  ['svc-root', 'addon-haircut'], ['svc-root', 'addon-toner'],
  ['svc-allover', 'addon-haircut'], ['svc-allover', 'addon-toner'],
  ['svc-toner', 'addon-haircut'],
].map(([service_id, addon_id]) => ({ service_id, addon_id }));

// Bridal and updo bookings never carry add-ons, so those categories are left
// out of the offer checklist entirely — matches the rule book_appointment
// enforces, rather than leaving a tickbox that would be rejected on save.
const ADDON_EXCLUDED_CATEGORIES = ['Bridal', 'Special Occasions'];

// ── OWNER TAB: REQUESTS ──
// Extensions bookings arrive as requests rather than bookings, because the
// salon has to check the client came in for a consultation and paid a deposit
// first. Each holds its slot for two days; after that the time goes back on
// sale, though the request stays here so it can still be answered.
async function renderOwnerRequestsTab() {
  const { data, error } = await fetchPendingBookingsAdmin(currentPin);
  const rows = (!error && data) ? data : [];

  ownerTabContent.innerHTML = `
    <h4 class="owner-section-title">Booking Requests</h4>
    <p style="font-size:0.78rem;color:var(--sched-text-muted);margin-bottom:1rem;">
      Extensions bookings wait here until you confirm them. Each one holds its time for two days -
      after that the slot is released, but the request stays so you can still answer it.
      Confirming or rejecting emails the client automatically.
    </p>
    <div class="owner-list" id="reqList"></div>
  `;

  const list = document.getElementById('reqList');
  if (!rows.length) {
    list.innerHTML = '<p class="owner-empty">No requests waiting.</p>';
    return;
  }

  const holdLabel = (r) => {
    if (r.hold_expires_at == null) return '';
    const h = Number(r.hold_hours_left);
    if (!Number.isFinite(h)) return '';
    if (h <= 0) return '<span class="req-hold lapsed">Hold lapsed - slot released</span>';
    if (h < 12) return `<span class="req-hold urgent">${Math.round(h)}h left on hold</span>`;
    return `<span class="req-hold">${Math.round(h / 24 * 10) / 10} days left on hold</span>`;
  };

  list.innerHTML = rows.map((r) => `
    <div class="owner-booking-card pending" data-id="${r.id}">
      <div class="owner-booking-top">
        <span class="owner-booking-time">${fmtTime(r.start_time)}</span>
        <div class="owner-booking-main">
          <div class="owner-booking-name">${escHtml(r.customer_name)} - ${escHtml(r.service_name)}</div>
          <div class="owner-booking-meta">
            ${new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'long' })}
            · ${escHtml(r.staff_name)} · ${r.customer_phone || 'No phone'}${r.customer_email ? ' · ' + r.customer_email : ''}
          </div>
          ${holdLabel(r)}
        </div>
      </div>
      <div class="owner-booking-actions">
        <button type="button" class="owner-action-btn confirm" data-decide="confirmed" data-id="${r.id}"><i class="fa-solid fa-check"></i> Confirm &amp; email</button>
        <button type="button" class="owner-action-btn reject" data-decide="rejected" data-id="${r.id}"><i class="fa-solid fa-xmark"></i> Reject &amp; email</button>
      </div>
      <div class="owner-status-msg" id="reqMsg-${r.id}"></div>
    </div>
  `).join('');

  list.querySelectorAll('[data-decide]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const decision = btn.dataset.decide;
      const row = rows.find((r) => r.id === btn.dataset.id);
      const msg = document.getElementById(`reqMsg-${btn.dataset.id}`);
      let reason = null;
      if (decision === 'rejected') {
        reason = prompt('Anything to tell them? (optional - it goes in the email)') || null;
      }
      btn.closest('.owner-booking-card').querySelectorAll('button').forEach((x) => (x.disabled = true));
      msg.textContent = 'Saving…';
      msg.style.color = 'var(--sched-text-muted)';

      const { data, error } = await decideBookingAdmin({
        pin: currentPin, bookingId: btn.dataset.id, decision, reason,
      });
      if (error) {
        msg.textContent = 'Error: ' + error.message;
        msg.style.color = '#dc2626';
        btn.closest('.owner-booking-card').querySelectorAll('button').forEach((x) => (x.disabled = false));
        return;
      }

      // The decision is saved at this point. Mail is best-effort on top of it,
      // so a mail failure reports itself without undoing anything.
      const d = (Array.isArray(data) ? data[0] : data) || {};
      msg.textContent = decision === 'confirmed' ? '✓ Confirmed. Emailing…' : 'Rejected. Emailing…';
      msg.style.color = '#059669';

      // Routed through send-message rather than send-booking-email so a
      // rejection can reach her by text as well. She is being turned down for
      // a fitting she wanted, and the useful part of that message is the way
      // back in - a consultation - which is worth more than an apology she
      // may not open.
      const mail = await sendMessage({
        pin: currentPin,
        bookingId: btn.dataset.id,
        key: decision === 'confirmed' ? 'request_approved' : 'request_rejected',
        lang: 'no',
        email: d.customer_email || (row && row.customer_email) || '',
        phone: d.customer_phone || (row && row.customer_phone) || '',
        context: {
          customerName: d.customer_name || (row && row.customer_name) || '',
          serviceName: d.service_name || (row && row.service_name) || '',
          staffName: d.staff_name || (row && row.staff_name) || '',
          date: d.date || (row && row.date) || '',
          startTime: d.start_time || (row && row.start_time) || '',
          reason: reason || '',
        },
      });

      if (mail && mail.sent) {
        msg.textContent = decision === 'confirmed'
          ? '✓ Confirmed - email sent.'
          : '✓ Rejected - email sent.';
        msg.style.color = '#059669';
      } else {
        msg.innerHTML = `✓ ${decision === 'confirmed' ? 'Confirmed' : 'Rejected'}, but the email didn't send`
          + `<div class="req-mail-warn">${(mail && mail.reason) || 'Mail service unavailable'}</div>`
          + `<div class="req-mail-warn">Let them know yourself: `
          + `<a href="tel:${(row && row.customer_phone) || ''}">call</a>`
          + `${row && row.customer_email ? ` or <a href="mailto:${escHtml(row.customer_email)}">email</a>` : ''}.</div>`;
        msg.style.color = '#b45309';
      }
      setTimeout(() => renderOwnerRequestsTab(), 2200);
    });
  });
}

// ── OWNER TAB: EXPORT ──
// Two exports and a reconciliation total. See migration 0006 for why the
// accounting file deliberately carries no names.

// Norwegian Excel reads a comma as a DECIMAL separator, not a column
// separator, so a normal comma-separated file opens as one mangled column on
// a Norwegian machine. Semicolons are what it expects. Numbers get a comma
// decimal for the same reason — 1250.50 would otherwise be read as text.
const CSV_SEP = ';';

function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value).replace('.', ',');
  const s = String(value);
  // Quote anything that would otherwise break the row apart. Inner quotes are
  // doubled, which is what every spreadsheet expects.
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(headers, rows, keys) {
  const lines = [headers.map(csvCell).join(CSV_SEP)];
  rows.forEach((r) => lines.push(keys.map((k) => csvCell(r[k])).join(CSV_SEP)));
  return lines.join('\r\n');
}

function downloadCsv(filename, csv) {
  // The byte-order mark is what stops æ, ø and å arriving as mojibake: without
  // it Excel guesses the ANSI codepage and "Håkon" becomes something else.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Freed on a delay — revoking immediately can cancel the download in some
  // browsers before they have finished reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STATUS_NO = {
  pending: 'Venter', confirmed: 'Bekreftet', arrived: 'Ankommet',
  no_show: 'Møtte ikke', cancelled: 'Avlyst', completed: 'Fullført',
};

async function renderOwnerExportTab() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  ownerTabContent.innerHTML = `
    <h4 class="owner-section-title">Export</h4>
    <div class="export-range">
      <label>From <input type="date" id="expFrom" value="${iso(firstOfMonth)}"></label>
      <label>To <input type="date" id="expTo" value="${iso(today)}"></label>
    </div>

    <div class="export-card">
      <div class="export-card-title">Accounting</div>
      <p class="export-card-note">
        What was sold, when, by whom and for how much. <strong>No names, phone numbers or
        emails</strong> - this is the file for your accountant, and it is safe to keep or send on.
      </p>
      <button type="button" class="owner-action-btn" id="expAccounting">
        <i class="fa-solid fa-file-arrow-down"></i> Download accounting file
      </button>
      <span class="export-status" id="expAccountingMsg"></span>
    </div>

    <div class="export-card personal">
      <div class="export-card-title">Client list</div>
      <p class="export-card-note">
        Everything above <strong>plus names, phone numbers, emails and notes</strong>. Only export
        this when you actually need it, and delete the file when you are done - each download is
        recorded in the activity log.
      </p>
      <button type="button" class="owner-action-btn reject" id="expClients">
        <i class="fa-solid fa-user-lock"></i> Download client list
      </button>
      <span class="export-status" id="expClientsMsg"></span>
    </div>

    <h4 class="owner-section-title" style="margin-top:2rem;">End of day</h4>
    <p class="export-card-note" style="margin-bottom:0.9rem;">
      Compare each day against the card terminal's own end-of-day report. One number against one
      number - if they match, every booking that day is right.
    </p>
    <div id="expTotals" class="owner-list"></div>
  `;

  const from = () => document.getElementById('expFrom').value;
  const to = () => document.getElementById('expTo').value;

  const run = async (fetcher, headers, keys, prefix, msgEl, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    msgEl.textContent = 'Preparing…';
    msgEl.style.color = 'var(--sched-text-muted)';
    const { data, error } = await fetcher({ pin: currentPin, from: from(), to: to() });
    if (error) { msgEl.textContent = 'Error: ' + error.message; msgEl.style.color = '#dc2626'; return; }
    if (!data || !data.length) { msgEl.textContent = 'Nothing in that range.'; return; }
    const rows = data.map((r) => ({ ...r, status: STATUS_NO[r.status] || r.status }));
    downloadCsv(`studio-serena-${prefix}-${from()}-${to()}.csv`, toCsv(headers, rows, keys));
    msgEl.textContent = `${data.length} bookings exported.`;
    msgEl.style.color = '#059669';
  };

  document.getElementById('expAccounting').addEventListener('click', () => run(
    exportAccounting,
    ['Referanse', 'Dato', 'Fra', 'Til', 'Minutter', 'Stylist', 'Tjeneste', 'Tillegg',
      'Status', 'Forventet', 'Estimat', 'Belastet', 'Differanse', 'Booket'],
    ['booking_ref', 'date', 'start_time', 'end_time', 'duration_minutes', 'staff_name',
      'service_name', 'addons', 'status', 'expected_total', 'expected_is_estimate',
      'amount_charged', 'difference', 'booked_at'],
    'regnskap', document.getElementById('expAccountingMsg'),
  ));

  document.getElementById('expClients').addEventListener('click', () => run(
    exportClients,
    ['Referanse', 'Dato', 'Tid', 'Stylist', 'Tjeneste', 'Navn', 'Telefon', 'E-post',
      'Notater', 'Status', 'Belastet', 'Booket'],
    ['booking_ref', 'date', 'start_time', 'staff_name', 'service_name', 'customer_name',
      'customer_phone', 'customer_email', 'notes', 'status', 'amount_charged', 'booked_at'],
    'kundeliste', document.getElementById('expClientsMsg'),
    'This file contains client names, phone numbers and emails.\n\nOnly download it if you need it, and delete it when you are done. The download is recorded in the activity log.\n\nContinue?',
  ));

  const totalsEl = document.getElementById('expTotals');
  const { data: totals, error: totalsErr } = await fetchDailyTotals({ pin: currentPin, from: from(), to: to() });
  if (totalsErr) { totalsEl.innerHTML = '<p class="owner-empty">Could not load totals.</p>'; return; }
  if (!totals || !totals.length) { totalsEl.innerHTML = '<p class="owner-empty">No completed bookings in that range.</p>'; return; }

  const kr = (n) => Number(n || 0).toLocaleString('nb-NO') + ' NOK';
  totalsEl.innerHTML = totals.map((t) => {
    const off = Number(t.difference || 0);
    // A zero difference is the normal case and should read as calm, not as a
    // success worth colouring.
    const cls = off === 0 ? '' : (off > 0 ? 'over' : 'under');
    return `
      <div class="export-day">
        <div class="export-day-date">${new Date(t.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
        <div class="export-day-count">${t.bookings_completed} booking${Number(t.bookings_completed) === 1 ? '' : 's'}</div>
        <div class="export-day-total">${kr(t.charged_total)}</div>
        <div class="export-day-diff ${cls}">${off === 0 ? 'matches expected' : (off > 0 ? '+' : '') + kr(off)}</div>
        <div class="export-day-flag">${Number(t.overridden_count) > 0 ? `${t.overridden_count} amended` : ''}</div>
      </div>`;
  }).join('');
}

// ── OWNER TAB: ADD-ONS ──
// The catalog behind the wizard's "Can be combined with" chips. Editing a
// price here only affects FUTURE bookings — booking_addons keeps its own
// name/price snapshot, so past takings never move under the owner's feet.
async function renderOwnerAddonsTab() {
  const { data, error } = await fetchAddonsAdmin(currentPin);
  const addons = !error && data ? data : FALLBACK_ADDONS_ADMIN;
  const servicesForAssignment = currentServices[0]?.duration_minutes != null ? currentServices : FALLBACK_SERVICES_ADMIN;
  const { data: mapRes, error: mapError } = await fetchServiceAddonsAdmin(currentPin);
  const mapData = (!mapError && mapRes && mapRes.length) ? mapRes : FALLBACK_SERVICE_ADDONS_ADMIN;
  const addonServiceMap = {}; // addon_id -> Set(service_id)
  (mapData || []).forEach((row) => {
    if (!addonServiceMap[row.addon_id]) addonServiceMap[row.addon_id] = new Set();
    addonServiceMap[row.addon_id].add(row.service_id);
  });

  ownerTabContent.innerHTML = `
    <h4 class="owner-section-title" id="adnFormTitle">Add Add-on</h4>
    <input type="hidden" id="adnId" />
    <div class="owner-form-grid">
      <div class="block-field"><label>Name (EN)</label><input type="text" id="adnName" /></div>
      <div class="block-field"><label>Name (NO)</label><input type="text" id="adnNameNo" /></div>
      <div class="block-field"><label>Price (NOK)</label><input type="number" id="adnPrice" /></div>
      <div class="block-field"><label>How the price reads</label><select id="adnKind">
        <option value="addon">Added to the service - shows as "+500 NOK"</option>
        <option value="combo">A service in its own right - shows as "From 1,250 NOK"</option>
      </select></div>
      <div class="block-field"><label>Sort order</label><input type="number" id="adnSortOrder" value="0" /></div>
    </div>
    <p style="font-size:0.72rem;color:var(--sched-text-muted);margin:0.2rem 0 0.9rem;">
      "How the price reads" only changes the wording on the client's chip - a haircut bolted onto a colour reads
      as <em>+500 NOK</em>, a toner reads as its own <em>From 1,250 NOK</em>. Either way the same amount is added to the total.
    </p>
    <label class="owner-checkbox-row" style="margin-bottom:0.6rem;"><input type="checkbox" id="adnPriceIsFrom" /> Price is a "from" price (not exact)</label>
    <label class="owner-checkbox-row" style="margin-bottom:1rem;"><input type="checkbox" id="adnActive" checked /> Active</label>
    <p style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--sched-text-muted);margin-bottom:0.6rem;">Services that offer this add-on</p>
    <div id="adnServiceChecklist" class="stf-service-checklist">
      ${OWNER_CATEGORIES.filter((c) => !ADDON_EXCLUDED_CATEGORIES.includes(c)).map((cat) => `
        <div class="stf-service-cat-label">${cat}</div>
        ${servicesForAssignment.filter((s) => s.category === cat).map((s) => `
          <label class="owner-checkbox-row"><input type="checkbox" class="adn-service-cb" value="${s.id}" /> ${s.name}</label>
        `).join('')}
      `).join('')}
    </div>
    <div class="owner-form-actions" style="margin-top:1rem;">
      <button type="button" id="btnSaveAddon" class="block-save-btn" style="width:auto;flex:1;">Save Add-on</button>
      <button type="button" id="btnCancelAddonEdit" class="owner-cancel-edit-btn" style="display:none;">Cancel</button>
    </div>
    <div id="adnStatusMsg" class="owner-status-msg"></div>
    <div class="owner-list" id="adnList"></div>
  `;

  function setCheckedServices(serviceIdSet) {
    document.querySelectorAll('.adn-service-cb').forEach((cb) => {
      cb.checked = !!(serviceIdSet && serviceIdSet.has(cb.value));
    });
  }

  function resetAddonForm() {
    document.getElementById('adnFormTitle').textContent = 'Add Add-on';
    ['adnId', 'adnName', 'adnNameNo', 'adnPrice'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('adnKind').value = 'addon';
    document.getElementById('adnSortOrder').value = 0;
    document.getElementById('adnPriceIsFrom').checked = false;
    document.getElementById('adnActive').checked = true;
    document.getElementById('btnCancelAddonEdit').style.display = 'none';
    setCheckedServices(null);
  }

  function priceText(a) {
    const num = Number(a.price).toLocaleString('en-US') + ' NOK';
    return a.price_is_from ? 'From ' + num : num;
  }

  function renderAddonList() {
    const list = document.getElementById('adnList');
    if (!addons.length) { list.innerHTML = '<p class="owner-empty">No add-ons yet.</p>'; return; }
    list.innerHTML = addons.map((a) => {
      const count = (addonServiceMap[a.id] || new Set()).size;
      return `
      <div class="owner-list-row">
        <div class="owner-list-row-main">
          <div class="owner-list-row-title">${a.name}</div>
          <div class="owner-list-row-meta">${priceText(a)} · ${a.kind === 'combo' ? 'own price' : 'added on'} · ${count} service${count === 1 ? '' : 's'}</div>
        </div>
        ${!a.active ? '<span class="owner-status-pill" style="background:#f0f0f2;color:var(--sched-text-muted);">Inactive</span>' : ''}
        <div class="owner-list-row-actions">
          <button type="button" class="owner-icon-btn edit" data-id="${a.id}"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="owner-icon-btn delete" data-id="${a.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('.owner-icon-btn.edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = addons.find((x) => x.id === btn.dataset.id);
        if (!a) return;
        document.getElementById('adnFormTitle').textContent = `Editing ${a.name}`;
        document.getElementById('adnId').value = a.id;
        document.getElementById('adnName').value = a.name || '';
        document.getElementById('adnNameNo').value = a.name_no || '';
        document.getElementById('adnPrice').value = a.price ?? '';
        document.getElementById('adnKind').value = a.kind || 'addon';
        document.getElementById('adnSortOrder').value = a.sort_order ?? 0;
        document.getElementById('adnPriceIsFrom').checked = !!a.price_is_from;
        document.getElementById('adnActive').checked = !!a.active;
        setCheckedServices(addonServiceMap[a.id]);
        document.getElementById('btnCancelAddonEdit').style.display = '';
        ownerTabContent.scrollTop = 0;
      });
    });

    list.querySelectorAll('.owner-icon-btn.delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const a = addons.find((x) => x.id === btn.dataset.id);
        if (!a) return;
        // Worth spelling out: deleting is not retroactive, by design.
        if (!confirm(`Delete "${a.name}"?\n\nIt stops being offered on new bookings. Bookings that already include it keep the name and price they were quoted.`)) return;
        const { error: delErr } = await deleteAddonAdmin({ pin: currentPin, id: a.id });
        if (delErr) { alert('Could not delete: ' + delErr.message); return; }
        renderOwnerAddonsTab();
      });
    });
  }
  renderAddonList();

  document.getElementById('btnCancelAddonEdit').addEventListener('click', resetAddonForm);
  document.getElementById('btnSaveAddon').addEventListener('click', async () => {
    const statusEl = document.getElementById('adnStatusMsg');
    const name = document.getElementById('adnName').value.trim();
    const price = parseFloat(document.getElementById('adnPrice').value);
    if (!name || isNaN(price) || price < 0) {
      statusEl.textContent = 'Name and a valid price are required.';
      statusEl.style.color = '#dc2626';
      return;
    }
    statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--sched-text-muted)';
    const { data: saved, error: saveErr } = await upsertAddonAdmin({
      pin: currentPin, id: document.getElementById('adnId').value || null,
      name, nameNo: document.getElementById('adnNameNo').value.trim(),
      price, priceIsFrom: document.getElementById('adnPriceIsFrom').checked,
      kind: document.getElementById('adnKind').value,
      sortOrder: parseInt(document.getElementById('adnSortOrder').value, 10) || 0,
      active: document.getElementById('adnActive').checked,
    });
    if (saveErr) { statusEl.textContent = 'Error: ' + saveErr.message; statusEl.style.color = '#dc2626'; return; }

    // The offer list is a second call, same shape as the stylist-services save.
    const serviceIds = Array.from(document.querySelectorAll('.adn-service-cb:checked')).map((cb) => cb.value);
    const addonId = (saved && saved.id) || document.getElementById('adnId').value;
    if (addonId) {
      const { error: mapErr } = await setAddonServicesAdmin({ pin: currentPin, addonId, serviceIds });
      if (mapErr) { statusEl.textContent = 'Saved, but services failed: ' + mapErr.message; statusEl.style.color = '#dc2626'; return; }
    }
    statusEl.textContent = '✓ Saved.'; statusEl.style.color = '#059669';
    renderOwnerAddonsTab();
  });
}

async function renderOwnerStaffTab() {
  const { data, error } = await fetchAllStaffAdmin(currentPin);
  const staffList = !error && data ? data : FALLBACK_STAFF_ADMIN;
  const servicesForAssignment = currentServices[0]?.duration_minutes != null ? currentServices : FALLBACK_SERVICES_ADMIN;
  const { data: assignData, error: assignError } = await fetchStaffServicesAdmin(currentPin);
  const staffServiceMap = {}; // staff_id -> Set(service_id)
  (assignError || !assignData ? [] : assignData).forEach((row) => {
    if (!staffServiceMap[row.staff_id]) staffServiceMap[row.staff_id] = new Set();
    staffServiceMap[row.staff_id].add(row.service_id);
  });

  ownerTabContent.innerHTML = `
    <h4 class="owner-section-title" id="stfFormTitle">Add Stylist</h4>
    <input type="hidden" id="stfId" />
    <div class="owner-form-grid">
      <div class="block-field"><label>Name</label><input type="text" id="stfName" /></div>
      <div class="block-field"><label>Role (EN)</label><input type="text" id="stfRole" /></div>
      <div class="block-field"><label>Role (NO)</label><input type="text" id="stfRoleNo" /></div>
      <div class="block-field"><label>Instagram URL</label><input type="text" id="stfInstagram" /></div>
      <div class="block-field full"><label>Bio (EN)</label><input type="text" id="stfBio" /></div>
      <div class="block-field full"><label>Bio (NO)</label><input type="text" id="stfBioNo" /></div>
      <div class="block-field"><label>Sort order</label><input type="number" id="stfSortOrder" value="0" /></div>
      <div class="block-field full"><label>External booking URL (if not bookable here)</label><input type="text" id="stfExternalUrl" /></div>
      <div class="block-field full"><label>External booking button text</label><input type="text" id="stfExternalLabel" placeholder="e.g. Book on Timma" /></div>
    </div>
    ${ownerPhotoFieldHtml({ fileId: 'stfPhotoFile', previewId: 'stfPhotoPreview', previewEmptyId: 'stfPhotoPreviewEmpty', statusId: 'stfPhotoStatus', hiddenId: 'stfPhotoUrl', label: 'Photo' })}
    <label class="owner-checkbox-row" style="margin-bottom:0.6rem;margin-top:1rem;"><input type="checkbox" id="stfBookable" checked /> Bookable in this system</label>
    <label class="owner-checkbox-row" style="margin-bottom:0.6rem;"><input type="checkbox" id="stfOverlap" /> Allow Balayage overlap-pairing (Hassan-style)</label>
    <label class="owner-checkbox-row" style="margin-bottom:1rem;"><input type="checkbox" id="stfActive" checked /> Active</label>
    <p style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--sched-text-muted);margin-bottom:0.6rem;">Services this stylist performs</p>
    <div id="stfServiceChecklist" class="stf-service-checklist">
      ${OWNER_CATEGORIES.map((cat) => `
        <div class="stf-service-cat-label">${cat}</div>
        ${servicesForAssignment.filter((s) => s.category === cat).map((s) => `
          <label class="owner-checkbox-row"><input type="checkbox" class="stf-service-cb" value="${s.id}" /> ${s.name}</label>
        `).join('')}
      `).join('')}
    </div>
    <div class="owner-form-actions" style="margin-top:1rem;">
      <button type="button" id="btnSaveStaff" class="block-save-btn" style="width:auto;flex:1;">Save Stylist</button>
      <button type="button" id="btnCancelStaffEdit" class="owner-cancel-edit-btn" style="display:none;">Cancel</button>
    </div>
    <div id="stfStatusMsg" class="owner-status-msg"></div>
    <div class="owner-list" id="stfList"></div>
  `;
  wireOwnerPhotoPicker({ fileId: 'stfPhotoFile', previewId: 'stfPhotoPreview', previewEmptyId: 'stfPhotoPreviewEmpty', statusId: 'stfPhotoStatus', hiddenId: 'stfPhotoUrl', folder: 'staff' });

  function setCheckedServices(serviceIdSet) {
    document.querySelectorAll('.stf-service-cb').forEach((cb) => { cb.checked = serviceIdSet ? serviceIdSet.has(cb.value) : false; });
  }

  function resetStaffForm() {
    document.getElementById('stfFormTitle').textContent = 'Add Stylist';
    ['stfId', 'stfName', 'stfRole', 'stfRoleNo', 'stfInstagram', 'stfBio', 'stfBioNo', 'stfPhotoUrl', 'stfExternalUrl', 'stfExternalLabel'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('stfSortOrder').value = '0';
    document.getElementById('stfBookable').checked = true;
    document.getElementById('stfOverlap').checked = false;
    document.getElementById('stfActive').checked = true;
    document.getElementById('btnCancelStaffEdit').style.display = 'none';
    document.getElementById('stfPhotoStatus').textContent = '';
    setOwnerPhotoPreview({ previewId: 'stfPhotoPreview', previewEmptyId: 'stfPhotoPreviewEmpty', url: null });
    setCheckedServices(null);
  }

  function renderStaffList() {
    const list = document.getElementById('stfList');
    if (!staffList.length) { list.innerHTML = '<p class="owner-empty">No staff yet.</p>'; return; }
    list.innerHTML = staffList.map((s) => `
      <div class="owner-list-row">
        <div class="owner-list-row-main">
          <div class="owner-list-row-title">${s.name}</div>
          <div class="owner-list-row-meta">${s.role}${s.bookable ? '' : ' · Not bookable'}${s.allow_overlap_booking ? ' · Overlap-eligible' : ''}</div>
        </div>
        ${!s.active ? '<span class="owner-status-pill" style="background:#f0f0f2;color:var(--sched-text-muted);">Inactive</span>' : ''}
        <div class="owner-list-row-actions">
          <button type="button" class="owner-icon-btn edit" data-id="${s.id}"><i class="fa-solid fa-pen"></i></button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.owner-icon-btn.edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = staffList.find((x) => x.id === btn.dataset.id);
        if (!s) return;
        document.getElementById('stfFormTitle').textContent = `Editing ${s.name}`;
        document.getElementById('stfId').value = s.id;
        document.getElementById('stfName').value = s.name || '';
        document.getElementById('stfRole').value = s.role || '';
        document.getElementById('stfRoleNo').value = s.role_no || '';
        document.getElementById('stfInstagram').value = s.instagram || '';
        document.getElementById('stfBio').value = s.bio || '';
        document.getElementById('stfBioNo').value = s.bio_no || '';
        document.getElementById('stfPhotoUrl').value = s.photo_url || '';
        document.getElementById('stfPhotoStatus').textContent = '';
        setOwnerPhotoPreview({ previewId: 'stfPhotoPreview', previewEmptyId: 'stfPhotoPreviewEmpty', url: s.photo_url || null });
        document.getElementById('stfExternalUrl').value = s.external_booking_url || '';
        document.getElementById('stfExternalLabel').value = s.external_booking_label || '';
        document.getElementById('stfSortOrder').value = s.sort_order ?? 0;
        document.getElementById('stfBookable').checked = !!s.bookable;
        document.getElementById('stfOverlap').checked = !!s.allow_overlap_booking;
        document.getElementById('stfActive').checked = !!s.active;
        setCheckedServices(staffServiceMap[s.id]);
        document.getElementById('btnCancelStaffEdit').style.display = '';
        ownerTabContent.scrollTop = 0;
      });
    });
  }
  renderStaffList();

  document.getElementById('btnCancelStaffEdit').addEventListener('click', resetStaffForm);
  document.getElementById('btnSaveStaff').addEventListener('click', async () => {
    const statusEl = document.getElementById('stfStatusMsg');
    const name = document.getElementById('stfName').value.trim();
    const role = document.getElementById('stfRole').value.trim();
    if (!name || !role) { statusEl.textContent = 'Name and role are required.'; statusEl.style.color = '#dc2626'; return; }
    statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--sched-text-muted)';
    const { data: savedStaff, error } = await upsertStaffAdmin({
      pin: currentPin, id: document.getElementById('stfId').value || null,
      name, role, roleNo: document.getElementById('stfRoleNo').value.trim(),
      bio: document.getElementById('stfBio').value.trim(), bioNo: document.getElementById('stfBioNo').value.trim(),
      photoUrl: document.getElementById('stfPhotoUrl').value.trim(), instagram: document.getElementById('stfInstagram').value.trim(),
      bookable: document.getElementById('stfBookable').checked,
      externalBookingUrl: document.getElementById('stfExternalUrl').value.trim(),
      externalBookingLabel: document.getElementById('stfExternalLabel').value.trim(),
      allowOverlapBooking: document.getElementById('stfOverlap').checked,
      sortOrder: parseInt(document.getElementById('stfSortOrder').value, 10) || 0,
      active: document.getElementById('stfActive').checked,
    });
    if (error) { statusEl.textContent = 'Error: ' + error.message; statusEl.style.color = '#dc2626'; return; }
    const checkedServiceIds = [...document.querySelectorAll('.stf-service-cb:checked')].map((cb) => cb.value);
    if (savedStaff?.id) {
      const { error: svcErr } = await setStaffServicesAdmin({ pin: currentPin, staffId: savedStaff.id, serviceIds: checkedServiceIds });
      if (svcErr) { statusEl.textContent = 'Saved stylist, but services failed: ' + svcErr.message; statusEl.style.color = '#dc2626'; return; }
    }
    statusEl.textContent = '✓ Saved.'; statusEl.style.color = '#059669';
    renderOwnerStaffTab();
    loadStaff();
  });
}

// Which action buttons make sense for a given current status — no point
// showing "Confirm" on a booking that's already been cancelled.
function ownerBookingActionsFor(status) {
  const actions = [];
  if (status === 'pending' || status === 'confirmed') actions.push({ type: 'move', cls: 'move', icon: 'fa-arrows-up-down-left-right', label: 'Move' });
  if (status === 'pending' || status === 'confirmed' || status === 'arrived') actions.push({ type: 'status', status: 'completed', cls: 'complete', icon: 'fa-flag-checkered', label: 'Complete' });
  if (status !== 'cancelled' && status !== 'completed') actions.push({ type: 'status', status: 'cancelled', cls: 'cancel', icon: 'fa-xmark', label: 'Cancel' });
  return actions;
}

const REVENUE_PERIODS = [
  { value: 'today', label: 'Today' }, { value: 'week', label: 'This Week' },
  { value: 'lastweek', label: 'Last Week' }, { value: 'last2weeks', label: 'Last 2 Weeks' },
  { value: 'month', label: 'This Month' }, { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
];
async function renderOwnerRevenueTab() {
  ownerTabContent.innerHTML = `
    ${ownerPillRowHtml({ id: 'revPeriodPills', active: 'month', options: REVENUE_PERIODS })}
    <div class="revenue-range-row">
      <span class="revenue-range-sep">or a custom range -</span>
      ${ownerDatePickerHtml({ btnId: 'revFromBtn', labelId: 'revFromLabel', popoverId: 'revFromPop', prevId: 'revFromPrev', nextId: 'revFromNext', monthLabelId: 'revFromMonth', gridId: 'revFromGrid', placeholder: 'From' })}
      <span class="revenue-range-sep">to</span>
      ${ownerDatePickerHtml({ btnId: 'revToBtn', labelId: 'revToLabel', popoverId: 'revToPop', prevId: 'revToPrev', nextId: 'revToNext', monthLabelId: 'revToMonth', gridId: 'revToGrid', placeholder: 'To' })}
      <button type="button" id="revRangeClear" class="history-date-clear" style="display:none;">Clear</button>
    </div>
    <div id="revenueContent"><p class="owner-empty">Loading…</p></div>
  `;
  const periodPills = wireOwnerPillRow({ id: 'revPeriodPills', onChange: () => { fromPicker.clear(); toPicker.clear(); document.getElementById('revRangeClear').style.display = 'none'; load(); } });
  const onRangePick = () => {
    if (fromPicker.value && toPicker.value) {
      document.querySelectorAll('#revPeriodPills .owner-filter-pill').forEach((b) => b.classList.remove('active'));
      document.getElementById('revRangeClear').style.display = '';
      load();
    }
  };
  const fromPicker = wireOwnerDatePicker({ btnId: 'revFromBtn', labelId: 'revFromLabel', popoverId: 'revFromPop', prevId: 'revFromPrev', nextId: 'revFromNext', monthLabelId: 'revFromMonth', gridId: 'revFromGrid', placeholder: 'From', onSelect: onRangePick });
  const toPicker = wireOwnerDatePicker({ btnId: 'revToBtn', labelId: 'revToLabel', popoverId: 'revToPop', prevId: 'revToPrev', nextId: 'revToNext', monthLabelId: 'revToMonth', gridId: 'revToGrid', placeholder: 'To', onSelect: onRangePick });
  document.getElementById('revRangeClear').addEventListener('click', () => {
    fromPicker.clear(); toPicker.clear();
    document.getElementById('revRangeClear').style.display = 'none';
    document.querySelector('#revPeriodPills .owner-filter-pill[data-value="month"]').classList.add('active');
    load();
  });

  let expandedStaffId = null;
  let cache = null; // { rows, completedDetail, from, to, useCustomRange } from the last fetch

  function renderList() {
    const content = document.getElementById('revenueContent');
    const { rows, completedDetail, from, to, useCustomRange } = cache;
    const total = rows.reduce((sum, r) => sum + Number(r.total_revenue), 0);
    const count = rows.reduce((sum, r) => sum + Number(r.booking_count), 0);
    const avg = count ? total / count : 0;
    const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const periodLabel = useCustomRange
      ? (from === to ? fmtDay(from) : `${fmtDay(from)} – ${fmtDay(to)}`)
      : (REVENUE_PERIODS.find((p) => p.value === (periodPills.value || 'month')) || {}).label || 'This period';
    const maxRevenue = Math.max(1, ...rows.map((r) => Number(r.total_revenue)));

    content.innerHTML = `
      <div class="revenue-summary">
        <div class="revenue-period-label">${periodLabel} · Total Revenue</div>
        <div class="revenue-total-amount">${Math.round(total).toLocaleString('en-US')} NOK</div>
        <div class="revenue-stats-row">
          <div class="revenue-stat"><strong>${count}</strong>Completed booking${count === 1 ? '' : 's'}</div>
          <div class="revenue-stat"><strong>${Math.round(avg).toLocaleString('en-US')} NOK</strong>Average per booking</div>
        </div>
      </div>
      <h4 class="owner-section-title">By Stylist <span style="font-weight:400;color:var(--sched-text-muted);font-size:0.72rem;text-transform:none;letter-spacing:0;">- tap a stylist for the breakdown</span></h4>
      <div class="revenue-stylist-list">
        ${rows.length ? rows.map((r) => {
          const isOpen = expandedStaffId === r.staff_id;
          const mine = completedDetail.filter((b) => b.staff_id === r.staff_id)
            .slice().sort((a, b) => (b.date + b.start_time).localeCompare(a.date + a.start_time));
          return `
          <div class="revenue-stylist-row${isOpen ? ' open' : ''}" data-staff="${r.staff_id}">
            <div class="revenue-stylist-main">
              <div class="revenue-stylist-name"><i class="fa-solid fa-chevron-right revenue-expand-icon"></i> ${escHtml(r.staff_name)}</div>
              <div class="revenue-stylist-meta">${r.booking_count} completed booking${Number(r.booking_count) === 1 ? '' : 's'}</div>
              <div class="revenue-bar-track"><div class="revenue-bar-fill" style="width:${(Number(r.total_revenue) / maxRevenue) * 100}%;"></div></div>
            </div>
            <div class="revenue-stylist-amount">${Math.round(Number(r.total_revenue)).toLocaleString('en-US')} NOK</div>
          </div>
          ${isOpen ? `
          <div class="revenue-detail-list">
            ${mine.length ? mine.map((b) => `
              <div class="revenue-detail-row">
                <div class="revenue-detail-main">
                  <div class="revenue-detail-service">${escHtml(b.service_name)}</div>
                  <div class="revenue-detail-meta">${escHtml(b.customer_name)} · ${new Date(b.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                </div>
                <div class="revenue-detail-amount">${b.amount_charged != null ? Math.round(Number(b.amount_charged)).toLocaleString('en-US') + ' NOK' : '-'}</div>
              </div>
            `).join('') : '<p class="owner-empty">No completed bookings in this period.</p>'}
          </div>` : ''}
        `;
        }).join('') : '<p class="owner-empty">No stylists found.</p>'}
      </div>
    `;
    content.querySelectorAll('.revenue-stylist-row').forEach((row) => {
      row.addEventListener('click', () => {
        expandedStaffId = expandedStaffId === row.dataset.staff ? null : row.dataset.staff;
        renderList();
      });
    });
  }

  async function load() {
    document.getElementById('revenueContent').innerHTML = '<p class="owner-empty">Loading…</p>';
    const useCustomRange = fromPicker.value && toPicker.value;
    const { from, to } = useCustomRange ? { from: fromPicker.value, to: toPicker.value } : revenueRangeFor(periodPills.value || 'month');
    const [revRes, bkRes] = await Promise.all([
      fetchRevenueAdmin({ pin: currentPin, dateFrom: from, dateTo: to }),
      fetchBookingsAdmin({ pin: currentPin, dateFrom: from, status: 'completed' }),
    ]);
    let rows = revRes.data;
    let completedDetail = !bkRes.error && bkRes.data ? bkRes.data.filter((b) => b.date <= to) : null;
    if (revRes.error || !completedDetail) {
      completedDetail = [...fallbackWindowBookings(todayStr()), ...fallbackHistoryBookings(todayStr())]
        .filter((b) => b.status === 'completed' && b.amount_charged != null && b.date >= from && b.date <= to);
    }
    if (revRes.error) {
      rows = FALLBACK_STAFF_ADMIN.filter((s) => s.bookable).map((s) => {
        const mine = completedDetail.filter((b) => b.staff_id === s.id);
        return { staff_id: s.id, staff_name: s.name, total_revenue: mine.reduce((sum, b) => sum + b.amount_charged, 0), booking_count: mine.length };
      }).sort((a, b) => b.total_revenue - a.total_revenue);
    }
    expandedStaffId = null;
    cache = { rows, completedDetail, from, to, useCustomRange };
    renderList();
  }
  load();
}

async function renderOwnerBookingsTab() {
  ownerTabContent.innerHTML = `
    <div class="owner-filter-row">
      <button type="button" id="btnAddBooking" class="owner-action-btn move" style="flex-shrink:0;"><i class="fa-solid fa-plus"></i> Add Booking</button>
      <button type="button" id="btnRefreshAdmBookings" class="owner-cancel-edit-btn">Refresh</button>
    </div>
    <div class="history-search-row" style="margin-bottom:0.9rem;">
      <i class="fa-solid fa-magnifying-glass history-search-icon"></i>
      <input type="text" id="admBkSearch" class="history-search-input" placeholder="Search name, phone, or email…" />
      <button type="button" id="admBkSearchClear" class="history-search-clear" style="display:none;" aria-label="Clear search"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="owner-filter-row">
      ${ownerDatePickerHtml({ btnId: 'admBkDateBtn', labelId: 'admBkDateLabel', popoverId: 'admBkDatePop', prevId: 'admBkDatePrev', nextId: 'admBkDateNext', monthLabelId: 'admBkDateMonth', gridId: 'admBkDateGrid', placeholder: 'From date' })}
      ${ownerPillRowHtml({
        id: 'admBkStatusPills', active: '',
        options: [
          { value: '', label: 'All' }, { value: 'confirmed', label: 'Confirmed' },
          { value: 'arrived', label: 'Arrived' }, { value: 'no_show', label: 'No-show' },
          { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' },
        ],
      })}
    </div>
    <div id="admBkCount" class="owner-count-line"></div>
    <div id="admBkList"><p class="owner-empty">Loading…</p></div>
  `;
  const datePicker = wireOwnerDatePicker({ btnId: 'admBkDateBtn', labelId: 'admBkDateLabel', popoverId: 'admBkDatePop', prevId: 'admBkDatePrev', nextId: 'admBkDateNext', monthLabelId: 'admBkDateMonth', gridId: 'admBkDateGrid', placeholder: 'From date', onSelect: load });
  const statusPills = wireOwnerPillRow({ id: 'admBkStatusPills', onChange: load });
  const searchInput = document.getElementById('admBkSearch');
  const searchClear = document.getElementById('admBkSearchClear');
  let loadedRows = [];

  /** The fee on a late cancellation or a no-show, and what can be done about
   *  it. Priced automatically at half the booking, but whether to charge it -
   *  and how much - is a judgement about a particular client, so the waiver
   *  and a different figure are both one press away.
   *
   *  Shown only where there is a fee to decide about; an ordinary booking
   *  carries none of this. */
  function cancellationFeeHtml(b) {
    if (!b.late_cancellation && b.status !== 'no_show') return '';
    const why = b.status === 'no_show' ? 'Did not turn up' : 'Cancelled late';
    const notice = (b.hours_notice != null && b.status !== 'no_show')
      ? ' &middot; ' + Math.max(0, Math.round(b.hours_notice)) + 'h notice' : '';

    if (b.cancellation_fee_waived) {
      return '<div class="owner-fee-box waived">'
        + '<span><i class="fa-solid fa-circle-check"></i> ' + why + notice
        + ' &middot; <strong>not charged</strong></span>'
        + '<button type="button" class="owner-fee-btn" data-fee-unwaive="' + escHtml(b.id) + '">Charge after all</button>'
        + '</div>';
    }
    if (b.cancellation_fee == null) {
      // No fixed price means no half to take. Saying so beats an empty space.
      return '<div class="owner-fee-box none">'
        + '<span><i class="fa-solid fa-circle-info"></i> ' + why + notice
        + ' &middot; no set price, so no fee was worked out</span>'
        + '<button type="button" class="owner-fee-btn" data-fee-set="' + escHtml(b.id) + '">Set an amount</button>'
        + '</div>';
    }
    const paid = b.cancellation_fee_settled;
    return '<div class="owner-fee-box' + (paid ? ' settled' : '') + '">'
      + '<span><i class="fa-solid fa-triangle-exclamation"></i> ' + why + notice
      + ' &middot; <strong>' + Number(b.cancellation_fee).toLocaleString('nb-NO') + ' kr</strong> '
      + (paid ? 'paid' : 'owed') + '</span>'
      + (paid ? '' :
          '<span class="owner-fee-actions">'
          + '<button type="button" class="owner-fee-btn" data-fee-set="' + escHtml(b.id) + '">Change amount</button>'
          + '<button type="button" class="owner-fee-btn waive" data-fee-waive="' + escHtml(b.id) + '">Do not charge</button>'
          + '</span>')
      + '</div>';
  }

  function renderList() {
    const list = document.getElementById('admBkList');
    const countLine = document.getElementById('admBkCount');
    const q = searchInput.value.trim().toLowerCase();
    const filtered = !q ? loadedRows : loadedRows.filter((b) =>
      b.customer_name.toLowerCase().includes(q) || (b.customer_phone || '').includes(q) || (b.customer_email || '').toLowerCase().includes(q));
    if (!filtered.length) { list.innerHTML = `<p class="owner-empty">${q ? 'No matching bookings.' : 'No bookings found.'}</p>`; countLine.textContent = ''; return; }
    countLine.textContent = `${filtered.length} booking${filtered.length === 1 ? '' : 's'}`;
    let html = '';
    let lastDate = null;
    filtered.forEach((b) => {
      if (b.date !== lastDate) {
        lastDate = b.date;
        html += `<div class="owner-date-header">${new Date(b.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>`;
      }
      const actions = ownerBookingActionsFor(b.status);
      html += `
        <div class="owner-booking-card ${b.status}" data-id="${b.id}">
          <div class="owner-booking-top">
            <span class="owner-booking-time">${fmtTime(b.start_time)}</span>
            <div class="owner-booking-main">
              <div class="owner-booking-name">${escHtml(b.customer_name)} - ${escHtml(b.service_name)}</div>
              <div class="owner-booking-meta">${escHtml(b.staff_name)} · ${b.customer_phone || 'No phone'}${b.customer_email ? ' · ' + b.customer_email : ''}</div>
              ${b.addons ? `<div class="owner-booking-notes"><i class="fa-solid fa-plus"></i> ${escHtml(b.addons)}</div>` : ''}
              ${b.notes ? `<div class="owner-booking-notes"><i class="fa-solid fa-note-sticky"></i> ${escHtml(b.notes)}</div>` : ''}
            </div>
            <span class="sched-status ${b.rejected_at ? 'rejected' : b.status}">${statusLabel(b)}</span>
          </div>
          ${b.status === 'completed' && b.amount_charged != null
            ? `<div class="owner-booking-amount">${Number(b.amount_charged).toLocaleString('en-US')} NOK charged${expectedLabel(b) ? ` · expected ${expectedLabel(b)}` : ''}</div>`
            : (expectedLabel(b) ? `<div class="owner-booking-amount owner-booking-expected">Expected ${expectedLabel(b)}</div>` : '')}
          ${cancellationFeeHtml(b)}
          ${actions.length ? `
          <div class="owner-booking-actions">
            ${actions.map((a) => `<button type="button" class="owner-action-btn ${a.cls}" data-type="${a.type}"${a.status ? ` data-status="${a.status}"` : ''}><i class="fa-solid ${a.icon}"></i> ${a.label}</button>`).join('')}
          </div>` : ''}
        </div>
      `;
    });
    list.innerHTML = html;
    list.querySelectorAll('[data-fee-waive]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const { error } = await waiveCancellationFee({ pin: currentPin, bookingId: btn.dataset.feeWaive });
        if (error) { alert('Could not save: ' + error.message); btn.disabled = false; return; }
        load();
      });
    });
    list.querySelectorAll('[data-fee-unwaive]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const { error } = await unwaiveCancellationFee({ pin: currentPin, bookingId: btn.dataset.feeUnwaive });
        if (error) { alert('Could not save: ' + error.message); btn.disabled = false; return; }
        load();
      });
    });
    list.querySelectorAll('[data-fee-set]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        // Zero is a real answer here - it waives the fee - so it is offered
        // rather than making the owner guess which button means nothing.
        const raw = prompt('What should she be charged, in kroner? Enter 0 to charge nothing.');
        if (raw === null) return;
        const amount = parseFloat(String(raw).replace(',', '.'));
        if (!Number.isFinite(amount) || amount < 0) { alert('Enter a number of zero or more.'); return; }
        btn.disabled = true;
        const { error } = await setCancellationFee({ pin: currentPin, bookingId: btn.dataset.feeSet, amount });
        if (error) { alert('Could not save: ' + error.message); btn.disabled = false; return; }
        load();
      });
    });
    list.querySelectorAll('.owner-booking-card').forEach((card) => {
      card.querySelectorAll('.owner-action-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const booking = loadedRows.find((bk) => bk.id === card.dataset.id);
          if (btn.dataset.type === 'move') { if (booking) { closeOwnerPanel(); startMoveMode(booking); } return; }
          if (btn.dataset.type === 'status' && btn.dataset.status === 'completed') { if (booking) openCompleteModal(booking); return; }
          const status = btn.dataset.status;
          if (status === 'cancelled' && !confirm('Cancel this booking?')) return;
          const { error: upErr } = await updateBookingStatusAdmin({ pin: currentPin, bookingId: card.dataset.id, status });
          if (upErr) { alert('Could not update: ' + upErr.message); return; }
          load();
        });
      });
    });
  }

  async function load() {
    const list = document.getElementById('admBkList');
    list.innerHTML = '<p class="owner-empty">Loading…</p>';
    const fromDate = datePicker.value;
    const statusFilter = statusPills.value;
    const { data, error } = await fetchBookingsAdmin({ pin: currentPin, dateFrom: fromDate, status: statusFilter });
    let rows = data;
    if (error) {
      rows = [...fallbackWindowBookings(todayStr()), ...fallbackHistoryBookings(todayStr())]
        .filter((b) => (!fromDate || b.date >= fromDate) && (!statusFilter || b.status === statusFilter));
    }
    loadedRows = (rows || []).slice().sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
    renderList();
  }
  searchInput.addEventListener('input', () => { searchClear.style.display = searchInput.value ? '' : 'none'; renderList(); });
  searchClear.addEventListener('click', () => { searchInput.value = ''; searchClear.style.display = 'none'; renderList(); });
  document.getElementById('btnRefreshAdmBookings').addEventListener('click', load);
  document.getElementById('btnAddBooking').addEventListener('click', () => openAddBookingModal());
  load();
}

const OWNER_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
async function renderOwnerHoursTab() {
  ownerTabContent.innerHTML = `
    <h4 class="owner-section-title">Business Hours</h4>
    <div id="admHoursGrid" style="margin-bottom:1.5rem;"><p class="owner-empty">Loading…</p></div>
    <button type="button" id="btnSaveHours" class="block-save-btn" style="margin-bottom:1.75rem;">Save Hours</button>
    <div id="admHoursStatus" class="owner-status-msg" style="margin-bottom:1.75rem;"></div>

    <h4 class="owner-section-title">Per-Stylist Hour Overrides</h4>
    <p style="font-size:0.78rem;color:var(--sched-text-muted);margin:-0.5rem 0 1rem;">For a stylist who closes later or earlier than the salon's general hours on a specific day - e.g. Kani stays until 18:00 on Mon/Wed/Fri.</p>
    <div class="owner-form-grid">
      <div class="block-field"><label>Stylist</label><select id="hoStaff"></select></div>
      <div class="block-field"><label>Day</label><select id="hoWeekday">${OWNER_WEEKDAY_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select></div>
      <div class="block-field full"><label>Closes at</label><input type="time" id="hoCloseTime" /></div>
    </div>
    <button type="button" id="btnSaveHourOverride" class="block-save-btn" style="margin-bottom:0.6rem;">Save Override</button>
    <div id="hoStatus" class="owner-status-msg" style="margin-bottom:1.25rem;"></div>
    <div class="owner-list" id="hoList"></div>
  `;

  const hoStaff = document.getElementById('hoStaff');
  currentStaff.forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id; opt.textContent = s.name;
    hoStaff.appendChild(opt);
  });

  async function loadHourOverrides() {
    const list = document.getElementById('hoList');
    list.innerHTML = '<p class="owner-empty">Loading…</p>';
    const { data, error } = await fetchStaffHoursOverridesAdmin(currentPin);
    if (error) { list.innerHTML = `<p class="owner-empty">Could not load: ${error.message}</p>`; return; }
    if (!data || !data.length) { list.innerHTML = '<p class="owner-empty">No overrides - everyone follows the salon\'s general hours.</p>'; return; }
    list.innerHTML = data.map((o) => `
      <div class="owner-list-row">
        <div class="owner-list-row-main">
          <div class="owner-list-row-title">${escHtml(o.staff_name)}</div>
          <div class="owner-list-row-meta">${OWNER_WEEKDAY_NAMES[o.weekday]} - closes at ${fmtTime(o.close_time)}</div>
        </div>
        <div class="owner-list-row-actions"><button type="button" class="owner-icon-btn delete" data-id="${o.id}"><i class="fa-solid fa-trash"></i></button></div>
      </div>
    `).join('');
    list.querySelectorAll('.owner-icon-btn.delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this override?')) return;
        const { error: delErr } = await deleteStaffHoursOverrideAdmin({ pin: currentPin, id: btn.dataset.id });
        if (delErr) { alert('Could not delete: ' + delErr.message); return; }
        loadHourOverrides();
      });
    });
  }
  loadHourOverrides();

  document.getElementById('btnSaveHourOverride').addEventListener('click', async () => {
    const statusEl = document.getElementById('hoStatus');
    const closeTime = document.getElementById('hoCloseTime').value;
    if (!closeTime) { statusEl.textContent = 'Pick a closing time.'; statusEl.style.color = '#dc2626'; return; }
    statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--sched-text-muted)';
    const { error } = await upsertStaffHoursOverrideAdmin({
      pin: currentPin, staffId: hoStaff.value, weekday: parseInt(document.getElementById('hoWeekday').value, 10), closeTime,
    });
    if (error) { statusEl.textContent = 'Error: ' + error.message; statusEl.style.color = '#dc2626'; return; }
    statusEl.textContent = '✓ Saved.'; statusEl.style.color = '#059669';
    document.getElementById('hoCloseTime').value = '';
    loadHourOverrides();
  });

  async function loadHours() {
    const grid = document.getElementById('admHoursGrid');
    const { data } = await fetchBusinessHours();
    const byDay = {};
    (data || []).forEach((d) => { byDay[d.weekday] = d; });
    grid.innerHTML = '';
    for (let w = 0; w <= 6; w++) {
      const d = byDay[w] || { weekday: w, open_time: '11:00', close_time: '17:30', closed: w === 0 || w === 6 };
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--sched-border);flex-wrap:wrap;';
      row.dataset.weekday = w;
      row.innerHTML = `
        <span style="width:90px;font-size:0.8rem;color:var(--sched-text);">${OWNER_WEEKDAY_NAMES[w]}</span>
        <input type="time" class="hrs-open" value="${(d.open_time || '11:00').slice(0, 5)}" style="padding:0.4rem;border-radius:8px;border:1px solid var(--sched-border);" ${d.closed ? 'disabled' : ''} />
        <span style="color:var(--sched-text-muted);font-size:0.75rem;">to</span>
        <input type="time" class="hrs-close" value="${(d.close_time || '17:30').slice(0, 5)}" style="padding:0.4rem;border-radius:8px;border:1px solid var(--sched-border);" ${d.closed ? 'disabled' : ''} />
        <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.76rem;color:var(--sched-text-muted);"><input type="checkbox" class="hrs-closed" ${d.closed ? 'checked' : ''} /> Closed</label>
      `;
      row.querySelector('.hrs-closed').addEventListener('change', (e) => {
        row.querySelector('.hrs-open').disabled = e.target.checked;
        row.querySelector('.hrs-close').disabled = e.target.checked;
      });
      grid.appendChild(row);
    }
  }
  await loadHours();

  document.getElementById('btnSaveHours').addEventListener('click', async () => {
    const statusEl = document.getElementById('admHoursStatus');
    statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--sched-text-muted)';
    const rows = document.getElementById('admHoursGrid').children;
    for (const row of rows) {
      const weekday = parseInt(row.dataset.weekday, 10);
      const closed = row.querySelector('.hrs-closed').checked;
      const openTime = row.querySelector('.hrs-open').value;
      const closeTime = row.querySelector('.hrs-close').value;
      const { error } = await upsertBusinessHoursAdmin({ pin: currentPin, weekday, openTime, closeTime, closed });
      if (error) { statusEl.textContent = 'Error: ' + error.message; statusEl.style.color = '#dc2626'; return; }
    }
    statusEl.textContent = '✓ Hours saved.'; statusEl.style.color = '#059669';
  });
}

const OWNER_ACTIVITY_META = {
  arrived: { icon: 'fa-check', bg: '#059669', title: (s) => `Checked in a client${s ? ' - ' + s : ''}` },
  no_show: { icon: 'fa-xmark', bg: '#dc2626', title: (s) => `Marked a no-show${s ? ' - ' + s : ''}` },
  confirmed: { icon: 'fa-rotate-left', bg: '#6b7280', title: (s) => `Undid an Arrived/No-show${s ? ' - ' + s : ''}` },
  block_created: { icon: 'fa-ban', bg: '#6b7280', title: (s) => `Blocked time - ${s || 'Whole salon'}` },
  block_removed: { icon: 'fa-rotate-left', bg: '#6b7280', title: (s) => `Removed a block - ${s || 'Whole salon'}` },
};
async function renderOwnerActivityTab() {
  ownerTabContent.innerHTML = `
    <div class="owner-filter-row">
      ${ownerDatePickerHtml({ btnId: 'admActDateBtn', labelId: 'admActDateLabel', popoverId: 'admActDatePop', prevId: 'admActDatePrev', nextId: 'admActDateNext', monthLabelId: 'admActDateMonth', gridId: 'admActDateGrid', placeholder: 'From date' })}
      ${ownerPillRowHtml({
        id: 'admActStaffPills', active: '',
        options: [{ value: '', label: 'All' }, ...currentStaff.map((s) => ({ value: s.id, label: s.name }))],
      })}
      <button type="button" id="btnRefreshActivity" class="owner-cancel-edit-btn">Refresh</button>
    </div>
    <div id="admActCount" class="owner-count-line"></div>
    <div id="admActList"><p class="owner-empty">Loading…</p></div>
  `;
  const datePicker = wireOwnerDatePicker({ btnId: 'admActDateBtn', labelId: 'admActDateLabel', popoverId: 'admActDatePop', prevId: 'admActDatePrev', nextId: 'admActDateNext', monthLabelId: 'admActDateMonth', gridId: 'admActDateGrid', placeholder: 'From date', onSelect: load });
  const staffPills = wireOwnerPillRow({ id: 'admActStaffPills', onChange: load });

  async function load() {
    const list = document.getElementById('admActList');
    const countLine = document.getElementById('admActCount');
    countLine.textContent = '';
    list.innerHTML = '<p class="owner-empty">Loading…</p>';
    const fromDate = datePicker.value;
    const staffIdFilter = staffPills.value;
    const { data, error } = await fetchActivityLogAdmin({ pin: currentPin, dateFrom: fromDate, staffId: staffIdFilter });
    let rows = data;
    if (error) {
      const staffName = staffIdFilter ? (currentStaff.find((s) => s.id === staffIdFilter) || {}).name : null;
      rows = fallbackActivityLog(todayStr())
        .filter((a) => (!fromDate || a.created_at.slice(0, 10) >= fromDate) && (!staffName || a.subject_name === staffName));
    }
    if (!rows || !rows.length) { list.innerHTML = '<p class="owner-empty">No activity yet.</p>'; return; }
    countLine.textContent = `${rows.length} event${rows.length === 1 ? '' : 's'}`;
    let html = '<div class="owner-timeline">';
    let lastDate = null;
    rows.forEach((a) => {
      const dateKey = a.created_at.slice(0, 10);
      if (dateKey !== lastDate) {
        lastDate = dateKey;
        html += `<div class="owner-date-header">${new Date(a.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>`;
      }
      const meta = OWNER_ACTIVITY_META[a.action] || { icon: 'fa-circle', bg: 'var(--sched-text-muted)', title: () => a.action };
      const time = new Date(a.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      html += `
        <div class="owner-timeline-item">
          <span class="owner-timeline-icon" style="background:${meta.bg};"><i class="fa-solid ${meta.icon}"></i></span>
          <div class="owner-timeline-body">
            <div class="owner-timeline-top">
              <div>
                <div class="owner-timeline-title">${meta.title(a.subject_name)}</div>
                ${a.detail ? `<div class="owner-timeline-detail">${a.detail}</div>` : ''}
              </div>
              <div class="owner-timeline-meta">
                <div class="owner-timeline-actor">${a.actor_name || 'Unknown'}</div>
                <div class="owner-timeline-time">${time}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    });
    html += '</div>';
    list.innerHTML = html;
  }
  document.getElementById('btnRefreshActivity').addEventListener('click', load);
  load();
}

/** How many prepaid texts are left, said plainly.
 *
 *  Credits are bought up front, so they run out - and when they do nothing
 *  breaks loudly. Bookings still work, emails still arrive, and only the SMS
 *  stops. Without this the first anyone hears of it is a client who never got
 *  her reminder, which is the most expensive way to find out.
 *
 *  Thresholds are in days rather than a bare count, because 200 left means
 *  nothing on its own: at roughly two texts a booking it is how long they
 *  last that decides whether to act today.
 */
async function renderSmsBalance() {
  const box = document.getElementById('smsBalanceBox');
  if (!box) return;
  const r = await fetchSmsBalance(currentPin);

  if (!r.configured) {
    box.className = 'sms-balance unset';
    box.innerHTML = '<i class="fa-solid fa-circle-info"></i> <span>Text messages are not set up yet. '
      + 'Once the Sveve details are saved, the balance shows here.</span>';
    return;
  }
  if (!r.ok || r.balance == null) {
    // Never a confident zero. A number nobody can read is a reason to look,
    // and saying so is more useful than guessing.
    box.className = 'sms-balance error';
    box.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span><strong>Could not check the balance.</strong> '
      + escHtml(r.reason || 'No reason given') + '</span>';
    return;
  }

  const n = r.balance;
  // Two per booking - a confirmation and a reminder - against a rough dozen
  // bookings a day.
  const perDay = 24;
  const days = Math.floor(n / perDay);
  const left = n.toLocaleString('nb-NO') + (n === 1 ? ' text' : ' texts');
  const lasts = days >= 1 ? ` &middot; about ${days} ${days === 1 ? 'day' : 'days'} at your usual rate` : '';

  if (n <= 0) {
    box.className = 'sms-balance out';
    box.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> <span><strong>No texts left.</strong> '
      + 'Reminders and confirmations are not being sent. Emails still are. Top up in Sveve.</span>';
  } else if (n < 100) {
    box.className = 'sms-balance low';
    box.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span><strong>${left} left</strong>${lasts}. `
      + 'Top up in Sveve before they run out - reminders stop silently when they do.</span>';
  } else if (n < 400) {
    box.className = 'sms-balance warn';
    box.innerHTML = `<i class="fa-solid fa-circle-info"></i> <span><strong>${left} left</strong>${lasts}. `
      + 'Worth topping up soon.</span>';
  } else {
    box.className = 'sms-balance ok';
    box.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span><strong>${left} left</strong>${lasts}.</span>`;
  }
}

async function renderOwnerSettingsTab() {
  // Read the live value first so the field shows what's actually in force,
  // not a placeholder the owner might save back unchanged.
  let horizon = 60;
  try {
    const { data, error } = await fetchBookingHorizonDays();
    if (!error && Number(data) > 0) horizon = Number(data);
  } catch (e) { /* keep the default */ }

  ownerTabContent.innerHTML = `
    <h4 class="owner-section-title">Text Messages</h4>
    <div id="smsBalanceBox" class="sms-balance checking">
      <i class="fa-solid fa-circle-notch fa-spin"></i> Checking how many texts are left&hellip;
    </div>

    <h4 class="owner-section-title">Booking Window</h4>
    <p style="font-size:0.78rem;color:var(--sched-text-muted);margin-bottom:0.8rem;">
      How far ahead clients can book. It rolls forward on its own every day, so there's nothing to renew.
      Keep it at or below the notice you get for holidays - if the calendar opens further ahead than you
      can see, someone can book into a week you haven't blocked yet.
    </p>
    <div class="block-field" style="max-width:220px;"><label>Days ahead</label><input type="number" id="setHorizon" min="1" max="365" value="${horizon}" /></div>
    <button type="button" id="btnSaveHorizon" class="block-save-btn" style="width:auto;margin-bottom:0.5rem;">Save</button>
    <div id="setHorizonStatus" class="owner-status-msg" style="margin-bottom:1.75rem;"></div>

    <h4 class="owner-section-title">Team Schedule PIN</h4>
    <p style="font-size:0.78rem;color:var(--sched-text-muted);margin-bottom:0.8rem;">Everyday PIN every stylist uses to open the schedule.</p>
    <div class="block-field" style="max-width:220px;"><label>Staff PIN</label><input type="text" id="setStaffPin" /></div>
    <button type="button" id="btnSaveStaffPinNew" class="block-save-btn" style="width:auto;margin-bottom:0.5rem;">Save</button>
    <div id="setStaffPinStatus" class="owner-status-msg" style="margin-bottom:1.75rem;"></div>

    <h4 class="owner-section-title">Owner PIN</h4>
    <p style="font-size:0.78rem;color:var(--sched-text-muted);margin-bottom:0.8rem;">This PIN unlocks the Owner Panel - keep it different from the staff PIN and don't share it with the team.</p>
    <div class="block-field" style="max-width:220px;"><label>Owner PIN</label><input type="text" id="setOwnerPin" /></div>
    <button type="button" id="btnSaveOwnerPinNew" class="block-save-btn" style="width:auto;">Save</button>
    <div id="setOwnerPinStatus" class="owner-status-msg"></div>
  `;
  // Fired without awaiting: the balance is a network call to Sveve and the
  // rest of the panel must not sit blank behind it.
  renderSmsBalance();

  document.getElementById('btnSaveHorizon').addEventListener('click', async () => {
    const statusEl = document.getElementById('setHorizonStatus');
    const days = parseInt(document.getElementById('setHorizon').value, 10);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      statusEl.textContent = 'Enter a number of days between 1 and 365.';
      statusEl.style.color = '#dc2626';
      return;
    }
    statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--sched-text-muted)';
    const { error } = await setBookingHorizonAdmin({ pin: currentPin, days });
    if (error) { statusEl.textContent = 'Error: ' + error.message; statusEl.style.color = '#dc2626'; return; }
    const until = new Date();
    until.setDate(until.getDate() + days);
    statusEl.textContent = `✓ Saved - clients can now book up to ${until.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}, moving forward a day at a time.`;
    statusEl.style.color = '#059669';
  });

  document.getElementById('btnSaveStaffPinNew').addEventListener('click', async () => {
    const statusEl = document.getElementById('setStaffPinStatus');
    const val = document.getElementById('setStaffPin').value.trim();
    if (!val) { statusEl.textContent = 'Enter a PIN first.'; statusEl.style.color = '#dc2626'; return; }
    statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--sched-text-muted)';
    const { error } = await setPinAdmin({ pin: currentPin, key: 'staff_pin', newValue: val });
    if (error) { statusEl.textContent = 'Error: ' + error.message; statusEl.style.color = '#dc2626'; return; }
    statusEl.textContent = '✓ Saved.'; statusEl.style.color = '#059669';
  });
  document.getElementById('btnSaveOwnerPinNew').addEventListener('click', async () => {
    const statusEl = document.getElementById('setOwnerPinStatus');
    const val = document.getElementById('setOwnerPin').value.trim();
    if (!val) { statusEl.textContent = 'Enter a PIN first.'; statusEl.style.color = '#dc2626'; return; }
    statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--sched-text-muted)';
    const { error } = await setPinAdmin({ pin: currentPin, key: 'owner_pin', newValue: val });
    if (error) { statusEl.textContent = 'Error: ' + error.message; statusEl.style.color = '#dc2626'; return; }
    statusEl.textContent = '✓ Saved - use this new PIN next time you open the Owner Panel.'; statusEl.style.color = '#059669';
  });
}

let dayStripResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(dayStripResizeTimer);
  dayStripResizeTimer = setTimeout(async () => {
    if (!currentPin) return;
    const next = computeDaysAhead();
    if (next === DAYS_AHEAD) return;
    const grew = next > DAYS_AHEAD;
    DAYS_AHEAD = next;
    if (grew) await loadWindow(currentPin, windowFrom, addDays(windowFrom, DAYS_AHEAD));
    renderDayStrip();
  }, 200);
});

// ── LOAD ──
async function loadStaff() {
  // fetchBookableStaff returns every ACTIVE staff member, bookable or not
  // (the team page needs the non-bookable ones too). The schedule grid only
  // wants people who actually take appointments here — otherwise Heba,
  // Pati and now Taniya each get a column that can never hold anything.
  const { data, error } = await fetchBookableStaff();
  const rows = !error && data && data.length ? data.filter((s) => s.bookable !== false) : null;
  currentStaff = rows && rows.length ? rows : FALLBACK_STAFF;
}
async function loadServices() {
  const { data, error } = await fetchActiveServices();
  currentServices = !error && data && data.length ? data : FALLBACK_SERVICES;
}

// Opening hours and the per-stylist closing overrides, for the day strip's
// capacity bar. Falls back to the seeded hours so the bar still means
// something in preview mode; an empty override list just means everyone
// works to the general closing time, which is the common case anyway.
async function loadHours() {
  const [hRes, oRes] = await Promise.all([
    fetchBusinessHours().catch(() => ({ error: true })),
    fetchStaffHoursOverrides().catch(() => ({ error: true })),
  ]);
  currentBusinessHours = (!hRes.error && hRes.data && hRes.data.length) ? hRes.data : FALLBACK_BUSINESS_HOURS_SCHED;
  currentHoursOverrides = (!oRes.error && oRes.data) ? oRes.data : FALLBACK_HOURS_OVERRIDES_SCHED;
}

async function loadWindow(pin, dateFrom, dateTo) {
  windowFrom = dateFrom; windowTo = dateTo;
  const [scheduleRes, blockedRes] = await Promise.all([
    fetchStaffSchedule({ pin, dateFrom, dateTo }),
    fetchBlockedSlotsRange(dateFrom, dateTo),
  ]);
  currentBookings = !scheduleRes.error && scheduleRes.data ? scheduleRes.data : fallbackWindowBookings(todayStr());
  currentBlocked = !blockedRes.error && blockedRes.data ? blockedRes.data : [];
  renderPills();
}

async function openSchedule(pin) {
  currentPin = pin;
  selectedDate = todayStr();
  pinScreen.style.display = 'none';
  const { data, error } = await isOwnerPin(pin);
  isOwnerMode = error ? pin === FALLBACK_OWNER_PIN : data === true;
  btnOwnerPanel.style.display = isOwnerMode ? '' : 'none';
  loadServices();
  loadHours().then(renderDayStrip);
  loadStaff().then(() => {
    if (currentActorStaffId && currentStaff.some((s) => s.id === currentActorStaffId)) enterApp(pin);
    else showIdentityPicker();
  });
}

// Self-reported identity for attribution ("who marked this arrived?") — not
// real auth, just picked once and remembered on this device (see the
// activity_log comment in 0001_booking_schema.sql for why this is enough).
function showIdentityPicker() {
  identityList.innerHTML = currentStaff.map((s) => `<button type="button" class="identity-option" data-id="${s.id}">${s.name}</button>`).join('');
  identityList.querySelectorAll('.identity-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentActorStaffId = btn.dataset.id;
      localStorage.setItem(IDENTITY_KEY, currentActorStaffId);
      enterApp(currentPin);
    });
  });
  identityScreen.style.display = 'flex';
}

function enterApp(pin) {
  identityScreen.style.display = 'none';
  scheduleApp.style.display = '';
  topbarActions.style.display = 'flex';
  relocateStaffPills();
  DAYS_AHEAD = computeDaysAhead();
  loadWindow(pin, todayStr(), addDays(todayStr(), DAYS_AHEAD)).then(() => {
    renderDayStrip();
    updateDayLabel();
    renderGrid();
    refreshRequestBanner();
    startAutoRefresh();
  });
}

// ── THE DAY KEEPS ITSELF UP TO DATE ──
// A booking made online, or by whoever is on the other phone, used to appear
// only when somebody thought to reload. On a busy afternoon that means the
// grid on the counter is quietly wrong, and two people take the same slot.
//
// Every 30 seconds, and immediately whenever the tab is brought back to the
// front - coming back to it is exactly when the screen has been unwatched
// longest, and is the moment it is most likely to be stale.
const AUTO_REFRESH_MS = 30000;
let autoRefreshTimer = null;

async function refreshNow() {
  // Nothing reloads underneath an open dialog. Half the modals here are a
  // decision in progress - an amount being typed, a move being placed - and
  // redrawing the grid beneath one is how a half-finished action is lost.
  const busy = [...document.querySelectorAll('.appt-popup-overlay')]
    .some((o) => getComputedStyle(o).display !== 'none');
  if (busy || !currentPin || document.hidden) return;
  try {
    await loadWindow(currentPin, windowFrom, windowTo);
    renderGrid();
    await refreshRequestBanner();
  } catch (e) { /* a failed poll is not worth interrupting anyone over */ }
}

// The line is drawn at the minute the grid was built, so on a quiet afternoon
// it would sit there being wrong. Redrawn on its own minute tick, without
// touching the rest of the day.
function tickNowLine() {
  if (selectedDate !== todayStr()) return;
  const start = currentGridStart;
  const now = nowMinutes();
  gridWrap.querySelectorAll('.sched-now-line').forEach((l) => {
    l.style.top = `${(now - start) * PX_PER_MIN}px`;
  });
  const label = gridWrap.querySelector('.sched-now-time');
  if (label) {
    label.textContent = minutesToTimeStr(now);
    label.style.top = `${HEADER_OFFSET_PX + (now - start) * PX_PER_MIN}px`;
  }
  const dot = gridWrap.querySelector('.sched-now-dot');
  if (dot) dot.style.top = `${HEADER_OFFSET_PX + (now - start) * PX_PER_MIN}px`;
}

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  setInterval(tickNowLine, 30000);
  autoRefreshTimer = setInterval(refreshNow, AUTO_REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshNow(); });
}

function showGate() {
  scheduleApp.style.display = 'none';
  identityScreen.style.display = 'none';
  topbarActions.style.display = 'none';
  pinScreen.style.display = '';
  pinInput.value = '';
  pinInput.focus();
}

pinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = pinInput.value.trim();
  if (!pin) return;
  pinError.classList.remove('visible');
  btnPinSubmit.disabled = true;
  const { data, error } = await verifyStaffPin(pin);
  btnPinSubmit.disabled = false;
  const ok = error ? (pin === FALLBACK_PIN || pin === FALLBACK_OWNER_PIN) : data === true;
  if (!ok) { pinError.textContent = 'Incorrect PIN. Please try again.'; pinError.classList.add('visible'); return; }
  localStorage.setItem(PIN_KEY, pin);
  openSchedule(pin);
});

btnSwitchPin.addEventListener('click', () => {
  localStorage.removeItem(PIN_KEY);
  localStorage.removeItem(IDENTITY_KEY);
  currentPin = null;
  currentActorStaffId = null;
  isOwnerMode = false;
  btnOwnerPanel.style.display = 'none';
  showGate();
});

let resizeTimer;
// On wide screens the staff-filter pills move into the topbar next to the
// menu button, freeing up the controls row below; on narrow screens they
// move back to their original spot (marked by staffPillsAnchor) since the
// topbar doesn't have room. Same element, just relocated — no re-render,
// no lost event listeners.
const STAFF_PILLS_TOPBAR_BREAKPOINT = 860;
function relocateStaffPills() {
  const inTopbar = staffPillsEl.parentElement === schedTopbar;
  const shouldBeInTopbar = window.innerWidth >= STAFF_PILLS_TOPBAR_BREAKPOINT;
  if (shouldBeInTopbar && !inTopbar) {
    schedTopbar.insertBefore(staffPillsEl, topbarActions);
  } else if (!shouldBeInTopbar && inTopbar) {
    staffPillsAnchor.after(staffPillsEl);
  }
}

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    relocateStaffPills();
    if (currentPin && viewMode === 'upcoming') renderGrid();
  }, 200);
});

// Keeps the "now" line actually moving while the page is left open.
setInterval(() => { if (currentPin && viewMode === 'upcoming') renderGrid(); }, 60000);

const cachedPin = localStorage.getItem(PIN_KEY);
if (cachedPin) openSchedule(cachedPin);

// ── EXTENSIONS ORDER BOOK ──
// Staff PIN, not owner: whoever takes the consultation writes the order, while
// the details are still in front of them. See migration 0007.

const extModal = document.getElementById('extModal');
const extClose = document.getElementById('extClose');
const extForm = document.getElementById('extForm');
const extList = document.getElementById('extList');
const extRisk = document.getElementById('extRisk');
const extSearch = document.getElementById('extSearch');
const extBadge = document.getElementById('extBadge');

// The four states a stylist actually acts on, in the order they need acting on.
// "Arrived with her already booked" is deliberately its own group: the hair is
// here and she is coming, so there is nothing to do and it should not sit among
// the jobs that do need doing.
const EXT_GROUPS = [
  { key: 'tell', title: 'Tell her', hint: 'Hair is here, no appointment booked' },
  { key: 'ordered', title: 'On order', hint: 'Waiting on the supplier' },
  { key: 'ready', title: 'Ready', hint: 'Hair is here and she is already booked' },
  { key: 'notified', title: 'Told her', hint: 'Waiting for her to come in' },
  { key: 'done', title: 'Finished', hint: '' },
];

function extGroupOf(o) {
  if (o.status === 'arrived') return o.needs_telling ? 'tell' : 'ready';
  if (o.status === 'ordered') return 'ordered';
  if (o.status === 'notified') return 'notified';
  return 'done';
}

const extEsc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const extNok = (n) => (n == null ? '' : Number(n).toLocaleString('nb-NO') + ' NOK');

/** "6/613 ombre · 50 cm · 100 g" from whatever was filled in. */
function extDetailLine(o) {
  return [o.colour, o.length_cm, o.quantity].filter(Boolean).map(extEsc).join(' · ');
}

function extDayLabel(n) {
  const d = Number(n);
  if (!Number.isFinite(d)) return '';
  if (d === 0) return 'today';
  if (d === 1) return '1 day';
  return `${d} days`;
}

function openExtModal() {
  extModal.style.display = 'flex';
  extForm.hidden = true;
  extSearch.value = '';
  loadExtensionStaffOptions();
  refreshExtensions();
}
function closeExtModal() { extModal.style.display = 'none'; }

async function loadExtensionStaffOptions() {
  const sel = document.getElementById('extStaff');
  if (!sel || sel.options.length) return;
  // The stylist list is already loaded for the schedule itself.
  sel.innerHTML = '<option value="">-</option>'
    + (currentStaff || []).map((s) => `<option value="${extEsc(s.id)}">${extEsc(s.name)}</option>`).join('');
  if (currentActorStaffId) sel.value = currentActorStaffId;
}

async function refreshExtensions(query) {
  const [ordersRes, riskRes] = await Promise.all([
    query
      ? fetchExtensionHistory({ pin: currentPin, query })
      : fetchExtensionOrders({ pin: currentPin }),
    fetchExtensionOrdersAtRisk({ pin: currentPin, withinDays: 7 }),
  ]);

  renderExtRisk(query ? [] : ((!riskRes.error && riskRes.data) || []));
  renderExtList((!ordersRes.error && ordersRes.data) || [], !!query, ordersRes.error);
}

// ── FITTINGS WITH NO HAIR ──
// Nothing here contacts the client. It is a warning for the salon so the
// supplier can be chased while there is still time — see the note in 0007.
function renderExtRisk(rows) {
  if (extBadge) {
    extBadge.hidden = rows.length === 0;
    extBadge.textContent = rows.length || '';
  }
  if (!rows.length) { extRisk.innerHTML = ''; return; }

  extRisk.innerHTML = `
    <div class="ext-risk-head">
      <i class="fa-solid fa-triangle-exclamation"></i>
      ${rows.length} fitting${rows.length === 1 ? '' : 's'} coming up, hair not arrived
    </div>
    ${rows.map((r) => `
      <div class="ext-risk-row">
        <div class="ext-risk-main">
          <strong>${extEsc(r.customer_name)}</strong>
          <span class="ext-risk-when">in ${extDayLabel(r.days_until_fitting)}</span>
          <div class="ext-risk-meta">
            ${new Date(r.booking_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            ${fmtTime(r.booking_time)}${r.booking_staff ? ' · ' + extEsc(r.booking_staff) : ''}
          </div>
          <div class="ext-risk-meta">
            ${extDetailLine(r)}${r.supplier ? ' · ' + extEsc(r.supplier) : ''}
            · ordered ${extDayLabel(r.days_since_ordered)} ago
          </div>
        </div>
        <div class="ext-risk-actions">
          <a class="owner-action-btn" href="tel:${extEsc(r.customer_phone)}"><i class="fa-solid fa-phone"></i> Call</a>
          <button type="button" class="owner-action-btn confirm" data-ext-arrived="${extEsc(r.id)}"><i class="fa-solid fa-box-open"></i> It arrived</button>
        </div>
      </div>`).join('')}
  `;
  wireExtActions(extRisk);
}

function renderExtList(rows, isSearch, error) {
  if (error) { extList.innerHTML = '<p class="owner-empty">Could not load orders.</p>'; return; }
  if (!rows.length) {
    extList.innerHTML = `<p class="owner-empty">${isSearch ? 'Nothing found.' : 'No orders yet.'}</p>`;
    return;
  }

  // A search is a history lookup — one client, newest first — so grouping it
  // by what needs doing would only get in the way.
  if (isSearch) {
    extList.innerHTML = `<div class="ext-group-title">Previous orders</div>`
      + rows.map((o) => extCard(o, true)).join('');
    wireExtActions(extList);
    return;
  }

  const grouped = {};
  rows.forEach((o) => {
    const g = extGroupOf(o);
    (grouped[g] = grouped[g] || []).push(o);
  });

  extList.innerHTML = EXT_GROUPS.filter((g) => grouped[g.key]).map((g) => `
    <div class="ext-group-title ext-group-${g.key}">
      ${g.title} <span>${grouped[g.key].length}</span>
      ${g.hint ? `<em>${g.hint}</em>` : ''}
    </div>
    ${grouped[g.key].map((o) => extCard(o)).join('')}
  `).join('');
  wireExtActions(extList);
}

function extCard(o, historyView) {
  const group = extGroupOf(o);
  const balance = o.balance_due != null && Number(o.balance_due) > 0
    ? `<span class="ext-balance">${extNok(o.balance_due)} to pay</span>` : '';
  const deposit = o.deposit_amount != null
    ? `<span class="ext-deposit ${o.deposit_paid ? 'paid' : 'unpaid'}">Deposit ${extNok(o.deposit_amount)}${o.deposit_paid ? ' paid' : ' UNPAID'}</span>`
    : '';
  // Client-side, her booking page will not unlock without deposit_paid = true
  // on this row - whatever the amount says or doesn't say. Shown whenever
  // that is still false, not only when there is a deposit_amount to display
  // beside it, because an order agreed for cash with no figure logged needs
  // this exactly as much as one with a number on file.
  const markPaidBtn = !o.deposit_paid
    ? `<button type="button" class="owner-action-btn" data-ext-mark-paid="${extEsc(o.id)}"><i class="fa-solid fa-sack-dollar"></i> Mark deposit paid</button>`
    : '';

  let actions = '';
  if (!historyView) {
    if (group === 'ordered') {
      actions = `<button type="button" class="owner-action-btn confirm" data-ext-arrived="${extEsc(o.id)}"><i class="fa-solid fa-box-open"></i> It arrived</button>`;
    } else if (group === 'tell') {
      // The only group with a Tell her button. An order sitting in "ready" has
      // her already booked, so there is nothing to tell her.
      actions = `
        <button type="button" class="owner-action-btn confirm" data-ext-tell="${extEsc(o.id)}"><i class="fa-solid fa-paper-plane"></i> Tell her</button>
        <a class="owner-action-btn" href="tel:${extEsc(o.customer_phone)}"><i class="fa-solid fa-phone"></i> Call</a>`;
    } else if (group === 'ready' || group === 'notified') {
      actions = `<button type="button" class="owner-action-btn" data-ext-status="fitted" data-ext-id="${extEsc(o.id)}"><i class="fa-solid fa-check"></i> Fitted</button>`;
    }
    // Independent of the group above: paying the deposit and the hair
    // turning up are two different facts, either can lag the other, and a
    // client cannot book until BOTH are true. Placed first so it is never
    // the thing the eye skips past to reach "It arrived".
    actions = markPaidBtn + actions;
  }

  const booked = o.booking_date
    ? `<span class="ext-booked"><i class="fa-regular fa-calendar-check"></i> ${new Date(o.booking_date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(o.booking_time)}${o.booking_staff ? ' · ' + extEsc(o.booking_staff) : ''}</span>`
    : '';

  return `
    <div class="ext-card ext-card-${group}" data-id="${extEsc(o.id)}">
      <div class="ext-card-main">
        <div class="ext-card-name">
          ${extEsc(o.customer_name)}
          ${group === 'ordered' ? `<span class="ext-waiting">waiting ${extDayLabel(o.days_waiting)}</span>` : ''}
        </div>
        <div class="ext-card-detail">${extDetailLine(o) || '<em>no details recorded</em>'}${o.supplier ? ' · ' + extEsc(o.supplier) : ''}</div>
        <div class="ext-card-meta">
          ${extEsc(o.customer_phone)}${o.staff_name ? ' · consultation by ' + extEsc(o.staff_name) : ''}
          ${booked}
        </div>
        <div class="ext-card-money">${deposit} ${balance}</div>
        ${o.notes ? `<div class="ext-card-notes"><i class="fa-solid fa-note-sticky"></i> ${extEsc(o.notes)}</div>` : ''}
      </div>
      <div class="ext-card-actions">${actions}</div>
      <div class="ext-card-status" id="extMsg-${extEsc(o.id)}"></div>
    </div>`;
}

function wireExtActions(root) {
  root.querySelectorAll('[data-ext-mark-paid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { error } = await markDepositPaid({ pin: currentPin, id: btn.dataset.extMarkPaid });
      if (error) { btn.disabled = false; alert('Could not mark the deposit paid: ' + error.message); return; }
      refreshExtensions();
    });
  });
  root.querySelectorAll('[data-ext-arrived]').forEach((btn) => {
    btn.addEventListener('click', () => markArrived(btn.dataset.extArrived, btn));
  });
  root.querySelectorAll('[data-ext-tell]').forEach((btn) => {
    btn.addEventListener('click', () => tellHer(btn.dataset.extTell, btn));
  });
  root.querySelectorAll('[data-ext-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { error } = await setExtensionOrderStatus({
        pin: currentPin, id: btn.dataset.extId, status: btn.dataset.extStatus,
      });
      if (error) { btn.disabled = false; alert('Could not update: ' + error.message); return; }
      refreshExtensions();
    });
  });
}

// Logging a delivery and telling the client are separate on purpose: a box with
// four clients' hair in it can be ticked off in seconds, and the messages sent
// afterwards. Until they are, the order keeps asking to be dealt with.
async function markArrived(id, btn) {
  btn.disabled = true;
  const { data, error } = await markExtensionsArrived({ pin: currentPin, id });
  if (error) { btn.disabled = false; alert('Could not mark it arrived: ' + error.message); return; }
  const row = Array.isArray(data) ? data[0] : data;
  await refreshExtensions();
  // If she has no fitting booked, she is now sitting in "Tell her" — say so,
  // rather than leaving the stylist to notice.
  if (row && !row.booking_date) {
    const msg = document.getElementById(`extMsg-${id}`);
    if (msg) {
      msg.textContent = 'Marked arrived - she still needs telling.';
      msg.style.color = '#b45309';
    }
  }
}

async function tellHer(id, btn) {
  const card = btn.closest('.ext-card');
  const msg = document.getElementById(`extMsg-${id}`);
  card.querySelectorAll('button').forEach((b) => (b.disabled = true));
  msg.textContent = 'Sending…';
  msg.style.color = 'var(--sched-text-muted)';

  // markExtensionsArrived is what returns the details the message is built
  // from, and it has already run — so re-read the order from the list instead
  // of asking the database again.
  const { data, error } = await fetchExtensionOrders({ pin: currentPin, status: 'arrived' });
  const order = (!error && data) ? data.find((o) => o.id === id) : null;
  if (!order) {
    msg.textContent = 'Could not find that order. Try reopening this screen.';
    msg.style.color = '#dc2626';
    card.querySelectorAll('button').forEach((b) => (b.disabled = false));
    return;
  }

  const sent = await sendExtensionsArrived({
    pin: currentPin,
    order_id: id,
    customer_name: order.customer_name,
    customer_email: order.customer_email || '',
    customer_phone: order.customer_phone,
    order_detail: [order.colour, order.length_cm, order.quantity].filter(Boolean).join(', '),
    balance_due: order.balance_due,
  });

  // The message is best-effort; being told is what matters. Record it either
  // way, but say plainly when nothing went out so someone picks up the phone.
  const { error: markErr } = await markExtensionsNotified({ pin: currentPin, id });
  if (markErr) {
    msg.textContent = 'Error: ' + markErr.message;
    msg.style.color = '#dc2626';
    card.querySelectorAll('button').forEach((b) => (b.disabled = false));
    return;
  }

  if (sent && sent.sent) {
    msg.textContent = '✓ Told her.';
    msg.style.color = '#059669';
  } else {
    msg.innerHTML = `Marked as told, but nothing was sent`
      + `<div class="req-mail-warn">${extEsc((sent && sent.reason) || 'Messaging is not set up yet')}</div>`
      + `<div class="req-mail-warn">Ring her: <a href="tel:${extEsc(order.customer_phone)}">${extEsc(order.customer_phone)}</a></div>`;
    msg.style.color = '#b45309';
  }
  setTimeout(() => refreshExtensions(), 1800);
}

// ── NEW ORDER ──
document.getElementById('btnExtNew').addEventListener('click', () => {
  extForm.hidden = !extForm.hidden;
  if (!extForm.hidden) document.getElementById('extName').focus();
});

document.getElementById('btnExtSave').addEventListener('click', async () => {
  const status = document.getElementById('extFormStatus');
  const val = (id) => document.getElementById(id).value.trim();
  const num = (id) => {
    const v = document.getElementById(id).value;
    return v === '' ? null : Number(v);
  };
  if (!val('extName') || !val('extPhone')) {
    status.textContent = 'A name and a phone number are needed - that is how she gets told when it arrives.';
    status.style.color = '#dc2626';
    return;
  }
  status.textContent = 'Saving…';
  status.style.color = 'var(--sched-text-muted)';

  const { error } = await addExtensionOrder({
    pin: currentPin,
    customerName: val('extName'), customerPhone: val('extPhone'), customerEmail: val('extEmail'),
    staffId: document.getElementById('extStaff').value || null,
    colour: val('extColour'), lengthCm: val('extLength'),
    quantity: val('extQty'), supplier: val('extSupplier'),
    totalAgreed: num('extTotal'), depositAmount: num('extDeposit'),
    depositPaid: document.getElementById('extDepositPaid').checked,
    notes: val('extNotes'),
  });
  if (error) { status.textContent = 'Error: ' + error.message; status.style.color = '#dc2626'; return; }

  status.textContent = '✓ Order added.';
  status.style.color = '#059669';
  ['extName', 'extPhone', 'extEmail', 'extColour', 'extLength', 'extQty', 'extTotal', 'extDeposit', 'extNotes']
    .forEach((id) => { document.getElementById(id).value = ''; });
  setTimeout(() => { extForm.hidden = true; status.textContent = ''; refreshExtensions(); }, 700);
});

// ── SEARCH ──
let extSearchTimer = null;
extSearch.addEventListener('input', () => {
  clearTimeout(extSearchTimer);
  extSearchTimer = setTimeout(() => {
    const q = extSearch.value.trim();
    refreshExtensions(q.length >= 2 ? q : undefined);
  }, 250);
});

document.getElementById('requestBannerOpen').addEventListener('click', () => {
  openOwnerPanel();
  switchOwnerTab('requests');
});

document.getElementById('btnExtensions').addEventListener('click', () => {
  closeMoreMenu();
  openExtModal();
});
extClose.addEventListener('click', closeExtModal);
extModal.addEventListener('click', (e) => { if (e.target === extModal) closeExtModal(); });

// ── NO-SHOW NOTICE WIRING ──
document.getElementById('noShowClose').addEventListener('click', closeNoShowNotice);
document.getElementById('noShowSkip').addEventListener('click', closeNoShowNotice);
document.getElementById('noShowModal').addEventListener('click', (e) => {
  if (e.target.id === 'noShowModal') closeNoShowNotice();
});
document.getElementById('noShowCharge').addEventListener('change', syncNoShowFee);

document.getElementById('noShowSend').addEventListener('click', async () => {
  if (!noShowTarget) return;
  const status = document.getElementById('noShowStatus');
  const btn = document.getElementById('noShowSend');
  const charge = document.getElementById('noShowCharge').checked;
  const feeAmount = parseFloat(document.getElementById('noShowFeeAmount').value);
  // Asked to invoice, but with nothing to invoice for. Better to stop here
  // than to send a client a bill with no figure on it.
  if (charge && (!Number.isFinite(feeAmount) || feeAmount <= 0)) {
    status.textContent = 'Enter the amount to invoice, or untick the fee.';
    status.style.color = '#dc2626';
    document.getElementById('noShowFeeAmount').focus();
    return;
  }
  btn.disabled = true;
  status.textContent = 'Sending…';
  status.style.color = 'var(--sched-text-muted)';

  // Routed through send-message, not send-booking-email: that function only
  // ever accepted 'confirmed' and 'rejected', so a no-show notice sent through
  // it came back a 400. send-message knows all thirteen messages.
  //
  // Two different letters. Without a fee it is the notice - we missed you,
  // ring us. With one it is the invoice, a document with an amount and the
  // salon's org number on it. The recipient should never have to work out
  // which of the two she has been sent.
  const res = await sendMessage({
    pin: currentPin,
    bookingId: noShowTarget.id,
    key: charge ? 'invoice' : 'no_show_notice',
    lang: 'no',
    email: noShowTarget.customer_email,
    phone: noShowTarget.customer_phone,
    smsConsent: noShowTarget.sms_consent !== false,
    context: {
      customerName: noShowTarget.customer_name,
      serviceName: noShowTarget.service_name,
      staffName: noShowTarget.staff_name || '',
      date: noShowTarget.date,
      startTime: fmtTime(noShowTarget.start_time),
      note: document.getElementById('noShowNote').value.trim(),
      ...(charge ? { invoiceAmount: feeAmount, invoiceReason: 'no_show' } : {}),
    },
  });

  if (res && res.sent) {
    status.textContent = charge
      ? '✓ Sent, with the ' + feeAmount.toLocaleString('nb-NO') + ' NOK invoice.'
      : '✓ Sent.';
    status.style.color = '#059669';
    setTimeout(closeNoShowNotice, 1200);
  } else {
    status.textContent = 'Could not send: ' + ((res && res.reason) || 'unknown');
    status.style.color = '#b45309';
    btn.disabled = false;
  }
});

// ── HOLD THE PAGE STILL BEHIND AN OPEN MODAL ──
// Every modal here is shown by setting style.display on its overlay, so one
// observer covers all of them and no open/close function has to remember to
// do this. The alternative - touch-action:none on the overlay - also stops
// the panel inside it from scrolling, because touch-action resolves down the
// ancestor chain and cannot be won back by a child.
(function holdPageBehindModals() {
  const overlays = document.querySelectorAll('.appt-popup-overlay');
  if (!overlays.length) return;
  const sync = () => {
    const anyOpen = [...overlays].some((o) => {
      const d = o.style.display;
      return d && d !== 'none';
    });
    document.body.classList.toggle('modal-open', anyOpen);
  };
  overlays.forEach((o) => {
    new MutationObserver(sync).observe(o, { attributes: true, attributeFilter: ['style'] });
  });
  sync();
})();
