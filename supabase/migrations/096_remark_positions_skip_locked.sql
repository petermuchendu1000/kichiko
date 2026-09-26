-- 096_remark_positions_skip_locked.sql — the per-minute position re-mark
-- never waits on a trade.
--
-- BUG (reproduced: scripts/ops/clob/test_remark_skip_locked.py, red: the
-- re-mark blocked until its statement timeout; and a 40P01 between
-- remark_positions() and clob_place_order in the replica's server log):
-- remark_positions (063; pg_cron every minute) updated every active position
-- whose value changed, in no set order, while the matcher locks positions in
-- book order. Either side could be the deadlock victim: the re-mark, or a
-- user's order.
--
-- FIX: lock only positions nobody holds (FOR NO KEY UPDATE SKIP LOCKED); it
-- never waits, so it cannot be part of a cycle. A position held by a trade is
-- left for the next run (the trade sets that position's value itself).
-- Otherwise 063's function, unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.remark_positions(p_market_id uuid DEFAULT NULL::uuid)
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
      -- Only rows that actually changed (keeps updated_at honest and the
      -- write set small on the per-minute cron).
      AND (
        p.current_value_usd IS DISTINCT FROM
          ROUND(p.shares * (CASE WHEN p.side = 'yes' THEN mo.price ELSE 1 - mo.price END), 6)
        OR p.unrealized_pnl_usd IS DISTINCT FROM
          ROUND(ROUND(p.shares * (CASE WHEN p.side = 'yes' THEN mo.price ELSE 1 - mo.price END), 6)
                - COALESCE(p.total_invested_usd, 0), 6)
      )
    -- [096] never wait on a trade: a held position is re-marked next run
    FOR NO KEY UPDATE OF p SKIP LOCKED
  ), upd AS (
    UPDATE public.positions p
       SET current_value_usd  = m.value_usd,
           unrealized_pnl_usd = ROUND(m.value_usd - COALESCE(p.total_invested_usd, 0), 6),
           updated_at         = now()
      FROM marked m
     WHERE p.id = m.id
     RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN jsonb_build_object('remarked', v_count, 'at', now());
END;
$function$;

COMMIT;
