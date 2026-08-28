// ── IS BOOKING ACTUALLY WORKING? ──
//
// A plain uptime ping on the homepage is close to useless here. When booking
// breaks, the site keeps loading perfectly: the pages are static files on a
// CDN and they will keep being served long after the database behind the
// Book button has stopped answering. The homepage returns 200 the whole time
// and nobody is told anything. Clients do not ring up to report a broken
// form - they just leave, and the first sign is a quiet week.
//
// That is exactly how the CSP mistake played out: every page loaded, and
// booking, appointments and the schedule were all dead because the Supabase
// library had been blocked.
//
// So this endpoint walks the same path a client walks, in order, and fails
// loudly if any step does. Point an uptime service at it and the alert means
// "someone cannot book right now", not "the web server is switched on".

const SUPABASE_URL = 'https://drejwxijygwwhnfpgxvl.supabase.co';
// The publishable anon key - the same one already served to every visitor in
// supabase-config.js. Nothing secret lives in this file; it must stay that
// way, because the response is public.
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyZWp3eGlqeWd3d2huZnBneHZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMDg0MjIsImV4cCI6MjA5MDc4NDQyMn0.1MJxo7D2WlX9jcvuVzgYm-A1qKqh26o1tJ827rvUaro';

const HEADERS = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  'Content-Type': 'application/json',
};

const TIMEOUT_MS = 8000;

async function call(path, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}${path}`, {
      ...init,
      headers: HEADERS,
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`HTTP ${res.status}${body && body.message ? `: ${body.message}` : ''}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function rpc(name, args) {
  return call(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args || {}) });
}

function isoDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const checks = [];
  let failed = null;

  // Each step is one thing a client depends on, in the order they hit it.
  // `detail` is deliberately a count or a plain word - this response is
  // public, so no client data goes anywhere near it.
  async function step(name, fn) {
    if (failed) return; // stop at the first failure; the rest is noise
    const started = Date.now();
    try {
      const detail = await fn();
      checks.push({ name, ok: true, ms: Date.now() - started, detail });
    } catch (err) {
      checks.push({ name, ok: false, ms: Date.now() - started, error: String(err.message || err) });
      failed = name;
    }
  }

  let staff = [];

  await step('database-reachable', async () => {
    const days = await rpc('get_booking_horizon_days');
    if (typeof days !== 'number' || days <= 0) throw new Error(`horizon is ${JSON.stringify(days)}`);
    return `${days} days ahead`;
  });

  await step('services-listed', async () => {
    const rows = await call('/rest/v1/services?select=id&active=eq.true&limit=50');
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('no active services');
    return `${rows.length} active`;
  });

  await step('stylists-listed', async () => {
    const rows = await call('/rest/v1/staff?select=id,name&active=eq.true&limit=50');
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('no active stylists');
    staff = rows;
    return `${rows.length} active`;
  });

  // The one that matters most. If this stops answering, the calendar shows a
  // day with no times on it and the client simply cannot book - while every
  // page still loads normally.
  await step('times-offered', async () => {
    const date = isoDaysFromNow(1);
    for (const s of staff) {
      const slots = await rpc('get_busy_slots', { p_staff_id: s.id, p_date: date });
      if (!Array.isArray(slots)) throw new Error(`availability for a stylist did not answer`);
    }
    return `${staff.length} stylists answered for ${date}`;
  });

  await step('booking-terms-readable', async () => {
    const terms = await rpc('get_current_booking_terms');
    if (!terms) throw new Error('no booking terms');
    return 'present';
  });

  const ok = !failed;
  res.setHeader('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json({
    ok,
    // Uptime services match on body text as well as status code, so say it
    // in words too.
    status: ok ? 'BOOKING OK' : `BOOKING BROKEN: ${failed}`,
    checkedAt: new Date().toISOString(),
    checks,
  });
}
