#!/usr/bin/env python3
"""Hot-path probe for clob_place_order on the PRIVATE throwaway container k13 (port 54339).
Never point at production or at kdb/kdb2. Commits bench data into k13 only."""
import os, sys, json, time, random, threading, argparse, statistics
import psycopg2

URL = os.environ.get("HP_URL", "postgresql://supabase_admin:localtest@localhost:54339/postgres")
assert ":54339/" in URL, "hp.py only runs against the private k13 container"
ST = json.load(open(os.path.join(os.environ["BENCH_DIR"], "clob_bench_state.json")))
USERS = ST["users"]; MARKETS = [tuple(x) for x in ST["markets"]]
SQL = """select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,'limit'::order_type,
         %s,%s,'USD'::currency_code,null,null)"""
BATCH_SQL = None

def conn(gucs):
    c = psycopg2.connect(URL); c.autocommit = True
    k = c.cursor()
    for g, v in gucs.items():
        k.execute(f"set {g} = %s", (v,))
    return c

def snap(k):
    k.execute("select wal_records, wal_fpi, wal_bytes::bigint, wal_write, wal_sync, wal_sync_time, wal_write_time, wal_buffers_full from pg_stat_wal")
    w = k.fetchone()
    k.execute("select xact_commit, blks_hit, blks_read from pg_stat_database where datname=current_database()")
    d = k.fetchone()
    k.execute("""select relname, n_tup_ins, n_tup_upd, n_tup_hot_upd from pg_stat_user_tables
                 where schemaname='public' and relname in ('clob_orders','clob_fills','positions','wallets','transactions','markets','market_options','price_history','market_activity','profiles')""")
    t = {r[0]: r[1:] for r in k.fetchall()}
    return w, d, t

def gen(r, mine, nmk, sells):
    mid, oid = r.choice(MARKETS[:nmk]); u = r.choice(mine)
    side = r.choice(['yes', 'no'])
    px = r.randint(45, 60) if r.random() < 0.7 else r.randint(20, 44)
    return (u, mid, oid, side, 'buy', px, r.randint(1, 30))

def run(a):
    gucs = json.loads(a.gucs) if a.gucs else {}
    c0 = conn({}); k0 = c0.cursor()
    k0.execute("select pg_stat_force_next_flush()")
    time.sleep(0.6)
    if a.checkpoint:
        k0.execute("checkpoint")
    s0 = snap(k0)
    stop = threading.Event(); lock = threading.Lock(); lat = []; nok = [0]; nf = [0]; errs = {}
    def worker(i):
        r = random.Random(a.seed + i); c = conn(gucs); k = c.cursor()
        mine = USERS[i::a.clients]
        loc = []
        while not stop.is_set():
            if a.batch > 1:
                ops = [gen(r, mine, a.markets, False) for _ in range(a.batch)]
                t0 = time.perf_counter()
                try:
                    k.execute("begin")
                    for op in ops:
                        k.execute(SQL, op); k.fetchone()
                    k.execute("commit")
                    loc.append(time.perf_counter() - t0)
                    with lock: nok[0] += a.batch
                except psycopg2.Error as e:
                    k.execute("rollback")
                    with lock: errs[e.pgcode] = errs.get(e.pgcode, 0) + 1
                continue
            op = gen(r, mine, a.markets, False)
            t0 = time.perf_counter()
            try:
                k.execute(SQL, op); res = k.fetchone()[0]
                loc.append(time.perf_counter() - t0)
                with lock:
                    nok[0] += 1; nf[0] += len(res.get('fills', []))
            except psycopg2.Error as e:
                with lock: errs[e.pgcode] = errs.get(e.pgcode, 0) + 1
        with lock: lat.extend(loc)
        k.execute("select pg_stat_force_next_flush()")
        c.close()
    ths = [threading.Thread(target=worker, args=(i,)) for i in range(a.clients)]
    t0 = time.time(); [t.start() for t in ths]; time.sleep(a.seconds); stop.set(); [t.join() for t in ths]
    el = time.time() - t0
    time.sleep(0.8)
    s1 = snap(k0)
    lat.sort()
    pc = lambda p: round(1000 * lat[min(len(lat)-1, int(p*len(lat)))], 2) if lat else None
    n = max(1, nok[0])
    w0, w1 = s0[0], s1[0]
    out = {"tag": a.tag, "clients": a.clients, "markets": a.markets, "batch": a.batch, "gucs": gucs,
           "orders": nok[0], "orders_per_s": round(nok[0]/el, 1), "p50_ms": pc(.5), "p95_ms": pc(.95), "p99_ms": pc(.99),
           "fills_per_order": round(nf[0]/n, 2), "errors": errs,
           "wal_records_per_order": round((w1[0]-w0[0])/n, 1), "wal_fpi_per_order": round((w1[1]-w0[1])/n, 2),
           "wal_bytes_per_order": round((w1[2]-w0[2])/n), "wal_syncs": w1[4]-w0[4],
           "orders_per_sync": round(n/max(1, w1[4]-w0[4]), 2),
           "avg_sync_us": round(1000*(w1[5]-w0[5])/max(1, w1[4]-w0[4]), 1),
           "commits": s1[1][0]-s0[1][0],
           "hot": {t: {"ins": s1[2][t][0]-s0[2][t][0], "upd": s1[2][t][1]-s0[2][t][1], "hot": s1[2][t][2]-s0[2][t][2]} for t in s1[2]}}
    print(json.dumps(out))
    with open(os.path.join(os.environ["BENCH_DIR"], "hp_results.jsonl"), "a") as f: f.write(json.dumps(out) + "\n")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--clients", type=int, default=1); p.add_argument("--markets", type=int, default=1)
    p.add_argument("--seconds", type=int, default=15); p.add_argument("--batch", type=int, default=1)
    p.add_argument("--gucs", default=""); p.add_argument("--tag", default="x"); p.add_argument("--seed", type=int, default=7)
    p.add_argument("--checkpoint", action="store_true")
    run(p.parse_args())
