-- 063_remark_positions_value_pnl.sql
-- ---------------------------------------------------------------------------
-- Keeps position mark-to-market (current_value_usd) and unrealized_pnl_usd
-- consistent with the live option price.
--
-- Problem (found by auditing all 1,400 active positions against the live book):
--   * clob_place_order re-marks current_value_usd only for the TWO
--     counterparties of a fill. When an option's price moves because OTHER
--     traders transact, every other holder's current_value_usd goes stale.
--     -> 16 positions had current_value_usd out of line with shares × price.
--   * clob_place_order never writes unrealized_pnl_usd at all, so it drifts
--     from (current_value_usd - total_invested_usd).
--     -> 3 positions violated pnl = value - invested.
--   The read paths (trader_positions, market_positions, and the trade ticket's
--   position panel) return these STORED columns directly and market_positions
--   even RANKS holders by current_value_usd, so stale marks corrupt displayed
--   value, P&L and holder/leaderboard ordering. No periodic re-mark existed
--   (refresh_market_stats isn't even scheduled).
--
-- Value convention (verified against live data: no_price == 1-price,
-- yes_price == price, and 1,384/1,400 positions already match):
--   value = shares × (side='yes' ? price : 1 - price)   [price is a 0..1 fraction]
--   unrealized_pnl = value - total_invested_usd
--
-- Fix:
--   1. remark_positions(p_market_id) — internal (service_role/cron) primitive
--      that re-marks active positions to the live price. NULL = all markets.
--   2. One-time backfill of every active position.
--   3. Schedule it every minute via pg_cron (off the hot trading path; the two
--      counterparties are still marked instantly by clob_place_order, so a
--      trader sees their own value immediately and P&L converges within ~1m).
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.remark_positions(p_market_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Internal service_role/cron-only primitive: reject any end-user JWT
  -- (auth.uid() present); service_role/postgres/cron have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;

  WITH marked AS (
    SELECT
      p.id,
      ROUND(p.shares * (CASE WHEN p.side = 'yes' THEN mo.price ELSE 1 - mo.price END), 6) AS value_usd
    FROM public.positions p
    JOIN public.market_options mo ON mo.id = p.market_option_id
    WHERE p.is_active
      AND (p_market_id IS NULL OR p.market_id = p_market_id)
  ), upd AS (
    UPDATE public.positions p
       SET current_value_usd  = m.value_usd,
           unrealized_pnl_usd = ROUND(m.value_usd - COALESCE(p.total_invested_usd, 0), 6),
           updated_at         = now()
      FROM marked m
     WHERE p.id = m.id
       -- Only touch rows that actually changed (keeps updated_at honest and the
       -- write set small on the per-minute cron).
       AND (
         p.current_value_usd  IS DISTINCT FROM m.value_usd
         OR p.unrealized_pnl_usd IS DISTINCT FROM ROUND(m.value_usd - COALESCE(p.total_invested_usd, 0), 6)
       )
     RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN jsonb_build_object('remarked', v_count, 'at', now());
END;
$function$;

-- Lock down execution to the roles that run internal jobs (belt-and-suspenders
-- alongside the in-body auth.uid() guard, matching the 051/052 pattern).
REVOKE EXECUTE ON FUNCTION public.remark_positions(uuid) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.remark_positions(uuid) TO service_role;

-- One-time backfill: re-mark everything now (postgres runs with NULL auth.uid()).
SELECT public.remark_positions(NULL);

-- Schedule the re-mark every minute (idempotent: drop any prior job first).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'remark-positions') THEN
    PERFORM cron.unschedule('remark-positions');
  END IF;
  PERFORM cron.schedule('remark-positions', '* * * * *', 'SELECT public.remark_positions()');
END;
$cron$;

COMMIT;
