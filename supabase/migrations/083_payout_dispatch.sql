-- 083_payout_dispatch.sql — payouts are claimed before they are sent, and
-- queued payouts are actually sent (audit 6.6; payout half of 6.10).
--
-- Before:
--   * a withdrawal approved after review (admin_approve_withdrawal only clears
--     requires_review) or retried (admin_retry_withdrawal only sets
--     'processing') was never sent to the provider: its funds stayed reserved
--     until an operator paid it by hand and pressed "complete" (6.6);
--   * nothing re-queried a payout whose result callback never came (6.10), and
--     since the 6.5 fix an ambiguous send stays 'processing' by design, so it
--     must be settled by a status query;
--   * nothing stopped two senders (the request, a worker) paying one
--     withdrawal twice.
--
-- After: withdrawals.payout_state
--   awaiting_review  held for review (requires_review)
--   queued           may be sent (new without review, approved, or retried)
--   dispatching      claimed by exactly one sender; the send is in flight
--   sent             the provider accepted it; result pending
--   unknown          sent, outcome unknown (timeout, 5xx, lost reply, or a
--                    sender that died mid-send). NEVER re-sent: only the
--                    provider's callback or a status query settles it
--   settled          completed / failed / refunded
--   NULL             legacy rows (before 083): never sent automatically; an
--                    admin approve or retry queues them explicitly.
-- Transitions on status / review changes are made by a trigger, so the
-- existing RPCs (request, approve, retry, complete, fail) stay as they are.
-- Senders use claim_withdrawal_dispatch / claim_withdrawals_for_dispatch (an
-- atomic UPDATE ... WHERE payout_state='queued': one winner) and report with
-- record_withdrawal_dispatch. A sweep claims sent/unknown payouts for status
-- queries with backoff (claim_withdrawals_for_status_check).
BEGIN;

ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS payout_state text
    CHECK (payout_state IN ('awaiting_review','queued','dispatching','sent','unknown','settled')),
  ADD COLUMN IF NOT EXISTS dispatch_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS check_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_check jsonb;

CREATE INDEX IF NOT EXISTS withdrawals_payout_queue_idx ON public.withdrawals (payout_state, created_at)
  WHERE payout_state IN ('queued','dispatching');
CREATE INDEX IF NOT EXISTS withdrawals_payout_check_idx ON public.withdrawals (next_check_at)
  WHERE payout_state IN ('sent','unknown');

-- Terminal rows are settled; live legacy rows stay NULL (not sent automatically).
UPDATE public.withdrawals SET payout_state = 'settled'
 WHERE payout_state IS NULL AND status IN ('completed','failed','refunded');

-- ---- state transitions driven by the existing RPCs -------------------------
CREATE OR REPLACE FUNCTION public.withdrawals_payout_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payout_state IS NULL THEN
      NEW.payout_state := CASE
        WHEN NEW.status IN ('completed','failed','refunded') THEN 'settled'
        WHEN NEW.requires_review THEN 'awaiting_review'
        ELSE 'queued' END;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IN ('completed','failed','refunded') THEN
    NEW.payout_state := 'settled';
  ELSIF OLD.status = 'failed' AND NEW.status IN ('pending','processing') THEN
    -- admin retry: a new attempt; the failed attempt's reference is not this one's
    NEW.payout_state := 'queued';
    NEW.provider_reference := NULL;
    NEW.next_check_at := NULL;
    NEW.check_count := 0;
  ELSIF OLD.requires_review AND NOT NEW.requires_review
        AND COALESCE(OLD.payout_state, 'awaiting_review') = 'awaiting_review' THEN
    -- approved after review (or a legacy row approved now): send it
    NEW.payout_state := 'queued';
  ELSIF NEW.requires_review AND NOT OLD.requires_review AND OLD.payout_state = 'queued' THEN
    NEW.payout_state := 'awaiting_review';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS withdrawals_payout_state ON public.withdrawals;
CREATE TRIGGER withdrawals_payout_state
  BEFORE INSERT OR UPDATE OF status, requires_review ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.withdrawals_payout_state();

-- ---- claim one (the request path) ------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_withdrawal_dispatch(p_withdrawal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.withdrawals%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  -- one winner: the WHERE is re-checked on the locked row
  UPDATE public.withdrawals
     SET payout_state = 'dispatching', status = 'processing',
         dispatch_attempts = dispatch_attempts + 1, dispatched_at = now(), updated_at = now()
   WHERE id = p_withdrawal_id AND payout_state = 'queued'
     AND status IN ('pending','processing') AND NOT requires_review
  RETURNING * INTO v;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', v.id, 'provider', v.provider, 'net_amount', v.net_amount,
                            'currency', v.currency, 'phone_number', v.phone_number,
                            'dispatch_attempts', v.dispatch_attempts);
END;
$function$;

-- ---- claim a batch (the worker) --------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_withdrawals_for_dispatch(p_limit integer DEFAULT 20)
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
  WITH picked AS (
    SELECT id FROM public.withdrawals
     WHERE payout_state = 'queued' AND status IN ('pending','processing') AND NOT requires_review
     ORDER BY created_at
     LIMIT LEAST(GREATEST(p_limit, 1), 100)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.withdrawals w
     SET payout_state = 'dispatching', status = 'processing',
         dispatch_attempts = dispatch_attempts + 1, dispatched_at = now(), updated_at = now()
    FROM picked WHERE w.id = picked.id
  RETURNING jsonb_build_object('id', w.id, 'provider', w.provider, 'net_amount', w.net_amount,
                               'currency', w.currency, 'phone_number', w.phone_number,
                               'dispatch_attempts', w.dispatch_attempts);
END;
$function$;

-- ---- report a send ---------------------------------------------------------
-- accepted -> sent; unknown -> unknown (status query later); rejected -> the
-- reserve is refunded (fail_withdrawal) in the same transaction.
CREATE OR REPLACE FUNCTION public.record_withdrawal_dispatch(
  p_withdrawal_id uuid, p_outcome text, p_reference text DEFAULT NULL,
  p_message text DEFAULT NULL, p_raw jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.withdrawals%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF p_outcome NOT IN ('accepted','rejected','unknown') THEN
    RAISE EXCEPTION 'Invalid dispatch outcome %', p_outcome USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found' USING ERRCODE = 'P0010'; END IF;
  IF v.payout_state IS DISTINCT FROM 'dispatching' THEN
    -- already settled by a fast callback, or marked unknown by the sweep: keep
    -- whatever settled it, but never lose a provider reference we just learned
    IF p_reference IS NOT NULL AND v.provider_reference IS NULL AND v.payout_state IN ('unknown','sent') THEN
      UPDATE public.withdrawals SET provider_reference = p_reference, updated_at = now() WHERE id = v.id;
    END IF;
    RETURN jsonb_build_object('recorded', false, 'payout_state', v.payout_state);
  END IF;

  IF p_outcome = 'rejected' THEN
    PERFORM public.fail_withdrawal(v.id, COALESCE(p_message, 'Disbursement rejected'),
                                   COALESCE(p_raw, '{}'::jsonb));
    RETURN jsonb_build_object('recorded', true, 'payout_state', 'settled', 'refunded', true);
  END IF;

  UPDATE public.withdrawals
     SET payout_state = CASE WHEN p_outcome = 'accepted' THEN 'sent' ELSE 'unknown' END,
         provider_reference = COALESCE(p_reference, provider_reference),
         raw_response = CASE WHEN p_outcome = 'unknown'
                             THEN jsonb_build_object('initiation', jsonb_build_object(
                                    'outcome', 'unknown', 'message', p_message, 'at', now()))
                             ELSE raw_response END,
         -- first status check: soon for unknown, after the normal callback window for sent
         next_check_at = now() + CASE WHEN p_outcome = 'accepted' THEN interval '10 minutes' ELSE interval '2 minutes' END,
         updated_at = now()
   WHERE id = v.id;
  RETURN jsonb_build_object('recorded', true,
                            'payout_state', CASE WHEN p_outcome = 'accepted' THEN 'sent' ELSE 'unknown' END);
END;
$function$;

-- ---- the status sweep ------------------------------------------------------
-- A sender that died mid-send (dispatching for > 10 minutes) is UNKNOWN, never
-- re-sent. Then claim sent/unknown payouts due for a status query, pushing
-- next_check_at out with backoff (2^n minutes, capped at 6 hours).
CREATE OR REPLACE FUNCTION public.claim_withdrawals_for_status_check(p_limit integer DEFAULT 50)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  UPDATE public.withdrawals
     SET payout_state = 'unknown', next_check_at = now(), updated_at = now(),
         raw_response = COALESCE(raw_response, '{}'::jsonb) || jsonb_build_object('initiation',
           jsonb_build_object('outcome', 'unknown', 'message', 'sender did not report (stale dispatch)', 'at', now()))
   WHERE payout_state = 'dispatching' AND dispatched_at < now() - interval '10 minutes'
     AND status = 'processing';

  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.withdrawals
     WHERE payout_state IN ('sent','unknown') AND status = 'processing'
       AND COALESCE(next_check_at, now()) <= now()
     ORDER BY next_check_at NULLS FIRST
     LIMIT LEAST(GREATEST(p_limit, 1), 200)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.withdrawals w
     SET check_count = w.check_count + 1,
         next_check_at = now() + LEAST(interval '1 minute' * power(2, LEAST(w.check_count + 1, 9)), interval '6 hours'),
         updated_at = now()
    FROM due WHERE w.id = due.id
  RETURNING jsonb_build_object('id', w.id, 'provider', w.provider, 'provider_reference', w.provider_reference,
                               'currency', w.currency, 'payout_state', w.payout_state,
                               'check_count', w.check_count, 'dispatched_at', w.dispatched_at);
END;
$function$;

-- record what a status query said (settling goes through complete/fail_withdrawal)
CREATE OR REPLACE FUNCTION public.note_withdrawal_status_check(p_withdrawal_id uuid, p_result jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.withdrawals SET last_check = p_result || jsonb_build_object('at', now()), updated_at = now()
   WHERE id = p_withdrawal_id AND auth.uid() IS NULL;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_withdrawal_dispatch(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_withdrawals_for_dispatch(integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_withdrawal_dispatch(uuid, text, text, text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_withdrawals_for_status_check(integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.note_withdrawal_status_check(uuid, jsonb) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_withdrawal_dispatch(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_withdrawals_for_dispatch(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_withdrawal_dispatch(uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_withdrawals_for_status_check(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.note_withdrawal_status_check(uuid, jsonb) TO service_role;

-- ---- legacy rows: an operator queues them explicitly -----------------------
-- A live withdrawal from before 083 (payout_state NULL) may already have been
-- paid by hand or by an earlier send whose result was lost, so it is never
-- sent automatically. After checking with the provider, finance queues it.
-- Only rows that never received a provider reference qualify.
CREATE OR REPLACE FUNCTION public.admin_queue_withdrawal_dispatch(p_withdrawal_id uuid, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v public.withdrawals%ROWTYPE;
BEGIN
  IF NOT public.has_capability('finance:withdrawals') THEN
    RAISE EXCEPTION 'Insufficient permissions (finance:withdrawals required)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'A note is required (what was checked with the provider)' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found' USING ERRCODE = 'no_data_found'; END IF;
  IF v.payout_state IS NOT NULL OR v.status NOT IN ('pending','processing') OR v.requires_review
     OR v.provider_reference IS NOT NULL THEN
    RAISE EXCEPTION 'Only a live, approved legacy withdrawal without a provider reference can be queued'
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.withdrawals SET payout_state = 'queued', updated_at = now() WHERE id = v.id;
  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'withdrawal.queue_dispatch', 'withdrawal', v.id,
          jsonb_build_object('payout_state', NULL, 'status', v.status),
          jsonb_build_object('payout_state', 'queued', 'notes', p_notes));
  RETURN jsonb_build_object('success', true, 'withdrawal_id', v.id, 'payout_state', 'queued');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_queue_withdrawal_dispatch(uuid, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_queue_withdrawal_dispatch(uuid, text) TO authenticated, service_role;

-- ---- schedule the payout worker with the other jobs (docs/12-BACKGROUND-JOBS.md)
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
                      'kichiko-refresh-market-stats','kichiko-payouts',
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

  RETURN jsonb_build_object('scheduled', TRUE, 'base_url', v_base, 'jobs', 6);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.schedule_kichiko_jobs(text, text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.schedule_kichiko_jobs(text, text) TO service_role;

-- ---- admin reject of an in-flight payout -----------------------------------
-- Rejecting refunds the reserve. For a payout that was sent (or may have been:
-- dispatching / sent / unknown) that is the double pay of audit 6.5 done by
-- hand, so it now needs an explicit statement that the provider was checked.
DROP FUNCTION IF EXISTS public.admin_reject_withdrawal(uuid, text);
CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(
  p_withdrawal_id uuid, p_reason text, p_confirmed_not_paid boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_w public.withdrawals%ROWTYPE;
  v_result JSONB;
BEGIN
  IF NOT public.has_capability('finance:withdrawals') THEN
    RAISE EXCEPTION 'Insufficient permissions (finance:withdrawals required)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_w.payout_state IN ('dispatching','sent','unknown') AND NOT p_confirmed_not_paid THEN
    RAISE EXCEPTION 'This payout was sent to the provider (%): confirm with the provider that it was not paid before rejecting',
      v_w.payout_state USING ERRCODE = 'P0160';
  END IF;

  -- fail_withdrawal notifies the user; the notification trigger refuses a
  -- user JWT unless the caller opts in (as 062 did for admin_adjust_balance).
  -- Without this every real admin rejection failed with P0121.
  PERFORM set_config('app.internal_notify', 'on', true);
  -- fail_withdrawal is atomic + idempotent + refunds reserved -> available.
  v_result := public.fail_withdrawal(p_withdrawal_id, p_reason,
    jsonb_build_object('rejected_by_admin', TRUE, 'payout_state', v_w.payout_state,
                       'confirmed_not_paid', p_confirmed_not_paid));

  UPDATE public.withdrawals
     SET reviewed_by = auth.uid(), reviewed_at = NOW(), review_notes = p_reason, updated_at = NOW()
   WHERE id = p_withdrawal_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_data)
  VALUES (
    auth.uid(), 'withdrawal.reject', 'withdrawal', p_withdrawal_id,
    jsonb_build_object('reason', p_reason, 'result', v_result, 'payout_state', v_w.payout_state,
                       'confirmed_not_paid', p_confirmed_not_paid)
  );

  RETURN v_result;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_reject_withdrawal(uuid, text, boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reject_withdrawal(uuid, text, boolean) TO authenticated, service_role;

-- ---- admin complete: same notification opt-in -------------------------------
CREATE OR REPLACE FUNCTION public.admin_complete_withdrawal(p_withdrawal_id uuid, p_provider_reference text DEFAULT NULL::text, p_provider_receipt text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.has_capability('finance:withdrawals') THEN
    RAISE EXCEPTION 'Insufficient permissions (finance:withdrawals required)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- complete_withdrawal notifies the user: opt in to the notification trigger
  -- for this transaction [083] (every real admin completion failed with P0121)
  PERFORM set_config('app.internal_notify', 'on', true);
  v_result := public.complete_withdrawal(
    p_withdrawal_id, p_provider_reference, p_provider_receipt,
    jsonb_build_object('completed_by_admin', TRUE)
  );

  UPDATE public.withdrawals
     SET reviewed_by = COALESCE(reviewed_by, auth.uid()), updated_at = NOW()
   WHERE id = p_withdrawal_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_data)
  VALUES (
    auth.uid(), 'withdrawal.complete_manual', 'withdrawal', p_withdrawal_id,
    jsonb_build_object('provider_reference', p_provider_reference, 'provider_receipt', p_provider_receipt, 'result', v_result)
  );

  RETURN v_result;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.admin_complete_withdrawal(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_complete_withdrawal(uuid, text, text) TO authenticated, service_role;

COMMIT;
