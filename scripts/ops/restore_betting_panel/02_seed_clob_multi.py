#!/usr/bin/env python3
"""
02_seed_clob_multi.py — restore the CLOB order book on the multi-outcome markets.

Part of the betting-panel restore (see 01_flags_and_independent.sql for the root
cause). flags.clob is already on; this script:

  1. Flips ONLY the active multiple_choice (>2 option) markets to
     pricing_engine='clob'. Binary markets are left on the AMM engine untouched
     (a binary clob market would have no order-book UI and could confuse the
     money path), so this is deliberately scoped.
  2. Ensures USD maker/taker wallets for the demo traders.
  3. Seeds a genuine two-sided resting book per candidate (BUY YES bids +
     BUY NO synthesised asks per the migration-030 contract) using the repo's
     own quant.clob_book primitive, plus a stream of autocorrelated taker fills
     (quant.taker_flow) as trade history.

Idempotent: existing clob_orders / clob_fills for the target markets are deleted
and re-seeded, so re-running converges to the same footprint.

Reversible: to kill the order-book UI, set flags.clob=false (instant, no
redeploy) — the markets gracefully fall back to the independent AMM Yes/No lines
seeded in step 01. To fully revert: update markets set pricing_engine='amm'
where <ids> and delete the seeded clob rows.

Apply:
    SEED_DB_URL="postgresql://…:5432/postgres" python3 02_seed_clob_multi.py
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg2
from psycopg2.extras import execute_values

# Reuse the exact quant models the production seeder drives.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "sim"))
import quant  # noqa: E402

NOW = datetime.now(timezone.utc)

# Footprint knobs (free-tier-safe; mirrors the seeder's "lean" clob tier).
DEPTH = 6            # price levels per side
MAKERS_PER_LEVEL = 2 # distinct resting orders per level
FILLS_PER_BOOK = 90  # trade-history rows per candidate book
SEED = 20260724      # deterministic, reproducible


def ensure_usd_wallets(cur, n_users: int) -> list[tuple[str, str]]:
    cur.execute(
        "select u.id from auth.users u where u.email like '%%@demo.kichiko' "
        "order by u.created_at limit %s",
        (n_users,),
    )
    users = [r[0] for r in cur.fetchall()]
    if not users:
        cur.execute("select id from auth.users order by created_at limit %s", (n_users,))
        users = [r[0] for r in cur.fetchall()]
    out = []
    for uid_ in users:
        cur.execute("select id from wallets where user_id=%s and currency='USD'", (uid_,))
        w = cur.fetchone()
        if not w:
            wid = str(uuid.uuid4())
            cur.execute(
                "insert into wallets(id,user_id,currency,available_balance,is_active) "
                "values (%s,%s,'USD',1000000,true)",
                (wid, uid_),
            )
            w = (wid,)
        out.append((uid_, w[0]))
    return out


def main() -> int:
    url = os.environ.get("SEED_DB_URL")
    if not url:
        print("SEED_DB_URL not set", file=sys.stderr)
        return 2
    rng = np.random.default_rng(SEED)
    conn = psycopg2.connect(url, connect_timeout=30)
    cur = conn.cursor()

    # 1. Target set: active multiple_choice markets with >2 options ONLY.
    cur.execute(
        """select mk.id, coalesce(mk.yes_price,0.5)
             from public.markets mk
             join public.market_options o on o.market_id = mk.id
            where mk.status='active' and mk.resolution_type='multiple_choice'
            group by mk.id, mk.yes_price
           having count(o.id) > 2"""
    )
    markets = cur.fetchall()
    market_ids = [m[0] for m in markets]
    if not markets:
        print("no target multi-outcome markets found")
        return 0

    # Per-market option lines (drive each candidate's book around its yes price).
    cur.execute(
        """select id, market_id, coalesce(yes_price, price, 0.5)
             from public.market_options where market_id = any(%s::uuid[])
            order by display_order""",
        (market_ids,),
    )
    opts: dict[str, list] = {}
    for oid, mid, price in cur.fetchall():
        opts.setdefault(str(mid), []).append((str(oid), float(price)))

    wallets = ensure_usd_wallets(cur, 40)

    # Flip engine (flag already enabled in step 01).
    cur.execute(
        "update public.markets set pricing_engine='clob', updated_at=now() "
        "where id = any(%s::uuid[])",
        (market_ids,),
    )

    # Idempotent reset for the target markets.
    cur.execute("delete from public.clob_fills where market_id = any(%s::uuid[])", (market_ids,))
    cur.execute("delete from public.clob_orders where market_id = any(%s::uuid[])", (market_ids,))

    order_rows: list = []
    fill_rows: list = []
    n_orders = n_fills = 0
    for mid, _yes in markets:
        mid = str(mid)
        for oid, price in opts.get(mid, []):
            mid_cents = min(99.0, max(1.0, price * 100.0))
            book = quant.clob_book(mid_cents, rng, depth=DEPTH)
            for lvl in book:
                # YES-sell (ask) -> BUY NO @ (100-ask); YES-buy stays BUY YES.
                if lvl.action == "sell":
                    side, pc = "no", round(100.0 - lvl.price_cents, 1)
                else:
                    side, pc = "yes", lvl.price_cents
                pc = min(quant.CENTS_MAX, max(quant.CENTS_MIN, pc))
                for _ in range(MAKERS_PER_LEVEL):
                    uid_, wid = wallets[rng.integers(0, len(wallets))]
                    size = round(float(lvl.size) * float(rng.uniform(0.5, 1.2)) / MAKERS_PER_LEVEL, 2)
                    if size <= 0:
                        continue
                    order_rows.append((mid, oid, uid_, wid, side, "buy", "limit",
                                       pc, size, 0, "open", "USD", 1, round(pc / 100 * size, 2)))
            # Autocorrelated taker flow around the mid -> trade history.
            flow = quant.taker_flow(FILLS_PER_BOOK, rng)
            for k in range(FILLS_PER_BOOK):
                drift = flow[k] * float(rng.uniform(0.0, 1.5))
                pc = min(99.9, max(0.1, round(mid_cents + drift + rng.normal(0, 0.8), 1)))
                size = round(float(rng.uniform(50, 6000)), 2)
                taker = wallets[rng.integers(0, len(wallets))][0]
                maker = wallets[rng.integers(0, len(wallets))][0]
                mk = "direct" if rng.random() < 0.82 else ("mint" if rng.random() < 0.5 else "burn")
                mins = int(rng.integers(0, 60 * 24 * 7))
                fill_rows.append((mid, oid, "yes", pc, size, mk, None, None, taker, maker,
                                  NOW - timedelta(minutes=mins)))

    if order_rows:
        execute_values(
            cur,
            "insert into public.clob_orders (market_id,market_option_id,user_id,wallet_id,"
            "outcome_side,action,order_type,price_cents,size,filled,status,currency,"
            "exchange_rate_to_usd,reserved_usd) values %s",
            order_rows,
            template="(%s::uuid,%s::uuid,%s::uuid,%s::uuid,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            page_size=1000,
        )
        n_orders = len(order_rows)
    if fill_rows:
        execute_values(
            cur,
            "insert into public.clob_fills (market_id,market_option_id,outcome_side,price_cents,"
            "size,match_kind,taker_order_id,maker_order_id,taker_user_id,maker_user_id,created_at) values %s",
            fill_rows,
            template="(%s::uuid,%s::uuid,%s,%s,%s,%s,%s::uuid,%s::uuid,%s::uuid,%s::uuid,%s)",
            page_size=1000,
        )
        n_fills = len(fill_rows)

    conn.commit()
    cur.close()
    conn.close()
    print(f"clob_markets={len(markets)} clob_orders={n_orders} clob_fills={n_fills}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
