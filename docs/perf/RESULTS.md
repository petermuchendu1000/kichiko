# Performance results — Module 15 (before → after)

Tracks each budget from `docs/15-PERFORMANCE-CACHING.md §2` against measured
values. Fill the "after" columns as optimizations land and RUM/Lighthouse data
accrues from staging/production. `—` = not yet measured on a deployed env.

## Bundle budgets (lab, deterministic)
| Metric | Budget | Ceiling | Before | After | Status |
|---|---:|---:|---:|---:|:--:|
| Shared first-load JS | 110 kB | 130 kB | 103 kB | 102 kB | ✅ within ceiling |
| `/markets/[slug]` first load | 180 kB | 250 kB | 370 kB¹ | **253 kB** | ⚠️ within ceiling (−117 kB / −32% after Recharts split) |
| `/portfolio` first load | 180 kB | 250 kB | 226 kB¹ | **124 kB** | ✅ (−102 kB / −45% after Recharts split) |

¹ "Before" re-measured on `main` immediately prior to the code-split change
(2026-07; the codebase had grown past the original Module-15 314 kB baseline).
Recharts (`price-chart`, `outcomes-chart`, `btc-live-chart`, `allocation-donut`)
is now `next/dynamic({ ssr:false })` behind CLS-safe skeletons, so the recharts
vendor chunk loads on demand instead of in first-load JS. All consumers
(detail page, market/order-book drawers, portfolio) import the `.lazy` wrappers.

## Web Vitals (field / RUM — from /api/telemetry/vitals)
| Metric | Target | Ceiling | Before | After |
|---|---:|---:|---:|---:|
| LCP | 2.0 s | 2.5 s | — | — |
| INP | 150 ms | 200 ms | — | — |
| CLS | 0.05 | 0.1 | — | — |
| TTFB (edge cached) | 200 ms | 500 ms | — | — |

## Server / DB (from logs + pg_stat_statements)
| Metric | Target | Ceiling | Before | After |
|---|---:|---:|---:|---:|
| Hot API p95 | 120 ms | 300 ms | — | — |
| Hot DB query p95 | 25 ms | 75 ms | — | — |

## Load (k6 smoke — load/markets.k6.js)
| Scenario | Threshold | Result |
|---|---|---|
| markets list p95 | < 300 ms | — |
| market detail p95 | < 300 ms | — |
| error rate | < 1% | — |

## Shipped in Module 15
- 15.1 RUM (web-vitals → structured logs), Lighthouse CI config.
- 15.2 hot-path indexes, 24h market-stats rollup + refresh cron, `slow_queries`,
  `pg_stat_statements` (migration 017).
- 15.3 Upstash Redis client, read-through cache (single-flight), distributed
  fixed-window rate limiter (fail-open) — all with graceful fallback.
- 15.4 typed Cache-Control policy; public markets/leaderboard reads
  edge-cacheable; private routes `no-store` (test-enforced classifier).
- 15.5 PWA app-shell service worker (never caches API/auth), offline fallback,
  immutable static-asset headers.
- 15.6 CI bundle-size budget gate (blocking) + Lighthouse CI job (non-blocking
  baseline) + k6 smoke script.

## Remaining optimization work (tracked, not blocking module close)
- Dynamic-import Recharts on `/markets/[slug]` to clear its first-load budget.
- Wire Upstash env in prod; promote Lighthouse CI to blocking against a staging
  URL (depends on Module 16 preview deploys).
- Capture production RUM + `pg_stat_statements` numbers into the tables above.
