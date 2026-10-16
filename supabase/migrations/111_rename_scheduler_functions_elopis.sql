-- 111_rename_scheduler_functions_elopis.sql
-- ------------------------------------------------------------
-- Kichiko → Elopis, for the live database objects that carry the name.
--
-- Migrations 001–110 are applied history and are NOT rewritten; this is the
-- same move migration 055 made for MarketPips → Kichiko, and for the same
-- reason: the only database objects that carry a brand are the two operator
-- helpers that schedule the cron jobs, plus the job names they create.
--
--   public.schedule_kichiko_jobs      → public.schedule_elopis_jobs
--   public.schedule_kichiko_btc_jobs  → public.schedule_elopis_btc_jobs
--   cron jobs 'kichiko-*'             → 'elopis-*'
--
-- The bodies are the live definitions (pg_get_functiondef, 2026-10-16) with
-- the job prefix changed and the cleanup pattern widened. Nothing else moves.
--
-- WHY THE CLEANUP LIST GROWS RATHER THAN CHANGES. Each helper unschedules the
-- old job names before it schedules the new ones, so running it after a rename
-- cannot leave two generations of jobs firing the same endpoint on the same
-- minute. That list now covers all three names this platform has had. Dropping
-- an earlier one would strand any job still scheduled under it in an
-- environment nobody has re-run the helper in.
--
-- No cron jobs were scheduled in production at the time of writing (the helper
-- is run by hand per environment), so this migration renames the functions and
-- leaves the schedule empty, exactly as it found it.

BEGIN;

-- ------------------------------------------------------------- the main one
CREATE OR REPLACE FUNCTION public.schedule_elopis_jobs(p_base_url text, p_cron_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'net'
AS $function$
DECLARE
  v_base TEXT := rtrim(p_base_url, '/');
  v_hdr  JSONB;
  v_job  RECORD;
  v_n    INT := 0;
  -- path, schedule. Mirrors the deployment's cron config exactly; keep in step.
  v_jobs CONSTANT TEXT[][] := ARRAY[
    ['ingest-news',           '7 * * * *'],
    ['update-exchange-rates', '0 */6 * * *'],
    ['close-markets',         '*/5 * * * *'],
    ['resolve-market',        '*/15 * * * *'],
    ['send-notifications',    '* * * * *'],
    ['refresh-market-stats',  '*/10 * * * *'],
    ['btc-windows',           '* * * * *'],
    ['deposit-sweep',         '*/5 * * * *'],
    ['payouts',               '*/10 * * * *']
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN jsonb_build_object('scheduled', FALSE, 'reason', 'pg_cron not installed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN jsonb_build_object(
      'scheduled', FALSE,
      'reason', 'pg_net not installed; run: create extension pg_net with schema extensions;'
    );
  END IF;

  -- The secret travels as a header, never in the URL, so it stays out of
  -- cron.job_run_details and any proxy log.
  v_hdr := jsonb_build_object('Content-Type', 'application/json',
                              'x-cron-secret', p_cron_secret);

  -- Drop every prior generation of these jobs so re-running is safe and two
  -- names cannot fire the same endpoint on the same minute.
  FOR v_job IN
    SELECT jobname FROM cron.job
     WHERE jobname LIKE 'elopis-%' OR jobname LIKE 'kichiko-%' OR jobname LIKE 'marketpips-%'
  LOOP
    PERFORM cron.unschedule(v_job.jobname);
  END LOOP;

  FOR v_n IN 1 .. array_length(v_jobs, 1) LOOP
    PERFORM cron.schedule(
      'elopis-' || v_jobs[v_n][1],
      v_jobs[v_n][2],
      format(
        $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
        v_base || '/api/cron/' || v_jobs[v_n][1],
        v_hdr::text
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'scheduled', TRUE,
    'base_url', v_base,
    'jobs', array_length(v_jobs, 1)
  );
END;
$function$;

-- --------------------------------------------------------------- the BTC one
CREATE OR REPLACE FUNCTION public.schedule_elopis_btc_jobs(p_base_url text, p_cron_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_base TEXT := rtrim(p_base_url, '/');
  v_hdr  JSONB;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN jsonb_build_object(
      'scheduled', FALSE,
      'reason', 'pg_cron and/or pg_net not installed; enable them then re-run.'
    );
  END IF;

  v_hdr := jsonb_build_object('Content-Type', 'application/json',
                              'x-cron-secret', p_cron_secret);

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname IN ('elopis-btc-windows', 'kichiko-btc-windows', 'marketpips-btc-windows');

  -- Tick + resolve + roll new windows, every minute.
  PERFORM cron.schedule('elopis-btc-windows', '* * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/btc-windows', v_hdr::text));

  RETURN jsonb_build_object('scheduled', TRUE, 'base_url', v_base, 'jobs', 1);
END;
$function$;

-- ------------------------------------------------------------------ grants
-- Same lockdown migration 057 applied: operator-only, never the API roles.
REVOKE ALL ON FUNCTION public.schedule_elopis_jobs(text, text)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.schedule_elopis_btc_jobs(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_elopis_jobs(text, text)     TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_elopis_btc_jobs(text, text) TO service_role;

COMMENT ON FUNCTION public.schedule_elopis_jobs(text, text) IS
  '111: operator helper. (Re)schedules the elopis-* pg_cron jobs against a base URL; unschedules every earlier generation first. Run by hand per environment.';
COMMENT ON FUNCTION public.schedule_elopis_btc_jobs(text, text) IS
  '111: operator helper for the minute-by-minute BTC window job.';

-- ---------------------------------------------------- retire the old names
-- Last, so a failure above leaves the old helpers in place to fall back on.
DROP FUNCTION IF EXISTS public.schedule_kichiko_jobs(text, text);
DROP FUNCTION IF EXISTS public.schedule_kichiko_btc_jobs(text, text);

COMMIT;
