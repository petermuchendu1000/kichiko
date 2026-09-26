-- 085_admin_adjust_balance_guards.sql — separation of duties, ceilings and
-- idempotency enforced IN the RPC (audit 6.8).
--
-- Before: the self-adjust ban and the ceiling existed only in the Next.js route
-- (app/api/admin/users/[id]/adjust-balance). The RPC is granted to
-- `authenticated` and checks only the capability, so an admin could call
-- POST /rest/v1/rpc/admin_adjust_balance with their own JWT and credit
-- themselves any amount. A double click credited twice.
--
-- After (the RPC itself):
--   * p_user_id = the caller -> P0180
--   * |amount| > 1,000,000 in the request currency -> P0181 (the route's rule)
--   * |amount| x USD rate > 10,000 USD -> P0182 (a USD ceiling: 1,000,000 USD
--     passed the old rule)
--   * p_idempotency_key: the same key returns the first result (replayed);
--     reused for a different adjustment -> P0184; malformed -> P0183
-- The old 5-argument signature is dropped so no unguarded overload remains.
-- Dual approval above a threshold is not implemented here (owner decision).
BEGIN;

DROP FUNCTION IF EXISTS public.admin_adjust_balance(uuid, currency_code, numeric, text, transaction_type);

CREATE OR REPLACE FUNCTION public.admin_adjust_balance(p_user_id uuid, p_currency currency_code, p_amount numeric, p_reason text, p_type transaction_type DEFAULT NULL::transaction_type, p_idempotency_key text DEFAULT NULL::text)
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
  v_idem   text;
  v_prev   public.transactions%ROWTYPE;
BEGIN
  IF NOT public.has_capability('users:update') THEN
    RAISE EXCEPTION 'Insufficient permissions (users:update required)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [085] separation of duties, in the RPC (the route check alone was
  -- bypassable by calling /rest/v1/rpc/admin_adjust_balance directly)
  IF auth.uid() IS NOT NULL AND p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot adjust your own balance' USING ERRCODE = 'P0180';
  END IF;
  IF p_amount = 0 THEN RAISE EXCEPTION 'Adjustment amount must be non-zero'; END IF;
  -- [085] ceiling in the request currency (the route's former check) ...
  IF abs(p_amount) > 1000000 THEN
    RAISE EXCEPTION 'Adjustment exceeds the 1,000,000 single-adjustment ceiling' USING ERRCODE = 'P0181';
  END IF;
  IF p_idempotency_key IS NOT NULL AND length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE = 'P0183';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required for a balance adjustment';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets
  WHERE user_id = p_user_id AND currency = p_currency FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet not found for % / %', p_user_id, p_currency; END IF;

  -- [085] idempotent: the same key (e.g. a double click) returns the first
  -- result instead of adjusting twice. Checked under the wallet lock, so a
  -- concurrent duplicate waits and then sees the first one's transaction.
  v_idem := CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE 'admin_adjust_' || btrim(p_idempotency_key) END;
  IF v_idem IS NOT NULL THEN
    SELECT * INTO v_prev FROM public.transactions WHERE idempotency_key = v_idem;
    IF FOUND THEN
      IF v_prev.wallet_id <> v_wallet.id OR v_prev.amount <> abs(p_amount) THEN
        RAISE EXCEPTION 'Idempotency key reused for a different adjustment' USING ERRCODE = 'P0184';
      END IF;
      RETURN jsonb_build_object('success', TRUE, 'wallet_id', v_wallet.id, 'replayed', TRUE,
        'balance_before', v_prev.balance_before, 'balance_after', v_prev.balance_after);
    END IF;
  END IF;

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
  -- [085] ... and in USD: 1,000,000 of USD would otherwise be allowed
  IF abs(p_amount) * v_rate > 10000 THEN
    RAISE EXCEPTION 'Adjustment of about % USD exceeds the 10,000 USD single-adjustment ceiling', round(abs(p_amount) * v_rate, 2)
      USING ERRCODE = 'P0182';
  END IF;

  -- Bug 1 (42804): cast the CASE result to transaction_type so both COALESCE
  -- operands share the enum type (bare 'bonus'/'fee' literals are text).
  v_type := COALESCE(p_type, (CASE WHEN p_amount >= 0 THEN 'bonus' ELSE 'fee' END)::transaction_type);

  UPDATE public.wallets SET available_balance = v_after, updated_at = NOW()
  WHERE id = v_wallet.id;

  -- Bug 2: transactions.amount is CHECK (amount >= 0); direction is carried by
  -- `type` + balance_before/after. Store the magnitude, not the signed delta.
  INSERT INTO public.transactions (
    user_id, wallet_id, type, status, amount, currency, amount_usd,
    exchange_rate_to_usd, balance_before, balance_after, description, notes, completed_at, idempotency_key
  ) VALUES (
    p_user_id, v_wallet.id, v_type, 'completed', abs(p_amount), p_currency, abs(p_amount) * v_rate,
    v_rate, v_before, v_after, 'Admin balance adjustment', p_reason, NOW(), v_idem
  );

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (
    auth.uid(), 'user.balance_adjust', 'wallet', v_wallet.id,
    jsonb_build_object('available_balance', v_before),
    jsonb_build_object('available_balance', v_after, 'delta', p_amount, 'currency', p_currency, 'reason', p_reason,
                       'idempotency_key', p_idempotency_key)
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

REVOKE EXECUTE ON FUNCTION public.admin_adjust_balance(uuid, currency_code, numeric, text, transaction_type, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(uuid, currency_code, numeric, text, transaction_type, text) TO authenticated, service_role;

COMMIT;
