-- 121_kyc_drafts_and_dob.sql
-- ---------------------------------------------------------------------------
-- Resumable KYC, and the date of birth an 18+ licence requires.
--
-- WHAT WAS WRONG
-- The five-step wizard held every answer in React state and wrote one row at
-- the end. A refresh, a dead battery, or switching from the phone that has the
-- camera to the laptop that has the address meant starting over. Document
-- upload is the step people abandon, and we were making them repeat the four
-- steps before it.
--
-- Pattern taken from Lemonway's save-and-resume onboarding (server-side draft,
-- a resume path, an expiry) and Upwardli's rule that completed steps are not
-- repeated. Draft state lives on the SERVER, not in localStorage, so the
-- journey survives a change of device, which is the case that actually breaks
-- people here.
--
-- WHAT THIS IS NOT
-- Not a second copy of the submission. `kyc_documents` stays the record of
-- what was submitted and reviewed; a draft is scratch space that is deleted
-- the moment a submission is created. Nothing in here is ever read by review.

-- ---------------------------------------------------------------------------
-- 1. Date of birth
-- ---------------------------------------------------------------------------
-- The KYC wizard collected email, phone, ID document, selfie and address, and
-- NO date of birth anywhere in the product. For a platform that may only serve
-- adults (L.N. 112; matrix F2) that is the one field the rule actually turns
-- on, and it was missing. Nullable because rows already exist; the application
-- requires it for new submissions.
ALTER TABLE public.kyc_documents
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- A submitted DOB must be a plausible adult's. Cheap, and it means a bad value
-- cannot reach a reviewer: 120 years is the outer bound, 18 the legal one.
ALTER TABLE public.kyc_documents
  DROP CONSTRAINT IF EXISTS kyc_documents_dob_adult;
ALTER TABLE public.kyc_documents
  ADD CONSTRAINT kyc_documents_dob_adult CHECK (
    date_of_birth IS NULL
    OR (
      date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')
      AND date_of_birth >= (CURRENT_DATE - INTERVAL '120 years')
    )
  );

COMMENT ON COLUMN public.kyc_documents.date_of_birth IS
  'Date of birth as declared at submission. Required by the 18+ rule (L.N. 112). CHECK enforces 18..120 years.';

-- ---------------------------------------------------------------------------
-- 2. The draft
-- ---------------------------------------------------------------------------
-- One row per user, replaced in place as they advance. `data` is jsonb because
-- the shape is the wizard's business and will change with it; pinning each
-- field as a column would mean a migration every time a step gains a question,
-- and none of it is queried — it is only ever read back whole by its owner.
--
-- Uploaded file PATHS live here, not the files: each document is uploaded to
-- storage as its step completes, so a resumed journey does not ask for the
-- photo again. The paths are storage keys, not public URLs.
CREATE TABLE IF NOT EXISTS public.kyc_drafts (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_step SMALLINT NOT NULL DEFAULT 0 CHECK (current_step BETWEEN 0 AND 10),
  data         JSONB    NOT NULL DEFAULT '{}'::jsonb,
  front_path   TEXT,
  back_path    TEXT,
  selfie_path  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Lemonway expires a resume link after 7 days. A half-finished KYC draft is
  -- personal data we have no reason to keep once it is cold (DPA 2019 storage
  -- limitation), and a 30-day-old draft is not a journey anyone is resuming.
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days')
);

COMMENT ON TABLE public.kyc_drafts IS
  'Scratch state for an in-progress KYC journey. One row per user, deleted on submit, expired after 30 days. Never read by review.';

CREATE INDEX IF NOT EXISTS idx_kyc_drafts_expires ON public.kyc_drafts (expires_at);

-- Keep updated_at honest without trusting the client to send it.
CREATE OR REPLACE FUNCTION public.kyc_drafts_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  -- Each save pushes the expiry out, so an active journey is never collected
  -- mid-flight; only an abandoned one ages out.
  NEW.expires_at := now() + INTERVAL '30 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kyc_drafts_touch ON public.kyc_drafts;
CREATE TRIGGER trg_kyc_drafts_touch
  BEFORE UPDATE ON public.kyc_drafts
  FOR EACH ROW EXECUTE FUNCTION public.kyc_drafts_touch();

-- ---------------------------------------------------------------------------
-- 3. RLS — a draft is readable and writable by exactly one person
-- ---------------------------------------------------------------------------
-- This table holds an identity document number, a date of birth and a home
-- address. It is the most sensitive table a user can write to, so the policies
-- are four narrow ones keyed on auth.uid(), not a single FOR ALL.
ALTER TABLE public.kyc_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kyc_drafts_select_own ON public.kyc_drafts;
CREATE POLICY kyc_drafts_select_own ON public.kyc_drafts
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS kyc_drafts_insert_own ON public.kyc_drafts;
CREATE POLICY kyc_drafts_insert_own ON public.kyc_drafts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS kyc_drafts_update_own ON public.kyc_drafts;
CREATE POLICY kyc_drafts_update_own ON public.kyc_drafts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS kyc_drafts_delete_own ON public.kyc_drafts;
CREATE POLICY kyc_drafts_delete_own ON public.kyc_drafts
  FOR DELETE USING (auth.uid() = user_id);

-- No grants to anon. An unauthenticated caller has no draft.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kyc_drafts TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Collection
-- ---------------------------------------------------------------------------
-- Called by the scheduler (lib/jobs/schedule.ts). SECURITY DEFINER because it
-- deletes other people's rows by definition, and is therefore locked to the
-- service role rather than exposed to `authenticated`.
CREATE OR REPLACE FUNCTION public.purge_expired_kyc_drafts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM public.kyc_drafts WHERE expires_at < now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_kyc_drafts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_kyc_drafts() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_kyc_drafts() TO service_role;
