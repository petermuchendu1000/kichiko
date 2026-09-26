#!/usr/bin/env python3
"""
test_delivery_lease.py - notification deliveries do not stick in 'sending'
(migration 091; audit 6.27). ONE transaction, ROLLED BACK.
  N1 a row leased > 10 minutes ago is claimed again (attempt 2)
  N2 a row leased > 10 minutes ago with no attempts left becomes 'failed'
  N3 a row leased 1 minute ago (a live worker) is left alone
Usage: SEED_DB_URL=postgresql://... python3 test_delivery_lease.py
"""
import os, sys
import psycopg2

conn = psycopg2.connect(os.environ["SEED_DB_URL"], connect_timeout=40); cur = conn.cursor()
fails = []
def check(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")
    if not ok: fails.append(name)
try:
    cur.execute("select id from profiles order by created_at limit 1"); uid = cur.fetchone()[0]
    cur.execute("insert into notifications(user_id,type,title,body) values(%s,'system_announcement','t','b') returning id", (uid,))
    nid = cur.fetchone()[0]
    cur.execute("delete from notification_deliveries where notification_id=%s", (nid,))
    cur.execute("""insert into notification_deliveries(notification_id,user_id,channel,destination,status,attempts,max_attempts,next_attempt_at,updated_at)
                   values (%s,%s,'email','a@b.c','sending',1,5,now()-interval '1 hour',now()-interval '20 minutes'),
                          (%s,%s,'sms','+254700000000','sending',5,5,now()-interval '1 hour',now()-interval '20 minutes'),
                          (%s,%s,'push','device-1','sending',1,5,now()-interval '1 hour',now()-interval '1 minute')""",
                (nid, uid, nid, uid, nid, uid))
    cur.execute("select channel from claim_notification_deliveries(500) where notification_id=%s", (nid,))
    claimed = {r[0] for r in cur.fetchall()}
    cur.execute("select channel, status, attempts from notification_deliveries where notification_id=%s", (nid,))
    st = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
    check("N1 stale lease re-claimed", 'email' in claimed and st['email'] == ('sending', 2), str(st['email']))
    check("N2 stale lease without attempts left -> failed", st['sms'][0] == 'failed' and 'sms' not in claimed, str(st['sms']))
    check("N3 a live lease is left alone", 'push' not in claimed and st['push'] == ('sending', 1), str(st['push']))
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()
print(f"\nRESULT: {3 - len(fails)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
