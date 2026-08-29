import { SUPABASE_URL, SUPABASE_ANON } from '/supabase-config.js';

// ── STATIC GALLERY DATA (ported as-is from the previous single-page site) ──
const galleryData = {
  Balayage: [
    './html/Pics/Balayage/Balayage1.jpeg', './html/Pics/Balayage/vid1.mp4',
    './html/Pics/Balayage/Balayage2.jpeg', './html/Pics/Balayage/vid10.mp4',
    './html/Pics/Balayage/Balayage23.jpeg', './html/Pics/Balayage/vid2.mp4',
    './html/Pics/Balayage/Balayage27.jpeg', './html/Pics/Balayage/vid11.mp4',
    './html/Pics/Balayage/Balayage8.jpeg', './html/Pics/Balayage/vid18.mp4',
    './html/Pics/Balayage/Balayage3.jpeg', './html/Pics/Balayage/vid14.mp4',
    './html/Pics/Balayage/Balayage18.jpeg', './html/Pics/Balayage/vid13.mp4',
    './html/Pics/Balayage/Balayage16.jpeg', './html/Pics/Balayage/vid12.mp4',
    './html/Pics/Balayage/Balayage22.jpeg', './html/Pics/Balayage/vid23.mp4',
    './html/Pics/Balayage/Balayage4.jpeg', './html/Pics/Balayage/vid5.mp4',
    './html/Pics/Balayage/Balayage5.jpeg', './html/Pics/Balayage/vid4.mp4',
    './html/Pics/Balayage/Balayage32.jpeg', './html/Pics/Balayage/vid21.mp4',
    './html/Pics/Balayage/Balayage6.jpeg', './html/Pics/Balayage/vid6.mp4',
    './html/Pics/Balayage/Balayage21.jpeg', './html/Pics/Balayage/vid25.mp4',
    './html/Pics/Balayage/Balayage7.jpeg', './html/Pics/Balayage/vid7.mp4',
    './html/Pics/Balayage/Balayage17.jpeg', './html/Pics/Balayage/vid8.mp4',
    './html/Pics/Balayage/Balayage19.jpeg', './html/Pics/Balayage/vid24.mp4',
    './html/Pics/Balayage/Balayage9.jpeg', './html/Pics/Balayage/vid9.mp4',
    './html/Pics/Balayage/Balayage20.jpeg', './html/Pics/Balayage/vid20.mp4',
    './html/Pics/Balayage/Balayage10.jpeg', './html/Pics/Balayage/vid3.mp4',
    './html/Pics/Balayage/Balayage11.jpeg', './html/Pics/Balayage/vid15.mp4',
    './html/Pics/Balayage/Balayage13.jpeg', './html/Pics/Balayage/vid16.mp4',
    './html/Pics/Balayage/Balayage15.jpeg', './html/Pics/Balayage/vid17.mp4',
    './html/Pics/Balayage/Balayage28.jpeg', './html/Pics/Balayage/vid19.mp4',
    './html/Pics/Balayage/vid22.mp4', './html/Pics/Balayage/vid28.mp4',
    './html/Pics/Balayage/vid27.mp4', './html/Pics/Balayage/Balayage14.jpeg',
  ],
  Brides: [
    './html/Pics/Brides/Bride4.jpeg', './html/Pics/Brides/vid2.mp4',
    './html/Pics/Brides/Bride5.jpeg', './html/Pics/Brides/Bride6.jpeg',
    './html/Pics/Brides/vid3.mp4', './html/Pics/Brides/Bride2.jpeg',
    './html/Pics/Brides/Bride1.jpeg', './html/Pics/Brides/vid1.mp4',
    './html/Pics/Brides/Bride3.jpeg', './html/Pics/Brides/Bride7.jpeg',
  ],
  Farge: [
    './html/Pics/Farge/Farge1.jpeg', './html/Pics/Farge/vid21.mp4',
    './html/Pics/Farge/Farge2.jpeg', './html/Pics/Farge/vid2.mp4',
    './html/Pics/Farge/Farge3.jpeg', './html/Pics/Farge/vid3.mp4',
    './html/Pics/Farge/Farge4.jpeg', './html/Pics/Farge/vid4.mp4',
    './html/Pics/Farge/Farge5.jpeg', './html/Pics/Farge/vid5.mp4',
    './html/Pics/Farge/Farge6.jpeg',
  ],
  Extensions: [
    './html/Pics/Extensions/vid4.mp4', './html/Pics/Extensions/vid7.mp4',
    './html/Pics/Extensions/vid6.mp4', './html/Pics/Extensions/vid2.mp4',
    './html/Pics/Extensions/vid3.mp4', './html/Pics/Extensions/vid11.mp4',
    './html/Pics/Extensions/vid1.mp4', './html/Pics/Extensions/vid5.mp4',
    './html/Pics/Extensions/vid9.mp4', './html/Pics/Extensions/vid8.mp4',
  ],
  Haircut: [
    './html/Pics/Haircut/Haircut5.jpeg', './html/Pics/Haircut/vid1.mp4',
    './html/Pics/Haircut/Haircut3.jpeg', './html/Pics/Haircut/vid2.mp4',
    './html/Pics/Haircut/vid4.mp4', './html/Pics/Haircut/vid3.mp4',
    './html/Pics/Haircut/Haircut1.jpeg', './html/Pics/Haircut/Haircut2.jpeg',
    './html/Pics/Haircut/Haircut4.jpeg', './html/Pics/Haircut/vid5.mp4',
  ],
  Styling: [
    './html/Pics/Styling/styling1.jpeg', './html/Pics/Styling/vid1.mp4',
    './html/Pics/Styling/styling4.jpeg', './html/Pics/Styling/styling5.jpeg',
    './html/Pics/Styling/styling10.jpeg', './html/Pics/Styling/styling3.jpeg',
    './html/Pics/Styling/styling2.jpeg', './html/Pics/Styling/styling6.jpeg',
    './html/Pics/Styling/styling7.jpeg', './html/Pics/Styling/styling8.jpeg',
    './html/Pics/Styling/styling9.jpeg',
  ],
  HairTreatment: [
    './html/Pics/Treatment/Ht1.mp4', './html/Pics/Treatment/Ht2.mp4',
    './html/Pics/Treatment/Ht4.mp4', './html/Pics/Treatment/Ht7.mp4',
    './html/Pics/Treatment/Ht3.mp4', './html/Pics/Treatment/Ht8.mp4',
    './html/Pics/Treatment/Ht11.mp4', './html/Pics/Treatment/Ht9.mp4',
    './html/Pics/Treatment/Ht12.mp4', './html/Pics/Treatment/Ht6.mp4',
    './html/Pics/Treatment/Ht5.mp4', './html/Pics/Treatment/Ht10.mp4',
  ],
  Nails: [
    './html/Pics/Nails/Nails1.jpeg', './html/Pics/Nails/Nails2.jpeg',
    './html/Pics/Nails/Nails3.jpeg', './html/Pics/Nails/Nails4.jpeg',
    './html/Pics/Nails/Nails5.jpeg',
  ],
};

// ── CLOUD MERGE (Supabase Storage) ──
(async function loadCloudGallery() {
  try {
    const CATEGORIES = ['Balayage', 'Farge', 'HairTreatment', 'Extensions', 'Haircut', 'Styling', 'Brides'];
    await Promise.all(CATEGORIES.map(async (cat) => {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/gallery`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: cat + '/', limit: 200, offset: 0 }),
      });
      if (!res.ok) return;
      const files = await res.json();
      if (!Array.isArray(files) || files.length === 0) return;
      const urls = files.map((f) => `${SUPABASE_URL}/storage/v1/object/public/gallery/${cat}/${f.name}`);
      galleryData[cat] = [...urls, ...(galleryData[cat] || [])];
    }));
  } catch (e) { /* static gallery still works */ }
})();

// ── CUSTOM CATEGORIES (added via admin.html) ──
(async function loadCustomCategories() {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/gallery/_custom_cats.json`);
    if (!res.ok) return;
    const cats = await res.json();
    if (!Array.isArray(cats) || cats.length === 0) return;
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;

    await Promise.all(cats.map(async ({ name, key, coverUrl }) => {
      if (!galleryData[key]) galleryData[key] = [];
      const listRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/gallery`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: key + '/', limit: 200, offset: 0 }),
      });
      if (listRes.ok) {
        const files = await listRes.json();
        if (Array.isArray(files)) {
          const urls = files.filter((f) => f.name !== 'cover.jpg').map((f) => `${SUPABASE_URL}/storage/v1/object/public/gallery/${key}/${f.name}`);
          galleryData[key] = [...urls, ...galleryData[key]];
        }
      }
      const card = document.createElement('div');
      card.className = 'gallery-cat-card';
      card.dataset.cat = key;
      card.addEventListener('click', () => openLightbox(key));
      const imgWrap = document.createElement('div');
      imgWrap.className = 'gallery-cat-img-wrap';
      if (coverUrl) {
        const img = document.createElement('img');
        img.src = coverUrl; img.alt = name; img.loading = 'lazy'; img.decoding = 'async';
        imgWrap.appendChild(img);
      } else {
        imgWrap.innerHTML = '<div style="background:var(--warmgrey);width:100%;height:100%;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-images" style="font-size:2rem;color:#fff;opacity:0.5"></i></div>';
      }
      const labelEl = document.createElement('div');
      labelEl.className = 'gallery-cat-label';
      labelEl.textContent = name;
      card.append(imgWrap, labelEl);
      grid.appendChild(card);
    }));
  } catch (e) { /* no custom categories yet */ }
})();

// ── LIGHTBOX ──
// Every video in a category used to fetch and start playing the moment the
// category opened - preload:auto plus an immediate .load() and three play
// attempts, for all twenty-odd videos at once, whether or not a single one
// of them was ever going to be seen. A phone on the gallery tab was pulling
// 50-100MB before it had shown a single frame. The observer already existed
// to pause a video once it scrolled away; it just never gated the loading
// in the first place, only the playing.
//
// Now nothing is fetched until a video actually enters the viewport - the
// same observer does both jobs: load it the first time it appears, then
// play/pause it as it scrolls in and out, same as before.
const _videoPlayObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    const v = entry.target;
    if (entry.isIntersecting) {
      if (!v.dataset.loaded) {
        v.dataset.loaded = '1';
        v.preload = 'auto';
        v.load();
      }
      v.muted = true;
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      v.pause();
    }
  });
}, { threshold: 0.1, rootMargin: '100px 0px' });

const _videoCache = {};

function _buildVideoWrapper(src) {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-wrap';
  wrapper.style.cssText = 'position:relative;width:100%;padding-bottom:125%;height:0;overflow:hidden;border-radius:10px;background:#1a1715;display:block;';

  const shimmer = document.createElement('div');
  shimmer.className = 'video-shimmer';
  wrapper.appendChild(shimmer);

  const video = document.createElement('video');
  video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center;display:block;pointer-events:none;';
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  // Nothing until the intersection observer says this one is actually on
  // screen - see the observer above. 'none' rather than 'metadata' because
  // even a metadata-only fetch on every video in a category is still twenty
  // network requests fired at once for nothing anyone can see yet.
  //
  // NO autoplay attribute - this is the one that actually mattered. Per
  // spec, a browser honours preload='none' only until autoplay is also
  // present, at which point it is entitled to act as though preload were
  // 'auto' regardless, since autoplaying requires having something to play.
  // Every video here had autoplay set from the moment it was created, so
  // every preload='none' above was silently overridden the instant Chrome
  // saw both attributes together - which is why all 28 videos in a category
  // were still fetched immediately even after the observer-gating fix.
  // Playback now happens only through the explicit .play() calls already in
  // the observer callback and the click handler below.
  video.preload = 'none';
  video.setAttribute('muted', '');
  video.setAttribute('disablepictureinpicture', '');
  video.setAttribute('playsinline', '');

  const source = document.createElement('source');
  source.src = src;
  source.type = 'video/mp4';
  video.appendChild(source);

  video.addEventListener('loadeddata', () => {
    shimmer.style.transition = 'opacity 0.3s';
    shimmer.style.opacity = '0';
    setTimeout(() => { if (shimmer.parentNode) shimmer.remove(); }, 320);
  }, { once: true });
  video.addEventListener('playing', () => wrapper.classList.add('playing'), { once: true });

  wrapper.addEventListener('click', () => {
    video.muted = true;
    if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
  });

  // Loading and the first play attempt happen once the observer below sees
  // this video on screen, not here - this function only builds the element.

  wrapper.appendChild(video);
  return { wrapper, video };
}

const categoryTitles = {
  Balayage: { en: 'Balayage', no: 'Balayage' },
  Farge: { en: 'Colour', no: 'Farge' },
  HairTreatment: { en: 'Keratin Treatment', no: 'Keratinbehandling' },
  Extensions: { en: 'Extensions', no: 'Extensions' },
  Haircut: { en: 'Cut & Style', no: 'Klipp & Style' },
  Styling: { en: 'Styling', no: 'Styling' },
  Brides: { en: 'Bridal', no: 'Brud' },
  Nails: { en: 'Nails', no: 'Negler' },
};

function openLightbox(category) {
  const overlay = document.getElementById('lightboxOverlay');
  const grid = document.getElementById('lightboxGrid');
  const title = document.getElementById('lightboxTitle');
  if (!overlay || !grid || !title) return;

  const currentLang = (window._getLang && window._getLang()) || 'en';
  const titleObj = categoryTitles[category];
  title.textContent = titleObj ? (titleObj[currentLang] || titleObj.en) : category;

  grid.querySelectorAll('video').forEach((v) => { _videoPlayObserver.unobserve(v); v.pause(); });
  grid.innerHTML = '';

  const items = galleryData[category] || [];
  if (items.length === 0) {
    grid.innerHTML = '<p style="color:var(--greige);text-align:center;padding:2rem;">No items found.</p>';
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    return;
  }

  // Every video is appended WITHOUT being observed yet. Observing an
  // element the instant it is appended - before the browser has laid the
  // grid out - gets an unreliable first intersection report: with no real
  // geometry computed yet, browsers can report most or all of a freshly
  // built grid as "intersecting", which defeated the whole point of gating
  // the fetch on visibility. Forty-odd items were all judged visible at
  // once because none of them had been through a layout pass yet.
  const videosToObserve = [];
  items.forEach((src) => {
    if (/\.(mp4|mov|webm)$/i.test(src)) {
      const cached = _videoCache[src];
      if (cached) {
        cached.video.muted = true;
        grid.appendChild(cached.wrapper);
        videosToObserve.push(cached.video);
      } else {
        const { wrapper, video } = _buildVideoWrapper(src);
        _videoCache[src] = { wrapper, video };
        grid.appendChild(wrapper);
        videosToObserve.push(video);
      }
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'media-wrap';
      wrap.style.cssText = 'position:relative;width:100%;padding-bottom:125%;height:0;overflow:hidden;border-radius:10px;display:block;background:#1a1715;';
      const img = document.createElement('img');
      img.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;object-position:center top;display:block;pointer-events:none;';
      img.src = src; img.alt = category; img.loading = 'lazy'; img.decoding = 'async';
      wrap.appendChild(img);
      grid.appendChild(wrap);
    }
  });

  overlay.classList.add('active');
  overlay.scrollTop = 0;
  document.body.style.overflow = 'hidden';

  // Two frames, not one: the first frame is where the browser applies the
  // 'active' class's display:flex and actually builds the grid's layout;
  // observing any earlier than that is the same premature-geometry problem
  // this whole block exists to avoid, just moved one step later.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      videosToObserve.forEach((v) => _videoPlayObserver.observe(v));
    });
  });
}

function closeLightbox() {
  const overlay = document.getElementById('lightboxOverlay');
  if (!overlay) return;
  overlay.style.pointerEvents = 'none';
  overlay.querySelectorAll('video').forEach((v) => { _videoPlayObserver.unobserve(v); v.pause(); });
  overlay.classList.remove('active');
  document.body.style.overflow = '';
  setTimeout(() => {
    const grid = document.getElementById('lightboxGrid');
    if (grid) grid.innerHTML = '';
    overlay.style.pointerEvents = '';
  }, 300);
}
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;

// ── TAP TO REVEAL, THEN OPEN ──
// The tiles are blurred until hovered, which shows the client the cover
// before they commit to opening a whole gallery. A phone has no hover, so a
// tap went straight past that to the lightbox and the cover was never seen at
// all - the blurred version was the only version a phone user ever got.
//
// So on a touch device the first tap clears the blur and holds it for half a
// second before opening - long enough to register the cover, short enough
// that it never feels like a wait. A second tap during that pause opens at
// once.
//
// Devices that can hover are untouched - the cover is already clear by the
// time the pointer is over it, so a delay there would just be a delay.
const CAN_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const REVEAL_PAUSE_MS = 500;

document.querySelectorAll('.gallery-cat-card[data-cat]').forEach((card) => {
  let pending = null;
  card.addEventListener('click', () => {
    if (CAN_HOVER) { openLightbox(card.dataset.cat); return; }
    if (pending) {
      clearTimeout(pending);
      pending = null;
      openLightbox(card.dataset.cat);
      return;
    }
    card.classList.add('touched');
    pending = setTimeout(() => {
      pending = null;
      openLightbox(card.dataset.cat);
      // Re-blur behind the lightbox, so coming back the tile is as it was.
      card.classList.remove('touched');
    }, REVEAL_PAUSE_MS);
  });
});

document.getElementById('lightboxCloseBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('lightboxOverlay');
    if (overlay && overlay.classList.contains('active')) closeLightbox();
  }
});
document.querySelectorAll('.reveal').forEach((el) => window._observeReveal && window._observeReveal(el));

// ── BEHAVIOUR THAT USED TO LIVE IN onclick ATTRIBUTES ──
// Inline handlers cannot run under a Content-Security-Policy that forbids
// inline script, and that policy is worth far more than the convenience: it is
// the wall that stops injected script executing at all. Same behaviour, wired
// where the policy allows it.
document.addEventListener('click', (e) => {
  // Tapping the Instagram badge on a gallery card opens Instagram; it must not
  // also open the card's own lightbox behind it.
  if (e.target.closest('.gallery-ig-link')) { e.stopPropagation(); return; }

  const overlay = document.getElementById('lightboxOverlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  // Clicking the backdrop closes; clicking the picture itself does not.
  if (e.target.closest('.lightbox-box')) return;
  if (overlay.contains(e.target) || e.target === overlay) closeLightbox();
});
