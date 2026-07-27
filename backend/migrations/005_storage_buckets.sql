-- =====================================================
-- Storage buckets + policies matching backend upload routes
-- Buckets: Avatars, Covers, Posts (PascalCase — used by code)
-- Idempotent: safe to re-run.
-- =====================================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('Avatars', 'Avatars', true),
  ('Covers', 'Covers', true),
  ('Posts', 'Posts', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    name = EXCLUDED.name;

-- Public read for all app media buckets
DROP POLICY IF EXISTS "Public read Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public read Covers" ON storage.objects;
DROP POLICY IF EXISTS "Public read Posts" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload Covers" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload Posts" ON storage.objects;
DROP POLICY IF EXISTS "Auth update own Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Auth update own Covers" ON storage.objects;
DROP POLICY IF EXISTS "Auth update own Posts" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete own Avatars" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete own Covers" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete own Posts" ON storage.objects;

CREATE POLICY "Public read Avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'Avatars');

CREATE POLICY "Public read Covers"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'Covers');

CREATE POLICY "Public read Posts"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'Posts');

-- Paths may be "{userId}/file" or "{prefix}/{userId}/file"
CREATE POLICY "Auth upload Avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'Avatars'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR auth.uid()::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY "Auth upload Covers"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'Covers'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR auth.uid()::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY "Auth upload Posts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'Posts'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR auth.uid()::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY "Auth update own Avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'Avatars'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR auth.uid()::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY "Auth update own Covers"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'Covers'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR auth.uid()::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY "Auth update own Posts"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'Posts'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR auth.uid()::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY "Auth delete own Avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'Avatars'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR auth.uid()::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY "Auth delete own Covers"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'Covers'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR auth.uid()::text = (storage.foldername(name))[2]
    )
  );

CREATE POLICY "Auth delete own Posts"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'Posts'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR auth.uid()::text = (storage.foldername(name))[2]
    )
  );