import { fetchBookableStaff } from '/js/supabase-client.js';

// Static fallback mirrors supabase/migrations/0002_seed_data.sql so the page
// still looks complete while the database is paused/unreachable.
const FALLBACK_STAFF = [
  { name: 'Hassan K.', role: 'Founder & Master Stylist', role_no: 'Grunnlegger & Mesterstylisten',
    bio: '25+ years of luxury experience across Oslo and Lebanon. A master of balayage and extensions, with an expert touch across every discipline.',
    bio_no: '25+ års luksuserfaring fra Oslo og Libanon. En mester innen balayage og extensions.',
    photo_url: '/html/Pics/Team/Hasan.jpg', instagram: 'https://www.instagram.com/studioserena.hair?igsh=YnZhMmU2ZDRhNDI2&utm_source=qr', bookable: true },
  { name: 'Kani M.', role: 'Senior Stylist & Makeup Artist', role_no: 'Senior Stylisten & Makeup Artist',
    bio: '8+ years of experience. Specialist in balayage, bridal artistry, makeup, and styling for all—including hijabis.',
    bio_no: '8+ års erfaring. Spesialist på balayage, brudestyling, makeup, og styling for alle.',
    photo_url: '/html/Pics/Team/Kani.jpg', instagram: 'https://www.instagram.com/hairgasmofficial?igsh=b3poaWo2dTZwOXo4', bookable: true },
  { name: 'Taniya S.', role: 'Keratin & Hair Treatment Specialist', role_no: 'Keratin & Hårbehandlingsspesialist',
    bio: 'Extensive luxury experience. A highly talented specialist in Keratin and restorative hair treatments for all clients—including hijabis.',
    bio_no: 'Omfattende luksuserfaring. En svært talentfull spesialist på Keratin og gjenoppbyggende hårbehandlinger.',
    photo_url: '/html/Pics/Team/Taniya.jpg', instagram: 'https://www.instagram.com/lavellaprofessional?igsh=Y2MxZTh6eGZvNTFu', bookable: true },
  { name: 'Pati', role: 'Nail Artist', role_no: 'Neglekunstner',
    bio: 'Our talented nail artist, specializing in gel, nail extensions, and creative nail art. Book your appointment directly through Timma.',
    bio_no: 'Vår talentfulle neglekunstner, spesialist på gele, neglforlengelse og kreativ neglekunst.',
    // Her photo lives only in Supabase Storage (uploaded via the admin panel),
    // not as a repo file — left null so it degrades gracefully until the
    // database is live and returns her real storage URL.
    photo_url: null, instagram: 'https://www.instagram.com/studio.serena.nailsbypati?igsh=amFoY2Y2bTAzbTZq',
    bookable: false, external_booking_url: 'https://timma.no/salong/patrycja-neglebar' },
  { name: 'Heba K.', role: 'Creative Lead & Communications', role_no: 'Creative Lead & Kommunikasjon',
    bio: 'Specializing in digital artistry and high-end client relations. The architect of our online world and the voice behind every appointment.',
    bio_no: 'Spesialist innen digital kreativitet og førsteklasses kunderelasjoner.',
    photo_url: '/html/Pics/Team/Heba.jpg', instagram: 'https://www.instagram.com/hebakolkas', bookable: false,
    message_url: 'https://www.instagram.com/hebakolkas' },
];

function lang() { return (window._getLang && window._getLang()) || 'en'; }

function cardHtml(member) {
  const role = lang() === 'no' && member.role_no ? member.role_no : member.role;
  const bio = lang() === 'no' && member.bio_no ? member.bio_no : member.bio;
  let cta = '';
  if (member.external_booking_url) {
    cta = `<a href="${member.external_booking_url}" class="btn-book-now team-card-cta" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-calendar-check"></i><span>Book on Timma</span></a>`;
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
      <div class="team-card-photo">
        ${photoInner}
      </div>
      <div class="team-card-name">${member.name}</div>
      <div class="team-card-role">${role}</div>
      <div class="team-card-stars">★★★★★</div>
      <div class="team-card-bio">${bio || ''}</div>
      ${member.instagram ? `<a href="${member.instagram}" class="team-card-social" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-instagram"></i></a>` : ''}
      ${cta}
    </div>
  `;
}

function isFounder(member) { return /founder/i.test(member.role || ''); }

function featuredCardHtml(member) {
  const role = lang() === 'no' && member.role_no ? member.role_no : member.role;
  const bio = lang() === 'no' && member.bio_no ? member.bio_no : member.bio;
  let cta = '';
  if (member.external_booking_url) {
    cta = `<a href="${member.external_booking_url}" class="btn-book-now team-card-cta" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-calendar-check"></i><span>Book on Timma</span></a>`;
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
      <div class="team-card-featured-photo">${photoInner}</div>
      <div class="team-card-featured-info">
        <div class="team-card-name">${member.name}</div>
        <div class="team-card-role">${role}</div>
        <div class="team-card-stars">★★★★★</div>
        <div class="team-card-bio">${bio || ''}</div>
        <div class="team-card-featured-actions">
          ${member.instagram ? `<a href="${member.instagram}" class="team-card-social" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-instagram"></i></a>` : ''}
          ${cta}
        </div>
      </div>
    </div>
  `;
}

function render(list) {
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
