-- 098_gateway_key_private.sql — the gateway-secret encryption key is not
-- callable by API clients (db-core audit #38).
--
-- BUG (reproduced: scripts/ops/test_gateway_key_private.py, red for anon and
-- authenticated): public._gateway_enc_key() (012) returns the symmetric key
-- that encrypts payment-gateway secrets (gateway_secrets: consumer secrets,
-- passkeys, B2C security credentials). It kept Supabase's default EXECUTE for
-- anon and authenticated, so anyone with the public anon key could POST
-- /rest/v1/rpc/_gateway_enc_key and read it. It is SECURITY INVOKER, so the
-- definer-exposure audit (which checks SECURITY DEFINER functions) never
-- flagged it.
--
-- FIX: EXECUTE only for its owner. The functions that use it
-- (set/get of gateway secrets, 012/036) are SECURITY DEFINER and run as the
-- owner, so they keep working. Nothing in the app calls it directly.
--
-- If the production key was ever read this way, rotating it means
-- re-encrypting every gateway secret: see the register (A-K1).
BEGIN;
REVOKE ALL ON FUNCTION public._gateway_enc_key() FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
