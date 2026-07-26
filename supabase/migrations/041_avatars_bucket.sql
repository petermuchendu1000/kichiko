-- 041_avatars_bucket.sql
-- ---------------------------------------------------------------------------
-- Profile avatars: a public-read storage bucket so users can provide and edit
-- their own profile image. Writes are owner-scoped -- a user may only create /
-- replace / delete objects under a top-level folder named for their own uid
-- (path convention: `<uid>/<file>`), mirroring the KYC bucket's ownership model
-- but with public read (avatars are shown on public leaderboard / trader pages).
--
-- Idempotent: bucket insert uses ON CONFLICT; policies are guarded by DROP IF
-- EXISTS so re-running the migration is safe.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  TRUE,
  2097152,  -- 2MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
) ON CONFLICT (id) DO NOTHING;

-- Public read (avatars appear on public surfaces).
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;
CREATE POLICY "Anyone can view avatars" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

-- Owner-scoped write: uid must match the first path segment.
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'avatars'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'avatars'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );
