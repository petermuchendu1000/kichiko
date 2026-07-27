# Testing Strategy

> Module 17.5. How Kichiko is tested at every level, and how those tests are
> enforced in CI so quality is durable, not a one-time event.

## Test pyramid

| Level | Tool | Location | Runs in CI |
| --- | --- | --- | --- |
| **Unit** | Vitest | `apps/web/lib/__tests__/*.test.ts` (400+ tests) | ✅ `unit` job |
| **Integration** | Vitest (RPC/logic) | co-located `__tests__` | ✅ `unit` job |
| **E2E** | Playwright | `apps/web/e2e/*.spec.ts` | (opt) via a11y/e2e |
| **Accessibility** | axe-core + Playwright | `apps/web/e2e/*a11y*` | ✅ `a11y` job |
| **Performance** | Lighthouse CI | `lighthouserc.json` | ✅ `lighthouse` job |
| **Load** | k6 | `load/` | manual / scheduled |
| **Security** | npm audit + gitleaks + dependency-review | CI | ✅ `security` job |
| **i18n** | catalog + pseudo-locale checks | `scripts/check-i18n-keys.mjs`, `gen-pseudo-locale.mjs` | ✅ (see CI) |
| **Migrations** | pglast parser lint | `scripts/lint_migrations.py` | ✅ `migration-lint` |

## Running locally

```bash
cd apps/web
npm test                 # vitest run (unit + integration)
npm run test:watch       # watch mode
npm run test:e2e         # Playwright (npx playwright install first)
npm run test:a11y        # axe accessibility scan
```

From the repo root:

```bash
npm run type-check
npm run lint
npm run i18n:check
npm run i18n:pseudo:check
python3 scripts/lint_migrations.py
node scripts/check-bundle-budget.mjs   # first-load JS budget
```

Load test (k6):

```bash
k6 run load/smoke.js     # smoke; see load/ for scenarios
```

## What to test where

- **Pure logic** (CLOB order-book pricing, currency/FX math, formatters, RBAC capability
  resolution, cache-header/rate-limit builders) → **unit tests**. These are the
  backbone; keep them fast and deterministic. Timezone-sensitive tests must pin a
  timezone (see `lib/__tests__/format.test.ts`).
- **Database invariants** (atomic `clob_place_order`, wallet balances, resolution
  payouts) → RPC/integration tests + assertions after `db:reset`.
- **User journeys** (browse → bet → portfolio; deposit; auth) → Playwright E2E.
- **Accessibility** → axe on key pages must report **zero critical/serious**
  violations; supplement with the manual checklist in `docs/a11y/AUDIT.md`.
- **Performance** → Lighthouse budgets + first-load JS bundle budget (blocking).

## CI gates (blocking)

`.github/workflows/ci.yml` runs: `lint`, `type-check`, `unit`, `build`
(+ bundle-size budget), `migration-lint`, `security`, `dependency-review`,
`a11y` (axe), and `lighthouse`. A change must pass these before it's safe to
merge/deploy. See `docs/16-CICD-IAC.md` and `docs/DEPLOYMENT.md`.

## Conventions

- Name tests `*.test.ts`; keep them near the code (`lib/__tests__/`).
- No network in unit tests — mock providers/clients.
- Prefer testing behaviour and invariants over implementation details.
- Add/adjust tests in the **same PR** as the code change.
