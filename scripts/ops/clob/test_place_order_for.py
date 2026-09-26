#!/usr/bin/env python3
"""
test_place_order_for.py - the single order RPC (migration 090; finding L1).
ONE transaction, ROLLED BACK.

place_order_for does in the database what POST /api/orders did in 6-8 round
trips:
  O1  an order is placed in the user's settlement currency (no assertion needed)
  O2  inactive account -> P0190
  O3  maintenance -> P0191; order book switched off -> P0192; an env override
      passed by the route turns it back on
  O4  no country -> P0193; a different asserted currency -> P0194
  O5  unknown market -> P0001; not an order-book market -> P0103
  O6  a dollar market buy is converted at the best ask and never spends more
      than the amount; with no liquidity -> P0195
  O7  a user JWT cannot call it (P0121): kill-switch overrides are the route's
Usage: SEED_DB_URL=postgresql://... python3 test_place_order_for.py
"""
import os, sys, uuid, json
from decimal import Decimal as D
import psycopg2

URL = os.environ["SEED_DB_URL"]
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()
def one(sql, args=()):
    cur.execute(sql, args); r = cur.fetchone(); return r[0] if r and len(r) == 1 else r

def pof(uid, *, side='yes', action='buy', otype='limit', price=40, size=5, amount=None, currency=None, env=None, market=None):
    cur.execute("savepoint p")
    try:
        cur.execute("""select place_order_for(%s,%s,%s,%s::order_side,%s::clob_action,%s::order_type,%s,%s,%s,%s::currency_code,null,null,%s::jsonb)""",
                    (uid, market or MKT, OPT, side, action, otype, price if otype == 'limit' else None, size, amount, currency, json.dumps(env or {})))
        r = cur.fetchone()[0]; cur.execute("release savepoint p"); return r, None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint p"); return None, e.pgcode

try:
    u, maker = [r[0] for r in (cur.execute("select id from profiles order by created_at limit 2") or cur.fetchall())]
    cur.execute("update profiles set account_status='active', country_code='KE' where id in (%s,%s)", (u, maker))
    cur.execute("update profiles set settlement_currency='KES' where id in (%s,%s)", (u, maker))
    for x in (u, maker):
        cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'KES',100000,true)
                       on conflict (user_id,currency) do update set available_balance=100000, reserved_balance=0""", (x,))
    cur.execute("""insert into exchange_rates(from_currency,to_currency,rate) values('KES','USD',0.0077)
                   on conflict (from_currency,to_currency) do update set rate=0.0077""")
    cur.execute("""insert into platform_settings(key,value,is_public) values('flags.clob','true',true),('maintenance.enabled','false',true)
                   on conflict (key) do update set value=excluded.value""")
    MKT, OPT = str(uuid.uuid4()), str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                   pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'P','P',%s,now()+interval '9 days','P','active','binary','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
                (MKT, 'pof-' + MKT[:8], u))
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (OPT, MKT))

    r, e = pof(u)
    cur_code = one("select currency::text from clob_orders where id=%s", (r['order_id'],)) if r else None
    check("O1 placed in the settlement currency", e is None and cur_code == 'KES', f"err={e} currency={cur_code}")

    cur.execute("update profiles set account_status='suspended' where id=%s", (u,))
    _, e = pof(u); check("O2 inactive account -> P0190", e == 'P0190', f"err={e}")
    cur.execute("update profiles set account_status='active' where id=%s", (u,))

    cur.execute("update platform_settings set value='true' where key='maintenance.enabled'")
    _, e = pof(u); check("O3 maintenance -> P0191", e == 'P0191', f"err={e}")
    cur.execute("update platform_settings set value='false' where key='maintenance.enabled'")
    cur.execute("update platform_settings set value='false' where key='flags.clob'")
    _, e = pof(u); check("O3 order book off -> P0192", e == 'P0192', f"err={e}")
    _, e = pof(u, env={'flags.clob': True}); check("O3 the route's env override turns it on", e is None, f"err={e}")
    cur.execute("update platform_settings set value='true' where key='flags.clob'")

    _, e = pof(u, currency='UGX'); check("O4 another asserted currency -> P0194", e == 'P0194', f"err={e}")
    # a user who has never moved money (settlement not locked yet) and has no country
    nc = one("select id from profiles where settlement_locked_at is null and id not in (%s,%s) order by created_at limit 1", (u, maker))
    cur.execute("update profiles set account_status='active', country_code=null, settlement_currency=null where id=%s", (nc,))
    _, e = pof(nc); check("O4 no country -> P0193", e == 'P0193', f"err={e}")

    _, e = pof(u, market=str(uuid.uuid4())); check("O5 unknown market -> P0001", e == 'P0001', f"err={e}")
    cur.execute("update markets set pricing_engine='amm' where id=%s", (MKT,))
    _, e = pof(u); check("O5 not an order-book market -> P0103", e == 'P0103', f"err={e}")
    cur.execute("update markets set pricing_engine='clob' where id=%s", (MKT,))

    # O6: the maker offers YES at 60 (a NO bid at 40 mints against YES buys)
    _, e = pof(maker, side='no', price=40, size=50)
    a0 = D(one("select available_balance from wallets where user_id=%s and currency='KES'", (u,)))
    r, e = pof(u, otype='market', size=None, amount=1000)       # KES 1000 = USD 7.70
    a1 = D(one("select available_balance from wallets where user_id=%s and currency='KES'", (u,)))
    spent = a0 - a1
    check("O6 dollar market buy converts and never overspends", e is None and r and D(str(r['filled_shares'])) > 0 and spent <= D('1000.000001'),
          f"err={e} filled={r and r.get('filled_shares')} spent={spent}")
    cur.execute("update clob_orders set status='cancelled' where market_id=%s and status in ('open','partially_filled')", (MKT,))
    _, e = pof(u, otype='market', size=None, amount=1000)
    check("O6 no liquidity -> P0195", e == 'P0195', f"err={e}")

    cur.execute("savepoint j")
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(u),))
    _, e = pof(u, env={'flags.clob': True})
    cur.execute("rollback to savepoint j")
    check("O7 a user JWT cannot call it", e == 'P0121', f"err={e}")
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
