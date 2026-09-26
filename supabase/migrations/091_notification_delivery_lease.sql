-- 091_notification_delivery_lease.sql — deliveries no longer stick in 'sending' (audit 6.27).
--
-- Before: the claim set status='sending' and only ever re-claimed 'pending'
-- rows; a worker that died or hit its 60 s budget mid-batch left rows in
-- 'sending' forever (the user never got the email/SMS).
-- After: each claim first returns rows leased more than 10 minutes ago to
-- 'pending' (or 'failed' when out of attempts), then claims as before.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_notification_deliveries(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, notification_id uuid, user_id uuid, channel text, destination text, attempts integer, max_attempts integer, title text, body text, data jsonb, type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  -- [091] lease: a worker that died (or ran out of time) mid-send left rows in
  -- 'sending' forever. Rows leased more than 10 minutes ago (far past the
  -- worker's 60 s budget) go back to 'pending', or to 'failed' when out of
  -- attempts. Delivery is at-least-once: a message sent but never recorded
  -- may be sent again, which is preferred over never sending it.
  UPDATE public.notification_deliveries nd
     SET status = CASE WHEN nd.attempts >= nd.max_attempts THEN 'failed' ELSE 'pending' END,
         next_attempt_at = NOW(),
         last_error = CASE WHEN nd.last_error IS NULL THEN 'lease expired while sending'
                           ELSE nd.last_error || ' | lease expired while sending' END,
         updated_at = NOW()
   WHERE nd.status = 'sending' AND nd.updated_at < NOW() - interval '10 minutes';

  RETURN QUERY
  WITH picked AS (
    SELECT d.id
    FROM public.notification_deliveries d
    WHERE d.status = 'pending'
      AND d.next_attempt_at <= NOW()
      AND d.attempts < d.max_attempts
    ORDER BY d.next_attempt_at
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.notification_deliveries d
  SET status = 'sending', attempts = d.attempts + 1, updated_at = NOW()
  FROM picked, public.notifications n
  WHERE d.id = picked.id AND n.id = d.notification_id
  RETURNING d.id, d.notification_id, d.user_id, d.channel, d.destination,
            d.attempts, d.max_attempts, n.title, n.body, n.data, n.type::TEXT;
END;
$function$;

COMMIT;
