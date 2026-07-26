-- 056_restore_admin_review_kyc_grant.sql
-- Regression fix (42501 in the admin KYC queue).
--
-- Migration 051 revoked EXECUTE on admin_review_kyc from anon/authenticated as
-- part of the internal-definer lockdown, on the stated assumption that "every
-- one of these is only ever invoked in-app via the service-role admin client."
-- That assumption is FALSE for this one function: the KYC review route
-- (POST /api/admin/kyc/[id]/review) calls it via the *authenticated* client
-- (guard.ctx.supabase from requireCapability), exactly like its 26 sibling
-- admin_* RPCs (admin_adjust_balance, admin_set_user_role, ...), all of which
-- remain granted to authenticated. So authenticated admins now hit
--   42501 "permission denied for function clob_place_order"-style errors
-- and KYC approval/rejection is completely broken in the admin panel.
--
-- Re-granting is SAFE (unlike leaving 051's over-revoke in place would be
-- "safe but broken"): admin_review_kyc carries the same in-body authorization
-- guard its siblings do -- added in migration 052 --
--     IF NOT public.has_capability('kyc:review') THEN
--       RAISE EXCEPTION '... (kyc:review required)' USING ERRCODE = 'P0121';
-- and has_capability() resolves the caller via auth.uid(), which is only
-- populated for the authenticated client. Calling this RPC as service_role
-- would make auth.uid() NULL and fail the guard, so the function is *designed*
-- to be invoked by the authenticated admin session. A direct PostgREST call by
-- a non-privileged authenticated (or anon) user therefore returns P0121, not a
-- bypass -- the belt-and-suspenders control 052 exists precisely for this.
--
-- Scope: authenticated only. We deliberately do NOT restore the historical anon
-- grant (051 removed it too); anon has no legitimate reason to reach an admin
-- KYC endpoint, and the in-body guard blocks it regardless.

GRANT EXECUTE ON FUNCTION public.admin_review_kyc(
  p_doc_id uuid,
  p_status kyc_status,
  p_reviewer_id uuid,
  p_rejection_reason text
) TO authenticated;
