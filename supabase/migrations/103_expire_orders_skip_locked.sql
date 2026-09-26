-- 103_expire_orders_skip_locked.sql — the expiry sweeper never waits on a
-- trade (db-core audit #24).
--
-- BUG (reproduced: scripts/ops/clob/test_expire_skip_locked.py, red: with one
-- buyer's wallet and one seller's position held, the sweep blocked until its
-- statement timeout and expired nothing, not even the unrelated order):
-- clob_expire_orders (082; pg_cron every minute) took the expired orders with
-- SKIP LOCKED but then locked each order's wallet or position with a blocking
-- lock, in expiry order, in one transaction of up to 5,000 orders, while the
-- matcher locks wallets in id order and maker positions in book order.
--
-- FIX: those locks are taken with SKIP LOCKED too; an order whose wallet or
-- position is held is left for the next run. It cannot trade meanwhile: the
-- matcher skips expired makers. A sell whose position row does not exist is
-- still expired (nothing to release). Otherwise 082's function, unchanged:
-- the same release amounts and statuses (single-threaded behaviour, which the
-- differential proof replays, is identical).
BEGIN;

CREATE OR REPLACE FUNCTION public.clob_expire_orders(p_limit integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_o    public.clob_orders%ROWTYPE;
  v_rest numeric(20,6);
  v_loc  numeric;
  v_res  numeric;
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

    -- [103] never wait on a trade: an order whose wallet or position another
    -- transaction holds is left for the next run (the matcher already skips
    -- expired makers, so it cannot trade meanwhile). Waiting here, in expiry
    -- order, against the matcher's id/book order, could deadlock, and one held
    -- row stalled the whole batch.
    IF v_o.action = 'buy' THEN
      SELECT reserved_balance INTO v_res FROM public.wallets WHERE id = v_o.wallet_id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN CONTINUE; END IF;   -- wallets always exist (FK): not found = held
    ELSE
      PERFORM 1 FROM public.positions
        WHERE user_id = v_o.user_id AND market_id = v_o.market_id
          AND market_option_id = v_o.market_option_id
          AND side = v_o.outcome_side::text::position_side
        FOR UPDATE SKIP LOCKED;
      IF NOT FOUND AND EXISTS (SELECT 1 FROM public.positions
                                WHERE user_id = v_o.user_id AND market_id = v_o.market_id
                                  AND market_option_id = v_o.market_option_id
                                  AND side = v_o.outcome_side::text::position_side) THEN
        CONTINUE;                            -- the position exists and is held
      END IF;
    END IF;

    IF v_o.action = 'buy' THEN
      -- release the cash still escrowed for the unfilled remainder
      -- [082] exactly the order's remaining escrow, never more than the wallet holds
      v_loc := LEAST(v_o.reserved_local, COALESCE(v_res, 0));
      UPDATE public.wallets SET
        available_balance = available_balance + v_loc,
        reserved_balance  = reserved_balance - v_loc,
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

    UPDATE public.clob_orders SET status = 'expired', reserved_usd = 0, reserved_local = 0, updated_at = now(),
      metadata = CASE WHEN v_o.action = 'buy' AND v_loc < v_o.reserved_local
                      THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('escrow_shortfall_local', v_o.reserved_local - v_loc)
                      ELSE metadata END
    WHERE id = v_o.id;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;

COMMIT;
