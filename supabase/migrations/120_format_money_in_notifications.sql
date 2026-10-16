-- 120_format_money_in_notifications.sql
-- ---------------------------------------------------------------------------
-- Notification copy said "100.00 KES". Everything else says "KSh 100.00".
--
-- WHY IT MATTERED ENOUGH TO TOUCH MONEY-PATH FUNCTIONS
--
-- Seen side by side in the new branded withdrawal email, the mismatch is
-- obvious and it reads as two systems stitched together:
--
--     Your withdrawal of 100.00 KES could not be completed...   <- body, from SQL
--     REFUNDED TO YOUR WALLET
--     KSh 100.00                                                <- figure, from the app
--
-- The app has formatted money as "KSh 1,234.56" everywhere since
-- lib/currency.ts: our own symbol plus a grouped number, specifically because
-- Intl's en-KE currency style renders KES as "Ksh" and put "KSh 500" next to
-- "Ksh 636.56" on the same ticket. The notification bodies never got that
-- treatment — they concatenated `amount::text || ' ' || currency::text`, which
-- also prints an unformatted "1234.50" with no thousands separator.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
--
-- `format_money()` is added, and the FOUR live functions that compose
-- notification bodies call it instead of concatenating. Those four were found
-- by searching pg_get_functiondef() over the live catalogue, not by reading
-- migration files in order — the same function is redefined in several
-- migrations (005/052/086 all define credit_deposit) and only the last one
-- applied is real.
--
-- Each function body below is the LIVE definition with exactly that one
-- expression substituted. Nothing else in them is touched: these are
-- SECURITY DEFINER money-path functions, and retyping them by hand to change a
-- string would be the riskiest possible way to fix a cosmetic bug.
--
-- Symbols match CURRENCY_META in lib/currency.ts exactly (KSh/USh/TSh/FRw/ZK/
-- Br/FBu/$), so the email body and the figure beneath it cannot disagree.

CREATE OR REPLACE FUNCTION public.format_money(p_amount NUMERIC, p_currency currency_code)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  -- to_char's FM strips the padding it would otherwise add; 'FM999,999,999,990.00'
  -- keeps one leading zero and always two decimals, so 0.5 -> "0.50" and
  -- 1234.5 -> "1,234.50".
  SELECT CASE p_currency
           WHEN 'KES' THEN 'KSh' WHEN 'UGX' THEN 'USh' WHEN 'TZS' THEN 'TSh'
           WHEN 'RWF' THEN 'FRw' WHEN 'ZMW' THEN 'ZK'  WHEN 'ETB' THEN 'Br'
           WHEN 'BIF' THEN 'FBu' ELSE '$'
         END || ' ' || to_char(COALESCE(p_amount, 0), 'FM999,999,999,990.00');
$fn$;

COMMENT ON FUNCTION public.format_money(NUMERIC, currency_code) IS
  'Money as the product shows it: symbol + grouped amount ("KSh 1,234.56"). Symbols match CURRENCY_META in lib/currency.ts. Use in any user-facing string composed in SQL. See 120.';

GRANT EXECUTE ON FUNCTION public.format_money(NUMERIC, currency_code) TO anon, authenticated, service_role;

-- complete_withdrawal: body is the live definition, one expression substituted.
CREATE OR REPLACE FUNCTION public.complete_withdrawal(p_withdrawal_id uuid, p_provider_reference text DEFAULT NULL::text, p_provider_receipt text DEFAULT NULL::text, p_raw_response jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_w public.withdrawals%ROWTYPE;
BEGIN
  -- [052 defense-in-depth] belt-and-suspenders behind the 051 REVOKE: even if
  -- EXECUTE is ever re-granted to a client role, an end-user JWT without the
  -- 'finance:withdrawals' capability cannot call this. service_role/cron (auth.uid() IS NULL)
  -- and the admin wrapper (holder of the capability) pass through.
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('finance:withdrawals') THEN
    RAISE EXCEPTION 'Not authorized (requires finance:withdrawals)' USING ERRCODE = 'P0121';
  END IF;
  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found' USING ERRCODE = 'P0010';
  END IF;

  IF v_w.status = 'completed' THEN
    RETURN jsonb_build_object('completed', false, 'already_processed', true, 'status', 'completed');
  END IF;
  IF v_w.status = 'failed' THEN
    RAISE EXCEPTION 'Cannot complete a failed (refunded) withdrawal' USING ERRCODE = 'P0013';
  END IF;

  -- Release the reserve and tally total_withdrawn. available_balance was
  -- already debited at reserve time → the payout leaves the wallet exactly once.
  UPDATE public.wallets SET
    reserved_balance = reserved_balance - v_w.amount,
    total_withdrawn  = total_withdrawn  + v_w.amount,
    updated_at       = now()
  WHERE id = v_w.wallet_id;

  UPDATE public.withdrawals SET
    status             = 'completed',
    provider_reference = COALESCE(p_provider_reference, provider_reference),
    provider_receipt   = COALESCE(p_provider_receipt, provider_receipt),
    raw_response       = p_raw_response,
    completed_at       = now(),
    updated_at         = now()
  WHERE id = p_withdrawal_id;

  UPDATE public.transactions SET
    status             = 'completed',
    completed_at       = now(),
    provider_reference = COALESCE(p_provider_reference, provider_reference),
    payment_reference  = COALESCE(p_provider_receipt, payment_reference),
    updated_at         = now()
  WHERE idempotency_key = 'withdraw_' || p_withdrawal_id::text;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_w.user_id, 'withdrawal_completed', 'Withdrawal Successful',
    public.format_money(v_w.net_amount, v_w.currency) || ' has been sent to ' || v_w.phone_number || '.',
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id, 'amount', v_w.amount,
      'net_amount', v_w.net_amount, 'currency', v_w.currency, 'receipt', p_provider_receipt
    )
  );

  RETURN jsonb_build_object('completed', true, 'already_processed', false, 'withdrawal_id', p_withdrawal_id);
END;
$function$;

-- credit_deposit: body is the live definition, one expression substituted.
CREATE OR REPLACE FUNCTION public.credit_deposit(p_deposit_id uuid, p_amount_usd numeric, p_exchange_rate numeric, p_provider_receipt text DEFAULT NULL::text, p_raw_callback jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deposit    public.deposits%ROWTYPE;
  v_wallet     public.wallets%ROWTYPE;
  v_bal_before numeric;
  v_bal_after  numeric;
  v_txn_id     uuid;
  v_idem       text;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  -- 1. Lock the deposit row: concurrent callbacks for the same deposit queue here.
  SELECT * INTO v_deposit FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit not found' USING ERRCODE = 'P0010';
  END IF;

  -- [086] a reversed (charged-back) deposit is never credited again by a
  -- late or replayed success status
  IF v_deposit.status = 'refunded' THEN
    RETURN jsonb_build_object(
      'credited', false, 'already_processed', true,
      'deposit_id', p_deposit_id, 'status', 'refunded'
    );
  END IF;

  -- 2. Idempotency: already credited → no-op.
  IF v_deposit.status = 'completed' THEN
    RETURN jsonb_build_object(
      'credited', false, 'already_processed', true,
      'deposit_id', p_deposit_id, 'status', 'completed'
    );
  END IF;

  -- 3. Lock the wallet and credit it.
  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_deposit.wallet_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found for deposit' USING ERRCODE = 'P0011';
  END IF;

  v_idem       := COALESCE(p_idempotency_key, 'deposit_' || p_deposit_id::text);
  v_bal_before := v_wallet.available_balance;
  v_bal_after  := v_bal_before + v_deposit.amount;

  UPDATE public.deposits SET
    status               = 'completed',
    confirmed_at         = now(),
    provider_receipt     = COALESCE(p_provider_receipt, provider_receipt),
    exchange_rate_to_usd = COALESCE(p_exchange_rate, exchange_rate_to_usd),
    raw_callback         = p_raw_callback,
    updated_at           = now()
  WHERE id = p_deposit_id;

  UPDATE public.wallets SET
    available_balance = available_balance + v_deposit.amount,
    total_deposited   = total_deposited   + v_deposit.amount,  -- correct increment
    updated_at        = now()
  WHERE id = v_deposit.wallet_id;

  INSERT INTO public.transactions (
    user_id, wallet_id, type, status, amount, currency, amount_usd,
    exchange_rate_to_usd, balance_before, balance_after, payment_reference,
    payment_provider, payment_phone, payment_metadata, description,
    idempotency_key, initiated_at, completed_at
  ) VALUES (
    v_deposit.user_id, v_deposit.wallet_id, 'deposit', 'completed',
    v_deposit.amount, v_deposit.currency, p_amount_usd, p_exchange_rate,
    v_bal_before, v_bal_after, p_provider_receipt, v_deposit.provider,
    v_deposit.phone_number, p_raw_callback,
    'Deposit via ' || v_deposit.provider::text,
    v_idem, now(), now()
  )
  RETURNING id INTO v_txn_id;

  UPDATE public.deposits SET transaction_id = v_txn_id WHERE id = p_deposit_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_deposit.user_id, 'deposit_completed', 'Deposit Confirmed',
    public.format_money(v_deposit.amount, v_deposit.currency) || ' has been added to your account.',
    jsonb_build_object(
      'amount', v_deposit.amount, 'currency', v_deposit.currency,
      'deposit_id', p_deposit_id, 'receipt', p_provider_receipt
    )
  );

  RETURN jsonb_build_object(
    'credited', true, 'already_processed', false,
    'deposit_id', p_deposit_id, 'transaction_id', v_txn_id,
    'amount', v_deposit.amount, 'currency', v_deposit.currency,
    'balance_before', v_bal_before, 'balance_after', v_bal_after
  );

EXCEPTION
  -- Defense-in-depth: a duplicate idempotency_key means another path already
  -- recorded this credit. The whole block rolls back → no double credit.
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'credited', false, 'already_processed', true,
      'deposit_id', p_deposit_id, 'status', 'completed',
      'note', 'idempotency_key conflict'
    );
END;
$function$;

-- fail_withdrawal: body is the live definition, one expression substituted.
CREATE OR REPLACE FUNCTION public.fail_withdrawal(p_withdrawal_id uuid, p_reason text, p_raw_response jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_w public.withdrawals%ROWTYPE;
BEGIN
  -- [052 defense-in-depth] belt-and-suspenders behind the 051 REVOKE: even if
  -- EXECUTE is ever re-granted to a client role, an end-user JWT without the
  -- 'finance:withdrawals' capability cannot call this. service_role/cron (auth.uid() IS NULL)
  -- and the admin wrapper (holder of the capability) pass through.
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('finance:withdrawals') THEN
    RAISE EXCEPTION 'Not authorized (requires finance:withdrawals)' USING ERRCODE = 'P0121';
  END IF;
  SELECT * INTO v_w FROM public.withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found' USING ERRCODE = 'P0010';
  END IF;

  -- Never refund a completed payout, never double-refund a failed one.
  IF v_w.status = 'completed' THEN
    RETURN jsonb_build_object('failed', false, 'already_processed', true, 'note', 'already completed');
  END IF;
  IF v_w.status = 'failed' THEN
    RETURN jsonb_build_object('failed', false, 'already_processed', true);
  END IF;

  -- Refund: move the reserved funds back to available.
  UPDATE public.wallets SET
    reserved_balance  = reserved_balance  - v_w.amount,
    available_balance = available_balance + v_w.amount,
    updated_at        = now()
  WHERE id = v_w.wallet_id;

  UPDATE public.withdrawals SET
    status         = 'failed',
    failure_reason = p_reason,
    raw_response   = p_raw_response,
    failed_at      = now(),
    updated_at     = now()
  WHERE id = p_withdrawal_id;

  UPDATE public.transactions SET
    status     = 'failed',
    failed_at  = now(),
    notes      = p_reason,
    updated_at = now()
  WHERE idempotency_key = 'withdraw_' || p_withdrawal_id::text;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_w.user_id, 'withdrawal_failed', 'Withdrawal Failed',
    'Your withdrawal of ' || public.format_money(v_w.amount, v_w.currency) ||
    ' could not be completed and has been refunded to your wallet.',
    jsonb_build_object('withdrawal_id', p_withdrawal_id, 'amount', v_w.amount, 'currency', v_w.currency, 'reason', p_reason)
  );

  RETURN jsonb_build_object('failed', true, 'already_processed', false, 'withdrawal_id', p_withdrawal_id, 'refunded', v_w.amount);
END;
$function$;

-- reverse_deposit: body is the live definition, one expression substituted.
CREATE OR REPLACE FUNCTION public.reverse_deposit(p_deposit_id uuid, p_reason text, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dep    public.deposits%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_debit  numeric;
  v_short  numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('finance:deposits') THEN
    RAISE EXCEPTION 'Not authorized (requires finance:deposits)' USING ERRCODE = 'P0121';
  END IF;
  SELECT * INTO v_dep FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deposit not found' USING ERRCODE = 'P0010'; END IF;

  IF v_dep.status = 'refunded' THEN
    RETURN jsonb_build_object('reversed', false, 'already_processed', true, 'deposit_id', v_dep.id);
  END IF;
  IF v_dep.status <> 'completed' THEN
    -- never credited: nothing to take back
    RETURN public.fail_deposit(v_dep.id, 'reversed: ' || COALESCE(p_reason, 'chargeback'), COALESCE(p_raw, '{}'::jsonb))
           || jsonb_build_object('reversed', false);
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = v_dep.wallet_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found for deposit' USING ERRCODE = 'P0011'; END IF;

  v_debit := LEAST(v_dep.amount, GREATEST(v_wallet.available_balance, 0));
  v_short := v_dep.amount - v_debit;

  UPDATE public.wallets
     SET available_balance = available_balance - v_debit,
         total_deposited   = GREATEST(total_deposited - v_dep.amount, 0),
         updated_at        = now()
   WHERE id = v_wallet.id;

  UPDATE public.deposits
     SET status = 'refunded', failure_reason = 'reversed: ' || COALESCE(p_reason, 'chargeback'),
         raw_callback = COALESCE(raw_callback, '{}'::jsonb) || jsonb_build_object('reversal', COALESCE(p_raw, '{}'::jsonb)),
         updated_at = now()
   WHERE id = v_dep.id;

  UPDATE public.transactions SET status = 'refunded', notes = 'reversed: ' || COALESCE(p_reason, 'chargeback'), updated_at = now()
   WHERE id = v_dep.transaction_id;

  INSERT INTO public.transactions (
    user_id, wallet_id, type, status, amount, currency, amount_usd, exchange_rate_to_usd,
    balance_before, balance_after, payment_provider, description, notes, idempotency_key, initiated_at, completed_at
  ) VALUES (
    v_dep.user_id, v_wallet.id, 'deposit', 'refunded', v_debit, v_dep.currency,
    v_debit * COALESCE(v_dep.exchange_rate_to_usd, 0), v_dep.exchange_rate_to_usd,
    v_wallet.available_balance, v_wallet.available_balance - v_debit, v_dep.provider,
    'Deposit reversed (chargeback)', 'shortfall ' || v_short::text, 'reversal_' || v_dep.id::text, now(), now()
  );

  IF v_short > 0 THEN
    UPDATE public.profiles SET account_status = 'suspended', updated_at = now()
     WHERE id = v_dep.user_id AND account_status = 'active';
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'deposit.reversed', 'deposit', v_dep.id,
          jsonb_build_object('status', 'completed', 'available_balance', v_wallet.available_balance),
          jsonb_build_object('status', 'refunded', 'debited', v_debit, 'shortfall', v_short,
                             'account_suspended', v_short > 0, 'reason', p_reason));

  PERFORM set_config('app.internal_notify', 'on', true);
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (v_dep.user_id, 'system_announcement', 'Deposit reversed',
          'Your deposit of ' || public.format_money(v_dep.amount, v_dep.currency) ||
          ' was reversed by the payment provider and has been removed from your balance.'
          || CASE WHEN v_short > 0 THEN ' Your account is on hold; please contact support.' ELSE '' END,
          jsonb_build_object('deposit_id', v_dep.id, 'debited', v_debit, 'shortfall', v_short));

  RETURN jsonb_build_object('reversed', true, 'deposit_id', v_dep.id, 'debited', v_debit,
                            'shortfall', v_short, 'account_suspended', v_short > 0);
END;
$function$;
