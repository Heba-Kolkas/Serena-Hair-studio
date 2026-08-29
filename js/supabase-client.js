// ── SHARED SUPABASE CLIENT + BOOKING RPC WRAPPERS ──
// Same createClient/CDN pattern used throughout the site's pages.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm';
import { SUPABASE_URL, SUPABASE_ANON } from '../supabase-config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// Every wrapper below resolves { data, error } — never throws — so callers can
// always render a friendly fallback instead of a blank/broken page.

export async function fetchActiveServices() {
  return supabase.from('services').select('*').eq('active', true).order('sort_order');
}

export async function fetchFeaturedServices() {
  return supabase.from('services').select('*').eq('active', true).eq('featured', true).order('sort_order');
}

export async function fetchBookableStaff() {
  return supabase.from('staff').select('*').eq('active', true).order('sort_order');
}

export async function fetchStaffForService(serviceId) {
  return supabase
    .from('staff_services')
    .select('staff:staff_id(*)')
    .eq('service_id', serviceId);
}

// The whole add-on catalog joined to the services that offer it, in one
// round trip — the wizard needs every service's options up front so
// selecting a service doesn't fire another request.
export async function fetchServiceAddons() {
  return supabase
    .from('service_addons')
    .select('service_id, sort_order, addon:addon_id(*)')
    .order('sort_order');
}

// Every stylist-to-service assignment, in one round trip. The wizard needs it
// to work out who may take an add-on that is really a service in disguise:
// the extensions add-ons carry requires_service_id, and only a stylist who
// performs THAT service may be offered.
export async function fetchAllStaffServices() {
  return supabase.from('staff_services').select('staff_id, service_id');
}

// Which (stylist, service, weekday) pairs run at fixed times, and what those
// times are. The wizard has to honour the same rows book_appointment_core
// checks, or it offers slots the booking will then refuse.
export async function fetchStaffServiceSchedule() {
  return supabase.from('staff_service_schedule').select('staff_id, service_id, weekday, start_time');
}

// How far ahead bookings are accepted. A rolling window from today, so the
// wizard asks each time rather than caching a date that would go stale.
export async function fetchBookingHorizonDays() {
  return supabase.rpc('get_booking_horizon_days');
}

// Per-stylist closing times (Kani works to 18:00 on Mon/Wed/Fri). Read
// straight off the table rather than through the owner-gated admin RPC,
// because the day strip's capacity bar needs them for anyone holding a
// staff PIN too.
// Per-stylist day rules: colour caps, whether shorter services run that day
// at all, how many, and the hours — which shift depending on where the
// day's colour sits. Mirrors staff_day_policy.
export async function fetchStaffDayPolicies() {
  return supabase.rpc('get_staff_day_policies');
}

export async function fetchStaffHoursOverrides() {
  return supabase.from('staff_hours_override').select('*');
}

export async function fetchBusinessHours() {
  return supabase.from('business_hours').select('*').order('weekday');
}

export async function fetchBlockedSlots(staffId, date) {
  return supabase
    .from('blocked_slots')
    .select('*')
    .eq('date', date)
    .or(`staff_id.eq.${staffId},staff_id.is.null`);
}

export async function fetchBusySlots(staffId, date) {
  return supabase.rpc('get_busy_slots', { p_staff_id: staffId, p_date: date });
}

// A whole month's bookings in one call, so the calendar can mark every fully
// booked day without firing a request per day.
export async function fetchBusySlotsRange(staffId, dateFrom, dateTo) {
  return supabase.rpc('get_busy_slots_range', { p_staff_id: staffId, p_date_from: dateFrom, p_date_to: dateTo });
}

export async function bookAppointment({ serviceId, staffId, date, startTime, name, email, phone, notes, addonIds, termsVersion, firstName, lastName, instagram, smsConsent }) {
  return supabase.rpc('book_appointment', {
    p_service_id: serviceId,
    p_staff_id: staffId,
    p_date: date,
    p_start_time: startTime,
    p_customer_name: name,
    p_customer_email: email,
    p_customer_phone: phone,
    p_notes: notes || null,
    p_addon_ids: (addonIds && addonIds.length) ? addonIds : null,
    // The version of the cancellation policy she ticked. The RPC refuses the
    // booking without it — see migration 0009.
    p_terms_version: termsVersion ?? null,
    p_first_name: firstName || null,
    p_last_name: lastName || null,
    p_instagram: instagram || null,
    p_sms_consent: !!smsConsent,
  });
}

// Asked as soon as the wizard knows her phone number, so a gated client gets a
// kind message early rather than a failure after filling in the whole form.
export async function checkClientMustCall({ phone, serviceId }) {
  return supabase.rpc('client_must_call', { p_phone: phone, p_service_id: serviceId });
}

// The wording the tick-box must show. Read from the database so the words she
// agrees to and the words stored against her booking are the same words.
export async function fetchBookingTerms() {
  return supabase.rpc('get_current_booking_terms');
}

// What cancelling would cost, asked before she confirms — so a fee is never
// a surprise.
export async function fetchCancellationQuote({ bookingId, email, phone }) {
  return supabase.rpc('cancellation_quote', {
    p_booking_id: bookingId, p_email: email, p_phone: phone,
  });
}

// The schedule tool's own booking entry. Same rules as the public one apart
// from overlaps, which a stylist entering it by hand is allowed to create.
export async function staffBookAppointment({ pin, serviceId, staffId, date, startTime, name, email, phone, notes, addonIds, notify }) {
  return supabase.rpc('staff_book_appointment', {
    p_pin: pin,
    p_service_id: serviceId, p_staff_id: staffId, p_date: date, p_start_time: startTime,
    p_customer_name: name, p_customer_email: email, p_customer_phone: phone,
    p_notes: notes || null, p_addon_ids: (addonIds && addonIds.length) ? addonIds : null,
    p_notify: notify !== false,
  });
}

export async function getMyBookings(email, phone) {
  return supabase.rpc('get_my_bookings', { p_email: email || '', p_phone: phone || '' });
}

export async function fetchProductImages() {
  const { data, error } = await supabase.storage.from('gallery').list('products', { limit: 50, sortBy: { column: 'name', order: 'asc' } });
  if (error || !data) return { data: [], error };
  const urls = data
    .filter((f) => f.name && !f.name.startsWith('.'))
    .map((f) => supabase.storage.from('gallery').getPublicUrl(`products/${f.name}`).data.publicUrl);
  return { data: urls, error: null };
}

export async function cancelMyBooking(bookingId, email, phone) {
  return supabase.rpc('cancel_my_booking', {
    p_booking_id: bookingId,
    p_email: email || '',
    p_phone: phone || '',
  });
}

// ── STAFF SCHEDULE (schedule.html) ──
export async function verifyStaffPin(pin) {
  return supabase.rpc('verify_staff_pin', { p_pin: pin });
}

export async function fetchStaffSchedule({ pin, dateFrom, dateTo, staffId }) {
  return supabase.rpc('get_staff_schedule', {
    p_pin: pin,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_staff_id: staffId || null,
  });
}

export async function updateBookingStatusStaff({ pin, bookingId, status, actorStaffId }) {
  return supabase.rpc('update_booking_status_staff', {
    p_pin: pin,
    p_booking_id: bookingId,
    p_status: status,
    p_actor_staff_id: actorStaffId || null,
  });
}

export async function fetchBlockedSlotsRange(dateFrom, dateTo) {
  return supabase.from('blocked_slots').select('*').gte('date', dateFrom).lte('date', dateTo);
}

export async function addStaffUnavailable({ pin, staffId, date, startTime, endTime, reason, actorStaffId }) {
  return supabase.rpc('add_staff_unavailable', {
    p_pin: pin,
    p_staff_id: staffId,
    p_date: date,
    p_start_time: startTime,
    p_end_time: endTime,
    p_reason: reason || null,
    p_actor_staff_id: actorStaffId || null,
  });
}

export async function removeStaffUnavailable({ pin, blockedSlotId, actorStaffId }) {
  return supabase.rpc('remove_staff_unavailable', { p_pin: pin, p_blocked_slot_id: blockedSlotId, p_actor_staff_id: actorStaffId || null });
}

export async function searchStaffBookings({ pin, query }) {
  return supabase.rpc('search_staff_bookings', { p_pin: pin, p_query: query });
}

export async function updateServiceColor({ pin, serviceId, color }) {
  return supabase.rpc('update_service_color', { p_pin: pin, p_service_id: serviceId, p_color: color });
}

// ── OWNER MODE (schedule.html's "Owner Panel" — owner_pin-gated) ──
export async function isOwnerPin(pin) {
  return supabase.rpc('is_owner_pin', { p_pin: pin });
}

export async function fetchAllServicesAdmin(pin) {
  return supabase.rpc('admin_get_all_services', { p_pin: pin });
}

export async function upsertServiceAdmin({ pin, id, name, nameNo, category, priceFrom, priceTo, priceOnConsultation, priceIsFrom, durationMinutes, durationWithAddonsMinutes, color, imageUrl, featured, active }) {
  return supabase.rpc('admin_upsert_service', {
    p_pin: pin, p_id: id || null, p_name: name, p_name_no: nameNo || null, p_category: category,
    p_price_from: priceFrom, p_price_to: priceTo || null, p_price_on_consultation: !!priceOnConsultation,
    p_price_is_from: !!priceIsFrom,
    p_duration_minutes: durationMinutes, p_duration_with_addons_minutes: durationWithAddonsMinutes || null, p_color: color || null, p_image_url: imageUrl || null,
    p_featured: !!featured, p_active: active !== false,
  });
}

export async function deleteServiceAdmin({ pin, id }) {
  return supabase.rpc('admin_delete_service', { p_pin: pin, p_id: id });
}

export async function fetchAllStaffAdmin(pin) {
  return supabase.rpc('admin_get_all_staff', { p_pin: pin });
}

export async function upsertStaffAdmin({ pin, id, name, role, roleNo, bio, bioNo, photoUrl, instagram, bookable, externalBookingUrl, externalBookingLabel, allowOverlapBooking, sortOrder, active }) {
  return supabase.rpc('admin_upsert_staff', {
    p_pin: pin, p_id: id || null, p_name: name, p_role: role, p_role_no: roleNo || null,
    p_bio: bio || null, p_bio_no: bioNo || null, p_photo_url: photoUrl || null, p_instagram: instagram || null,
    p_bookable: !!bookable, p_external_booking_url: externalBookingUrl || null,
    p_external_booking_label: externalBookingLabel || null,
    p_allow_overlap_booking: !!allowOverlapBooking, p_sort_order: sortOrder || 0, p_active: active !== false,
  });
}

// ── OWNER MODE: ADD-ON CATALOG (Owner Panel "Add-ons" tab) ──
export async function fetchAddonsAdmin(pin) {
  return supabase.rpc('admin_get_addons', { p_pin: pin });
}

export async function upsertAddonAdmin({ pin, id, name, nameNo, price, priceIsFrom, kind, sortOrder, active }) {
  return supabase.rpc('admin_upsert_addon', {
    p_pin: pin, p_id: id || null, p_name: name, p_name_no: nameNo || null,
    p_price: price, p_price_is_from: !!priceIsFrom, p_kind: kind || 'addon',
    p_sort_order: sortOrder || 0, p_active: active !== false,
  });
}

export async function deleteAddonAdmin({ pin, id }) {
  return supabase.rpc('admin_delete_addon', { p_pin: pin, p_id: id });
}

export async function fetchServiceAddonsAdmin(pin) {
  return supabase.rpc('admin_get_service_addons', { p_pin: pin });
}

export async function setAddonServicesAdmin({ pin, addonId, serviceIds }) {
  return supabase.rpc('admin_set_addon_services', { p_pin: pin, p_addon_id: addonId, p_service_ids: serviceIds });
}

export async function fetchBookingsAdmin({ pin, dateFrom, status }) {
  return supabase.rpc('admin_get_bookings', { p_pin: pin, p_date_from: dateFrom || null, p_status: status || null });
}

export async function updateBookingStatusAdmin({ pin, bookingId, status }) {
  return supabase.rpc('admin_update_booking_status', { p_pin: pin, p_booking_id: bookingId, p_status: status });
}

export async function rescheduleBookingAdmin({ pin, bookingId, date, startTime, staffId, serviceId }) {
  return supabase.rpc('admin_reschedule_booking', {
    p_service_id: serviceId || null,
    p_pin: pin, p_booking_id: bookingId, p_date: date, p_start_time: startTime, p_staff_id: staffId || null,
  });
}

export async function completeBookingAdmin({ pin, bookingId, amountCharged }) {
  return supabase.rpc('admin_complete_booking', { p_pin: pin, p_booking_id: bookingId, p_amount_charged: amountCharged });
}

export async function fetchRevenueAdmin({ pin, dateFrom, dateTo }) {
  return supabase.rpc('admin_get_revenue', { p_pin: pin, p_date_from: dateFrom, p_date_to: dateTo });
}

export async function fetchStaffServicesAdmin(pin) {
  return supabase.rpc('admin_get_staff_services', { p_pin: pin });
}

export async function setStaffServicesAdmin({ pin, staffId, serviceIds }) {
  return supabase.rpc('admin_set_staff_services', { p_pin: pin, p_staff_id: staffId, p_service_ids: serviceIds });
}

export async function fetchStaffHoursOverridesAdmin(pin) {
  return supabase.rpc('admin_get_staff_hours_overrides', { p_pin: pin });
}

export async function upsertStaffHoursOverrideAdmin({ pin, staffId, weekday, closeTime }) {
  return supabase.rpc('admin_upsert_staff_hours_override', { p_pin: pin, p_staff_id: staffId, p_weekday: weekday, p_close_time: closeTime });
}

export async function deleteStaffHoursOverrideAdmin({ pin, id }) {
  return supabase.rpc('admin_delete_staff_hours_override', { p_pin: pin, p_id: id });
}

export async function upsertBusinessHoursAdmin({ pin, weekday, openTime, closeTime, closed }) {
  return supabase.rpc('admin_upsert_business_hours', {
    p_pin: pin, p_weekday: weekday, p_open_time: closed ? null : openTime, p_close_time: closed ? null : closeTime, p_closed: !!closed,
  });
}

export async function fetchBlockedSlotsAdmin({ pin, dateFrom }) {
  return supabase.rpc('admin_get_blocked_slots', { p_pin: pin, p_date_from: dateFrom || null });
}

export async function addBlockedSlotAdmin({ pin, staffId, date, startTime, endTime, reason }) {
  return supabase.rpc('admin_add_blocked_slot', {
    p_pin: pin, p_staff_id: staffId || null, p_date: date, p_start_time: startTime, p_end_time: endTime, p_reason: reason || null,
  });
}

export async function removeBlockedSlotAdmin({ pin, id }) {
  return supabase.rpc('admin_remove_blocked_slot', { p_pin: pin, p_id: id });
}

export async function setBookingHorizonAdmin({ pin, days }) {
  return supabase.rpc('admin_set_booking_horizon', { p_pin: pin, p_days: days });
}

// Bookings already inside a date range — shown before a holiday is blocked
// so the owner can call those clients instead of finding out later.
// Blocks a whole holiday in one call, writing a row per working day.
export async function addBlockedRangeAdmin({ pin, staffId, dateFrom, dateTo, startTime, endTime, reason }) {
  return supabase.rpc('admin_add_blocked_range', {
    p_pin: pin, p_staff_id: staffId || null, p_date_from: dateFrom, p_date_to: dateTo,
    p_start_time: startTime, p_end_time: endTime, p_reason: reason || null,
  });
}

// ── THE "PLEASE CALL US" LIST ──
export async function fetchGateCandidates({ pin, min }) {
  return supabase.rpc('admin_gate_candidates', { p_pin: pin, p_min: min ?? 1 });
}

export async function setClientGate({ pin, phone, name, gated, reason }) {
  return supabase.rpc('admin_set_client_gate', {
    p_pin: pin, p_phone: phone, p_name: name || null,
    p_gated: !!gated, p_reason: reason || null,
  });
}

// ── UNPAID CANCELLATION FEES ──
// Read when a stylist opens the Complete screen: an unpaid fee is only ever
// collectable at the one moment the client is standing there paying for
// something else.
export async function fetchClientOutstanding({ pin, phone }) {
  return supabase.rpc('client_outstanding', { p_pin: pin, p_phone: phone });
}

export async function settleCancellationFee({ pin, bookingId }) {
  return supabase.rpc('staff_settle_cancellation_fee', { p_pin: pin, p_booking_id: bookingId });
}

// ── WAITING LIST ──
// The consent wording is sent with the request and stored verbatim on the row,
// so if the form is ever reworded, old entries keep the text those clients
// actually agreed to.
export async function joinWaitlist(w) {
  return supabase.rpc('join_waitlist', {
    p_name: w.name, p_phone: w.phone, p_email: w.email || null,
    p_service_id: w.serviceId, p_staff_id: w.staffId || null,
    p_earliest: w.earliest || null, p_latest: w.latest || null,
    p_consent_text: w.consentText, p_consent_sms: !!w.consentSms,
    p_lang: w.lang || 'no', p_notes: w.notes || null,
  });
}

export async function leaveWaitlist(token) {
  return supabase.rpc('leave_waitlist', { p_token: token });
}

export async function fetchWaitlist(pin) {
  return supabase.rpc('admin_waitlist', { p_pin: pin });
}

export async function removeFromWaitlist({ pin, id, reason }) {
  return supabase.rpc('admin_remove_from_waitlist', {
    p_pin: pin, p_id: id, p_reason: reason || null,
  });
}

// Hours nobody has bought yet — the proactive half of the list.
export async function fetchUnsoldGaps({ pin, daysAhead }) {
  return supabase.rpc('admin_unsold_gaps', { p_pin: pin, p_days_ahead: daysAhead ?? 2 });
}

// ── EXTENSIONS ORDER BOOK ──
// Staff PIN, not owner: whoever takes the consultation writes the order.
export async function addExtensionOrder(o) {
  return supabase.rpc('staff_add_extension_order', {
    p_pin: o.pin,
    p_customer_name: o.customerName, p_customer_phone: o.customerPhone,
    p_customer_email: o.customerEmail || null,
    p_staff_id: o.staffId || null,
    p_colour: o.colour || null, p_length_cm: o.lengthCm || null,
    p_quantity: o.quantity || null, p_supplier: o.supplier || null,
    p_total_agreed: o.totalAgreed ?? null, p_deposit_amount: o.depositAmount ?? null,
    p_deposit_paid: !!o.depositPaid,
    p_notes: o.notes || null, p_booking_id: o.bookingId || null,
  });
}

export async function fetchExtensionOrders({ pin, status }) {
  return supabase.rpc('staff_list_extension_orders', { p_pin: pin, p_status: status || null });
}

export async function updateExtensionOrder(o) {
  return supabase.rpc('staff_update_extension_order', {
    p_pin: o.pin, p_order_id: o.id,
    p_colour: o.colour || null, p_length_cm: o.lengthCm || null,
    p_quantity: o.quantity || null, p_supplier: o.supplier || null,
    p_total_agreed: o.totalAgreed ?? null, p_deposit_amount: o.depositAmount ?? null,
    p_deposit_paid: !!o.depositPaid,
    p_notes: o.notes || null, p_booking_id: o.bookingId || null,
  });
}

// Returns what the arrival message needs, including whether she is already
// booked in — that decides which of the two messages goes out.
export async function markExtensionsArrived({ pin, id }) {
  return supabase.rpc('staff_mark_extensions_arrived', { p_pin: pin, p_order_id: id });
}

export async function markExtensionsNotified({ pin, id }) {
  return supabase.rpc('staff_mark_extensions_notified', { p_pin: pin, p_order_id: id });
}

export async function markDepositPaid({ pin, id }) {
  return supabase.rpc('staff_mark_deposit_paid', { p_pin: pin, p_order_id: id, p_paid: true });
}

export async function setBookingBeforeDeposit({ pin, id, allowed }) {
  return supabase.rpc('staff_set_booking_before_deposit', { p_pin: pin, p_order_id: id, p_allowed: allowed !== false });
}

export async function setExtensionOrderStatus({ pin, id, status }) {
  return supabase.rpc('staff_set_extension_order_status', { p_pin: pin, p_order_id: id, p_status: status });
}

// One search box: a name, a phone number, or part of either.
export async function fetchExtensionHistory({ pin, query }) {
  return supabase.rpc('staff_extension_history', { p_pin: pin, p_query: query });
}

// Fittings coming up with the hair still not here. The warning that replaces
// the arrival message we decided not to send.
export async function fetchExtensionOrdersAtRisk({ pin, withinDays }) {
  return supabase.rpc('staff_extension_orders_at_risk', {
    p_pin: pin, p_within_days: withinDays ?? 7,
  });
}

// Tells a client her extensions have arrived. Only ever called for a client
// with no fitting booked — one who is already coming in is told nothing,
// because the news changes nothing she does.
export async function sendExtensionsArrived(payload) {
  try {
    const { data, error } = await supabase.functions.invoke('send-extensions-arrived', { body: payload });
    if (error) return { sent: false, reason: error.message || 'Edge function error' };
    return data || { sent: false, reason: 'No response' };
  } catch (e) {
    return { sent: false, reason: (e && e.message) || 'Could not reach the messaging service' };
  }
}

// ── EXPORTS ──
// Two, deliberately: the accounting one carries no personal data, so the file
// the owner handles every month is the harmless one. See migration 0006.
export async function exportAccounting({ pin, from, to }) {
  return supabase.rpc('admin_export_accounting', { p_pin: pin, p_from: from, p_to: to });
}

export async function exportClients({ pin, from, to }) {
  return supabase.rpc('admin_export_clients', { p_pin: pin, p_from: from, p_to: to });
}

export async function fetchDailyTotals({ pin, from, to }) {
  return supabase.rpc('admin_daily_totals', { p_pin: pin, p_from: from, p_to: to });
}

// Requests still waiting on the salon, with how long is left on each hold.
export async function fetchPendingBookingsAdmin(pin) {
  return supabase.rpc('admin_get_pending_bookings', { p_pin: pin });
}

export async function fetchRequestHistoryAdmin(pin) {
  return supabase.rpc('admin_get_request_history', { p_pin: pin, p_limit: 100 });
}

// Confirm or reject, and get back what the email needs in the same round trip.
export async function decideBookingAdmin({ pin, bookingId, decision, reason }) {
  return supabase.rpc('admin_decide_booking', {
    p_pin: pin, p_booking_id: bookingId, p_decision: decision, p_reason: reason || null,
  });
}

// Emails the client. Lives in an Edge Function because the Resend key must
// never reach the browser — see supabase/functions/send-booking-email.
// Resolves { sent, reason } and never throws: a decision must not be lost
// because mail is down.
// Has this client already been in, ordered her hair and paid the deposit?
// Asked before the calendar so she is never offered a date her hair cannot
// make. Both phone AND email are required by the function itself - with the
// phone alone this would answer "does this number have extensions on order"
// for any number anyone typed.
export async function fetchExtensionsStatus(phone, email) {
  return supabase.rpc('extensions_status_for', { p_phone: phone, p_email: email });
}

export async function sendBookingEmail(payload) {
  try {
    const { data, error } = await supabase.functions.invoke('send-booking-email', { body: payload });
    if (error) return { sent: false, reason: error.message || 'Edge function error' };
    return data || { sent: false, reason: 'No response' };
  } catch (e) {
    return { sent: false, reason: (e && e.message) || 'Could not reach the mail service' };
  }
}

// The single send path for every message the salon sends - confirmations,
// reminders, no-show notices, invoices, extensions arrivals, waitlist offers.
// See supabase/functions/send-message: it holds the Resend and Sveve keys,
// refuses to send the same message twice, will not text anyone at 03:00 or
// anyone who did not agree to texts, and records every attempt either way.
//
// Like sendBookingEmail it resolves rather than throws: a decision the owner
// has already made must not be lost because a provider is down.
export async function sendMessage({ pin, key, lang, email, phone, context, bookingId, extensionOrderId, smsConsent }) {
  try {
    const { data, error } = await supabase.functions.invoke('send-message', {
      body: { pin, key, lang, email, phone, context, bookingId, extensionOrderId, smsConsent },
    });
    if (error) return { sent: false, reason: error.message || 'Edge function error' };
    return data || { sent: false, reason: 'No response' };
  } catch (e) {
    return { sent: false, reason: (e && e.message) || 'Could not reach the message service' };
  }
}

// How many prepaid SMS remain. Resolves rather than throws, and never invents
// a number: a balance that could not be read comes back with ok:false and the
// reason, so the panel can say "could not check" instead of a confident zero.
export async function fetchSmsBalance(pin) {
  try {
    const { data, error } = await supabase.functions.invoke('send-message', {
      body: { pin, action: 'balance' },
    });
    if (error) return { ok: false, balance: null, reason: error.message || 'Edge function error', configured: false };
    return data || { ok: false, balance: null, reason: 'No response', configured: false };
  } catch (e) {
    return { ok: false, balance: null, reason: (e && e.message) || 'Could not reach the message service', configured: false };
  }
}

// Whether a late cancellation is actually charged, and how much. Priced
// automatically at half the booking; these three are the owner overriding
// that for a particular client.
export async function waiveCancellationFee({ pin, bookingId }) {
  return supabase.rpc('admin_waive_cancellation_fee', { p_pin: pin, p_booking_id: bookingId });
}
export async function unwaiveCancellationFee({ pin, bookingId }) {
  return supabase.rpc('admin_unwaive_cancellation_fee', { p_pin: pin, p_booking_id: bookingId });
}
export async function setCancellationFee({ pin, bookingId, amount }) {
  return supabase.rpc('admin_set_cancellation_fee', { p_pin: pin, p_booking_id: bookingId, p_amount: amount });
}

// How many extensions requests are waiting. Staff PIN: every stylist needs
// to know one is sitting there, even though only the owner decides it.
export async function fetchPendingCount(pin) {
  return supabase.rpc('staff_pending_count', { p_pin: pin });
}

export async function fetchBookingsInRangeAdmin({ pin, dateFrom, dateTo, staffId }) {
  return supabase.rpc('admin_get_bookings_in_range', {
    p_pin: pin, p_date_from: dateFrom, p_date_to: dateTo, p_staff_id: staffId || null,
  });
}

export async function fetchActivityLogAdmin({ pin, dateFrom, staffId }) {
  return supabase.rpc('admin_get_activity_log', { p_pin: pin, p_date_from: dateFrom || null, p_staff_id: staffId || null });
}

export async function setPinAdmin({ pin, key, newValue }) {
  return supabase.rpc('admin_set_pin', { p_pin: pin, p_key: key, p_new_value: newValue });
}

// Owner Panel photo uploads (Services/Staff "Photo" fields) — a real file
// picker instead of a pasted link. Uploads to the existing public 'gallery'
// bucket under owner-uploads/<folder>/, then returns that object's public
// URL, which is exactly what gets saved into services.image_url /
// staff.photo_url — no schema change needed, those were already plain text
// columns. See 0003_owner_image_uploads.sql for the storage policies this
// depends on.
export async function uploadOwnerImage({ folder, file }) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `owner-uploads/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('gallery').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (uploadError) return { data: null, error: uploadError };
  const { data } = supabase.storage.from('gallery').getPublicUrl(path);
  return { data: data.publicUrl, error: null };
}
