-- 092_trader_realized_pnl.sql — trader P&L, win rate and bet counts from
-- realized P&L, not from ledger rows (audit 6.29).
--
-- BUG (reproduced: scripts/ops/clob/test_leaderboard_pnl.py, 8 checks red):
-- the profile counters behind the all-time leaderboard, the profile page and
-- the admin views were kept by update_profile_stats (002) on ledger inserts:
--   bet_placed: total_bets + 1, profit_loss_usd - amount
--   bet_won:    total_wins + 1, profit_loss_usd + amount
-- and the week/month leaderboard summed the same two row types. Under the
-- order book:
--   * a SALE is a bet_refunded row and was ignored: buy 10 at 40, sell at 70
--     showed -4.00, not +3.00; a void refund was ignored the same way
--   * each MAKER FILL is its own bet_placed row: one resting bid filled by 3
--     takers counted as 3 bets, which also diluted the win rate
--   * a loss (bet_lost) never counted, so the week board listed only buyers
-- On the replica, 29 existing profiles' P&L differed from their positions'.
--
-- FIX: positions.realized_pnl_usd is the single correct source, for both
-- engines: a sale adds (price - average entry) x shares and lowers the cost
-- basis (043 #3); settlement adds payout - remaining cost (069). Summed over a
-- position's life it is proceeds - cost.
--   * position_pnl_events: an insert-only log of every change to a position's
--     realized P&L and of every close, written by a trigger on positions, so
--     week/month P&L is attributed to when it was realized. No foreign keys:
--     the insert takes no row lock on any other table, so the matcher's lock
--     order (081) is unchanged. Backfilled from existing positions.
--   * the profile counters are recomputed from positions by
--     sync_profile_trading_stats(), which refresh_leaderboard() runs first
--     (every 2 minutes, 040). It takes only profile rows nobody holds
--     (SKIP LOCKED): it never waits on, or deadlocks with, a trade; a skipped
--     row is corrected on the next run. Profile figures are therefore up to
--     ~2 minutes behind, as the leaderboard already was; the public trader
--     card and trader page compute them live instead.
--   * update_profile_stats keeps only total_volume_usd (buy notional,
--     including maker fills: that is traded volume, not a count of bets).
-- DEFINITIONS (documented in the register):
--   profit_loss_usd  sum of realized P&L over the user's positions
--                    (open positions' unrealized P&L is not included)
--   total_bets       positions taken (one per market option and side)
--   total_wins       closed positions (sold out or settled) with P&L > 0;
--                    a loss is one with P&L < 0; a position in a VOIDED
--                    market is neither (its P&L still counts)
--   win_rate         wins / (wins + losses), 0 when there are none
-- Week/month: P&L realized in the period; wins/losses of positions closed in
-- the period; bets = market options bought in the period (the ledger has no
-- side, so YES and NO on one option count once).
BEGIN;

-- ------------------------------------------------------------------ the log
CREATE TABLE IF NOT EXISTS public.position_pnl_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  position_id    uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  market_id      uuid,
  delta_usd      numeric     NOT NULL,      -- change in realized P&L
  closed         boolean     NOT NULL,      -- this change closed the position
  realized_after numeric     NOT NULL,      -- the position's realized P&L after it
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pnl_events_created  ON public.position_pnl_events (created_at);
CREATE INDEX IF NOT EXISTS idx_pnl_events_position ON public.position_pnl_events (position_id);
ALTER TABLE public.position_pnl_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.position_pnl_events FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.position_pnl_events IS
  '092: insert-only log of realized P&L changes and closes per position (trigger on positions). Read by get_leaderboard for week/month.';

CREATE OR REPLACE FUNCTION public._position_pnl_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.position_pnl_events (position_id, user_id, market_id, delta_usd, closed, realized_after)
    VALUES (NEW.id, NEW.user_id, NEW.market_id, COALESCE(NEW.realized_pnl_usd, 0),
            NOT COALESCE(NEW.is_active, TRUE), COALESCE(NEW.realized_pnl_usd, 0));
  ELSE
    INSERT INTO public.position_pnl_events (position_id, user_id, market_id, delta_usd, closed, realized_after)
    VALUES (NEW.id, NEW.user_id, NEW.market_id,
            COALESCE(NEW.realized_pnl_usd, 0) - COALESCE(OLD.realized_pnl_usd, 0),
            COALESCE(OLD.is_active, TRUE) AND NOT COALESCE(NEW.is_active, TRUE),
            COALESCE(NEW.realized_pnl_usd, 0));
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._position_pnl_event() FROM PUBLIC, anon, authenticated;

-- No trade may change a position between the backfill and the triggers.
LOCK TABLE public.positions IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO public.position_pnl_events (position_id, user_id, market_id, delta_usd, closed, realized_after, created_at)
SELECT p.id, p.user_id, p.market_id, COALESCE(p.realized_pnl_usd, 0), NOT COALESCE(p.is_active, TRUE),
       COALESCE(p.realized_pnl_usd, 0), COALESCE(p.claimed_at, p.updated_at, p.created_at, now())
  FROM public.positions p
 WHERE (COALESCE(p.realized_pnl_usd, 0) <> 0 OR NOT COALESCE(p.is_active, TRUE))
   AND NOT EXISTS (SELECT 1 FROM public.position_pnl_events e WHERE e.position_id = p.id);

DROP TRIGGER IF EXISTS trg_position_pnl_event_ins ON public.positions;
CREATE TRIGGER trg_position_pnl_event_ins
  AFTER INSERT ON public.positions
  FOR EACH ROW
  WHEN (COALESCE(NEW.realized_pnl_usd, 0) <> 0 OR NOT COALESCE(NEW.is_active, TRUE))
  EXECUTE FUNCTION public._position_pnl_event();

DROP TRIGGER IF EXISTS trg_position_pnl_event_upd ON public.positions;
CREATE TRIGGER trg_position_pnl_event_upd
  AFTER UPDATE OF realized_pnl_usd, is_active ON public.positions
  FOR EACH ROW
  WHEN (NEW.realized_pnl_usd IS DISTINCT FROM OLD.realized_pnl_usd
        OR (COALESCE(OLD.is_active, TRUE) AND NOT COALESCE(NEW.is_active, TRUE)))
  EXECUTE FUNCTION public._position_pnl_event();

-- ------------------------------------------------------------------ the ledger trigger keeps volume only
CREATE OR REPLACE FUNCTION public.update_profile_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [092] P&L, bets, wins and win rate come from positions
  -- (sync_profile_trading_stats); a ledger row only adds traded volume.
  IF NEW.type = 'bet_placed' AND NEW.status = 'completed' THEN
    UPDATE public.profiles SET
      total_volume_usd = total_volume_usd + NEW.amount_usd,
      updated_at = NOW()
    WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ------------------------------------------------------------------ per-user figures from positions
CREATE OR REPLACE FUNCTION public._trader_stats(p_user_id uuid)
 RETURNS TABLE (bets integer, wins integer, losses integer, pnl_usd numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT count(p.id)::int,
         (count(*) FILTER (WHERE p.is_active IS FALSE AND m.status IS DISTINCT FROM 'cancelled'
                             AND p.realized_pnl_usd > 0))::int,
         (count(*) FILTER (WHERE p.is_active IS FALSE AND m.status IS DISTINCT FROM 'cancelled'
                             AND p.realized_pnl_usd < 0))::int,
         COALESCE(sum(p.realized_pnl_usd), 0)
    FROM public.positions p
    LEFT JOIN public.markets m ON m.id = p.market_id
   WHERE p.user_id = p_user_id;
$function$;
REVOKE ALL ON FUNCTION public._trader_stats(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_profile_trading_stats()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  WITH s AS (
    SELECT pr.id,
           count(p.id)::int AS bets,
           (count(*) FILTER (WHERE p.is_active IS FALSE AND m.status IS DISTINCT FROM 'cancelled'
                               AND p.realized_pnl_usd > 0))::int AS wins,
           (count(*) FILTER (WHERE p.is_active IS FALSE AND m.status IS DISTINCT FROM 'cancelled'
                               AND p.realized_pnl_usd < 0))::int AS losses,
           ROUND(COALESCE(sum(p.realized_pnl_usd), 0), 6) AS pnl
      FROM public.profiles pr
      LEFT JOIN public.positions p ON p.user_id = pr.id
      LEFT JOIN public.markets m   ON m.id = p.market_id
     GROUP BY pr.id
  ), want AS (
    SELECT s.id, s.bets, s.wins, s.pnl,
           CASE WHEN s.wins + s.losses > 0 THEN ROUND(s.wins::numeric / (s.wins + s.losses), 4) ELSE 0 END AS wr
      FROM s JOIN public.profiles pr ON pr.id = s.id
     WHERE (COALESCE(pr.total_bets, 0), COALESCE(pr.total_wins, 0), COALESCE(pr.profit_loss_usd, 0), COALESCE(pr.win_rate, 0))
           IS DISTINCT FROM
           (s.bets, s.wins, s.pnl,
            CASE WHEN s.wins + s.losses > 0 THEN ROUND(s.wins::numeric / (s.wins + s.losses), 4) ELSE 0 END)
  ), locked AS (
    -- never wait on a trade: rows a transaction holds are left for the next run
    SELECT pr.id FROM public.profiles pr
     WHERE pr.id IN (SELECT id FROM want)
     ORDER BY pr.id
     FOR NO KEY UPDATE SKIP LOCKED
  )
  UPDATE public.profiles pr SET
    total_bets      = w.bets,
    total_wins      = w.wins,
    win_rate        = w.wr,
    profit_loss_usd = w.pnl
  FROM want w
  WHERE w.id = pr.id AND pr.id IN (SELECT id FROM locked);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_profile_trading_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_profile_trading_stats() TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_leaderboard()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [052 defense-in-depth] internal service_role/cron-only primitive: reject any
  -- end-user JWT (auth.uid() present). service_role/postgres have a NULL auth.uid().
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Not authorized: internal function' USING ERRCODE = 'P0121';
  END IF;
  PERFORM public.sync_profile_trading_stats();   -- [092] profile figures from positions
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard;
  EXCEPTION WHEN feature_not_supported OR object_not_in_prerequisite_state THEN
    -- CONCURRENTLY needs the matview populated once first.
    REFRESH MATERIALIZED VIEW public.leaderboard;
  END;
END;
$function$;

-- ------------------------------------------------------------------ public trader surfaces: live figures
CREATE OR REPLACE FUNCTION public.trader_card_stats(p_user_id uuid)
RETURNS TABLE (
  user_id         uuid,
  display_name    text,
  username        text,
  avatar_url      text,
  joined_at       timestamptz,
  positions_value numeric,
  profit_loss_usd numeric,
  volume_usd      numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pr.id,
    pr.display_name,
    pr.username,
    pr.avatar_url,
    pr.created_at,
    COALESCE((SELECT SUM(current_value_usd) FROM public.positions
              WHERE user_id = pr.id AND is_active = TRUE), 0),
    (SELECT st.pnl_usd FROM public._trader_stats(pr.id) st),   -- [092] live, from positions
    pr.total_volume_usd
  FROM public.profiles pr
  WHERE pr.id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.trader_public_profile(p_user_id uuid)
RETURNS TABLE (
  user_id          uuid,
  display_name     text,
  username         text,
  avatar_url       text,
  bio              text,
  joined_at        timestamptz,
  view_count       integer,
  positions_value  numeric,
  biggest_win_usd  numeric,
  predictions      bigint,
  profit_loss_usd  numeric,
  volume_usd       numeric,
  win_rate         numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pr.id,
    pr.display_name,
    pr.username,
    pr.avatar_url,
    pr.bio,
    pr.created_at,
    pr.profile_view_count,
    COALESCE((SELECT SUM(current_value_usd) FROM public.positions
              WHERE user_id = pr.id AND is_active = TRUE), 0),
    COALESCE((SELECT MAX(realized_pnl_usd) FROM public.positions
              WHERE user_id = pr.id AND is_active = FALSE), 0),
    (SELECT COUNT(DISTINCT market_id) FROM public.positions WHERE user_id = pr.id),
    st.pnl_usd,                                                   -- [092] live, from positions
    pr.total_volume_usd,
    CASE WHEN st.wins + st.losses > 0 THEN ROUND(st.wins::numeric / (st.wins + st.losses), 4) ELSE 0 END
  FROM public.profiles pr
  CROSS JOIN LATERAL public._trader_stats(pr.id) st
  WHERE pr.id = p_user_id;
$$;

-- ------------------------------------------------------------------ the leaderboard
CREATE OR REPLACE FUNCTION public.get_leaderboard(
  p_metric text DEFAULT 'volume',  -- 'volume' | 'winrate' | 'pnl'
  p_period text DEFAULT 'all',     -- 'all' | 'week' | 'month'
  p_limit  int  DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_metric text := lower(COALESCE(p_metric, 'volume'));
  v_period text := lower(COALESCE(p_period, 'all'));
  v_since  timestamptz;
  v_data   jsonb := '[]'::jsonb;
BEGIN
  IF v_metric NOT IN ('volume', 'winrate', 'pnl') THEN v_metric := 'volume'; END IF;
  IF v_period NOT IN ('all', 'week', 'month')     THEN v_period := 'all';    END IF;

  IF v_period = 'all' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.rank), '[]'::jsonb)
      INTO v_data
    FROM (
      SELECT
        l.id, l.display_name, l.username, l.avatar_url,
        l.total_bets, l.total_wins, l.win_rate,
        l.profit_loss_usd, l.total_volume_usd,
        CASE v_metric
          WHEN 'winrate' THEN l.winrate_rank
          WHEN 'pnl'     THEN l.pnl_rank
          ELSE l.volume_rank
        END AS rank
      FROM public.leaderboard l
      ORDER BY rank
      LIMIT v_limit
    ) t;
  ELSE
    v_since := now() - (CASE v_period WHEN 'month' THEN interval '30 days'
                                      ELSE interval '7 days' END);
    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.rank), '[]'::jsonb)
      INTO v_data
    FROM (
      WITH buys AS (      -- [092] traded volume; bets = market options bought
        SELECT tx.user_id,
               count(DISTINCT COALESCE(tx.market_option_id, tx.market_id)) AS bets,
               COALESCE(sum(tx.amount_usd), 0) AS volume
          FROM public.transactions tx
         WHERE tx.status = 'completed' AND tx.type = 'bet_placed' AND tx.created_at >= v_since
         GROUP BY tx.user_id
      ), pnl AS (         -- [092] P&L realized in the period (sales and settlements)
        SELECT e.user_id, sum(e.delta_usd) AS pnl
          FROM public.position_pnl_events e
         WHERE e.created_at >= v_since
         GROUP BY e.user_id
      ), closes AS (      -- [092] positions closed in the period, at their latest close
        SELECT DISTINCT ON (e.position_id) e.user_id, e.realized_after, m.status
          FROM public.position_pnl_events e
          LEFT JOIN public.markets m ON m.id = e.market_id
         WHERE e.closed AND e.created_at >= v_since
         ORDER BY e.position_id, e.created_at DESC, e.id DESC
      ), wl AS (
        SELECT c.user_id,
               count(*) FILTER (WHERE c.status IS DISTINCT FROM 'cancelled' AND c.realized_after > 0) AS wins,
               count(*) FILTER (WHERE c.status IS DISTINCT FROM 'cancelled' AND c.realized_after < 0) AS losses
          FROM closes c
         GROUP BY c.user_id
      ), agg AS (
        SELECT u.user_id,
               COALESCE(b.bets, 0)   AS period_bets,
               COALESCE(w.wins, 0)   AS period_wins,
               COALESCE(w.losses, 0) AS period_losses,
               COALESCE(b.volume, 0) AS period_volume,
               ROUND(COALESCE(p.pnl, 0), 6) AS period_pnl
          FROM (SELECT user_id FROM buys UNION SELECT user_id FROM pnl UNION SELECT user_id FROM wl) u
          LEFT JOIN buys b ON b.user_id = u.user_id
          LEFT JOIN pnl  p ON p.user_id = u.user_id
          LEFT JOIN wl   w ON w.user_id = u.user_id
      )
      SELECT
        pr.id, pr.display_name, pr.username, pr.avatar_url,
        agg.period_bets   AS total_bets,
        agg.period_wins   AS total_wins,
        CASE WHEN agg.period_wins + agg.period_losses > 0
             THEN round(agg.period_wins::numeric / (agg.period_wins + agg.period_losses), 4)
             ELSE 0 END   AS win_rate,
        agg.period_pnl    AS profit_loss_usd,
        agg.period_volume AS total_volume_usd,
        RANK() OVER (
          ORDER BY
            CASE v_metric
              WHEN 'winrate' THEN (CASE WHEN agg.period_wins + agg.period_losses > 0
                                        THEN agg.period_wins::numeric / (agg.period_wins + agg.period_losses)
                                        ELSE 0 END)
              WHEN 'pnl'     THEN agg.period_pnl
              ELSE agg.period_volume
            END DESC,
            CASE WHEN v_metric = 'winrate' THEN agg.period_wins + agg.period_losses ELSE 0 END DESC,
            pr.id
        ) AS rank
      FROM agg
      JOIN public.profiles pr
        ON pr.id = agg.user_id AND pr.account_status = 'active'
      ORDER BY rank
      LIMIT v_limit
    ) t;
  END IF;

  RETURN jsonb_build_object('data', v_data, 'metric', v_metric, 'period', v_period);
END;
$$;

COMMENT ON FUNCTION public.get_leaderboard IS
  'Leaderboard by metric (volume|winrate|pnl) and period (all|week|month). All-time reads the leaderboard matview (profile figures synced from positions, 092); week/month: realized P&L and closes from position_pnl_events, volume from bet_placed rows.';

-- the figures are right the moment this lands
SELECT public.sync_profile_trading_stats();
SELECT public.refresh_leaderboard();

COMMIT;
