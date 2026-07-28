-- 062_fix_admin_adjust_balance_and_notify_guard.sql
-- ---------------------------------------------------------------------------
-- Fixes the admin "Adjust balance" action (and two sibling admin RPCs) that
-- were fully broken. Three independent, compounding defects were found by
-- end-to-end testing every branch of admin_adjust_balance:
--
--   BUG 1 (42804 / "COALESCE types transaction_type and text cannot be
--          matched"): migration 010 built v_type as
--          COALESCE(p_type, CASE WHEN ... THEN 'bonus' ELSE 'fee' END).
--          The bare CASE literals resolve to text, which has no common type
--          with the transaction_type enum p_type -> plan-time failure on the
--          first call. (A hotfix had been applied directly to the live DB but
--          never captured as a migration, so the repo/schema had drifted and
--          any rebuild -- DR, staging, a fresh env -- reintroduces the bug.)
--
--   BUG 2 (ck_transactions_amt_nonneg): the function inserted the *signed*
--          p_amount into transactions.amount, but that column is
--          CHECK (amount >= 0). Every debit (negative adjustment) therefore
--          failed. The table convention (confirmed against live data:
--          0 negative rows; withdrawals store a positive amount with
--          type='withdrawal') encodes direction via `type` and via
--          balance_before/after -- never via the sign of `amount`.
--          Fix: store abs(p_amount) for amount and amount_usd; keep signed
--          math for the wallet balance.
--
--   BUG 3 (P0121 / "Not authorized: internal function"): migration 052 gave
--          the enqueue_notification_deliveries() trigger a guard that rejects
--          ANY write made while auth.uid() IS NOT NULL, on the assumption that
--          only service_role/cron (NULL auth.uid()) ever writes notifications.
--          But the capability-gated admin RPCs admin_adjust_balance,
--          admin_send_announcement and admin_review_kyc legitimately insert a
--          user notification while running under the admin's JWT -> the guard
--          blocked every admin-originated notification. This is a systemic
--          regression, not specific to adjust-balance.
--          Fix: keep blocking raw end-user writes, but allow the insert when a
--          trusted SECURITY DEFINER RPC has opted in via a transaction-local
--          GUC (app.internal_notify='on'). End users cannot set this GUC
--          (no arbitrary SQL over PostgREST) and still cannot insert into
--          notifications (RLS/grants + the guard), so the abuse control the
--          052 guard was defending is preserved.
-- ---------------------------------------------------------------------------

BEGIN;

-- 1) Relax the notification trigger guard: allow trusted internal opt-in.
CREATE OR REPLACE FUNCTION public.enqueue_notification_deliveries()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email      TEXT;
  v_phone      TEXT;
  v_email_pref BOOLEAN;
  v_sms_pref   BOOLEAN;
  v_def_email  BOOLEAN := FALSE;
  v_def_sms    BOOLEAN := FALSE;
BEGIN
  -- [052 defense-in-depth, relaxed in 062] Reject raw end-user writes
  -- (auth.uid() present) UNLESS a trusted SECURITY DEFINER RPC has opted in
  -- for this transaction via set_config('app.internal_notify','on',true).
  -- service_role/postgres/cron still pass on the NULL-auth.uid() branch.
  IF auth.uid() IS NOT NULL
     AND COALESCE(current_setting('app.internal_notify', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
  SELECT phone_number, email_notifications, sms_notifications
    INTO v_phone, v_email_pref, v_sms_pref
    FROM public.profiles WHERE id = NEW.user_id;
  SELECT email, sms INTO v_def_email, v_def_sms
    FROM public.notification_channel_defaults WHERE type = NEW.type;

  -- Email delivery: policy on + user opted in (default on) + address present.
  IF COALESCE(v_def_email, FALSE) AND COALESCE(v_email_pref, TRUE) AND v_email IS NOT NULL THEN
    INSERT INTO public.notification_deliveries (notification_id, user_id, channel, destination)
    VALUES (NEW.id, NEW.user_id, 'email', v_email)
    ON CONFLICT (notification_id, channel) DO NOTHING;
  END IF;

  -- SMS delivery: policy on + user opted in (default on) + phone present.
  IF COALESCE(v_def_sms, FALSE) AND COALESCE(v_sms_pref, TRUE) AND v_phone IS NOT NULL THEN
    INSERT INTO public.notification_deliveries (notification_id, user_id, channel, destination)
    VALUES (NEW.id, NEW.user_id, 'sms', v_phone)
    ON CONFLICT (notification_id, channel) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) admin_adjust_balance: enum-cast COALESCE (Bug 1), non-negative amount
--    (Bug 2), and trusted notify opt-in (Bug 3).
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(p_user_id uuid, p_currency currency_code, p_amount numeric, p_reason text, p_type transaction_type DEFAULT NULL::transaction_type)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_rate   NUMERIC;
  v_before NUMERIC;
  v_after  NUMERIC;
  v_type   transaction_type;
BEGIN
  IF NOT public.has_capability('users:update') THEN
    RAISE EXCEPTION 'Insufficient permissions (users:update required)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_amount = 0 THEN RAISE EXCEPTION 'Adjustment amount must be non-zero'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required for a balance adjustment';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets
  WHERE user_id = p_user_id AND currency = p_currency FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found for % / %', p_user_id, p_currency; END IF;

  v_before := v_wallet.available_balance;
  v_after  := v_before + p_amount;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Adjustment would make balance negative (have %, delta %)', v_before, p_amount;
  END IF;

  IF p_currency = 'USD' THEN
    v_rate := 1;
  ELSE
    SELECT rate INTO v_rate FROM public.exchange_rates
    WHERE from_currency = p_currency AND to_currency = 'USD'
    ORDER BY fetched_at DESC NULLS LAST LIMIT 1;
  END IF;
  IF v_rate IS NULL THEN RAISE EXCEPTION 'No USD exchange rate for %', p_currency; END IF;

  -- Bug 1 (42804): cast the CASE result to transaction_type so both COALESCE
  -- operands share the enum type (bare 'bonus'/'fee' literals are text).
  v_type := COALESCE(p_type, (CASE WHEN p_amount >= 0 THEN 'bonus' ELSE 'fee' END)::transaction_type);

  UPDATE public.wallets SET available_balance = v_after, updated_at = NOW()
  WHERE id = v_wallet.id;

  -- Bug 2: transactions.amount is CHECK (amount >= 0); direction is carried by
  -- `type` + balance_before/after. Store the magnitude, not the signed delta.
  INSERT INTO public.transactions (
    user_id, wallet_id, type, status, amount, currency, amount_usd,
    exchange_rate_to_usd, balance_before, balance_after, description, notes, completed_at
  ) VALUES (
    p_user_id, v_wallet.id, v_type, 'completed', abs(p_amount), p_currency, abs(p_amount) * v_rate,
    v_rate, v_before, v_after, 'Admin balance adjustment', p_reason, NOW()
  );

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    auth.uid(), 'user.balance_adjust', 'wallet', v_wallet.id,
    jsonb_build_object('available_balance', v_before),
    jsonb_build_object('available_balance', v_after, 'delta', p_amount, 'currency', p_currency, 'reason', p_reason)
  );

  -- Bug 3: opt in to the notification trigger for this trusted admin write,
  -- then reset immediately (also auto-reset at txn end / on rollback).
  PERFORM set_config('app.internal_notify', 'on', true);
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    p_user_id, 'system_announcement',
    CASE WHEN p_amount >= 0 THEN 'Balance credited' ELSE 'Balance adjusted' END,
    format('Your %s balance was adjusted by %s.', p_currency, p_amount),
    jsonb_build_object('delta', p_amount, 'currency', p_currency)
  );
  PERFORM set_config('app.internal_notify', 'off', true);

  RETURN jsonb_build_object('success', TRUE, 'wallet_id', v_wallet.id,
    'balance_before', v_before, 'balance_after', v_after);
END;
$function$;

-- 3) admin_send_announcement: same trusted notify opt-in (Bug 4).
CREATE OR REPLACE FUNCTION public.admin_send_announcement(p_id uuid)
 RETURNS announcements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row   public.announcements%ROWTYPE;
  v_count INT := 0;
BEGIN
  IF NOT public.has_capability('announcements:send') THEN
    RAISE EXCEPTION 'Insufficient permissions (announcements:send required)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_row FROM public.announcements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Announcement not found' USING ERRCODE = 'no_data_found'; END IF;
  IF v_row.status NOT IN ('draft','scheduled') THEN
    -- Idempotent: already sent/sending/cancelled -> no double delivery.
    RETURN v_row;
  END IF;

  -- In-app delivery: one notification per matching recipient (trusted write).
  PERFORM set_config('app.internal_notify', 'on', true);
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT r, 'system_announcement', v_row.title, v_row.body,
         jsonb_build_object('announcement_id', v_row.id, 'channels', v_row.channels)
  FROM public.announcement_recipients(v_row.audience) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.internal_notify', 'off', true);

  UPDATE public.announcements SET
    status = 'sent', sent_at = NOW(), recipient_count = v_count, updated_at = NOW()
  WHERE id = p_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_data)
  VALUES (auth.uid(), 'announcement.send', 'announcement', p_id,
          jsonb_build_object('recipient_count', v_count, 'channels', v_row.channels));
  RETURN v_row;
END;
$function$;

-- 4) admin_review_kyc: same trusted notify opt-in (Bug 4).
CREATE OR REPLACE FUNCTION public.admin_review_kyc(p_doc_id uuid, p_status kyc_status, p_reviewer_id uuid, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc public.kyc_documents%ROWTYPE;
BEGIN
  -- [052 defense-in-depth] require the kyc:review capability.
  IF NOT public.has_capability('kyc:review') THEN
    RAISE EXCEPTION 'Insufficient permissions (kyc:review required)' USING ERRCODE = 'P0121';
  END IF;
  SELECT * INTO v_doc FROM public.kyc_documents
  WHERE id = p_doc_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KYC document not found';
  END IF;

  UPDATE public.kyc_documents SET
    status = p_status,
    reviewed_by = p_reviewer_id,
    reviewed_at = NOW(),
    rejection_reason = p_rejection_reason,
    updated_at = NOW()
  WHERE id = p_doc_id;

  -- Update profile KYC status
  UPDATE public.profiles SET
    kyc_status = p_status,
    kyc_completed_at = CASE WHEN p_status = 'verified' THEN NOW() ELSE kyc_completed_at END,
    updated_at = NOW()
  WHERE id = v_doc.user_id;

  -- Notification (trusted write).
  PERFORM set_config('app.internal_notify', 'on', true);
  -- Bug 5 (same enum/text family as Bug 1): the notification `type` column is
  -- the notification_type enum, but a bare CASE resolves to text and will not
  -- coerce ("column type is of type notification_type but expression is text").
  -- Cast the CASE result to the enum. (This surfaced only after Bug 3's guard
  -- fix let execution reach the notification INSERT.)
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_doc.user_id,
    (CASE WHEN p_status = 'verified' THEN 'kyc_approved' ELSE 'kyc_rejected' END)::notification_type,
    CASE WHEN p_status = 'verified' THEN '✅ Identity Verified' ELSE '⛔ KYC Rejected' END,
    CASE WHEN p_status = 'verified'
      THEN 'Your identity has been verified. You now have full platform access.'
      ELSE COALESCE('Rejection reason: ' || p_rejection_reason, 'Your KYC was rejected. Please resubmit.')
    END,
    jsonb_build_object(
      'kyc_doc_id', p_doc_id,
      'status', p_status,
      'rejection_reason', p_rejection_reason
    )
  );
  PERFORM set_config('app.internal_notify', 'off', true);

  -- Audit log
  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_data)
  VALUES (
    p_reviewer_id,
    'kyc_review',
    'kyc_documents',
    p_doc_id,
    jsonb_build_object('status', p_status, 'reason', p_rejection_reason)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'user_id', v_doc.user_id,
    'status', p_status
  );
END;
$function$;

COMMIT;
