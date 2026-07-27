# Kichiko — Disaster Recovery, Backups, HA & Capacity

> Module 17.6. Backup policy, point-in-time recovery, a **rehearsable** restore
> drill, high-availability topology, and a capacity plan with scale triggers.
> Operational procedures (freeze, incident, rotation) live in
> [`RUNBOOK.md`](./RUNBOOK.md); this doc is the reliability program.

## 1. Targets (RPO / RTO)

| Scope | Target | Mechanism |
| --- | --- | --- |
| App tier | RTO ≤ 10 min | Rollback to prior Fly image by digest (M16) |
| Database (data loss/corruption) | **RTO ≤ 60 min**, **RPO ≤ 5 min** | Supabase PITR |
| Config / infra | RTO ≤ 30 min | Terraform re-apply from remote state |

RPO ≤ 5 min = at most ~5 minutes of writes lost in a worst-case data incident.
RTO is time-to-service-restored once recovery starts.

## 2. Backup policy

- **Managed backups:** Supabase automated daily backups **plus Point-in-Time
  Recovery (PITR)** enabled on the production project. PITR lets us restore to any
  timestamp within the retention window (WAL-based), which is what delivers the
  ≤5-min RPO.
- **Retention:** keep PITR window + daily snapshots per plan (confirm ≥ 7 days;
  raise for compliance if required by AML record-keeping — see
  `docs/legal/data-retention.md`).
- **Encryption:** backups are encrypted at rest (managed by Supabase); the
  database is encrypted at rest and connections are TLS.
- **Scope:** Postgres (all app data) + Supabase Storage (KYC media). Verify
  Storage is included in the backup/restore plan; if not, add scheduled Storage
  export.
- **Off-platform copy (recommended):** periodic `pg_dump` to encrypted object
  storage (R2/S3) for a provider-independent copy; document the cadence once
  wired.

## 3. Restore drill (rehearsable)

**Cadence:** quarterly, and after any major schema/infra change. **Never** drill
against production — restore into an isolated **scratch project**.

### Procedure
1. **Declare a drill window** (not an incident). Note the target restore
   timestamp `T` (e.g. now − 10 min) to exercise PITR.
2. **Restore** the production backup / PITR to timestamp `T` into a new scratch
   Supabase project (dashboard PITR restore, or CLI).
3. **Point the checker at the scratch DB** and run the integrity verifier:
   ```bash
   export DR_DB_URL='postgresql://…scratch…'
   pip install psycopg2-binary   # if needed
   python3 scripts/dr_restore_check.py          # read-only invariants
   python3 scripts/dr_restore_check.py --smoke  # + CLOB money-path RPC sanity (rolled back)
   ```
   The checker asserts: core tables present & populated; **no negative wallet
   balances**; **no orphaned** positions/orders/wallets; schema is current
   (latest applied migration **>= 058**, the current head); and (smoke) the live
   CLOB RPCs `clob_place_order` / `clob_cancel_order` / `resolve_market` exist for
   a rolled-back sanity exercise. (The legacy AMM/LMSR `place_bet` RPC was dropped
   in migration 035, so it is intentionally **not** asserted.)
4. **Spot-check** a known market/user, and `/api/health` when the scratch app is
   pointed at the restored DB.
5. **Record timings** vs targets (start → restore complete → checks green) and
   any gaps below.

### Drill results log

| Date | Restored to (T) | RTO actual | RPO actual | Checker | Notes |
| --- | --- | --- | --- | --- | --- |
| _pending first live run_ | — | — | — | — | Procedure + verifier committed; **live rehearsal against a scratch project is outstanding — it requires production Supabase credentials not available in this environment.** |

**Gap & remediation:** the live restore has not yet been executed here because it
needs prod backup access. Remediation: the on-call/DB owner runs the procedure
above against a scratch project during the first production readiness window and
appends a row to this table. The drill is fully scripted so it is a ~15-minute
task, not a research task.

## 4. High availability & redundancy

- **App tier (Fly.io):** run **≥ 2 machines** in prod (raise `min_machines_running`
  from the staging value of 1). `fly.toml` uses a **canary** deploy strategy with
  a health-gated `/api/health` check (15s interval) so a bad release auto-aborts
  and the previous release keeps serving. `primary_region = "jnb"` (Johannesburg,
  nearest to East Africa); add a second region for regional redundancy as traffic
  grows.
- **Database (Supabase):** managed Postgres with provider failover; app connects
  via the **pooler**. Read-heavy hot paths are served from the Redis cache +
  edge cache (M15), reducing DB dependence during partial degradation.
- **Edge (Cloudflare):** fronts the app for TLS, caching of public reads, and
  resilience; managed via `infra/terraform/cloudflare.tf`.
- **Graceful degradation:** rate-limiter and cache **fail open** if Redis is
  unavailable; the money-path freeze (RUNBOOK §money-path freeze) can disable
  writes without a full outage during a data incident.

## 5. Capacity plan & scale triggers

Baseline load evidence: `load/markets.k6.js` (k6) with a `p(95) < 300ms`
threshold on list/detail reads. Re-run before each capacity decision.

### Projections (initial launch, single-country soft launch → EA-wide)
| Dimension | Launch assumption | Headroom lever |
| --- | --- | --- |
| Concurrent users | hundreds → low thousands | Fly machines scale horizontally |
| Requests | reads dominate; served by edge + Redis cache | raise cache TTL/SWR; add region |
| Orders/day | thousands | atomic `clob_place_order` RPC; DB pooler connections |
| Storage growth | KYC media dominant | Supabase Storage; monitor & tier |
| DB connections | bounded by pooler budget | tune pooler; add read replicas if added |

### Scale triggers (act when sustained)
- App CPU > 70% or `p95` latency > SLO for 10 min → **add Fly machines**.
- Fly concurrency near `soft_limit` (200) → **add machines / raise limits**.
- DB pooler connection saturation → **raise pooler size / optimise hot queries**
  (M15.2 indexes/rollup) / consider read replica.
- Cache hit-rate drop or Redis latency spike → **investigate keys / scale Redis**.
- Storage approaching plan limit → **upgrade tier / lifecycle old media**.

Cost model: right-size Fly VMs (`shared-cpu-1x`/512MB baseline), keep ≥1 warm for
money paths, prefer cache/edge over vertical DB scaling. Review cost monthly
(RUNBOOK maintenance cadence).

## 6. Secrets & config backup

- **Secret inventory:** enumerated in `docs/developer/ENVIRONMENT.md` (🔒 items).
  Runtime secrets are held in **Fly secrets** and Supabase; **not** in the repo.
- **Rotation:** schedule + procedure in `RUNBOOK.md` (secret rotation). Rotate on
  suspected exposure, staff offboarding, and at least periodically for
  payment/cron/admin secrets. `CRON_SECRET`, `ADMIN_SECRET_KEY`, provider creds,
  `UPSTASH_*`, and service-role key are the highest priority.
- **Terraform state:** stored in **Terraform Cloud** (remote, encrypted, locked,
  versioned) via `infra/terraform/backend.tf` — any prior state can be restored;
  concurrent applies can't corrupt it.
- **Config export:** `fly.toml`, `vercel.json`, `supabase/config`, and the
  Terraform files are version-controlled (this repo) — infra is reproducible from
  git + remote state.

## 7. DR checklist

- [x] PITR-backed backup policy with RPO ≤ 5 min / RTO ≤ 60 min documented.
- [x] Restore drill **procedure + automated integrity verifier** committed
      (`scripts/dr_restore_check.py`).
- [ ] **Live restore rehearsal executed** against a scratch project and logged in
      §3 (outstanding — needs prod backup access; remediation owner: DB on-call).
- [x] HA topology documented; prod action item: `min_machines_running ≥ 2`.
- [x] Capacity plan + scale triggers committed.
- [x] Secret inventory + rotation + Terraform state backup documented.
