-- ============================================================
-- MarketPips - Migration 054: Per-table autovacuum & fillfactor tuning
-- ============================================================
-- The cluster runs default autovacuum (vacuum scale_factor 0.2, analyze 0.1),
-- which is too lax for high-churn fintech tables: at 0.2 a large table must
-- accumulate 20% dead tuples before it is vacuumed, which causes index/heap
-- bloat and stale planner statistics (the markets-list and order-book plans
-- depend on fresh stats to keep choosing index scans -- verified in
-- docs/perf/DB-PROFILING-2026-07.md).
--
-- This migration sets storage parameters declaratively (Infrastructure-as-Data)
-- so the behaviour is versioned and reproducible across environments:
--
--   UPDATE-heavy tables (get HOT updates via fillfactor + aggressive vacuum):
--     * clob_orders  -- `filled`/`status` mutate on every match; `filled` is
--                       unindexed so a <100 fillfactor enables HOT updates,
--                       avoiding index bloat on the hottest write path.
--     * markets      -- volume/price/counter columns update constantly.
--     * wallets      -- balance updates on every deposit/trade/withdrawal.
--     * positions    -- share/value updates on every fill.
--
--   APPEND-heavy tables (keep stats fresh; insert-driven autovacuum):
--     * price_history, btc_price_ticks, clob_fills, market_activity,
--       transactions -- mostly INSERTs; the risk is STALE STATS, not dead
--       tuples, so we tighten analyze + insert-based vacuum thresholds.
--
-- All statements are idempotent (ALTER TABLE ... SET is declarative) and use
-- IF EXISTS so the migration is safe on any environment. Storage-parameter
-- changes are non-destructive; fillfactor applies to future writes (existing
-- rows are unaffected until naturally rewritten).
-- ============================================================

-- ------------------------------------------------------------
-- 1. UPDATE-heavy tables: HOT updates (fillfactor) + aggressive autovacuum
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS public.clob_orders SET (
  fillfactor = 90,
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 2
);

ALTER TABLE IF EXISTS public.markets SET (
  fillfactor = 90,
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE IF EXISTS public.wallets SET (
  fillfactor = 90,
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE IF EXISTS public.positions SET (
  fillfactor = 90,
  autovacuum_vacuum_scale_factor  = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

-- ------------------------------------------------------------
-- 2. APPEND-heavy tables: keep planner statistics fresh
--    (autovacuum_vacuum_insert_scale_factor is PG13+; harmless if unsupported
--     it would error, so we only set widely-supported params here plus the
--     insert threshold which Supabase/PG15+ supports.)
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS public.price_history SET (
  autovacuum_analyze_scale_factor        = 0.02,
  autovacuum_vacuum_insert_scale_factor  = 0.05
);

ALTER TABLE IF EXISTS public.btc_price_ticks SET (
  autovacuum_analyze_scale_factor        = 0.02,
  autovacuum_vacuum_insert_scale_factor  = 0.05
);

ALTER TABLE IF EXISTS public.clob_fills SET (
  autovacuum_analyze_scale_factor        = 0.02,
  autovacuum_vacuum_insert_scale_factor  = 0.05
);

ALTER TABLE IF EXISTS public.market_activity SET (
  autovacuum_analyze_scale_factor        = 0.02,
  autovacuum_vacuum_insert_scale_factor  = 0.05
);

ALTER TABLE IF EXISTS public.transactions SET (
  autovacuum_analyze_scale_factor        = 0.02,
  autovacuum_vacuum_insert_scale_factor  = 0.05
);
