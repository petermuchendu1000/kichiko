# Module 15 — Performance & Caching

> Status: ☐ planned. This document is the authoritative, build-ready
> specification for Module 15. It is scoped to the **actual** Kichiko stack —
> Next.js 15 (App Router) on Fly.io behind Cloudflare, Supabase Postgres, and
> (introduced here) Upstash Redis — and it builds directly on the primitives
> already shipped in earlier modules (69 DB indexes, the `leaderboard`
> materialized view, the pluggable `lib/security/rate-limit.ts` store, structured
> logging/observability from M13, and the M12 background-job runner).

---

## 1. Objective & scope

Make Kichiko fast and cheap under East-African mobile-network conditions
(high latency, intermittent 3G, low-end Android devices) **without weakening the
correctness guarantees** established in earlier modules: money still moves only
inside the database, RLS is never bypassed for speed, and no user ever sees
another user's cached private data.

Performance work spans four layers, each with an explicit owner and budget:

1. **Database** — indexes, query shape, connection pooling, materialized/rollup
   views, `EXPLAIN`-verified hot paths.
2. **Application (Next.js)** — rendering strategy (RSC/SSR/ISR), the fetch cache,
   `revalidate`/tags, streaming, bundle size, code-splitting.
3. **Edge/CDN (Cloudflare)** — cache rules, tiered caching, image
   transformation, compression (Brotli), stale-while-revalidate.
4. **Client** — TanStack Query cache hygiene, image loading, font strategy,
   third-party script deferral, PWA/service-worker asset caching.

A cross-cutting **distributed cache (Upstash Redis)** is introduced to back
response caching, rate-limiting, and hot read-through caches across all Fly
instances (replacing the per-isolate in-memory `MapRateStore`).

### Out of scope (owned elsewhere)
- Rate-limit *policy* and abuse rules → Module 14 (already shipped; this module
  only swaps its store to Redis for correctness across instances).
- Deploy pipeline / autoscaling config → Module 16.
- Accessibility-driven layout changes → Module 17.

---

## 2. Performance budgets (the definition of "done")

All budgets are measured on a **Moto G-class device / Slow 4G** profile against
the production Fly deployment behind Cloudflare, in the KE region.

| Metric | Target | Hard ceiling | Tool |
|---|---|---|---|
| Lighthouse Performance (mobile), key pages | ≥ 90 | ≥ 85 | Lighthouse CI |
| Largest Contentful Paint (LCP) | ≤ 2.0 s | ≤ 2.5 s | Lighthouse / RUM |
| Interaction to Next Paint (INP) | ≤ 150 ms | ≤ 200 ms | RUM (web-vitals) |
| Cumulative Layout Shift (CLS) | ≤ 0.05 | ≤ 0.1 | Lighthouse / RUM |
| Time to First Byte (TTFB), cached edge | ≤ 200 ms | ≤ 500 ms | Cloudflare RUM |
| First-load JS (shared) | ≤ 110 kB | ≤ 130 kB | `next build` report |
| Per-route JS (p95) | ≤ 180 kB | ≤ 250 kB | `next build` report |
| Hot API p95 latency (server) | ≤ 120 ms | ≤ 300 ms | structured logs |
| Hot DB query p95 | ≤ 25 ms | ≤ 75 ms | `pg_stat_statements` |

**Key pages** = `/` (home/markets list), `/markets/[slug]`, `/leaderboard`,
`/portfolio`, `/search`. The build already reports shared first-load JS ≈ 103 kB;
this module holds the line and prevents regressions via a CI budget gate.

---

## 3. Current baseline (what we start from)

- **DB:** 69 indexes across 15 migrations; `leaderboard` is a materialized view
  refreshed on schedule; search uses `pg_trgm`. No `pg_stat_statements` review
  has been done yet, and no rollup tables for market-list aggregates exist.
- **App:** `next.config.js` sets `images.remotePatterns` for Supabase, CORS
  headers on `/api/*`, and a `/health` rewrite. No explicit `revalidate`, cache
  tags, or `Cache-Control` strategy is defined per route yet. Rendering is
  largely dynamic.
- **Edge:** Cloudflare is in the topology (DNS/CDN/WAF) but no cache rules,
  tiered cache, or image resizing are configured in IaC.
- **Client:** TanStack Query + SWR are installed; no standardized `staleTime`/
  `gcTime` policy, no web-vitals RUM, no service worker despite the PWA intent.
- **Cache infra:** rate-limiting uses an in-memory per-isolate store — **wrong
  under horizontal scale** (each Fly instance counts independently).

---

## 4. Sub-milestones (commit-per-step; gate before merge)

Each sub-milestone is independently committable and keeps `main` green
(type-check · unit tests · lint · `next build`). DB changes ship as forward-only
migrations and are validated with `pglast` locally before push.

### 15.1 — Measurement harness & baselines (measure first)
- Enable Postgres `pg_stat_statements`; add an admin-only `slow_queries` view
  and a `docs/perf/` baseline capture (top 25 statements by total & mean time).
- Add **web-vitals RUM**: a tiny client reporter (`lib/perf/vitals.ts`) posting
  LCP/INP/CLS/TTFB to `/api/telemetry/vitals`, which structured-logs them (M13
  logger) with `request_id` + route; sampled (e.g. 10%) to control cost.
- Wire **Lighthouse CI** (`@lhci/cli`) as a non-blocking CI job first (collect
  baselines), promoted to blocking in 15.6.
- **Gate:** baseline numbers captured & committed under `docs/perf/`; vitals rows
  visible in logs; Lighthouse CI runs.

### 15.2 — Database performance pass
- Review every hot path with `EXPLAIN (ANALYZE, BUFFERS)`: markets list (status +
  category + closes_at ordering), single market load, portfolio positions by
  user, notifications feed, search, leaderboard read, admin lists.
- Add/adjust **covering & partial indexes** where the planner shows seq scans or
  sorts on hot predicates (e.g. `markets (status, category, closes_at)`,
  `positions (user_id) WHERE is_active`, `notifications (user_id, created_at DESC)
  WHERE read_at IS NULL`). Migration `017_perf_indexes.sql`.
- Introduce a **market-stats rollup** (denormalized `markets.volume_24h`,
  `bettor_count`, `last_trade_at`) maintained incrementally by triggers or
  refreshed by a new lightweight cron job (reuse M12 `withJobRun` +
  `job_runs`), so the markets grid never aggregates over `bets` at request time.
- Verify **connection pooling** via Supabase's transaction pooler (PgBouncer):
  document the pooled connection string for serverless/Fly, and ensure the
  service-role client uses it.
- **Gate:** each hot query shows an index/■bitmap scan (no seq scan on large
  tables) in committed `EXPLAIN` output; `017` parses via `pglast`; migrate-db
  green.

### 15.3 — Distributed cache (Upstash Redis) + read-through helpers
- Add `lib/cache/redis.ts`: a thin Upstash REST client (edge-safe, no TCP),
  guarded by env (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), with a
  **no-op fallback** when unset so local/dev/CI never require it.
- Add `lib/cache/cache.ts`: `cached(key, ttl, loader)` read-through helper with
  single-flight (in-process de-dupe), JSON (de)serialization, and negative-cache
  guards; namespaced keys (`mp:v1:...`) with an explicit version prefix for
  bust-on-deploy.
- **Swap the rate-limit store** to a `RedisRateStore implements RateStore` so the
  M14 sliding-window limiter is correct across all instances; keep `MapRateStore`
  as the automatic fallback. This is the correctness fix, not just perf.
- **Gate:** unit tests for `cached` (hit/miss/expiry/single-flight/negative
  cache) and `RedisRateStore` (against a mock store); fallback path proven when
  env unset.

### 15.4 — Application rendering & fetch-cache strategy
- Classify every route: **static** (marketing, legal), **ISR**
  (`revalidate`-based: markets list, single resolved market, leaderboard),
  **dynamic/SSR** (portfolio, admin, anything user-scoped), **client** (realtime
  widgets). Document the matrix in this file (§7).
- Apply Next fetch-cache **tags** (`next: { tags: [...] }`) and `revalidateTag`
  on writes (e.g. resolving/creating a market busts `markets` and
  `market:{id}`), so ISR pages update immediately after admin actions instead of
  waiting for TTL.
- Add per-route `Cache-Control` (`s-maxage`, `stale-while-revalidate`) for
  cacheable **public** GET APIs (markets list, single active market, exchange
  rates); **never** cache authenticated/private responses (assert `private,
  no-store` on those, enforced by a small test).
- Stream slow pages with Suspense + skeletons (already have skeletons); move
  above-the-fold content out of client components where possible (RSC).
- **Gate:** cache-policy unit test (public routes cacheable, private routes
  `no-store`); tag-revalidation covered; first-load JS budget still met.

### 15.5 — Edge/CDN & asset optimization (Cloudflare) + client
- Cloudflare **cache rules** (as IaC in Module 16's Terraform, referenced here):
  cache static `/_next/static/*` immutably, cache eligible public API GETs with
  edge TTL + SWR, bypass cache on cookies/`Authorization`, enable **Tiered
  Cache** and **Brotli**.
- **Images:** confirm `next/image` everywhere (audit for raw `<img>`), correct
  `sizes`, `priority` on LCP image, AVIF/WebP via Next; optionally Cloudflare
  Image Resizing for user/market covers. Set long-cache immutable headers on
  hashed assets.
- **Fonts:** `next/font` self-hosting with `display: swap` and preloaded subset
  (Latin) to kill layout shift and third-party font RTT.
- **PWA/service worker:** ship a minimal service worker (Workbox or hand-rolled)
  that pre-caches the app shell + static assets and serves stale-while-revalidate
  for images — honoring the "mobile-first, progressive" principle in the
  architecture doc. Guard so it never caches API/auth responses.
- Defer/`async` non-critical third-party scripts (analytics, Sentry) and load
  them post-interaction.
- **Gate:** no raw `<img>` on key pages; SW registers and passes an offline
  app-shell smoke test; Lighthouse "best practices" for caching headers passes.

### 15.6 — Regression gates & sign-off
- Promote **Lighthouse CI** to **blocking** with asserted budgets (§2) on key
  pages against a preview/staging URL.
- Add a **bundle-size budget** check (parse `next build` output or use
  `size-limit`) failing CI on first-load JS regressions beyond ceiling.
- Add a **k6 smoke/load** script (`load/`) hitting markets list, single market,
  and place-bet preview at target RPS; assert p95 latency budgets and zero 5xx.
- **Gate:** Lighthouse mobile ≥ target on all key pages; bundle budget green;
  k6 p95 within budget; all budgets from §2 recorded in `docs/perf/RESULTS.md`.

---

## 5. Caching taxonomy & invalidation (the correctness contract)

Caching is only safe with an explicit invalidation story. Layers, TTLs, and
bust triggers:

| Data | Layer(s) | TTL | Invalidation trigger |
|---|---|---|---|
| `/_next/static/*`, hashed assets | Cloudflare + browser | 1y immutable | content hash (new deploy) |
| Home / markets list (public) | ISR + Cloudflare SWR | 30–60 s | `revalidateTag('markets')` on create/close/resolve |
| Single market (active) | ISR + edge SWR | 15–30 s | `revalidateTag('market:{id}')` on trade/price change |
| Single market (resolved) | ISR long | 1 h+ | rarely; tag bust on dispute/cancel |
| Exchange rates (public) | edge + Redis read-through | 5 min | M12 `update-exchange-rates` job busts key |
| Leaderboard | matview + edge | matches refresh cadence | matview refresh job busts `leaderboard` tag |
| Portfolio / wallet / notifications | **never cached** | — | `private, no-store` (user-scoped, RLS) |
| Admin consoles | **never cached** | — | `private, no-store` |
| Rate-limit counters | Redis | window length | window expiry |

**Golden rule:** anything gated by a user's JWT/RLS is `private, no-store`. Public
cacheability is opt-in per route and asserted by tests. A version prefix
(`mp:v1:`) on all Redis keys plus content-hashed assets gives a global "bust on
deploy" lever.

---

## 6. Files introduced/changed (implementation map)

| Path | Purpose |
|---|---|
| `supabase/migrations/017_perf_indexes.sql` | hot-path indexes, market-stats rollup, `slow_queries` view, `pg_stat_statements` |
| `apps/web/lib/cache/redis.ts` | Upstash REST client, env-guarded, no-op fallback |
| `apps/web/lib/cache/cache.ts` | `cached()` read-through + single-flight + key versioning |
| `apps/web/lib/security/rate-limit.ts` | add `RedisRateStore` (store swap; policy unchanged) |
| `apps/web/lib/perf/vitals.ts` | web-vitals client reporter |
| `apps/web/app/api/telemetry/vitals/route.ts` | RUM ingest → structured logs |
| `apps/web/lib/http/cache-headers.ts` | typed `Cache-Control` builders (public vs private) |
| `apps/web/public/sw.js` + registration | app-shell/service-worker caching |
| `load/markets.k6.js` | k6 smoke/load script |
| `.github/workflows/ci.yml` | Lighthouse CI + bundle budget jobs |
| `docs/perf/BASELINE.md`, `docs/perf/RESULTS.md` | measured before/after numbers |

Env added (documented in `.env.example`, secrets in Fly): `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`. All optional — absence degrades gracefully to
in-memory/no-cache, never a hard failure.

---

## 7. Rendering matrix (to be finalized in 15.4)

| Route | Strategy | Notes |
|---|---|---|
| `/` , `/markets` | ISR (`revalidate: 60`) + tags | list from rollup, not live aggregation |
| `/markets/[slug]` (active) | ISR (`revalidate: 30`) + `market:{id}` tag | realtime price via client subscription overlay |
| `/markets/[slug]` (resolved) | ISR long | static-ish once resolved |
| `/leaderboard` | ISR matching matview refresh | edge-cacheable |
| `/search` | dynamic (query-dependent) | debounced, short edge TTL on popular queries |
| `/portfolio`, `/notifications`, `/profile`, `/kyc` | SSR dynamic, `no-store` | user-scoped, RLS |
| `/admin/*` | SSR dynamic, `no-store` | capability-gated |
| `/auth/*` | static/SSR | no PII cached |

---

## 8. Testing strategy (per the roadmap testing pyramid)

- **Unit (Vitest):** `cached()` semantics, `RedisRateStore`, cache-header
  builders (public cacheable vs private `no-store`), vitals payload validation.
- **Integration:** route handlers assert correct `Cache-Control`; tag
  revalidation busts the right keys on market write.
- **DB:** committed `EXPLAIN (ANALYZE)` proving index usage on each hot query;
  rollup trigger/refresh correctness.
- **E2E (Playwright):** cold vs warm navigation; offline app-shell loads via SW;
  no private data served from cache after logout.
- **Load (k6):** markets list + single market + place-bet preview at target RPS;
  p95 and error-rate assertions.
- **Regression:** Lighthouse CI budgets + bundle-size budget, both blocking.

---

## 9. Cross-cutting concerns addressed

- **Security:** private responses are provably uncacheable; Redis keys are
  namespaced/versioned; SW never caches auth/API; rate-limit store fix closes a
  real bypass under scale.
- **Observability:** RUM (field data) + `pg_stat_statements` + `job_runs` for the
  rollup refresh; slow-query view for ops.
- **Cost optimization:** fewer DB round-trips (rollups, read-through cache),
  edge offload (Cloudflare), sampled RUM, Upstash pay-per-request.
- **Reliability/HA:** every cache is best-effort with a graceful fallback — a
  cache outage degrades latency, never correctness or availability.
- **Extensibility:** `RateStore`/cache abstractions keep the store swappable;
  key versioning enables safe schema evolution of cached payloads.
- **Accessibility/UX:** CLS/INP budgets, font `display: swap`, skeletons — dovetails
  with Module 17.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Stale public pages after admin actions | tag-based `revalidateTag` on writes, not TTL-only |
| Caching private data by mistake | default `no-store`; opt-in public caching; test-enforced |
| Redis outage | no-op fallback to in-memory / direct DB; never a hard dep |
| Index bloat / write amplification | only add indexes proven needed by `EXPLAIN`; monitor write latency |
| SW serving stale JS after deploy | content-hashed assets + versioned SW cache + skipWaiting/clientsClaim |
| Lighthouse flakiness in CI | median-of-3 runs; assert budgets with tolerance; run against stable preview |

---

## 11. Exit checklist (Gate for ☑)

- [ ] `pg_stat_statements` enabled; baselines captured in `docs/perf/BASELINE.md`.
- [ ] `017_perf_indexes.sql` merged; every hot query index-verified (`EXPLAIN`).
- [ ] Market-stats rollup live; markets grid does no request-time aggregation.
- [ ] Upstash read-through cache + `RedisRateStore` shipped with graceful fallback.
- [ ] Rendering matrix implemented; tag-based invalidation on market writes.
- [ ] Public GET APIs edge-cacheable; private APIs `no-store` (test-enforced).
- [ ] Cloudflare cache rules + Tiered Cache + Brotli (IaC in M16), image/font opt.
- [ ] Service worker app-shell caching; offline shell smoke test green.
- [ ] Lighthouse mobile ≥ 90 (ceiling 85) on all key pages — **blocking** in CI.
- [ ] First-load JS ≤ budget; bundle-size gate green.
- [ ] k6 p95 within budget; zero 5xx under smoke load.
- [ ] `docs/perf/RESULTS.md` records before/after for every budget in §2.
