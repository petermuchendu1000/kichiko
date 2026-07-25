-- 039_data_integrity_constraints.sql
-- ============================================================
-- Persistent data-integrity guards (data-governance: INTEGRITY, CONSISTENCY,
-- ACCURACY). These CHECK constraints make invalid money/price states
-- unrepresentable at the database layer, so no application bug, migration, or
-- manual edit can silently poison the data again.
--
-- Universal invariants only (no brittle business limits like the M-Pesa cap,
-- which stays config-driven at the app layer for extensibility):
--   * money & quantities are non-negative
--   * probabilities/prices are within their natural bounds ([0,1] or [0,100]c)
--   * an order can never be filled beyond its size
--
-- Idempotent: each constraint is added only if absent, so the migration is safe
-- to re-run (expand/contract friendly). Non-destructive.
-- ============================================================
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('wallets',        'ck_wallets_nonneg',        'available_balance >= 0 AND reserved_balance >= 0 AND total_deposited >= 0 AND total_withdrawn >= 0'),
      ('positions',      'ck_positions_nonneg',      'shares >= 0 AND total_invested_usd >= 0 AND COALESCE(reserved_shares,0) >= 0'),
      ('markets',        'ck_markets_price_bounds',  '(yes_price IS NULL OR (yes_price >= 0 AND yes_price <= 1)) AND (no_price IS NULL OR (no_price >= 0 AND no_price <= 1))'),
      ('markets',        'ck_markets_vol_nonneg',    'COALESCE(total_volume_usd,0) >= 0 AND COALESCE(volume_24h_usd,0) >= 0 AND COALESCE(liquidity_pool_usd,0) >= 0'),
      ('market_options', 'ck_options_price_bounds',  'price IS NULL OR (price >= 0 AND price <= 1)'),
      ('market_options', 'ck_options_vol_nonneg',    'COALESCE(volume_usd,0) >= 0'),
      ('clob_orders',    'ck_clob_orders_bounds',    'price_cents >= 0 AND price_cents <= 100 AND size >= 0 AND filled >= 0 AND filled <= size'),
      ('clob_fills',     'ck_clob_fills_bounds',     'price_cents >= 0 AND price_cents <= 100 AND size >= 0'),
      ('deposits',       'ck_deposits_amount_pos',   'amount > 0'),
      ('withdrawals',    'ck_withdrawals_amount_pos','amount > 0'),
      ('transactions',   'ck_transactions_amt_nonneg','amount >= 0')
    ) AS t(tbl, cname, expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = c.cname AND conrelid = ('public.' || c.tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)', c.tbl, c.cname, c.expr);
    END IF;
  END LOOP;
END $$;
