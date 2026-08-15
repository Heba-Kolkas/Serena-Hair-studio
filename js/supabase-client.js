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

export async function bookAppointment({ serviceId, staffId, date, startTime, name, email, phone, notes }) {
  return supabase.rpc('book_appointment', {
    p_service_id: serviceId,
    p_staff_id: staffId,
    p_date: date,
    p_start_time: startTime,
    p_customer_name: name,
    p_customer_email: email,
    p_customer_phone: phone,
    p_notes: notes || null,
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

export async function upsertServiceAdmin({ pin, id, name, nameNo, category, priceFrom, priceTo, priceOnConsultation, durationMinutes, color, imageUrl, featured, active }) {
  return supabase.rpc('admin_upsert_service', {
    p_pin: pin, p_id: id || null, p_name: name, p_name_no: nameNo || null, p_category: category,
    p_price_from: priceFrom, p_price_to: priceTo || null, p_price_on_consultation: !!priceOnConsultation,
    p_duration_minutes: durationMinutes, p_color: color || null, p_image_url: imageUrl || null,
    p_featured: !!featured, p_active: active !== false,
  });
}

export async function deleteServiceAdmin({ pin, id }) {
  return supabase.rpc('admin_delete_service', { p_pin: pin, p_id: id });
}

export async function fetchAllStaffAdmin(pin) {
  return supabase.rpc('admin_get_all_staff', { p_pin: pin });
}

export async function upsertStaffAdmin({ pin, id, name, role, roleNo, bio, bioNo, photoUrl, instagram, bookable, externalBookingUrl, allowOverlapBooking, sortOrder, active }) {
  return supabase.rpc('admin_upsert_staff', {
    p_pin: pin, p_id: id || null, p_name: name, p_role: role, p_role_no: roleNo || null,
    p_bio: bio || null, p_bio_no: bioNo || null, p_photo_url: photoUrl || null, p_instagram: instagram || null,
    p_bookable: !!bookable, p_external_booking_url: externalBookingUrl || null,
    p_allow_overlap_booking: !!allowOverlapBooking, p_sort_order: sortOrder || 0, p_active: active !== false,
  });
}

export async function fetchBookingsAdmin({ pin, dateFrom, status }) {
  return supabase.rpc('admin_get_bookings', { p_pin: pin, p_date_from: dateFrom || null, p_status: status || null });
}

export async function updateBookingStatusAdmin({ pin, bookingId, status }) {
  return supabase.rpc('admin_update_booking_status', { p_pin: pin, p_booking_id: bookingId, p_status: status });
}

export async function rescheduleBookingAdmin({ pin, bookingId, date, startTime, staffId }) {
  return supabase.rpc('admin_reschedule_booking', {
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
