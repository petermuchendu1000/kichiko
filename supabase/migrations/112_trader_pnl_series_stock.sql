-- 112_trader_pnl_series_stock.sql
-- ---------------------------------------------------------------------------
-- trader_pnl_series(): plot a STOCK on a grid, not a sum of whatever ticked.
--
-- WHAT WAS WRONG (measured 2026-10-16, user d73c23c4…, YTD)
-- The 026 version was:
--
--     SELECT date_trunc('hour', ph.recorded_at) AS bucket, SUM(shares * price)
--     FROM held JOIN price_history ph ON ph.market_id = held.market_id
--     GROUP BY bucket
--
-- which sums over price_history ROWS, inside hours that happen to contain
-- rows. Two independent errors, pulling in opposite directions:
--
--   1. MULTIPLICITY. A position is counted once per snapshot row in the hour.
--      Measured: up to 7 rows per (market, option, hour); mean 1.18.
--   2. PARTIAL COVERAGE. A position whose market did not tick in that hour
--      contributes ZERO instead of its last known value. The tallest bucket in
--      the trader's whole YTD series — KSh 152,513 — was 4 of their 32
--      positions, joined to 28 rows. The shortest, KSh 74, was one position.
--
-- So the curve was not portfolio value. It was a chart of how many of the
-- trader's markets the ingestion cron happened to sweep in each hour, scaled
-- by price. Consecutive YTD points read 2,141 → 1,066 → 4,228 → 74 → 76,434
-- on a book whose true value is KSh 30,730 and whose cost basis is KSh 32,837.
-- The last point — what the card's headline printed — was off by 14x, and the
-- series maximum was 5x a book that never cost more than 33k.
--
-- A third defect, latent only because no position currently holds a NULL
-- market_option_id: `(h.market_option_id IS NULL OR ph.market_option_id =
-- h.market_option_id)` makes a binary position join EVERY per-option row of
-- its market. On a 5-candidate market that is a 5x inflation waiting for the
-- first binary position. Closed here with IS NOT DISTINCT FROM.
--
-- A fourth: `win.step` was computed (1 hour / 6 hours / 1 day) and then never
-- referenced. Every range was bucketed hourly, which is why ALL and YTD
-- returned 624 points into a 448px-wide chart — 0.72px per point, below the
-- resolution of the display.
--
-- HOW POLYMARKET DOES IT (measured against data-api.polymarket.com/v2/user-pnl)
--   interval=1d   → 24 points,     fidelity 1h, gaps uniformly 3600s
--   interval=1w   → 168 points,    fidelity 1h, gaps uniformly 3600s
--   interval=1m   → 720 points,    fidelity 1h, 52% repeat the previous value
--   interval=all  → 41,526 points, fidelity 1h, 95% repeat the previous value
--
-- Every bucket is present. Nothing is missing because nothing happened: 95% of
-- the all-time series is the previous value carried forward. That is what
-- makes their line continuous, and it is the thing we were not doing. A
-- portfolio's value is a stock — it exists between trades.
--
-- WHAT THIS VERSION DOES
--   • Generates a complete bucket grid over the range, using a step that is
--     actually applied, and bounded so no range exceeds ~400 points.
--   • Takes ONE price per (position, bucket) — the last tick at or before it —
--     and carries it forward across empty buckets (LOCF, via the standard
--     count()-as-group-id trick, Postgres having no IGNORE NULLS).
--   • Counts a position only from positions.created_at onward, so the book is
--     not back-projected onto months it did not exist in.
--   • Returns cost_usd alongside value_usd, from avg_entry_price x shares, as
--     of the same bucket. This closes matrix item M4: the caller can now plot
--     real P&L (value - cost) instead of position value, without a second
--     round trip.
--
-- Ticks are read unbounded below, because a position's last price may predate
-- the window by any amount and LOCF needs it. price_history is 21,495 rows
-- today; if it grows past a few million, seed the LOCF with the single last
-- tick before t0 instead of scanning the whole history for held markets.
-- ---------------------------------------------------------------------------

-- migration:allow-destructive
-- Return type gains a column, so the old signature must go first. Read-only
-- function; no data is touched.
DROP FUNCTION IF EXISTS public.trader_pnl_series(UUID, TEXT);

CREATE FUNCTION public.trader_pnl_series(
  p_user_id UUID,
  p_range   TEXT DEFAULT '1M'
)
RETURNS TABLE (
  bucket    TIMESTAMPTZ,
  value_usd NUMERIC,
  cost_usd  NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH held AS (
    SELECT p.id,
           p.market_id,
           p.market_option_id,
           p.side,
           p.shares,
           p.shares * COALESCE(p.avg_entry_price, 0) AS cost_usd,
           p.created_at                              AS opened_at
    FROM public.positions p
    WHERE p.user_id = p_user_id
      AND p.is_active = TRUE
      AND p.shares > 0
  ),
  cfg AS (
    SELECT t0,
           NOW() AS t1,
           -- The declared step, raised if it would exceed ~400 buckets. 1D
           -- gives 24 points, 1W 84, 1M 30, 1Y 365, YTD ~289, ALL <= 400.
           GREATEST(base_step, (NOW() - t0) / 400) AS step
    FROM (
      SELECT
        CASE p_range
          WHEN '1D'  THEN NOW() - INTERVAL '1 day'
          WHEN '1W'  THEN NOW() - INTERVAL '7 days'
          WHEN '1M'  THEN NOW() - INTERVAL '30 days'
          WHEN '1Y'  THEN NOW() - INTERVAL '365 days'
          WHEN 'YTD' THEN date_trunc('year', NOW())
          -- ALL starts when the book did, not at an arbitrary decade.
          ELSE COALESCE((SELECT min(opened_at) FROM held), NOW() - INTERVAL '30 days')
        END AS t0,
        CASE p_range
          WHEN '1D' THEN INTERVAL '1 hour'
          WHEN '1W' THEN INTERVAL '2 hours'
          ELSE INTERVAL '1 day'
        END AS base_step
    ) s
  ),
  grid AS (
    SELECT generate_series(
             (SELECT t0   FROM cfg),
             (SELECT t1   FROM cfg),
             (SELECT step FROM cfg)
           ) AS ts
  ),
  -- Grid rows (price unknown, pri = 1) interleaved with real ticks (pri = 0),
  -- so that at an identical timestamp the tick is ordered first and the grid
  -- row inherits it.
  events AS (
    SELECT h.id AS pos_id, g.ts, NULL::NUMERIC AS px, 1 AS pri
    FROM held h
    CROSS JOIN grid g
    UNION ALL
    SELECT h.id,
           ph.recorded_at,
           CASE WHEN h.side = 'yes' THEN COALESCE(ph.price, ph.yes_price)
                ELSE COALESCE(1 - ph.price, ph.no_price)
           END,
           0
    FROM held h
    JOIN public.price_history ph
      ON ph.market_id = h.market_id
     -- IS NOT DISTINCT FROM, not `IS NULL OR =`: a binary position must match
     -- the market-level row only, never every option row of its market.
     AND ph.market_option_id IS NOT DISTINCT FROM h.market_option_id
    WHERE ph.recorded_at <= (SELECT t1 FROM cfg)
  ),
  grouped AS (
    SELECT pos_id, ts, px, pri,
           count(px) OVER (PARTITION BY pos_id ORDER BY ts, pri
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
    FROM events
  ),
  filled AS (
    SELECT pos_id, ts, pri,
           first_value(px) OVER (PARTITION BY pos_id, grp ORDER BY ts, pri) AS px_locf
    FROM grouped
  )
  SELECT f.ts AS bucket,
         SUM(h.shares   * f.px_locf) AS value_usd,
         SUM(h.cost_usd)             AS cost_usd
  FROM filled f
  JOIN held h ON h.id = f.pos_id
  WHERE f.pri = 1
    -- A position contributes from the moment it existed, and only once we have
    -- a price to mark it at. Excluded from BOTH sides so value and cost stay
    -- comparable: an unpriced position cannot show as a total loss.
    AND h.opened_at <= f.ts
    AND f.px_locf IS NOT NULL
  GROUP BY f.ts
  ORDER BY f.ts;
$$;

GRANT EXECUTE ON FUNCTION public.trader_pnl_series(UUID, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.trader_pnl_series(UUID, TEXT)
  IS 'Mark-to-market value and cost basis of a trader''s open book, on a complete bucket grid with last-observation-carried-forward pricing. One price per position per bucket. See 112 for the row-multiplicity and partial-coverage defects this replaced.';
