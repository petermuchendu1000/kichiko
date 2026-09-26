#!/usr/bin/env python3
"""
sql_run.py --seed S --n N --tick 0.01|0.001 --out DIR

Runs one seeded, state-dependent random order stream against the SQL engine on
the LOCAL replica kdb2 (port 54323 only) and records
  DIR/stream_<seed>.json  : exact op inputs + starting state (input for the twin)
  DIR/sql_<seed>.json     : per-op results + final orders/positions/wallets

Each op is its own committed transaction (autocommit). Determinism controls,
all test-environment only, none touching the engine functions:
  * pg_cron jobs clob_expire_orders / remark_positions are paused for the run
    (restored afterwards): they would expire orders / rewrite current_value_usd
    at wall-clock-dependent moments.
  * after each placement the new order's created_at is set to
    2000-01-01 + s ms. This keeps strict placement order (the only thing
    created_at is used for in the ladder) and makes the 046 "100 placements /
    10 s" rate limit vacuous, which would otherwise fire depending on speed.
  * expires_at is either NULL, 2001-01-01 + s ms (already expired) or 2099.
"""
import os, sys, json, uuid, random, argparse, time, datetime as dt
from decimal import Decimal as D
import psycopg2

URL = "postgresql://postgres:localtest@localhost:54323/postgres"
assert ":54323/" in URL and "localhost" in URL

EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
BASE_CREATED = dt.datetime(2000, 1, 1, tzinfo=dt.timezone.utc)
PAST = dt.datetime(2001, 1, 1, tzinfo=dt.timezone.utc)
FUTURE = dt.datetime(2099, 1, 1, tzinfo=dt.timezone.utc)

def us(t):
    return int((t - EPOCH) / dt.timedelta(microseconds=1))

# user i: (currency, starting available balance)
USERS = [("USD", "20000.000000"), ("USD", "20000.000000"), ("USD", "20000.000000"),
         ("USD", "80.000000"), ("KES", "2500000.000000"), ("KES", "15000.000000")]

def jloads(t):
    return json.loads(t, parse_float=D, parse_int=D)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, required=True)
    ap.add_argument("--n", type=int, default=2000)
    ap.add_argument("--tick", default="0.01")
    ap.add_argument("--min", default="0.50")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cancel", type=float, default=0.10, help="P(cancel own order)")
    ap.add_argument("--capcancel", type=float, default=0.7, help="P(cancel when >=58 open)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    c = psycopg2.connect(URL); c.autocommit = True; k = c.cursor()

    k.execute("select jobid from cron.job where active and command ilike any(array['%clob_expire_orders%','%remark_positions%'])")
    paused = [r[0] for r in k.fetchall()]
    for j in paused:
        k.execute("select cron.alter_job(%s, active := false)", (j,))
    try:
        run(a, k)
    finally:
        for j in paused:
            k.execute("select cron.alter_job(%s, active := true)", (j,))

def run(a, k):
    k.execute("select id from profiles where display_name like 'CLOB CI %%' order by display_name")
    U = [str(r[0]) for r in k.fetchall()]
    assert len(U) == 6, U
    rates = {}
    for cur in ("USD", "KES"):
        k.execute("select rate from exchange_rates where from_currency=%s and to_currency='USD'", (cur,))
        rates[cur] = str(k.fetchone()[0])
    # identical starting state (test data only)
    k.execute("update clob_orders set status='cancelled', reserved_usd=0, reserved_local=0 where status in ('open','partially_filled')")
    for i, u in enumerate(U):
        cur, bal = USERS[i]
        k.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,%s,0,true) on conflict (user_id,currency) do nothing", (u, cur))
        k.execute("update wallets set available_balance=%s, reserved_balance=0 where user_id=%s and currency=%s", (bal, u, cur))
    mid = str(uuid.uuid4()); opts = [str(uuid.uuid4()), str(uuid.uuid4())]
    k.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                 pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                 values(%s,%s,'twin','twin',%s,now()+interval '30 days','twin','active','multiple_choice','clob','independent',
                        %s,%s,now()-interval '1 day',0)""", (mid, 'twin-' + mid[:8], U[0], a.tick, a.min))
    for i, o in enumerate(opts):
        k.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,%s,%s,true)", (o, mid, 'AB'[i], i))
    k.execute("select tick_size::text, min_order_size::text from markets where id=%s", (mid,))
    tick_s, min_s = k.fetchone()

    r = random.Random(a.seed)
    mids = [D(r.randint(20, 80)), D(r.randint(20, 80))]
    oid2seq, seq2oid, owner = {}, {}, {}
    ops, results = [], []
    now_us = us(dt.datetime.now(dt.timezone.utc))
    t0 = time.time()

    def fmt_px(x):
        """limit price in various lattice-(in)compatible spellings"""
        q = r.random()
        if q < 0.02:
            return r.choice(["-3", "0", "0.04", "99.96", "100", "150.25", "999.94", "999.96", "1500"])
        if q < 0.60:
            return str(int(x.quantize(D(1))))
        if q < 0.85:
            return str(x.quantize(D("0.1")))
        return str(x.quantize(D("0.01")))

    def fmt_size(maxv=None):
        q = r.random()
        if maxv is not None:
            v = maxv * D(r.randint(1, 100)) / 100
            if q < 0.05:
                return str(maxv + D("0.000001"))       # over-sell -> P0113
            if q < 0.25:
                return str(maxv)                       # exactly all
            if q < 0.35:
                return str(v.quantize(D("0.00000001")))   # >6 decimals
            return str(v.quantize(D("0.000001")))
        if q < 0.55:
            return str(r.randint(1, 40))
        if q < 0.85:
            return str((D(r.randint(1, 40_000_000)) / D(1_000_000)).normalize())
        if q < 0.93:
            return str(D(r.randint(1, 4_000_000_000)) / D(100_000_000))  # 8 decimals
        if q < 0.95:
            return r.choice(["0.0000004", "0.0000005", "0.00000049", "0.000001"])
        return str(r.randint(100, 600))

    for s in range(a.n):
        ui = r.randrange(6); u = U[ui]; oi = r.randrange(2); o = opts[oi]
        side = r.choice(["yes", "no"]); roll = r.random()
        mids[oi] = min(D(95), max(D(5), mids[oi] + D(r.randint(-2, 2))))
        k.execute("select shares-reserved_shares from positions where user_id=%s and market_id=%s and market_option_id=%s and side=%s::position_side", (u, mid, o, side))
        row = k.fetchone(); have = D(row[0]) if row else None
        k.execute("select id from clob_orders where user_id=%s and market_id=%s and status in ('open','partially_filled') order by created_at", (u, mid))
        mine = [str(x[0]) for x in k.fetchall()]
        if roll < 0.02:
            op = {"k": "expire"}
            k.execute("select clob_expire_orders()")
            res = {"s": s, "expired": int(k.fetchone()[0])}
            ops.append(op); results.append(res); continue
        if (roll < 0.02 + a.cancel and mine) or (len(mine) >= 58 and r.random() < a.capcancel):
            victim = mine[r.randrange(len(mine))]
            op = {"k": "cancel", "u": ui, "ref": oid2seq[victim]}
        elif 0.12 <= roll < 0.135:
            q = r.random()
            if q < 0.3 or not seq2oid:
                victim = str(uuid.uuid4()); ref = -1
            else:
                ref = r.choice(list(seq2oid)); victim = seq2oid[ref]
            op = {"k": "cancel", "u": ui, "ref": ref}
        else:
            victim = None
        if victim is not None:
            try:
                k.execute("select clob_cancel_order(%s,%s)::text", (u, victim))
                j = jloads(k.fetchone()[0])
                res = {"s": s, "released_shares": str(j["released_shares"]), "released_local": str(j["released_local"])}
            except psycopg2.Error as e:
                res = {"s": s, "err": e.pgcode}
            ops.append(op); results.append(res); continue

        if roll < 0.45 and have is not None and have > 0:
            act = "sell"; size = fmt_size(have)
        elif roll < 0.47:
            act = "sell"; size = fmt_size()      # often no position -> P0113
        else:
            act = "buy"; size = fmt_size()
        otype = "market" if r.random() < 0.15 else "limit"
        yes_mid = mids[oi]
        if otype == "limit":
            base = yes_mid if side == "yes" else 100 - yes_mid
            # buyers bid a bit below mid, sellers ask a bit above; wide noise so
            # plenty of orders cross
            skew = D(-2) if act == "buy" else D(2)
            x = base + skew + D(r.randint(-900, 900)) / 100
            price = fmt_px(x) if r.random() > 0.005 else None     # None -> P0104
        else:
            price = None if r.random() > 0.05 else fmt_px(yes_mid)  # market ignores price
        spend = None
        if act == "buy" and ((otype == "market" and r.random() < 0.7) or (otype == "limit" and r.random() < 0.1)):
            spend = str(D(r.randint(10, 4000)) / 100) if r.random() < 0.8 else str(D(r.randint(1, 400000)) / 10000)
        q = r.random()
        exp = PAST + dt.timedelta(milliseconds=s) if q < 0.06 else (FUTURE if q < 0.10 else None)
        op = {"k": "place", "u": ui, "opt": oi, "side": side, "act": act, "type": otype, "price": price,
              "size": size, "spend": spend, "exp_us": us(exp) if exp else None}
        cur = USERS[ui][0]
        try:
            k.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,%s::order_type,
                         %s::numeric,%s::numeric,%s::currency_code,NULL,%s::timestamptz,%s::numeric)::text""",
                      (u, mid, o, side, act, otype, price, size, cur, exp, spend))
            j = jloads(k.fetchone()[0])
            oid = str(j["order_id"]); oid2seq[oid] = s; seq2oid[s] = oid
            k.execute("update clob_orders set created_at=%s where id=%s", (BASE_CREATED + dt.timedelta(milliseconds=s), oid))
            fills = [[oid2seq[str(f["maker_order_id"])], str(f["price_cents"]), str(f["size"]), f["match_kind"]] for f in j["fills"]]
            res = {"s": s, "status": j["status"], "filled": str(j["filled_shares"]), "rest": str(j["resting_shares"]),
                   "cash": str(j["cash_local"]), "fills": fills}
        except psycopg2.Error as e:
            res = {"s": s, "err": e.pgcode}
        ops.append(op); results.append(res)
    elapsed = time.time() - t0

    # final state
    orders = {}
    for s, oid in seq2oid.items():
        k.execute("select status::text, filled::text, reserved_usd::text, reserved_local::text from clob_orders where id=%s", (oid,))
        orders[str(s)] = list(k.fetchone())
    uidx = {u: i for i, u in enumerate(U)}; oidx = {o: i for i, o in enumerate(opts)}
    k.execute("""select user_id, market_option_id, side::text, shares::text, reserved_shares::text, total_invested_usd::text,
                        avg_entry_price::text, current_value_usd::text, realized_pnl_usd::text, total_payout_usd::text, is_active
                 from positions where market_id=%s""", (mid,))
    positions = [[uidx[str(x[0])], oidx[str(x[1])]] + list(x[2:]) for x in k.fetchall()]
    wallets = []
    for i, u in enumerate(U):
        k.execute("select available_balance::text, reserved_balance::text from wallets where user_id=%s and currency=%s", (u, USERS[i][0]))
        wallets.append([i] + list(k.fetchone()))
    stream = {"tick_size": tick_s, "min_order_size": min_s, "n_options": 2, "now_us": now_us,
              "users": [{"rate": rates[c], "available": b} for c, b in USERS], "ops": ops,
              "meta": {"seed": a.seed, "market_id": mid, "sql_seconds": round(elapsed, 2)}}
    json.dump(stream, open(os.path.join(a.out, f"stream_{a.seed}.json"), "w"))
    json.dump({"results": results, "orders": orders, "positions": positions, "wallets": wallets},
              open(os.path.join(a.out, f"sql_{a.seed}.json"), "w"))
    nf = sum(len(x.get("fills", [])) for x in results)
    print(f"seed {a.seed}: ops={len(ops)} fills={nf} sql_seconds={elapsed:.1f}")

if __name__ == "__main__":
    main()
