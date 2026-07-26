# Database profiling & optimization — 2026-07

Authoritative, evidence-driven DB performance pass against the **live** project
(PostgreSQL 17.6 on Supabase). Closes the Module-15 backlog items "verify 017
indexes with EXPLAIN on production data volumes" and "capture pg_stat_statements
numbers", and adds continuous-hygiene tuning (migration 054).

All query plans below were captured with a **rolled-back data lab**: representative
volume generated server-side with `generate_series` inside a transaction,
`ANALYZE`, `EXPLAIN (ANALYZE, BUFFERS)`, then `ROLLBACK` — so nothing was
persisted. This is reproducible; see the recipe at the bottom.

> ⚠️ **Pre-launch caveat.** The DB currently holds almost no real rows (38
> markets, near-zero elsewhere). On a near-empty DB the planner *correctly*
> prefers sequential scans and **every** index reports `idx_scan = 0`. Therefore
> runtime index-usage stats are **not** evidence that an index is unused — do NOT
> drop indexes on that signal until real traffic has accrued. Re-run the
> unused-index query (below) a few weeks after launch.

## 1. Hot paths from `pg_stat_statements` (real captured traffic)

| Rank | Query | Calls | Mean | % of total time | Note |
|---:|---|---:|---:|---:|---|
| 1 | Realtime WAL decode (`realtime.list_changes`) | 4377 | 4.9 ms | **61.5%** | Dominant DB cost. Polls logical replication for every table in the `supabase_realtime` publication. **Directly reduced by migration 053**, which removed the `price_history` firehose + legacy `orders` from the publication. |
| 2 | `SELECT name FROM pg_timezone_names` | 10 | **512 ms** | 14.6% | Pathologically slow (scans tz files). Only 10 calls (dashboard/introspection). If ever reached from an app path, cache it — never call per request. |
| 3 | `refresh_leaderboard()` | 118 | 20.4 ms | 6.9% | Auto-refresh cron (migration 040). Healthy today; revisit as a materialized/incremental refresh if it grows with user count. |
| 4 | CLOB place-order RPC (PostgREST) | 618 | 3.7 ms | 6.5% | Healthy. |
| 5 | `clob_expire_orders()` sweeper | 237 | 3.1 ms | 2.1% | Healthy. |

**Takeaway:** the single biggest DB consumer is Realtime WAL decoding, which
scales with *how many tables are published*, not how many clients subscribe.
Right-sizing the publication (migration 053) is the highest-leverage realtime
optimization, and the negative-control E2E test guards it from regressing.

## 2. Markets-list indexes (migration 017) — verified at 50k markets

Lab: 50,000 markets, realistic status mix (~60% active), `ANALYZE`.

| Hot query | Plan | Time | Buffers |
|---|---|---:|---:|
| `WHERE status='active' ORDER BY total_volume_usd DESC LIMIT 20` | **Index Scan** `idx_markets_status_volume` (no sort) | 0.046 ms | 19 |
| `WHERE status='active' ORDER BY created_at DESC LIMIT 20` | **Index Scan** `idx_markets_status_created` (no sort) | 0.042 ms | 22 |

✅ Both composite `(status, <sort> DESC)` indexes serve the `ORDER BY` directly and
the `LIMIT` stops early — no sort node, ~20 buffers, sub-0.05 ms even with 30k
active markets. The 017 design holds up.

## 3. CLOB order book (`clob_get_book`) — index confirmed, covering index rejected

`clob_get_book` filters `clob_orders` by
`(market_id, market_option_id, outcome_side, action)` +
`status IN ('open','partially_filled')` +
`(expires_at IS NULL OR expires_at > now())`, run **4× per book fetch**. The
existing partial index `idx_clob_orders_book` matches this predicate exactly.

Lab A/B (existing vs a covering `INCLUDE (size, filled)` variant):

| Book depth | Existing index | Covering index | Verdict |
|---|---|---|---|
| ~200 resting orders/side (realistic) | Index Scan, 206 buffers, ~2 ms | Index Scan, ~205 buffers | **No gain** — `expires_at` (not in index) forces a heap fetch, so it never becomes an *Index-Only* Scan. |
| ~4000 resting orders/side (extreme) | Bitmap Heap Scan, 3989 buffers, ~11 ms | Bitmap Heap Scan (slightly larger/slower) | **Worse** — bitmap plans always recheck the heap; INCLUDE columns can't help. |

✅ **Decision: keep `idx_clob_orders_book`; do NOT add a covering index.** It would
add write cost on the hottest write path (`filled`/`status` updates) for zero read
benefit. If a single market's resting book ever grows to thousands of orders,
the right fix is a maintained per-price-level depth aggregate, not a wider index.

## 4. Bloat reclaimed + autovacuum tuning (migration 054)

Dead-tuple/file bloat had accumulated from earlier seeding/testing (and this
profiling pass's rolled-back inserts — rollback frees rows but not file pages).

`VACUUM (FULL, ANALYZE)` on the 12 largest tables: **DB 128 MB → 34 MB (−93.9 MB)**
(`clob_orders` 45 MB→864 kB, `markets` 26 MB→392 kB, …).

The cluster ran default autovacuum (vacuum scale_factor **0.2**, analyze **0.1**) —
too lax for high-churn fintech tables. Migration **054** sets per-table storage
params declaratively:

- **Update-heavy** (`clob_orders`, `markets`, `wallets`, `positions`):
  `fillfactor=90` (enables HOT updates — `clob_orders.filled` is unindexed, so its
  frequent updates can now stay off the indexes), `autovacuum_vacuum_scale_factor=0.05`,
  `autovacuum_analyze_scale_factor=0.02` (+ lower cost delay on `clob_orders`).
- **Append-heavy** (`price_history`, `btc_price_ticks`, `clob_fills`,
  `market_activity`, `transactions`): `autovacuum_analyze_scale_factor=0.02` and
  `autovacuum_vacuum_insert_scale_factor=0.05` — the risk here is stale planner
  stats, not dead tuples, so we prioritise frequent `ANALYZE`.

## Reproduce

```sql
-- Top hot queries (real traffic)
SELECT calls, round(total_exec_time::numeric,1) total_ms, round(mean_exec_time::numeric,2) mean_ms,
       round((100*total_exec_time/sum(total_exec_time) over())::numeric,1) pct, left(query,120)
FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'
ORDER BY total_exec_time DESC LIMIT 20;

-- Unused indexes — ONLY meaningful after real traffic has accrued
SELECT s.relname, s.indexrelname, s.idx_scan, pg_size_pretty(pg_relation_size(s.indexrelid))
FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid=s.indexrelid
WHERE s.schemaname='public' AND s.idx_scan=0 AND NOT i.indisprimary AND NOT i.indisunique
ORDER BY pg_relation_size(s.indexrelid) DESC;
```

Rolled-back plan lab: `BEGIN; INSERT … SELECT FROM generate_series(…); ANALYZE t;
EXPLAIN (ANALYZE, BUFFERS) <hot query>; ROLLBACK;`
