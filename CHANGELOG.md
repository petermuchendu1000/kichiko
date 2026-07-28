# Changelog

All notable changes to Kichiko are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/). Production releases are cut as
`vMAJOR.MINOR.PATCH` git tags; per-release notes are auto-generated from
Conventional-Commit messages by `.github/workflows/release.yml`.

## [Unreleased]

### Added
- **CI/CD & IaC (Module 16).** Hardened pipeline (parallel lint/type-check/unit
  → build, concurrency, path filters, migration-lint, security scans);
  monorepo-aware multi-stage non-root `Dockerfile` with `/api/health`
  HEALTHCHECK; `fly.toml` with health-gated deploys; staging (auto) and
  production (approval-gated, digest-promotion) delivery workflows with
  post-deploy smoke; Cloudflare + Fly Terraform IaC (`infra/terraform/`);
  one-click rollback workflow; feature-flag layer (`lib/flags.ts`, env override
  → DB → default) with two dark-launch flags; tag-driven releases + this
  changelog.

### Fixed
- **Currency — KES converts at the real-time market rate, not a "1 USD = 100 KES"
  peg.** The platform hardcoded `KES→USD = 0.01` (via `SHARE_PAYOUT_KES` /
  `KES_SETTLEMENT_RATE`), excluded KES from the live FX cron
  (`PEGGED_CURRENCIES`), and seeded a `pilot-peg-ksh100` `exchange_rates` row —
  mispricing every KES↔USD conversion by ~29% vs the real market (~129 KES/USD).
  KES is now a first-class market currency: fetched, inverted and upserted live
  on every `update-exchange-rates` cycle exactly like UGX/TZS/etc.; the fallback
  bootstrap (`fx-fallback.json`) and all call sites (`page.tsx`, admin money,
  campaign/marketer forms) convert via `localToUsd`/`usdToLocal` at the live
  rate. The internal unit stays true USD (one share settles at $1); the local
  per-share payout is derived at the live rate (~KSh 129) instead of a hardcoded
  KSh 100, and the landing-page explainer copy interpolates it dynamically.
  DB reversal: migration `067_kes_realtime_fx` (reverses `038_kes_peg_ksh100`).
- **Auth — email sign-in delivers a 6-digit code, not a magic link.** Added a
  branded `magic_link` email template rendering `{{ .Token }}` and wired it in
  `supabase/config.toml` (`otp_length=6`, `otp_expiry=3600`); the in-dialog
  `requestCode()` now omits `emailRedirectTo` so GoTrue never mints a link.
- **UI — overlay focus.** Full-screen modal scrims (sign-in/up, share-chart,
  market drawer, mobile trade sheet) now apply a subtle `backdrop-blur-sm`.
- **CI — Dependency review is fully green and still enforcing (M6).** Enabled
  the repo Dependency graph + Dependabot alerts and replaced the job-level
  `continue-on-error` with an availability probe: the review enforces
  `fail-on-severity: high` when the graph is available and skips gracefully
  (green, non-fatal) only when it is genuinely unavailable.
- Enable Next.js `output: 'standalone'` (+ `outputFileTracingRoot`) so container
  builds/deploys produce a runnable image (the Dockerfile referenced
  `.next/standalone` which was never emitted).

### Docs
- `docs/DEPLOYMENT.md`, `docs/RUNBOOK.md`, `infra/terraform/README.md`; explicit
  "never run `npm audit fix --force`" hazard + local recovery guidance.

---

<!--
Release entries below are appended per tag. Example:

## [v1.0.0] - 2026-07-03
### Added
- ...
-->
