#!/usr/bin/env python3
"""Seed a large, idempotent demo dataset for the social surfaces.

Populates the Top Holders board (two-column Yes/No, per-option for multi-outcome
markets), the holder hover-peek card and the public trader profile
(migration 026) with a realistic, East-Africa-flavoured crowd so every surface
renders like the Polymarket reference — no empty states anywhere.

WHAT IT CREATES
---------------
* ~60 demo traders (deterministic uuid5 ids, @demo.kichiko emails). The
  handle_new_user trigger auto-creates each profile + wallets on insert.
* Yes AND No holders on:
    - featured BINARY markets (both columns full, whale-to-minnow ranking), and
    - every option of featured MULTI-OUTCOME markets (each option is its own
      Yes/No book, exactly like Polymarket's per-candidate Buy Yes / Buy No).
* Cross-market positions so trader profiles are rich (many rows, multiple
  markets), plus CLOSED positions (won/lost) for the Closed tab + biggest-win.
* price_history ticks for every seeded market/option (P&L sparklines).
* market_activity rows (Activity feed).
* Profile aggregates (P&L, volume, win-rate, predictions) recomputed from the
  seeded positions so the peek-card / profile stats are internally consistent.

SAFETY / IDEMPOTENCY
--------------------
* Reads the DB URL from SUPABASE_DB_URL. No secrets are committed.
* Demo rows are keyed by @demo.kichiko + deterministic uuid5, so re-runs
  update in place. Each run first removes demo-owned positions/activity and the
  price ticks for the seeded markets, then re-inserts a clean snapshot. It never
  touches real user data.

USAGE
-----
    SUPABASE_DB_URL="postgresql://...:5432/postgres" \
        python3 scripts/seed_demo_traders.py
"""
from __future__ import annotations

import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras

DEMO_DOMAIN = "demo.kichiko"
NS = uuid.uuid5(uuid.NAMESPACE_DNS, DEMO_DOMAIN)
NOW = datetime.now(timezone.utc)
RNG = random.Random(2027)  # deterministic distribution across runs

N_TRADERS = 60

# Markets to fill (by slug). Boards for these will never be empty.
BINARY_SLUGS = [
    "ke-ruto-reelection-2027", "ke-mpesa-record-2026", "ke-afcon-stadia-pass-2027",
    "ke-inflation-below-5-dec2026", "ke-iebc-chair-before-2027", "ke-y-housing-levy-still-2026",
    "ke-kes-stronger-130-eoy2026", "ke-btc-150k-2026", "ke-eurobond-2026",
    "ke-talanta-complete-2026", "ke-safaricom-above-30-eoy2026", "ke-y-genz-protest-2026",
]
MULTI_SLUGS = ["ke-2027-president", "ke-nairobi-governor-2027", "ke-2027-campaign-issue"]
# Older/settled markets used only for CLOSED positions.
CLOSED_SLUGS = ["btc-up-down-5m-1783639485", "ke-mpesa-record-2026",
                "ke-afcon-stadia-pass-2027", "ke-inflation-below-5-dec2026"]

FIRST = ["Amani", "Baraka", "Chege", "Dalmas", "Esther", "Faith", "Gathoni", "Halima",
         "Imani", "Juma", "Kamau", "Lilian", "Maina", "Nyambura", "Otieno", "Pendo",
         "Rehema", "Sanaipei", "Tabitha", "Violet", "Wanjiru", "Zawadi", "Brian",
         "Collins", "Dennis", "Eric", "Felix", "George", "Hassan", "Ian", "Joseph",
         "Kevin", "Lewis", "Martin", "Nelson", "Oscar", "Peter", "Quincy", "Ronald",
         "Samuel", "Teddy", "Victor", "Wesley", "Yusuf", "Zack", "Aisha", "Brenda",
         "Cynthia", "Diana", "Eunice", "Grace", "Hilda", "Irene", "Joyce", "Karen",
         "Lucy", "Mercy", "Naomi", "Purity", "Ruth"]
LAST = ["Kamau", "Otieno", "Wanjiru", "Mwangi", "Ochieng", "Kiptoo", "Njoroge", "Achieng",
        "Barasa", "Chebet", "Omondi", "Kimani", "Wafula", "Mutua", "Nyaga", "Kariuki",
        "Auma", "Cheruiyot", "Gichuru", "Hassan", "Ndegwa", "Owino", "Rono", "Simiyu",
        "Wekesa", "Yego", "Abdi", "Bett", "Chumo", "Kilonzo"]
BIOS = ["Long Kenya. Conviction over noise.", "Nairobi. Macro + elections.",
        "Value on East African politics.", "Sports arbs. Cross-book value.",
        "Data over vibes.", "Fading the favourite since 2023.", "Turnout models.",
        "FX + rates. Mombasa.", "Small stakes, sharp reads.", "Weekend positions only.",
        "Policy desk. Long-horizon.", "Coast trader. Contrarian.", "Momentum trader.",
        "", "", ""]


def uid(key: str) -> str:
    return str(uuid.uuid5(NS, key))


def descending_shares(n: int, top: float) -> list[float]:
    """A whale-to-minnow ranking: geometric-ish decay with jitter."""
    out = []
    v = top
    for _ in range(n):
        out.append(round(v))
        v *= RNG.uniform(0.45, 0.8)
    return out


def main() -> int:
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        print("ERROR: set SUPABASE_DB_URL", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ---- resolve markets --------------------------------------------------
    all_slugs = list(dict.fromkeys(BINARY_SLUGS + MULTI_SLUGS + CLOSED_SLUGS))
    cur.execute(
        "SELECT id, slug, yes_price, no_price, resolution_type FROM markets WHERE slug = ANY(%s)",
        (all_slugs,),
    )
    markets = {r["slug"]: r for r in cur.fetchall()}
    missing = [s for s in all_slugs if s not in markets]
    if missing:
        print(f"WARN: markets not found (skipped): {missing}", file=sys.stderr)

    # options for multi markets + backfill yes/no price from `price`
    options: dict[str, list] = {}
    for slug in MULTI_SLUGS:
        m = markets.get(slug)
        if not m:
            continue
        cur.execute(
            "SELECT id, label, price FROM market_options WHERE market_id=%s ORDER BY display_order",
            (m["id"],),
        )
        opts = cur.fetchall()
        options[slug] = opts
        for o in opts:
            price = float(o["price"] or 0.5)
            cur.execute("UPDATE market_options SET yes_price=%s, no_price=%s WHERE id=%s",
                        (round(price, 4), round(1 - price, 4), o["id"]))

    touched_market_ids = list({markets[s]["id"] for s in all_slugs if s in markets})

    # ---- traders ----------------------------------------------------------
    traders = []
    used_users = set()
    for i in range(N_TRADERS):
        fn = FIRST[i % len(FIRST)]
        ln = LAST[(i * 7 + 3) % len(LAST)]
        key = f"trader_{i:02d}"
        uname = f"{fn.lower()}.{ln.lower()}" if i % 3 else f"{fn.lower()}{i}"
        display = f"{fn} {ln}" if i % 4 else fn.lower() + "." + ln.lower()[:2]
        joined = (NOW - timedelta(days=RNG.randint(30, 900))).date().isoformat()
        traders.append({"key": key, "display": display, "username": uname,
                        "bio": RNG.choice(BIOS), "joined": joined})
    demo_ids = [uid(t["key"]) for t in traders]

    # ---- idempotent cleanup (ALL demo users, by email domain) -------------
    cur.execute("SELECT id FROM auth.users WHERE email LIKE %s", (f"%@{DEMO_DOMAIN}",))
    all_demo_ids = [r["id"] for r in cur.fetchall()] or demo_ids
    cur.execute("DELETE FROM market_activity WHERE user_id = ANY(%s::uuid[])", (all_demo_ids,))
    cur.execute("DELETE FROM positions WHERE user_id = ANY(%s::uuid[])", (all_demo_ids,))
    if touched_market_ids:
        cur.execute("DELETE FROM price_history WHERE market_id = ANY(%s::uuid[])", (touched_market_ids,))

    # ---- ensure auth users + profiles ------------------------------------
    for t in traders:
        u = uid(t["key"])
        cur.execute("SELECT 1 FROM auth.users WHERE id=%s", (u,))
        if not cur.fetchone():
            cur.execute(
                """INSERT INTO auth.users (id, email, raw_user_meta_data, created_at)
                     VALUES (%s,%s,%s::jsonb,%s)""",
                (u, f"{t['key']}@{DEMO_DOMAIN}",
                 psycopg2.extras.Json({"display_name": t["display"], "username": t["username"]}),
                 datetime.fromisoformat(t["joined"]).replace(tzinfo=timezone.utc)),
            )
        cur.execute(
            """UPDATE profiles SET display_name=%s, username=%s, bio=%s, created_at=%s,
                    avatar_url=NULL, profile_view_count=%s WHERE id=%s""",
            (t["display"], t["username"], t["bio"],
             datetime.fromisoformat(t["joined"]).replace(tzinfo=timezone.utc),
             RNG.randint(30, 8000), u),
        )

    cur.execute("SELECT user_id, id FROM wallets WHERE user_id = ANY(%s::uuid[]) AND currency='KES'",
                (demo_ids,))
    wallet = {r["user_id"]: r["id"] for r in cur.fetchall()}

    # aggregate accumulators per trader for profile stats
    agg = {u: {"invested": 0.0, "unreal": 0.0, "realized": 0.0, "markets": set(),
               "closed": 0, "won": 0} for u in demo_ids}

    def add_position(user_id, market_id, option_id, side, shares, entry, cur_price,
                     is_active=True, realized=0.0, payout=0.0):
        cur_value = round(shares * cur_price, 2) if is_active else 0.0
        invested = round(shares * entry, 2)
        unreal = round(cur_value - invested, 2) if is_active else 0.0
        cur.execute(
            """INSERT INTO positions
                 (user_id, market_id, wallet_id, market_option_id, side, shares,
                  total_invested_usd, avg_entry_price, current_value_usd,
                  unrealized_pnl_usd, realized_pnl_usd, total_payout_usd,
                  is_active, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT DO NOTHING""",
            (user_id, market_id, wallet[user_id], option_id, side, shares,
             invested, round(entry, 4), cur_value, unreal, round(realized, 2),
             round(payout, 2), is_active,
             NOW - timedelta(days=RNG.randint(15, 200)), NOW),
        )
        a = agg[user_id]
        a["invested"] += invested
        a["markets"].add(market_id)
        if is_active:
            a["unreal"] += unreal
        else:
            a["realized"] += realized
            a["closed"] += 1
            if payout > 0:
                a["won"] += 1

    def fill_side(market_id, option_id, side, price, top_shares, n):
        holders = RNG.sample(demo_ids, min(n, len(demo_ids)))
        for u, sh in zip(holders, descending_shares(n, top_shares)):
            if sh <= 0:
                continue
            entry = min(0.97, max(0.03, price + RNG.uniform(-0.12, 0.10)))
            add_position(u, market_id, option_id, side, sh, entry, price)

    # ---- binary markets: both columns -------------------------------------
    for slug in BINARY_SLUGS:
        m = markets.get(slug)
        if not m:
            continue
        yp, npx = float(m["yes_price"]), float(m["no_price"])
        top = RNG.uniform(1_500_000, 9_000_000) if slug == "ke-ruto-reelection-2027" else RNG.uniform(200_000, 3_000_000)
        fill_side(m["id"], None, "yes", yp, top * yp * 2, RNG.randint(12, 16))
        fill_side(m["id"], None, "no", npx, top * npx * 2, RNG.randint(12, 16))

    # ---- multi markets: every option gets a Yes/No book -------------------
    for slug in MULTI_SLUGS:
        m = markets.get(slug)
        if not m:
            continue
        for o in options.get(slug, []):
            price = float(o["price"] or 0.5)
            top = 4_000_000 * price
            fill_side(m["id"], o["id"], "yes", price, top, RNG.randint(6, 9))
            fill_side(m["id"], o["id"], "no", 1 - price, top * 0.5, RNG.randint(4, 7))

    # ---- closed positions (Closed tab + biggest win) ----------------------
    for slug in CLOSED_SLUGS:
        m = markets.get(slug)
        if not m:
            continue
        winners = RNG.sample(demo_ids, 10)
        losers = RNG.sample(demo_ids, 8)
        for u in winners:
            sh = RNG.randint(40_000, 800_000)
            entry = RNG.uniform(0.25, 0.7)
            payout = sh * 1.0
            add_position(u, m["id"], None, RNG.choice(["yes", "no"]), sh, entry, 0.0,
                         is_active=False, realized=round(sh * (1 - entry), 2), payout=payout)
        for u in losers:
            sh = RNG.randint(30_000, 500_000)
            entry = RNG.uniform(0.3, 0.75)
            add_position(u, m["id"], None, RNG.choice(["yes", "no"]), sh, entry, 0.0,
                         is_active=False, realized=round(-sh * entry, 2), payout=0.0)

    # ---- profile aggregates (consistent with positions) -------------------
    for u, a in agg.items():
        volume = round(a["invested"] * RNG.uniform(1.6, 4.2), 2)
        pnl = round(a["unreal"] + a["realized"], 2)
        bets = max(len(a["markets"]) * RNG.randint(2, 8), a["closed"] + 1)
        wins = min(bets, a["won"] + RNG.randint(0, bets // 2))
        win_rate = round(wins / bets, 4) if bets else 0
        cur.execute(
            """UPDATE profiles SET total_volume_usd=%s, profit_loss_usd=%s,
                    total_bets=%s, total_wins=%s, win_rate=%s WHERE id=%s""",
            (volume, pnl, bets, wins, win_rate, u),
        )

    # ---- price history ----------------------------------------------------
    def ticks(market_id, option_id, base):
        # Daily ticks anchored to the SAME time each day so that, when
        # trader_pnl_series buckets by hour and sums across a trader's markets,
        # the buckets align and the portfolio curve reads as a smooth trend
        # (not sawtooth noise). Gentle random walk + slight mean-reversion.
        p = base
        anchor = NOW.replace(minute=0, second=0, microsecond=0)
        for d in range(45, -1, -1):
            drift = (base - p) * 0.08  # mild pull back toward the baseline
            p = min(0.96, max(0.04, p + drift + RNG.uniform(-0.018, 0.018)))
            cur.execute(
                """INSERT INTO price_history
                     (market_id, market_option_id, yes_price, no_price, price, volume_usd, recorded_at)
                     VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (market_id, option_id, round(p, 4), round(1 - p, 4), round(p, 4),
                 round(RNG.uniform(10_000, 240_000), 2), anchor - timedelta(days=d)),
            )

    for slug in BINARY_SLUGS:
        m = markets.get(slug)
        if m:
            ticks(m["id"], None, float(m["yes_price"]))
    for slug in MULTI_SLUGS:
        m = markets.get(slug)
        if not m:
            continue
        for o in options.get(slug, []):
            ticks(m["id"], o["id"], float(o["price"] or 0.5))

    # ---- activity feed ----------------------------------------------------
    cur.execute("SELECT DISTINCT user_id, market_id, side FROM positions WHERE user_id = ANY(%s::uuid[]) AND is_active=TRUE",
                (demo_ids,))
    holdings = cur.fetchall()
    for h in holdings:
        for _ in range(RNG.randint(1, 3)):
            cur.execute(
                """INSERT INTO market_activity (market_id, user_id, action, amount_usd, side, price, created_at)
                     VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (h["market_id"], h["user_id"], RNG.choice(["buy", "sell"]),
                 round(RNG.uniform(200, 90_000), 2), h["side"], round(RNG.uniform(0.05, 0.95), 4),
                 NOW - timedelta(days=RNG.randint(0, 40), hours=RNG.randint(0, 23))),
            )

    # ---- market + option aggregates (headers, $Vol, chart footer) ---------
    # Derive believable market stats from the seeded positions so the market
    # header (Total volume / bets / unique traders), the chart "$Vol" footer and
    # the per-option $Vol all read as a live market rather than $0.
    if touched_market_ids:
        cur.execute(
            """WITH agg AS (
                 SELECT p.market_id,
                        SUM(p.total_invested_usd) AS invested,
                        SUM(p.total_invested_usd) FILTER (WHERE p.side='yes') AS yes_inv,
                        SUM(p.total_invested_usd) FILTER (WHERE p.side='no')  AS no_inv,
                        COUNT(*) AS bets,
                        COUNT(DISTINCT p.user_id) AS traders
                 FROM positions p
                 WHERE p.market_id = ANY(%s::uuid[])
                 GROUP BY p.market_id
               )
               UPDATE markets m SET
                 total_volume_usd = ROUND(agg.invested * 2.3, 2),
                 yes_volume_usd   = ROUND(COALESCE(agg.yes_inv,0) * 2.3, 2),
                 no_volume_usd    = ROUND(COALESCE(agg.no_inv,0) * 2.3, 2),
                 volume_24h_usd   = ROUND(agg.invested * 0.12, 2),
                 total_bets       = agg.bets,
                 unique_bettors   = agg.traders,
                 last_trade_at    = NOW()
               FROM agg WHERE m.id = agg.market_id""",
            (touched_market_ids,),
        )
        # per-option volume + invested for the multi-outcome candidate boards
        cur.execute(
            """WITH agg AS (
                 SELECT market_option_id,
                        SUM(total_invested_usd) AS invested,
                        COUNT(*) AS bets
                 FROM positions
                 WHERE market_option_id IS NOT NULL AND market_id = ANY(%s::uuid[])
                 GROUP BY market_option_id
               )
               UPDATE market_options o SET
                 volume_usd = ROUND(agg.invested * 2.1, 2),
                 total_invested_usd = ROUND(agg.invested, 2)
               FROM agg WHERE o.id = agg.market_option_id""",
            (touched_market_ids,),
        )

    conn.commit()

    # ---- verification -----------------------------------------------------
    b = markets["ke-ruto-reelection-2027"]
    cur.execute("SELECT side, count(*) n FROM market_top_holders(%s,NULL,20) GROUP BY side", (b["id"],))
    print("binary board sides:", {r["side"]: r["n"] for r in cur.fetchall()})
    pres = markets["ke-2027-president"]
    ruto = options["ke-2027-president"][0]["id"]
    cur.execute("SELECT side, count(*) n FROM market_top_holders(%s,%s,20) GROUP BY side", (pres["id"], ruto))
    print("president/Ruto option sides:", {r["side"]: r["n"] for r in cur.fetchall()})
    cur.execute("SELECT count(*) n FROM positions WHERE user_id = ANY(%s::uuid[])", (demo_ids,))
    print("total demo positions:", cur.fetchone()["n"])
    cur.execute("SELECT count(*) n FROM price_history"); print("price_history rows:", cur.fetchone()["n"])
    cur.execute("SELECT count(*) n FROM market_activity"); print("activity rows:", cur.fetchone()["n"])
    # a rich profile sample
    cur.execute("""SELECT p.display_name, tp.positions_value, tp.predictions, tp.profit_loss_usd, tp.volume_usd
                   FROM profiles p, LATERAL trader_public_profile(p.id) tp
                   WHERE p.id = ANY(%s::uuid[]) ORDER BY tp.positions_value DESC LIMIT 3""", (demo_ids,))
    for r in cur.fetchall():
        print("top profile:", r["display_name"], "pv=", float(r["positions_value"]), "preds=", r["predictions"])

    cur.close()
    conn.close()
    print("seed complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
