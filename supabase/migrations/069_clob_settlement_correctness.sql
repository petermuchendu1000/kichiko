-- 069_clob_settlement_correctness.sql
-- ---------------------------------------------------------------------------
-- CLOB-correct settlement: resolution, void and cancel.
--
-- PROBLEM (CONFIRMED in code and reproduced by scripts/ops/clob/test_settlement.py)
--   The resolvers in 052 are AMM-era code. Under the AMM a stake was parked in
--   wallets.reserved_balance, so at resolution the resolver "returned the stake"
--   and paid winnings on top. On the CLOB a buyer's filled cost leaves the
--   wallet for good (046:400-403); only the UNFILLED remainder of a resting buy
--   sits in reserved_balance. The unchanged resolvers therefore:
--     1. pay every winner shares + total_invested_usd (052:450-453, 784-786):
--        100 YES bought at 60c paid $160 instead of $100, minting money;
--     2. subtract cost basis from reserved_balance for winners AND losers
--        (052:454, 786, 823), eating the escrow of the user's open orders on
--        any market and their pending-withdrawal holds;
--     3. leave the market's resting orders live, so their escrow and share
--        reservations stay locked forever on a dead market;
--     4. in the simplex resolver, pay by option and ignore side (wrong holders
--        paid on a CLOB book) and key ledger rows by (market, user), so a user
--        with two positions aborts the whole resolution;
--     5. insert notifications under the admin's JWT without the 062 opt-in, so
--        every admin-console resolution with a winner fails with P0121;
--     6. overwrite realized P&L / payout history instead of accumulating.
--   cancel_market refunds cost basis, which is not collateral-backed once
--   shares have traded on the secondary book (a seller already received the
--   buyer's cash), has no status check, and shares problem 4's key collision.
--
-- MODEL (what the engine guarantees, 046):
--   mint   = YES buy x NO buy  -> +1 YES, +1 NO, $1 of cash leaves the buyers
--   merge  = YES sell x NO sell -> -1 YES, -1 NO, $1 of cash returns to sellers
--   direct = share transfer at the maker's price
--   => per option, Sum(YES shares) == Sum(NO shares) == collateral held ($).
--   A settlement that pays YES p and NO (1-p) per share (0<=p<=1) pays out
--   exactly the collateral, for any p. Resolution is p in {0,1}; a void is any p.
--
-- FIX
--   _clob_release_market_orders  cancels every live order on the market and
--                                returns escrow / share reservations. It moves
--                                LEAST(order escrow, wallet reserved) so a
--                                wallet whose reserve is already short (seed
--                                data, 064) is never credited money it does not
--                                hold; shortfalls are reported, not hidden.
--   _clob_settle_market          single settlement core for every path:
--                                payout per share by (option, side), ledger key
--                                per position, cumulative P&L, wallet locks in
--                                id order, notification opt-in, and a solvency
--                                guard (P0141) that refuses to pay when
--                                Sum(YES) != Sum(NO) on any option, i.e. when
--                                positions exist that no collateral backs.
--   resolve_market / resolve_market_options / resolve_market_options_binary /
--   cancel_market                same signatures and grants; CLOB markets go
--                                through the core. resolve_market on a
--                                multi-option CLOB market is ambiguous (P0143).
--                                cancel_market refuses when positions exist
--                                (P0144) instead of paying unbacked refunds.
--   void_market                  explicit, conserving void at a YES price p
--                                (service_role only until a void policy is
--                                approved for the admin console).
--
-- Legacy AMM markets (pricing_engine='amm'): the AMM trading RPCs were dropped
-- in 035, so no AMM path can create positions today. The BTC window engine
-- still creates amm markets with no positions and resolves them through
-- resolve_market; that keeps working (status change only). An amm market WITH
-- positions raises P0142 rather than guessing AMM semantics.
--
-- Override for the solvency guard: only a trusted server session (auth.uid()
-- IS NULL) that has explicitly run `SET LOCAL app.settlement_allow_unbacked =
-- 'on'` in the same transaction. PostgREST clients cannot set GUCs.
--
-- Error codes introduced: P0141 collateral invariant violated, P0142 no
-- settlement path (amm with positions / option-less position), P0143 ambiguous
-- yes/no outcome on a multi-option market, P0144 cancel with open positions,
-- P0145 payout map missing or out of range.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Release every live order on a market (internal).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clob_release_market_orders(p_market_id uuid, p_reason text DEFAULT 'market_settled')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_o         public.clob_orders%ROWTYPE;
  v_rest      numeric(20,6);
  v_loc       numeric;
  v_move      numeric;
  v_reserved  numeric;
  v_n         integer := 0;
  v_short     numeric := 0;
  v_short_n   integer := 0;
BEGIN
  FOR v_o IN
    SELECT * FROM public.clob_orders
     WHERE market_id = p_market_id AND status IN ('open','partially_filled')
     ORDER BY id
     FOR UPDATE
  LOOP
    v_rest := v_o.size - v_o.filled;
    IF v_o.action = 'buy' THEN
      v_loc := ROUND(v_o.reserved_usd / v_o.exchange_rate_to_usd, 6);
      SELECT COALESCE(reserved_balance, 0) INTO v_reserved
        FROM public.wallets WHERE id = v_o.wallet_id FOR UPDATE;
      v_move := LEAST(v_loc, v_reserved);
      IF v_move < v_loc THEN
        v_short := v_short + (v_loc - v_move);
        v_short_n := v_short_n + 1;
      END IF;
      UPDATE public.wallets SET
        available_balance = available_balance + v_move,
        reserved_balance  = reserved_balance - v_move,
        updated_at = now()
      WHERE id = v_o.wallet_id;
    ELSE
      UPDATE public.positions SET
        reserved_shares = GREATEST(0, reserved_shares - v_rest), updated_at = now()
      WHERE user_id = v_o.user_id AND market_id = v_o.market_id
        AND market_option_id = v_o.market_option_id
        AND side = v_o.outcome_side::text::position_side;
    END IF;

    UPDATE public.clob_orders SET
      status = 'cancelled', reserved_usd = 0, updated_at = now(),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('cancel_reason', p_reason)
    WHERE id = v_o.id;
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('orders_cancelled', v_n,
                            'escrow_shortfall_local', v_short,
                            'escrow_shortfall_orders', v_short_n);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2) Settlement core (internal). p_yes_payout: {"<option_id>": p} with 0<=p<=1;
--    YES pays p per share, NO pays 1-p. Every option that has an active
--    position must be present.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._clob_settle_market(
  p_market_id          uuid,
  p_yes_payout         jsonb,
  p_final_status       public.market_status,
  p_resolver_id        uuid,
  p_notes              text,
  p_resolved_outcome   public.order_side DEFAULT NULL,
  p_winning_option_id  uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_market        public.markets%ROWTYPE;
  v_opt           RECORD;
  v_pos           RECORD;
  v_p             numeric;
  v_pps           numeric;
  v_payout_usd    numeric;
  v_payout_local  numeric;
  v_rate          numeric;
  v_after         numeric;
  v_type          public.transaction_type;
  v_release       jsonb := '{}'::jsonb;
  v_override      boolean;
  v_winners       integer := 0;
  v_losers        integer := 0;
  v_paid_usd      numeric := 0;
  v_collateral    numeric := 0;
  v_is_void       boolean := (p_final_status = 'cancelled');
BEGIN
  IF p_final_status NOT IN ('resolved','cancelled') THEN
    RAISE EXCEPTION 'Invalid settlement status %', p_final_status USING ERRCODE = 'P0145';
  END IF;

  SELECT * INTO v_market FROM public.markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001'; END IF;
  IF v_market.status NOT IN ('active','closed','disputed') THEN
    RAISE EXCEPTION 'Market cannot be settled in status: %', v_market.status USING ERRCODE = 'P0002';
  END IF;

  -- Legacy / option-less positions have no CLOB settlement semantics.
  IF EXISTS (SELECT 1 FROM public.positions
              WHERE market_id = p_market_id AND is_active AND shares > 0
                AND (v_market.pricing_engine <> 'clob'
                     OR market_option_id IS NULL OR side IS NULL)) THEN
    RAISE EXCEPTION 'Market % has positions with no CLOB settlement path (engine %)',
      p_market_id, v_market.pricing_engine USING ERRCODE = 'P0142';
  END IF;

  -- Payout map must cover every option carrying an active position, in [0,1].
  FOR v_opt IN
    SELECT DISTINCT market_option_id AS id FROM public.positions
     WHERE market_id = p_market_id AND is_active AND shares > 0
  LOOP
    IF p_yes_payout IS NULL OR NOT (p_yes_payout ? v_opt.id::text) THEN
      RAISE EXCEPTION 'No settlement price for option %', v_opt.id USING ERRCODE = 'P0145';
    END IF;
    v_p := (p_yes_payout ->> v_opt.id::text)::numeric;
    IF v_p IS NULL OR v_p < 0 OR v_p > 1 THEN
      RAISE EXCEPTION 'Settlement price for option % must be within [0,1], got %', v_opt.id, v_p
        USING ERRCODE = 'P0145';
    END IF;
  END LOOP;

  -- Solvency guard: pay only what collateral backs (Sum YES == Sum NO per option).
  v_override := auth.uid() IS NULL
            AND COALESCE(current_setting('app.settlement_allow_unbacked', true), '') = 'on';
  FOR v_opt IN
    SELECT market_option_id AS id,
           COALESCE(SUM(shares) FILTER (WHERE side = 'yes'), 0) AS yes_sh,
           COALESCE(SUM(shares) FILTER (WHERE side = 'no'),  0) AS no_sh
      FROM public.positions
     WHERE market_id = p_market_id AND is_active AND shares > 0
     GROUP BY market_option_id
  LOOP
    v_collateral := v_collateral + LEAST(v_opt.yes_sh, v_opt.no_sh);
    IF abs(v_opt.yes_sh - v_opt.no_sh) > 0.000001 AND NOT v_override THEN
      RAISE EXCEPTION 'Collateral invariant violated on option %: YES % vs NO % shares; refusing unbacked payout',
        v_opt.id, v_opt.yes_sh, v_opt.no_sh USING ERRCODE = 'P0141';
    END IF;
  END LOOP;

  -- Deterministic lock order (by wallet id) on every wallet this settlement
  -- touches: holders of live orders and holders of active positions. Taking
  -- them all up front, in one order, narrows the deadlock window against
  -- concurrent trading on other markets; a deadlock still aborts atomically.
  PERFORM 1 FROM public.wallets
   WHERE id IN (SELECT wallet_id FROM public.clob_orders
                 WHERE market_id = p_market_id AND status IN ('open','partially_filled')
                UNION
                SELECT wallet_id FROM public.positions
                 WHERE market_id = p_market_id AND is_active AND shares > 0)
   ORDER BY id FOR UPDATE;

  -- Close the book: cancel every live order, return escrow / reservations.
  v_release := public._clob_release_market_orders(p_market_id,
                 CASE WHEN v_is_void THEN 'market_voided' ELSE 'market_resolved' END);

  UPDATE public.markets SET
    status            = p_final_status,
    resolved_outcome  = COALESCE(p_resolved_outcome, resolved_outcome),
    resolved_option_id= COALESCE(p_winning_option_id, resolved_option_id),
    resolved_at       = CASE WHEN v_is_void THEN resolved_at ELSE now() END,
    resolver_id       = COALESCE(p_resolver_id, resolver_id),
    resolution_notes  = p_notes,
    updated_at        = now()
  WHERE id = p_market_id;

  IF NOT v_is_void AND p_yes_payout IS NOT NULL THEN
    UPDATE public.market_options o SET
      is_winner  = ((p_yes_payout ->> o.id::text)::numeric = 1),
      updated_at = now()
    WHERE o.market_id = p_market_id AND p_yes_payout ? o.id::text;
  END IF;

  -- Trusted internal notification insert (062 guard opt-in, transaction-local).
  PERFORM set_config('app.internal_notify', 'on', true);

  FOR v_pos IN
    SELECT p.*, w.currency
      FROM public.positions p
      JOIN public.wallets w ON w.id = p.wallet_id
     WHERE p.market_id = p_market_id AND p.is_active AND p.shares > 0
     ORDER BY p.id
  LOOP
    v_p   := (p_yes_payout ->> v_pos.market_option_id::text)::numeric;
    v_pps := CASE WHEN v_pos.side = 'yes' THEN v_p ELSE 1 - v_p END;
    v_payout_usd := ROUND(v_pos.shares * v_pps, 6);

    SELECT rate INTO v_rate FROM public.exchange_rates
     WHERE from_currency = v_pos.currency AND to_currency = 'USD';
    IF v_rate IS NULL OR v_rate <= 0 THEN
      RAISE EXCEPTION 'No USD rate for %', v_pos.currency USING ERRCODE = 'P0003';
    END IF;
    v_payout_local := ROUND(v_payout_usd / v_rate, 6);

    UPDATE public.wallets SET
      available_balance = available_balance + v_payout_local,
      total_won  = COALESCE(total_won, 0)  + CASE WHEN v_payout_usd > 0 THEN v_payout_usd ELSE 0 END,
      total_lost = COALESCE(total_lost, 0) + GREATEST(0, COALESCE(v_pos.total_invested_usd, 0) - v_payout_usd),
      updated_at = now()
    WHERE id = v_pos.wallet_id
    RETURNING available_balance INTO v_after;

    UPDATE public.positions SET
      is_active          = FALSE,
      reserved_shares    = 0,
      realized_pnl_usd   = COALESCE(realized_pnl_usd, 0) + v_payout_usd - COALESCE(total_invested_usd, 0),
      total_payout_usd   = COALESCE(total_payout_usd, 0) + v_payout_usd,
      current_value_usd  = 0,
      unrealized_pnl_usd = 0,
      claimed_at         = now(),
      updated_at         = now()
    WHERE id = v_pos.id;

    v_type := CASE WHEN v_is_void THEN 'bet_refunded'
                   WHEN v_payout_usd > 0 THEN 'bet_won'
                   ELSE 'bet_lost' END;

    INSERT INTO public.transactions (
      user_id, wallet_id, type, status, amount, currency, amount_usd, exchange_rate_to_usd,
      balance_before, balance_after, market_id, market_option_id, description, idempotency_key,
      payment_metadata
    ) VALUES (
      v_pos.user_id, v_pos.wallet_id, v_type, 'completed',
      v_payout_local, v_pos.currency, v_payout_usd, v_rate,
      v_after - v_payout_local, v_after, p_market_id, v_pos.market_option_id,
      FORMAT('%s %s: %s (%s sh @ %s)',
             CASE WHEN v_is_void THEN 'Void' WHEN v_payout_usd > 0 THEN 'Won' ELSE 'Lost' END,
             UPPER(v_pos.side::text), v_market.title, v_pos.shares, v_pps),
      FORMAT('settle_%s', v_pos.id),
      jsonb_build_object('engine', 'clob', 'settlement', CASE WHEN v_is_void THEN 'void' ELSE 'resolution' END,
                         'position_id', v_pos.id, 'payout_per_share', v_pps)
    );

    IF v_payout_usd > 0 THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        v_pos.user_id,
        CASE WHEN v_is_void THEN 'market_resolved' ELSE 'bet_won' END::public.notification_type,
        CASE WHEN v_is_void THEN 'Market voided' ELSE 'You won!' END,
        FORMAT('Your %s position on "%s" settled at %s USD per share: +%s USD',
               UPPER(v_pos.side::text), v_market.title, v_pps, ROUND(v_payout_usd, 2)),
        jsonb_build_object('market_id', p_market_id, 'option_id', v_pos.market_option_id,
                           'side', v_pos.side, 'payout_usd', v_payout_usd,
                           'payout_local', v_payout_local, 'currency', v_pos.currency)
      );
      v_winners := v_winners + 1;
    ELSE
      v_losers := v_losers + 1;
    END IF;
    v_paid_usd := v_paid_usd + v_payout_usd;
  END LOOP;

  -- Retire zero-share rows that were still flagged active.
  UPDATE public.positions SET
    is_active = FALSE, reserved_shares = 0, current_value_usd = 0, updated_at = now()
  WHERE market_id = p_market_id AND is_active AND shares <= 0;

  RETURN jsonb_build_object(
    'success', TRUE, 'market_id', p_market_id, 'status', p_final_status,
    'winning_option_id', p_winning_option_id, 'resolved_outcome', p_resolved_outcome,
    'winners', v_winners, 'losers', v_losers,
    'total_paid_out_usd', v_paid_usd, 'collateral_usd', v_collateral,
    'unbacked_override', v_override, 'orders', v_release);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3) Public entry points (same signatures; grants preserved by CREATE OR REPLACE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_market(p_market_id uuid, p_outcome order_side, p_resolver_id uuid, p_resolution_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_engine text;
  v_n      integer;
  v_opt    uuid;
  v_map    jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('markets:resolve') THEN
    RAISE EXCEPTION 'Not authorized (requires markets:resolve)' USING ERRCODE = 'P0121';
  END IF;
  SELECT pricing_engine INTO v_engine FROM public.markets WHERE id = p_market_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001'; END IF;

  IF v_engine = 'clob' THEN
    SELECT count(*), (array_agg(id))[1] INTO v_n, v_opt
      FROM public.market_options WHERE market_id = p_market_id;
    IF v_n > 1 THEN
      RAISE EXCEPTION 'Market has % options; resolve it with a winning option, not a yes/no outcome', v_n
        USING ERRCODE = 'P0143';
    ELSIF v_n = 1 THEN
      v_map := jsonb_build_object(v_opt::text, CASE WHEN p_outcome = 'yes' THEN 1 ELSE 0 END);
    END IF;
  END IF;

  RETURN public._clob_settle_market(p_market_id, v_map, 'resolved', p_resolver_id,
                                    p_resolution_notes, p_outcome, NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_market_options(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_map jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('markets:resolve') THEN
    RAISE EXCEPTION 'Not authorized (requires markets:resolve)' USING ERRCODE = 'P0121';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.market_options WHERE id = p_winning_option_id AND market_id = p_market_id) THEN
    RAISE EXCEPTION 'Winning option not found for market' USING ERRCODE = 'P0007';
  END IF;
  -- On a CLOB book every option carries YES and NO lines, so settlement is by
  -- (option, side) regardless of options_pricing_mode.
  SELECT jsonb_object_agg(id::text, CASE WHEN id = p_winning_option_id THEN 1 ELSE 0 END)
    INTO v_map FROM public.market_options WHERE market_id = p_market_id;
  RETURN public._clob_settle_market(p_market_id, v_map, 'resolved', p_resolver_id,
                                    p_resolution_notes, NULL, p_winning_option_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_market_options_binary(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Identical settlement to resolve_market_options on a CLOB book; kept as a
  -- separate entry point because the API routes select it by pricing mode.
  RETURN public.resolve_market_options(p_market_id, p_winning_option_id, p_resolver_id, p_resolution_notes);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_market(p_market_id uuid, p_reason text DEFAULT 'Market cancelled'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_market  public.markets%ROWTYPE;
  v_release jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('markets:cancel') THEN
    RAISE EXCEPTION 'Not authorized (requires markets:cancel)' USING ERRCODE = 'P0121';
  END IF;
  SELECT * INTO v_market FROM public.markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001'; END IF;
  IF v_market.status IN ('resolved','cancelled') THEN
    RAISE EXCEPTION 'Market cannot be cancelled in status: %', v_market.status USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.positions WHERE market_id = p_market_id AND is_active AND shares > 0) THEN
    RAISE EXCEPTION 'Market has open positions: a cost-basis refund is not backed by collateral. Settle it with void_market(market, yes_price, reason).'
      USING ERRCODE = 'P0144';
  END IF;

  v_release := public._clob_release_market_orders(p_market_id, 'market_cancelled');
  UPDATE public.markets SET status = 'cancelled', resolution_notes = p_reason, updated_at = now()
   WHERE id = p_market_id;

  RETURN jsonb_build_object('success', TRUE, 'market_id', p_market_id,
                            'refunded_users', 0, 'total_refunded_usd', 0, 'orders', v_release);
END;
$function$;

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
  RETURN public._clob_settle_market(p_market_id, v_map, 'cancelled', NULL, p_reason, NULL, NULL);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) Grants. Internal helpers: owner only. void_market: service_role only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._clob_release_market_orders(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._clob_settle_market(uuid, jsonb, public.market_status, uuid, text, public.order_side, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.void_market(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_market(uuid, numeric, text) TO service_role;

COMMIT;
