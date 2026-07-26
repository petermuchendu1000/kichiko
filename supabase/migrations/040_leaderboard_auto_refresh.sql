-- 040_leaderboard_auto_refresh.sql
-- ---------------------------------------------------------------------------
-- Data consistency / timeliness fix for the leaderboard.
--
-- `public.leaderboard` is a MATERIALIZED VIEW (a ranked snapshot of the
-- trigger-maintained `profiles` stat columns). A refresh helper
-- `public.refresh_leaderboard()` has always existed, and 002 shipped the
-- intended pg_cron schedule -- but that line was left COMMENTED OUT, so the
-- matview was only ever populated once. As trades accrued, `profiles` (kept
-- live by `update_profile_stats_on_transaction`) drifted arbitrarily far from
-- the frozen matview: every eligible row diverged (e.g. a trader showing 20
-- bets / ~1.6K volume in the matview vs 71 bets / ~16M live). The all-time
-- leaderboard and the profile pages therefore disagreed -- a direct violation
-- of the accuracy, integrity, consistency and timeliness principles.
--
-- Fix: actually schedule the refresh (the matview has a UNIQUE index on id, so
-- REFRESH ... CONCURRENTLY is used by the helper) and refresh once immediately
-- so the standings are correct the moment this migration lands.
--
-- pg_cron is a prerequisite (Supabase ships it). cron.schedule() upserts by
-- job name, so re-running this migration is idempotent.

-- Refresh every 2 minutes -- fresh enough that the board tracks live profiles,
-- cheap because REFRESH CONCURRENTLY only diffs changed rows and the endpoint
-- is additionally HTTP-cached with stale-while-revalidate.
SELECT cron.schedule(
  'refresh-leaderboard',
  '*/2 * * * *',
  $$SELECT public.refresh_leaderboard()$$
);

-- Make the standings correct right now (don't wait for the first cron tick).
SELECT public.refresh_leaderboard();
