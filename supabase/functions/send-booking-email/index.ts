// Sends the client an email when the salon confirms or rejects a booking.
//
// WHY THIS RUNS SERVER-SIDE
// The site is static: everything in its JavaScript is readable by anyone who
// opens dev tools. A Resend API key there would be a key anybody could use to
// send mail as Studio Serena. So the key lives as a Supabase secret and only
// this function ever sees it.
//
// SETUP (once, by the owner)
//   1. Create a Resend account and verify studioserena.no — Resend gives you
//      DNS records (a TXT for DKIM, and usually one for SPF) to add wherever
//      the domain's DNS lives. These are additive and don't affect the site.
//   2. supabase secrets set RESEND_API_KEY=re_xxx
//   3. supabase functions deploy send-booking-email
//
// Until step 2 is done the function returns a clear "not configured" error and
// the Owner Panel says the decision was saved but no email went out — the
// booking is never left in a wrong state just because mail is unavailable.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

// Replies should reach the inbox the owner actually reads.
const FROM = Deno.env.get('BOOKING_FROM') ?? 'Studio Serena <bookings@studioserena.no>';
const REPLY_TO = Deno.env.get('BOOKING_REPLY_TO') ?? 'info@studioserena.no';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

function prettyDate(date: string, time: string) {
  const d = new Date(`${date}T${time}`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function shell(inner: string) {
  // Inline styles only: email clients strip <style> blocks and know nothing of
  // modern CSS. Table-free, single column, safe fallback fonts.
  return `<div style="margin:0;padding:24px;background:#faf6ef;font-family:Helvetica,Arial,sans-serif;color:#3f3632;">
  <div style="max-width:520px;margin:0 auto;background:#fdfaf5;border:1px solid #e9e3db;border-radius:14px;padding:28px;">
    <div style="font-size:20px;letter-spacing:0.12em;text-align:center;color:#3f3632;">STUDIO SERENA</div>
    <div style="font-size:11px;letter-spacing:0.3em;text-align:center;color:#9f948e;margin-top:4px;">HAIR</div>
    <div style="height:1px;background:#e9e3db;margin:22px 0;"></div>
    ${inner}
    <div style="height:1px;background:#e9e3db;margin:24px 0 16px;"></div>
    <div style="font-size:12px;color:#9f948e;line-height:1.6;">
      Torshovgata 5H, 0476 Oslo &middot; +47 45 39 76 31<br />
      Reply to this email and it comes straight to us.
    </div>
  </div>
</div>`;
}

function buildEmail(d: Record<string, string>) {
  const when = prettyDate(d.date, d.start_time);
  const ref = String(d.booking_ref ?? '').toUpperCase();

  if (d.decision === 'confirmed') {
    return {
      subject: `Your appointment is confirmed — ${when}`,
      html: shell(`
        <p style="font-size:16px;margin:0 0 14px;">Hi ${esc(d.customer_name)},</p>
        <p style="font-size:15px;line-height:1.65;margin:0 0 18px;">
          Your appointment is <strong>confirmed</strong>. We've checked your consultation and
          deposit, and your extensions are on order. We're looking forward to seeing you.
        </p>
        <div style="background:#f4efe7;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.8;">
          <strong>${esc(d.service_name)}</strong><br />
          ${esc(when)}<br />
          with ${esc(d.staff_name)}<br />
          <span style="color:#9f948e;font-size:13px;">Reference ${esc(ref)}</span>
        </div>
        <p style="font-size:14px;line-height:1.65;color:#6b615c;margin:18px 0 0;">
          Need to change or cancel? Reply to this email or call us — as much notice as you can
          manage, please, so we can offer the time to someone else.
        </p>`),
    };
  }

  return {
    subject: `About your booking request — ${when}`,
    html: shell(`
      <p style="font-size:16px;margin:0 0 14px;">Hi ${esc(d.customer_name)},</p>
      <p style="font-size:15px;line-height:1.65;margin:0 0 18px;">
        Thank you for your request. Unfortunately we're not able to hold this time for you:
      </p>
      <div style="background:#f4efe7;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.8;">
        <strong>${esc(d.service_name)}</strong><br />
        ${esc(when)}<br />
        <span style="color:#9f948e;font-size:13px;">Reference ${esc(ref)}</span>
      </div>
      ${d.reason ? `<p style="font-size:14px;line-height:1.65;margin:16px 0 0;">${esc(d.reason)}</p>` : ''}
      <p style="font-size:14px;line-height:1.65;color:#6b615c;margin:18px 0 0;">
        Extensions need a consultation and a deposit before we can book the fitting. If you
        haven't had yours yet, reply to this email and we'll arrange one — we'd love to get
        you in.
      </p>`),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected JSON' }, 400);
  }

  const { pin, booking_id, decision, reason } = body;
  if (!pin || !booking_id || !decision) {
    return json({ error: 'pin, booking_id and decision are required' }, 400);
  }
  if (decision !== 'confirmed' && decision !== 'rejected') {
    return json({ error: 'decision must be confirmed or rejected' }, 400);
  }

  // The PIN is checked by the database, not here — is_owner_pin is the single
  // place that knows it, and this function never sees the value it's compared
  // against. Without this an open endpoint could email anyone on file.
  const pinRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_owner_pin`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_pin: pin }),
  });
  if (!pinRes.ok || (await pinRes.json()) !== true) {
    return json({ error: 'Invalid owner PIN' }, 403);
  }

  if (!RESEND_API_KEY) {
    // Deliberately not an error the caller should retry: the decision has
    // already been saved, and the owner just needs to be told mail is off.
    return json({ sent: false, reason: 'RESEND_API_KEY is not set' }, 200);
  }

  const details = { ...body, decision, reason: reason ?? '' } as Record<string, string>;
  const { subject, html } = buildEmail(details);

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [details.customer_email],
      reply_to: REPLY_TO,
      subject,
      html,
    }),
  });

  if (!send.ok) {
    const detail = await send.text();
    return json({ sent: false, reason: detail.slice(0, 300) }, 200);
  }

  return json({ sent: true });
});
