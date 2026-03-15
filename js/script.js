// ── WELCOME POPUP ──
(function() {
  function closePopup() {
    const popup = document.getElementById('welcome-popup');
    if (!popup) return;
    popup.classList.add('closing');
    setTimeout(() => { popup.style.display = 'none'; }, 400);
  }
  const btnClose = document.getElementById('popupClose');
  const btnX     = document.getElementById('popupX');
  if (btnClose) btnClose.addEventListener('click', closePopup);
  if (btnX)     btnX.addEventListener('click', closePopup);
  // Close on backdrop click
  const popup = document.getElementById('welcome-popup');
  if (popup) popup.addEventListener('click', e => { if (e.target === popup) closePopup(); });
  // Escape key
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopup(); });
})();

// ── PRELOADER ──
window.addEventListener('load', () => {
  setTimeout(() => {
    const preloader = document.getElementById('preloader');
    if (preloader) {
      preloader.classList.add('hidden');
      setTimeout(() => preloader.remove(), 500);
    }
  }, 1000);
});

// ── NAV & BACK TO TOP ──
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 60);
  const backTop = document.getElementById('back-top');
  if (backTop) backTop.classList.toggle('visible', window.scrollY > 400);
});

// ── MOBILE MENU ──
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
const closeMenu = document.getElementById('closeMenu');

if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => mobileMenu.classList.add('open'));
}
if (closeMenu && mobileMenu) {
  closeMenu.addEventListener('click', () => mobileMenu.classList.remove('open'));
}
function closeMob() {
  if (mobileMenu) mobileMenu.classList.remove('open');
}

// ── THEME TOGGLE ──
const themeBtn = document.getElementById('themeToggle');
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    themeBtn.textContent = isDark ? '☾ Dark' : '☀ Light';
  });
}

// ── LANGUAGE TOGGLE ──
let lang = 'en';
const langBtn = document.getElementById('langToggle');
if (langBtn) {
  langBtn.addEventListener('click', () => {
    lang = lang === 'en' ? 'no' : 'en';
    langBtn.textContent = lang === 'en' ? 'NO | EN' : 'EN | NO';

    // Translate all [data-en] elements
    document.querySelectorAll('[data-en]').forEach(el => {
      const val = el.getAttribute('data-' + lang);
      if (val) el.innerHTML = val;
    });

    // Translate FAQ answer <p> elements (they have data-en too)
    document.querySelectorAll('.faq-a p[data-en]').forEach(el => {
      const val = el.getAttribute('data-' + lang);
      if (val) el.innerHTML = val;
    });

    // Translate chatbot placeholder
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
      chatInput.placeholder = lang === 'no' ? 'Skriv en melding...' : 'Type a message...';
    }

    // Translate chat suggestion chips (use data-en/data-no on buttons)
    document.querySelectorAll('.chat-sug[data-no]').forEach(el => {
      const val = el.getAttribute('data-' + lang);
      if (val) el.textContent = val;
    });

    // Re-render status badge in correct language
    updateStatusLang(lang);
  });
}

// ── SCROLL REVEAL ──
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) e.target.classList.add('visible');
  });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal, .reveal-left').forEach(el => revealObserver.observe(el));

// ── ANIMATED COUNTERS ──
const counterObs = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting && !e.target.dataset.counted) {
      e.target.dataset.counted = '1';
      const target = parseInt(e.target.dataset.target);
      let count = 0;
      const step = Math.ceil(target / 40);
      const timer = setInterval(() => {
        count = Math.min(count + step, target);
        e.target.textContent = count;
        if (count >= target) clearInterval(timer);
      }, 40);
    }
  });
}, { threshold: 0.5 });
document.querySelectorAll('.counter').forEach(c => counterObs.observe(c));

// ── SERVICES PANEL ──
document.querySelectorAll('.svc-row').forEach(row => {
  row.addEventListener('mouseenter', () => {
    const idx = row.dataset.svc;
    document.querySelectorAll('.svc-row').forEach(r => r.classList.remove('active-svc'));
    row.classList.add('active-svc');
    document.querySelectorAll('.svc-panel-slide').forEach(s => s.classList.remove('visible'));
    const target = document.querySelector(`.svc-panel-slide[data-panel="${idx}"]`);
    if (target) target.classList.add('visible');
  });
});

// ── GALLERY LIGHTBOX ──
const galleryData = {
  Balayage: [
    './html/Pics/Balayage/Balayage1.jpeg',
    './html/Pics/Balayage/vid1.mp4',
    './html/Pics/Balayage/Balayage2.jpeg',
    './html/Pics/Balayage/vid10.mp4',
    './html/Pics/Balayage/Balayage23.jpeg',
    './html/Pics/Balayage/vid2.mp4',
    './html/Pics/Balayage/Balayage27.jpeg',
    './html/Pics/Balayage/vid11.mp4',
    './html/Pics/Balayage/Balayage8.jpeg',
    './html/Pics/Balayage/vid18.mp4',
    './html/Pics/Balayage/Balayage3.jpeg',
    './html/Pics/Balayage/vid14.mp4',
    './html/Pics/Balayage/Balayage18.jpeg',
    './html/Pics/Balayage/vid13.mp4',
    './html/Pics/Balayage/Balayage16.jpeg',
    './html/Pics/Balayage/vid12.mp4',
    './html/Pics/Balayage/Balayage4.jpeg',
    './html/Pics/Balayage/vid5.mp4',
    './html/Pics/Balayage/Balayage5.jpeg',
    './html/Pics/Balayage/vid4.mp4',
    './html/Pics/Balayage/Balayage29.jpeg',
    './html/Pics/Balayage/vid21.mp4',
    './html/Pics/Balayage/Balayage6.jpeg',
    './html/Pics/Balayage/vid6.mp4',
    './html/Pics/Balayage/Balayage7.jpeg',
    './html/Pics/Balayage/vid7.mp4',
    './html/Pics/Balayage/Balayage17.jpeg',
    './html/Pics/Balayage/vid8.mp4',
    './html/Pics/Balayage/Balayage9.jpeg',
    './html/Pics/Balayage/vid9.mp4',
    './html/Pics/Balayage/Balayage20.jpeg',
    './html/Pics/Balayage/vid20.mp4',
    './html/Pics/Balayage/Balayage10.jpeg',
    './html/Pics/Balayage/vid3.mp4',
    './html/Pics/Balayage/Balayage11.jpeg',
    './html/Pics/Balayage/vid15.mp4',
    './html/Pics/Balayage/Balayage13.jpeg',
    './html/Pics/Balayage/vid16.mp4',
    './html/Pics/Balayage/Balayage15.jpeg',
    './html/Pics/Balayage/vid17.mp4',
    './html/Pics/Balayage/Balayage28.jpeg',
    './html/Pics/Balayage/vid19.mp4',
    './html/Pics/Balayage/Balayage14.jpeg',
    './html/Pics/Balayage/vid22.mp4',
  ],
  Brides: [
    './html/Pics/Brides/Bride4.jpeg',
    './html/Pics/Brides/vid2.mp4',
    './html/Pics/Brides/Bride5.jpeg',
    './html/Pics/Brides/Bride6.jpeg',
    './html/Pics/Brides/vid3.mp4',
    './html/Pics/Brides/Bride2.jpeg',
    './html/Pics/Brides/Bride1.jpeg',
    './html/Pics/Brides/vid1.mp4',
    './html/Pics/Brides/Bride3.jpeg',
  ],
  Farge: [
    './html/Pics/Farge/Farge1.jpeg',
    './html/Pics/Farge/vid21.mp4',
    './html/Pics/Farge/Farge2.jpeg',
    './html/Pics/Farge/vid2.mp4',
    './html/Pics/Farge/Farge3.jpeg',
    './html/Pics/Farge/vid3.mp4',
    './html/Pics/Farge/Farge4.jpeg',
    './html/Pics/Farge/Farge5.jpeg',
    './html/Pics/Farge/Farge6.jpeg',
  ],
  Extensions: [
    './html/Pics/Extensions/vid4.mp4',
    './html/Pics/Extensions/vid7.mp4',
    './html/Pics/Extensions/vid6.mp4',
    './html/Pics/Extensions/vid2.mp4',
    './html/Pics/Extensions/vid3.mp4',
    './html/Pics/Extensions/vid11.mp4',
    './html/Pics/Extensions/vid1.mp4',
    './html/Pics/Extensions/vid5.mp4',
    './html/Pics/Extensions/vid9.mp4',
    './html/Pics/Extensions/vid8.mp4',


  ],
  Haircut: [
    './html/Pics/Haircut/Haircut5.jpeg',
    './html/Pics/Haircut/vid1.mp4',
    './html/Pics/Haircut/Haircut3.jpeg',
    './html/Pics/Haircut/vid2.mp4',
    './html/Pics/Haircut/vid4.mp4',
    './html/Pics/Haircut/vid3.mp4',
      './html/Pics/Haircut/Haircut1.jpeg',
    './html/Pics/Haircut/Haircut2.jpeg',
    './html/Pics/Haircut/Haircut4.jpeg',
  ],
  Styling: [
    './html/Pics/Styling/Styling1.jpeg',
    './html/Pics/Styling/Styling4.jpeg',
    './html/Pics/Styling/Styling5.jpeg',
    './html/Pics/Styling/Styling10.jpeg',
    './html/Pics/Styling/Styling3.jpeg',
    './html/Pics/Styling/Styling2.jpeg',
    './html/Pics/Styling/Styling6.jpeg',
    './html/Pics/Styling/Styling7.jpeg',
    './html/Pics/Styling/Styling8.jpeg',
    './html/Pics/Styling/Styling9.jpeg',
  ],
  HairTreatment: [
    './html/Pics/Treatment/Ht1.mp4',
    './html/Pics/Treatment/Ht2.mp4',
    './html/Pics/Treatment/Ht4.mp4',
    './html/Pics/Treatment/Ht7.mp4',
    './html/Pics/Treatment/Ht3.mp4',
    './html/Pics/Treatment/Ht8.mp4',
    './html/Pics/Treatment/Ht11.mp4',
    './html/Pics/Treatment/Ht9.mp4',
    './html/Pics/Treatment/Ht12.mp4',
    './html/Pics/Treatment/Ht6.mp4',
    './html/Pics/Treatment/Ht5.mp4',
    './html/Pics/Treatment/Ht10.mp4',
  ]
};


// ── PRE-FETCH VIDEOS on hover/touch so they're ready instantly ──
(function preloadOnHover() {
  const preloadCache = {};
  function prefetchCategory(cat) {
    if (preloadCache[cat]) return;
    preloadCache[cat] = true;
    const items = galleryData[cat] || [];
    items.forEach(src => {
      if (/\.(mp4|mov|webm)$/i.test(src)) {
        const v = document.createElement('video');
        v.preload = 'auto';
        v.muted = true;
        v.src = src;
        v.load(); // triggers browser fetch
      }
    });
  }
  document.querySelectorAll('.gallery-cat-card').forEach(card => {
    const oncard = card.getAttribute('onclick') || '';
    const match = oncard.match(/openLightbox\('([^']+)'\)/);
    if (!match) return;
    const cat = match[1];
    card.addEventListener('mouseenter', () => prefetchCategory(cat));
    card.addEventListener('touchstart',  () => prefetchCategory(cat), { passive: true });
  });
})();

function openLightbox(category) {
  const overlay = document.getElementById('lightboxOverlay');
  const grid = document.getElementById('lightboxGrid');
  const title = document.getElementById('lightboxTitle');
  if (!overlay || !grid || !title) return;

  // Human-readable titles (EN | NO)
  const categoryTitles = {
    Balayage:      { en: 'Balayage',           no: 'Balayage' },
    Farge:         { en: 'Colour',             no: 'Farge' },
    HairTreatment: { en: 'Keratin Treatment',  no: 'Keratinbehandling' },
    Extensions:    { en: 'Extensions',         no: 'Extensions' },
    Haircut:       { en: 'Cut & Style',        no: 'Klipp & Style' },
    Styling:       { en: 'Styling',            no: 'Styling' },
    Brides:        { en: 'Bridal',             no: 'Brud' },
  };
  const currentLang = (typeof lang !== 'undefined') ? lang : 'en';
  const titleObj = categoryTitles[category];
  title.textContent = titleObj ? titleObj[currentLang] || titleObj.en : category;

  grid.innerHTML = '';

  const items = galleryData[category] || [];
  if (items.length === 0) {
    grid.innerHTML = '<p style="color:var(--greige);text-align:center;padding:2rem;">No items found.</p>';
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    return;
  }

  items.forEach(src => {
    const isVideo = /\.(mp4|mov|webm)$/i.test(src);
    if (isVideo) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'width:100%;aspect-ratio:4/5;overflow:hidden;border-radius:8px;';
      const video = document.createElement('video');
      video.src = src;
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      // Start loading immediately
      video.load();
      wrapper.appendChild(video);
      grid.appendChild(wrapper);
    } else {
      const img = document.createElement('img');
      img.src = src;
      img.alt = category;
      grid.appendChild(img);
    }
  });

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const overlay = document.getElementById('lightboxOverlay');
  if (overlay) overlay.classList.remove('active');
  document.body.style.overflow = '';
}

// ── BEFORE & AFTER SLIDER ──
(function () {
  const sc = document.getElementById('sc');
  const bw = document.getElementById('bw');
  const bimg = document.getElementById('bimg');
  const handle = document.getElementById('handle');
  if (!sc || !bw || !bimg || !handle) return;

  let dragging = false;

  function setPos(clientX) {
    const rect = sc.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.min(1, Math.max(0, pct));
    const p = (pct * 100).toFixed(2) + '%';
    bw.style.width = p;
    bimg.style.width = (1 / pct * 100).toFixed(2) + '%';
    handle.style.left = p;
  }

  // Mouse
  sc.addEventListener('mousedown', e => { dragging = true; setPos(e.clientX); });
  window.addEventListener('mouseup', () => dragging = false);
  window.addEventListener('mousemove', e => { if (dragging) setPos(e.clientX); });

  // Touch
  sc.addEventListener('touchstart', e => { dragging = true; setPos(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend', () => dragging = false);
  window.addEventListener('touchmove', e => { if (dragging) setPos(e.touches[0].clientX); }, { passive: true });
}());

// ── FAQ ACCORDION ──
document.querySelectorAll('.faq-q').forEach(btn => {
  btn.addEventListener('click', () => {
    const isOpen = btn.classList.contains('open');
    document.querySelectorAll('.faq-q').forEach(b => {
      b.classList.remove('open');
      if (b.nextElementSibling) b.nextElementSibling.style.maxHeight = '0';
    });
    if (!isOpen) {
      btn.classList.add('open');
      btn.nextElementSibling.style.maxHeight = btn.nextElementSibling.scrollHeight + 'px';
    }
  });
});

// ── BACK TO TOP ──
const backTopBtn = document.getElementById('back-top');
if (backTopBtn) {
  backTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// ── WORKING HOURS STATUS BADGE ──
function updateStatus() {
  const badge = document.getElementById('statusBadge');
  if (!badge) return;
  const now = new Date();
  const day = now.getDay();       // 0=Sun … 6=Sat
  const mins = now.getHours() * 60 + now.getMinutes();
  // All open days: 11:00 (660) – 17:30 (1050). Sat & Sun closed.
  const isOpen = day >= 1 && day <= 5 && mins >= 660 && mins < 1050;

  const openText   = (typeof lang !== 'undefined' && lang === 'no') ? '● Åpen nå'    : '● Open Now';
  const closedText = (typeof lang !== 'undefined' && lang === 'no') ? '● Stengt nå'  : '● Closed Now';
  if (isOpen) {
    badge.textContent = openText;
    badge.className = 'status-badge status-open';
  } else {
    badge.textContent = closedText;
    badge.className = 'status-badge status-closed';
  }
}
function updateStatusLang(l) {
  const badge = document.getElementById('statusBadge');
  if (!badge) return;
  const isOpen = badge.classList.contains('status-open');
  if (isOpen) {
    badge.textContent = l === 'no' ? '● Åpen nå'   : '● Open Now';
  } else {
    badge.textContent = l === 'no' ? '● Stengt nå' : '● Closed Now';
  }
}
updateStatus();
// ── CHATBOT ──
if (!window._studioSerenaChatInit) {
  window._studioSerenaChatInit = true;

  const chatBubble = document.getElementById('chatBubble');
  const chatWindow = document.getElementById('chatWindow');
  const chatClose = document.getElementById('chatClose');
  const chatInput = document.getElementById('chatInput');
  const chatMessages = document.getElementById('chatMessages');
  const chatSendBtn = document.getElementById('chatSendBtn');
  const chatSugs = document.getElementById('chatSugs');

  // ── Whole-word / whole-phrase matcher ──
  function matchesAny(keys, text) {
    return keys.some(key => {
      const escaped = key.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      return new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i').test(text);
    });
  }

  // ── Response map (most-specific first) ──
  const responses = [

    // BOOKING
    {
      keys: ['book', 'appointment', 'reserve', 'schedule', 'bestille', 'bestill', 'avtale'],
      reply: "To book an appointment, DM us on Instagram @saloncoiff1rst or call/WhatsApp +47 453 97 631 ✦\nFor å bestille time, kontakt oss på Instagram @saloncoiff1rst eller WhatsApp +47 453 97 631 ✦"
    },

    // SERVICES — specific with descriptions
    {
      keys: ['balayage'],
      reply: "Balayage is one of our specialties! ✦\n\nIt's a freehand hair colouring technique that creates soft, natural-looking highlights — no harsh lines, just a beautiful sun-kissed gradient tailored to your hair. Perfect for all hair types and colours.\n\nBook via Instagram @saloncoiff1rst or WhatsApp +47 453 97 631."
    },

    {
      keys: ['keratin'],
      reply: "Our Keratin Treatment is a professional smoothing service that eliminates frizz, reduces styling time, and leaves your hair glossy and manageable for weeks. ✦\n\nThe treatment infuses keratin protein deep into the hair shaft, repairing damage and sealing the cuticle for a sleek, healthy finish.\n\nReach out on Instagram @saloncoiff1rst or WhatsApp +47 453 97 631 to book."
    },

    {
      keys: ['extensions', 'hair extensions'],
      reply: "We offer high-quality hair extensions that seamlessly blend with your natural hair for added length, volume, or both. ✦\n\nOur extensions are carefully applied to match your colour and texture, giving you a natural, full look that you can style just like your own hair.\n\nDM us on Instagram @saloncoiff1rst or WhatsApp to discuss your look."
    },

    {
      keys: ['bridal', 'bride', 'brud', 'bryllup', 'wedding'],
      reply: "Our bridal packages are tailored to make you shine on your most special day. ✦\n\nWe offer full bridal hair styling and makeup artistry — from elegant updos and soft waves to flawless, long-lasting bridal makeup. We also accommodate trial sessions so you feel completely confident before the big day.\n\nContact us to book a consultation."
    },

    {
      keys: ['hijab', 'hijabi', 'privat'],
      reply: "We offer a fully private, respectful space exclusively for our hijabi clients. ✦\n\nOur salon ensures complete privacy throughout your appointment — you can relax and enjoy your service comfortably and confidently.\n\nBook via Instagram @saloncoiff1rst or WhatsApp +47 453 97 631."
    },

    {
      keys: ['botox hair', 'botox behandling'],
      reply: "Our Botox Hair Treatment is an intensive nourishing service that deeply conditions and smooths the hair. ✦\n\nUnlike medical Botox, this is a cosmetic hair treatment that fills in damaged, porous areas of the hair fibre — reducing frizz, restoring shine, and making hair feel soft and rejuvenated. Great for dry or over-processed hair.\n\nDM us on Instagram @saloncoiff1rst for more info."
    },

    {
      keys: ['botox'],
      reply: "Our Botox Hair Treatment is an intensive nourishing service that deeply conditions and smooths the hair. ✦\n\nUnlike medical Botox, this is a cosmetic hair treatment that fills in damaged, porous areas of the hair fibre — reducing frizz, restoring shine, and making hair feel soft and rejuvenated. Great for dry or over-processed hair.\n\nDM us on Instagram @saloncoiff1rst for more info."
    },

    {
      keys: ['protein treatment', 'protein'],
      reply: "Our Protein Treatment is designed to restore strength, elasticity, and shine to weakened or damaged hair. ✦\n\nIt works by replenishing the protein bonds inside the hair shaft that are broken down by heat, colour, or chemical processing — leaving hair noticeably healthier, fuller, and more resilient.\n\nContact us on Instagram @saloncoiff1rst or WhatsApp to learn more."
    },

    {
      keys: ['anti-frizz', 'frizz'],
      reply: "Our Anti-Frizz Treatment tames unruly hair and leaves it smooth, manageable, and humidity-resistant. ✦\n\nIt works by sealing the hair cuticle and neutralising the moisture imbalance that causes frizz — giving you sleek, polished results that last. Ideal for naturally curly, wavy, or coarse hair types.\n\nBook via Instagram @saloncoiff1rst or WhatsApp."
    },

    {
      keys: ['haircut', 'trim', 'klipp'],
      reply: "We offer precision haircuts tailored to your face shape, hair type, and personal style. ✦\n\nWhether you're after a classic trim, a fresh new cut, or a full style transformation, our stylists take the time to understand exactly what you're looking for.\n\nBook via Instagram @saloncoiff1rst or WhatsApp +47 453 97 631."
    },

    {
      keys: ['highlights', 'one color', 'colour', 'color', 'farge'],
      reply: "We offer a full range of colour services — from classic one-colour applications to multi-dimensional highlights and creative toning. ✦\n\nOur colourists work with both permanent and semi-permanent colour to achieve your ideal shade, whether you want a subtle refresh or a bold transformation.\n\nDM us on Instagram @saloncoiff1rst to discuss what's right for you."
    },

    // SERVICES — general
    {
      keys: ['our services', 'services', 'service', 'what do you offer', 'hva tilbyr', 'tjenester', 'behandlinger', 'våre tjenester'],
      reply: "We offer / Vi tilbyr:\n✦ Balayage\n✦ Haircuts / Hårklipp\n✦ Keratin\n✦ Extensions\n✦ One Color\n✦ Botox Hair Treatment\n✦ Protein Treatment\n✦ Anti-Frizz Treatment\n✦ Bridal Hair / Brudefrisyre\n✦ Hijabi services\n\nAsk me about any treatment for more details, or contact us for a consultation!"
    },

    // TEAM
    {
      keys: ['hassan', 'hasan'],
      reply: "Hassan K. is our Founder with 25+ years of luxury experience across Oslo and Lebanon ✦"
    },
    {
      keys: ['kani'],
      reply: "Kani M. is our Stylist & Makeup Artist, specialising in bridal artistry and balayage ✦"
    },
    {
      keys: ['taniya'],
      reply: "Taniya I. is our Treatment Expert, specialising in Keratin and restorative treatments ✦"
    },
    {
      keys: ['heba'],
      reply: "Heba K. is our Creative Lead & Communications ✦\n\nShe specialises in digital artistry and high-end client relations — the architect of our online world and the voice behind every appointment."
    },
    {
      keys: ['team', 'staff', 'stylists', 'ansatte', 'hvem jobber'],
      reply: "Our expert team:\n✦ Hassan K. — Founder (25+ years luxury experience)\n✦ Kani M. — Stylist & MUA (bridal & balayage)\n✦ Taniya I. — Treatment Expert (Keratin & restoration)\n✦ Heba K. — Creative Lead & Communications"
    },

    // LOCATION & HOURS
    {
      keys: ['opening hours', 'åpningstider', 'når er dere åpne', 'når åpner', 'when are you open', 'closed', 'stenger', 'stengt'],
      reply: "Opening hours / Åpningstider:\nMon–Fri / Man–Fre: 11:00–17:30\nSat–Sun / Lør–Søn: Closed / Stengt ✦"
    },
    {
      keys: ['hours'],
      reply: "Opening hours / Åpningstider:\nMon–Fri / Man–Fre: 11:00–17:30\nSat–Sun / Lør–Søn: Closed / Stengt ✦"
    },
    {
      keys: ['price', 'prices', 'pricing', 'cost', 'how much', 'pris', 'priser', 'hva koster', 'fee'],
      reply: "For pricing, DM us on Instagram @saloncoiff1rst or WhatsApp +47 453 97 631 ✦\nFor priser, send oss en DM på Instagram @saloncoiff1rst ✦"
    },
    {
      keys: ['where are you', 'location', 'address', 'where is', 'find you', 'adresse', 'hvor er dere', 'lokasjon'],
      reply: "We're at / Vi holder til på:\nTorshovgata 5, Oslo ✦\nEasy to reach by public transport!"
    },
    {
      keys: ['parking', 'parkering'],
      reply: "Street parking is available on Torshovgata ✦\nGateparkering er tilgjengelig på Torshovgata ✦"
    },

    // CONTACT — email entry removed, contact reply updated
    {
      keys: ['instagram', 'insta'],
      reply: "Find us on Instagram @saloncoiff1rst — we'd love to see you there! ✦"
    },
    {
      keys: ['phone', 'call', 'ring', 'telefon', 'whatsapp'],
      reply: "Call or WhatsApp us at +47 453 97 631 ✦"
    },
    {
      keys: ['contact us', 'kontakt oss', 'reach you', 'get in touch', 'contact', 'kontakt'],
      reply: "Reach us at / Kontakt oss:\n✦ Phone/WhatsApp: +47 453 97 631\n✦ Instagram: @saloncoiff1rst"
    },

    // SMALL TALK — Norwegian
    {
      keys: ['god morgen'],
      reply: "God morgen! ☀ Håper du har en fantastisk dag — hva kan jeg hjelpe deg med?"
    },
    {
      keys: ['god kveld'],
      reply: "God kveld! 🌙 Velkommen til Studio Serena — hva kan jeg gjøre for deg?"
    },
    {
      keys: ['god dag'],
      reply: "God dag! ✦ Velkommen til Studio Serena — hva kan jeg hjelpe med?"
    },
    {
      keys: ['hvordan går', 'hvordan har du', 'hva skjer', 'alt bra'],
      reply: "Det går kjempebra, takk! ✦ Klar til å hjelpe deg med å se fantastisk ut. Hva lurer du på?"
    },
    {
      keys: ['tusen takk', 'mange takk'],
      reply: "Bare hyggelig! Vi er alltid her for deg ✦ Er det noe annet du vil vite?"
    },
    {
      keys: ['ha det bra', 'ha det', 'adjø'],
      reply: "Ha det så bra! Håper vi ses på Studio Serena snart ✦"
    },
    {
      keys: ['hei', 'hej', 'heisann', 'halla', 'heyyy', 'heiiii'],
      replies: [
        "Hei! Velkommen til Studio Serena ✦ Hva kan jeg hjelpe deg med i dag?",
        "Hei hei! ✦ Så hyggelig at du tok kontakt. Hva lurer du på?",
        "Heisann! Vi er her for deg ✦ Hva kan vi gjøre for deg i dag?",
        "Hei! Hva kan Studio Serena hjelpe deg med? ✦",
      ]
    },

    // SMALL TALK — English
    {
      keys: ['good morning'],
      reply: "Good morning! ☀ Hope your day is off to a great start — how can I help?"
    },
    {
      keys: ['good afternoon'],
      reply: "Good afternoon! ✦ Welcome to Studio Serena — what can I do for you?"
    },
    {
      keys: ['good evening'],
      reply: "Good evening! 🌙 Welcome to Studio Serena — how can I help you tonight?"
    },
    {
      keys: ['how are you', 'how are u', 'how r u', 'hows it going', 'you ok', 'all good'],
      replies: [
        "Doing great, thanks for asking! ✦ Ready to help you look amazing. What do you need?",
        "All good here! ✦ How can I help you today?",
        "Wonderful, thank you! ✦ What can Studio Serena do for you?",
      ]
    },
    {
      keys: ['whats up', 'wassup', 'sup'],
      replies: [
        "Hey! Not much — just here to help ✦ What's on your mind?",
        "Hey! What can I do for you today? ✦",
        "Wassup! Studio Serena is here ✦ Ask me anything!",
      ]
    },
    {
      keys: ['hi', 'hey', 'hello', 'hiya', 'heyyy', 'heyy', 'helloo'],
      replies: [
        "Hey! Welcome to Studio Serena ✦ How can I help you today?",
        "Hello! Great to have you here ✦ What can I do for you?",
        "Hi there! ✦ Ask me anything about our services, team, or location.",
        "Hey hey! ✦ Studio Serena at your service — what do you need?",
        "Hello! How can we make your hair dreams come true today? ✦",
      ]
    },
    {
      keys: ['thank you', 'thanks', 'thank u', 'thx', 'cheers', 'appreciate it', 'ty'],
      replies: [
        "You're so welcome! We're always here if you need anything ✦",
        "Happy to help! ✦ Don't hesitate to ask if you have more questions.",
        "Anytime! ✦ We love hearing from our clients.",
        "Of course! ✦ Is there anything else I can help you with?",
      ]
    },
    {
      keys: ['goodbye', 'bye', 'see you', 'take care', 'later', 'cya', 'byeee'],
      replies: [
        "Goodbye! Hope to see you at Studio Serena soon ✦",
        "Take care! ✦ We're here whenever you need us.",
        "Bye! Come visit us at Torshovgata 5 anytime ✦",
        "See you soon! ✦ Have a wonderful day.",
      ]
    },
    {
      keys: ['haha', 'lol', 'hehe', 'lmao', 'lmfao', '😂', 'hahaha', 'ahahah', 'hahahaha'],
      replies: [
        "Haha! ✦ We like good vibes here at Studio Serena. Anything I can help you with?",
        "😄 Love the energy! So, what can I do for you today? ✦",
        "Ha! We're a fun bunch here at the studio ✦ Anything you'd like to know?",
        "Hehe ✦ Good mood = great hair day. Want to book an appointment?",
        "Lol! ✦ Glad you're in a good mood. How can Studio Serena help?",
      ]
    },
    {
      keys: ['amazing', 'fantastic', 'awesome', 'love it', 'love this', 'great', 'perfect', 'excellent', 'brilliant'],
      replies: [
        "Glad to hear that! ✦ We always strive for the best for our clients.",
        "Wonderful! ✦ That's exactly what we aim for at Studio Serena.",
        "That makes us so happy to hear! ✦ Is there anything else you'd like to know?",
      ]
    },
    {
      keys: ['wow', 'omg', 'oh my god', 'no way', 'seriously', 'really'],
      replies: [
        "We know, right?! ✦ Studio Serena never disappoints.",
        "Yes, really! ✦ We take pride in everything we do.",
        "Haha, we love that reaction! ✦ Anything else you'd like to know?",
      ]
    },
    {
      keys: ['cool', 'sick', 'fire', 'lit', 'dope', 'clean'],
      reply: "Thanks! ✦ We try to keep things sharp around here. Anything else I can help with?"
    },

    // SHORT AFFIRMATIONS — keep last
    {
      keys: ['jep', 'jada', 'jo', 'ja'],
      replies: [
        "Flott! ✦ Spør gjerne om noe annet.",
        "Supert! ✦ Hva annet kan jeg hjelpe deg med?",
      ]
    },
    {
      keys: ['absolutely', 'sure', 'yep', 'yeah', 'yep', 'yup'],
      replies: [
        "Great! ✦ Feel free to ask anything else.",
        "Perfect! ✦ What else can I help you with?",
      ]
    },
    {
      keys: ['okay', 'ok', 'alright', 'got it', 'understood', 'makes sense', 'i see'],
      replies: [
        "Perfect! ✦ Anything else you'd like to know?",
        "Great! ✦ I'm here if you need anything else.",
        "Got it! ✦ Feel free to ask me anything.",
        "Sounds good! ✦ What else can I help you with?",
      ]
    },
    {
      keys: ['nope', 'nah', 'no', 'not really'],
      replies: [
        "No problem at all! ✦ Let me know if there's anything else I can help with.",
        "All good! ✦ I'm here whenever you need me.",
      ]
    },
  ];

  const fallbackReplies = [
    "That's a great question! Reach out on Instagram @saloncoiff1rst or WhatsApp +47 453 97 631 ✦",
    "We'd love to help! DM us on Instagram @saloncoiff1rst or WhatsApp +47 453 97 631 ✦",
    "Our team would be happy to assist — contact us at +47 453 97 631 ✦",
    "Not sure about that one! DM us on Instagram @saloncoiff1rst and we'll get back to you ✦",
    "Best way to get a precise answer is to WhatsApp us at +47 453 97 631 ✦",
  ];

  // ── UI helpers ──
  function addMessage(text, type) {
    if (!chatMessages) return;
    const msg = document.createElement('div');
    msg.className = 'chat-msg ' + type;
    msg.style.whiteSpace = 'pre-line';
    msg.textContent = text;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showTypingIndicator() {
    if (!chatMessages) return null;
    const t = document.createElement('div');
    t.className = 'chat-msg bot chat-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    chatMessages.appendChild(t);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return t;
  }

  function isOpenNow() {
    const now = new Date();
    const day = now.getDay();
    const time = now.getHours() * 60 + now.getMinutes();
    if (day === 0 || day === 6) return false;   // Sat & Sun closed
    return time >= 660 && time < 1050;           // 11:00–17:30 Mon–Fri
  }

  // ── Main handler ──
  function handleChat(input) {
    const text = input.trim();
    if (!text) return;
    const lower = text.toLowerCase().replace(/[?!.,]/g, '').trim();
    addMessage(text, 'user');

    // Real-time open check
    const openPhrases = ['open now', 'åpen nå', 'are you open', 'er dere åpne', 'is the salon open'];
    if (openPhrases.some(p => lower.includes(p))) {
      const answer = isOpenNow()
        ? "Yes, we're open right now! ✦\nJa, vi er åpne nå! ✦"
        : "We're currently closed.\nWe're open Mon–Fri 11:00–17:30 ✦\nVi er stengt. Åpent Man–Fre 11:00–17:30 ✦";
      const t = showTypingIndicator();
      setTimeout(() => { t.remove(); addMessage(answer, 'bot'); }, 700);
      return;
    }

    // Keyword matching
    let reply = fallbackReplies[Math.floor(Math.random() * fallbackReplies.length)];
    for (const r of responses) {
      if (matchesAny(r.keys, lower)) {
        if (r.replies) {
          reply = r.replies[Math.floor(Math.random() * r.replies.length)];
        } else {
          reply = r.reply;
        }
        break;
      }
    }

    const t = showTypingIndicator();
    setTimeout(() => { t.remove(); addMessage(reply, 'bot'); }, 600 + Math.random() * 400);
  }

  // ── Open / Close ──
  if (chatBubble && chatWindow) {
    chatBubble.addEventListener('click', () => {
      chatWindow.classList.toggle('open');
      if (!chatWindow.dataset.welcomed && chatWindow.classList.contains('open')) {
        chatWindow.dataset.welcomed = 'true';
        chatMessages.innerHTML = '';
        const t = showTypingIndicator();
        setTimeout(() => {
          t.remove();
          addMessage("Hello! Welcome to Studio Serena ✦\nHow can I help you today?", 'bot');
        }, 400);
      }
    });
  }

  if (chatClose && chatWindow) {
    chatClose.addEventListener('click', () => chatWindow.classList.remove('open'));
  }

  // ── Send / Enter ──
  if (chatSendBtn && chatInput) {
    chatSendBtn.addEventListener('click', () => {
      handleChat(chatInput.value);
      chatInput.value = '';
    });
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { handleChat(chatInput.value); chatInput.value = ''; }
    });
  }

  // ── Suggestion chips ──
  if (chatSugs) {
    chatSugs.addEventListener('click', e => {
      const chip = e.target.closest('.chat-sug');
      if (chip) {
        const text = (chip.dataset.en || chip.textContent).replace(/\s+/g, ' ').trim();
        handleChat(text);
      }
    });
  }

} // end guard