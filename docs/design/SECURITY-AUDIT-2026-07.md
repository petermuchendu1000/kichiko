# MarketPips — Security Audit & Remediation (2026-07)

Scope: database/authorization security posture of the Supabase/Postgres backend
(PostgREST-exposed `public` schema, RLS, SECURITY DEFINER functions, role grants,
views, extensions). Every finding below was verified against the **live** database
and, where fixed, re-verified with a rolled-back E2E test before applying live and
merging through CI. Threat model: sophisticated attackers with a valid `anon`
public key and/or a self-registered `authenticated` account, plus direct
PostgREST RPC access.

Method: live introspection of `pg_proc` / `pg_policy` / `pg_class` / grants +
targeted rolled-back exploits and fix-verification, driven from
`scripts/ops/` style probes (all `ROLLBACK`, zero live pollution).

---

## 1. Fixed & shipped (each E2E-verified, applied live, CI-green, merged)

| ID | Sev | Finding | Fix | PR / migration |
|----|-----|---------|-----|----------------|
| V-01 | 🟠 MED | **Security Definer Views** — `market_search`, `slow_queries` ran as `postgres` (RLS-bypassing) with `security_invoker` unset. | `security_invoker = on`; for `slow_queries` also `REVOKE ALL FROM anon/authenticated` (exposed raw `pg_stat_statements` SQL text). | #60 / 047 |
| V-02 | 🔴 HIGH | **Function Search Path Mutable (CWE-426)** — 14 SECURITY DEFINER functions without a pinned `search_path`, **including the authz primitives** `has_capability`/`is_admin`/`is_superadmin`/`is_staff`/`_actor_is_superadmin` that gate every `admin_*` function and RLS policy. Search-path manipulation → privilege escalation. | `ALTER FUNCTION ... SET search_path = public` on all 14. | #61 / 048 |
| V-03 | 🟠 MED | **Stray client grants on sensitive tables** — `anon SELECT` + `authenticated INSERT/UPDATE/DELETE` on `gateway_secrets` (payment secrets) and `btc_*` price-feed tables. Client-writable price feed = market-resolution fraud vector (masked today only by RLS deny-all). | `REVOKE ALL FROM anon, authenticated` on all four; access remains via SECURITY DEFINER RPCs + `service_role`. | #62 / 049 |
| V-04 | 🟠 MED | **Unauthenticated PII scraping on `profiles`** — `SELECT USING true` + table-wide anon grant let the anon key read every user's `phone_number`, `role` (exposes admins), `kyc_status`, `account_status`, referral graph. | `REVOKE SELECT ON profiles FROM anon` + re-`GRANT SELECT (public columns only)`. `authenticated` self-read untouched. | #63 / 050 |

E2E evidence highlights:
- V-02: after the fix, `is_admin`/`has_capability` return correct results for
  superadmin (`T/T/T`) and normal (`F/F/F`) **and are unaffected by a hostile
  caller `search_path`**; whole schema now has **0** unpinned SECURITY DEFINER funcs.
- V-03: `authenticated INSERT=false` / `anon SELECT=false` on all four tables;
  `latest_btc_price()` (definer read path) still works.
- V-04: anon → `42501` on `phone_number`/`role`/`kyc_status`/`SELECT *`; anon
  retains `username`/`display_name`/`avatar_url`/stats; authenticated self-read intact.

---

## 2. Confirmed SAFE under scrutiny (no change required)

- **Money-table object-level authorization (IDOR):** `wallets`, `withdrawals`,
  `deposits`, `transactions`, `positions`, `clob_orders` all enforce per-user
  isolation (`auth.uid() = user_id`), with staff/admin gated by
  `is_staff()`/`is_admin()` and `service_role` for backend. No cross-user read
  or write path exists at the DB layer.
- **`admin_*` functions:** although EXECUTE is granted broadly (defense-in-depth
  pattern), each self-guards with `has_capability(...)`; a non-admin
  `authenticated`/`anon` caller is rejected. Verified on a sample + live
  `has_capability` returns false for a normal user.
- **Deny-all internal tables:** `gateway_secrets`, `btc_*` have RLS enabled with
  no policies (deny-all for non-owner roles); access mediated by definer RPCs.
- **`clob_place_order` / `clob_cancel_order` / `clob_expire_orders`:** locked to
  `service_role`+`postgres` (migrations 042/043) with `auth.uid()` guard.

---

## 3. Open — requires elevated privilege we do NOT hold (action required)

### V-05 🔴 HIGH — Database-resident SSRF via the `http` extension
The `http` extension lives in `public` and, by extension default, grants EXECUTE
on all `http_*` functions to **PUBLIC** — so `anon`/`authenticated` can call
`http_get`/`http_post`/… directly via PostgREST RPC
(`POST /rest/v1/rpc/http_get`) and make arbitrary outbound requests from the
database's network position (cloud metadata `169.254.169.254`, internal
services, port scans, blind SSRF).

**Confirmed:** `has_function_privilege('anon','http_get(varchar)','EXECUTE') = true`.

**Why not fixed here:** the grant was made by `supabase_admin` and the functions
are owned by `supabase_admin`. Our deploy role `postgres` is **not** a superuser
and **not** a member of `supabase_admin`, so `REVOKE ... FROM PUBLIC` is a silent
no-op (`WARNING: no privileges could be revoked`) and `ALTER EXTENSION http SET
SCHEMA` is unsupported by the extension. This must be run by a superuser.

**Remediation (run as `supabase_admin`/superuser, e.g. Supabase support or a
privileged SQL session), preserving the legitimate cron/webhook path owned by
`postgres`):**
```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'http%'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC;', r.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO postgres;', r.sig);
  END LOOP;
END $$;
```
Legitimate callers are the SECURITY DEFINER functions `btc_tick_cron`,
`schedule_marketpips_jobs`, `schedule_marketpips_btc_jobs` (owned by `postgres`),
so re-granting to `postgres` keeps them working. Longer term: move all outbound
HTTP to Edge Functions / the backend and **drop the `http` extension**.

---

## 4. Tracked residuals (need app-coordinated change)

- **R-01 — authenticated cross-user private profile columns.** V-04 closed the
  anon vector; an `authenticated` user can still read *other* users' private
  columns because column grants are role-wide, not row-scoped. Proper fix: move
  the private columns (`phone_number`, `kyc_status`, notification prefs, referral
  fields, `role`, `account_status`) into an owner-RLS `profiles_private` table
  (or a self-only SECURITY DEFINER RPC) and update `use-auth`, settings, and the
  KYC wizard to read them from there. Deferred to avoid breaking `select('*')`
  self-read without frontend changes.
- **R-02 — Extensions in `public` (`http`, `pg_trgm`).** Supabase "Extension in
  Public" advisory. `http` doesn't support `SET SCHEMA` (must be dropped/recreated
  by a superuser in a dedicated schema); `pg_trgm` relocation must be coordinated
  with the search code that uses it. Requires superuser.

---

## 5. Recommended next audit phases (not yet performed)

Application/edge layer (outside this DB-focused pass): security headers (CSP,
HSTS, X-Frame-Options), CORS allow-list, per-route JWT verification and
service_role key handling, edge rate limiting / WAF / bot protection, dependency
CVE scanning (SCA), and secret rotation cadence. CI already enforces gitleaks,
migration-lint, type-check, unit tests, dependency review, and a build gate.

> Credentials shared for this engagement (GitHub PAT, Supabase DB password,
> `sbp_`/`sb_secret_` keys) should be rotated.
