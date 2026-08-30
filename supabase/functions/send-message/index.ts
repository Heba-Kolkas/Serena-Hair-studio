// ── ONE WAY OUT ──
// Every message Studio Serena sends leaves through this function: booking
// confirmations, reminders, cancellations, no-show notices, invoices,
// extensions arrivals, waitlist offers.
//
// WHY ONE FUNCTION RATHER THAN A CALL PER FEATURE
// Before this, each place that wanted to send a message called Resend its own
// way. That means every one of them has to remember the same six things - is
// there an address, is it the right language, has this already gone out, is it
// a reasonable hour, did it fail, was it recorded - and the moment one forgets,
// a client silently gets nothing and nobody finds out until she turns up on the
// wrong day. Those six things live here instead, once.
//
// WHAT IT GUARANTEES
//   * Never sends the same message twice. The ledger enforces it, not a check.
//   * Never fails silently. Every attempt is recorded with its outcome; a
//     failure is visible in the Owner Panel rather than lost.
//   * Never texts anyone at 03:00, and never texts anyone who did not agree.
//   * Always answers, even when a provider is down, so a booking is never left
//     half-finished because mail was unavailable.
//
// NOT YET DEPLOYED. Needs: a paused Supabase project resumed, then
//   supabase secrets set RESEND_API_KEY=re_xxx SVEVE_USER=... SVEVE_PASSWORD=...
//   supabase functions deploy send-message

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import {
  renderEmail, renderSms, renderExtensionsArrivedEmail, renderExtensionsArrivedSms,
  smsLength, SALON, type Lang, type MessageKey, type MessageContext,
} from '../_shared/messages.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Supplied to every Edge Function by Supabase; never leaves the server.
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const EMAIL_FROM = Deno.env.get('BOOKING_FROM') ?? `${SALON.name} <bookings@studioserena.no>`;
const EMAIL_REPLY_TO = Deno.env.get('BOOKING_REPLY_TO') ?? SALON.email;

// Sveve: Norwegian, billed in NOK. The sender name is capped at 11 characters
// by the GSM standard, which "Studio Serena" (13) does not fit. The salon's
// account already has SALONSERENA registered - exactly 11 - so that is what
// goes out, rather than the SerenaHair this once assumed.
//
// Alphanumeric senders cannot receive replies. Every message body therefore
// opens with the salon's full name and ends by giving the phone number, so a
// client who wants to answer has somewhere to go.
const SVEVE_USER = Deno.env.get('SVEVE_USER');
const SVEVE_PASSWORD = Deno.env.get('SVEVE_PASSWORD');
const SVEVE_SENDER = (Deno.env.get('SVEVE_SENDER') ?? 'SALONSERENA').slice(0, 11);

// Lets the scheduled drain identify itself without a staff PIN.
const OUTBOX_SECRET = Deno.env.get('OUTBOX_SECRET');

/** Compares without leaking the answer through how long it takes. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Nobody is texted between these hours. A cancellation at 23:40 is not worth
// waking a client for, and a salon that does it looks careless. Email is not
// held back - someone awake and looking at their phone can act on it, and one
// that arrives quietly at 2am is simply read in the morning.
const QUIET_FROM = 21;
const QUIET_UNTIL = 8;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function callRpc(name: string, args: Record<string, unknown>, key: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);

  // A function returning void answers 204 with an empty body, and res.json()
  // on nothing throws "Unexpected end of JSON input". That is most of the
  // queue's bookkeeping - mark_message_sent, mark_message_failed,
  // defer_message - so every SUCCESSFUL send threw immediately after being
  // recorded as sent, and the row was then put back to pending by the
  // catch-all below it. Two things followed, both bad:
  //
  //   - a client kept receiving the same confirmation every five minutes,
  //     because the row was never allowed to reach 'sent';
  //   - the real failure reason was overwritten by this parse error, so the
  //     one field that says why a message did not go out said nothing useful.
  //
  // It could only ever appear once something actually sent, and until the
  // real function was deployed nothing ever had - so it sat here unseen.
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const rpc = (name: string, args: Record<string, unknown>) => callRpc(name, args, SUPABASE_ANON_KEY);

/** For the queue only. Claiming a message and marking it sent decides whether
 *  a client hears from the salon at all, so those functions are granted to
 *  service_role and nothing else - with the anon key, which ships in every
 *  browser, anyone could claim the whole queue, mark it delivered, and stop
 *  every confirmation and reminder without anything appearing to break. */
const rpcAdmin = (name: string, args: Record<string, unknown>) =>
  callRpc(name, args, SERVICE_ROLE_KEY);

/** Oslo's wall clock, which is the only clock that matters for "is it late?" */
function osloHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo', hour: 'numeric', hour12: false,
  }).format(new Date()));
}

function isQuietHour(): boolean {
  const h = osloHour();
  return h >= QUIET_FROM || h < QUIET_UNTIL;
}

/** The next 08:00 in Oslo, as an instant. A message held overnight is due
 *  then - not dropped, and not sent at 03:00.
 *
 *  Walks forward a quarter hour at a time and asks Oslo what time it is,
 *  rather than doing offset arithmetic. Slightly blunt, but it cannot get
 *  the summer-time changeover wrong, and it runs at most a hundred times. */
function nextMorningOslo(): string {
  const now = new Date();
  for (let i = 1; i <= 24 * 4 + 8; i++) {
    const t = new Date(now.getTime() + i * 15 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Oslo', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(t);
    const h = Number(parts.find((p) => p.type === 'hour')!.value);
    const m = Number(parts.find((p) => p.type === 'minute')!.value);
    if (h === QUIET_UNTIL && m < 15) return t.toISOString();
  }
  // Unreachable in practice; a sane fallback beats throwing inside the drain.
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString();
}

/** Norwegian mobile numbers, in the shape Sveve wants: digits, country code. */
function normalisePhone(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 8) return `47${digits}`;          // local
  if (digits.startsWith('47') && digits.length === 10) return digits;
  if (digits.startsWith('0047')) return digits.slice(2);
  return digits.length >= 10 ? digits : null;             // foreign, pass through
}

// ── SENDERS ──
// Each returns a result rather than throwing, so one channel failing never
// takes the other down with it.

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return { ok: false, reason: 'RESEND_API_KEY is not set', id: null };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], reply_to: EMAIL_REPLY_TO, subject, html }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: JSON.stringify(body).slice(0, 300), id: null };
    return { ok: true, reason: null, id: body?.id ?? null };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, id: null };
  }
}

async function sendSms(to: string, text: string) {
  if (!SVEVE_USER || !SVEVE_PASSWORD) {
    return { ok: false, reason: 'SVEVE_USER / SVEVE_PASSWORD are not set', id: null, cost: null };
  }
  const number = normalisePhone(to);
  if (!number) return { ok: false, reason: `Unusable phone number: ${to}`, id: null, cost: null };

  // A message that would split into two costs twice and is worth knowing about,
  // but it is not a reason to withhold it from the client.
  const cost = smsLength(text);

  try {
    const url = new URL('https://sveve.no/SMS/SendMessage');
    url.searchParams.set('user', SVEVE_USER);
    url.searchParams.set('passwd', SVEVE_PASSWORD);
    url.searchParams.set('to', number);
    url.searchParams.set('msg', text);
    url.searchParams.set('from', SVEVE_SENDER);
    url.searchParams.set('f', 'json');

    const res = await fetch(url.toString(), { method: 'GET' });
    const body = await res.json().catch(() => ({}));
    const okCount = body?.response?.msgOkCount ?? 0;
    if (!res.ok || okCount < 1) {
      const errs = body?.response?.errors ?? body;
      return { ok: false, reason: JSON.stringify(errs).slice(0, 300), id: null, cost: cost.segments };
    }
    return { ok: true, reason: null, id: String(body?.response?.ids?.[0] ?? ''), cost: cost.segments };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, id: null, cost: cost.segments };
  }
}

// ── HOW MANY MESSAGES ARE LEFT ──
// Credits are prepaid, so they run out. When they do, nothing breaks loudly:
// bookings still work, emails still arrive, and only the SMS quietly stops -
// which the salon finds out about from a client who never got her reminder.
//
// Sveve exposes the remaining count, so the Owner Panel can say so first.
// Deliberately honest about not knowing: a balance that cannot be read comes
// back as an error, never as zero and never as a confident number. "Unknown"
// prompts someone to look; a wrong number does not.
async function smsBalance(): Promise<{ ok: boolean; balance: number | null; reason: string | null }> {
  if (!SVEVE_USER || !SVEVE_PASSWORD) {
    return { ok: false, balance: null, reason: 'SVEVE_USER / SVEVE_PASSWORD are not set' };
  }
  try {
    const url = new URL('https://sveve.no/SMS/AccountAdm');
    url.searchParams.set('cmd', 'sms_count');
    url.searchParams.set('user', SVEVE_USER);
    url.searchParams.set('passwd', SVEVE_PASSWORD);
    const res = await fetch(url.toString(), { method: 'GET' });
    const text = (await res.text()).trim();
    if (!res.ok) return { ok: false, balance: null, reason: `Sveve returned ${res.status}` };
    // The endpoint answers with a bare number. Anything else is an error
    // message, and is passed through rather than coerced into a count.
    const n = Number(text.replace(/[^0-9-]/g, ''));
    if (!/^-?[0-9]+$/.test(text.replace(/[^0-9-]/g, '')) || Number.isNaN(n)) {
      return { ok: false, balance: null, reason: text.slice(0, 200) || 'Empty response' };
    }
    return { ok: true, balance: n, reason: null };
  } catch (e) {
    return { ok: false, balance: null, reason: (e as Error).message };
  }
}

// ── EMPTYING THE QUEUE ──
//
// Each row is claimed by the database before it gets here, so two overlapping
// runs cannot both send the same message. What happens to a row afterwards is
// decided here and written straight back: sent, deferred, or failed. A row is
// never left in "sending" - that is the one state nothing would ever retry.
async function drainOutbox(): Promise<Record<string, unknown>> {
  let rows: any[];
  try {
    rows = await rpcAdmin('claim_due_messages', { p_limit: 20 }) as any[];
  } catch (e) {
    return { ok: false, error: 'Could not claim messages: ' + (e as Error).message };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, claimed: 0, sent: 0 };

  let sent = 0, deferred = 0, failed = 0;

  for (const row of rows) {
    const id = row.id;
    try {
      // Quiet hours move the row rather than dropping it. Nobody is texted at
      // 03:00; the message is still owed and goes out after 08:00. Email is
      // silent, so it is not held back - only the text is.
      const smsWouldSend = !!row.phone && row.sms_consent !== false;
      if (smsWouldSend && !row.email && isQuietHour()) {
        await rpcAdmin('defer_message', { p_id: id, p_until: nextMorningOslo() });
        deferred++;
        continue;
      }

      const language: Lang = row.lang === 'en' ? 'en' : 'no';
      const ctx = (row.context ?? {}) as MessageContext;
      const rendered = renderEmail(row.message_key as MessageKey, ctx, language);
      const smsText = renderSms(row.message_key as MessageKey, ctx, language);

      const results: Record<string, any> = { email: null, sms: null };
      let anyOk = false;
      const problems: string[] = [];

      if (row.email) {
        const r = await sendEmail(row.email, rendered.subject, rendered.html);
        results.email = r;
        if (r.ok) anyOk = true; else problems.push('email: ' + r.reason);
        try {
          await rpcAdmin('record_sent_message', {
            p_booking_id: row.booking_id ?? null, p_extension_order_id: null,
            p_message_key: row.message_key, p_channel: 'email', p_recipient: row.email,
            p_lang: language, p_provider_id: r.id,
            p_status: r.ok ? 'sent' : 'failed', p_error: r.reason, p_cost_ore: null,
          });
        } catch { /* the send is what matters */ }
      }

      // A text only goes to someone who asked for one, and only where the
      // template has something worth 30 øre to say. Six of the thirteen
      // deliberately return null - a receipt by text helps nobody.
      if (smsText && row.phone && row.sms_consent !== false) {
        if (isQuietHour()) {
          results.sms = { ok: false, reason: 'held until morning', held: true };
        } else {
          const r = await sendSms(row.phone, smsText);
          results.sms = r;
          if (r.ok) anyOk = true; else problems.push('sms: ' + r.reason);
          try {
            await rpcAdmin('record_sent_message', {
              p_booking_id: row.booking_id ?? null, p_extension_order_id: null,
              p_message_key: row.message_key, p_channel: 'sms', p_recipient: row.phone,
              p_lang: language, p_provider_id: r.id,
              p_status: r.ok ? 'sent' : 'failed', p_error: r.reason,
              p_cost_ore: r.cost ? r.cost * 30 : null,
            });
          } catch { /* as above */ }
        }
      }

      if (anyOk) {
        await rpcAdmin('mark_message_sent', { p_id: id });
        sent++;
      } else {
        await rpcAdmin('mark_message_failed', { p_id: id, p_error: problems.join('; ') || 'nothing sent' });
        failed++;
      }
    } catch (e) {
      // Any unexpected throw still has to put the row back, or it sits in
      // "sending" and is never retried by anything.
      try { await rpcAdmin('mark_message_failed', { p_id: id, p_error: (e as Error).message }); } catch { /* ignore */ }
      failed++;
    }
  }

  return { ok: true, claimed: rows.length, sent, deferred, failed };
}

// ── THE ENTRY POINT ──
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: 'Expected JSON' }, 400); }

  const { pin, key, action, lang, email, phone, context, bookingId, extensionOrderId, smsConsent } = body;

  // ── THE SCHEDULED DRAIN ──
  // The queue is emptied by a job in the database, which has no staff PIN and
  // should not be given one. It proves itself with a shared secret instead,
  // compared in constant time so a wrong guess tells an attacker nothing by
  // how long the answer took.
  //
  // This path never accepts a recipient from the caller. It reads the address
  // off the queued row, so even with the secret nobody can use this to send
  // the salon's name to an address of their choosing.
  if (action === 'drain') {
    const given = req.headers.get('x-outbox-key') ?? '';
    if (!OUTBOX_SECRET || !timingSafeEqual(given, OUTBOX_SECRET)) {
      return json({ error: 'Not authorised' }, 403);
    }
    return json(await drainOutbox());
  }

  if (!pin) return json({ error: 'pin is required' }, 400);

  // The PIN is checked by the database, which is the only thing that knows it.
  // Without this the function is an open endpoint that will email or text
  // anyone, with the salon's name on it. Checked before the balance too - the
  // credit remaining is a fact about the business, not public information.
  try {
    const ok = await rpc('verify_staff_pin', { p_pin: pin });
    if (ok !== true) return json({ error: 'Invalid PIN' }, 403);
  } catch (e) {
    return json({ error: 'Could not verify PIN: ' + (e as Error).message }, 502);
  }

  // Asking how many are left is not sending anything, so it needs no message
  // key and takes no recipient.
  if (action === 'balance') {
    const b = await smsBalance();
    return json({ ...b, configured: !!(SVEVE_USER && SVEVE_PASSWORD) });
  }

  if (!key) return json({ error: 'key is required' }, 400);

  const language: Lang = lang === 'en' ? 'en' : 'no';
  const ctx = (context ?? {}) as MessageContext;
  const results: Record<string, unknown> = { email: null, sms: null };

  // Extensions arrivals have their own shape - there may be no appointment for
  // them to describe, which is the whole reason they are being sent.
  const isArrival = key === 'extensions_arrived';
  const rendered = isArrival
    ? renderExtensionsArrivedEmail(ctx as any, language)
    : renderEmail(key as MessageKey, ctx, language);
  const smsText = isArrival
    ? renderExtensionsArrivedSms(ctx as any, language)
    : renderSms(key as MessageKey, ctx, language);

  // ── EMAIL ──
  if (email) {
    const r = await sendEmail(email, rendered.subject, rendered.html);
    results.email = r;
    // Recorded whether it worked or not. A failure that leaves no trace is the
    // one nobody fixes.
    try {
      await rpc('record_sent_message', {
        p_booking_id: bookingId ?? null,
        p_extension_order_id: extensionOrderId ?? null,
        p_message_key: key, p_channel: 'email', p_recipient: email, p_lang: language,
        p_provider_id: r.id, p_status: r.ok ? 'sent' : 'failed', p_error: r.reason,
        p_cost_ore: null,
      });
    } catch { /* the send is what matters; a ledger write failing must not undo it */ }
  }

  // ── SMS ──
  // Three things have to be true, and each is a separate reason to hold back.
  if (smsText && phone) {
    if (smsConsent === false) {
      results.sms = { ok: false, reason: 'No SMS consent on file', held: true };
    } else if (isQuietHour()) {
      // Held rather than dropped: the scheduled job picks it up after 08:00.
      results.sms = { ok: false, reason: `Held until 08:00 Oslo time (now ${osloHour()}:00)`, held: true };
    } else {
      const r = await sendSms(phone, smsText);
      results.sms = r;
      try {
        await rpc('record_sent_message', {
          p_booking_id: bookingId ?? null,
          p_extension_order_id: extensionOrderId ?? null,
          p_message_key: key, p_channel: 'sms', p_recipient: phone, p_lang: language,
          p_provider_id: r.id, p_status: r.ok ? 'sent' : 'failed', p_error: r.reason,
          // Sveve bills per segment; recorded in øre so a month can be totalled.
          p_cost_ore: r.cost ? r.cost * 30 : null,
        });
      } catch { /* as above */ }
    }
  }

  const anySent = (results.email as any)?.ok || (results.sms as any)?.ok;
  return json({
    sent: !!anySent,
    // Named so a caller can tell "nothing was configured" from "it was tried
    // and refused", which need different things done about them.
    configured: { email: !!RESEND_API_KEY, sms: !!(SVEVE_USER && SVEVE_PASSWORD) },
    results,
  });
});
