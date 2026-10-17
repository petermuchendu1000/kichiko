-- 123_didit_verification.sql
-- ---------------------------------------------------------------------------
-- Identity verification moves to Didit.
--
-- WHAT THIS REPLACES
-- The wizard asked for a document photo, a back photo and a selfie, uploaded
-- them to a private bucket, and put the row in front of a human. That human
-- looks at a JPEG and decides whether it is real. They cannot read an MRZ
-- checksum, cannot tell a screen recapture from a face, cannot check whether
-- the holder is on a sanctions list, and they take a day or two to do it.
--
-- Didit runs OCR with document authenticity, passive liveness, face match
-- against the document portrait and IP analysis, and returns a decision in
-- about a minute. The KYC+AML workflow adds sanctions and PEP screening,
-- which POCAMLA 2009 expects of us and which no reviewer here can perform.
--
-- Our own review is not deleted. It becomes what it should always have been:
-- the queue for what the vendor declines or flags, not the first pass.
--
-- WHAT THIS DOES NOT STORE
-- No image URLs. Didit returns media as short-lived presigned links; storing
-- one gives you a dead URL and the illusion of a record. The session id is the
-- record, and the admin console fetches fresh links when a reviewer opens a
-- case. That also means document images never sit in our bucket, which is the
-- cheapest way to comply with DPA 2019 storage limitation: we hold the
-- decision and the extracted fields, not the photographs.

-- ---------------------------------------------------------------------------
-- 1. The provider's verdict on a submission
-- ---------------------------------------------------------------------------
ALTER TABLE public.kyc_documents
  ADD COLUMN IF NOT EXISTS provider            TEXT,
  ADD COLUMN IF NOT EXISTS provider_session_id UUID,
  ADD COLUMN IF NOT EXISTS provider_status     TEXT,
  ADD COLUMN IF NOT EXISTS provider_decision   JSONB,
  ADD COLUMN IF NOT EXISTS provider_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.kyc_documents.provider IS
  'Verification vendor that produced this row, e.g. ''didit''. NULL for the legacy manual-upload submissions.';
COMMENT ON COLUMN public.kyc_documents.provider_session_id IS
  'The vendor session. The only durable handle on the evidence: media links are presigned and expire, so they are fetched through this, never stored.';
COMMENT ON COLUMN public.kyc_documents.provider_status IS
  'Vendor status verbatim (Approved, Declined, In Review, Abandoned, ...). Kept beside our own kyc_status because the two are not the same vocabulary and the vendor''s is the audit trail.';
COMMENT ON COLUMN public.kyc_documents.provider_decision IS
  'Decision payload with media URLs stripped. Holds the extracted identity fields, per-check statuses and scores, and any warnings.';

-- One row per session. This is what makes the webhook idempotent: Didit
-- retries, and sends status.updated more than once per session as a journey
-- advances, so the handler upserts on this key rather than inserting.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kyc_documents_provider_session
  ON public.kyc_documents (provider_session_id)
  WHERE provider_session_id IS NOT NULL;

-- The reviewer queue is "what the vendor would not clear", so it is read by
-- provider_status far more often than by anything else.
CREATE INDEX IF NOT EXISTS idx_kyc_documents_provider_status
  ON public.kyc_documents (provider_status)
  WHERE provider_status IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The draft remembers its session
-- ---------------------------------------------------------------------------
-- A session is not free and Didit returns the SAME unfinished session when you
-- create one again with the same vendor_data. Holding the id on the draft
-- means a user who closes the tab mid-scan and comes back is handed their
-- existing session rather than a second one, and we can show "verification in
-- progress" without asking Didit on every page load.
ALTER TABLE public.kyc_drafts
  ADD COLUMN IF NOT EXISTS didit_session_id  UUID,
  ADD COLUMN IF NOT EXISTS didit_session_url TEXT,
  ADD COLUMN IF NOT EXISTS didit_status      TEXT;

COMMENT ON COLUMN public.kyc_drafts.didit_session_url IS
  'The hosted verification URL. Stored so a resumed draft reopens the same session instead of paying for a new one.';

-- ---------------------------------------------------------------------------
-- 3. Applying a vendor decision
-- ---------------------------------------------------------------------------
-- admin_review_kyc() is the one place that flips kyc_documents.status,
-- profiles.kyc_status and raises the notification, and it is guarded by
-- has_capability('kyc:review'). A webhook has no session and therefore no
-- capability, so it cannot and must not reuse it.
--
-- This is its sibling for machine decisions: same three effects, no reviewer,
-- granted to service_role alone. Keeping it as one function rather than three
-- writes in the route is what stops a half-applied decision — a verified
-- document whose profile still says unverified is the bug that lets someone
-- through a deposit gate, or keeps them out of one they have paid for.
CREATE OR REPLACE FUNCTION public.apply_didit_decision(
  p_user_id         UUID,
  p_session_id      UUID,
  p_status          kyc_status,
  p_provider_status TEXT,
  p_decision        JSONB,
  p_reason          TEXT DEFAULT NULL,
  p_document_type   TEXT DEFAULT NULL,
  p_document_number TEXT DEFAULT NULL,
  p_date_of_birth   DATE DEFAULT NULL,
  p_country         CHAR(2) DEFAULT NULL,
  p_expiry          DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc_id UUID;
BEGIN
  -- Upsert on the session, not the user: a user may verify more than once
  -- (expiry, a re-check after a declined attempt) and each attempt is its own
  -- auditable row.
  INSERT INTO public.kyc_documents (
    user_id, document_type, document_number, date_of_birth, country_of_issue,
    expiry_date, status, provider, provider_session_id, provider_status,
    provider_decision, provider_checked_at, rejection_reason
  ) VALUES (
    p_user_id, COALESCE(p_document_type, 'unknown'), p_document_number,
    p_date_of_birth, p_country, p_expiry, p_status, 'didit', p_session_id,
    p_provider_status, p_decision, now(), p_reason
  )
  ON CONFLICT (provider_session_id) WHERE provider_session_id IS NOT NULL
  DO UPDATE SET
    document_type    = COALESCE(EXCLUDED.document_type, public.kyc_documents.document_type),
    document_number  = COALESCE(EXCLUDED.document_number, public.kyc_documents.document_number),
    date_of_birth    = COALESCE(EXCLUDED.date_of_birth, public.kyc_documents.date_of_birth),
    country_of_issue = COALESCE(EXCLUDED.country_of_issue, public.kyc_documents.country_of_issue),
    expiry_date      = COALESCE(EXCLUDED.expiry_date, public.kyc_documents.expiry_date),
    status           = EXCLUDED.status,
    provider_status  = EXCLUDED.provider_status,
    provider_decision = EXCLUDED.provider_decision,
    provider_checked_at = now(),
    rejection_reason = EXCLUDED.rejection_reason,
    updated_at       = now()
  RETURNING id INTO v_doc_id;

  -- The profile is the gate every other feature reads. Only ever moved by a
  -- terminal decision: an in-progress scan must not downgrade someone who is
  -- already verified from an earlier submission.
  IF p_status IN ('verified', 'rejected', 'pending') THEN
    UPDATE public.profiles SET
      kyc_status       = p_status,
      kyc_completed_at = CASE WHEN p_status = 'verified' THEN now() ELSE kyc_completed_at END,
      updated_at       = now()
    WHERE id = p_user_id
      -- Never walk a verified account backwards on a later non-verified
      -- event. A re-verification that fails is a case for a reviewer, not an
      -- automatic revocation of access someone already has.
      AND (kyc_status <> 'verified' OR p_status = 'verified');
  END IF;

  -- Notify only on a decision a person would want to hear about. "In progress"
  -- is not news.
  IF p_status IN ('verified', 'rejected') THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      p_user_id,
      CASE WHEN p_status = 'verified' THEN 'kyc_approved' ELSE 'kyc_rejected' END,
      CASE WHEN p_status = 'verified' THEN 'Identity verified' ELSE 'Verification unsuccessful' END,
      CASE WHEN p_status = 'verified'
        THEN 'Your identity has been verified. Deposits, withdrawals and trading are unlocked.'
        ELSE COALESCE(p_reason, 'We could not verify your identity. You can try again.')
      END,
      jsonb_build_object(
        'kyc_doc_id', v_doc_id,
        'status', p_status,
        'provider', 'didit',
        'provider_status', p_provider_status,
        'rejection_reason', p_reason
      )
    );
  END IF;

  -- A decision outlives the draft that led to it. Leaving it would offer to
  -- "resume" a journey that has already been decided.
  IF p_status IN ('verified', 'rejected') THEN
    DELETE FROM public.kyc_drafts WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('kyc_doc_id', v_doc_id, 'status', p_status);
END;
$$;

-- Machine decisions only. No user, and no reviewer, may call this: a user who
-- could would be able to verify themselves.
REVOKE ALL ON FUNCTION public.apply_didit_decision(UUID, UUID, kyc_status, TEXT, JSONB, TEXT, TEXT, TEXT, DATE, CHAR(2), DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_didit_decision(UUID, UUID, kyc_status, TEXT, JSONB, TEXT, TEXT, TEXT, DATE, CHAR(2), DATE) FROM authenticated;
REVOKE ALL ON FUNCTION public.apply_didit_decision(UUID, UUID, kyc_status, TEXT, JSONB, TEXT, TEXT, TEXT, DATE, CHAR(2), DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_didit_decision(UUID, UUID, kyc_status, TEXT, JSONB, TEXT, TEXT, TEXT, DATE, CHAR(2), DATE) TO service_role;
