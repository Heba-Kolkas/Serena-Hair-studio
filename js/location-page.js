// ── FAQ ACCORDION ──
document.querySelectorAll('.faq-q').forEach((btn) => {
  btn.addEventListener('click', () => {
    const isOpen = btn.classList.contains('open');
    document.querySelectorAll('.faq-q').forEach((b) => {
      b.classList.remove('open');
      if (b.nextElementSibling) b.nextElementSibling.style.maxHeight = '0';
    });
    if (!isOpen) {
      btn.classList.add('open');
      btn.nextElementSibling.style.maxHeight = btn.nextElementSibling.scrollHeight + 'px';
    }
  });
});

// ── OPEN/CLOSED STATUS BADGE ── (Mon-Fri 11:00-17:30, matches business_hours seed data)
function updateStatus(currentLang) {
  const badge = document.getElementById('statusBadge');
  if (!badge) return;
  const l = currentLang || (window._getLang ? window._getLang() : 'en');
  const now = new Date();
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const isOpen = day >= 1 && day <= 5 && mins >= 660 && mins < 1050;
  const openText = l === 'no' ? 'Åpen nå' : 'Open Now';
  const closedText = l === 'no' ? 'Stengt nå' : 'Closed Now';
  badge.textContent = isOpen ? openText : closedText;
  badge.className = 'status-badge reveal ' + (isOpen ? 'status-open' : 'status-closed');

  const isWeekday = day >= 1 && day <= 5;
  document.querySelectorAll('.hours-row[data-days]').forEach((row) => {
    row.setAttribute('data-active', row.dataset.days === (isWeekday ? 'weekday' : 'weekend') ? 'true' : 'false');
  });
}
window._updateLocationStatus = updateStatus;
document.addEventListener('lang:changed', (e) => updateStatus(e.detail.lang));
updateStatus();
