-- =====================================================================
-- Migration 044: CLOB expired-order escrow sweeper (audit finding #5, MED)
--
-- A resting limit order may carry expires_at. Both clob_get_book and the
-- clob_place_order matcher already EXCLUDE expired orders (expires_at > now()),
-- so once an order lapses it can never fill again -- yet nothing releases its
-- escrow: a BUY's reserved cash and a SELL's reserved shares stay locked
-- indefinitely (no sweeper existed; expiries were a deferred "phase 1b'" item).
-- That silently strands user funds/inventory.
--
-- Fix: a pure-SQL sweeper that cancels-out due orders and releases their exact
-- unfilled escrow (mirroring clob_cancel_order), scheduled every minute via
-- pg_cron (same mechanism as refresh-leaderboard in migration 040). Uses
-- FOR UPDATE SKIP LOCKED so it never contends with live matching -- any order it
-- can't lock this tick is swept on the next. Idempotent; additive; reversible
-- (DROP the function + unschedule).
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.clob_expire_orders(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_o    public.clob_orders%ROWTYPE;
  v_rest numeric(20,6);
  v_loc  numeric;
  v_n    integer := 0;
BEGIN
  FOR v_o IN
    SELECT * FROM public.clob_orders
    WHERE status IN ('open','partially_filled')
      AND expires_at IS NOT NULL
      AND expires_at <= now()
    ORDER BY expires_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_rest := v_o.size - v_o.filled;

    IF v_o.action = 'buy' THEN
      -- release the cash still escrowed for the unfilled remainder
      v_loc := ROUND(v_o.reserved_usd / v_o.exchange_rate_to_usd, 2);
      UPDATE public.wallets SET
        available_balance = available_balance + v_loc,
        reserved_balance  = GREATEST(0, reserved_balance - v_loc),
        updated_at = now()
      WHERE id = v_o.wallet_id;
    ELSE
      -- release the reserved shares back to the position
      UPDATE public.positions SET
        reserved_shares = GREATEST(0, reserved_shares - v_rest),
        updated_at = now()
      WHERE user_id = v_o.user_id AND market_id = v_o.market_id
        AND market_option_id = v_o.market_option_id
        AND side = v_o.outcome_side::text::position_side;
    END IF;

    UPDATE public.clob_orders SET status = 'expired', reserved_usd = 0, updated_at = now()
    WHERE id = v_o.id;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

-- Lock down EXECUTE (consistent with the other state-mutating CLOB RPCs); the
-- pg_cron job runs as the schedule owner, not via these grants.
REVOKE EXECUTE ON FUNCTION public.clob_expire_orders(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clob_expire_orders(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.clob_expire_orders(integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.clob_expire_orders(integer) TO service_role;

COMMIT;

-- Schedule every minute (pg_cron upserts by job name -> idempotent), and sweep
-- once now so any already-lapsed order is released the moment this lands.
SELECT cron.schedule('clob-expire-orders', '* * * * *', $$SELECT public.clob_expire_orders()$$);
SELECT public.clob_expire_orders();
