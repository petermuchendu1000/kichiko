# Kichiko — Deployment & Environments

> Companion to `docs/16-CICD-IAC.md` (design) and `docs/RUNBOOK.md` (operations).
> This document is the authoritative reference for **how code becomes a running
> production system**, the promotion model, migration ordering rules, and the
> local-environment hazards every contributor must know.

---

## 0. Local environment — read this first

### ⛔ NEVER run `npm audit fix --force`

`npm audit fix --force` will **downgrade Next.js** (observed: `15.5.19 → 9.3.3`,
then `16.x`) to "resolve" transitive advisories. This is catastrophic:

- Next 9 is the **Pages Router**; this app is the **App Router**, so
  `npm run dev` dies with `Couldn't find a 'pages' directory`.
- It removes ~1000 packages and rewrites the lockfile with incompatible versions.

The transitive CVEs surfaced by `npm audit` come almost entirely from **build-time
/ dev-only** dependency trees and are addressed the correct way in CI
(`.github/workflows/ci.yml` → `security` job: `npm audit --audit-level=high`,
dependency review, gitleaks). We remediate by **pinning/overriding specific
transitive versions** (npm `overrides`) — never by force-downgrading Next.

### If your local install is already broken

```bash
git restore package-lock.json apps/web/package.json   # revert any forced changes
rm -rf node_modules apps/web/node_modules              # nuke poisoned trees
npm ci                                                 # clean, lockfile-exact install
npm run dev                                            # back to App Router @ next 15
```

### Correct first-time setup

```bash
git clone https://github.com/petermuchendu1000/kichiko
cd kichiko
cp apps/web/.env.local.template apps/web/.env.local    # then fill in values
npm ci                                                 # NOT `npm install` for reproducibility
npm run dev
```

Use `npm ci` (lockfile-exact) rather than `npm install` in CI and for clean
setups so everyone builds the same dependency graph.

---

## 1. Environments & promotion model

| Environment | Trigger | App host (Fly) | Database (Supabase) | URL |
|---|---|---|---|---|
| **Preview** | per PR (optional) | ephemeral PR machine | staging branch (read-guarded) | `pr-<n>.preview.kichiko.…` |
| **Staging** | merge to `main` (auto) | `kichiko-staging` | staging project | `staging.kichiko.…` |
| **Production** | tag `v*` / manual dispatch (approval-gated) | `kichiko-prod` | prod project | `app.kichiko.…` |

**Image-based promotion.** The exact image validated on staging is the one
promoted to production — **promote by digest, never rebuild**. This guarantees
"what we tested is what we ship" parity.

**Production is approval-gated** via a GitHub *Environment* protection rule
(required reviewers). Migrations run **before** the app cutover
(`release_command`), and Fly only shifts traffic when health checks pass.

---

## 2. Migration ordering — expand / contract

Migrations are **forward-only** (`supabase/migrations/NNN_*.sql`) and MUST be
**backward compatible during a rollout window**:

1. **Expand** (release _n_): add columns/tables/indexes, backfill, dual-write.
   The *old* app keeps working against the new schema.
2. **Migrate reads/writes** (release _n_): new code uses the new shape.
3. **Contract** (release _n+1_, a **later** deploy): drop the now-unused
   columns/tables — only after no running code references them.

This ordering is what makes **rollback safe**: the old app image still runs
against the (expanded) schema, and the new schema still runs against the old app.

Never combine a destructive `DROP` with the same release that stops using the
object. See `docs/RUNBOOK.md` → "Rollback".

---

## 3. Pipeline overview

```
PR  ──▶ [lint] [type-check] [unit]  (parallel matrix)
              └▶ [build + bundle budget] ─▶ [migration-lint] [security]
                                          └▶ (preview deploy, optional)

merge → main ──▶ [build image] ─▶ [deploy-staging]
                                    ├─ release_command: supabase db push (staging)
                                    ├─ rolling / blue-green deploy
                                    └─ post-deploy smoke ✔

tag v* / dispatch ──▶ [approval gate] ─▶ [deploy-production]
                                          ├─ promote SAME image by digest
                                          ├─ release_command: supabase db push (prod)
                                          ├─ health-gated cutover
                                          └─ smoke ✔ (else auto-abort, prior release stays live)
```

Workflow files:

- `.github/workflows/ci.yml` — quality gates (every PR + `main`).
- `.github/workflows/deploy-staging.yml` — build → migrate → deploy → smoke.
- `.github/workflows/deploy-production.yml` — approval-gated digest promotion.
- `.github/workflows/rollback.yml` — one-click app rollback to a prior digest.

---

## 4. Secrets (declared here, values live in the platforms)

Never commit secret values. They are set via `fly secrets set …` (app runtime)
and GitHub *Environment/Repository secrets* (CI). Required:

| Secret | Used by | Where |
|---|---|---|
| `FLY_API_TOKEN` | deploy/rollback workflows | GitHub secrets |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` | migrations | GitHub secrets (per-env) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Terraform | GitHub secrets |
| `TF_API_TOKEN` | Terraform Cloud backend | GitHub secrets |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` | build | GitHub secrets |
| `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ADMIN_SECRET_KEY`, payment secrets, `UPSTASH_*`, `SENTRY_DSN` | app runtime | `fly secrets set` |

See `docs/01-ARCHITECTURE.md §4` for the full secret inventory and
`docs/RUNBOOK.md` for the rotation procedure.

---

## 5. Versioning & releases

- Semantic version tags `vMAJOR.MINOR.PATCH` drive production.
- Release notes are auto-generated from Conventional-Commit messages; history is
  kept in `CHANGELOG.md`.
- Every production release records **image digest ↔ migration head ↔ Terraform
  commit** for full auditability (see the release workflow output).
