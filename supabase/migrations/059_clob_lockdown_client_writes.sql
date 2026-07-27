-- 059_clob_lockdown_client_writes.sql
-- Security fix (H-DB-1): lock down DIRECT client writes to the CLOB money-path
-- tables public.clob_orders and public.clob_fills.
--
-- Background: migration 030 enabled RLS on both tables but left two gaps that,
-- combined with Supabase's platform default privileges (which grant
-- INSERT/UPDATE/DELETE EXPLICITLY to `authenticated` on new public tables),
-- let an authenticated user write these tables DIRECTLY via PostgREST:
--
--   1. clob_orders carried an over-broad `clob_orders_owner_cud` policy
--      (FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())),
--      so an owner could INSERT/UPDATE/DELETE their OWN order rows, AND
--   2. `authenticated` held table grants INSERT/UPDATE/DELETE on BOTH
--      clob_orders and clob_fills (live ACL confirmed:
--      authenticated = SELECT,INSERT,UPDATE,DELETE on each).
--
-- This bypassed the SECURITY DEFINER RPCs clob_place_order / clob_cancel_order,
-- skipping collateral reservation, self-trade prevention, rate limits, and
-- tick/min-size/market-active validation -- i.e. a user could forge open
-- orders / fills with no escrow (seen live: orders with metadata.engine IS NULL
-- and wallet reserved_balance = 0 despite open-order escrow).
--
-- Fix (mirrors the 049/051/057/058 client-lockdown pattern):
--   * REVOKE INSERT, UPDATE, DELETE from anon, authenticated, PUBLIC on both
--     tables. SELECT is intentionally KEPT so reads still work: GET /api/orders
--     returns a user's own orders via RLS. A blanket REVOKE would kill reads,
--     so we revoke ONLY the write privileges.
--   * Replace the FOR ALL `clob_orders_owner_cud` policy with a SELECT-only
--     owner policy (owners can still READ their orders, never write directly).
--     clob_fills already had only a SELECT policy (clob_fills_participant_select)
--     and NO write policy, so no fills write-policy exists to drop -- its read
--     policy is left exactly as-is.
--
-- The SECURITY DEFINER RPCs (clob_place_order, clob_cancel_order,
-- clob_expire_orders) run as the function OWNER and bypass the caller's table
-- grants + RLS, so they remain fully functional and are now the ONLY write path
-- to clob_orders / clob_fills.
--
-- Idempotent: REVOKE and DROP POLICY IF EXISTS / CREATE POLICY are safe to
-- re-run. No table/column drops or truncation -- expand/contract-safe.

-- ---------------------------------------------------------------------
-- 1. Remove the explicit client-role WRITE grants (keep SELECT untouched).
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.clob_orders FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.clob_fills  FROM anon, authenticated, PUBLIC;

-- ---------------------------------------------------------------------
-- 2. clob_orders: drop the over-broad FOR ALL owner policy and (re)assert a
--    SELECT-only owner policy. Same USING predicate as before, so owner read
--    behavior is preserved EXACTLY; direct writes are removed.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS clob_orders_owner_cud ON public.clob_orders;
DROP POLICY IF EXISTS clob_orders_owner_select ON public.clob_orders;
CREATE POLICY clob_orders_owner_select ON public.clob_orders
  FOR SELECT USING (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. clob_fills: no write policy exists; the participant SELECT policy is the
--    only policy and stays as defined in migration 030. Re-asserted here
--    idempotently so read behavior is explicit and unchanged.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS clob_fills_participant_select ON public.clob_fills;
CREATE POLICY clob_fills_participant_select ON public.clob_fills
  FOR SELECT USING (taker_user_id = auth.uid() OR maker_user_id = auth.uid());
