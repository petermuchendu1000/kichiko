# Module 17 — Accessibility, i18n, Documentation, Launch & DR

> Status: ☑ complete (17.1–17.7 committed to `main`; live restore rehearsal is
> the one operational item pending prod access — see `docs/DR.md` §3 and
> `docs/LAUNCH.md` §1). Authoritative build-ready specification for the launch-
> readiness module: a WCAG 2.1 AA accessibility pass, East-Africa localization &
> internationalization scaffolding, complete product/ops documentation, a
> disaster-recovery + backup program with a rehearsed restore drill, and the
> go-live checklist that flips Kichiko to production. It builds on M13
> (observability), M14 (security), M15 (performance) and M16 (CI/CD & IaC).

---

## 1. Objective & scope

Ship a product that is **usable by everyone, in every target market, operable by
the team, and safe to run in production** — then launch it deliberately.

Five workstreams:

1. **Accessibility (a11y)** — WCAG 2.1 AA across all user journeys.
2. **i18n / localization (l10n)** — framework + English baseline + EA locale
   scaffolding (currency/number/date already partly handled by `lib/currency.ts`
   `CURRENCY_META` locales; extend to UI strings & formatting).
3. **Documentation** — user, developer, API, and operations docs consolidated.
4. **DR / backups / HA** — backup policy, PITR, restore drill, capacity plan.
5. **Launch** — staged rollout, go-live checklist, post-launch monitoring, and a
   maintenance/technical-debt cadence for long-term evolution.

### Current baseline
- Tailwind mobile-first UI, custom SVG icon system, skeletons, dark-mode-aware
  design; several components have `react-hooks/exhaustive-deps` warnings (lint)
  but no systematic a11y audit yet.
- `CURRENCY_META` already carries per-currency `locale`/`decimals` and
  `formatCurrency()` is locale-aware — a strong l10n foundation for money; **UI
  copy is hardcoded English**, no `next-intl`/`next-i18next`, no RTL.
- Docs exist per module (`docs/00`–`16`) but there is no consolidated user guide,
  API reference, or DR runbook (DR runbook is shared with M16 §5).
- Supabase provides managed backups; **no documented restore drill, RPO/RTO, or
  capacity plan** yet.

### Out of scope
- New product features. This module is quality, reach, safety, and launch — not
  scope expansion.

---

## 2. Sub-milestones (commit-per-step; gate before merge)

### 17.1 — Accessibility foundation & automated gates
- Add automated a11y testing: `@axe-core/playwright` in E2E for every key page,
  `eslint-plugin-jsx-a11y` in lint, and (optional) `pa11y-ci`/Lighthouse a11y in
  CI. Establish a baseline report under `docs/a11y/`.
- Fix the low-hanging systemic issues: document language (`<html lang>`), landmark
  regions (`header/nav/main/footer`), skip-to-content link, page `<title>`s, and
  focus-visible styles.
- **Gate:** axe reports **zero critical/serious** violations on key pages;
  `jsx-a11y` lint clean; baseline committed.

### 17.2 — Accessibility deep pass (WCAG 2.1 AA)
- **Keyboard:** every interactive element reachable & operable; visible focus
  order; no keyboard traps; modals/dialogs (Radix already used) trap+restore
  focus and close on Esc.
- **Screen readers:** correct roles/names/values; `aria-label`/`aria-describedby`
  on icon-only buttons; live regions for async updates (toasts, balance changes,
  bet confirmations); form errors programmatically associated.
- **Color & contrast:** ≥ 4.5:1 text / 3:1 large text & UI; never color-only for
  meaning (Yes/No market outcomes, P&L up/down get icon+text, not just green/red);
  verify in both light and dark themes.
- **Motion & zoom:** respect `prefers-reduced-motion`; 200% zoom & 320px reflow
  without loss; touch targets ≥ 44px (mobile-first EA users).
- **Charts (Recharts):** accessible alternatives — tabular data fallback / aria
  summaries for price history & portfolio charts.
- **Gate:** manual audit checklist (keyboard + VoiceOver/NVDA + zoom/reflow +
  contrast) signed off per key journey; documented in `docs/a11y/AUDIT.md`.

### 17.3 — i18n framework & English extraction
- Adopt **`next-intl`** (App-Router native): locale routing/segment, message
  catalogs (`messages/en.json`), typed message keys, and server+client message
  access. Default locale `en`; structure ready for `sw` (Swahili), `fr`
  (Burundi/Rwanda), `am` (Ethiopia).
- **Extract all hardcoded UI strings** into `messages/en.json` (ICU MessageFormat
  for plurals/gender/interpolation). Provide a lint/CI check for missing keys and
  untranslated literals.
- Centralize **formatting**: dates/times via `Intl.DateTimeFormat` in the user's
  locale + timezone (EA is `Africa/Nairobi` etc.), numbers/currency via the
  existing `formatCurrency`/`CURRENCY_META`. Remove ad-hoc `toLocaleString()`
  calls in favor of shared formatters.
- **Gate:** app renders fully from the `en` catalog (no hardcoded strings on key
  pages); missing-key check green; locale switch mechanism in place (even if only
  `en` is fully translated at launch).

### 17.4 — Localization scaffolding & pseudo-locale
- Ship a **pseudo-locale** (`en-XA`) build to surface hard-coded strings,
  truncation, and concatenation bugs; wire it as an optional dev/CI check.
- Provide the **translation workflow**: catalog structure, contributor guide,
  and a stub `sw.json` (Swahili) with high-value strings (auth, wallet, betting,
  errors) as the first real target market beyond English.
- Add **locale-aware SEO** (`hreflang`, localized `<title>`/meta) and ensure the
  currency/locale selection persists (profile `preferred_currency` already
  exists; add `preferred_locale`).
- Handle **RTL-readiness** (logical CSS properties) even though current target
  locales are LTR, to keep future Arabic/others cheap.
- **Gate:** pseudo-locale reveals no layout breakage on key pages; `sw` stub
  loads; `preferred_locale` persists per user (migration + profile UI).

### 17.5 — Documentation consolidation
- **User docs** (`docs/user/` or an in-app Help): getting started, deposit/
  withdraw (mobile money), how betting/LMSR pricing works in plain language,
  portfolio & P&L, KYC, notifications, responsible-play & fees.
- **Developer docs:** consolidated architecture (link `01`), local setup, env
  matrix, testing, contribution guide, coding standards, migration conventions.
- **API reference:** document every public/route-handler endpoint (method, auth,
  params, responses, rate limits, cache policy) — generate from a checked-in
  OpenAPI spec where feasible; include the cron endpoints (M12) and webhooks.
- **Ops/runbook:** merge with M16 `docs/RUNBOOK.md` — incident response, secret
  rotation, scaling, on-call, money-path freeze, and the DR procedures below.
- **Compliance/privacy:** privacy policy, terms, data-retention & data-subject-
  request process, KYC/AML posture, cookie disclosure — reviewed for EA
  jurisdictions.
- **Gate:** `docs/INDEX.md` links a complete set; a new engineer can go from
  clone → running locally using only the docs (dry-run reviewed); API reference
  covers 100% of public endpoints.

### 17.6 — DR, backups, HA & capacity planning
- **Backup policy:** confirm Supabase automated backups + **PITR** enabled on
  prod; define **RPO ≤ 5 min** and **RTO ≤ 60 min** targets; document backup
  cadence, retention, and encryption-at-rest.
- **Restore drill:** perform an actual **restore-from-backup / PITR rehearsal**
  into a scratch project; verify data integrity (row counts, a `place_bet` +
  `resolve_market` sanity check, wallet-balance invariants), and record
  timings vs RTO/RPO in `docs/DR.md`.
- **HA/redundancy:** Fly multi-machine (≥2) for the app with health-gated
  rolling deploys (M16); document DB failover expectations (Supabase managed);
  Cloudflare in front for edge resilience.
- **Capacity plan:** load-test-informed (reuse M15 k6) projections for users/
  markets/bets/day; DB connection budget (pooler), storage growth (KYC media),
  and cost model; define scale-up triggers and headroom.
- **Backup of secrets & config:** documented secret inventory + rotation
  schedule; Terraform state backup (M16); export of critical config.
- **Gate:** restore drill executed & documented (meets RPO/RTO or gaps noted with
  remediation); capacity plan + scale triggers committed; HA config verified.

### 17.7 — Launch readiness & go-live
- **Pre-launch checklist** (§5): security scan clean, all budgets (M15) met,
  pipeline/rollback (M16) proven, a11y AA, legal docs published, monitoring &
  alerts live (M13), payment providers in production mode, KYC (M8) live.
- **Staged rollout:** soft launch / limited cohort or single-country (Kenya)
  first behind feature flags (M16 §6); monitor; then widen to other EA markets.
- **Post-launch:** dashboards + alerts (error rate, payment success, deposit/
  withdraw latency, cron health via `job_runs`), an on-call rota, and a
  **launch-day runbook**.
- **Maintenance & long-term evolution:** a recurring cadence for dependency
  updates (Renovate/Dependabot), tech-debt triage, security patching,
  cost review, and roadmap grooming — so the system keeps evolving safely.
- **Gate:** go/no-go checklist fully green and signed off; staged rollout plan
  documented; post-launch monitoring + on-call live.

---

## 3. Files introduced/changed (implementation map)

| Path | Purpose |
|---|---|
| `apps/web/messages/en.json` (+ `sw.json` stub) | i18n message catalogs (ICU) |
| `apps/web/i18n/*` , `middleware` update | `next-intl` config, locale routing |
| `apps/web/lib/format.ts` | centralized date/number/currency formatters |
| `supabase/migrations/018_preferred_locale.sql` | `profiles.preferred_locale` |
| `apps/web/**` | a11y fixes: landmarks, labels, focus, contrast tokens |
| `e2e/a11y.spec.ts` | `@axe-core/playwright` checks on key pages |
| `.github/workflows/ci.yml` | jsx-a11y lint, axe/pa11y, missing-i18n-key, pseudo-locale |
| `docs/a11y/{BASELINE,AUDIT}.md` | accessibility reports |
| `docs/user/*`, `docs/API.md`, `docs/INDEX.md` | user + API + index docs |
| `docs/DR.md` | backup policy, restore drill, RPO/RTO, capacity plan |
| `docs/LAUNCH.md` | go-live checklist, staged rollout, launch runbook |
| `docs/COMPLIANCE.md`, `PRIVACY.md`, `TERMS.md` | legal/compliance |
| `renovate.json` / dependabot config | maintenance automation |

---

## 4. Standards & targets

| Area | Standard / target |
|---|---|
| Accessibility | **WCAG 2.1 Level AA**; zero axe critical/serious on key pages |
| Contrast | ≥ 4.5:1 text, ≥ 3:1 large text/UI (light + dark) |
| Touch targets | ≥ 44×44 px |
| i18n | 100% of key-page UI strings externalized; ICU MessageFormat; locale+tz-aware formatting |
| Locales | `en` full at launch; `sw` stub; `fr`/`am` scaffolded |
| RPO / RTO | ≤ 5 min / ≤ 60 min (prod DB) |
| Docs coverage | 100% public endpoints; clone→run from docs only |
| Availability target | 99.9% app (post-launch SLO) |

---

## 5. Go-live checklist (Gate for launch)

**Correctness & security**
- [ ] All prior module gates ☑ (incl. M8 KYC live, M12 jobs scheduled).
- [ ] Security header scan + `npm audit` + gitleaks clean; RLS spot-audit passed.
- [ ] Payment providers in **production** credentials; webhook signatures verified.

**Performance & reliability (M15/M16)**
- [ ] Lighthouse mobile ≥ target on key pages; bundle/latency budgets met.
- [ ] Health-gated deploy + one-click rollback proven; staging↔prod parity.
- [ ] Multi-instance app; cron jobs healthy (`job_runs` green).

**Accessibility & i18n (this module)**
- [ ] axe zero critical/serious; manual AA audit signed off.
- [ ] English catalog complete; locale switch + `preferred_locale` persist.

**DR & docs**
- [ ] PITR enabled; **restore drill executed** and meets RPO/RTO.
- [ ] Capacity plan + scale triggers documented.
- [ ] User + API + ops + legal docs published; `docs/INDEX.md` complete.

**Launch ops**
- [ ] Monitoring dashboards + alerts live (error rate, payments, cron, latency).
- [ ] On-call rota + launch-day runbook ready.
- [ ] Staged rollout plan (Kenya-first behind flags) approved.
- [ ] Rollback & incident runbooks rehearsed.

---

## 6. Cross-cutting concerns addressed

- **Accessibility:** the whole module's first pillar — automated + manual AA.
- **i18n/l10n:** framework + EA locale reach; builds on existing currency/locale
  metadata; timezone-correct formatting (`Africa/Nairobi` etc.).
- **Compliance & privacy:** legal docs, data-retention, DSR process, KYC/AML
  posture for EA jurisdictions.
- **DR / backups / HA / capacity:** rehearsed restore, RPO/RTO, multi-instance,
  cost-aware capacity plan.
- **Documentation:** user, dev, API, ops consolidated and index-linked.
- **Maintenance & technical-debt / long-term evolution:** dependency automation,
  tech-debt triage cadence, SLOs, post-launch review loop.
- **Observability/alerting:** launch dashboards & alerts wired to M13 primitives.
- **Deployment/release/rollback:** launch executed through the M16 pipeline with
  staged rollout and flags.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| a11y regressions creep back in | axe in E2E + jsx-a11y lint as blocking gates |
| Hardcoded strings re-introduced | missing-key + no-literal CI check; pseudo-locale run |
| Untested backups ("Schrödinger's backup") | mandatory, documented restore drill; repeat quarterly |
| Launch overload / thundering herd | staged rollout, feature flags, capacity headroom, edge cache |
| Legal/compliance gaps in EA markets | counsel-reviewed policies before public launch |
| Docs rot after launch | docs owned per module; PR template requires doc updates |

---

## 8. Testing strategy

- **Automated a11y:** axe-core in Playwright across key journeys (blocking).
- **Manual a11y:** keyboard-only + screen-reader (VoiceOver/NVDA) + 200% zoom +
  320px reflow + contrast audit, checklisted per journey.
- **i18n:** missing-key check, pseudo-locale layout check, formatter unit tests
  (date/number/currency per locale+tz).
- **DR:** live restore-from-backup rehearsal with integrity assertions.
- **Launch:** synthetic monitors + smoke on prod post-cutover; alert firing test.
- **Regression:** all of the above wired into CI so quality is durable, not a
  one-time launch event.
