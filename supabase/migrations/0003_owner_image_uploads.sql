-- Lets the Owner Panel (schedule.html) upload real photo files for Services
-- and Staff, instead of the owner having to paste an already-hosted image
-- link. NOT YET APPLIED — same status as 0001/0002, run this once Supabase
-- is restored and the other two have been applied.
--
-- Assumes the 'gallery' storage bucket already exists (created earlier via
-- the Supabase dashboard — it's already used read-only by
-- fetchProductImages() in js/supabase-client.js for the public product
-- gallery). This migration only adds new folder-scoped upload permissions
-- and a size/type cap on top of it; it does not create the bucket.
--
-- SECURITY NOTE: schedule.html has no real Supabase Auth session (fully
-- anon, same model as every other RPC in this app), and Storage's row-level
-- security can't see our custom owner_pin the way the admin_* RPCs can —
-- there's no way to pass it through a storage upload request. So this
-- can't be locked to "owner PIN holders only" the same way the rest of the
-- Owner Panel is. It's scoped as tightly as Storage allows instead: anon
-- can only INSERT into two specific folders (owner-uploads/services/,
-- owner-uploads/staff/), and the bucket enforces an image-only MIME
-- allowlist plus a 5MB cap. Anyone holding the public anon key (already
-- exposed client-side on every page of this site) could technically upload
-- a file into those two folders without the PIN — acceptable for a small,
-- low-traffic internal tool, but worth knowing before relying on this.

update storage.buckets
  set file_size_limit = 5242880, -- 5MB
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  where id = 'gallery';

create policy "anon upload owner service/staff photos" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'gallery'
    and (storage.foldername(name))[1] = 'owner-uploads'
    and (storage.foldername(name))[2] in ('services', 'staff')
  );
