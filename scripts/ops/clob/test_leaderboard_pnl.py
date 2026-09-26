#!/usr/bin/env python3
"""
test_leaderboard_pnl.py - trader P&L, win rate and bet counts (migration 092;
audit 6.29). ONE transaction, ROLLED BACK.

Before 092 the profile counters (and so the all-time leaderboard, profile and
trader pages) and the week/month leaderboard were built from ledger rows:
P&L = bet_won - bet_placed, so a CLOB SELL (a bet_refunded row) never counted
and a profitable seller showed a loss; every maker fill was one more "bet".

  L1 a buy at 40 then a sale at 70 shows P&L +3.00 for 10 shares, not -4.00
  L2 one resting bid filled by 3 takers is ONE position, not 3 bets
  L3 settlement: the winner's P&L is payout - cost; the loser's is -cost;
     a closed profitable position is a win, a losing one a loss
  L4 a voided market's P&L counts, but it is neither a win nor a loss
  L5 the week leaderboard shows the same figures
  L6 invariant over the whole database: every position's realized P&L is
     accounted in position_pnl_events, and profile P&L equals the positions'
Usage: SEED_DB_URL=postgresql://... python3 test_leaderboard_pnl.py
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
def one(sql, args=()):
    cur.execute(sql, args); r = cur.fetchone(); return r[0] if r and len(r) == 1 else r

def market(creator, tag):
    mid, oid = str(uuid.uuid4()), str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                   pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,%s,'L',%s,now()+interval '9 days','L','active','binary','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
                (mid, f'lb-{tag}-{mid[:8]}', f'LB {tag}', creator))
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (oid, mid))
    return mid, oid

def place(uid, mkt, opt, side, action, price, size):
    cur.execute("""select clob_place_order(%s,%s,%s,%s::order_side,%s::clob_action,'limit'::order_type,%s,%s,'USD'::currency_code,null,null,null)""",
                (uid, mkt, opt, side, action, price, size))
    return cur.fetchone()[0]

def stats(uid):
    r = one("select total_bets, total_wins, win_rate, profit_loss_usd from profiles where id=%s", (uid,))
    return int(r[0] or 0), int(r[1] or 0), D(r[2] or 0), D(r[3] or 0)

def board(uid, period):
    data = one("select get_leaderboard('pnl', %s, 100)", (period,))['data']
    return next((e for e in data if e['id'] == str(uid)), None)

try:
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('USD','USD',1) on conflict do nothing")
    # fresh traders: their counters start at zero, so every figure below is theirs alone
    users = []
    for i in range(6):
        u = str(uuid.uuid4())
        cur.execute("insert into auth.users(id, email) values(%s,%s)", (u, f'lb{i}-{u[:8]}@test.invalid'))
        cur.execute("insert into profiles(id, username, display_name) values(%s,%s,%s) on conflict (id) do nothing", (u, f'lb{i}{u[:6]}', f'LB {i}'))
        cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',10000,true)
                       on conflict (user_id,currency) do update set available_balance=10000, reserved_balance=0""", (u,))
        users.append(u)
    A, B, C, T1, T2, T3 = users
    for u in users:   # a profile row created by the auth trigger may carry defaults; zero the counters we assert on
        cur.execute("update profiles set total_bets=0,total_wins=0,win_rate=0,profit_loss_usd=0,total_volume_usd=0,account_status='active' where id=%s", (u,))

    # L1: A buys 10 YES at 40 (minted against B's NO at 60), then sells them to C at 70
    M1, O1 = market(A, 'l1')
    place(A, M1, O1, 'yes', 'buy', 40, 10); place(B, M1, O1, 'no', 'buy', 60, 10)
    place(C, M1, O1, 'yes', 'buy', 70, 10)
    r = place(A, M1, O1, 'yes', 'sell', 70, 10)
    check("L1 setup: A's sale filled", D(str(r['filled_shares'])) == 10, str(r.get('filled_shares')))

    # L2: A rests one bid for 30 YES at 50; three takers fill it 10 each (mints)
    M2, O2 = market(A, 'l2')
    place(A, M2, O2, 'yes', 'buy', 50, 30)
    for t in (T1, T2, T3):
        place(t, M2, O2, 'no', 'buy', 50, 10)
    check("L2 setup: A holds 30 YES from one order",
          D(one("select shares from positions where user_id=%s and market_option_id=%s and side='yes'", (A, O2))) == 30)

    # L3: settle M2 YES: A (30 @ 50, cost 15) is paid 30 -> +15; each taker (10 NO @ 50) -> -5
    cur.execute("select resolve_market_options_binary(%s,%s,%s,%s)", (M2, O2, A, 'leaderboard test'))

    # L4: void M3 at 50: A bought 10 YES at 30 (cost 3), paid 5 -> +2; B bought NO at 70 (cost 7), paid 5 -> -2
    M3, O3 = market(A, 'l4')
    place(A, M3, O3, 'yes', 'buy', 30, 10); place(B, M3, O3, 'no', 'buy', 70, 10)
    cur.execute("select void_market(%s, 0.5, 'leaderboard test void')", (M3,))

    cur.execute("select refresh_leaderboard()")

    bets, wins, wr, pnl = stats(A)
    # A: +3 (L1 sale) + 15 (L3 win) + 2 (L4 void) = +20; closed: L1 (+3 win), L3 (+15 win), L4 void (neither)
    check("L1 A's P&L includes the sale: +3 + 15 + 2 = +20.00", pnl == D('20'), f"got {pnl}")
    check("L2 A's bets are positions (3), not fills (1 + 3 + 1 = 5)", bets == 3, f"got {bets}")
    check("L3/L4 A: 2 wins, the void is not counted; win rate 1.0", wins == 2 and wr == D('1'), f"wins={wins} win_rate={wr}")
    bb, bw, bwr, bpnl = stats(B)
    # B: NO 10 @ 60 in M1 still open (0 realized); M3 void -2 -> P&L -2, no wins, no losses
    check("L4 B's void loss counts in P&L (-2.00) but not as a loss", bpnl == D('-2') and bw == 0 and bwr == 0, f"pnl={bpnl} wins={bw} wr={bwr}")
    tb, tw, twr, tpnl = stats(T1)
    check("L3 a settled loser: P&L -5.00, 0 wins, win rate 0", tpnl == D('-5') and tw == 0 and twr == 0 and tb == 1,
          f"bets={tb} wins={tw} wr={twr} pnl={tpnl}")
    row = one("select profit_loss_usd, total_bets, total_wins from leaderboard where id=%s", (A,))
    check("L1 the all-time leaderboard shows A at +20.00, 3 bets, 2 wins",
          row is not None and D(row[0]) == D('20') and row[1] == 3 and row[2] == 2, f"row={row}")

    wk = board(A, 'week')
    check("L5 the week leaderboard shows A at +20.00 with 2 wins",
          wk is not None and D(str(wk['profit_loss_usd'])) == D('20') and wk['total_wins'] == 2, f"entry={wk}")
    wkt = board(T1, 'week')
    check("L5 the week leaderboard lists a loser at -5.00 (not only buyers)",
          wkt is not None and D(str(wkt['profit_loss_usd'])) == D('-5'), f"entry={wkt}")

    # L6: whole-database invariants
    has_events = one("select to_regclass('public.position_pnl_events') is not null")
    if has_events:
        bad = one("""select count(*) from (
                       select p.id, coalesce(p.realized_pnl_usd,0) r, coalesce(sum(e.delta_usd),0) s
                         from positions p left join position_pnl_events e on e.position_id = p.id
                        group by p.id, p.realized_pnl_usd) x where abs(r - s) > 0.000001""")
        check("L6 every position's realized P&L is accounted in position_pnl_events", bad == 0, f"{bad} positions differ")
    else:
        check("L6 position_pnl_events exists", False)
    drift = one("""select count(*) from profiles pr
                     left join (select user_id, sum(coalesce(realized_pnl_usd,0)) s from positions group by 1) p on p.user_id = pr.id
                    where abs(coalesce(pr.profit_loss_usd,0) - coalesce(p.s,0)) > 0.000001""")
    check("L6 every profile's P&L equals its positions' realized P&L", drift == 0, f"{drift} profiles differ")

    # L7: the sync never waits on a trade. Another session holds a committed
    # profile row (as the matcher does, FOR NO KEY UPDATE); that profile's P&L
    # is stale here. The sync must return at once and skip it, then fix it
    # once the lock is gone.
    P = one("select id from profiles where not (id = any(%s::uuid[])) order by created_at limit 1", (users,))
    cur.execute("""insert into wallets(user_id,currency,available_balance,is_active) values(%s,'USD',0,true)
                   on conflict (user_id,currency) do nothing""", (P,))
    M7, O7 = market(A, 'l7')
    cur.execute("""insert into positions(user_id,market_id,wallet_id,market_option_id,side,shares,realized_pnl_usd,is_active)
                   values(%s,%s,(select id from wallets where user_id=%s and currency='USD'),%s,'yes',0,7.5,false)""", (P, M7, P, O7))
    want = one("select round(coalesce(sum(realized_pnl_usd),0),6) from positions where user_id=%s", (P,))
    holder = psycopg2.connect(URL); hc = holder.cursor()
    hc.execute("select 1 from profiles where id=%s for no key update", (P,))
    cur.execute("savepoint l7")
    try:
        cur.execute("set local statement_timeout = '5s'")
        cur.execute("select sync_profile_trading_stats()"); cur.fetchone(); err = None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint l7"); err = e.pgcode
    skipped = D(one("select profit_loss_usd from profiles where id=%s", (P,))) != D(want)
    holder.rollback(); holder.close()
    check("L7 the sync does not wait on a locked profile, and skips it", err is None and skipped, f"err={err} skipped={skipped}")
    cur.execute("set local statement_timeout = 0")
    cur.execute("select sync_profile_trading_stats()"); cur.fetchone()
    check("L7 the next run corrects it", D(one("select profit_loss_usd from profiles where id=%s", (P,))) == D(want))
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
