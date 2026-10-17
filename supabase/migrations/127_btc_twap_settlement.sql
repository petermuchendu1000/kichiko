-- 127_btc_twap_settlement.sql
-- ===========================================================================
-- Settle the BTC Up/Down windows on a 60-second TWAP instead of a single tick.
--
-- WHY
--
-- Two measured defects, both live, both deciding real payouts:
--
--   1. STALE.  `btc_price_ticks` is written by the btc-windows cron, and
--      pg_cron's finest schedule is one minute. Measured on production: 28
--      ticks in 30 minutes, an average gap of 65 seconds. resolve_btc_windows
--      took "the first tick at or after the close", so the settle price could
--      be up to a minute later than the window actually ended. On a 5-minute
--      market that is a fifth of the window. Measured on Coinbase the same
--      day, BTC moved $16.76 inside one ten-second slice.
--
--   2. SINGLE-PRINT.  One tick decided the outcome. On a tape where dozens of
--      prints sit on the same resting order (1000 prints over 310 seconds
--      carried 44 distinct prices), one print is both noisy and cheap to push.
--
-- Polymarket's equivalent market resolves on Chainlink's `btc-usd-twap-60s`
-- stream and says so in its rules: "according to the TWAP Chainlink data
-- stream for the asset pair BTC/USD, not according to any other sources or
-- spot markets". Their chart plots the same quantity (`crypto_prices_twap_sixty`,
-- one message per second). Ours now plots a 60-second TWAP too, so settling on
-- one makes the graph and the payout the same number.
--
-- HOW
--
-- Density comes from the route, not the scheduler: the cron cannot run faster
-- than once a minute, so each run now ingests the last ~90 seconds of Coinbase
-- prints, bucketed to one tick per second (the cadence Polymarket publishes).
-- That is what record_btc_ticks() below is for.
--
-- SAFETY: a window adopts TWAP settlement only if a TWAP was actually
-- computable when it opened. btc_twap() returns NULL when the window is too
-- thinly covered, so open_btc_windows() falls back to the old spot rule and
-- records that choice on the row. We therefore never create a window we cannot
-- settle, and windows already open when this migration lands keep the exact
-- rule they were sold under.
-- ===========================================================================

-- 1. How each window is priced --------------------------------------------
-- Existing rows keep 'spot': they were opened against a single reading, and
-- their reference_price is that reading. Settling them against an average
-- would compare two different quantities.
ALTER TABLE public.btc_windows
  ADD COLUMN IF NOT EXISTS price_method TEXT NOT NULL DEFAULT 'spot';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'btc_windows_price_method_chk'
  ) THEN
    ALTER TABLE public.btc_windows
      ADD CONSTRAINT btc_windows_price_method_chk
      CHECK (price_method IN ('spot', 'twap60'));
  END IF;
END $$;

COMMENT ON COLUMN public.btc_windows.price_method IS
  'How reference_price and settle_price are measured. twap60 = 60-second '
  'time-weighted average (migration 127). spot = single tick (pre-127, and '
  'the fallback when ticks are too sparse to average).';

-- 2. The average ------------------------------------------------------------
-- Time-weighted, not the mean of the samples: ticks do not arrive on an even
-- cadence, so a plain AVG() would weight a burst of prints the same as a quiet
-- stretch. The series is treated as a step function (a price holds until the
-- next tick), which is what "time-weighted" means and what the client-side
-- twapSeries() in lib/markets/btc-chart.ts computes for the chart.
--
-- The tick at or before the window start is pulled in as a seed so the first
-- fraction of a second is not left unweighted.
--
-- Returns NULL when fewer than p_min_samples ticks fall INSIDE the window.
-- That is the honesty guard: with the old one-per-minute cadence a "60-second
-- TWAP" would be one tick wearing an average's name, and every caller here
-- treats NULL as "cannot price this yet" rather than substituting a guess.
CREATE OR REPLACE FUNCTION public.btc_twap(
  p_at             TIMESTAMPTZ,
  p_window_seconds INTEGER DEFAULT 60,
  p_min_samples    INTEGER DEFAULT 20
)
RETURNS DECIMAL
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lo     TIMESTAMPTZ := p_at - make_interval(secs => GREATEST(p_window_seconds, 1));
  v_inside INTEGER;
  v_twap   DECIMAL;
BEGIN
  IF p_at IS NULL THEN RETURN NULL; END IF;

  SELECT count(*) INTO v_inside
    FROM public.btc_price_ticks
   WHERE observed_at > v_lo AND observed_at <= p_at;

  IF v_inside < GREATEST(p_min_samples, 1) THEN
    RETURN NULL;
  END IF;

  WITH pts AS (
    -- The step already in force when the window opens, carried forward to the
    -- window start so the first fraction of a second is not left unweighted.
    --
    -- EVERY COLUMN HERE IS TABLE-QUALIFIED ON PURPOSE. This subquery renames a
    -- constant to `observed_at`, and PostgreSQL resolves an unqualified name
    -- in ORDER BY against OUTPUT COLUMN ALIASES before table columns. Written
    -- as `ORDER BY observed_at DESC` it therefore sorted by the constant — no
    -- ordering at all — and LIMIT 1 returned an arbitrary historical tick.
    -- Caught on production: the seed came back at $65,934 while every tick in
    -- the window was ~$81,490, which would have dragged the settlement average
    -- toward a price from months earlier. WHERE does not accept output
    -- aliases, so the filter looked correct throughout.
    (SELECT v_lo AS observed_at, t.price, 0::BIGINT AS id
       FROM public.btc_price_ticks t
      WHERE t.observed_at <= v_lo
      ORDER BY t.observed_at DESC, t.id DESC
      LIMIT 1)
    UNION ALL
    (SELECT t.observed_at, t.price, t.id
       FROM public.btc_price_ticks t
      WHERE t.observed_at > v_lo AND t.observed_at <= p_at)
  ),
  spans AS (
    SELECT
      price,
      EXTRACT(epoch FROM (
        LEAST(COALESCE(LEAD(observed_at) OVER (ORDER BY observed_at, id), p_at), p_at)
          - observed_at
      )) AS secs
    FROM pts
  )
  SELECT SUM(price * secs) / NULLIF(SUM(secs), 0) INTO v_twap
    FROM spans
   WHERE secs > 0;

  RETURN v_twap;
END;
$$;

COMMENT ON FUNCTION public.btc_twap(TIMESTAMPTZ, INTEGER, INTEGER) IS
  'Time-weighted average BTC/USD over the p_window_seconds ending at p_at. '
  'NULL when the window holds fewer than p_min_samples ticks, so callers can '
  'wait for coverage instead of averaging one print.';

-- 3. Bulk tick ingestion ----------------------------------------------------
-- One row per second, fed from the exchange's trade prints by the cron route.
-- Idempotent: a run overlaps the previous one on purpose (so a slow minute
-- leaves no hole), and re-offered timestamps are dropped rather than
-- double-weighted in the average above.
CREATE OR REPLACE FUNCTION public.record_btc_ticks(
  p_ticks  JSONB,
  p_source TEXT DEFAULT 'coinbase-trades'
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_source TEXT := COALESCE(NULLIF(p_source, ''), 'unknown');
  v_n      INTEGER := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  IF p_ticks IS NULL OR jsonb_typeof(p_ticks) <> 'array' THEN
    RETURN 0;
  END IF;

  WITH incoming AS (
    SELECT DISTINCT ON (date_trunc('second', (e->>'t')::TIMESTAMPTZ))
           date_trunc('second', (e->>'t')::TIMESTAMPTZ) AS observed_at,
           (e->>'p')::DECIMAL                            AS price
      FROM jsonb_array_elements(p_ticks) AS e
     WHERE (e->>'p') IS NOT NULL
       AND (e->>'t') IS NOT NULL
       AND (e->>'p')::DECIMAL > 0
       -- never accept a print from the future, and never rewrite deep history
       AND (e->>'t')::TIMESTAMPTZ <= NOW() + interval '5 seconds'
       AND (e->>'t')::TIMESTAMPTZ >= NOW() - interval '1 hour'
     ORDER BY date_trunc('second', (e->>'t')::TIMESTAMPTZ), (e->>'t')::TIMESTAMPTZ DESC
  ),
  fresh AS (
    SELECT i.* FROM incoming i
     WHERE NOT EXISTS (
       SELECT 1 FROM public.btc_price_ticks t
        WHERE t.source = v_source AND t.observed_at = i.observed_at
     )
  ),
  ins AS (
    INSERT INTO public.btc_price_ticks (price, source, observed_at)
    SELECT price, v_source, observed_at FROM fresh
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM ins;

  -- Retention. At one row per second this table grows by 86k rows a day and
  -- nothing here ever looks back more than one window. Settled outcomes stay
  -- auditable because settle_price is written onto btc_windows itself.
  DELETE FROM public.btc_price_ticks
   WHERE observed_at < NOW() - interval '24 hours';

  RETURN v_n;
END;
$$;

-- 4. Open a window on the average ------------------------------------------
CREATE OR REPLACE FUNCTION public.open_btc_windows(
  p_creator           UUID DEFAULT NULL,
  p_resolution_source TEXT DEFAULT 'https://www.coinbase.com/price/bitcoin'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_creator UUID := p_creator;
  v_now     TIMESTAMPTZ := NOW();
  -- The average first; the single tick only if the average cannot be had.
  v_twap    DECIMAL := public.btc_twap(NOW(), 60, 20);
  v_price   DECIMAL := COALESCE(v_twap, public.latest_btc_price());
  v_method  TEXT    := CASE WHEN v_twap IS NOT NULL THEN 'twap60' ELSE 'spot' END;
  v_basis   TEXT;
  v_series  RECORD;
  v_closes  TIMESTAMPTZ;
  v_market  UUID;
  v_slug    TEXT;
  v_opened  INTEGER := 0;
  v_ids     UUID[] := '{}';
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kichiko.open_btc_windows'));

  IF v_price IS NULL THEN
    RETURN jsonb_build_object('opened', 0, 'reason', 'no_price');
  END IF;

  -- The rules text has to say which number settles it. A market that claims to
  -- settle on "the spot price" and then settles on an average is mis-sold.
  v_basis := CASE WHEN v_method = 'twap60'
    THEN 'the 60-second time-weighted average Coinbase BTC-USD price'
    ELSE 'the Coinbase BTC-USD spot price' END;

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
        'automatically against ' || v_basis || '.',
      'crypto', 'binary', v_creator,
      'active', v_now, v_closes, v_closes,
      'Resolves YES (Up) if ' || v_basis || ' at close is STRICTLY greater '
        'than the reference price of $' || to_char(v_price, 'FM999,999,990.00') ||
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
        'reference_price', v_price,
        'price_method', v_method,
        'live', TRUE
      )
    )
    RETURNING id INTO v_market;

    INSERT INTO public.btc_windows (
      market_id, series_key, window_seconds, reference_price,
      opens_at, closes_at, resolves_at, status, price_method
    ) VALUES (
      v_market, v_series.series_key, v_series.window_seconds, v_price,
      v_now, v_closes, v_closes, 'open', v_method
    );

    v_opened := v_opened + 1;
    v_ids := array_append(v_ids, v_market);
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened, 'market_ids', v_ids,
                            'reference_price', v_price, 'price_method', v_method);
END;
$$;

-- 5. Settle on the same quantity the window was opened on -------------------
CREATE OR REPLACE FUNCTION public.resolve_btc_windows(p_resolver UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_resolver UUID := p_resolver;
  v_w        RECORD;
  v_settle   DECIMAL;
  v_basis    TEXT;
  v_outcome  order_side;
  v_mstatus  TEXT;
  v_resolved INTEGER := 0;
  v_skipped  INTEGER := 0;
  v_voided   INTEGER := 0;
  v_ids      UUID[] := '{}';
  v_errors   JSONB := '[]'::jsonb;
BEGIN
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
    SELECT status::text INTO v_mstatus FROM public.markets WHERE id = v_w.market_id;
    IF v_mstatus IS NULL OR v_mstatus NOT IN ('active', 'closed') THEN
      UPDATE public.btc_windows SET status = 'void' WHERE id = v_w.id;
      v_voided := v_voided + 1;
      CONTINUE;
    END IF;

    v_settle := NULL;
    v_basis  := 'spot';

    IF v_w.price_method = 'twap60' THEN
      -- The average over the 60 seconds ENDING at the close, so the measured
      -- interval is the window's own last minute and not whenever the cron
      -- happened to wake up afterwards.
      v_settle := public.btc_twap(v_w.closes_at, 60, 20);
      -- A TWAP computed before any tick has landed at or after the close is
      -- still filling: it would silently measure a shorter interval. Wait.
      IF v_settle IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.btc_price_ticks WHERE observed_at >= v_w.closes_at
      ) THEN
        v_settle := NULL;
      END IF;
      v_basis := 'twap60';

      -- Last resort. If ingestion was down long enough that the close can
      -- never be averaged, a window would otherwise hang open forever with
      -- traders' money in it. After 30 minutes, settle it the old way and say
      -- so in the audit note.
      IF v_settle IS NULL AND v_w.closes_at < NOW() - interval '30 minutes' THEN
        SELECT price INTO v_settle FROM public.btc_price_ticks
          WHERE observed_at >= v_w.closes_at
          ORDER BY observed_at ASC, id ASC LIMIT 1;
        v_basis := 'spot-fallback';
      END IF;
    ELSE
      SELECT price INTO v_settle FROM public.btc_price_ticks
        WHERE observed_at >= v_w.closes_at AND observed_at <= v_w.closes_at + interval '10 minutes'
        ORDER BY observed_at ASC, id ASC LIMIT 1;
    END IF;

    IF v_settle IS NULL THEN
      v_skipped := v_skipped + 1;   -- not priceable yet; never a pre-close price
      CONTINUE;
    END IF;

    v_outcome := CASE WHEN v_settle > v_w.reference_price
                      THEN 'yes'::order_side ELSE 'no'::order_side END;
    BEGIN
      PERFORM public.resolve_market(
        v_w.market_id, v_outcome, v_resolver,
        'Auto-resolved BTC ' || v_w.series_key || ' window (' || v_basis || '): settle $' ||
          to_char(v_settle, 'FM999,999,990.00') || ' vs reference $' ||
          to_char(v_w.reference_price, 'FM999,999,990.00')
      );
      UPDATE public.btc_windows
        SET status = 'resolved', settle_price = v_settle, resolved_outcome = v_outcome
        WHERE id = v_w.id;
      UPDATE public.markets
        SET metadata = metadata || jsonb_build_object(
          'live', FALSE, 'settle_price', v_settle, 'settled_outcome', v_outcome,
          'settle_basis', v_basis)
        WHERE id = v_w.market_id;
      v_resolved := v_resolved + 1;
      v_ids := array_append(v_ids, v_w.market_id);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('window_id', v_w.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('resolved', v_resolved, 'skipped', v_skipped, 'voided', v_voided,
                            'failed', jsonb_array_length(v_errors), 'errors', v_errors, 'market_ids', v_ids);
END;
$$;

-- 6. Grants — internal primitives, same posture as 024/049 ------------------
REVOKE ALL ON FUNCTION public.record_btc_ticks(JSONB, TEXT)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_twap(TIMESTAMPTZ, INTEGER, INTEGER)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_btc_ticks(JSONB, TEXT)         TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_twap(TIMESTAMPTZ, INTEGER, INTEGER) TO service_role;
