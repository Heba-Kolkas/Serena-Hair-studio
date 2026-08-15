import {
  fetchActiveServices,
  fetchStaffForService,
  fetchBusinessHours,
  fetchBlockedSlots,
  fetchBusySlots,
  bookAppointment,
} from '/js/supabase-client.js';

// Static fallbacks so the wizard is fully browsable for UI/UX review while
// Supabase is paused — mirrors supabase/migrations/0002_seed_data.sql and
// js/team.js's bookable staff. Steps 1-4 work identically to how they'll
// look once the database is live; the final Confirm step will still fail
// (there's nowhere to actually save a booking yet), by design.
// Every service defaults to Hassan+Kani; Taniya is scoped to just her two
// specialties (Keratin/Botox), per the owner. A few service types only run
// at two fixed times a day rather than the normal 15-min grid.
const STAFF_GENERAL = ['staff-1', 'staff-2'];
const STAFF_TANIYA = ['staff-3'];
const TIMES_COLOR_BASICS = ['13:00', '16:30']; // haircuts, toner, one-color

// Balayage's fixed times are per-stylist/per-weekday rather than a single
// array like the other fixed-time services — Hassan runs it every weekday,
// Kani only Tue/Thu (Mon/Wed/Fri she's 11:00-only). Mirrors
// staff_service_schedule in supabase/migrations/0001_booking_schema.sql.
function getBalayageTimes(staffId, weekday) {
  if (staffId === 'staff-2') return (weekday === 2 || weekday === 4) ? ['11:00', '15:00'] : ['11:00'];
  return ['11:00', '15:00']; // Hassan (and any other overlap-eligible stylist)
}
// Kani takes clients until 18:00 on Mon/Wed/Fri — later than the salon's
// general 17:30 close on those days. Mirrors staff_hours_override.
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
// A Balayage appointment (240min, starting 11:00 or 15:00) doesn't block its
// paired "second client" time for a stylist with allow_overlap_booking —
// mirrors the exemption carved out in the book_appointment RPC. Keyed in
// minutes. The pairing times themselves (13:00/16:30) are about when the
// color is far enough into processing to leave unattended, which doesn't
// shift just because the full appointment now runs longer end-to-end.
const OVERLAP_ANCHORS = { 660: 780, 900: 990 }; // 11:00->13:00, 15:00->16:30
const BALAYAGE_DURATION = 240;

// Shared combo/add-on options, reused across whichever services can combine
// with them — Haircut/Toner/One Color/Balayage all reference their own real
// price rather than each service inventing a separate number for the same
// thing.
const COMBO_HAIRCUT = { name: 'Haircut', name_no: 'Klipp', price: 500, isAddon: true };
const COMBO_TONER = { name: 'Toner', name_no: 'Toner', price: 1000 };
const COMBO_ONE_COLOR = { name: 'One Color', name_no: 'Én Farge', price: 1500, priceIsFrom: true };
const COMBO_BALAYAGE = { name: 'Balayage', name_no: 'Balayage', price: 3500, priceIsFrom: true };
const COMBO_WASH = { name: 'Wash', name_no: 'Vask', price: 100, isAddon: true };
const COMBO_WAVY_STYLING = { name: 'Wavy Styling', name_no: 'Bølgestyling', price: 200, isAddon: true };
const EXTENSIONS_COMBOS = [COMBO_BALAYAGE, COMBO_TONER, COMBO_ONE_COLOR, COMBO_HAIRCUT];
function comboPriceLabel(c) {
  if (c.isAddon) return '+' + c.price.toLocaleString('en-US') + ' NOK';
  const prefix = c.priceIsFrom ? (lang() === 'no' ? 'Fra ' : 'From ') : '';
  return prefix + c.price.toLocaleString('en-US') + ' NOK';
}

const FALLBACK_SERVICES = [
  { id: 'svc-3', name: 'Highlights / Balayage', name_no: 'Striper / Balayage', category: 'Color Services', price_from: 3500, price_to: 4000, duration_minutes: 240, image_url: '/html/Pics/Balayage/Blayage12.jpeg', staff: STAFF_GENERAL, balayageSchedule: true, comboOptions: [COMBO_HAIRCUT, COMBO_ONE_COLOR, COMBO_TONER] },
  { id: 'svc-1', name: 'One Color (Roots)', name_no: 'Én Farge (Røtter)', category: 'Color Services', price_from: 1500, duration_minutes: 90, image_url: '/html/Pics/Farge/Farge1.jpeg', staff: STAFF_GENERAL, fixed_times: TIMES_COLOR_BASICS, comboOptions: [COMBO_HAIRCUT, COMBO_TONER] },
  { id: 'svc-2', name: 'One Color (All Hair)', name_no: 'Én Farge (Alt Hår)', category: 'Color Services', price_from: 2000, duration_minutes: 90, image_url: '/html/Pics/Farge/Farge1.jpeg', staff: STAFF_GENERAL, fixed_times: TIMES_COLOR_BASICS, comboOptions: [COMBO_HAIRCUT, COMBO_TONER] },
  { id: 'svc-4', name: 'Toner', name_no: 'Toner', category: 'Color Services', price_from: 1000, duration_minutes: 45, image_url: '/html/Pics/Farge/Farge1.jpeg', staff: STAFF_GENERAL, fixed_times: TIMES_COLOR_BASICS, comboOptions: [COMBO_HAIRCUT] },
  { id: 'svc-5', name: 'Blowdry', name_no: 'Føn', category: 'Haircuts & Styling', price_from: 600, duration_minutes: 30, image_url: '/html/Pics/Styling/styling4.jpeg', staff: STAFF_GENERAL, comboOptions: [COMBO_WASH, COMBO_WAVY_STYLING] },
  { id: 'svc-8', name: 'Haircut + Blowdry', name_no: 'Klipp + Føn', category: 'Haircuts & Styling', price_from: 850, duration_minutes: 60, image_url: '/html/Pics/Haircut/Haircut5.jpeg', staff: STAFF_GENERAL, fixed_times: TIMES_COLOR_BASICS, comboOptions: [COMBO_WASH, COMBO_WAVY_STYLING] },
  { id: 'svc-11', name: 'Hair Extensions (50g)', name_no: 'Extensions (50g)', category: 'Hair Extensions', price_from: 3000, duration_minutes: 180, image_url: '/html/Pics/Extensions/cover.jpeg', staff: STAFF_GENERAL, requiresConsultation: true, comboOptions: EXTENSIONS_COMBOS },
  { id: 'svc-12', name: 'Hair Extensions (100-150g)', name_no: 'Extensions (100-150g)', category: 'Hair Extensions', price_on_consultation: true, duration_minutes: 240, image_url: '/html/Pics/Extensions/cover.jpeg', staff: STAFF_GENERAL, requiresConsultation: true, comboOptions: EXTENSIONS_COMBOS },
  { id: 'svc-13', name: 'Keratin Treatment', name_no: 'Keratinbehandling', category: 'Keratin & Hair Treatments', price_on_consultation: true, duration_minutes: 150, image_url: '/html/Pics/Treatment/cover.jpeg', staff: STAFF_TANIYA },
  { id: 'svc-17', name: 'Hair Botox', name_no: 'Hår Botox', category: 'Keratin & Hair Treatments', price_on_consultation: true, duration_minutes: 120, image_url: '/html/Pics/Treatment/cover.jpeg', staff: STAFF_TANIYA },
  { id: 'svc-14', name: 'Half Updo', name_no: 'Halv Oppsett', category: 'Bridal & Special Occasion', price_from: 1500, duration_minutes: 45, image_url: '/html/Pics/Brides/Bride5.jpeg', staff: STAFF_GENERAL },
  { id: 'svc-15', name: 'Full Updo', name_no: 'Helt Oppsett', category: 'Bridal & Special Occasion', price_from: 2000, duration_minutes: 75, image_url: '/html/Pics/Brides/Bride5.jpeg', staff: STAFF_GENERAL },
  { id: 'svc-16', name: 'Bridal Hair', name_no: 'Brudehår', category: 'Bridal & Special Occasion', price_from: 4000, duration_minutes: 120, image_url: '/html/Pics/Brides/Bride5.jpeg', staff: STAFF_GENERAL },
  { id: 'svc-0', name: 'Consultation', name_no: 'Konsultasjon', category: 'Consultation', price_from: 0, duration_minutes: 10, image_url: '/html/Pics/Haircut/Haircut5.jpeg', staff: STAFF_GENERAL, consultationRule: true },
];
const FALLBACK_STAFF = [
  { id: 'staff-1', name: 'Hassan K.', role: 'Founder & Master Stylist', role_no: 'Grunnlegger & Mesterstylisten', photo_url: '/html/Pics/Team/Hasan.jpg', allow_overlap_booking: true },
  { id: 'staff-2', name: 'Kani M.', role: 'Senior Stylist & Makeup Artist', role_no: 'Senior Stylisten & Makeup Artist', photo_url: '/html/Pics/Team/Kani.jpg' },
  { id: 'staff-3', name: 'Taniya S.', role: 'Keratin & Hair Treatment Specialist', role_no: 'Keratin & Hårbehandlingsspesialist', photo_url: '/html/Pics/Team/Taniya.jpg' },
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
  addonSelected: false,
  comboSelections: [],
  staff: null,
  staffOptions: [],
  date: null,
  startTime: null, // minutes since midnight
  name: '', email: '', phone: '', notes: '',
  lastBooking: null,
};

const wizard = document.getElementById('wizard');
const errorBox = document.getElementById('wizardError');

function lang() { return (window._getLang && window._getLang()) || 'en'; }
function localName(obj, base) {
  const l = lang();
  return (l === 'no' && obj[base + '_no']) ? obj[base + '_no'] : obj[base];
}

function priceLabel(svc) {
  if (svc.price_from === 0) return lang() === 'no' ? 'Gratis' : 'Free';
  if (svc.price_on_consultation) return lang() === 'no' ? 'Pris etter konsultasjon' : 'Price on consultation';
  const prefix = lang() === 'no' ? 'Fra ' : 'From ';
  if (svc.price_to) return `${prefix}${Number(svc.price_from).toLocaleString('en-US')}–${Number(svc.price_to).toLocaleString('en-US')} NOK`;
  return prefix + Number(svc.price_from).toLocaleString('en-US') + ' NOK';
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
    data = FALLBACK_SERVICES; // Supabase unreachable — preview mode
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
          <span id="categoryDropdownLabel">${allLabel}</span>
          <i class="fa-solid fa-chevron-down"></i>
        </button>
        <div class="custom-select-menu" id="categoryDropdownMenu">
          <button type="button" class="custom-select-option active" data-value="all">${allLabel}</button>
          ${categories.map((cat) => `<button type="button" class="custom-select-option" data-value="${cat}">${cat}</button>`).join('')}
        </div>
      </div>
    </div>
  `;

  const groups = Object.entries(byCategory).map(([cat, list]) => `
    <div class="category-group" data-category="${cat}">
      <div class="category-group-title">${cat}</div>
      <div class="option-grid">
        ${list.map((s) => {
          const addonLabel = s.addon ? (lang() === 'no' ? s.addon.name_no : s.addon.name) : '';
          const combos = s.comboOptions || [];
          return `
          <div class="option-card-wrap" data-service-id="${s.id}">
            <button type="button" class="option-card" data-service-id="${s.id}">
              <span class="option-card-img"><img src="${s.image_url || ''}" alt=""></span>
              <span class="option-card-body">
                <span class="option-card-title">${localName(s, 'name')}</span>
                <span class="option-card-meta">${s.duration_minutes} min · ${priceLabel(s)}</span>
              </span>
              <span class="option-card-check"><i class="fa-solid fa-check"></i></span>
            </button>
            ${s.addon ? `
            <label class="option-card-addon">
              <input type="checkbox" class="option-card-addon-checkbox" data-service-id="${s.id}">
              <span class="option-card-addon-body">
                <span>${lang() === 'no' ? 'Legg til' : 'Add'} ${addonLabel}</span>
                <span class="option-card-addon-price">+${s.addon.price.toLocaleString('en-US')} NOK</span>
              </span>
            </label>` : ''}
            ${combos.length ? `
            <div class="option-card-combos">
              <span class="option-card-combos-label">${lang() === 'no' ? 'Kan kombineres med:' : 'Can be combined with:'}</span>
              <div class="combo-chip-row">
                ${combos.map((c) => `
                  <button type="button" class="combo-chip" data-service-id="${s.id}" data-combo="${c.name}">
                    <span class="combo-chip-name">${lang() === 'no' ? c.name_no : c.name}</span>
                    <span class="combo-chip-price">${comboPriceLabel(c)}</span>
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

  wrap.querySelectorAll('.option-card-addon-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('click', (e) => e.stopPropagation());
    checkbox.addEventListener('change', () => {
      const svc = state.services.find((s) => s.id === checkbox.dataset.serviceId);
      if (state.service !== svc) { selectService(svc); checkbox.checked = true; }
      state.addonSelected = checkbox.checked;
    });
  });
  wrap.querySelectorAll('.combo-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const svc = state.services.find((s) => s.id === chip.dataset.serviceId);
      const wasActive = chip.classList.contains('active');
      if (state.service !== svc) selectService(svc); // resets chips for the new service
      chip.classList.toggle('active', !wasActive);
      state.comboSelections = Array.from(
        document.querySelectorAll(`.combo-chip[data-service-id="${svc.id}"].active`)
      ).map((c) => c.dataset.combo);
    });
  });

  // Custom category dropdown — native <select> popups can't be themed (that
  // menu is rendered by the OS, not the page), so this is a real styled
  // button + menu instead.
  const dropdown = document.getElementById('categoryDropdown');
  const trigger = document.getElementById('categoryDropdownTrigger');
  const menu = document.getElementById('categoryDropdownMenu');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  menu.querySelectorAll('.custom-select-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      menu.querySelectorAll('.custom-select-option').forEach((o) => o.classList.remove('active'));
      opt.classList.add('active');
      selectedCategory = opt.dataset.value;
      document.getElementById('categoryDropdownLabel').textContent = opt.textContent;
      dropdown.classList.remove('open');
      applyServiceFilters();
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
  state.addonSelected = false;
  state.comboSelections = [];
  document.querySelectorAll('#serviceGroups .option-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.serviceId === svc.id);
  });
  document.querySelectorAll('#serviceGroups .option-card-wrap').forEach((w) => {
    w.classList.toggle('selected', w.dataset.serviceId === svc.id);
  });
  document.querySelectorAll('#serviceGroups .option-card-addon-checkbox').forEach((cb) => {
    if (cb.dataset.serviceId !== svc.id) cb.checked = false;
  });
  document.querySelectorAll('#serviceGroups .combo-chip').forEach((chip) => {
    if (chip.dataset.serviceId !== svc.id) chip.classList.remove('active');
  });
  renderConsultationNotice(svc);
  document.getElementById('next1').disabled = false;
}

function renderConsultationNotice(svc) {
  let notice = document.getElementById('extensionsNotice');
  if (notice) notice.remove();
  if (!svc.requiresConsultation) return;
  const card = document.querySelector(`#serviceGroups .option-card-wrap[data-service-id="${svc.id}"]`);
  if (!card) return;
  const el = document.createElement('div');
  el.id = 'extensionsNotice';
  el.className = 'extensions-notice';
  el.innerHTML = `
    <i class="fa-solid fa-circle-info"></i>
    <span>${lang() === 'no'
      ? 'Extensions krever en tidligere konsultasjon (hvor vi bestiller extensions du ønsker) og et depositum.'
      : 'Hair Extensions require a prior consultation (to order the extensions you want) and a deposit.'}
      <button type="button" class="extensions-notice-link" id="switchToConsultation">${lang() === 'no' ? 'Ikke gjort dette ennå? Bestill en konsultasjon' : "Haven't done this yet? Book a Consultation instead"}</button>
    </span>
  `;
  card.insertAdjacentElement('afterend', el);
  document.getElementById('switchToConsultation').addEventListener('click', () => {
    const consultation = state.services.find((s) => s.id === 'svc-0');
    if (consultation) selectService(consultation);
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
  state.staffOptions = staffList;
  // Clients always choose their own stylist — no "no preference" shortcut,
  // since that used to silently default to whichever stylist sorted first
  // without actually checking who was free.
  grid.innerHTML = staffList.map((st) => `
    <button type="button" class="option-card" data-staff-id="${st.id}">
      <span class="option-card-img"><img src="${st.photo_url || ''}" alt=""></span>
      <span class="option-card-body">
        <span class="option-card-title">${st.name}</span>
        <span class="option-card-meta">${localName(st, 'role')}</span>
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
const maxBookableDate = new Date(today);
maxBookableDate.setDate(maxBookableDate.getDate() + 60);
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
    calendarBusinessHours = FALLBACK_BUSINESS_HOURS; // Supabase unreachable — preview mode
  }
  renderCalendar();
}

function shiftCalendarMonth(delta) {
  calendarViewMonth += delta;
  if (calendarViewMonth < 0) { calendarViewMonth = 11; calendarViewYear--; }
  if (calendarViewMonth > 11) { calendarViewMonth = 0; calendarViewYear++; }
  renderCalendar();
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
  let cells = '';
  for (let i = 0; i < leadingBlanks; i++) cells += '<span class="calendar-day calendar-day-blank"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const cellDate = new Date(calendarViewYear, calendarViewMonth, d);
    const iso = toLocalISO(cellDate);
    const dayHours = calendarBusinessHours.find((h) => h.weekday === cellDate.getDay());
    const closed = !dayHours || dayHours.closed;
    const disabled = cellDate < today || cellDate > maxBookableDate || closed;
    const selected = state.date === iso;
    cells += `<button type="button" class="calendar-day${selected ? ' selected' : ''}" data-date="${iso}" ${disabled ? 'disabled' : ''}>${d}</button>`;
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

async function generateSlots() {
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '<p style="text-align:center;color:var(--greige);grid-column:1/-1;">Checking availability…</p>';
  if (!state.date || !state.staff || !state.service) return;

  const jsDate = new Date(state.date + 'T00:00:00');
  const weekday = jsDate.getDay();

  let hours, blocked, busy;
  try {
    const [hRes, bRes, buRes] = await Promise.all([
      fetchBusinessHours(),
      fetchBlockedSlots(state.staff.id, state.date),
      fetchBusySlots(state.staff.id, state.date),
    ]);
    if (hRes.error || bRes.error || buRes.error) throw hRes.error || bRes.error || buRes.error;
    hours = hRes.data; blocked = bRes.data; busy = buRes.data;
  } catch (e) {
    // Supabase unreachable — preview mode: real hours, no known blocks/bookings.
    hours = FALLBACK_BUSINESS_HOURS; blocked = []; busy = [];
  }

  {
    const dayHours = (hours || []).find((h) => h.weekday === weekday);
    if (!dayHours || dayHours.closed || !dayHours.open_time || !dayHours.close_time) {
      grid.innerHTML = '<p class="slot-empty" data-en="Closed on this day — please pick another date." data-no="Stengt denne dagen — velg en annen dato.">Closed on this day — please pick another date.</p>';
      return;
    }

    const open = parseTime(dayHours.open_time);
    const staffCloseOverride = getStaffCloseOverride(state.staff.id, weekday);
    const close = staffCloseOverride ? parseTime(staffCloseOverride) : parseTime(dayHours.close_time);
    const duration = state.service.duration_minutes;
    const blockedRanges = (blocked || []).map((b) => [parseTime(b.start_time), parseTime(b.end_time)]);
    const busyRanges = (busy || []).map((b) => [parseTime(b.start_time), parseTime(b.end_time)]);
    const allRanges = blockedRanges.concat(busyRanges);

    const now = new Date();
    const isToday = toLocalISO(now) === state.date;
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // Consultation is capped at 2 bookings per stylist per day — inferred
    // from busy ranges matching its own 10-minute duration, since the local
    // fallback's busy list carries no service id to match against directly.
    if (state.service.consultationRule) {
      const existingConsultations = busyRanges.filter(([s, e]) => (e - s) === CONSULTATION_DURATION).length;
      if (existingConsultations >= CONSULTATION_DAILY_CAP) {
        grid.innerHTML = '<p class="slot-empty" data-en="This stylist already has 2 consultations booked today — please try another date." data-no="Denne stylisten har allerede 2 konsultasjoner booket i dag — prøv en annen dato.">This stylist already has 2 consultations booked today — please try another date.</p>';
        return;
      }
    }

    // Some services (haircuts/toner/one-color) only run at two fixed times a
    // day instead of the usual 15-min grid; Balayage's fixed times are
    // per-stylist/per-weekday (see getBalayageTimes) rather than a flat list.
    // Fixed times are owner-curated on purpose, so — unlike the dynamic grid
    // below — they're not required to finish before closing time: a 15:00
    // Balayage (240min) legitimately runs until 19:00 even though the salon
    // stops taking new arrivals at 17:30. Consultation uses the normal
    // dynamic grid too, but 17:00 caps its latest START time (not "must
    // finish by," like the general close time means for everything else).
    const candidates = state.service.balayageSchedule
      ? getBalayageTimes(state.staff.id, weekday).map(parseTime).filter((t) => t >= open)
      : state.service.fixed_times
        ? state.service.fixed_times.map(parseTime).filter((t) => t >= open)
        : state.service.consultationRule
          ? (() => { const arr = []; const latest = parseTime(CONSULTATION_LATEST_START); for (let t = open; t <= latest; t += 15) arr.push(t); return arr; })()
          : (() => { const arr = []; for (let t = open; t + duration <= close; t += 15) arr.push(t); return arr; })();

    // A stylist with allow_overlap_booking can take a second, non-Bridal
    // client at 13:00/16:30 while their own 11:00/15:00 Balayage (240min) is
    // processing unattended — that specific pairing is exempt from the
    // overlap conflict below. A Consultation can nest inside ANY other
    // booking's time block — it just can't share that booking's exact start
    // time (guaranteed separately by the slot-selection UI itself, since two
    // bookings can never be selected at the identical start minute).
    const overlapEligible = !!state.staff.allow_overlap_booking
      && !state.service.balayageSchedule
      && state.service.category !== 'Bridal & Special Occasion';

    const slots = candidates.filter((t) => {
      if (isToday && t <= nowMins) return false;
      return !allRanges.some(([s, e]) => {
        if (!(t < e && (t + duration) > s)) return false; // no overlap, not a conflict anyway
        if (state.service.consultationRule && s !== t) return false; // exempt — just can't share the exact start minute
        if (overlapEligible && (e - s) === BALAYAGE_DURATION && OVERLAP_ANCHORS[s] === t) return false; // exempt pairing
        return true;
      });
    });

    if (!slots.length) {
      grid.innerHTML = '<p class="slot-empty" data-en="No open slots left this day — please try another date." data-no="Ingen ledige tider denne dagen — prøv en annen dato.">No open slots left this day — please try another date.</p>';
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
}
function toLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── STEP 5: SUMMARY ──
function renderSummary() {
  const card = document.getElementById('summaryCard');
  const dateLabel = new Date(state.date + 'T00:00:00').toLocaleDateString(lang() === 'no' ? 'nb-NO' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const addon = state.addonSelected && state.service.addon ? state.service.addon : null;
  card.innerHTML = `
    <div class="summary-row"><span>Service</span><span>${localName(state.service, 'name')}</span></div>
    <div class="summary-row"><span>Stylist</span><span>${state.staff ? state.staff.name : '—'}</span></div>
    <div class="summary-row"><span>Date</span><span>${dateLabel}</span></div>
    <div class="summary-row"><span>Time</span><span>${formatTime(state.startTime)}</span></div>
    <div class="summary-row"><span>Duration</span><span>${state.service.duration_minutes} min</span></div>
    <div class="summary-row"><span>Price</span><span>${priceLabel(state.service)}</span></div>
    ${addon ? `<div class="summary-row"><span>${lang() === 'no' ? addon.name_no : addon.name}</span><span>+${addon.price.toLocaleString('en-US')} NOK</span></div>` : ''}
    ${state.comboSelections.map((name) => {
      const c = EXTENSIONS_COMBOS.find((opt) => opt.name === name);
      const label = c ? (lang() === 'no' ? c.name_no : c.name) : name;
      return `<div class="summary-row"><span>+ ${label}</span><span>${c ? comboPriceLabel(c) : ''}</span></div>`;
    }).join('')}
    <div class="summary-row"><span>Name</span><span>${state.name}</span></div>
    <div class="summary-row"><span>Email</span><span>${state.email}</span></div>
    <div class="summary-row"><span>Phone</span><span>${state.phone}</span></div>
  `;
}

// ── CONFIRM ──
async function confirmBooking() {
  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  btn.textContent = 'Booking…';
  try {
    const addon = state.addonSelected && state.service.addon ? state.service.addon : null;
    // The schema has no dedicated add-on/combo column yet, so both are
    // folded into notes for now — the salon still sees them when reviewing
    // the booking.
    const extras = [];
    if (addon) extras.push(`Add-on: ${addon.name} (+${addon.price} NOK)`);
    if (state.comboSelections.length) {
      const comboText = state.comboSelections.map((name) => {
        const c = EXTENSIONS_COMBOS.find((opt) => opt.name === name);
        return c ? `${c.name} (${comboPriceLabel(c)})` : name;
      }).join(', ');
      extras.push(`Combined with: ${comboText}`);
    }
    const notes = extras.length
      ? `${state.notes}${state.notes ? ' — ' : ''}${extras.join(' — ')}`
      : state.notes;
    const { data, error } = await bookAppointment({
      serviceId: state.service.id,
      staffId: state.staff.id,
      date: state.date,
      startTime: toPgTime(state.startTime),
      name: state.name,
      email: state.email,
      phone: state.phone,
      notes,
    });
    if (error) throw error;
    state.lastBooking = data;
    document.getElementById('successRef').textContent = '#' + (data.booking_ref || '').toUpperCase();
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
    `SUMMARY:Studio Serena — ${localName(state.service, 'name')}`,
    'LOCATION:Torshovgata 5H, 0476 Oslo',
    `DESCRIPTION:Booking reference ${booking.booking_ref}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  link.href = URL.createObjectURL(blob);
  link.download = 'studio-serena-appointment.ics';
}

// ── WIRING ──
document.getElementById('next1').addEventListener('click', () => { showPanel('2'); loadStaffForService(); });
document.getElementById('next2').addEventListener('click', () => { showPanel('3'); });
document.getElementById('next3').addEventListener('click', () => showPanel('4'));
document.getElementById('next4').addEventListener('click', () => {
  const name = document.getElementById('custName').value.trim();
  const email = document.getElementById('custEmail').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const notes = document.getElementById('custNotes').value.trim();
  if (!name || !email || !phone) { showError('Please fill in your name, email and phone.'); return; }
  if (!/^\S+@\S+\.\S+$/.test(email)) { showError('Please enter a valid email address.'); return; }
  state.name = name; state.email = email; state.phone = phone; state.notes = notes;
  renderSummary();
  showPanel('5');
});
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
  if (state.services.length) renderServices();
  renderCalendar();
  applyNotesPlaceholder();
});
applyNotesPlaceholder();

initDateInput();
loadServices();
showPanel('1');
