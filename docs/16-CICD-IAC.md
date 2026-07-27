# Module 16 — CI/CD & Infrastructure as Code

> Status: ☑ delivered (code-complete). All six sub-milestones landed on `main`
> (see 16.1–16.6 commits): hardened CI, container + `fly.toml`, staging/prod
> delivery workflows, Terraform IaC, rollback workflow + runbook, and the
> release/feature-flag layer. Two gate items are **code-complete but require live
> infra to exercise**: the *first* staging auto-deploy and the *live* rollback
> drill both need the Fly apps + `FLY_API_TOKEN`/Cloudflare/Terraform-Cloud
> secrets provisioned (workflows + `docs/RUNBOOK.md` drill procedure are ready).
> Verified locally: `npm ci`, `vitest` (16 pass incl. 7 flag tests), `tsc
> --noEmit`, `next lint`, `pglast` migration-lint, and YAML/TOML/HCL syntax.
>
> Authoritative build-ready specification. It hardens the
> **existing** GitHub Actions pipeline (`.github/workflows/ci.yml`: quality →
> build → migrate-db) into a full lint → type-check → test → build → **deploy**
> flow with a promotion path (preview → staging → production), and codifies the
> runtime topology from `docs/01-ARCHITECTURE.md` (Cloudflare → Fly.io →
> Supabase) as version-controlled Infrastructure as Code with a documented,
> tested rollback strategy.

---

## 1. Objective & scope

Turn deployment from a partly-manual activity into a **repeatable, reviewable,
reversible** process:

1. **CI (quality gates):** every PR runs the full pyramid; `main` is always
   releasable.
2. **CD (delivery):** merges to `main` build an immutable image and deploy it to
   Fly.io; DB migrations run in a controlled, ordered step; deploys are health-
   gated with automatic rollback on failure.
3. **IaC:** Fly (`fly.toml`), Cloudflare (DNS, cache rules, WAF), Supabase
   (config + migrations), and CI/CD itself are declarative and code-reviewed —
   no console-only "snowflake" config.
4. **Environments:** clean separation of **preview** (per-PR), **staging**
   (pre-prod mirror), and **production**, each with its own secrets and Supabase
   project/branch.
5. **Rollback:** any release can be reverted in minutes (app image + DB) with a
   written, drilled runbook.

### Starting baseline (pre-Module 16, historical)
> The list below describes the pipeline **as it stood before Module 16 landed**.
> It is retained for historical context only and no longer reflects the repo.
> For the current state see **"Current state"** immediately below.

- `ci.yml` had three jobs: `quality` (npm ci → type-check → lint → unit tests),
  `build` (needs quality; builds with public env), and `migrate-db` (needs build;
  `main` only; `supabase link` + `supabase db push`).
- A `Dockerfile` and `docker-compose.yml` existed; **no `fly.toml`**, no Cloudflare
  IaC, no staging environment, no deploy job, no rollback automation.
- Migrations were forward-only SQL under `supabase/migrations/` (016 latest at the
  time), validated locally with `pglast`.
- Vercel deploy was intentionally dropped earlier; Fly.io is the app host.

### Current state
As of this writing the pipeline has been fully hardened and the IaC/CD surface is
in place. Verified against the tracked files:

- **CI (`.github/workflows/ci.yml`)** now runs 14 jobs, gated by a `changes`
  path-filter and aggregated by a required `CI green` (`ci-required`) job:
  `Detect changes`, `Lint`, `Type check`, `Unit tests`, `i18n check`, `Build`
  (with a first-load JS bundle-size budget), `Migration lint` (with a
  definer-exposure static gate), `Security scan` (npm audit + gitleaks secret
  scan), `Dependency review`, `Accessibility (axe)`, `Lighthouse CI`,
  `E2E (Playwright)`, `CLOB invariants (ephemeral PG)`, and `CI green`.
- **Delivery / ops workflows** exist as separate files under
  `.github/workflows/`: `deploy-staging.yml` (Deploy Staging),
  `deploy-production.yml` (Deploy Production), `rollback.yml`
  (Rollback Production), `terraform.yml` (Terraform), `image-scan.yml`
  (Image scan), `security-audit.yml` (Security audit — definer exposure),
  `load-test.yml` (Load test — k6), `release.yml` (Release), and
  `realtime-e2e.yml` (Realtime E2E — live).
- **`fly.toml` exists** at the repo root (Fly.io app host).
- **Cloudflare + Fly IaC** lives under `infra/terraform/` (`cloudflare.tf`,
  `fly.tf`, `main.tf`, `backend.tf`, `variables.tf`, `terraform.tfvars.example`,
  plus a README).
- Migrations remain forward-only SQL under `supabase/migrations/`; the latest is
  059 (`059_clob_lockdown_client_writes.sql`).

### Out of scope
- Application-level cache/CDN *behavior* → Module 15 (this module provisions the
  Cloudflare *rules* as IaC but does not tune TTLs).
- Feature/runtime secrets values → owned by ops in Fly/Supabase secret stores;
  this module manages their **declaration**, not their values.

---

## 2. Environments & promotion model

| Environment | Trigger | App (Fly) | Database (Supabase) | URL |
|---|---|---|---|---|
| **Preview** | per PR | ephemeral Fly app or PR-scoped machine | Supabase **branch** (or shared staging, read-guarded) | `pr-<n>.preview.kichiko…` |
| **Staging** | merge to `main` (auto) | `kichiko-staging` | staging project | `staging.kichiko…` |
| **Production** | manual promotion / tag `v*` | `kichiko-prod` | prod project | `app.kichiko…` |

Promotion is **image-based**: the exact artifact validated in staging is the one
promoted to production (no rebuild), guaranteeing parity. Production deploy
requires a manual approval (GitHub Environments protection rule) and runs
migrations before the app cutover.

**Migration ordering rule:** DB migrations are **expand-first / contract-later**
(backward compatible) so the new schema works with the *old* app during the
rollout window and the old schema works with the *new* app during rollback.
Destructive changes (drop column/table) ship a release *after* the code that
stopped using them.

---

## 3. Sub-milestones (commit-per-step; gate before merge)

### 16.1 — Pipeline hardening (CI)
- Split/confirm jobs: `lint`, `type-check`, `unit` (can run in parallel matrix),
  then `build`. Cache `npm` and the Next build cache for speed.
- Add **concurrency** groups (cancel superseded PR runs) and **path filters**
  where safe (docs-only changes skip heavy jobs).
- Add **DB migration lint**: a job that runs `pglast` parse over
  `supabase/migrations/*.sql` and checks filename ordering/monotonic numbering
  (the local check we already do, promoted to CI).
- Add **security scans**: `npm audit --audit-level=high`, dependency review, and
  a secret scanner (gitleaks) — non-blocking first, then blocking.
- **Gate:** all jobs green on a no-op PR; docs-only PR skips heavy jobs;
  migration-lint catches a deliberately malformed test migration.

### 16.2 — Container & Fly IaC
- Harden the `Dockerfile`: multi-stage (deps → build → runtime), Next
  **standalone** output, non-root user, pinned Node 20, minimal final image,
  `HEALTHCHECK` hitting `/api/health` (the endpoint from M13).
- Author **`fly.toml`**: app name, primary region (`jnb`/nearest EA region),
  internal port, `[http_service]` with health checks, `[[vm]]` sizing,
  autoscaling (min machines > 0 for prod to avoid cold starts on money paths),
  and `[env]` for non-secret config. Use Fly's **release_command** to run
  `supabase db push` (or a migrate step) before the app starts.
- Document `fly secrets set …` for every secret in `docs/01-ARCHITECTURE.md §4`
  (service-role key, payment secrets, `CRON_SECRET`, `ADMIN_SECRET_KEY`, Upstash,
  Sentry DSN) — values never in the repo.
- **Gate:** `docker build` succeeds locally; image runs and `/api/health` returns
  green; `fly.toml` validated (`fly config validate`).

### 16.3 — Continuous delivery (deploy jobs)
- Add a **deploy-staging** job (needs build; `main` only): builds/pushes the
  image, runs migrations via `release_command`, deploys with Fly's rolling/blue-
  green strategy, then a **post-deploy smoke** (curl `/api/health` + a couple of
  public GETs + the cron endpoints returning 401 without the secret).
- Add a **deploy-production** job gated by a **GitHub Environment** with required
  reviewers and a `v*` tag or manual dispatch; promotes the **same image** from
  staging (by digest).
- Deploy is **health-gated**: Fly only shifts traffic when health checks pass;
  otherwise it aborts and keeps the previous release serving.
- **Gate:** staging auto-deploys on merge; smoke passes; production requires
  approval and promotes by digest; a forced failing health check aborts cutover.

### 16.4 — Cloudflare & Supabase IaC (Terraform)
- Introduce `infra/terraform/` with providers for **Cloudflare** and **Fly**
  (and Supabase where the provider supports it). Manage: DNS records, cache
  rules + Tiered Cache + Brotli (the rules Module 15 specifies), WAF/rate-limit
  rules (M14 policy at the edge), and TLS settings.
- State stored remotely (e.g. Terraform Cloud or an R2/S3 backend) with locking;
  `plan` on PR (comment the diff), `apply` gated behind approval on `main`.
- Keep **Supabase** schema as the migration files (source of truth) + a checked-in
  `config.toml`; document project linking and the `schedule_kichiko_jobs()`
  one-time setup (from M12) per environment.
- **Gate:** `terraform validate` + `plan` clean in CI; a trivial DNS/cache-rule
  change round-trips through plan→apply on staging.

### 16.5 — Rollback strategy & runbook
- **App rollback:** document + script `fly releases` / `fly deploy --image
  <prev-digest>` (or `fly releases rollback`) to restore the previous machine
  image in minutes; wire a one-click "Rollback production" GitHub workflow
  (manual dispatch, environment-protected).
- **DB rollback:** because migrations are expand/contract and forward-only, the
  primary DB "rollback" is a **compensating forward migration** plus PITR
  (Supabase Point-in-Time Recovery) for data-loss incidents; document the exact
  steps, the RPO/RTO targets, and when to choose PITR vs compensating migration.
- **Config rollback:** Terraform `apply` of the previous commit (git revert) for
  Cloudflare/Fly config.
- **Runbook:** `docs/RUNBOOK.md` — deploy, promote, rollback, hotfix, incident,
  secret rotation, on-call escalation, and the "money-path freeze" procedure.
- **Gate:** a **rollback drill** performed on staging and documented (timestamps,
  who/what/verify); revert restores the prior release and health stays green.

### 16.6 — Release management & versioning
- Adopt semantic version tags (`vMAJOR.MINOR.PATCH`), auto-generated release
  notes from Conventional-Commit-style messages, and a `CHANGELOG.md`.
- Production deploy is tag-driven; each release records the image digest,
  migration head, and Terraform commit for full traceability (audit).
- Optional: **feature flags** (see §6) so risky features ship dark and enable via
  config, decoupling deploy from release.
- **Gate:** cutting a tag produces release notes + a promoted prod deploy; the
  release record ties image digest ↔ migration ↔ infra commit.

---

## 4. Pipeline topology (target)

```
PR opened ─▶ [lint] [type-check] [unit]  (parallel)
                     └─▶ [build] ─▶ [migration-lint] [security-scan]
                                   └─▶ (preview deploy, optional)

merge to main ─▶ [build image] ─▶ [deploy-staging]
                                   ├─ release_command: db migrate (staging)
                                   ├─ rolling/blue-green deploy
                                   └─ post-deploy smoke ✔

tag v* / manual ─▶ [approval gate] ─▶ [deploy-production]
                                       ├─ promote SAME image by digest
                                       ├─ release_command: db migrate (prod)
                                       ├─ health-gated cutover
                                       └─ smoke ✔  (else auto-abort/rollback)
```

---

## 5. Files introduced/changed (implementation map)

| Path | Purpose |
|---|---|
| `.github/workflows/ci.yml` | split jobs, caching, concurrency, migration-lint, security scans |
| `.github/workflows/deploy-staging.yml` | build image → migrate → deploy staging → smoke |
| `.github/workflows/deploy-production.yml` | approval-gated, digest-promotion, migrate, health-gated |
| `.github/workflows/rollback.yml` | manual dispatch app rollback to prior digest |
| `Dockerfile` | multi-stage, standalone, non-root, HEALTHCHECK |
| `fly.toml` | Fly app config, health checks, autoscale, release_command |
| `infra/terraform/{main,cloudflare,fly,variables,backend}.tf` | IaC for edge + host |
| `docs/RUNBOOK.md` | deploy/rollback/incident/rotation runbook |
| `docs/DEPLOYMENT.md` | environments, promotion, migration ordering rules |
| `CHANGELOG.md` | release history |
| `.github/environments` (settings) | required reviewers for production |

Required CI secrets (declared, values in GitHub/Fly): `FLY_API_TOKEN`,
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` (already
used), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TF_API_TOKEN`,
plus the public build vars already present.

---

## 6. Feature flags (deploy ≠ release)

- Lightweight flag layer (`lib/flags.ts`) reading from env + a `feature_flags`
  table (admin-editable via the M11 settings console), with a typed accessor and
  safe defaults. Enables dark launches, gradual rollout, and instant kill-switch
  for risky money paths — a cheaper "rollback" than redeploying.
- Flags are audit-logged (M13/M14) when toggled; RLS restricts writes to
  `settings:write` capability holders.
- **Gate:** a flag defaults off, can be toggled by an admin, gates a code path,
  and the toggle is audit-logged.

---

## 7. Cross-cutting concerns addressed

- **Version control:** trunk-based on `main`, protected branch, required checks,
  linear history, signed tags for releases.
- **Security:** least-privilege CI tokens, secret scanning, dependency review,
  no secrets in repo, environment-scoped approvals for prod, image provenance
  (digest pinning).
- **Reliability/HA:** health-gated rolling/blue-green deploys, min-instances for
  money paths, auto-abort on failed health checks.
- **DR/backups:** documented Supabase PITR, migration head tracking, IaC means
  the whole stack is reconstructable from git.
- **Observability:** deploys emit markers/annotations (release id → Sentry & logs)
  so regressions correlate to releases; smoke tests gate promotion.
- **Cost optimization:** build caching, path-filtered CI, right-sized Fly VMs,
  scale-to-min in non-prod.
- **Compliance/audit:** every prod change traces to an approved PR, a tag, an
  image digest, a migration head, and an infra commit.
- **Extensibility:** adding a new environment or region is a Terraform + workflow
  change, not a manual console ritual.

---

## 8. Testing strategy

- **Pipeline tests:** dry-run workflows on a throwaway branch; assert job graph,
  gates, and skip logic behave.
- **IaC:** `terraform validate` + `plan` in CI; a staged `apply` of a trivial
  change; drift detection job (scheduled `plan`).
- **Deploy verification:** post-deploy smoke (health + public GET + cron-auth
  401) blocks promotion; synthetic check after prod cutover.
- **Rollback drill:** scripted, timed rehearsal on staging, documented in the
  runbook (repeat quarterly).
- **DR drill:** restore-from-backup / PITR rehearsal documented (shared gate with
  Module 17 §DR).

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Migration breaks running app mid-deploy | expand/contract, backward-compatible migrations; release_command ordering |
| Failed deploy takes down prod | health-gated cutover; auto-abort keeps prior release live |
| Terraform state corruption/loss | remote backend with locking + versioning |
| Secret leakage in CI logs | masked secrets, gitleaks scan, least-privilege tokens |
| "Works on staging, breaks on prod" | promote the *same image by digest*, parity envs |
| Rollback needs untested path | mandatory quarterly rollback drill, one-click workflow |

---

## 10. Exit checklist (Gate for ☑)

- [x] CI: parallel lint/type-check/unit + build + migration-lint + security scan,
      all green; docs-only PRs skip heavy jobs.
- [x] `Dockerfile` multi-stage/standalone/non-root with `/api/health` HEALTHCHECK.
- [x] `fly.toml` committed & validated; migrations run as an ordered CI step
      before cutover (supabase CLI kept out of the runtime image).
- [~] Staging auto-deploy workflow + smoke ready; **first live run pending Fly
      app + secrets provisioning**.
- [x] Production deploy is approval-gated (GitHub Environment) and promotes the
      same image by digest.
- [x] Cloudflare + Fly IaC in `infra/terraform/`; `plan` on PR, gated `apply`.
- [~] One-click rollback workflow shipped + drill procedure/log in RUNBOOK;
      **live drill pending staging provisioning**.
- [x] `docs/RUNBOOK.md` + `docs/DEPLOYMENT.md` complete (deploy/rollback/rotate).
- [x] Semantic-version tags drive prod; `CHANGELOG.md` + release notes generated.
- [x] Feature-flag layer live (`lib/flags.ts`), admin-toggleable via settings
      console, audit-logged; env kill-switch override.
- [~] Green pipeline + documented rollback satisfied; end-to-end staging deploy
      is the final live-infra step (workflows ready).
