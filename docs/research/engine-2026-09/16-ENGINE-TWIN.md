# 16 - Native Rust engine twin (`kengine`): design, equivalence proof, benchmarks

Date: 2026-09-26. Workspace: `/tmp/claude-0/-home-user-kichiko/385cc00d-340c-5f67-955a-0a985fc3ce7d/scratchpad/engine` (standalone cargo workspace; `/home/user/kichiko` was only read, and `git status` there is clean).
Database: local replica `kdb2` only (`postgresql://postgres:localtest@localhost:54323/postgres`, PostgreSQL 17.6, all 72 migrations, CI seed with 6 users). Port 54322 and remote hosts were never used, and `/root/.secrets` was never read.

## 0. Result in one paragraph

`kengine` is a native Rust twin of `clob_place_order` (071), `clob_cancel_order` and `clob_expire_orders` (045; I checked that 072 does not touch them and that the functions deployed on kdb2 match the migration text). It has two interchangeable ladders: a `BTreeMap<price, VecDeque>` baseline and a fixed 1024-slot tick array with intrusive u32-slab FIFO lists and a two-level u64 bitmap. I ran 18 seeded streams through the SQL engine on kdb2, one committed transaction per op, and replayed each through both ladders: **40,000 ops**, 18,010 fills, 23,262 orders, 432 positions and 108 wallets. Every per-op result matches the SQL text exactly, including value and numeric scale: fills (maker, price, size, kind), order status/filled/resting, cash, and error SQLSTATE. So does every final order (status, filled, reserved_usd), every position column and every wallet balance. Result: **0 divergences**, and the two ladders also match each other. The PostgreSQL `numeric` emulation was separately checked against PostgreSQL on 100,000 random cases (plus 190,000 in earlier runs) with 0 mismatches. On one core the twin runs **1.9-2.0 M orders/s** on the realistic mix (tick ladder), against 485-512 orders/s for the SQL engine per 071's own benchmark. Differential testing also turned up a **genuine SQL bug**: the post-match "market-sell dust guard" rejects LIMIT sells. Section 5 has a minimal repro.

## 1. Design

### 1.1 Crate layout (`kengine/`)

| file | role |
|---|---|
| `src/num.rs` | `Num {m: i128, s: u32}`: PostgreSQL `numeric` with display scale (dscale). Add/sub/mul are exact. Division follows `numeric_div` (`select_div_scale` + half-away-from-zero rounding). Also ROUND(x,k), FLOOR, `typmod(p,s)` (assignment to numeric(p,s) with overflow check), GREATEST/LEAST tie rules, and a `numeric_in` parser including exponent literals. Overflow panics and never wraps. |
| `src/engine.rs` | `Engine<L: Ladder>`: markets, books per (market, option), wallets, dense positions table, order slab with generation-tagged ids, open-order counters, the 046 rate-limit ring, expiry heap. API: `place_order`, `cancel_order`, `expire`, plus setup and accessors. |
| `src/book.rs` | `trait Ladder` + `BTreeLadder` (a) + `TickLadder` (b). |
| `src/replay.rs`, `src/bin/replay.rs` | Replays a recorded SQL stream through both ladders and emits canonical JSON. |
| `src/workload.rs` | Deterministic, state-aware benchmark scenarios. |
| `src/bin/{numfuzz,throughput,cgrun}.rs` | numeric fuzzer, throughput runner, valgrind driver. |
| `benches/engine.rs` | criterion benchmarks. |
| `tests/noalloc.rs` | counting-allocator test: 0 allocations on the hot path for (b). |
| `tests/sql_quirks.rs` | the twin reproduces the SQL limit-sell P0105 behaviour. |
| `scripts/` | `sql_run.py` (SQL side), `compare.py`, `run_all.sh`, `numcheck.py`, `cachegrind.sh`, `repro_limit_sell_p0105.sql`. |

### 1.2 How the twin follows the SQL

Each money expression is the SQL expression evaluated with `Num`, in SQL order, with the SQL types' rounding on assignment. Code comments carry 071 line numbers. The details that matter:

- **Rounding.** ROUND(x,8)/ROUND(x,6) and every numeric(20,6) / numeric(8,6) / numeric(4,1) assignment round half away from zero. Products are exact, and GREATEST(0, ...) clamps are applied before the assignment rounding, exactly as in SQL.
- **dscale tracking.** This is what makes division exact. For example, `avg_entry_price = (invested(6) + maker_usd(8)) / (shares + fill)` is rounded at `select_div_scale` digits (usually 20) and then again to 6 digits when assigned to numeric(8,6). That double rounding is reproduced bit-for-bit. The same applies to `v_avg_price = v_notional / v_filled`, the local-currency conversions `ROUND(usd / rate, 6)` (KES at 0.00775 is exercised), the budget formula `FLOOR(((budget - spent) / (v_e/100.0)) * 1e6) / 1e6`, and the tick lattice `ROUND((ROUND(p/tick)*tick), 1)`. The tick lattice includes `v_tick = GREATEST(0.1, tick_size*100)`, where the tie returns the first argument, so its dscale differs between 1c and 0.1c markets.
- **Ladder.** Every resting order has `yes_px` (deci-cents) and a book side (bid = buy YES / sell NO, ask = sell YES / buy NO). A YES-bid taker walks asks by (yes_px ASC, FIFO) up to `yes_lim`; a YES-ask taker walks bids by (yes_px DESC, FIFO). Kind is direct when the outcomes match, otherwise mint (taker buy) or burn (taker sell). Execution price is the maker's price, or 100 minus it for a complementary maker. The walk skips self-trades (`user_id <> p_user_id`) and expired orders (`expires_at <= now`); expired orders stay in the book until swept, as in SQL.
- **Atomicity without undo.** SQL rolls back on any RAISE. The twin runs in three phases:
  1. every pre-match check, in SQL order: 046 caps, P0102, P0001/P0002, P0104, 22003 price overflow in numeric(4,1), 22003 size, P0105, P0113, and 23514 when the size rounds to 0;
  2. a *read-only* ladder walk that computes all fills, then the post-match checks (P0006 buy balance, P0105 sell);
  3. applying the effects in SQL statement order.

  This is valid because the walk only reads maker *orders*: only this taker touches them, and each maker is visited once. It is also why no undo log is needed.
- **Twin rules from SQL types and literals.** `v_remaining := p_size` rounds to 6 decimals, but the availability check and the market-sell release use the unrounded `p_size`. Sizes with more than 6 decimals and sizes that round to 0 are therefore exercised. Literal `0` keeps dscale 0 (`released_shares` of a buy cancel is `0`, not `0.000000`).

### 1.3 Ladders

- **(a) `BTreeLadder`.** `Vec<[BTreeMap<u16, VecDeque<u64>>; 2]>`. Cancel is O(log L + queue position).
- **(b) `TickLadder`.**
  - Per (book, side), `Box<[Level {head, tail: u32}; 1024]>` (yes_px 0..1023; only 1..999 is used).
  - One shared `Vec<Node {order: u64, prev, next: u32}>` slab with a free list, giving intrusive doubly linked FIFO lists with O(1) unlink.
  - A `[u64; 16]` occupancy bitmap plus a `u16` summary. Best/next price is found with `trailing_zeros` / `leading_zeros` on the word, then on the summary.
  - Orders store their node handle.

  After warm-up **(b) never allocates**: `tests/noalloc.rs` counts allocations over 40,000 steady-state ops per scenario (places, sweeps, cancels, expires) and finds **tick = 0 in all 5 scenarios**. For comparison, btree does 6,298 / 5,353 / 22,664 / 0 / 15,154. That required a capacity-preserving `clone_reserved()`, because derived `Clone` shrinks Vecs to their length.

### 1.4 Configuration and deliberate limits

- `Config.keep_history` (default true, as in SQL): when false, terminal order slots are recycled behind generation-tagged ids. A stale id then cancels with P0112; SQL would return P0111 if the canceller is not the owner.
- `rate_limit`: the 046 rule of 100 placements per 10 s is modelled with a 100-entry ring per user.
- Market status/closes_at (P0001/P0002) and unknown option (P0007) are modelled but not fuzzed, because each stream uses one live market.
- The SQL side writes audit rows (transactions, clob_fills, price_history, market_activity, markets/market_options stats) that are outside the twin's state. The fill list the twin returns carries the same data as `clob_fills`.

## 2. Equivalence evidence

### 2.1 Numeric helpers against PostgreSQL itself

`numfuzz` emits random cases as SQL expressions plus the twin's answer. `numcheck.py` evaluates `(<expr>)::text` on kdb2 and compares the **text**, so value and display scale are both checked. There are 11 case families, each about 9% of cases:
- ROUND(x,{0,1,6,8}) with forced .5 ties and negatives
- `::numeric(20,6)`
- generic division (dscale-dependent)
- the budget formula (071 L316)
- the tick lattice (L190-193, both tick sizes)
- avg-entry `::numeric(8,6)` including overflow
- local conversion `ROUND(usd/rate, 6)` for 5 real rates
- `ROUND(fill*e/100.0, 8)`
- `v_avg_price` → current_value and ROUND(avg, 6)
- exponent literals (`'1.0E-7'::numeric`)
- FLOOR

| run | cases | mismatches |
|---|---|---|
| `numfuzz 100000 2026` (final code) | 100,000 | **0** |
| earlier seeds 11, 23, 29, 31 during development | 30,000 + 60,000 + 60,000 + 40,000 | 0 |

### 2.2 Differential proof: SQL (kdb2) against both twin ladders

**Protocol** (`scripts/run_all.sh`; the canonical run is `proof_final2/`):
- Each seed creates a fresh market with 2 options.
- It resets every live order to cancelled and resets the 6 CI users' wallets to identical balances: 3×20,000 USD, 1×80 USD, 1×2,500,000 KES and 1×15,000 KES. The poor wallets exist to trigger P0006.
- It then plays a seeded, state-dependent stream. Each op is its own autocommit transaction, recorded with its exact input strings, so the scale of every numeric literal is preserved.
- The stream mixes buys and sells, YES and NO, limit (85%) and market orders, and budget caps (70% of market buys, 10% of limit buys, 2- and 4-decimal budgets).
- Sizes: integers, 6-decimal, 8-decimal, sub-micro (0.0000004), up to 600, and exact or over-sells.
- Prices: integers, 1- and 2-decimal off-lattice values, and out-of-range values (-3, 0, 0.04, 99.96, 150.25, 999.96, 1500). NULL limit prices (P0104) are included.
- Cancels: own, foreign, terminal and nonexistent orders. Expiry sweeps run too, and 6% of orders are already expired at placement.
- Odd seeds use a 1c tick, even seeds 0.1c. Seeds divisible by 3 use min_order_size 5.00, the rest 0.50.
- Profiles: standard (101-112), deep book with 2% cancels (201-204), and caps with no cancels and 4,000 ops (301-302), which reach the 60-open-orders-per-market cap.
- The twin replays `stream_<seed>.json` through `BTreeLadder` and `TickLadder`. `compare.py` compares every field as exact text and as Decimal.

**Determinism controls** (environment only; the SQL functions were never modified):
1. The pg_cron jobs `clob_expire_orders` and `remark_positions` are paused via `cron.alter_job` for the run and restored afterwards. Left running, they would expire orders and rewrite `current_value_usd` at wall-clock-dependent moments.
2. After each placement the new order's `created_at` is set to 2000-01-01 + s ms. This keeps strict placement order, which is all the ladder uses `created_at` for, and makes the 046 rate limit vacuous. That limit would otherwise fire depending on run speed, so the twin runs with `rate_limit=false`.
3. `expires_at` is NULL, 2001-01-01 + s ms (already expired) or 2099-01-01.

**Results (final code, `proof_final2/run_all.log`): ALL IDENTICAL.**

| seeds | tick | ops | fills | orders | per-op results identical (btree / tick) | final orders | positions | wallets |
|---|---|---|---|---|---|---|---|---|
| 101-112 (12 × 2,000) | alternating | 24,000 | 10,696 | 14,280 | 24,000/24,000 both | 14,280 identical | identical | identical |
| 201-204 (4 × 2,000, deep) | alternating | 8,000 | 3,541 | 4,491 | 8,000/8,000 both | 4,491 identical | identical | identical |
| 301-302 (2 × 4,000, caps) | 1c / 0.1c | 8,000 | 3,773 | 4,491 | 8,000/8,000 both | 4,491 identical | identical | identical |
| **total (18 seeds)** | | **40,000** | **18,010** | **23,262** | **40,000/40,000** | **23,262** | **432 rows, all columns** | **108** |

- Text-level differences: 0 in ops, orders, positions and wallets. The twin reproduces PostgreSQL's output scale too, not just the values.
- Match kinds: direct 8,583, mint 6,584, burn 2,843.
- Taker final status: open 12,152, partially_filled 1,196, filled 9,815, cancelled (market remainder) 99.
- Successful cancels: 2,425. Orders expired by the sweeper: 748.
- Rejections, all matched by SQLSTATE: P0105 5,879; P0113 3,033; P0006 2,821; P0131 851; P0111 344; P0110 168; 22003 144; P0104 140; P0112 54; 23514 24; P0102 1.

Branch coverage, counted inside the twin across the 18 streams:

| branch | count |
|---|---|
| self-trade skips | 5,643 |
| expired-maker skips | 1,107 |
| budget trims | 702 |
| budget stops | 650 |
| makers fully filled and removed | 8,201 |
| market-sell remainder releases | 224 |

Two of the six wallets are KES (rate 0.00775), so fills between KES and USD wallets exercise the non-trivial `ROUND(usd / rate, 6)` division paths.

**Divergences found during development (both fixed in the twin, never in SQL):**
1. `clob_cancel_order` returns `released_shares = 0` for buys. That is the literal `0` with dscale 0, and the twin printed `0.000000`. It was a text-only difference, and the twin now carries the dscale.
2. Python's `str(Decimal)` produced the size literal `'1.0E-7'`, which PostgreSQL parses as 0.00000010 (dscale 8). The twin's parser did not accept exponent notation. It now implements the `numeric_in` rule dscale = frac_digits - exponent, and exponent literals are part of the numeric fuzz.

There were no matching or money divergences.

## 3. Benchmarks

**Environment:**
- Intel Xeon Processor @ 2.80 GHz (family 6, model 85, Cascade Lake class, `avx512f/bw/dq/vl/vnni`, `bmi1/2`, `abm`/lzcnt).
- KVM guest with 4 vCPUs and 1 thread per core. L1d 32 KiB, L2 1 MiB and L3 33 MiB per core.
- **No hardware PMU**: `/sys/bus/event_source/devices` has no `cpu` PMU, so perf hardware counters are unavailable and cache and branch figures come from valgrind simulation.
- Full flags are in `/proc/cpuinfo`. rustc 1.94.1.
- Profile: `lto="fat"`, `codegen-units=1`, `panic="abort"` (see Cargo.toml), `-C target-cpu=native` (`.cargo/config.toml`).
- Runs pinned with `taskset -c 3`. Another agent was running Postgres I/O load on the host, so wall-clock numbers carry about ±10% noise. The valgrind counts are deterministic.

**Scenarios** (`src/workload.rs`, seeded and state-aware, 20k warm-up ops before measurement, 256 users, caps 250/60 enforced):
- **shallow**: 2 books at about 60 resting orders each.
- **deep3000**: about 3,000 resting orders over about 800 levels.
- **sweep**: 1,500 resting orders of 1-3 shares; market orders of 100-300 shares average 56 fills each, giving 1.0 fill/op overall.
- **cancel_heavy**: 3,000 orders on 20 levels (about 150 per level); 50% of ops cancel from the middle of a queue.
- **mixed** (realistic): 2 markets × 2 options at about 200 resting orders each, with limit, crossing, market/budget, cancel, sell and expire ops.

### 3.1 Criterion wall clock per op

Command: `taskset -c 3 cargo bench --bench engine`. Each sample replays the pre-generated stream on a fresh `clone_reserved()` of the warmed engine; clone and drop are untimed. Figures are median [95% CI], from `bench_criterion.log`.

| scenario | btree (a) | tick (b) | b vs a |
|---|---|---|---|
| shallow | 472.7 ns [467.2, 478.7] | 428.0 ns [420.2, 439.0] | -9% |
| deep3000 | 379.8 ns [372.6, 387.8] | 286.7 ns [278.4, 295.4] | -25% |
| sweep | 824.4 ns [802.5, 845.5] | 600.6 ns [582.3, 623.8] | -27% |
| cancel_heavy | 225.5 ns [218.9, 232.1] | 162.8 ns [159.5, 167.1] | -28% |
| mixed | 521.8 ns [507.0, 540.2] | 430.2 ns [419.6, 444.8] | -18% |

Ladder-only micro-benchmarks, with no money arithmetic (`cargo bench --bench engine -- ladder`, `bench_ladder.log`):

| op | btree | tick |
|---|---|---|
| cancel + re-insert, 3,000 orders at 150 per level | 130.3 ns | **14.7 ns** (8.9×) |
| walk the top 10 on each side of a 3,000-deep book | 59.3 ns | **26.0 ns** (2.3×) |
| best bid + best ask on a sparse book | 14.5 ns | 13.5 ns |

### 3.2 Cachegrind: simulated per-op instructions, cache misses and branch mispredicts

Command: `scripts/cachegrind.sh`, which runs `valgrind --tool=cachegrind --cache-sim=yes --branch-sim=yes`. Each figure is (run with 20,000 ops minus run with 0 ops of the same stream) / 20,000, so setup is excluded.

The binary is built for `-C target-cpu=x86-64-v3` (AVX2/BMI2/LZCNT) because valgrind 3.22 cannot execute AVX-512. Simulated caches: I1 and D1 32 KiB 8-way with 64 B lines; LL 34 MiB 17-way (auto-detected from the L3).

| scenario | ladder | Ir/op | D refs/op | D1 miss/op | LL miss/op | branches/op | mispredicts/op | fills/op |
|---|---|---|---|---|---|---|---|---|
| shallow | btree | 3,637 | 935 | 7.30 | 0.001 | 332 | 16.87 | 0.58 |
| shallow | tick | 3,433 | 879 | 6.09 | 0.001 | 303 | 15.02 | 0.58 |
| deep3000 | btree | 2,611 | 676 | 8.49 | 0.001 | 266 | 16.46 | 0.24 |
| deep3000 | tick | 2,232 | 596 | 7.02 | 0.001 | 200 | 9.08 | 0.24 |
| sweep | btree | 5,435 | 1,437 | 17.89 | 0.008 | 524 | 18.02 | 1.00 |
| sweep | tick | 4,760 | 1,244 | 16.45 | 0.008 | 417 | 8.86 | 1.00 |
| cancel_heavy | btree | 1,702 | 457 | 7.50 | 0.014 | 226 | 5.92 | 0.00 |
| cancel_heavy | tick | 1,361 | 389 | 5.54 | 0.016 | 127 | 3.68 | 0.00 |
| mixed | btree | 3,739 | 974 | 11.28 | 0.001 | 362 | 21.05 | 0.54 |
| mixed | tick | 3,267 | 840 | 8.90 | 0.001 | 288 | 14.11 | 0.54 |

**Callgrind breakdown (mixed, 20k ops).** Command: `valgrind --tool=callgrind --toggle-collect=replay_ops_tick target-vg/release/cgrun mixed tick 20000`; output in `cg/callgrind.mixed.{tick,btree}.out`.
- `Num::div`, the exact PostgreSQL division with `select_div_scale`, is **48%** of tick instructions (42% on btree).
- The ladder walk including the per-fill closure is 17%.
- BTree remove/insert alone is 11.4% on btree, versus about 1% for tick.

The per-op cost is therefore dominated by *exact numeric emulation*, not the book. That is the price of being a bit-exact twin. Choosing (b) removes 13% of instructions and 33% of mispredicts on the mix, and 45-50% of both on deep and sweep books.

### 3.3 Single-core throughput

Command: `taskset -c 3 target/release/throughput <scenario> 1000000 5`, best of 5, `throughput.txt`. Orders/s counts only placements; cancels and expires are excluded.

| scenario | btree ops/s | tick ops/s | tick **orders/s** | tick ns/op |
|---|---|---|---|---|
| mixed (1M ops, 474,700 fills) | 2.14 M | 2.74 M | **2.02 M** | 364 |
| mixed (5M ops, 3 reps) | 2.14 M | 2.66 M | **1.95 M** | 376 |
| shallow | 2.30 M | 2.59 M | 2.02 M | 386 |
| deep3000 | 2.83 M | 3.72 M | 2.31 M | 269 |
| sweep (1 fill/op, 56 per sweep) | 1.50 M | 1.86 M | 1.86 M | 539 |
| cancel_heavy | 4.67 M | 6.36 M | 3.18 M | 157 |

For context only: 071's own measurement of the SQL engine is 485-512 orders/s on one hot market. The twin does no WAL, locking or audit rows, so the ratio is not like-for-like.

## 4. Commands to reproduce

```
cd /tmp/claude-0/-home-user-kichiko/385cc00d-340c-5f67-955a-0a985fc3ce7d/scratchpad/engine
cargo test --release                                              # unit + noalloc + sql_quirks
./target/release/numfuzz 100000 2026 > numcases_final.tsv && python3 scripts/numcheck.py numcases_final.tsv
OUT=$PWD/proof_final2 scripts/run_all.sh                          # 40,000-op differential proof (about 2.5 min)
taskset -c 3 cargo bench --bench engine                           # criterion (scenarios + ladder micro)
scripts/cachegrind.sh                                             # cachegrind per-op table
taskset -c 3 ./target/release/throughput mixed 1000000 5          # throughput
PGPASSWORD=localtest psql -h localhost -p 54323 -U postgres -d postgres -f scripts/repro_limit_sell_p0105.sql
```

## 5. SQL engine findings

The twin reproduces all three of these faithfully; the SQL was not changed.

1. **BUG: the post-match "market-sell dust guard" rejects LIMIT sells.**
   - Where: 071 L512-515 (`IF v_min_usd > 0 AND v_filled > 0 AND v_notional < v_min_usd THEN RAISE P0105`). It runs for *every* sell, while the comments at L211-212 and L512 say it is for market sells only.
   - Effect: a limit sell that passes the pre-check (for example 100 @ 60c = $60 against a $5 minimum) and happens to cross a small remainder (1 share = $0.60) is rolled back entirely instead of filling 1 share and resting 99. Makers left with small remainders thereby block larger sells at their price.
   - Frequency: 32 such rejections in the 40,000-op proof.
   - Minimal repro: `scripts/repro_limit_sell_p0105.sql`, run inside BEGIN/ROLLBACK on kdb2. It prints `limit sell REJECTED: SQLSTATE P0105`, and the control run (the same order with no crossing bid) prints `open`.
   - Twin test: `tests/sql_quirks.rs`.
   - Suggested fix: add `AND p_order_type = 'market'` to that guard.
2. **Escrow dust is stranded on fully filled maker buys.**
   - Cause: `reserved_usd` is numeric(20,6) while `v_maker_usd` is ROUND(..., 8), with GREATEST clamps in between. A maker buy that fills completely can keep a few micro-dollars of `reserved_usd`, which then also stay in `wallets.reserved_balance`, and a filled order cannot be cancelled.
   - Size: 275 filled orders, $0.000287 in total, across the proof.
   - Impact: harmless in size but not self-healing. 064's reconciler only counts OPEN buy orders, so it would move this dust back.
3. **By design, probably:** a *limit* buy with `p_max_spend_usd` stops matching when the budget runs out, and its remainder rests with escrow at the full limit price. The budget caps immediate spend, not the resting escrow. This happened 156 times in the proof.

## 6. Artefacts

- Crate: `engine/kengine/` (about 2,600 lines of Rust including binaries, benches and tests).
- Differential data: `engine/proof_final2/` (`stream_*.json`, `sql_*.json`, `twin_*.{btree,tick}.json`, `run_all.log`).
- Benchmark logs: `engine/bench_criterion.log`, `engine/bench_ladder.log`, `engine/cachegrind_table.txt`, `engine/cg/`, `engine/throughput.txt`.
- Numeric fuzz cases: `engine/numcases_final.tsv`.
- `engine/proof/`, `engine/proof2/`, `engine/proof_final/` and `engine/runs/` are earlier development runs. `proof_final/` is the run that stopped on the `1.0E-7` literal. All four can be deleted.

## Addendum (2026-09-26): re-proof after migration 073

Migration 073 fixed the limit-sell dust-guard bug reported above (SQL finding 1): the post-match guard now applies to market orders only. The twin was changed the same way (`kengine/src/engine.rs`, `tests/sql_quirks.rs` now asserts the 073 behaviour) and the full differential proof was re-run against a replica rebuilt through 073 (`engine/results/proof_073.txt`):

- 18 seeds, 40,000 ops, both ladders: **ALL IDENTICAL** (17,869 fills, 23,133 orders, 432 positions, 108 wallets, every error code).
- Still open from this run: the SQL engine surfaces raw SQLSTATEs 22003 (numeric overflow, 146x) and 23514 (check violation, 23x) instead of engine error codes (bug register E8).
