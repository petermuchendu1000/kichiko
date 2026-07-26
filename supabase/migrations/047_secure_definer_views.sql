-- 047_secure_definer_views.sql
-- Fixes two Supabase "Security Definer View" advisories on public views that
-- were owned by `postgres` (a superuser, so RLS is bypassed) with the default
-- SECURITY DEFINER behavior (security_invoker unset). Both are switched to
-- `security_invoker = on` so the querying user's privileges + RLS apply.
--
--   * public.market_search  -- reads RLS-enabled `markets`. Its WHERE clause
--       (status IN active/closed/resolved AND is_hidden = false) is identical
--       to the PUBLIC branch of the markets SELECT RLS policy, and anon/
--       authenticated already hold SELECT on markets, so flipping to invoker
--       returns the SAME public rows -- no functional change, just correct RLS.
--
--   * public.slow_queries  -- observability over pg_stat_statements, which
--       holds the raw SQL text of every statement across the whole database.
--       As a definer view it leaked that to anon/authenticated. security_invoker
--       alone is not enough here: the data must not be reachable by public roles
--       at all, so we also REVOKE public access and keep it to service_role.

-- ---------------------------------------------------------------------------
-- market_search: enforce caller RLS (safe; results unchanged for public users)
-- ---------------------------------------------------------------------------
ALTER VIEW public.market_search SET (security_invoker = on);

-- ---------------------------------------------------------------------------
-- slow_queries: remove public exposure + enforce caller RLS (defense in depth)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.slow_queries FROM anon, authenticated, PUBLIC;
ALTER VIEW public.slow_queries SET (security_invoker = on);
GRANT SELECT ON public.slow_queries TO service_role;
