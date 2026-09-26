#!/usr/bin/env python3
"""
bench_engine.py - load benchmark for the CLOB engine. LOCAL/THROWAWAY DATABASES
ONLY: it commits users, markets and orders. Never point SEED_DB_URL at production.
Commits data (replica only). Measures client-observed latency of
clob_place_order on a local socket (so it is DB work, not WAN), orders/s,
fills/order, and error codes (40P01 = deadlock).

  setup   : python3 bench_engine.py setup --users 200 --markets 16 --depth 60
  fresh   : python3 bench_engine.py fresh --markets 1 --depth 3000   # new markets, clean book
  run     : python3 bench_engine.py run --markets 1 --clients 8 --seconds 20 --tag X
Results append to $BENCH_DIR/clob_bench_results.jsonl (default /tmp).
"""
import os, sys, time, uuid, random, threading, argparse, json, statistics
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


def conn():
    c = psycopg2.connect(URL); c.autocommit = True; return c

def setup(a):
    c = conn(); k = c.cursor()
    k.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    k.execute("select count(*) from profiles where display_name like 'bench%%'")
    have = k.fetchone()[0]
    for i in range(have, a.users):
        k.execute("insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),%s,%s)",
                  (f"bench{i}@example.com", json.dumps({"display_name": f"bench{i}", "country_code": "KE"})))
    k.execute("""insert into wallets(user_id,currency,available_balance,is_active)
                 select id,'USD',10000000,true from profiles where display_name like 'bench%%'
                 on conflict (user_id,currency) do update set available_balance=10000000, reserved_balance=0""")
    k.execute("select id from profiles where display_name like 'bench%%' order by display_name")
    users = [r[0] for r in k.fetchall()]
    creator = users[0]
    mk = []
    for m in range(a.markets):
        mid = str(uuid.uuid4()); oid = str(uuid.uuid4())
        k.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,
                     resolution_type,pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                     values(%s,%s,%s,'bench',%s,now()+interval '30 days','bench','active','binary','clob','independent',
                            0.01,0.01,now()-interval '1 day',0)""", (mid, f"bench-{mid[:8]}", f"Bench market {m}", creator))
        k.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (oid, mid))
        mk.append((mid, oid))
        # resting depth: bids on both sides away from the middle (no crossing)
        r = random.Random(m)
        for d in range(a.depth):
            u = users[(m * 7 + d) % len(users)]
            side = 'yes' if d % 2 == 0 else 'no'
            px = r.randint(20, 44)                     # yes bids <=44 and no bids <=44 never cross (sum<100)
            k.execute("""select clob_place_order(%s,%s,%s,%s::order_side,'buy'::clob_action,'limit'::order_type,
                         %s,%s,'USD'::currency_code,null,null)""", (u, mid, oid, side, px, r.randint(5, 50)))
        k.execute("update clob_orders set created_at = created_at - interval '1 hour' where market_id=%s", (mid,))
    json.dump({"users": users, "markets": mk}, open(a.state, "w"))
    print(f"setup: users={len(users)} markets={len(mk)} depth/market={a.depth}")

def fresh(a):
    """Cancel every live bench order (bench data only) and create new markets with a fresh book."""
    c = conn(); k = c.cursor()
    k.execute("""update clob_orders o set status='cancelled', reserved_usd=0
                 from markets m where m.id=o.market_id and m.slug like 'bench-%%' and o.status in ('open','partially_filled')""")
    k.execute("update wallets w set reserved_balance=0, available_balance=10000000 from profiles p where p.id=w.user_id and p.display_name like 'bench%%' and w.currency='USD'")
    k.execute("update positions p set reserved_shares=0 from profiles pr where pr.id=p.user_id and pr.display_name like 'bench%%'")
    k.execute("update clob_orders set created_at = created_at - interval '1 hour' where created_at > now() - interval '1 minute'")
    setup(a)

def run(a):
    st = json.load(open(a.state)); users = st["users"]; markets = [tuple(x) for x in st["markets"]][:a.markets]
    stop = threading.Event(); lock = threading.Lock()
    lat = []; errs = {}; nfills = [0]; nok = [0]
    def worker(i):
        r = random.Random(1000 + i); c = conn(); k = c.cursor()
        # each worker owns a disjoint slice of users -> avoids per-user caps skew
        mine = users[i::a.clients] or users
        local_lat = []
        while not stop.is_set():
            mid, oid = r.choice(markets); u = r.choice(mine)
            side = r.choice(['yes', 'no'])
            # 70%: marketable-ish flow around the middle (mint/burn/direct), 30%: passive
            px = r.randint(45, 60) if r.random() < 0.7 else r.randint(20, 44)
            act = 'buy'
            t0 = time.perf_counter()
            try:
                k.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,'limit'::order_type,
                             %s,%s,'USD'::currency_code,null,null)""", (u, mid, oid, side, act, px, r.randint(1, 30)))
                res = k.fetchone()[0]
                dt = time.perf_counter() - t0
                local_lat.append(dt)
                with lock:
                    nok[0] += 1; nfills[0] += len(res.get('fills', []))
            except psycopg2.Error as e:
                with lock: errs[e.pgcode] = errs.get(e.pgcode, 0) + 1
        with lock: lat.extend(local_lat)
        c.close()
    ths = [threading.Thread(target=worker, args=(i,)) for i in range(a.clients)]
    t0 = time.time(); [t.start() for t in ths]; time.sleep(a.seconds); stop.set(); [t.join() for t in ths]
    el = time.time() - t0
    lat.sort()
    def pct(p): return 1000 * lat[min(len(lat) - 1, int(p * len(lat)))] if lat else float('nan')
    out = {"tag": a.tag, "markets": a.markets, "clients": a.clients, "seconds": round(el, 1),
           "orders_ok": nok[0], "orders_per_s": round(nok[0] / el, 1),
           "p50_ms": round(pct(0.50), 2), "p95_ms": round(pct(0.95), 2), "p99_ms": round(pct(0.99), 2),
           "fills_per_order": round(nfills[0] / max(1, nok[0]), 2), "errors": errs,
           "deadlock_pct": round(100 * errs.get('40P01', 0) / max(1, nok[0] + sum(errs.values())), 2)}
    print(json.dumps(out))
    with open(a.out, "a") as f: f.write(json.dumps(out) + "\n")

if __name__ == "__main__":
    p = argparse.ArgumentParser(); p.add_argument("cmd")
    p.add_argument("--users", type=int, default=200); p.add_argument("--markets", type=int, default=16)
    p.add_argument("--depth", type=int, default=60); p.add_argument("--clients", type=int, default=8)
    p.add_argument("--seconds", type=int, default=20); p.add_argument("--tag", default="baseline")
    p.add_argument("--state", default=os.path.join(os.environ.get("BENCH_DIR", "/tmp"), "clob_bench_state.json"))
    p.add_argument("--out", default=os.path.join(os.environ.get("BENCH_DIR", "/tmp"), "clob_bench_results.jsonl"))
    a = p.parse_args()
    {"setup": setup, "fresh": fresh, "run": run}[a.cmd](a)
