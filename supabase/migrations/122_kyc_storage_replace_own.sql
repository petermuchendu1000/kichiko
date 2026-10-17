-- 122_kyc_storage_replace_own.sql
-- ---------------------------------------------------------------------------
-- Let a user REPLACE their own KYC document, not just add one.
--
-- The bucket had exactly one write policy, for INSERT:
--   bucket_id = 'kyc-documents' AND auth.uid() = (storage.foldername(name))[1]
--
-- That was enough while the wizard uploaded to a timestamped path
-- (`<uid>/<ts>-front.jpg`), because every upload was a new object. Migration
-- 121 made the journey resumable, which means uploading as each step is
-- completed and writing the path into the draft — and a stable path
-- (`<uid>/front.jpg`) is what lets someone retake a blurry photo without
-- orphaning the first one or leaving the draft pointing at a stale file.
--
-- A stable path means `upsert`, and an upsert over an existing object is an
-- UPDATE, which no policy allowed. Caught by driving the real wizard: the
-- draft came back with front_path NULL, so a resumed journey would have asked
-- for the document a second time, which is the one thing the change existed to
-- prevent.
--
-- Scope is identical to the INSERT policy: a user may only touch objects in
-- the folder named after their own id. Nothing here widens who can READ a
-- document; the existing SELECT policies (owner, reviewers, admins) stand.

-- Replace your own document.
DROP POLICY IF EXISTS "Users can replace own KYC docs" ON storage.objects;
CREATE POLICY "Users can replace own KYC docs"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'kyc-documents'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );

-- Remove your own document. Needed so that clearing a file in the wizard (or
-- abandoning a draft) does not leave an object the owner cannot delete, which
-- is also what the DPA 2019 erasure right expects of us.
DROP POLICY IF EXISTS "Users can delete own KYC docs" ON storage.objects;
CREATE POLICY "Users can delete own KYC docs"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );
