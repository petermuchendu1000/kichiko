-- 072_admin_void_market.sql
-- ---------------------------------------------------------------------------
-- Void policy for the admin console: a conserving void at a chosen YES price.
--
-- Policy (docs/design/BRAIN-ARCHITECTURE-2026-09.md §9.3, approved by owner):
--   * A market that cannot be resolved (event cancelled, ambiguous rules,
--     source unavailable) is VOIDED, not refunded at cost basis.
--   * Every share settles at a single YES price p (0 <= p <= 1); NO pays 1-p.
--     Default p = 0.50, the precedent Polymarket's UMA flow uses for
--     "Unknown / 50-50" outcomes (research report 01 §5). An operator may pick
--     another p (e.g. a documented fair value) with a written reason.
--   * Why not refund cost basis: after secondary trading a seller has already
--     received the buyer's cash, so the sum of holders' cost bases exceeds the
--     $1-per-pair collateral actually held; a cost-basis refund pays out money
--     the platform does not have (see 069 header). A p / 1-p void pays out
--     exactly the collateral for ANY p (Sum YES == Sum NO per option).
--   * All resting orders are cancelled and their escrow returned first; the
--     069 solvency guard (P0141) still applies.
--
-- This migration:
--   1. void_market records the acting operator as resolver (was NULL).
--   2. admin_void_market(market, yes_price DEFAULT 0.5, reason): capability
--      markets:cancel, reason >= 10 chars, price in [0,1], audit_log entry.
--      Callable by authenticated (the capability check is the gate), like the
--      other admin_* wrappers.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.void_market(p_market_id uuid, p_yes_price numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_map jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('markets:cancel') THEN
    RAISE EXCEPTION 'Not authorized (requires markets:cancel)' USING ERRCODE = 'P0121';
  END IF;
  IF p_yes_price IS NULL OR p_yes_price < 0 OR p_yes_price > 1 THEN
    RAISE EXCEPTION 'Void YES price must be within [0,1]' USING ERRCODE = 'P0145';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A void reason is required' USING ERRCODE = 'P0145';
  END IF;
  SELECT COALESCE(jsonb_object_agg(id::text, p_yes_price), '{}'::jsonb)
    INTO v_map FROM public.market_options WHERE market_id = p_market_id;
  RETURN public._clob_settle_market(p_market_id, v_map, 'cancelled', auth.uid(), p_reason, NULL, NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_void_market(
  p_market_id UUID,
  p_reason    TEXT,
  p_yes_price NUMERIC DEFAULT 0.5
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.has_capability('markets:cancel') THEN
    RAISE EXCEPTION 'Insufficient permissions (markets:cancel required)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A void reason (>= 10 chars) is required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_yes_price IS NULL OR p_yes_price < 0 OR p_yes_price > 1 THEN
    RAISE EXCEPTION 'Void YES price must be within [0,1]' USING ERRCODE = 'check_violation';
  END IF;

  v_result := public.void_market(p_market_id, p_yes_price, p_reason);

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_data)
  VALUES (
    auth.uid(), 'market.void', 'market', p_market_id,
    jsonb_build_object('reason', p_reason, 'yes_price', p_yes_price, 'result', v_result)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_void_market(UUID, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_market(UUID, TEXT, NUMERIC) TO authenticated, service_role;

COMMIT;
