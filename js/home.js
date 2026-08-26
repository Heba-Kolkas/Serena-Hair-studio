import { fetchFeaturedServices, fetchProductImages } from '/js/supabase-client.js';

// Static fallback mirrors the real pricing on /pricelist.html so the homepage
// still looks complete (and accurate) while the database is paused/unreachable,
// or before it's been seeded.
const FALLBACK_SERVICES = [
  { name: 'Balayage / Highlights', price_from: 3750, price_is_from: true, image_url: '/html/Pics/Covers/balayage-and-highlights.jpeg' },
  { name: 'Haircut + Blowdry', price_from: 950, image_url: '/html/Pics/Covers/haircuts-and-styling.jpeg' },
  { name: 'Keratin Treatment', price_label: 'Price on Consultation', image_url: '/html/Pics/Covers/keratin-and-treatments.jpeg' },
  { name: 'Hair Extensions', price_from: 3000, image_url: '/html/Pics/Covers/hair-extensions.jpeg' },
];

function priceLabel(s) {
  if (s.price_label) return s.price_label; // static FALLBACK_SERVICES shorthand
  if (s.price_from === 0) return 'Free';
  if (s.price_on_consultation) return 'Price on Consultation';
  if (s.price_to) return 'From ' + Number(s.price_from).toLocaleString('en-US') + '–' + Number(s.price_to).toLocaleString('en-US') + ' NOK';
  // Only say "from" where the price list does — a haircut is 950 NOK flat.
  return (s.price_is_from ? 'From ' : '') + Number(s.price_from).toLocaleString('en-US') + ' NOK';
}

function renderServices(row, services) {
  row.innerHTML = services.map((s) => `
    <a class="service-thumb" href="/book.html?service=${s.id || ''}">
      <span class="service-thumb-img"><img src="${s.image_url}" alt="${s.name}" loading="lazy"></span>
      <span class="service-thumb-label">${s.name}</span>
      <span class="service-thumb-price">${priceLabel(s)}</span>
      <span class="service-thumb-book">Book Now <i class="fa-solid fa-arrow-right"></i></span>
    </a>
  `).join('');
  row.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', () => window._applyImgFallback && window._applyImgFallback(img));
  });
}

async function initPopularServices() {
  const row = document.getElementById('popularServicesRow');
  if (!row) return;
  try {
    const { data, error } = await fetchFeaturedServices();
    if (error || !data || !data.length) throw error || new Error('no featured services yet');
    renderServices(row, data);
  } catch (e) {
    renderServices(row, FALLBACK_SERVICES);
  }
}

initPopularServices();

// ── PRODUCT PHOTOS SLIDESHOW (decorative — no shop, no checkout) ──
// Falls back to a static local video (index.html's .brand-slideshow-video)
// until real product photos exist in Supabase Storage.
async function initBrandSlideshow() {
  const wrap = document.getElementById('brandSlideshow');
  if (!wrap) return;
  try {
    const { data: urls, error } = await fetchProductImages();
    if (error || !urls || !urls.length) return; // keep the fallback video

    const video = wrap.querySelector('.brand-slideshow-video');
    if (video) video.remove();
    urls.forEach((url, i) => {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Studio Serena product';
      img.loading = i === 0 ? 'eager' : 'lazy';
      if (i === 0) img.classList.add('active');
      wrap.appendChild(img);
    });

    if (urls.length > 1) {
      const dots = document.createElement('div');
      dots.className = 'brand-slideshow-dots';
      urls.forEach((_, i) => {
        const dot = document.createElement('span');
        if (i === 0) dot.classList.add('active');
        dots.appendChild(dot);
      });
      wrap.appendChild(dots);

      let current = 0;
      const imgs = wrap.querySelectorAll('img');
      const dotEls = dots.querySelectorAll('span');
      setInterval(() => {
        imgs[current].classList.remove('active');
        dotEls[current].classList.remove('active');
        current = (current + 1) % imgs.length;
        imgs[current].classList.add('active');
        dotEls[current].classList.add('active');
      }, 3500);
    }
  } catch (e) {
    // keep the "coming soon" placeholder on any failure
  }
}

initBrandSlideshow();
