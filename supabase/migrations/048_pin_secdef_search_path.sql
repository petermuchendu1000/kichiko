-- 048_pin_secdef_search_path.sql
-- Hardens the 14 SECURITY DEFINER functions that were missing a pinned
-- search_path (Supabase advisory "Function Search Path Mutable", CWE-426).
--
-- A SECURITY DEFINER function without a pinned search_path resolves unqualified
-- object names against the CALLER's session search_path, so a caller who can
-- place an object earlier in the path can shadow what the function references
-- and run code with the definer's (elevated) privileges. This is especially
-- dangerous here because the set includes the authorization primitives
-- (has_capability / is_admin / is_superadmin / is_staff / _actor_is_superadmin)
-- that gate every admin_* function and RLS policy in the system.
--
-- Fix: pin search_path = public (these functions reference only public objects;
-- none use pgcrypto/uuid-ossp/extensions), matching the convention already used
-- by the other 90 SECURITY DEFINER functions. Bodies and grants are unchanged.

ALTER FUNCTION public._actor_is_superadmin() SET search_path = public;
ALTER FUNCTION public.admin_review_kyc(p_doc_id uuid, p_status kyc_status, p_reviewer_id uuid, p_rejection_reason text) SET search_path = public;
ALTER FUNCTION public.cancel_market(p_market_id uuid, p_reason text) SET search_path = public;
ALTER FUNCTION public.guard_profile_delete() SET search_path = public;
ALTER FUNCTION public.guard_profile_role_change() SET search_path = public;
ALTER FUNCTION public.has_capability(cap text) SET search_path = public;
ALTER FUNCTION public.is_admin() SET search_path = public;
ALTER FUNCTION public.is_staff() SET search_path = public;
ALTER FUNCTION public.is_superadmin() SET search_path = public;
ALTER FUNCTION public.resolve_market_options(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text) SET search_path = public;
ALTER FUNCTION public.resolve_market_options_binary(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text) SET search_path = public;
ALTER FUNCTION public.set_market_pricing_independent(p_market_id uuid) SET search_path = public;
ALTER FUNCTION public.update_profile_stats() SET search_path = public;
ALTER FUNCTION public.update_unique_bettors() SET search_path = public;
