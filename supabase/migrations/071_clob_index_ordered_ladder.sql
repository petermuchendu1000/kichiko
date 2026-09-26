-- 071_clob_index_ordered_ladder.sql
-- ---------------------------------------------------------------------------
-- Matching-engine performance: index-ordered unified ladder + HOT-eligible
-- position updates. Behaviour-preserving (same makers, same order, same fills).
--
-- MEASURED PROBLEM (local Supabase PG 17.6 replica, scripts/ops/clob/bench_engine.py)
--   1. The 046 maker ladder filters and sorts the WHOLE live book of the option
--      on every order: it orders by a computed CASE expression, so no index can
--      supply the order. EXPLAIN ANALYZE on a 4,749-order book: 5,553 heap rows
--      read, 5,247 discarded, sort, 6.4 ms, all while the market lock is held.
--      Single-client throughput fell from 414 to 263 orders/s as the book grew
--      from 60 to 3,000 resting orders.
--   2. positions updates were 6.6% HOT: every fill changes shares and
--      current_value_usd, which two indexes contain, so each fill rewrote every
--      positions index entry. (markets updates are 0% HOT for the same reason,
--      total_volume_usd; that is NOT changed here, see the KEPT note below.)
--
-- FIX
--   * clob_orders gets two STORED generated columns: yes_px (the order's price
--     in YES terms) and book_side ('bid' = buy YES / sell NO, 'ask' = sell YES /
--     buy NO), and two partial indexes on live orders:
--        asks (market, option, yes_px ASC,  created_at ASC)
--        bids (market, option, yes_px DESC, created_at ASC)
--     A taker that is a YES-bid walks asks; a YES-ask walks bids. In the taker's
--     own price terms this is exactly the 046 order (exec ASC for buys, DESC for
--     sells, then created_at ASC) and exactly the same eligible makers (direct /
--     mint / merge). Rows are read lazily through a cursor: O(log n + fills).
--   * positions indexes that contained fill-changing columns are narrowed so
--     position updates are HOT-eligible (6.6% -> 94.2% HOT): shares dropped
--     from idx_positions_holders_board (market_top_holders windows over every
--     holder of the option anyway), idx_positions_user_active dropped
--     (redundant with idx_positions_active; its sorts are per user).
--     The markets volume indexes are deliberately KEPT: the homepage listing
--     (status='active' ORDER BY total_volume_usd DESC LIMIT 20) measured
--     4.27 ms without them vs 0.089 ms with them at 10k markets.
--
-- VERIFICATION
--   * Differential test (scripts/ops/clob/diff_engine.py): 2 x 2,500-op seeded
--     streams (limit/market, buy/sell, YES/NO, budget caps, cancels; 1c and 0.1c
--     ticks; each op its own committed transaction) through 046 and through this
--     engine: every fill (maker, price, size, kind), every order outcome, every
--     position and every wallet delta IDENTICAL (5,000/5,000 ops, 3,833 fills).
--   * fuzz_invariants (4,000 ops), test_two_sided (20/20), test_046, and
--     test_settlement (50/50) all green.
--   * Benchmarks, scripts/ops/clob/bench_engine.py, same replica and scenarios,
--     one hot market (per-market serialisation is the ceiling; local NVMe, so
--     this is DB work only, not WAN):
--        scenario                 046                 071
--        60-deep book, 1 client   414/s  p50 1.94ms   508/s  p50 1.31ms
--        3,000-deep,   1 client   263/s  p50 3.11ms   485/s  p50 1.38ms
--        3,000-deep,   8 clients  265/s  p99 74.6ms   512/s  p99 42.7ms
--     Multi-market runs on the 2-vCPU test box were CPU-bound and noisy
--     (584-862/s across all versions) and are not used as evidence.
--
-- Table rewrite: ADD COLUMN ... STORED rewrites clob_orders under an ACCESS
-- EXCLUSIVE lock (2.3k rows in production at the time of writing: sub-second).
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.clob_orders
  ADD COLUMN IF NOT EXISTS yes_px numeric(4,1)
    GENERATED ALWAYS AS (CASE WHEN outcome_side = 'yes' THEN price_cents ELSE (100 - price_cents) END) STORED;
ALTER TABLE public.clob_orders
  ADD COLUMN IF NOT EXISTS book_side text
    GENERATED ALWAYS AS (CASE WHEN (action = 'buy') = (outcome_side = 'yes') THEN 'bid' ELSE 'ask' END) STORED;

CREATE INDEX IF NOT EXISTS idx_clob_orders_asks
  ON public.clob_orders (market_id, market_option_id, yes_px ASC, created_at ASC)
  WHERE status IN ('open','partially_filled') AND book_side = 'ask';
CREATE INDEX IF NOT EXISTS idx_clob_orders_bids
  ON public.clob_orders (market_id, market_option_id, yes_px DESC, created_at ASC)
  WHERE status IN ('open','partially_filled') AND book_side = 'bid';

-- HOT-eligible position updates (no fill-changing column indexed). The markets
-- volume indexes are deliberately KEPT: without them the homepage listing
-- (status='active' ORDER BY total_volume_usd DESC LIMIT 20) measured 4.27 ms vs
-- 0.089 ms at 10k markets, a read path far hotter than trading.
DROP INDEX IF EXISTS public.idx_positions_holders_board;
CREATE INDEX idx_positions_holders_board ON public.positions (market_id, market_option_id, side) WHERE is_active = true;
DROP INDEX IF EXISTS public.idx_positions_user_active;

CREATE OR REPLACE FUNCTION public.clob_place_order(p_user_id uuid, p_market_id uuid, p_market_option_id uuid, p_outcome_side order_side, p_action clob_action, p_order_type order_type, p_price_cents numeric, p_size numeric, p_currency currency_code, p_client_order_id text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_max_spend_usd numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_market       public.markets%ROWTYPE;
  v_option       public.market_options%ROWTYPE;
  v_wallet       public.wallets%ROWTYPE;
  v_rate         numeric;
  v_comp         public.order_side := CASE WHEN p_outcome_side = 'yes' THEN 'no' ELSE 'yes' END;
  v_tick         numeric;
  v_limit_c      numeric(4,1);
  v_min_usd      numeric;
  v_avail_shares numeric(20,6);
  v_remaining    numeric(20,6);
  v_filled       numeric(20,6) := 0;
  v_cash_delta   numeric := 0;          -- taker USD: buys negative-cost accum (spent), sells proceeds accum
  v_notional     numeric := 0;          -- Sum(exec*fill)/100 traded, USD (for stats/avg)
  v_taker_order  uuid;
  v_mk           RECORD;                 -- ladder row (maker id + kind + exec)
  v_maker        public.clob_orders%ROWTYPE;
  v_maker_avail  numeric(20,6);
  v_fill         numeric(20,6);
  v_e            numeric(4,1);           -- execution price cents (on S)
  v_maker_price  numeric(4,1);           -- maker's own leg price cents
  v_taker_usd    numeric;               -- per-fill taker USD (cost if buy, proceeds if sell)
  v_maker_usd    numeric;               -- per-fill maker USD leg
  v_maker_local  numeric;
  v_last_yes     numeric(4,1);          -- YES-implied price of the last fill (for writeback)
  v_order_id     uuid;
  v_txn_id       uuid;
  v_rest         numeric(20,6);
  v_reserve_usd  numeric := 0;
  v_reserve_loc  numeric := 0;
  v_cash_local   numeric;
  v_avg_price    numeric;               -- USD per share (0..1)
  v_status       public.order_status;
  v_fills        jsonb := '[]'::jsonb;
  v_spent_usd    numeric := 0;          -- [043 #2] cumulative taker USD spent (budget cap)
  v_affordable   numeric(20,6);         -- [043 #2] shares still affordable under budget
  v_order_usd    numeric;               -- [043 #4] order notional for min-size check
  v_cur          refcursor;             -- [071] ladder cursor
  v_taker_bid    boolean;               -- [071] taker is a YES-bid (buy YES / sell NO)
  v_yes_lim      numeric(4,1);          -- [071] limit in YES-price terms
BEGIN

  -- [042 authz guard] Defense-in-depth: when invoked inside an end-user session
  -- (auth.uid() present, e.g. a direct PostgREST RPC), the caller may act ONLY
  -- as themselves. The server API calls this as service_role (auth.uid() IS
  -- NULL) and passes the JWT-verified session user as p_user_id, so it is
  -- unaffected. Combined with the REVOKE below this closes the impersonation /
  -- fund-theft vector (audit finding #1).
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not authorized to act on behalf of another user' USING ERRCODE = 'P0121';
  END IF;

  -- [046 abuse prevention] Per-user open-order caps + placement rate limit.
  -- Bounds book-flood and RPC-spam DoS vectors (audit recommendation: abuse
  -- prevention / rate limiting). Thresholds carry generous headroom over the
  -- observed legitimate ceiling (max 74 open globally, 10 per market, ~49
  -- placements / 10s during seeding) so no genuine market-maker is rejected,
  -- while a true flood (orders of magnitude higher) is stopped. Enforced only
  -- for order-creating calls (all invocations create an order here).
  IF (SELECT count(*) FROM public.clob_orders
        WHERE user_id = p_user_id
          AND status IN ('open','partially_filled')) >= 250 THEN
    RAISE EXCEPTION 'Too many open orders (max 250 per user); cancel some before placing more'
      USING ERRCODE = 'P0130';
  END IF;

  IF (SELECT count(*) FROM public.clob_orders
        WHERE user_id = p_user_id
          AND market_id = p_market_id
          AND status IN ('open','partially_filled')) >= 60 THEN
    RAISE EXCEPTION 'Too many open orders on this market (max 60 per user per market)'
      USING ERRCODE = 'P0131';
  END IF;

  IF (SELECT count(*) FROM public.clob_orders
        WHERE user_id = p_user_id
          AND created_at > now() - interval '10 seconds') >= 100 THEN
    RAISE EXCEPTION 'Order placement rate limit exceeded (max 100 per 10s); please slow down'
      USING ERRCODE = 'P0132';
  END IF;
  -- ---- validation --------------------------------------------------
  IF p_action NOT IN ('buy','sell') THEN
    RAISE EXCEPTION 'action must be buy or sell' USING ERRCODE='P0102';
  END IF;
  IF p_market_option_id IS NULL THEN
    RAISE EXCEPTION 'CLOB requires a market_option_id (per-candidate book)' USING ERRCODE='P0101';
  END IF;
  IF p_size IS NULL OR p_size <= 0 THEN
    RAISE EXCEPTION 'size must be > 0' USING ERRCODE='P0102';
  END IF;

  SELECT * INTO v_market FROM public.markets WHERE id = p_market_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found or not active' USING ERRCODE='P0001'; END IF;
  IF v_market.closes_at < now() THEN RAISE EXCEPTION 'Market is closed for betting' USING ERRCODE='P0002'; END IF;
  IF v_market.pricing_engine <> 'clob' THEN RAISE EXCEPTION 'Market is not a CLOB market' USING ERRCODE='P0103'; END IF;

  SELECT * INTO v_option FROM public.market_options
    WHERE id = p_market_option_id AND market_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Option not found for market' USING ERRCODE='P0007'; END IF;

  -- tick lattice + limit clamp (031: markets.tick_size in {0.001,0.01} => 0.1c/1c)
  v_tick := GREATEST(0.1, COALESCE(v_market.tick_size,0.001) * 100);   -- cents
  IF p_order_type = 'limit' THEN
    IF p_price_cents IS NULL THEN RAISE EXCEPTION 'limit order needs price_cents' USING ERRCODE='P0104'; END IF;
    v_limit_c := ROUND((ROUND(p_price_cents / v_tick) * v_tick)::numeric, 1);
    v_limit_c := LEAST(99.9, GREATEST(0.1, v_limit_c));
  ELSE
    v_limit_c := CASE WHEN p_action='buy' THEN 99.9 ELSE 0.1 END;  -- market: cross anything
  END IF;

  -- FX for the taker
  SELECT rate INTO v_rate FROM public.exchange_rates WHERE from_currency = p_currency AND to_currency = 'USD';
  IF NOT FOUND THEN RAISE EXCEPTION 'Unsupported currency: %', p_currency USING ERRCODE='P0003'; END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = p_user_id AND currency = p_currency FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found' USING ERRCODE='P0005'; END IF;

  -- min order size (USD notional at the limit / best price estimate)
  v_min_usd := COALESCE(v_market.min_order_size, 0);

  v_remaining := p_size;

  -- [043 #4] minimum order size (USD notional). Prevents dust-order spam;
  -- market sells are checked post-match against realized proceeds below.
  v_order_usd := CASE
    WHEN p_order_type = 'limit' THEN p_size * v_limit_c / 100.0
    WHEN p_action = 'buy'       THEN COALESCE(p_max_spend_usd, p_size * v_limit_c / 100.0)
    ELSE NULL
  END;
  IF v_min_usd > 0 AND v_order_usd IS NOT NULL AND v_order_usd < v_min_usd THEN
    RAISE EXCEPTION 'Order below minimum size (min % USD equivalent)', v_min_usd USING ERRCODE = 'P0105';
  END IF;

  -- ---- SELL: lock the position and reserve shares (I7 no over-sell) ----
  IF p_action = 'sell' THEN
    PERFORM 1 FROM public.positions
      WHERE user_id = p_user_id AND market_id = p_market_id
        AND market_option_id = p_market_option_id
        AND side = p_outcome_side::text::position_side FOR UPDATE;
    SELECT (COALESCE(shares,0) - COALESCE(reserved_shares,0)) INTO v_avail_shares
      FROM public.positions
      WHERE user_id = p_user_id AND market_id = p_market_id
        AND market_option_id = p_market_option_id
        AND side = p_outcome_side::text::position_side;
    IF v_avail_shares IS NULL OR v_avail_shares < p_size THEN
      RAISE EXCEPTION 'Not enough shares to sell (available %, requested %)',
        COALESCE(v_avail_shares,0), p_size USING ERRCODE='P0113';
    END IF;
    -- reserve the full size up-front; each fill unlocks its part as it delivers.
    UPDATE public.positions SET reserved_shares = reserved_shares + p_size, updated_at = now()
      WHERE user_id = p_user_id AND market_id = p_market_id
        AND market_option_id = p_market_option_id
        AND side = p_outcome_side::text::position_side;
  END IF;

  -- ---- create the taker order row (for fill FK) --------------------
  INSERT INTO public.clob_orders (
    market_id, market_option_id, user_id, wallet_id, outcome_side, action,
    order_type, price_cents, size, filled, status, currency, exchange_rate_to_usd,
    reserved_usd, client_order_id, expires_at, metadata
  ) VALUES (
    p_market_id, p_market_option_id, p_user_id, v_wallet.id, p_outcome_side, p_action,
    p_order_type, CASE WHEN p_order_type='limit' THEN v_limit_c ELSE NULL END,
    p_size, 0, 'open', p_currency, v_rate,
    0, p_client_order_id, p_expires_at, jsonb_build_object('engine','clob')
  ) RETURNING id INTO v_taker_order;

  -- ---- unified ladder in price-time priority ----------------------
  --  BUY  S: asks = SELL S (direct @ a) UNION BUY C (mint @ 100-q); e ASC, e<=limit
  --  SELL S: bids = BUY  S (direct @ b) UNION SELL C (merge @ 100-a); e DESC, e>=limit
  -- [071] Index-ordered unified ladder. Every live order carries a YES-
  -- perspective price (yes_px) and book side (bid = buy YES / sell NO,
  -- ask = sell YES / buy NO). A taker that is a YES-bid walks asks by
  -- (yes_px ASC, created_at ASC); a YES-ask walks bids by (yes_px DESC,
  -- created_at ASC). Same makers, same order as the 046 ladder, but read
  -- lazily from a partial index: O(log n + fills) instead of O(book) + sort.
  v_taker_bid := (p_action = 'buy') = (p_outcome_side = 'yes');
  v_yes_lim   := CASE WHEN p_outcome_side = 'yes' THEN v_limit_c ELSE (100 - v_limit_c)::numeric(4,1) END;
  IF v_taker_bid THEN
    OPEN v_cur FOR
      SELECT id,
             CASE WHEN outcome_side = p_outcome_side THEN 'direct'
                  WHEN p_action='buy' THEN 'mint' ELSE 'burn' END AS kind,
             CASE WHEN outcome_side = p_outcome_side THEN price_cents
                  ELSE (100 - price_cents)::numeric(4,1) END AS exec,
             created_at
        FROM public.clob_orders
       WHERE market_id = p_market_id AND market_option_id = p_market_option_id
         AND status IN ('open','partially_filled') AND book_side = 'ask'
         AND yes_px <= v_yes_lim
         AND user_id <> p_user_id                          -- I4 self-trade prevention
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY yes_px ASC, created_at ASC;
  ELSE
    OPEN v_cur FOR
      SELECT id,
             CASE WHEN outcome_side = p_outcome_side THEN 'direct'
                  WHEN p_action='buy' THEN 'mint' ELSE 'burn' END AS kind,
             CASE WHEN outcome_side = p_outcome_side THEN price_cents
                  ELSE (100 - price_cents)::numeric(4,1) END AS exec,
             created_at
        FROM public.clob_orders
       WHERE market_id = p_market_id AND market_option_id = p_market_option_id
         AND status IN ('open','partially_filled') AND book_side = 'bid'
         AND yes_px >= v_yes_lim
         AND user_id <> p_user_id                          -- I4 self-trade prevention
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY yes_px DESC, created_at ASC;
  END IF;
  LOOP
    FETCH v_cur INTO v_mk;
    EXIT WHEN NOT FOUND;
    EXIT WHEN v_remaining <= 0;

    SELECT * INTO v_maker FROM public.clob_orders WHERE id = v_mk.id FOR UPDATE;
    IF v_maker.status NOT IN ('open','partially_filled') THEN CONTINUE; END IF;
    v_maker_avail := v_maker.size - v_maker.filled;
    IF v_maker_avail <= 0 THEN CONTINUE; END IF;

    v_fill       := LEAST(v_remaining, v_maker_avail);
    v_e          := v_mk.exec;                 -- taker execution price on S (cents)
    v_maker_price:= v_maker.price_cents;       -- maker's own leg price (cents)
    v_maker_local:= NULL;

    -- [043 #2] budget cap: a BUY with an explicit USD budget never overspends.
    -- Trim this fill to what the remaining budget affords at v_e; stop when spent.
    IF p_action = 'buy' AND p_max_spend_usd IS NOT NULL THEN
      v_affordable := FLOOR( ((p_max_spend_usd - v_spent_usd) / (v_e / 100.0)) * 1e6 ) / 1e6;
      IF v_affordable <= 0 THEN EXIT; END IF;
      v_fill := LEAST(v_fill, v_affordable);
      IF v_fill <= 0 THEN EXIT; END IF;
    END IF;

    -- advance maker order (filled + status); escrow release depends on kind.
    UPDATE public.clob_orders SET
      filled = filled + v_fill,
      status = (CASE WHEN (filled + v_fill) >= size THEN 'filled' ELSE 'partially_filled' END)::public.order_status,
      updated_at = now()
    WHERE id = v_maker.id;

    IF p_action = 'buy' THEN
      -- taker BUYS S @ v_e
      v_taker_usd := ROUND(v_fill * v_e / 100.0, 8);
      v_spent_usd := v_spent_usd + v_taker_usd;   -- [043 #2] track budget consumption
      IF v_mk.kind = 'direct' THEN
        -- maker SELL S delivers shares, receives v_e; release maker's reserved shares
        v_maker_usd := v_taker_usd;
        UPDATE public.positions SET
          shares = shares - v_fill,
          total_invested_usd = GREATEST(0, COALESCE(total_invested_usd,0) - v_fill * COALESCE(avg_entry_price,0)),  -- [043 #3] reduce cost basis on sale
          reserved_shares = GREATEST(0, reserved_shares - v_fill),
          realized_pnl_usd = COALESCE(realized_pnl_usd,0) + (v_e/100.0 - COALESCE(avg_entry_price,0)) * v_fill,
          total_payout_usd = COALESCE(total_payout_usd,0) + v_maker_usd,
          current_value_usd = GREATEST(0, (shares - v_fill)) * (v_e/100.0),
          is_active = (shares - v_fill) > 0, updated_at = now()
        WHERE user_id = v_maker.user_id AND market_id = p_market_id
          AND market_option_id = p_market_option_id AND side = p_outcome_side::text::position_side;
        v_maker_local := ROUND(v_maker_usd / v_maker.exchange_rate_to_usd, 6);
        UPDATE public.wallets SET available_balance = available_balance + v_maker_local, updated_at = now()
          WHERE id = v_maker.wallet_id;
      ELSE
        -- MINT: maker BUY C @ q spends escrow q, receives C shares
        v_maker_usd := ROUND(v_fill * v_maker_price / 100.0, 8);
        v_maker_local := ROUND(v_maker_usd / v_maker.exchange_rate_to_usd, 6);
        UPDATE public.clob_orders SET reserved_usd = GREATEST(0, reserved_usd - v_maker_usd) WHERE id = v_maker.id;
        UPDATE public.wallets SET reserved_balance = GREATEST(0, reserved_balance - v_maker_local), updated_at = now()
          WHERE id = v_maker.wallet_id;
        INSERT INTO public.positions (
          user_id, market_id, wallet_id, market_option_id, side, shares,
          total_invested_usd, avg_entry_price, current_value_usd
        ) VALUES (
          v_maker.user_id, p_market_id, v_maker.wallet_id, p_market_option_id,
          v_comp::text::position_side, v_fill, v_maker_usd, ROUND(v_maker_price/100.0,6),
          v_fill * (v_maker_price/100.0))
        ON CONFLICT (user_id, market_id, market_option_id, side)
          WHERE market_option_id IS NOT NULL AND side IS NOT NULL
        DO UPDATE SET
          shares = public.positions.shares + v_fill,
          total_invested_usd = public.positions.total_invested_usd + v_maker_usd,
          avg_entry_price = (public.positions.total_invested_usd + v_maker_usd)
                            / NULLIF(public.positions.shares + v_fill, 0),
          current_value_usd = (public.positions.shares + v_fill) * (v_maker_price/100.0),
          is_active = TRUE, updated_at = now();
      END IF;
      v_cash_delta := v_cash_delta - v_taker_usd;    -- taker spends

    ELSE
      -- taker SELLS S @ v_e : delivers S shares, receives v_e
      v_taker_usd := ROUND(v_fill * v_e / 100.0, 8);
      IF v_mk.kind = 'direct' THEN
        -- maker BUY S spends escrow (their bid price), receives S shares
        v_maker_usd := ROUND(v_fill * v_maker_price / 100.0, 8);   -- == v_taker_usd (e==maker bid)
        v_maker_local := ROUND(v_maker_usd / v_maker.exchange_rate_to_usd, 6);
        UPDATE public.clob_orders SET reserved_usd = GREATEST(0, reserved_usd - v_maker_usd) WHERE id = v_maker.id;
        UPDATE public.wallets SET reserved_balance = GREATEST(0, reserved_balance - v_maker_local), updated_at = now()
          WHERE id = v_maker.wallet_id;
        INSERT INTO public.positions (
          user_id, market_id, wallet_id, market_option_id, side, shares,
          total_invested_usd, avg_entry_price, current_value_usd
        ) VALUES (
          v_maker.user_id, p_market_id, v_maker.wallet_id, p_market_option_id,
          p_outcome_side::text::position_side, v_fill, v_maker_usd, ROUND(v_maker_price/100.0,6),
          v_fill * (v_maker_price/100.0))
        ON CONFLICT (user_id, market_id, market_option_id, side)
          WHERE market_option_id IS NOT NULL AND side IS NOT NULL
        DO UPDATE SET
          shares = public.positions.shares + v_fill,
          total_invested_usd = public.positions.total_invested_usd + v_maker_usd,
          avg_entry_price = (public.positions.total_invested_usd + v_maker_usd)
                            / NULLIF(public.positions.shares + v_fill, 0),
          current_value_usd = (public.positions.shares + v_fill) * (v_maker_price/100.0),
          is_active = TRUE, updated_at = now();
      ELSE
        -- MERGE: maker SELL C @ a delivers C shares, receives a; S+C burn -> $1
        v_maker_usd := ROUND(v_fill * v_maker_price / 100.0, 8);   -- a/100*f
        v_maker_local := ROUND(v_maker_usd / v_maker.exchange_rate_to_usd, 6);
        UPDATE public.positions SET
          shares = shares - v_fill,
          total_invested_usd = GREATEST(0, COALESCE(total_invested_usd,0) - v_fill * COALESCE(avg_entry_price,0)),  -- [043 #3] reduce cost basis on sale
          reserved_shares = GREATEST(0, reserved_shares - v_fill),
          realized_pnl_usd = COALESCE(realized_pnl_usd,0) + (v_maker_price/100.0 - COALESCE(avg_entry_price,0)) * v_fill,
          total_payout_usd = COALESCE(total_payout_usd,0) + v_maker_usd,
          current_value_usd = GREATEST(0,(shares - v_fill)) * (v_maker_price/100.0),
          is_active = (shares - v_fill) > 0, updated_at = now()
        WHERE user_id = v_maker.user_id AND market_id = p_market_id
          AND market_option_id = p_market_option_id AND side = v_comp::text::position_side;
        UPDATE public.wallets SET available_balance = available_balance + v_maker_local, updated_at = now()
          WHERE id = v_maker.wallet_id;
      END IF;
      -- taker delivers S shares (reserved) and collects proceeds
      UPDATE public.positions SET
        shares = shares - v_fill,
        total_invested_usd = GREATEST(0, COALESCE(total_invested_usd,0) - v_fill * COALESCE(avg_entry_price,0)),  -- [043 #3] reduce cost basis on sale
        reserved_shares = GREATEST(0, reserved_shares - v_fill),
        realized_pnl_usd = COALESCE(realized_pnl_usd,0) + (v_e/100.0 - COALESCE(avg_entry_price,0)) * v_fill,
        total_payout_usd = COALESCE(total_payout_usd,0) + v_taker_usd,
        current_value_usd = GREATEST(0,(shares - v_fill)) * (v_e/100.0),
        is_active = (shares - v_fill) > 0, updated_at = now()
      WHERE user_id = p_user_id AND market_id = p_market_id
        AND market_option_id = p_market_option_id AND side = p_outcome_side::text::position_side;
      v_cash_delta := v_cash_delta + v_taker_usd;    -- taker receives
    END IF;

    -- maker transaction (audit)
    INSERT INTO public.transactions (
      user_id, wallet_id, type, status, amount, currency, amount_usd,
      exchange_rate_to_usd, balance_before, balance_after, market_id,
      market_option_id, description, idempotency_key, payment_metadata
    ) VALUES (
      v_maker.user_id, v_maker.wallet_id,
      (CASE WHEN v_maker.action='buy' THEN 'bet_placed' ELSE 'bet_refunded' END)::public.transaction_type, 'completed'::public.transaction_status,
      COALESCE(v_maker_local,0), v_maker.currency, COALESCE(v_maker_usd,0), v_maker.exchange_rate_to_usd,
      0, 0, p_market_id, p_market_option_id,
      FORMAT('CLOB %s maker %s @ %s¢ (%s sh)', v_mk.kind, UPPER(v_maker.outcome_side::text), v_maker_price, v_fill),
      FORMAT('clob_mk_%s_%s', v_maker.id, gen_random_uuid()),
      jsonb_build_object('clob_order_id', v_maker.id, 'engine','clob','role','maker','match_kind', v_mk.kind)
    );

    -- fill print (taker perspective) + YES-implied last price
    INSERT INTO public.clob_fills (
      market_id, market_option_id, outcome_side, price_cents, size, match_kind,
      taker_order_id, maker_order_id, taker_user_id, maker_user_id
    ) VALUES (
      p_market_id, p_market_option_id, p_outcome_side, v_e, v_fill, v_mk.kind,
      v_taker_order, v_maker.id, p_user_id, v_maker.user_id
    );
    v_last_yes := CASE WHEN p_outcome_side='yes' THEN v_e ELSE (100 - v_e)::numeric(4,1) END;
    v_fills := v_fills || jsonb_build_object('price_cents', v_e, 'size', v_fill, 'match_kind', v_mk.kind, 'maker_order_id', v_maker.id);

    v_notional  := v_notional + v_taker_usd;
    v_filled    := v_filled + v_fill;
    v_remaining := v_remaining - v_fill;
  END LOOP;
  CLOSE v_cur;

  -- ---- taker settlement -------------------------------------------
  v_rest := CASE WHEN p_order_type='limit' THEN v_remaining ELSE 0 END;

  IF p_action = 'buy' THEN
    -- cash: spend filled cost + escrow the resting remainder
    v_reserve_usd := ROUND(v_rest * v_limit_c / 100.0, 8);
    v_cash_local  := ROUND((-v_cash_delta) / v_rate, 6);     -- spent (>=0)
    v_reserve_loc := ROUND(v_reserve_usd / v_rate, 6);
    IF v_wallet.available_balance < (v_cash_local + v_reserve_loc) THEN
      RAISE EXCEPTION 'Insufficient balance. Available: %, Required: %',
        v_wallet.available_balance, (v_cash_local + v_reserve_loc) USING ERRCODE='P0006';
    END IF;
    UPDATE public.wallets SET
      available_balance = available_balance - v_cash_local - v_reserve_loc,
      reserved_balance  = reserved_balance + v_reserve_loc, updated_at = now()
    WHERE id = v_wallet.id;

    IF v_filled > 0 THEN
      v_avg_price := v_notional / v_filled;             -- USD/share
      INSERT INTO public.positions (
        user_id, market_id, wallet_id, market_option_id, side, shares,
        total_invested_usd, avg_entry_price, current_value_usd
      ) VALUES (
        p_user_id, p_market_id, v_wallet.id, p_market_option_id,
        p_outcome_side::text::position_side, v_filled, v_notional, ROUND(v_avg_price,6),
        v_filled * v_avg_price)
      ON CONFLICT (user_id, market_id, market_option_id, side)
        WHERE market_option_id IS NOT NULL AND side IS NOT NULL
      DO UPDATE SET
        shares = public.positions.shares + v_filled,
        total_invested_usd = public.positions.total_invested_usd + v_notional,
        avg_entry_price = (public.positions.total_invested_usd + v_notional)
                          / NULLIF(public.positions.shares + v_filled, 0),
        current_value_usd = (public.positions.shares + v_filled) * ROUND(v_avg_price,6),
        is_active = TRUE, updated_at = now();
    END IF;
  ELSE
    -- SELL: credit proceeds; release the unfilled reserved shares for market orders
    v_cash_local := ROUND(v_cash_delta / v_rate, 6);        -- proceeds (>=0)
    UPDATE public.wallets SET available_balance = available_balance + v_cash_local, updated_at = now()
      WHERE id = v_wallet.id;
    IF v_rest = 0 AND (p_size - v_filled) > 0 THEN
      -- market sell remainder dropped: release its share reservation
      UPDATE public.positions SET reserved_shares = GREATEST(0, reserved_shares - (p_size - v_filled)), updated_at = now()
        WHERE user_id = p_user_id AND market_id = p_market_id
          AND market_option_id = p_market_option_id AND side = p_outcome_side::text::position_side;
    END IF;
    IF v_filled > 0 THEN v_avg_price := v_notional / v_filled; END IF;
    -- [043 #4] market-sell dust guard (proceeds-based, post-match).
    IF v_min_usd > 0 AND v_filled > 0 AND v_notional < v_min_usd THEN
      RAISE EXCEPTION 'Order below minimum size (min % USD equivalent)', v_min_usd USING ERRCODE = 'P0105';
    END IF;
  END IF;

  -- final taker order status
  IF v_rest > 0 THEN
    v_status := CASE WHEN v_filled > 0 THEN 'partially_filled' ELSE 'open' END;
  ELSE
    v_status := CASE WHEN v_filled > 0 THEN 'filled' ELSE 'cancelled' END;
  END IF;
  UPDATE public.clob_orders SET
    filled = v_filled, status = v_status, reserved_usd = CASE WHEN p_action='buy' THEN v_reserve_usd ELSE 0 END,
    updated_at = now()
  WHERE id = v_taker_order RETURNING id INTO v_order_id;

  -- taker transaction (audit)
  IF v_cash_local IS NOT NULL AND v_cash_local <> 0 THEN
    INSERT INTO public.transactions (
      user_id, wallet_id, type, status, amount, currency, amount_usd,
      exchange_rate_to_usd, balance_before, balance_after, market_id,
      market_option_id, description, idempotency_key, payment_metadata
    ) VALUES (
      p_user_id, v_wallet.id,
      (CASE WHEN p_action='buy' THEN 'bet_placed' ELSE 'bet_refunded' END)::public.transaction_type, 'completed'::public.transaction_status,
      v_cash_local, p_currency, ABS(v_notional), v_rate, 0, 0, p_market_id, p_market_option_id,
      FORMAT('CLOB %s %s %s (%s sh @ avg %s¢)', UPPER(p_action::text), UPPER(p_outcome_side::text),
             v_option.label, v_filled, ROUND(COALESCE(v_avg_price,0)*100,1)),
      COALESCE(p_client_order_id, FORMAT('clob_%s', v_order_id)),
      jsonb_build_object('clob_order_id', v_order_id, 'engine','clob','role','taker','action',p_action)
    ) RETURNING id INTO v_txn_id;
  END IF;

  -- market stats + price history + activity + live option price writeback
  IF v_filled > 0 THEN
    UPDATE public.markets SET
      total_volume_usd = total_volume_usd + v_notional, total_bets = total_bets + 1,
      last_trade_at = now(), updated_at = now()
    WHERE id = p_market_id;
    UPDATE public.market_options SET
      volume_usd = COALESCE(volume_usd,0) + v_notional,
      yes_price = ROUND(v_last_yes/100.0, 6),
      no_price  = ROUND((100 - v_last_yes)/100.0, 6),
      price     = ROUND(v_last_yes/100.0, 6),
      updated_at = now()
    WHERE id = p_market_option_id;
    INSERT INTO public.price_history (market_id, market_option_id, price, volume_usd)
    VALUES (p_market_id, p_market_option_id, ROUND(v_last_yes/100.0,6), v_notional);
    INSERT INTO public.market_activity (market_id, user_id, market_option_id, action, amount_usd, side, price)
    VALUES (p_market_id, p_user_id, p_market_option_id,
            CASE WHEN p_outcome_side='yes' THEN 'bet_yes' ELSE 'bet_no' END,
            v_notional, p_outcome_side, ROUND(v_e/100.0,6));
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE, 'order_id', v_order_id, 'transaction_id', v_txn_id, 'status', v_status,
    'action', p_action, 'filled_shares', v_filled, 'resting_shares', v_rest,
    'avg_fill_price_cents', CASE WHEN v_filled>0 THEN ROUND(v_avg_price*100,1) ELSE NULL END,
    'notional_usd', ROUND(v_notional,6), 'cash_local', v_cash_local, 'fills', v_fills
  );
END;
$function$;

COMMIT;
