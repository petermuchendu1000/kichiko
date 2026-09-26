-- 100_gateway_secret_reencrypt.sql — move the gateway secrets to a real key
-- (register A-K1).
--
-- The deploy report shows production's gateway secrets are encrypted with the
-- dev fallback key, a constant in 012 ("gateway secret key: NOT SET"), which
-- 098 also found callable by anyone until then. The key itself must never be
-- in this repository, so the owner sets it; this function then moves every
-- secret to it in one statement:
--
--   1. ALTER DATABASE postgres SET app.gateway_encryption_key = '<64+ random chars>';
--      (Supabase SQL editor; new sessions pick it up)
--   2. in a NEW session:
--      SELECT public.reencrypt_gateway_secrets('marketpips-dev-gateway-key-change-me-in-production');
--   3. restart the project (Settings > General > Restart), straight after 2:
--      the setting applies to NEW sessions only, and pooled API connections
--      opened before step 1 would keep decrypting with the old key and fail;
--   4. check the next deploy report: "gateway secret key: set".
--   Do 1-3 together: between 2 and 3, gateway secrets read through old
--   pooled sessions fail (M-Pesa config for deposits is one of them).
--
-- Refused while no key is configured, or when the new key equals the old.
-- All-or-nothing: a wrong old key makes pgp_sym_decrypt raise and nothing
-- changes. Writes an audit row (counts only, never a secret). Service role
-- or SQL editor only.
BEGIN;

CREATE OR REPLACE FUNCTION public.reencrypt_gateway_secrets(p_old_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_new text := NULLIF(current_setting('app.gateway_encryption_key', true), '');
  v_n   integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'Set app.gateway_encryption_key first (ALTER DATABASE ... SET), then call this from a new session'
      USING ERRCODE = 'P0197';
  END IF;
  IF p_old_key IS NULL OR p_old_key = v_new THEN
    RAISE EXCEPTION 'The old key must be given and differ from the new one' USING ERRCODE = 'P0198';
  END IF;

  UPDATE public.gateway_secrets
     SET ciphertext = pgp_sym_encrypt(pgp_sym_decrypt(ciphertext, p_old_key), v_new),
         updated_at = now()
   WHERE true;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_data)
  VALUES (NULL, 'gateway_secrets_reencrypted', 'gateway_secrets', NULL, jsonb_build_object('secrets', v_n));

  RETURN jsonb_build_object('reencrypted', v_n);
END;
$function$;

REVOKE ALL ON FUNCTION public.reencrypt_gateway_secrets(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reencrypt_gateway_secrets(text) TO service_role;

COMMIT;
