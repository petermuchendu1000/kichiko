#!/usr/bin/env python3
"""
test_deadlock_free.py - concurrent takers must not deadlock (migration 081; bug E3).
COMMITS data: throwaway/CI databases only (refuses non-local hosts).

Before 081 each taker locked its own wallet first, then maker wallets in book
order, so takers on different markets that share wallets deadlocked (40P01):
15-23 per run of this kind of load on a local replica. After 081 all wallet and
profile locks are taken together in id order.

Load: 6 threads x ORDERS_PER_THREAD limit buys (YES and NO, random prices, so
mint fills happen) on 4 markets whose makers share 24 wallets. Passes when:
  D1 no deadlock (40P01) at all
  D2 cash conserved: sum(available + reserved) over the test wallets is
     unchanged (money only moves between them; positions hold the rest as
     shares, and every mint is fully paid by the two buyers)
  D3 no negative balances
Usage: SEED_DB_URL=postgresql://...@localhost:.../postgres python3 test_deadlock_free.py
"""
import os, sys, uuid, json, random, threading
from decimal import Decimal
from urllib.parse import urlparse
import psycopg2

URL = os.environ["SEED_DB_URL"]
if (urlparse(URL).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
    sys.exit("refusing: this test commits data (local/CI databases only)")
THREADS, ORDERS_PER_THREAD, USERS, MARKETS = 6, int(os.environ.get("ORDERS_PER_THREAD", "300")), 24, 4

def conn():
    c = psycopg2.connect(URL, connect_timeout=40); c.autocommit = True; return c

c = conn(); k = c.cursor()
run = uuid.uuid4().hex[:8]
k.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
users = []
for i in range(USERS):
    uid = str(uuid.uuid4())
    k.execute("insert into auth.users(id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)",
              (uid, f"dl-{run}-{i}@example.com", json.dumps({"display_name": f"dl {run} {i}", "country_code": "KE"})))
    k.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',100000,true) "
              "on conflict (user_id,currency) do update set available_balance=100000, reserved_balance=0", (uid,))
    users.append(uid)
books = []
for i in range(MARKETS):
    m, o = str(uuid.uuid4()), str(uuid.uuid4())
    k.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                 pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                 values(%s,%s,'D','D',%s,now()+interval '1 day','D','active','binary','clob','independent',0.01,0.01,now()-interval '1 hour',0)""",
              (m, f"dl-{run}-{i}", users[0]))
    k.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (o, m))
    books.append((m, o))

def cash():
    k.execute("select coalesce(sum(available_balance+reserved_balance),0), count(*) filter (where available_balance<0 or reserved_balance<0) "
              "from wallets where currency='USD' and user_id = any(%s::uuid[])", (users,))
    s, neg = k.fetchone(); return Decimal(s), neg

start, _ = cash()
errors, ok, lock = {}, [0], threading.Lock()

def trader(seed):
    r = random.Random(seed); cc = conn(); kk = cc.cursor()
    for _ in range(ORDERS_PER_THREAD):
        m, o = r.choice(books)
        try:
            kk.execute("select clob_place_order(%s,%s,%s,%s::order_side,'buy'::clob_action,'limit'::order_type,%s,%s,'USD'::currency_code,null,null)",
                       (r.choice(users), m, o, r.choice(['yes', 'no']), r.randint(20, 80), r.randint(1, 20)))
            with lock: ok[0] += 1
        except psycopg2.Error as e:
            with lock: errors[e.pgcode] = errors.get(e.pgcode, 0) + 1
    cc.close()

ts = [threading.Thread(target=trader, args=(i,)) for i in range(THREADS)]
[t.start() for t in ts]; [t.join() for t in ts]

# money moved into positions (shares) is exactly the cash spent on fills; mints are
# funded by both buyers, so cash + the collateral locked in minted shares is constant
k.execute("""select coalesce(sum(shares),0) from positions p join markets m on m.id=p.market_id
             where m.slug like %s and p.side='yes'""", (f"dl-{run}-%",))
minted = Decimal(k.fetchone()[0])     # every YES share came from a mint paying $1 in total
end, neg = cash()
print(f"orders ok={ok[0]} errors={errors}")
print(f"cash start={start} end={end} minted_collateral={minted} end+collateral={end + minted}")
fails = []
if errors.get('40P01'): fails.append(f"D1 deadlocks: {errors['40P01']}")
if abs((end + minted) - start) > Decimal('0.0001'): fails.append(f"D2 cash not conserved: {end + minted - start}")
if neg: fails.append(f"D3 negative wallets: {neg}")
if ok[0] == 0: fails.append("no order placed")
print("\n".join(f"  [FAIL] {f}" for f in fails) or "  [PASS] D1 no deadlocks, D2 cash conserved, D3 no negatives")
print(f"RESULT: {3 - len(fails)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
