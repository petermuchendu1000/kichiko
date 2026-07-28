# RBAC / RLS DB-Operations Verification Matrix

End-to-end proof that **every database operation is authorized exactly as the
DB's own `role_permissions` matrix dictates, for every role** — the "test and
confirm all actions per user" gate.

Harness: [`scripts/security/rbac_dbops_matrix.py`](../../scripts/security/rbac_dbops_matrix.py)

```bash
DATABASE_URL=postgresql://... python3 scripts/security/rbac_dbops_matrix.py
```

The connection string is read from the environment (never hardcoded). Every
check runs inside a transaction that is **always rolled back** — the harness
mutates nothing. Exit 0 = all invariants hold; exit 1 = a mismatch.

## Roles covered (all 9)

`user · creator · marketer · support · resolver · finance · moderator · admin · superadmin`

Roles without a seeded account are simulated by flipping a spare `user`
profile's role with no JWT set (the profile role-change guard's trusted-server
path, `auth.uid() IS NULL`), then setting `request.jwt.claims` so
`auth.uid()` / `has_capability()` resolve to the target role.

## Phases & latest result (576 checks, 0 failures)

| Phase | Checks | What it proves |
| --- | --- | --- |
| **Capability gates** | 531 | Each of the 58 capability-gated `admin_*`/RPCs is called as all 9 roles; the role passes the gate **iff** it (or superadmin) holds one of the capabilities the RPC checks via `has_capability()`. Handles OR-gates (e.g. `admin_dispute_market` = `markets:cancel` OR `markets:resolve`) and the data-dependent `admin_reject_application` gate (tested with real fixtures per application kind). |
| **Self-only / internal RPCs** | 22 | Every self-only/internal RPC (`clob_place_order`, `clob_cancel_order`, `request_withdrawal`, `credit_deposit`, `complete_withdrawal`, cron/service functions, …) **denies a normal user** acting on behalf of another user (`p_user_id <> auth.uid()`) or calling a service-only internal. |
| **RLS read-scoping** | 16 | A normal user sees only their **own** rows in money/PII tables (`wallets`, `transactions`, `deposits`, `withdrawals`, `positions`, `clob_orders`, `kyc_documents`, `payout_items`, `notifications`) and is denied/empty on locked tables (`gateway_secrets`, `audit_log`, `role_permissions`, `payout_runs`, `commission_plans`, `impersonation_sessions`, `admin_user_notes`). |
| **Client write-lockdown** | 7 | A normal user cannot directly write money/audit/config tables (`wallets`, `transactions`, `exchange_rates`, `audit_log`, `role_permissions`, `platform_settings`, `positions`) — INSERT/UPDATE/DELETE are denied or RLS-filtered to 0 rows. |

## Findings & remediation

- **`exchange_rates` write-grant hardening (migration `068`).** Writes were
  already blocked by RLS (only the `service_role` policy permits them), but the
  `anon`/`authenticated` roles still held table-level INSERT/UPDATE/DELETE
  grants, leaving FX writes gated by RLS alone. Since FX rates drive every
  KES↔USD conversion, `068_lockdown_exchange_rates_client_writes.sql` revokes
  those grants so rates can only be written by the service role / the
  `upsert_exchange_rates` SECURITY DEFINER job. Public `SELECT` is preserved.

- The RBAC capability matrix in `apps/web/lib/admin/rbac.ts` is verified in
  lockstep with the DB `role_permissions` seed (admin 23 · finance 8 ·
  moderator 12 · resolver 1 · support 3; superadmin = god-mode; user/creator/
  marketer hold no staff capabilities).
