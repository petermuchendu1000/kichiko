-- 114_market_option_deltas.sql
-- ---------------------------------------------------------------------------
-- How far each outcome has moved since this market opened.
--
-- WHY (measured 2026-10-16, section C of the element matrix)
--
-- Polymarket's outcome rows carry a coloured change figure beside the
-- probability — `79%  ▲77%`, `21%  ▼39%` on the Brazil presidential market.
-- Ours carried the probability alone. On a board whose whole job is to say
-- what people now believe, "what moved" is the one thing a reader cannot
-- reconstruct by looking harder: the current number is on screen, the
-- previous one never was.
--
-- Our own market has the same story to tell and was not telling it:
--
--   William Ruto        52.6% -> 46.4%   -6.2
--   Rigathi Gachagua    20.8% -> 23.8%   +3.0
--   Kalonzo Musyoka      8.0% -> 13.7%   +5.7
--   Fred Matiang'i       9.9% -> 12.6%   +2.8
--   Musalia Mudavadi     8.8% ->  5.3%   -3.5
--
-- WHY SINCE OPEN, AND NOT 24 HOURS
--
-- 24h is the obvious window and would render "0.0" against every outcome on
-- this platform today: nothing writes price_history but the CLOB matching
-- path, and nothing has traded since late July (measured: 8,319 rows in July,
-- 5 in August). A figure that is structurally zero is worse than no figure —
-- it reads as "nothing is happening here" when the truth is "we stopped
-- recording". Since-open is honest on the data that exists, matches what
-- Polymarket appears to show (Bolsonaro at 79% with +77 is a lifetime move,
-- not a daily one), and does not change under the reader's feet when they
-- switch the chart's range.
--
-- ONE QUERY, NOT A SECOND HISTORY FETCH
--
-- The chart already pulls the full per-option history, but it does so inside
-- its own component; reaching it from the outcome board would mean either
-- lifting the fetch through three layers or fetching it twice. Both first and
-- last price per option is a single indexed pass, so the database does it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.market_option_deltas(p_market_id UUID)
RETURNS TABLE (
  market_option_id UUID,
  first_price      NUMERIC,
  last_price       NUMERIC,
  delta            NUMERIC,
  first_at         TIMESTAMPTZ,
  last_at          TIMESTAMPTZ,
  points           INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT ph.market_option_id AS oid,
           ph.price,
           ph.recorded_at,
           row_number() OVER (PARTITION BY ph.market_option_id ORDER BY ph.recorded_at)      AS asc_rn,
           row_number() OVER (PARTITION BY ph.market_option_id ORDER BY ph.recorded_at DESC) AS desc_rn,
           count(*)     OVER (PARTITION BY ph.market_option_id)                              AS n
    FROM public.price_history ph
    WHERE ph.market_id = p_market_id
      AND ph.market_option_id IS NOT NULL
      AND ph.price IS NOT NULL
  )
  SELECT f.oid,
         f.price           AS first_price,
         l.price           AS last_price,
         l.price - f.price AS delta,
         f.recorded_at     AS first_at,
         l.recorded_at     AS last_at,
         f.n::int          AS points
  FROM ranked f
  JOIN ranked l ON l.oid = f.oid AND l.desc_rn = 1
  WHERE f.asc_rn = 1
    -- A single recorded price is a level, not a move. Returning 0.0 for it
    -- would be indistinguishable from "traded all day and ended flat", which
    -- is the same confusion the 24h window would have created platform-wide.
    AND f.n > 1;
$$;

GRANT EXECUTE ON FUNCTION public.market_option_deltas(UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.market_option_deltas(UUID)
  IS 'Per-option price change since the market''s first recorded price. Options with a single datapoint are omitted: one price is a level, not a move.';
