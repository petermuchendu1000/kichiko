-- 077_fx_safeupdate.sql
-- ---------------------------------------------------------------------------
-- BUG (found by an end-to-end run through a real PostgREST): Supabase preloads
-- pg-safeupdate for the `authenticator` role PostgREST connects as
-- (rolconfig session_preload_libraries=safeupdate), and safeupdate refuses any
-- UPDATE or DELETE without a WHERE clause, including inside functions. The
-- temp-table reset in upsert_fx_observations (075/076),
--     DELETE FROM pg_temp.fx_in76;
-- therefore failed with 21000 "DELETE requires a WHERE clause" on EVERY call
-- made through the API: the FX cron route and scripts/ops/fx/refresh_fx.mjs
-- (and upsert_exchange_rates, which forwards to it). psql sessions do not load
-- safeupdate, so the SQL harness missed it.
--
-- FIX: `DELETE FROM pg_temp.fx_in76 WHERE true;`. Nothing else changes: the
-- function is 076's verbatim apart from that line (diffed).
-- Regression: scripts/ops/fx/test_fx_gates.py G14 (runs under safeupdate on
-- the Supabase image); scripts/lint_migrations.py now rejects a WHERE-less
-- UPDATE/DELETE in new migrations.
-- ---------------------------------------------------------------------------

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

    INSERT INTO public.fx_observations (batch_id, currency, units_per_usd, rate_date, source, official, accepted, reason)
      SELECT v_batch, currency, units, rate_date, source, official, v_ok, v_reason
        FROM pg_temp.fx_in76 WHERE in_band AND currency = v_cur;

    IF v_ok THEN
      INSERT INTO public.exchange_rates (from_currency, to_currency, rate, units_per_usd, rate_date, source, fetched_at)
        SELECT v_cur, 'USD', ROUND(1 / v_median, 8), ROUND(v_median, 8), max(rate_date),
               string_agg(DISTINCT source, '+' ORDER BY source), now()
          FROM pg_temp.fx_in76 WHERE in_band AND currency = v_cur
           AND (official OR NOT EXISTS (SELECT 1 FROM pg_temp.fx_in76 o WHERE o.in_band AND o.currency = v_cur AND o.official))
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

COMMIT;
