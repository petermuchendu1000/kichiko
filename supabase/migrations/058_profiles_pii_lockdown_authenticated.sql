-- 058_profiles_pii_lockdown_authenticated.sql
-- Closes the residual PII leak that migration 050 explicitly deferred:
-- "authenticated is intentionally left untouched ... the residual 'an
--  authenticated user can read other users' private columns' is tracked
--  separately for an app-coordinated split."
--
-- Problem: profiles has SELECT RLS `USING (true)` for all roles AND a
-- table-wide SELECT grant to `authenticated`, so ANY logged-in user can read
-- EVERY column of EVERY user -- phone_number, kyc_status, account_status, role
-- (reveals staff/superadmin accounts to target), last_login_at, referral graph,
-- notification prefs. Confirmed live.
--
-- Fix (mirrors the 050 anon lockdown, now for authenticated): a table-wide
-- SELECT grant covers all columns and makes column-level REVOKE ineffective, so
-- drop authenticated's table-wide SELECT and re-grant SELECT on ONLY the public
-- identity + aggregate-trading columns (the exact set 050 exposed to anon, which
-- leaderboards / trader cards / comment authors / PostgREST embeds actually
-- read). RLS `USING (true)` stays -- row visibility of PUBLIC columns is
-- intended; private columns are simply no longer granted to the client roles.
--
-- Self-access: a user still needs their OWN full row (role/kyc/prefs) for the
-- app to work. get_my_profile() is a self-scoped SECURITY DEFINER function
-- (returns only WHERE id = auth.uid()) granted to authenticated. Chosen over a
-- SECURITY DEFINER *view* deliberately -- migration 047 moved away from definer
-- views; a self-scoped, allow-listed definer function is the consistent pattern.
--
-- Cross-user private access (admin consoles) goes through the service_role
-- "capability-holder" client, which bypasses RLS/grants and is already the
-- path used for admin writes.

-- 1) Narrow authenticated's SELECT to the public column set (same as anon/050).
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, username, display_name, avatar_url, bio, country_code,
  total_volume_usd, total_bets, total_wins, win_rate, profit_loss_usd,
  created_at, updated_at, profile_view_count
) ON public.profiles TO authenticated;

-- 2) Self-scoped full-row read for the authenticated caller.
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

COMMENT ON FUNCTION public.get_my_profile() IS
  'Returns the caller''s own profile row only (WHERE id = auth.uid()). Definer so an authenticated user can read their own private columns after 058 narrowed the table SELECT grant to public columns. Never returns another user''s row.';
