-- 060_profiles_write_column_lockdown.sql
--
-- DB-1 (Critical): close a live, browser-exploitable privilege-escalation on
-- public.profiles.
--
-- Before this migration, `authenticated` held a *table-level* UPDATE grant on
-- public.profiles and the self-update RLS policy ("Users can update own
-- profile") had no WITH CHECK. Because Supabase runs every signed-in user as the
-- single `authenticated` Postgres role, any logged-in user could issue
--   PATCH /rest/v1/profiles?id=eq.<self>
-- and directly set sensitive columns on their own row:
--   * kyc_status      -> self-approve KYC / bypass AML gating
--   * account_status  -> self-reactivate a suspended account
--   * role            -> (blocked by guard_profile_role_change trigger, but the
--                         grant was still present)
--   * total_volume_usd/total_bets/total_wins/win_rate/profit_loss_usd
--                     -> inflate leaderboard / trader stats
--
-- Fix: drop the over-broad table-level UPDATE grant and re-grant UPDATE only on
-- the columns the application legitimately lets a user edit via the RLS-scoped
-- session (verified against /api/profile, /api/notifications/preferences and
-- /api/locale). All admin/privileged mutations of sensitive columns already go
-- through SECURITY DEFINER RPCs (admin_review_kyc, admin_set_user_role,
-- admin_set_account_status, admin_adjust_balance, ...), which run as the
-- function owner and are unaffected by these column grants. Also add a WITH
-- CHECK to the self-update policy so row ownership (id) cannot be reassigned.

BEGIN;

-- 1. Remove the over-broad table-level UPDATE (covers every column).
REVOKE UPDATE ON public.profiles FROM authenticated;
REVOKE UPDATE ON public.profiles FROM anon;
REVOKE UPDATE ON public.profiles FROM PUBLIC;

-- 2. Re-grant UPDATE only on user-editable columns.
--    Matches the exact SET lists written by the RLS-scoped user session:
--      /api/profile               -> display_name, username, bio, phone_number,
--                                    country_code, preferred_currency, avatar_url
--      /api/notifications/prefs    -> email_notifications, sms_notifications,
--                                    push_notifications
--      /api/locale                 -> preferred_locale
GRANT UPDATE (
  display_name,
  username,
  bio,
  phone_number,
  country_code,
  preferred_currency,
  avatar_url,
  email_notifications,
  sms_notifications,
  push_notifications,
  preferred_locale
) ON public.profiles TO authenticated;

-- 3. Tighten the self-update policy with a WITH CHECK so a user cannot reassign
--    the row's id (ownership) during an update. USING is preserved verbatim.
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

COMMIT;
