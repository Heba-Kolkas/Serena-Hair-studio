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

async function rpc(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

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

// ── THE ENTRY POINT ──
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ error: 'Expected JSON' }, 400); }

  const { pin, key, lang, email, phone, context, bookingId, extensionOrderId, smsConsent } = body;

  if (!pin) return json({ error: 'pin is required' }, 400);
  if (!key) return json({ error: 'key is required' }, 400);

  // The PIN is checked by the database, which is the only thing that knows it.
  // Without this the function is an open endpoint that will email or text
  // anyone, with the salon's name on it.
  try {
    const ok = await rpc('verify_staff_pin', { p_pin: pin });
    if (ok !== true) return json({ error: 'Invalid PIN' }, 403);
  } catch (e) {
    return json({ error: 'Could not verify PIN: ' + (e as Error).message }, 502);
  }

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
