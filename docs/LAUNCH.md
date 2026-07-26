# Kichiko — Launch Readiness & Go-Live

> Module 17.7. The go/no-go gate that flips Kichiko to production: the launch
> checklist, the staged (Kenya-first) rollout plan behind feature flags, the
> launch-day runbook, post-launch monitoring/alerts + on-call, and the ongoing
> maintenance cadence for long-term evolution. Operational procedures live in
> [`RUNBOOK.md`](./RUNBOOK.md); reliability program in [`DR.md`](./DR.md).

---

## 1. Go / no-go checklist

Status legend: ✅ done · 🟩 code/docs ready, needs a production action · ⛔ blocker.
Launch is **go** only when every item is ✅ or an accepted 🟩 with a named owner.

### Correctness & security
- 🟩 All prior module gates green (M1–M16); **M8 KYC live** and **M12 cron jobs
  scheduled** in prod (`job_runs` green). _Owner: eng lead — verify in prod._
- ✅ Security scans in CI: `npm audit` (baseline), **gitleaks blocking**,
  dependency-review, security headers. 🟩 RLS spot-audit sign-off before launch.
- 🟩 Payment providers switched to **production credentials** (`*_ENV=production`,
  live keys via `fly secrets`); webhook signatures verified end-to-end with a
  live 1-unit test deposit + withdrawal per provider. _Owner: payments._

### Performance & reliability (M15 / M16)
- ✅ Lighthouse CI + **first-load JS bundle budget** (blocking) in CI.
- ✅ Health-gated canary deploy + one-click rollback (proven via the quarterly
  rollback drill, RUNBOOK §4); staging↔prod parity (same image by digest).
- 🟩 **Multi-instance app**: set `min_machines_running ≥ 2` on `kichiko-prod`
  (staging ships 1). _Owner: infra._

### Accessibility & i18n (M17)
- ✅ axe a11y CI job (zero critical/serious on key pages); manual AA audit in
  `docs/a11y/AUDIT.md`.
- ✅ English catalog complete; **locale switch + `preferred_locale` persist**
  (migration 018, `/api/locale`); i18n integrity + pseudo-locale CI gates.

### DR & docs
- 🟩 **PITR enabled** in prod; **restore drill executed** and meeting RPO/RTO
  (procedure + verifier ready in `DR.md` §3; live rehearsal outstanding). _Owner: DB on-call._
- ✅ Capacity plan + scale triggers documented (`DR.md` §5).
- ✅ User + API + ops + legal docs published; `docs/INDEX.md` complete.
  🟩 Legal docs **counsel-reviewed** before public launch (currently templates).

### Launch ops
- 🟩 Monitoring dashboards + **alerts live** (error rate, payment success,
  deposit/withdraw latency, cron health via `job_runs`) — wired to M13 primitives
  (`/api/health`, structured logs, Sentry, web-vitals). _Owner: eng lead._
- ✅ On-call rota + launch-day runbook ready (this doc + RUNBOOK §8).
- ✅ Staged rollout plan (Kenya-first behind flags) — §2 below.
- ✅ Rollback & incident runbooks (RUNBOOK §3, §5); rehearsed quarterly.

> **Go/no-go meeting:** owners confirm their rows; the eng lead records the
> decision and timestamp here before cutover.

---

## 2. Staged rollout plan (Kenya-first, flag-gated)

Deploy ≠ release. We ship to prod dark, then widen exposure using the feature
flags in the admin settings console (`flags.*`, env-overridable as
`FLAG_*` kill-switches — see `apps/web/lib/flags.ts`).

| Phase | Audience | Config |
| --- | --- | --- |
| **0. Dark** | Team only | App in prod; deposits/withdrawals **off** (`FLAG_DEPOSITS_ENABLED=false`, `FLAG_WITHDRAWALS_ENABLED=false`); internal smoke only. |
| **1. Soft launch** | Small Kenya cohort (KES · M-Pesa/Airtel) | Enable deposits/withdrawals for the cohort; `market_creation_enabled` limited to trusted creators; monitor closely 24–48h. |
| **2. Kenya GA** | All Kenya | Widen; keep dark-launch flags (`new_market_ui`, `social_sharing`) **off**. |
| **3. EA expansion** | UG → TZ → RW → ZM → ET → BI | Enable per-country once that country's payment provider is verified in prod; one country at a time. |

**Kill-switches (instant, no redeploy):** set the env override to freeze a risky
path — e.g. `FLAG_WITHDRAWALS_ENABLED=false` during a payment incident. Prefer
the money-path freeze (RUNBOOK §7) for broader incidents.

**Promotion criteria between phases:** error rate within SLO, payment success
rate ≥ target, no unresolved SEV, cron/`job_runs` healthy, latency budgets met
for the full monitoring window.

---

## 3. Launch-day runbook

**T-1 day**
- Final go/no-go (§1). Freeze non-launch deploys. Confirm prod secrets set
  (`ENVIRONMENT.md`), providers in production mode, `min_machines_running ≥ 2`.
- Confirm PITR on and a restore drill has passed (`DR.md`).

**T-0 cutover**
1. Announce start in the incident/launch channel; on-call online.
2. Deploy the release image via the M16 pipeline (health-gated canary).
3. Verify `/api/health` green, key pages load, and a **live 1-unit deposit +
   withdrawal** succeeds per enabled provider.
4. Move to **Phase 1** by enabling the cohort flags. Start the monitoring window.

**During**
- Watch dashboards (§4). Any SEV → RUNBOOK §5; payment issue → freeze via flag
  (§2) or money-path freeze (RUNBOOK §7); bad release → rollback (RUNBOOK §3).

**T+1 / post**
- Widen per §2 promotion criteria. Hold a launch retro; log actions.

**Abort/rollback:** one-click app rollback (RUNBOOK §3.1); data incident → PITR
(RUNBOOK §3.2 / DR.md). When unsure, freeze money paths first.

---

## 4. Post-launch monitoring, alerts & on-call

Built on M13 observability: `/api/health` (per-dependency checks), structured
logs, Sentry error tracking (`SENTRY_DSN`), web-vitals RUM, and `job_runs`
job observability.

**Dashboards / alerts (must be live before Phase 1):**
| Signal | Alert condition (tune to SLO) |
| --- | --- |
| Error rate (5xx / Sentry) | spike above baseline for 5 min |
| Payment success rate | deposit/withdraw success < target |
| Deposit/withdraw latency | p95 breaches budget |
| API latency / availability | `/api/health` failing or p95 over SLO |
| Cron health | any `job_runs` failure or missed schedule |
| Web vitals | LCP/INP/CLS regressions past thresholds |
| Infra | Fly machine health, CPU/mem, Redis latency, DB pooler saturation |

**On-call:** rota + escalation in RUNBOOK §8. Launch week: primary + secondary
on-call, faster response target, daily health check-in.

---

## 5. Maintenance & long-term evolution

A recurring cadence so the system keeps evolving safely (not a one-time launch):

| Cadence | Activity |
| --- | --- |
| **Continuous** | Dependabot PRs (`.github/dependabot.yml`) — npm/actions/docker, weekly + immediate security; CI gates every one. |
| **Weekly** | Triage Dependabot + security advisories; review error/alert trends; cron/`job_runs` review. |
| **Monthly** | Tech-debt triage (incl. the `jsx-a11y` warn-level items tracked in `docs/a11y/`); **cost review** (Fly VMs, Supabase, Redis, egress — DR.md §5); dependency major-version planning. |
| **Quarterly** | **Rollback drill** (RUNBOOK §4) and **restore drill** (DR.md §3); capacity re-projection from fresh k6 runs; secret rotation review (RUNBOOK §6); roadmap grooming. |
| **As needed** | Security patching (out-of-band for criticals); incident postmortems → action items; per-country expansion readiness. |

**Technical-debt register:** track known debt where it's actionable — a11y
warn-level rules (`docs/a11y/`), incremental i18n string extraction beyond key
pages (`docs/i18n/TRANSLATION.md`), and any 🟩 items from §1 until closed. Each
gets an owner and is reviewed in the monthly triage.

**Extensibility:** new locales are one config line + a catalog file
(`TRANSLATION.md`); new feature flags inherit the console UI + audit trail; new
endpoints follow the API/coding standards and must update `docs/api/`. This keeps
long-term change cheap and safe.

---

## 6. Sign-off

| Role | Name | Go/No-go | Date |
| --- | --- | --- | --- |
| Engineering lead | | | |
| Payments | | | |
| Infra / DB on-call | | | |
| Compliance / legal | | | |

Record the final decision and timestamp here at the go/no-go meeting.
