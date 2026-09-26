#!/usr/bin/env python3
"""
diff_engine.py - differential test between two engine versions. LOCAL/THROWAWAY
DATABASES ONLY: it commits users, markets and orders. Never point SEED_DB_URL at
production. Used to prove 071 (index-ordered ladder) fill-for-fill identical to 046.
  python3 diff_engine.py run --tag v0 --n 2500 --seed 7   # on current engine
  (apply new engine)
  python3 diff_engine.py run --tag v1 --n 2500 --seed 7
  python3 diff_engine.py compare v0 v1
Each run creates a fresh 2-option market and replays the same seeded,
state-dependent stream (each order its own committed transaction, so
created_at gives real time priority). Records every fill in ladder order,
order outcomes, and final positions / wallet deltas, keyed by stream index.
"""
import os, sys, json, uuid, random, argparse
from decimal import Decimal as D
import psycopg2

URL = os.environ.get("SEED_DB_URL", "postgresql://postgres:localtest@localhost:54322/postgres")

def _refuse_remote(url):
    """These tools COMMIT data. Refuse anything but a local database unless
    CLOB_TOOLS_ALLOW_REMOTE=1 is set explicitly (never for production)."""
    from urllib.parse import urlparse
    host = (urlparse(url).hostname or "").lower()
    if host not in ("localhost", "127.0.0.1", "::1") and os.environ.get("CLOB_TOOLS_ALLOW_REMOTE") != "1":
        sys.exit(f"refusing to run against non-local host {host!r}: this tool commits data")
_refuse_remote(URL)

DIR = os.environ.get("DIFF_DIR", "/tmp")

def conn():
    c = psycopg2.connect(URL); c.autocommit = True; return c

def users(k, n=30):
    k.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    k.execute("select count(*) from profiles where display_name like 'diff%%'")
    for i in range(k.fetchone()[0], n):
        k.execute("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),%s,%s)",
                  (f"diff{i}@example.com", json.dumps({"display_name": f"diff{i:02d}", "country_code": "KE"})))
    k.execute("""insert into wallets(user_id,currency,available_balance,is_active)
                 select id,'USD',1000000,true from profiles where display_name like 'diff%%'
                 on conflict (user_id,currency) do nothing""")
    k.execute("select id from profiles where display_name like 'diff%%' order by display_name")
    return [r[0] for r in k.fetchall()]

def run(a):
    c = conn(); k = c.cursor(); U = users(k)
    # Identical starting state for every run (test data only): retire earlier
    # diff markets' live orders and reset the diff users' USD wallets. Without
    # this, GREATEST(0, reserved - x) clamps fire in one run and not the other
    # and 1e-6 rounding dust makes wallet deltas differ between engine versions.
    k.execute("""update clob_orders o set status='cancelled', reserved_usd=0, created_at = o.created_at - interval '1 hour'
                 from markets m where m.id=o.market_id and m.slug like 'diff-%%'""")
    k.execute("update positions p set reserved_shares=0 from markets m where m.id=p.market_id and m.slug like 'diff-%%'")
    k.execute("update wallets set available_balance=1000000, reserved_balance=0 where currency='USD' and user_id=any(%s::uuid[])", (U,))
    mid = str(uuid.uuid4()); opts = [str(uuid.uuid4()), str(uuid.uuid4())]
    k.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                 pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                 values(%s,%s,'diff','diff',%s,now()+interval '30 days','diff','active','multiple_choice','clob','independent',
                        %s,0.01,now()-interval '1 day',0)""", (mid, 'diff-' + mid[:8], U[0], a.tick))
    for i, o in enumerate(opts):
        k.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,%s,%s,true)", (o, mid, 'AB'[i], i))
    def wal():
        k.execute("select user_id, available_balance+reserved_balance from wallets where currency='USD' and user_id=any(%s::uuid[])", (U,))
        return {str(r[0]): str(r[1]) for r in k.fetchall()}
    w0 = wal()
    r = random.Random(a.seed); oid2seq = {}; log = []
    for s in range(a.n):
        ui = r.randrange(len(U)); u = U[ui]; oi = r.randrange(2); o = opts[oi]
        side = r.choice(['yes', 'no']); roll = r.random()
        k.execute("select coalesce(shares-reserved_shares,0) from positions where user_id=%s and market_id=%s and market_option_id=%s and side=%s::position_side", (u, mid, o, side))
        row = k.fetchone(); have = D(row[0]) if row else D(0)
        k.execute("select id from clob_orders where user_id=%s and market_id=%s and status in ('open','partially_filled') order by created_at", (u, mid))
        mine = [x[0] for x in k.fetchall()]
        if (roll < 0.10 and mine) or len(mine) >= 55:
            victim = mine[r.randrange(len(mine))]
            try:
                k.execute("select clob_cancel_order(%s,%s)", (u, victim)); log.append({"s": s, "op": "cancel", "o": oid2seq.get(str(victim))})
            except psycopg2.Error as e:
                log.append({"s": s, "op": "cancel", "err": e.pgcode})
            continue
        if roll < 0.35 and have >= 1:
            act = 'sell'; size = r.randint(1, int(min(have, 40)))
        else:
            act = 'buy'; size = r.randint(1, 40)
        otype = 'market' if r.random() < 0.15 else 'limit'
        px = None if otype == 'market' else (r.randint(1, 99) if a.tick == 0.01 else round(r.uniform(0.1, 99.9), 1))
        spend = D(r.randint(2, 30)) if (otype == 'market' and act == 'buy') else None
        try:
            k.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,%s::order_type,%s,%s,'USD'::currency_code,%s,null,%s)""",
                      (u, mid, o, side, act, otype, px, size, f"{a.tag}_{s}", spend))
            res = k.fetchone()[0]; oid2seq[str(res['order_id'])] = s
            fills = [[oid2seq.get(str(f['maker_order_id'])), str(f['price_cents']), str(f['size']), f['match_kind']] for f in res.get('fills', [])]
            log.append({"s": s, "op": f"{act}/{side}/{otype}", "opt": oi, "status": res['status'], "filled": str(res['filled_shares']),
                        "rest": str(res['resting_shares']), "fills": fills, "cash": str(res['cash_local'])})
        except psycopg2.Error as e:
            log.append({"s": s, "op": f"{act}/{side}/{otype}", "err": e.pgcode})
    k.execute("""select p.user_id, p.market_option_id, p.side, p.shares, p.reserved_shares, p.total_invested_usd, p.realized_pnl_usd
                 from positions p where p.market_id=%s order by 1,2,3""", (mid,))
    optidx = {o: i for i, o in enumerate(opts)}
    pos = [[str(x[0]), optidx[str(x[1])], x[2], str(x[3]), str(x[4]), str(x[5]), str(x[6])] for x in k.fetchall()]
    w1 = wal(); dw = {u: str(D(w1[u]) - D(w0[u])) for u in w0}
    json.dump({"log": log, "pos": pos, "dwallet": dw}, open(os.path.join(DIR, f"diff_{a.tag}.json"), "w"))
    nf = sum(len(x.get("fills", [])) for x in log); ne = sum(1 for x in log if "err" in x)
    kinds = {}
    for x in log:
        for f in x.get("fills", []): kinds[f[3]] = kinds.get(f[3], 0) + 1
    print(f"{a.tag}: ops={len(log)} fills={nf} kinds={kinds} errors={ne} positions={len(pos)}")

def compare(t1, t2):
    A = json.load(open(os.path.join(DIR, f"diff_{t1}.json"))); B = json.load(open(os.path.join(DIR, f"diff_{t2}.json")))
    bad = 0
    for x, y in zip(A["log"], B["log"]):
        if x != y:
            bad += 1
            if bad <= 5: print("DIFF op", x["s"], "\n  ", x, "\n  ", y)
    if len(A["log"]) != len(B["log"]): bad += 1; print("length differs")
    pa = sorted(map(tuple, A["pos"])); pb = sorted(map(tuple, B["pos"]))
    pos_ok = pa == pb; w_ok = A["dwallet"] == B["dwallet"]
    print(f"ops identical: {len(A['log'])-bad}/{len(A['log'])}  positions identical: {pos_ok}  wallet deltas identical: {w_ok}")
    print("IDENTICAL" if bad == 0 and pos_ok and w_ok else "DIVERGED")
    sys.exit(0 if bad == 0 and pos_ok and w_ok else 1)

if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("cmd"); p.add_argument("args", nargs="*")
    p.add_argument("--tag", default="v0"); p.add_argument("--n", type=int, default=2500)
    p.add_argument("--seed", type=int, default=7); p.add_argument("--tick", type=float, default=0.01)
    a = p.parse_args()
    run(a) if a.cmd == "run" else compare(*a.args)
