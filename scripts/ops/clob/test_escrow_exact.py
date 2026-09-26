#!/usr/bin/env python3
"""
test_escrow_exact.py - buy-order escrow is exact in the wallet's currency (migration 082;
bug register E7, R2). Runs in ONE transaction that is ROLLED BACK; nothing persists.

Before 082 an order's escrow was stored only in USD (reserved_usd). The wallet
reserved ROUND(reserved_usd / rate, 6) when the order rested, but each fill
released its own ROUND(ROUND(fill * price / 100, 8) / rate, 6) and cancel/expiry
released ROUND(remaining reserved_usd / rate, 6), all behind GREATEST(0, ...)
clamps. The pieces do not add up to what was reserved, so:
  * dust stays reserved after an order fills completely (E7), or a release is
    silently clamped (R2);
  * cancel/expiry credit available with the full amount even when the wallet's
    reserved balance is short of it, i.e. they create money.
After 082 each order carries reserved_local (its escrow in the wallet's
currency); fills release a pro-rata share and the final fill whatever remains,
cancel/expiry release exactly what remains; no clamps.

  X1 a KES maker buy filled in fractional pieces: nothing stays reserved, and the
     maker paid exactly what was escrowed
  X2 partial fill then cancel: nothing stays reserved; available + reserved moved
     by exactly the amount paid for the filled part
  X3 cancel never creates money: if the wallet's reserved balance is short of the
     order's escrow, available + reserved does not increase
  X4 expiry releases exactly like cancel (nothing stays reserved)
  X5 property: after 400 random fractional buys/sells/cancels/expiries across
     KES wallets, wallet_reservation_drift() reports nothing for them
     (reserved = live buy escrow + pending withdrawal holds, to the unit)
  X6 reconcile_wallet_reservations(true): a pending withdrawal with no hold (D2)
     and escrow dust (E7) are corrected, a buy order the wallet cannot fund is
     cancelled with a reason, total money is unchanged, each change is audited

Usage: SEED_DB_URL="postgresql://...:5432/postgres" python3 test_escrow_exact.py
"""
import os, sys, uuid
from decimal import Decimal as D
import psycopg2

URL = os.environ["SEED_DB_URL"]
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()

def place(uid, opt, side, price, size, cur_code='KES', exp=None):
    cur.execute("""select clob_place_order(%s,%s,%s,%s::order_side,'buy'::clob_action,'limit'::order_type,%s,%s,
                   %s::currency_code,null,%s,null)""", (uid, MKT, opt, side, price, size, cur_code, exp))
    return cur.fetchone()[0]

def wallet(uid, cur_code='KES'):
    cur.execute("select available_balance, reserved_balance from wallets where user_id=%s and currency=%s", (uid, cur_code))
    a, r = cur.fetchone(); return D(a), D(r)

try:
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    cur.execute("""insert into exchange_rates(from_currency,to_currency,rate) values('KES','USD',0.00771485)
                   on conflict (from_currency,to_currency) do update set rate=0.00771485""")
    cur.execute("select id from profiles order by created_at limit 3")
    u1, u2, u3 = [r[0] for r in cur.fetchall()]
    for u in (u1, u2, u3):
        cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'KES',1000000,true)
                       on conflict (user_id,currency) do update set available_balance=1000000, reserved_balance=0""", (u,))
    MKT = str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                   pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'T','T',%s,now()+interval '30 days','T','active','multiple_choice','clob','independent',0.001,0.01,now()-interval '1 day',0)""",
                (MKT, 'esc-' + MKT[:8], u1))
    n = [0]
    def fresh():
        o = str(uuid.uuid4())
        cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,%s,%s,true)", (o, MKT, f'O{n[0]}', n[0]))
        n[0] += 1; return o

    print("X1 maker buy filled in fractional pieces:")
    O = fresh()
    a0, r0 = wallet(u1)
    # pieces found by search: per-fill releases sum to 1 unit less than the escrow
    pieces = (D('3.837994'), D('9.917909'), D('1.715088'))
    place(u1, O, 'yes', D('74.8'), sum(pieces))                  # maker rests (escrow)
    _, r_rest = wallet(u1)
    for piece in pieces:                                         # NO buys at 25.2 mint against it
        place(u2, O, 'no', D('25.2'), piece)
    a1, r1 = wallet(u1)
    cur.execute("select status from clob_orders where user_id=%s and market_option_id=%s", (u1, O))
    st = cur.fetchone()[0]
    check("X1 order filled", st == 'filled', st)
    check("X1 nothing stays reserved", r1 == r0, f"reserved before={r0} after={r1} (rested with {r_rest - r0})")
    check("X1 maker paid exactly the escrow", (a0 + r0) - (a1 + r1) == (r_rest - r0),
          f"paid={(a0 + r0) - (a1 + r1)} escrowed={r_rest - r0}")

    print("X2 partial fill, then cancel:")
    O = fresh()
    a0, r0 = wallet(u1)
    rr = place(u1, O, 'yes', D('33.3'), D('9.999999'))
    oid = rr['order_id']
    _, r_rest = wallet(u1)
    place(u2, O, 'no', D('66.7'), D('3.333333'))
    cur.execute("select clob_cancel_order(%s,%s)", (u1, oid))
    a1, r1 = wallet(u1)
    cur.execute("select coalesce(sum(shares),0) from positions where user_id=%s and market_option_id=%s and side='yes'", (u1, O))
    got = D(cur.fetchone()[0])
    check("X2 nothing stays reserved", r1 == r0, f"reserved before={r0} after={r1}")
    check("X2 bought 3.333333 shares", got == D('3.333333'), f"shares={got}")
    paid = (a0 + r0) - (a1 + r1)
    check("X2 paid a positive amount no larger than the escrow", D(0) < paid <= (r_rest - r0), f"paid={paid} escrowed={r_rest - r0}")

    print("X3 cancel never creates money:")
    O = fresh()
    rr = place(u3, O, 'yes', D('50.0'), D('20'))
    oid = rr['order_id']
    cur.execute("update wallets set reserved_balance = reserved_balance - 1 where user_id=%s and currency='KES'", (u3,))  # simulate drift
    a0, r0 = wallet(u3)
    cur.execute("savepoint sp")
    try:
        cur.execute("select clob_cancel_order(%s,%s)", (u3, oid)); cur.execute("release savepoint sp"); err = None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint sp"); err = e.pgcode
    a1, r1 = wallet(u3)
    check("X3 available + reserved does not increase", (a1 + r1) <= (a0 + r0), f"before={a0 + r0} after={a1 + r1} err={err}")
    check("X3 reserved never negative", r1 >= 0, f"reserved={r1}")

    print("X4 expiry releases exactly:")
    O = fresh()
    a0, r0 = wallet(u2)
    rr = place(u2, O, 'yes', D('12.3'), D('4.567891'), exp='2099-01-01T00:00:00Z')
    cur.execute("update clob_orders set expires_at = now() - interval '1 second' where id=%s", (rr['order_id'],))
    cur.execute("select clob_expire_orders(100)")
    a1, r1 = wallet(u2)
    check("X4 nothing stays reserved, nothing created", r1 == r0 and a1 + r1 == a0 + r0,
          f"reserved {r0}->{r1}, total {a0 + r0}->{a1 + r1}")
    print("X5 random stream keeps the invariant:")
    import random
    rnd = random.Random(82)
    cur.execute("select id from profiles order by created_at offset 3 limit 3")
    xs = [r[0] for r in cur.fetchall()]
    for u in xs:
        cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'KES',1000000,true)
                       on conflict (user_id,currency) do update set available_balance=1000000, reserved_balance=0""", (u,))
    opts = [fresh() for _ in range(3)]
    live = []
    for step in range(400):
        u = rnd.choice(xs); o = rnd.choice(opts); r = rnd.random()
        cur.execute("savepoint s5")
        try:
            if r < 0.55:
                res = place(u, o, rnd.choice(['yes', 'no']), D(rnd.randint(10, 990)) / 10, D(rnd.randint(1, 20_000_000)) / D(1_000_000))
                if res.get('status') in ('open', 'partially_filled'): live.append((u, res['order_id']))
            elif r < 0.75:
                cur.execute("""select side, shares - reserved_shares from positions where user_id=%s and market_option_id=%s
                               and shares - reserved_shares > 0 order by random() limit 1""", (u, o))
                row = cur.fetchone()
                if row:
                    sz = min(D(row[1]), D(rnd.randint(1, 5_000_000)) / D(1_000_000))
                    cur.execute("""select clob_place_order(%s,%s,%s,%s::order_side,'sell'::clob_action,'limit'::order_type,%s,%s,
                                   'KES'::currency_code,null,null,null)""", (u, MKT, o, row[0], D(rnd.randint(10, 990)) / 10, sz))
            elif r < 0.92 and live:
                cu, oid = live.pop(rnd.randrange(len(live)))
                cur.execute("select clob_cancel_order(%s,%s)", (cu, oid))
            elif live:
                cu, oid = live.pop(rnd.randrange(len(live)))
                cur.execute("update clob_orders set expires_at = now() - interval '1 second' where id=%s and status in ('open','partially_filled')", (oid,))
                cur.execute("select clob_expire_orders(100)")
            cur.execute("release savepoint s5")
        except psycopg2.Error:
            cur.execute("rollback to savepoint s5")   # rejected orders (P0006, P0113, ...) are fine
    cur.execute("""select count(*) from clob_fills f join clob_orders o on o.id=f.maker_order_id
                   where o.market_id=%s and o.market_option_id = any(%s::uuid[])""", (MKT, opts))
    nf = cur.fetchone()[0]
    cur.execute("""select w.user_id, d.drift from wallet_reservation_drift() d join wallets w on w.id=d.wallet_id
                   where w.user_id = any(%s::uuid[])""", (xs,))
    bad = cur.fetchall()
    check("X5 no reservation drift after 400 random ops", not bad and nf > 20, f"fills={nf} drift={bad}")

    print("X6 reconciler restores the invariant without creating money:")
    ya, yb, yc = xs
    # ya: a pending withdrawal with no hold in reserved_balance (D2) and E7-style dust
    cur.execute("""insert into withdrawals(user_id,wallet_id,provider,amount,currency,phone_number,status)
                   select %s, id, 'mpesa', 1234.5, 'KES', '254700000000', 'pending' from wallets where user_id=%s and currency='KES'""", (ya, ya))
    cur.execute("update wallets set reserved_balance = reserved_balance + 0.000287, available_balance = available_balance - 0.000287 where user_id=%s and currency='KES'", (ya,))
    # yb: a live buy order whose escrow the wallet cannot fund at all
    O = fresh()
    rr = place(yb, O, 'yes', D('40.0'), D('10'))
    cur.execute("update wallets set available_balance = 0, reserved_balance = 0 where user_id=%s and currency='KES'", (yb,))
    cur.execute("""select coalesce(sum(available_balance + reserved_balance),0) from wallets where currency='KES'""")
    total0 = D(cur.fetchone()[0])
    cur.execute("select count(*) from wallet_reservation_drift() d join wallets w on w.id=d.wallet_id where w.user_id = any(%s::uuid[])", ([ya, yb],))
    check("X6 drift present before", cur.fetchone()[0] == 2)
    ra = wallet(ya)
    cur.execute("select reconcile_wallet_reservations(true)")
    res = cur.fetchone()[0]
    cur.execute("""select coalesce(sum(available_balance + reserved_balance),0) from wallets where currency='KES'""")
    total1 = D(cur.fetchone()[0])
    cur.execute("select count(*) from wallet_reservation_drift()")
    left = cur.fetchone()[0]
    a1, r1 = wallet(ya)
    cur.execute("select status, metadata->>'cancel_reason' from clob_orders where id=%s", (rr['order_id'],))
    st = cur.fetchone()
    cur.execute("select count(*) from audit_log where action='reconcile_wallet_reservation' and entity_id = (select id from wallets where user_id=%s and currency='KES')", (ya,))
    audited = cur.fetchone()[0]
    check("X6 no drift left anywhere", left == 0, f"left={left} result={res}")
    check("X6 total money unchanged", total1 == total0, f"{total0} -> {total1}")
    check("X6 withdrawal hold is now reserved, dust released",
          r1 == ra[1] - D('0.000287') + D('1234.5') and a1 + r1 == ra[0] + ra[1],
          f"reserved {ra[1]} -> {r1}, available {ra[0]} -> {a1}")
    check("X6 unfunded buy order cancelled with a reason", st == ('cancelled', 'unfunded_escrow_082'), str(st))
    check("X6 wallet change audited", audited == 1, f"rows={audited}")

except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
