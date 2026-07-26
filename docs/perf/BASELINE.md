# Performance baseline — Module 15

Captured from `next build` on the Module 15 branch (production build, workspace
`apps/web`). These are the **lab/bundle** starting points; field data (RUM) is
collected via `/api/telemetry/vitals` (Module 15.1) once deployed.

## Shared first-load JS
- **First Load JS shared by all: ~103 kB** (budget 110 kB, hard ceiling 130 kB).
  Enforced in CI by `scripts/check-bundle-budget.mjs` (`BUNDLE_BUDGET_KB=130`).

## Key-page first-load JS (before optimization)
| Route | Route size | First Load JS | Notes |
|---|---:|---:|---|
| `/` (home) | 1.92 kB | 112 kB | ISR candidate (15.4) |
| `/markets` | 1.08 kB | 112 kB | ISR + edge cache (15.4) |
| `/markets/[slug]` | **123 kB** | **314 kB** | ⚠️ heaviest — chart lib (Recharts). Top optimization target: dynamic-import the chart, split vendor. |
| `/leaderboard` | 2.09 kB | 105 kB | edge-cacheable (done 15.4) |
| `/search` | 3.01 kB | 109 kB | dynamic |
| `/portfolio` | 284 B | 103 kB | SSR, `no-store` |
| `/notifications` | 2.5 kB | 171 kB | user-scoped |
| `/profile` | 3.23 kB | 172 kB | user-scoped |

## Targets (see docs/15-PERFORMANCE-CACHING.md §2)
- LCP ≤ 2.0 s · INP ≤ 150 ms · CLS ≤ 0.05 · TTFB (edge) ≤ 200 ms.
- Hot API p95 ≤ 120 ms (server); hot DB query p95 ≤ 25 ms.
- First-load JS shared ≤ 110 kB; per-route p95 ≤ 180 kB.

## Optimization backlog (ranked)
1. **`/markets/[slug]` 314 kB** — dynamic-import the Recharts price chart
   (`next/dynamic`, `ssr:false`) so it loads after interaction; expected large
   first-load reduction on the most-visited detail page.
2. `/notifications`, `/profile` (~171 kB) — audit client bundles; defer heavy
   client components.
3. DB: verify `017` indexes with `EXPLAIN (ANALYZE)` on production data volumes.

## How to reproduce
```bash
npm run build 2>&1 | tee build.log
node scripts/check-bundle-budget.mjs build.log 130
# Lighthouse (local prod server):
npm --workspace apps/web run start & npx wait-on http://localhost:3000
npx @lhci/cli autorun --config=./lighthouserc.json
# Load smoke (against a staging URL):
BASE_URL=https://staging.kichiko.co.ke k6 run load/markets.k6.js
```
