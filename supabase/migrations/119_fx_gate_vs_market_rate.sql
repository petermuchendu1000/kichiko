-- 119_fx_gate_vs_market_rate.sql
-- ---------------------------------------------------------------------------
-- The FX move-gate was comparing today's market quote against the SHARE PEG.
--
-- WHY (measured 2026-10-16, the first time the job had ever run)
--
-- `job_runs` was empty, so the FX cron had never executed on this project. The
-- first dispatch ran it and it held EVERY currency:
--
--   accepted 0 · held 7 · rejected 0 · 14 observations from 2-3 sources each
--   every one with reason `large_move`
--
-- The moves it saw were all ~26%, which is not what currencies do in unison.
-- They were measured against the wrong number:
--
--   | cur | stored units_per_usd | live quote | "move" |
--   | KES | 100.00 (exactly)     | 129.89     | 26.2%  |
--   | TZS | 2026.22              | 2644.56    | 26.6%  |
--   | ETB | 123.98               | 160.92     | 26.1%  |
--
-- KES stored as exactly 100 is the tell: that is the SHARE PEG from migration
-- 113 (one share = KSh 100), not an exchange rate. 113 redefined
-- `units_per_usd` — and `rate` — as the share-unit rate and moved the real
-- market quote into the new `market_rate` column. The gate at 077 kept reading
-- `units_per_usd`, so from that moment every incoming quote looked like a ~26%
-- jump and was held. The gate holds anything over 10% unconditionally, so this
-- was not a delay: FX ingestion was frozen permanently, and would have stayed
-- frozen on a multi-currency platform.
--
-- This is a regression introduced by 113 earlier the same day, found only
-- because the scheduler (118) ran the job for the first time.
--
-- THE FIX, AND THE PROOF IT IS THE RIGHT ONE
--
-- Compare against `market_rate`. Re-measured against the same live quotes:
--
--   | cur | vs peg | vs market | after |
--   | ETB | 26.1%  | 0.00%     | accept |
--   | BIF | 26.1%  | 0.03%     | accept |
--   | RWF | 26.0%  | 0.05%     | accept |
--   | KES | 26.2%  | 0.07%     | accept |
--   | TZS | 26.6%  | 0.55%     | accept |
--   | UGX | 23.6%  | 2.45%     | accept |
--   | ZMW | 33.9%  | 7.86%     | HELD   |
--
-- Six of seven land inside 0.6%, which is what a correct comparison against a
-- current quote looks like and is the evidence that the fetched data was right
-- all along. ZMW still holds, and should: its stored quote is ~80 days old and
-- only ONE source reported it, so the 3-10% band's "two agreeing sources" rule
-- catches it. The safety behaviour is unchanged — only the column it reads.
--
--
-- A SECOND, DEEPER BUG FOUND WHILE VERIFYING THE FIRST
--
-- Unfreezing the gate made the next bug reachable: the accepted write was
-- CORRUPTING the stored quote, one generation per run.
--
--   ETB before: share_unit 123.98, market 160.92   (correct)
--   ETB after : share_unit  95.52, market 123.98   (the old share unit, now
--                                                   stored as a market quote)
--
-- ON CONFLICT DO UPDATE evaluates EXCLUDED from the row AS MODIFIED BY THE
-- BEFORE INSERT TRIGGER. 113's trigger rewrites `rate` to the share unit, so
-- by the time the conflict is detected EXCLUDED.rate is 0.008066 (1/123.98),
-- not the provider's 0.006214 (1/160.92). The BEFORE UPDATE trigger then sees
-- a `rate` that differs from OLD, concludes a provider quote arrived, and
-- copies the SHARE UNIT into market_rate. Next run, the same again, ~23% lower
-- each time. KES escaped only because share_unit_rate returns a hard-coded
-- 0.01 for it, so its `rate` never changes and the branch never fires.
--
-- The trigger's own comment states the contract: "Only treat `rate` as a
-- provider quote when the caller did not state a market_rate of its own." The
-- FX writer simply never stated one. It does now, on both the INSERT and the
-- DO UPDATE, which puts it on the trigger's intended path and makes the write
-- idempotent: re-running with the same quotes reproduces the same row.
--
-- WHAT IS NOT CHANGED
--
-- 113's trigger, and the peg itself. The trigger is correct and is left alone;
-- proven by probe, feeding it the true quote restores ETB to 123.98/160.92
-- exactly. What changed is that the writer now tells it what the quote is
-- instead of leaving it to infer one from a value the trigger had itself
-- rewritten.

BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_fx_observations(p_obs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch    uuid := gen_random_uuid();
  v_row      jsonb;
  v_code     text;
  v_units    numeric;
  v_date     date;
  v_src      text;
  v_official boolean;
  v_cur      currency_code;
  v_n        integer;
  v_median   numeric;
  v_spread   numeric;
  v_agree    integer;
  v_stored   numeric;
  v_move     numeric;
  v_reason   text;
  v_ok       boolean;
  v_accepted integer := 0;
  v_held     integer := 0;
  v_rejected integer := 0;
  v_skipped  integer := 0;
  v_detail   jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF p_obs IS NULL OR jsonb_typeof(p_obs) <> 'array' THEN
    RAISE EXCEPTION 'p_obs must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.fx_in76 (currency currency_code, units numeric, rate_date date, source text, in_band boolean, official boolean) ON COMMIT DROP;
  -- [077] WHERE true: pg-safeupdate (PostgREST sessions) refuses a WHERE-less DELETE
  DELETE FROM pg_temp.fx_in76 WHERE true;   -- a second call in the same transaction starts empty

  -- 1. parse; skip USD, unknown codes, non-numeric and non-positive quotes
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_obs) LOOP
    v_code := upper(NULLIF(v_row->>'currency', ''));
    BEGIN v_units := (v_row->>'units_per_usd')::numeric; EXCEPTION WHEN others THEN v_units := NULL; END;
    BEGIN v_date := (v_row->>'rate_date')::date;          EXCEPTION WHEN others THEN v_date := NULL; END;
    v_src := COALESCE(NULLIF(v_row->>'source', ''), 'unknown');
    BEGIN v_official := COALESCE((v_row->>'official')::boolean, false); EXCEPTION WHEN others THEN v_official := false; END;
    IF v_code IS NULL OR v_code = 'USD' OR v_units IS NULL OR v_units <= 0
       OR NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                       WHERE t.typname = 'currency_code' AND e.enumlabel = v_code) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    INSERT INTO pg_temp.fx_in76 VALUES (v_code::currency_code, v_units, COALESCE(v_date, current_date), v_src,
      EXISTS (SELECT 1 FROM public.fx_bands b WHERE b.currency = v_code::currency_code
                AND v_units BETWEEN b.min_units_per_usd AND b.max_units_per_usd), v_official);
  END LOOP;

  -- 2. out-of-band quotes (and currencies with no band) are rejected outright
  INSERT INTO public.fx_observations (batch_id, currency, units_per_usd, rate_date, source, official, accepted, reason)
    SELECT v_batch, currency, units, rate_date, source, official, false, 'out_of_band' FROM pg_temp.fx_in76 WHERE NOT in_band;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rejected := v_rejected + v_n;

  -- 3. per currency: consensus, then the move gate against the stored rate
  FOR v_cur IN SELECT DISTINCT currency FROM pg_temp.fx_in76 WHERE in_band ORDER BY 1 LOOP
    SELECT count(*), (max(units) - min(units)) / percentile_cont(0.5) WITHIN GROUP (ORDER BY units)::numeric
      INTO v_n, v_spread
      FROM pg_temp.fx_in76 WHERE in_band AND currency = v_cur;
    -- [076] candidate: median of the official quotes when any, else of all
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY units)::numeric INTO v_median
      FROM pg_temp.fx_in76 WHERE in_band AND currency = v_cur
       AND (official OR NOT EXISTS (SELECT 1 FROM pg_temp.fx_in76 o WHERE o.in_band AND o.currency = v_cur AND o.official));
    SELECT count(*) INTO v_agree FROM pg_temp.fx_in76
      WHERE in_band AND currency = v_cur AND abs(units / v_median - 1) <= 0.01;
    -- [119] Compare against the MARKET quote, not the share unit.
    -- 113 pegged units_per_usd (and rate) to the share unit — KES is literally
    -- 100 — so this read was measuring today's market quote against a constant
    -- and calling the difference a 26% move. market_rate is the column 113 added
    -- to hold the real quote; the old columns remain the fallback for rows
    -- written before 113, where market_rate is NULL.
    SELECT COALESCE(1 / NULLIF(market_rate, 0), units_per_usd, 1 / NULLIF(rate, 0)) INTO v_stored
      FROM public.exchange_rates WHERE from_currency = v_cur AND to_currency = 'USD';

    v_ok := true; v_reason := CASE WHEN v_n > 1 AND v_spread > 0.01 THEN 'accepted_median' ELSE 'accepted' END;
    IF v_n > 1 AND v_spread > 0.02 THEN
      v_ok := false; v_reason := 'sources_disagree';
    ELSIF v_stored IS NOT NULL THEN
      v_move := abs(ln(v_median / v_stored));
      IF v_move > 0.10 OR (v_move > 0.03 AND v_agree < 2) THEN
        v_ok := false; v_reason := 'large_move';
      END IF;
    END IF;

    INSERT INTO public.fx_observations (batch_id, currency, units_per_usd, rate_date, source, official, accepted, reason)
      SELECT v_batch, currency, units, rate_date, source, official, v_ok, v_reason
        FROM pg_temp.fx_in76 WHERE in_band AND currency = v_cur;

    IF v_ok THEN
      -- [119] State market_rate EXPLICITLY. See the header: without it, the
      -- BEFORE INSERT trigger rewrites `rate` to the share unit before the
      -- conflict is detected, EXCLUDED carries that rewritten value, and the
      -- BEFORE UPDATE trigger then mistakes the share rate for a fresh quote.
      INSERT INTO public.exchange_rates (from_currency, to_currency, rate, units_per_usd, market_rate, rate_date, source, fetched_at)
        SELECT v_cur, 'USD', ROUND(1 / v_median, 8), ROUND(v_median, 8), ROUND(1 / v_median, 8), max(rate_date),
               string_agg(DISTINCT source, '+' ORDER BY source), now()
          FROM pg_temp.fx_in76 WHERE in_band AND currency = v_cur
           AND (official OR NOT EXISTS (SELECT 1 FROM pg_temp.fx_in76 o WHERE o.in_band AND o.currency = v_cur AND o.official))
      ON CONFLICT (from_currency, to_currency) DO UPDATE SET
        rate = EXCLUDED.rate, units_per_usd = EXCLUDED.units_per_usd,
        -- EXCLUDED.market_rate is the quote this statement stated, and the
        -- INSERT trigger leaves a stated market_rate alone — so this is the one
        -- value in EXCLUDED that is still the provider's number.
        market_rate = EXCLUDED.market_rate,
        rate_date = EXCLUDED.rate_date,
        source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at;
      v_accepted := v_accepted + 1;
    ELSE
      v_held := v_held + 1;
    END IF;
    v_detail := v_detail || jsonb_build_object(v_cur::text, jsonb_build_object(
      'outcome', CASE WHEN v_ok THEN 'accepted' ELSE 'held' END, 'reason', v_reason,
      'units_per_usd', v_median, 'sources', v_n));
  END LOOP;

  RETURN jsonb_build_object('batch_id', v_batch, 'accepted', v_accepted, 'held', v_held,
                            'rejected', v_rejected, 'skipped', v_skipped, 'currencies', v_detail);
END;
$function$;

COMMIT;
