-- ============================================================
-- Kichiko - Migration 055: rename operator cron-scheduler helpers
-- ============================================================
-- Brand rename (MarketPips -> Kichiko) for the two internal operator helpers
-- that (re)register the pg_cron background jobs, and for the pg_cron JOB NAMES
-- they create. These are SECURITY DEFINER, service_role/cron-only primitives
-- (guarded by the 052 auth.uid() check) with NO client grants and NO runtime
-- callers in the app (only invoked manually by an operator via SQL), so the
-- rename is safe.
--
--   schedule_marketpips_jobs      -> schedule_kichiko_jobs
--   schedule_marketpips_btc_jobs  -> schedule_kichiko_btc_jobs
--   cron job names 'marketpips-*'  -> 'kichiko-*'
--
-- The bodies are identical to migrations 016/024 (+052 guard) except for the
-- job-name literals. We also proactively unschedule any legacy 'marketpips-*'
-- jobs that a prior run may have registered, so re-running the new helper leaves
-- a clean cron state. Idempotent: CREATE OR REPLACE + guarded unschedule +
-- DROP ... IF EXISTS.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New general scheduler (kichiko-* job names)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_kichiko_jobs(p_base_url text, p_cron_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $fn$
DECLARE
  v_base TEXT := rtrim(p_base_url, '/');
  v_hdr  JSONB;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
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
    WHERE jobname IN ('kichiko-close-markets','kichiko-resolve-market',
                      'kichiko-update-exchange-rates','kichiko-send-notifications',
                      'kichiko-refresh-market-stats',
                      -- also clear any legacy marketpips-* jobs from prior runs
                      'marketpips-close-markets','marketpips-resolve-market',
                      'marketpips-update-exchange-rates','marketpips-send-notifications',
                      'marketpips-refresh-market-stats');

  PERFORM cron.schedule('kichiko-close-markets', '*/5 * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/close-markets', v_hdr::text));

  PERFORM cron.schedule('kichiko-resolve-market', '*/15 * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/resolve-market', v_hdr::text));

  PERFORM cron.schedule('kichiko-update-exchange-rates', '0 */6 * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/update-exchange-rates', v_hdr::text));

  PERFORM cron.schedule('kichiko-send-notifications', '* * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/send-notifications', v_hdr::text));

  PERFORM cron.schedule('kichiko-refresh-market-stats', '*/5 * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/refresh-market-stats', v_hdr::text));

  RETURN jsonb_build_object('scheduled', TRUE, 'base_url', v_base, 'jobs', 5);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.schedule_kichiko_jobs(TEXT, TEXT) FROM PUBLIC;

-- ------------------------------------------------------------
-- 2. New BTC-windows scheduler (kichiko-btc-windows job name)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_kichiko_btc_jobs(p_base_url text, p_cron_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $fn$
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
     FROM cron.job WHERE jobname IN ('kichiko-btc-windows', 'marketpips-btc-windows');

  -- Tick + resolve + roll new windows, every minute.
  PERFORM cron.schedule('kichiko-btc-windows', '* * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/btc-windows', v_hdr::text));

  RETURN jsonb_build_object('scheduled', TRUE, 'base_url', v_base, 'jobs', 1);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.schedule_kichiko_btc_jobs(TEXT, TEXT) FROM PUBLIC;

-- ------------------------------------------------------------
-- 3. Drop the old brand-named helpers (operator-only; no runtime callers)
--    DROP FUNCTION is non-destructive to data; safe to remove.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.schedule_marketpips_jobs(text, text);
DROP FUNCTION IF EXISTS public.schedule_marketpips_btc_jobs(text, text);
