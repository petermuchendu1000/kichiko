-- 061_lockdown_money_table_client_writes.sql
--
-- DB-2 (High, defense-in-depth): `authenticated` (and in some cases anon/PUBLIC)
-- still holds table-level INSERT/UPDATE/DELETE grants on the core money tables.
--
-- These are currently NOT exploitable: each table has RLS enabled with only a
-- service_role write policy (no permissive write policy for authenticated), so
-- RLS denies direct client writes today. But the stray grants are the exact
-- latent trap migration 059 removed for clob_orders/clob_fills — a single future
-- permissive write policy (e.g. FOR ALL USING (true)) would turn them into
-- direct balance / withdrawal / position forgery. It is inconsistent that
-- clob_* were hardened while wallets/transactions/withdrawals/deposits/positions
-- were left with the grants.
--
-- All legitimate money mutations already go through SECURITY DEFINER RPCs
-- (credit_deposit, request_withdrawal, complete_withdrawal, fail_withdrawal,
-- clob_place_order, clob_cancel_order, admin_adjust_balance, ...) which run as
-- the function owner and are unaffected by these grants.
--
-- Scope: revoke direct writes only; SELECT is preserved for RLS-scoped reads.
-- NOTE: public.markets and public.kyc_documents are intentionally EXCLUDED —
-- they carry legitimate authenticated self-INSERT policies (market creation and
-- KYC document upload) and must keep their write grants.

REVOKE INSERT, UPDATE, DELETE ON public.wallets      FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.withdrawals  FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.deposits     FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.positions    FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.orders       FROM anon, authenticated, PUBLIC;
