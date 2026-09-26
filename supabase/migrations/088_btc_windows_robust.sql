-- 088_btc_windows_robust.sql — the BTC window engine cannot stall, never
-- settles on a pre-close price, and never opens duplicate windows (audit 6.13).
--
-- Before:
--   * resolve_btc_windows called resolve_market for each due window with no
--     per-window error handling; one window whose market an admin had
--     cancelled or resolved (resolve_market raises P0002) aborted the whole
--     run, every minute, forever;
--   * with no tick at or after the close, it settled on latest_btc_price(),
--     which can be a PRE-close tick;
--   * open_btc_windows checked NOT EXISTS then inserted, unlocked, while two
--     schedulers call it every minute: duplicate windows.
-- After:
--   * each window settles in its own subtransaction; a failure is reported
--     and the run continues; a window whose market is no longer active or
--     closed is marked 'void' (it can never settle);
--   * the settle price is the first tick in [close, close + 10 minutes];
--     without one the window is skipped (reported), never settled on an
--     older price;
--   * open_btc_windows takes a transaction advisory lock.
-- Both schedulers stay (the app may not be deployed; the in-database job may
-- be the only one running); the lock makes the duplicate harmless.
BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_btc_windows(p_resolver uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resolver UUID := p_resolver;
  v_w        RECORD;
  v_settle   DECIMAL;
  v_outcome  order_side;
  v_mstatus  text;
  v_resolved INTEGER := 0;
  v_skipped  INTEGER := 0;
  v_voided   INTEGER := 0;
  v_ids      UUID[] := '{}';
  v_errors   jsonb := '[]'::jsonb;
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
      -- an admin cancelled or resolved it: this window can never settle
      UPDATE public.btc_windows SET status = 'void' WHERE id = v_w.id;
      v_voided := v_voided + 1;
      CONTINUE;
    END IF;

    -- the first tick at or after the close, and not long after it
    v_settle := NULL;
    SELECT price INTO v_settle FROM public.btc_price_ticks
      WHERE observed_at >= v_w.closes_at AND observed_at <= v_w.closes_at + interval '10 minutes'
      ORDER BY observed_at ASC, id ASC LIMIT 1;
    IF v_settle IS NULL THEN
      v_skipped := v_skipped + 1;   -- no valid settle tick (yet); never a pre-close price
      CONTINUE;
    END IF;

    v_outcome := CASE WHEN v_settle > v_w.reference_price
                      THEN 'yes'::order_side ELSE 'no'::order_side END;
    BEGIN
      PERFORM public.resolve_market(
        v_w.market_id, v_outcome, v_resolver,
        'Auto-resolved BTC ' || v_w.series_key || ' window: settle $' ||
          to_char(v_settle, 'FM999,999,990.00') || ' vs reference $' ||
          to_char(v_w.reference_price, 'FM999,999,990.00')
      );
      UPDATE public.btc_windows
        SET status = 'resolved', settle_price = v_settle, resolved_outcome = v_outcome
        WHERE id = v_w.id;
      UPDATE public.markets
        SET metadata = metadata || jsonb_build_object(
          'live', FALSE, 'settle_price', v_settle, 'settled_outcome', v_outcome)
        WHERE id = v_w.market_id;
      v_resolved := v_resolved + 1;
      v_ids := array_append(v_ids, v_w.market_id);
    EXCEPTION WHEN OTHERS THEN
      -- one bad window never stops the others
      v_errors := v_errors || jsonb_build_object('window_id', v_w.id, 'sqlstate', SQLSTATE, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('resolved', v_resolved, 'skipped', v_skipped, 'voided', v_voided,
                            'failed', jsonb_array_length(v_errors), 'errors', v_errors, 'market_ids', v_ids);
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_btc_windows(p_creator uuid DEFAULT NULL::uuid, p_resolution_source text DEFAULT 'https://www.coinbase.com/price/bitcoin'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_creator UUID := p_creator;
  v_price   DECIMAL := public.latest_btc_price();
  v_series  RECORD;
  v_now     TIMESTAMPTZ := NOW();
  v_closes  TIMESTAMPTZ;
  v_market  UUID;
  v_slug    TEXT;
  v_opened  INTEGER := 0;
  v_ids     UUID[] := '{}';
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  -- [088] one opener at a time: two schedulers call this every minute
  -- (029's in-database tick and the HTTP btc-windows job), and the
  -- NOT EXISTS check below then INSERT raced into duplicate windows
  PERFORM pg_advisory_xact_lock(hashtext('kichiko.open_btc_windows'));

  IF v_price IS NULL THEN
    RETURN jsonb_build_object('opened', 0, 'reason', 'no_price');
  END IF;

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
    -- Already have a live window for this series? leave it be.
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
        'automatically against the Coinbase BTC-USD spot feed.',
      'crypto', 'binary', v_creator,
      'active', v_now, v_closes, v_closes,
      'Resolves YES (Up) if the Coinbase BTC-USD spot price at close is '
        'STRICTLY greater than the reference price of $' ||
        to_char(v_price, 'FM999,999,990.00') ||
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
        'reference_price', v_price, 'live', TRUE
      )
    )
    RETURNING id INTO v_market;

    INSERT INTO public.btc_windows (
      market_id, series_key, window_seconds, reference_price,
      opens_at, closes_at, resolves_at, status
    ) VALUES (
      v_market, v_series.series_key, v_series.window_seconds, v_price,
      v_now, v_closes, v_closes, 'open'
    );

    v_opened := v_opened + 1;
    v_ids := array_append(v_ids, v_market);
  END LOOP;

  RETURN jsonb_build_object('opened', v_opened, 'market_ids', v_ids, 'reference_price', v_price);
END;
$function$;

COMMIT;
