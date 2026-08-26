import { fetchBookableStaff } from '/js/supabase-client.js';

// Static fallback mirrors supabase/migrations/0002_seed_data.sql so the page
// still looks complete while the database is paused/unreachable.
// A blank line between paragraphs, built from char codes rather than an
// escape sequence, because escapes get mangled writing to this file.
const PARA = String.fromCharCode(10, 10);

const FALLBACK_STAFF = [
  { name: 'Hassan K.', role: 'Founder & Master Stylist', role_no: 'Grunnlegger & Mesterstylisten',
    bio: '25+ years of luxury experience across Oslo and Lebanon. A master of balayage and extensions, with an expert touch across every discipline.',
    bio_no: '25+ års luksuserfaring fra Oslo og Libanon. En mester innen balayage og extensions.',
    photo_url: './html/Pics/Team/Hassan.jpeg', instagram: 'https://www.instagram.com/studioserena.hair?igsh=YnZhMmU2ZDRhNDI2&utm_source=qr', bookable: true },
  { name: 'Kani M.', role: 'Senior Stylist & Makeup Artist', role_no: 'Senior Stylisten & Makeup Artist',
    bio: '8+ years of experience. Specialist in balayage, bridal artistry, makeup, and styling for all-including hijabis.',
    bio_no: '8+ års erfaring. Spesialist på balayage, brudestyling, makeup, og styling for alle.',
    photo_url: './html/Pics/Team/Kani.jpeg', instagram: 'https://www.instagram.com/hairgasmofficial?igsh=b3poaWo2dTZwOXo4', bookable: true },
  { name: 'Taniya S.', role: 'Keratin & Hair Treatment Specialist', role_no: 'Keratin & Hårbehandlingsspesialist',
    bio: 'Extensive luxury experience. A highly talented specialist in Keratin and restorative hair treatments for all clients-including hijabis.',
    bio_no: 'Omfattende luksuserfaring. En svært talentfull spesialist på Keratin og gjenoppbyggende hårbehandlinger.',
    photo_url: './html/Pics/Team/Taniya.jpeg', instagram: 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu',
    // Keratin and Hair Botox are booked with Taniya directly over Instagram,
    // not through the wizard — same hand-off Pati has for nails via Timma.
    bookable: false, external_booking_url: 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu',
    external_booking_label: 'Book on Instagram' },
  { name: 'Pati', role: 'Nail Artist', role_no: 'Neglekunstner',
    bio_short: 'Ten years of gel, extensions and nail art.',
    bio_short_no: 'Ti års erfaring med gele, forlengelse og neglekunst.',
    bio: [
      'With over 10 years of experience in the nail industry, I am passionate about creating beautiful, precise, and long-lasting nails tailored to each client.',
      'Throughout my career, I have completed several professional training courses and earned multiple certifications, continuously developing my skills and staying up to date with the latest techniques and trends.',
      'My certifications include training in gel manicure, nail extensions, nail art and design, e-file techniques, as well as hygiene and safety standards.',
      'For me, nail styling is not only about beautiful results, it is about precision, quality, attention to detail, and making every client feel confident and well cared for.',
    ].join(PARA),
    bio_no: [
      'Med over 10 års erfaring i neglebransjen brenner jeg for å skape vakre, presise og holdbare negler tilpasset hver enkelt kunde.',
      'Gjennom karrieren har jeg fullført flere profesjonelle kurs og tatt en rekke sertifiseringer, og utvikler meg kontinuerlig for å holde meg oppdatert på de nyeste teknikkene og trendene.',
      'Sertifiseringene mine omfatter gelemanikyr, neglforlengelse, neglekunst og design, e-fil-teknikker samt hygiene- og sikkerhetsstandarder.',
      'For meg handler negledesign ikke bare om et vakkert resultat, det handler om presisjon, kvalitet, sans for detaljer, og at hver kunde skal føle seg trygg og godt ivaretatt.',
    ].join(PARA),
    photo_url: './html/Pics/Team/Pati.jpeg', instagram: 'https://www.instagram.com/studio.serena.nailsbypati?igsh=amFoY2Y2bTAzbTZq',
    bookable: false, external_booking_url: 'https://timma.no/salong/patrycja-neglebar' },
  { name: 'Heba K.', role: 'Creative Lead & Communications', role_no: 'Creative Lead & Kommunikasjon',
    bio: 'Specializing in digital artistry and high-end client relations. The architect of our online world and the voice behind every appointment.',
    bio_no: 'Spesialist innen digital kreativitet og førsteklasses kunderelasjoner.',
    photo_url: './html/Pics/Team/Heba.jpeg', instagram: 'https://www.instagram.com/hebakolkas', bookable: false,
    message_url: 'https://www.instagram.com/hebakolkas' },
];

function lang() { return (window._getLang && window._getLang()) || 'en'; }

/** The line shown on a card. A written short version wins over an automatic
 *  cut, which only ever says whatever happened to fall inside the budget. */
function cardBio(member) {
  const no = lang() === 'no';
  const short = no && member.bio_short_no ? member.bio_short_no : member.bio_short;
  if (short) return short;
  return shortBio(no && member.bio_no ? member.bio_no : member.bio);
}

function cardHtml(member) {
  const role = lang() === 'no' && member.role_no ? member.role_no : member.role;
  const bio = lang() === 'no' && member.bio_no ? member.bio_no : member.bio;
  let cta = '';
  if (member.external_booking_url) {
    const label = member.external_booking_label || 'Book on Timma';
    cta = `<a href="${member.external_booking_url}" class="btn-book-now team-card-cta" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-calendar-check"></i><span>${label}</span></a>`;
  } else if (member.message_url) {
    cta = `<a href="${member.message_url}" class="btn-book-now team-card-cta" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-comment-dots"></i><span>Message ${member.name.split(' ')[0]}</span></a>`;
  } else if (member.bookable) {
    cta = `<a href="/book.html" class="btn-book-now team-card-cta"><i class="fa-regular fa-calendar-check"></i><span>Book with ${member.name.split(' ')[0]}</span></a>`;
  }
  const initial = member.name.trim().charAt(0).toUpperCase();
  const photoInner = member.photo_url
    ? `<img src="${member.photo_url}" loading="lazy" alt="${member.name}">`
    : `<span class="team-card-initial">${initial}</span>`;
  return `
    <div class="team-card-app reveal">
      <button type="button" class="team-card-photo" data-bio="${member.name}" aria-label="Read more about ${member.name}">
        ${photoInner}
        <span class="team-card-photo-more"><i class="fa-solid fa-plus"></i></span>
      </button>
      <div class="team-card-name">${member.name}</div>
      <div class="team-card-role">${role}</div>
      <div class="team-card-stars">★★★★★</div>
      <div class="team-card-bio">${cardBio(member)}${moreLink(member, bio)}</div>
      ${member.instagram ? `<a href="${member.instagram}" class="team-card-social" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-instagram"></i></a>` : ''}
      ${cta}
    </div>
  `;
}

// ── SHORT ON THE CARD, WHOLE THING IN THE DIALOG ──
// Pati's bio is four paragraphs. Printed in full on a card it either swamps
// the grid or gets clipped mid-sentence by a line-clamp, and a bio cut off at
// "I am passionate..." reads worse than no bio at all. So the card carries a
// sentence that stands on its own, and the rest is a tap away.
const SHORT_BIO_CHARS = 165;
// Only worth cutting when there is a real amount left over. Truncating a bio
// for the sake of seven characters costs a "Read more" and an ellipsis and
// saves nothing, so a bio has to overrun by a clear margin before it is
// shortened at all.
const SHORT_BIO_SLACK = 1.25;

function isLongBio(bio) { return (bio || '').length > SHORT_BIO_CHARS * SHORT_BIO_SLACK; }

/** Sits at the end of the sentence it continues, rather than floating below
 *  the text with a gap around it. A trailing space keeps it from butting up
 *  against the full stop. */
function moreLink(member, bio) {
  if (!isLongBio(bio)) return '';
  return ` <button type="button" class="team-card-more" data-bio="${member.name}">`
    + (lang() === 'no' ? 'Les mer' : 'Read more') + '</button>';
}

function shortBio(bio) {
  const t = (bio || '').trim();
  if (!isLongBio(t)) return t;
  // Cut at a sentence end where there is one nearby, so the card shows a whole
  // thought rather than a fragment with dots after it.
  const window = t.slice(0, SHORT_BIO_CHARS + 60);
  const stop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (stop > SHORT_BIO_CHARS * 0.5) return t.slice(0, stop + 1);
  const space = t.lastIndexOf(' ', SHORT_BIO_CHARS);
  return t.slice(0, space > 0 ? space : SHORT_BIO_CHARS).trim() + '…';
}

// ── THE DIALOG ──
let bioMembers = [];

function openBio(name) {
  const m = bioMembers.find((x) => x.name === name);
  const modal = document.getElementById('bioModal');
  if (!m || !modal) return;
  const no = lang() === 'no';
  const role = no && m.role_no ? m.role_no : m.role;
  const bio = (no && m.bio_no ? m.bio_no : m.bio) || '';

  document.getElementById('bioModalPhoto').innerHTML = m.photo_url
    ? `<img src="${m.photo_url}" alt="${m.name}">`
    : `<span class="team-card-initial">${m.name.trim().charAt(0).toUpperCase()}</span>`;
  document.getElementById('bioModalName').textContent = m.name;
  document.getElementById('bioModalRole').textContent = role || '';
  // Blank lines in the source become real paragraphs. Built with RegExp from a
  // string rather than a literal, because escapes get mangled writing to this
  // file. NL is a newline; the pattern is one or more blank lines.
  const NL = String.fromCharCode(10);
  const PARA_BREAK = new RegExp(NL + '\\s*' + NL);
  document.getElementById('bioModalText').innerHTML = bio
    .split(PARA_BREAK)
    .map((par) => `<p>${par.trim()}</p>`)
    .join('');

  const links = document.getElementById('bioModalLinks');
  let html = '';
  if (m.instagram) html += `<a href="${m.instagram}" class="team-card-social" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-instagram"></i></a>`;
  if (m.external_booking_url) html += `<a href="${m.external_booking_url}" class="btn-book-now" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-calendar-check"></i><span>${m.external_booking_label || 'Book on Timma'}</span></a>`;
  else if (m.message_url) html += `<a href="${m.message_url}" class="btn-book-now" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-comment-dots"></i><span>Message ${m.name.split(' ')[0]}</span></a>`;
  else if (m.bookable) html += `<a href="/book.html" class="btn-book-now"><i class="fa-regular fa-calendar-check"></i><span>Book with ${m.name.split(' ')[0]}</span></a>`;
  links.innerHTML = html;

  modal.hidden = false;
  document.body.classList.add('bio-modal-open');
  document.getElementById('bioModalClose').focus();
}

function closeBio() {
  const modal = document.getElementById('bioModal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove('bio-modal-open');
}

function isFounder(member) { return /founder/i.test(member.role || ''); }

function featuredCardHtml(member) {
  const role = lang() === 'no' && member.role_no ? member.role_no : member.role;
  const bio = lang() === 'no' && member.bio_no ? member.bio_no : member.bio;
  let cta = '';
  if (member.external_booking_url) {
    const label = member.external_booking_label || 'Book on Timma';
    cta = `<a href="${member.external_booking_url}" class="btn-book-now team-card-cta" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-calendar-check"></i><span>${label}</span></a>`;
  } else if (member.message_url) {
    cta = `<a href="${member.message_url}" class="btn-book-now team-card-cta" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-comment-dots"></i><span>Message ${member.name.split(' ')[0]}</span></a>`;
  } else if (member.bookable) {
    cta = `<a href="/book.html" class="btn-book-now team-card-cta"><i class="fa-regular fa-calendar-check"></i><span>Book with ${member.name.split(' ')[0]}</span></a>`;
  }
  const initial = member.name.trim().charAt(0).toUpperCase();
  const photoInner = member.photo_url
    ? `<img src="${member.photo_url}" loading="lazy" alt="${member.name}">`
    : `<span class="team-card-initial">${initial}</span>`;
  return `
    <div class="team-card-featured reveal">
      <span class="team-card-founder-badge" data-en="Founder" data-no="Grunnlegger">Founder</span>
      <button type="button" class="team-card-featured-photo" data-bio="${member.name}" aria-label="Read more about ${member.name}">
        ${photoInner}
        <span class="team-card-photo-more"><i class="fa-solid fa-plus"></i></span>
      </button>
      <div class="team-card-featured-info">
        <div class="team-card-name">${member.name}</div>
        <div class="team-card-role">${role}</div>
        <div class="team-card-stars">★★★★★</div>
        <div class="team-card-bio">${cardBio(member)}${moreLink(member, bio)}</div>
        <div class="team-card-featured-actions">
          ${member.instagram ? `<a href="${member.instagram}" class="team-card-social" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-instagram"></i></a>` : ''}
          ${cta}
        </div>
      </div>
    </div>
  `;
}

function render(list) {
  bioMembers = list;
  const featuredEl = document.getElementById('teamFeatured');
  const grid = document.getElementById('teamGrid');
  const featured = list.find(isFounder);
  const rest = featured ? list.filter((m) => m !== featured) : list;

  if (featuredEl) featuredEl.innerHTML = featured ? featuredCardHtml(featured) : '';
  grid.innerHTML = rest.map(cardHtml).join('');

  [featuredEl, grid].forEach((el) => {
    if (!el) return;
    el.querySelectorAll('img').forEach((img) => {
      if (img.complete && img.naturalWidth === 0) window._applyImgFallback && window._applyImgFallback(img);
      else img.addEventListener('error', () => window._applyImgFallback && window._applyImgFallback(img));
    });
    el.querySelectorAll('.reveal').forEach((el2) => window._observeReveal && window._observeReveal(el2));
    el.querySelectorAll('[data-bio]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openBio(btn.dataset.bio);
      });
    });
  });
}

async function init() {
  try {
    const { data, error } = await fetchBookableStaff();
    if (error || !data || !data.length) throw error || new Error('no staff yet');
    render(data);
  } catch (e) {
    render(FALLBACK_STAFF);
  }
}

document.addEventListener('lang:changed', init);
init();

// ── BIO DIALOG WIRING ──
// Attached once, on the dialog itself, so re-rendering the cards (a language
// switch does that) never leaves a second set of listeners behind.
(function wireBioModal() {
  const modal = document.getElementById('bioModal');
  if (!modal) return;
  document.getElementById('bioModalClose').addEventListener('click', closeBio);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeBio(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBio(); });
}());
