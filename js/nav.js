// ── SHARED CHROME BEHAVIOUR ──
// Nav/footer are injected asynchronously by include.js, so everything that
// touches them waits for "partials:loaded". Reveal-on-scroll and counters
// target page-owned elements that exist at parse time, so they init immediately.

// ── SCROLL REVEAL ──
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) e.target.classList.add('visible');
  });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal, .reveal-left').forEach((el) => revealObserver.observe(el));
// Exposed so pages that inject cards after fetching from Supabase (team/gallery)
// can observe newly-added nodes instead of them staying invisible forever.
window._observeReveal = (el) => revealObserver.observe(el);

// ── ANIMATED COUNTERS ──
const counterObs = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting && !e.target.dataset.counted) {
      e.target.dataset.counted = '1';
      const target = parseInt(e.target.dataset.target, 10);
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
document.querySelectorAll('.counter').forEach((c) => counterObs.observe(c));

// ── BROKEN IMAGE FALLBACK ──
function applyImgFallback(img) {
  if (img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = '1';
  img.style.display = 'none';
  const wrap = img.parentElement;
  if (!wrap || wrap.querySelector('.img-fallback-icon')) return;
  if (!wrap.style.position) wrap.style.position = 'relative';
  wrap.style.background = 'var(--taupe)';
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-image img-fallback-icon';
  icon.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.8rem;color:#fff;opacity:0.55;';
  wrap.appendChild(icon);
}
window._applyImgFallback = applyImgFallback;
document.querySelectorAll('.team-img-wrap img, .team-card-photo img, .mini-stylist-card img, .gallery-cat-img-wrap img, .service-thumb img').forEach((img) => {
  if (img.complete && img.naturalWidth === 0) applyImgFallback(img);
  else img.addEventListener('error', () => applyImgFallback(img));
});

// ── LANGUAGE STATE (persisted — the old site reset to English on every reload) ──
let lang = localStorage.getItem('ss_lang') || 'en';
document.documentElement.lang = lang;

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-en]').forEach((el) => {
    const val = el.getAttribute('data-' + lang);
    if (!val) return;
    // Only preserve child nodes if a CHILD is itself independently translatable
    // (e.g. a nested <em data-en="...">) — a plain <br> shouldn't trigger this
    // path, or every text node around it gets overwritten with the full string.
    const hasTranslatableChildren = Array.from(el.children).some((child) => child.hasAttribute('data-en'));
    if (hasTranslatableChildren) {
      Array.from(el.childNodes).forEach((node) => {
        if (node.nodeType === 3 && node.textContent.trim()) node.textContent = val;
      });
    } else {
      el.innerHTML = val;
    }
  });
  document.querySelectorAll('.faq-a p[data-en]').forEach((el) => {
    const val = el.getAttribute('data-' + lang);
    if (val) el.innerHTML = val;
  });
  const langBtn = document.getElementById('langToggle');
  const langBtnMob = document.getElementById('langToggleMob');
  const label = lang === 'en' ? 'NO | EN' : 'EN | NO';
  if (langBtn) langBtn.textContent = label;
  if (langBtnMob) langBtnMob.textContent = label;
  document.dispatchEvent(new CustomEvent('lang:changed', { detail: { lang } }));
}
window._applyLang = applyLang;
window._getLang = () => lang;
applyLang();

// The site is light-only. There is deliberately no theme state here: this
// used to read prefers-color-scheme and set data-theme="dark", which meant
// anyone whose phone was in dark mode got a near-black palette instead of
// the cream one. Any stale choice from that version is cleared below.
try { localStorage.removeItem('ss_theme'); } catch (e) {}
document.documentElement.removeAttribute('data-theme');

// ── NAV/FOOTER-DEPENDENT WIRING ──
function initChrome() {
  const navbar = document.getElementById('navbar');
  const scrollProgress = document.getElementById('scroll-progress');
  const backTop = document.getElementById('back-top');

  window.addEventListener('scroll', () => {
    if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 60);
    if (backTop) backTop.classList.toggle('visible', window.scrollY > 400);
    if (scrollProgress) {
      const docH = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const pct = docH > 0 ? (window.scrollY / docH) * 100 : 0;
      scrollProgress.style.width = pct.toFixed(2) + '%';
    }
  });
  if (backTop) backTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  const closeMenu = document.getElementById('closeMenu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', (e) => {
      e.stopPropagation();
      mobileMenu.classList.toggle('open');
    });
  }
  if (closeMenu && mobileMenu) closeMenu.addEventListener('click', () => mobileMenu.classList.remove('open'));
  // Dropdown UX: click anywhere outside it to close.
  document.addEventListener('click', (e) => {
    if (mobileMenu && mobileMenu.classList.contains('open') && !mobileMenu.contains(e.target) && e.target !== hamburger) {
      mobileMenu.classList.remove('open');
    }
  });
  if (mobileMenu) {
    mobileMenu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => mobileMenu.classList.remove('open')));
  }

  const langBtn = document.getElementById('langToggle');
  if (langBtn) {
    langBtn.addEventListener('click', () => {
      lang = lang === 'en' ? 'no' : 'en';
      localStorage.setItem('ss_lang', lang);
      applyLang();
    });
  }
  const langBtnMob = document.getElementById('langToggleMob');
  if (langBtnMob) langBtnMob.addEventListener('click', () => { if (langBtn) langBtn.click(); });

  // Highlight current page in nav
  const here = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '/index.html') || '/index.html';
  document.querySelectorAll('.nav-links a, .mobile-menu a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && (href === here || (here === '/index.html' && href === '/index.html'))) {
      a.classList.add('nav-active');
    }
  });

  // Bell dot: lit up if the last "My Appointments" lookup this session found
  // an upcoming booking. Set by js/appointments.js — no extra query per page.
  const bellDot = document.getElementById('navBellDot');
  if (bellDot && parseInt(sessionStorage.getItem('ss_upcoming_count') || '0', 10) > 0) {
    bellDot.hidden = false;
  }

  applyLang(); // re-apply now that nav/footer text nodes with data-en exist
}

if (document.querySelector('[data-include]')) {
  document.addEventListener('partials:loaded', initChrome);
} else {
  // Page has no partials (shouldn't normally happen) — wire up whatever's inline.
  initChrome();
}

// ── PRELOADER (index.html only, harmless no-op elsewhere) ──
window.addEventListener('load', () => {
  setTimeout(() => {
    const preloader = document.getElementById('preloader');
    if (preloader) {
      preloader.classList.add('hidden');
      setTimeout(() => preloader.remove(), 500);
    }
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }, 600);
});
