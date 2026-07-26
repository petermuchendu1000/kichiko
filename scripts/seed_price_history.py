#!/usr/bin/env python3
"""
seed_price_history.py — quant-grade price-history simulator for Kichiko.

Generates realistic implied-probability paths and inserts them into
public.price_history so charts (hero, featured carousel, movers rail) show
lifelike curves instead of a flat seeded line.

Model (deliberately market-microstructure-flavoured, not a naive random walk):

  BINARY markets
    • Work in logit (log-odds) space so probabilities stay in (0,1).
    • Ornstein–Uhlenbeck mean reversion toward a slowly drifting fair value.
    • Stochastic volatility (AR(1) on variance) → volatility clustering, so the
      curve has calm stretches and choppy stretches like a real order book.
    • Poisson "news jumps" (rare, larger log-odds shocks) for headline events.
    • The whole path is shifted so its LAST point == the market's current
      yes_price, anchoring the chart endpoint to the displayed probability.

  MULTIPLE_CHOICE markets
    • One correlated latent score per option (OU + idiosyncratic noise + a
      shared market factor + occasional regime shifts where a candidate surges).
    • softmax(scores) → probabilities that sum to 1 at EVERY timestamp (a proper
      simplex), anchored so the last step reproduces each option's current price.

Idempotent: deletes prior history for each seeded market, then re-inserts.
Usage:
    DATABASE_URL=postgres://... python3 scripts/seed_price_history.py [--limit N] [--days D] [--dry-run]
"""
from __future__ import annotations
import argparse
import math
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import psycopg2
from psycopg2.extras import execute_values

LOGIT_CLAMP = 0.02  # keep probabilities within [0.02, 0.98] for display sanity


def logit(p: float) -> float:
    p = min(1 - LOGIT_CLAMP, max(LOGIT_CLAMP, p))
    return math.log(p / (1 - p))


def sigmoid(z: float) -> float:
    return 1.0 / (1.0 + math.exp(-z))


def binary_path(p_now: float, n: int, rng: np.random.Generator) -> np.ndarray:
    """OU + stochastic-vol + jumps in logit space, anchored to end at p_now."""
    kappa = 0.045            # mean-reversion speed toward the drifting fair value
    base_var = 0.010         # baseline logit variance per step
    z = np.zeros(n)
    theta = 0.0              # slowly drifting fair value (logit)
    v = base_var             # stochastic variance state
    for i in range(1, n):
        # fair value drifts as a slow random walk
        theta += rng.normal(0, 0.02)
        # AR(1) stochastic volatility → clustering
        v = max(0.002, 0.90 * v + 0.10 * base_var + rng.normal(0, 0.0015))
        shock = rng.normal(0, math.sqrt(v))
        # rare Poisson news jump
        jump = rng.normal(0, 0.30) if rng.random() < 0.03 else 0.0
        z[i] = z[i - 1] + kappa * (theta - z[i - 1]) + shock + jump
    # anchor: shift so the final logit equals logit(p_now); keeps the shape
    z = z - z[-1] + logit(p_now)
    return np.array([sigmoid(float(x)) for x in z])


def multi_paths(prices: list[float], n: int, rng: np.random.Generator) -> list[np.ndarray]:
    """Correlated latent OU scores → softmax simplex, anchored to `prices`."""
    k = len(prices)
    q = np.array([max(1e-4, p) for p in prices], dtype=float)
    q = q / q.sum()
    base = np.log(q)                      # softmax(base) == q
    s = np.tile(base, (n, 1)).astype(float)
    kappa = 0.04
    for i in range(1, n):
        market_factor = rng.normal(0, 0.03)          # shared regime wobble
        for j in range(k):
            idio = rng.normal(0, 0.10)
            regime = rng.normal(0, 0.6) if rng.random() < 0.02 else 0.0  # a surge
            s[i, j] = s[i - 1, j] + kappa * (base[j] - s[i - 1, j]) + idio + market_factor + regime
    # anchor each series so the last step's softmax reproduces q exactly
    s = s - s[-1, :] + base
    out = []
    ex = np.exp(s - s.max(axis=1, keepdims=True))
    probs = ex / ex.sum(axis=1, keepdims=True)
    for j in range(k):
        out.append(probs[:, j])
    return out


def timestamps(n: int, days: int, opens_at: datetime | None) -> list[datetime]:
    """Evenly spaced timestamps over the trailing `days` window ending now.

    We intentionally use the full window even for recently-created demo markets
    so long-dated featured markets read like weeks of trading history (the
    seeded markets' opens_at reflects when they were loaded, not real life)."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    span = (now - start).total_seconds()
    return [start + timedelta(seconds=span * i / (n - 1)) for i in range(n)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=80, help="max markets to seed (by volume)")
    ap.add_argument("--days", type=int, default=90, help="history window length in days")
    ap.add_argument("--points", type=int, default=90, help="points per market")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: set DATABASE_URL", file=sys.stderr)
        return 2
    rng = np.random.default_rng(args.seed)

    conn = psycopg2.connect(dsn, connect_timeout=20)
    conn.autocommit = False
    cur = conn.cursor()

    # Target markets: active, real (has volume) or featured/trending, excluding
    # the self-ticking BTC up/down recurring windows.
    cur.execute(
        """
        select id, resolution_type, yes_price, total_volume_usd, opens_at, created_at, title
        from public.markets
        where status = 'active'
          and title not ilike '%%Up or Down%%'
          and (is_featured = true or is_trending = true or total_volume_usd > 0)
        order by total_volume_usd desc nulls last
        limit %s
        """,
        (args.limit,),
    )
    markets = cur.fetchall()
    print(f"Seeding {len(markets)} markets · {args.points} pts · {args.days}d window")

    # Preload options for multi markets.
    multi_ids = [m[0] for m in markets if m[1] == "multiple_choice"]
    opts_by_market: dict[str, list[tuple]] = {}
    if multi_ids:
        cur.execute(
            "select id, market_id, coalesce(yes_price, price, 0.0), display_order "
            "from public.market_options where market_id = any(%s::uuid[]) order by display_order asc",
            (multi_ids,),
        )
        for oid, mid, price, order in cur.fetchall():
            opts_by_market.setdefault(str(mid), []).append((str(oid), float(price)))

    n = args.points
    total_rows = 0
    seeded = 0
    for mid, rtype, yes_price, total_vol, opens_at, created_at, title in markets:
        mid = str(mid)
        ts = timestamps(n, args.days, opens_at or created_at)
        vol_total = float(total_vol or 0) or rng.uniform(2e5, 5e6)
        # per-bar volume: noisy slice of total, heavier near the end
        weights = np.linspace(0.5, 1.5, n) * rng.uniform(0.5, 1.5, n)
        bar_vol = vol_total * weights / weights.sum()
        rows: list[tuple] = []

        if rtype == "multiple_choice":
            opts = opts_by_market.get(mid, [])
            if len(opts) < 2:
                continue
            paths = multi_paths([p for _, p in opts], n, rng)
            for (oid, _), path in zip(opts, paths):
                for i in range(n):
                    p = float(path[i])
                    rows.append((mid, oid, round(p, 6), round(1 - p, 6), round(p, 6),
                                 round(float(bar_vol[i]) / len(opts), 6), ts[i]))
        else:
            p_now = float(yes_price if yes_price is not None else 0.5)
            path = binary_path(p_now, n, rng)
            for i in range(n):
                p = float(path[i])
                rows.append((mid, None, round(p, 6), round(1 - p, 6), round(p, 6),
                             round(float(bar_vol[i]), 6), ts[i]))

        if args.dry_run:
            seeded += 1
            total_rows += len(rows)
            continue

        cur.execute("delete from public.price_history where market_id = %s::uuid", (mid,))
        execute_values(
            cur,
            "insert into public.price_history "
            "(market_id, market_option_id, yes_price, no_price, price, volume_usd, recorded_at) values %s",
            rows,
            template="(%s::uuid, %s::uuid, %s, %s, %s, %s, %s)",
            page_size=500,
        )
        conn.commit()
        seeded += 1
        total_rows += len(rows)
        if seeded % 10 == 0:
            print(f"  … {seeded}/{len(markets)} markets, {total_rows} rows")

    print(f"DONE: {seeded} markets, {total_rows} rows "
          + ("(dry-run, nothing written)" if args.dry_run else "inserted"))
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
