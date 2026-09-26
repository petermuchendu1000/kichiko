-- 084_deposit_status_sweep.sql — deposits whose callback never came are
-- settled by asking the provider (deposit half of audit 6.10).
--
-- Before: a deposit was settled only by its provider callback. A callback that
-- was lost, rate-limited (429), challenged by the WAF, or answered while the
-- provider's status query still said "processing" left the deposit pending
-- forever although the user had paid. The code promised a "reconciliation
-- sweep" that did not exist.
--
-- After: claim_deposits_for_status_check hands a worker the pending /
-- processing deposits that are due (older than 2 minutes, younger than 7 days),
-- pushing next_check_at out with backoff (2^n minutes, capped at 6 hours) so
-- concurrent sweeps never query one deposit twice at once (SKIP LOCKED). The
-- worker (/api/cron/deposit-sweep) asks the provider and settles through the
-- same idempotent credit_deposit / fail_deposit as the webhooks.
BEGIN;

ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS next_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS check_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_check jsonb;

CREATE INDEX IF NOT EXISTS deposits_status_check_idx ON public.deposits (next_check_at NULLS FIRST, created_at)
  WHERE status IN ('pending','processing');

CREATE OR REPLACE FUNCTION public.claim_deposits_for_status_check(p_limit integer DEFAULT 50)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.deposits
     WHERE status IN ('pending','processing')
       AND created_at < now() - interval '2 minutes'
       AND created_at > now() - interval '7 days'
       AND COALESCE(next_check_at, now()) <= now()
     ORDER BY next_check_at NULLS FIRST, created_at
     LIMIT LEAST(GREATEST(p_limit, 1), 200)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.deposits d
     SET check_count = d.check_count + 1,
         next_check_at = now() + LEAST(interval '1 minute' * power(2, LEAST(d.check_count + 1, 9)), interval '6 hours'),
         updated_at = now()
    FROM due WHERE d.id = due.id
  RETURNING jsonb_build_object('id', d.id, 'provider', d.provider, 'amount', d.amount, 'currency', d.currency,
                               'checkout_request_id', d.checkout_request_id, 'mtn_reference_id', d.mtn_reference_id,
                               'airtel_reference', d.airtel_reference, 'pesapal_order_id', d.pesapal_order_id,
                               'check_count', d.check_count, 'created_at', d.created_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.note_deposit_status_check(p_deposit_id uuid, p_result jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.deposits SET last_check = p_result || jsonb_build_object('at', now()), updated_at = now()
   WHERE id = p_deposit_id AND auth.uid() IS NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_deposits_for_status_check(integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.note_deposit_status_check(uuid, jsonb) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_deposits_for_status_check(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.note_deposit_status_check(uuid, jsonb) TO service_role;

-- ---- schedule the sweep with the other jobs (docs/12-BACKGROUND-JOBS.md) ---
CREATE OR REPLACE FUNCTION public.schedule_kichiko_jobs(p_base_url text, p_cron_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
                      'kichiko-refresh-market-stats','kichiko-payouts','kichiko-deposit-sweep',
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

  -- [083] send queued payouts and query the status of unsettled ones
  PERFORM cron.schedule('kichiko-payouts', '* * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/payouts', v_hdr::text));

  -- [084] settle deposits whose callback never came, by asking the provider
  PERFORM cron.schedule('kichiko-deposit-sweep', '*/2 * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/deposit-sweep', v_hdr::text));

  RETURN jsonb_build_object('scheduled', TRUE, 'base_url', v_base, 'jobs', 7);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.schedule_kichiko_jobs(text, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.schedule_kichiko_jobs(text, text) TO service_role;

COMMIT;
