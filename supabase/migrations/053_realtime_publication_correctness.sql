-- ============================================================
-- MarketPips - Migration 053: Realtime publication correctness & right-sizing
-- ============================================================
-- Fixes a broken feature and eliminates a zero-consumer realtime firehose.
--
-- FINDINGS (audited against the live publication + every frontend subscription):
--   * public.comments is subscribed by components/markets/market-comments.tsx
--     ('comments:<marketId>', INSERT, filter market_id) but was NOT a member of
--     the supabase_realtime publication -> the live-comments feature received
--     NOTHING. This migration publishes it.
--   * public.price_history and public.orders were published but are subscribed
--     by NO frontend code. price_history takes a row per BTC tick and per trade
--     (a firehose); orders is a legacy table superseded by clob_orders. Both
--     only generated WAL decode + per-change RLS evaluation + Realtime fan-out
--     for zero consumers. Live prices are polled client-side (btc-live-chart),
--     not delivered over Realtime. We remove both from the publication.
--   * public.markets and public.market_activity are also currently unconsumed
--     but are low-write and a plausible near-term "live market card" surface;
--     they are intentionally LEFT in place and revisited when/if wired.
--
-- REPLICA IDENTITY: the two live subscriptions (notifications, comments) are
-- INSERT-only, for which the default (primary-key) replica identity carries the
-- full new row -- no change required. We assert it explicitly for clarity.
--
-- Robustness: every statement is idempotent (guarded against current membership)
-- so this migration is safe to re-run and safe regardless of an environment's
-- starting publication state.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Publish public.comments (fixes the live-comments feature)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
  END IF;
END$$;

-- ------------------------------------------------------------
-- 2. Remove zero-consumer, high-cost tables from the publication
--    (publication-membership changes only; the tables themselves are untouched)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'price_history'
  ) THEN
    -- migration:allow-destructive  (removes from publication only; does NOT drop the relation)
    ALTER PUBLICATION supabase_realtime DROP TABLE public.price_history;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    -- migration:allow-destructive  (removes from publication only; does NOT drop the relation)
    ALTER PUBLICATION supabase_realtime DROP TABLE public.orders;
  END IF;
END$$;

-- ------------------------------------------------------------
-- 3. Assert the INSERT-subscribed tables keep default (PK) replica identity,
--    which is sufficient for INSERT payloads (full new row is emitted).
-- ------------------------------------------------------------
ALTER TABLE public.comments      REPLICA IDENTITY DEFAULT;
ALTER TABLE public.notifications REPLICA IDENTITY DEFAULT;
