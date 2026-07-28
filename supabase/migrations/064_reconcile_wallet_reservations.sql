-- 064_reconcile_wallet_reservations.sql
-- ---------------------------------------------------------------------------
-- Reconciles wallets.reserved_balance with the escrow implied by each wallet's
-- OPEN buy orders.
--
-- Problem (found auditing all wallets against clob_orders):
--   40 wallets have reserved_balance = 0 while carrying 50-69 open buy orders
--   each (reserved_usd totalling ~13k-21k KES). clob_place_order is verified
--   correct today — a resting buy moves `reserve` from available_balance to
--   reserved_balance (and releases it on fill/cancel/expiry). These 40 are
--   historical seed rows inserted straight into clob_orders, bypassing that
--   accounting, so reserved_balance was never funded and available_balance was
--   never debited. The user can therefore "spend" funds that are actually
--   committed to open orders (double-spend / broken cash conservation).
--
-- Fix: set reserved_balance to the sum of the wallet's open-buy reservations,
-- expressed in the wallet's currency (reserved_usd / exchange_rate_to_usd), and
-- offset available_balance by the same delta. This is CASH-NEUTRAL
-- (available + reserved is preserved) and simply relabels already-committed
-- funds. Verified safe: no wallet's available_balance goes negative.
-- A wallet whose reconciliation WOULD go negative (over-committed seed data) is
-- deliberately skipped and surfaced in the result so it can be handled by
-- cancelling excess orders rather than silently corrupting the balance.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_wallet_reservations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_reconciled integer;
  v_skipped    integer;
BEGIN
  -- Internal service_role/cron-only primitive: reject any end-user JWT.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;

  WITH target AS (
    SELECT w.id AS wallet_id,
           w.available_balance,
           w.reserved_balance,
           ROUND(COALESCE(SUM(o.reserved_usd / NULLIF(o.exchange_rate_to_usd, 0)), 0), 6) AS want_reserved
      FROM public.wallets w
      LEFT JOIN public.clob_orders o
        ON o.wallet_id = w.id AND o.status = 'open' AND o.action = 'buy'
     GROUP BY w.id, w.available_balance, w.reserved_balance
  ), actionable AS (
    SELECT *,
           (reserved_balance - want_reserved)                       AS delta,        -- moved back to available
           (available_balance + (reserved_balance - want_reserved)) AS new_available
      FROM target
     WHERE abs(reserved_balance - want_reserved) > 0.000001
  ), upd AS (
    UPDATE public.wallets w
       SET reserved_balance  = a.want_reserved,
           available_balance = a.new_available,
           updated_at        = now()
      FROM actionable a
     WHERE w.id = a.wallet_id
       AND a.new_available >= 0        -- never drive available negative
     RETURNING 1
  )
  SELECT (SELECT count(*) FROM upd),
         (SELECT count(*) FROM actionable WHERE new_available < 0)
    INTO v_reconciled, v_skipped;

  RETURN jsonb_build_object('reconciled', v_reconciled, 'skipped_negative', v_skipped, 'at', now());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reconcile_wallet_reservations() FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reconcile_wallet_reservations() TO service_role;

-- One-time reconciliation (postgres runs with NULL auth.uid()).
SELECT public.reconcile_wallet_reservations();

COMMIT;
