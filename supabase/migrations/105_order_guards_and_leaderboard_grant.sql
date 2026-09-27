-- 105_order_guards_and_leaderboard_grant.sql — three guards the app layer
-- cannot enforce on its own (docs/research/ui-2026-09/51-PROPOSED-DB-CHANGES.md
-- D1-D3), applied on the owner's instruction (2026-09-27).
--
-- D1: place_order_for refused nothing on hidden markets (104 left it as policy,
--     register A-X4). Two markets were hidden on 2026-09-27 under Kenya L.N. 112
--     of 2026 Reg. 45(7)(a) and could still take orders by id. Buys on a hidden
--     market now raise P0186; sells stay open so holders can exit.
-- D2: statutory minimum stake. Gambling Control Act 2025 s.71(1): "A player in
--     an online gambling activity shall not bet an amount of less than twenty
--     shillings". Buys costing less than KSh 20 (in the settlement currency)
--     raise P0185. The app checks this too, but only the database knows the
--     settlement currency and the cost of every order type.
-- D3: the profit leaderboard was taken down in the app, but get_leaderboard
--     stayed executable by PUBLIC, anon and authenticated through PostgREST.
--
-- The function body is 104's (verified identical to production on 2026-09-27)
-- plus the two [105] blocks. The matcher (clob_place_order) is unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.place_order_for(
  p_user_id uuid, p_market_id uuid, p_market_option_id uuid, p_outcome_side order_side,
  p_action clob_action, p_order_type order_type,
  p_price_cents numeric DEFAULT NULL, p_size numeric DEFAULT NULL, p_amount_local numeric DEFAULT NULL,
  p_currency currency_code DEFAULT NULL, p_client_order_id text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL, p_env_flags jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prof     record;
  v_setting  jsonb;
  v_on       boolean;
  v_engine   text;
  v_book     jsonb;
  v_best_ask numeric;
  v_rate     numeric;
  v_amt_usd  numeric;
  v_size     numeric := p_size;
  v_budget   numeric := NULL;
  v_coid     text := p_client_order_id;
  v_hidden   boolean;
  v_min_local  numeric;
  v_cost_local numeric;
  v_kes_rate   numeric;
  v_ask        numeric;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;

  SELECT account_status::text AS status, country_code, settlement_currency INTO v_prof
    FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND OR v_prof.status <> 'active' THEN
    RAISE EXCEPTION 'Account is not active' USING ERRCODE = 'P0190';
  END IF;
  -- [099] an order that has already expired is refused, not traded (audit #30)
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'This order has already expired (expires_at is in the past)' USING ERRCODE = 'P0196';
  END IF;

  -- maintenance: env override, else stored (default off)
  IF p_env_flags ? 'maintenance.enabled' THEN
    v_on := (p_env_flags->>'maintenance.enabled')::boolean;
  ELSE
    SELECT value INTO v_setting FROM public.platform_settings WHERE key = 'maintenance.enabled';
    v_on := COALESCE(v_setting = 'true'::jsonb OR v_setting = '"true"'::jsonb, false);
  END IF;
  IF v_on THEN RAISE EXCEPTION 'Kichiko is in maintenance' USING ERRCODE = 'P0191'; END IF;

  -- order-book kill switch: env override, else stored (default off)
  IF p_env_flags ? 'flags.clob' THEN
    v_on := (p_env_flags->>'flags.clob')::boolean;
  ELSE
    SELECT value INTO v_setting FROM public.platform_settings WHERE key = 'flags.clob';
    v_on := COALESCE(v_setting = 'true'::jsonb OR v_setting = '"true"'::jsonb, false);
  END IF;
  IF NOT v_on THEN RAISE EXCEPTION 'Order-book trading is temporarily unavailable' USING ERRCODE = 'P0192'; END IF;

  -- settlement currency of the user's country (079); a request currency is an assertion
  IF v_prof.country_code IS NULL OR v_prof.settlement_currency IS NULL THEN
    RAISE EXCEPTION 'Choose your country in Settings before moving money' USING ERRCODE = 'P0193';
  END IF;
  IF p_currency IS NOT NULL AND p_currency <> v_prof.settlement_currency THEN
    RAISE EXCEPTION 'Your account settles in %; this request was in %', v_prof.settlement_currency, p_currency
      USING ERRCODE = 'P0194';
  END IF;

  SELECT pricing_engine, is_hidden INTO v_engine, v_hidden FROM public.markets WHERE id = p_market_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001'; END IF;
  -- [105] a hidden (taken-down) market takes no new buys. Sells stay open so
  -- holders are never trapped in a position they cannot exit.
  IF v_hidden AND p_action = 'buy' THEN
    RAISE EXCEPTION 'This market is not open for trading' USING ERRCODE = 'P0186';
  END IF;
  IF v_engine IS DISTINCT FROM 'clob' THEN
    RAISE EXCEPTION 'This market is not an order-book market' USING ERRCODE = 'P0103';
  END IF;

  -- [104] a deactivated option is not traded; a frozen wallet does not trade
  -- (withdrawals already refuse it with P0012) (db-core #19)
  IF EXISTS (SELECT 1 FROM public.market_options
              WHERE id = p_market_option_id AND market_id = p_market_id AND is_active IS FALSE) THEN
    RAISE EXCEPTION 'This option is not open for trading' USING ERRCODE = 'P0199';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallets
              WHERE user_id = p_user_id AND currency = v_prof.settlement_currency AND is_active IS FALSE) THEN
    RAISE EXCEPTION 'Wallet is inactive' USING ERRCODE = 'P0012';
  END IF;

  -- a dollar-denominated market buy: shares at the best ask, the amount as the budget
  IF p_order_type = 'market' AND v_size IS NULL AND p_amount_local IS NOT NULL THEN
    v_book := public.clob_get_book(p_market_id, p_market_option_id, p_outcome_side);
    v_best_ask := NULLIF(v_book->>'best_ask', '')::numeric;
    IF v_best_ask IS NULL OR v_best_ask <= 0 THEN
      RAISE EXCEPTION 'No resting liquidity to fill a market order right now' USING ERRCODE = 'P0195';
    END IF;
    SELECT rate INTO v_rate FROM public.exchange_rates
     WHERE from_currency = v_prof.settlement_currency AND to_currency = 'USD';
    IF v_rate IS NULL THEN RAISE EXCEPTION 'Unsupported currency' USING ERRCODE = 'P0003'; END IF;
    v_amt_usd := p_amount_local * v_rate;
    v_size := floor((v_amt_usd / (v_best_ask / 100.0)) * 1e6) / 1e6;
    v_budget := v_amt_usd;
    IF v_size <= 0 THEN RAISE EXCEPTION 'Amount too small to buy any shares' USING ERRCODE = 'P0102'; END IF;
  END IF;
  IF v_size IS NULL OR v_size <= 0 THEN
    RAISE EXCEPTION 'Order size must be greater than zero' USING ERRCODE = 'P0102';
  END IF;

  -- [105] statutory minimum stake on buys (Gambling Control Act 2025 s.71(1):
  -- no online bet under KSh 20), in the user's settlement currency: exactly
  -- KSh 20 for KES; KSh 20 converted through the USD rates otherwise.
  IF p_action = 'buy' THEN
    IF v_rate IS NULL THEN
      SELECT rate INTO v_rate FROM public.exchange_rates
       WHERE from_currency = v_prof.settlement_currency AND to_currency = 'USD';
    END IF;
    IF v_prof.settlement_currency = 'KES' THEN
      v_min_local := 20;
    ELSE
      SELECT rate INTO v_kes_rate FROM public.exchange_rates WHERE from_currency = 'KES' AND to_currency = 'USD';
      v_min_local := CASE WHEN v_kes_rate > 0 AND v_rate > 0 THEN 20 * v_kes_rate / v_rate END;
    END IF;
    IF p_amount_local IS NOT NULL AND p_size IS NULL THEN
      v_cost_local := p_amount_local;
    ELSIF p_order_type = 'limit' AND v_rate > 0 THEN
      v_cost_local := v_size * (p_price_cents / 100.0) / v_rate;
    ELSIF v_rate > 0 THEN
      v_ask := NULLIF(public.clob_get_book(p_market_id, p_market_option_id, p_outcome_side)->>'best_ask', '')::numeric;
      v_cost_local := CASE WHEN v_ask > 0 THEN v_size * (v_ask / 100.0) / v_rate END;
    END IF;
    IF v_min_local IS NOT NULL AND v_cost_local IS NOT NULL AND v_cost_local < v_min_local THEN
      RAISE EXCEPTION 'The minimum stake is KSh 20' USING ERRCODE = 'P0185';
    END IF;
  END IF;

  IF v_coid IS NULL THEN
    v_coid := 'clob_' || left(p_user_id::text, 8) || '_' || left(md5(random()::text || clock_timestamp()::text), 8);
  END IF;

  RETURN public.clob_place_order(
    p_user_id, p_market_id, p_market_option_id, p_outcome_side, p_action, p_order_type,
    CASE WHEN p_order_type = 'limit' THEN p_price_cents ELSE NULL END,
    v_size, v_prof.settlement_currency, v_coid, p_expires_at, v_budget);
END;
$function$;

-- D3: the ranking is no longer public. Kept (service_role) for the opt-in
-- accuracy board that replaces it.
REVOKE EXECUTE ON FUNCTION public.get_leaderboard(text, text, integer) FROM PUBLIC, anon, authenticated;

COMMIT;
