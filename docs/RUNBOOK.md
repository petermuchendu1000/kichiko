# Kichiko — Operations Runbook

> On-call, deploy, promote, rollback, incident, secret-rotation, and
> money-path-freeze procedures (Module 16.5). Companion to `docs/DEPLOYMENT.md`
> (design/promotion) and `docs/16-CICD-IAC.md` (module spec).

**Targets:** RTO (app) ≤ 10 min · RTO (DB, PITR) ≤ 60 min · RPO ≤ 5 min.

---

## 1. Quick reference

| Situation | Action | Where |
|---|---|---|
| Ship to staging | merge to `main` | auto (`deploy-staging.yml`) |
| Ship to production | cut tag `vX.Y.Z` or run *Deploy Production* | approval-gated |
| Bad prod release | run **Rollback Production** (`target: previous`) | `rollback.yml` |
| Data incident | PITR restore / compensating migration | Supabase + `supabase/migrations` |
| Config/edge broke | `git revert` infra commit → Terraform apply | `terraform.yml` |
| Abuse / attack | raise CF rate limits / WAF, or freeze money paths | `infra/terraform` + flags |
| Leaked secret | rotate + redeploy (see §6) | Fly/Supabase/GitHub |

---

## 2. Deploy & promote

**Staging (automatic).** Every merge to `main` runs `deploy-staging.yml`:
ordered `supabase db push` (staging) → build & push immutable image → canary
health-gated deploy → `scripts/smoke.sh`. A failed smoke fails the run and
**blocks any promotion**.

**Production (gated).** Cut a semver tag or run *Deploy Production* manually:
1. Approve the `production` GitHub Environment prompt (required reviewer).
2. The workflow pins the **staging image by digest**, runs the ordered prod
   migration, does a **blue/green** health-gated cutover, then smoke.
3. On failure Fly aborts the cutover — the prior release keeps serving.

Never hand-run `flyctl deploy` against prod outside these workflows (breaks
provenance and the digest-parity guarantee).

---

## 3. Rollback

### 3.1 App rollback (fast path, minutes)
Run the **Rollback Production** workflow (`rollback.yml`), `target: previous`
(or an explicit prior image ref). It restores the previous Fly release and
re-runs smoke. Approved via the `production` environment. Because migrations are
**expand/contract + forward-only**, the previous image is schema-compatible with
the current DB — no DB change needed for a code rollback.

Manual equivalent (break-glass):
```bash
flyctl releases --app kichiko-prod            # find the good version/digest
flyctl releases rollback --app kichiko-prod --yes
# or: flyctl deploy --app kichiko-prod --image <registry.fly.io/...@sha256:...> --strategy immediate
```

### 3.2 Database rollback
There is **no destructive down-migration**. Choose:
- **Compensating forward migration** (preferred for schema mistakes): write a
  new `NNN_*.sql` that corrects the change, run it through CI migration-lint and
  the normal deploy. Never edit an already-applied migration.
- **PITR** (Supabase Point-in-Time Recovery — for *data* loss/corruption):
  restore to a timestamp just before the incident. RPO ≤ 5 min. This is
  disruptive (restores whole DB) — declare an incident, freeze money paths (§7)
  first, communicate, then restore. Verify with `/api/health` + spot checks.

Decision rule: schema-only mistake → compensating migration. Data
loss/corruption → PITR. When unsure, freeze money paths and page the DB owner.

### 3.3 Config / edge rollback
`git revert` the offending `infra/terraform` commit and merge → gated Terraform
`apply` restores the prior Cloudflare/Fly state. For an emergency, `terraform
apply` a known-good commit locally against the shared state (last resort).

---

## 4. Rollback drill (quarterly — REQUIRED gate)

Rehearse on **staging** and record it here.

Procedure:
1. Note current staging release: `flyctl releases --app kichiko-staging`.
2. Deploy a trivial, obviously-different change to staging.
3. Run *Rollback Production* pointed at the staging app (or `flyctl releases
   rollback --app kichiko-staging`).
4. Confirm the previous version serves and `scripts/smoke.sh` passes.
5. Record: date, operator, start/verify timestamps, elapsed, notes.

### Drill log
| Date (UTC) | Env | Operator | Start → Verified | Elapsed | Result | Notes |
|---|---|---|---|---|---|---|
| _bootstrap_ | staging | _ops_ | procedure authored | — | ☐ pending first live drill | Run on first staging deploy after Module 16 lands |

> First live drill is scheduled with the first real staging deploy (needs Fly
> apps + `FLY_API_TOKEN` provisioned). Update this table with real timestamps.

---

## 5. Incident response (SEV)

1. **Declare** in the incident channel; assign an Incident Commander.
2. **Assess** blast radius via `/api/health`, logs (request IDs, Module 13),
   and error tracking. Is money movement affected? If yes → **freeze (§7)**.
3. **Mitigate** with the fastest safe lever: app rollback (§3.1), feature-flag
   kill-switch (`lib/flags.ts`), or edge WAF/rate-limit tightening.
4. **Fix forward** once stable; avoid risky hotfixes mid-incident.
5. **Verify** with smoke + targeted checks; unfreeze.
6. **Post-mortem** (blameless) within 48h; file follow-up issues.

---

## 6. Secret rotation

Secrets live in Fly (runtime), Supabase (DB), and GitHub (CI) — never in git.
```bash
# App/runtime secret (triggers a rolling restart with the new value):
flyctl secrets set SENTRY_DSN=... CRON_SECRET=... --app kichiko-prod
# CI secret: update in GitHub → Settings → Secrets (repo/Environment).
# Supabase service-role/DB password: rotate in Supabase dashboard, then update
#   the corresponding Fly + GitHub secrets and redeploy.
```
Rotate immediately on suspected leak (gitleaks in CI catches commits). After
rotating, redeploy so all machines pick up the new values, then invalidate old
sessions/tokens if the auth signing key changed.

---

## 7. Money-path freeze

When financial integrity is at risk (payment provider incident, suspected fraud,
mid-PITR), disable money movement without a full outage:
1. Toggle feature flags off (admin settings console → Feature flags):
   `flags.deposits_enabled`, `flags.withdrawals_enabled` (and
   `flags.market_creation_enabled` if needed). Changes are audit-logged (M11/M14).
2. Or set `maintenance.enabled = true` for a full read-only freeze with a banner
   (`maintenance.message`).
3. Announce via the admin announcements console.
4. Unfreeze only after root cause is contained and verified.

---

## 8. On-call escalation

1. **Primary on-call** acknowledges within 15 min.
2. No ack in 15 min → **secondary**.
3. Payments/DB data-loss or security → page the **owner** immediately and open a
   SEV1. Keep a written timeline (feeds the post-mortem).
