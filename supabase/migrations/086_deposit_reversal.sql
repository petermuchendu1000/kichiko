-- 086_deposit_reversal.sql — a chargeback after a credit is clawed back (audit 6.30).
--
-- Before: a PesaPal REVERSED status (chargeback) after the deposit was
-- credited called fail_deposit, which returns early for completed deposits:
-- the user kept the money and could withdraw it.
--
-- After: reverse_deposit(deposit, reason, raw)
--   * completed deposit: debit the wallet's available balance by the deposit
--     amount; what it cannot cover is the SHORTFALL (spent or reserved), and
--     the account is SUSPENDED so the unbacked balance cannot leave (withdraw
--     and trading routes refuse a non-active account). The deposit becomes
--     'refunded', its ledger transaction 'refunded', and a reversal
--     transaction records what was taken back. Audited; the user is notified.
--   * not yet credited: same as fail_deposit.
--   * already reversed: no-op (idempotent).
-- credit_deposit never credits a 'refunded' (reversed) deposit again.
BEGIN;

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
    v_deposit.amount::text || ' ' || v_deposit.currency::text || ' has been added to your account.',
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
          'Your deposit of ' || v_dep.amount::text || ' ' || v_dep.currency::text ||
          ' was reversed by the payment provider and has been removed from your balance.'
          || CASE WHEN v_short > 0 THEN ' Your account is on hold; please contact support.' ELSE '' END,
          jsonb_build_object('deposit_id', v_dep.id, 'debited', v_debit, 'shortfall', v_short));

  RETURN jsonb_build_object('reversed', true, 'deposit_id', v_dep.id, 'debited', v_debit,
                            'shortfall', v_short, 'account_suspended', v_short > 0);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reverse_deposit(uuid, text, jsonb) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_deposit(uuid, text, jsonb) TO service_role;

COMMIT;
