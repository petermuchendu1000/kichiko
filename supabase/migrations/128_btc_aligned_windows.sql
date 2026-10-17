-- 128_btc_aligned_windows.sql
-- ===========================================================================
-- Put the BTC Up/Down windows on the wall clock.
--
-- WHY
--
-- A window opened wherever the cron happened to notice the previous one had
-- ended:
--
--   v_closes := v_now + make_interval(secs => v_series.window_seconds);
--
-- so `opens_at` was NOW(). Measured on production, the last twelve 5-minute
-- windows started these many seconds into their 5-minute block:
--
--   195, 199, 204, 209, 214, 218, 223, 227, 239, 246, 260, 264
--
-- Each window opens about five seconds later than the one before it, and the
-- drift never corrects — it walks through the clock forever. Three things
-- follow from that:
--
--   * A trader cannot anticipate a window. "The 2:40 market" does not exist;
--     there is only "whatever opens after the current one dies".
--   * The slug carried the close epoch, so it named an arbitrary instant.
--   * Polymarket's equivalent market is aligned exactly — every slug in the
--     series is a start epoch congruent to 0 mod 300 (verified across
--     1792261200 / 1792261500 / 1792261800 / 1792262100 / 1792262400), which
--     is what lets their page offer 2:40PM / 2:45PM / 2:50PM tabs at all.
--
-- HOW
--
-- Each series gets a fixed grid: a 300-second series has boundaries at every
-- :00 / :05 / :10, a 3600-second series on the hour. A window is created FOR a
-- slot rather than at an arbitrary moment, so `opens_at` and `closes_at` are
-- both exact multiples of the window length.
--
-- The reference price is then taken AT the slot boundary, not at creation
-- time. That is possible because btc_twap() reads recorded ticks and so works
-- retroactively: a window created a few seconds into its slot still prices
-- itself from the tick history at the slot's true start. This is exactly the
-- quantity Polymarket publishes as `openPrice` for the window, and it makes
-- each window's reference price equal to the previous window's settle price
-- on the same grid — their `closePrice[N] = openPrice[N+1]` identity, which
-- their /api/past-results data satisfies bit-for-bit.
--
-- WHAT THIS DOES NOT DO. It does not pre-create the next slot. Polymarket has
-- several future windows accepting orders at once; we keep one live window per
-- series, because "active" is load-bearing across the board pin, the sibling
-- chips and the trading surface, and widening it is a separate change with its
-- own UI work. The consequence is a window can still be created up to one cron
-- period (60s) into its own slot. It is then correctly aligned and correctly
-- priced — only short. MIN_USABLE_FRACTION below refuses to publish a stub
-- when too little of the slot is left, so a trader is never handed a window
-- with seconds on it; the grid simply picks up at the next boundary.
-- ===========================================================================

-- 1. The grid ---------------------------------------------------------------
-- Floor an instant to its slot boundary for a given window length. IMMUTABLE
-- so it can be used in index predicates and generated expressions later.
CREATE OR REPLACE FUNCTION public.btc_slot_start(
  p_at             TIMESTAMPTZ,
  p_window_seconds INTEGER
)
RETURNS TIMESTAMPTZ
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT to_timestamp(
    floor(extract(epoch FROM p_at) / GREATEST(p_window_seconds, 1))::BIGINT
      * GREATEST(p_window_seconds, 1)
  );
$$;

COMMENT ON FUNCTION public.btc_slot_start(TIMESTAMPTZ, INTEGER) IS
  'The wall-clock slot boundary at or before p_at for a p_window_seconds grid. '
  'A 300s grid floors to :00/:05/:10, a 3600s grid to the hour.';

-- 2. One window per series per slot -----------------------------------------
-- Two schedulers call open_btc_windows every minute (029''s in-database tick
-- and the HTTP btc-windows job). They already serialise on an advisory lock,
-- but the grid makes the intended invariant expressible, so state it: a slot
-- is a slot, and it gets one window. Verified no duplicates exist before
-- adding this.
CREATE UNIQUE INDEX IF NOT EXISTS btc_windows_series_slot_uniq
  ON public.btc_windows (series_key, opens_at);

-- 3. Open the slot, not the moment ------------------------------------------
CREATE OR REPLACE FUNCTION public.open_btc_windows(
  p_creator           UUID DEFAULT NULL,
  p_resolution_source TEXT DEFAULT 'https://www.coinbase.com/price/bitcoin'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  -- Refuse to publish a window with less than this much of its slot left. One
  -- cron period on a 5-minute grid is 20% of the window; a trader handed the
  -- tail of a slot has a market they cannot use, and the next boundary is
  -- never more than one window away.
  MIN_USABLE_FRACTION CONSTANT NUMERIC := 0.5;

  v_creator UUID := p_creator;
  v_now     TIMESTAMPTZ := NOW();
  v_series  RECORD;
  v_opens   TIMESTAMPTZ;
  v_closes  TIMESTAMPTZ;
  v_twap    DECIMAL;
  v_price   DECIMAL;
  v_method  TEXT;
  v_basis   TEXT;
  v_market  UUID;
  v_slug    TEXT;
  v_opened  INTEGER := 0;
  v_ids     UUID[] := '{}';
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject
  -- any end-user JWT. service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  -- [088] one opener at a time.
  PERFORM pg_advisory_xact_lock(hashtext('kichiko.open_btc_windows'));

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
    v_opens  := public.btc_slot_start(v_now, v_series.window_seconds);
    v_closes := v_opens + make_interval(secs => v_series.window_seconds);

    -- This slot already has its window (the unique index also enforces it).
    IF EXISTS (
      SELECT 1 FROM public.btc_windows w
      WHERE w.series_key = v_series.series_key
        AND w.opens_at   = v_opens
    ) THEN
      CONTINUE;
    END IF;

    -- A live window still covering now is either the previous, unaligned
    -- window draining after this migration, or a slot we already serve. Leave
    -- it alone: two live windows in one series is not a thing the board, the
    -- sibling chips or the trading surface expect.
    IF EXISTS (
      SELECT 1 FROM public.btc_windows w
      WHERE w.series_key = v_series.series_key
        AND w.status     = 'open'
        AND w.closes_at  > v_now
    ) THEN
      CONTINUE;
    END IF;

    -- Too little of this slot left to be worth trading; wait for the next
    -- boundary rather than publish a stub.
    IF extract(epoch FROM (v_closes - v_now))
         < v_series.window_seconds * MIN_USABLE_FRACTION THEN
      CONTINUE;
    END IF;

    -- The reference price AT the slot boundary, read back out of the tick
    -- history. This is the number Polymarket calls openPrice, and settling the
    -- previous slot produced the same quantity at the same instant.
    v_twap   := public.btc_twap(v_opens, 60, 20);
    v_price  := COALESCE(v_twap, public.latest_btc_price());
    v_method := CASE WHEN v_twap IS NOT NULL THEN 'twap60' ELSE 'spot' END;

    IF v_price IS NULL THEN
      CONTINUE;  -- no price for this boundary yet; try again next run
    END IF;

    -- The rules text has to say which number settles it. A market that claims
    -- to settle on "the spot price" and then settles on an average is
    -- mis-sold.
    v_basis := CASE WHEN v_method = 'twap60'
      THEN 'the 60-second time-weighted average Coinbase BTC-USD price'
      ELSE 'the Coinbase BTC-USD spot price' END;

    -- The slug names the slot it opens, so it is predictable and sortable --
    -- the convention Polymarket uses (btc-updown-5m-<start epoch>). It used to
    -- carry the close epoch of an arbitrary instant.
    v_slug := v_series.series_key || '-' || (extract(epoch FROM v_opens)::BIGINT)::TEXT;

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
      'active', v_opens, v_closes, v_closes,
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
      v_opens, v_closes, v_closes, 'open', v_method
    );

    v_opened := v_opened + 1;
    v_ids := array_append(v_ids, v_market);
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened, 'market_ids', v_ids);
END;
$$;

COMMENT ON FUNCTION public.open_btc_windows(UUID, TEXT) IS
  'Opens the current wall-clock slot for each enabled BTC series, pricing the '
  'reference off btc_twap() AT the slot boundary. Skips a slot that already '
  'has a window, a series whose previous window is still live, and a slot with '
  'less than half its time left.';

-- Grants unchanged from 051/052: internal, service_role only.
REVOKE EXECUTE ON FUNCTION public.open_btc_windows(UUID, TEXT) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.open_btc_windows(UUID, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.btc_slot_start(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.btc_slot_start(TIMESTAMPTZ, INTEGER) TO service_role, authenticated, anon;
