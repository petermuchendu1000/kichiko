-- 075_fx_rate_gates.sql
-- ---------------------------------------------------------------------------
-- FX rate validation gates, enforced in the database (bug register O1 / audit
-- finding "FX without sanity bounds").
--
-- BUG: upsert_exchange_rates (016, 052) accepted ANY positive number. One bad
-- provider datapoint (KES at 5 per USD, a 96% move) or a single-source jump
-- replaced the rate that order escrow (clob_place_order), deposits,
-- withdrawals and settlement all convert with. Nothing recorded what a
-- provider had said, or the publisher's value date, so staleness was invisible.
-- Repro: scripts/ops/fx/test_fx_gates.py (G1, G2 red on 074).
--
-- FIX (design and measured thresholds: docs/research/engine-2026-09/14-FX-SOURCES.md §6)
--   * exchange_rates gains rate_date (publisher's value date) and
--     units_per_usd (the published quote, exact; `rate` stays USD per unit,
--     derived as ROUND(1/units_per_usd, 8), so every reader is unchanged).
--   * fx_bands: hard sanity band per currency in units per USD. Changing a band
--     needs a migration (human sign-off). Bands are the 2024-2026 observed
--     ranges widened by about 25% (report §6.2).
--   * fx_observations: append-only record of every quote received, with its
--     outcome (accepted / held / rejected) and reason.
--   * upsert_fx_observations(p_obs jsonb): the ONLY write path. Per currency:
--       1. out-of-band quotes are rejected (out_of_band);
--       2. in-band quotes: candidate = median; spread = (max - min) / median;
--          more than one source with spread > 2%  -> held (sources_disagree);
--       3. move = |ln(candidate / stored)|:
--            > 10%                                 -> held (large_move);
--            3-10% unless >= 2 sources within 1%   -> held (large_move);
--            otherwise accepted. No stored rate yet -> accepted (in band).
--     Thresholds from measured data (report §4.3-4.5): day-over-day p99 moves
--     0.5-2.4%, official vs aggregator same-day deviation < 0.75%; the largest
--     real official move in 2024-2026 was KES -4.9% (2024-02-16), which passes
--     with two agreeing sources.
--   * upsert_exchange_rates (the current cron's entry point) keeps its
--     signature and return keys but forwards to upsert_fx_observations, so no
--     writer bypasses the gates.
-- Held quotes keep the last good rate; they are visible in fx_observations.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.exchange_rates
  ADD COLUMN IF NOT EXISTS rate_date date,
  ADD COLUMN IF NOT EXISTS units_per_usd numeric(20,8) CHECK (units_per_usd IS NULL OR units_per_usd > 0);

CREATE TABLE IF NOT EXISTS public.fx_bands (
  currency          currency_code PRIMARY KEY,
  min_units_per_usd numeric NOT NULL CHECK (min_units_per_usd > 0),
  max_units_per_usd numeric NOT NULL,
  CHECK (max_units_per_usd > min_units_per_usd)
);
INSERT INTO public.fx_bands (currency, min_units_per_usd, max_units_per_usd) VALUES
  ('KES',  100,  180),
  ('UGX', 3000, 5000),
  ('TZS', 2000, 3500),
  ('RWF', 1200, 2000),
  ('ZMW',   12,   35),
  ('ETB',  100,  300),
  ('BIF', 2500, 4500)
ON CONFLICT (currency) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fx_observations (
  id            bigserial PRIMARY KEY,
  batch_id      uuid NOT NULL,
  currency      currency_code NOT NULL,
  units_per_usd numeric NOT NULL,
  rate_date     date,
  source        text NOT NULL,
  observed_at   timestamptz NOT NULL DEFAULT now(),
  accepted      boolean NOT NULL,
  reason        text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fx_observations_currency_time ON public.fx_observations (currency, observed_at DESC);

-- internal tables: no client access (service role / definer functions only)
ALTER TABLE public.fx_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fx_bands, public.fx_observations FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SEQUENCE public.fx_observations_id_seq FROM anon, authenticated, PUBLIC;

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

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.fx_in (currency currency_code, units numeric, rate_date date, source text, in_band boolean) ON COMMIT DROP;
  DELETE FROM pg_temp.fx_in;   -- a second call in the same transaction starts empty

  -- 1. parse; skip USD, unknown codes, non-numeric and non-positive quotes
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_obs) LOOP
    v_code := upper(NULLIF(v_row->>'currency', ''));
    BEGIN v_units := (v_row->>'units_per_usd')::numeric; EXCEPTION WHEN others THEN v_units := NULL; END;
    BEGIN v_date := (v_row->>'rate_date')::date;          EXCEPTION WHEN others THEN v_date := NULL; END;
    v_src := COALESCE(NULLIF(v_row->>'source', ''), 'unknown');
    IF v_code IS NULL OR v_code = 'USD' OR v_units IS NULL OR v_units <= 0
       OR NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                       WHERE t.typname = 'currency_code' AND e.enumlabel = v_code) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    INSERT INTO pg_temp.fx_in VALUES (v_code::currency_code, v_units, COALESCE(v_date, current_date), v_src,
      EXISTS (SELECT 1 FROM public.fx_bands b WHERE b.currency = v_code::currency_code
                AND v_units BETWEEN b.min_units_per_usd AND b.max_units_per_usd));
  END LOOP;

  -- 2. out-of-band quotes (and currencies with no band) are rejected outright
  INSERT INTO public.fx_observations (batch_id, currency, units_per_usd, rate_date, source, accepted, reason)
    SELECT v_batch, currency, units, rate_date, source, false, 'out_of_band' FROM pg_temp.fx_in WHERE NOT in_band;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_rejected := v_rejected + v_n;

  -- 3. per currency: consensus, then the move gate against the stored rate
  FOR v_cur IN SELECT DISTINCT currency FROM pg_temp.fx_in WHERE in_band ORDER BY 1 LOOP
    SELECT count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY units)::numeric,
           (max(units) - min(units)) / percentile_cont(0.5) WITHIN GROUP (ORDER BY units)::numeric
      INTO v_n, v_median, v_spread
      FROM pg_temp.fx_in WHERE in_band AND currency = v_cur;
    SELECT count(*) INTO v_agree FROM pg_temp.fx_in
      WHERE in_band AND currency = v_cur AND abs(units / v_median - 1) <= 0.01;
    SELECT COALESCE(units_per_usd, 1 / NULLIF(rate, 0)) INTO v_stored
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

    INSERT INTO public.fx_observations (batch_id, currency, units_per_usd, rate_date, source, accepted, reason)
      SELECT v_batch, currency, units, rate_date, source, v_ok, v_reason
        FROM pg_temp.fx_in WHERE in_band AND currency = v_cur;

    IF v_ok THEN
      INSERT INTO public.exchange_rates (from_currency, to_currency, rate, units_per_usd, rate_date, source, fetched_at)
        SELECT v_cur, 'USD', ROUND(1 / v_median, 8), ROUND(v_median, 8), max(rate_date),
               string_agg(DISTINCT source, '+' ORDER BY source), now()
          FROM pg_temp.fx_in WHERE in_band AND currency = v_cur
      ON CONFLICT (from_currency, to_currency) DO UPDATE SET
        rate = EXCLUDED.rate, units_per_usd = EXCLUDED.units_per_usd, rate_date = EXCLUDED.rate_date,
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

REVOKE EXECUTE ON FUNCTION public.upsert_fx_observations(jsonb) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.upsert_fx_observations(jsonb) TO service_role;

-- The current cron's entry point: same signature and return keys
-- ({upserted, skipped}), now forwarded through the gates. `rate` is USD per
-- unit, so units_per_usd = 1 / rate.
CREATE OR REPLACE FUNCTION public.upsert_exchange_rates(p_rates jsonb, p_source text DEFAULT 'cron'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_obs jsonb := '[]'::jsonb;
  v_row jsonb;
  v_rate numeric;
  v_skip integer := 0;
  v_res jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF p_rates IS NULL OR jsonb_typeof(p_rates) <> 'array' THEN
    RAISE EXCEPTION 'p_rates must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rates) LOOP
    BEGIN v_rate := (v_row->>'rate')::numeric; EXCEPTION WHEN others THEN v_rate := NULL; END;
    IF v_rate IS NULL OR v_rate <= 0 THEN v_skip := v_skip + 1; CONTINUE; END IF;
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'currency', v_row->>'from_currency', 'units_per_usd', 1 / v_rate,
      'rate_date', current_date, 'source', COALESCE(p_source, 'cron')));
  END LOOP;
  v_res := public.upsert_fx_observations(v_obs);
  RETURN jsonb_build_object(
    'upserted', (v_res->>'accepted')::int,
    'skipped',  v_skip + (v_res->>'skipped')::int + (v_res->>'held')::int + (v_res->>'rejected')::int,
    'held',     (v_res->>'held')::int,
    'rejected', (v_res->>'rejected')::int,
    'batch_id', v_res->'batch_id');
END;
$function$;

COMMIT;
