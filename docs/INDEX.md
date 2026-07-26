# Kichiko — Documentation Index

> Module 17.5. The single entry point to all Kichiko documentation: users,
> developers, API, operations, compliance, and per-module design specs. If you're
> new, start with **Getting started** (users) or **Developer setup** (engineers).

## 👤 For users
- [User guide (start here)](./user/README.md)
- [How betting & pricing works (LMSR)](./user/how-betting-works.md)
- [Deposits & withdrawals (mobile money)](./user/deposits-withdrawals.md)
- [Portfolio & profit/loss](./user/portfolio-and-pnl.md)
- [Identity verification (KYC)](./user/kyc.md)
- [Notifications](./user/notifications.md)
- [Responsible play & fees](./user/responsible-play-and-fees.md)

In-app: `/help`, `/legal/terms`, `/legal/privacy`, `/legal/responsible-play`.

## 🛠️ For developers
- [Local setup: clone → running](./developer/SETUP.md)
- [Environment variable matrix](./developer/ENVIRONMENT.md)
- [Testing strategy](./developer/TESTING.md)
- [Contributing guide](./developer/CONTRIBUTING.md)
- [Coding standards](./developer/CODING-STANDARDS.md)
- [Migration conventions](./developer/MIGRATIONS.md)
- [Translation & i18n workflow](./i18n/TRANSLATION.md)
- Project overview: [`README.md`](../README.md)

## 🔌 API
- [API reference (all 64 endpoints)](./api/README.md)
- [OpenAPI spec (public + user)](./api/openapi.yaml)

## ♿ Accessibility
- [A11y baseline](./a11y/) · [Manual audit checklist](./a11y/AUDIT.md)

## 🚀 Operations & reliability
- [Deployment & environments](./DEPLOYMENT.md)
- [Operations runbook (on-call, incident, secret rotation, money-path freeze)](./RUNBOOK.md)
- [Disaster recovery, backups & capacity](./DR.md) _(Module 17.6)_
- [Launch readiness & go-live](./LAUNCH.md) _(Module 17.7)_

## ⚖️ Compliance & privacy
- [Privacy policy](./legal/privacy.md)
- [Terms of service](./legal/terms.md)
- [Responsible play](./legal/responsible-play.md)
- [Data retention](./legal/data-retention.md)
- [Data-subject requests (DSR)](./legal/data-subject-requests.md)
- [KYC / AML posture](./legal/kyc-aml.md)
- [Cookie disclosure](./legal/cookies.md)

## 📐 Design specs (per module)
- [00 — Assessment](./00-ASSESSMENT.md)
- [01 — Architecture](./01-ARCHITECTURE.md)
- [03 — Roadmap](./03-ROADMAP.md)
- [04 — Flows](./04-FLOWS.md)
- [05 — Currency](./05-CURRENCY.md)
- [06 — Markets](./06-MARKETS.md)
- [07 — Trading](./07-TRADING.md)
- [08 — Admin](./08-ADMIN.md)
- [09 — Notifications](./09-NOTIFICATIONS.md)
- [12 — Background jobs](./12-BACKGROUND-JOBS.md)
- [15 — Performance & caching](./15-PERFORMANCE-CACHING.md)
- [16 — CI/CD & IaC](./16-CICD-IAC.md)
- [17 — Accessibility, i18n, docs, launch & DR](./17-ACCESSIBILITY-I18N-DOCS-LAUNCH.md)

## 🎨 Product design (Phase 0)
- [Design foundations & landing-page dossier](./design/README.md) — "Pip" design system, competitive research, tokens, landing-page spec, roadmap, and a static reference prototype.

---

_Docs are owned per area and updated in the same change as the code (see the
Contributing "definition of done"). Docs rot is treated as a launch risk._
