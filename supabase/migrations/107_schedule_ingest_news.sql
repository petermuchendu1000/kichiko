-- 107: schedule every HTTP cron from inside Postgres, including ingest-news.
--
-- Deployment is Cloudflare + Fly.io + Supabase, NOT Vercel, so the `crons`
-- block in vercel.json schedules nothing — it is kept only as a machine
-- readable list of what must run and how often. pg_cron is the thing that
-- actually fires, and it is already installed here (three SQL jobs run on it).
--
-- This supersedes schedule_marketpips_jobs() from 016 rather than editing it:
-- same mechanism, the project's current name, and ingest-news added.
--
-- REQUIRES pg_net. It is available on this project but not installed by
-- default; the function reports that instead of failing, so a run on a project
-- without it is harmless.
--
-- Usage (service-role only, from the SQL editor):
--   select public.schedule_kichiko_jobs('https://kichiko.app', '<CRON_SECRET>');

create or replace function public.schedule_kichiko_jobs(
  p_base_url    text,
  p_cron_secret text
)
returns jsonb
language plpgsql
security definer
set search_path = public, cron, net
as $$
DECLARE
  v_base TEXT := rtrim(p_base_url, '/');
  v_hdr  JSONB;
  v_job  RECORD;
  v_n    INT := 0;
  -- path, schedule. Mirrors vercel.json `crons` exactly; keep them in step.
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

  -- Drop prior definitions (this migration's and 016's) so re-running is safe
  -- and the old marketpips-* names do not double-fire alongside the new ones.
  FOR v_job IN
    SELECT jobname FROM cron.job
     WHERE jobname LIKE 'kichiko-%' OR jobname LIKE 'marketpips-%'
  LOOP
    PERFORM cron.unschedule(v_job.jobname);
  END LOOP;

  FOR v_n IN 1 .. array_length(v_jobs, 1) LOOP
    PERFORM cron.schedule(
      'kichiko-' || v_jobs[v_n][1],
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
$$;

revoke execute on function public.schedule_kichiko_jobs(text, text) from public, anon, authenticated;

comment on function public.schedule_kichiko_jobs(text, text) is
  '107: (re)schedules every /api/cron/* route on pg_cron via pg_net. Deployment is Cloudflare/Fly/Supabase, so this — not vercel.json — is what fires. Safe to re-run; unschedules kichiko-* and the legacy marketpips-* first.';
