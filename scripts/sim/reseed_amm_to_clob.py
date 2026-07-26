#!/usr/bin/env python3
"""
scripts/sim/reseed_amm_to_clob.py — remove every AMM market and reseed a fresh,
finquant-simulated CLOB catalog in its place.

Why this exists
---------------
The platform is migrating to an explicit CLOB (central-limit-order-book) world;
the legacy AMM/LMSR markets are being retired. This tool performs the migration
as a single, auditable, idempotent operation:

  1. backup   Snapshot every AMM market + all dependent rows to a timestamped
              JSON file (disaster recovery / reversibility) BEFORE deleting.
  2. remove   Delete all pricing_engine='amm' markets and their dependents in
              FK-safe order (positions/orders/transactions are ON DELETE NO
              ACTION, so they must be removed explicitly; the rest CASCADE).
  3. seed     Create the fresh CLOB catalog from clob_catalog.json. Each binary
              question becomes a multiple_choice + independent CLOB market with a
              SINGLE per-event option — the Polymarket binary model that the
              tested multi-outcome UI (candidate list + inline order book) and
              engine (clob_place_order / clob_get_book) already support. Binary
              markets rendered under resolution_type='binary' would fall back to
              the retired AMM panel, so multiple_choice is REQUIRED for a working
              order book (see apps/web/app/markets/[slug]/page.tsx `clob` gate).
  4. simulate Populate lifelike market microstructure using the quant models in
              scripts/sim/quant.py — all scoped to the catalog markets ONLY, so
              the pre-existing CLOB markets are never disturbed:
                * price_history  — OU-logit implied-probability path anchored to
                                   the fair value, sharing a cross-market latent
                                   factor so the whole board co-moves like a real
                                   exchange on macro days.
                * clob_orders    — a genuine two-sided resting book (geometric
                                   depth decay + bid/ask spread), multi-maker per
                                   level, per the migration-030 contract (BUY YES
                                   bids + BUY NO synthesised asks).
                * clob_fills     — autocorrelated (herding) taker flow over the
                                   trailing week; realistic direct/mint/burn mix.
                * positions      — whale-to-minnow holder distribution across the
                                   demo traders, both Yes and No sides.
                * market_activity— a derived buy/sell feed.
              Market + option aggregates (volume, bettors, last trade) are then
              recomputed from the seeded rows.
  5. verify   Row counts, book depth, price-path sanity, DB size.

All subcommands are idempotent (safe to re-run) and deterministic given --seed.

Usage
-----
    SEED_DB_URL="postgresql://...:5432/postgres" \\
        python3 scripts/sim/reseed_amm_to_clob.py all [--dry-run] [--seed 2027]

    # granular
    python3 scripts/sim/reseed_amm_to_clob.py backup
    python3 scripts/sim/reseed_amm_to_clob.py remove
    python3 scripts/sim/reseed_amm_to_clob.py seed
    python3 scripts/sim/reseed_amm_to_clob.py simulate
    python3 scripts/sim/reseed_amm_to_clob.py verify
"""
from __future__ import annotations

import argparse
import datetime as dt
import decimal
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import quant  # noqa: E402  (sibling module: pure finance model library)

NOW = datetime.now(timezone.utc)
HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG_PATH = os.path.join(HERE, "clob_catalog.json")

# footprint knobs — comfortably inside the Supabase free-tier budget
PRICE_DAYS = 90
PRICE_PTS = 220
INTRADAY_TOP = 8          # densest history for the top-N markets by fair value
INTRADAY_PTS = 480
BOOK_DEPTH = 8            # resting rungs per side
MAKERS_PER_LEVEL = 3
FILLS_PER_BOOK = 180
HOLDERS_YES = 16
HOLDERS_NO = 12


def connect():
    dsn = (os.environ.get("SEED_DB_URL") or os.environ.get("DATABASE_URL")
           or os.environ.get("SUPABASE_DB_URL"))
    if not dsn:
        sys.exit("Set SEED_DB_URL (or DATABASE_URL) to the Supabase Postgres URL.")
    conn = psycopg2.connect(dsn, connect_timeout=25)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("set statement_timeout='120s'; set lock_timeout='15s'")
    conn.commit()
    cur.close()
    return conn


def _tstamps(n: int, days: float, end: datetime) -> list[datetime]:
    start = end - timedelta(days=days)
    span = (end - start).total_seconds()
    return [start + timedelta(seconds=span * i / (n - 1)) for i in range(n)]


def _outcome_label(title: str) -> str:
    """A concise per-event outcome label for the single independent option."""
    t = (title or "").strip().rstrip("?").strip()
    return t[:80] if t else "Outcome"


def load_catalog() -> list[dict]:
    with open(CATALOG_PATH) as f:
        return json.load(f)


# --------------------------------------------------------------------------- #
# 1) backup
# --------------------------------------------------------------------------- #
def _json_default(o):
    if isinstance(o, (dt.datetime, dt.date)):
        return o.isoformat()
    if isinstance(o, decimal.Decimal):
        return str(o)
    if isinstance(o, memoryview):
        return o.tobytes().hex()
    return str(o)


def backup(conn, dry: bool) -> dict:
    dc = conn.cursor(cursor_factory=RealDictCursor)
    dc.execute("select id from markets where pricing_engine='amm'")
    ids = [r["id"] for r in dc.fetchall()]
    if not ids:
        dc.close()
        return {"amm_markets": 0, "note": "nothing to back up"}
    tables = {
        "markets": "select * from markets where id=any(%s::uuid[])",
        "positions": "select * from positions where market_id=any(%s::uuid[])",
        "comments": "select * from comments where market_id=any(%s::uuid[])",
        "market_activity": "select * from market_activity where market_id=any(%s::uuid[])",
        "price_history": "select * from price_history where market_id=any(%s::uuid[])",
        "btc_windows": "select * from btc_windows where market_id=any(%s::uuid[])",
    }
    snap = {"meta": {"created_at": NOW.isoformat(), "amm_market_ids": [str(i) for i in ids]}}
    for t, q in tables.items():
        dc.execute(q, (ids,))
        snap[t] = dc.fetchall()
    dc.close()
    counts = {k: len(v) for k, v in snap.items() if isinstance(v, list)}
    if dry:
        return {"would_backup": counts}
    os.makedirs(os.path.join(HERE, "backups"), exist_ok=True)
    path = os.path.join(HERE, "backups", f"amm_backup_{NOW:%Y%m%d_%H%M%S}.json")
    with open(path, "w") as f:
        json.dump(snap, f, default=_json_default)
    return {"backup_path": path, "counts": counts}


# --------------------------------------------------------------------------- #
# 2) remove
# --------------------------------------------------------------------------- #
def remove(conn, dry: bool) -> dict:
    cur = conn.cursor()
    cur.execute("select id from markets where pricing_engine='amm'")
    ids = [r[0] for r in cur.fetchall()]
    if not ids:
        cur.close()
        return {"removed_markets": 0, "note": "no AMM markets"}
    counts = {}
    # dependents with ON DELETE NO ACTION must be removed explicitly first;
    # comments/market_activity/price_history/btc_windows/clob_*/market_options
    # CASCADE from markets, but we delete them explicitly too for an auditable,
    # deterministic teardown (and market_search has no FK at all).
    order = [
        ("clob_fills", "delete from clob_fills where market_id=any(%s::uuid[])"),
        ("clob_orders", "delete from clob_orders where market_id=any(%s::uuid[])"),
        ("market_activity", "delete from market_activity where market_id=any(%s::uuid[])"),
        ("price_history", "delete from price_history where market_id=any(%s::uuid[])"),
        ("positions", "delete from positions where market_id=any(%s::uuid[])"),
        ("orders", "delete from orders where market_id=any(%s::uuid[])"),
        ("transactions", "delete from transactions where market_id=any(%s::uuid[])"),
        ("comments", "delete from comments where market_id=any(%s::uuid[])"),
        ("btc_windows", "delete from btc_windows where market_id=any(%s::uuid[])"),
        ("market_options", "delete from market_options where market_id=any(%s::uuid[])"),
        # NOTE: market_search is an auto-updatable VIEW over markets (not a table);
        # the markets delete below removes its rows. Never delete it directly.
        ("markets", "delete from markets where id=any(%s::uuid[])"),
    ]
    for name, q in order:
        cur.execute(q, (ids,))
        counts[name] = cur.rowcount
    if dry:
        conn.rollback()
        cur.close()
        return {"would_remove_markets": len(ids), "would_delete": counts}
    conn.commit()
    cur.close()
    return {"removed_markets": len(ids), "deleted": counts}


# --------------------------------------------------------------------------- #
# 3) seed catalog (markets + single independent option)
# --------------------------------------------------------------------------- #
def _creator_id(cur) -> str:
    cur.execute("select creator_id from markets where creator_id is not null limit 1")
    r = cur.fetchone()
    if r:
        return r[0]
    cur.execute("select id from auth.users order by created_at limit 1")
    return cur.fetchone()[0]


def seed(conn, dry: bool) -> dict:
    cur = conn.cursor()
    catalog = load_catalog()
    creator = _creator_id(cur)
    # enable the CLOB + independent-options feature flags (idempotent)
    for k in ("flags.clob", "flags.independent_options", "flags.pm_ticket"):
        cur.execute("""insert into platform_settings(key,value) values (%s,'true'::jsonb)
                       on conflict (key) do update set value='true'::jsonb""", (k,))

    created = 0
    id_by_slug = {}
    for m in catalog:
        slug = m["slug"]
        fv = float(m["fair_value"])
        # idempotency: drop a prior reseed of this slug (and its dependents)
        cur.execute("select id from markets where slug=%s", (slug,))
        prev = cur.fetchone()
        if prev:
            pid = prev[0]
            for t in ("clob_fills", "clob_orders", "market_activity", "price_history",
                      "positions", "market_options"):
                cur.execute(f"delete from {t} where market_id=%s", (pid,))
            # market_search is a VIEW over markets; deleting the market row suffices.
            cur.execute("delete from markets where id=%s", (pid,))

        mid = str(uuid.uuid4())
        id_by_slug[slug] = mid
        if dry:
            created += 1
            continue
        cur.execute("""
            insert into markets
              (id, slug, title, description, category, resolution_type, creator_id,
               status, opens_at, closes_at, resolves_at, resolution_criteria,
               resolution_source, yes_price, no_price, tags, cover_image_url,
               cover_entity_kind, cover_entity_ref, allowed_countries, is_featured,
               is_trending, creator_reward_rate, platform_fee_rate,
               pricing_engine, options_pricing_mode, tick_size, min_order_size,
               initial_liquidity_usd, created_at, updated_at)
            values
              (%s,%s,%s,%s,%s::market_category,'multiple_choice',%s,
               'active',%s,%s,%s,%s,
               %s,%s,%s,%s,%s,
               %s,%s,%s,%s,
               %s,%s,%s,
               'clob','independent',0.001,5,
               100, now(), now())
        """, (
            mid, slug, m["title"], m["description"], m["category"], creator,
            m.get("opens_at"), m["closes_at"], m.get("resolves_at"), m["resolution_criteria"],
            m.get("resolution_source"), round(fv, 6), round(1 - fv, 6), m.get("tags") or [],
            m.get("cover_image_url"), m.get("cover_entity_kind"), m.get("cover_entity_ref"),
            m.get("allowed_countries") or ["KE", "TZ", "UG", "RW", "ZM", "ET", "BI"],
            bool(m.get("is_featured")), bool(m.get("is_trending")),
            m.get("creator_reward_rate") or 0.0025, m.get("platform_fee_rate") or 0.02,
        ))
        # single per-event independent option (Polymarket binary model)
        oid = str(uuid.uuid4())
        cur.execute("""
            insert into market_options
              (id, market_id, label, description, price, yes_price, no_price,
               display_order, entity_kind, entity_ref, image_url, is_active,
               created_at, updated_at)
            values (%s,%s,%s,%s,%s,%s,%s,0,%s,%s,%s,true, now(), now())
        """, (oid, mid, _outcome_label(m["title"]), m["description"],
              round(fv, 6), round(fv, 6), round(1 - fv, 6),
              m.get("cover_entity_kind"), m.get("cover_entity_ref"), m.get("cover_image_url")))
        created += 1

    if dry:
        conn.rollback()
        cur.close()
        return {"would_create": created}
    conn.commit()
    cur.close()
    return {"created_markets": created}


# --------------------------------------------------------------------------- #
# 4) simulate microstructure (scoped to catalog markets only)
# --------------------------------------------------------------------------- #
def _catalog_markets(cur) -> list[tuple]:
    slugs = [m["slug"] for m in load_catalog()]
    cur.execute("""select m.id, m.slug, o.id, coalesce(o.yes_price, m.yes_price, 0.5)
                   from markets m join market_options o on o.market_id=m.id
                   where m.slug=any(%s) and m.pricing_engine='clob'
                   order by m.slug""", (slugs,))
    return cur.fetchall()


def _usd_makers(cur, n=40):
    cur.execute("""select u.id, w.id from auth.users u
                   join wallets w on w.user_id=u.id and w.currency='KES'
                   where u.email like '%%@demo.kichiko' order by u.created_at limit %s""", (n,))
    rows = cur.fetchall()
    if not rows:
        cur.execute("""select u.id, w.id from auth.users u
                       join wallets w on w.user_id=u.id and w.currency='KES'
                       order by u.created_at limit %s""", (n,))
        rows = cur.fetchall()
    return rows


def _kes_traders(cur, n=60):
    cur.execute("""select u.id, w.id from auth.users u
                   join wallets w on w.user_id=u.id and w.currency='KES'
                   where u.email like '%%@demo.kichiko' order by u.created_at limit %s""", (n,))
    return cur.fetchall()


def _whale_to_minnow(n, top, rng):
    out, v = [], top
    for _ in range(n):
        out.append(round(v))
        v *= float(rng.uniform(0.45, 0.82))
    return out


def simulate(conn, rng, dry: bool) -> dict:
    cur = conn.cursor()
    markets = _catalog_markets(cur)
    if not markets:
        cur.close()
        return {"note": "no catalog CLOB markets found; run seed first"}
    makers = _usd_makers(cur)
    traders = _kes_traders(cur)
    if not makers or not traders:
        cur.close()
        return {"note": "no demo wallets available"}
    trader_ids = [t[0] for t in traders]
    trader_wallet = {t[0]: t[1] for t in traders}

    market_ids = [m[0] for m in markets]
    # rank by fair value spread from 0.5 as a proxy for "interest" -> denser history
    top_ids = {m[0] for m in sorted(markets, key=lambda r: abs(float(r[3]) - 0.5))[:INTRADAY_TOP]}
    factor_full = quant.market_factor_path(max(PRICE_PTS, INTRADAY_PTS), rng)

    if dry:
        est_orders = len(markets) * BOOK_DEPTH * 2 * MAKERS_PER_LEVEL
        est_fills = len(markets) * FILLS_PER_BOOK
        est_pos = len(markets) * (HOLDERS_YES + HOLDERS_NO)
        cur.close()
        return {"markets": len(markets), "est_orders": est_orders,
                "est_fills": est_fills, "est_positions": est_pos}

    # idempotent reset for these markets
    cur.execute("delete from clob_fills where market_id=any(%s::uuid[])", (market_ids,))
    cur.execute("delete from clob_orders where market_id=any(%s::uuid[])", (market_ids,))
    cur.execute("delete from price_history where market_id=any(%s::uuid[])", (market_ids,))
    cur.execute("delete from market_activity where market_id=any(%s::uuid[])", (market_ids,))
    cur.execute("delete from positions where market_id=any(%s::uuid[])", (market_ids,))
    conn.commit()

    order_rows, fill_rows, ph_rows, pos_rows, act_rows = [], [], [], [], []
    n_orders = n_fills = n_ph = n_pos = 0

    for mkt, slug, oid, yes_price in markets:
        mkt = str(mkt); oid = str(oid); p = float(yes_price)
        mid_cents = min(99.0, max(1.0, p * 100.0))

        # ---- price history: OU-logit path anchored to the fair value ----
        is_top = mkt in {str(t) for t in top_ids}
        n = INTRADAY_PTS if is_top else PRICE_PTS
        days = 3.0 if is_top else PRICE_DAYS
        ts = _tstamps(n, days, NOW)
        factor = np.interp(np.linspace(0, 1, n), np.linspace(0, 1, len(factor_full)), factor_full)
        beta = float(rng.uniform(0.2, 0.9))
        path = quant.ou_logit_path(p, n, rng, factor=factor, beta=beta)
        for i in range(n):
            pv = float(path[i])
            ph_rows.append((mkt, oid, round(pv, 6), round(1 - pv, 6), round(pv, 6),
                            round(float(rng.uniform(20, 900)), 2), ts[i]))

        # ---- resting two-sided book (migration-030 contract) ----
        book = quant.clob_book(mid_cents, rng, depth=BOOK_DEPTH)
        for lvl in book:
            if lvl.action == "sell":              # YES ask -> BUY NO @ (100 - ask)
                side, pc = "no", round(100.0 - lvl.price_cents, 1)
            else:                                  # YES bid -> BUY YES
                side, pc = "yes", lvl.price_cents
            pc = min(quant.CENTS_MAX, max(quant.CENTS_MIN, pc))
            for _ in range(MAKERS_PER_LEVEL):
                uid_, wid = makers[rng.integers(0, len(makers))]
                size = round(float(lvl.size) * float(rng.uniform(0.5, 1.2)) / MAKERS_PER_LEVEL, 2)
                if size <= 0:
                    continue
                order_rows.append((mkt, oid, uid_, wid, side, "buy", "limit",
                                   pc, size, 0, "open", "KES", 0.01, round(pc / 100 * size, 2)))

        # ---- trade history: autocorrelated taker flow ----
        flow = quant.taker_flow(FILLS_PER_BOOK, rng)
        for k in range(FILLS_PER_BOOK):
            drift = flow[k] * float(rng.uniform(0.0, 1.5))
            pc = min(99.9, max(0.1, round(mid_cents + drift + rng.normal(0, 0.8), 1)))
            size = round(float(rng.uniform(20, 2000)), 2)
            taker = makers[rng.integers(0, len(makers))][0]
            maker = makers[rng.integers(0, len(makers))][0]
            mk = "direct" if rng.random() < 0.82 else ("mint" if rng.random() < 0.5 else "burn")
            mins = int(rng.integers(0, 60 * 24 * 7))
            fill_rows.append((mkt, oid, "yes", pc, size, mk, None, None, taker, maker,
                              NOW - timedelta(minutes=mins)))

        # ---- holder distribution (whale -> minnow), both sides ----
        seen = set()

        def _book_side(side, price, top, count):
            holders = rng.choice(len(trader_ids), size=min(count, len(trader_ids)), replace=False)
            for idx, sh in zip(holders, _whale_to_minnow(count, top, rng)):
                if sh <= 0:
                    continue
                u = trader_ids[int(idx)]
                if (u, side) in seen:
                    continue
                seen.add((u, side))
                entry = min(0.97, max(0.03, price + float(rng.uniform(-0.12, 0.10))))
                cur_val = round(sh * price, 2)
                inv = round(sh * entry, 2)
                pos_rows.append((u, mkt, trader_wallet[u], oid, side, sh, inv, round(entry, 4),
                                 cur_val, round(cur_val - inv, 2), 0, 0, True, None,
                                 NOW - timedelta(days=int(rng.integers(15, 200))), NOW, 0))

        top_yes = 40_000 * p  # KES peg: 1 share = KSh 100, so keep whale positions realistic
        _book_side("yes", p, top_yes, HOLDERS_YES)
        _book_side("no", 1 - p, top_yes * 0.5, HOLDERS_NO)

        # flush in batches to bound memory
        if len(order_rows) >= 4000:
            n_orders += _flush_orders(cur, order_rows); order_rows = []; conn.commit()
        if len(fill_rows) >= 4000:
            n_fills += _flush_fills(cur, fill_rows); fill_rows = []; conn.commit()
        if len(ph_rows) >= 4000:
            n_ph += _flush_ph(cur, ph_rows); ph_rows = []; conn.commit()

    if order_rows:
        n_orders += _flush_orders(cur, order_rows)
    if fill_rows:
        n_fills += _flush_fills(cur, fill_rows)
    if ph_rows:
        n_ph += _flush_ph(cur, ph_rows)
    if pos_rows:
        execute_values(cur, """insert into positions
            (user_id,market_id,wallet_id,market_option_id,side,shares,total_invested_usd,
             avg_entry_price,current_value_usd,unrealized_pnl_usd,realized_pnl_usd,
             total_payout_usd,is_active,claimed_at,created_at,updated_at,reserved_shares)
            values %s""",
            pos_rows,
            template="(%s::uuid,%s::uuid,%s::uuid,%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            page_size=1000)
        n_pos = len(pos_rows)
    conn.commit()

    # ---- activity feed derived from active holdings ----
    cur.execute("""select distinct user_id, market_id, side from positions
                   where market_id=any(%s::uuid[]) and is_active=true""", (market_ids,))
    for u, mkt, side in cur.fetchall():
        for _ in range(int(rng.integers(1, 4))):
            act_rows.append((mkt, u, rng.choice(["buy", "sell"]),
                             round(float(rng.uniform(200, 90_000)), 2), side,
                             round(float(rng.uniform(0.05, 0.95)), 4),
                             NOW - timedelta(days=int(rng.integers(0, 40)),
                                             hours=int(rng.integers(0, 23)))))
    if act_rows:
        execute_values(cur, """insert into market_activity
            (market_id,user_id,action,amount_usd,side,price,created_at) values %s""",
            act_rows, template="(%s::uuid,%s::uuid,%s,%s,%s,%s,%s)", page_size=1000)
    conn.commit()

    _recompute_aggregates(cur, market_ids)
    conn.commit()
    cur.close()
    return {"markets": len(markets), "clob_orders": n_orders, "clob_fills": n_fills,
            "price_history": n_ph, "positions": n_pos, "activity": len(act_rows)}


def _flush_orders(cur, rows):
    execute_values(cur, """insert into clob_orders
        (market_id,market_option_id,user_id,wallet_id,outcome_side,action,order_type,
         price_cents,size,filled,status,currency,exchange_rate_to_usd,reserved_usd) values %s""",
        rows, template="(%s::uuid,%s::uuid,%s::uuid,%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        page_size=1000)
    return len(rows)


def _flush_fills(cur, rows):
    execute_values(cur, """insert into clob_fills
        (market_id,market_option_id,outcome_side,price_cents,size,match_kind,
         taker_order_id,maker_order_id,taker_user_id,maker_user_id,created_at) values %s""",
        rows, template="(%s::uuid,%s::uuid,%s,%s,%s,%s,%s::uuid,%s::uuid,%s::uuid,%s::uuid,%s)",
        page_size=1000)
    return len(rows)


def _flush_ph(cur, rows):
    execute_values(cur, """insert into price_history
        (market_id,market_option_id,yes_price,no_price,price,volume_usd,recorded_at) values %s""",
        rows, template="(%s::uuid,%s::uuid,%s,%s,%s,%s,%s)", page_size=1000)
    return len(rows)


def _recompute_aggregates(cur, market_ids):
    # market-level volume/bettors from seeded positions (x2.3 ~ round-trip churn)
    cur.execute("""with agg as (
          select market_id, sum(total_invested_usd) inv,
                 sum(total_invested_usd) filter (where side='yes') yi,
                 sum(total_invested_usd) filter (where side='no') ni,
                 count(*) bets, count(distinct user_id) traders
          from positions where market_id=any(%s::uuid[]) group by market_id)
        update markets m set total_volume_usd=round(agg.inv*2.3,2),
          yes_volume_usd=round(coalesce(agg.yi,0)*2.3,2),
          no_volume_usd=round(coalesce(agg.ni,0)*2.3,2),
          volume_24h_usd=round(agg.inv*0.12,2), total_bets=agg.bets,
          unique_bettors=agg.traders, last_trade_at=now()
        from agg where m.id=agg.market_id""", (market_ids,))
    # option-level volume from positions
    cur.execute("""with agg as (select market_option_id, sum(total_invested_usd) inv
          from positions where market_option_id is not null and market_id=any(%s::uuid[])
          group by market_option_id)
        update market_options o set volume_usd=round(agg.inv*2.1,2),
          total_invested_usd=round(agg.inv,2)
        from agg where o.id=agg.market_option_id""", (market_ids,))
    # option yes/no price from the latest price_history point
    cur.execute("""with last as (
          select distinct on (market_option_id) market_option_id, yes_price, no_price
          from price_history where market_id=any(%s::uuid[])
          order by market_option_id, recorded_at desc)
        update market_options o set yes_price=last.yes_price, no_price=last.no_price,
          price=last.yes_price
        from last where o.id=last.market_option_id""", (market_ids,))
    # mirror option yes_price up to the market headline yes/no price
    cur.execute("""update markets m set yes_price=o.yes_price, no_price=o.no_price
        from market_options o where o.market_id=m.id and m.id=any(%s::uuid[])""", (market_ids,))


# --------------------------------------------------------------------------- #
# 5) verify
# --------------------------------------------------------------------------- #
def verify(conn) -> dict:
    cur = conn.cursor()
    out = {}
    cur.execute("select pricing_engine, count(*) from markets group by 1 order by 1")
    out["markets_by_engine"] = dict(cur.fetchall())
    slugs = [m["slug"] for m in load_catalog()]
    cur.execute("""select count(*) from markets where slug=any(%s) and pricing_engine='clob'""", (slugs,))
    out["catalog_clob_markets"] = cur.fetchone()[0]
    for t in ("clob_orders", "clob_fills", "price_history", "positions", "market_activity"):
        cur.execute(f"""select count(*) from {t} tt join markets m on m.id=tt.market_id
                        where m.slug=any(%s)""", (slugs,))
        out[f"catalog_{t}"] = cur.fetchone()[0]
    cur.execute("select pg_size_pretty(pg_database_size('postgres'))")
    out["db_size"] = cur.fetchone()[0]
    cur.close()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["backup", "remove", "seed", "simulate", "verify", "all"])
    ap.add_argument("--seed", type=int, default=2027)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    conn = connect()
    print(f"cmd={args.cmd} dry_run={args.dry_run}")
    try:
        if args.cmd in ("backup", "all"):
            print("backup  ->", backup(conn, args.dry_run))
        if args.cmd in ("remove", "all"):
            print("remove  ->", remove(conn, args.dry_run))
        if args.cmd in ("seed", "all"):
            print("seed    ->", seed(conn, args.dry_run))
        if args.cmd in ("simulate", "all"):
            print("simulate->", simulate(conn, rng, args.dry_run))
        if args.cmd in ("verify", "all"):
            print("verify  ->", verify(conn))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
