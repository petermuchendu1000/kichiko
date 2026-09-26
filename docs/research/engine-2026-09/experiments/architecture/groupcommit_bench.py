#!/usr/bin/env python3
"""Application-level group-commit benchmark (LOCAL THROWAWAY DB ONLY).

Models the write set of an out-of-DB single-writer matcher that applies the
*results* of matching (fills) to Postgres, the system of record:
  per order: insert taker order, update maker order, insert fill,
             4 ledger legs, 2 wallet updates, 2 position upserts, 1 outbox row
  per batch: fenced shard high-water-mark update (epoch + last_seq CAS)
Batch size N = orders per COMMIT. Measures orders/s and per-commit latency.
"""
import os, sys, time, random, statistics, json, threading
import psycopg2

URL = os.environ.get("BENCH_URL", "postgresql://postgres:localtest@127.0.0.1:54399/postgres")
assert "127.0.0.1" in URL or "localhost" in URL, "local only"

DDL = """
drop table if exists b_wallet, b_position, b_order, b_fill, b_ledger, b_shard, b_outbox cascade;
create table b_wallet(user_id int primary key, available bigint not null, reserved bigint not null default 0,
  check (available >= 0 and reserved >= 0)) with (fillfactor=80);
create table b_position(user_id int, option_id int, side smallint, shares bigint not null,
  primary key(user_id, option_id, side)) with (fillfactor=80);
create table b_order(order_id bigint primary key, user_id int not null, option_id int not null, side smallint,
  price int, qty bigint, remaining bigint, status smallint, client_order_id text,
  unique(user_id, client_order_id)) with (fillfactor=80);
create table b_fill(fill_id bigint primary key, shard_id int, shard_seq bigint, taker_order bigint, maker_order bigint,
  price int, qty bigint, created_at timestamptz default now());
create table b_ledger(entry_id bigserial primary key, fill_id bigint not null, leg smallint not null, account int not null,
  amount bigint not null, unique(fill_id, leg));
create table b_shard(shard_id int primary key, epoch bigint not null, last_seq bigint not null);
create table b_outbox(id bigserial primary key, shard_id int, seq bigint, payload jsonb);

create or replace function apply_batch(p_shard int, p_epoch bigint, p_prev_seq bigint,
   p_taker_user int[], p_maker_user int[], p_maker_order bigint[], p_taker_order bigint[],
   p_price int[], p_qty bigint[], p_option int[]) returns bigint language plpgsql as $$
declare n int := cardinality(p_qty); v_new bigint := p_prev_seq + n; ok int;
begin
  -- fencing: only the current epoch holder, continuing exactly from the last seq, may write
  update b_shard set last_seq = v_new where shard_id = p_shard and epoch = p_epoch and last_seq = p_prev_seq;
  get diagnostics ok = row_count;
  if ok <> 1 then raise exception 'fenced or out-of-sequence' using errcode = 'P0901'; end if;

  insert into b_order(order_id,user_id,option_id,side,price,qty,remaining,status,client_order_id)
    select t, u, o, 0, p, q, 0, 2, 'c'||t from unnest(p_taker_order,p_taker_user,p_option,p_price,p_qty) as x(t,u,o,p,q);
  update b_order bo set remaining = bo.remaining - x.q, status = case when bo.remaining - x.q = 0 then 2 else 1 end
    from (select m, sum(q) q from unnest(p_maker_order,p_qty) as y(m,q) group by m) x where bo.order_id = x.m;
  insert into b_fill(fill_id,shard_id,shard_seq,taker_order,maker_order,price,qty)
    select p_prev_seq + i, p_shard, p_prev_seq + i, t, m, p, q
    from unnest(p_taker_order,p_maker_order,p_price,p_qty) with ordinality as x(t,m,p,q,i);
  insert into b_ledger(fill_id,leg,account,amount)
    select p_prev_seq + i, l.leg, case when l.leg in (1,2) then tu else mu end,
           case l.leg when 1 then -p*q when 2 then p*q when 3 then p*q else -p*q end
    from unnest(p_taker_user,p_maker_user,p_price,p_qty) with ordinality as x(tu,mu,p,q,i)
    cross join (values (1::smallint),(2::smallint),(3::smallint),(4::smallint)) l(leg);
  -- wallets: aggregate deltas, update in user_id order (deterministic lock order)
  update b_wallet w set available = w.available + d.delta
    from (select u, sum(delta) delta from (
            select tu u, -p*q delta from unnest(p_taker_user,p_price,p_qty) a(tu,p,q)
            union all select mu, p*q from unnest(p_maker_user,p_price,p_qty) b(mu,p,q)) s
          group by u order by u) d
    where w.user_id = d.u;
  insert into b_position(user_id,option_id,side,shares)
    select u, o, 0, sum(q) from (
      select tu u, o, q from unnest(p_taker_user,p_option,p_qty) a(tu,o,q)
      union all select mu, o, -q from unnest(p_maker_user,p_option,p_qty) b(mu,o,q)) s
    group by u, o order by u, o
    on conflict (user_id,option_id,side) do update set shares = b_position.shares + excluded.shares;
  insert into b_outbox(shard_id, seq, payload) values (p_shard, v_new, jsonb_build_object('n', n, 'last', v_new));
  return v_new;
end $$;
"""

def setup(k, users, makers, shards):
    k.execute(DDL)
    k.execute("insert into b_wallet(user_id,available) select g, 1000000000000 from generate_series(1,%s) g", (users,))
    k.execute("""insert into b_order(order_id,user_id,option_id,side,price,qty,remaining,status,client_order_id)
                 select g, 1 + (g %% %s), 1 + (g %% 64), 1, 50, 1000000000, 1000000000, 0, 'm'||g
                 from generate_series(1,%s) g""", (users, makers))
    for s in range(shards):
        k.execute("insert into b_shard values (%s, 1, %s)", (s, s * 10**12))
    k.execute("vacuum analyze")

def worker(shard, batch, orders, users, makers, sync, res, seed):
    c = psycopg2.connect(URL); c.autocommit = False; k = c.cursor()
    k.execute("set synchronous_commit = %s" % sync); c.commit()
    k.execute("select last_seq from b_shard where shard_id=%s", (shard,)); seq = k.fetchone()[0]; c.commit()
    r = random.Random(seed); taker_id = 10**13 * (shard + 1) + seq
    lat = []; done = 0; t0 = time.perf_counter()
    while done < orders:
        n = min(batch, orders - done)
        tu = [r.randint(1, users) for _ in range(n)]
        mu = [r.randint(1, users) for _ in range(n)]
        mo = [r.randint(1, makers) for _ in range(n)]
        to = list(range(taker_id, taker_id + n)); taker_id += n
        px = [r.randint(1, 999) for _ in range(n)]
        q = [r.randint(1, 100) for _ in range(n)]
        op = [1 + (x % 64) for x in mo]
        s = time.perf_counter()
        k.execute("select apply_batch(%s,1,%s,%s,%s,%s,%s,%s,%s,%s)", (shard, seq, tu, mu, mo, to, px, q, op))
        seq = k.fetchone()[0]
        c.commit()
        lat.append((time.perf_counter() - s) * 1000)
        done += n
    el = time.perf_counter() - t0
    res.append(dict(shard=shard, orders=done, secs=el, lat=lat))
    c.close()

def run(batch, orders, writers, sync, users, makers):
    res = []; th = []
    for w in range(writers):
        t = threading.Thread(target=worker, args=(w, batch, orders, users, makers, sync, res, 1000 * batch + w))
        th.append(t)
    t0 = time.perf_counter()
    for t in th: t.start()
    for t in th: t.join()
    wall = time.perf_counter() - t0
    tot = sum(x["orders"] for x in res)
    lat = sorted(l for x in res for l in x["lat"])
    pct = lambda p: lat[min(len(lat) - 1, int(p * len(lat)))]
    return dict(batch=batch, writers=writers, sync=sync, orders=tot, wall_s=round(wall, 2),
                orders_per_s=round(tot / wall), commits=len(lat),
                commit_ms_p50=round(pct(.5), 3), commit_ms_p99=round(pct(.99), 3),
                per_order_us=round(wall * 1e6 * writers / tot, 1))

if __name__ == "__main__":
    users, makers = 10000, 200000
    c = psycopg2.connect(URL); c.autocommit = True; k = c.cursor()
    out = []
    plan = [(1, 4000, 1, "on"), (1, 4000, 1, "off"), (10, 20000, 1, "on"), (100, 100000, 1, "on"),
            (1000, 200000, 1, "on"), (1000, 200000, 1, "off"),
            (1, 3000, 4, "on"), (100, 50000, 4, "on")]
    if len(sys.argv) > 1: plan = json.loads(sys.argv[1])
    for (b, n, w, sync) in plan:
        setup(k, users, makers, max(4, w))
        k.execute("checkpoint"); k.execute("select wal_records, wal_fpi, wal_bytes, wal_sync from pg_stat_wal"); w0 = k.fetchone()
        r = run(b, n, w, sync, users, makers)
        k.execute("select wal_records, wal_fpi, wal_bytes, wal_sync from pg_stat_wal"); w1 = k.fetchone()
        r.update(wal_bytes_per_order=round((w1[2]-w0[2])/r['orders']), fpi_per_order=round((w1[1]-w0[1])/r['orders'],2),
                 wal_syncs=w1[3]-w0[3])
        print(json.dumps(r), flush=True); out.append(r)
