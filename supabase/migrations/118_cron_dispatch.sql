-- 118_cron_dispatch.sql
-- ---------------------------------------------------------------------------
-- The lock and the last-run read behind /api/cron/dispatch.
--
-- WHY (measured 2026-10-16)
--
-- The nine background jobs were scheduled in `vercel.json` and nowhere else.
-- The CI deploy path is Fly, Fly has no cron, and there is no in-process
-- scheduler — `lib/cron-auth.ts` says the routes expect "a scheduler (Supabase
-- scheduled function, Vercel Cron, or an external pinger)" and none was wired.
--
-- `job_runs` proves it rather than suggesting it: ZERO rows. No market has ever
-- been auto-closed, no resolution attempted on a schedule, no FX refresh run as
-- a job, since the project was created on 2026-07-22.
--
-- One pinger now hits /api/cron/dispatch every minute. This function is the
-- part that cannot live in the application: taking a lock, and reading the
-- last start per job, in ONE round trip that two machines cannot both win.
--
-- WHY A TRANSACTION-SCOPED ADVISORY LOCK
--
-- `fly.toml` keeps >=1 app machine warm and will add more under load, and a
-- redeploy briefly runs old and new together. Two dispatchers that both read
-- "last run was 6 minutes ago" would both fire the 5-minute jobs. The handlers
-- are individually idempotent (close_due_markets uses FOR UPDATE SKIP LOCKED),
-- so the damage is waste rather than corruption — but waste on the minute, for
-- every job, forever.
--
-- pg_try_advisory_xact_lock takes the lock without blocking and releases it
-- when the statement's transaction ends, so a dispatcher that crashes mid-run
-- cannot wedge the scheduler: there is no unlock to miss. A second caller gets
-- `locked => false` immediately and does nothing.
--
-- THE LOCK KEY IS A CONSTANT, NOT hashtext()
--
-- hashtext() is not guaranteed stable across major Postgres versions, and a
-- scheduler whose mutual exclusion silently stops working after an upgrade is
-- the kind of bug that is only found by its consequences. A literal is boring
-- and cannot drift. 8_273_001 = arbitrary, recorded here so nobody reuses it.

DROP FUNCTION IF EXISTS public.cron_dispatch_begin();

CREATE FUNCTION public.cron_dispatch_begin()
RETURNS TABLE (
  locked    BOOLEAN,
  last_runs JSONB
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked BOOLEAN;
BEGIN
  v_locked := pg_try_advisory_xact_lock(8273001);

  IF NOT v_locked THEN
    -- Another dispatcher holds it. Say so and return nothing to act on.
    RETURN QUERY SELECT FALSE, '{}'::JSONB;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    TRUE,
    COALESCE(
      (
        SELECT jsonb_object_agg(j.job_name, j.started_at)
        FROM (
          SELECT r.job_name, MAX(r.started_at) AS started_at
          FROM job_runs r
          -- A year is far longer than the longest cadence (6 h) and keeps the
          -- aggregate off the full history as the ledger grows.
          WHERE r.started_at > NOW() - INTERVAL '1 year'
          GROUP BY r.job_name
        ) j
      ),
      '{}'::JSONB
    );
END;
$$;

COMMENT ON FUNCTION public.cron_dispatch_begin() IS
  'Takes the transaction-scoped cron dispatch lock and returns the last start time per job. locked=false means another dispatcher is already running this tick. See 118.';

-- SECURITY DEFINER because it reads job_runs, which is operational data and not
-- public. Only the service role may call it: the dispatcher route runs with the
-- admin client behind CRON_SECRET, and anon/authenticated have no business
-- knowing the platform's job cadence or health.
REVOKE ALL ON FUNCTION public.cron_dispatch_begin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cron_dispatch_begin() TO service_role;

-- The dispatcher reads MAX(started_at) per job on every tick. Without this it
-- is a sequential scan of the whole ledger once a minute, forever.
CREATE INDEX IF NOT EXISTS idx_job_runs_name_started
  ON public.job_runs (job_name, started_at DESC);
