import { fetchBookableStaff } from '/js/supabase-client.js';

// Static fallback mirrors supabase/migrations/0002_seed_data.sql so the page
// still looks complete while the database is paused/unreachable.
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
    external_booking_label: 'Book with Taniya on Instagram' },
  { name: 'Pati', role: 'Nail Artist', role_no: 'Neglekunstner',
    bio: 'With over 10 years of experience in the nail industry, I am passionate about creating beautiful, precise, and long-lasting nails tailored to each client. Throughout my career, I have completed several professional training courses and earned multiple certifications, continuously developing my skills and staying up to date with the latest techniques and trends. My certifications include training in gel manicure, nail extensions, nail art and design, e-file techniques, as well as hygiene and safety standards. For me, nail styling is not only about beautiful results - it is about precision, quality, attention to detail, and making every client feel confident and well cared for.',
    bio_no: 'Med over 10 års erfaring i neglebransjen brenner jeg for å skape vakre, presise og holdbare negler tilpasset hver enkelt kunde. Gjennom karrieren har jeg fullført flere profesjonelle kurs og tatt en rekke sertifiseringer, og utvikler meg kontinuerlig for å holde meg oppdatert på de nyeste teknikkene og trendene. Sertifiseringene mine omfatter gelemanikyr, neglforlengelse, neglekunst og design, e-fil-teknikker samt hygiene- og sikkerhetsstandarder. For meg handler negledesign ikke bare om et vakkert resultat - det handler om presisjon, kvalitet, sans for detaljer, og at hver kunde skal føle seg trygg og godt ivaretatt.',
    photo_url: './html/Pics/Team/Pati.jpeg', instagram: 'https://www.instagram.com/studio.serena.nailsbypati?igsh=amFoY2Y2bTAzbTZq',
    bookable: false, external_booking_url: 'https://timma.no/salong/patrycja-neglebar' },
  { name: 'Heba K.', role: 'Creative Lead & Communications', role_no: 'Creative Lead & Kommunikasjon',
    bio: 'Specializing in digital artistry and high-end client relations. The architect of our online world and the voice behind every appointment.',
    bio_no: 'Spesialist innen digital kreativitet og førsteklasses kunderelasjoner.',
    photo_url: './html/Pics/Team/Heba.jpeg', instagram: 'https://www.instagram.com/hebakolkas', bookable: false,
    message_url: 'https://www.instagram.com/hebakolkas' },
];

function lang() { return (window._getLang && window._getLang()) || 'en'; }

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
