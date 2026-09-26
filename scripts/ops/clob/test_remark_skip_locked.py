#!/usr/bin/env python3
"""
test_remark_skip_locked.py - the per-minute position re-mark never waits on a
trade (migration 096). COMMITS one value change: local/CI databases only.

BUG: remark_positions() (063, pg_cron every minute) updated every active
position whose value changed, in no particular order, while the matcher
locks positions in book order: the two deadlocked (40P01, seen in the
replica's server log during test_deadlock_free.py), aborting either the
re-mark or a user's order.

  R1 with a position held by another transaction, the re-mark returns at
     once and leaves that position for the next run
  R2 once the lock is gone, the next run re-marks it
Usage: SEED_DB_URL=postgresql://...@localhost:.../postgres python3 test_remark_skip_locked.py
"""
import os, sys, uuid
from urllib.parse import urlparse
import psycopg2

URL = os.environ["SEED_DB_URL"]
if (urlparse(URL).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
    sys.exit("refusing: this test commits data (local/CI databases only)")
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

setup = psycopg2.connect(URL); setup.autocommit = True; k = setup.cursor()
# own fixture: a user, wallet, market, option (priced) and an active position with a stale mark
run = uuid.uuid4().hex[:8]
uid, mid, oid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
k.execute("insert into auth.users(id, email) values (%s, %s)", (uid, f"rm-{run}@example.com"))
k.execute("insert into profiles(id, username, display_name) values(%s,%s,%s) on conflict (id) do nothing", (uid, f"rm{run}", f"rm {run}"))
k.execute("insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',0,true) on conflict (user_id,currency) do nothing", (uid,))
k.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
             pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
             values(%s,%s,'RM','RM',%s,now()+interval '9 days','RM','active','binary','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
          (mid, f"rm-{run}", uid))
k.execute("insert into market_options(id,market_id,label,display_order,is_active,price,yes_price,no_price) values(%s,%s,'A',0,true,0.5,0.5,0.5)", (oid, mid))
k.execute("""insert into positions(user_id,market_id,wallet_id,market_option_id,side,shares,total_invested_usd,avg_entry_price,current_value_usd,is_active)
             values(%s,%s,(select id from wallets where user_id=%s and currency='USD'),%s,'yes',10,4,0.4,-1,true) returning id""",
          (uid, mid, uid, oid))
pid = k.fetchone()[0]   # stale mark (-1): the re-mark must fix it (to 10 x 0.5 = 5)

holder = psycopg2.connect(URL); hc = holder.cursor()
hc.execute("select 1 from positions where id=%s for no key update", (pid,))     # as a trade holds it
cron = psycopg2.connect(URL); cc = cron.cursor()
try:
    cc.execute("set statement_timeout = '5s'")
    cc.execute("select remark_positions(null)"); cc.fetchone(); cron.commit(); err = None
except psycopg2.Error as e:
    cron.rollback(); err = e.pgcode
k.execute("select current_value_usd from positions where id=%s", (pid,))
still = float(k.fetchone()[0])
check("R1 the re-mark does not wait on a held position, and skips it", err is None and still == -1, f"err={err} value={still}")
holder.rollback(); holder.close()
cc.execute("set statement_timeout = 0"); cc.execute("select remark_positions(null)"); cc.fetchone(); cron.commit()
k.execute("select current_value_usd from positions where id=%s", (pid,))
check("R2 the next run re-marks it (10 shares x 0.50 = 5.00)", float(k.fetchone()[0]) == 5.0)
cron.close(); setup.close()
print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
