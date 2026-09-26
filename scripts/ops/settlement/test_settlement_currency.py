#!/usr/bin/env python3
"""
test_settlement_currency.py - one country -> one settlement currency (migration 079).
Runs in ONE transaction that is ROLLED BACK; nothing persists.

Owner decision: the settlement currency is the currency of the user's
country (detected in the browser). Checks:
  S1  supported_countries holds the 7 countries with their currency and dial code
  S2  signup (handle_new_user) with a supported country: settlement_currency is
      derived from the country, preferred_currency mirrors it, and exactly ONE
      wallet is created (the settlement wallet); a metadata currency is ignored
  S3  signup with an unsupported/missing country: no country, no settlement
      currency, no wallet (never a silent KE/KES default)
  S4  a user cannot UPDATE country_code / preferred_currency directly
  S5  set_my_country: allowed while there is no money activity; sets country,
      currency, source and signals, creates the wallet
  S6  set_my_country: rate-limited to one change per 24 h
  S7  set_my_country: unsupported country rejected
  S8  set_my_country: refused once the user has money activity (funded wallet)
  S9  the first order locks the settlement currency; then set_my_country is refused
  S10 user_settlement(user) returns country, currency, wallet id, lock
  S11 another user cannot read someone else's user_settlement

Usage: SEED_DB_URL="postgresql://...:5432/postgres" python3 test_settlement_currency.py
"""
import os, sys, uuid, json
import psycopg2

URL = os.environ["SEED_DB_URL"]
fails, passed = [], []
def check(name, ok, detail=""):
    (passed if ok else fails).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")

conn = psycopg2.connect(URL, connect_timeout=40); conn.autocommit = False; cur = conn.cursor()

def call(sql, args=()):
    cur.execute("savepoint sp")
    try:
        cur.execute(sql, args); r = cur.fetchone()
        cur.execute("release savepoint sp"); return (r[0] if r else None), None
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint sp"); return None, f"{e.pgcode} {e.pgerror.splitlines()[0] if e.pgerror else ''}"

def as_user(uid, sql, args=(), role=True):
    cur.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(uid),))
    if role: cur.execute("set local role authenticated")
    try:
        return call(sql, args)
    finally:
        if role: cur.execute("reset role")
        cur.execute("select set_config('request.jwt.claim.sub', '', true)")

def signup(meta):
    uid = str(uuid.uuid4())
    cur.execute("insert into auth.users(id, email, raw_user_meta_data) values (%s, %s, %s::jsonb)",
                (uid, f"sc-{uid[:8]}@example.com", json.dumps(meta)))
    return uid

def prof(uid):
    cur.execute("select row_to_json(p) from profiles p where id=%s", (uid,))
    return cur.fetchone()[0]

def wallets(uid):
    cur.execute("select array_agg(currency::text order by currency) from wallets where user_id=%s", (uid,))
    return cur.fetchone()[0] or []

try:
    print("Reference data:")
    r, err = call("select json_agg(json_build_array(code, currency, dial_code) order by code) from supported_countries")
    check("S1 7 supported countries", r == [["BI","BIF","257"],["ET","ETB","251"],["KE","KES","254"],["RW","RWF","250"],
                                            ["TZ","TZS","255"],["UG","UGX","256"],["ZM","ZMW","260"]], f"{r} {err or ''}")

    print("Signup:")
    ug = signup({"display_name": "UG user", "country_code": "ug", "preferred_currency": "KES",
                 "country_source": "browser", "country_signals": {"tz": "Africa/Kampala", "lang": "en-UG"}})
    p = prof(ug)
    check("S2 UG signup -> UGX settlement, KES metadata ignored, one UGX wallet",
          p.get('country_code') == 'UG' and p.get('settlement_currency') == 'UGX' and p.get('preferred_currency') == 'UGX'
          and wallets(ug) == ['UGX'], f"country={p.get('country_code')} settlement={p.get('settlement_currency')} "
          f"pref={p.get('preferred_currency')} wallets={wallets(ug)}")
    xx = signup({"display_name": "DE user", "country_code": "DE"})
    p = prof(xx)
    check("S3 unsupported country -> no country, no currency, no wallet",
          p.get('country_code') is None and p.get('settlement_currency') is None and wallets(xx) == [],
          f"country={p.get('country_code')} settlement={p.get('settlement_currency')} wallets={wallets(xx)}")

    print("Direct edits are refused:")
    # Checked on the grants themselves: a behavioural UPDATE as `authenticated`
    # also depends on the RLS policy's auth.uid(), and the CI bootstrap gives
    # that role no USAGE on schema auth, so it failed for an unrelated reason
    # ("permission denied for schema auth") and passed vacuously.
    r, err = call("""select json_build_object(
        'country_code', has_column_privilege('authenticated','public.profiles','country_code','UPDATE'),
        'preferred_currency', has_column_privilege('authenticated','public.profiles','preferred_currency','UPDATE'),
        'settlement_currency', has_column_privilege('authenticated','public.profiles','settlement_currency','UPDATE'),
        'display_name', has_column_privilege('authenticated','public.profiles','display_name','UPDATE'))""")
    check("S4 authenticated cannot UPDATE country_code / preferred_currency / settlement_currency (can UPDATE display_name)",
          r == {'country_code': False, 'preferred_currency': False, 'settlement_currency': False, 'display_name': True}, f"{r} {err or ''}")

    print("set_my_country:")
    r, err = as_user(xx, "select set_my_country('TZ', '{\"tz\":\"Africa/Dar_es_Salaam\"}'::jsonb)")
    p = prof(xx)
    check("S5 unsupported-country user picks TZ -> TZS, wallet created",
          err is None and p.get('country_code') == 'TZ' and p.get('settlement_currency') == 'TZS' and wallets(xx) == ['TZS']
          and p.get('country_source') == 'browser', f"r={r} err={err} p={ {k: p.get(k) for k in ('country_code','settlement_currency','country_source')} } w={wallets(xx)}")
    _, err = as_user(xx, "select set_my_country('KE', '{}'::jsonb)")
    check("S6 second change within 24h refused", bool(err) and 'P0173' in err, err or '')
    cur.execute("update profiles set country_changed_at = now() - interval '2 days' where id=%s", (xx,))
    _, err = as_user(xx, "select set_my_country('DE', '{}'::jsonb)")
    check("S7 unsupported country refused", bool(err) and 'P0171' in err, err or '')
    cur.execute("update wallets set available_balance = 10 where user_id=%s", (xx,))
    _, err = as_user(xx, "select set_my_country('KE', '{}'::jsonb)")
    check("S8 refused with a funded wallet", bool(err) and 'P0172' in err, err or '')

    print("Lock on first money event:")
    cur.execute("update wallets set available_balance = 1000000 where user_id=%s", (ug,))
    cur.execute("insert into exchange_rates(from_currency,to_currency,rate) values('UGX','USD',0.000255) on conflict do nothing")
    mkt = str(uuid.uuid4()); opt = str(uuid.uuid4())
    cur.execute("""insert into markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,
                   pricing_engine,options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
                   values(%s,%s,'T','T',%s,now()+interval '30 days','T','active','multiple_choice','clob','independent',0.01,0.01,now()-interval '1 day',0)""",
                (mkt, 'sc-' + mkt[:8], ug))
    cur.execute("insert into market_options(id,market_id,label,display_order,is_active) values(%s,%s,'A',0,true)", (opt, mkt))
    r, err = call("select clob_place_order(%s,%s,%s,'yes','buy','limit',40,10,'UGX')", (ug, mkt, opt))
    p = prof(ug)
    check("S9a first order locks the settlement currency", err is None and p.get('settlement_locked_at') is not None, f"err={err} locked={p.get('settlement_locked_at')}")
    _, err = as_user(ug, "select set_my_country('KE', '{}'::jsonb)")
    check("S9b set_my_country refused once locked", bool(err) and 'P0170' in err, err or '')

    print("user_settlement:")
    r, err = as_user(ug, "select row_to_json(s) from user_settlement(%s) s", (ug,))
    check("S10 own settlement readable", err is None and r and r.get('country') == 'UG' and r.get('currency') == 'UGX'
          and r.get('wallet_id') is not None and r.get('locked') is True, f"r={r} err={err}")
    r, err = as_user(xx, "select row_to_json(s) from user_settlement(%s) s", (ug,))
    check("S11 another user's settlement refused", bool(err) or r is None, f"r={r} err={err}")
except psycopg2.Error as e:
    check("harness completed", False, f"{e.pgcode} {e.pgerror}")
finally:
    conn.rollback(); conn.close()

print(f"\nRESULT: {len(passed)} passed, {len(fails)} failed")
print("(transaction rolled back - no data persisted)")
sys.exit(1 if fails else 0)
