-- 124_sms_delivery_reports.sql
-- ---------------------------------------------------------------------------
-- Make SMS delivery truthful: stop retrying what cannot succeed, and record
-- what the telco says actually happened.
--
-- TWO THINGS WERE MISSING.
--
-- 1. There was no way to say "do not retry this". complete_notification_delivery
--    only knew success or failure, and every failure went back in the queue
--    until max_attempts. An InvalidPhoneNumber and a GatewayError were treated
--    identically: five attempts over eight hours, against a number that will
--    never exist either time.
--
-- 2. `sent` meant "Africa's Talking accepted it", which is not delivery. A
--    101 Sent says the telco took the message. Whether a handset ever saw it
--    arrives later, on a callback, and we had nowhere to put it. For a
--    platform whose SMS carry payout confirmations, "we believe we sent it"
--    is not a record.

-- ---------------------------------------------------------------------------
-- 1. What the telco said
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_deliveries
  ADD COLUMN IF NOT EXISTS provider_cost     TEXT,
  ADD COLUMN IF NOT EXISTS provider_status   TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason    TEXT;

COMMENT ON COLUMN public.notification_deliveries.provider_cost IS
  'As billed by the provider, e.g. "KES 0.8000". Text, not numeric: it carries its own currency and is an audit record, not an amount we do arithmetic on.';
COMMENT ON COLUMN public.notification_deliveries.provider_status IS
  'The provider''s own last word (Sent, Success, Buffered, Rejected, Failed). Distinct from `status`, which is this pipeline''s state.';
COMMENT ON COLUMN public.notification_deliveries.delivered_at IS
  'When the handset actually received it, from the delivery report. `sent_at` only means the provider accepted it.';

-- Delivery reports arrive keyed on the provider's message id and nothing else,
-- so that lookup has to be fast and it is the only way in.
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_provider_msg
  ON public.notification_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. A failure that is not worth retrying
-- ---------------------------------------------------------------------------
-- The old five-argument version is DROPPED rather than left beside this one.
-- Adding a defaulted parameter creates a second function, and a five-argument
-- call would then be ambiguous between them: Postgres raises 42725 and every
-- delivery completion in the worker starts failing at once.
DROP FUNCTION IF EXISTS public.complete_notification_delivery(UUID, BOOLEAN, TEXT, TEXT, INT);

CREATE OR REPLACE FUNCTION public.complete_notification_delivery(
  p_id                  UUID,
  p_success             BOOLEAN,
  p_provider_message_id TEXT DEFAULT NULL,
  p_error               TEXT DEFAULT NULL,
  p_backoff_seconds     INT  DEFAULT 300,
  p_permanent           BOOLEAN DEFAULT FALSE,
  p_provider_cost       TEXT DEFAULT NULL,
  p_provider_status     TEXT DEFAULT NULL
)
RETURNS public.notification_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.notification_deliveries;
BEGIN
  UPDATE public.notification_deliveries d
  SET status = CASE
        WHEN p_success THEN 'sent'
        -- A permanent failure is final on the first attempt. Nothing about an
        -- unregistered sender ID or a number that is not a number changes by
        -- waiting six hours.
        WHEN COALESCE(p_permanent, FALSE) THEN 'failed'
        WHEN d.attempts >= d.max_attempts THEN 'failed'
        ELSE 'pending'
      END,
      sent_at = CASE WHEN p_success THEN NOW() ELSE d.sent_at END,
      provider_message_id = COALESCE(p_provider_message_id, d.provider_message_id),
      provider_cost = COALESCE(p_provider_cost, d.provider_cost),
      provider_status = COALESCE(p_provider_status, d.provider_status),
      last_error = CASE WHEN p_success THEN NULL ELSE p_error END,
      next_attempt_at = CASE
        WHEN p_success OR COALESCE(p_permanent, FALSE) OR d.attempts >= d.max_attempts
          THEN d.next_attempt_at
        ELSE NOW() + make_interval(secs => GREATEST(COALESCE(p_backoff_seconds, 300), 1))
      END,
      updated_at = NOW()
  WHERE d.id = p_id
  RETURNING d.* INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_notification_delivery(UUID, BOOLEAN, TEXT, TEXT, INT, BOOLEAN, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_notification_delivery(UUID, BOOLEAN, TEXT, TEXT, INT, BOOLEAN, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_notification_delivery(UUID, BOOLEAN, TEXT, TEXT, INT, BOOLEAN, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Recording a delivery report
-- ---------------------------------------------------------------------------
-- Keyed on the provider's message id, which is the ONLY thing the callback
-- carries that ties back to us. Africa's Talking does not sign these, so the
-- route in front of this verifies a shared secret in the URL; this function
-- additionally refuses to invent a row, so a report for a message id we never
-- sent does nothing at all rather than creating a record out of a POST body.
--
-- Idempotent on purpose: the provider retries a callback whenever it does not
-- get a 2xx, and a handset can produce Buffered then Success.
CREATE OR REPLACE FUNCTION public.record_sms_delivery_report(
  p_provider_message_id TEXT,
  p_status              TEXT,
  p_outcome             TEXT,          -- 'delivered' | 'failed' | 'pending'
  p_failure_reason      TEXT DEFAULT NULL,
  p_network_code        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.notification_deliveries;
BEGIN
  IF p_provider_message_id IS NULL OR length(trim(p_provider_message_id)) = 0 THEN
    RETURN jsonb_build_object('matched', FALSE, 'reason', 'no message id');
  END IF;

  UPDATE public.notification_deliveries d
  SET provider_status = p_status,
      failure_reason  = CASE WHEN p_outcome = 'failed' THEN p_failure_reason ELSE d.failure_reason END,
      delivered_at    = CASE WHEN p_outcome = 'delivered' THEN COALESCE(d.delivered_at, NOW()) ELSE d.delivered_at END,
      -- A delivery report is the telco's verdict, and it overrides our
      -- optimistic 'sent'. It never REOPENS the delivery for retry, though:
      -- the message was accepted and billed, and sending it again because a
      -- handset was off would double-send a payout confirmation.
      status = CASE WHEN p_outcome = 'failed' THEN 'failed' ELSE d.status END,
      last_error = CASE WHEN p_outcome = 'failed'
                        THEN COALESCE(p_failure_reason, p_status)
                        ELSE d.last_error END,
      updated_at = NOW()
  WHERE d.provider_message_id = p_provider_message_id
  RETURNING d.* INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', FALSE, 'reason', 'unknown message id');
  END IF;

  RETURN jsonb_build_object(
    'matched', TRUE,
    'delivery_id', v_row.id,
    'status', v_row.status,
    'network_code', p_network_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_sms_delivery_report(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_sms_delivery_report(TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_sms_delivery_report(TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
