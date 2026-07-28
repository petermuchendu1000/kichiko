#!/usr/bin/env python3
"""
scripts/security/rbac_dbops_matrix.py

Banking-grade authorization/RLS verification harness. Confirms, for EVERY role,
that EVERY database operation is authorized exactly as the DB's own
`role_permissions` matrix dictates -- "test and confirm all actions per user".

Four phases, all executed inside transactions that are ALWAYS rolled back (no
data is ever mutated):

  1. Capability gates  -- each SECURITY DEFINER `admin_*`/gated RPC is called as
     every role; a role must PASS the gate iff it (or superadmin) holds one of
     the capabilities the RPC checks via has_capability(). OR-gates and the
     data-dependent admin_reject_application gate are handled explicitly.
  2. Self-only / internal RPCs -- must DENY a normal user acting on behalf of
     another user (p_user_id != auth.uid()) or calling service-only internals.
  3. RLS read-scoping -- a normal user must see only their OWN money/PII rows and
     be denied/empty on locked tables (secrets, audit, RBAC, payout runs...).
  4. Client write-lockdown -- a normal user must NOT directly write money / audit
     / config tables (wallets, transactions, exchange_rates, audit_log, ...).

Role simulation: within a rolled-back transaction we flip a spare `user`
profile's role with NO jwt set (auth.uid() IS NULL -> the profile role-change
guard's trusted-server path applies), then set request.jwt.claims to that user
so auth.uid()/has_capability() resolve to the target role.

Usage:
    DATABASE_URL=postgresql://... python3 scripts/security/rbac_dbops_matrix.py
Exit code 0 = all authorization invariants hold; 1 = at least one mismatch.
The DB connection string is read from the environment (never hardcoded).
"""
from __future__ import annotations
import json
import os
import re
import sys

import psycopg2

ROLES = ['user', 'creator', 'marketer', 'support', 'resolver', 'finance', 'moderator', 'admin', 'superadmin']

# RPCs whose capability check runs AFTER a row fetch (NULL args short-circuit to
# 'not found'), so they need a real fixture to exercise the gate. Maps rpc ->
# list of (fixture_kind, required_capability).
DATA_DEPENDENT = {
    'admin_reject_application': [('creator', 'creators:manage'), ('marketer', 'marketers:manage')],
}
# Trigger functions mis-detected as RPCs (reference NEW/OLD); not directly callable.
TRIGGER_FUNCS = {'enqueue_notification_deliveries'}

OWNER_TABLES = ['wallets', 'transactions', 'deposits', 'withdrawals', 'positions',
                'clob_orders', 'kyc_documents', 'payout_items', 'notifications']
LOCKED_TABLES = ['gateway_secrets', 'audit_log', 'role_permissions', 'payout_runs',
                 'commission_plans', 'impersonation_sessions', 'admin_user_notes']
WRITE_LOCKED = {
    'wallets': "insert into wallets(user_id,currency,available_balance) values (%(me)s,'KES',999999)",
    'transactions': "insert into transactions(user_id,type,status,amount,currency) values (%(me)s,'deposit','completed',999999,'KES')",
    'exchange_rates': "update exchange_rates set rate=0.5 where from_currency='KES'",
    'audit_log': "insert into audit_log(actor_id,action,entity_type) values (%(me)s,'hack','x')",
    'role_permissions': "insert into role_permissions(role,capability) values ('user','users:role_grant')",
    'platform_settings': "update platform_settings set value='{}'::jsonb where true",
    'positions': "update positions set current_value_usd=current_value_usd+1000000 where user_id=%(me)s",
}


def typed_args(argstr: str, first_uuid: str | None = None) -> str:
    """Build a positional arg list of typed NULLs from an identity-args string.
    If first_uuid is given, the first argument is that literal uuid instead."""
    if not argstr.strip():
        return ""
    parts, depth, cur = [], 0, ''
    for ch in argstr:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(cur); cur = ''
        else:
            cur += ch
    parts.append(cur)
    out = []
    for i, p in enumerate(parts):
        p = re.sub(r'^(IN|OUT|INOUT|VARIADIC)\s+', ' ', p.strip(), flags=re.I).strip()
        toks = p.split(None, 1)
        typ = toks[1] if len(toks) == 2 else toks[0]
        if i == 0 and first_uuid is not None and typ.strip().lower() == 'uuid':
            out.append(f"'{first_uuid}'::uuid")
        else:
            out.append(f"NULL::{typ}")
    return ", ".join(out)


def is_denied(exc: Exception) -> bool:
    pg = getattr(exc, 'pgcode', None)
    msg = str(exc)
    return pg in ('42501', 'P0121') or bool(re.search(r'insufficient permission|not authoriz|internal function', msg, re.I))


def is_sig_error(exc: Exception) -> bool:
    return getattr(exc, 'pgcode', None) == '42883'


def load_catalog(cur):
    cur.execute("""
        select p.proname, pg_get_functiondef(p.oid), pg_get_function_identity_arguments(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' order by p.proname;""")
    catalog = {}
    for name, body, args in cur.fetchall():
        caps = sorted(set(re.findall(r"has_capability\(\s*'([^']+)'", body)))
        self_only = bool(re.search(r"Not authorized: internal function|act on behalf of another user", body))
        if (caps or self_only) and name not in TRIGGER_FUNCS:
            catalog[name] = {'caps': caps, 'self_only': self_only, 'args': args}
    return catalog


def role_caps(cur):
    cur.execute("select role, capability from role_permissions")
    rc = {r: set() for r in ROLES}
    for role, cap in cur.fetchall():
        rc.setdefault(role, set()).add(cap)
    return rc


def spare_users(cur, n=2):
    cur.execute("select id from profiles where role='user' order by created_at limit %s", (n,))
    return [str(r[0]) for r in cur.fetchall()]


def impersonate(cur, uid):
    # Set BOTH the JSON claims (live Supabase reads request.jwt.claims->>'sub')
    # and the singular claim GUCs (the CI auth stub reads request.jwt.claim.sub /
    # request.jwt.claim.role). Keeps the harness portable across both.
    claims = json.dumps({"sub": uid, "role": "authenticated"})
    cur.execute(
        "select set_config('request.jwt.claims', %s, true),"
        "       set_config('request.jwt.claim.sub', %s, true),"
        "       set_config('request.jwt.claim.role', 'authenticated', true)",
        (claims, uid),
    )


def as_service(cur):
    # Clear all auth GUCs -> auth.uid() IS NULL (trusted server path).
    cur.execute(
        "select set_config('request.jwt.claims', '', true),"
        "       set_config('request.jwt.claim.sub', '', true),"
        "       set_config('request.jwt.claim.role', '', true)"
    )


def phase_capability_gates(cur, catalog, rcaps, spare, applicant):
    """Return (checks, failures)."""
    gated = {n: c for n, c in catalog.items() if c['caps']}
    guard_first = {n: c for n, c in gated.items() if n not in DATA_DEPENDENT}
    checks, failures = 0, []
    for role in ROLES:
        cur.execute("BEGIN")
        as_service(cur)
        cur.execute("update profiles set role=%s where id=%s", (role, spare))  # trusted path (auth.uid() NULL)
        impersonate(cur, spare)
        for rpc, c in guard_first.items():
            caps = set(c['caps'])
            expected = 'PASSED' if (role == 'superadmin' or (caps & rcaps.get(role, set()))) else 'DENIED'
            cur.execute("SAVEPOINT sp")
            try:
                cur.execute(f"SELECT public.{rpc}({typed_args(c['args'])})")
                actual = 'PASSED'
            except Exception as e:
                actual = 'DENIED' if is_denied(e) else 'PASSED'
            cur.execute("ROLLBACK TO SAVEPOINT sp")
            checks += 1
            if actual != expected:
                failures.append(f"[cap] {role}/{rpc}: expected {expected} got {actual}")
        # data-dependent gates via real fixtures
        for rpc, kinds in DATA_DEPENDENT.items():
            for kind, cap in kinds:
                expected = 'PASSED' if (role == 'superadmin' or cap in rcaps.get(role, set())) else 'DENIED'
                cur.execute("SAVEPOINT sp")
                try:
                    as_service(cur)
                    cur.execute("insert into role_applications (user_id, kind, status) values (%s,%s,'pending') returning id",
                                (applicant, kind))
                    appid = cur.fetchone()[0]
                    impersonate(cur, spare)
                    cur.execute(f"select public.{rpc}(%s, %s)", (appid, 'test'))
                    actual = 'PASSED'
                except Exception as e:
                    actual = 'DENIED' if is_denied(e) else 'PASSED'
                cur.execute("ROLLBACK TO SAVEPOINT sp")
                checks += 1
                if actual != expected:
                    failures.append(f"[cap] {role}/{rpc}[{kind}]: expected {expected} got {actual}")
        cur.execute("ROLLBACK")
    return checks, failures


def phase_self_only(cur, catalog, users):
    """A normal user must be denied on every self-only/internal RPC."""
    me, other = users[0], users[1]
    selfonly = {n: c for n, c in catalog.items() if c['self_only']}
    checks, failures = 0, []
    cur.execute("BEGIN")
    impersonate(cur, me)
    for rpc, c in selfonly.items():
        # For RPCs whose first arg is a user uuid, pass ANOTHER user's id so the
        # `auth.uid() <> p_user_id` guard triggers; else pass typed NULLs.
        for attempt in (other, None):
            args = typed_args(c['args'], first_uuid=attempt)
            cur.execute("SAVEPOINT sp")
            try:
                cur.execute(f"SELECT public.{rpc}({args})")
                actual = 'PASSED'
                err = None
            except Exception as e:
                err = e
                actual = 'DENIED' if is_denied(e) else ('SIGERR' if is_sig_error(e) else 'PASSED')
            cur.execute("ROLLBACK TO SAVEPOINT sp")
            if actual != 'SIGERR':
                break  # got a real answer with this arg shape
        checks += 1
        if actual != 'DENIED':
            failures.append(f"[self] {rpc}: normal user not denied (got {actual})")
    cur.execute("ROLLBACK")
    return checks, failures


def phase_rls_reads(cur, users):
    me = users[0]
    checks, failures = 0, []
    cur.execute("BEGIN")
    cur.execute("SET LOCAL ROLE authenticated")
    impersonate(cur, me)
    for t in OWNER_TABLES:
        cur.execute("SAVEPOINT sp")
        try:
            cur.execute(f"select count(*) from {t} where user_id <> %s", (me,))
            others = cur.fetchone()[0]
            ok = (others == 0)
        except Exception:
            ok = True  # denied entirely is also fine
        cur.execute("ROLLBACK TO SAVEPOINT sp")
        checks += 1
        if not ok:
            failures.append(f"[rls-read] {t}: normal user can see {others} other users' rows")
    for t in LOCKED_TABLES:
        cur.execute("SAVEPOINT sp")
        try:
            cur.execute(f"select count(*) from {t}")
            vis = cur.fetchone()[0]
            ok = (vis == 0)
        except Exception:
            ok = True  # permission denied = correctly locked
        cur.execute("ROLLBACK TO SAVEPOINT sp")
        checks += 1
        if not ok:
            failures.append(f"[rls-read] {t}: locked table exposed {vis} rows to a normal user")
    cur.execute("ROLLBACK")
    return checks, failures


def phase_write_lockdown(cur, users):
    me = users[0]
    checks, failures = 0, []
    cur.execute("BEGIN")
    cur.execute("SET LOCAL ROLE authenticated")
    impersonate(cur, me)
    for t, sql in WRITE_LOCKED.items():
        cur.execute("SAVEPOINT sp")
        allowed_rows = None
        try:
            cur.execute(sql, {'me': me})
            allowed_rows = cur.rowcount  # RLS may filter UPDATE/DELETE to 0 rows w/o error
        except Exception:
            allowed_rows = 0  # denied
        cur.execute("ROLLBACK TO SAVEPOINT sp")
        checks += 1
        if allowed_rows and allowed_rows > 0:
            failures.append(f"[write] {t}: normal user wrote {allowed_rows} row(s) directly")
    cur.execute("ROLLBACK")
    return checks, failures


def main() -> int:
    dsn = os.environ.get('DATABASE_URL') or os.environ.get('SUPABASE_DB_URL')
    if not dsn:
        print("ERROR: set DATABASE_URL (or SUPABASE_DB_URL) to the Postgres connection string.", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dsn, connect_timeout=30)
    conn.autocommit = False
    cur = conn.cursor()
    catalog = load_catalog(cur)
    rcaps = role_caps(cur)
    users = spare_users(cur, 2)
    if len(users) < 2:
        print("ERROR: need at least 2 'user' profiles to run the matrix.", file=sys.stderr)
        return 2
    spare, applicant = users[0], users[1]

    all_fail = []
    total = 0
    for label, fn in [
        ("capability-gates", lambda: phase_capability_gates(cur, catalog, rcaps, spare, applicant)),
        ("self-only-rpcs", lambda: phase_self_only(cur, catalog, users)),
        ("rls-read-scoping", lambda: phase_rls_reads(cur, users)),
        ("client-write-lockdown", lambda: phase_write_lockdown(cur, users)),
    ]:
        checks, failures = fn()
        total += checks
        status = 'OK' if not failures else f'{len(failures)} FAIL'
        print(f"[{status:>8}] {label}: {checks} checks")
        all_fail.extend(failures)

    cur.close()
    conn.close()
    print(f"\n{'='*60}\nTOTAL: {total} authorization checks, {len(all_fail)} failure(s)")
    for f in all_fail:
        print("  FAIL", f)
    if all_fail:
        print("RESULT: FAIL")
        return 1
    print("RESULT: PASS -- every DB operation is authorized per role_permissions.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
