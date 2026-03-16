// ── WELCOME POPUP ──
(function() {
  function closePopup() {
    const popup = document.getElementById('welcome-popup');
    if (!popup) return;
    // Restore scroll IMMEDIATELY — never inside a timeout
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    popup.classList.add('closing');
    setTimeout(() => { popup.style.display = 'none'; }, 400);
    // Trigger toast after 3s on popup close
    setTimeout(() => { if (typeof window._showToast === 'function') window._showToast(); }, 3000);
  }
  function initPopup() {
    const btnClose = document.getElementById('popupClose');
    const btnX     = document.getElementById('popupX');
    const popup    = document.getElementById('welcome-popup');
    if (btnClose) btnClose.addEventListener('click', closePopup);
    if (btnX)     btnX.addEventListener('click', closePopup);
    if (popup)    popup.addEventListener('click', e => { if (e.target === popup) closePopup(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopup(); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
  } else {
    initPopup();
  }
})();

// ── PRELOADER ──
window.addEventListener('load', () => {
  setTimeout(() => {
    const preloader = document.getElementById('preloader');
    if (preloader) {
      preloader.classList.add('hidden');
      setTimeout(() => preloader.remove(), 500);
    }
    // Always ensure body can scroll after preloader
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }, 1000);
});

// ── NAV & BACK TO TOP ──
const navbar = document.getElementById('navbar');
const scrollProgress = document.getElementById('scroll-progress');
window.addEventListener('scroll', () => {
  if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 60);
  const backTop = document.getElementById('back-top');
  if (backTop) backTop.classList.toggle('visible', window.scrollY > 400);
  // Scroll progress bar
  if (scrollProgress) {
    const docH = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const pct = docH > 0 ? (window.scrollY / docH) * 100 : 0;
    scrollProgress.style.width = pct.toFixed(2) + '%';
  }
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
  function _syncThemeIcon(isDark) {
    const moon = themeBtn.querySelector('.theme-icon-moon');
    const sun  = themeBtn.querySelector('.theme-icon-sun');
    if (moon) moon.style.display = isDark ? 'none' : '';
    if (sun)  sun.style.display  = isDark ? ''     : 'none';
  }
  themeBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    _syncThemeIcon(!isDark);
    // Re-render black card tier if visible
    if (typeof window._bcRender === 'function') window._bcRender();
  });
  // Sync icon on page load
  _syncThemeIcon(document.documentElement.getAttribute('data-theme') === 'dark');
}

// ── LANGUAGE TOGGLE ──
let lang = 'en';
const langBtn = document.getElementById('langToggle');
const langBtnMob = document.getElementById('langToggleMob');
if (langBtn) {
  langBtn.addEventListener('click', () => {
    lang = lang === 'en' ? 'no' : 'en';
    langBtn.textContent = lang === 'en' ? 'NO | EN' : 'EN | NO';
    if (langBtnMob) langBtnMob.textContent = langBtn.textContent;

    // Translate all [data-en] elements — smart: preserve child elements
    document.querySelectorAll('[data-en]').forEach(el => {
      const val = el.getAttribute('data-' + lang);
      if (!val) return;
      // If element has child ELEMENT nodes (icons, links etc), only update text nodes
      const hasChildElements = Array.from(el.childNodes).some(n => n.nodeType === 1);
      if (hasChildElements) {
        // Only update text nodes directly inside this element, leave child elements alone
        Array.from(el.childNodes).forEach(node => {
          if (node.nodeType === 3 && node.textContent.trim()) {
            // This is a text node with content — but we use data-en on parent for context only
            // Skip direct text replacement here; child spans handle their own data-en
          }
        });
      } else {
        el.innerHTML = val;
      }
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

    // Translate popup if still visible
    const popupTitle = document.querySelector('.popup-title');
    const popupText  = document.querySelector('.popup-text');
    const popupBadge = document.querySelector('.popup-badge span');
    const popupBtn   = document.querySelector('.popup-close span');
    if (popupTitle) {
      const v = popupTitle.getAttribute('data-' + lang);
      if (v) popupTitle.innerHTML = v;
    }
    if (popupText) {
      const v = popupText.getAttribute('data-' + lang);
      if (v) popupText.innerHTML = v;
    }
    if (popupBadge) {
      const v = popupBadge.getAttribute('data-' + lang);
      if (v) popupBadge.textContent = v;
    }
    if (popupBtn) {
      const v = popupBtn.getAttribute('data-' + lang);
      if (v) popupBtn.textContent = v;
    }
  });
}


if (langBtnMob) {
  langBtnMob.addEventListener('click', () => { if (langBtn) langBtn.click(); });
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
    './html/Pics/Balayage/Balayage22.jpeg',
    './html/Pics/Balayage/vid23.mp4',
    './html/Pics/Balayage/Balayage4.jpeg',
    './html/Pics/Balayage/vid5.mp4',
    './html/Pics/Balayage/Balayage5.jpeg',
    './html/Pics/Balayage/vid4.mp4',
    './html/Pics/Balayage/Balayage32.jpeg',
    './html/Pics/Balayage/vid21.mp4',
    './html/Pics/Balayage/Balayage6.jpeg',
    './html/Pics/Balayage/vid6.mp4',
    './html/Pics/Balayage/Balayage21.jpeg',
    './html/Pics/Balayage/vid25.mp4',
    './html/Pics/Balayage/Balayage7.jpeg',
    './html/Pics/Balayage/vid7.mp4',
    './html/Pics/Balayage/Balayage17.jpeg',
    './html/Pics/Balayage/vid8.mp4',
    './html/Pics/Balayage/Balayage19.jpeg',
    './html/Pics/Balayage/vid24.mp4',
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
    './html/Pics/Balayage/vid22.mp4',
    './html/Pics/Balayage/vid28.mp4',
     './html/Pics/Balayage/vid27.mp4',
    './html/Pics/Balayage/Balayage14.jpeg',
    
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
    './html/Pics/Brides/Bride3.jpeg' ,
    './html/Pics/Brides/Bride7.jpeg',
  ],
  Farge: [
    './html/Pics/Farge/Farge1.jpeg',
    './html/Pics/Farge/vid21.mp4',
    './html/Pics/Farge/Farge2.jpeg',
    './html/Pics/Farge/vid2.mp4',
    './html/Pics/Farge/Farge3.jpeg',
    './html/Pics/Farge/vid3.mp4',
    './html/Pics/Farge/Farge4.jpeg',
     './html/Pics/Farge/vid4.mp4',
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
    './html/Pics/Styling/styling1.jpeg',
    './html/Pics/Styling/vid1.mp4',
    './html/Pics/Styling/styling4.jpeg',
    './html/Pics/Styling/styling5.jpeg',
    './html/Pics/Styling/styling10.jpeg',
    './html/Pics/Styling/styling3.jpeg',
    './html/Pics/Styling/styling2.jpeg',
    './html/Pics/Styling/styling6.jpeg',
    './html/Pics/Styling/styling7.jpeg',
    './html/Pics/Styling/styling8.jpeg',
    './html/Pics/Styling/styling9.jpeg',
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


// ── LIGHTBOX VIDEO SYSTEM — autoplay, muted, infinite loop, works on slow wifi ──

// IntersectionObserver: play when scrolled into view, pause when out → saves bandwidth on slow wifi
const _videoPlayObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const v = entry.target;
    if (entry.isIntersecting) {
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      v.pause();
    }
  });
}, { threshold: 0.2 });

function _buildVideoWrapper(src, eager) {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-wrap';

  // Shimmer shown while buffering
  const shimmer = document.createElement('div');
  shimmer.className = 'video-shimmer';
  wrapper.appendChild(shimmer);

  const video = document.createElement('video');
  video.muted       = true;
  video.loop        = true;
  video.playsInline = true;
  video.autoplay    = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('autoplay', '');
  // First few videos: preload=auto (fast start). Rest: preload=metadata (saves data on slow wifi)
  video.preload = eager ? 'auto' : 'metadata';

  const source = document.createElement('source');
  source.src  = src;
  source.type = 'video/mp4';
  video.appendChild(source);

  // Remove shimmer once first frame is ready
  video.addEventListener('loadeddata', () => {
    shimmer.style.transition = 'opacity 0.3s';
    shimmer.style.opacity = '0';
    setTimeout(() => shimmer.remove(), 320);
  }, { once: true });

  // Tap to play if autoplay was blocked (some iOS / strict browsers)
  wrapper.addEventListener('click', () => {
    if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
  });

  video.load();

  // Try play immediately — works on all muted-autoplay-capable browsers
  const tryPlay = () => { const p = video.play(); if (p && p.catch) p.catch(() => {}); };
  tryPlay();
  setTimeout(tryPlay, 150);
  setTimeout(tryPlay, 600);

  // Watch viewport to play/pause automatically
  _videoPlayObserver.observe(video);

  wrapper.appendChild(video);
  return wrapper;
}

// Only prefetch images on hover (not videos — stream them on demand to save bandwidth)
const _imgPrefetchCache = {};
document.querySelectorAll('.gallery-cat-card').forEach(card => {
  const oncard = card.getAttribute('onclick') || '';
  const match  = oncard.match(/openLightbox\('([^']+)'\)/);
  if (!match) return;
  const cat = match[1];
  const prefetch = () => {
    if (_imgPrefetchCache[cat]) return;
    _imgPrefetchCache[cat] = true;
    (galleryData[cat] || []).forEach(src => {
      if (!/\.(mp4|mov|webm)$/i.test(src)) { const i = new Image(); i.src = src; }
    });
  };
  card.addEventListener('mouseenter', prefetch);
  card.addEventListener('touchstart', prefetch, { passive: true });
});

function openLightbox(category) {
  const overlay = document.getElementById('lightboxOverlay');
  const grid    = document.getElementById('lightboxGrid');
  const title   = document.getElementById('lightboxTitle');
  if (!overlay || !grid || !title) return;

  const categoryTitles = {
    Balayage:      { en: 'Balayage',          no: 'Balayage' },
    Farge:         { en: 'Colour',            no: 'Farge' },
    HairTreatment: { en: 'Keratin Treatment', no: 'Keratinbehandling' },
    Extensions:    { en: 'Extensions',        no: 'Extensions' },
    Haircut:       { en: 'Cut & Style',       no: 'Klipp & Style' },
    Styling:       { en: 'Styling',           no: 'Styling' },
    Brides:        { en: 'Bridal',            no: 'Brud' },
  };
  const currentLang = (typeof lang !== 'undefined') ? lang : 'en';
  const titleObj = categoryTitles[category];
  title.textContent = titleObj ? titleObj[currentLang] || titleObj.en : category;

  // Clean up all previous videos before clearing grid
  grid.querySelectorAll('video').forEach(v => {
    _videoPlayObserver.unobserve(v);
    v.pause();
    v.src = '';
    v.load();
  });
  grid.innerHTML = '';

  const items = galleryData[category] || [];
  if (items.length === 0) {
    grid.innerHTML = '<p style="color:var(--greige);text-align:center;padding:2rem;">No items found.</p>';
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    return;
  }

  let videoIdx = 0;
  items.forEach(src => {
    if (/\.(mp4|mov|webm)$/i.test(src)) {
      // First 3 videos: eager (preload=auto). Rest: lazy (preload=metadata)
      grid.appendChild(_buildVideoWrapper(src, videoIdx < 3));
      videoIdx++;
    } else {
      const img = document.createElement('img');
      img.src      = src;
      img.alt      = category;
      img.loading  = 'lazy';
      img.decoding = 'async';
      grid.appendChild(img);
    }
  });

  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Force-play all videos after overlay is painted
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      grid.querySelectorAll('video').forEach(v => {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      });
    });
  });
}

function closeLightbox() {
  const overlay = document.getElementById('lightboxOverlay');
  if (!overlay) return;

  overlay.querySelectorAll('video').forEach(v => {
    _videoPlayObserver.unobserve(v);
    v.pause();
    v.src = '';
    v.innerHTML = '';
    v.load();
  });

  overlay.classList.remove('active');
  document.body.style.overflow = '';

  setTimeout(() => {
    const grid = document.getElementById('lightboxGrid');
    if (grid) grid.innerHTML = '';
  }, 300);
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
    pct = Math.min(0.99, Math.max(0.01, pct)); // clamp away from 0/1 to avoid divide-by-zero
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
      reply: "Taniya S. is our Treatment Expert, specialising in Keratin and restorative treatments ✦"
    },
    {
      keys: ['heba'],
      reply: "Heba K. is our Creative Lead & Communications ✦\n\nShe specialises in digital artistry and high-end client relations — the architect of our online world and the voice behind every appointment."
    },
    {
      keys: ['team', 'staff', 'stylists', 'ansatte', 'hvem jobber'],
      reply: "Our expert team:\n✦ Hassan K. — Founder (25+ years luxury experience)\n✦ Kani M. — Stylist & MUA (bridal & balayage)\n✦ Taniya S. — Treatment Expert (Keratin & restoration)\n✦ Heba K. — Creative Lead & Communications"
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
// ═══════════════════════════════════════════════════════════════
// NEW FEATURES
// ═══════════════════════════════════════════════════════════════

// ── HERO TIME-OF-DAY GREETING ──
(function() {
  const el = document.getElementById('heroTimeGreeting');
  if (!el) return;
  const h = new Date().getHours();
  const day = new Date().getDay();
  const msgs = {
    en: [
      h < 6  ? 'Still up? Come in tomorrow — we open at 11.' :
      h < 12 ? 'Good morning — start your week looking incredible.' :
      h < 17 ? 'Good afternoon — treat yourself today.' :
      h < 21 ? 'Good evening — your glow-up starts here.' :
               'Late night browsing? DM us on Instagram.',
    ],
    no: [
      h < 6  ? 'Fremdeles oppe? Kom innom i morgen — vi åpner kl. 11.' :
      h < 12 ? 'God morgen — start uken din med å se fantastisk ut.' :
      h < 17 ? 'God ettermiddag — unne deg selv litt i dag.' :
      h < 21 ? 'God kveld — din forvandling starter her.' :
               'Seint ute? Send oss en DM på Instagram.',
    ]
  };
  // Weekend special
  let msgEn = msgs.en[0];
  let msgNo = msgs.no[0];
  if (day === 0 || day === 6) {
    msgEn = 'Enjoying the weekend? Book ahead for next week.';
    msgNo = 'Nyter helgen? Bestill time til neste uke.';
  }
  el.setAttribute('data-en', msgEn);
  el.setAttribute('data-no', msgNo);
  el.textContent = msgEn;
})();

// ── LANGUAGE AUTO-DETECT BANNER ──
(function() {
  const banner = document.getElementById('langBanner');
  const bannerText = document.getElementById('langBannerText');
  if (!banner || !bannerText) return;

  // Only show once per session
  if (sessionStorage.getItem('langBannerDismissed')) return;

  const browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  const isNorwegian = browserLang.startsWith('nb') || browserLang.startsWith('nn') || browserLang.startsWith('no');
  const isEnglish = browserLang.startsWith('en');

  // Only show if browser language differs from current lang variable
  setTimeout(() => {
    if (isNorwegian && lang === 'en') {
      bannerText.textContent = 'Vi ser at du er norsk — vil du bytte til norsk?';
      document.getElementById('langBannerNO').classList.add('active');
      banner.style.display = 'flex';
    } else if (isEnglish && lang === 'no') {
      bannerText.textContent = 'We detected English — switch language?';
      document.getElementById('langBannerEN').classList.add('active');
      banner.style.display = 'flex';
    }
  }, 2000);
})();

function langBannerPick(l) {
  const banner = document.getElementById('langBanner');
  if (banner) banner.style.display = 'none';
  sessionStorage.setItem('langBannerDismissed', '1');
  // Trigger the same lang toggle logic
  if (l !== lang) {
    const langBtn = document.getElementById('langToggle');
    if (langBtn) langBtn.click();
  }
}

// ── APPOINTMENT REMINDER TOAST ──
(function() {
  const toast = document.getElementById('apptToast');
  if (!toast) return;

  // Exposed so popup close can trigger it
  window._showToast = function() {
    if (sessionStorage.getItem('toastShown')) return;
    sessionStorage.setItem('toastShown', '1');
    toast.style.display = 'flex';
    toast.style.opacity = '1';
    toast.classList.remove('is-showing');
    void toast.offsetWidth;
    toast.classList.add('is-showing');
    // Auto-hide after 30 seconds
    setTimeout(() => {
      toast.style.transition = 'opacity 0.5s';
      toast.style.opacity = '0';
      setTimeout(() => { toast.style.display = 'none'; toast.style.opacity = ''; toast.style.transition = ''; }, 500);
    }, 30000);
  };

  // Close button (X)
  const xBtn = document.getElementById('apptToastX');
  if (xBtn) xBtn.addEventListener('click', () => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; toast.style.opacity = ''; toast.style.transition = ''; }, 300);
  });
})();

// ── BLACK CARD ──
(function() {
  const card = document.getElementById('bcCard');
  const nameInput = document.getElementById('bcNameInput');
  const holderName = document.getElementById('bcHolderName');
  const tierBadge = document.getElementById('bcTierBadge');
  const tierInfo = document.getElementById('bcTierInfo');
  const dotsEl = document.getElementById('bcDots');
  if (!card) return;

  const tiers = [
    { name: 'New Client',    nameNo: 'Ny Klient',       min: 0, color: 'rgba(181,168,154,0.7)' },
    { name: 'Silver Client', nameNo: 'Sølv Klient',     min: 2, color: '#c0c0c0' },
    { name: 'Gold Client',   nameNo: 'Gull Klient',     min: 4, color: '#C9A96E' },
    { name: 'VIP ✦',         nameNo: 'VIP ✦',           min: 6, color: '#fff' },
  ];

  // Load saved data
  const savedName = localStorage.getItem('bcName') || '';
  const visits = parseInt(localStorage.getItem('ssVisitCount') || '1');

  if (savedName) {
    holderName.textContent = savedName.toUpperCase();
    if (nameInput) nameInput.value = savedName;
  }

  function renderCard() {
    // Dots — 1 per visit, max 7
    if (dotsEl) {
      dotsEl.innerHTML = '';
      for (let i = 0; i < 7; i++) {
        const d = document.createElement('div');
        d.className = 'bc-visit-dot' + (i < visits ? ' filled' : '');
        dotsEl.appendChild(d);
      }
    }
    // Tier
    const currentTier = [...tiers].reverse().find(t => visits >= t.min) || tiers[0];
    if (tierBadge) {
      tierBadge.textContent = lang === 'no' ? currentTier.nameNo : currentTier.name;
      tierBadge.style.color = currentTier.color;
    }
    // Next tier info
    const nextTier = tiers.find(t => t.min > visits);
    if (tierInfo && nextTier) {
      const visitsNeeded = nextTier.min - visits;
      tierInfo.textContent = lang === 'no'
        ? `${visitsNeeded} besøk til ${nextTier.nameNo}`
        : `${visitsNeeded} more visit${visitsNeeded !== 1 ? 's' : ''} until ${nextTier.name}`;
    } else if (tierInfo) {
      tierInfo.textContent = lang === 'no' ? 'Du er VIP ✦' : 'You\'ve reached VIP status ✦';
    }
  }

  renderCard();

  // Name input
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      const v = nameInput.value.trim();
      if (holderName) holderName.textContent = v ? v.toUpperCase() : (lang === 'no' ? 'DITT NAVN' : 'YOUR NAME');
      if (v) localStorage.setItem('bcName', v);
    });
  }

  // 3D tilt on hover
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(700px) rotateY(${x * 20}deg) rotateX(${-y * 14}deg) translateY(-6px)`;
    card.style.boxShadow = `${-x * 20}px ${y * 10}px 50px rgba(0,0,0,0.6)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    card.style.boxShadow = '0 20px 60px rgba(0,0,0,0.5)';
  });

  // Re-render when lang changes
  window._bcRender = renderCard;
})();

// ── STYLE QUIZ ──
const quizAnswers = {
  frizz:   { en: 'Keratin Treatment',       no: 'Keratinbehandling',     descEn: 'Your hair is crying out for a Keratin Treatment. It will eliminate frizz, restore shine, and last up to 6 months. Taniya S. is our specialist — she will transform it completely.', descNo: 'Håret ditt ber om en Keratinbehandling. Den eliminerer krøll, gjenoppretter glans og varer opptil 6 måneder. Taniya S. er vår spesialist.' },
  colour:  { en: 'Balayage',                no: 'Balayage',              descEn: 'You need Balayage. Our signature freehand colouring technique creates natural-looking sun-kissed dimension with zero harsh lines. Hassan K. is the master of this craft.', descNo: 'Du trenger Balayage. Vår signatur frihand-fargeteknikk skaper naturlig solkysset dimensjon uten harde linjer. Hassan K. er mester i dette.' },
  length:  { en: 'Hair Extensions',         no: 'Hårextensions',         descEn: 'Extensions are your answer. We apply high-quality extensions that blend seamlessly with your natural hair — nobody will ever know. Hassan specialises in making them look and feel completely real.', descNo: 'Extensions er svaret ditt. Vi applicerer høykvalitetsextensions som blender sømløst med naturlig hår — ingen vil vite det.' },
  special: { en: 'Bridal & Event Package',  no: 'Brudie- og Eventpakke', descEn: 'For a special occasion, you deserve the full bridal experience — hair and makeup by Kani M., our Senior Stylist and Makeup Artist. Every detail, perfected.', descNo: 'For en spesiell anledning fortjener du den fulle brudeopplevelsen — hår og sminke av Kani M.' },
  health:  { en: 'Protein Treatment',       no: 'Proteinbehandling',     descEn: 'A Protein Treatment will rebuild your hair from the inside. It replenishes broken protein bonds caused by heat and chemical processing — leaving hair noticeably stronger and fuller.', descNo: 'En proteinbehandling vil gjenoppbygge håret ditt innenfra. Den fyller ødelagte proteinbindinger forårsaket av varme og kjemisk behandling.' },
  hijabi:  { en: 'Private Hijabi Service',  no: 'Privat Hijabi-tjeneste', descEn: 'We have a fully private room exclusively for hijabi clients. Complete privacy, complete respect, complete artistry. Book in advance to secure your private appointment.', descNo: 'Vi har et fullt privat rom eksklusivt for hijabi-klienter. Komplett personvern, komplett respekt, komplett håndverk.' },
};

function quizPick(answer) {
  const result = quizAnswers[answer];
  if (!result) return;
  document.getElementById('quizStep1').style.display = 'none';
  const wrap = document.getElementById('quizResult');
  wrap.style.display = 'block';
  const serviceEl = document.getElementById('quizService');
  const descEl = document.getElementById('quizDesc');
  if (serviceEl) { serviceEl.textContent = lang === 'no' ? result.no : result.en; }
  if (descEl) { descEl.textContent = lang === 'no' ? result.descNo : result.descEn; }
}

function quizRestart() {
  document.getElementById('quizStep1').style.display = 'block';
  document.getElementById('quizResult').style.display = 'none';
}