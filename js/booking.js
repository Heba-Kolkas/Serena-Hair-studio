import {
  fetchActiveServices,
  fetchServiceAddons,
  fetchStaffForService,
  fetchBusinessHours,
  fetchBookingHorizonDays,
  fetchBlockedSlots,
  fetchBusySlots,
  fetchBusySlotsRange,
  fetchBlockedSlotsRange,
  bookAppointment,
  fetchBookingTerms,
  checkClientMustCall,
} from '/js/supabase-client.js';

// Static fallbacks so the wizard is fully browsable for UI/UX review while
// Supabase is paused — mirrors supabase/migrations/0002_seed_data.sql and
// js/team.js's bookable staff. Steps 1-4 work identically to how they'll
// look once the database is live; the final Confirm step will still fail
// (there's nowhere to actually save a booking yet), by design.
// Every bookable service is Hassan+Kani. Keratin/Hair Botox are still on the
// list but no longer book here at all — they route to Taniya's Instagram
// (see EXTERNAL_TANIYA below). A few service types only run at two fixed
// times a day rather than the normal 15-min grid.
const STAFF_GENERAL = ['staff-1', 'staff-2'];
const STAFF_HASSAN = ['staff-1']; // extensions are his alone

// Services the studio offers but doesn't book through this system — the
// wizard shows them, then hands off. Mirrors services.external_booking_url /
// external_booking_label (migration 0005); the same idea already sends nail
// clients to Pati's Timma page from the team card.
const EXTERNAL_TANIYA = {
  external_booking_url: 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu',
  external_booking_label: 'Book with Taniya on Instagram',
};

// The 4-hour lightening services (balayage, both foils, reverse balayage) run
// at two starts a day, for both stylists, every weekday. Four hours either
// way leaves a clear window on the other side of the day, so a second client
// still fits without overlapping: 11:00 runs to 15:00 and frees the
// afternoon, 15:00 frees the whole morning. Mirrors staff_service_schedule
// in 0002_seed_data.sql, which is what actually governs this.
//
// Kept as a function rather than a constant because it's driven per stylist
// and weekday in the database, and this is the shape that has to match.
function getBalayageTimes(staffId, weekday) {
  return ['11:00', '15:00'];
}
// ── PER-STYLIST DAY POLICY ──
// Mirrors the staff_day_policy table, which is what book_appointment actually
// enforces; this copy exists so the wizard draws the same slots rather than
// offering times the RPC would then refuse.
//
// Kani's Mon/Wed/Fri: one four-hour colour (11:00 or 15:00), at most two
// shorter appointments around it, and hours that move with the colour — an
// 11:00 colour means she works to 17:30, a 15:00 colour means she starts at
// 12:00, and a day with no colour ends at 17:00.
//
// On a day with nothing booked yet, her shorter work starts at 12:00 and has
// to fall entirely on one side of 15:00. A booking straddling that hour would
// rule out BOTH colour starts and cost her the most valuable slot of the day;
// either side of it leaves one still bookable.
// Her Tue/Thu: colours only, two a day — except the run-up to the afternoon
// colour, which opens to shorter work within three days of the date. Taking
// it costs the morning colour slot, which is why it only opens once that
// colour probably isn't coming.
// Hassan has no policy and is governed by business_hours as before.
const STAFF_DAY_POLICY = {
  'staff-2': {
    1: { maxLimited: 1, allowOther: true, maxOther: 2, colourHoldDays: 1, open: '11:00', close: '17:00', otherOpen: '12:00', otherSplitAt: '15:00', closeAfterEarly: '17:30', openBeforeLate: '12:00' },
    3: { maxLimited: 1, allowOther: true, maxOther: 2, colourHoldDays: 1, open: '11:00', close: '17:00', otherOpen: '12:00', otherSplitAt: '15:00', closeAfterEarly: '17:30', openBeforeLate: '12:00' },
    5: { maxLimited: 1, allowOther: true, maxOther: 2, colourHoldDays: 1, open: '11:00', close: '17:00', otherOpen: '12:00', otherSplitAt: '15:00', closeAfterEarly: '17:30', openBeforeLate: '12:00' },
    2: { maxLimited: 2, allowOther: false, lateFillDays: 3, colourHoldDays: 1, open: '11:00', close: '17:00', otherOpen: '12:00', otherSplitAt: '15:00', closeAfterEarly: '18:00', openBeforeLate: '11:00' },
    4: { maxLimited: 2, allowOther: false, lateFillDays: 3, colourHoldDays: 1, open: '11:00', close: '17:00', otherOpen: '12:00', otherSplitAt: '15:00', closeAfterEarly: '18:00', openBeforeLate: '11:00' },
  },
};

function getDayPolicy(staffId, weekday) {
  const forStaff = STAFF_DAY_POLICY[staffId];
  return (forStaff && forStaff[weekday]) || null;
}

// Kani takes clients until 18:00 on Mon/Wed/Fri — later than the salon's
// general 17:30 close on those days. Mirrors staff_hours_override.
// Hassan takes everything that isn't a four-hour colour at 13:00 or 16:30,
// every day, colour or not — the same two times his overlap pairing uses.
// Kani has no entry here and runs on the open grid inside her own hours.
// Mirrors the staff_service_schedule rows in 0002_seed_data.sql.
const HASSAN_SLOT_SERVICES = new Set([
  'svc-toner', 'svc-root', 'svc-allover',
  'svc-cut-blowdry', 'svc-cut-wash-blowdry',
  'svc-cut-wash-blowdry-styling', 'svc-cut-wash-mask-blowdry',
  'svc-blowdry', 'svc-wash-blowdry', 'svc-wash-blowdry-wavy',
  'svc-ext-50', 'svc-ext-100',
]);
const HASSAN_SLOT_TIMES = ['13:00', '16:30'];
// Updos are the exception: ninety minutes at 11:00 leaves the rest of his day
// free for a colour touch-up, haircut, toner or blowdry, and keeps the 15:00
// balayage bookable.
const HASSAN_UPDO_SERVICES = new Set(['svc-half-updo', 'svc-full-updo']);
const HASSAN_UPDO_TIMES = ['11:00'];
// The hour the afternoon colour starts. Once something already fills part of
// Hassan's morning, his 13:00 slot gives way to the open grid up to here, so
// the leftover time gets used instead of sitting idle — an 11:00 updo ends at
// 12:30 and the rest of the morning becomes bookable from 12:30. His 16:30
// slot is untouched, which is what keeps a 15:00 colour and a late short
// appointment both on the table.
const GAP_FILL_BOUNDARY = '15:00';
// How many start times a policy stylist's day shows at once. See the note at
// the end of computeSlotsFor for why the list is deliberately short.
const POLICY_VISIBLE_SLOTS = 3;

function getStaffFixedTimes(svc, staffId, weekday) {
  if (staffId === 'staff-1') {
    if (HASSAN_UPDO_SERVICES.has(svc.id)) return HASSAN_UPDO_TIMES;
    if (HASSAN_SLOT_SERVICES.has(svc.id)) return HASSAN_SLOT_TIMES;
    return svc.fixed_times;
  }
  // Kani has no fixed times of her own: her day policy shapes everything,
  // updos included.
  return svc.fixed_times;
}

function getStaffCloseOverride(staffId, weekday) {
  if (staffId === 'staff-2' && (weekday === 1 || weekday === 3 || weekday === 5)) return '18:00';
  return null;
}
// Consultation is a special case: bookable in any open slot (it's allowed to
// nest inside another booking, not blocked by the usual overlap check —
// mirrors book_appointment) as long as it doesn't start at that booking's
// exact start time (already guaranteed by the same-slot uniqueness check),
// capped at 17:00 and 2 per stylist per day.
const CONSULTATION_LATEST_START = '17:00';
const CONSULTATION_DAILY_CAP = 2;
const CONSULTATION_DURATION = 10;
// A 4-hour lightening appointment (240min, starting 11:00 or 15:00) doesn't
// block its paired "second client" time for a stylist with
// allow_overlap_booking — mirrors the exemption carved out in the
// book_appointment RPC. Keyed in minutes. The pairing times themselves
// (13:00/16:30) are about when the colour is far enough into processing to
// leave unattended, which doesn't shift just because the full appointment now
// runs longer end-to-end.
const OVERLAP_ANCHORS = { 660: 780, 900: 990 }; // 11:00->13:00, 15:00->16:30
const BALAYAGE_DURATION = 240;
// Bridal and updo work is treated apart from everything else in two ways:
// it never gets paired with a second client while colour processes, and it
// never carries add-ons — a client can't tack an updo or bridal styling onto
// a balayage booking, or bolt extras onto a bridal one. Enforced in the
// wizard below, in book_appointment, and in the Owner Panel's add-on
// checklist, so it can't be reintroduced by configuration.
const BRIDAL_CATEGORIES = ['Bridal', 'Special Occasions'];

// ── ADD-ONS ──
// The printed price list names exactly two extras, both on colour work —
// "a haircut added to a color service is an additional 500 kr" and "covering
// grey hair in addition to balayage is an additional 1,200 kr" (the list is
// written in kr; the site displays the same figures as NOK) — plus toner,
// which the owner confirmed rides along at its standalone rate.
//
// Field names deliberately match the `addons` table (migration 0005), so a
// fallback add-on and one fetched from the database are interchangeable
// everywhere below. `kind` only affects labelling: 'addon' is a small extra
// bolted on ("+500 NOK"), 'combo' is a second full service in the same visit
// ("From 1,250 NOK"). Both add to the total the same way.
const ADDON_HAIRCUT = { id: 'addon-haircut', name: 'Haircut', name_no: 'Klipp', price: 500, kind: 'addon' };
const ADDON_GREY = { id: 'addon-grey', name: 'Grey Coverage', name_no: 'Grådekking', price: 1200, kind: 'addon' };
const ADDON_TONER = { id: 'addon-toner', name: 'Toner', name_no: 'Toner', price: 1250, price_is_from: true, kind: 'combo' };
// Extensions fitted during the same visit. The colour's length doesn't
// change — the fitting happens while it processes and after the rinse — and
// there's no figure to show, because the price was agreed at the consultation
// where the client chose colour and length. requiresStaff mirrors
// addons.requires_service_id: only a stylist who fits extensions may take it.
const ADDON_EXT_50 = { id: 'addon-ext-50', name: 'Extensions (50g)', name_no: 'Extensions (50g)', price: 0, price_on_consultation: true, kind: 'combo', exclusive_group: 'extensions', requires_confirmation: true, requiresStaff: STAFF_HASSAN };
const ADDON_EXT_100 = { id: 'addon-ext-100', name: 'Extensions (100-150g)', name_no: 'Extensions (100-150g)', price: 0, price_on_consultation: true, kind: 'combo', exclusive_group: 'extensions', requires_confirmation: true, requiresStaff: STAFF_HASSAN };

const LIGHTENING_ADDONS = [ADDON_HAIRCUT, ADDON_GREY, ADDON_TONER, ADDON_EXT_50, ADDON_EXT_100];
const COLOR_ADDONS = [ADDON_HAIRCUT, ADDON_TONER];

function fmtPrice(n) { return Number(n).toLocaleString('en-US') + ' NOK'; }

function addonPriceLabel(a) {
  if (a.price_on_consultation) return lang() === 'no' ? 'Pris etter konsultasjon' : 'Price on consultation';
  if (a.kind !== 'combo') return '+' + fmtPrice(a.price);
  const prefix = a.price_is_from ? (lang() === 'no' ? 'Fra ' : 'From ') : '';
  return prefix + fmtPrice(a.price);
}

// How long the appointment actually runs. A service can declare a longer
// length that kicks in the moment ANY add-on is picked — flat, not one delta
// per add-on: a root touch-up is 90 minutes alone and 120 with a haircut
// and/or a toner. Services that leave duration_with_addons_minutes unset
// never stretch, which is how balayage stays 4 hours whatever goes with it.
// Mirrors the same rule in book_appointment, which is the one that counts.
function effectiveDuration() {
  const svc = state.service;
  if (!svc) return 0;
  if (state.addons.length && svc.duration_with_addons_minutes) return svc.duration_with_addons_minutes;
  return svc.duration_minutes;
}

// What the visit is expected to cost: the service's own price plus every
// selected add-on. Mirrors the same calculation in book_appointment, which
// is the one that actually gets stored on the booking — this copy only
// drives what the summary screen shows.
//
// `isEstimate` is true when any component has no firm number: a service the
// price list quotes as "from", a consultation-priced service, or a "from"
// add-on. The figure is then a floor, not a quote, and is labelled as such.
function expectedTotal() {
  const svc = state.service;
  let total = 0;
  let isEstimate = false;
  if (!svc) return { total, isEstimate };
  total += Number(svc.price_from) || 0;
  if (svc.price_on_consultation || svc.price_is_from || svc.price_to != null) isEstimate = true;
  state.addons.forEach((a) => {
    // A consultation-priced add-on has no figure to add, but it does mean the
    // total shown is a floor rather than the real number.
    if (a.price_on_consultation) { isEstimate = true; return; }
    total += Number(a.price) || 0;
    if (a.price_is_from) isEstimate = true;
  });
  return { total, isEstimate };
}

function totalLabel({ total, isEstimate }) {
  const num = fmtPrice(total);
  if (!isEstimate) return num;
  return (lang() === 'no' ? 'Fra ' : 'From ') + num;
}

// Mirrors supabase/migrations/0002_seed_data.sql, which is itself a
// line-for-line transcription of the owner's printed price list.
const FALLBACK_SERVICES = [
  // Balayage & Highlights — 4 hours each, add-ons never extend them.
  { id: 'svc-balayage', name: 'Balayage / Highlights', name_no: 'Balayage / Striper', category: 'Balayage & Highlights', price_from: 3750, price_is_from: true, duration_minutes: 240, image_url: './html/Pics/Balayage/Blayage12.jpeg', staff: STAFF_GENERAL, balayageSchedule: true, addons: LIGHTENING_ADDONS },
  { id: 'svc-half-foil', name: 'Half Head Foil', name_no: 'Halv Folie', category: 'Balayage & Highlights', price_from: 3000, price_is_from: true, duration_minutes: 240, image_url: './html/Pics/Balayage/Blayage12.jpeg', staff: STAFF_GENERAL, balayageSchedule: true, addons: LIGHTENING_ADDONS },
  { id: 'svc-full-foil', name: 'Full Head Foil', name_no: 'Hel Folie', category: 'Balayage & Highlights', price_from: 3750, price_is_from: true, duration_minutes: 240, image_url: './html/Pics/Balayage/Blayage12.jpeg', staff: STAFF_GENERAL, balayageSchedule: true, addons: LIGHTENING_ADDONS },
  // Colour — root touch-up and all-over stretch to 120 min with any add-on.
  { id: 'svc-root', name: 'Root Touch-Up', name_no: 'Ansatsfarge', category: 'Color', price_from: 1600, price_is_from: true, duration_minutes: 90, duration_with_addons_minutes: 120, image_url: './html/Pics/Farge/Farge1.jpeg', staff: STAFF_GENERAL, addons: COLOR_ADDONS },
  { id: 'svc-allover', name: 'All-Over Color', name_no: 'Helfarge', category: 'Color', price_from: 2100, price_is_from: true, duration_minutes: 90, duration_with_addons_minutes: 120, image_url: './html/Pics/Farge/Farge1.jpeg', staff: STAFF_GENERAL, addons: COLOR_ADDONS },
  { id: 'svc-reverse', name: 'Reverse Balayage', name_no: 'Omvendt Balayage', category: 'Color', price_from: 3000, duration_minutes: 240, image_url: './html/Pics/Farge/Farge1.jpeg', staff: STAFF_GENERAL, balayageSchedule: true, addons: LIGHTENING_ADDONS },
  { id: 'svc-toner', name: 'Toner', name_no: 'Toner', category: 'Color', price_from: 1250, price_is_from: true, duration_minutes: 60, image_url: './html/Pics/Farge/Farge1.jpeg', staff: STAFF_GENERAL, addons: [ADDON_HAIRCUT] },
  // Haircuts — every combination is its own priced line, so nothing bolts on.
  { id: 'svc-cut-blowdry', name: 'Haircut + Blowdry (without wash)', name_no: 'Klipp + Føn (uten vask)', category: 'Haircuts & Styling', price_from: 950, duration_minutes: 60, image_url: './html/Pics/Haircut/Haircut5.jpeg', staff: STAFF_GENERAL },
  { id: 'svc-cut-wash-blowdry', name: 'Haircut + Wash + Blowdry', name_no: 'Klipp + Vask + Føn', category: 'Haircuts & Styling', price_from: 1150, duration_minutes: 60, image_url: './html/Pics/Haircut/Haircut5.jpeg', staff: STAFF_GENERAL },
  { id: 'svc-cut-wash-blowdry-styling', name: 'Haircut + Wash + Blowdry + Styling', name_no: 'Klipp + Vask + Føn + Styling', category: 'Haircuts & Styling', price_from: 1250, duration_minutes: 60, image_url: './html/Pics/Haircut/Haircut5.jpeg', staff: STAFF_GENERAL },
  { id: 'svc-cut-wash-mask-blowdry', name: 'Haircut + Wash + Mask + Blowdry', name_no: 'Klipp + Vask + Maske + Føn', category: 'Haircuts & Styling', price_from: 1350, duration_minutes: 60, image_url: './html/Pics/Haircut/Haircut5.jpeg', staff: STAFF_GENERAL },
  // Styling — normal 15-minute grid.
  { id: 'svc-blowdry', name: 'Blowdry / Light Styling', name_no: 'Føn / Lett Styling', category: 'Styling', price_from: 680, duration_minutes: 60, image_url: './html/Pics/Styling/styling4.jpeg', staff: STAFF_GENERAL },
  { id: 'svc-wash-blowdry', name: 'Wash + Blowdry', name_no: 'Vask + Føn', category: 'Styling', price_from: 750, duration_minutes: 60, image_url: './html/Pics/Styling/styling4.jpeg', staff: STAFF_GENERAL },
  { id: 'svc-wash-blowdry-wavy', name: 'Wash + Blowdry + Wavy Styling', name_no: 'Vask + Føn + Bølgestyling', category: 'Styling', price_from: 890, duration_minutes: 60, image_url: './html/Pics/Styling/styling4.jpeg', staff: STAFF_GENERAL },
  // Special occasions.
  { id: 'svc-half-updo', name: 'Half Updo', name_no: 'Halv Oppsett', category: 'Special Occasions', price_from: 1500, price_is_from: true, duration_minutes: 90, image_url: './html/Pics/Brides/Bride5.jpeg', staff: STAFF_GENERAL },
  { id: 'svc-full-updo', name: 'Full Updo', name_no: 'Helt Oppsett', category: 'Special Occasions', price_from: 2500, price_is_from: true, duration_minutes: 90, image_url: './html/Pics/Brides/Bride5.jpeg', staff: STAFF_GENERAL },
  // Bridal — quoted at consultation, with ~4,000 shown as a guideline.
  { id: 'svc-bridal', name: 'Bridal Hair', name_no: 'Brudehår', category: 'Bridal', price_from: 4000, price_on_consultation: true, duration_minutes: 240, fixed_times: ['11:00'], image_url: './html/Pics/Brides/Bride5.jpeg', staff: STAFF_GENERAL },
  // Not on the printed list, but still booked here.
  { id: 'svc-ext-50', name: 'Hair Extensions (50g)', name_no: 'Extensions (50g)', category: 'Hair Extensions', price_from: 3000, duration_minutes: 180, image_url: './html/Pics/Extensions/cover.jpeg', staff: STAFF_HASSAN, requiresConsultation: true },
  { id: 'svc-ext-100', name: 'Hair Extensions (100-150g)', name_no: 'Extensions (100-150g)', category: 'Hair Extensions', price_on_consultation: true, duration_minutes: 240, image_url: './html/Pics/Extensions/cover.jpeg', staff: STAFF_HASSAN, requiresConsultation: true },
  { id: 'svc-keratin', name: 'Keratin Treatment', name_no: 'Keratinbehandling', category: 'Keratin & Hair Treatments', price_on_consultation: true, duration_minutes: 150, image_url: './html/Pics/Treatment/cover.jpeg', ...EXTERNAL_TANIYA },
  { id: 'svc-botox', name: 'Hair Botox', name_no: 'Hår Botox', category: 'Keratin & Hair Treatments', price_on_consultation: true, duration_minutes: 120, image_url: './html/Pics/Treatment/cover.jpeg', ...EXTERNAL_TANIYA },
  { id: 'svc-consultation', name: 'Consultation', name_no: 'Konsultasjon', category: 'Consultation', price_from: 0, duration_minutes: 10, image_url: './html/Pics/Haircut/Haircut5.jpeg', staff: STAFF_GENERAL, consultationRule: true },
];
const FALLBACK_STAFF = [
  { id: 'staff-1', name: 'Hassan K.', role: 'Founder & Master Stylist', role_no: 'Grunnlegger & Mesterstylisten', photo_url: './html/Pics/Team/Hassan.jpeg', allow_overlap_booking: true },
  { id: 'staff-2', name: 'Kani M.', role: 'Senior Stylist & Makeup Artist', role_no: 'Senior Stylisten & Makeup Artist', photo_url: './html/Pics/Team/Kani.jpeg' },
];

const FALLBACK_BUSINESS_HOURS = [
  { weekday: 0, closed: true },
  { weekday: 1, open_time: '11:00', close_time: '17:30', closed: false },
  { weekday: 2, open_time: '11:00', close_time: '17:30', closed: false },
  { weekday: 3, open_time: '11:00', close_time: '17:30', closed: false },
  { weekday: 4, open_time: '11:00', close_time: '17:30', closed: false },
  { weekday: 5, open_time: '11:00', close_time: '17:30', closed: false },
  { weekday: 6, closed: true },
];

const state = {
  services: [],
  service: null,
  // Selected add-on rows themselves, not just their names — their ids go to
  // book_appointment, which prices them and writes them as real line items.
  addons: [],
  staff: null,
  staffOptions: [],
  date: null,
  startTime: null, // minutes since midnight
  name: '', email: '', phone: '', notes: '',
  lastBooking: null,
};

const wizard = document.getElementById('wizard');
const errorBox = document.getElementById('wizardError');

// Image paths are relative ('./html/...') rather than rooted ('/html/...')
// so the pages also work when a file is opened straight from the folder,
// where a leading slash points at the root of the drive. Matches the paths
// the seed data stores, so a fallback service and a live one look the same.
const IMG_FALLBACK = '<span class="option-card-img-empty"><i class="fa-regular fa-image"></i></span>';

function imgOrFallback(url) {
  if (!url) return IMG_FALLBACK;
  return `<img src="${url}" alt="" loading="lazy">`;
}

// Several of the service photo folders aren't in the repo, so those <img>s
// 404 and the browser paints its own broken-image icon inside every card.
// Swap a failed image for a plain tinted disc instead — missing artwork
// should look deliberate rather than broken. Registered on the document in
// the capture phase because `error` doesn't bubble, which also means it
// covers cards rendered later without re-binding anything.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG') return;
  const holder = img.closest('.option-card-img');
  if (holder) holder.innerHTML = IMG_FALLBACK;
}, true);

function lang() { return (window._getLang && window._getLang()) || 'en'; }
function localName(obj, base) {
  const l = lang();
  return (l === 'no' && obj[base + '_no']) ? obj[base + '_no'] : obj[base];
}

function priceLabel(svc) {
  if (svc.price_from === 0) return lang() === 'no' ? 'Gratis' : 'Free';
  const no = lang() === 'no';
  // Consultation-priced with no guideline figure at all (keratin, the larger
  // extensions tier) has nothing to show but the words.
  if (svc.price_on_consultation && svc.price_from == null) {
    return no ? 'Pris etter konsultasjon' : 'Price on consultation';
  }
  // "From" only where the price list actually says so — a haircut is 950 NOK
  // flat, a balayage is from 3,750 kr. Bridal carries both a guideline
  // figure and a consultation note, so it gets the prefix and the suffix.
  const prefix = (svc.price_is_from || svc.price_to || svc.price_on_consultation) ? (no ? 'Fra ' : 'From ') : '';
  const amount = svc.price_to
    ? `${Number(svc.price_from).toLocaleString('en-US')}–${Number(svc.price_to).toLocaleString('en-US')} NOK`
    : fmtPrice(svc.price_from);
  const suffix = svc.price_on_consultation ? (no ? ' · etter konsultasjon' : ' · on consultation') : '';
  return prefix + amount + suffix;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('visible');
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function clearError() {
  errorBox.classList.remove('visible');
  errorBox.textContent = '';
}

function showPanel(name) {
  document.querySelectorAll('.wizard-panel').forEach((p) => p.classList.remove('active'));
  const panel = document.querySelector(`.wizard-panel[data-panel="${name}"]`);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('.wizard-step-dot').forEach((dot) => {
    const step = parseInt(dot.dataset.step, 10);
    const current = parseInt(name, 10);
    dot.classList.toggle('active', step === current);
    dot.classList.toggle('done', !isNaN(current) && step < current);
  });
  clearError();
  if (typeof updateStickyBar === 'function') updateStickyBar();
  window.scrollTo({ top: wizard.offsetTop - 90, behavior: 'smooth' });
}

// ── STEP 1: SERVICES ──
async function loadServices() {
  const params = new URLSearchParams(location.search);
  const preselect = params.get('service');
  let data;
  try {
    const res = await fetchActiveServices();
    if (res.error || !res.data || !res.data.length) throw res.error || new Error('no services');
    data = res.data;
  } catch (e) {
    data = FALLBACK_SERVICES; // Supabase unreachable - preview mode
  }
  // Attach each service's add-on offers. Fetched alongside the services
  // rather than per-selection, so picking a service never waits on a second
  // request — and kept outside the block above so that a failure here costs
  // the wizard its add-ons, never its real service list.
  if (data !== FALLBACK_SERVICES) {
    try {
      const addonRes = await fetchServiceAddons();
      const byService = {};
      if (!addonRes.error && addonRes.data) {
        addonRes.data.forEach((row) => {
          if (!row.addon || row.addon.active === false) return;
          (byService[row.service_id] = byService[row.service_id] || []).push(row.addon);
        });
      }
      data.forEach((svc) => { svc.addons = byService[svc.id] || []; });
    } catch (e) {
      data.forEach((svc) => { svc.addons = []; });
    }
  }
  state.services = data;
  renderServices();
  if (preselect) {
    const svc = data.find((s) => s.id === preselect);
    if (svc) selectService(svc);
  }
}

function renderServices() {
  const wrap = document.getElementById('serviceGroups');
  const byCategory = {};
  state.services.forEach((s) => {
    (byCategory[s.category] = byCategory[s.category] || []).push(s);
  });
  const categories = Object.keys(byCategory);

  const allLabel = lang() === 'no' ? 'Alle kategorier' : 'All Categories';
  const filterBar = `
    <div class="service-filter-bar">
      <div class="service-search-wrap">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="serviceSearchInput" placeholder="${lang() === 'no' ? 'Søk etter tjenester…' : 'Search services…'}" />
      </div>
      <div class="custom-select" id="categoryDropdown">
        <button type="button" class="custom-select-trigger" id="categoryDropdownTrigger">
          <span class="custom-select-current" id="categoryDropdownLabel">${allLabel}</span>
          <i class="fa-solid fa-chevron-down"></i>
        </button>
        <div class="custom-select-menu" id="categoryDropdownMenu">
          <button type="button" class="custom-select-option active" data-value="all">${allLabel}</button>
          ${categories.map((cat) => {
            const pic = (byCategory[cat] || []).map((x) => x.image_url).find(Boolean);
            return `<button type="button" class="custom-select-option" data-value="${cat}">`
              + (pic ? `<span class="category-tab-img"><img src="${pic}" alt="" loading="lazy" /></span>` : '')
              + `<span>${cat}</span></button>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div class="category-tabs" id="categoryTabs" role="tablist">
      <button type="button" class="category-tab active" data-value="all">${allLabel}</button>
      ${categories.map((cat) => {
        // The category's own photo, taken from the first service in it. One
        // image per category in the catalogue, so this is that category's
        // picture rather than any particular service's.
        const pic = (byCategory[cat] || []).map((x) => x.image_url).find(Boolean);
        return `<button type="button" class="category-tab" data-value="${cat}">`
          + (pic ? `<span class="category-tab-img"><img src="${pic}" alt="" loading="lazy" /></span>` : '')
          + `<span>${cat}</span></button>`;
      }).join('')}
    </div>
  `;

  // One photo per category, circular, beside the heading — and the same photo
  // inside that category's tab above. Never on the cards themselves: there is
  // a single image per category, so a per-card photo repeated the same picture
  // three times and said nothing about what separated the services.
  const groups = Object.entries(byCategory).map(([cat, list]) => `
    <div class="category-group" data-category="${cat}">
      <div class="category-group-head">
        ${(byCategory[cat] || []).map((x) => x.image_url).find(Boolean)
          ? `<span class="category-group-img">${imgOrFallback((byCategory[cat] || []).map((x) => x.image_url).find(Boolean))}</span>`
          : ''}
        <div class="category-group-title">${cat}</div>
      </div>
      <div class="option-grid">
        ${list.map((s) => {
          // Externally booked services (Keratin / Hair Botox) show their card
          // but never their add-ons — they don't book through this wizard.
          // Bridal and updo bookings never take add-ons at all.
          const addons = (s.external_booking_url || BRIDAL_CATEGORIES.includes(s.category))
            ? [] : (s.addons || []);
          return `
          <div class="option-card-wrap" data-service-id="${s.id}">
            <button type="button" class="option-card${s.external_booking_url ? ' external' : ''}" data-service-id="${s.id}">
              <span class="option-card-body">
                <span class="option-card-title">${localName(s, 'name')}</span>
                <span class="option-card-meta">
                  <span class="option-card-dur">${s.duration_minutes} min</span>
                  <span class="option-card-price">${priceLabel(s)}</span>
                  ${addons.length ? `<span class="option-card-addcount">${lang() === 'no'
                    ? 'Trykk for \u00e5 velge dine tillegg'
                    : 'Tap to choose your add-ons'}</span>` : ''}
                </span>
              </span>
              <span class="option-card-check"><i class="fa-solid fa-${s.external_booking_url ? 'arrow-up-right-from-square' : 'check'}"></i></span>
            </button>
            ${addons.length ? `
            <div class="option-card-combos">
              <span class="option-card-combos-label">${lang() === 'no'
                ? 'Velg tillegg \u2014 valgfritt'
                : 'Choose your add-ons - optional'}</span>
              <div class="combo-chip-row">
                ${addons.map((a) => `
                  <button type="button" class="combo-chip" data-service-id="${s.id}" data-addon-id="${a.id}">
                    <span class="combo-chip-name">${lang() === 'no' && a.name_no ? a.name_no : a.name}</span>
                    <span class="combo-chip-price">${addonPriceLabel(a)}</span>
                  </button>
                `).join('')}
              </div>
            </div>` : ''}
          </div>
        `;
        }).join('')}
      </div>
    </div>
  `).join('');

  wrap.innerHTML = filterBar + groups;

  let selectedCategory = 'all';
  function applyServiceFilters() {
    const term = document.getElementById('serviceSearchInput').value.toLowerCase().trim();
    wrap.querySelectorAll('.category-group').forEach((group) => {
      const categoryMatches = selectedCategory === 'all' || group.dataset.category === selectedCategory;
      let anyVisible = false;
      group.querySelectorAll('.option-card-wrap').forEach((cardWrap) => {
        const title = cardWrap.querySelector('.option-card-title').textContent.toLowerCase();
        const visible = categoryMatches && (!term || title.includes(term));
        cardWrap.style.display = visible ? '' : 'none';
        if (visible) anyVisible = true;
      });
      group.style.display = anyVisible ? '' : 'none';
    });
  }
  document.getElementById('serviceSearchInput').addEventListener('input', applyServiceFilters);

  wrap.querySelectorAll('.combo-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const svc = state.services.find((s) => s.id === chip.dataset.serviceId);
      const wasActive = chip.classList.contains('active');
      if (state.service !== svc) selectService(svc); // resets chips for the new service
      chip.classList.toggle('active', !wasActive);

      // Alternatives, not extras: turning on one member of an exclusive group
      // turns the others off, so a client can't end up with both extensions
      // tiers on the same booking.
      const offered = svc.addons || [];
      const picked = offered.find((a) => String(a.id) === chip.dataset.addonId);
      if (picked && picked.exclusive_group && !wasActive) {
        offered.forEach((a) => {
          if (a === picked || a.exclusive_group !== picked.exclusive_group) return;
          const other = document.querySelector(`.combo-chip[data-service-id="${svc.id}"][data-addon-id="${a.id}"]`);
          if (other) other.classList.remove('active');
        });
      }

      state.addons = Array.from(
        document.querySelectorAll(`.combo-chip[data-service-id="${svc.id}"].active`)
      ).map((c) => offered.find((a) => String(a.id) === c.dataset.addonId)).filter(Boolean);
      renderConsultationNotice(svc); // an extensions add-on raises the notice too
      updateStickyBar(); // duration and total both move with the add-ons
    });
  });

  // Custom category dropdown — native <select> popups can't be themed (that
  // menu is rendered by the OS, not the page), so this is a real styled
  // button + menu instead.
  // Two controls, one choice. On a wide screen a row of tabs shows every
  // category at once, so a client can see the salon does bridal work without
  // going looking for it. On a phone that row would scroll off the side and
  // hide most of itself, so it becomes a dropdown instead — with the same
  // circular category photos inside it. CSS shows one and hides the other;
  // both drive the same state, so whichever the client used, the other agrees.
  const tabs = document.getElementById('categoryTabs');
  const dropdown = document.getElementById('categoryDropdown');
  const trigger = document.getElementById('categoryDropdownTrigger');
  const menu = document.getElementById('categoryDropdownMenu');

  function setCategory(value, label) {
    selectedCategory = value;
    tabs.querySelectorAll('.category-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.value === value);
    });
    menu.querySelectorAll('.custom-select-option').forEach((o) => {
      o.classList.toggle('active', o.dataset.value === value);
    });
    document.getElementById('categoryDropdownLabel').textContent = label;
    applyServiceFilters();
  }

  tabs.querySelectorAll('.category-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      setCategory(tab.dataset.value, tab.textContent.trim());
      // Keep the chosen tab on screen when the row scrolls sideways.
      tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
  });

  // Native <select> popups can't be themed — that menu is drawn by the OS, not
  // the page — so this is a real styled button and menu.
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  menu.querySelectorAll('.custom-select-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      setCategory(opt.dataset.value, opt.textContent.trim());
      dropdown.classList.remove('open');
    });
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
  });

  wrap.querySelectorAll('.option-card').forEach((card) => {
    card.addEventListener('click', () => {
      const svc = state.services.find((s) => s.id === card.dataset.serviceId);
      selectService(svc);
    });
  });
}

function selectService(svc) {
  state.service = svc;
  state.addons = [];
  if (BRIDAL_CATEGORIES.includes(svc.category)) svc.addons = [];
  document.querySelectorAll('#serviceGroups .option-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.serviceId === svc.id);
  });
  document.querySelectorAll('#serviceGroups .option-card-wrap').forEach((w) => {
    w.classList.toggle('selected', w.dataset.serviceId === svc.id);
  });
  document.querySelectorAll('#serviceGroups .combo-chip').forEach((chip) => {
    if (chip.dataset.serviceId !== svc.id) chip.classList.remove('active');
  });
  renderExternalNotice(svc);
  renderConsultationNotice(svc);
  updateStickyBar();
  // An externally booked service has no stylist, date or slot to pick — the
  // only way forward is the hand-off link in its notice.
  document.getElementById('next1').disabled = !!svc.external_booking_url;
}

// Keratin Treatment and Hair Botox are still services the studio offers, but
// Taniya takes those bookings herself over Instagram rather than through
// this system. Rather than hiding them (clients search for them, and they're
// on the price list), the card stays and the wizard hands off here.
function renderExternalNotice(svc) {
  const existing = document.getElementById('externalNotice');
  if (existing) existing.remove();
  if (!svc.external_booking_url) return;
  const card = document.querySelector(`#serviceGroups .option-card-wrap[data-service-id="${svc.id}"]`);
  if (!card) return;
  const label = svc.external_booking_label || (lang() === 'no' ? 'Bestill direkte' : 'Book directly');
  const el = document.createElement('div');
  el.id = 'externalNotice';
  el.className = 'extensions-notice';
  el.innerHTML = `
    <i class="fa-brands fa-instagram"></i>
    <span>${lang() === 'no'
      ? `${localName(svc, 'name')} bestilles direkte hos spesialisten vår på Instagram - ikke gjennom dette skjemaet.`
      : `${localName(svc, 'name')} is booked directly with our specialist on Instagram, not through this form.`}
      <a class="extensions-notice-link" href="${svc.external_booking_url}" target="_blank" rel="noopener noreferrer">${label} ↗</a>
    </span>
  `;
  card.insertAdjacentElement('afterend', el);
}

// Extensions can't be confirmed on the spot: the salon has to check the
// client came in for a consultation, paid the deposit, and had their
// extensions ordered. Said in the same words wherever it appears.
const PENDING_COPY = {
  en: {
    lead: 'This is a request, not a confirmed booking.',
    body: "We'll message you to confirm once we've checked you've had your consultation, paid your deposit, and that your extensions have been ordered. Your time isn't held until then.",
  },
  no: {
    lead: 'Dette er en foresp\u00f8rsel, ikke en bekreftet time.',
    body: 'Vi sender deg en melding for \u00e5 bekrefte n\u00e5r vi har sjekket at du har v\u00e6rt p\u00e5 konsultasjon, betalt depositum, og at extensions er bestilt. Tiden er ikke reservert f\u00f8r da.',
  },
};
function pendingCopy() { return PENDING_COPY[lang() === 'no' ? 'no' : 'en']; }
function pendingNoticeHtml() {
  const c = pendingCopy();
  return `<i class="fa-solid fa-circle-exclamation"></i><span><strong>${c.lead}</strong> ${c.body}</span>`;
}

// Extensions need confirming whether they're the service or an add-on on a
// colour, so both paths ask the same question.
function needsConfirmation(svc) {
  if (svc && svc.requiresConsultation) return true;
  return (state.addons || []).some((a) => a.requires_confirmation || a.exclusive_group === 'extensions');
}

// What the hair actually is. Clients comparing prices between salons have no
// way to tell double-drawn Remy from the cheap alternative, and the difference
// is most of why the price is what it is — so it is said plainly at the moment
// they are looking at the price, not buried on another page.
const EXTENSIONS_QUALITY = {
  en: 'Our extensions are made from <strong>100% premium Remy human hair</strong>, carefully selected '
    + 'to ensure the highest quality. Each piece is <strong>double drawn</strong>, meaning the thickness '
    + 'is consistent from the top all the way to the ends - no thin, wispy tips. This gives you a '
    + 'fuller, more luxurious look that blends seamlessly with your natural hair. Because it is Remy '
    + 'hair, the cuticles remain intact and aligned, so it stays smooth, shiny and tangle-free with '
    + 'the right care.',
  no: 'Extensionsene våre er laget av <strong>100 % premium Remy ekte hår</strong>, nøye utvalgt for å '
    + 'sikre høyeste kvalitet. Hver bunt er <strong>double drawn</strong>, som betyr at tykkelsen er den '
    + 'samme fra topp til tupp - ingen tynne, spinkle ender. Det gir et fyldigere og mer luksuriøst '
    + 'resultat som smelter sømløst sammen med ditt eget hår. Fordi det er Remy-hår ligger hårstråenes '
    + 'ytterste lag intakt og i samme retning, så håret holder seg glatt, blankt og floke-fritt med '
    + 'riktig pleie.',
};

function isExtensionsService(svc) {
  return !!svc && (svc.category === 'Hair Extensions'
    || (state.addons || []).some((a) => a.exclusive_group === 'extensions'));
}

function renderExtensionsQuality(svc) {
  const existing = document.getElementById('extensionsQuality');
  if (existing) existing.remove();
  if (!isExtensionsService(svc)) return;
  const card = document.querySelector(`#serviceGroups .option-card-wrap[data-service-id="${svc.id}"]`);
  if (!card) return;
  const el = document.createElement('div');
  el.id = 'extensionsQuality';
  el.className = 'notice-quality';
  el.innerHTML = `<i class="fa-solid fa-certificate"></i><span>${EXTENSIONS_QUALITY[lang() === 'no' ? 'no' : 'en']}</span>`;
  card.insertAdjacentElement('afterend', el);
}

function renderConsultationNotice(svc) {
  let notice = document.getElementById('extensionsNotice');
  if (notice) notice.remove();
  renderExtensionsQuality(svc);
  if (!needsConfirmation(svc)) return;
  const card = document.querySelector(`#serviceGroups .option-card-wrap[data-service-id="${svc.id}"]`);
  if (!card) return;
  const c = pendingCopy();
  const el = document.createElement('div');
  el.id = 'extensionsNotice';
  el.className = 'notice-pending';
  el.innerHTML = `
    <i class="fa-solid fa-circle-exclamation"></i>
    <span><strong>${c.lead}</strong> ${c.body}
      <button type="button" class="extensions-notice-link" id="switchToConsultation">${lang() === 'no' ? 'Ikke vært på konsultasjon ennå? Bestill en' : "Haven't had your consultation yet? Book one"}</button>
    </span>
  `;
  card.insertAdjacentElement('afterend', el);
  document.getElementById('switchToConsultation').addEventListener('click', () => {
    const consultation = state.services.find((x) => x.consultationRule)
      || state.services.find((x) => /consultation/i.test(x.name || ''));
    if (!consultation) return;
    selectService(consultation);
    const card = document.querySelector(`#serviceGroups .option-card-wrap[data-service-id="${consultation.id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ── STEP 2: STAFF ──
async function loadStaffForService() {
  const grid = document.getElementById('staffGrid');
  grid.innerHTML = '<p style="text-align:center;color:var(--greige);">Loading stylists…</p>';
  let staffList;
  try {
    const { data, error } = await fetchStaffForService(state.service.id);
    if (error) throw error;
    staffList = (data || []).map((row) => row.staff).filter(Boolean);
    if (!staffList.length) throw new Error('no staff for service');
  } catch (e) {
    // Supabase unreachable — preview mode, using each service's real staff assignment.
    const allowed = state.service.staff;
    staffList = allowed ? FALLBACK_STAFF.filter((s) => allowed.includes(s.id)) : FALLBACK_STAFF;
  }

  // Some add-ons are a service in disguise and carry that service's staffing:
  // extensions are Hassan's, so choosing them narrows the list rather than
  // letting a client pick a stylist who'd then be refused at the last step.
  state.addons.forEach((a) => {
    if (!a.requiresStaff) return;
    staffList = staffList.filter((st) => a.requiresStaff.includes(st.id));
  });

  state.staffOptions = staffList;
  // Clients always choose their own stylist — no "no preference" shortcut,
  // since that used to silently default to whichever stylist sorted first
  // without actually checking who was free.
  const narrowedBy = state.addons.filter((a) => a.requiresStaff);
  if (narrowedBy.length) {
    const names = narrowedBy.map((a) => localName(a, 'name')).join(', ');
    grid.innerHTML = `<p class="staff-narrowed">${lang() === 'no'
      ? `${names} utf\u00f8res kun av stylisten under.`
      : `${names} is only done by the stylist below.`}</p>`;
  } else {
    grid.innerHTML = '';
  }

  grid.innerHTML += staffList.map((st) => `
    <button type="button" class="option-card" data-staff-id="${st.id}">
      <span class="option-card-img">${imgOrFallback(st.photo_url)}</span>
      <span class="option-card-body">
        <span class="option-card-title">${st.name}</span>
        <span class="option-card-meta"><span class="option-card-dur">${localName(st, 'role')}</span></span>
      </span>
      <span class="option-card-check"><i class="fa-solid fa-check"></i></span>
    </button>
  `).join('');
  grid.querySelectorAll('.option-card').forEach((card) => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.option-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      state.staff = staffList.find((s) => s.id === card.dataset.staffId) || null;
      document.getElementById('next2').disabled = !state.staff;
      // Availability is per stylist, so anything already marked is now stale.
      calendarAvailability = {};
      calendarUserNavigated = false;
    });
  });
}

// ── STEP 3: DATE & TIME ──
function parseTime(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}
function formatTime(mins) {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function toPgTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

// ── CALENDAR WIDGET (replaces the native <input type="date">) ──
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_NO = ['Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Desember'];
const today = new Date();
today.setHours(0, 0, 0, 0);
// A rolling window: "today + N days", never a fixed end date, so it advances
// on its own and there is nothing to renew. The real N comes from the owner's
// setting below; 60 is only the value used until that request lands (and if
// it never does, in preview mode). book_appointment enforces the same limit,
// so this just decides which dates get drawn.
const DEFAULT_BOOKING_HORIZON_DAYS = 60;
let maxBookableDate = new Date(today);
maxBookableDate.setDate(maxBookableDate.getDate() + DEFAULT_BOOKING_HORIZON_DAYS);
let calendarViewYear = today.getFullYear();
let calendarViewMonth = today.getMonth();
let calendarBusinessHours = FALLBACK_BUSINESS_HOURS;

async function initDateInput() {
  document.getElementById('calPrev').addEventListener('click', () => shiftCalendarMonth(-1));
  document.getElementById('calNext').addEventListener('click', () => shiftCalendarMonth(1));
  renderCalendar();
  try {
    const { data, error } = await fetchBusinessHours();
    if (error || !data || !data.length) throw error || new Error('no hours');
    calendarBusinessHours = data;
  } catch (e) {
    calendarBusinessHours = FALLBACK_BUSINESS_HOURS; // Supabase unreachable - preview mode
  }
  try {
    const { data, error } = await fetchBookingHorizonDays();
    const days = Number(data);
    if (!error && Number.isFinite(days) && days > 0) {
      maxBookableDate = new Date(today);
      maxBookableDate.setDate(maxBookableDate.getDate() + days);
    }
  } catch (e) {
    // Keep the default rather than opening the calendar wider than the
    // server will actually accept.
  }
  renderCalendar();
}

// ── MONTH AVAILABILITY ──
// dateIso -> true when that day still has at least one open slot. Only ever
// holds the month currently on screen, and is recomputed whenever the month,
// the stylist, the service or the chosen add-ons change — all four move the
// answer, the last because add-ons can lengthen the appointment.
let calendarAvailability = {};
let calendarReason = {};  // dateIso -> 'full' | 'unavailable', for the label
let calendarAvailabilityKey = '';  // guards against a slow request overwriting a newer one
let calendarUserNavigated = false; // set the moment the client uses the arrows

function monthBoundsForView() {
  const first = new Date(calendarViewYear, calendarViewMonth, 1);
  const last = new Date(calendarViewYear, calendarViewMonth + 1, 0);
  return { first, last, from: toLocalISO(first), to: toLocalISO(last) };
}

// A day counts as bookable if it's in range, not closed, and has a slot left.
function anyBookableDayInView() {
  const { last } = monthBoundsForView();
  for (let d = 1; d <= last.getDate(); d++) {
    const cellDate = new Date(calendarViewYear, calendarViewMonth, d);
    if (cellDate < today || cellDate > maxBookableDate) continue;
    if (calendarAvailability[toLocalISO(cellDate)]) return true;
  }
  return false;
}

async function loadCalendarAvailability({ allowAutoAdvance = false, hops = 0 } = {}) {
  // Before a stylist and service are picked there's nothing to compute
  // against — leave every open day selectable rather than guessing.
  if (!state.staff || !state.service) {
    calendarAvailability = {};
    calendarReason = {};
    renderCalendar();
    return;
  }

  const { last, from, to } = monthBoundsForView();
  const key = [state.staff.id, state.service.id, state.addons.map((a) => a.id).join('+'), from].join('|');
  calendarAvailabilityKey = key;

  let blocked = [];
  let busy = [];
  try {
    const [bRes, buRes] = await Promise.all([
      fetchBlockedSlotsRange(from, to).catch(() => ({ error: true })),
      fetchBusySlotsRange(state.staff.id, from, to).catch(() => ({ error: true })),
    ]);
    // fetchBlockedSlotsRange isn't staff-scoped (schedule.html wants every
    // stylist's blocks), so narrow it here: this stylist's own time off, plus
    // whole-salon closures, which carry a null staff_id.
    if (!bRes.error && bRes.data) {
      blocked = bRes.data.filter((b) => !b.staff_id || b.staff_id === state.staff.id);
    }
    if (!buRes.error && buRes.data) busy = buRes.data;
  } catch (e) {
    // Supabase unreachable — preview mode. Nothing is known to be taken, so
    // no day gets marked full. Better to under-mark than to invent one.
    blocked = [];
    busy = [];
  }

  // A newer month/stylist/service was requested while this was in flight.
  if (calendarAvailabilityKey !== key) return;

  const blockedBy = {};
  const busyBy = {};
  blocked.forEach((b) => { (blockedBy[b.date] = blockedBy[b.date] || []).push(b); });
  busy.forEach((b) => { (busyBy[b.date] = busyBy[b.date] || []).push(b); });

  const map = {};
  for (let d = 1; d <= last.getDate(); d++) {
    const iso = toLocalISO(new Date(calendarViewYear, calendarViewMonth, d));
    const { slots, reason } = computeSlotsFor(iso, calendarBusinessHours, blockedBy[iso], busyBy[iso]);
    // false = nothing left, and calendarReason says whether that's a sell-out
    // or time off, so the day can be labelled honestly.
    map[iso] = slots.length > 0;
    calendarReason[iso] = slots.length ? null : reason;
  }
  calendarAvailability = map;

  // Availability arrives after the calendar is already interactive, so a
  // client can pick a day and see its times before this lands. If the day
  // they picked turns out to be full, take the selection and the times away
  // again — otherwise the calendar says "fully booked" while the slots
  // underneath still invite a booking the server would only reject at the
  // very end.
  if (state.date && map[state.date] === false) {
    state.date = null;
    state.startTime = null;
    document.getElementById('next3').disabled = true;
    const slotGrid = document.getElementById('slotGrid');
    if (slotGrid) {
      slotGrid.innerHTML = '<p class="slot-empty" data-en="That day just filled up - please pick another date." data-no="Den dagen ble nettopp fullbooket - velg en annen dato.">That day just filled up - please pick another date.</p>';
    }
  }

  renderCalendar();

  // Nothing left in this month: move on rather than making the client find
  // that out a tap at a time. Only on arrival at the step, and never once
  // they've used the arrows themselves — deliberately going back to a full
  // month should show it as full, not bounce them forward again. Capped at
  // two hops so a quiet stretch can't run the calendar off into next year.
  const viewingMaxMonth = calendarViewYear === maxBookableDate.getFullYear()
    && calendarViewMonth === maxBookableDate.getMonth();
  if (allowAutoAdvance && !calendarUserNavigated && hops < 2 && !viewingMaxMonth && !anyBookableDayInView()) {
    stepCalendarMonth(1);
    await loadCalendarAvailability({ allowAutoAdvance: true, hops: hops + 1 });
  }
}

// Month arithmetic on its own, so the auto-advance above can reuse it without
// being mistaken for the client having navigated.
function stepCalendarMonth(delta) {
  calendarViewMonth += delta;
  if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear--; }
  if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear++; }
}

function shiftCalendarMonth(delta) {
  calendarUserNavigated = true;
  stepCalendarMonth(delta);
  renderCalendar();
  loadCalendarAvailability();
}

function renderCalendar() {
  const label = document.getElementById('calMonthLabel');
  const names = lang() === 'no' ? MONTH_NAMES_NO : MONTH_NAMES;
  label.textContent = `${names[calendarViewMonth]} ${calendarViewYear}`;

  const viewingCurrentMonth = calendarViewYear === today.getFullYear() && calendarViewMonth === today.getMonth();
  const viewingMaxMonth = calendarViewYear === maxBookableDate.getFullYear() && calendarViewMonth === maxBookableDate.getMonth();
  document.getElementById('calPrev').disabled = viewingCurrentMonth;
  document.getElementById('calNext').disabled = viewingMaxMonth;

  const firstOfMonth = new Date(calendarViewYear, calendarViewMonth, 1);
  const daysInMonth = new Date(calendarViewYear, calendarViewMonth + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // Monday-first grid

  const grid = document.getElementById('calendarGrid');
  const no = lang() === 'no';
  const labelFor = (iso) => (calendarReason[iso] === 'unavailable'
    ? (no ? 'Stengt - vi er borte' : 'Closed - we are away')
    : (no ? 'Fullbooket' : 'Fully booked'));
  let cells = '';
  for (let i = 0; i < leadingBlanks; i++) cells += '<span class="calendar-day calendar-day-blank"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(calendarViewYear, calendarViewMonth, d);
    const iso = toLocalISO(cellDate);
    const dayHours = calendarBusinessHours.find((h) => h.weekday === cellDate.getDay());
    const closed = !dayHours || dayHours.closed;
    const outOfRange = cellDate < today || cellDate > maxBookableDate || closed;
    // Distinct from out-of-range on purpose: a closed Sunday is simply not a
    // working day, whereas a full day is one the salon works and has sold
    // out. Only the second gets the mark.
    const full = !outOfRange && calendarAvailability[iso] === false;
    const selected = state.date === iso;
    cells += `<button type="button" class="calendar-day${selected ? ' selected' : ''}${full ? ' calendar-day-full' : ''}"`
      + ` data-date="${iso}"${outOfRange || full ? ' disabled' : ''}`
      + (full ? ` title="${labelFor(iso)}" aria-label="${d} - ${labelFor(iso)}"` : '')
      + `>${d}</button>`;
  }
  grid.innerHTML = cells;

  grid.querySelectorAll('.calendar-day:not(.calendar-day-blank)').forEach((cell) => {
    cell.addEventListener('click', () => {
      grid.querySelectorAll('.calendar-day').forEach((c) => c.classList.remove('selected'));
      cell.classList.add('selected');
      state.date = cell.dataset.date;
      state.startTime = null;
      document.getElementById('next3').disabled = true;
      generateSlots();
    });
  });
}

// ── SHARED AVAILABILITY MATH ──
// The slot grid and the calendar must agree exactly: a day the calendar shows
// as open has to produce at least one slot when it's tapped, and a day it
// marks fully booked has to produce none. Both call this, so the two can't
// drift apart as the booking rules change.
//
// `blocked` and `busy` are the ranges for this one date. Returns the open
// start times in minutes, and — when there are none — why.
// The free stretches inside a window, once what's already booked is taken out.
// Returns [start, end] pairs in order.
function freeIntervals(windowStart, windowEnd, ranges) {
  const inside = (ranges || [])
    .map(([a, z]) => [Math.max(a, windowStart), Math.min(z, windowEnd)])
    .filter(([a, z]) => z > a)
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  let cursor = windowStart;
  inside.forEach(([a, z]) => {
    if (a > cursor) out.push([cursor, a]);
    cursor = Math.max(cursor, z);
  });
  if (cursor < windowEnd) out.push([cursor, windowEnd]);
  return out;
}

// Slots inside a window, without leaving crumbs.
//
// Within each free stretch, appointments chain back-to-back from where the
// stretch begins, plus one that finishes flush against where it ends. That
// second one matters: chaining alone would leave a tail nobody can use when
// the stretch isn't an exact multiple of the service, and offering every
// fifteen minutes instead would strand quarter-hours all over the day.
//
// Chaining from each free stretch rather than from the window as a whole is
// what keeps the day tight as it fills: book 12:00-13:30 and the next offer is
// 13:30, not 14:00.
//
// The flush start may begin BEFORE the window opens, as long as the salon is
// open: a two-hour colour finishing at 15:00 has to start at 13:00, and
// refusing it because the window nominally opens at 13:30 would mean that
// service simply can't be booked.
function windowSlots(windowStart, windowEnd, duration, earliestAllowed, ranges) {
  const out = [];
  freeIntervals(windowStart, windowEnd, ranges).forEach(([a, z]) => {
    for (let t = a; t + duration <= z; t += duration) out.push(t);
    const flush = z - duration;
    if (flush >= a && !out.includes(flush)) out.push(flush);
  });
  const wide = windowEnd - duration;
  if (wide < windowStart && wide >= earliestAllowed && !out.includes(wide)) out.push(wide);
  return out.sort((a, b) => a - b);
}

function computeSlotsFor(dateIso, hours, blocked, busy, staffOverride) {
  const svc = state.service;
  const staff = staffOverride || state.staff;
  if (!svc || !staff) return { slots: [], reason: 'unknown' };

  const weekday = new Date(dateIso + 'T00:00:00').getDay();
  const dayHours = (hours || []).find((h) => h.weekday === weekday);
  if (!dayHours || dayHours.closed || !dayHours.open_time || !dayHours.close_time) {
    return { slots: [], reason: 'closed' };
  }

  let open = parseTime(dayHours.open_time);
  const staffCloseOverride = getStaffCloseOverride(staff.id, weekday);
  let close = staffCloseOverride ? parseTime(staffCloseOverride) : parseTime(dayHours.close_time);

  // Bookings of the four-hour colour family already on this day, and where
  // the first one starts — both the caps and the working hours hang off it.
  // Bridal counts here too: it is four hours of her day exactly as a colour
  // is, so Mon/Wed/Fri hold one four-hour appointment, not one colour plus a
  // bride.
  const limitedIds = new Set(
    (state.services || [])
      .filter((x) => x.balayageSchedule || x.category === 'Bridal')
      .map((x) => String(x.id)),
  );
  const limitedToday = (busy || []).filter((b) => limitedIds.has(String(b.service_id)));
  const otherToday = (busy || []).filter((b) => b.service_id && !limitedIds.has(String(b.service_id)));
  const colourStart = limitedToday.length
    ? Math.min(...limitedToday.map((b) => parseTime(b.start_time)))
    : null;

  // Bridal is four hours at a fixed 11:00 — the same shape as a colour, not
  // the shape of short work. So it sits outside the day policy entirely: it
  // isn't held back by a colour-only day, doesn't wait for the hour her
  // shorter work starts, and isn't built from her windows. Booking one still
  // rules out the 11:00 colour, because the block simply overlaps it.
  const isBridalService = svc.category === 'Bridal';

  const blockedRanges = (blocked || []).map((b) => [parseTime(b.start_time), parseTime(b.end_time)]);
  const busyRanges = (busy || []).map((b) => [parseTime(b.start_time), parseTime(b.end_time)]);
  const allRanges = blockedRanges.concat(busyRanges);

  // Every protection on her day — short work not starting until 12:00, the
  // finish-by-15:00 rule, the cap — exists for one purpose: keep a four-hour
  // colour start alive. Each of them costs bookable hours, and that price is
  // only worth paying while a colour can still actually happen.
  //
  // Once every colour start is blocked, they are guarding an empty room. A
  // 12:00 booking rules out the 11:00 colour and a 16:00 booking rules out
  // the 15:00 one; hold the rules after that and the whole middle of the day
  // is unsellable for nothing. So when no colour can start any more, the
  // protections drop and her day opens end to end, packed against whatever
  // is already booked.
  const noColourPossible = colourStart == null
    && !getBalayageTimes(staff.id, weekday).map(parseTime).some(
      (t) => !allRanges.some(([bs, be]) => t < be && (t + BALAYAGE_DURATION) > bs),
    );

  const daysAhead = Math.round(
    (new Date(dateIso + 'T00:00:00') - new Date(toLocalISO(new Date()) + 'T00:00:00')) / 86400000,
  );

  const policy = getDayPolicy(staff.id, weekday);
  // ...and the hold has a deadline as well as a condition. A colour that
  // hasn't booked by the day before isn't coming, and every hour still being
  // held for it is an hour that now can't be sold to anybody. So the hold
  // lapses on its own and the day opens, colour still bookable if one does
  // turn up.
  const colourHoldOver = noColourPossible
    || (policy && policy.colourHoldDays != null && colourStart == null
        && daysAhead <= policy.colourHoldDays);
  if (policy) {
    if (policy.open) open = parseTime(policy.open);
    if (policy.close) close = parseTime(policy.close);

    if (svc.balayageSchedule || isBridalService) {
      if (policy.maxLimited != null && limitedToday.length >= policy.maxLimited) {
        return { slots: [], reason: 'colour-taken' };
      }
    } else {
      // Colours only, until the date is close enough that the colour probably
      // isn't coming — from then on the day is an ordinary mixed one and
      // everything below applies unchanged.
      if (!policy.allowOther) {
        if (policy.lateFillDays == null || daysAhead > policy.lateFillDays) {
          return { slots: [], reason: 'colour-only-day' };
        }
      }
      if (policy.maxOther != null && !colourHoldOver && otherToday.length >= policy.maxOther) {
        return { slots: [], reason: 'others-full' };
      }
    }

    // Her hours shift with the colour: early colour extends the finish, late
    // colour delays the start.
    if (colourStart != null) {
      if (colourStart <= open && policy.closeAfterEarly) close = parseTime(policy.closeAfterEarly);
      else if (colourStart > open && policy.openBeforeLate) open = parseTime(policy.openBeforeLate);
    } else if (!svc.balayageSchedule && !isBridalService && policy.otherOpen
               && !colourHoldOver) {
      // A colour can still happen today, so the day has to leave room for one.
      open = parseTime(policy.otherOpen);
    }
  }
  const duration = effectiveDuration();

  const now = new Date();
  const isToday = toLocalISO(now) === dateIso;
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // Consultation is capped at 2 bookings per stylist per day.
  if (svc.consultationRule) {
    const existing = busyRanges.filter(([s, e]) => (e - s) === CONSULTATION_DURATION).length;
    if (existing >= CONSULTATION_DAILY_CAP) return { slots: [], reason: 'consultation-cap' };
  }

  // Some services (haircuts/toner/colour touch-ups) only run at two fixed
  // times a day instead of the usual 15-min grid; the 4-hour lightening
  // services have fixed times that vary per stylist and weekday (see
  // getBalayageTimes) rather than a flat list. Fixed times are owner-curated
  // on purpose, so — unlike the dynamic grid below — they're not required to
  // finish before closing: a 15:00 balayage (240min) legitimately runs until
  // 19:00 even though the salon stops taking new arrivals at 17:30.
  // Consultation uses the normal dynamic grid too, but 17:00 caps its latest
  // START time (not "must finish by", as the close time means for the rest).
  // A shorter service on an as-yet-uncoloured day must finish by the split or
  // start after it, so one colour start survives whichever side it lands.
  const splitAt = (policy && policy.otherSplitAt && colourStart == null && !colourHoldOver
                   && !svc.balayageSchedule && !isBridalService)
    ? parseTime(policy.otherSplitAt)
    : null;

  // ...and once one shorter booking exists, every later one must stay on the
  // SAME side of the split.
  //
  // One short booking always leaves a colour start alive — before the split
  // leaves the afternoon colour, after it leaves the morning one. Two on
  // opposite sides leave none, and the day ends up with no four-hour start and
  // several unsellable hours between the two small bookings. So the first
  // booking of the day chooses the side and the rest follow it.
  //
  // Both halves stay sellable, and a colour always survives, whichever way the
  // day happens to go.
  //
  // Consultations don't count — they nest inside other bookings rather than
  // taking a slot of their own. Bridal doesn't either: it is four hours and is
  // counted with the colours.
  const consultationIds = new Set(
    (state.services || []).filter((x) => x.consultationRule).map((x) => String(x.id)),
  );
  let sideLock = null;
  if (splitAt != null) {
    for (const b of otherToday) {
      if (consultationIds.has(String(b.service_id))) continue;
      if (parseTime(b.end_time) <= splitAt) { sideLock = 'early'; break; }
      if (parseTime(b.start_time) >= splitAt) { sideLock = 'late'; break; }
    }
  }

  const staffFixed = getStaffFixedTimes(svc, staff.id, weekday);

  // Hassan's two slots leave gaps once his morning is partly booked: an 11:00
  // updo runs to 12:30, and a 13:00-only rule would waste 12:30-13:00 and
  // 14:00-15:00. So when a NON-colour booking already ends inside the morning,
  // everything up to the colour boundary opens to the normal grid, and 16:30
  // stays as it was. A colour booked at 11:00 is deliberately excluded: its
  // 13:00 is the overlap pairing, and replacing that with a grid would offer
  // times that sit inside the colour.
  let gapFilled = null;
  if (staffFixed === HASSAN_SLOT_TIMES) {
    const boundary = parseTime(GAP_FILL_BOUNDARY);
    const morningEnd = (busy || [])
      .filter((bk) => !limitedIds.has(String(bk.service_id)))
      .map((bk) => parseTime(bk.end_time))
      .filter((e) => e > open && e <= boundary)
      .reduce((a, e) => Math.max(a, e), 0);
    if (morningEnd > 0) {
      // Once part of his morning is spoken for, the rest of it up to the
      // colour hour opens on the same crumb-free chain — and because it takes
      // the existing bookings into account, it keeps chaining as the day
      // fills. His slots at or after the colour hour are untouched.
      gapFilled = windowSlots(morningEnd, boundary, duration, open, allRanges);
      staffFixed.forEach((ft) => {
        const t = parseTime(ft);
        if (t >= boundary) gapFilled.push(t);
      });
      gapFilled.sort((a, b) => a - b);
    }
  }

  // On a policy day the shorter services are shaped by her windows, so build
  // them the same crumb-free way rather than stepping a grid through them.
  let policyWindows = null;
  if (policy && !svc.balayageSchedule && !svc.consultationRule && !isBridalService) {
    const dayOpen = parseTime(dayHours.open_time);
    policyWindows = splitAt != null
      ? (sideLock === 'late' ? [] : windowSlots(open, splitAt, duration, dayOpen, allRanges))
        .concat(sideLock === 'early' ? [] : windowSlots(splitAt, close, duration, dayOpen, allRanges))
      : windowSlots(open, close, duration, dayOpen, allRanges);
  }

  const candidates = svc.balayageSchedule
    ? getBalayageTimes(staff.id, weekday).map(parseTime).filter((t) => t >= open)
    : policyWindows
      ? policyWindows
      : gapFilled
        ? gapFilled
        : staffFixed
          ? staffFixed.map(parseTime).filter((t) => t >= open)
          : svc.consultationRule
            ? (() => { const arr = []; const latest = parseTime(CONSULTATION_LATEST_START); for (let t = open; t <= latest; t += 15) arr.push(t); return arr; })()
            : (() => { const arr = []; for (let t = open; t + duration <= close; t += 15) arr.push(t); return arr; })();

  // A stylist with allow_overlap_booking can take a second, non-bridal client
  // at 13:00/16:30 while their own 11:00/15:00 lightening appointment
  // (240min) processes unattended — that specific pairing is exempt from the
  // overlap check below. A consultation can nest inside ANY other booking's
  // block; it just can't share that booking's exact start time (guaranteed by
  // the slot UI itself, since two bookings can't be picked at the same
  // minute).
  const overlapEligible = !!staff.allow_overlap_booking
    && !svc.balayageSchedule
    && !BRIDAL_CATEGORIES.includes(svc.category);

  const slots = candidates.filter((t) => {
    if (isToday && t <= nowMins) return false;
    if (splitAt != null && t < splitAt && (t + duration) > splitAt) return false;
    return !allRanges.some(([s, e]) => {
      if (!(t < e && (t + duration) > s)) return false; // no overlap, not a conflict anyway
      if (svc.consultationRule && s !== t) return false; // exempt - just can't share the exact start minute
      if (overlapEligible && (e - s) === BALAYAGE_DURATION && OVERLAP_ANCHORS[s] === t) return false; // exempt pairing
      return true;
    });
  });

  // Offer her day three times at a time rather than laying the whole thing out
  // at once. Clients pick the first time that suits them, so a long list
  // scatters bookings across the day and leaves holes between them that nothing
  // short enough can ever fill. Three keeps the day packing, and each one taken
  // brings the next into view — nothing is withheld, it just arrives in an
  // order that doesn't strand time.
  //
  // WHICH three matters as much as how many. The three offered are the ones
  // NEAREST to work already booked, not the earliest on the clock.
  //
  // The difference is her afternoon. With a colour at 15:00 and her day open
  // from 11:00, offering 11:00, 12:00, 13:00 means a client takes 11:00, nobody
  // else books, and Kani sits in the salon from 12:00 to 15:00 with nothing to
  // do. Offering 12:00, 13:00, 14:00 packs the work against the colour, so her
  // hours stay together and she comes in later on a quiet day. Same number of
  // bookings, three hours less waiting.
  //
  // With nothing booked there is nothing to pack against, so it falls back to
  // earliest-first, which is what a client expects to see.
  //
  // Colour, bridal and consultations are left alone: the first two have two
  // curated times anyway, and a consultation nests inside other bookings, so
  // it can't strand anything.
  if (policy && slots.length > POLICY_VISIBLE_SLOTS
      && !svc.balayageSchedule && !isBridalService && !svc.consultationRule) {
    // Gap between this slot and the nearest thing already in the day. Touching
    // it is 0; an empty day leaves every slot equal and the sort stable, so
    // the earliest survive.
    const distanceToWork = (t) => {
      let best = Infinity;
      for (const [bs, be] of allRanges) {
        const gap = t >= be ? t - be : (bs >= t + duration ? bs - (t + duration) : 0);
        if (gap < best) best = gap;
      }
      return best;
    };
    const chosen = slots
      .map((t) => ({ t, d: distanceToWork(t) }))
      .sort((a, b) => (a.d - b.d) || (a.t - b.t))
      .slice(0, POLICY_VISIBLE_SLOTS)
      .map((x) => x.t)
      .sort((a, b) => a - b);
    return { slots: chosen, reason: null };
  }

  if (slots.length) return { slots, reason: null };

  // A block that swallows the whole working day is time off — a holiday, or
  // the stylist away — not a day that sold out. Distinguished by the block
  // covering business hours end to end, which is exactly what an "all day"
  // block in the Owner Panel writes (00:00–23:59).
  const closedOff = blockedRanges.some(([s, e]) => s <= open && e >= close);
  return { slots, reason: closedOff ? 'unavailable' : 'full' };
}

// ── WHEN THE CHOSEN STYLIST HAS NOTHING THAT DAY ──
// Stylists take holidays separately, so "Hassan is away that week" doesn't
// mean the salon is shut — Kani may well be in. A dead end that only says
// "fully booked" hides that, and the client either gives up or rings to ask.
//
// Two different offers, because there are two different situations. If
// another stylist is free on the very day the client picked, say so and let
// them switch in one tap. If she isn't free that day either, don't go quiet —
// give her soonest opening instead. Silence is what loses the booking.
//
// Returns one entry per other stylist: either sameDay, or the next date they
// can take, or nothing at all if we couldn't find out.
async function findAlternatives(dateIso) {
  const others = (state.staffOptions || []).filter((st) => st.id !== (state.staff && state.staff.id));
  if (!others.length) return [];

  const { last, from, to } = monthBoundsForView();

  // Blocked slots aren't staff-scoped by the API, so fetch once and split.
  let blockedRange = [];
  const bRes = await fetchBlockedSlotsRange(from, to).catch(() => ({ error: true }));
  if (!bRes.error && bRes.data) blockedRange = bRes.data;

  const results = await Promise.all(others.map(async (st) => {
    const buRes = await fetchBusySlotsRange(st.id, from, to).catch(() => ({ error: true }));
    // Claiming a stylist is free when we can't actually tell would send the
    // client somewhere that then turns out to be full. Stay quiet instead.
    if (buRes.error || !buRes.data) return null;

    const blockedBy = {};
    const busyBy = {};
    blockedRange
      .filter((b) => !b.staff_id || b.staff_id === st.id)
      .forEach((b) => { (blockedBy[b.date] = blockedBy[b.date] || []).push(b); });
    buRes.data.forEach((b) => { (busyBy[b.date] = busyBy[b.date] || []).push(b); });

    const openOn = (d) => computeSlotsFor(d, calendarBusinessHours, blockedBy[d], busyBy[d], st).slots.length > 0;

    if (openOn(dateIso)) return { staff: st, sameDay: true, nextDate: null };

    for (let d = 1; d <= last.getDate(); d++) {
      const cell = new Date(calendarViewYear, calendarViewMonth, d);
      if (cell < today || cell > maxBookableDate) continue;
      const cIso = toLocalISO(cell);
      if (cIso <= dateIso) continue;
      if (openOn(cIso)) return { staff: st, sameDay: false, nextDate: cIso };
    }
    return null;
  }));

  return results.filter(Boolean);
}

// The earliest day in the month on screen that the chosen stylist can still
// take. Uses the availability already loaded for the calendar, so it's free.
function nextOpeningForCurrentStylist(afterIso) {
  const dates = Object.keys(calendarAvailability)
    .filter((d) => calendarAvailability[d] && d > afterIso)
    .sort();
  return dates[0] || null;
}

function prettyDate(dateIso) {
  return new Date(dateIso + 'T00:00:00').toLocaleDateString(
    lang() === 'no' ? 'nb-NO' : 'en-US',
    { weekday: 'long', month: 'long', day: 'numeric' },
  );
}

function switchToStylist(staffId, dateIso) {
  const st = (state.staffOptions || []).find((x) => x.id === staffId);
  if (!st) return;
  state.staff = st;
  // Keep step 2 honest about who's now selected, so going back doesn't show a
  // different stylist ticked than the one actually being booked.
  document.querySelectorAll('#staffGrid .option-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.staffId === st.id);
  });
  if (dateIso) state.date = dateIso;
  state.startTime = null;
  document.getElementById('next3').disabled = true;
  calendarAvailability = {};
  calendarReason = {};
  renderCalendar();
  generateSlots();
  loadCalendarAvailability();
}

async function renderDeadEndHelp(grid, dateIso, opts) {
  const alts = await findAlternatives(dateIso);
  const sameDay = alts.filter((a) => a.sameDay);
  const laterOnly = alts.filter((a) => !a.sameDay && a.nextDate);
  // Suppressed when the caller has already led with it — repeating the same
  // date twice on one screen reads as a bug.
  const nextOpen = (opts && opts.skipNextOpen) ? null : nextOpeningForCurrentStylist(dateIso);
  if (!sameDay.length && !laterOnly.length && !nextOpen) return;

  const firstName = (st) => st.name.split(' ')[0];
  const no = lang() === 'no';
  const wrap = document.createElement('div');
  wrap.className = 'slot-alt';
  const bits = [];

  if (sameDay.length) {
    const names = sameDay.map((a) => firstName(a.staff)).join(no ? ' og ' : ' and ');
    bits.push(`<p class="slot-alt-lead">${no
      ? `${names} har ledig tid denne dagen.`
      : `${names} ${sameDay.length === 1 ? 'has' : 'have'} times on this day.`}</p>`);
    bits.push('<div class="slot-alt-row">' + sameDay.map((a) =>
      `<button type="button" class="slot-alt-btn" data-staff="${a.staff.id}">${no
        ? `Bestill hos ${firstName(a.staff)}`
        : `Book with ${firstName(a.staff)}`}</button>`).join('') + '</div>');
  } else if (laterOnly.length) {
    // Nobody is free on the chosen day — offer the soonest each of them has,
    // rather than leaving the client with nowhere to go.
    bits.push(`<p class="slot-alt-lead">${no
      ? 'Ingen er ledige akkurat denne dagen - men det er ledig tid snart:'
      : "Nobody's free on that exact day - but there is time soon:"}</p>`);
    bits.push('<div class="slot-alt-row">' + laterOnly.map((a) =>
      `<button type="button" class="slot-alt-btn" data-staff="${a.staff.id}" data-date="${a.nextDate}">${no
        ? `${firstName(a.staff)} - ${prettyDate(a.nextDate)}`
        : `${firstName(a.staff)} - ${prettyDate(a.nextDate)}`}</button>`).join('') + '</div>');
  }

  if (nextOpen) {
    const mine = state.staff ? firstName(state.staff) : '';
    bits.push(`<button type="button" class="slot-alt-link" data-staff="${state.staff ? state.staff.id : ''}" data-date="${nextOpen}">${no
      ? `Eller vent på ${mine} - neste ledige er ${prettyDate(nextOpen)}`
      : `Or wait for ${mine} - next opening is ${prettyDate(nextOpen)}`}</button>`);
  }

  wrap.innerHTML = bits.join('');
  grid.appendChild(wrap);

  wrap.querySelectorAll('[data-staff]').forEach((btn) => {
    btn.addEventListener('click', () => switchToStylist(btn.dataset.staff, btn.dataset.date || null));
  });
}

async function generateSlots() {
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '<p style="text-align:center;color:var(--greige);grid-column:1/-1;">Checking availability…</p>';
  if (!state.date || !state.staff || !state.service) return;

  // Each source falls back on its own. They used to share one try/catch, so a
  // failed opening-hours lookup threw away the blocked slots and bookings that
  // HAD come back — and the day would then offer times that were already
  // taken. Opening hours have a real static fallback; the other two don't, so
  // an empty list there means "nothing known", not "nothing booked".
  const [hRes, bRes, buRes] = await Promise.all([
    fetchBusinessHours().catch(() => ({ error: true })),
    fetchBlockedSlots(state.staff.id, state.date).catch(() => ({ error: true })),
    fetchBusySlots(state.staff.id, state.date).catch(() => ({ error: true })),
  ]);
  const hours = (!hRes.error && hRes.data && hRes.data.length) ? hRes.data : FALLBACK_BUSINESS_HOURS;
  const blocked = (!bRes.error && bRes.data) ? bRes.data : [];
  const busy = (!buRes.error && buRes.data) ? buRes.data : [];

  const { slots, reason } = computeSlotsFor(state.date, hours, blocked, busy);

  if (reason === 'closed') {
    grid.innerHTML = '<p class="slot-empty" data-en="Closed on this day - please pick another date." data-no="Stengt denne dagen - velg en annen dato.">Closed on this day - please pick another date.</p>';
    return;
  }
  if (reason === 'colour-only-day') {
    const who = state.staff ? state.staff.name.split(' ')[0] : '';
    const no = lang() === 'no';
    // This day isn't sold out — it's reserved. So the useful answer is the
    // soonest day she CAN take this, offered as the headline rather than as a
    // consolation at the bottom of a list of other stylists.
    const next = nextOpeningForCurrentStylist(state.date);
    grid.innerHTML = `<p class="slot-empty">${no
      ? `${who} tar kun lange fargetimer denne dagen.`
      : `${who} only takes long colour appointments on this day.`}</p>`
      // Her name goes on the button. Without it the client cannot tell that
      // this option keeps her with Kani, so the screen reads as one dead end
      // and one alternative rather than as the two real choices it is: wait a
      // day for Kani, or come in on this day with Hassan.
      + (next
        ? `<button type="button" class="slot-alt-primary" id="colourOnlyJump">${no
            ? `Bestill hos <strong>${who}</strong> - første ledige dag er <strong>${prettyDate(next)}</strong>`
            : `Book with <strong>${who}</strong> - her earliest day is <strong>${prettyDate(next)}</strong>`}</button>`
        : '');
    const jump = document.getElementById('colourOnlyJump');
    if (jump) {
      jump.addEventListener('click', () => switchToStylist(state.staff ? state.staff.id : '', next));
    }
    // The nextOpen line is already the headline above, so don't repeat it.
    await renderDeadEndHelp(grid, state.date, { skipNextOpen: true });
    return;
  }
  if (reason === 'others-full') {
    const who = state.staff ? state.staff.name.split(' ')[0] : '';
    grid.innerHTML = `<p class="slot-empty">${lang() === 'no'
      ? `${who} er fullbooket for korte timer denne dagen.`
      : `${who} is fully booked for shorter appointments on this day.`}</p>`;
    await renderDeadEndHelp(grid, state.date);
    return;
  }
  if (reason === 'colour-taken') {
    const who = state.staff ? state.staff.name.split(' ')[0] : '';
    grid.innerHTML = `<p class="slot-empty">${lang() === 'no'
      ? `${who} tar kun én fargebehandling per dag, og den er allerede booket.`
      : `${who} takes one colour appointment a day, and it's already booked.`}</p>`;
    await renderDeadEndHelp(grid, state.date);
    return;
  }
  if (reason === 'consultation-cap') {
    grid.innerHTML = '<p class="slot-empty" data-en="This stylist already has 2 consultations booked today - please try another date." data-no="Denne stylisten har allerede 2 konsultasjoner booket i dag - prøv en annen dato.">This stylist already has 2 consultations booked today - please try another date.</p>';
    return;
  }
  if (reason === 'unavailable') {
    const who = state.staff ? state.staff.name.split(' ')[0] : '';
    grid.innerHTML = `<p class="slot-empty">${lang() === 'no'
      ? `${who} er ikke tilgjengelig denne dagen.`
      : `${who} isn't available on this day.`}</p>`;
    await renderDeadEndHelp(grid, state.date);
    return;
  }
  if (!slots.length) {
    grid.innerHTML = '<p class="slot-empty" data-en="Fully booked - please try another date." data-no="Fullbooket - prøv en annen dato.">Fully booked - please try another date.</p>';
    await renderDeadEndHelp(grid, state.date);
    return;
  }

  grid.innerHTML = slots.map((t) => `<button type="button" class="slot-btn" data-mins="${t}">${formatTime(t)}</button>`).join('');
  grid.querySelectorAll('.slot-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.startTime = parseInt(btn.dataset.mins, 10);
      document.getElementById('next3').disabled = false;
    });
  });
}

function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── STEP 5: SUMMARY ──
function renderSummary() {
  const card = document.getElementById('summaryCard');
  const dateLabel = new Date(state.date + 'T00:00:00').toLocaleDateString(lang() === 'no' ? 'nb-NO' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const total = expectedTotal();
  card.innerHTML = `
    <div class="summary-row"><span>Service</span><span>${localName(state.service, 'name')}</span></div>
    <div class="summary-row"><span>Stylist</span><span>${state.staff ? state.staff.name : '-'}</span></div>
    <div class="summary-row"><span>Date</span><span>${dateLabel}</span></div>
    <div class="summary-row"><span>Time</span><span>${formatTime(state.startTime)}</span></div>
    <div class="summary-row"><span>Duration</span><span>${effectiveDuration()} min</span></div>
    <div class="summary-row"><span>Price</span><span>${priceLabel(state.service)}</span></div>
    ${state.addons.map((a) => `
      <div class="summary-row"><span>+ ${lang() === 'no' && a.name_no ? a.name_no : a.name}</span><span>${addonPriceLabel(a)}</span></div>
    `).join('')}
    ${state.addons.length ? `
      <div class="summary-row summary-row-total">
        <span>${lang() === 'no' ? 'Estimert total' : 'Estimated total'}</span>
        <span>${totalLabel(total)}</span>
      </div>` : ''}
    <div class="summary-row"><span>Name</span><span>${state.name}</span></div>
    <div class="summary-row"><span>Email</span><span>${state.email}</span></div>
    <div class="summary-row"><span>Phone</span><span>${state.phone}</span></div>
  `;
  const pending = document.getElementById('summaryPending');
  if (pending) {
    pending.hidden = !needsConfirmation(state.service);
    if (!pending.hidden) pending.innerHTML = pendingNoticeHtml();
  }
}

// ── CONFIRM ──
// ── THE CANCELLATION POLICY ──
// Its wording comes from the database rather than being written here, so what
// she reads and what is recorded against her booking can never drift apart.
// If it cannot be loaded, booking is blocked rather than allowed through
// unagreed: a booking with no acceptance is exactly the one that gets disputed.
let termsVersion = null;
const FALLBACK_TERMS = {
  no: 'Avbestilling må skje senest 48 timer før timen. Avbestiller du senere enn dette, '
    + 'eller ikke møter opp, faktureres halve prisen for behandlingen.',
  en: 'Cancellations must be made at least 48 hours before your appointment. If you cancel '
    + 'later than that, or do not turn up, half the price of the service is charged.',
};

async function loadBookingTerms() {
  const wrap = document.getElementById('termsCheckWrap');
  const textEl = document.getElementById('termsText');
  if (!wrap || !textEl) return;

  const { data, error } = await fetchBookingTerms().catch(() => ({ error: true }));
  const row = (!error && data) ? (Array.isArray(data) ? data[0] : data) : null;
  if (row) {
    termsVersion = row.version;
    textEl.dataset.no = row.text_no;
    textEl.dataset.en = row.text_en;
  } else {
    termsVersion = null;
    textEl.dataset.no = FALLBACK_TERMS.no;
    textEl.dataset.en = FALLBACK_TERMS.en;
  }
  textEl.textContent = textEl.dataset[lang() === 'no' ? 'no' : 'en'];
}

function termsAccepted() {
  const box = document.getElementById('termsAccept');
  return !!(box && box.checked);
}

async function confirmBooking() {
  if (!termsAccepted()) {
    showError(lang() === 'no'
      ? 'Du må godta avbestillingsreglene før du kan booke.'
      : 'Please accept the cancellation policy before booking.');
    const wrap = document.getElementById('termsCheckWrap');
    if (wrap) {
      wrap.classList.add('terms-check-missing');
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => wrap.classList.remove('terms-check-missing'), 2200);
    }
    return;
  }
  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  btn.textContent = 'Booking…';
  try {
    // Add-ons travel as ids, not as text smuggled into `notes` —
    // book_appointment re-validates each one against the service's offer
    // list, snapshots its name and price onto the booking, and stores the
    // expected total. `notes` goes back to being only what the client typed.
    const { data, error } = await bookAppointment({
      serviceId: state.service.id,
      staffId: state.staff.id,
      date: state.date,
      startTime: toPgTime(state.startTime),
      name: state.name,
      email: state.email,
      phone: state.phone,
      notes: state.notes,
      addonIds: state.addons.map((a) => a.id),
      termsVersion,
    });
    if (error) throw error;
    state.lastBooking = data;
    document.getElementById('successRef').textContent = '#' + (data.booking_ref || '').toUpperCase();

    // book_appointment returns the row, so trust its status rather than
    // guessing from the service: anything it left pending needs saying.
    const isPending = data.status === 'pending';
    const notice = document.getElementById('pendingNotice');
    if (notice) {
      notice.hidden = !isPending;
      if (isPending) notice.innerHTML = pendingNoticeHtml();
    }
    const heading = document.querySelector('.wizard-panel[data-panel="success"] .wizard-panel-title');
    const blurb = document.getElementById('successBlurb');
    if (isPending) {
      if (heading) heading.innerHTML = lang() === 'no' ? 'Foresp\u00f8rsel <em>Sendt</em>' : "Request <em>Received</em>";
      if (blurb) blurb.textContent = lang() === 'no'
        ? 'Ta vare på referansen under.'
        : 'Keep the reference below.';
    }
    wireIcsDownload(data);
    showPanel('success');
  } catch (e) {
    const msg = (e && e.message) || 'Something went wrong confirming your booking.';
    if (/slot|available|blocked/i.test(msg)) {
      showError(msg + ' Please pick another time.');
      showPanel('3');
      generateSlots();
    } else {
      showError(msg);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Booking';
  }
}

function wireIcsDownload(booking) {
  const link = document.getElementById('icsDownload');
  const start = new Date(`${booking.date}T${booking.start_time}`);
  const end = new Date(`${booking.date}T${booking.end_time}`);
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
    `UID:${booking.id}@studioserena.no`,
    `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:Studio Serena - ${localName(state.service, 'name')}`,
    'LOCATION:Torshovgata 5H, 0476 Oslo',
    `DESCRIPTION:Booking reference ${booking.booking_ref}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  link.href = URL.createObjectURL(blob);
  link.download = 'studio-serena-appointment.ics';
}

// ── STICKY CONFIRM BAR (step 1) ──
// Choosing a service near the top of a twenty-card list used to mean
// scrolling the whole way down to find Next. This mirrors that button at the
// bottom of the screen the moment something is selected, showing what's
// selected and what it comes to, and hides itself whenever the real Next is
// already on screen so the client never sees two of them.
const stickyBar = document.getElementById('wizardSticky');
const stickyNextBtn = document.getElementById('stickyNext');
const stickyExternalLink = document.getElementById('stickyExternal');
let next1OnScreen = false;

function updateStickyBar() {
  if (!stickyBar) return;
  const panel1 = document.querySelector('.wizard-panel[data-panel="1"]');
  const onStep1 = panel1 && panel1.classList.contains('active');
  const svc = state.service;

  if (!onStep1 || !svc || next1OnScreen) {
    stickyBar.hidden = true;
    document.body.classList.remove('has-sticky-bar');
    return;
  }

  document.getElementById('stickyName').textContent = localName(svc, 'name');

  // An externally booked service can't go forward in the wizard, so the bar
  // carries the hand-off link instead of a dead Continue button.
  if (svc.external_booking_url) {
    document.getElementById('stickyMeta').textContent = lang() === 'no' ? 'Bestilles på Instagram' : 'Booked on Instagram';
    stickyNextBtn.hidden = true;
    stickyExternalLink.hidden = false;
    stickyExternalLink.href = svc.external_booking_url;
    stickyExternalLink.textContent = svc.external_booking_label || (lang() === 'no' ? 'Bestill direkte' : 'Book directly');
  } else {
    const total = expectedTotal();
    const parts = [`${effectiveDuration()} min`, totalLabel(total)];
    if (state.addons.length) {
      parts.push(state.addons.length === 1
        ? (lang() === 'no' ? '1 tillegg' : '1 add-on')
        : `${state.addons.length} ${lang() === 'no' ? 'tillegg' : 'add-ons'}`);
    }
    document.getElementById('stickyMeta').textContent = parts.join(' · ');
    stickyNextBtn.hidden = false;
    stickyExternalLink.hidden = true;
  }

  stickyBar.hidden = false;
  document.body.classList.add('has-sticky-bar');
}

if (stickyNextBtn) {
  // Defers to the real button so there is only ever one path forward.
  stickyNextBtn.addEventListener('click', () => document.getElementById('next1').click());
}

// Watching the real Next button is what keeps the two from ever both showing.
if (window.IntersectionObserver) {
  const next1El = document.getElementById('next1');
  if (next1El) {
    new IntersectionObserver((entries) => {
      next1OnScreen = entries[0].isIntersecting;
      updateStickyBar();
    }, { threshold: 0.5 }).observe(next1El);
  }
}

// ── WIRING ──
document.getElementById('next1').addEventListener('click', () => { showPanel('2'); loadStaffForService(); });
document.getElementById('next2').addEventListener('click', () => {
  showPanel('3');
  // Add-ons can change the duration, so any slot chosen earlier has to be
  // re-validated against the current length rather than trusted — and so does
  // the whole month's availability, since a longer appointment fits fewer
  // days. allowAutoAdvance only here: arriving at the step is the one moment
  // where skipping a sold-out month is helpful rather than disorienting.
  loadCalendarAvailability({ allowAutoAdvance: true });
  if (state.date) generateSlots();
});
document.getElementById('next3').addEventListener('click', () => showPanel('4'));
document.getElementById('next4').addEventListener('click', () => {
  const name = document.getElementById('custName').value.trim();
  const email = document.getElementById('custEmail').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const notes = document.getElementById('custNotes').value.trim();
  if (!name || !email || !phone) { showError('Please fill in your name, email and phone.'); return; }
  if (!/^\S+@\S+\.\S+$/.test(email)) { showError('Please enter a valid email address.'); return; }
  state.name = name; state.email = email; state.phone = phone; state.notes = notes;

  // A gated client is told here, not at the last step. She has given her phone
  // number, which is the first moment we can know — and being turned away after
  // filling in everything is a worse experience than being turned away now.
  // A failed lookup lets her through: the RPC is the real gate, and the salon
  // would rather take a booking it can cancel than turn away a good client
  // because a network call failed.
  checkClientMustCall({ phone, serviceId: state.service.id })
    .then(({ data, error }) => {
      if (error || !data) return;
      showMustCallNotice();
    })
    .catch(() => {});

  renderSummary();
  showPanel('5');
});

// Deliberately warm, and it never says why. She may well be a good client who
// had a bad month, and the salon is asking her to ring — not accusing her.
function showMustCallNotice() {
  const card = document.getElementById('summaryCard');
  const btn = document.getElementById('confirmBtn');
  if (btn) btn.disabled = true;
  const wrap = document.getElementById('termsCheckWrap');
  if (wrap) wrap.hidden = true;
  if (!card) return;
  const no = lang() === 'no';
  card.insertAdjacentHTML('beforebegin', `
    <div class="notice-pending" id="mustCallNotice">
      <strong>${no ? 'Denne timen booker vi sammen med deg' : 'Let us book this one with you'}</strong>
      <p>${no
        ? 'Denne behandlingen tar flere timer, så vi setter den opp direkte med deg. Ring oss på '
          + '<a href="tel:+4745397631">+47 45 39 76 31</a>, så finner vi en tid som passer.'
        : 'This treatment takes several hours, so we arrange it with you directly. Give us a ring on '
          + '<a href="tel:+4745397631">+47 45 39 76 31</a> and we will find a time that suits you.'}</p>
    </div>`);
}
document.getElementById('confirmBtn').addEventListener('click', confirmBooking);
document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', () => showPanel(btn.dataset.back));
});

function applyNotesPlaceholder() {
  const notes = document.getElementById('custNotes');
  if (!notes) return;
  const val = notes.dataset[lang() === 'no' ? 'placeholderNo' : 'placeholderEn'];
  if (val) notes.placeholder = val;
}
document.addEventListener('lang:changed', () => {
  const t = document.getElementById('termsText');
  if (t && t.dataset.no) t.textContent = t.dataset[lang() === 'no' ? 'no' : 'en'];
  if (state.services.length) {
    // renderServices() rebuilds every card, so the .selected / .active
    // classes go with it. State survives, so put the highlighting back
    // rather than letting the two disagree.
    const keptService = state.service;
    const keptAddons = state.addons.slice();
    renderServices();
    if (keptService) {
      selectService(keptService); // clears state.addons as part of a fresh pick
      keptAddons.forEach((a) => {
        const chip = document.querySelector(`.combo-chip[data-service-id="${keptService.id}"][data-addon-id="${a.id}"]`);
        if (!chip) return;
        chip.classList.add('active');
        state.addons.push(a);
      });
    }
  }
  renderCalendar();
  applyNotesPlaceholder();
});
applyNotesPlaceholder();

initDateInput();
loadBookingTerms();
loadServices();
showPanel('1');
