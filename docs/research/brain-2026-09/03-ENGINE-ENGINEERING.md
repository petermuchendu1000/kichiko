# 05 — Kichiko Trading Engine: Engineering Architecture Research

Research date: 2026-09-26. Scope: fastest, most correct, most scalable matching/ledger architecture for Kichiko (Supabase Postgres in eu-west-1, PostgREST RPC + Supavisor, Next.js 15 on Vercel / Fly `jnb`).

**How to read this report**
- Every factual claim or number carries a source URL that was fetched during this research, with its context (hardware, workload).
- **INFERENCE** marks my own reasoning or calculations.
- **UNVERIFIED** marks things I could not confirm from a primary source.
- **REPO** marks observations from reading the local codebase at `/home/claude/work/kichiko` (migrations and API routes). These are not web facts.

---

## 0. Executive summary

1. **Network placement costs more latency than the database engine does today.** Supabase has no African region: the documented list has no `af-south-1` or Cape Town [S-REG]. Fly `jnb` ↔ Dublin RTT is about 169 ms [W-JNB-DUB]. REPO: `apps/web/app/api/orders/route.ts` makes about 5–7 *sequential* awaited network calls to Supabase per order: `auth.getUser`, `get_my_profile` RPC, feature-flag read, `markets` read, sometimes `clob_get_book` and `exchange_rates`, then `clob_place_order`. INFERENCE: from `jnb` that is roughly 0.85–1.2 s of pure WAN latency per order before any Postgres work. Moving order handling next to the DB (Vercel `dub1` = eu-west-1 [V-REG], or Fly `lhr`, about 11 ms from Dublin [W-LON-DUB]) and folding those calls into one RPC should cut order latency from Nairobi to about one intercontinental RTT (Nairobi↔London about 127 ms, Nairobi↔Dublin about 178 ms [W-NBO-LON], [W-NBO-DUB]) plus a few ms of server time. This is the biggest, cheapest win.
2. **The in-DB engine is correct in shape but serializes each market on a heavy transaction.** REPO: `clob_place_order` takes `markets … FOR UPDATE`, then locks the option, wallet, positions and each maker order, and per fill updates maker order, positions, wallet, `transactions` and `clob_fills`. It then updates `markets`, `market_options`, `price_history` and `market_activity`. Per-market throughput is therefore about 1 / (transaction hold time including commit flush) (INFERENCE). Published single-hot-row Postgres numbers put *trivial* transactions in the thousands of TPS (8.3k TPS on 4 counter rows, local 8-core [PIZZA]). A 20+-statement matching transaction on a cloud gp3 disk ("single-digit millisecond latency" [EBS]) will be much lower: likely low hundreds of orders/s per market (INFERENCE — **measure it**).
3. **Several cheap fixes are available inside the current engine** (section 7, Architecture A):
   - Use `pg_advisory_xact_lock(market)` or `FOR NO KEY UPDATE` instead of `FOR UPDATE` on `markets`. `FOR UPDATE` conflicts with `FOR KEY SHARE`; `FOR NO KEY UPDATE` does not [PG-LOCK].
   - Lock wallets in a consistent order. Deadlocks cost `deadlock_timeout` = 1 s before detection [PG-LOCKCFG].
   - Make the `markets` update HOT-eligible: `idx_markets_trending` indexes `total_volume_usd`, which is updated on every trade. HOT requires no indexed column to change [PG-HOT].
   - Move statistics and history writes off the critical transaction.
   - Push book deltas over Realtime **Broadcast** rather than Postgres Changes. Postgres Changes runs on one thread and checks RLS once per subscriber [S-PGCH].
4. **Dedicated in-memory engines are 3–4 orders of magnitude faster than the DB approach.** LMAX: 6M orders/s on one JVM thread [LMAX]. exchange-core: 5M ops/s, p99 4 µs at 1M ops/s on a 2010-era Xeon [EXC]. Coinbase: p99 internal round trip under 1 ms, core built for 100k msg/s [CB]. None of this matters while WAN RTT is 130–180 ms and volume is modest. The real benefit is *per-market throughput headroom* and *low lock contention*. The real cost is a second source of truth, which needs sequencing, journaling, snapshots, idempotent ledger application and reconciliation.
5. **Recommended staged path:**
   - Stage 0: measure.
   - Stage 1: Architecture A (co-locate, one RPC, lock hygiene, HOT, Broadcast). Weeks, low risk.
   - Stage 2: safety net (invariant checks, reconciliation, kill switches, property-based and model-based tests).
   - Stage 3 (only if measured per-market load approaches the in-DB ceiling): Architecture B. A single-writer matcher per market shard reads a Postgres queue and commits batched fills atomically to the *same* Postgres, which stays the only source of truth.
   - Stage 4 (only at exchange scale): Architecture C, an LMAX-style in-memory engine with a journal and a Postgres or TigerBeetle ledger.

---

## 1. In-database matching (PL/pgSQL on Supabase)

### 1.1 Locking primitives (PostgreSQL docs)

**Row locks.**
- "FOR UPDATE causes the rows retrieved by the SELECT statement to be locked as though for update… Other transactions that attempt UPDATE, DELETE, SELECT FOR UPDATE, SELECT FOR NO KEY UPDATE, SELECT FOR SHARE or SELECT FOR KEY SHARE of these rows will be blocked until the current transaction ends." [PG-LOCK]
- Conflict table: `FOR UPDATE` conflicts with FOR KEY SHARE, FOR SHARE, FOR NO KEY UPDATE and FOR UPDATE. `FOR NO KEY UPDATE` does **not** conflict with FOR KEY SHARE. A plain `UPDATE` takes `FOR NO KEY UPDATE` unless it modifies unique-key columns usable by foreign keys [PG-LOCK].
- INFERENCE (from Postgres's referential-integrity trigger implementation; not re-verified this session): FK checks on child inserts take `FOR KEY SHARE` on the parent row. So `SELECT … FROM markets … FOR UPDATE` held for a whole matching transaction can block unrelated inserts of rows that reference that market. `FOR NO KEY UPDATE` or an advisory lock avoids this.
- Row locks are stored in the tuple itself: "PostgreSQL stores lock information directly in the row's internal system column (xmax)" [AWS-ROWLOCK]. INFERENCE: taking a row lock therefore dirties a heap page and generates WAL. An advisory lock lives in the shared-memory lock table and does not.

**Advisory locks.**
- Transaction-level advisory locks "are automatically released at the end of the transaction, and there is no explicit unlock operation" [PG-LOCK].
- Session-level locks "do not honor transaction semantics" [PG-LOCK].
- Both kinds live in a shared memory pool sized by `max_locks_per_transaction` and `max_connections`: "Care must be taken not to exhaust this memory" [PG-LOCK].
- PgBouncer transaction pooling: session-level advisory locks "Never" work, and neither does `LISTEN` [PGB]. Supabase's shared Supavisor pooler (port 6543) and dedicated pooler (PgBouncer) run in transaction mode [S-CONN].
- Consequence: `pg_advisory_xact_lock` is safe through the pooler or PostgREST. Session-level locks, for example worker leases, need a direct or session-mode connection.

**SKIP LOCKED / NOWAIT.** "Skipping locked rows provides an inconsistent view of the data, so this is not suitable for general purpose work, but can be used to avoid lock contention with multiple consumers accessing a queue-like table." [PG-SELECT] Use it for queues and sweepers (REPO: `clob_expire_orders` already does), not for matching.

**Deadlocks.** Postgres detects deadlocks and aborts one transaction [PG-LOCK]. `deadlock_timeout` defaults to 1 s: "probably about the smallest value you would want in practice" [PG-LOCKCFG]. The best defense is to "acquire locks on multiple objects in a consistent order" [PG-LOCK].

INFERENCE on the REPO code: the taker's wallet is locked first, then maker wallets are updated in book order. Consider taker A in market X matching maker B while taker B in market Y matches maker A. Their wallet locks cross, so a deadlock is possible. It would stall both for about 1 s and then abort one.

### 1.2 Isolation levels
- **Read Committed**, the default: a blocked `UPDATE` or `SELECT FOR UPDATE` waits for the other transaction, then "the WHERE clause is re-evaluated to see if the updated version of the row still matches" [PG-ISO]. No application retry is needed, which makes it the right level for explicit-lock matching.
- **Repeatable Read / Serializable**: concurrent updates produce `could not serialize access due to concurrent update`. Applications "must be prepared to retry transactions" [PG-ISO].
- INFERENCE: on a hot market, Serializable plus retries would thrash. Stay on Read Committed with an explicit per-market lock.

### 1.3 PL/pgSQL execution cost
- Each SQL statement or expression in PL/pgSQL is parsed the first time into a prepared statement via `SPI_prepare` and reused afterwards. Plans may be cached generically. Dynamic `EXECUTE` pays "new parse analysis and constructing a new execution plan on every execution" [PG-PLPGSQL].
- INFERENCE: the per-iteration interpreter cost is small next to the per-fill work (4–6 row writes, each with index maintenance and WAL). So the cost that matters is *row writes per fill* and the *commit flush*, not PL/pgSQL loops as such.
- REPO: the maker-selection query orders by a computed `CASE` expression (`exec`). That likely forces a sort of all eligible resting orders on every taker order instead of an index-ordered scan (INFERENCE; check with `EXPLAIN ANALYZE`).

### 1.4 HOT updates and fillfactor
- HOT is possible only if "the update does not modify any columns referenced by the table's indexes" and "there is sufficient free space on the page". Lowering `fillfactor` raises the chance of free space. Monitor with `pg_stat_all_tables` [PG-HOT].
- REPO: migration 054 sets `fillfactor = 90` on `markets`, `wallets` and `clob_orders`. But `idx_markets_trending ON markets(is_trending, total_volume_usd DESC)` (001) and every trade does `UPDATE markets SET total_volume_usd = …` (046).
- INFERENCE: every trade-driven `markets` update is therefore **non-HOT** and writes new entries into every `markets` index (status, category, creator, closes_at, slug, featured, trending, GIN tags).
- Fix options: move volume and trade counters to a narrow `market_stats` table with no index on the counters, or update statistics asynchronously from `clob_fills`. REPO: migration 065 already refreshes market statistics from fills.

### 1.5 Commit latency and `synchronous_commit`
- Asynchronous commit risks "data loss, not data corruption". The loss window is up to "three times `wal_writer_delay`". The mode can be set per transaction [PG-ASYNC].
- Supabase disks are gp3 or io2 [S-COMPUTE]. AWS describes gp3 as "single-digit millisecond latency" and io2 Block Express as "average latency of under 500 microseconds for 16KiB I/O" [EBS].
- Group commit: a CYBERTEC benchmark (notebook NVMe throttled to 1000 write IOPS, `pgbench simple-update -c 10`) got 1,576 TPS at `commit_delay = 0` and 2,738 TPS at 1000 µs [CYB-COMMIT].
- INFERENCE: per-market serial throughput ≈ 1 / (statement time + WAL flush). With a flush of about 1–5 ms on gp3, the ceiling from the flush alone is roughly 200–1000 serial commits/s per market *before* statement time. For money-moving fills keep `synchronous_commit = on`: a user shown a fill that later disappears is unacceptable. Asynchronous commit is fine for derived data such as price history and activity feeds, if those are written in separate transactions.

### 1.6 Published contention benchmarks (hot rows)

| Source | Setup | Result |
|---|---|---|
| [PIZZA] outof.pizza | 8-core machine, 8 threads, 32 connections; voting app, counters on 4 rows vs insert-only | Counter (hot rows): **8,286 TPS**, 3.86 ms avg. Insert-only: **42,863 TPS**, 0.75 ms. 10 bins per counter: **31,435 TPS** |
| [AWS-ROWLOCK] AWS Aurora PostgreSQL blog | 128 sessions over the whole inventory vs 512 sessions on 25 hot rows | ~**10,900 TPS** → ~**4,900 TPS** (−55%); `Lock:TransactionId`, `Lock:Tuple` and `LWLock:LockManager` waits were 95% of load |
| [SWM] SoftwareMill (31 Aug 2026) | GCP; DB n2-highmem-4 ×3 (Postgres primary + 2 sync standbys); transfers with Zipf skew; `FOR UPDATE` vs "atomic" strategy; 5k TPS target | Zipf 1.0: PG 2,890–3,068 TPS, p50 ~304–325 ms. Zipf 2.0 (hotspot): PG **753–977 TPS**, p50 1.0–1.3 s. TigerBeetle 4,461 TPS, p50 32 ms |
| [TB-BLOG] TigerBeetle (2026-09-17) | Relational DB with stored procedures, pooling, `shared_buffers` 64 GiB vs TigerBeetle | RDBMS "about 7k transactions per second"; TigerBeetle 454,518 tx/s (909,162 transfers/s) |
| [MT-HT] Modern Treasury | Postgres-based ledger | 1,200 tx/s (4,800 entries/s), p90 297 ms for writes; hot accounts handled by a "hybrid-async API" with an SQS batching queue |

INFERENCE: these figures bound the problem. Postgres handles thousands of *simple* hot-row TPS, but multi-row, skewed, synchronously replicated money transactions drop to hundreds or low thousands. The TigerBeetle and SoftwareMill figures come from vendor-adjacent or specific setups, so treat them as direction, not a promise.

### 1.7 Supabase-specific limits

**Compute tiers** [S-COMPUTE]:

| Tier | Price/month | CPU | RAM | Max DB connections | Pooler max clients |
|---|---|---|---|---|---|
| Micro | ~$10 | shared | 1 GB | 60 | 200 |
| Small | ~$15 | shared | 2 GB | 90 | 400 |
| Medium | ~$60 | shared | 4 GB | 120 | 600 |
| Large | ~$110 | 2 dedicated vCPU | 8 GB | 160 | 800 |
| XL | ~$210 | 4 dedicated vCPU | 16 GB | 240 | 1,000 |
| 2XL | ~$410 | 8 dedicated vCPU | 32 GB | 380 | 1,500 |
| 4XL | ~$960 | 16 dedicated vCPU | 64 GB | 480 | 3,000 |

Baseline IOPS rise from 500 (Micro) to 3,600 (Large) and 6,000 (XL).

**Pooling** [S-CONN]:
- Port 6543 is transaction mode (Supavisor shared, or PgBouncer dedicated). Transaction mode "does not support prepared statements".
- The dedicated pooler "runs on the same machine as your database, so lower latency than the shared pooler".
- Use the shared pooler in transaction mode for serverless. Use a direct connection or the dedicated pooler for persistent backends. Direct connections are IPv6 unless you buy the IPv4 add-on.

**Supavisor overhead** [S-SUPAVISOR], Supabase's own benchmark:
- At 5,000 QPS: median 2 ms, p95 3 ms, p99 23 ms.
- At 20,000 QPS: median 18.4 ms, p99 68 ms.
- On insert queries at 5,000 QPS, Supavisor added about 2 ms per query versus PgBouncer (median 4 ms vs 1 ms).

**PostgREST overhead.** No official benchmark results were found; the postgrest-benchmark repo publishes only the harness [PGRST-BENCH]. One user report measured about 10 ms p95 and about 50 TPS through PostgREST versus about 2 ms p95 and 2K TPS for direct queries [PGRST-2005]. This is an **anecdotal single report**, UNVERIFIED as typical.

**Statement timeouts** [S-TIMEOUT]: `anon` 3 s, `authenticated` 8 s, `service_role` falls back to the `authenticator` role's 8 s, `postgres` is capped by a 2 min global limit. API queries can be configured up to 60 s.

**Custom config** [S-PGCONF]: user-context GUCs can be set per role or database. `max_locks_per_transaction` is set through the CLI and requires a restart.

**pg_net** [S-PGNET]: asynchronous, and requests start only after commit. It is "configured to reliably execute up to 200 requests per second". Requests and responses are in unlogged tables and are lost on crash. **Do not use it on the money path.**

**pg_cron / Supabase Cron** [S-CRON]: "no more than 8 Jobs run concurrently", each should run ≤10 minutes, schedules "from every second to once a year".

**Supabase Queues (pgmq)** [S-QUEUES], [PGMQ]: "exactly once to a consumer within a customizable visibility window", backed by Postgres. No published throughput numbers.

**LISTEN/NOTIFY caveat** [RECALL]: a transaction that issues `NOTIFY` takes a global lock at commit ("AccessExclusiveLock on object 0 of class 1262 of database 0"). This serialized commits at Recall.ai with tens of thousands of concurrent writers. A DBOS rebuttal post exists ("actually scales") but was not fetched in detail. **INFERENCE:** avoid `NOTIFY` inside every order transaction on a hot path.

---

## 2. Out-of-database in-memory matching engines

### 2.1 LMAX / single-threaded sequencer [LMAX] (Martin Fowler, 12 Jul 2011)
- Throughput: "6 million orders per second on a single JVM thread". Hardware: "3Ghz dual-socket quad-core Nehalem based Dell server with 32GB RAM".
- "all the business logic… all trades, from all customers, in all markets — on a single thread". It "runs entirely in-memory using event sourcing"; "you can always recreate the current state by replaying the events".
- Input and output Disruptors handle unmarshalling, journaling and replication. Ring buffers: "20 million slots for input buffer and 4 million slots for each output buffers".
- Snapshots "every night"; "full restart takes less than a minute".

### 2.2 Open-source engines with published numbers

| Engine | Numbers (as published) | Conditions |
|---|---|---|
| exchange-core (Java) [EXC] | 5M ops/s per order book; at 1M ops/s latency p50 0.5 µs, p90 0.9 µs, p99 4 µs, p99.99 31 µs, worst 45 µs; "150ns per matching for large market orders" | Dual X5690 3.47 GHz, isolated socket, RHEL 7.5, Java 8u192; 3M messages (9% GTC, 3% IOC, 6% cancel, 82% move), ~1,000 resting orders over ~750 price levels, 1,000 accounts. Architecture: LMAX Disruptor pipeline with sharded risk/accounting and matching, journaling and snapshots |
| Liquibook (C++) [LQB] | "sustained rates of 2.0 million to 2.5 million inserts per second" | Hardware not stated ("rough order-of-magnitude estimate") |
| OrderBook-rs (Rust) [OBRS] | Mixed HFT sim, 30 threads: 168,074 ops/s total; single hot price level: 31.6M ops/s | Apple M4 Max; lock-free DashMap + SkipMap (multi-threaded design) |
| i25959341/orderbook (Go) [GO-OB] | "above 300k trades per second" | No hardware or method stated → treat as UNVERIFIED |
| Hobby C++ LOB, array vs `std::map` [ARR-BENCH] | Array levels: 28.4M ops/s, p50 40.6 ns; `std::map`: 15.7M ops/s, p50 71.6 ns | 1,000 price levels, 2M non-crossing insert/cancel actions, GCC -O3; hobby project, not production |

INFERENCE: any competent single-threaded in-memory book in Rust, Go, Java or even Node handles far more than Kichiko's plausible order rate. Engine speed is not the bottleneck; persistence and ledger application are.

### 2.3 How real venues structure the pipeline

**Coinbase** [CB] (re:Invent 2023 FSI309):
- Matching engine (order book) plus OMS (balance, risk, margin, liquidations).
- A Raft cluster, "one leader, multiple followers", "requires majority before processing". All nodes run the "same code with same input" and are "single-threaded and deterministic".
- Aeron UDP messaging with SBE encoding. EC2 cluster placement groups; z1d, X2iezn, R7iz and m5zn instances.
- "Full internal p99 round-trip latencies under 1ms": 80% networking over 10 hops, processing "single-digit μs". "Core systems built to handle 100k messages per second."

**Kalshi** [KAL-SHARD], [KAL-RL]:
- Four exchange instances (shards) split by category. "All child markets of an event will live on the same exchange instance."
- "Programmatic traders must preallocate collateral on a given exchange shard". "Order groups do not function across exchange instances".
- Write rate-limit tiers run from 100/s (Basic) to 9,600/s (Prestige). Batch items are billed individually.
- INFERENCE: Kalshi shards collateral per engine, a clear sign that its risk/balance checks run inside each shard's engine rather than against a global DB.

**Polymarket** [PM-LIFE], [PM-ME], [PM-TOK]:
- An off-chain CLOB operator validates signatures, balances and allowances and matches orders. It then "submits the trade to the blockchain", where the Exchange contract settles atomically.
- Trade statuses: MATCHED → MINED → CONFIRMED, plus RETRYING and FAILED.
- Matching-engine restarts return HTTP 425 and are followed by 2 minutes of post-only mode.
- Invariant: "Every Yes/No pair in existence is backed by exactly $1 of pUSD collateral"; "Splitting $1 creates 1 Yes token and 1 No token".
- INFERENCE: this is the pattern "matcher decides, ledger settles asynchronously with explicit settlement states", which is Architecture C.

**Hyperliquid** [HL-OV], [HL-OB]:
- Fully on-chain book with HyperBFT consensus. Median 0.2 s and p99 0.9 s end-to-end for co-located clients; "approximately 200k orders/sec".
- Price-time priority. A deterministic in-block ordering: non-order actions, then cancels, then GTC/IOC orders.
- INFERENCE: processing cancels before takers within a batch is a useful, citable fairness rule for any batched engine.

**Binance**: no primary engineering source found. **UNVERIFIED**.

### 2.4 Keeping the ledger consistent
- **Transactional outbox** [OUTBOX]: write messages to an outbox table in the same transaction as the business update. A relay publishes them. "Messages are guaranteed to be sent if and only if the database transaction commits", in order. Delivery is at-least-once, so "consumers must be idempotent".
- **Idempotency keys** [BRANDUR]: a table with a unique `(user_id, idempotency_key)`, recovery points, "atomic phases" between external calls, a `locked_at` column, and retention of about 72 h. Modern Treasury uses client-sent keys stored 24 h [MT-6].
- **Double-entry with cached balances** [MT-6], [MT-HT]: balances are O(n) unless cached. Keep a cached balance and "regularly verify each Account's cached balances match the sum of Entries". Use write-ahead queues to batch writes. Hot accounts go through a hybrid async path.
- **TigerBeetle** [TB-PERF], [TB-DOCS], [TB-BLOG]:
  - A purpose-built debit/credit database. Batches hold up to 8,190 transfers per request (8,189 operations per the 2026 blog).
  - "strong consistency guarantees without row locks. This sidesteps the issue of contention on hot accounts."
  - Positioned for the "data plane" alongside a general-purpose DB in the control plane.
  - Vendor-published result: 454,518 tx/s (909,162 transfers/s) vs about 7k tx/s for a tuned RDBMS.
  - INFERENCE: not offered as a managed service on Supabase; self-hosting a 3- or 6-replica cluster is a real operational addition.

---

## 3. Hybrid designs for a small team on Supabase

### 3.1 Option H1: Postgres stays the only truth; per-market advisory lock
- `pg_advisory_xact_lock(hashtextextended(market_id::text, 0))` at the top of `clob_place_order` and `clob_cancel_order` replaces `markets … FOR UPDATE`. It is safe through transaction pooling [PGB], [S-CONN]. It writes no tuple (INFERENCE from [AWS-ROWLOCK]). It does not block FK `KEY SHARE` checks.
- Lock all involved wallets in a deterministic order (for example `ORDER BY user_id`). Read the maker IDs first with a plain `SELECT`, then `SELECT … FROM wallets WHERE user_id = ANY($1) ORDER BY user_id FOR UPDATE`.
- Throughput: still one serial transaction per market at a time, bounded by transaction duration (§1.5, INFERENCE).

### 3.2 Option H2: single-writer matcher per shard, Postgres queue, atomic batched commit
Flow:
1. The API inserts the order into an inbound queue with an idempotency key. Candidates: a Postgres table consumed with `FOR UPDATE SKIP LOCKED`, or pgmq / Supabase Queues [S-QUEUES]. The insert is short and uncontended.
2. One long-running worker per market shard (Node, Go or Rust on Fly `lhr` or another eu-west host) holds a **lease**, such as a session-level advisory lock on a *direct* connection [PGB]. It keeps the book in memory, loaded from `clob_orders` at startup.
3. The worker pulls N orders, matches them in memory in arrival order, then writes all resulting fills, order updates, wallet and position deltas and ledger entries, plus a `shard_seq` high-water mark, in **one** transaction. This is group commit at the application level, the same batching idea as TigerBeetle [TB-BLOG] and Modern Treasury's write-ahead queue [MT-6].
4. The result is published through the outbox to Realtime Broadcast.

Correctness:
- Single writer means no lock contention.
- Postgres atomicity means fills and ledger can never diverge.
- Crash recovery: rebuild the book from DB state and resume from `shard_seq`.
- Idempotent by order ID and idempotency key.

Latency cost:
- Queue wake-up latency. Poll every few ms, or use NOTIFY with the [RECALL] caveat noted.
- The API must wait for the result (poll or subscribe) or return "accepted" asynchronously.
- INFERENCE: one extra intra-region hop plus the batch interval, about 2–20 ms.

Throughput: INFERENCE. With batches of 100–1000 orders per commit, per-shard throughput becomes about batch size / (batch write time). Expect thousands to tens of thousands of orders/s, bounded by row writes and not by lock waits. This must be benchmarked.

### 3.3 Option H3: Redis Streams or NATS JetStream as the order log
- Redis Streams consumer groups give at-least-once delivery through the pending entries list, `XACK` and `XAUTOCLAIM` [REDIS].
- NATS JetStream gives "at-least-once delivery — messages survive restarts and can be replayed" [NATS].
- INFERENCE: either adds a second durable system whose ordering must be reconciled with Postgres. For Kichiko, a Postgres-native queue (H2) keeps one source of truth and one backup/restore story. REPO: Upstash Redis is already used for rate limiting per the `fly.toml` comment, but not as a log.

### 3.4 Latency budget: Nairobi user, eu-west-1 database

Published RTTs (WonderNetwork, 30 pings each between hosting providers; figures vary by provider):

| Path | Avg RTT | Source |
|---|---|---|
| Nairobi ↔ Johannesburg | 52.3 ms | [W-NBO-JNB] |
| Nairobi ↔ London | 127.4 ms | [W-NBO-LON] |
| Nairobi ↔ Dublin | 178.1 ms | [W-NBO-DUB] |
| Nairobi ↔ Frankfurt | 204.5 ms | [W-NBO-FRA] |
| Johannesburg ↔ Dublin | 169.1 ms | [W-JNB-DUB] |
| Johannesburg ↔ London | 168.0 ms | [W-JNB-LON] |
| Johannesburg ↔ Frankfurt | 176.4 ms | [W-JNB-FRA] |
| London ↔ Dublin | 10.8 ms | [W-LON-DUB] |
| AWS af-south-1 ↔ eu-west-1 (P50) | 155.8 ms | [CLOUDPING] |

Hosting options:
- **Supabase regions**: eu-west-1, eu-west-2 London, eu-central-1 and others; **no Africa region** [S-REG].
- **Vercel regions**: include `cpt1` (af-south-1), `dub1` (eu-west-1) and `lhr1`. The default function region is `iad1`. "Functions should be executed in the same region as your database" [V-REG].
- **Fly regions**: include `jnb`, `lhr`, `ams`, `fra`, `cdg`, `arn`; **no Dublin** [FLY-REG].

Budget per order, INFERENCE from the RTTs above plus the REPO call count:

| Topology | User → app | App → DB (× sequential calls) | Network total |
|---|---|---|---|
| Current: app in Fly `jnb`, ~6 sequential DB/Auth calls | ~52 ms | ~169 ms × 6 ≈ 1,000 ms | **≈ 1.05 s** |
| App in Fly `jnb`, one RPC (`getClaims` local JWT verify) | ~52 ms | ~169 ms × 1 | **≈ 0.22 s** |
| App in Vercel `dub1` or Fly `lhr`, one RPC | ~127–178 ms | ~1–11 ms × 1 | **≈ 0.14–0.19 s** |

Notes:
- `getClaims` verifies the JWT against a cached JWKS when the project uses asymmetric signing keys. With symmetric keys it falls back to an Auth server request [S-GETCLAIMS].
- Vercel PoPs terminate TCP and TLS close to the user and route over a private network [V-REG]. Fluid compute reduces cold starts through bytecode caching and pre-warming on production [V-FLUID].
- REPO: `fly.toml` keeps `min_machines_running = 1`, so money paths do not cold-start.

Conclusion (INFERENCE): the order-placement API must sit in or next to eu-west-1. The page shell and static assets can stay near users.

---

## 4. Order book data structures for a bounded price grid

REPO: prices are `numeric(4,1)` cents on 0–100, i.e. ≤1000 ticks.

- **Array ladder** [HFT-DS]: "An array indexed by tick plus a bitmap of occupied levels, with a doubly-linked FIFO in each cell and a hash map of order-id to node". Finding the next occupied level uses `lzcnt` and tests 64 ticks per instruction. Add, cancel and best-price lookup are O(1). Tree maps are "correct, easy, and slow" because of cache misses, about 10 comparisons at ~1000 levels.
- Memory: the source estimates about 1 MB per book for 16,384 ticks × 64 B per level [HFT-DS]. INFERENCE: 1,000 ticks × 2 sides × 64 B ≈ 128 KB per book, plus the order pool. 10,000 active markets would be ~1.3 GB of level arrays. Lazily allocating books for active markets keeps this small, and a leaner 16–24 B level header brings it to ~40 MB.
- Measured (hobby, non-crossing flow, 1000 levels): array 28.4M ops/s vs `std::map` 15.7M ops/s; p50 40.6 ns vs 71.6 ns [ARR-BENCH].
- **Binary markets, one book per market** (INFERENCE, consistent with REPO semantics and Polymarket's split/merge [PM-TOK]): map "BUY NO @ p" to "SELL YES @ (100−p)" as a complement view.
  - YES-buy vs NO-buy is a **mint**: collateral p + (100−p) = 100 is locked.
  - YES-sell vs NO-sell is a **merge**: 100 is released.
  - YES-buy vs YES-sell is a **transfer**.
  - One ladder of 1000 ticks per side covers all three match kinds.
- In Postgres (Architecture A), the equivalent is an index that supports ordered scans on `(market_id, option_id, side-normalised price, created_at) WHERE status IN ('open','partially_filled')`. That means storing a normalised `exec_price` column, generated or maintained, instead of ordering by a `CASE` expression (INFERENCE).

---

## 5. Market data dissemination

**Supabase Realtime limits** [S-RT-LIM]:

| Plan | Concurrent connections | Messages/s | Channel joins/s |
|---|---|---|---|
| Free | 200 | 100 | 100 |
| Pro | 500 | 500 | 500 |
| Pro (no spend cap) / Team | 10,000 | 2,500 | 2,500 |

Broadcast payloads are 3,000 KB on paid plans.

**Postgres Changes** [S-PGCH]:
- "processed on a single thread to preserve their order, which means larger compute add-ons don't meaningfully increase Postgres Changes throughput".
- "authorizes every event against each subscriber… 100 authorization checks".
- Above about 3,000 subscribers, Supabase recommends Broadcast.

**Broadcast benchmarks** [S-RT-BENCH], Supabase-published:

| Test | Scale | Median / p95 / p99 latency |
|---|---|---|
| WebSocket broadcast | 32k users, 224k msg/s | 6 / 28 / 213 ms |
| Broadcast from DB | 80k users, 10k msg/s | 46 / 132 / 159 ms |
| Large scale | 250k users, >800k msg/s | 58 ms median, 279 ms p95 |

**Architecture and database broadcast:**
- Realtime is "a globally distributed Elixir cluster". Clients connect to any node. Postgres changes stream from the database's region [S-RT-ARCH].
- Whether an African Realtime node exists is **UNVERIFIED**.
- `realtime.send()` and `realtime.broadcast_changes()` insert into `realtime.messages`, which is delivered via WAL; private channels are authorised by RLS on that table; messages are retained 3 days [S-RT-BC].
- **No ordering or delivery guarantee is documented** [S-RT-BC]. Clients must therefore detect gaps themselves.

**Recommended protocol** (INFERENCE; standard snapshot+delta practice, not a cited Supabase feature):
1. Each market has a monotonically increasing `book_seq`, assigned inside the matching transaction or by the single writer.
2. Deltas `{market, seq, level changes, trades}` go out on a public Broadcast channel per market, e.g. `book:<market_id>`.
3. The client fetches a snapshot, for example `clob_get_book` returning `seq`, from a cached endpoint. It buffers deltas, drops those with seq ≤ snapshot seq, and on any gap re-fetches the snapshot.
4. Private fills and order updates go on a per-user private channel with RLS.

REPO: migration 053 already pruned the `supabase_realtime` publication.

---

## 6. Risk and safety

**Exchange-level controls (FIA)** [FIA]:
- Maximum order size ("fat finger").
- Maximum intraday position.
- Price tolerance versus a reference price.
- Cancel-on-disconnect.
- Kill switches that "immediately disable all trading activity for a particular participant or group".
- Dynamic price collars and bands; daily price limits.
- Trading pauses and circuit breakers.
- Message throttles.

Kalshi's per-tier write-token buckets are a concrete throttle design [KAL-RL]. Polymarket's post-only restart window shows a controlled resumption mode [PM-ME].

**Pre-trade balance checks:** reserve at order entry. REPO: `reserved_balance` and `reserved_shares` already exist, and migration 064 reconciles wallet reservations. In Architecture C the check moves into the engine's in-memory balance copy, as with Kalshi's per-shard collateral [KAL-SHARD] and Coinbase's OMS [CB].

**Idempotency:** unique `(user_id, client_order_id)` [BRANDUR]; 24–72 h retention [MT-6], [BRANDUR]. REPO: `p_client_order_id` exists; check that it is backed by a unique constraint.

**Exactly-once fill application:** at-least-once delivery plus an idempotent consumer [OUTBOX]. Concretely: a deterministic `fill_id` (for example `shard_seq:match_idx`) with a `UNIQUE` constraint on `clob_fills(fill_id)` and on the ledger `transactions(fill_id, leg)` (INFERENCE).

**Formal invariants** to check continuously and in tests (INFERENCE, derived from [PM-TOK] and double-entry [MT-6]), for every binary market m:
- **I1 conservation:** Σ YES shares = Σ NO shares = shares minted − merged − redeemed.
- **I2 collateral:** collateral locked(m) = 1.00 × outstanding pairs; Σ user cash + Σ reserved + Σ market collateral + fees = total deposits − withdrawals.
- **I3 cache:** each wallet's cached balance = Σ its ledger entries [MT-6].
- **I4 book:** no crossed book after matching; order filled ≤ size; reserved amounts = Σ open-order requirements.
- **I5 no negative balances.**

Run I1–I5 as a SQL reconciliation job (pg_cron, at most 8 concurrent jobs [S-CRON]) and page on any drift.

**Testing:**
- Hypothesis-style stateful or model-based tests: generate sequences of place, cancel, expire and resolve actions; run invariants after each step; shrink failures to "a very short program" [HYP].
- Deterministic simulation, FoundationDB style: "Deterministic simulation of an entire FoundationDB cluster within a single-threaded process… perfect repeatability", with fault injection [FDB]. TigerBeetle's VOPR runs at "1000x speed" [TB-DOCS].
- A single-threaded deterministic matcher (Architectures B and C) is directly amenable to this. Differential testing of the new engine against the existing PL/pgSQL engine on replayed production order streams is the key migration safety net (INFERENCE).

---

## 7. Candidate architectures

Latency figures are for a Nairobi user and are INFERENCE built on the cited RTTs. Engine and DB internals are INFERENCE unless cited.

### Architecture A: optimise the current in-DB engine (recommended now)

Changes:
1. Serve `/api/orders` from `dub1` (Vercel) or `lhr` (Fly) next to eu-west-1 [V-REG], [FLY-REG], [W-LON-DUB]. Or keep `jnb` for pages only.
2. Collapse the auth, profile, flag, market, FX and book reads into a single `place_order_v2` RPC. Use `getClaims` [S-GETCLAIMS].
3. Replace `markets FOR UPDATE` with `pg_advisory_xact_lock(market)` [PG-LOCK], [PGB]. Sort wallet locks deterministically [PG-LOCK].
4. Take `total_volume_usd` out of indexed columns or move statistics to a side table so hot updates become HOT [PG-HOT]. Move `price_history`, `market_activity` and statistics out of the critical transaction into a fills-driven async job.
5. Add a normalised `exec_price` plus a partial index for ordered maker scans.
6. Use a dedicated-CPU compute tier (Large or XL) [S-COMPUTE]. Optionally use the dedicated pooler or a direct connection from a persistent server instead of PostgREST [S-CONN], [S-SUPAVISOR].
7. Replace Postgres Changes with Broadcast plus sequence numbers [S-PGCH], [S-RT-BENCH].

Assessment:
- **Latency:** ≈140–190 ms network from Nairobi plus ~5–30 ms DB time. Today it is ≈1 s.
- **Throughput:** unchanged in kind, a serial transaction per market. Likely low hundreds of orders/s per market, and many markets in parallel up to CPU and IOPS limits. The hot-row evidence is [PIZZA], [AWS-ROWLOCK], [SWM]. **Measure** with `load/markets.k6.js`.
- **Correctness:** strongest of all options. A single ACID transaction covers match, ledger and positions.
- **Operational complexity:** minimal.
- **Migration risk:** low. Function replacement follows the existing expand/contract migrations.
- **Cost:** compute tier delta, e.g. Medium ~$60 → Large ~$110 or XL ~$210 per month [S-COMPUTE].

### Architecture B: single-writer matcher per market shard, Postgres as truth (recommended if A's ceiling is reached)

Design:
- The API enqueues into a Postgres queue (pgmq, or a table with SKIP LOCKED).
- One worker per shard, Go, Rust or Node, runs on Fly `lhr` or `ams`, or an EC2 instance in eu-west-1. Each holds a lease via a session advisory lock on a direct connection [PGB], [S-CONN].
- The worker keeps an in-memory array ladder [HFT-DS] and applies batches in one ACID transaction (group commit) that includes the ledger.
- Outbox → Broadcast.

Assessment:
- **Latency:** A's latency plus about 2–20 ms queue and batch delay.
- **Throughput:** roughly thousands to tens of thousands of orders/s per shard, set by batch write cost rather than lock waits (INFERENCE). The batching principle is shown by [TB-BLOG] and [MT-HT]. The engine CPU cost is negligible [EXC], [ARR-BENCH].
- **Correctness:** equal to A. Fills and ledger commit atomically in the same DB, and one writer removes deadlocks. Recovery rebuilds from the DB.
- **Complexity:** moderate. Always-on workers, a lease/fencing token (for example `shard_epoch` checked in the write transaction), shard assignment, health checks and a kill switch per shard.
- **Migration risk:** medium. Route markets shard by shard with a feature flag, the way Kalshi assigns events to shards [KAL-SHARD]. Run in shadow mode first, comparing outputs with the PL/pgSQL engine.
- **Cost:** 2–3 Fly performance machines ≈ $14–28 each per month in `lhr`. These figures are approximate from Fly's pricing calculator [FLY-PRICE]; verify. Plus the Supabase IPv4 add-on if IPv6 egress is not usable (UNVERIFIED for Fly→Supabase).

### Architecture C: dedicated in-memory engine (LMAX-style) with journal and Postgres ledger

Design:
- A sequencer journal: Aeron Cluster/Raft as at Coinbase [CB], or Kafka / Redpanda / NATS JetStream [NATS].
- A deterministic single-threaded matcher and risk engine holds books and balance copies in memory, with snapshots and replay [LMAX], [EXC].
- A ledger writer consumes fills idempotently into Postgres. Settlement states are explicit, like Polymarket's MATCHED → CONFIRMED [PM-LIFE].

Assessment:
- **Latency:** internal µs to sub-ms [CB], [EXC]. End-to-end is still dominated by 130–180 ms WAN.
- **Throughput:** 100k–millions of msg/s [CB], [LMAX], [EXC].
- **Correctness:** strong *if* built well. But balances now live in two places, so you need reconciliation (I1–I5), idempotent consumers [OUTBOX] and deterministic replay testing [FDB].
- **Complexity:** high. A consensus or replicated journal, snapshotting, and on-call for a stateful service.
- **Migration risk:** high. It changes the money source of truth.
- **Cost:** several dedicated hosts plus engineering time. Not justified at current scale (INFERENCE).

### Architecture D: C plus TigerBeetle as the balance/ledger data plane

- TigerBeetle holds the double-entry accounts and Postgres holds metadata [TB-DOCS].
- Vendor-reported: about 455k tx/s vs about 7k for an RDBMS [TB-BLOG]. Independent: about 4.6× Postgres under hotspot contention with a 3-node cluster [SWM].
- INFERENCE: only worth it if the ledger itself becomes the bottleneck after C, or if hot house or fee accounts dominate. It is not managed on Supabase and adds another replicated system.

### Comparison

| | A: optimise in-DB | B: single-writer + PG | C: in-memory engine | D: C + TigerBeetle |
|---|---|---|---|---|
| E2E latency (Nairobi) | ~0.15–0.22 s | ~0.16–0.24 s | ~0.14–0.19 s | ~0.14–0.19 s |
| Per-market throughput | 10²/s (measure) | 10³–10⁴/s (measure) | 10⁵+/s | 10⁵+/s |
| Source of truth | Postgres | Postgres | Engine journal + PG | Journal + TB + PG |
| Correctness risk | Lowest | Low | Medium (reconciliation) | Medium–high |
| Ops complexity | Low | Medium | High | Very high |
| Migration risk | Low | Medium | High | High |
| Time to ship (INFERENCE) | 1–3 weeks | 1–2 months | 4–9 months | 6–12 months |

---

## 8. Recommended staged path

**Stage 0: measure (days)**
- `pg_stat_statements` for `clob_place_order` timing.
- `pg_stat_user_tables.n_tup_hot_upd` vs `n_tup_upd` on `markets`, `wallets` and `clob_orders` [PG-HOT].
- `log_lock_waits` (configurable via supautils [S-PGCONF]) and the deadlock count.
- Server-side timing breakdown in `/api/orders`.
- k6 order-rate test on one hot market to find the per-market ceiling.

**Stage 1: Architecture A (1–3 weeks, low risk).** Order of payoff:
1. Co-locate the order API with eu-west-1 and collapse to one RPC plus `getClaims`. This removes about 0.8 s.
2. Advisory lock and ordered wallet locks.
3. HOT fix and async statistics.
4. Ordered maker index.
5. Broadcast with sequence numbers.
6. Dedicated-CPU tier.

**Stage 2: safety net (in parallel, 2–4 weeks)**
- Invariant reconciliation job (I1–I5).
- Unique `fill_id` and idempotency keys.
- FIA-style controls: per-user throttles, max order size, price collars, per-market halt flag, global kill switch, post-only resume mode.
- Hypothesis-style model tests of the matching rules, runnable against both the SQL engine and any future engine.

**Stage 3: Architecture B, only if Stage 0/1 measurements show per-market demand approaching the ceiling or lock waits dominating.**
- Build the deterministic matcher as a pure function `(book, order) → (book', fills)`.
- Differential-test it against the SQL engine on recorded order streams.
- Shadow-run, then migrate shard by shard behind a flag.

**Stage 4: Architecture C/D** only for exchange-scale ambitions, for example market makers needing sub-10 ms and 10k+ orders/s sustained. Revisit only then.

---

## 9. References (all fetched 2026-09-26)

**PostgreSQL documentation**
- [PG-LOCK] https://www.postgresql.org/docs/current/explicit-locking.html
- [PG-LOCKCFG] https://www.postgresql.org/docs/current/runtime-config-locks.html
- [PG-SELECT] https://www.postgresql.org/docs/current/sql-select.html
- [PG-ISO] https://www.postgresql.org/docs/current/transaction-iso.html
- [PG-HOT] https://www.postgresql.org/docs/current/storage-hot.html
- [PG-ASYNC] https://www.postgresql.org/docs/current/wal-async-commit.html
- [PG-PLPGSQL] https://www.postgresql.org/docs/current/plpgsql-implementation.html

**PostgreSQL benchmarks and pooling**
- [CYB-COMMIT] https://www.cybertec-postgresql.com/en/commit_delay-performance-postgresql-benchmark/
- [PIZZA] https://outof.pizza/posts/locks/
- [AWS-ROWLOCK] https://aws.amazon.com/blogs/database/troubleshooting-row-lock-contention-in-amazon-aurora-postgresql-part-1-understanding-row-lock-contention-in-postgresql/
- [SWM] https://softwaremill.com/tigetbeetle-vs-postgresql-performance-benchmark-harness-cloud-tests/
- [PGB] https://www.pgbouncer.org/features.html
- [RECALL] https://www.recall.ai/blog/postgres-listen-notify-does-not-scale
- [PGRST-2005] https://github.com/PostgREST/postgrest/issues/2005
- [PGRST-BENCH] https://github.com/PostgREST/postgrest-benchmark/blob/master/README.md
- [EBS] https://aws.amazon.com/ebs/volume-types/ ; https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html

**Supabase**
- [S-COMPUTE] https://supabase.com/docs/guides/platform/compute-and-disk
- [S-REG] https://supabase.com/docs/guides/platform/regions
- [S-CONN] https://supabase.com/docs/guides/database/connecting-to-postgres
- [S-SUPAVISOR] https://supabase.com/blog/supavisor-1-million
- [S-TIMEOUT] https://supabase.com/docs/guides/database/postgres/timeouts
- [S-PGCONF] https://supabase.com/docs/guides/database/custom-postgres-config
- [S-PGNET] https://supabase.com/docs/guides/database/extensions/pg_net
- [S-CRON] https://supabase.com/docs/guides/cron
- [S-QUEUES] https://supabase.com/docs/guides/queues
- [PGMQ] https://github.com/pgmq/pgmq
- [S-RT-LIM] https://supabase.com/docs/guides/realtime/limits
- [S-PGCH] https://supabase.com/docs/guides/realtime/postgres-changes
- [S-RT-BENCH] https://supabase.com/docs/guides/realtime/benchmarks
- [S-RT-ARCH] https://supabase.com/docs/guides/realtime/architecture
- [S-RT-BC] https://supabase.com/docs/guides/realtime/broadcast
- [S-GETCLAIMS] https://supabase.com/docs/reference/javascript/auth-getclaims

**Hosting and network latency**
- [V-REG] https://vercel.com/docs/regions
- [V-FLUID] https://vercel.com/docs/fluid-compute
- [FLY-REG] https://docs.fly.io/reference/regions
- [FLY-PRICE] https://docs.fly.io/about/pricing
- [W-NBO-DUB] https://wondernetwork.com/pings/Nairobi/Dublin
- [W-NBO-LON] https://wondernetwork.com/pings/Nairobi/London
- [W-NBO-FRA] https://wondernetwork.com/pings/Nairobi/Frankfurt
- [W-NBO-JNB] https://wondernetwork.com/pings/Nairobi/Johannesburg
- [W-JNB-DUB] https://wondernetwork.com/pings/Johannesburg/Dublin
- [W-JNB-LON] https://wondernetwork.com/pings/Johannesburg/London
- [W-JNB-FRA] https://wondernetwork.com/pings/Johannesburg/Frankfurt
- [W-LON-DUB] https://wondernetwork.com/pings/London/Dublin
- [CLOUDPING] https://www.cloudping.co/ (P50 view)
- A second matrix (https://latency.bluegoat.net/) reported af-south-1↔eu-west-1 at 178 ms. It was discarded because it also showed an implausible 68 ms for eu-west-2↔eu-west-1.

**Matching engines and exchanges**
- [LMAX] https://martinfowler.com/articles/lmax.html
- [EXC] https://github.com/exchange-core/exchange-core
- [LQB] https://github.com/enewhuis/liquibook
- [OBRS] https://github.com/joaquinbejar/OrderBook-rs
- [GO-OB] https://github.com/i25959341/orderbook
- [ARR-BENCH] https://github.com/LucaT2/Order-Matching-Engine
- [HFT-DS] https://hftengineer.com/posts/order-book-data-structures/
- [CB] https://d1.awsstatic.com/events/Summits/reinvent2023/FSI309_Coinbase-Building-an-ultra-low-latency-crypto-exchange-on-AWS.pdf
- [KAL-SHARD] https://docs.kalshi.com/getting_started/exchange_sharding
- [KAL-RL] https://docs.kalshi.com/getting_started/rate_limits
- [PM-LIFE] https://docs.polymarket.com/concepts/order-lifecycle.md
- [PM-ME] https://docs.polymarket.com/trading/matching-engine.md
- [PM-TOK] https://docs.polymarket.com/concepts/positions-tokens.md
- [HL-OV] https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/overview
- [HL-OB] https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/order-book

**Ledgers, messaging and consistency**
- [TB-PERF] https://docs.tigerbeetle.com/concepts/performance/
- [TB-DOCS] https://docs.tigerbeetle.com/single-page/
- [TB-BLOG] https://tigerbeetle.com/blog/2026-09-17-performant-use-of-tigerbeetle/
- [MT-6] https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-vi
- [MT-HT] https://www.moderntreasury.com/journal/behind-the-scenes-how-we-built-ledgers-for-high-throughput
- [OUTBOX] https://microservices.io/patterns/data/transactional-outbox.html
- [BRANDUR] https://brandur.org/idempotency-keys
- [REDIS] https://redis.io/docs/latest/develop/data-types/streams/
- [NATS] https://docs.nats.io/nats-concepts/jetstream

**Risk controls and testing**
- [FIA] https://www.fia.org/sites/default/files/2024-07/FIA_WP_AUTOMATED%20TRADING%20RISK%20CONTROLS_FINAL_0.pdf
- [HYP] https://hypothesis.readthedocs.io/en/latest/stateful.html
- [FDB] https://apple.github.io/foundationdb/testing.html

**Could not fetch or verify**
- Stripe's Ledger blog (redirected; body not retrievable).
- Binance matching-engine internals (no primary source).
- DBOS "LISTEN/NOTIFY actually scales" (seen in search results only).
- Whether Supabase Realtime has an African edge node.
- Fly→Supabase IPv6 connectivity.
