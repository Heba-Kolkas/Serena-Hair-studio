-- ── EVERY EMAIL LINK POINTED AT THE PREVIEW URL ──
-- APPLIED 30 August 2026 to the studio-serena project.
--
-- Every button in every email pointed at a URL hardcoded inside
-- booking_message_context: https://studio-serena.vercel.app. It resolves
-- today - checked, both .vercel.app hosts return 200 for appointments.html -
-- but it is the preview address. The day studioserena.no is serving, every
-- email the salon has ever sent still goes to the .vercel.app one, and
-- changing that would mean a migration rather than a setting.
--
-- It lives in app_settings now, beside the PINs and the cancellation policy:
--
--   update app_settings set value = 'https://studioserena.no'
--    where key = 'site_url';
insert into app_settings (key, value)
values ('site_url', 'https://studio-serena.vercel.app')
on conflict (key) do nothing;

create or replace function get_site_url()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(rtrim((select value from app_settings where key = 'site_url'), '/'), ''),
    'https://studio-serena.vercel.app'
  );
$$;

create or replace function booking_message_context(p_booking_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'customerName', coalesce(b.customer_first_name, split_part(b.customer_name, ' ', 1), b.customer_name),
    'serviceName',  sv.name,
    'staffName',    st.name,
    'date',         to_char(b.date, 'YYYY-MM-DD'),
    'startTime',    to_char(b.start_time, 'HH24:MI'),
    'endTime',      to_char(b.end_time, 'HH24:MI'),
    'bookingRef',   b.booking_ref,
    -- Where she manages the booking she already has.
    'manageUrl',    get_site_url() || '/appointments.html',
    -- Where she makes a new one. The waitlist messages say "see available
    -- times" and "book this time" and were pointing at her existing
    -- appointments instead, which is the wrong page for both.
    'bookUrl',      get_site_url() || '/book.html',
    'addons', coalesce((
      select jsonb_agg(jsonb_build_object('name', ba.name_at_booking, 'price', ba.price_at_booking)
                       order by ba.created_at)
      from booking_addons ba where ba.booking_id = b.id
    ), '[]'::jsonb),
    'lateCancellation', b.late_cancellation,
    'cancellationFee',  b.cancellation_fee,
    'noticeHours',      (select notice_hours from get_cancellation_policy())
  )
  from bookings b
  join services sv on sv.id = b.service_id
  join staff st on st.id = b.staff_id
  where b.id = p_booking_id;
$$;
