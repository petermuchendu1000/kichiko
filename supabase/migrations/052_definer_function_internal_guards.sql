-- 052_definer_function_internal_guards.sql
-- Defense-in-depth guards inside the 27 internal SECURITY DEFINER functions that
-- migration 051 revoked from client roles. 051 (REVOKE) is the primary control;
-- these in-body guards are belt-and-suspenders so a future accidental re-GRANT
-- (or a blanket grant like the historical 032) cannot reopen the hole.
--
-- Three guard shapes (CREATE OR REPLACE preserves the 051 grant lockdown):
--   * internal service_role/cron primitives -> reject any end-user JWT
--     (auth.uid() IS NOT NULL); service_role/postgres have NULL auth.uid().
--   * functions also invoked by an admin_* wrapper in a user-JWT context
--     (fail_deposit, *_withdrawal, resolve_market*, cancel_market) -> reject a
--     JWT that lacks the wrapper's capability, so admin + service_role pass.
--   * admin_review_kyc -> require has_capability('kyc:review') (was missing the
--     guard its admin_* siblings all have).
-- All raise SQLSTATE P0121 (mapped to HTTP 403 in lib/clob.ts).

-- credit_deposit (internal)
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
$function$
;

-- fail_deposit (cap:finance:deposits)
CREATE OR REPLACE FUNCTION public.fail_deposit(p_deposit_id uuid, p_reason text, p_raw_callback jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status transaction_status;
BEGIN
  -- [052 defense-in-depth] belt-and-suspenders behind the 051 REVOKE: even if
  -- EXECUTE is ever re-granted to a client role, an end-user JWT without the
  -- 'finance:deposits' capability cannot call this. service_role/cron (auth.uid() IS NULL)
  -- and the admin wrapper (holder of the capability) pass through.
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('finance:deposits') THEN
    RAISE EXCEPTION 'Not authorized (requires finance:deposits)' USING ERRCODE = 'P0121';
  END IF;
  SELECT status INTO v_status FROM public.deposits WHERE id = p_deposit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit not found' USING ERRCODE = 'P0010';
  END IF;

  -- Never mark a completed (already-credited) deposit as failed.
  IF v_status = 'completed' THEN
    RETURN jsonb_build_object('failed', false, 'already_processed', true);
  END IF;

  UPDATE public.deposits SET
    status         = 'failed',
    failed_at      = now(),
    failure_reason = p_reason,
    raw_callback   = p_raw_callback,
    updated_at     = now()
  WHERE id = p_deposit_id;

  RETURN jsonb_build_object('failed', true, 'deposit_id', p_deposit_id);
END;
$function$
;

-- complete_withdrawal (cap:finance:withdrawals)
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
    v_w.net_amount::text || ' ' || v_w.currency::text || ' has been sent to ' || v_w.phone_number || '.',
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id, 'amount', v_w.amount,
      'net_amount', v_w.net_amount, 'currency', v_w.currency, 'receipt', p_provider_receipt
    )
  );

  RETURN jsonb_build_object('completed', true, 'already_processed', false, 'withdrawal_id', p_withdrawal_id);
END;
$function$
;

-- fail_withdrawal (cap:finance:withdrawals)
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
    'Your withdrawal of ' || v_w.amount::text || ' ' || v_w.currency::text ||
    ' could not be completed and has been refunded to your wallet.',
    jsonb_build_object('withdrawal_id', p_withdrawal_id, 'amount', v_w.amount, 'currency', v_w.currency, 'reason', p_reason)
  );

  RETURN jsonb_build_object('failed', true, 'already_processed', false, 'withdrawal_id', p_withdrawal_id, 'refunded', v_w.amount);
END;
$function$
;

-- request_withdrawal (internal)
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_user_id uuid, p_wallet_id uuid, p_amount numeric, p_amount_usd numeric, p_exchange_rate numeric, p_fee_amount numeric, p_provider payment_provider, p_phone text, p_requires_review boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wallet        public.wallets%ROWTYPE;
  v_withdrawal_id uuid;
  v_txn_id        uuid;
  v_net           numeric;
  v_status        transaction_status;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the wallet: the balance check + reserve below are now atomic, so two
  -- concurrent withdrawals can never both pass the check and overdraw.
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found' USING ERRCODE = 'P0011';
  END IF;
  IF NOT COALESCE(v_wallet.is_active, true) THEN
    RAISE EXCEPTION 'Wallet is inactive' USING ERRCODE = 'P0012';
  END IF;
  IF v_wallet.available_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance' USING ERRCODE = 'P0006';
  END IF;

  v_net    := p_amount - COALESCE(p_fee_amount, 0);
  v_status := CASE WHEN p_requires_review THEN 'pending' ELSE 'processing' END::transaction_status;

  UPDATE public.wallets SET
    available_balance = available_balance - p_amount,
    reserved_balance  = reserved_balance  + p_amount,
    updated_at        = now()
  WHERE id = p_wallet_id;

  INSERT INTO public.withdrawals (
    user_id, wallet_id, status, provider, amount, currency, phone_number,
    exchange_rate_to_usd, fee_amount, requires_review, initiated_at
  ) VALUES (
    p_user_id, p_wallet_id, v_status, p_provider, p_amount, v_wallet.currency, p_phone,
    p_exchange_rate, COALESCE(p_fee_amount, 0), p_requires_review, now()
  )
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO public.transactions (
    user_id, wallet_id, type, status, amount, currency, amount_usd,
    exchange_rate_to_usd, fee_amount, fee_currency,
    balance_before, balance_after, payment_provider, payment_phone,
    description, idempotency_key, initiated_at
  ) VALUES (
    p_user_id, p_wallet_id, 'withdrawal', 'pending', p_amount, v_wallet.currency, p_amount_usd,
    p_exchange_rate, COALESCE(p_fee_amount, 0), v_wallet.currency,
    v_wallet.available_balance, v_wallet.available_balance - p_amount, p_provider, p_phone,
    'Withdrawal via ' || p_provider::text, 'withdraw_' || v_withdrawal_id::text, now()
  )
  RETURNING id INTO v_txn_id;

  UPDATE public.withdrawals SET transaction_id = v_txn_id WHERE id = v_withdrawal_id;

  RETURN jsonb_build_object(
    'success', true,
    'withdrawal_id', v_withdrawal_id,
    'transaction_id', v_txn_id,
    'status', v_status,
    'amount', p_amount,
    'fee_amount', COALESCE(p_fee_amount, 0),
    'net_amount', v_net,
    'available_balance', v_wallet.available_balance - p_amount,
    'reserved_balance', v_wallet.reserved_balance + p_amount
  );
END;
$function$
;

-- resolve_market (cap:markets:resolve)
CREATE OR REPLACE FUNCTION public.resolve_market(p_market_id uuid, p_outcome order_side, p_resolver_id uuid, p_resolution_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_market public.markets%ROWTYPE;
  v_position RECORD;
  v_wallet public.wallets%ROWTYPE;
  v_payout_usd DECIMAL;
  v_payout_local DECIMAL;
  v_exchange_rate DECIMAL;
  v_total_paid_out DECIMAL := 0;
  v_winners INTEGER := 0;
  v_losers INTEGER := 0;
BEGIN
  -- [052 defense-in-depth] belt-and-suspenders behind the 051 REVOKE: even if
  -- EXECUTE is ever re-granted to a client role, an end-user JWT without the
  -- 'markets:resolve' capability cannot call this. service_role/cron (auth.uid() IS NULL)
  -- and the admin wrapper (holder of the capability) pass through.
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('markets:resolve') THEN
    RAISE EXCEPTION 'Not authorized (requires markets:resolve)' USING ERRCODE = 'P0121';
  END IF;
  -- Lock and fetch market
  SELECT * INTO v_market FROM public.markets
  WHERE id = p_market_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_market.status NOT IN ('active', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be resolved in status: %', v_market.status USING ERRCODE = 'P0002';
  END IF;

  -- Mark market resolved
  UPDATE public.markets SET
    status = 'resolved',
    resolved_outcome = p_outcome,
    resolved_at = NOW(),
    resolver_id = p_resolver_id,
    resolution_notes = p_resolution_notes
  WHERE id = p_market_id;

  -- Process all winning positions
  FOR v_position IN
    SELECT p.*, w.currency, w.available_balance
    FROM public.positions p
    JOIN public.wallets w ON w.id = p.wallet_id
    WHERE p.market_id = p_market_id
    AND p.is_active = TRUE
    AND p.side = p_outcome::text::position_side
  LOOP
    -- Payout = shares * $1 (binary outcome)
    v_payout_usd := v_position.shares;

    -- Get exchange rate
    SELECT rate INTO v_exchange_rate FROM public.exchange_rates
    WHERE from_currency = v_position.currency AND to_currency = 'USD';

    v_payout_local := v_payout_usd / v_exchange_rate;

    -- Credit wallet (move from reserved to available + add winnings)
    UPDATE public.wallets SET
      available_balance = available_balance + v_payout_local
        + (v_position.total_invested_usd / v_exchange_rate), -- return initial bet too (reserved)
      reserved_balance = GREATEST(0, reserved_balance - (v_position.total_invested_usd / v_exchange_rate)),
      total_won = total_won + v_payout_usd,
      updated_at = NOW()
    WHERE id = v_position.wallet_id;

    -- Update position
    UPDATE public.positions SET
      is_active = FALSE,
      realized_pnl_usd = v_payout_usd - v_position.total_invested_usd,
      total_payout_usd = v_payout_usd + v_position.total_invested_usd,
      claimed_at = NOW(),
      updated_at = NOW()
    WHERE id = v_position.id;

    -- Transaction record
    INSERT INTO public.transactions (
      user_id, wallet_id, type, status,
      amount, currency, amount_usd, exchange_rate_to_usd,
      balance_before, balance_after,
      market_id, description, idempotency_key
    ) VALUES (
      v_position.user_id, v_position.wallet_id, 'bet_won', 'completed',
      v_payout_local + (v_position.total_invested_usd / v_exchange_rate),
      v_position.currency, v_payout_usd + v_position.total_invested_usd, v_exchange_rate,
      v_position.available_balance,
      v_position.available_balance + v_payout_local + (v_position.total_invested_usd / v_exchange_rate),
      p_market_id,
      FORMAT('Won: %s - %s', v_market.title, UPPER(p_outcome::TEXT)),
      FORMAT('win_%s_%s', p_market_id, v_position.user_id)
    );

    -- Notification
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_position.user_id, 'bet_won',
      '🎉 You Won!',
      FORMAT('Your %s prediction on "%s" was correct! +%s USD', UPPER(p_outcome::TEXT), v_market.title, ROUND(v_payout_usd, 2)),
      jsonb_build_object('market_id', p_market_id, 'payout_usd', v_payout_usd)
    );

    v_total_paid_out := v_total_paid_out + v_payout_usd;
    v_winners := v_winners + 1;
  END LOOP;

  -- Mark losing positions
  FOR v_position IN
    SELECT p.*, w.currency, w.available_balance
    FROM public.positions p
    JOIN public.wallets w ON w.id = p.wallet_id
    WHERE p.market_id = p_market_id
    AND p.is_active = TRUE
    AND p.side <> p_outcome::text::position_side
  LOOP
    -- Get exchange rate for reserved balance release
    SELECT rate INTO v_exchange_rate FROM public.exchange_rates
    WHERE from_currency = v_position.currency AND to_currency = 'USD';

    -- Release reserved balance (already deducted when bet placed)
    UPDATE public.wallets SET
      reserved_balance = GREATEST(0, reserved_balance - (v_position.total_invested_usd / v_exchange_rate)),
      total_lost = total_lost + v_position.total_invested_usd,
      updated_at = NOW()
    WHERE id = v_position.wallet_id;

    -- Update position
    UPDATE public.positions SET
      is_active = FALSE,
      realized_pnl_usd = -v_position.total_invested_usd,
      total_payout_usd = 0,
      claimed_at = NOW(),
      updated_at = NOW()
    WHERE id = v_position.id;

    -- Transaction record
    INSERT INTO public.transactions (
      user_id, wallet_id, type, status,
      amount, currency, amount_usd, exchange_rate_to_usd,
      balance_before, balance_after,
      market_id, description, idempotency_key
    ) VALUES (
      v_position.user_id, v_position.wallet_id, 'bet_lost', 'completed',
      0, v_position.currency, 0, v_exchange_rate,
      v_position.available_balance, v_position.available_balance,
      p_market_id,
      FORMAT('Lost: %s', v_market.title),
      FORMAT('lose_%s_%s', p_market_id, v_position.user_id)
    );

    -- Notification
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_position.user_id, 'bet_lost',
      '📉 Prediction Incorrect',
      FORMAT('Your %s prediction on "%s" did not win this time.',
        CASE WHEN v_position.side = 'yes' THEN 'YES' ELSE 'NO' END, v_market.title),
      jsonb_build_object('market_id', p_market_id)
    );

    v_losers := v_losers + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'market_id', p_market_id,
    'outcome', p_outcome,
    'winners', v_winners,
    'losers', v_losers,
    'total_paid_out_usd', v_total_paid_out
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$function$
;

-- resolve_market_options (cap:markets:resolve)
CREATE OR REPLACE FUNCTION public.resolve_market_options(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_market public.markets%ROWTYPE;
  v_win public.market_options%ROWTYPE;
  v_position RECORD;
  v_exchange_rate DECIMAL;
  v_payout_usd DECIMAL;
  v_payout_local DECIMAL;
  v_total_paid_out DECIMAL := 0;
  v_winners INTEGER := 0;
  v_losers INTEGER := 0;
BEGIN
  -- [052 defense-in-depth] belt-and-suspenders behind the 051 REVOKE: even if
  -- EXECUTE is ever re-granted to a client role, an end-user JWT without the
  -- 'markets:resolve' capability cannot call this. service_role/cron (auth.uid() IS NULL)
  -- and the admin wrapper (holder of the capability) pass through.
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('markets:resolve') THEN
    RAISE EXCEPTION 'Not authorized (requires markets:resolve)' USING ERRCODE = 'P0121';
  END IF;
  SELECT * INTO v_market FROM public.markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001'; END IF;
  IF v_market.status NOT IN ('active', 'closed', 'disputed') THEN
    RAISE EXCEPTION 'Market cannot be resolved in status: %', v_market.status USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_win FROM public.market_options
  WHERE id = p_winning_option_id AND market_id = p_market_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Winning option not found for market' USING ERRCODE = 'P0007'; END IF;

  -- Mark market + option winners
  UPDATE public.markets SET
    status = 'resolved', resolved_option_id = p_winning_option_id,
    resolved_at = NOW(), resolver_id = p_resolver_id, resolution_notes = p_resolution_notes
  WHERE id = p_market_id;

  UPDATE public.market_options
    SET is_winner = (id = p_winning_option_id), updated_at = NOW()
  WHERE market_id = p_market_id;

  -- Winners
  FOR v_position IN
    SELECT p.*, w.currency, w.available_balance
    FROM public.positions p JOIN public.wallets w ON w.id = p.wallet_id
    WHERE p.market_id = p_market_id AND p.is_active = TRUE
      AND p.market_option_id = p_winning_option_id
  LOOP
    v_payout_usd := v_position.shares;
    SELECT rate INTO v_exchange_rate FROM public.exchange_rates
    WHERE from_currency = v_position.currency AND to_currency = 'USD';
    v_payout_local := v_payout_usd / v_exchange_rate;

    UPDATE public.wallets SET
      available_balance = available_balance + v_payout_local + (v_position.total_invested_usd / v_exchange_rate),
      reserved_balance = GREATEST(0, reserved_balance - (v_position.total_invested_usd / v_exchange_rate)),
      total_won = total_won + v_payout_usd,
      updated_at = NOW()
    WHERE id = v_position.wallet_id;

    UPDATE public.positions SET
      is_active = FALSE,
      realized_pnl_usd = v_payout_usd - v_position.total_invested_usd,
      total_payout_usd = v_payout_usd + v_position.total_invested_usd,
      claimed_at = NOW(), updated_at = NOW()
    WHERE id = v_position.id;

    INSERT INTO public.transactions (
      user_id, wallet_id, type, status, amount, currency, amount_usd, exchange_rate_to_usd,
      balance_before, balance_after, market_id, market_option_id, description, idempotency_key
    ) VALUES (
      v_position.user_id, v_position.wallet_id, 'bet_won', 'completed',
      v_payout_local + (v_position.total_invested_usd / v_exchange_rate),
      v_position.currency, v_payout_usd + v_position.total_invested_usd, v_exchange_rate,
      v_position.available_balance,
      v_position.available_balance + v_payout_local + (v_position.total_invested_usd / v_exchange_rate),
      p_market_id, p_winning_option_id,
      FORMAT('Won: %s - %s', v_market.title, v_win.label),
      FORMAT('win_%s_%s', p_market_id, v_position.user_id)
    );

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_position.user_id, 'bet_won', '🎉 You Won!',
      FORMAT('Your pick "%s" on "%s" was correct! +%s USD', v_win.label, v_market.title, ROUND(v_payout_usd, 2)),
      jsonb_build_object('market_id', p_market_id, 'option_id', p_winning_option_id, 'payout_usd', v_payout_usd)
    );

    v_total_paid_out := v_total_paid_out + v_payout_usd;
    v_winners := v_winners + 1;
  END LOOP;

  -- Losers (any other option on this market)
  FOR v_position IN
    SELECT p.*, w.currency, w.available_balance
    FROM public.positions p JOIN public.wallets w ON w.id = p.wallet_id
    WHERE p.market_id = p_market_id AND p.is_active = TRUE
      AND p.market_option_id IS NOT NULL
      AND p.market_option_id <> p_winning_option_id
  LOOP
    SELECT rate INTO v_exchange_rate FROM public.exchange_rates
    WHERE from_currency = v_position.currency AND to_currency = 'USD';

    UPDATE public.wallets SET
      reserved_balance = GREATEST(0, reserved_balance - (v_position.total_invested_usd / v_exchange_rate)),
      total_lost = total_lost + v_position.total_invested_usd,
      updated_at = NOW()
    WHERE id = v_position.wallet_id;

    UPDATE public.positions SET
      is_active = FALSE, realized_pnl_usd = -v_position.total_invested_usd,
      total_payout_usd = 0, claimed_at = NOW(), updated_at = NOW()
    WHERE id = v_position.id;

    INSERT INTO public.transactions (
      user_id, wallet_id, type, status, amount, currency, amount_usd, exchange_rate_to_usd,
      balance_before, balance_after, market_id, market_option_id, description, idempotency_key
    ) VALUES (
      v_position.user_id, v_position.wallet_id, 'bet_lost', 'completed',
      0, v_position.currency, 0, v_exchange_rate,
      v_position.available_balance, v_position.available_balance,
      p_market_id, v_position.market_option_id,
      FORMAT('Lost: %s', v_market.title),
      FORMAT('lose_%s_%s', p_market_id, v_position.user_id)
    );

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_position.user_id, 'bet_lost', '📉 Prediction Incorrect',
      FORMAT('Your pick on "%s" did not win this time.', v_market.title),
      jsonb_build_object('market_id', p_market_id)
    );

    v_losers := v_losers + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE, 'market_id', p_market_id, 'winning_option_id', p_winning_option_id,
    'winners', v_winners, 'losers', v_losers, 'total_paid_out_usd', v_total_paid_out
  );
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$function$
;

-- resolve_market_options_binary (cap:markets:resolve)
CREATE OR REPLACE FUNCTION public.resolve_market_options_binary(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_market public.markets%ROWTYPE;
  v_win public.market_options%ROWTYPE;
  v_position RECORD;
  v_exchange_rate DECIMAL;
  v_payout_usd DECIMAL;
  v_payout_local DECIMAL;
  v_is_winner BOOLEAN;
  v_total_paid_out DECIMAL := 0;
  v_winners INTEGER := 0;
  v_losers INTEGER := 0;
BEGIN
  -- [052 defense-in-depth] belt-and-suspenders behind the 051 REVOKE: even if
  -- EXECUTE is ever re-granted to a client role, an end-user JWT without the
  -- 'markets:resolve' capability cannot call this. service_role/cron (auth.uid() IS NULL)
  -- and the admin wrapper (holder of the capability) pass through.
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('markets:resolve') THEN
    RAISE EXCEPTION 'Not authorized (requires markets:resolve)' USING ERRCODE = 'P0121';
  END IF;
  SELECT * INTO v_market FROM public.markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001'; END IF;
  IF v_market.status NOT IN ('active', 'closed', 'disputed') THEN
    RAISE EXCEPTION 'Market cannot be resolved in status: %', v_market.status USING ERRCODE = 'P0002';
  END IF;
  IF v_market.options_pricing_mode <> 'independent' THEN
    RAISE EXCEPTION 'Market is not in independent pricing mode' USING ERRCODE = 'P0009';
  END IF;

  SELECT * INTO v_win FROM public.market_options
  WHERE id = p_winning_option_id AND market_id = p_market_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Winning option not found for market' USING ERRCODE = 'P0007'; END IF;

  UPDATE public.markets SET
    status = 'resolved', resolved_option_id = p_winning_option_id,
    resolved_at = NOW(), resolver_id = p_resolver_id, resolution_notes = p_resolution_notes
  WHERE id = p_market_id;

  UPDATE public.market_options
    SET is_winner = (id = p_winning_option_id), updated_at = NOW()
  WHERE market_id = p_market_id;

  -- Iterate every independent (option, side) position on this market.
  FOR v_position IN
    SELECT p.*, w.currency, w.available_balance
    FROM public.positions p JOIN public.wallets w ON w.id = p.wallet_id
    WHERE p.market_id = p_market_id AND p.is_active = TRUE
      AND p.market_option_id IS NOT NULL AND p.side IS NOT NULL
  LOOP
    v_is_winner := (v_position.market_option_id = p_winning_option_id AND v_position.side = 'yes')
                OR (v_position.market_option_id <> p_winning_option_id AND v_position.side = 'no');

    SELECT rate INTO v_exchange_rate FROM public.exchange_rates
    WHERE from_currency = v_position.currency AND to_currency = 'USD';

    IF v_is_winner THEN
      v_payout_usd := v_position.shares;
      v_payout_local := v_payout_usd / v_exchange_rate;

      UPDATE public.wallets SET
        available_balance = available_balance + v_payout_local + (v_position.total_invested_usd / v_exchange_rate),
        reserved_balance = GREATEST(0, reserved_balance - (v_position.total_invested_usd / v_exchange_rate)),
        total_won = total_won + v_payout_usd,
        updated_at = NOW()
      WHERE id = v_position.wallet_id;

      UPDATE public.positions SET
        is_active = FALSE,
        realized_pnl_usd = v_payout_usd - v_position.total_invested_usd,
        total_payout_usd = v_payout_usd + v_position.total_invested_usd,
        claimed_at = NOW(), updated_at = NOW()
      WHERE id = v_position.id;

      INSERT INTO public.transactions (
        user_id, wallet_id, type, status, amount, currency, amount_usd, exchange_rate_to_usd,
        balance_before, balance_after, market_id, market_option_id, description, idempotency_key
      ) VALUES (
        v_position.user_id, v_position.wallet_id, 'bet_won', 'completed',
        v_payout_local + (v_position.total_invested_usd / v_exchange_rate),
        v_position.currency, v_payout_usd + v_position.total_invested_usd, v_exchange_rate,
        v_position.available_balance,
        v_position.available_balance + v_payout_local + (v_position.total_invested_usd / v_exchange_rate),
        p_market_id, v_position.market_option_id,
        FORMAT('Won %s: %s — %s', UPPER(v_position.side::TEXT), v_market.title, v_win.label),
        FORMAT('winb_%s_%s_%s_%s', p_market_id, v_position.market_option_id, v_position.side, v_position.user_id)
      );

      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        v_position.user_id, 'bet_won', '🎉 You Won!',
        FORMAT('Your %s line on "%s" paid out +%s USD', UPPER(v_position.side::TEXT), v_market.title, ROUND(v_payout_usd, 2)),
        jsonb_build_object('market_id', p_market_id, 'option_id', v_position.market_option_id, 'side', v_position.side, 'payout_usd', v_payout_usd)
      );

      v_total_paid_out := v_total_paid_out + v_payout_usd;
      v_winners := v_winners + 1;
    ELSE
      UPDATE public.wallets SET
        reserved_balance = GREATEST(0, reserved_balance - (v_position.total_invested_usd / v_exchange_rate)),
        total_lost = total_lost + v_position.total_invested_usd,
        updated_at = NOW()
      WHERE id = v_position.wallet_id;

      UPDATE public.positions SET
        is_active = FALSE, realized_pnl_usd = -v_position.total_invested_usd,
        total_payout_usd = 0, claimed_at = NOW(), updated_at = NOW()
      WHERE id = v_position.id;

      INSERT INTO public.transactions (
        user_id, wallet_id, type, status, amount, currency, amount_usd, exchange_rate_to_usd,
        balance_before, balance_after, market_id, market_option_id, description, idempotency_key
      ) VALUES (
        v_position.user_id, v_position.wallet_id, 'bet_lost', 'completed',
        0, v_position.currency, 0, v_exchange_rate,
        v_position.available_balance, v_position.available_balance,
        p_market_id, v_position.market_option_id,
        FORMAT('Lost %s: %s', UPPER(v_position.side::TEXT), v_market.title),
        FORMAT('loseb_%s_%s_%s_%s', p_market_id, v_position.market_option_id, v_position.side, v_position.user_id)
      );

      v_losers := v_losers + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE, 'market_id', p_market_id, 'winning_option_id', p_winning_option_id,
    'mode', 'independent', 'winners', v_winners, 'losers', v_losers,
    'total_paid_out_usd', v_total_paid_out
  );
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$function$
;

-- cancel_market (cap:markets:cancel)
CREATE OR REPLACE FUNCTION public.cancel_market(p_market_id uuid, p_reason text DEFAULT 'Market cancelled'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_market public.markets%ROWTYPE;
  v_position RECORD;
  v_exchange_rate DECIMAL;
  v_refund_local DECIMAL;
  v_total_refunded DECIMAL := 0;
  v_refunded_count INTEGER := 0;
BEGIN
  -- [052 defense-in-depth] belt-and-suspenders behind the 051 REVOKE: even if
  -- EXECUTE is ever re-granted to a client role, an end-user JWT without the
  -- 'markets:cancel' capability cannot call this. service_role/cron (auth.uid() IS NULL)
  -- and the admin wrapper (holder of the capability) pass through.
  IF auth.uid() IS NOT NULL AND NOT public.has_capability('markets:cancel') THEN
    RAISE EXCEPTION 'Not authorized (requires markets:cancel)' USING ERRCODE = 'P0121';
  END IF;
  SELECT * INTO v_market FROM public.markets
  WHERE id = p_market_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  UPDATE public.markets SET
    status = 'cancelled',
    resolution_notes = p_reason,
    updated_at = NOW()
  WHERE id = p_market_id;

  FOR v_position IN
    SELECT p.*, w.currency, w.available_balance
    FROM public.positions p
    JOIN public.wallets w ON w.id = p.wallet_id
    WHERE p.market_id = p_market_id AND p.is_active = TRUE
  LOOP
    SELECT rate INTO v_exchange_rate FROM public.exchange_rates
    WHERE from_currency = v_position.currency AND to_currency = 'USD';

    v_refund_local := v_position.total_invested_usd / v_exchange_rate;

    UPDATE public.wallets SET
      available_balance = available_balance + v_refund_local,
      reserved_balance = GREATEST(0, reserved_balance - v_refund_local),
      updated_at = NOW()
    WHERE id = v_position.wallet_id;

    UPDATE public.positions SET
      is_active = FALSE, realized_pnl_usd = 0, updated_at = NOW()
    WHERE id = v_position.id;

    INSERT INTO public.transactions (
      user_id, wallet_id, type, status,
      amount, currency, amount_usd, exchange_rate_to_usd,
      balance_before, balance_after, market_id, description, idempotency_key
    ) VALUES (
      v_position.user_id, v_position.wallet_id, 'bet_refunded', 'completed',
      v_refund_local, v_position.currency, v_position.total_invested_usd, v_exchange_rate,
      v_position.available_balance, v_position.available_balance + v_refund_local,
      p_market_id,
      FORMAT('Refund: %s (cancelled)', v_market.title),
      FORMAT('refund_%s_%s', p_market_id, v_position.user_id)
    );

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_position.user_id, 'market_resolved',
      '↩️ Market Cancelled - Refund Issued',
      FORMAT('"%s" was cancelled. Your bet of %s %s has been refunded.', v_market.title, v_refund_local, v_position.currency),
      jsonb_build_object('market_id', p_market_id, 'refund_amount', v_refund_local)
    );

    v_total_refunded := v_total_refunded + v_position.total_invested_usd;
    v_refunded_count := v_refunded_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'refunded_users', v_refunded_count,
    'total_refunded_usd', v_total_refunded
  );
END;
$function$
;

-- close_due_markets (internal)
CREATE OR REPLACE FUNCTION public.close_due_markets(p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids            UUID[];
  v_closed         INTEGER := 0;
  v_notified       INTEGER := 0;
  v_limit          INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000));
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  -- Select & lock the due markets, then flip them in one statement. FOR UPDATE
  -- SKIP LOCKED keeps concurrent runs from fighting over the same rows.
  WITH due AS (
    SELECT id
      FROM public.markets
     WHERE status = 'active'
       AND closes_at <= NOW()
     ORDER BY closes_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), moved AS (
    UPDATE public.markets m
       SET status = 'closed', updated_at = NOW()
      FROM due
     WHERE m.id = due.id
     RETURNING m.id
  )
  SELECT array_agg(id) INTO v_ids FROM moved;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('closed', 0, 'notified', 0, 'market_ids', '[]'::jsonb);
  END IF;

  v_closed := array_length(v_ids, 1);

  -- System audit trail (one row per closed market).
  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, old_data, new_data)
  SELECT NULL, 'market.auto_close', 'market', m.id,
         jsonb_build_object('status', 'active', 'closes_at', m.closes_at),
         jsonb_build_object('status', 'closed', 'via', 'cron:close-markets')
    FROM public.markets m
   WHERE m.id = ANY(v_ids);

  -- Notify each distinct holder of an active position that their market closed
  -- and now awaits resolution. In-app only (system_announcement default = no
  -- SMS/email), so no provider fan-out from a batch job.
  WITH holders AS (
    SELECT DISTINCT p.user_id, p.market_id, m.title
      FROM public.positions p
      JOIN public.markets m ON m.id = p.market_id
     WHERE p.market_id = ANY(v_ids)
       AND p.is_active = TRUE
  ), ins AS (
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT h.user_id, 'system_announcement',
           'Market closed',
           'Trading has closed for "' || h.title || '". It now awaits resolution.',
           jsonb_build_object('market_id', h.market_id, 'event', 'market_closed')
      FROM holders h
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_notified FROM ins;

  RETURN jsonb_build_object(
    'closed', v_closed,
    'notified', v_notified,
    'market_ids', to_jsonb(v_ids)
  );
END;
$function$
;

-- flag_markets_due_for_resolution (internal)
CREATE OR REPLACE FUNCTION public.flag_markets_due_for_resolution(p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids       UUID[];
  v_flagged   INTEGER := 0;
  v_notified  INTEGER := 0;
  v_limit     INTEGER := GREATEST(1, LEAST(COALESCE(p_limit, 500), 2000));
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  WITH due AS (
    SELECT id
      FROM public.markets
     WHERE status = 'closed'
       AND resolves_at IS NOT NULL
       AND resolves_at <= NOW()
       AND resolution_flagged_at IS NULL
     ORDER BY resolves_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ), flagged AS (
    UPDATE public.markets m
       SET resolution_flagged_at = NOW(), updated_at = NOW()
      FROM due
     WHERE m.id = due.id
     RETURNING m.id
  )
  SELECT array_agg(id) INTO v_ids FROM flagged;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('flagged', 0, 'notified', 0, 'market_ids', '[]'::jsonb);
  END IF;

  v_flagged := array_length(v_ids, 1);

  -- System audit trail.
  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, old_data, new_data)
  SELECT NULL, 'market.resolution_due', 'market', m.id,
         jsonb_build_object('status', 'closed', 'resolves_at', m.resolves_at),
         jsonb_build_object('flagged_at', NOW(), 'via', 'cron:resolve-market')
    FROM public.markets m
   WHERE m.id = ANY(v_ids);

  -- Notify the resolution cohort: any role that grants markets:resolve, plus the
  -- always-privileged admin/superadmin roles. One notice per market per staffer.
  WITH resolvers AS (
    SELECT DISTINCT pr.id AS user_id
      FROM public.profiles pr
     WHERE pr.role IN ('admin', 'superadmin', 'resolver')
        OR pr.role::text IN (
             SELECT role::text FROM public.role_permissions WHERE capability = 'markets:resolve'
           )
  ), targets AS (
    SELECT r.user_id, m.id AS market_id, m.title
      FROM resolvers r
      CROSS JOIN public.markets m
     WHERE m.id = ANY(v_ids)
  ), ins AS (
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT t.user_id, 'system_announcement',
           'Market awaiting resolution',
           'Market "' || t.title || '" is past its resolution time and needs a resolver.',
           jsonb_build_object('market_id', t.market_id, 'event', 'resolution_due')
      FROM targets t
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_notified FROM ins;

  RETURN jsonb_build_object(
    'flagged', v_flagged,
    'notified', v_notified,
    'market_ids', to_jsonb(v_ids)
  );
END;
$function$
;

-- set_market_pricing_independent (internal)
CREATE OR REPLACE FUNCTION public.set_market_pricing_independent(p_market_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_market public.markets%ROWTYPE;
  v_count INT;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  SELECT * INTO v_market FROM public.markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001'; END IF;

  -- Seed only the options that have not yet been given a binary line.
  UPDATE public.market_options
    SET yes_price = COALESCE(yes_price, 0.5),
        no_price  = COALESCE(no_price, 0.5),
        q_yes     = COALESCE(q_yes, 0),
        q_no      = COALESCE(q_no, 0),
        updated_at = NOW()
  WHERE market_id = p_market_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.markets
    SET options_pricing_mode = 'independent', updated_at = NOW()
  WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'success', TRUE, 'market_id', p_market_id,
    'options_seeded', v_count, 'mode', 'independent'
  );
END;
$function$
;

-- upsert_exchange_rates (internal)
CREATE OR REPLACE FUNCTION public.upsert_exchange_rates(p_rates jsonb, p_source text DEFAULT 'cron'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row      JSONB;
  v_code     TEXT;
  v_rate     NUMERIC;
  v_upserted INTEGER := 0;
  v_skipped  INTEGER := 0;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF p_rates IS NULL OR jsonb_typeof(p_rates) <> 'array' THEN
    RAISE EXCEPTION 'p_rates must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rates)
  LOOP
    v_code := upper(NULLIF(v_row->>'from_currency', ''));
    BEGIN
      v_rate := (v_row->>'rate')::NUMERIC;
    EXCEPTION WHEN others THEN
      v_rate := NULL;
    END;

    -- Skip unknown enum values, USD self-rate, and non-positive/NULL rates.
    IF v_code IS NULL
       OR v_code = 'USD'
       OR NOT EXISTS (SELECT 1 FROM pg_enum e
                        JOIN pg_type t ON t.oid = e.enumtypid
                       WHERE t.typname = 'currency_code' AND e.enumlabel = v_code)
       OR v_rate IS NULL OR v_rate <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.exchange_rates (from_currency, to_currency, rate, source, fetched_at)
    VALUES (v_code::currency_code, 'USD', v_rate, COALESCE(p_source, 'cron'), NOW())
    ON CONFLICT (from_currency, to_currency)
    DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at;

    v_upserted := v_upserted + 1;
  END LOOP;

  RETURN jsonb_build_object('upserted', v_upserted, 'skipped', v_skipped);
END;
$function$
;

-- admin_review_kyc (kyc:review)
CREATE OR REPLACE FUNCTION public.admin_review_kyc(p_doc_id uuid, p_status kyc_status, p_reviewer_id uuid, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc public.kyc_documents%ROWTYPE;
BEGIN
  -- [052 defense-in-depth] require the kyc:review capability (matches the app
  -- guard and this function's admin_* siblings; closes the missing guard).
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

  -- Notification
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_doc.user_id,
    CASE WHEN p_status = 'verified' THEN 'kyc_approved' ELSE 'kyc_rejected' END,
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
$function$
;

-- record_btc_tick (internal)
CREATE OR REPLACE FUNCTION public.record_btc_tick(p_price numeric, p_source text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id BIGINT;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF p_price IS NULL OR p_price <= 0 THEN
    RAISE EXCEPTION 'Invalid BTC price: %', p_price USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.btc_price_ticks (price, source)
    VALUES (p_price, COALESCE(NULLIF(p_source, ''), 'unknown'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
;

-- resolve_btc_windows (internal)
CREATE OR REPLACE FUNCTION public.resolve_btc_windows(p_resolver uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resolver UUID := p_resolver;
  v_w        RECORD;
  v_settle   DECIMAL;
  v_outcome  order_side;
  v_resolved INTEGER := 0;
  v_skipped  INTEGER := 0;
  v_ids      UUID[] := '{}';
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF v_resolver IS NULL THEN
    SELECT id INTO v_resolver FROM public.profiles
      WHERE role IN ('superadmin', 'admin') ORDER BY created_at LIMIT 1;
  END IF;
  IF v_resolver IS NULL THEN
    SELECT id INTO v_resolver FROM public.profiles ORDER BY created_at LIMIT 1;
  END IF;

  FOR v_w IN
    SELECT * FROM public.btc_windows
    WHERE status = 'open' AND resolves_at <= NOW()
    ORDER BY resolves_at
    FOR UPDATE SKIP LOCKED
  LOOP
    -- Settle price: first tick at/after close; fallback to the latest tick.
    SELECT price INTO v_settle FROM public.btc_price_ticks
      WHERE observed_at >= v_w.closes_at ORDER BY observed_at ASC, id ASC LIMIT 1;
    IF v_settle IS NULL THEN
      v_settle := public.latest_btc_price();
    END IF;
    IF v_settle IS NULL THEN
      v_skipped := v_skipped + 1;  -- no price yet; a later cron tick will settle it
      CONTINUE;
    END IF;

    v_outcome := CASE WHEN v_settle > v_w.reference_price
                      THEN 'yes'::order_side ELSE 'no'::order_side END;

    -- Pay out through the single audited settlement path.
    PERFORM public.resolve_market(
      v_w.market_id, v_outcome, v_resolver,
      'Auto-resolved BTC ' || v_w.series_key || ' window: settle $' ||
        to_char(v_settle, 'FM999,999,990.00') || ' vs reference $' ||
        to_char(v_w.reference_price, 'FM999,999,990.00')
    );

    UPDATE public.btc_windows
      SET status = 'resolved', settle_price = v_settle, resolved_outcome = v_outcome
      WHERE id = v_w.id;

    UPDATE public.markets
      SET metadata = metadata || jsonb_build_object(
        'live', FALSE, 'settle_price', v_settle, 'settled_outcome', v_outcome)
      WHERE id = v_w.market_id;

    v_resolved := v_resolved + 1;
    v_ids := array_append(v_ids, v_w.market_id);
  END LOOP;

  RETURN jsonb_build_object('resolved', v_resolved, 'skipped', v_skipped, 'market_ids', v_ids);
END;
$function$
;

-- open_btc_windows (internal)
CREATE OR REPLACE FUNCTION public.open_btc_windows(p_creator uuid DEFAULT NULL::uuid, p_resolution_source text DEFAULT 'https://www.coinbase.com/price/bitcoin'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_creator UUID := p_creator;
  v_price   DECIMAL := public.latest_btc_price();
  v_series  RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_closes  TIMESTAMPTZ;
  v_market  UUID;
  v_slug    TEXT;
  v_opened  INTEGER := 0;
  v_ids     UUID[] := '{}';
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF v_price IS NULL THEN
    RETURN jsonb_build_object('opened', 0, 'reason', 'no_price');
  END IF;

  -- Resolve a stable system creator (superadmin first, then any profile).
  IF v_creator IS NULL THEN
    SELECT id INTO v_creator FROM public.profiles
      WHERE role IN ('superadmin', 'admin') ORDER BY created_at LIMIT 1;
  END IF;
  IF v_creator IS NULL THEN
    SELECT id INTO v_creator FROM public.profiles ORDER BY created_at LIMIT 1;
  END IF;
  IF v_creator IS NULL THEN
    RETURN jsonb_build_object('opened', 0, 'reason', 'no_creator');
  END IF;

  FOR v_series IN
    SELECT * FROM public.btc_series_config WHERE enabled ORDER BY featured_order
  LOOP
    -- Already have a live window for this series? leave it be.
    IF EXISTS (
      SELECT 1 FROM public.btc_windows w
      WHERE w.series_key = v_series.series_key
        AND w.status = 'open'
        AND w.closes_at > v_now
    ) THEN
      CONTINUE;
    END IF;

    v_closes := v_now + make_interval(secs => v_series.window_seconds);
    v_slug   := v_series.series_key || '-' || (extract(epoch from v_closes)::bigint)::text;

    INSERT INTO public.markets (
      slug, title, description, category, resolution_type, creator_id,
      status, opens_at, closes_at, resolves_at,
      resolution_criteria, resolution_source,
      yes_price, no_price, liquidity_pool_usd, initial_liquidity_usd,
      is_featured, featured_order, tags, metadata
    ) VALUES (
      v_slug,
      'Bitcoin ' || v_series.display_label || ' — Up or Down?',
      'Will Bitcoin (BTC/USD) be HIGHER than $' ||
        to_char(v_price, 'FM999,999,990.00') || ' when this ' ||
        v_series.display_label ||
        ' window closes? The window opens at the reference price and settles '
        'automatically against the Coinbase BTC-USD spot feed.',
      'crypto', 'binary', v_creator,
      'active', v_now, v_closes, v_closes,
      'Resolves YES (Up) if the Coinbase BTC-USD spot price at close is '
        'STRICTLY greater than the reference price of $' ||
        to_char(v_price, 'FM999,999,990.00') ||
        ' captured at open; otherwise NO (Down). A flat price settles NO.',
      p_resolution_source,
      0.5, 0.5, 0, 100,
      TRUE, v_series.featured_order,
      ARRAY['bitcoin', 'btc', 'crypto', 'live'],
      jsonb_build_object(
        'card_kind', 'up_down', 'asset', 'BTC',
        'yes_label', 'Up', 'no_label', 'Down',
        'series_key', v_series.series_key,
        'window_seconds', v_series.window_seconds,
        'window_label', v_series.display_label,
        'reference_price', v_price, 'live', TRUE
      )
    )
    RETURNING id INTO v_market;

    INSERT INTO public.btc_windows (
      market_id, series_key, window_seconds, reference_price,
      opens_at, closes_at, resolves_at, status
    ) VALUES (
      v_market, v_series.series_key, v_series.window_seconds, v_price,
      v_now, v_closes, v_closes, 'open'
    );

    v_opened := v_opened + 1;
    v_ids := array_append(v_ids, v_market);
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened, 'market_ids', v_ids, 'reference_price', v_price);
END;
$function$
;

-- btc_tick_cron (internal)
CREATE OR REPLACE FUNCTION public.btc_tick_cron()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_status  INT;
  v_content TEXT;
  v_price   NUMERIC;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  -- 1) Sample BTC/USD spot in-process (best-effort; a bad sample degrades to a
  --    no-op tick and the next minute recovers).
  BEGIN
    SELECT h.status, h.content INTO v_status, v_content
      FROM http_get('https://api.coinbase.com/v2/prices/BTC-USD/spot') h;
    IF v_status = 200 THEN
      v_price := (v_content::json -> 'data' ->> 'amount')::numeric;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_price := NULL;
  END;

  IF v_price IS NOT NULL AND v_price > 0 THEN
    PERFORM public.record_btc_tick(v_price, 'coinbase-pgcron');
  END IF;

  -- 2) Settle any due windows, then 3) roll a fresh window per series.
  PERFORM public.resolve_btc_windows();
  PERFORM public.open_btc_windows();

  RETURN jsonb_build_object('price', v_price, 'at', now());
END;
$function$
;

-- record_job_start (internal)
CREATE OR REPLACE FUNCTION public.record_job_start(p_job_name text, p_request_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  INSERT INTO public.job_runs (job_name, status, request_id)
  VALUES (p_job_name, 'running', p_request_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
;

-- record_job_finish (internal)
CREATE OR REPLACE FUNCTION public.record_job_finish(p_id uuid, p_status text, p_result jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF p_status NOT IN ('success', 'partial', 'failed') THEN
    RAISE EXCEPTION 'Invalid job status: %', p_status USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.job_runs
     SET status      = p_status,
         result      = COALESCE(p_result, result),
         error       = p_error,
         finished_at = NOW(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INT)
   WHERE id = p_id;
END;
$function$
;

-- enqueue_notification_deliveries (internal)
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
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
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
$function$
;

-- claim_notification_deliveries (internal)
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
$function$
;

-- complete_notification_delivery (internal)
CREATE OR REPLACE FUNCTION public.complete_notification_delivery(p_id uuid, p_success boolean, p_provider_message_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text, p_backoff_seconds integer DEFAULT 300)
 RETURNS notification_deliveries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.notification_deliveries;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  UPDATE public.notification_deliveries d
  SET status = CASE
        WHEN p_success THEN 'sent'
        WHEN d.attempts >= d.max_attempts THEN 'failed'
        ELSE 'pending'
      END,
      sent_at = CASE WHEN p_success THEN NOW() ELSE d.sent_at END,
      provider_message_id = COALESCE(p_provider_message_id, d.provider_message_id),
      last_error = CASE WHEN p_success THEN NULL ELSE p_error END,
      next_attempt_at = CASE
        WHEN p_success OR d.attempts >= d.max_attempts THEN d.next_attempt_at
        ELSE NOW() + make_interval(secs => GREATEST(COALESCE(p_backoff_seconds, 300), 1))
      END,
      updated_at = NOW()
  WHERE d.id = p_id
  RETURNING d.* INTO v_row;
  RETURN v_row;
END;
$function$
;

-- refresh_market_stats (internal)
CREATE OR REPLACE FUNCTION public.refresh_market_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  WITH windowed AS (
    SELECT o.market_id,
           COALESCE(SUM(o.filled_usd), 0)          AS vol_24h,
           COUNT(*) FILTER (WHERE o.filled_usd > 0) AS trades_24h,
           MAX(o.created_at) FILTER (WHERE o.filled_usd > 0) AS last_trade
      FROM public.orders o
     WHERE o.created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY o.market_id
  ), upd AS (
    UPDATE public.markets m
       SET volume_24h_usd = COALESCE(w.vol_24h, 0),
           trades_24h     = COALESCE(w.trades_24h, 0),
           last_trade_at  = COALESCE(w.last_trade, m.last_trade_at),
           updated_at     = NOW()
      FROM (
        -- Left join every refreshable market to its window so markets that fell
        -- out of the 24h window are reset to zero.
        SELECT mk.id AS market_id, wd.vol_24h, wd.trades_24h, wd.last_trade
          FROM public.markets mk
          LEFT JOIN windowed wd ON wd.market_id = mk.id
         WHERE mk.status IN ('active', 'closed')
      ) w
     WHERE m.id = w.market_id
       AND (m.volume_24h_usd IS DISTINCT FROM COALESCE(w.vol_24h, 0)
            OR m.trades_24h  IS DISTINCT FROM COALESCE(w.trades_24h, 0))
     RETURNING m.id
  )
  SELECT COUNT(*) INTO v_updated FROM upd;

  RETURN jsonb_build_object('updated', v_updated, 'at', NOW());
END;
$function$
;

-- refresh_leaderboard (internal)
CREATE OR REPLACE FUNCTION public.refresh_leaderboard()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard;
EXCEPTION WHEN feature_not_supported OR object_not_in_prerequisite_state THEN
  -- CONCURRENTLY needs the matview populated once first.
  REFRESH MATERIALIZED VIEW public.leaderboard;
END;
$function$
;

-- schedule_marketpips_jobs (internal)
CREATE OR REPLACE FUNCTION public.schedule_marketpips_jobs(p_base_url text, p_cron_secret text)
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
    WHERE jobname IN ('marketpips-close-markets','marketpips-resolve-market',
                      'marketpips-update-exchange-rates','marketpips-send-notifications',
                      'marketpips-refresh-market-stats');

  PERFORM cron.schedule('marketpips-close-markets', '*/5 * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/close-markets', v_hdr::text));

  PERFORM cron.schedule('marketpips-resolve-market', '*/15 * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/resolve-market', v_hdr::text));

  PERFORM cron.schedule('marketpips-update-exchange-rates', '0 */6 * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/update-exchange-rates', v_hdr::text));

  PERFORM cron.schedule('marketpips-send-notifications', '* * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/send-notifications', v_hdr::text));

  PERFORM cron.schedule('marketpips-refresh-market-stats', '*/5 * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/refresh-market-stats', v_hdr::text));

  RETURN jsonb_build_object('scheduled', TRUE, 'base_url', v_base, 'jobs', 5);
END;
$function$
;

-- schedule_marketpips_btc_jobs (internal)
CREATE OR REPLACE FUNCTION public.schedule_marketpips_btc_jobs(p_base_url text, p_cron_secret text)
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
     FROM cron.job WHERE jobname = 'marketpips-btc-windows';

  -- Tick + resolve + roll new windows, every minute.
  PERFORM cron.schedule('marketpips-btc-windows', '* * * * *', format(
    $c$ SELECT net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb) $c$,
    v_base || '/api/cron/btc-windows', v_hdr::text));

  RETURN jsonb_build_object('scheduled', TRUE, 'base_url', v_base, 'jobs', 1);
END;
$function$
;
