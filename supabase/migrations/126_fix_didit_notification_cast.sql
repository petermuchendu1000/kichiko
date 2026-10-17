-- 126_fix_didit_notification_cast.sql
-- ---------------------------------------------------------------------------
-- apply_didit_decision() failed on EVERY approval.
--
--   column "type" is of type notification_type but expression is of type text
--
-- `CASE WHEN ... THEN 'kyc_approved' ELSE 'kyc_rejected' END` is two unknown
-- literals, which Postgres resolves to `text`, and text does not implicitly
-- cast into an enum column on INSERT. admin_review_kyc() already carries the
-- `::notification_type` cast for exactly this reason; migration 123 wrote the
-- machine-decision sibling from the ORIGINAL 002 version of that function
-- rather than the live, already-corrected one, and reintroduced a bug this
-- schema had solved.
--
-- WHY NOTHING CAUGHT IT
-- Every webhook test used a session in "Not Started", which mapStatus() maps
-- to null, so the handler returned before it ever reached this INSERT. The
-- signature path was tested exhaustively and the path that actually verifies
-- somebody was never executed once. Found by a real user finishing a real
-- scan: Didit approved them, the function raised, the whole transaction rolled
-- back, and the page polled forever against a decision that could not land.
--
-- The failure was at least loud rather than silent: the RPC raised, syncSession
-- threw, and no kyc_documents row or profile change was half-written. A user
-- verified at the vendor and unverified here is recoverable by re-reading the
-- session; a half-applied decision would not have been.

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

  IF p_status IN ('verified', 'rejected', 'pending') THEN
    UPDATE public.profiles SET
      kyc_status       = p_status,
      kyc_completed_at = CASE WHEN p_status = 'verified' THEN now() ELSE kyc_completed_at END,
      updated_at       = now()
    WHERE id = p_user_id
      AND (kyc_status <> 'verified' OR p_status = 'verified');
  END IF;

  IF p_status IN ('verified', 'rejected') THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      p_user_id,
      -- THE CAST. Without it this INSERT raises and the whole decision rolls
      -- back, which is what made an approved user unverifiable.
      (CASE WHEN p_status = 'verified' THEN 'kyc_approved' ELSE 'kyc_rejected' END)::notification_type,
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

  IF p_status IN ('verified', 'rejected') THEN
    DELETE FROM public.kyc_drafts WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object('kyc_doc_id', v_doc_id, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_didit_decision(UUID, UUID, kyc_status, TEXT, JSONB, TEXT, TEXT, TEXT, DATE, CHAR(2), DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_didit_decision(UUID, UUID, kyc_status, TEXT, JSONB, TEXT, TEXT, TEXT, DATE, CHAR(2), DATE) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_didit_decision(UUID, UUID, kyc_status, TEXT, JSONB, TEXT, TEXT, TEXT, DATE, CHAR(2), DATE) TO service_role;

-- ---------------------------------------------------------------------------
-- A guard, so the next person writing a notification cannot repeat this
-- ---------------------------------------------------------------------------
-- Two of the three functions that write notifications got the cast right only
-- because somebody remembered. This proves the enum accepts what these
-- functions send, at migration time, rather than at the moment a real user is
-- waiting for a decision.
DO $$
BEGIN
  PERFORM 'kyc_approved'::notification_type, 'kyc_rejected'::notification_type;
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'notification_type is missing kyc_approved/kyc_rejected; apply_didit_decision would fail at runtime';
END;
$$;
