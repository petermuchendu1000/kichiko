-- 078_fx_admin_override.sql
-- ---------------------------------------------------------------------------
-- The admin FX override (admin_upsert_exchange_rate, 012; settings:write,
-- audited) is the confirmation path for quotes the 075-077 gates hold (e.g.
-- ZMW, whose only machine-readable source is one aggregator, so a stale
-- stored rate holds every new quote as a large move). Two bugs:
--
--   1. It wrote `rate` but left `units_per_usd` and `rate_date` (added in 075)
--      at their previous values. The columns then disagreed, and the gates
--      compared the next quote against the stale units_per_usd, so an admin
--      correction was ignored by the next refresh (test_fx_gates.py G15, G16).
--   2. It accepted any positive rate: a typo such as 1.95 ZMW per USD instead
--      of 19.5 went straight into escrow, deposit, withdrawal and settlement
--      conversions (G17).
--
-- FIX
--   * admin_upsert_exchange_rate (same signature, grants, capability check and
--     audit_log row): for a rate to USD it rejects a value outside the
--     currency's fx_bands range, sets units_per_usd = 1/rate and
--     rate_date = today, and records the override in fx_observations
--     (source 'admin:<source>', reason 'admin_override').
--   * trigger exchange_rates_units_consistent: any other UPDATE that changes
--     `rate` without setting units_per_usd clears units_per_usd, so readers
--     and the gates fall back to 1/rate instead of a stale quote.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION public.exchange_rates_units_consistent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.rate IS DISTINCT FROM OLD.rate AND NEW.units_per_usd IS NOT DISTINCT FROM OLD.units_per_usd THEN
    NEW.units_per_usd := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_exchange_rates_units_consistent ON public.exchange_rates;
CREATE TRIGGER trg_exchange_rates_units_consistent
  BEFORE UPDATE ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.exchange_rates_units_consistent();

CREATE OR REPLACE FUNCTION public.admin_upsert_exchange_rate(
  p_from   currency_code,
  p_to     currency_code,
  p_rate   NUMERIC,
  p_source TEXT DEFAULT 'manual'
)
RETURNS public.exchange_rates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old   public.exchange_rates%ROWTYPE;
  v_row   public.exchange_rates%ROWTYPE;
  v_band  public.fx_bands%ROWTYPE;
  v_units numeric;
BEGIN
  IF NOT public.has_capability('settings:write') THEN
    RAISE EXCEPTION 'Insufficient permissions (settings:write required)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 THEN
    RAISE EXCEPTION 'Rate must be a positive number' USING ERRCODE = 'check_violation';
  END IF;

  -- [078] sanity band (typo guard) for rates to USD; bands change only by migration
  IF p_to = 'USD' THEN
    v_units := 1 / p_rate;
    SELECT * INTO v_band FROM public.fx_bands WHERE currency = p_from;
    IF FOUND AND (v_units < v_band.min_units_per_usd OR v_units > v_band.max_units_per_usd) THEN
      RAISE EXCEPTION 'Rate % % per USD is outside the sanity band [%, %]',
        round(v_units, 4), p_from, v_band.min_units_per_usd, v_band.max_units_per_usd
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT * INTO v_old FROM public.exchange_rates
    WHERE from_currency = p_from AND to_currency = p_to;

  INSERT INTO public.exchange_rates (from_currency, to_currency, rate, units_per_usd, rate_date, source, fetched_at)
  VALUES (p_from, p_to, p_rate, ROUND(v_units, 8), CASE WHEN p_to = 'USD' THEN current_date END,
          COALESCE(p_source, 'manual'), NOW())
  ON CONFLICT (from_currency, to_currency) DO UPDATE
    SET rate = EXCLUDED.rate, units_per_usd = EXCLUDED.units_per_usd, rate_date = EXCLUDED.rate_date,
        source = EXCLUDED.source, fetched_at = NOW()
  RETURNING * INTO v_row;

  IF p_to = 'USD' THEN
    INSERT INTO public.fx_observations (batch_id, currency, units_per_usd, rate_date, source, official, accepted, reason)
    VALUES (gen_random_uuid(), p_from, v_units, current_date, 'admin:' || COALESCE(p_source, 'manual'), false, true, 'admin_override');
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, old_data, new_data)
  VALUES (auth.uid(), 'fx.upsert_rate', 'exchange_rate', NULL,
          CASE WHEN v_old.id IS NULL THEN NULL ELSE jsonb_build_object(
            'from', v_old.from_currency, 'to', v_old.to_currency, 'rate', v_old.rate) END,
          jsonb_build_object('from', p_from, 'to', p_to, 'rate', p_rate, 'source', COALESCE(p_source, 'manual')));
  RETURN v_row;
END;
$$;

COMMIT;
