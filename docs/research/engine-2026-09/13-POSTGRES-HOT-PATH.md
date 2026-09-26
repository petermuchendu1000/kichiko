# 13: Postgres and Supabase internals on Kichiko's order hot path

Track: what one `clob_place_order` call (migration 071) costs inside PostgreSQL 17, measured statement by statement and explained from the source. Then what to change, ranked, with measured or derived gains, and how far a single serial transaction per market can go.

Date: 2026-09-26. Author: research agent, track 13. The repo was read-only. No remote database was contacted. No production data was touched.

## How to read this report

Evidence tags:

- **[M-x]** Measured in this session. Every one has its conditions in §1.
- **[SRC]** Read in PostgreSQL source at the file and line given (REL_17_STABLE unless noted, fetched from `raw.githubusercontent.com/postgres/postgres`).
- **[DOC]** Official documentation, fetched from its GitHub source. `postgresql.org` and `supabase.com` are blocked by this sandbox's egress proxy, so documentation was read from the `.sgml`/`.mdx` sources in the projects' GitHub repositories.
- **[REPO]** Kichiko code (`/home/user/kichiko`).
- **INFERENCE**: my reasoning, not measured.
- **UNVERIFIED**: I could not fetch or measure it.

This report does not repeat reports 03 (engine engineering), 10 (microarchitecture), 11 (durability, group commit, batching), or BRAIN-ARCHITECTURE. It goes below them to the row, lock, WAL-record and plan-cache level of the engine as it exists in 071. Where report 11 measured a *synthetic* set-based batch, this report measures the *real* 071 function, and the two disagree in one important way (§3.8).

---

## 0. Executive summary

**Where one order's time goes.** Conditions: private PG 17.6 container, 2 vCPU, local disk with 269 µs fdatasync, 071 engine, 60-deep book, 0.70 fills per order.

- **Server time is ≈1.54 ms per order [M-SPLIT].**
  - ≈1.12 ms is SQL executed through SPI. That includes 69 µs of foreign-key (RI) checks, 48 µs in the profile-stats trigger, and 8.5 µs recomputing a `tsvector`.
  - ≈0.42 ms is PL/pgSQL interpretation, expression evaluation and function overhead.
- **The commit adds ≈0.36–0.50 ms of WAL flush [M-SYNC].**
- **Time grows by ~0.65–1.0 ms per fill [M-FILLS]:**

  | Fills | p50 |
  |---|---|
  | 0 | 1.34 ms |
  | 1 | 2.32 ms |
  | 2 | 2.92 ms |
  | 3 | 3.60 ms |
  | 4+ | 4.18 ms |

**What one order touches** [M-LOCKS], [M-WAL]:
- A resting order takes 18 relation locks. A crossing order takes **103 relation locks, of which 86 overflow the 16 fast-path slots** into the shared lock table.
- An order writes **48 WAL records and 5.9 kB** in steady state (7.4 kB in the first run after setup). Of those records:
  - 25.0 are B-tree leaf inserts;
  - **9.2 are `Heap/LOCK` records**, row locks written into tuple headers;
  - 1.4 are non-HOT heap updates;
  - 1.2 are GIN metapage updates. These come from the `markets` row update on every trade.
- Right after a checkpoint, full-page images raise WAL to **16–25 kB per order** [M-FPW].

**Three hidden costs in the 071 statements**, all verified in source and measured:

1. **The `markets` update recomputes the search vector on every trade.** `markets` has a `BEFORE UPDATE` trigger (`update_markets_updated_at`), and PG 17 recomputes *every* stored generated column when a BEFORE ROW UPDATE trigger exists (`nodeModifyTable.c:390-399`). So every trade reruns `markets_tsv(title, tags, description)`.
   - The update is also never HOT: it writes new entries into all 19 `markets` indexes, 3 of them GIN.
   - Cost: 333 µs mean per trade [M-PGSS], the most expensive statement in the engine.
   - The trigger is redundant: the statement already sets `updated_at = now()`.
2. **The taker's own order row is inserted, then updated in the same transaction.** RI "update" triggers normally skip when key columns are unchanged, but not for a row the current transaction inserted (`ri_triggers.c:1322-1331`). So every order pays its 4 FK checks twice.
   - The final `status` change also defeats HOT, because `status` appears in the predicates of the partial indexes: `clob_orders` updates were 59% HOT [M-HOT].
3. **`SELECT … FROM markets … FOR UPDATE` conflicts with `FOR KEY SHARE`.** While any order on a market is in flight, every foreign-key insert that references that market from *another* transaction blocks. That includes posting a comment. Measured: a comment insert times out under `FOR UPDATE` and proceeds under `FOR NO KEY UPDATE` [M-FKBLOCK].

**Plan caching is worth ~2 ms per order.** Forcing custom plans halves throughput: 216–224/s versus 383–419/s [M-PLAN].
- A fresh backend's first call costs **25 ms**, and calls 2–8 cost 3–7 ms, while plans warm up [M-COLD].
- So pooler or PostgREST connection churn is expensive. The SPI plan cache lives in the backend, so it *does* survive transaction pooling as long as the server connection is reused.

**Concurrency on one market.** With 8 clients on one market, wait sampling shows:
- **72% `Lock:tuple` and 12% `Lock:transactionid`**: the FIFO queue on the `markets` row;
- 12% on CPU;
- 2.7% `IO:WalSync`.

Throughput equals the single-client rate: 379–403/s [M-WAIT].

**Every round trip made while the lock is held costs throughput.** An extra 150 µs local round trip inside the transaction cut per-market throughput from 377 to 334 to 313/s [M-RTT]. Heavyweight locks are released only *after* `XLogFlush` (`xact.c:2325` → `2349` → `2392`), so the per-market critical section is execution time plus flush time plus handoff time.

**Ranked fixes, measured cumulatively.** Single client, one market; 8 clients on one market in brackets.

| Step | Change | Orders/s |
|---|---|---|
| V0 | baseline | ≈414 [403] |
| V1 | drop the redundant BEFORE trigger on `markets` | ≈434 |
| V2 | move the profile-stats trigger off the hot path | ≈458 |
| V3 | advisory lock replaces the `markets`/`market_options` row locks | ≈460 |
| V4 | move `markets`/`market_options`/`price_history`/`market_activity` writes out of the transaction | ≈469–503 [479] |
| V5 | remove the 17 FKs on the four hot tables | **≈577 [660]** |

- WAL records per order fell from 48 to 32.
- `synchronous_commit=off` alone gives 481–541/s. It is not recommended for money (§3.8).

**Batching real orders.** 10 orders of the *real* PL/pgSQL engine per transaction reach only 475–509/s, versus 386–419/s one per transaction [M-BATCH]. Unlike report 11's set-based synthetic apply, per-order statement execution (≈1.5 ms) dominates, not the 0.4 ms flush. Batching only pays once the per-order work is set-based. INFERENCE backed by M-BATCH and report 11 §2.2.

**Serial ceiling.**
- Today's statement shape on local NVMe: ≈400–500 orders/s per market.
- Supabase gp3, flush 1–3 ms (UNVERIFIED for Kichiko's instance): ≈220–330/s.
- Lean V5 shape on gp3: ≈300–400/s.
- One PL/pgSQL call per order cannot exceed ≈1/T_exec ≈ 650–900/s even with asynchronous commit.
- Beyond that, matching must leave per-row PL/pgSQL. Postgres then applies the results set-based, at ~65–70 µs per order per report 11.

**Supabase in 2026:**
- **PG 18 is not offered.** `supabase/postgres` `ansible/vars.yml` on `develop` lists majors 15, 17 and orioledb-17 only.
- **No compiled code.** The PG 17 image ships `pg_tle 1.4.0` and `plpgsql_check 2.7`. It has no PL/Rust or plv8, and plv8 is deprecated on PG 17 [DOC].
- So "rewrite the engine in C/Rust inside the database" is not an option on Supabase. It could save at most the ≈0.42 ms non-SQL share anyway.

---

## 1. Method and environment

**[ENV] Private throwaway container `k13`.** I did not use the shared replica `kdb`, except for read-only catalog and settings queries, or `kdb2` (port 54323, owned by another agent).

- Built with `docker run supabase/postgres:17.6.1.011` (`PostgreSQL 17.6 … gcc 13.2.0`) and `--cpus=2` on a 4-vCPU Firecracker VM (kernel 6.18). Other agents' containers were running, so expect ±5–10% noise.
- Schema: `pg_dump --schema-only -n public -n auth` of `kdb`, restored into `k13`. The only restore error was "schema public already exists". The 071 function (`yes_px`, `book_side`, `idx_clob_orders_asks/bids`) is present.
- Config: the image defaults.
  - `shared_buffers=128MB`, `wal_level=logical`, `synchronous_commit=on`, `full_page_writes=on`, `wal_compression=off`, `wal_sync_method=fdatasync`.
  - `checkpoint_timeout=300s`, `max_wal_size=1GB`, `max_locks_per_transaction=64`, `plan_cache_mode=auto`, `jit=on`.
  - `shared_preload_libraries` includes `pg_stat_statements, pgaudit, plpgsql_check, pg_cron, pg_net, auto_explain, pg_tle, …` (identical on `kdb`).
- In `k13` only I enabled `track_wal_io_timing`, `track_io_timing` and `track_functions=all`, and set `pg_stat_statements.track` to `all` for the statement-breakdown runs and `top` otherwise.
- `pg_test_fsync` inside the container: **fdatasync 269 µs/op, open_datasync 266 µs/op**.

**Workload.** The repo's own generator, `scripts/ops/clob/bench_engine.py` (`fresh --users 200 --markets 4 --depth 60`), called before every run, so the book restarts at 60 resting bids per market.
- Order flow as in `bench_engine.run`: buy-only; 70% of orders priced at 45–60 (marketable against the complement book, so mint matches), 30% passive at 20–44; size 1–30.
- Resulting 0.69–0.74 fills per order.

**Harness** (scratchpad):
- `hp.py`: psycopg2, autocommit, one call per order. It snapshots `pg_stat_wal`, `pg_stat_database` and `pg_stat_user_tables` around each run.
- `runv.sh` / `runw.sh`: fresh book plus run; `runw.sh` also samples wait events.
- `waits.py`: samples `pg_stat_activity` every 5 ms.
- `mb.sql`: microbenchmarks.
- `pgrst_conc.py`: lock-hold round-trip test.
- Raw results: `scratchpad/bench/hp_results.jsonl` (54 runs).

**Caveats.**
- Round trips go through docker's userland port proxy, so one `select 1` round trip costs 151 µs [M-RTT0]. That inflates client-side latency relative to a unix socket.
- The container has 2 vCPUs, so multi-client runs are CPU-bound.
- `pg_stat_statements.track=all` adds per-nested-statement overhead. Use its absolute µs as upper bounds and its ratios as reliable.

---

## 2. Anatomy of one order (071), statement by statement

### 2.1 Statement inventory with measured cost [M-PGSS]

Run: 5,904 orders, 1 client, 1 market, `track=all`. "µs/order" = mean × calls ÷ orders. Nested rows run *inside* the parent statement's time. The "Line" column gives the 071 line numbers (`071_clob_index_ordered_ladder.sql`).

| Line | Statement | Calls per order | Mean µs | µs/order | WAL records per call |
|---|---|---|---|---|---|
| 245 | `INSERT clob_orders` (taker) + 4 RI checks | 1.00 | 164 | **164** | 7.1 |
| 433 | `INSERT transactions` (maker, per fill) + 5 RI + profile trigger | 0.67 | 230 | **155** | 10.1 |
| 548 | `UPDATE markets` (volume, bets): non-HOT, tsvector recompute, 19 indexes | 0.39 | **333** | **129** | 15.1 |
| 524 | `UPDATE clob_orders` (taker final status): RI re-check, non-HOT | 1.00 | 113 | **112** | 2.0 |
| 448 | `INSERT clob_fills` + 4 RI | 0.67 | 111 | 75 | 5.7 |
| 353 | `UPDATE clob_orders SET reserved_usd` (maker, second update of the same row) | 0.67 | 108 | 73 | 3.1 |
| 531 | `INSERT transactions` (taker) | 0.39 | 187 | 72 | 10.1 |
| 323 | `UPDATE clob_orders` (maker filled/status) | 0.67 | 82 | 55 | 3.5 |
| 356 | `INSERT … ON CONFLICT positions` (maker) | 0.67 | 72 | 48 | 2.4 |
| 476 | `UPDATE wallets` (taker) | 1.00 | 45 | 45 | 1.0 |
| 148/155/163 | 3 × `count(*)` caps and rate limit | 3.00 | 24/5/24 | 53 | ~0 |
| 552 | `UPDATE market_options` (price, volume) | 0.39 | 75 | 29 | 1.0 |
| 354 | `UPDATE wallets` (maker reserved) | 0.67 | 42 | 28 | 2.0 |
| 559/561 | `INSERT price_history` / `market_activity` | 0.39 each | 70 / 63 | 51 | 4.1 / 3.1 |
| 483 | positions upsert (taker) | 0.39 | 69 | 27 | 2.8 |
| 180/185/203/303 | `SELECT … FOR UPDATE` (market, option, wallet, maker) | 3.67 | 8–13 | 38 | 1.0 each |
| 268–296 | ladder cursor (index-ordered, 071) | 1.00 | 10–11 | 11 | ~0 |
| nested | `UPDATE profiles` (trigger `update_profile_stats`) | 1.06 | 47 | 50 | 2.0 |
| nested | RI `SELECT 1 … FOR KEY SHARE` on market_options / markets / profiles / wallets / clob_orders | **19.9** | 3.3–6.8 | ~92 | 0–0.4 |
| nested | `markets_tsv()` body (generated column) | 0.39 | 25 | 10 | 0 |

**Function total [M-SPLIT]** (second run, 6,340 calls): 1,543 µs mean.
- SPI statements: 1,122 µs. This includes RI (69), the profile trigger (48) and the tsvector recompute (8.5).
- Everything else: **421 µs per order**. That covers PL/pgSQL statement dispatch, `exec_eval_simple_expr` evaluations (roughly 150 numeric expressions per fill), jsonb building (`v_fills || jsonb_build_object(...)` per fill plus the return object), `%ROWTYPE` copies (`SELECT * INTO v_market` deforms a ~40-column row), and the function prologue.

### 2.2 Heavyweight locks per order [M-LOCKS]

Measured by calling the function and then reading `pg_locks` for our own PID in the same transaction (rolled back), after 20 warm-up calls.

| Order type | Relation locks | Fast-path | In shared lock table |
|---|---|---|---|
| Resting (no fill) | 18 | 16 + vxid | 3 |
| Crossing (≥1 fill) | **103** | 16 (+ vxid, xid) | **86** |

On a cold backend (first call), even a resting order took 61 relation locks, 45 of them in the shared table. The planner opens every index of every table it plans for.

Why a crossing order takes ~100 relation locks:

- **Result relations lock every index.** Every INSERT or UPDATE target opens *all* of that table's indexes with `RowExclusiveLock`: `ExecOpenIndices` → `index_open(indexOid, RowExclusiveLock)` (`execIndexing.c:157,205`). `markets` alone contributes 20 locks (the table plus 19 indexes), `positions` 10, and `clob_orders` and `transactions` 8 each.
- **`FOR UPDATE` and `FOR KEY SHARE` scans hold `RowShareLock`.** They hold it on the table and on indexes the plan touches. The RI queries add their parents' locks.
- **Only 16 locks fit in fast-path slots.** In PG 17 `FP_LOCK_SLOTS_PER_BACKEND = 16` (`proc.h:86`), and only weak modes (< `ShareUpdateExclusiveLock`) on relations qualify (`lock.c:213-218`, `EligibleForRelationFastPath`). The other ~86 take the partitioned shared lock table: one of `NUM_LOCK_PARTITIONS = 16` LWLocks (`lwlock.h:96-97`), a shared-hash insert, and a matching release in `LockReleaseAll` at commit.
- **Uncontended, this is cheap.** `LWLock:LockManager` was only 0.6–1.2% of wait samples at 8 clients [M-WAIT]. It becomes the classic wall only at hundreds of concurrent backends (see the AWS figures in report 03 §1.6).

**PG 18 change [SRC, REL_18_STABLE].**
- Fast-path capacity becomes `FP_LOCK_SLOTS_PER_GROUP (16) × FastPathLockGroupsPerBackend`.
- The group count is computed at startup as `Max(Min(pg_nextpower2_32(max_locks_per_xact) / 16, 1024), 1)` (`postinit.c:580-601`, `proc.h:87-100`). The code comment says "The default max_locks_per_transaction = 64 means 4 groups by default", i.e. 64 slots.
- Release note: "Improve the locking performance of queries that access many relations (Tomas Vondra)", commit c4d5cb71d (`release-18.sgml`).
- Kichiko's ~103-lock crossing order needs `max_locks_per_transaction ≥ 128` to fit entirely in fast-path slots on PG 18. INFERENCE from the formula.
- This matters only if PG 18 becomes available on Supabase, which it is not (§5).

### 2.3 WAL generated per order [M-WAL]

`pg_walinspect.pg_get_wal_stats(start, end, per_record => true)` over 3,807 orders (first 10 s after `fresh`):

| Record type | Per order | Share of bytes | Where it comes from in 071 |
|---|---|---|---|
| `Btree/INSERT_LEAF` | **25.0** | 61.7% (FPI-heavy after setup) | every non-HOT update and every insert, into every index |
| `Heap/LOCK` | **9.2** | 4.9% | `FOR UPDATE` on market/option/wallet/maker rows plus RI `FOR KEY SHARE` on parent rows |
| `Heap/HOT_UPDATE` | 5.6 | 10.7% | wallets, positions, profiles, market_options, some clob_orders |
| `Heap/INSERT` | 3.6 | 9.4% | clob_orders, clob_fills, transactions ×(1+fills), price_history, market_activity |
| `Heap/UPDATE` (non-HOT) | 1.4 | 4.1% | markets (always), clob_orders when status changes |
| `Gin/UPDATE_META_PAGE` | 1.2 | 2.8% | markets GIN indexes (tags, title trigram, search_vector) pending-list inserts |
| `Transaction/COMMIT` | 1.0 | 0.4% | one per order |

Steady-state totals from `pg_stat_wal`:
- **48.3 records, 5.8–6.2 kB per order**, with 0–0.28 full-page images per order in long runs.
- Right after `CHECKPOINT`: **1.7–3.5 FPI and 16–25 kB per order** [M-FPW].

Mechanism [SRC]:
- Every `XLogInsert` checks whether the buffer's page LSN is at or before the current `RedoRecPtr` (`xloginsert.c:507-520`, `GetFullPageWriteInfo` / `XLogRecordAssemble(..., doPageWrites, ...)`). If so, it logs the whole 8 kB page.
- Every *distinct* page an order touches in a new checkpoint cycle pays one full-page image. With ~25 index leaf pages per order and random `transactions`/`positions` keys, the first-touch rate is high after each checkpoint.

`wal_compression` [M-FPW], same post-checkpoint conditions:
- lz4 cut 16.0 kB to 14.2–14.8 kB per order; zstd to 12.8 kB.
- Throughput was unchanged within noise: 420–440/s, versus 396/s for zstd.
- WAL volume is not the bottleneck at these rates: 500/s × 6 kB = 3 MB/s.

---

## 3. Internals, layer by layer

### 3.1 PL/pgSQL → SPI → plan cache

**Mechanism [SRC].**
- Each embedded SQL statement is an `exec_stmt_execsql` (`pl_exec.c:4202`). It is prepared once per backend by `exec_prepare_plan` (`:4161`) and run by `SPI_execute_plan_extended` (`:2230`).
- In SPI, `_SPI_execute_plan` (`spi.c:2399`) calls `GetCachedPlan` (`:2577`). For a non-read-only function it pushes a fresh snapshot per statement (`PushActiveSnapshot(GetTransactionSnapshot())`, `:2613`) and does a `CommandCounterIncrement()` after each statement (`:2667`). So every SQL line in the function pays at least three things:
  - snapshot acquisition;
  - `ExecutorStart`: plan revalidation, `AcquireExecutorLocks` on the range table, node initialisation, `ExecOpenIndices` for DML targets;
  - `ExecutorEnd` and trigger-queue processing.
- Assignments whose right side is a "simple expression" skip the executor through `exec_eval_simple_expr` (`:6027`, qualified by `exec_simple_check_plan`, `:7981`).
- **Custom versus generic plans.** `choose_custom_plan` (`plancache.c:1054-1097`) honours `plan_cache_mode` first (`:1070-1072`). Otherwise it uses custom plans while `num_custom_plans < 5` (`:1082`), then switches to the generic plan if `generic_cost < avg_custom_cost` (`:1097`). Each backend therefore plans every statement at least 5 times before it settles.

**Measured [M-PLAN].** Single client, fresh book each run, 2 repetitions.

| `plan_cache_mode` | Orders/s | p50 |
|---|---|---|
| auto (default) | 386–419 | 1.62–1.80 ms |
| force_generic_plan | 383–404 | 1.61–1.79 ms |
| **force_custom_plan** | **216–224** | 2.97–3.16 ms |

- Planning every statement costs ≈2.0 ms per order: 2.59 → 4.63 ms mean.
- `auto` behaves like `generic` here, so the generic plans are good. The ladder's partial-index predicates (`status IN (...) AND book_side='ask'`) are constants, so the generic plan can still use `idx_clob_orders_asks/bids`.

**Cold backend [M-COLD]** (new connection per trial, 25 trials, medians):

| Step | Median |
|---|---|
| Connect | 11.3 ms |
| Call 1 | **25.1 ms** |
| Call 2 | 7.5 ms |
| Calls 3–8 | 3.0–6.4 ms |
| Calls 9–12 | 2.7–3.8 ms |

- The first call pays syscache/relcache loading, PL/pgSQL compilation and one custom plan per statement reached. The following calls reach new branches and still use custom plans.
- INFERENCE: any pool that recycles server connections often multiplies order latency. Examples: PgBouncer/Supavisor `server_lifetime`, `server_idle_timeout`, or PostgREST pool churn.

**Microbenchmarks [M-MB]** (`mb.bench`, PL/pgSQL loops, one transaction per run, median of 3):

| Operation (inside PL/pgSQL) | ns/op |
|---|---|
| `x := x + 1` (simple expression) | 65 |
| `r := round((i*57.3)/100.0, 6)` (numeric) | 314 |
| call of an inlinable SQL function `a+b` | 66 (inlined) |
| call of a PL/pgSQL function `a+b` | 861 |
| same, `SECURITY DEFINER SET search_path` | 1,363–1,437 |
| `SELECT … INTO` by primary key (SPI, generic plan) | 4,572 |
| same with `FOR UPDATE` | 5,984 |
| `PERFORM … FOR KEY SHARE` (what an RI check does) | 6,157 |
| `pg_advisory_xact_lock(i)` | 2,532 |
| `EXECUTE` dynamic SQL, same select | 22,212 |
| HOT `UPDATE`, 1 index | 8,238 (126 B WAL) |
| HOT-eligible `UPDATE`, 8-index table | 15,983 (331 B) |
| non-HOT `UPDATE`, 8 indexes | 19,302 (695 B) |
| `INSERT`, pk only | 6,821 (174 B) |
| `INSERT … RETURNING id INTO` | 7,566 |
| `INSERT` with 4 FKs | **33,837** (230 B) |
| `INSERT` with a STORED generated column (`amt*2`) | 11,195 |
| `INSERT` + AFTER ROW PL/pgSQL no-op trigger | 9,708 |
| `INSERT` + BEFORE ROW PL/pgSQL no-op trigger | 10,305 |
| set-based `INSERT … SELECT generate_series` | 2,905 per row |
| set-based, 4 FKs | 24,203 per row |

Readings:
1. One RI check costs ≈6.8 µs, (33.8 − 6.8) / 4. It runs the same SPI query as `PERFORM … FOR KEY SHARE`.
2. A row trigger costs 3–3.5 µs even when it does nothing.
3. `RETURNING` costs ≈0.7 µs.
4. A stored generated column adds ≈4.4 µs for a trivial expression. Much more for `markets_tsv`: 25 µs per call [M-PGSS].
5. Set-based insert is 2.3× cheaper per row than a PL/pgSQL loop, but not when FKs dominate. RI triggers still fire per row.
6. Dynamic SQL is 4.9× the cost of static SQL. 071 correctly uses none.

In the real engine the per-statement costs (45–333 µs) are 5–40× these microbenchmark costs. Reasons (INFERENCE, supported by §2.1): each real statement touches wider rows, more indexes (up to 19), 4–5 RI checks, triggers and numeric expressions, and the pgss `track=all` instrumentation inflates it.

### 3.2 Executor startup and index maintenance

- A single-row `UPDATE` or `INSERT` pays per-index work proportional to the number of indexes on the target, unless the update is HOT. That work: open and lock each index, form an index tuple, descend the B-tree, lock the leaf buffer (`LWLock:BufferContent`), insert, and write a WAL record.
- `markets` has 19 indexes (listed in §2.3 context):
  - 3 are GIN: `idx_markets_tags`, `idx_markets_title_trgm` (trigram, so one entry per trigram of the title) and `idx_markets_search_vector`;
  - 2 contain `total_volume_usd`, which every trade changes;
  - so each trade's `markets` update is non-HOT and inserts into all of them.
- EXPLAIN of that update on a warm backend, with the `update_markets_updated_at` trigger dropped: 0.149 ms, 15 WAL records, 1,946 B, plus 0.104 ms for an RI re-check (`markets_creator_id_fkey`) when the row was already updated earlier in the same transaction. GIN uses the pending list (`fastupdate`), which explains the `Gin/UPDATE_META_PAGE` records.

### 3.3 Row locks: xmax, `Heap/LOCK`, the tuple-lock queue, MultiXact

**Mechanism [SRC: `README.tuplock`, `heapam.c`].**
- A row lock is written into the tuple header: "a tuple is marked as locked by setting the current transaction's XID as its XMAX". `heap_lock_tuple` (`heapam.c:4803`) dirties the heap page and emits an `XLOG_HEAP_LOCK` record (`:5474`). So a `SELECT … FOR UPDATE` is a page write plus a WAL record, and an RI `FOR KEY SHARE` on a parent row not yet locked by this transaction is too.
  - Measured: 9.2 `Heap/LOCK` records per order.
- **Waiting is two-level.** A waiter does `LockTuple()` (heavyweight tuple lock, which is the queue), then `XactLockTableWait()` on the holder's xid.
  - Measured at 8 clients on one market: **71.9% `Lock:tuple`, 12.4% `Lock:transactionid`** [M-WAIT]. One waiter sleeps on the holder's xid while the other six queue on the tuple lock.
  - Every handoff costs a wake-up and context switch, and the woken waiter re-evaluates its `WHERE` clause (Read Committed EvalPlanQual). INFERENCE, standard mechanism.
- **MultiXact.** When more than one transaction locks the same row, xmax becomes a MultiXact id. Examples: a `FOR KEY SHARE` from an RI check plus a `FOR NO KEY UPDATE` from an `UPDATE`.
  - Measured at 8 clients over 4 markets: `next_multixact_id` went 488 → 925, i.e. **437 MultiXacts for 9,516 orders (4.6%)** [M-MX].
  - Candidate rows, all shared across markets (INFERENCE from the FK graph): `profiles` (`clob_orders.user_id`, `transactions.user_id` and `positions.user_id` RI checks, plus the profile-stats `UPDATE`) and `wallets` (`wallet_id` FKs plus balance updates).
  - Each MultiXact costs SLRU pages (`pg_multixact`), extra WAL and, eventually, anti-wraparound work (`autovacuum_multixact_freeze_max_age`).

**Lock strength matters [M-FKBLOCK].** Measured with session A holding `SELECT id FROM markets WHERE id=X <mode>` open while session B, with `lock_timeout = 300ms`, inserted a comment for market X:
- `FOR UPDATE` → B **blocked, timed out (55P03)**;
- `FOR NO KEY UPDATE` → B proceeded.

This follows the conflict table: `FOR UPDATE` conflicts with `FOR KEY SHARE` [README.tuplock, report 03 §1.1]. 071 line 180 uses `FOR UPDATE`, so during trading any FK insert into a child of `markets` from another transaction waits behind the whole order queue on that row. `comments` is the obvious case.

**Advisory versus row lock.**
- Advisory: 2.5 µs, no heap page, no WAL. Row lock: 6.0 µs including the SELECT, plus a page write and a WAL record [M-MB].
- In the full engine, swapping the market and option row locks for `pg_advisory_xact_lock(hashtextextended(market_id::text,0))` measured about zero gain on its own (V2 456–459/s → V3 459–460/s) [M-CUMUL]. The market row lock is not where the time goes.
- The real benefits are elsewhere:
  - no `FOR UPDATE`/`FOR KEY SHARE` conflict with other writers;
  - no tuple-lock plus xid double wait: advisory waiters queue directly in the lock manager;
  - one fewer `Heap/LOCK` record per order;
  - it frees the `markets` row for readers that need `FOR SHARE`.
- Advisory locks do not go through fast-path (`EligibleForRelationFastPath` requires `LOCKTAG_RELATION`), so each costs one shared-lock-table entry [SRC `lock.c:213`].

### 3.4 Foreign keys: RI triggers on the hot path

**Counts.**
- Each hot table carries RI "check" triggers: `clob_orders` 4, `clob_fills` 4, `transactions` 5, `positions` 4, `price_history` 2, `market_activity` 3.
- On the parent side, "action" triggers fire only when a parent key changes (`markets` has 28, `profiles` 96), which never happens here [M-CAT].
- Measured: **19.9 RI queries per order** (117,240 over 5,904 orders), 3.3–6.8 µs mean each, about 69–92 µs per order of direct query time [M-PGSS]. Add the AFTER-trigger queue work.

**Why so many [SRC `ri_triggers.c:1322-1331`].** `RI_FKey_fk_upd_check_required` skips the check when the key columns are unchanged, *except*:

> "If the original row was inserted by our own transaction, we must fire the trigger whether or not the keys are equal."

- 071 inserts the taker's `clob_orders` row (line 245) and updates it at line 524, so its 4 FK checks run twice.
- A `positions` row created by an upsert earlier in the same order and updated later would too (for example the taker's MINT branch).
- The same rule is why batching several orders per transaction *raises* RI work: from the second order in the batch on, rows updated earlier in the batch look "inserted by our own transaction". Observed in the EXPLAIN test (§3.2) and consistent with [M-BATCH].

**Effect of removing them [M-CUMUL].** V4 → V5 dropped the 17 FKs on `clob_orders`, `clob_fills`, `transactions` and `positions`:
- single client **+15–18%** (469–503 → 564–590/s), 8 clients on one market **+38%** (479 → 660/s);
- WAL records 36.6 → 31.8 per order, from fewer `Heap/LOCK` records.

This is an upper bound on what FK work costs. It is not a recommendation to drop integrity blindly (§7, item 5).

**PG 18 adds `NOT ENFORCED` foreign keys** (commit eec0040c4, `release-18.sgml:10718`). They are declarative documentation with no trigger cost. That option is unavailable on Supabase PG 17.

### 3.5 Triggers and generated columns

1. **`update_markets_updated_at` (BEFORE UPDATE ROW) forces the generated tsvector to be recomputed.** `ExecInitStoredGenerated` (`nodeModifyTable.c:382-432`):

   > "In an UPDATE, we can skip computing any generated columns that do not depend on any UPDATE target column. But if there is a BEFORE ROW UPDATE trigger, we cannot skip because the trigger might change more columns."

   - Measured: `markets_tsv()`'s body ran 2,285 times, once per `markets` update, 25 µs each [M-PGSS].
   - Dropping the trigger (V1) raised throughput 414 → 434/s (+5%) [M-CUMUL].
   - The trigger adds nothing: 071 line 550 already sets `updated_at = now()`.
2. **`update_profile_stats_on_transaction` (AFTER INSERT ROW on `transactions`).** For every `bet_placed` ledger row, it runs `UPDATE profiles SET total_bets=…, total_volume_usd=…, profit_loss_usd=…`.
   - 1.06 profile updates per order, 47 µs each, and they touch a row that is shared across markets. That is a cross-market deadlock and MultiXact source (§3.3).
   - Moving it off the hot path (V2) raised throughput 434 → 458/s (+5.5%) [M-CUMUL].
3. **071's stored generated columns** `yes_px` and `book_side` cost ≈4 µs per insert (microbenchmark reading 4). They are **required**: PG 18's new virtual generated columns cannot be indexed ("Also disallow virtual generated columns in indexes", `indexcmds.c:1122`, REL_18_STABLE), and 071's ladder indexes need them.

### 3.6 HOT and fillfactor [M-HOT]

Update and HOT counts over one run:

| Table | Updates | HOT | HOT % | Why |
|---|---|---|---|---|
| wallets | 10,389 | 10,333 | 99.5% | balances not indexed |
| positions | 6,763 | 6,763 | 100% | 071 narrowed the indexes |
| profiles | 6,763 | 6,738 | 99.6% | |
| market_options | 2,461 | 2,461 | 100% | |
| **clob_orders** | 14,691 | 8,660 | **59%** | `status` appears in the predicates of 5 partial indexes (`idx_clob_orders_asks/bids/book/expiry/user_open`), so a status change is non-HOT |
| **markets** | 2,461 | 0 | **0%** | `total_volume_usd` is in 2 indexes |

**Mechanism [SRC].** `heap_update` (`heapam.c:3348`) builds `hot_attrs` from `RelationGetIndexAttrBitmap` (`:3436`). That bitmap includes the columns used in index *predicates* and *expressions*, not just key columns. `HeapDetermineColumnsInfo` (`:3532`) then compares old and new values. The update is HOT only if no such attribute changed *and* the new version fits on the same page (`:4151`). PG 16+ also allows "summarized" updates that touch only BRIN-type indexes (`summarized_update`, `:4161`); none exist here.

**Consequences.**
- *Filled or partially filled maker orders.* The first fill changes status from `open` to `partially_filled` or `filled`, which is non-HOT and writes 7 index entries. Later partial fills (`partially_filled` → `partially_filled`) are HOT-eligible.
- *Taker order row.* It always changes status (`open` → final), so it is always non-HOT. Inserting it once with its final status avoids that update (§7, item 3).
- *`fillfactor = 90`* (migration 054) is enough for HOT on `wallets`, `positions` and `profiles`. In a long transaction (batching), repeated updates of the same row cannot be pruned until commit. Chains grow and pages fill: 30,000 HOT-eligible updates in the 8-index microbenchmark stayed only 61% HOT [M-MB].

### 3.7 WAL insertion and LWLocks

- WAL insertion takes one of `NUM_XLOGINSERT_LOCKS = 8` insertion locks (`xlog.c:151`), reserves space, CRCs and copies the record. At 48 records per order and ≈500 orders/s, that is ≈24k records/s, far below the level where `WALInsert` contends.
  - Measured: zero `LWLock:WALInsert` samples at 8 clients [M-WAIT]. INFERENCE: not a factor below tens of thousands of records per second on this core count.
- `LWLock:WALWrite` reached 7.2% of samples and `IO:WalSync` 7.0% with 8 clients over 4 markets. That is group commit working: waiters queue on `WALWriteLock` while one backend flushes for all.
- `LWLock:LockManager`: 0.6–1.2%. `LWLock:BufferContent` (leaf-page locks): 0.0–0.3%. Buffer-mapping partitions (`NUM_BUFFER_PARTITIONS = 128`, `lwlock.h:93`) never appeared.
- At this scale the contention is *heavyweight* row locks, not LWLocks.

### 3.8 The commit path: flush, lock release, sync levels, group commit

**Order of operations [SRC `xact.c`].**
1. `CommitTransaction` calls `RecordTransactionCommit()` (`:2325`).
2. If the transaction wrote WAL and `synchronous_commit > off`, it calls `XLogFlush(XactLastRecEnd)` (`:1487-1491`), then updates CLOG.
3. Then `SyncRepWaitForLSN` (`:1546`) if synchronous standbys are configured.
4. **Only after that** do `ProcArrayEndTransaction` (`:2349`) and `ResourceOwnerRelease(..., LOCKS)` (`:2392`) release the row, xid and advisory locks.

Consequence: **the per-market critical section includes the flush and any synchronous-replica round trip.** No lock design inside Postgres removes the flush from the serial section, short of turning off synchronous commit.

**`XLogFlush` group commit [SRC `xlog.c:2775-2879`].** A backend takes `WALWriteLock` with `LWLockAcquireOrWait` (`:2849`), so late arrivals piggyback on the current holder's flush. If `CommitDelay > 0` and at least `CommitSiblings` other backends are active, it sleeps `commit_delay` first (`:2876-2879`). Within one market there is never a second committer to share a flush, because they queue on the row lock. Report 11 §2.2 says the same.

**Measured [M-SYNC] [M-CD].**

| Setting | 1 client (orders/s, p50) | 8 clients, 1 market | Syncs per order |
|---|---|---|---|
| `synchronous_commit=on` | 386–419, 1.62–1.80 ms | 403 | 1.0 (avg sync 357–468 µs) |
| `local` | 390, 1.80 ms | – | 1.0 |
| `off` | 476–541, 1.08–1.29 ms | **491** | 0.01 |

- With `off`, the loss window is up to 3 × `wal_writer_delay` = 600 ms of acknowledged commits on a *server crash*, not corruption [report 03 §1.5, DOC via report 03]. For money-moving fills this remains unacceptable (report 03).
- `commit_delay` 0 / 200 / 1000 µs with `commit_siblings=2`, 8 clients over 4 markets: 1,026–1,282 / 1,023–1,155 / 996–1,014 orders/s. Orders per sync rose from 1.2 to 1.4 to 1.7, but throughput did not improve, because the 2-vCPU box is CPU-bound and the local flush (269 µs) is short.
  - INFERENCE: on gp3 with a 1–3 ms flush, `commit_delay ≈ 100–300 µs` may help *cross-market* throughput. Measure on the real tier.

**Batching the real engine [M-BATCH].** One client, one market, N sequential `clob_place_order` calls inside one `BEGIN…COMMIT`:

| N | Orders/s | Syncs per order | Commit-cycle p50 |
|---|---|---|---|
| 1 | 386–419 | 1.0 | 1.6–1.8 ms |
| 10 | 475–493 | 0.11 | 19.4–20.3 ms |
| 50 | 504 | 0.03 | 96 ms |
| 10, `sync=off` | 509 | 0.01 | 19.1 ms |

- The function's own mean is 1.53 ms per call inside a batch versus 1.62 ms alone (pgss). So amortising the flush saves only the ≈0.4–0.5 ms flush share, +20–25%.
- Report 11's 20× gain came from a *set-based* apply, 64–71 µs per order. The two results agree once you see that **the cost to cut is per-order statement execution, not the commit**.
- INFERENCE: batching PL/pgSQL order calls also raises RI re-checks (§3.4) and HOT-chain length (§3.6) within the transaction, which partly offsets the gain.

---

## 4. PL/pgSQL versus SQL functions versus C/Rust, and what Supabase allows

**Measured split of the real engine [M-SPLIT].** 1,122 µs of SQL (73%) versus 421 µs of everything else (27%).

- A perfect C or Rust port of the *same* statement sequence keeps the SPI/executor cost. SPI from C runs the same `_SPI_execute_plan`.
- So the port could save at most ≈0.42 ms of 1.54 ms. INFERENCE: realistically less, because jsonb building, numeric maths and row copies still cost something in C. Numeric is arbitrary-precision in any language unless replaced by int64 micro-units.

**Language call overheads [M-MB].**
- An inlinable `LANGUAGE sql` function costs nothing: 66 ns, the same as inline code, because the planner substitutes the body.
- A PL/pgSQL function call costs 0.86 µs, and 1.4 µs with `SECURITY DEFINER SET search_path` (071 uses both).
- Numeric expression evaluation costs ≈0.3 µs each in PL/pgSQL.
- A `LANGUAGE sql` function *with multiple statements* is not inlined and runs each statement through the executor (functions.c), so it is no faster for DML. INFERENCE from the documented inlining rules. Not separately measured.

**Published PL/Rust versus PL/pgSQL numbers.** A web-search extract attributes to a pganalyze/InfoQ write-up "PL/pgSQL 14 s vs PL/Rust 3 s" (≈4.6×) on a vector-building function, with plv8 at 53 s. **UNVERIFIED**: `pganalyze.com` and `infoq.com` are blocked here, and the workload is CPU arithmetic, not DML. For a DML-bound engine like 071, the achievable gain is bounded by the 27% non-SQL share measured above.

**What Supabase allows (verified 2026-09-26).**
- `supabase/postgres` build vars (`develop`) list `postgres_major: "15", "17", orioledb-17` and releases `postgres17: "17.6.1.177"`, `postgres15: "15.14.1.177"` [DOC-SPVARS].
- The PG 17 image's `supautils.privileged_extensions` includes `pg_tle`, `plpgsql_check`, `pljava`, `plcoffee`, `plls`, `pgmq`, `pg_net`, `pg_cron`, `pg_walinspect`, `pg_stat_statements` and others [M-CAT, from `/etc/postgresql-custom/supautils.conf` in `supabase/postgres:17.6.1.011`].
- Actually *available* in that image's `pg_available_extensions`: `pg_tle 1.4.0`, `plpgsql_check 2.7`, `pgmq 1.4.4`, `pg_net 0.19.5`, `pg_cron 1.6.4`, `pg_walinspect 1.1`, `pg_buffercache 1.5`, `pg_prewarm 1.2`, `hypopg`, `index_advisor`. There is **no plv8, plrust or pljava** [M-CAT].
- plv8: "deprecated in projects using Postgres 17. It continues to be supported in projects using Postgres 15, but will need to dropped before those projects are upgraded" [DOC plv8.mdx]. `plls` and `plcoffee` are also deprecated on 17 [DOC upgrading.mdx §Upgrading to Postgres 17].
- `pg_tle` lets unprivileged users package extensions written in *trusted* languages [pg_tle README]. On Supabase PG 17 that means SQL and PL/pgSQL. It is a packaging tool, not a speed-up.
- The extensions guide: "you can also install your own SQL extensions … including plpgsql extensions". Compiled C or pgrx extensions cannot be loaded on the managed platform. INFERENCE from the allowlist and the image contents; self-hosting would allow them.

**Verdict.** On Supabase the only in-database lever is doing *less SQL per order* and doing it *set-based*. Language choice is not a lever.

---

## 5. PostgreSQL 18 changes relevant here, and Supabase status

From `doc/src/sgml/release-18.sgml` (REL_18_STABLE; release date 2025-09-25; the file now reaches 18.6):

| PG 18 change | Relevance to Kichiko's hot path |
|---|---|
| Asynchronous I/O subsystem (`io_method` = `worker`/`io_uring`/`sync`), Freund, Munro et al. "allows backends to queue multiple read requests … sequential scans, bitmap heap scans, vacuums" | **Reads only.** The order path is point lookups on cached pages plus WAL writes and fsync. No effect on commit latency. Could help cold-cache scans and vacuum (INFERENCE) |
| Fast-path lock slots scale with `max_locks_per_transaction` (Vondra, c4d5cb71d) | Removes the 86 shared-table lock acquisitions per crossing order if `max_locks_per_transaction ≥ 128` (§2.2). Minor at Kichiko's concurrency |
| B-tree skip scan (Geoghegan, 92fe23d93) | Lets multi-column indexes serve queries without a leading-column predicate. Could merge redundant `markets`/`positions` indexes, and fewer indexes means cheaper writes (INFERENCE) |
| Virtual generated columns, now the default (Eisentraut et al.) | Cheaper writes for non-indexed derived columns. **Not usable for `yes_px`/`book_side`**: indexes on virtual generated columns are disallowed (`indexcmds.c:1122`) |
| `RETURNING OLD/NEW` (Rasheed, 80feb727c) | Lets one statement return pre- and post-update values, e.g. wallet balance before/after for the ledger, instead of SELECT + UPDATE |
| `NOT ENFORCED` foreign keys (eec0040c4) | Keeps FK metadata without RI trigger cost (§3.4) |
| `uuidv7()` | Time-ordered keys give right-edge B-tree inserts for `clob_orders`/`clob_fills`/`transactions` primary keys instead of random `gen_random_uuid()` pages. That means fewer distinct leaf pages dirtied per order and fewer full-page images after checkpoints (INFERENCE) |
| `pg_stat_statements.wal_buffers_full`; `track_wal_io_timing` re-added | Observability |

**Supabase status:**
- Not offered. The build repo carries no `postgres18` major [DOC-SPVARS].
- The upgrading guide's notes stop at "Postgres 15.19 or 17.11" [DOC upgrading.mdx].
- A 2026 web-search extract says a "rough target … January 2026" slipped (GitHub discussion #42681; **UNVERIFIED**, since `github.com` pages return 403 here).
- **Plan on PG 17 semantics.**

---

## 6. Supabase transport: PostgREST, Supavisor, PgBouncer, direct connections

**PostgREST request shape [DOC PostgREST `references/transactions.rst`].**

> "every request to an API resource runs inside a transaction … `START TRANSACTION; -- <Access Mode> <Isolation Level>` / `-- <Transaction-scoped settings>` / `-- <Main Query>` / `END;`"

- POST to a VOLATILE function runs READ WRITE, and the isolation level is READ COMMITTED.
- Request data reaches SQL through transaction-scoped `set_config('request.…', …, true)`: headers, JWT claims, method and path.
- `db-prepared-statements` defaults to true: "Not using prepared statements will noticeably decrease performance". Disable it only behind a transaction-mode pooler [DOC `references/configuration.rst`].

**Measured DB-side emulation [M-PGRST].** Same psycopg2 client and 3,000 orders:
- `BEGIN READ WRITE`, a `set_config` batch (search_path, role → `service_role`, jwt claims, method, path, headers, cookies), a PostgREST-style CTE (`json_to_record` → named-argument call → `json_agg`), `COMMIT`;
- median **2.76–2.83 ms** versus **1.51–1.55 ms** for a plain autocommit call.
- Most of the difference is 3 extra round trips at 151 µs each through docker's port proxy, plus unprepared parsing of the CTE, which real PostgREST prepares.
- INFERENCE: with PostgREST co-located with Postgres, the DB-side overhead should be a few hundred µs. The PostgREST server's own HTTP, JWT and JSON cost is **UNVERIFIED**: no PostgREST binary could be obtained, because Docker Hub answered 429 and the GitHub release returned 404 through the proxy.

**Lock held across round trips [M-RTT].** 8 clients, one market:

| Transaction shape | Orders/s |
|---|---|
| autocommit call | 377 |
| `BEGIN; call; COMMIT` (+1 round trip inside the locked section) | 334 |
| + one more `select 1` before `COMMIT` | 313 |

- Every round trip between the function's lock acquisition and `COMMIT` adds to the per-market critical section.
- Under PostgREST the result goes back and `END` comes as a separate statement, so one server-side round trip is inside the section. INFERENCE from the documented transaction shape.
- **Never** open a transaction from the app server in Johannesburg against eu-west-1 and call the engine inside it. At ~150 ms WAN round-trip time, the per-market ceiling would fall to single digits per second (1/0.15 s ≈ 6.7/s, INFERENCE).

**Poolers [DOC `connecting-to-postgres.mdx`].**
- Port 5432 is a direct connection (IPv6, or IPv4 with the add-on) or Supavisor session mode. Port 6543 is Supavisor shared transaction mode or the dedicated PgBouncer, which "runs on the same machine as your database, so lower latency than the shared pooler".
- Transaction mode: "does not support prepared statements … does not support query pipelining". Session state (`SET`, session advisory locks, `LISTEN`, temp tables) is lost.
- A 2023-12 Supabase blog said Supavisor added named-prepared-statement support by broadcasting `PREPARE` across connections [DOC blog 2023-12-13]. The 2026 docs say transaction mode does not support prepared statements. Follow the current docs.
- **This does not affect the engine's internal plans.** PL/pgSQL/SPI plans are cached in the *server backend*, which the pooler reuses across client transactions. Only client-side protocol prepared statements are lost. What *does* hurt is server-connection churn: first call 25 ms [M-COLD].
- Supavisor's README benchmark: local `pgbench -M extended`, 100 clients, pool 60, TPC-B-like. PgBouncer 196 tps at 510 ms average latency; Supavisor 189 tps at 528 ms. Load test: 1,003,200 client connections at 20k+ QPS on a two-node 64-vCPU cluster [DOC supavisor README]. These are pooler capacity figures, not per-query latency. Report 03 cites Supabase's ~2 ms added median for Supavisor versus PgBouncer (not re-fetched here, because `supabase.com` is blocked).

**Realtime amplification [DOC `realtime/postgres-changes.mdx`, M-CAT].**
- `supabase_realtime` publishes `markets` and `market_activity` (plus `comments` and `notifications`). So every trade's `markets` update and `market_activity` insert is decoded and pushed.
- Docs: "Postgres Changes authorizes every event against each subscriber … Changes are also processed on a single thread … larger compute add-ons don't meaningfully increase Postgres Changes throughput". Above ~3,000 concurrent subscribers, use Broadcast.
- Consequence for §7: removing the per-trade `markets` update from the order transaction also removes one Realtime event per trade.
- **Making `market_activity` UNLOGGED would break its Realtime feed.** Unlogged tables write no WAL, so logical decoding cannot see them. It would also lose the table's rows on a crash and keep them off read replicas. INFERENCE from how logical decoding works.

---

## 7. Ranked optimisations for the in-database engine

Ranked by (gain × certainty) ÷ risk. "Measured" means an A/B on `k13` with the stated conditions. Gains are cumulative in the order of §0's table unless stated. All line numbers refer to 071.

### 1. Drop `update_markets_updated_at`; stop per-trade `markets`/`market_options` writes, `price_history`/`market_activity` inserts and the profile-stats trigger inside the order transaction

**Measured:** V0 → V4 raised 1-client throughput from ≈414 to 469–503/s (+13–21%) and 8-clients-on-one-market from 403 to 479/s (+19%). WAL records went from 48 to 37 per order [M-CUMUL].

**Why:**
- The `markets` update is the single most expensive statement: 333 µs, non-HOT, 19 indexes, tsvector recompute, Realtime event.
- The profile update adds 47 µs and a cross-market lock (§3.5).

**How:**
- Derive these from `clob_fills`, which is already written in the transaction, with a set-based job: `refresh_market_stats()` (065) already aggregates 24h stats from `clob_fills`.
- Run it every 1 s via pg_cron (supports "every second" per report 03). Or derive on read: last price is `SELECT … FROM clob_fills ORDER BY created_at DESC LIMIT 1` via `idx_clob_fills_book`.
- Keep `market_options.yes_price` for the UI only if it is updated asynchronously.
- For the homepage volume sort, keep `idx_markets_status_volume` (071's measured 0.089 ms versus 4.27 ms) but update `total_volume_usd` from the batch job. Each market row then changes once per second instead of once per trade.

**Risk:** stats lag by ≤1 s. Money is unaffected.

### 2. Deterministic lock order (removes the confirmed deadlocks)

**Current order in 071:**
1. market row (180);
2. option row (186);
3. taker wallet (203);
4. taker position (224, sell);
5. then, per maker in book order: maker order (303), maker position, maker wallet (347/354/383/415);
6. the profile rows touched by the trigger, in fill order.

Two takers in different markets who are makers for each other lock wallets in opposite orders. Deadlocks were confirmed in the BRAIN doc §3, and 1 × 40P01 was observed at 8 clients over 4 markets here [M-MX].

**Fix:**
- In the loop, touch only rows owned by *this market*: maker order rows and positions. Positions are keyed by market and option, so they cannot cross markets.
- Accumulate per-wallet deltas in PL/pgSQL arrays: `wallet_id[]`, `d_available[]`, `d_reserved[]`.
- After the loop, lock and update every wallet (taker plus makers) in **one sorted statement**, for example:

  ```sql
  UPDATE wallets w SET … FROM (SELECT unnest($ids) id, unnest($da) da, unnest($dr) dr ORDER BY 1) d WHERE w.id = d.id
  ```

  preceded by `PERFORM 1 FROM wallets WHERE id = ANY($ids) ORDER BY id FOR NO KEY UPDATE` to fix the lock order.
- Re-check the taker's balance after taking its lock. 071 already checks the balance after matching (line 472), but against a value read at line 203.
- Profiles: gone from the hot path (item 1).

**Expected:** zero deadlocks, and none of the ~1 s `deadlock_timeout` stalls.
- INFERENCE; not implemented here.
- Cost is neutral to slightly positive: one multi-row UPDATE replaces 2–3 single-row UPDATEs per fill (per-statement overhead is ≈45–110 µs, §2.1).

### 3. Insert the taker order once, with its final state; one UPDATE per maker per fill

**Today:**
- Taker: INSERT (line 245) then UPDATE (line 524). The UPDATE costs 112 µs per order, re-runs 4 RI checks because the row was inserted by this transaction (§3.4), and is non-HOT because `status` changes.
- Maker: two UPDATEs of the same row per fill, lines 323 and 353/382, 55 + 73 µs per order.

**Fix:**
- `v_taker_order := gen_random_uuid()` up front.
- Buffer the fills in arrays and insert them set-based after the loop with `INSERT … SELECT unnest(...)`.
- Insert the taker order *before* the fills, now with its final `filled`, `status` and `reserved_usd`. Or declare `clob_fills_taker_order_id_fkey DEFERRABLE INITIALLY DEFERRED`.
- Merge the maker's `reserved_usd` change into its first UPDATE.

**Expected:** about −180 µs per order (≈12%). INFERENCE from the §2.1 per-statement means, not A/B-measured.

### 4. Replace `markets … FOR UPDATE` with a transaction-scoped advisory lock (or at least `FOR NO KEY UPDATE`); drop the `market_options … FOR UPDATE`

**Measured:** ≈0% throughput on its own [M-CUMUL].

**Benefits:**
- Comment and other FK inserts on a hot market no longer block [M-FKBLOCK].
- One fewer `Heap/LOCK` WAL record and page write per order.
- Advisory waiters queue once in the lock manager instead of on `Lock:tuple` plus `Lock:transactionid` [M-WAIT].

**Key:** `pg_advisory_xact_lock(<market bigint surrogate>)`. `hashtextextended(uuid::text, 0)` works but can collide. Only transaction-level advisory locks are safe through transaction pooling [DOC connecting-to-postgres].

**Also:** keep the `status='active'` and `closes_at` checks as a plain read after taking the lock.

### 5. Cut FK trigger work on append-only ledger tables

**Measured upper bound:** dropping all 17 FKs on `clob_orders`, `clob_fills`, `transactions` and `positions` gave +15–18% single-client and **+38% at 8 clients on one market** (479 → 660/s) [M-CUMUL].

**Recommendation:**
- The function already proves existence of market, option, wallet and user under lock (lines 180–204). So:
  - drop the FKs from `clob_fills` and `transactions` to `markets`, `market_options`, `profiles`, `wallets` and `clob_orders`;
  - keep `clob_orders` → `markets`/`market_options` if you want belt and braces;
  - add a nightly anti-join reconciliation, `SELECT … FROM clob_fills f LEFT JOIN clob_orders o … WHERE o.id IS NULL`.
- On PG 18 this becomes `NOT ENFORCED` (§5).

**Risk:** a buggy writer could insert orphan rows. Mitigated by `REVOKE INSERT` (migrations 059 and 061 already lock client writes down) and by the reconciliation.

### 6. Trim non-HOT index maintenance

- **`clob_orders`.** Five partial indexes filter on `status` (§3.6).
  - `idx_clob_orders_book` (market, option, side, action, price, created_at) is superseded by 071's `asks/bids` indexes for matching. If no read path uses it, dropping it removes one index insert per insert and per status change. INFERENCE; check `pg_stat_user_indexes.idx_scan` in production before dropping.
- **`markets` (19 indexes).**
  - `idx_markets_slug` duplicates the unique `markets_slug_key`.
  - `idx_markets_status` is a prefix of `idx_markets_status_closes/created/volume`.
  - `idx_markets_closes_at` overlaps `idx_markets_active_closes_at`.
  - Removing them matters less once item 1 stops per-trade updates, but it still speeds settlement and admin writes.
- **`transactions` (7 indexes).** `idx_transactions_status` and `idx_transactions_type` are low-cardinality B-trees paid on every ledger insert (≈1.1 per order). Consider partial indexes, or drop them if unused.

### 7. Use time-ordered keys for append-only tables

- `gen_random_uuid()` scatters inserts across `clob_orders_pkey`, `clob_fills_pkey`, `transactions_pkey` and the `transactions_idempotency_key_key` values (`clob_mk_<uuid>_<uuid>`, 071 line 443).
- Each order therefore dirties several random leaf pages, and after each checkpoint each one costs a full-page image: 1.7–3.5 FPI per order post-checkpoint versus ~0.3 in steady state [M-FPW].
- A UUIDv7 generated in SQL (or `bigint` identity) makes those inserts right-edge.
- Expected: fewer FPIs and less WAL after checkpoints, and a smaller buffer working set. INFERENCE; not measured.
- Also raise `checkpoint_timeout` and `max_wal_size` if Supabase allows it (UNVERIFIED which of these Supabase exposes), to space out full-page-image storms.

### 8. Keep server backends long-lived

- First call on a new backend: 25 ms. Calls 2–8: 3–7 ms [M-COLD].
- Configure the pool (PostgREST `db-pool`, PgBouncer `server_lifetime`) so backends live for hours.
- Pre-warm after deploys: call the function 10× per backend with rolled-back test orders.
- Never set `plan_cache_mode=force_custom_plan`: it halves throughput [M-PLAN].

### 9. Keep `synchronous_commit=on` for the order transaction; use `off` only in *separate* transactions for derived data

- Measured +17–25% for `off` [M-SYNC], but it acknowledges fills that can vanish on a crash.
- The asynchronous stats job from item 1 can `SET LOCAL synchronous_commit = off` safely.

### 10. Batch orders per transaction only once per-order work is set-based

- The real engine at batch 10 gains only +20–25% [M-BATCH].
- Report 11's set-based apply gains 7–20×.
- If Kichiko moves matching out of the database (report 11 architecture), apply each batch's results with `INSERT … SELECT unnest(...)` and `UPDATE … FROM (VALUES …)`, not N function calls.

### 11. `wal_compression = lz4`

- Measured −10–30% WAL bytes after checkpoints, throughput neutral [M-FPW].
- Worth enabling if Supabase exposes it. UNVERIFIED: `wal_compression` is superuser-level, so it may not be user-settable on the platform.

### Not recommended

- **UNLOGGED for `market_activity`**: it breaks Realtime and loses rows on a crash (§6).
- **UNLOGGED for `price_history`**: possible, since it is not in the publication and can be rebuilt from `clob_fills`, but it saves only ≈0.4 of 48 WAL records per order. Better to derive it from `clob_fills` asynchronously (item 1).
- **`SKIP LOCKED` in matching**: it breaks price-time priority. Report 03 says the same.
- **Serializable isolation**: retry storms on hot rows (report 03).

---

## 8. How far can one serial transaction per market go?

**Model.** The per-market critical section runs from lock acquisition to lock release:

`S = T_locked_exec + T_flush + T_syncrep + T_rtt_inside + T_handoff`

because locks are released after `XLogFlush` and `SyncRepWaitForLSN` (§3.8). The per-market ceiling is 1/S.

**Calibration on `k13`** (local disk, 269 µs raw fdatasync):
- Function server time 1.54 ms. The part before `markets FOR UPDATE` (three `count(*)`, about 55 µs) is outside S, so T_locked_exec ≈ 1.45 ms at 0.7 fills per order.
- T_flush ≈ 0.36–0.50 ms (`pg_stat_wal`) [M-SYNC].
- T_handoff: from the 8-client, one-market runs with `sync=off`, 1/491 = 2.04 ms per order ≈ 1.45 ms of execution + ~0.1 ms autocommit round-trip share + ~0.5 ms wake-up and context switching on 2 vCPUs. So T_handoff ≈ 0.3–0.5 ms here. INFERENCE from those two measurements.
- Predicted S ≈ 1.45 + 0.43 + 0.4 ≈ 2.3 ms, i.e. ≈ 435/s. Measured 8-client one-market throughput: 379–403/s. ✔

**Projections** (INFERENCE; flush figures for gp3 and io2 come from AWS descriptions via reports 03/11, not measured on Kichiko's instance):

| Engine shape | T_exec | gp3 flush 1–3 ms | io2 flush ~0.5 ms | `sync=off` (no flush) |
|---|---|---|---|---|
| 071 today (0.7 fills) | 1.45 ms | 1/(1.45+1…3+0.3) = **210–360/s** | ≈ 440/s | ≈ 570/s |
| V5-like lean (items 1, 4, 5 measured) | ≈ 1.0 ms (660/s at 8 clients includes handoff) | 230–430/s | ≈ 550/s | ≈ 770/s |
| lean + items 2, 3, 6 (estimate) | ≈ 0.7–0.8 ms | 250–480/s | ≈ 650/s | ≈ 1,000/s |
| lean PL/pgSQL, 3+ fills per order | + 0.4–0.6 ms per extra fill (M-FILLS scaled by the lean fraction) | 150–300/s | ~350/s | ~450/s |

**Hard floor for a PL/pgSQL-per-order design** (INFERENCE from the M-MB costs). A 1-fill order needs at least:
- ~8 row writes: taker order insert, maker order update, maker wallet, taker wallet, 2 positions, fill, ledger. At 8–20 µs each on narrow tables (microbenchmark), ≈150 µs;
- ~5 locking reads at ~6 µs, ≈30 µs;
- about 100 simple expressions, ≈30 µs;
- function and snapshot overhead, ≈20 µs.

That is ≈250 µs of pure executor work. On Kichiko's real schema (wide rows, more indexes) the practical floor is ≈0.5–0.7 ms. So a single market cannot exceed ≈1,400–2,000/s even with no flush and no handoff, and **≈300–500/s is realistic with durable commits on Supabase disks.**

**Beyond that the only lever is batching with set-based apply.**
- Report 11 measured C(b) ≈ 1.6 ms + 0.064 ms·b on the same image, so ≈10k/s per shard at b=100.
- That requires the matching decision to happen outside per-row PL/pgSQL: in an app-side matcher, or in a single SQL statement per batch, which price-time sequential matching makes impractical in pure SQL (INFERENCE).
- The WAL side is not the limit: 5–6 kB × 1,000/s = 6 MB/s, far below gp3's baseline throughput. Neither are LWLocks (§3.7).

**What does not raise the ceiling:**
- more CPUs, since the section is serial;
- `commit_delay`, since there is no second committer in the same market;
- PG 18 AIO, which is reads only;
- a C/Rust port, which is bounded by the ≈27% non-SQL share and not available on Supabase.

---

## 9. UNVERIFIED items and gaps

1. Supabase gp3/io2 flush latency *for Kichiko's instance*. The 1–3 ms range is inferred from AWS's "single-digit millisecond" gp3 description (via reports 03 and 11). Measure with `pg_stat_wal.wal_sync_time / wal_sync` on production (read-only view) or on a staging project.
2. PostgREST's own per-request overhead: HTTP, JWT, JSON, and its pipelining behaviour. No binary could be obtained here.
3. The current Supabase statement that PG 18 is unavailable is inferred from the build repository and the upgrading guide. The GitHub discussion was not fetchable.
4. PL/Rust speed-ups: search extract only. Supabase does not offer PL/Rust anyway.
5. Whether `wal_compression`, `checkpoint_timeout`, `max_wal_size`, `commit_delay` and `max_locks_per_transaction` are user-settable on Supabase. Report 03 found `max_locks_per_transaction` settable via the CLI; the others were not checked (`supabase.com` blocked).
6. The Supavisor versus PgBouncer latency figures are carried from report 03, not re-fetched.
7. All absolute numbers are from a 2-vCPU container on local disk; the ratios are the transferable part. Multi-client runs were CPU-bound and noisy (±15% on repeats).
8. Items 2, 3, 6 and 7 of §7 are estimated from per-statement costs, not A/B-measured.

---

## References

### PostgreSQL source (fetched from `https://raw.githubusercontent.com/postgres/postgres/<branch>/<path>`, 2026-09-26)

- `REL_17_STABLE/src/include/storage/proc.h`: `FP_LOCK_SLOTS_PER_BACKEND 16` (l.86).
- `REL_18_STABLE/src/include/storage/proc.h` (l.80-100) and `REL_18_STABLE/src/backend/utils/init/postinit.c` (`InitializeFastPathLocks`, l.580-601).
- `REL_17_STABLE/src/backend/storage/lmgr/lock.c`: `EligibleForRelationFastPath` (l.213-218), fast-path grant (l.929-930).
- `REL_17_STABLE/src/include/storage/lwlock.h`: `NUM_BUFFER_PARTITIONS 128`, `NUM_LOCK_PARTITIONS 16` (l.93-97).
- `REL_17_STABLE/src/backend/access/transam/xlog.c`: `NUM_XLOGINSERT_LOCKS 8` (l.151), `XLogFlush` (l.2775-2879).
- `REL_17_STABLE/src/backend/access/transam/xact.c`: `RecordTransactionCommit` (l.1304, 1487-1512, 1546), `CommitTransaction` ordering (l.2325, 2349, 2392).
- `REL_17_STABLE/src/backend/access/transam/xloginsert.c`: `GetFullPageWriteInfo`/`XLogRecordAssemble` (l.507-520).
- `REL_17_STABLE/src/backend/utils/cache/plancache.c`: `choose_custom_plan` (l.1054-1097).
- `REL_17_STABLE/src/backend/executor/spi.c`: `_SPI_execute_plan` (l.2399), `GetCachedPlan` (l.2577), snapshot push (l.2613), `CommandCounterIncrement` (l.2667).
- `REL_17_STABLE/src/pl/plpgsql/src/pl_exec.c`: `exec_stmt_execsql` (l.4202), `exec_prepare_plan` (l.4161), `exec_eval_simple_expr` (l.6027), `exec_simple_check_plan` (l.7981).
- `REL_17_STABLE/src/backend/executor/execIndexing.c`: `ExecOpenIndices`, `index_open(..., RowExclusiveLock)` (l.157, 205).
- `REL_17_STABLE/src/backend/executor/nodeModifyTable.c`: `ExecInitStoredGenerated` skip rule and BEFORE-trigger exception (l.382-432).
- `REL_17_STABLE/src/backend/utils/adt/ri_triggers.c`: `FOR KEY SHARE OF x` (l.389), `RI_FKey_fk_upd_check_required` own-transaction rule (l.1322-1331).
- `REL_17_STABLE/src/backend/commands/trigger.c`: RI skip at queue time (l.6492-6504).
- `REL_17_STABLE/src/backend/access/heap/heapam.c`: `heap_update` (l.3348, 3436, 3532, 4151, 4161), `heap_lock_tuple` (l.4803), `XLOG_HEAP_LOCK` (l.5474).
- `REL_17_STABLE/src/backend/access/heap/README.tuplock`.
- `REL_18_STABLE/src/backend/commands/indexcmds.c`: virtual generated columns disallowed in indexes (l.1122-1142).
- `REL_18_STABLE/doc/src/sgml/release-18.sgml`: release date 2025-09-25; AIO (commits 02844012b … 2a5e709e7); fast-path c4d5cb71d; skip scan 92fe23d93; virtual generated columns 83ea6c540; RETURNING OLD/NEW 80feb727c; NOT ENFORCED FKs eec0040c4; uuidv7; `pg_stat_statements.wal_buffers_full` ce5bcc4a9.

### Supabase (fetched from `https://raw.githubusercontent.com/supabase/...`)

- `supabase/supabase` `apps/docs/content/guides/database/extensions.mdx`.
- `…/database/extensions/plv8.mdx`: plv8 deprecated on PG 17.
- `…/platform/upgrading.mdx`: "Upgrading to Postgres 17"; deprecated extensions; notes for 15.19/17.11.
- `…/database/connecting-to-postgres.mdx`: ports, modes, "Transaction mode does not support prepared statements … query pipelining", dedicated pooler.
- `…/realtime/postgres-changes.mdx`: per-subscriber authorization, single thread, >3,000 subscribers → Broadcast.
- `apps/www/_blog/2023-12-13-supavisor-postgres-connection-pooler.mdx`: named prepared statements broadcast.
- `supabase/postgres` `develop/ansible/vars.yml`: `postgres_major` 15, 17, orioledb-17; `postgres17: 17.6.1.177`.
- `supabase/supavisor` `main/README.md`: pgbench and load-test figures.
- Image `supabase/postgres:17.6.1.011`: `/etc/postgresql-custom/supautils.conf` (`privileged_extensions`) and `pg_available_extensions`, read in the local container.

### PostgREST (fetched from `https://raw.githubusercontent.com/PostgREST/...`)

- `postgrest` `main/docs/references/transactions.rst`: transaction shape, access mode, READ COMMITTED, `set_config`.
- `postgrest` `main/docs/references/configuration.rst`: `db-prepared-statements`.
- `postgrest-benchmark` `master/README.md`: harness only, no published results.

### Other

- `aws/pg_tle` `main/README.md`: trusted-language extensions.
- `tcdi/plrust` `main/README.md`: "natively-compiled functions".
- Web search only (hosts blocked; not fetched; UNVERIFIED): postgres.ai "#PostgresMarathon 2-004: Fast-path locking explained"; thebuild.com "Sixteen Locks Ought to Be Enough for Anybody"; pganalyze "PL/Rust 1.0 and its trusted language mode"; InfoQ "High Performance Functions in Rust on RDS PostgreSQL"; GitHub supabase discussion #42681 "Support postgres 18?".
- Blocked by the egress proxy this session: `www.postgresql.org`, `supabase.com`, `postgres.ai`, `pganalyze.com`, `www.infoq.com`, `www.mail-archive.com`, `thebuild.com`, `github.com` pages and API (403), and Docker Hub (429).

### Kichiko repo

- `supabase/migrations/071_clob_index_ordered_ladder.sql` (engine; line numbers cited throughout); `046_clob_order_abuse_prevention.sql`; `053_realtime_publication_correctness.sql`; `054_autovacuum_hot_table_tuning.sql` (fillfactor, per report 03); `065_refresh_market_stats_from_clob_fills.sql`.
- `scripts/ops/clob/bench_engine.py` (workload generator).
- `docs/design/BRAIN-ARCHITECTURE-2026-09.md`; `docs/research/brain-2026-09/03-ENGINE-ENGINEERING.md`; sibling report `11-ARCHITECTURE-PERSISTENCE-CORRECTNESS.md` §2.2 and §4.3.

### Measurements in this session

Scripts and raw data are in `/tmp/claude-0/-home-user-kichiko/385cc00d-340c-5f67-955a-0a985fc3ce7d/scratchpad/`: `hp.py`, `runv.sh`, `runw.sh`, `waits.py`, `mb.sql`, `pgrst_conc.py`, `f_v3.sql`, `f_v4.sql`, `pgss.txt`, `pgss2.txt`, `bench/hp_results.jsonl`.

- **[M-PGSS]** Statement breakdown (§2.1). **[M-SPLIT]** SPI versus non-SPI split. **[M-LOCKS]** `pg_locks` per order. **[M-WAL]** `pg_walinspect` breakdown. **[M-FPW]** Post-checkpoint WAL and compression.
- **[M-PLAN]** plan_cache_mode A/B. **[M-COLD]** Cold-backend call latency. **[M-MB]** Microbenchmarks.
- **[M-HOT]** HOT ratios. **[M-WAIT]** Wait-event sampling. **[M-MX]** MultiXact count. **[M-FKBLOCK]** FOR UPDATE versus FOR NO KEY UPDATE.
- **[M-SYNC]** synchronous_commit levels. **[M-CD]** commit_delay. **[M-BATCH]** Batched real orders. **[M-CUMUL]** V0–V5 cumulative variants.
- **[M-FILLS]** Latency by number of fills. **[M-RTT]**, **[M-RTT0]** Round-trip and lock-hold tests. **[M-PGRST]** PostgREST-shaped wrapper. **[M-CAT]** Catalog, trigger and extension inventory.
