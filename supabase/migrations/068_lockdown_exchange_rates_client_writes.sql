-- 068_lockdown_exchange_rates_client_writes.sql
-- Defense-in-depth: lock direct client writes on public.exchange_rates.
--
-- exchange_rates is already write-protected by RLS: the only write-capable
-- policy is "Service role can manage exchange rates" (USING auth.role() =
-- 'service_role'), so an authenticated UPDATE/DELETE matches 0 rows and INSERT
-- fails the WITH CHECK. HOWEVER the anon/authenticated roles still held
-- table-level INSERT/UPDATE/DELETE grants, leaving writes gated by RLS alone.
--
-- FX rates drive every KES<->USD conversion (deposits credited, payouts,
-- balances, display), so they must only ever be written by the service role or
-- the SECURITY DEFINER `upsert_exchange_rates` job. Revoke the loose grants,
-- mirroring the money-table client-write lockdown in migration 061. Public
-- SELECT (anon-readable rates the UI relies on) is intentionally preserved.

revoke insert, update, delete on public.exchange_rates from anon;
revoke insert, update, delete on public.exchange_rates from authenticated;
