import { getMyBookings, cancelMyBooking, fetchCancellationQuote } from '/js/supabase-client.js';

const errorBox = document.getElementById('lookupError');
const resultsWrap = document.getElementById('apptResults');
const upcomingList = document.getElementById('upcomingList');
const pastList = document.getElementById('pastList');

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('visible');
}
function clearError() {
  errorBox.classList.remove('visible');
  errorBox.textContent = '';
}

function fmtDate(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}`);
  return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Escapes anything the client typed. Her own notes come back to her here, and
// a booking is not a place to trust a string just because she wrote it.
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const STATUS_WORDS = {
  pending: 'Awaiting confirmation', confirmed: 'Confirmed', arrived: 'Arrived',
  completed: 'Completed', cancelled: 'Cancelled', no_show: 'Missed',
};

function cardHtml(b, cancellable) {
  // The names come from the RPC now. It used to read b.services.name and
  // b.staff.name - nested objects the query never returned - so every card
  // said "Appointment" with no service and no stylist on it.
  const price = b.amount_charged != null
    ? `<span class="appt-card-paid">Paid ${Number(b.amount_charged).toLocaleString('nb-NO')} kr</span>`
    : (b.expected_total != null
        ? `<span class="appt-card-price">${b.expected_total_is_estimate ? 'From ' : ''}${Number(b.expected_total).toLocaleString('nb-NO')} kr</span>`
        : '');

  return `
    <div class="appt-card" data-id="${esc(b.id)}">
      <div class="appt-card-info">
        <div class="appt-card-service">${esc(b.service_name || 'Appointment')}</div>
        <div class="appt-card-meta">
          ${fmtDate(b.date, b.start_time)}${b.staff_name ? ' &middot; with ' + esc(b.staff_name) : ''}
        </div>
        ${b.addons ? `<div class="appt-card-addons">+ ${esc(b.addons)}</div>` : ''}
        ${b.notes ? `<div class="appt-card-notes"><i class="fa-solid fa-note-sticky"></i> ${esc(b.notes)}</div>` : ''}
        <div class="appt-card-tags">
          <span class="appt-card-status ${esc(b.status)}">${esc(STATUS_WORDS[b.status] || b.status)}</span>
          ${price}
          ${b.booking_ref ? `<span class="appt-card-ref">Ref ${esc(b.booking_ref)}</span>` : ''}
        </div>
      </div>
      ${cancellable ? `<button class="appt-cancel-btn" data-cancel="${esc(b.id)}">Cancel</button>` : ''}
    </div>
  `;
}

async function runLookup(email, phone) {
  clearError();
  const { data, error } = await getMyBookings(email, phone);
  if (error) {
    showError('Something went wrong looking up your appointments. Please try again.');
    return;
  }
  const bookings = data || [];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings.filter((b) => b.date >= today && b.status !== 'cancelled' && b.status !== 'completed');
  const past = bookings.filter((b) => !(b.date >= today && b.status !== 'cancelled' && b.status !== 'completed'));

  upcomingList.innerHTML = upcoming.length ? upcoming.map((b) => cardHtml(b, true)).join('') : '<p class="appt-empty">No upcoming appointments found.</p>';
  pastList.innerHTML = past.length ? past.map((b) => cardHtml(b, false)).join('') : '<p class="appt-empty">Nothing here yet.</p>';
  resultsWrap.style.display = 'block';

  sessionStorage.setItem('ss_upcoming_count', String(upcoming.length));

  upcomingList.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      // Ask what it will cost BEFORE she confirms. A fee she was not shown at
      // the moment she clicked is an ambush, not a policy — and it is the kind
      // of thing that turns one bad afternoon into a lost client and a review.
      btn.disabled = true;
      btn.textContent = 'Checking…';
      const { data: quote, error: quoteErr } = await fetchCancellationQuote({
        bookingId: btn.dataset.cancel, email, phone,
      }).catch(() => ({ error: true }));
      btn.disabled = false;
      btn.textContent = 'Cancel';

      const q = (!quoteErr && quote) ? (Array.isArray(quote) ? quote[0] : quote) : null;

      // If the quote could not be fetched, say so rather than guessing. Telling
      // her "this is free" and then charging her is far worse than asking her
      // to ring.
      if (!q) {
        showError('We could not check this booking just now. Please ring us on +47 45 39 76 31 and we will cancel it for you.');
        return;
      }

      // A blank line between paragraphs. Built from a char code rather than an
      // escape because the escapes get mangled on the way into this file.
      const BR = String.fromCharCode(10, 10);
      let message;
      if (!q.is_late) {
        message = 'Cancel this appointment?' + BR + 'There is nothing to pay.';
      } else {
        const fee = q.fee != null
          ? Number(q.fee).toLocaleString('nb-NO') + ' NOK'
            + (q.fee_is_estimate ? ' (approximately, we will confirm the exact amount)' : '')
          : 'half the price of the service';
        message = 'This is a late cancellation.' + BR
          + 'Your appointment is less than 48 hours away, so our cancellation policy '
          + 'applies and ' + fee + ' will be charged.' + BR
          + 'Cancel anyway?' + BR
          + 'If something has come up, please ring us on +47 45 39 76 31 first, '
          + 'we would much rather talk to you.';
      }
      if (!confirm(message)) return;

      btn.disabled = true;
      btn.textContent = 'Cancelling…';
      const { error: cancelErr } = await cancelMyBooking(btn.dataset.cancel, email, phone);
      if (cancelErr) {
        showError('Could not cancel - please try again.');
        btn.disabled = false;
        btn.textContent = 'Cancel';
        return;
      }
      runLookup(email, phone);
    });
  });
}

document.getElementById('lookupBtn').addEventListener('click', () => {
  const email = document.getElementById('lookupEmail').value.trim();
  const phone = document.getElementById('lookupPhone').value.trim();
  if (!email && !phone) {
    showError('Please enter your email or phone number.');
    return;
  }
  sessionStorage.setItem('ss_lookup_email', email);
  sessionStorage.setItem('ss_lookup_phone', phone);
  runLookup(email, phone);
});

// Same-session convenience: re-run automatically if we already looked up once.
const savedEmail = sessionStorage.getItem('ss_lookup_email') || '';
const savedPhone = sessionStorage.getItem('ss_lookup_phone') || '';
if (savedEmail || savedPhone) {
  document.getElementById('lookupEmail').value = savedEmail;
  document.getElementById('lookupPhone').value = savedPhone;
  runLookup(savedEmail, savedPhone);
}
