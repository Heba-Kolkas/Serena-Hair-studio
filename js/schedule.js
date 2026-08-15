import {
  verifyStaffPin, fetchStaffSchedule, updateBookingStatusStaff, fetchBookableStaff,
  fetchBlockedSlotsRange, addStaffUnavailable, removeStaffUnavailable, searchStaffBookings,
  fetchActiveServices, updateServiceColor, isOwnerPin,
  fetchAllServicesAdmin, upsertServiceAdmin, deleteServiceAdmin,
  fetchAllStaffAdmin, upsertStaffAdmin,
  fetchBookingsAdmin, updateBookingStatusAdmin, rescheduleBookingAdmin, completeBookingAdmin,
  upsertBusinessHoursAdmin, addBlockedSlotAdmin, removeBlockedSlotAdmin,
  fetchActivityLogAdmin, setPinAdmin, fetchBusinessHours, uploadOwnerImage, bookAppointment,
  fetchRevenueAdmin, fetchStaffServicesAdmin, setStaffServicesAdmin,
  fetchStaffHoursOverridesAdmin, upsertStaffHoursOverrideAdmin, deleteStaffHoursOverrideAdmin,
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
const DAYS_AHEAD = 13; // day-strip shows today + 13 more = 2 weeks
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
const FALLBACK_STAFF = [
  { id: 'staff-hassan', name: 'Hassan K.', allow_overlap_booking: true },
  { id: 'staff-kani', name: 'Kani M.', allow_overlap_booking: false },
  { id: 'staff-taniya', name: 'Taniya S.', allow_overlap_booking: false },
];
// Hassan's Balayage overlap pairing (mirrors book_appointment/booking.js): an
// 11:00 or 15:00 Balayage always visually reserves the paired 13:00/16:30
// half-slot for a second client, even before anyone's actually booked it —
// not just once a real overlapping booking exists.
const OVERLAP_ANCHORS = { 660: 780, 900: 990 };
const BALAYAGE_DURATION = 240;
const FALLBACK_SERVICES = [
  { id: 'svc-balayage', name: 'Highlights / Balayage', category: 'Color Services', color: '#C9A96E' },
  { id: 'svc-onecolor', name: 'One Color (All Hair)', category: 'Color Services', color: '#D68C3E' },
  { id: 'svc-toner', name: 'Toner', category: 'Color Services', color: '#EAC17E' },
  { id: 'svc-haircut-blowdry', name: 'Haircut + Blowdry', category: 'Haircuts & Styling', color: '#3D7A94' },
  { id: 'svc-keratin', name: 'Keratin Treatment', category: 'Keratin & Hair Treatments', color: '#6FAF7A' },
];
function fallbackWindowBookings(today) {
  return [
    { id: 'demo-1', date: today, start_time: '11:00:00', end_time: '15:00:00', status: 'confirmed', customer_name: 'Sara Nilsen', customer_phone: '+4791234567', customer_email: 'sara.nilsen@example.com', notes: null, service_name: 'Highlights / Balayage', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'demo-2', date: today, start_time: '13:00:00', end_time: '14:00:00', status: 'confirmed', customer_name: 'Mona Iqbal', customer_phone: '+4790112233', customer_email: 'mona.iqbal@example.com', notes: 'Allergic to ammonia-based products — check before use.', service_name: 'Haircut + Blowdry', service_color: '#3D7A94', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'demo-3', date: today, start_time: '11:00:00', end_time: '12:30:00', status: 'confirmed', customer_name: 'Julie Berg', customer_phone: '+4793344556', customer_email: 'julie.berg@example.com', notes: null, service_name: 'One Color (All Hair)', service_color: '#D68C3E', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
    { id: 'demo-4', date: today, start_time: '14:30:00', end_time: '17:00:00', status: 'confirmed', customer_name: 'Amina Yusuf', customer_phone: '+4795566778', customer_email: 'amina.yusuf@example.com', notes: null, service_name: 'Keratin Treatment', service_color: '#6FAF7A', staff_id: FALLBACK_STAFF[2].id, staff_name: FALLBACK_STAFF[2].name },
    { id: 'demo-8', date: today, start_time: '15:00:00', end_time: '19:00:00', status: 'confirmed', customer_name: 'Thea Lindberg', customer_phone: '+4792233445', customer_email: 'thea.lindberg@example.com', notes: null, service_name: 'Highlights / Balayage', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'demo-5', date: addDays(today, 1), start_time: '11:00:00', end_time: '11:45:00', status: 'confirmed', customer_name: 'Ida Solberg', customer_phone: '+4796677889', customer_email: 'ida.solberg@example.com', notes: null, service_name: 'Toner', service_color: '#EAC17E', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
    { id: 'demo-6', date: addDays(today, 1), start_time: '15:00:00', end_time: '19:00:00', status: 'confirmed', customer_name: 'Camilla Haugen', customer_phone: '+4798877665', customer_email: 'camilla.haugen@example.com', notes: null, service_name: 'Highlights / Balayage', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'demo-7', date: addDays(today, 3), start_time: '13:00:00', end_time: '14:00:00', status: 'confirmed', customer_name: 'Nora Eide', customer_phone: '+4799001122', customer_email: 'nora.eide@example.com', notes: null, service_name: 'Haircut + Blowdry', service_color: '#3D7A94', staff_id: FALLBACK_STAFF[2].id, staff_name: FALLBACK_STAFF[2].name },
  ];
}
function fallbackHistoryBookings(today) {
  return [
    { id: 'hist-1', date: addDays(today, -2), start_time: '11:00:00', end_time: '15:00:00', status: 'completed', amount_charged: 3800, customer_name: 'Marte Fossum', customer_phone: '+4790011223', customer_email: 'marte.fossum@example.com', notes: null, service_name: 'Highlights / Balayage', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'hist-2', date: addDays(today, -2), start_time: '13:00:00', end_time: '14:00:00', status: 'no_show', customer_name: 'Tuva Lund', customer_phone: '+4790033445', customer_email: 'tuva.lund@example.com', notes: null, service_name: 'Toner', service_color: '#EAC17E', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
    { id: 'hist-3', date: addDays(today, -6), start_time: '11:00:00', end_time: '13:30:00', status: 'completed', amount_charged: 1400, customer_name: 'Sofie Kristiansen', customer_phone: '+4790055667', customer_email: 'sofie.kristiansen@example.com', notes: null, service_name: 'Keratin Treatment', service_color: '#6FAF7A', staff_id: FALLBACK_STAFF[2].id, staff_name: FALLBACK_STAFF[2].name },
    { id: 'hist-4', date: addDays(today, -10), start_time: '13:00:00', end_time: '14:00:00', status: 'completed', amount_charged: 850, customer_name: 'Live Andersen', customer_phone: '+4790077889', customer_email: 'live.andersen@example.com', notes: null, service_name: 'Haircut + Blowdry', service_color: '#3D7A94', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
    { id: 'hist-5', date: addDays(today, -14), start_time: '11:00:00', end_time: '15:00:00', status: 'completed', amount_charged: 4000, customer_name: 'Selma Braaten', customer_phone: '+4790099001', customer_email: 'selma.braaten@example.com', notes: null, service_name: 'Highlights / Balayage', service_color: '#C9A96E', staff_id: FALLBACK_STAFF[0].id, staff_name: FALLBACK_STAFF[0].name },
    { id: 'hist-6', date: addDays(today, -20), start_time: '11:00:00', end_time: '12:30:00', status: 'completed', amount_charged: 2000, customer_name: 'Frida Moen', customer_phone: '+4790011009', customer_email: 'frida.moen@example.com', notes: null, service_name: 'One Color (All Hair)', service_color: '#D68C3E', staff_id: FALLBACK_STAFF[1].id, staff_name: FALLBACK_STAFF[1].name },
  ];
}

// ── OWNER PANEL fallback data ──
// Mirrors the *real* values in supabase/migrations/0002_seed_data.sql (not
// the abbreviated FALLBACK_SERVICES/FALLBACK_STAFF above, which only carry
// the few fields the main schedule grid needs) — so previewing the Owner
// Panel locally, before Supabase is restored, shows the actual salon's
// real services/staff/prices instead of blank/undefined fields.
const FALLBACK_SERVICES_ADMIN = [
  { id: 'svc-onecolor-roots', name: 'One Color (Roots)', name_no: 'Én Farge (Røtter)', category: 'Color Services', price_from: 1500, price_to: null, price_on_consultation: false, duration_minutes: 90, image_url: './html/Pics/Farge/Farge1.jpeg', color: '#E0A458', featured: false, active: true, sort_order: 1 },
  { id: 'svc-onecolor-all', name: 'One Color (All Hair)', name_no: 'Én Farge (Alt Hår)', category: 'Color Services', price_from: 2000, price_to: null, price_on_consultation: false, duration_minutes: 90, image_url: './html/Pics/Farge/Farge1.jpeg', color: '#D68C3E', featured: false, active: true, sort_order: 2 },
  { id: 'svc-balayage', name: 'Highlights / Balayage', name_no: 'Striper / Balayage', category: 'Color Services', price_from: 3500, price_to: 4000, price_on_consultation: false, duration_minutes: 240, image_url: './html/Pics/Balayage/Blayage12.jpeg', color: '#C9A96E', featured: true, active: true, sort_order: 3 },
  { id: 'svc-toner', name: 'Toner', name_no: 'Toner', category: 'Color Services', price_from: 1000, price_to: null, price_on_consultation: false, duration_minutes: 45, image_url: './html/Pics/Farge/Farge1.jpeg', color: '#EAC17E', featured: false, active: true, sort_order: 4 },
  { id: 'svc-blowdry', name: 'Blowdry', name_no: 'Føn', category: 'Haircuts & Styling', price_from: 600, price_to: null, price_on_consultation: false, duration_minutes: 30, image_url: './html/Pics/Styling/styling4.jpeg', color: '#7FB3C9', featured: false, active: true, sort_order: 5 },
  { id: 'svc-haircut-blowdry', name: 'Haircut + Blowdry', name_no: 'Klipp + Føn', category: 'Haircuts & Styling', price_from: 850, price_to: null, price_on_consultation: false, duration_minutes: 60, image_url: './html/Pics/Haircut/Haircut5.jpeg', color: '#3D7A94', featured: true, active: true, sort_order: 6 },
  { id: 'svc-extensions-50', name: 'Hair Extensions (50g)', name_no: 'Extensions (50g)', category: 'Hair Extensions', price_from: 3000, price_to: null, price_on_consultation: false, duration_minutes: 180, image_url: './html/Pics/Extensions/cover.jpeg', color: '#A97FC9', featured: true, active: true, sort_order: 7 },
  { id: 'svc-extensions-100', name: 'Hair Extensions (100-150g)', name_no: 'Extensions (100-150g)', category: 'Hair Extensions', price_from: null, price_to: null, price_on_consultation: true, duration_minutes: 240, image_url: './html/Pics/Extensions/cover.jpeg', color: '#8C5EAD', featured: false, active: true, sort_order: 8 },
  { id: 'svc-keratin', name: 'Keratin Treatment', name_no: 'Keratinbehandling', category: 'Keratin & Hair Treatments', price_from: null, price_to: null, price_on_consultation: true, duration_minutes: 150, image_url: './html/Pics/Treatment/cover.jpeg', color: '#6FAF7A', featured: true, active: true, sort_order: 9 },
  { id: 'svc-hairbotox', name: 'Hair Botox', name_no: 'Hår Botox', category: 'Keratin & Hair Treatments', price_from: null, price_to: null, price_on_consultation: true, duration_minutes: 120, image_url: './html/Pics/Treatment/cover.jpeg', color: '#549260', featured: false, active: true, sort_order: 10 },
  { id: 'svc-half-updo', name: 'Half Updo', name_no: 'Halv Oppsett', category: 'Bridal & Special Occasion', price_from: 1500, price_to: null, price_on_consultation: false, duration_minutes: 45, image_url: './html/Pics/Brides/Bride5.jpeg', color: '#D98CA8', featured: false, active: true, sort_order: 11 },
  { id: 'svc-full-updo', name: 'Full Updo', name_no: 'Helt Oppsett', category: 'Bridal & Special Occasion', price_from: 2000, price_to: null, price_on_consultation: false, duration_minutes: 75, image_url: './html/Pics/Brides/Bride5.jpeg', color: '#C46E8C', featured: false, active: true, sort_order: 12 },
  { id: 'svc-bridal', name: 'Bridal Hair', name_no: 'Brudehår', category: 'Bridal & Special Occasion', price_from: 4000, price_to: null, price_on_consultation: false, duration_minutes: 120, image_url: './html/Pics/Brides/Bride5.jpeg', color: '#A8506E', featured: false, active: true, sort_order: 13 },
  { id: 'svc-consultation', name: 'Consultation', name_no: 'Konsultasjon', category: 'Consultation', price_from: 0, price_to: null, price_on_consultation: false, duration_minutes: 10, image_url: './html/Pics/Haircut/Haircut5.jpeg', color: '#9a9aa2', featured: false, active: true, sort_order: 14 },
];
const FALLBACK_STAFF_ADMIN = [
  { id: 'staff-hassan', name: 'Hassan K.', role: 'Founder & Master Stylist', role_no: 'Grunnlegger & Mesterstylisten', bio: '25+ years of luxury experience across Oslo and Lebanon. A master of balayage and extensions, with an expert touch across every discipline.', bio_no: '25+ års luksuserfaring fra Oslo og Libanon. En mester innen balayage og extensions, med et ekspertblikk på alle faglige disipliner.', photo_url: './html/Pics/Team/Hasan.jpg', instagram: 'https://www.instagram.com/studioserena.hair', bookable: true, external_booking_url: null, allow_overlap_booking: true, sort_order: 1, active: true },
  { id: 'staff-kani', name: 'Kani M.', role: 'Senior Stylist & Makeup Artist', role_no: 'Senior Stylisten & Makeup Artist', bio: '8+ years of experience. Specialist in balayage, bridal artistry, makeup, and styling for all—including hijabis.', bio_no: '8+ års erfaring. Spesialist på balayage brudestyling, makeup, og styling for alle – inkludert hijabis.', photo_url: './html/Pics/Team/Kani.jpg', instagram: 'https://www.instagram.com/hairgasmofficial', bookable: true, external_booking_url: null, allow_overlap_booking: false, sort_order: 2, active: true },
  { id: 'staff-taniya', name: 'Taniya S.', role: 'Keratin & Hair Treatment Specialist', role_no: 'Keratin & Hårbehandlingsspesialist', bio: 'Extensive luxury experience. A highly talented specialist in Keratin and restorative hair treatments for all clients—including hijabis.', bio_no: 'Omfattende luksuserfaring. En svært talentfull spesialist på Keratin og gjenoppbyggende hårbehandlinger for alle – inkludert hijabis.', photo_url: './html/Pics/Team/Taniya.jpg', instagram: 'https://www.instagram.com/lavellaprofessional', bookable: true, external_booking_url: null, allow_overlap_booking: false, sort_order: 3, active: true },
  { id: 'staff-heba', name: 'Heba K.', role: 'Creative Lead & Communications', role_no: 'Creative Lead & Kommunikasjon', bio: 'Specializing in digital artistry and high-end client relations. The architect of our online world and the voice behind every appointment.', bio_no: 'Spesialist innen digital kreativitet og førsteklasses kunderelasjoner. Arkitekten bak vår digitale verden og stemmen bak hver timebestilling.', photo_url: './html/Pics/Team/Heba.jpg', instagram: 'https://www.instagram.com/studioserena.hair', bookable: false, external_booking_url: null, allow_overlap_booking: false, sort_order: 4, active: true },
  { id: 'staff-pati', name: 'Pati', role: 'Nail Artist', role_no: 'Neglekunstner', bio: 'Our talented nail artist, specializing in gel, nail extensions, and creative nail art. Book your appointment directly through Timma.', bio_no: 'Vår talentfulle neglekunstner, spesialist på gele, neglforlengelse og kreativ neglekunst. Bestill time direkte via Timma.', photo_url: null, instagram: 'https://www.instagram.com/studio.serena.nailsbypati', bookable: false, external_booking_url: 'https://timma.no/salong/patrycja-neglebar', allow_overlap_booking: false, sort_order: 5, active: true },
];
function fallbackActivityLog(today) {
  const now = new Date(today + 'T00:00:00');
  const at = (daysAgo, h, m) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };
  return [
    { id: 'act-1', actor_name: 'Hassan K.', subject_name: 'Hassan K.', action: 'arrived', detail: 'Sara Nilsen · Highlights / Balayage', created_at: at(0, 11, 5) },
    { id: 'act-2', actor_name: 'Kani M.', subject_name: 'Kani M.', action: 'no_show', detail: 'Tuva Lund · Toner', created_at: at(0, 13, 15) },
    { id: 'act-3', actor_name: 'Taniya S.', subject_name: 'Taniya S.', action: 'block_created', detail: `${today} · 14:00–14:30 · Lunch`, created_at: at(0, 9, 0) },
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
  pending: 'Pending', confirmed: 'Confirmed', arrived: 'Arrived',
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
function renderDayStrip() {
  const today = todayStr();
  let html = '';
  // Anchored to the currently-loaded window (not always "today"), so paging
  // forward/back with the arrow buttons or the calendar picker actually
  // changes what the strip shows instead of always displaying today+13.
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const dateStr = addDays(windowFrom, i);
    const d = new Date(dateStr + 'T00:00:00');
    const dow = d.getDay();
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const count = currentBookings.filter((b) => b.date === dateStr).length;
    const loadPct = Math.min(100, Math.round((count / 6) * 100));
    const classes = ['day-cell'];
    if (dateStr === today) classes.push('today');
    if (dow === 0 || dow === 6) classes.push('weekend');
    if (dateStr === selectedDate) classes.push('active');
    html += `
      <button type="button" class="${classes.join(' ')}" data-date="${dateStr}">
        <span class="day-cell-weekday">${weekday}</span>
        <span class="day-cell-num">${d.getDate()}</span>
        <span class="day-cell-bar"><span class="day-cell-bar-fill" style="width:${loadPct}%;"></span></span>
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
  if (cellEl) cellEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
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
btnDayStripNext.addEventListener('click', async () => {
  if (dayStripEl.scrollLeft + dayStripEl.clientWidth >= dayStripEl.scrollWidth - 4) {
    await selectDate(addDays(windowTo, 1), null);
  } else {
    dayStripEl.scrollBy({ left: dayStripEl.clientWidth * 0.6, behavior: 'smooth' });
  }
});
btnDayStripPrev.addEventListener('click', async () => {
  if (dayStripEl.scrollLeft <= 4) {
    await selectDate(addDays(windowFrom, -(DAYS_AHEAD + 1)), null);
  } else {
    dayStripEl.scrollBy({ left: -dayStripEl.clientWidth * 0.6, behavior: 'smooth' });
  }
});

// ── STAFF FILTER PILLS ──
function renderPills() {
  const pills = ['<button type="button" class="staff-pill" data-staff="all">All Stylists</button>']
    .concat(currentStaff.map((s) => `<button type="button" class="staff-pill" data-staff="${s.id}">${s.name}</button>`));
  staffPillsEl.innerHTML = pills.join('');
  staffPillsEl.querySelectorAll('.staff-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.staff === staffFilter);
    btn.addEventListener('click', () => {
      staffFilter = btn.dataset.staff;
      localStorage.setItem(STAFF_FILTER_KEY, staffFilter);
      renderPills();
      if (viewMode === 'upcoming') renderGrid(); else renderHistory();
    });
  });
}

// ── OVERLAP-AWARE COLUMN LAYOUT ──
// Groups blocks that overlap in time into clusters and splits each cluster's
// width evenly. For an overlap-eligible stylist, a Balayage anchor booking
// (11:00/15:00) always reserves its paired half-slot (13:00/16:30) — a
// phantom entry forces the 50/50 split even when no second client has
// actually booked that pairing yet; phantoms are filtered out before render.
function layoutBlocks(bookings, allowOverlap) {
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
    const n = cluster.length;
    cluster.forEach((e, i) => { if (e.b) positioned.push({ ...e.b, widthPct: 100 / n, leftPct: (100 / n) * i }); });
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
function statusBadgeHtml(b) {
  if (b.status === 'arrived') return '<span class="sched-block-badge badge-arrived"><i class="fa-solid fa-check"></i></span>';
  if (b.status === 'no_show') return '<span class="sched-block-badge badge-noshow"><i class="fa-solid fa-xmark"></i></span>';
  return '';
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
      <div class="sched-block-name">${b.customer_name}</div>
      ${narrow ? '' : `<div class="sched-block-meta">${b.service_name}</div>`}
      <div class="sched-block-meta">${fmtTime(b.start_time)}</div>
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
  return `<div class="sched-now-line" style="top:${top}px;"></div>`;
}

function columnHtml(staff, bookings, blocked, gridStart, gridEnd) {
  const gridHeight = (gridEnd - gridStart) * PX_PER_MIN;
  const positioned = layoutBlocks(bookings, !!staff.allow_overlap_booking);
  return `
    <div class="sched-col" data-staff="${staff.id}">
      <div class="sched-col-header">${staff.name}</div>
      <div class="sched-col-body" style="height:${gridHeight}px;">
        ${hourLinesHtml(gridStart, gridEnd)}
        ${blocked.map((s) => unavailBlockHtml(s, gridStart)).join('')}
        ${!bookings.length && !blocked.length ? '<div class="sched-col-empty">No appointments</div>' : ''}
        ${positioned.map((b) => blockHtml(b, gridStart)).join('')}
        ${nowLineHtml(gridStart, gridEnd)}
      </div>
    </div>
  `;
}

function renderGrid() {
  const staffList = staffFilter === 'all' ? currentStaff : currentStaff.filter((s) => s.id === staffFilter);
  if (!staffList.length) { gridWrap.innerHTML = '<p class="sched-empty-note">No stylists to show.</p>'; return; }

  const dayBookings = currentBookings.filter((b) => b.date === selectedDate);
  const dayBlocked = currentBlocked.filter((s) => s.date === selectedDate);
  const relevantBookings = staffFilter === 'all' ? dayBookings : dayBookings.filter((b) => b.staff_id === staffFilter);
  const { start, end } = computeGridRange(relevantBookings);
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
    body.addEventListener('click', (e) => {
      if (e.target.closest('.sched-block, .sched-block-unavailable')) return;
      const staffId = body.closest('.sched-col').dataset.staff;
      const offsetY = e.clientY - body.getBoundingClientRect().top;
      const minutes = Math.round((start + offsetY / PX_PER_MIN) / 15) * 15;
      openAddBookingModal({ staffId, date: selectedDate, time: minutesToTimeStr(minutes) });
    });
  });
}

// ── DETAIL POPUP ──
function openPopup(id) {
  const b = currentBookings.find((x) => x.id === id) || (historyBookings || []).find((x) => x.id === id) || (searchResults || []).find((x) => x.id === id);
  if (!b) return;
  const isToday = b.date === todayStr();
  const canAct = isToday && (b.status === 'pending' || b.status === 'confirmed');
  const canUndo = isToday && (b.status === 'arrived' || b.status === 'no_show');
  popupBody.innerHTML = `
    <div class="popup-name">${b.customer_name}</div>
    <div class="popup-meta">${b.service_name}${b.staff_name ? ' · ' + b.staff_name : ''}</div>
    <div class="popup-meta">${fmtTime(b.start_time)} – ${fmtTime(b.end_time)}</div>
    ${b.customer_phone ? `<a class="popup-phone" href="tel:${b.customer_phone}"><i class="fa-solid fa-phone"></i> ${b.customer_phone}</a>` : '<div style="margin-bottom:1.25rem;"></div>'}
    ${b.notes ? `<div class="popup-notes"><i class="fa-solid fa-note-sticky"></i> ${b.notes}</div>` : ''}
    ${canAct
      ? `<div class="popup-actions">
           <button class="sched-btn sched-btn-arrived" data-action="arrived" data-id="${b.id}"><i class="fa-solid fa-check"></i> Arrived</button>
           <button class="sched-btn sched-btn-noshow" data-action="no_show" data-id="${b.id}">No-show</button>
         </div>`
      : `<span class="sched-status ${b.status}">${STATUS_LABELS[b.status] || b.status}</span>
         ${canUndo ? `<button type="button" class="popup-undo-btn" data-action="confirmed" data-id="${b.id}"><i class="fa-solid fa-rotate-left"></i> Pressed by mistake? Undo</button>` : ''}`}
    ${b.customer_phone || b.customer_name ? `<button type="button" class="popup-history-btn" id="popupCheckHistory"><i class="fa-solid fa-clock-rotate-left"></i> Check history of this person</button>` : ''}
  `;
  popupBody.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      popupBody.querySelectorAll('button').forEach((x) => (x.disabled = true));
      const status = btn.dataset.action;
      const { error } = await updateBookingStatusStaff({ pin: currentPin, bookingId: id, status, actorStaffId: currentActorStaffId });
      if (error && id.startsWith('demo-')) { const fb = currentBookings.find((x) => x.id === id); if (fb) fb.status = status; }
      else if (!error) b.status = status;
      closePopup();
      renderGrid();
    });
  });
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
          <div class="history-row-name">${b.customer_name}</div>
          <div class="history-row-meta">${b.service_name}${b.staff_name ? ' · ' + b.staff_name : ''}</div>
        </div>
        <span class="sched-status ${b.status}">${STATUS_LABELS[b.status] || b.status}</span>
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
  const start = blockAllDay.checked ? '00:00' : blockStart.value;
  const end = blockAllDay.checked ? '23:59' : blockEnd.value;
  if (!date || !start || !end) { blockStatus.textContent = 'Fill in date, start, and end time.'; blockStatus.style.color = '#dc2626'; return; }
  if (end <= start) { blockStatus.textContent = 'End time must be after start time.'; blockStatus.style.color = '#dc2626'; return; }
  blockStatus.textContent = 'Saving…'; blockStatus.style.color = 'var(--sched-text-muted)';
  const reason = blockReason.value.trim();
  const { data, error } = staffId === null
    ? await addBlockedSlotAdmin({ pin: currentPin, staffId: null, date, startTime: start, endTime: end, reason })
    : await addStaffUnavailable({ pin: currentPin, staffId, date, startTime: start, endTime: end, reason, actorStaffId: currentActorStaffId });
  const slot = !error && data ? data : { id: 'fallback-' + Date.now(), staff_id: staffId, date, start_time: start + ':00', end_time: end + ':00', reason: reason || null };
  currentBlocked.push(slot);
  blockStatus.textContent = '✓ Blocked.'; blockStatus.style.color = '#059669';
  renderExistingBlocks();
  renderGrid();
});

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
      .map((b) => ({ startMin: timeToMinutes(fmtTime(b.start_time)), endMin: timeToMinutes(fmtTime(b.end_time)), label: `${b.customer_name} — ${b.service_name}`, isBlock: false })),
    ...blocked
      .filter((b) => b.staff_id === staffId || b.staff_id === null)
      .map((b) => ({ startMin: timeToMinutes(fmtTime(b.start_time)), endMin: timeToMinutes(fmtTime(b.end_time)), label: b.reason ? `Blocked — ${b.reason}` : 'Blocked', isBlock: true })),
  ].sort((a, b) => a.startMin - b.startMin);
}
function renderBusyRangesInto(el, busyRanges) {
  if (!busyRanges.length) {
    el.innerHTML = '<p class="reschedule-availability-title">Availability that day</p><p class="reschedule-free-note"><i class="fa-solid fa-circle-check"></i> Wide open — nothing else booked.</p>';
  } else {
    el.innerHTML = '<p class="reschedule-availability-title">Already busy that day</p>' + busyRanges.map((r) => `
      <div class="reschedule-busy-row" data-start="${r.startMin}" data-end="${r.endMin}">
        <span class="reschedule-busy-time">${minutesToTimeStr(r.startMin)}–${minutesToTimeStr(r.endMin)}</span>
        <span class="reschedule-busy-label">${r.isBlock ? '<i class="fa-solid fa-ban"></i> ' : ''}${r.label}</span>
      </div>
    `).join('');
  }
}
// Highlights conflicting rows + shows a warning inside `el`, disables
// `saveBtn` while a conflict exists. Returns the list of conflicts found.
// 13:00 and 16:30 are Hassan-style overlap-pairing's designated slots (a
// Balayage at 11:00/15:00 legitimately shares the chair with a second quick
// service exactly there — see OVERLAP_ANCHORS). Those two times stay hard-
// blocked even for an overlap-eligible stylist, so that pairing can't be
// triple-booked. Any OTHER time is left to the owner's judgment — an
// overlap-eligible stylist can be manually double-booked there if needed.
const PROTECTED_OVERLAP_TIMES = [780, 990]; // 13:00, 16:30 in minutes
function markConflictsIn(el, busyRanges, newStart, newEnd, saveBtn, allowOverlap) {
  el.querySelectorAll('.reschedule-busy-row').forEach((row) => row.classList.remove('conflict', 'conflict-allowed'));
  const existingWarn = el.querySelector('.reschedule-conflict-warning');
  if (existingWarn) existingWarn.remove();
  const conflicts = busyRanges.filter((r) => newStart < r.endMin && newEnd > r.startMin);
  const canOverride = allowOverlap && !PROTECTED_OVERLAP_TIMES.includes(newStart);
  if (conflicts.length) {
    el.querySelectorAll('.reschedule-busy-row').forEach((row) => {
      if (conflicts.some((c) => c.startMin === Number(row.dataset.start) && c.endMin === Number(row.dataset.end))) {
        row.classList.add(canOverride ? 'conflict-allowed' : 'conflict');
      }
    });
    const warn = document.createElement('p');
    warn.className = 'reschedule-conflict-warning';
    warn.innerHTML = canOverride
      ? '<i class="fa-solid fa-circle-info"></i> Overlaps an existing appointment — allowed for this stylist, double-check before saving.'
      : '<i class="fa-solid fa-triangle-exclamation"></i> That time overlaps something already booked — pick another time.';
    if (!canOverride) warn.classList.add('blocking');
    el.appendChild(warn);
  }
  const mustBlock = conflicts.length > 0 && !canOverride;
  if (saveBtn) saveBtn.disabled = mustBlock;
  return mustBlock ? conflicts : [];
}

// ── MOVE (RESCHEDULE) BOOKING MODAL ── (Owner Panel Bookings tab's "Move")
let rescheduleBookingTarget = null;
let rescheduleBusyRanges = [];
const rescheduleDatePicker = wireOwnerDatePicker({
  btnId: 'btnRescheduleDatePick', labelId: 'rescheduleDateLabel', popoverId: 'rescheduleCalendarPopover',
  prevId: 'reschedCalPrev', nextId: 'reschedCalNext', monthLabelId: 'reschedCalMonthLabel', gridId: 'reschedCalGrid',
  placeholder: 'Pick a date', onSelect: () => loadRescheduleAvailability(),
});

async function loadRescheduleAvailability() {
  const date = rescheduleDatePicker.value;
  const staffId = rescheduleStaffSelect.value;
  if (!date || !staffId) { rescheduleAvailability.innerHTML = ''; rescheduleBusyRanges = []; checkRescheduleConflict(); return; }
  rescheduleAvailability.innerHTML = '<p class="reschedule-availability-title">Checking availability…</p>';
  rescheduleBusyRanges = await fetchBusyRangesFor(date, staffId, rescheduleBookingTarget?.id);
  renderBusyRangesInto(rescheduleAvailability, rescheduleBusyRanges);
  checkRescheduleConflict();
}

// Returns the current conflict list (not just a side effect) so the Save
// handler can independently re-verify at the moment of saving — belt and
// suspenders on top of the disabled button, so a stale/bypassed disabled
// state can never let a double-booking through.
function checkRescheduleConflict() {
  const time = rescheduleTime.value;
  if (!time || !rescheduleBookingTarget) return markConflictsIn(rescheduleAvailability, [], 0, 0, btnSaveReschedule);
  const duration = timeToMinutes(fmtTime(rescheduleBookingTarget.end_time)) - timeToMinutes(fmtTime(rescheduleBookingTarget.start_time));
  const newStart = timeToMinutes(time);
  const staff = currentStaff.find((s) => s.id === rescheduleStaffSelect.value);
  return markConflictsIn(rescheduleAvailability, rescheduleBusyRanges, newStart, newStart + duration, btnSaveReschedule, staff?.allow_overlap_booking);
}

function openRescheduleModal(booking) {
  rescheduleBookingTarget = booking;
  rescheduleSub.textContent = `${booking.customer_name} — ${booking.service_name}`;
  rescheduleDatePicker.setValue(booking.date);
  rescheduleTime.value = booking.start_time.slice(0, 5);
  rescheduleStaffSelect.innerHTML = currentStaff.map((s) => `<option value="${s.id}"${s.id === booking.staff_id ? ' selected' : ''}>${s.name}</option>`).join('');
  rescheduleStatus.textContent = '';
  rescheduleModal.style.display = 'flex';
  loadRescheduleAvailability();
}
function closeRescheduleModal() { rescheduleModal.style.display = 'none'; rescheduleBookingTarget = null; }
rescheduleClose.addEventListener('click', closeRescheduleModal);
rescheduleModal.addEventListener('click', (e) => { if (e.target === rescheduleModal) closeRescheduleModal(); });
rescheduleStaffSelect.addEventListener('change', loadRescheduleAvailability);
rescheduleTime.addEventListener('input', checkRescheduleConflict);
btnSaveReschedule.addEventListener('click', async () => {
  if (!rescheduleBookingTarget) return;
  const date = rescheduleDatePicker.value;
  const time = rescheduleTime.value;
  if (!date || !time) { rescheduleStatus.textContent = 'Pick a date and time.'; rescheduleStatus.style.color = '#dc2626'; return; }
  if (checkRescheduleConflict().length) {
    rescheduleStatus.textContent = 'That time overlaps something already booked — pick another time.';
    rescheduleStatus.style.color = '#dc2626';
    return;
  }
  rescheduleStatus.textContent = 'Saving…'; rescheduleStatus.style.color = 'var(--sched-text-muted)';
  const { error } = await rescheduleBookingAdmin({
    pin: currentPin, bookingId: rescheduleBookingTarget.id, date, startTime: time, staffId: rescheduleStaffSelect.value,
  });
  if (error) { rescheduleStatus.textContent = 'Error: ' + error.message; rescheduleStatus.style.color = '#dc2626'; return; }
  rescheduleStatus.textContent = '✓ Moved.'; rescheduleStatus.style.color = '#059669';
  setTimeout(() => { closeRescheduleModal(); switchOwnerTab(ownerActiveTab); }, 500);
});

// ── COMPLETE BOOKING MODAL ── (captures amount_charged — see 0001's comment on that column)
let completeBookingTarget = null;
function openCompleteModal(booking) {
  completeBookingTarget = booking;
  completeSub.textContent = `${booking.customer_name} — ${booking.service_name}`;
  completeAmount.value = '';
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
  return markConflictsIn(addBkAvailability, addBkBusyRanges, newStart, newStart + service.duration_minutes, btnSaveAddBooking, staff?.allow_overlap_booking);
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
  if (checkAddBookingConflict().length) {
    addBkStatus.textContent = 'That time overlaps something already booked — pick another time.';
    addBkStatus.style.color = '#dc2626';
    return;
  }
  addBkStatus.textContent = 'Saving…'; addBkStatus.style.color = 'var(--sched-text-muted)';
  const { error } = await bookAppointment({
    serviceId: addBkService.value, staffId: addBkStaff.value, date, startTime: time,
    name, email, phone, notes: addBkNotes.value.trim(),
  });
  if (error) { addBkStatus.textContent = 'Error: ' + error.message; addBkStatus.style.color = '#dc2626'; return; }
  addBkStatus.textContent = '✓ Booked.'; addBkStatus.style.color = '#059669';
  setTimeout(() => { closeAddBookingModal(); switchOwnerTab(ownerActiveTab); }, 500);
});

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
  services: renderOwnerServicesTab,
  staff: renderOwnerStaffTab,
  bookings: renderOwnerBookingsTab,
  revenue: renderOwnerRevenueTab,
  hours: renderOwnerHoursTab,
  activity: renderOwnerActivityTab,
  settings: renderOwnerSettingsTab,
};
let ownerActiveTab = 'services';
function openOwnerPanel() {
  ownerPanelModal.style.display = 'flex';
  switchOwnerTab(ownerActiveTab);
}
function closeOwnerPanel() { ownerPanelModal.style.display = 'none'; }
function switchOwnerTab(tab) {
  ownerActiveTab = tab;
  ownerTabs.querySelectorAll('.owner-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ownerTabContent.innerHTML = '<p class="owner-empty">Loading…</p>';
  (OWNER_TAB_RENDERERS[tab] || (() => {}))();
}
btnOwnerPanel.addEventListener('click', () => { closeMoreMenu(); openOwnerPanel(); });
ownerPanelClose.addEventListener('click', closeOwnerPanel);
ownerPanelModal.addEventListener('click', (e) => { if (e.target === ownerPanelModal) closeOwnerPanel(); });
ownerTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.owner-tab');
  if (btn) switchOwnerTab(btn.dataset.tab);
});

const OWNER_CATEGORIES = ['Color Services', 'Haircuts & Styling', 'Hair Extensions', 'Keratin & Hair Treatments', 'Bridal & Special Occasion', 'Consultation'];

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
      <div class="block-field"><label>Price from (NOK)</label><input type="number" id="svcPriceFrom" /></div>
      <div class="block-field"><label>Price to (optional)</label><input type="number" id="svcPriceTo" /></div>
      <div class="block-field"><label>Duration (minutes)</label><input type="number" id="svcDuration" /></div>
    </div>
    ${ownerPhotoFieldHtml({ fileId: 'svcImageFile', previewId: 'svcImagePreview', previewEmptyId: 'svcImagePreviewEmpty', statusId: 'svcImageStatus', hiddenId: 'svcImageUrl', label: 'Photo' })}
    <label class="owner-checkbox-row" style="margin-bottom:0.6rem;margin-top:1rem;"><input type="checkbox" id="svcOnConsultation" /> Price on consultation (no fixed price)</label>
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
    ['svcId', 'svcName', 'svcNameNo', 'svcPriceFrom', 'svcPriceTo', 'svcDuration', 'svcImageUrl'].forEach((id) => { document.getElementById(id).value = ''; });
    document.getElementById('svcCategory').value = OWNER_CATEGORIES[0];
    document.getElementById('svcColor').value = '#9a9aa2';
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
        document.getElementById('svcImageUrl').value = s.image_url || '';
        document.getElementById('svcImageStatus').textContent = '';
        setOwnerPhotoPreview({ previewId: 'svcImagePreview', previewEmptyId: 'svcImagePreviewEmpty', url: s.image_url || null });
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
      priceOnConsultation: onConsultation, durationMinutes: duration,
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
    ['stfId', 'stfName', 'stfRole', 'stfRoleNo', 'stfInstagram', 'stfBio', 'stfBioNo', 'stfPhotoUrl', 'stfExternalUrl'].forEach((id) => { document.getElementById(id).value = ''; });
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
      <span class="revenue-range-sep">or a custom range —</span>
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
      <h4 class="owner-section-title">By Stylist <span style="font-weight:400;color:var(--sched-text-muted);font-size:0.72rem;text-transform:none;letter-spacing:0;">— tap a stylist for the breakdown</span></h4>
      <div class="revenue-stylist-list">
        ${rows.length ? rows.map((r) => {
          const isOpen = expandedStaffId === r.staff_id;
          const mine = completedDetail.filter((b) => b.staff_id === r.staff_id)
            .slice().sort((a, b) => (b.date + b.start_time).localeCompare(a.date + a.start_time));
          return `
          <div class="revenue-stylist-row${isOpen ? ' open' : ''}" data-staff="${r.staff_id}">
            <div class="revenue-stylist-main">
              <div class="revenue-stylist-name"><i class="fa-solid fa-chevron-right revenue-expand-icon"></i> ${r.staff_name}</div>
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
                  <div class="revenue-detail-service">${b.service_name}</div>
                  <div class="revenue-detail-meta">${b.customer_name} · ${new Date(b.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                </div>
                <div class="revenue-detail-amount">${b.amount_charged != null ? Math.round(Number(b.amount_charged)).toLocaleString('en-US') + ' NOK' : '—'}</div>
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
              <div class="owner-booking-name">${b.customer_name} — ${b.service_name}</div>
              <div class="owner-booking-meta">${b.staff_name} · ${b.customer_phone || 'No phone'}${b.customer_email ? ' · ' + b.customer_email : ''}</div>
              ${b.notes ? `<div class="owner-booking-notes"><i class="fa-solid fa-note-sticky"></i> ${b.notes}</div>` : ''}
            </div>
            <span class="sched-status ${b.status}">${STATUS_LABELS[b.status] || b.status}</span>
          </div>
          ${b.status === 'completed' && b.amount_charged != null ? `<div class="owner-booking-amount">${Number(b.amount_charged).toLocaleString('en-US')} NOK charged</div>` : ''}
          ${actions.length ? `
          <div class="owner-booking-actions">
            ${actions.map((a) => `<button type="button" class="owner-action-btn ${a.cls}" data-type="${a.type}"${a.status ? ` data-status="${a.status}"` : ''}><i class="fa-solid ${a.icon}"></i> ${a.label}</button>`).join('')}
          </div>` : ''}
        </div>
      `;
    });
    list.innerHTML = html;
    list.querySelectorAll('.owner-booking-card').forEach((card) => {
      card.querySelectorAll('.owner-action-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const booking = loadedRows.find((bk) => bk.id === card.dataset.id);
          if (btn.dataset.type === 'move') { if (booking) openRescheduleModal(booking); return; }
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
    <p style="font-size:0.78rem;color:var(--sched-text-muted);margin:-0.5rem 0 1rem;">For a stylist who closes later or earlier than the salon's general hours on a specific day — e.g. Kani stays until 18:00 on Mon/Wed/Fri.</p>
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
    if (!data || !data.length) { list.innerHTML = '<p class="owner-empty">No overrides — everyone follows the salon\'s general hours.</p>'; return; }
    list.innerHTML = data.map((o) => `
      <div class="owner-list-row">
        <div class="owner-list-row-main">
          <div class="owner-list-row-title">${o.staff_name}</div>
          <div class="owner-list-row-meta">${OWNER_WEEKDAY_NAMES[o.weekday]} — closes at ${fmtTime(o.close_time)}</div>
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
  arrived: { icon: 'fa-check', bg: '#059669', title: (s) => `Checked in a client${s ? ' — ' + s : ''}` },
  no_show: { icon: 'fa-xmark', bg: '#dc2626', title: (s) => `Marked a no-show${s ? ' — ' + s : ''}` },
  confirmed: { icon: 'fa-rotate-left', bg: '#6b7280', title: (s) => `Undid an Arrived/No-show${s ? ' — ' + s : ''}` },
  block_created: { icon: 'fa-ban', bg: '#6b7280', title: (s) => `Blocked time — ${s || 'Whole salon'}` },
  block_removed: { icon: 'fa-rotate-left', bg: '#6b7280', title: (s) => `Removed a block — ${s || 'Whole salon'}` },
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

function renderOwnerSettingsTab() {
  ownerTabContent.innerHTML = `
    <h4 class="owner-section-title">Team Schedule PIN</h4>
    <p style="font-size:0.78rem;color:var(--sched-text-muted);margin-bottom:0.8rem;">Everyday PIN every stylist uses to open the schedule.</p>
    <div class="block-field" style="max-width:220px;"><label>Staff PIN</label><input type="text" id="setStaffPin" /></div>
    <button type="button" id="btnSaveStaffPinNew" class="block-save-btn" style="width:auto;margin-bottom:0.5rem;">Save</button>
    <div id="setStaffPinStatus" class="owner-status-msg" style="margin-bottom:1.75rem;"></div>

    <h4 class="owner-section-title">Owner PIN</h4>
    <p style="font-size:0.78rem;color:var(--sched-text-muted);margin-bottom:0.8rem;">This PIN unlocks the Owner Panel — keep it different from the staff PIN and don't share it with the team.</p>
    <div class="block-field" style="max-width:220px;"><label>Owner PIN</label><input type="text" id="setOwnerPin" /></div>
    <button type="button" id="btnSaveOwnerPinNew" class="block-save-btn" style="width:auto;">Save</button>
    <div id="setOwnerPinStatus" class="owner-status-msg"></div>
  `;
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
    statusEl.textContent = '✓ Saved — use this new PIN next time you open the Owner Panel.'; statusEl.style.color = '#059669';
  });
}

// ── LOAD ──
async function loadStaff() {
  const { data, error } = await fetchBookableStaff();
  currentStaff = !error && data && data.length ? data : FALLBACK_STAFF;
}
async function loadServices() {
  const { data, error } = await fetchActiveServices();
  currentServices = !error && data && data.length ? data : FALLBACK_SERVICES;
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
  loadWindow(pin, todayStr(), addDays(todayStr(), DAYS_AHEAD)).then(() => {
    renderDayStrip();
    updateDayLabel();
    renderGrid();
  });
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
