#!/usr/bin/env python3
"""
seed_ticker_activity.py — put trades inside the on-chart ticker's window so the
ticker has something to animate.

WHY THIS EXISTS SEPARATELY FROM seed_activity.py
------------------------------------------------
`seed_activity.py` spreads its trades across the last 24 hours, which is right
for the market page's Activity panel and useless for the ticker: the ticker
only renders trades inside `TICKER_WINDOW_MS` (90 minutes, see
apps/web/lib/markets/trade-ticker.ts), so roughly one in sixteen of those rows
would ever reach it. That window is deliberate — a ticker is a claim that the
market is trading NOW — so the fix is to seed inside it, not to widen it.

It also offers `--live`, which is the only way to actually watch the thing
work. The ticker's first frame is server-rendered and the poller then asks for
trades newer than what it already has; a pile of backdated rows therefore
animates once on load and then sits still. A trickle of genuinely new rows is
what makes labels arrive one at a time, push the stack and age out.

EVERY ROW IS TAGGED AND REMOVABLE
---------------------------------
Seeded rows carry `metadata->>'seed' = 'ticker-demo'`, so they can be told
apart from real trades and deleted exactly:

    python3 scripts/seed_ticker_activity.py --purge

Nothing here touches money. `market_activity` is a display feed; balances,
orders and the ledger live in other tables and are not written to.

AUTH
----
Uses the Supabase Management API, like scripts/backfill_resolution_sources.py:
SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

API = "https://api.supabase.com/v1/projects/{ref}/database/query"
SEED_TAG = "ticker-demo"
#: Must stay <= TICKER_WINDOW_MS in apps/web/lib/markets/trade-ticker.ts.
WINDOW_MINUTES = 90


def sql(query: str) -> list[dict]:
    ref = os.environ.get("SUPABASE_PROJECT_REF")
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not ref or not token:
        print("ERROR: set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN", file=sys.stderr)
        raise SystemExit(2)
    r = requests.post(
        API.format(ref=ref),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"query": query},
        timeout=60,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"query failed {r.status_code}: {r.text[:400]}")
    out = r.json()
    return out if isinstance(out, list) else []


def q(s: str) -> str:
    """Single-quote a SQL literal."""
    return "'" + str(s).replace("'", "''") + "'"


def targets(slugs: list[str], limit: int) -> list[dict]:
    """Markets to seed: the named ones, else whatever the hero is showing."""
    if slugs:
        where = "m.slug in (" + ",".join(q(s) for s in slugs) + ")"
    else:
        where = "(m.is_featured or m.is_trending)"
    rows = sql(f"""
        select m.id, m.slug, m.title, coalesce(m.yes_price, 0.5) as yes_price,
               coalesce(m.total_volume_usd, 0) as vol,
               coalesce(json_agg(json_build_object('id', o.id, 'price', coalesce(o.yes_price, o.price, 0))
                        order by coalesce(o.yes_price, o.price, 0) desc)
                        filter (where o.id is not null), '[]') as options
        from public.markets m
        left join public.market_options o on o.market_id = m.id
        where m.status = 'active' and not m.is_hidden and {where}
        group by m.id
        order by m.total_volume_usd desc nulls last
        limit {int(limit)}
    """)
    for r in rows:
        if isinstance(r.get("options"), str):
            r["options"] = json.loads(r["options"])
    return rows


def profiles(n: int) -> list[str]:
    rows = sql(f"select id from public.profiles order by random() limit {int(n)}")
    return [r["id"] for r in rows]


def make_trade(m: dict, who: str, when: datetime, rng: random.Random) -> str:
    """One INSERT tuple. Amounts and prices stay plausible for the market."""
    opts = m.get("options") or []
    # A multi-outcome market records which option traded; a binary one does not,
    # and the ticker colours it by side instead.
    opt = rng.choice(opts) if opts else None
    base = float(opt["price"]) if opt else float(m["yes_price"])
    side = rng.choices(["yes", "no"], weights=[3, 1])[0]
    p = base if side == "yes" else 1 - base
    price = min(0.98, max(0.02, p + rng.uniform(-0.03, 0.03)))

    # Long-tailed, like real order flow: mostly small, occasionally large. The
    # ticker renders the figure, so the shape of this matters more than it
    # looks like it should.
    #
    # NOT scaled from the market's lifetime volume, which was the first cut:
    # total_volume_usd / 0.00008 put every stake at the 20 floor, so the ticker
    # showed "+ KSh 2,590" four times in a row. Stakes are a property of the
    # people trading, not of how long a market has been open. These are in USD,
    # the ledger's unit, and land where real ones do once converted: a median
    # near KSh 1,500, a ninth decile near KSh 8,000, and the occasional
    # five-figure ticket.
    amount = round(min(900.0, max(0.2, rng.lognormvariate(2.5, 1.25))), 2)

    meta = json.dumps({"seed": SEED_TAG})
    return (
        f"({q(m['id'])}::uuid, {q(who)}::uuid, 'buy', {q(side)}::order_side, "
        f"{amount}, {round(price, 6)}, {q(when.isoformat())}::timestamptz, "
        f"{q(opt['id']) + '::uuid' if opt else 'null'}, {q(meta)}::jsonb)"
    )


def insert(tuples: list[str]) -> int:
    if not tuples:
        return 0
    for i in range(0, len(tuples), 200):
        chunk = tuples[i : i + 200]
        sql(
            "insert into public.market_activity "
            "(market_id, user_id, action, side, amount_usd, price, created_at, "
            " market_option_id, metadata) values " + ",".join(chunk)
        )
    return len(tuples)


def purge() -> int:
    rows = sql(
        f"with d as (delete from public.market_activity "
        f"where metadata->>'seed' = {q(SEED_TAG)} returning 1) select count(*) as n from d"
    )
    return int(rows[0]["n"]) if rows else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--market", action="append", default=[], metavar="SLUG",
                    help="market slug (repeatable); default: featured + trending")
    ap.add_argument("--limit", type=int, default=6, help="how many markets when no slug is given")
    ap.add_argument("--backlog", type=int, default=5,
                    help="trades per market already inside the window, for the first frame")
    ap.add_argument("--live", type=int, default=0, metavar="SECONDS",
                    help="then keep inserting one trade every --every seconds for this long")
    ap.add_argument("--every", type=float, default=4.0, help="seconds between live trades")
    ap.add_argument("--purge", action="store_true", help="delete every row this script has written")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    if args.purge:
        n = purge()
        print(f"purged {n} seeded activity rows (metadata.seed = {SEED_TAG})")
        return 0

    rng = random.Random(args.seed)
    markets = targets(args.market, args.limit)
    if not markets:
        print("no matching active markets", file=sys.stderr)
        return 3
    who = profiles(40)
    if len(who) < 5:
        print("not enough profiles to attribute activity", file=sys.stderr)
        return 3

    now = datetime.now(timezone.utc)
    rows: list[str] = []
    for m in markets:
        for _ in range(args.backlog):
            # Inside the window, weighted towards the recent end so the stack
            # reads newest-at-the-bottom the way live flow would.
            mins = rng.triangular(0, WINDOW_MINUTES, 0)
            rows.append(make_trade(m, rng.choice(who), now - timedelta(minutes=mins), rng))

    print(f"markets: {len(markets)} ({', '.join(m['slug'] for m in markets)})")
    print(f"backlog: {len(rows)} trades inside the last {WINDOW_MINUTES} min")
    if args.dry_run:
        print("dry-run — nothing written")
        return 0

    print(f"inserted {insert(rows)} backlog trades")

    if args.live > 0:
        print(f"live: one trade every {args.every}s for {args.live}s — watch the chart")
        end = time.time() + args.live
        n = 0
        while time.time() < end:
            m = rng.choice(markets)
            insert([make_trade(m, rng.choice(who), datetime.now(timezone.utc), rng)])
            n += 1
            print(f"  +{n} {m['slug']}", flush=True)
            time.sleep(args.every)
        print(f"live: {n} trades")

    print("\nto remove every row this wrote:")
    print("  python3 scripts/seed_ticker_activity.py --purge")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
