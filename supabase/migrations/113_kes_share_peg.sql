-- 113_kes_share_peg.sql
-- ---------------------------------------------------------------------------
-- One share settles at KSh 100. The shilling price of an outcome IS its
-- probability in percent.
--
-- WHY (measured 2026-10-16, recorded in docs/research/ui-2026-09/43-FX-AND-THE-SHARE-UNIT.md)
--
-- A share settled at $1, displayed to a Kenyan at the live CBK rate (~129.81).
-- Two consequences, both measured rather than argued:
--
--   1. THE BOARD CONTRADICTED ITSELF. The same outcome printed "46%" and
--      "KSh 60" side by side, and Yes + No summed to KSh 130. Polymarket's
--      cent convention reads cleanly only because $1 = 100c makes price and
--      probability the same number; settling at $1 ~ KSh 130 is exactly what
--      threw that away.
--
--   2. THE DISPLAY HAD DRIFTED OFF THE LEDGER. The ledger was already written
--      at 100: sum(transactions.amount) / sum(transactions.amount_usd) =
--      100.0001 across 2,907 rows, and 2,289 of 2,291 clob_orders carry
--      exchange_rate_to_usd = 0.01 exactly. Only THREE rows in the entire
--      database were ever written at a live FX rate. Meanwhile the open book
--      -- 1,574,018 internal units, which cost users KSh 157,401,812 -- was
--      being valued on screen at KSh 204,323,293. Every open position was
--      overstated by 29.8%.
--
-- So this migration does not re-denominate anything. It makes the conversion
-- agree with the ledger that already exists. No user balance, position, order
-- or transaction row is touched.
--
-- HOW
--
-- `exchange_rates.rate` becomes the local -> SHARE-UNIT rate, where one share
-- is 1.0 units and one unit is KSh 1. KES is pegged at exactly 0.01. Every
-- other currency is a cross through the KES market quote, so a share costs the
-- same economic amount in any currency.
--
-- The provider's honest local->USD quote moves to `market_rate`, and every
-- observation keeps flowing into `fx_observations` untouched (125 KES rows
-- over 20 days at the time of writing). The peg is therefore auditable: the
-- market rate is still measured and stored every cycle, it simply no longer
-- decides what a share costs.
--
-- This is deliberately the ONE place the peg lives. Every consumer -- the app
-- (`buildRatesMap` -> `getUsdRate`), the order engine (099/101/102/104/105/110
-- all read `exchange_rates.rate`), the admin and marketer money formatters --
-- picks it up with no further change. `lib/currency.ts` additionally hard-
-- guards KES in code, so a bad row can never un-peg the product.

-- 0. Stand the peg trigger down before touching anything.
--
-- Not hygiene — ordering. The trigger is (re)created at step 4, so on a
-- re-run the PREVIOUS version is still live while steps 1-3 write, and it
-- rewrites what they write. Measured: run 1 left UGX at 1,454.78 per share and
-- run 2 at 3,196.73 from identical input. A migration whose result depends on
-- how many times it has run is not idempotent, whatever its WHERE clauses say.
DROP TRIGGER IF EXISTS trg_fx_apply_share_peg ON public.exchange_rates;

-- 1. The provider's quote gets its own column, and keeps its meaning.
ALTER TABLE public.exchange_rates
  ADD COLUMN IF NOT EXISTS market_rate NUMERIC;

COMMENT ON COLUMN public.exchange_rates.market_rate
  IS 'The FX provider''s honest local->USD quote. Never used to price a share; kept for observability, cross-rates and reversibility of the peg.';
COMMENT ON COLUMN public.exchange_rates.rate
  IS 'local -> SHARE-UNIT rate (migration 113). One share = 1.0 units = KSh 100, so KES is pegged at exactly 0.01. Non-KES currencies are a cross through the KES market quote. NOT a market FX rate: that is market_rate.';

-- Restore market_rate from the measurements themselves, every run.
--
-- The first draft seeded it with `market_rate = rate WHERE market_rate IS
-- NULL` and relied on that guard for idempotence. It was not enough: the
-- trigger below (step 4) captured the DERIVED rate written by step 3 as if it
-- were a provider quote, so a second run crossed an already-crossed number and
-- UGX moved 3,181 -> 2,451 per share. Caught by re-running the migration and
-- reading the table, which is the only reason it is not in the repository.
--
-- Deriving from `fx_observations` instead makes the migration converge no
-- matter how often it runs: the observations are raw provider readings and
-- nothing in this file writes to them. The latest accepted reading per
-- currency is used, which is the quote the FX job itself would have published.
WITH latest AS (
  SELECT DISTINCT ON (currency) currency, units_per_usd
    FROM public.fx_observations
   WHERE accepted AND units_per_usd > 0
   ORDER BY currency, rate_date DESC, observed_at DESC
)
UPDATE public.exchange_rates e
   SET market_rate = 1 / l.units_per_usd
  FROM latest l
 WHERE e.from_currency::text = l.currency::text
   AND e.to_currency = 'USD';

-- Two currencies have no observation to restore from:
--   USD — the share unit's own code; the identity, by definition.
--   ZMW — its row predates the multi-source job (source `exchangerate-api`,
--         fetched 2026-07-25) and no provider in fx-sources.ts quotes it, so
--         the value recorded in exchange_rates before this migration is the
--         only measurement that exists. Written explicitly so a re-run cannot
--         compound it.
UPDATE public.exchange_rates SET market_rate = 1
 WHERE from_currency = 'USD' AND to_currency = 'USD';
UPDATE public.exchange_rates SET market_rate = 0.05392548
 WHERE from_currency = 'ZMW' AND to_currency = 'USD';

-- 2. The peg itself, as a function so the app, the engine and the FX job
--    cannot drift apart.
CREATE OR REPLACE FUNCTION public.kes_per_share()
RETURNS NUMERIC LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 100::numeric $$;

COMMENT ON FUNCTION public.kes_per_share()
  IS 'Shillings paid by one winning share. The product peg (migration 113). Changing this alone does not re-peg the system: exchange_rates.rate must be recomputed with share_unit_rate().';

/**
 * local -> share-unit rate for a currency, given its market local->USD quote.
 * KES is the anchor; everything else crosses through it so one share costs the
 * same economic amount whatever currency it is quoted in.
 */
CREATE OR REPLACE FUNCTION public.share_unit_rate(p_currency TEXT, p_market_rate NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_peg      NUMERIC := 1 / public.kes_per_share();   -- 0.01
  v_kes_mkt  NUMERIC;
BEGIN
  IF p_currency = 'KES' THEN
    RETURN v_peg;
  END IF;
  -- 'USD' is the share unit's OWN code, not a US dollar: thirty ledger columns
  -- are named `_usd` and hold share units. It is the identity, so its rate is
  -- 1 by definition, and one of them is KSh 100. lib/currency.ts guards the
  -- same case for the same reason; the two must not disagree, or the engine
  -- and the app would price a unit differently. No wallet or profile settles
  -- in USD (checked at migration time: all 74 are KES).
  IF p_currency = 'USD' THEN
    RETURN 1;
  END IF;
  IF p_market_rate IS NULL OR p_market_rate <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT market_rate INTO v_kes_mkt
    FROM public.exchange_rates
   WHERE from_currency = 'KES' AND to_currency = 'USD';

  -- Without a KES market quote there is no honest cross. Returning NULL leaves
  -- the existing rate in place rather than inventing one — the same refusal
  -- lib/currency.ts makes when it throws instead of falling back to a magic
  -- number.
  IF v_kes_mkt IS NULL OR v_kes_mkt <= 0 THEN
    RETURN NULL;
  END IF;

  -- units(X) = USD(X) / USD(KES) * peg
  RETURN p_market_rate / v_kes_mkt * v_peg;
END;
$$;

-- 3. Re-express every stored rate in share units. KES first, so the cross used
--    by the others reads a settled anchor.
UPDATE public.exchange_rates
   SET rate = 1 / public.kes_per_share(),
       units_per_usd = public.kes_per_share(),
       source = 'peg',
       fetched_at = now()
 WHERE from_currency = 'KES' AND to_currency = 'USD';

UPDATE public.exchange_rates e
   SET rate = public.share_unit_rate(e.from_currency::text, e.market_rate),
       units_per_usd = CASE
         WHEN public.share_unit_rate(e.from_currency::text, e.market_rate) > 0
           THEN 1 / public.share_unit_rate(e.from_currency::text, e.market_rate)
       END
 WHERE e.from_currency <> 'KES'
   AND public.share_unit_rate(e.from_currency::text, e.market_rate) IS NOT NULL;

-- 4. Keep it pegged. The FX job writes `rate` straight from the provider
--    median (076), which would un-peg KES on the next cycle. A BEFORE trigger
--    moves that quote to market_rate and re-derives the unit rate, so the job
--    needs no change and cannot win a race with the peg.
CREATE OR REPLACE FUNCTION public.fx_apply_share_peg()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_unit NUMERIC;
BEGIN
  -- Only treat `rate` as a provider quote when the caller did not state a
  -- market_rate of its own.
  --
  -- The first version keyed off `source <> 'peg'`, which is wrong for any
  -- writer that computes the unit rate itself — including step 3 of this very
  -- migration, whose derived value was then captured as a market quote and
  -- crossed again on the next run (UGX 3,181 -> 2,451 per share). The FX job
  -- (076) writes only `rate` and never `market_rate`, so it still lands in the
  -- first branch exactly as intended.
  IF TG_OP = 'INSERT' THEN
    IF NEW.market_rate IS NULL THEN NEW.market_rate := NEW.rate; END IF;
  ELSIF NEW.market_rate IS NOT DISTINCT FROM OLD.market_rate
        AND NEW.rate IS DISTINCT FROM OLD.rate THEN
    NEW.market_rate := NEW.rate;
  END IF;

  v_unit := public.share_unit_rate(NEW.from_currency::text, NEW.market_rate);
  IF v_unit IS NOT NULL AND v_unit > 0 THEN
    NEW.rate := v_unit;
    NEW.units_per_usd := 1 / v_unit;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fx_apply_share_peg ON public.exchange_rates;
CREATE TRIGGER trg_fx_apply_share_peg
  BEFORE INSERT OR UPDATE ON public.exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.fx_apply_share_peg();

-- 5. The sanity band for KES was 100-180 units per USD, which put the peg
--    exactly on the floor. The band guards the MARKET observation, which is
--    still collected and still needs guarding, so it is widened downward
--    rather than removed — a genuine CBK print below 100 would still be
--    rejected as implausible, but the peg's own value is no longer at the edge.
UPDATE public.fx_bands SET min_units_per_usd = 80 WHERE currency = 'KES';

-- Bands exist for KES and UGX only; the other five supported currencies had
-- none, so a poisoned quote for them was accepted unchecked (noted in the FX
-- dossier). Ranges are wide on purpose: this is a plausibility floor, not a
-- forecast.
INSERT INTO public.fx_bands (currency, min_units_per_usd, max_units_per_usd) VALUES
  ('TZS', 1500, 4500),
  ('RWF',  800, 2500),
  ('ZMW',    8,   60),
  ('ETB',   40,  400),
  ('BIF', 1500, 6000)
ON CONFLICT (currency) DO NOTHING;

GRANT EXECUTE ON FUNCTION public.kes_per_share() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_unit_rate(TEXT, NUMERIC) TO anon, authenticated;
