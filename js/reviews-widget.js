// ── CLIENT REVIEWS SLIDESHOW ──
// Shows 3 reviews at a time beside the Team section; auto-advances to the
// next 3 every 3 minutes. Visitors can also jump to any page via the dots.
const REVIEWS = [
  { author: 'Sofia L.', en: 'Hassan transformed my hair completely. The balayage looks so natural — I get compliments every single day.', no: 'Hassan forvandlet håret mitt helt. Balayagen ser så naturlig ut — jeg får komplimenter hver eneste dag.' },
  { author: 'Marta R.', en: 'Best keratin treatment I have ever had. My hair is silky, smooth, and the results lasted 6 months.', no: 'Den beste keratinbehandlingen jeg noensinne har hatt. Håret er silkemykt og jevnt, og resultatet varte i 6 måneder.' },
  { author: 'Amina B.', en: 'The bridal package was absolutely worth every krone. I felt like a queen. Kani and her team are pure magic.', no: 'Brudepakken var verdt hver krone. Jeg følte meg som en dronning. Kani og teamet hennes er ren magi.' },
  { author: 'Lars P.', en: 'Booking was so easy, and Heba is incredibly friendly! She makes you feel welcome before you even arrive.', no: 'Det var så lett å bestille time, og Heba er utrolig vennlig! Hun får deg til å føle deg velkommen.' },
  { author: 'Emma T.', en: 'I got butterfly weft extensions with Hassan and I am obsessed. They feel weightless and blend perfectly.', no: 'Jeg fikk butterfly weft extensions av Hassan og er helt hekta. De er lette som luft og blender perfekt.' },
  { author: 'Kaoutar A.', en: 'This is the best my hair has ever looked. Finally a hijabi-friendly salon in Oslo that truly knows what they’re doing!', no: 'Dette er det vakreste håret mitt noensinne har sett ut. Endelig en hijabivennlig salong i Oslo!' },
  { author: 'Hana M.', en: 'As a hijabi, Taniya made me feel so safe and respected in the private section. Genuinely changed my confidence.', no: 'Som hijabi fikk Taniya meg til å føle meg trygg og respektert i den private seksjonen.' },
  { author: 'Nadia K.', en: 'I travelled from London just to have Hassan do my butterfly weft extensions — completely worth every penny.', no: 'Jeg reiste fra London bare for å la Hassan gjøre extensions — absolutt verdt hver krone.' },
  { author: 'Diea', en: 'A thousand thanks — you made my day, Kani!! Absolutely thrilled with the bridal hair and makeup.', no: 'Tusen takk til deg — du gjorde dagen min, Kani!! Ble kjempe fornøyd med brudehåret og sminken.' },
  { author: 'Rania S.', en: 'Taniya completely restored my damaged hair with the protein treatment. Absolutely incredible.', no: 'Taniya reddet det skadde håret mitt helt med proteinbehandlingen. Helt utrolig.' },
  { author: 'Isabelle M.', en: 'Hassan did my bridal hair and I have never felt more elegant. Every guest asked who did my hair.', no: 'Hassan gjorde brudefrisyren min og jeg har aldri følt meg mer elegant.' },
  { author: 'Julia K.', en: 'I messaged on Instagram at 10pm and Heba replied within minutes. That responsiveness set the tone.', no: 'Jeg sendte melding på Instagram klokken 22 og Heba svarte innen få minutter.' },
  { author: 'Camilla B.', en: 'Hassan is in a league of his own. My highlights have never looked this dimensional and natural.', no: 'Hassan er i en klasse for seg selv. Stripene mine har aldri sett så naturlige ut.' },
  { author: 'Mani K.', en: 'First time — WOW! Couldn’t be more satisfied with the result and the amazing atmosphere.', no: 'Første gang — WOW! Kunne ikke vært mer fornøyd med resultatet og stemningen.' },
  { author: 'Victoria A.', en: 'Hassan created an updo I could only have dreamed of. It held perfectly the entire night.', no: 'Hassan skapte en oppsatt frisyre jeg bare kunne drømt om. Den holdt perfekt hele kvelden.' },
  { author: 'Yasmine T.', en: 'Heba walked me through all the treatment options before my appointment. I felt informed and confident.', no: 'Heba gikk gjennom alle behandlingsalternativene før timen. Jeg følte meg informert og trygg.' },
  { author: 'Fatima H.', en: 'I came in with frizzy hair and left with the smoothest, shiniest hair of my life. Taniya is an expert.', no: 'Jeg kom inn med krøllete hår og gikk ut med det glatteste håret i mitt liv.' },
  { author: 'Zahra S.', en: 'Thank you for a great haircut — so much easier to wash now and I feel like myself again!', no: 'Tusen takk for en fin klipp — så mye lettere å vaske nå!' },
  { author: 'Petra N.', en: 'Hassan cut my hair and gave it so much life and shape. Absolutely in love with the result.', no: 'Hassan klipte håret mitt og ga det så mye liv og form.' },
  { author: 'Nour H.', en: 'The hijabi section made me feel so welcomed. The website made everything easy to navigate beforehand.', no: 'Hijabi-seksjonen fikk meg til å føle meg ønsket og komfortabel.' },
  { author: 'Mona C.', en: 'Kani did my updo for a wedding and I danced all night — it did not move a single millimetre.', no: 'Kani satte opp håret mitt til et bryllup og jeg danset hele kvelden.' },
  { author: 'Layla R.', en: '25 years of experience truly shows. Hassan knew exactly what my hair needed.', no: '25 års erfaring viser virkelig. Hassan visste nøyaktig hva håret mitt trengte.' },
  { author: 'Sara B.', en: 'Nothing comes close to Taniya’s work with hair botox. My hair has never felt better.', no: 'Ingenting er i nærheten av Taniya sitt arbeid med hår botox.' },
  { author: 'Rozhgar S.', en: 'I have been going to Kani for two years now. She always listens and always delivers.', no: 'Jeg har vært hos Kani i to år nå. Hun lytter alltid og leverer alltid.' },
  { author: 'Olivia S.', en: 'I found Studio Serena through Instagram and the studio matched the aesthetic completely.', no: 'Jeg fant Studio Serena gjennom Instagram og studioet matchet estetikken helt.' },
];

const PAGE_SIZE = 3;
const PAGE_COUNT = Math.ceil(REVIEWS.length / PAGE_SIZE);
let currentPage = 0;
let autoTimer = null;

function currentLang() { return (window._getLang && window._getLang()) || 'en'; }

function cardHtml(r) {
  const text = currentLang() === 'no' ? r.no : r.en;
  return `
    <div class="mini-review-card">
      <div class="stars">★★★★★</div>
      <p>${text}</p>
      <span>— ${r.author}</span>
    </div>
  `;
}

function renderPage(page) {
  const track = document.getElementById('reviewsTrack');
  if (!track) return;
  const start = page * PAGE_SIZE;
  const items = REVIEWS.slice(start, start + PAGE_SIZE);
  track.innerHTML = items.map(cardHtml).join('');
  document.querySelectorAll('.reviews-sidebar-dots span').forEach((dot, i) => {
    dot.classList.toggle('active', i === page);
  });
}

function goToPage(page) {
  const track = document.getElementById('reviewsTrack');
  if (!track) return;
  currentPage = (page + PAGE_COUNT) % PAGE_COUNT;
  track.classList.add('fading');
  setTimeout(() => {
    renderPage(currentPage);
    track.classList.remove('fading');
  }, 250);
}

function initReviewsWidget() {
  const track = document.getElementById('reviewsTrack');
  const sidebar = document.getElementById('reviews');
  if (!track || !sidebar) return;

  renderPage(0);

  const nav = document.createElement('div');
  nav.className = 'reviews-sidebar-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'reviews-nav-arrow';
  prevBtn.setAttribute('aria-label', 'Previous reviews');
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
  prevBtn.addEventListener('click', () => {
    goToPage(currentPage - 1);
    resetAutoTimer();
  });

  const dots = document.createElement('div');
  dots.className = 'reviews-sidebar-dots';
  for (let i = 0; i < PAGE_COUNT; i++) {
    const dot = document.createElement('span');
    if (i === 0) dot.classList.add('active');
    dot.addEventListener('click', () => {
      goToPage(i);
      resetAutoTimer();
    });
    dots.appendChild(dot);
  }

  const nextBtn = document.createElement('button');
  nextBtn.className = 'reviews-nav-arrow';
  nextBtn.setAttribute('aria-label', 'Next reviews');
  nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
  nextBtn.addEventListener('click', () => {
    goToPage(currentPage + 1);
    resetAutoTimer();
  });

  nav.appendChild(prevBtn);
  nav.appendChild(dots);
  nav.appendChild(nextBtn);
  sidebar.appendChild(nav);

  document.addEventListener('lang:changed', () => renderPage(currentPage));

  function resetAutoTimer() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(() => goToPage(currentPage + 1), 3 * 60 * 1000);
  }
  resetAutoTimer();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReviewsWidget);
} else {
  initReviewsWidget();
}
