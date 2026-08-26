// ── GDPR COOKIE CONSENT ── (ported as-is from the previous single-page site)
// Norway E-Com Act §3-15 / GDPR Art. 4(11), 7 & Recital 32: Fonts/icons load
// under Legitimate Interest, Google Maps is blocked until explicit consent,
// Accept/Decline are visually equal (no dark patterns), consent is timestamped,
// withdrawable anytime via the footer's "Manage Cookies" button.
function initCookieConsent() {
  var CONSENT_KEY = 'ss_cookie_consent';
  var CONSENT_TS_KEY = 'ss_cookie_consent_ts';
  var banner = document.getElementById('cookie-banner');
  var consent = null;
  try { consent = localStorage.getItem(CONSENT_KEY); } catch (e) {}

  // Anything else pinned to the bottom of the screen needs to know how tall
  // the banner is, so it can sit above it rather than under it. Measured
  // rather than hard-coded: the height changes with the viewport and with the
  // length of the text.
  function setBannerOffset() {
    if (!banner) return;
    var h = banner.classList.contains('visible') ? banner.offsetHeight : 0;
    document.documentElement.style.setProperty('--cookie-banner-h', h + 'px');
    document.body.classList.toggle('cookie-banner-open', h > 0);
  }

  function dismiss() {
    if (banner) banner.classList.remove('visible');
    setBannerOffset();
  }

  if (!consent) {
    if (banner) {
      banner.classList.add('visible');
      setBannerOffset();
      window.addEventListener('resize', setBannerOffset);
    }
  } else if (consent === 'accepted') {
    loadMap();
  } else if (consent === 'declined') {
    showMapBlocked();
  }

  var btnAccept = document.getElementById('cookieAccept');
  var btnDecline = document.getElementById('cookieDecline');

  if (btnAccept) btnAccept.addEventListener('click', function () {
    try {
      localStorage.setItem(CONSENT_KEY, 'accepted');
      localStorage.setItem(CONSENT_TS_KEY, new Date().toISOString());
    } catch (e) {}
    dismiss();
    loadMap();
  });

  if (btnDecline) btnDecline.addEventListener('click', function () {
    try {
      localStorage.setItem(CONSENT_KEY, 'declined');
      localStorage.setItem(CONSENT_TS_KEY, new Date().toISOString());
    } catch (e) {}
    dismiss();
    showMapBlocked();
  });

  var manageBtn = document.getElementById('manageCookiesFooter');
  if (manageBtn) {
    manageBtn.addEventListener('click', function () {
      try {
        localStorage.removeItem(CONSENT_KEY);
        localStorage.removeItem(CONSENT_TS_KEY);
      } catch (e) {}
      window.location.reload();
    });
  }

  function loadMap() {
    var iframe = document.querySelector('.map-frame');
    if (iframe && !iframe.src && iframe.dataset.src) iframe.src = iframe.dataset.src;
    var ph = document.getElementById('map-blocked-placeholder');
    if (ph) ph.remove();
    if (iframe) iframe.style.display = '';
  }

  function showMapBlocked() {
    var iframe = document.querySelector('.map-frame');
    if (!iframe) return;
    iframe.style.display = 'none';
    if (document.getElementById('map-blocked-placeholder')) return;
    var ph = document.createElement('div');
    ph.id = 'map-blocked-placeholder';
    ph.className = 'map-blocked';
    ph.innerHTML =
      '<p class="map-blocked-title">Map not loaded</p>' +
      '<p>You declined cookies, so Google Maps is disabled to protect your privacy.</p>' +
      '<button class="map-enable-btn" id="mapEnableBtn">Enable map</button>';
    iframe.parentNode.insertBefore(ph, iframe);
    var enableBtn = document.getElementById('mapEnableBtn');
    if (enableBtn) {
      enableBtn.addEventListener('click', function () {
        try {
          localStorage.setItem(CONSENT_KEY, 'accepted');
          localStorage.setItem(CONSENT_TS_KEY, new Date().toISOString());
        } catch (e) {}
        loadMap();
      });
    }
  }
}

if (document.querySelector('[data-include]')) {
  document.addEventListener('partials:loaded', initCookieConsent);
} else {
  initCookieConsent();
}
