-- 057_lockdown_kichiko_schedulers.sql
-- Security fix: complete the client lockdown that migration 055 left half-done.
--
-- Background: 055 renamed the cron schedulers (schedule_marketpips_* ->
-- schedule_kichiko_jobs / schedule_kichiko_btc_jobs) via CREATE OR REPLACE and
-- attempted to lock them with `REVOKE EXECUTE ... FROM PUBLIC` ONLY. That is
-- insufficient on Supabase: the platform's default privileges grant EXECUTE
-- EXPLICITLY to the `anon` and `authenticated` roles, and a PUBLIC-only revoke
-- does not remove those explicit grants. The functions therefore remained
-- client-exposed SECURITY DEFINER surfaces (live ACL: anon=X, authenticated=X),
-- which the definer-exposure security audit flags as UNREVIEWED violations.
--
-- These functions schedule/unschedule pg_cron jobs (they can point cron at an
-- arbitrary base URL with the cron secret) and must only ever be invoked by
-- the trusted service_role during provisioning -- never by a browser client.
-- This migration applies the correct 051-style lockdown: REVOKE from
-- anon/authenticated/PUBLIC, GRANT to service_role only.
--
-- Idempotent: REVOKE/GRANT are safe to re-run.

REVOKE EXECUTE ON FUNCTION public.schedule_kichiko_jobs(text, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.schedule_kichiko_jobs(text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.schedule_kichiko_btc_jobs(text, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.schedule_kichiko_btc_jobs(text, text) TO service_role;
