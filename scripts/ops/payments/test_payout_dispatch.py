#!/usr/bin/env python3
"""
test_payout_dispatch.py - payout dispatch state machine (migration 083; audit 6.6, 6.10).

Part 1 runs in ONE transaction that is ROLLED BACK. Part 2 (claim race) commits
throwaway rows on local/CI databases only, and deletes them afterwards.

  P1  a new withdrawal is queued; one held for review is awaiting_review
  P2  approval queues it (it was never sent before 083: 6.6)
  P3  claim -> dispatching/processing; a second claim gets nothing
  P4  accepted -> sent with the provider reference; a late second report is ignored
  P5  rejected -> refunded (fail_withdrawal) and settled, in one call
  P6  unknown -> kept processing, reserve held, NOT refunded, due for a status check
  P7  a sender that died mid-send is turned into unknown by the sweep, never re-queued
  P8  status-check claims back off (next_check_at moves out, check_count grows)
  P9  completion settles; admin retry after a failure queues a new attempt with
      no stale provider reference
  P10 legacy rows (payout_state NULL) are never claimed automatically
  P11 the reservation invariant (082) holds for the test wallet throughout
  P13 an admin cannot reject (refund) a payout already sent to the provider
      without confirming it was not paid (P0160); unsent ones reject as before.
      Admin reject / complete work at all under an admin JWT (before 083 the
      notification trigger refused them: P0121)
  P14 finance can queue a legacy row explicitly (audited); the worker then sends it
  P12 (committed, local only) 12 concurrent batch claims + 12 single claims on
      the same queued withdrawals: every withdrawal claimed exactly once
Usage: SEED_DB_URL=postgresql://... python3 test_payout_dispatch.py
"""
import os, sys, json, uuid, threading
from decimal import Decimal as D
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

def request(uid, wid, amount, review=False):
    cur.execute("select request_withdrawal(%s,%s,%s,%s,%s,%s,'mpesa'::payment_provider,'+254712345678',%s)",
                (uid, wid, amount, amount * D('0.0077'), D('0.0077'), 0, review))
    return cur.fetchone()[0]['withdrawal_id']

def w(wd):
    cur.execute("select status::text, payout_state, provider_reference, dispatch_attempts, check_count, next_check_at, requires_review from withdrawals where id=%s", (wd,))
    return cur.fetchone()

def bal(wid):
    cur.execute("select available_balance, reserved_balance from wallets where id=%s", (wid,)); a, r = cur.fetchone(); return D(a), D(r)

def drift(wid):
    return one("select count(*) from wallet_reservation_drift() where wallet_id=%s", (wid,))

try:
    uid = one("select id from profiles order by created_at limit 1")
    cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'KES',100000,true)
                   on conflict (user_id,currency) do update set available_balance=100000, reserved_balance=0 returning id""", (uid,))
    wid = cur.fetchone()[0]

    print("P1/P2 queueing:")
    a = request(uid, wid, D('1000'))
    b = request(uid, wid, D('2000'), review=True)
    check("P1 new withdrawal queued", w(a)[1] == 'queued', str(w(a)))
    check("P1 review withdrawal awaiting_review, not claimable", w(b)[1] == 'awaiting_review' and one("select claim_withdrawal_dispatch(%s)", (b,)) is None)
    cur.execute("update withdrawals set requires_review=false where id=%s", (b,))   # what admin_approve_withdrawal does
    check("P2 approval queues it", w(b)[1] == 'queued', str(w(b)))

    print("P3/P4 claim and accept:")
    c1 = one("select claim_withdrawal_dispatch(%s)", (a,))
    c2 = one("select claim_withdrawal_dispatch(%s)", (a,))
    check("P3 first claim wins", c1 is not None and c1['provider'] == 'mpesa' and D(str(c1['net_amount'])) == D('1000') and w(a)[:2] == ('processing', 'dispatching'), str(c1))
    check("P3 second claim gets nothing", c2 is None)
    r = one("select record_withdrawal_dispatch(%s,'accepted','AG_1',null,null)", (a,))
    r2 = one("select record_withdrawal_dispatch(%s,'rejected',null,'late',null)", (a,))
    check("P4 accepted -> sent with reference", r['recorded'] and w(a)[1:3] == ('sent', 'AG_1'), str(w(a)))
    check("P4 a second report is ignored (no refund)", not r2['recorded'] and w(a)[0] == 'processing')

    print("P5 rejected:")
    avail0, res0 = bal(wid)
    one("select claim_withdrawal_dispatch(%s)", (b,))
    r = one("select record_withdrawal_dispatch(%s,'rejected',null,'Bad Request - Invalid PartyB','{}'::jsonb)", (b,))
    avail1, res1 = bal(wid)
    check("P5 refunded and settled in one call", r.get('refunded') and w(b)[:2] == ('failed', 'settled')
          and avail1 - avail0 == D('2000') and res0 - res1 == D('2000'), f"{w(b)} avail +{avail1 - avail0}")

    print("P6 unknown:")
    u = request(uid, wid, D('3000'))
    one("select claim_withdrawal_dispatch(%s)", (u,))
    avail0, res0 = bal(wid)
    one("select record_withdrawal_dispatch(%s,'unknown',null,'TimeoutError',null)", (u,))
    st = w(u)
    check("P6 unknown: processing, reserve held, not refunded", st[:2] == ('processing', 'unknown') and bal(wid) == (avail0, res0), str(st))
    check("P6 never claimable for a re-send", one("select claim_withdrawal_dispatch(%s)", (u,)) is None)
    cur.execute("update withdrawals set next_check_at = now() - interval '1 second' where id=%s", (u,))
    cur.execute("select claim_withdrawals_for_status_check(50)")
    due = [x[0] for x in cur.fetchall()]
    check("P6 due for a status check", any(d['id'] == str(u) for d in due), f"{len(due)} due")

    print("P7 stale dispatch:")
    s = request(uid, wid, D('400'))
    one("select claim_withdrawal_dispatch(%s)", (s,))
    cur.execute("update withdrawals set dispatched_at = now() - interval '11 minutes' where id=%s", (s,))
    cur.execute("select claim_withdrawals_for_status_check(50)")
    cur.fetchall()
    st = w(s)
    check("P7 stale dispatching -> unknown (not queued)", st[1] == 'unknown' and st[0] == 'processing', str(st))
    cur.execute("select count(*) from claim_withdrawals_for_dispatch(100) x where x->>'id' = %s", (str(s),))
    check("P7 the worker never re-sends it", cur.fetchone()[0] == 0)

    print("P8 backoff:")
    n0, t0 = w(u)[4], w(u)[5]
    cur.execute("update withdrawals set next_check_at = now() - interval '1 second' where id=%s", (u,))
    cur.execute("select claim_withdrawals_for_status_check(50)"); cur.fetchall()
    n1, t1 = w(u)[4], w(u)[5]
    cur.execute("select claim_withdrawals_for_status_check(50)")
    again = [x[0]['id'] for x in cur.fetchall()]
    check("P8 check_count grows, next_check_at moves out, not due again at once", n1 == n0 + 1 and t1 > t0 and str(u) not in again, f"{n0}->{n1}")

    print("P9 settle and retry:")
    cur.execute("select complete_withdrawal(%s,'TX1','RCP1','{}'::jsonb)", (a,))
    check("P9 completion settles", w(a)[:2] == ('completed', 'settled'))
    cur.execute("select fail_withdrawal(%s,'provider TF','{}'::jsonb)", (u,))
    cur.execute("update withdrawals set provider_reference='OLD' where id=%s", (u,))
    # what admin_retry_withdrawal does (it needs an admin JWT): re-reserve + processing
    cur.execute("update wallets set available_balance=available_balance-3000, reserved_balance=reserved_balance+3000 where id=%s", (wid,))
    cur.execute("update withdrawals set status='processing', failed_at=null, failure_reason=null where id=%s", (u,))
    st = w(u)
    check("P9 retry queues a new attempt without the stale reference", st[1] == 'queued' and st[2] is None, str(st))
    c = one("select claim_withdrawal_dispatch(%s)", (u,))
    check("P9 the retry is claimable; attempt 2", c is not None and c['dispatch_attempts'] == 2, str(c))

    print("P10 legacy rows:")
    lg = request(uid, wid, D('50'))
    cur.execute("update withdrawals set payout_state=NULL where id=%s", (lg,))
    cur.execute("select count(*) from claim_withdrawals_for_dispatch(100) x where x->>'id' = %s", (str(lg),))
    check("P10 legacy row not claimed by the worker", cur.fetchone()[0] == 0 and one("select claim_withdrawal_dispatch(%s)", (lg,)) is None)
    cur.execute("savepoint q")
    try:
        cur.execute("select admin_queue_withdrawal_dispatch(%s,'checked')", (lg,)); err = None
    except psycopg2.Error as e:
        err = e.pgcode
    cur.execute("rollback to savepoint q")
    check("P10 queueing a legacy row needs finance:withdrawals", err == '42501', f"err={err}")


    print("P13/P14 operator actions (as a finance user):")
    fin = one("select id from profiles order by created_at offset 1 limit 1")
    cur.execute("update profiles set role='finance' where id=%s", (fin,))
    x = request(uid, wid, D('700'))
    one("select claim_withdrawal_dispatch(%s)", (x,))
    one("select record_withdrawal_dispatch(%s,'accepted','AG_X',null,null)", (x,))
    q = request(uid, wid, D('80'))
    cm = request(uid, wid, D('60'))
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(fin),))
    cur.execute("savepoint r")
    try:
        cur.execute("select admin_reject_withdrawal(%s,'customer asked')", (x,)); err = None
    except psycopg2.Error as e:
        err = e.pgcode
    cur.execute("rollback to savepoint r")
    check("P13 rejecting a SENT payout without confirmation is refused (P0160)", err == 'P0160' and w(x)[0] == 'processing', f"err={err}")
    avail0, _ = bal(wid)
    cur.execute("select admin_reject_withdrawal(%s,'provider confirmed not paid',true)", (x,))
    check("P13 with confirmation it is refunded", w(x)[:2] == ('failed', 'settled') and bal(wid)[0] - avail0 == D('700'))
    cur.execute("select admin_reject_withdrawal(%s,'not sent yet')", (q,))
    check("P13 a queued (never sent) payout rejects without confirmation", w(q)[:2] == ('failed', 'settled'))
    cur.execute("select admin_complete_withdrawal(%s,'MANUAL-1','RCPT-1')", (cm,))
    check("P13 an admin can complete a payout by hand (was P0121 for every admin)", w(cm)[:2] == ('completed', 'settled'))
    cur.execute("select admin_queue_withdrawal_dispatch(%s,'checked with M-Pesa: not paid')", (lg,))
    check("P14 finance can queue a legacy row; then it is claimable", w(lg)[1] == 'queued')
    cur.execute("select set_config('request.jwt.claim.sub', '', true)")
    check("P14 ... and the worker claims it", one("select claim_withdrawal_dispatch(%s)", (lg,)) is not None)
    cur.execute("select count(*) from audit_log where entity_id = any(%s::uuid[]) and action in ('withdrawal.reject','withdrawal.queue_dispatch')", ([str(x), str(q), str(lg)],))
    check("P13/P14 operator actions audited", cur.fetchone()[0] == 3)
    cur.execute("select count(*) from notifications where data->>'withdrawal_id' = any(%s)", ([str(x), str(q), str(cm)],))
    check("P13 the user was notified of each", cur.fetchone()[0] == 3)
    check("P11 reservation invariant holds for the wallet", drift(wid) == 0)
except psycopg2.Error as e:
    check("harness part 1 completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback()

# ---- P12: claim race (committed; local/CI only) ------------------------------
if (urlparse(URL).hostname or "") in ("localhost", "127.0.0.1", "::1"):
    print("P12 claim race:")
    conn.autocommit = True
    uid = str(uuid.uuid4())   # a throwaway user: seed wallets are not touched
    cur.execute("insert into auth.users(id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)",
                (uid, f"payout-{uid[:8]}@example.com", json.dumps({"display_name": f"payout {uid[:8]}", "country_code": "KE"})))
    cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'KES',100000,true)
                   on conflict (user_id,currency) do update set available_balance=100000, reserved_balance=0 returning id""", (uid,))
    wid = cur.fetchone()[0]
    ids = [request(uid, wid, D('100')) for _ in range(30)]
    wins, lock = [], threading.Lock()
    def worker(k):
        c = psycopg2.connect(URL); c.autocommit = True; k2 = c.cursor()
        if k % 2:
            k2.execute("select claim_withdrawals_for_dispatch(7)"); got = [r[0]['id'] for r in k2.fetchall()]
        else:
            got = []
            for i in ids:
                k2.execute("select claim_withdrawal_dispatch(%s)", (i,)); r = k2.fetchone()[0]
                if r: got.append(r['id'])
        with lock: wins.extend(got)
        c.close()
    ts = [threading.Thread(target=worker, args=(k,)) for k in range(24)]
    [t.start() for t in ts]; [t.join() for t in ts]
    counts = {i: wins.count(str(i)) for i in ids}
    check("P12 every withdrawal claimed exactly once", all(v == 1 for v in counts.values()),
          f"claims={len(wins)} dup={[i for i, v in counts.items() if v > 1][:3]} missing={[i for i, v in counts.items() if v == 0][:3]}")
    for i in ids:
        cur.execute("select fail_withdrawal(%s,'test cleanup','{}'::jsonb)", (i,))
    cur.execute("delete from notifications where data->>'withdrawal_id' = any(%s)", ([str(i) for i in ids],))
    cur.execute("delete from withdrawals where id = any(%s::uuid[])", ([str(i) for i in ids],))
    cur.execute("delete from transactions where idempotency_key = any(%s)", ([f"withdraw_{i}" for i in ids],))
    check("P12 cleanup left the wallet whole", bal(wid) == (D('100000'), D('0')), str(bal(wid)))
else:
    print("P12 skipped (non-local database)")

conn.close()
print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
