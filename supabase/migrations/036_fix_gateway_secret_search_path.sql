-- ============================================================
-- 036_fix_gateway_secret_search_path.sql
-- ------------------------------------------------------------
-- FIX: gateway secret encrypt/decrypt failed on Supabase with
--   "function pgp_sym_decrypt(bytea, text) does not exist".
--
-- Root cause: admin_get_gateway_secret / admin_rotate_gateway_secret are
-- SECURITY DEFINER with `SET search_path = public`, but pgcrypto is installed in
-- the `extensions` schema on Supabase (not `public`). With only `public` on the
-- path, pgp_sym_encrypt / pgp_sym_decrypt are unresolvable, so every secret read
-- returned an error (surfaced in the UI as "Missing consumer_key /
-- consumer_secret" on the gateway connection test) and every rotation failed.
--
-- Fix: pin `search_path = public, extensions` so pgcrypto resolves, while still
-- keeping a FIXED search_path (no injection surface for the SECURITY DEFINER
-- functions). Portable: works whether pgcrypto lives in `extensions` (Supabase)
-- or `public` (some local setups). Bodies are otherwise byte-for-byte identical
-- to migration 012; existing ciphertext stays valid (same key function).
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_get_gateway_secret(
  p_gateway_id UUID,
  p_key        TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cipher BYTEA;
BEGIN
  IF NOT (public.has_capability('gateways:secrets') OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Insufficient permissions to read gateway secrets'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT ciphertext INTO v_cipher
    FROM public.gateway_secrets WHERE gateway_id = p_gateway_id AND key = p_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pgp_sym_decrypt(v_cipher, public._gateway_enc_key());
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_rotate_gateway_secret(
  p_gateway_id UUID,
  p_key        TEXT,
  p_value      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_last4 TEXT;
BEGIN
  IF NOT public.has_capability('gateways:secrets') THEN
    RAISE EXCEPTION 'Insufficient permissions (gateways:secrets required — superadmin only)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_value IS NULL OR length(p_value) = 0 THEN
    RAISE EXCEPTION 'A non-empty secret value is required' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM public.payment_gateways WHERE id = p_gateway_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gateway not found' USING ERRCODE = 'no_data_found'; END IF;

  v_last4 := right(p_value, 4);

  INSERT INTO public.gateway_secrets (gateway_id, key, ciphertext, last4, updated_by, updated_at)
  VALUES (p_gateway_id, p_key,
          pgp_sym_encrypt(p_value, public._gateway_enc_key()), v_last4, auth.uid(), NOW())
  ON CONFLICT (gateway_id, key) DO UPDATE
    SET ciphertext = EXCLUDED.ciphertext,
        last4      = EXCLUDED.last4,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW();

  UPDATE public.payment_gateways
     SET secret_ref = COALESCE(secret_ref, '{}'::jsonb) || jsonb_build_object(
           p_key, jsonb_build_object('last4', v_last4, 'updated_at', NOW())),
         updated_at = NOW()
   WHERE id = p_gateway_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'gateway.rotate_secret', 'payment_gateway', p_gateway_id,
          NULL, jsonb_build_object('key', p_key, 'last4', v_last4));

  RETURN jsonb_build_object('success', TRUE, 'key', p_key, 'last4', v_last4);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_gateway_secret(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_rotate_gateway_secret(UUID, TEXT, TEXT) TO authenticated, service_role;
