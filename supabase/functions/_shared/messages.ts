// Every message Studio Serena sends a client, in Norwegian and English, for
// both channels.
//
// WHY ONE FILE
// A booking's confirmation goes out by email and by SMS, and the two have to
// say the same thing. Keeping them side by side means a change to the wording
// can't update one and forget the other, and a new message can't ship with
// only half its languages — the types below won't compile without all four
// pieces.
//
// THE SMS CONSTRAINT (read before editing any sms string)
// One SMS is 160 characters, but only while every character is in the GSM 03.38
// alphabet. Norwegian æ ø å Æ Ø Å are in it. These are NOT, and a single one
// drops the whole message to a 70-character encoding — so a 150-character text
// silently becomes three messages and costs three times as much:
//
//     –  —  ‘  ’  “  ”  …  →  •  ·  ½  °  and every emoji
//
// Use a plain hyphen, straight quotes, and "1,5 t" rather than "1½ t".
// smsLength() below measures a string the way the network does; the test at
// the bottom of this file fails the build if any message would split.

export type Lang = 'no' | 'en';

export type MessageKey =
  | 'booking_confirmed'
  | 'request_received'
  | 'request_approved'
  | 'request_rejected'
  | 'rescheduled'
  | 'cancelled_by_client'
  | 'cancelled_by_salon'
  | 'reminder'
  | 'waitlist_joined'
  | 'waitlist_opening'
  | 'visit_thank_you'
  | 'no_show_notice'
  | 'invoice';

export interface MessageContext {
  customerName: string;
  serviceName: string;
  staffName: string;
  /** ISO date, e.g. "2026-09-04". */
  date: string;
  /** 24-hour "HH:MM". */
  startTime: string;
  endTime?: string;
  bookingRef?: string;
  /** Free text from the owner — shown on a rejection or a salon cancellation. */
  reason?: string;
  /** Where the client manages the booking. Kept short: it goes in an SMS. */
  manageUrl?: string;
  /** Waitlist: the window they asked to be told about. */
  waitlistWindow?: string;
  /** What was actually rung up. Shown on the thank-you note. */
  amountCharged?: number;
  /** Add-ons as they were priced at the time of booking. */
  addons?: { name: string; price: number }[];
  /** A PDF receipt, once invoicing is live. */
  invoiceUrl?: string;
  /** Invoice: number, amount, and how to pay it. */
  invoiceNumber?: number;
  invoiceAmount?: number;
  invoiceReason?: 'no_show' | 'late_cancellation';
  /** A hosted checkout link, once one exists. */
  payUrl?: string;
  /** Fallback when there is no checkout yet: the salon's Vipps number. */
  vippsNumber?: string;
  dueDays?: number;
  /** A line the salon typed itself, added to a no-show message. */
  ownerNote?: string;
  /** Set on a cancellation made inside the notice period. */
  lateCancellation?: boolean;
  cancellationFee?: number;
  /** True when the price was a "from" and the half is not an exact figure. */
  feeIsEstimate?: boolean;
  noticeHours?: number;
}

/** An extensions order arriving. Deliberately separate from MessageContext:
 *  there is no appointment yet — that is the whole reason this is sent. A
 *  client who has already booked her fitting is told nothing, because the news
 *  changes nothing she does. See staff_extension_orders_at_risk in migration
 *  0007 for the case that does matter: a fitting coming up with no hair. */
export interface ExtensionsArrivedContext {
  customerName: string;
  /** Free text as the stylist typed it, e.g. "6/613 ombre, 50 cm, 100 g". */
  orderDetail?: string;
  /** Where to book. Kept short: it goes in an SMS. */
  bookUrl?: string;
  /** Outstanding balance after the deposit, if there is one. */
  balanceDue?: number;
}

// ── SALON DETAILS ──
// One place, so a change of number doesn't have to be chased through 44
// strings.
export const SALON = {
  name: 'Studio Serena',
  address: 'Torshovgata 5H, 0476 Oslo',
  phone: '+47 45 39 76 31',
  /** Plain digits for tel: links. */
  phoneHref: '+4745397631',
  email: 'info@studioserena.no',
  site: 'studioserena.no',
} as const;

// ── FORMATTING ──

const MONTHS_NO = [
  'januar', 'februar', 'mars', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'desember',
];
const DAYS_NO = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "fredag 4. september kl. 15:00" / "Friday 4 September at 15:00". */
export function longDate(ctx: MessageContext, lang: Lang): string {
  const d = new Date(`${ctx.date}T${ctx.startTime}`);
  const day = d.getDate();
  return lang === 'no'
    ? `${DAYS_NO[d.getDay()]} ${day}. ${MONTHS_NO[d.getMonth()]} kl. ${ctx.startTime}`
    : `${DAYS_EN[d.getDay()]} ${day} ${MONTHS_EN[d.getMonth()]} at ${ctx.startTime}`;
}

/** "fre 4. sep kl. 15:00" — the SMS form, which has to earn every character. */
export function shortDate(ctx: MessageContext, lang: Lang): string {
  const d = new Date(`${ctx.date}T${ctx.startTime}`);
  const day = d.getDate();
  const mNo = MONTHS_NO[d.getMonth()].slice(0, 3);
  const mEn = MONTHS_EN[d.getMonth()].slice(0, 3);
  return lang === 'no'
    ? `${DAYS_NO[d.getDay()].slice(0, 3)} ${day}. ${mNo} ${ctx.startTime}`
    : `${DAYS_EN[d.getDay()].slice(0, 3)} ${day} ${mEn} ${ctx.startTime}`;
}

/** First name only. An SMS has no room for "Ingrid Marie Solberg-Hansen". */
export function firstName(full: string): string {
  return String(full || '').trim().split(/\s+/)[0] || '';
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

// ── SMS LENGTH ──
// Characters that cost two GSM septets rather than one.
const GSM_EXTENDED = '^{}\\[~]|€';
// The single-septet basic set. Anything outside both sets forces UCS-2.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

export interface SmsCost {
  /** Septets if GSM-7, UTF-16 code units if UCS-2. */
  units: number;
  encoding: 'GSM-7' | 'UCS-2';
  /** How many messages the network will actually bill for. */
  segments: number;
  /** The characters that forced UCS-2, if any. Empty when GSM-7. */
  offenders: string[];
}

export function smsLength(text: string): SmsCost {
  const offenders: string[] = [];
  let units = 0;
  for (const ch of text) {
    if (GSM_EXTENDED.includes(ch)) units += 2;
    else if (GSM_BASIC.includes(ch)) units += 1;
    else { offenders.push(ch); units += 1; }
  }
  if (offenders.length) {
    const u = [...text].length;
    return {
      units: u,
      encoding: 'UCS-2',
      segments: u <= 70 ? 1 : Math.ceil(u / 67),
      offenders: [...new Set(offenders)],
    };
  }
  return {
    units,
    encoding: 'GSM-7',
    segments: units <= 160 ? 1 : Math.ceil(units / 153),
    offenders: [],
  };
}

// ── EMAIL SHELL ──
// Inline styles only: email clients strip <style> blocks and know nothing of
// modern CSS. Single column, no tables, fonts that exist everywhere. The
// palette matches the salon's own site.

function shell(inner: string, lang: Lang): string {
  const footer = lang === 'no'
    ? `${SALON.address}<br />${SALON.phone}<br />Svar på denne e-posten, så kommer den rett til oss.`
    : `${SALON.address}<br />${SALON.phone}<br />Reply to this email and it comes straight to us.`;
  return `<div style="margin:0;padding:24px;background:#faf6ef;font-family:Helvetica,Arial,sans-serif;color:#3f3632;">
  <div style="max-width:520px;margin:0 auto;background:#fdfaf5;border:1px solid #e9e3db;border-radius:14px;padding:28px;">
    <div style="font-size:20px;letter-spacing:0.12em;text-align:center;color:#3f3632;">STUDIO SERENA</div>
    <div style="font-size:11px;letter-spacing:0.3em;text-align:center;color:#9f948e;margin-top:4px;">HAIR</div>
    <div style="height:1px;background:#e9e3db;margin:22px 0;"></div>
    ${inner}
    <div style="height:1px;background:#e9e3db;margin:24px 0 16px;"></div>
    <div style="font-size:12px;color:#9f948e;line-height:1.6;">${footer}</div>
  </div>
</div>`;
}

const p = (text: string) =>
  `<p style="font-size:15px;line-height:1.65;margin:0 0 16px;">${text}</p>`;

const greeting = (name: string, lang: Lang) =>
  `<p style="font-size:16px;margin:0 0 14px;">${lang === 'no' ? 'Hei' : 'Hi'} ${esc(firstName(name))},</p>`;

/** The appointment, boxed. Struck through when the booking no longer stands. */
function detailBox(ctx: MessageContext, lang: Lang, struck = false): string {
  const s = struck ? 'text-decoration:line-through;opacity:0.65;' : '';
  const ref = ctx.bookingRef
    ? `<span style="color:#9f948e;font-size:13px;">${lang === 'no' ? 'Referanse' : 'Reference'} ${esc(String(ctx.bookingRef).toUpperCase())}</span>`
    : '';
  return `<div style="background:#f4efe7;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.8;${s}">
    <strong>${esc(ctx.serviceName)}</strong><br />
    ${esc(longDate(ctx, lang))}<br />
    ${lang === 'no' ? 'hos' : 'with'} ${esc(ctx.staffName)}<br />
    ${ref}
  </div>`;
}

/** What the visit consisted of, and what was paid. The service and its add-ons
 *  are listed separately so the number at the bottom is never a mystery — that
 *  matters most on the services priced "from", where the final amount is only
 *  settled in the chair. */
function receiptBox(ctx: MessageContext, lang: Lang): string {
  const rows = [
    `<tr><td style="padding:2px 0;">${esc(ctx.serviceName)}</td><td></td></tr>`,
    ...(ctx.addons || []).map((a) =>
      `<tr><td style="padding:2px 0;color:#6b615c;">+ ${esc(a.name)}</td><td></td></tr>`),
  ].join('');
  const paid = lang === 'no' ? 'Betalt' : 'Paid';
  const total = typeof ctx.amountCharged === 'number'
    ? `${ctx.amountCharged.toLocaleString('nb-NO')} NOK`
    : '';
  return `<div style="background:#f4efe7;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.7;">
    <table style="width:100%;border-collapse:collapse;font-size:15px;">${rows}</table>
    <div style="height:1px;background:#e2d9cc;margin:12px 0;"></div>
    <div style="display:flex;justify-content:space-between;font-size:16px;">
      <strong>${paid}</strong> <strong>${esc(total)}</strong>
    </div>
    ${ctx.bookingRef ? `<div style="color:#9f948e;font-size:13px;margin-top:8px;">${lang === 'no' ? 'Referanse' : 'Reference'} ${esc(String(ctx.bookingRef).toUpperCase())}</div>` : ''}
  </div>`;
}

const button = (url: string, label: string) =>
  `<div style="margin:22px 0 6px;"><a href="${esc(url)}" style="display:inline-block;background:#3f3632;color:#fdfaf5;text-decoration:none;font-size:14px;letter-spacing:0.04em;padding:12px 22px;border-radius:8px;">${esc(label)}</a></div>`;

const smallPrint = (text: string) =>
  `<p style="font-size:14px;line-height:1.65;color:#6b615c;margin:18px 0 0;">${text}</p>`;

// ── THE MESSAGES ──

export interface Rendered {
  subject: string;
  html: string;
}

type Builder = (ctx: MessageContext, lang: Lang) => Rendered;

const EMAILS: Record<MessageKey, Builder> = {
  // Booked and confirmed on the spot — everything except extensions.
  booking_confirmed: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Timen din er bekreftet - ${longDate(ctx, lang)}`
      : `Your appointment is confirmed - ${longDate(ctx, lang)}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? 'Timen din er <strong>bekreftet</strong>. Vi gleder oss til å se deg.'
        : 'Your appointment is <strong>confirmed</strong>. We are looking forward to seeing you.')
      + detailBox(ctx, lang)
      + (ctx.manageUrl ? button(ctx.manageUrl, lang === 'no' ? 'Se eller endre timen' : 'View or change booking') : '')
      + smallPrint(lang === 'no'
        ? 'Trenger du å endre eller avlyse? Svar på denne e-posten eller ring oss - så tidlig du kan, så vi rekker å tilby tiden til noen andre.'
        : 'Need to change or cancel? Reply to this email or call us - as much notice as you can manage, so we can offer the time to someone else.'),
      lang,
    ),
  }),

  // Extensions: a request, not a booking. The slot is held for two days.
  request_received: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Forespørselen din er mottatt - ${longDate(ctx, lang)}`
      : `We have your request - ${longDate(ctx, lang)}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? 'Takk for forespørselen. Extensions krever konsultasjon og depositum før vi kan sette av tiden, så denne er <strong>ikke bekreftet ennå</strong> - vi sjekker og gir deg beskjed.'
        : 'Thank you for your request. Extensions need a consultation and a deposit before we can hold the time, so this is <strong>not confirmed yet</strong> - we will check and let you know.')
      + detailBox(ctx, lang)
      + p(lang === 'no'
        ? 'Vi holder tiden for deg i <strong>to dager</strong> mens vi ser på det. Har du ikke hatt konsultasjon ennå, svar på denne e-posten, så avtaler vi en.'
        : 'We are holding the time for you for <strong>two days</strong> while we look at it. If you have not had your consultation yet, reply to this email and we will arrange one.')
      + smallPrint(lang === 'no'
        ? 'Du får en e-post og en SMS så snart vi har bekreftet.'
        : 'You will get an email and a text as soon as we confirm.'),
      lang,
    ),
  }),

  request_approved: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Timen din er bekreftet - ${longDate(ctx, lang)}`
      : `Your appointment is confirmed - ${longDate(ctx, lang)}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? 'Timen din er <strong>bekreftet</strong>. Vi har konsultasjonen og depositumet på plass, og extensions er bestilt.'
        : 'Your appointment is <strong>confirmed</strong>. We have your consultation and deposit, and your extensions are on order.')
      + detailBox(ctx, lang)
      + (ctx.manageUrl ? button(ctx.manageUrl, lang === 'no' ? 'Se timen' : 'View booking') : '')
      + smallPrint(lang === 'no'
        ? 'Dette er en lang time, så gi oss beskjed så tidlig som mulig hvis noe endrer seg.'
        : 'This is a long appointment, so please tell us as early as you can if anything changes.'),
      lang,
    ),
  }),

  request_rejected: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Om forespørselen din - ${longDate(ctx, lang)}`
      : `About your request - ${longDate(ctx, lang)}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? 'Takk for forespørselen. Dessverre kan vi ikke holde denne tiden for deg:'
        : 'Thank you for your request. Unfortunately we are not able to hold this time for you:')
      + detailBox(ctx, lang, true)
      + (ctx.reason ? p(esc(ctx.reason)) : '')
      + p(lang === 'no'
        ? 'Extensions krever konsultasjon og depositum før vi kan sette av tiden. Har du ikke hatt konsultasjon ennå, svar på denne e-posten - vi vil veldig gjerne få deg inn.'
        : 'Extensions need a consultation and a deposit before we can book the fitting. If you have not had yours yet, reply to this email and we will arrange one - we would love to get you in.')
      + smallPrint(lang === 'no'
        ? `Du kan også ringe oss på ${SALON.phone}.`
        : `You can also call us on ${SALON.phone}.`),
      lang,
    ),
  }),

  rescheduled: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Timen din er flyttet - ny tid ${longDate(ctx, lang)}`
      : `Your appointment has moved - now ${longDate(ctx, lang)}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? 'Vi har måttet flytte timen din. Den nye tiden er:'
        : 'We have had to move your appointment. The new time is:')
      + detailBox(ctx, lang)
      + (ctx.reason ? p(esc(ctx.reason)) : '')
      + p(lang === 'no'
        ? 'Passer ikke den nye tiden? Svar på denne e-posten eller ring oss, så finner vi noe annet.'
        : 'If the new time does not suit you, reply to this email or call us and we will find another.')
      + (ctx.manageUrl ? button(ctx.manageUrl, lang === 'no' ? 'Se timen' : 'View booking') : '')
      + smallPrint(lang === 'no' ? 'Beklager bryet.' : 'Sorry for the inconvenience.'),
      lang,
    ),
  }),

  cancelled_by_client: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Timen din er avlyst - ${longDate(ctx, lang)}`
      : `Your appointment is cancelled - ${longDate(ctx, lang)}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no' ? 'Denne timen er nå avlyst:' : 'This appointment is now cancelled:')
      + detailBox(ctx, lang, true)
      + p(lang === 'no'
        ? 'Takk for at du ga beskjed - da kan vi tilby tiden til noen andre.'
        : 'Thank you for letting us know - that lets us offer the time to someone else.')
      // Only on a late cancellation, and worded as a fact rather than a
      // telling-off: she was shown this figure before she confirmed, so the
      // email is a record, not a surprise.
      + (ctx.lateCancellation
        ? `<div style="background:#f7efe9;border:1px solid #e4cfc4;border-radius:10px;padding:16px 18px;">
             <div style="font-size:14px;font-weight:bold;margin-bottom:6px;">${lang === 'no' ? 'Avbestilling på kort varsel' : 'Cancelled at short notice'}</div>
             <div style="font-size:14px;line-height:1.6;color:#6b615c;">${lang === 'no'
               ? `Denne timen ble avbestilt mindre enn ${ctx.noticeHours ?? 48} timer før. Da gjelder halv pris etter avbestillingsreglene våre${typeof ctx.cancellationFee === 'number' ? `, som er <strong>${ctx.cancellationFee.toLocaleString('nb-NO')} NOK</strong>${ctx.feeIsEstimate ? ' (omtrentlig - vi bekrefter beløpet)' : ''}` : ''}. Beløpet legges til ved neste besøk.`
               : `This appointment was cancelled less than ${ctx.noticeHours ?? 48} hours ahead, so our half-price cancellation policy applies${typeof ctx.cancellationFee === 'number' ? `, which comes to <strong>${ctx.cancellationFee.toLocaleString('nb-NO')} NOK</strong>${ctx.feeIsEstimate ? ' (approximate - we will confirm the amount)' : ''}` : ''}. It will be added to your next visit.`}</div>
           </div>`
        : '')
      + smallPrint(lang === 'no'
        ? `Vil du booke på nytt, finner du oss på ${SALON.site}.`
        : `To book again, find us at ${SALON.site}.`),
      lang,
    ),
  }),

  cancelled_by_salon: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Vi må dessverre avlyse - ${longDate(ctx, lang)}`
      : `We have to cancel - ${longDate(ctx, lang)}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? 'Vi er veldig lei oss - vi må avlyse denne timen:'
        : 'We are very sorry - we have to cancel this appointment:')
      + detailBox(ctx, lang, true)
      + (ctx.reason ? p(esc(ctx.reason)) : '')
      + p(lang === 'no'
        ? 'Ring oss, så finner vi en ny tid til deg så raskt vi kan. Vi setter deg fremst i køen.'
        : 'Call us and we will find you a new time as soon as we can. We will put you at the front of the queue.')
      + button(`tel:${SALON.phoneHref}`, lang === 'no' ? `Ring ${SALON.phone}` : `Call ${SALON.phone}`),
      lang,
    ),
  }),

  // Email exists for the record; the reminder that actually gets read is the SMS.
  reminder: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Påminnelse: timen din i morgen ${ctx.startTime}`
      : `Reminder: your appointment tomorrow at ${ctx.startTime}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no' ? 'En liten påminnelse om timen din i morgen:' : 'A quick reminder about your appointment tomorrow:')
      + detailBox(ctx, lang)
      + smallPrint(lang === 'no'
        ? `Kan du ikke komme, ring oss på ${SALON.phone} så snart som mulig.`
        : `If you cannot make it, please call us on ${SALON.phone} as soon as you can.`),
      lang,
    ),
  }),

  // The nudge matters more than the confirmation: a waitlist place is not an
  // appointment, and saying so plainly is what stops a disappointed client.
  waitlist_joined: (ctx, lang) => ({
    subject: lang === 'no' ? 'Du står på ventelisten' : 'You are on the waiting list',
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? `Vi har notert at du ønsker <strong>${esc(ctx.serviceName)}</strong>${ctx.waitlistWindow ? ` ${esc(ctx.waitlistWindow)}` : ''}. Blir en tid ledig, sier vi fra med en gang - på e-post og SMS.`
        : `We have noted that you would like <strong>${esc(ctx.serviceName)}</strong>${ctx.waitlistWindow ? ` ${esc(ctx.waitlistWindow)}` : ''}. If a time opens up we will tell you straight away, by email and text.`)
      + `<div style="background:#f7efe9;border:1px solid #e4cfc4;border-radius:10px;padding:16px 18px;margin:4px 0 4px;">
          <div style="font-size:14px;font-weight:bold;margin-bottom:6px;">${lang === 'no' ? 'Men vent med å regne med det' : 'One thing worth knowing'}</div>
          <div style="font-size:14px;line-height:1.6;color:#6b615c;">${lang === 'no'
            ? 'En plass på ventelisten er ikke en time. Det kan hende ingen avlyser, og da har vi dessverre ingenting å tilby deg. Vil du være sikker, book en time som er ledig nå - står du på ventelisten i tillegg, tilbyr vi deg å bytte hvis noe bedre dukker opp.'
            : 'A place on the waiting list is not an appointment. It is possible that nobody cancels, and then we will have nothing to offer you. If you want to be sure, book a time that is free now - stay on the list as well and we will offer you the swap if something better opens up.'}</div>
        </div>`
      + (ctx.manageUrl ? button(ctx.manageUrl, lang === 'no' ? 'Se ledige tider' : 'See available times') : '')
      + smallPrint(lang === 'no'
        ? 'Vil du av ventelisten, svar på denne e-posten.'
        : 'To come off the list, just reply to this email.'),
      lang,
    ),
  }),

  waitlist_opening: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Ledig tid: ${longDate(ctx, lang)}`
      : `A time has opened: ${longDate(ctx, lang)}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? 'En tid ble nettopp ledig, og den passer det du står på ventelisten for:'
        : 'A time has just come free, and it matches what you are waiting for:')
      + detailBox(ctx, lang)
      + p(lang === 'no'
        ? 'Vi tilbyr tiden til noen få om gangen. <strong>Du har to timer før vi sier fra til flere</strong> - men tiden er din like lenge den står ledig, så du mister den ikke etter to timer. Den går rett og slett til den som booker først.'
        : 'We offer the time to a few people at a time. <strong>You have two hours before we tell anyone else</strong> - but it stays yours to take for as long as it is free, so you do not lose it after two hours. It simply goes to whoever books first.')
      + (ctx.manageUrl ? button(ctx.manageUrl, lang === 'no' ? 'Book denne tiden' : 'Book this time') : '')
      + smallPrint(lang === 'no'
        ? 'Har du allerede en time hos oss og vil bytte til denne, book den her - så frigjør vi den gamle tiden for deg.'
        : 'If you already have a booking with us and want to swap to this one, book it here and we will release your old time.'),
      lang,
    ),
  }),

  // Only ever sent when the salon has explicitly asked for it. Never automatic:
  // a missed appointment has a reason behind it more often than not, and a
  // machine sending an invoice to someone whose morning fell apart is how a
  // salon loses a client it could have kept. So the panel asks first, and
  // whoever knows the client decides.
  //
  // Written to leave the door open rather than to close it.
  no_show_notice: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Vi savnet deg - ${longDate(ctx, lang)}`
      : `We missed you - ${longDate(ctx, lang)}`,
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? 'Vi hadde satt av tid til deg i dag, men du kom dessverre ikke. Vi håper alt står bra til.'
        : 'We had time set aside for you today and you were not able to make it. We hope everything is alright.')
      + detailBox(ctx, lang, true)
      + (ctx.ownerNote ? p(esc(ctx.ownerNote)) : '')
      + (typeof ctx.cancellationFee === 'number'
        ? `<div style="background:#f7efe9;border:1px solid #e4cfc4;border-radius:10px;padding:16px 18px;">
             <div style="font-size:14px;line-height:1.6;color:#6b615c;">${lang === 'no'
               ? `Etter avbestillingsreglene du godtok da du booket, faktureres halve prisen ved uteblivelse - <strong>${ctx.cancellationFee.toLocaleString('nb-NO')} NOK</strong>. Ta kontakt med oss hvis det var noe som kom i veien, så finner vi ut av det sammen.`
               : `Under the cancellation policy you agreed to when booking, half the price applies when an appointment is missed - <strong>${ctx.cancellationFee.toLocaleString('nb-NO')} NOK</strong>. Do get in touch if something got in the way and we will sort it out together.`}</div>
           </div>`
        : '')
      + smallPrint(lang === 'no'
        ? `Vil du booke en ny tid, er du hjertelig velkommen - ${SALON.site} eller ring ${SALON.phone}.`
        : `You are very welcome to book again - ${SALON.site} or call ${SALON.phone}.`),
      lang,
    ),
  }),

  // The invoice. Sent by hand, never automatically.
  //
  // Two ways to pay, and which one shows depends only on whether a hosted
  // checkout exists yet. Before then it is a Vipps number and a reference,
  // which most Norwegian clients can settle in about ten seconds — that is
  // worth more than waiting for an integration.
  invoice: (ctx, lang) => ({
    subject: lang === 'no'
      ? `Faktura ${ctx.invoiceNumber ?? ''} - Studio Serena`.trim()
      : `Invoice ${ctx.invoiceNumber ?? ''} - Studio Serena`.trim(),
    html: shell(
      greeting(ctx.customerName, lang)
      + p(ctx.invoiceReason === 'no_show'
        ? (lang === 'no'
          ? 'Vi hadde satt av tid til deg, men du kom dessverre ikke. Etter avbestillingsreglene du godtok da du booket, faktureres halve prisen.'
          : 'We had time set aside for you and you were not able to come. Under the cancellation policy you agreed to when booking, half the price applies.')
        : (lang === 'no'
          ? 'Timen din ble avbestilt mindre enn 48 timer før. Etter avbestillingsreglene du godtok da du booket, faktureres halve prisen.'
          : 'Your appointment was cancelled less than 48 hours ahead. Under the cancellation policy you agreed to when booking, half the price applies.'))
      + `<div style="background:#f4efe7;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.8;">
          <strong>${esc(ctx.serviceName)}</strong><br />
          ${esc(longDate(ctx, lang))}<br />
          <div style="height:1px;background:#e2d9cc;margin:12px 0;"></div>
          <div style="display:flex;justify-content:space-between;font-size:17px;">
            <strong>${lang === 'no' ? 'Å betale' : 'To pay'}</strong>
            <strong>${typeof ctx.invoiceAmount === 'number' ? ctx.invoiceAmount.toLocaleString('nb-NO') : ''} NOK</strong>
          </div>
          ${ctx.invoiceNumber != null
            ? `<div style="color:#9f948e;font-size:13px;margin-top:8px;">${lang === 'no' ? 'Fakturanr.' : 'Invoice no.'} ${ctx.invoiceNumber}${ctx.bookingRef ? ` · ${lang === 'no' ? 'ref' : 'ref'} ${esc(String(ctx.bookingRef).toUpperCase())}` : ''}</div>`
            : ''}
        </div>`
      + (ctx.payUrl
        ? button(ctx.payUrl, lang === 'no' ? 'Betal nå' : 'Pay now')
        : (ctx.vippsNumber
          ? p(lang === 'no'
            ? `Enklest med <strong>Vipps til ${esc(ctx.vippsNumber)}</strong> - skriv <strong>${esc(String(ctx.bookingRef || ctx.invoiceNumber || '').toUpperCase())}</strong> i meldingen, så vet vi at det er deg.`
            : `Easiest with <strong>Vipps to ${esc(ctx.vippsNumber)}</strong> - put <strong>${esc(String(ctx.bookingRef || ctx.invoiceNumber || '').toUpperCase())}</strong> in the message so we know it is you.`)
          : ''))
      + smallPrint(lang === 'no'
        ? `Betal gjerne innen ${ctx.dueDays ?? 14} dager. Var det noe som kom i veien? Svar på denne e-posten eller ring ${SALON.phone} - vi vil helst finne ut av det sammen.`
        : `Please settle within ${ctx.dueDays ?? 14} days. Did something get in the way? Reply to this email or call ${SALON.phone} - we would much rather sort it out together.`),
      lang,
    ),
  }),

  // Sent once the visit is marked paid. Warm, short, and carries the receipt —
  // the client asked what they paid often enough that it belongs here rather
  // than only in the salon's books.
  visit_thank_you: (ctx, lang) => ({
    subject: lang === 'no'
      ? 'Takk for besøket hos Studio Serena'
      : 'Thank you for visiting Studio Serena',
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? `Takk for at du kom innom i dag - det var hyggelig å ha deg her. Vi håper du er fornøyd med håret ditt${ctx.staffName ? `, og ${esc(firstName(ctx.staffName))} sier takk for seg` : ''}.`
        : `Thank you for coming in today - it was lovely to have you. We hope you are happy with your hair${ctx.staffName ? `, and ${esc(firstName(ctx.staffName))} says thank you` : ''}.`)
      + receiptBox(ctx, lang)
      + (ctx.invoiceUrl ? button(ctx.invoiceUrl, lang === 'no' ? 'Last ned kvittering' : 'Download receipt') : '')
      + p(lang === 'no'
        ? 'Vil du booke neste gang med en gang, finner du oss på ' + SALON.site + '.'
        : 'To book your next visit, find us at ' + SALON.site + '.')
      + smallPrint(lang === 'no'
        ? 'Er det noe du ikke er fornøyd med, si fra til oss - svar på denne e-posten eller ring. Vi vil gjerne vite det, og vi ordner opp.'
        : 'If there is anything you are not happy with, tell us - reply to this email or call. We would genuinely rather know, and we will put it right.'),
      lang,
    ),
  }),

};

// ── SMS ──
// Every one of these is checked against smsLength() by the test below. The
// salon name leads, because Norwegian networks show an alphanumeric sender
// only sometimes and a client should know who is texting them.

const SMS: Record<MessageKey, (ctx: MessageContext, lang: Lang) => string | null> = {
  booking_confirmed: (c, l) => l === 'no'
    ? `Studio Serena: timen din er bekreftet. ${c.serviceName}, ${shortDate(c, l)}, hos ${firstName(c.staffName)}. Ma du endre? Ring ${SALON.phone}.`
    : `Studio Serena: your appointment is confirmed. ${c.serviceName}, ${shortDate(c, l)}, with ${firstName(c.staffName)}. Need to change? Call ${SALON.phone}.`,

  // Email only. It is not urgent, and the two-day hold, the consultation and
  // the deposit all need more room than 160 characters to explain properly.
  request_received: () => null,

  request_approved: (c, l) => l === 'no'
    ? `Studio Serena: timen din er bekreftet. ${shortDate(c, l)} hos ${firstName(c.staffName)}. Vi gleder oss!`
    : `Studio Serena: your appointment is confirmed. ${shortDate(c, l)} with ${firstName(c.staffName)}. See you then!`,

  // A rejection needs room to explain and somewhere to reply. Email only.
  request_rejected: () => null,

  rescheduled: (c, l) => l === 'no'
    ? `Studio Serena: timen din er flyttet til ${shortDate(c, l)}. Passer det ikke, ring ${SALON.phone}.`
    : `Studio Serena: your appointment has moved to ${shortDate(c, l)}. If that does not suit, call ${SALON.phone}.`,

  // They just did it themselves; the email is the receipt.
  cancelled_by_client: () => null,

  cancelled_by_salon: (c, l) => l === 'no'
    ? `Studio Serena: vi ma dessverre avlyse timen din ${shortDate(c, l)}. Vi er lei oss. Ring ${SALON.phone}, sa finner vi ny tid.`
    : `Studio Serena: we are very sorry, we have to cancel your appointment on ${shortDate(c, l)}. Call ${SALON.phone} and we will find a new time.`,

  reminder: (c, l) => l === 'no'
    ? `Studio Serena: vi ses i morgen kl. ${c.startTime} hos ${firstName(c.staffName)}. ${SALON.address}. Kan du ikke komme, ring ${SALON.phone}.`
    : `Studio Serena: see you tomorrow at ${c.startTime} with ${firstName(c.staffName)}. ${SALON.address}. If you cannot make it, call ${SALON.phone}.`,

  // Joining is not urgent, and the nudge needs more room than an SMS has.
  waitlist_joined: () => null,

  waitlist_opening: (c, l) => l === 'no'
    ? `Studio Serena: ledig tid ${shortDate(c, l)}, ${c.serviceName}. Forst til molla - book her: ${c.manageUrl || SALON.site}`
    : `Studio Serena: a time opened ${shortDate(c, l)}, ${c.serviceName}. First to book gets it: ${c.manageUrl || SALON.site}`,

  // Email only: an invoice needs an amount, a reference and a way to pay, and
  // a text about money owed reads as a debt collector.
  invoice: () => null,

  // Email only. This one needs room to be kind, and a text about money owed
  // arriving on the day she missed her appointment reads as a debt collector.
  no_show_notice: () => null,

  // A thank-you is not urgent, and an SMS for it is money spent on nothing.
  visit_thank_you: () => null,

};

// ── PUBLIC API ──

export function renderEmail(key: MessageKey, ctx: MessageContext, lang: Lang): Rendered {
  return EMAILS[key](ctx, lang);
}

/** Null where the message deliberately has no SMS form. */
export function renderSms(key: MessageKey, ctx: MessageContext, lang: Lang): string | null {
  return SMS[key](ctx, lang);
}

// ── EXTENSIONS HAVE ARRIVED ──
// Two versions of the same news. If the fitting is already booked, asking her
// to book again is confusing and risks a second appointment; she just needs to
// know it is on track. If it is not booked, the whole point of the message is
// to get her booked while she is reading it.

export function renderExtensionsArrivedEmail(
  ctx: ExtensionsArrivedContext, lang: Lang,
): Rendered {
  const detail = ctx.orderDetail
    ? `<div style="background:#f4efe7;border-radius:10px;padding:16px 18px;font-size:15px;line-height:1.7;">
        <strong>${lang === 'no' ? 'Bestillingen din' : 'Your order'}</strong><br />
        ${esc(ctx.orderDetail)}
        ${typeof ctx.balanceDue === 'number' && ctx.balanceDue > 0
          ? `<div style="margin-top:10px;color:#6b615c;font-size:14px;">${lang === 'no' ? 'Rest å betale' : 'Balance to pay'}: <strong>${ctx.balanceDue.toLocaleString('nb-NO')} NOK</strong></div>`
          : ''}
      </div>`
    : '';

  return {
    subject: lang === 'no'
      ? 'Extensions-bestillingen din har kommet'
      : 'Your extensions have arrived',
    html: shell(
      greeting(ctx.customerName, lang)
      + p(lang === 'no'
        ? 'Gode nyheter - <strong>extensions-bestillingen din har kommet</strong>.'
        : 'Good news - <strong>your extensions have arrived</strong>.')
      + detail
      + p(lang === 'no'
        ? 'Nå er det bare å finne en tid som passer deg for selve påsettingen.'
        : 'All that is left is to find a time that suits you for the fitting.')
      + (ctx.bookUrl ? button(ctx.bookUrl, lang === 'no' ? 'Book påsetting' : 'Book your fitting') : '')
      + smallPrint(lang === 'no'
        ? `Spørsmål? Svar på denne e-posten eller ring ${SALON.phone}.`
        : `Any questions? Reply to this email or call ${SALON.phone}.`),
      lang,
    ),
  };
}

export function renderExtensionsArrivedSms(
  ctx: ExtensionsArrivedContext, lang: Lang,
): string {
  return lang === 'no'
    ? `Studio Serena: extensions dine har kommet! Book pasetting her: ${ctx.bookUrl || SALON.site}`
    : `Studio Serena: your extensions have arrived! Book your fitting here: ${ctx.bookUrl || SALON.site}`;
}

export const MESSAGE_KEYS = Object.keys(EMAILS) as MessageKey[];
