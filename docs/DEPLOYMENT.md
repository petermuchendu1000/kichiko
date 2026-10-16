# Elopis — Deployment & Environments

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
git clone https://github.com/petermuchendu1000/elopis
cd elopis
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
| **Preview** | per PR (optional) | ephemeral PR machine | staging branch (read-guarded) | `pr-<n>.preview.elopis.…` |
| **Staging** | merge to `main` (auto) | `elopis-staging` | staging project | `staging.elopis.…` |
| **Production** | tag `v*` / manual dispatch (approval-gated) | `elopis-prod` | prod project | `app.elopis.…` |

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

### Turning on Google sign-in

The button is already built and shipped (`components/auth/google-button.tsx`,
on the login page, the register page and the in-context auth dialog). It reads
`GET /auth/v1/settings` and renders **only** when GoTrue reports the provider
enabled, so there is no build flag and no redeploy: enable the provider and the
button appears on the next page load.

What is left is the part that needs a Google account:

1. **Google Cloud Console** → APIs & Services → Credentials → *Create
   credentials* → *OAuth client ID* → Web application.
2. Authorised redirect URI — this must be **Supabase's** callback, not ours,
   because GoTrue is what Google redirects to:
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
   (`<project-ref>` is the subdomain of the project's API URL.)
3. Configure the OAuth consent screen (app name, support email, logo, the
   `email` and `profile` scopes). A public app needs verification before it
   leaves the 100-user test cap.
4. Paste the client ID and secret into Supabase → Authentication → Providers →
   Google, and enable it. By API:
   ```bash
   curl -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"external_google_enabled":true,
          "external_google_client_id":"…",
          "external_google_secret":"…"}'
   ```

Our own `/auth/callback` route already exchanges the returned `?code` for a
session and honours `?next`, so an OAuth sign-in lands exactly where an email
sign-in would have. Nothing else to wire.

One consequence worth knowing before enabling: a Google account whose address
matches an existing email account will, by default, link to it. That is usually
what people expect, and it is also why the Google address must be verified,
which Google guarantees.

---

### ⛔ Deploying by hand: the three build args are not optional

The `NEXT_PUBLIC_*` row above says **build**, and that word is load-bearing.
`next build` bakes those three values into the bundle; nothing reads them from
the environment at runtime. A Fly secret of the same name **cannot** repair an
image that was built without them — and all three are set as Fly secrets, which
makes it look like they are covered.

CI passes them (`deploy-staging.yml`). A hand-run deploy must too:

```bash
flyctl deploy --app elopis-prod --strategy rolling \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_APP_URL="https://elopis.com"
```

Omit them and the build still succeeds and the image still starts; then
`middleware.js` throws *"Your project's URL and Key are required to create a
Supabase client!"* on every request, including `/api/health`. Because the
health check never passes, the rolling deploy replaces each machine and leaves
none serving. On 2026-10-16 that took elopis.com down for about eight minutes,
recovered by redeploying the previous image by digest:

```bash
flyctl deploy --app elopis-prod --image registry.fly.io/elopis-prod:deployment-<ID> --strategy rolling
```

`flyctl releases --app elopis-prod` lists the IDs. The Dockerfile now fails the
build when any of the three is empty, so this specific mistake costs a red
build instead of an outage — but the rollback command above is still the first
move if a release ever starts failing its health check.

---

## 5. Versioning & releases

- Semantic version tags `vMAJOR.MINOR.PATCH` drive production.
- Release notes are auto-generated from Conventional-Commit messages; history is
  kept in `CHANGELOG.md`.
- Every production release records **image digest ↔ migration head ↔ Terraform
  commit** for full auditability (see the release workflow output).
