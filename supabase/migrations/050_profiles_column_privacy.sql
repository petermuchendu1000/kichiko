-- 050_profiles_column_privacy.sql
-- Fixes unauthenticated PII / role / KYC exposure on public.profiles.
--
-- profiles has an RLS policy "Profiles are publicly viewable" (SELECT USING true)
-- and a table-wide SELECT grant to anon, so the anon (unauthenticated) role can
-- read EVERY column of EVERY user -- confirmed live: anon read users'
-- phone_number, each user's role (revealing admin/superadmin accounts to
-- target), kyc_status, account_status and the referral graph. A privacy/PII
-- leak and attacker-recon aid, scrapeable with only the public anon key.
--
-- Column-level REVOKE alone is ineffective while a table-wide SELECT grant
-- exists (the table grant covers all columns), so we drop anon's table-wide
-- SELECT and re-grant SELECT on ONLY the public identity + aggregate trading
-- columns that leaderboards / trader cards / spotlight actually read.
--
-- authenticated is intentionally left untouched (users read their own full row
-- via use-auth select('*')); the residual "an authenticated user can read other
-- users' private columns" is tracked separately for an app-coordinated split
-- into an owner-RLS private table.

REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, username, display_name, avatar_url, bio, country_code, total_volume_usd, total_bets, total_wins, win_rate, profit_loss_usd, created_at, updated_at, profile_view_count) ON public.profiles TO anon;
