#!/usr/bin/env python3
"""
test_btc_windows.py - the BTC window engine (migration 088; audit 6.13).
Part 1: ONE transaction, ROLLED BACK. Part 2 (opener race) commits on local
databases only and deletes its rows.

  B1 a window whose market an admin cancelled is voided and does not stop the
     others (before 088 resolve_market raised P0002 and aborted every run)
  B2 with only a PRE-close tick the window is skipped, never settled on it
  B3 the settle tick is the first in [close, close + 10 min]; a tick only
     20 minutes later is not used
  B4 (committed, local only) 8 concurrent open_btc_windows calls open one
     window per series, not duplicates
Usage: SEED_DB_URL=postgresql://... python3 test_btc_windows.py
"""
import os, sys, threading
from urllib.parse import urlparse
import psycopg2

URL = os.environ["SEED_DB_URL"]
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()
def one(sql, args=()):
    cur.execute(sql, args); r = cur.fetchone(); return r[0] if r and len(r) == 1 else r

def window(series, closed_ago_min, ref=60000):
    """a due window (closed `closed_ago_min` minutes ago) with its own binary market"""
    mid = one("""insert into markets(slug,title,description,category,resolution_type,creator_id,status,opens_at,closes_at,resolves_at,
                 resolution_criteria,yes_price,no_price)
                 values(%s,'BTC','BTC','crypto','binary',(select id from profiles order by created_at limit 1),'active',
                        now()-interval '2 hours', now()-%s::interval, now()-%s::interval,'BTC',0.5,0.5) returning id""",
              (f"t-{series}-{os.urandom(4).hex()}", f"{closed_ago_min} minutes", f"{closed_ago_min} minutes"))
    return mid, one("""insert into btc_windows(market_id,series_key,window_seconds,reference_price,opens_at,closes_at,resolves_at,status)
                       values(%s,%s,300,%s,now()-interval '2 hours',now()-%s::interval,now()-%s::interval,'open') returning id""",
                    (mid, series, ref, f"{closed_ago_min} minutes", f"{closed_ago_min} minutes"))

def tick(price, at_sql):
    cur.execute(f"insert into btc_price_ticks(price,source,observed_at) values(%s,'test',{at_sql})", (price,))

try:
    cur.execute("update btc_windows set status='void' where status='open'")   # isolate (rolled back)
    cur.execute("delete from btc_price_ticks where true")                      # isolate (rolled back)
    # B1: a cancelled market's window + a healthy one
    m_bad, w_bad = window('btc-up-down-5m', 30)
    cur.execute("update markets set status='cancelled' where id=%s", (m_bad,))
    m_ok, w_ok = window('btc-up-down-15m', 30, ref=60000)
    close_ok = one("select closes_at from btc_windows where id=%s", (w_ok,))
    tick(61000, f"'{close_ok.isoformat()}'::timestamptz + interval '30 seconds'")
    cur.execute("savepoint b1")
    try:
        cur.execute("select resolve_btc_windows(null)"); r = cur.fetchone()[0]; err = None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint b1"); r, err = None, e.pgcode
    check("B1 the run survives a window whose market was cancelled", err is None and r and r.get('resolved', 0) >= 1, f"err={err} r={r}")
    check("B1 that window is voided, the healthy one resolved YES at the post-close tick",
          err is None and one("select status from btc_windows where id=%s", (w_bad,)) == 'void'
          and one("select status||':'||resolved_outcome||':'||settle_price::int from btc_windows where id=%s", (w_ok,)) == 'resolved:yes:61000')

    # B2: only a tick BEFORE the close exists
    cur.execute("delete from btc_price_ticks where true")
    m2, w2 = window('btc-up-down-30m', 5, ref=60000)
    close2 = one("select closes_at from btc_windows where id=%s", (w2,))
    tick(99999, f"'{close2.isoformat()}'::timestamptz - interval '1 minute'")
    cur.execute("savepoint b2")
    try:
        cur.execute("select resolve_btc_windows(null)"); cur.fetchone(); err = None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint b2"); err = e.pgcode
    check("B2 a pre-close tick is never the settle price", one("select status from btc_windows where id=%s", (w2,)) == 'open'
          and one("select status::text from markets where id=%s", (m2,)) == 'active', f"err={err}")

    # B3: only a tick 20 minutes after the close -> not used; then a 5-minute one -> used
    tick(50000, f"'{close2.isoformat()}'::timestamptz + interval '20 minutes'")
    cur.execute("select resolve_btc_windows(null)"); cur.fetchone()
    check("B3 a tick 20 minutes after the close is not used", one("select status from btc_windows where id=%s", (w2,)) == 'open')
    tick(58000, f"'{close2.isoformat()}'::timestamptz + interval '5 minutes'")
    cur.execute("select resolve_btc_windows(null)"); cur.fetchone()
    check("B3 the first tick within 10 minutes settles it (NO: 58000 < 60000)",
          one("select status||':'||resolved_outcome from btc_windows where id=%s", (w2,)) == 'resolved:no')
except psycopg2.Error as e:
    check("harness part 1 completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback()

if (urlparse(URL).hostname or "") in ("localhost", "127.0.0.1", "::1"):
    print("B4 concurrent openers:")
    conn.autocommit = True
    cur.execute("select count(*) from btc_windows where status='open' and closes_at > now()")
    if cur.fetchone()[0]:
        print("  [SKIP] live windows already exist on this database")
    else:
        cur.execute("insert into btc_price_ticks(price,source,observed_at) values(60000,'test-b4',now()) returning id")
        tid = cur.fetchone()[0]
        errs = []
        def opener():
            c = psycopg2.connect(URL); c.autocommit = True; k = c.cursor()
            try: k.execute("select open_btc_windows(null)")
            except psycopg2.Error as e: errs.append(e.pgcode)
            c.close()
        ts = [threading.Thread(target=opener) for _ in range(8)]
        [t.start() for t in ts]; [t.join() for t in ts]
        cur.execute("""select series_key, count(*) from btc_windows where status='open' and closes_at > now()
                       group by 1 having count(*) > 1""")
        dups = cur.fetchall()
        cur.execute("select count(distinct series_key) from btc_windows where status='open' and closes_at > now()")
        n = cur.fetchone()[0]
        check("B4 one window per series, no duplicates", not dups and n >= 1 and not errs, f"series={n} dups={dups} errors={errs}")
        cur.execute("select market_id from btc_windows where status='open' and closes_at > now()")
        mids = [r[0] for r in cur.fetchall()]
        cur.execute("delete from btc_windows where market_id = any(%s::uuid[])", (mids,))
        cur.execute("delete from markets where id = any(%s::uuid[])", (mids,))
        cur.execute("delete from btc_price_ticks where id=%s", (tid,))
else:
    print("B4 skipped (non-local database)")

conn.close()
print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
