-- 066_lockdown_audit_config_and_kyc_insert.sql
-- ---------------------------------------------------------------------------
-- DB security hardening (audit DB-4, DB-5). Not destructive to data; only
-- removes latent client write grants and tightens one RLS insert policy.
--
-- DB-4 — audit_log / payment_gateways / platform_settings still carried the
-- Supabase-default authenticated INSERT/UPDATE/DELETE table grants (verified
-- live). Writes are blocked TODAY only because no permissive RLS write policy
-- exists for authenticated — exactly the "one future USING(true) policy turns
-- this into forgery" trap that migrations 059/061 closed for the money tables.
-- These three were outside that scope. Mirror the lockdown: writes flow only
-- through SECURITY DEFINER RPCs / service_role. audit_log becomes effectively
-- append-only for clients (integrity of the audit trail).
--
-- DB-5 — kyc_documents self-INSERT policy checked ownership only, so a user
-- could insert their OWN document row pre-marked status='verified' (it does not
-- flip profiles.kyc_status, which only admin_review_kyc sets, but it pollutes
-- KYC state and the reviewer console). Pin the insert to status='pending'
-- (matching the role_applications / content_reports policies) and remove client
-- UPDATE/DELETE grants (only admins/reviewers mutate KYC rows).

-- DB-4 --------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.audit_log        FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_gateways FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.platform_settings FROM anon, authenticated;

-- DB-5 --------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can submit KYC docs" ON public.kyc_documents;
CREATE POLICY "Users can submit KYC docs" ON public.kyc_documents
  FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending'::public.kyc_status);

REVOKE UPDATE, DELETE ON public.kyc_documents FROM anon, authenticated;
