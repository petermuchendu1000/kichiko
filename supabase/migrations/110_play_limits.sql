-- 110_play_limits.sql
-- ------------------------------------------------------------
-- Self-service deposit and loss limits, and the two pre-trade gates that
-- enforce them.
--
-- L.N. 112 Reg. 84 requires deposit, loss and session limits. What existed
-- before this migration: a sentence on /legal/responsible-play saying "For
-- deposit or loss limits, contact us via the Help page while we finish
-- building them". Ruling I2 of docs/research/ui-2026-09/40-ELEMENT-MATRIX.md
-- makes limits the default path, typed freely rather than picked from a menu
-- of presets, with the asymmetry that decides whether a limit is a protection
-- or a decoration:
--
--   TIGHTENING (a lower limit, or a first limit) takes effect immediately.
--   LOOSENING  (a higher limit, or removing one) waits 24 hours AND must then
--              be confirmed again. Until it is, the old limit stands.
--
-- The 24 hours is the point. A limit that can be raised in the moment of
-- wanting to play is not a limit; it is a dialog in the way. Kalshi's monthly
-- deposit cap takes the same shape (increases apply next month); Tanzania's
-- regime uses 7 days. Reg. 84 sets no interval, so 24 hours is the floor we
-- adopt, matched to the 24-hour minimum break in Reg. 84(2)(d).
--
-- WHAT A "LOSS LIMIT" MEANS HERE, AND WHY IT IS NOT REALISED P&L
--
-- The obvious reading — cap realised losses per period — does not bind on
-- this platform. Realised P&L only moves when a position is sold or the
-- market settles, and our markets settle weeks or months out
-- (position_pnl_events, migration 092, is attributed to when P&L is
-- realised). Someone could stake every shilling they have on a Monday and a
-- realised-loss cap would not notice until the market resolved. It would look
-- like a protection and function as an ornament.
--
-- So the limit here counts money OUT and not back, in the period:
--
--   buys  −  sells  −  settlement payouts        (floored at zero)
--
-- which is realised loss plus the cost of positions still open. Since a
-- position cannot lose more than it cost, that figure is the worst case: the
-- most the person can be down from the period's trading, counting every open
-- position as if it lost. Capping it caps loss, and it binds the moment the
-- order is placed, which is the only moment a limit can help. The UI says
-- this in plain words rather than hiding it behind "loss".
--
-- Windows are rolling (any 24 hours, any 7 days, any 30 days), not calendar.
-- A calendar day resets at midnight, which is precisely when a long session
-- is at its worst.
--
-- WHERE THE GATES SIT
--
-- The loss limit and the play break (migration 109) are enforced inside
-- place_order_for, not in the API route. Two reasons:
--   1. Exactness. A route-level check and the wallet debit are separate
--      round trips, so two orders sent together can both pass a check that
--      only one should. Inside place_order_for the check runs in the same
--      transaction as clob_place_order's debit.
--   2. Migration 090 finding L1: order placement is ONE round trip. The
--      break gate shipped as a second one; this folds it back in.
-- The deposit limit is enforced by deposit_gate(), called by the deposit
-- route before it asks the provider for money.

BEGIN;

-- ------------------------------------------------------------------ storage
--
-- Insert-only, from the owner's point of view: every request for a limit is
-- a row, and the limit in force is derived. Nothing is ever edited in place,
-- so the history of who loosened what, and when, survives — which is the
-- record Reg. 84 compliance is proved from.
CREATE TABLE IF NOT EXISTS public.play_limits (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Request order, and the tie-break for "which limit is in force". now() is
  -- the TRANSACTION timestamp, so two requests written in one transaction
  -- share requested_at to the microsecond and ordering by it alone returns an
  -- arbitrary one of them (caught in testing: a lower limit requested after a
  -- higher one did not take effect). A sequence cannot tie.
  seq                BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('deposit', 'loss')),
  period             TEXT NOT NULL CHECK (period IN ('day', 'week', 'month')),
  -- NULL = no limit. Removing a limit is a loosening and waits like one.
  amount             NUMERIC(20,2) CHECK (amount IS NULL OR amount > 0),
  -- The currency the figure was typed in. Comparisons run in USD (the ledger's
  -- common unit), so a later change of settlement country cannot silently
  -- reinterpret a limit as a different number.
  currency           public.currency_code NOT NULL,
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- now() for a tightening; now() + 24h for a loosening.
  effective_at       TIMESTAMPTZ NOT NULL,
  -- TRUE only for a loosening: it must also be confirmed after the wait.
  needs_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS play_limits_lookup_idx
  ON public.play_limits (user_id, kind, period, effective_at DESC, seq DESC);

ALTER TABLE public.play_limits ENABLE ROW LEVEL SECURITY;

-- Read your own. No INSERT, UPDATE or DELETE policy at all: every write goes
-- through the functions below, which hold the 24-hour rule. A policy that let
-- the client write the table directly would let it write effective_at.
DROP POLICY IF EXISTS play_limits_select_own ON public.play_limits;
CREATE POLICY play_limits_select_own ON public.play_limits
  FOR SELECT USING (auth.uid() = user_id);

COMMENT ON TABLE public.play_limits IS
  '110: self-service deposit and loss limits (L.N. 112 Reg. 84). Insert-only log of requests; the limit in force is derived. Tightening is immediate, loosening waits 24h and must be re-confirmed. Written only via set_play_limit/confirm_play_limit/cancel_play_limit.';

-- -------------------------------------------------------------- the window
-- Rolling, not calendar: see the header.
CREATE OR REPLACE FUNCTION public.play_limit_window(p_period TEXT)
RETURNS INTERVAL
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_period
           WHEN 'day'   THEN INTERVAL '24 hours'
           WHEN 'week'  THEN INTERVAL '7 days'
           WHEN 'month' THEN INTERVAL '30 days'
         END;
$$;

-- ------------------------------------------------------- the limit in force
-- The latest request that has come into force. A loosening counts only once
-- confirmed; until then the row before it is still the answer.
CREATE OR REPLACE FUNCTION public.play_limit_in_force(
  p_user_id UUID, p_kind TEXT, p_period TEXT)
RETURNS TABLE (id UUID, amount NUMERIC, currency public.currency_code, effective_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.amount, l.currency, l.effective_at
  FROM public.play_limits l
  WHERE l.user_id = p_user_id
    AND l.kind = p_kind
    AND l.period = p_period
    AND l.cancelled_at IS NULL
    AND l.effective_at <= now()
    AND (NOT l.needs_confirmation OR l.confirmed_at IS NOT NULL)
  ORDER BY l.effective_at DESC, l.seq DESC
  LIMIT 1;
$$;

-- --------------------------------------------------------- what is used up
--
-- 'deposit': money asked for from the provider in the window, whether or not
-- it has landed yet. Pending and processing count, or ten concurrent STK
-- pushes would each see an empty allowance.
--
-- 'loss': money out and not back — buys less sells less settlement payouts,
-- floored at zero. See the header on why this, and not realised P&L.
CREATE OR REPLACE FUNCTION public.play_limit_used_usd(
  p_user_id UUID, p_kind TEXT, p_period TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_kind
    WHEN 'deposit' THEN COALESCE((
      SELECT SUM(d.amount * COALESCE(d.exchange_rate_to_usd, 0))
      FROM public.deposits d
      WHERE d.user_id = p_user_id
        AND d.status IN ('pending', 'processing', 'completed')
        AND d.created_at > now() - public.play_limit_window(p_period)
    ), 0)
    WHEN 'loss' THEN GREATEST(0, COALESCE((
      SELECT SUM(CASE WHEN t.type = 'bet_placed' THEN t.amount_usd ELSE -t.amount_usd END)
      FROM public.transactions t
      WHERE t.user_id = p_user_id
        AND t.status = 'completed'
        AND t.type IN ('bet_placed', 'bet_refunded', 'bet_won', 'bet_lost')
        AND t.created_at > now() - public.play_limit_window(p_period)
    ), 0))
  END;
$$;

-- ------------------------------------------------------------- the gate
-- NULL when nothing blocks. Otherwise the shortest period that would be
-- exceeded, with the figures a message needs, in the currency the limit was
-- typed in.
CREATE OR REPLACE FUNCTION public.play_limit_block(
  p_user_id UUID, p_kind TEXT, p_extra_usd NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period   TEXT;
  v_amount   NUMERIC;
  v_currency public.currency_code;
  v_rate     NUMERIC;
  v_limit_usd NUMERIC;
  v_used_usd  NUMERIC;
BEGIN
  IF p_extra_usd IS NULL OR p_extra_usd < 0 THEN RETURN NULL; END IF;

  FOREACH v_period IN ARRAY ARRAY['day', 'week', 'month'] LOOP
    SELECT amount, currency INTO v_amount, v_currency
      FROM public.play_limit_in_force(p_user_id, p_kind, v_period);
    CONTINUE WHEN v_amount IS NULL;

    SELECT rate INTO v_rate FROM public.exchange_rates
     WHERE from_currency = v_currency AND to_currency = 'USD';
    -- No rate means the figure cannot be compared. Refusing the trade on a
    -- missing FX row would be its own outage; the limit is reported as not
    -- applied instead, and the FX monitor already alarms on this.
    CONTINUE WHEN v_rate IS NULL OR v_rate <= 0;

    v_limit_usd := v_amount * v_rate;
    v_used_usd  := public.play_limit_used_usd(p_user_id, p_kind, v_period);

    IF v_used_usd + p_extra_usd > v_limit_usd THEN
      RETURN jsonb_build_object(
        'period',    v_period,
        'amount',    v_amount,
        'currency',  v_currency,
        'used',      round(LEAST(v_used_usd, v_limit_usd) / v_rate, 2),
        'remaining', round(GREATEST(0, v_limit_usd - v_used_usd) / v_rate, 2),
        'requested', round(p_extra_usd / v_rate, 2)
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- How a period reads in a sentence, and how money reads in one.
CREATE OR REPLACE FUNCTION public.play_limit_period_word(p_period TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_period WHEN 'day' THEN '24 hours' WHEN 'week' THEN '7 days' ELSE '30 days' END;
$$;

CREATE OR REPLACE FUNCTION public.play_limit_money(p_amount NUMERIC, p_currency TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  -- KES and its neighbours are quoted whole; USD keeps its cents.
  SELECT CASE WHEN p_currency = 'USD'
    THEN '$' || trim(to_char(p_amount, 'FM999,999,990.00'))
    ELSE CASE WHEN p_currency = 'KES' THEN 'KSh ' ELSE p_currency || ' ' END
         || trim(to_char(round(p_amount), 'FM999,999,999'))
  END;
$$;

-- ------------------------------------------------- setting and changing one
CREATE OR REPLACE FUNCTION public.set_play_limit(
  p_kind TEXT, p_period TEXT, p_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_currency   public.currency_code;
  v_cur_amount NUMERIC;
  v_cur_curr   public.currency_code;
  v_rate_new   NUMERIC;
  v_rate_cur   NUMERIC;
  v_loosening  BOOLEAN;
  v_row        public.play_limits;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'P0121';
  END IF;
  IF p_kind NOT IN ('deposit', 'loss') OR p_period NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'Unknown limit' USING ERRCODE = 'P0102';
  END IF;
  IF p_amount IS NOT NULL AND p_amount <= 0 THEN
    RAISE EXCEPTION 'A limit must be more than zero' USING ERRCODE = 'P0102';
  END IF;

  SELECT settlement_currency INTO v_currency FROM public.profiles WHERE id = v_uid;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Choose your country in Settings first' USING ERRCODE = 'P0193';
  END IF;

  SELECT amount, currency INTO v_cur_amount, v_cur_curr
    FROM public.play_limit_in_force(v_uid, p_kind, p_period);

  -- Is this a loosening? Removing a limit always is. Setting one where there
  -- was none never is. Otherwise compare in USD, so a currency change between
  -- the two requests cannot turn a raise into a cut.
  IF p_amount IS NULL THEN
    v_loosening := (v_cur_amount IS NOT NULL);
  ELSIF v_cur_amount IS NULL THEN
    v_loosening := FALSE;
  ELSE
    SELECT rate INTO v_rate_new FROM public.exchange_rates
     WHERE from_currency = v_currency AND to_currency = 'USD';
    SELECT rate INTO v_rate_cur FROM public.exchange_rates
     WHERE from_currency = v_cur_curr AND to_currency = 'USD';
    IF v_rate_new IS NULL OR v_rate_cur IS NULL THEN
      -- Unknown which direction this is. Treat it as a loosening: the wait is
      -- the safe answer when we cannot tell.
      v_loosening := TRUE;
    ELSE
      v_loosening := (p_amount * v_rate_new) > (v_cur_amount * v_rate_cur);
    END IF;
  END IF;

  -- A pending loosening is dropped by any new request for the same limit.
  -- Otherwise someone who asks for a raise and then thinks better of it, and
  -- lowers their limit instead, would still be raised 24 hours later.
  UPDATE public.play_limits
     SET cancelled_at = now()
   WHERE user_id = v_uid AND kind = p_kind AND period = p_period
     AND cancelled_at IS NULL
     AND (effective_at > now() OR (needs_confirmation AND confirmed_at IS NULL));

  INSERT INTO public.play_limits (
    user_id, kind, period, amount, currency, effective_at, needs_confirmation)
  VALUES (
    v_uid, p_kind, p_period, p_amount, v_currency,
    CASE WHEN v_loosening THEN now() + INTERVAL '24 hours' ELSE now() END,
    v_loosening)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id, 'kind', v_row.kind, 'period', v_row.period,
    'amount', v_row.amount, 'currency', v_row.currency,
    'effective_at', v_row.effective_at, 'needs_confirmation', v_row.needs_confirmation,
    'in_force_now', NOT v_loosening);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_play_limit(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.play_limits;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'P0121'; END IF;

  SELECT * INTO v_row FROM public.play_limits WHERE id = p_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Change not found' USING ERRCODE = 'P0110'; END IF;
  IF v_row.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'That change was cancelled' USING ERRCODE = 'P0112';
  END IF;
  IF NOT v_row.needs_confirmation OR v_row.confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'That change needs no confirmation' USING ERRCODE = 'P0112';
  END IF;
  -- The wait is the protection. Confirming early would remove it.
  --
  -- The hour is deliberately not in this message. The server runs in UTC and
  -- our users are spread over UTC+2 and UTC+3, so a clock time written here
  -- would be wrong for some of them; the panel has effective_at as an ISO
  -- timestamp and counts down in the reader's own zone.
  IF v_row.effective_at > now() THEN
    RAISE EXCEPTION 'The 24 hours is not up yet. You can confirm this change once it is.'
      USING ERRCODE = 'P0189';
  END IF;

  UPDATE public.play_limits SET confirmed_at = now() WHERE id = p_id RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'amount', v_row.amount, 'confirmed_at', v_row.confirmed_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_play_limit(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.play_limits;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'P0121'; END IF;

  SELECT * INTO v_row FROM public.play_limits WHERE id = p_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Change not found' USING ERRCODE = 'P0110'; END IF;

  -- Only a change that is not yet in force can be cancelled — which is only
  -- ever a pending loosening. Cancelling a limit already in force would be a
  -- loosening without the 24 hours; that is what set_play_limit is for.
  IF NOT (v_row.cancelled_at IS NULL
          AND (v_row.effective_at > now() OR (v_row.needs_confirmation AND v_row.confirmed_at IS NULL))) THEN
    RAISE EXCEPTION 'That change is already in force' USING ERRCODE = 'P0112';
  END IF;

  UPDATE public.play_limits SET cancelled_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'cancelled', true);
END;
$$;

-- ------------------------------------------------------------ what to show
-- One call for the whole panel: every limit, what is in force, what is used,
-- and any change still waiting.
CREATE OR REPLACE FUNCTION public.my_play_limits()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_out       JSONB := '[]'::jsonb;
  v_kind      TEXT;
  v_per       TEXT;
  v_amount    NUMERIC;
  v_currency  public.currency_code;
  v_pend_id   UUID;
  v_pend_amt  NUMERIC;
  v_pend_curr public.currency_code;
  v_pend_eff  TIMESTAMPTZ;
  v_rate      NUMERIC;
  v_used      NUMERIC;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'P0121'; END IF;

  FOREACH v_kind IN ARRAY ARRAY['deposit', 'loss'] LOOP
    FOREACH v_per IN ARRAY ARRAY['day', 'week', 'month'] LOOP
      SELECT amount, currency INTO v_amount, v_currency
        FROM public.play_limit_in_force(v_uid, v_kind, v_per);

      SELECT id, amount, currency, effective_at
        INTO v_pend_id, v_pend_amt, v_pend_curr, v_pend_eff
        FROM public.play_limits
       WHERE user_id = v_uid AND kind = v_kind AND period = v_per
         AND cancelled_at IS NULL AND needs_confirmation AND confirmed_at IS NULL
       ORDER BY seq DESC LIMIT 1;

      -- Nothing set and nothing pending: say nothing about it.
      CONTINUE WHEN v_amount IS NULL AND v_pend_id IS NULL;

      v_used := public.play_limit_used_usd(v_uid, v_kind, v_per);
      SELECT rate INTO v_rate FROM public.exchange_rates
       WHERE from_currency = COALESCE(v_currency, v_pend_curr) AND to_currency = 'USD';

      v_out := v_out || jsonb_build_object(
        'kind', v_kind,
        'period', v_per,
        'amount', v_amount,
        'currency', COALESCE(v_currency, v_pend_curr),
        'used', CASE WHEN v_rate > 0 THEN round(v_used / v_rate, 2) END,
        'pending', CASE WHEN v_pend_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', v_pend_id,
          'amount', v_pend_amt,
          'effective_at', v_pend_eff,
          'confirmable', v_pend_eff <= now()) END);
    END LOOP;
  END LOOP;

  RETURN v_out;
END;
$$;

-- ------------------------------------------------------- the deposit gate
-- Called by the deposit route before it asks a provider for money. Covers
-- both the break (109) and the deposit limit, because both answer the same
-- question: may money move in right now.
CREATE OR REPLACE FUNCTION public.deposit_gate(
  p_user_id UUID, p_amount_local NUMERIC, p_currency TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT;
  v_ends TIMESTAMPTZ;
  v_rate NUMERIC;
  v_blk  JSONB;
BEGIN
  -- The date is rendered in East Africa Time, not the server's UTC: a break
  -- started at 1am in Nairobi ends on a UTC date one day earlier than the one
  -- the person is living in.
  SELECT kind, ends_at INTO v_kind, v_ends FROM public.active_play_break(p_user_id);
  IF v_kind IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'play_break_active', 'message',
      CASE WHEN v_kind = 'self_exclusion'
        THEN 'You have self-excluded, so deposits are closed. You can still withdraw your money at any time.'
        ELSE FORMAT('You are on a break until %s, so deposits are closed. You can still withdraw your money at any time.',
                    to_char(v_ends AT TIME ZONE 'Africa/Nairobi', 'DD FMMonth YYYY'))
      END);
  END IF;

  SELECT rate INTO v_rate FROM public.exchange_rates
   WHERE from_currency = p_currency::public.currency_code AND to_currency = 'USD';
  IF v_rate IS NULL OR v_rate <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'limit_checked', false);
  END IF;

  v_blk := public.play_limit_block(p_user_id, 'deposit', p_amount_local * v_rate);
  IF v_blk IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'deposit_limit', 'message', FORMAT(
      'This would pass the deposit limit you set. %s of %s is left in the last %s.',
      public.play_limit_money((v_blk->>'remaining')::numeric, v_blk->>'currency'),
      public.play_limit_money((v_blk->>'amount')::numeric, v_blk->>'currency'),
      public.play_limit_period_word(v_blk->>'period')), 'detail', v_blk);
  END IF;

  RETURN jsonb_build_object('ok', true, 'limit_checked', true);
END;
$$;

-- ------------------------------------------------------------------ grants
--
-- FROM PUBLIC ALONE IS NOT ENOUGH. Supabase's default privileges grant
-- EXECUTE on every new function in `public` to anon and authenticated
-- explicitly, and revoking the PUBLIC default does not touch an explicit
-- grant. Checked in testing: with only `FROM PUBLIC`,
-- has_function_privilege('anon', 'set_play_limit…') was still true, and the
-- three functions that take a p_user_id are SECURITY DEFINER — any signed-in
-- caller could have read any other user's deposit and loss figures. Each
-- function is revoked from all three, then granted back to exactly who needs
-- it.
REVOKE ALL ON FUNCTION public.play_limit_window(TEXT)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.play_limit_period_word(TEXT)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.play_limit_money(NUMERIC, TEXT)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.play_limit_in_force(UUID, TEXT, TEXT)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.play_limit_used_usd(UUID, TEXT, TEXT)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.play_limit_block(UUID, TEXT, NUMERIC)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_play_limit(TEXT, TEXT, NUMERIC)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_play_limit(UUID)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_play_limit(UUID)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_play_limits()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deposit_gate(UUID, NUMERIC, TEXT)      FROM PUBLIC, anon, authenticated;

-- The four that act on "me" are the user's own. The rest take a p_user_id and
-- stay internal: a SECURITY DEFINER function runs as its owner, so the gates
-- can call them with no grant to the session's role at all.
GRANT EXECUTE ON FUNCTION public.set_play_limit(TEXT, TEXT, NUMERIC)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_play_limit(UUID)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_play_limit(UUID)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_play_limits()                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.play_limit_in_force(UUID, TEXT, TEXT)   TO service_role;
GRANT EXECUTE ON FUNCTION public.play_limit_used_usd(UUID, TEXT, TEXT)   TO service_role;
GRANT EXECUTE ON FUNCTION public.play_limit_block(UUID, TEXT, NUMERIC)   TO service_role;
GRANT EXECUTE ON FUNCTION public.deposit_gate(UUID, NUMERIC, TEXT)       TO service_role;

-- ---------------------------------------------------------- the trade gate
--
-- 105's place_order_for with two statements added (diffed; everything else is
-- byte-identical):
--
--   1. the per-user advisory lock clob_place_order already takes (101), moved
--      up so the limit check and the debit cannot interleave for one user.
--      Same key, transaction-scoped, same position in the lock order (this
--      lock first, then the market row, then 081's ordered wallet locks), so
--      no new deadlock is possible. Re-taking it inside clob_place_order is a
--      no-op within the transaction.
--   2. the break gate (109, ruling I3) and the loss-limit gate (110, ruling
--      I2), on buys only. The break check sits before any book read so it
--      fails fast; the limit check needs the order's cost, so it sits with
--      the minimum-stake check that already computes it.
--
-- v_cost_local is the most this order can cost. A position cannot lose more
-- than it cost, so charging the full cost against the loss limit is the worst
-- case — the limit binds at placement, not at settlement.
CREATE OR REPLACE FUNCTION public.place_order_for(
  p_user_id uuid, p_market_id uuid, p_market_option_id uuid, p_outcome_side order_side,
  p_action clob_action, p_order_type order_type,
  p_price_cents numeric DEFAULT NULL, p_size numeric DEFAULT NULL, p_amount_local numeric DEFAULT NULL,
  p_currency currency_code DEFAULT NULL, p_client_order_id text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL, p_env_flags jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prof     record;
  v_setting  jsonb;
  v_on       boolean;
  v_engine   text;
  v_book     jsonb;
  v_best_ask numeric;
  v_rate     numeric;
  v_amt_usd  numeric;
  v_size     numeric := p_size;
  v_budget   numeric := NULL;
  v_coid     text := p_client_order_id;
  v_hidden   boolean;
  v_min_local  numeric;
  v_cost_local numeric;
  v_kes_rate   numeric;
  v_ask        numeric;
  v_brk_kind   text;       -- [110]
  v_brk_ends   timestamptz;-- [110]
  v_block      jsonb;      -- [110]
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;

  -- [110] see note 1 above: the lock 101 takes, taken one step earlier.
  PERFORM pg_advisory_xact_lock(hashtextextended('clob_user:' || p_user_id::text, 0));

  SELECT account_status::text AS status, country_code, settlement_currency INTO v_prof
    FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND OR v_prof.status <> 'active' THEN
    RAISE EXCEPTION 'Account is not active' USING ERRCODE = 'P0190';
  END IF;
  -- [099] an order that has already expired is refused, not traded (audit #30)
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'This order has already expired (expires_at is in the past)' USING ERRCODE = 'P0196';
  END IF;

  -- [110] ruling I3 / Reg. 84: a break stops PLAY, not PAYOUT. Buys only —
  -- selling is how a position is exited and withdrawing is how the money
  -- comes back, and blocking either would trap funds at the exact moment the
  -- person has asked to stop.
  IF p_action = 'buy' THEN
    SELECT kind, ends_at INTO v_brk_kind, v_brk_ends FROM public.active_play_break(p_user_id);
    IF v_brk_kind IS NOT NULL THEN
      RAISE EXCEPTION '%', CASE WHEN v_brk_kind = 'self_exclusion'
        THEN 'You have self-excluded, so new positions are closed. You can still sell what you hold and withdraw your money.'
        ELSE FORMAT('You are on a break until %s, so new positions are closed. You can still sell what you hold and withdraw your money.',
                    to_char(v_brk_ends AT TIME ZONE 'Africa/Nairobi', 'DD FMMonth YYYY'))
        END USING ERRCODE = 'P0187';
    END IF;
  END IF;

  -- maintenance: env override, else stored (default off)
  IF p_env_flags ? 'maintenance.enabled' THEN
    v_on := (p_env_flags->>'maintenance.enabled')::boolean;
  ELSE
    SELECT value INTO v_setting FROM public.platform_settings WHERE key = 'maintenance.enabled';
    v_on := COALESCE(v_setting = 'true'::jsonb OR v_setting = '"true"'::jsonb, false);
  END IF;
  IF v_on THEN RAISE EXCEPTION 'Kichiko is in maintenance' USING ERRCODE = 'P0191'; END IF;

  -- order-book kill switch: env override, else stored (default off)
  IF p_env_flags ? 'flags.clob' THEN
    v_on := (p_env_flags->>'flags.clob')::boolean;
  ELSE
    SELECT value INTO v_setting FROM public.platform_settings WHERE key = 'flags.clob';
    v_on := COALESCE(v_setting = 'true'::jsonb OR v_setting = '"true"'::jsonb, false);
  END IF;
  IF NOT v_on THEN RAISE EXCEPTION 'Order-book trading is temporarily unavailable' USING ERRCODE = 'P0192'; END IF;

  -- settlement currency of the user's country (079); a request currency is an assertion
  IF v_prof.country_code IS NULL OR v_prof.settlement_currency IS NULL THEN
    RAISE EXCEPTION 'Choose your country in Settings before moving money' USING ERRCODE = 'P0193';
  END IF;
  IF p_currency IS NOT NULL AND p_currency <> v_prof.settlement_currency THEN
    RAISE EXCEPTION 'Your account settles in %; this request was in %', v_prof.settlement_currency, p_currency
      USING ERRCODE = 'P0194';
  END IF;

  SELECT pricing_engine, is_hidden INTO v_engine, v_hidden FROM public.markets WHERE id = p_market_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001'; END IF;
  -- [105] a hidden (taken-down) market takes no new buys. Sells stay open so
  -- holders are never trapped in a position they cannot exit.
  IF v_hidden AND p_action = 'buy' THEN
    RAISE EXCEPTION 'This market is not open for trading' USING ERRCODE = 'P0186';
  END IF;
  IF v_engine IS DISTINCT FROM 'clob' THEN
    RAISE EXCEPTION 'This market is not an order-book market' USING ERRCODE = 'P0103';
  END IF;

  -- [104] a deactivated option is not traded; a frozen wallet does not trade
  -- (withdrawals already refuse it with P0012) (db-core #19)
  IF EXISTS (SELECT 1 FROM public.market_options
              WHERE id = p_market_option_id AND market_id = p_market_id AND is_active IS FALSE) THEN
    RAISE EXCEPTION 'This option is not open for trading' USING ERRCODE = 'P0199';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallets
              WHERE user_id = p_user_id AND currency = v_prof.settlement_currency AND is_active IS FALSE) THEN
    RAISE EXCEPTION 'Wallet is inactive' USING ERRCODE = 'P0012';
  END IF;

  -- a dollar-denominated market buy: shares at the best ask, the amount as the budget
  IF p_order_type = 'market' AND v_size IS NULL AND p_amount_local IS NOT NULL THEN
    v_book := public.clob_get_book(p_market_id, p_market_option_id, p_outcome_side);
    v_best_ask := NULLIF(v_book->>'best_ask', '')::numeric;
    IF v_best_ask IS NULL OR v_best_ask <= 0 THEN
      RAISE EXCEPTION 'No resting liquidity to fill a market order right now' USING ERRCODE = 'P0195';
    END IF;
    SELECT rate INTO v_rate FROM public.exchange_rates
     WHERE from_currency = v_prof.settlement_currency AND to_currency = 'USD';
    IF v_rate IS NULL THEN RAISE EXCEPTION 'Unsupported currency' USING ERRCODE = 'P0003'; END IF;
    v_amt_usd := p_amount_local * v_rate;
    v_size := floor((v_amt_usd / (v_best_ask / 100.0)) * 1e6) / 1e6;
    v_budget := v_amt_usd;
    IF v_size <= 0 THEN RAISE EXCEPTION 'Amount too small to buy any shares' USING ERRCODE = 'P0102'; END IF;
  END IF;
  IF v_size IS NULL OR v_size <= 0 THEN
    RAISE EXCEPTION 'Order size must be greater than zero' USING ERRCODE = 'P0102';
  END IF;

  -- [105] statutory minimum stake on buys (Gambling Control Act 2025 s.71(1):
  -- no online bet under KSh 20), in the user's settlement currency: exactly
  -- KSh 20 for KES; KSh 20 converted through the USD rates otherwise.
  IF p_action = 'buy' THEN
    IF v_rate IS NULL THEN
      SELECT rate INTO v_rate FROM public.exchange_rates
       WHERE from_currency = v_prof.settlement_currency AND to_currency = 'USD';
    END IF;
    IF v_prof.settlement_currency = 'KES' THEN
      v_min_local := 20;
    ELSE
      SELECT rate INTO v_kes_rate FROM public.exchange_rates WHERE from_currency = 'KES' AND to_currency = 'USD';
      v_min_local := CASE WHEN v_kes_rate > 0 AND v_rate > 0 THEN 20 * v_kes_rate / v_rate END;
    END IF;
    IF p_amount_local IS NOT NULL AND p_size IS NULL THEN
      v_cost_local := p_amount_local;
    ELSIF p_order_type = 'limit' AND v_rate > 0 THEN
      v_cost_local := v_size * (p_price_cents / 100.0) / v_rate;
    ELSIF v_rate > 0 THEN
      v_ask := NULLIF(public.clob_get_book(p_market_id, p_market_option_id, p_outcome_side)->>'best_ask', '')::numeric;
      v_cost_local := CASE WHEN v_ask > 0 THEN v_size * (v_ask / 100.0) / v_rate END;
    END IF;
    IF v_min_local IS NOT NULL AND v_cost_local IS NOT NULL AND v_cost_local < v_min_local THEN
      RAISE EXCEPTION 'The minimum stake is KSh 20' USING ERRCODE = 'P0185';
    END IF;

    -- [110] ruling I2 / Reg. 84: the loss limit, charged at the order's full
    -- cost. Without an FX rate the cost cannot be put in the limit's currency,
    -- so the limit cannot be applied; refusing every trade on a missing rate
    -- would be its own outage, and the FX monitor already alarms on one.
    IF v_cost_local IS NOT NULL AND v_rate > 0 THEN
      v_block := public.play_limit_block(p_user_id, 'loss', v_cost_local * v_rate);
      IF v_block IS NOT NULL THEN
        -- Name what this order costs, then what is left. "KSh 100 of KSh 100
        -- is left" — the first wording — was true and useless when nothing
        -- had been spent yet.
        RAISE EXCEPTION 'This order would put % at risk. Your loss limit leaves % in the last %.',
          public.play_limit_money((v_block->>'requested')::numeric, v_block->>'currency'),
          public.play_limit_money((v_block->>'remaining')::numeric, v_block->>'currency'),
          public.play_limit_period_word(v_block->>'period')
          USING ERRCODE = 'P0188';
      END IF;
    END IF;
  END IF;

  IF v_coid IS NULL THEN
    v_coid := 'clob_' || left(p_user_id::text, 8) || '_' || left(md5(random()::text || clock_timestamp()::text), 8);
  END IF;

  RETURN public.clob_place_order(
    p_user_id, p_market_id, p_market_option_id, p_outcome_side, p_action, p_order_type,
    CASE WHEN p_order_type = 'limit' THEN p_price_cents ELSE NULL END,
    v_size, v_prof.settlement_currency, v_coid, p_expires_at, v_budget);
END;
$function$;

COMMIT;
