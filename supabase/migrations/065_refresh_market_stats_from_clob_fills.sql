-- 065_refresh_market_stats_from_clob_fills.sql
-- ---------------------------------------------------------------------------
-- Fix the 24h market-stats rollup so it reflects real trading (audit DB-1).
--
-- Problem (verified against the live DB, 2026-07):
--   * refresh_market_stats() aggregates public.orders, but the legacy AMM
--     `orders` path was dropped when the CLOB replaced it (migrations 030-035).
--     public.orders now has 0 rows; ALL trading flows through clob_fills
--     (13k+ rows). So volume_24h_usd / trades_24h were computed as 0 for every
--     one of the 38 active/closed markets despite live CLOB fills.
--   * The markets grid, movers and "24h volume" reads these columns, so the
--     whole product showed 0 recent activity — a data inconsistency between the
--     grid stats and the book/price-history/portfolio surfaces.
--
-- Fix: re-source the 24h window from public.clob_fills. Each fill row is one
-- match; its matched notional is price_cents/100 * size (USD), matching the
-- convention used elsewhere (clob_fills.price_cents is 0-100, size is a decimal
-- share count). clob_fills carries market_id directly, so no join is needed.
--
-- Everything else is preserved verbatim: SECURITY DEFINER + pinned search_path,
-- the 052 internal-only guard (reject end-user JWTs), the LEFT JOIN that resets
-- markets which fell out of the 24h window to zero, and the change-detection
-- filter that only writes rows whose values actually changed.
--
-- NOTE (ops): this only recomputes when the /api/cron/refresh-market-stats
-- endpoint runs. Register it in each environment alongside the other cron jobs
-- (the endpoint is CRON_SECRET-gated); it was previously not scheduled.
--
-- Not destructive (CREATE OR REPLACE preserves the existing service_role-only
-- EXECUTE privilege set from migrations 051/057).

CREATE OR REPLACE FUNCTION public.refresh_market_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;

  WITH windowed AS (
    -- 24h matched notional per market from the CLOB fills (was: public.orders).
    SELECT f.market_id,
           COALESCE(SUM(f.price_cents * f.size / 100.0), 0)   AS vol_24h,
           COUNT(*) FILTER (WHERE f.size > 0)                 AS trades_24h,
           MAX(f.created_at) FILTER (WHERE f.size > 0)        AS last_trade
      FROM public.clob_fills f
     WHERE f.created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY f.market_id
  ), upd AS (
    UPDATE public.markets m
       SET volume_24h_usd = COALESCE(w.vol_24h, 0),
           trades_24h     = COALESCE(w.trades_24h, 0),
           last_trade_at  = COALESCE(w.last_trade, m.last_trade_at),
           updated_at     = NOW()
      FROM (
        -- Left join every refreshable market to its window so markets that fell
        -- out of the 24h window are reset to zero.
        SELECT mk.id AS market_id, wd.vol_24h, wd.trades_24h, wd.last_trade
          FROM public.markets mk
          LEFT JOIN windowed wd ON wd.market_id = mk.id
         WHERE mk.status IN ('active', 'closed')
      ) w
     WHERE m.id = w.market_id
       AND (m.volume_24h_usd IS DISTINCT FROM COALESCE(w.vol_24h, 0)
            OR m.trades_24h  IS DISTINCT FROM COALESCE(w.trades_24h, 0))
     RETURNING m.id
  )
  SELECT COUNT(*) INTO v_updated FROM upd;

  RETURN jsonb_build_object('updated', v_updated, 'at', NOW());
END;
$function$;
