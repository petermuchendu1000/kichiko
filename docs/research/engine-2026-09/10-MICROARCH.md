# 10 — Microarchitecture-level design of Kichiko's in-memory matching core

Date: 2026-09-26. Scope: a single-threaded, in-memory limit order book (LOB) for Kichiko's bounded tick grid (0.1¢–99.9¢, at most 1,000 levels per side, few orders per level), analysed at the level of caches, TLBs, branch prediction and instruction counts. It follows on from `docs/research/brain-2026-09/03-ENGINE-ENGINEERING.md` §2 and §4 and does not repeat them. That report established that an in-memory engine is 3–4 orders of magnitude faster than the PL/pgSQL engine. This report goes one level down: which layout, which instructions, what each operation costs in cycles and why. It also includes a benchmark plan.

## Evidence tags used throughout

- **[F]**: fetched primary source (paper, slides, source code, official doc). The URL is in References.
- **[S]**: the page itself was blocked by the egress proxy. The claim comes from the search engine's extract of that page and has not been read in full. Treat it as partially verified.
- **[M]**: measured by me in this session, on the machine described in §5.1. Code: `scratchpad/bench/book.cpp`, `scratchpad/bench/memlat.cpp`, `scratchpad/bench/rbook/src/main.rs`.
- **[I]**: INFERENCE, my own reasoning.
- **[U]**: UNVERIFIED.

**Blocked hosts** (proxy returned EGRESS_BLOCKED or 403):
- arxiv.org (including export.arxiv.org and alphaxiv);
- chipsandcheese.com (old and new);
- agner.org, uops.info, 7-cpu.com, wikipedia.org;
- cdrdv2-public.intel.com, numberworld.org, docs.kernel.org;
- lmax-exchange.github.io, readyset.io, flash1.com, researchgate, semanticscholar.

GitHub was reachable, so primary material hosted there was read in full: LMAX Disruptor paper source, the CppCon 2017 and 2024 slide decks, LLVM scheduling models, Linux kernel docs, exchange-core source, crossbeam, and the Flash One benchmark repository.

---

## 0. Executive summary

1. **The bounded grid makes the problem easy and cache-resident.** A side of 1,000 levels at 16 B per level header is 16 KB, and a 1,024-bit occupancy bitmap is 128 B.
   - The whole hot structure of one book (two ladders plus bitmaps) is **33,152 B**. That fits in a 48 KB L1D (Golden Cove, Zen 5) or trivially in a 1–2 MB L2 [I, arithmetic; cache sizes §1].
   - The published "flat array loses" result applies to wide price domains. The Flash One harness says flat arrays "cache-thrash a wide domain", and its flash-crash scenario walks "tens of thousands of ticks" [F]. It does not apply to Kichiko.
2. **Measured prototype [M]:**
   - The recommended structure (tick-indexed level array, 2-level bitmap, 32-byte intrusive FIFO nodes in a slab with 32-bit links, engine-issued handles) sustains **21.5–34 ns/op (29–46 M ops/s)** on one vCPU of a KVM Cascade Lake Xeon at 2.8 GHz. That covers four Kichiko-shaped workloads, 2M operations each.
   - A textbook `std::map<price, std::list>` + `std::unordered_map` book runs at **87–228 ns/op** on the same command stream: 3.4–9× slower.
   - All implementations produced **bit-identical fill hashes**.
   - Cachegrind: **~102–179 instructions/op vs ~421–701** for the textbook book, and 0.9 vs 4.0 simulated L1D misses per op on the "normal" book (§5).
3. **Per-operation costs [M], net of the ~17.5 ns timer overhead, p50:**
   - rest a passive order ≈ **18–21 ns**;
   - cancel ≈ **17–36 ns** (the higher figure is for the 81k-order book);
   - marketable order with ~2.4 fills ≈ **44–56 ns**.
   - p99 is 2–4× p50. p99.99 and max (4–18 µs, up to 0.5 ms) are dominated by hypervisor and interrupt noise on this unisolated VM.
4. **With many markets, the cache-cold book is what matters, not the algorithm [M].**
   - Routing 2M ops uniformly across 1 / 100 / 1,000 / 10,000 books costs 28.8 / 45.3 / ~81–102 / ~197–238 ns per op.
   - Software look-ahead prefetch in the sequencer loop (prefetch the book header, level and order node of the command 4 ahead) cuts the 10k-book case to **165–177 ns/op (−15 to −20%)**.
   - Even the worst case is ≥4 M ops/s on one core. That is 10⁴× Kichiko's current per-market database ceiling of ~500 orders/s (brain doc §3).
5. **The bitmap matters only for sparse books [M].**
   - With dense books (next level usually adjacent), a linear scan of level headers ties with the LZCNT/TZCNT bitmap (21.8 vs 21.5 ns/op).
   - On a sweep workload (takers crossing up to 40 ticks) the bitmap wins by ~12% (33.8 vs 38.6 ns/op), and cachegrind shows fewer instructions (179 vs 188 per op).
   - Keep it: its worst case is bounded at 2 loads + 2 bit-scans (≈16–18 cycles on Intel, ≈10 on AMD, §3.2), while a linear scan's worst case is ~1,000 loads.
6. **Language choice is not decisive at this level [M].**
   - A Rust port replaying the identical stream produced identical hashes.
   - It ran at 19.3–31.9 ns/op, within ~10% of GCC 13 and Clang 18 C++ builds and sometimes faster.
   - Bounds checks cost **+9.4 instructions/op (+8.5%) but only 3–7% time**, because the checks are perfectly predicted branches. This matches the published view that the direct cost is small and the indirect cost comes from blocked optimisations such as vectorisation [F: matklad].
7. **Published anchors (with conditions in §4):**
   - LMAX Disruptor: 52 ns mean per hop vs 32,757 ns for `ArrayBlockingQueue` [F].
   - exchange-core: p50 0.5 µs at 1 M ops/s, 3.47 GHz X5690 [F].
   - David Gross, CppCon 2024 (order-book medians):
     - `std::map` 33 ns, rising to **63 ns** once allocations are randomised;
     - `std::vector` 34 ns, reversed vector 32 ns;
     - branchless binary search 29 ns;
     - **linear search 22 ns** [F, slide images].
   - Carl Cook, CppCon 2017: `unordered_map` find 14–24 ns vs an open-addressing hybrid 7–9 ns; "a very good" software wire-to-wire is ~2.5 µs [F].
   - Flash One (arXiv 2606.01183, 2026): **33.20 M msgs/s worst-case on Graviton4**, vs ≤8.19 M/s for the best of 159 other conforming open-source engines, in their harness [F, repo README]. The paper body was not fetched (arXiv blocked). The disclosed structures, "PIN" and "neighbor-aware trees", are known only from the abstract [S].
8. **Recommendation (ranked, detailed in §7):**
   1. direct-indexed 1,000-tick ladder with a 16 B level header;
   2. engine-issued `u32` slot handles plus a `u64` sequence as ABA check, so no hash map on the hot path;
   3. a 32 B hot order node with a parallel 32 B cold record;
   4. 2-level bitmap with 16-bit summaries in a 64 B book header;
   5. one slab and one body arena per core on 2 MiB pages;
   6. look-ahead prefetch in the command loop;
   7. single writer, with an SPSC ring to a persistence thread (128 B-padded counters);
   8. cold error paths `noinline`.

   SIMD is not useful in the matching loop. For Kichiko the engine is not the bottleneck. This design buys headroom and a flat tail, and it lets one core hold every market.

---

## 1. Memory hierarchy: the numbers that set the cost model

### 1.1 Latency and capacity per level

| Core / platform | L1D | L2 | L3 / LLC | DRAM | Source |
|---|---|---|---|---|---|
| Golden Cove / Sapphire Rapids (Xeon 4th gen) | 48 KB; LLVM model `LoadLatency = 5` | 2 MB per core [S]; ~16 cycles [U: this is the Redwood Cove figure; SPR was not verified separately] | **33 ns ≈ 125 cycles at 3.8 GHz** | **~107 ns** (1 GB array, 2 MB pages) | L3 and DRAM: C&C [S]. L1: LLVM `X86SchedSapphireRapids.td` [F] |
| Redwood Cove / Granite Rapids (Xeon 6) | 48 KB, **5 cycles** | 2 MB, **16 cycles** | **~33 ns (~130 cycles)** in SNC mode; one-core L3 RMW bandwidth 60 GB/s vs 22 GB/s all-core | — | C&C "Redwood Cove" and "Xeon 6 memory subsystem" [S] |
| Zen 4 (Genoa / Raphael) | 32 KB, **4 cycles** | 1 MB, **14 cycles** | **~50 cycles** | — | [S] search extract of C&C and the AMD Family 19h SOG. LLVM `X86ScheduleZnver4.td`: `LoadLatency = 4` [F] |
| Zen 5 (Turin / Granite Ridge) | **48 KB, 4 cycles** | 1 MB | EPYC 9355P L3 **10.58 ns**; Granite Rapids SNC 33 ns vs Zen 5 11 ns | NPS0 (UMA) **>220 ns**, ~90 ns worse than NPS1 | C&C [S] |
| Neoverse V2 (Graviton 4) | 64 KB [U]; LLVM `LoadLatency = 4` | 2 MB [U]; **10-cycle** load-to-use, 64 B/cycle to L1 [S] | **68 cycles ≈ 25 ns** at the 16 MB point | — | C&C [S]. LLVM `AArch64SchedNeoverseV2.td` [F] |
| **This session's VM** (Cascade Lake Xeon @ 2.8 GHz TSC, KVM, 4 vCPU) | **1.52 ns** | **4.3 ns** (64–256 KB) | ~24–27 ns (2–4 MB). Jumps to 130–150 ns at ≥16 MB: the effective LLC slice seen by the guest is ~8 MB | **240–273 ns at 1 GiB with 4 KiB pages; 183–189 ns with THP** | [M] `memlat.cpp`: pointer chase, 1 pointer per 64 B line, random single cycle |

- [I] The VM's 1.52 ns L1 hit is about 5 cycles if the core runs at roughly 3.3 GHz turbo, and 4.3 ns is about 14 cycles. Both match the published Skylake-SP / Cascade Lake figures (L1 4–5 cycles, L2 14 cycles). The TSC runs at a fixed 2.8 GHz and does not track the core clock.
- **Branch mispredict penalty** from the LLVM scheduling models (the compiler's own cost model) [F]: Sapphire Rapids 14 cycles, Zen 4 13 cycles, Neoverse V2 10 cycles ("Copied from N2").
- **Bit-scan latency** from the same models [F]:
  - SPR: `LZCNT`, `TZCNT` and `POPCNT` are 3 cycles each (port 1); `BSF` is 3 cycles; `BLSR` and friends 2 cycles.
  - Zen 4: `LZCNT`, `TZCNT`, `POPCNT` and `BSF` are 1 cycle; `PDEP`/`PEXT` go to ALU1.
  - Neoverse V2: scalar `CLZ`/`RBIT` fall to the default integer write class, `V2Write_1c_1I`, i.e. 1 cycle [I, from the model's defaults].
  - Agner Fog's tables and uops.info could not be fetched [U]. The LLVM values are the ones compilers schedule with.

### 1.2 Why these numbers matter for a book (mechanism)

1. **Dependent-load chains (pointer chasing).** A walk down a price level's FIFO is `node → node.next → …`. Each hop waits for the previous load, so cost is *latency* × hops: 5 cycles per hop in L1, ~16 in L2, ~130 in L3 on Intel server parts, 250–600 in DRAM.
   - Out-of-order execution cannot overlap hops of one chain. It can overlap independent chains, which gives memory-level parallelism (MLP).
   - So the design goal is to make every chain short (1–3 hops) and to make chains of *different* operations independent. That is why look-ahead prefetch works (§5.6) [I].
2. **Streaming vs random.** Sequential access is covered by the L2 streamer and the L1 IP-stride prefetcher. Random access is not.
   - Gross measured random-access throughput falling from ~27 GB/s (≤32 KB) to ~13 GB/s (256 KB–1 MB), ~9 GB/s (a few MB), and ~1 GB/s beyond LLC. With 6 workers sharing L3 it collapsed to ~2–3 GB/s above 4 MB [F, slide "You're not alone", EPYC system; working-set chart].
3. **Cache line and adjacent-line pairing.** Every core above uses 64 B lines.
   - Intel's L2 "spatial prefetcher" fetches the *pair* line that completes a 128 B-aligned chunk [S: Intel manual text quoted in the Intel community forum].
   - crossbeam therefore pads `CachePadded` to **128 B on x86_64 and aarch64**. Its source comment: "Starting from Intel's Sandy Bridge, spatial prefetcher is now pulling pairs of 64-byte cache lines at a time, so we have to align to 128 bytes rather than 64", citing the Intel manual and folly [F].
   - Consequences for Kichiko: any word written by the engine thread and read by another thread (ring counters, published best-bid/offer) must sit alone in a 128 B-aligned block. Single-thread book data should be *packed*, not padded.
4. **False sharing** is the same effect on writes: two cores writing one line, or a pair of lines under spatial prefetch, turn every store into a coherence round-trip.
   - The Disruptor paper's cost table, one 64-bit counter incremented 500M times on a 2.4 GHz Westmere [F]:

     | Variant | Time |
     |---|---|
     | single thread | 300 ms |
     | single thread with lock | 10,000 ms |
     | two threads with lock | 224,000 ms |
     | single thread with CAS | 5,700 ms |
     | two threads with CAS | 30,000 ms |
     | volatile write | 4,700 ms |

   - Hence **single writer, no atomics on the matching path**.
5. **TLB reach.**
   - Golden Cove / SPR: L1 DTLB **96 entries**; L2 STLB **2,048 entries**; an STLB hit adds **7 cycles** (SPR "inherits the same TLB architecture") [S].
   - Zen 4: L1 DTLB 72, L2 3,072. Zen 5: 96 and **4,096**; an L2 DTLB hit costs 7 extra cycles, the same as Zen 4 [S].
   - Neoverse V2: 48-entry fully associative L1 DTLB and 2,048-entry 8-way L2 TLB, +5 cycles [S].
   - With 4 KiB pages, 2,048 entries cover only **8 MiB**. A Kichiko shard with 10k books × 32 KB bodies (320 MB), a 128 MB order slab and an account table far exceeds that. Every cold access then pays a page walk on top of the cache miss.
   - With 2 MiB pages the same 2,048 entries would reach 4 GiB [I; whether the STLB shares entries between 4 KiB and 2 MiB pages on each core is U].
   - Under virtualization the walk is two-dimensional. The kernel THP doc says TLB misses "run faster (especially with virtualization using nested pagetables…)" and that "a significant speedup already happens if only one of the two [guest or host] is using hugepages" [F: `transhuge.rst`].
   - Measured here: at 1 GiB, THP cut pointer-chase latency from 240–273 ns to 183–189 ns (−25 to −30%). At ≤64 MB the difference was within noise [M].
   - 1 GiB pages must be reserved at boot (`hugepagesz=1G hugepages=N`), "the most reliable method of allocating huge pages as memory has not yet become fragmented" [F: `hugetlbpage.rst`].
6. **NUMA.**
   - Turin DRAM latency in NPS0 (interleaved UMA) is >220 ns, ~90 ns worse than NPS1 [S].
   - Gross duplicates queue headers onto the remote NUMA node [F, slide "FastQueue – going even further"].
   - Rule: allocate the book arena, slab and rings on the node of the matching core (`numactl --membind`, or first-touch from the pinned thread). Put the persistence thread on the same CCD or SNC domain [I].
   - Granite Rapids' L3 is ~3× Zen 5's latency (33 vs 11 ns) [S], so any sharing through LLC costs more on Intel server parts.
7. **SIMD frequency.**
   - Ice Lake Xeon lost ~175 MHz under heavy AVX-512. Sapphire Rapids and Genoa show no fixed AVX-512 clock penalty [S: Phoronix, C&C].
   - [I] This removes the old reason to avoid AVX-512. But the matching loop is latency-bound pointer chasing, which SIMD does not help (§3.9).

---

## 2. What an operation on a bounded-grid book actually touches

Kichiko facts from the repository, which are the design inputs:
- prices are `numeric(4,1)` cents in [0.1, 99.9], which is ≤999 integer ticks (`clob_orders.price_cents` CHECK);
- sizes are `numeric(20,6)`, i.e. micro-shares, so a `u64` fixed-point value is exact;
- the tick size can be 0.1¢ or 1¢ (`031`, per the comment in `071_clob_index_ordered_ladder.sql:189–190`);
- matching is unified per option across real and synthetic levels (`docs/design/CLOB-TWO-SIDED-ENGINE.md`):
  - a resting BUY NO @ q is a synthetic ask on YES @ (100−q), matched as a **mint**;
  - a resting SELL NO @ a is a synthetic bid on YES @ (100−a), matched as a **merge/burn**;
  - both obey strict price-time priority with self-trade prevention (STP).

**Consequence [I]: one book per option with exactly two ladders in YES-price space.**
- The bid ladder holds BUY YES@p ∪ SELL NO@(1000−t).
- The ask ladder holds SELL YES@p ∪ BUY NO@(1000−t).
- Each node carries a 2-bit *kind*. The settlement type (direct / mint / merge) is a 4×4 table lookup on (taker kind, maker kind), with no branches.
- FIFO order across real and synthetic orders at a level is simply arrival order in one list. That is exactly the "unified ladder" the PL/pgSQL engine builds on every call, but maintained incrementally.

Cache lines touched per operation in the recommended layout (§7), warm case:

| Operation | Lines touched (typical) | Dependent chain |
|---|---|---|
| Top of book read | 1 (book header) | 1 load |
| Rest passive order | header, free-list head node, new node, level header, old tail node (+ bitmap word/summary if the level was empty) | free-head → node; level → tail node |
| Cancel by handle | node (this *is* the id lookup), prev node, next node, level header (+ bitmap + header if the level empties and it was best) | node → {prev, next, level}: one hop then 3 independent loads |
| Fill k makers at one level | level header, k nodes (+ next level after empty: bitmap line, header) | level → head → next → … (k hops) |

This is why the per-op cost is only a few tens of nanoseconds when hot, and ~150–250 ns when every line is a DRAM miss: 2–3 serial misses × ~100 ns in this VM.

---

## 3. Data structures at the cache and branch level

### 3.1 Price-level array indexed by tick (the ladder)

- **Layout.** `struct Level { u32 head; u32 tail; u64 qty; }` is 16 B, four per line. It is indexed directly by tick, so there is no search. 1,000 levels are 16,000 B per side.
- Gross's slides say "A typical stock order book has ~1000 price levels 'per side'" [F]. Kichiko's *entire price domain* is that size.
- **Why not a tree or `std::map`.**
  - Every level access in a red-black tree is ~log₂(n) dependent node loads, plus an allocator call per new level.
  - Gross: `std::map` median 33 ns in a warm benchmark, but **63 ns once allocations are randomised**. The tree's nodes scatter, and each comparison is a cache miss [F, slide 31 chart].
  - Gross's alternative is a sorted `std::vector`, best price at the *end* to minimise shifting: median 32 ns. Branchless binary search gave 29 ns, with branch misses 48.24M → 27.83M and IPC 1.40 → 1.57. **Linear search from the top gave 22 ns**, because the NVDA update distribution is extremely concentrated at levels 0–10: the log-scale histogram peaks near 10⁶ updates at level 0 and is ~10² by level 100 [F, slides 38–52 charts].
  - For a bounded grid, direct indexing removes even the linear search.
- **Why not "flat arrays are slow" (Flash One harness).** The harness classifies "Flat direct-indexed array (± bitmap)" best at 5.60 M/s (14 engines) and notes "O(1) by tick, but cache-thrashes a wide domain → lands lower" [F].
  - Its tick is $0.005 on a $167.52 mid, i.e. 33,504 ticks, and its flash-crash scenario walks "tens of thousands of ticks" [F: `docs/METHODOLOGY.md`].
  - 16 B × 60k ticks ≈ 1 MB per side, which spills L2 [I]. Kichiko's 16 KB per side does not.
- **Alignment.** `alignas(64)` on the ladder, and 16 B headers at 16 B-aligned offsets, so no header straddles two lines. Four adjacent ticks share a line, and ticks near the touch are the hot set, so the L1 hot set of the touch region is 1–3 lines [I].

### 3.2 Hierarchical occupancy bitmap with LZCNT / TZCNT

- **Layout.** 1,024 bits = 16 × `u64` = 128 B per side (2 lines, keep them 128 B-aligned as a prefetch pair), plus a 16-bit summary word in which bit w means word w is non-zero.
- **Best bid** (highest set bit): `w = 15 − lzcnt16(summary)`, then `t = 64w + 63 − lzcnt64(bits[w])`.
- **Best ask** (lowest): `w = tzcnt(summary)`, then `t = 64w + tzcnt(bits[w])`.
- **Cost (critical path, L1-resident)** [I from the LLVM latencies in §1.1]:
  - SPR: load summary 5 + lzcnt 3 + load `bits[w]` 5 + lzcnt 3 + add/shift ~1 ≈ **17 cycles**.
  - Zen 4: 4 + 1 + 4 + 1 + 1 ≈ **11 cycles**.
  - It is branch-free apart from the empty-book test.
  - Keeping the summary in the book header, which is already loaded for the best price, removes one load from the chain.
- **Only needed when a level empties.**
  - Best bid and ask are cached in the header and updated with a compare and cmov on insert.
  - On cancel or fill of a non-best level, no search is needed.
  - The bitmap is consulted only when *the best level* empties.
- **vs linear scan [M].**
  - Dense books: equal (normal: 21.5–21.9 vs 21.8–24.4 ns/op, noise overlapping).
  - Sweep: bitmap faster (33.8–34.4 vs 38.6–40.0 ns/op; 179 vs 188 instructions/op).
  - Deep book: roughly equal, noisy (24.6–24.9 vs 23.8–33.4).
  - Worst case for a linear scan is ~1,000 header loads plus a mispredict on exit (13–14 cycles). For the bitmap it is fixed.
- **Relationship to van Emde Boas layouts [I].** A 2-level 64-ary bitmap *is* a height-2 vEB-style/"y-fast"-like successor structure specialised to a machine word.
  - For a universe of 1,024 a third level is pointless; 64³ = 262,144 would be needed only for million-tick domains.
  - True vEB *memory layouts* (recursive subtree blocking) matter for pointer-based search trees of millions of keys, not here.
  - BMI2 `PDEP`/`PEXT` add nothing for a pure successor query. `BLSR` (clear lowest set bit, 2 cycles SPR) is handy for iterating occupied ticks when building depth snapshots.

### 3.3 Intrusive doubly-linked FIFO in a slab with 32-bit indices

- **Node** (32 B, two per line):
  - `u64 qty; u64 oid; u32 next; u32 prev; u32 acct; u16 tick; u8 kind; u8 flags`.
  - `oid` is the engine sequence number. It doubles as the **generation/ABA check** for handle reuse: a cancel carries (handle, oid) and is rejected if `pool[handle].oid != oid`.
- **Why 32-bit indices.**
  - They halve link size, so a node fits in 32 B and two fit per line.
  - An index `i` becomes an address with one `lea`/shift.
  - 4 G slots is ample.
  - The slab is contiguous, so it can sit on 2 MiB pages.
  - It is also what itch-book does: "32-bit handles into a recycled order pool" with "intrusive doubly-linked chains of order references per level", 16.4 M msg/s full parse+apply on a Ryzen 7 9700X (Zen 5) [F].
- **Free list is LIFO.** The slot freed by the last fill or cancel is the next one reused, so it is almost always L1-hot [I]. This is a large, often ignored, effect. Gross shows `std::map` median doubling (33 → 63 ns) simply from randomised allocations [F].
- **exchange-core's "Direct" book** goes further: a single global doubly-linked list threads *all* orders across levels, bucket objects keep a `tail` pointer, and `bestAskOrder`/`bestBidOrder` are head pointers. A sweep therefore follows `prev` links across price levels without touching the price tree. Price buckets and the order index are Adaptive Radix Trees, with objects pooled [F: `OrderBookDirectImpl.java`]. For a bounded grid the bitmap already makes the cross-level step O(1).
- **Alternative (option B): per-level contiguous FIFO chunks** (arrays of handles, tombstone on cancel, compaction when more than half are dead).
  - Matching then reads sequentially and prefetch-friendly.
  - Flash One's "Priority-Indicated Node (PIN)" is described as "a contiguously addressable region of slots and priority indicators encoding the node-local priority rule, that provide worst-case constant work per node while preserving strict price–time priority" [S: abstract extract].
  - With Kichiko's small per-level counts the linked list's k-hop chain is short, and cancels stay O(1) without compaction. So the list is ranked first and chunks second [I]. Benchmark both (§8, scenario S9).

### 3.4 Order-id → slot map

| Option | Hot-path cost | Evidence |
|---|---|---|
| **Direct index by engine handle** (recommended) | 0 extra lines: the lookup *is* the node load | [I]. The Flash One harness's reference adapters use "flat-array direct indexing rather than a hash map", calling it "the more faithful model of real order-entry protocols, where a session assigns increasing, dense order identifiers — the sequential UserRefNum discipline of Nasdaq OUCH 5.0" [F] |
| Paged direct index (8,192 refs per page) | 1 extra load (page table), usually hot | itch-book [F] |
| Swiss table (Abseil / hashbrown) | ≥1 extra line (the 16-byte control group), plus the slot line unless the value is inline | Control byte = 1 control bit + 7-bit H2; H1 = 57 bits for the index; SSE matches 16 candidates at once; deleted entries keep probing going, empty ones stop it [F: Abseil design doc] |
| Robin Hood (open addressing) | Similar to Swiss, with bounded probe-length variance | martinus `robin_hood` is archived; the author recommends `ankerl::unordered_dense` [F] |
| Open-addressing / chaining hybrid | 7–9 ns find, 10–10k elements | Cook 2017, 32 × 2.89 GHz [F] |
| `std::unordered_map` (node-based) | 14 ns (10 elements) to 24 ns (10k), 0.67 IPC, 56.5% frontend idle | Cook 2017 [F] |
| ART (adaptive radix tree) | Several dependent node loads | exchange-core [F] |

Kichiko orders are UUIDs in Postgres. [I] The engine should return a `(handle u32, oid u64)` pair at accept, and the API/DB should persist it next to the UUID so that every later cancel or modify is direct-indexed. A UUID→handle Swiss table can live in the gateway, off the matching thread, for clients that only know UUIDs.

### 3.5 Structure-of-arrays vs array-of-structures, and hot/cold split

- **Hot path uses AoS.** Matching reads `head` and `qty` of a level together, and `qty/next/acct/oid` of a node together, so SoA would *split* one access into two lines [I].
- **Cold data goes in a parallel array** indexed by the same slot: client UUID (16 B), accept timestamp (8 B), original size (8 B), making a 32 B cold record. It is touched only at accept and at terminal events such as persistence or reporting.
- **SoA wins for market-data snapshots**: summing or copying top-N `qty` values for the depth feed. That work belongs on a publisher that reads a snapshot, not on the matcher [I].
- Cook: "denormalized data is not a sin… pull all the data you care about in the same cacheline… better than trampling your cache to 'save memory'" [F, slides 27–28].

### 3.6 Alignment of headers and false sharing

- Book header: 64 B, one line, `alignas(64)`, in an array indexed by book id.
- Bitmaps: 128 B-aligned per side.
- Ladder: 16 B headers.
- Cross-thread fields (ring read/write counters, published top-of-book) go in their own 128 B blocks. Gross's FastQueue puts `mReadCounter`, `mWriteCounter` and the buffer in separate `alignas(CACHE_LINE_SIZE)` blocks [F].
- Gross's final queue results, after the counter-caching and alignment optimisations: throughput at 2 readers ≈ 31.6 M msgs/s for FastQueue v3, vs ≈ 10.2 M (Disruptor) and ≈ 11.8 M (Aeron broadcast) on an AMD EPYC 9474F [F, final results chart, values read off the bar chart ±0.5 M].

### 3.7 No heap allocation on the hot path

- Cook: "Allocations are costly: Use a pool of preallocated objects"; glibc `free` "has 400 lines of book-keeping code"; delete large objects from another thread [F].
- Gross's randomised-allocation experiment above shows the *locality* cost as well [F].
- Pre-size the slab at startup. On exhaustion, reject; do not grow. Growing means a copy and a latency spike.
- `std::function` may allocate. Cook shows `operator new(24)` for a 24 B capture, and suggests `inplace_function` [F].

### 3.8 Branch behaviour and branchless code

- Mispredicts cost 13–14 cycles on current x86 and 10 on V2 [F: LLVM models], i.e. more than an L2 hit.
- Techniques:
  - **Error/slow paths out of line.** Cook: fold error checks into one flags word, keep `HandleError` `noinline`. Gross: `[[unlikely]]` plus an IIFE `[&]() __attribute__((noinline, cold)) { HandleError(); }()` to keep i-cache lines hot [F].
  - **Templates instead of runtime side branches**, e.g. `template<Side>` [F: Cook slides 23–24].
  - **cmov for best-price updates** (`best = max(best, tick)`) and **table lookup for match kind**.
  - **Branchless binary search**: `first += comp(first[half], value) * (length - half)`. "multiplication (by 1) is needed for GCC to generate CMOV" [F: Gross slide 49].
- What remains in the matching loop are data-dependent branches:
  - "maker fully filled?" is predictable when orders are small relative to takers;
  - "STP hit?" is rare and marked `UNLIKELY`;
  - "level empty?" is predictable.
- "Keeping the cache hot": run a frequent dummy path through the system to keep the d-cache, i-cache and branch predictor trained [F: Cook slide 38]. [I] For Kichiko's low message rate this matters more than any of the above. At 10 orders/s per market, every real order arrives to a cold core unless warmed.

### 3.9 SIMD (AVX2 / AVX-512): where it helps and where it does not

- **Does not help.**
  - The matching loop is a dependent chain of scalar loads (`head → next → …`) with per-order arithmetic. Latency-bound work gets nothing from width [I].
  - Best-price search is already 2 loads + 2 bit-scans.
- **Can help:**
  - Swiss-table probing (16 control bytes per `pcmpeqb` / `pmovmskb`) [F: Abseil];
  - building depth snapshots, e.g. compressing the non-empty levels of a 64-tick window with AVX-512 `VPCOMPRESSQ` or a mask plus scalar pext;
  - STP checks against a small set of an account's resting prices;
  - checksumming journal records.
- **Costs.** Pre-SPR Intel downclocking has gone on SPR and Zen 4 [S]. Valgrind cannot run AVX-512 code: our `-march=native` build died with SIGILL under cachegrind, and we had to use `-march=x86-64-v3` [M]. That is a practical tooling cost.

---

## 4. Published engines and talks, with conditions

| Source | Number | Conditions | Tag |
|---|---|---|---|
| **LMAX Disruptor paper** | Mean latency per hop, 3-stage pipeline: **52 ns vs 32,757 ns** (`ArrayBlockingQueue`). 99% < 128 ns vs < 2,097,152 ns; 99.99% < 8,192 ns; max 175,567 ns | Core i7-2720QM 2.2 GHz, Java 1.6.0_25, Ubuntu 11.04; 1 µs gap between events, 50M events, invariant TSC, no CPU binding | [F] |
| Disruptor throughput | Unicast 1P–1C **25,998,336 ops/s** vs ABQ 5,339,256 (Nehalem 2.8 GHz, Win7). Updated: Disruptor 4 **160,359,204 ops/s** vs ABQ 20,895,148 | EPYC 9374F, Linux 5.4.277, OpenJDK 11.0.24, best of 3 over 500M messages | [F] |
| LMAX exchange (Fowler 2011) | "6 million orders per second on a single JVM thread" | 3 GHz dual-socket quad-core Nehalem, 32 GB | via report 03 (not re-fetched) |
| **exchange-core** | 1 M ops/s: p50 0.5 µs, p90 0.9, p99 4, p99.9 22, p99.99 31, worst 45 µs. 5 M ops/s: p50 1.5 µs, p99 42 µs, worst 190 µs. "150ns per matching for large market orders" | Dual X5690 3.47 GHz, one socket isolated and tickless, RHEL 7.5, Java 8u192, mitigations off. 3M msgs: 9% GTC, 3% IOC, 6% cancel, 82% move; ~1,000 resting orders over ~750 price slots | [F] README |
| exchange-core in the Flash One harness | 1.40 M/s worst case (flash-crash), with `engine_on_batch`; 1.20 M/s per-message JNI | Graviton4 | [F] |
| **Liquibook** | "2.0 million to 2.5 million inserts per second", a "rough order-of-magnitude estimate" | Hardware not stated | [F] README |
| Liquibook in the Flash One harness | 0.03 M/s (static scenario), "with fix" (IOC residual rests instead of cancelling; corrected adapter-side, issue #43) | Graviton4 | [F] |
| **CoinTossX** (Jericevich, Sing, Gebbie; SoftwareX 2022, arXiv 2102.10925) | No throughput or latency number in the README. The paper claims linear scaling [S]. The harness measured 0.03 M/s, with 2 fixes (B+Tree destructive `firstKey`; wrong-side compare) | Java, Aeron UDP + SBE, off-heap, 2 MB HugePages [F README] | [F]/[S] |
| **Flash One** "The World's Fastest Matching Engine Algorithm" (Jake Yoon, arXiv 2606.01183; v1 31 May 2026, v8 17 Aug 2026 [S]) | **33.20 M msgs/s worst-case** on one Graviton4 core. Top open-source engine **8.19 M/s** (e820/weekend-orderbook, C, with fix). Sub-µs P99 host path at 13 M msgs/s; P99 < 10 µs up to a knee near 42 M msgs/s, and 41.08 M/s, "on AMD EPYC". Claims ~640 M/s on 96 cores over 10,000 symbols [S] | ~2.0M messages, one at a time, through a C ABI; output drained by an adjacent-core consumer, so throughput includes the hand-off. 5 scenarios; the result is each engine's *minimum* scenario median of 10. `-O3 -march=native`. Workload: 95% of non-IOC orders cancelled (median lifetime 0.431 ms), 15% IOC, 20% modified. 247 engines tested; 160 conform byte-identically (47 as shipped); 181 issues filed upstream | [F] repo README and `docs/METHODOLOGY.md`. Structures: "PIN + Neighbor-aware trees" [F]; PIN definition and "constant-time splice and graft … single root-to-leaf rebalancing path" [S, abstract]. Paper body not read (arXiv blocked) |
| Flash One harness, best by class | RB-tree 7.94 M/s (59 engines, "37% of the field"); sorted vector 7.86; AVL 7.26; B-tree 7.20; binary heap 8.19; flat array ±bitmap 5.60; skip-list 1.62; hash-of-levels 0.11 | Same | [F] |
| **David Gross, CppCon 2024** (Optiver) | Order-book medians: `std::map` 33 ns (63 ns with randomised allocations); vector 34; reversed vector 32; branchless `lower_bound` 29; **linear search 22 ns**. Branchless vs `std::lower_bound`: 3.53 vs 3.92 G cycles; 27.83M vs 48.24M branch misses; 5.55 vs 5.49 G instructions | Order-book benchmark hardware not stated in the slides [U]. Queue results on AMD EPYC 9474F, tuned and isolated, 73 B messages, 8 MB queue. "Ultra low-latency execution (< 1μs)" tier | [F] slides + chart images |
| **Carl Cook, CppCon 2017** (Optiver) | Wire-to-wire ~2.5 µs "very good" for software. `unordered_map` find 14–24 ns vs `array_map` 7–9 ns (IPC 0.67 vs 1.6). Exceptions for control flow ≥1.5 µs. Static-local guard 5–10% overhead | 32 × 2892.9 MHz, 2017-09-08 (Google Benchmark header) | [F] slides |
| **itch-book** (C++23) | 16.4 M msg/s = 61 ns/msg, full ITCH parse + book apply. Parse only: 199 M msg/s | Ryzen 7 9700X (Zen 5), 96 GB DDR5, Ubuntu 24.04, kernel 6.17, gcc 13.3 -O3; `isolcpus=2-7 nohz_full=2-7 rcu_nocbs=2-7`; 12302019.NASDAQ_ITCH50 (268,744,780 msgs, 8.25 GB) | [F] README |
| Another ITCH reconstructor | ~9.4 ns/msg decode-only; **320 ns/msg** parse + book over a 423M-message day | Hardware not given in the extract | [S] |
| Coinbase exchange | Internal p99 RTT < 1 ms, "single-digit μs" processing | via report 03 | — |
| Deutsche Börse T7 | Per-partition matching ceilings "~300,000 orders/s"; gateway peaks in the millions/s | Cited by the Flash One README from the "T7 Latency Roadmap" (Open Day 2023) | secondary [U] |
| Databento | No order-book-builder benchmark found. It has an MBO (L3) Python order-book tutorial and per-minute MBO snapshots | — | [S] |

Reading of the evidence [I]:
1. Every serious engine converges on the same ideas: a single writer, pooled or pre-allocated order objects, O(1) access to the best level, and short pointer chains.
2. Most "M ops/s" claims are not comparable. They differ in whether gateway, risk, journaling or output hand-off are included, and in message mix. The Flash One harness is the only public apples-to-apples comparison, and its domain (wide ticks, cancel-heavy equity flow) differs from Kichiko's.
3. At 30–45 M ops/s our prototype is in the same order as FlashOne's 33 M/s, but **not comparable**. It is a different machine; the harness adds a C ABI call and an inter-thread output hand-off per message; and our grid is 1,000 ticks. Our 4 Kichiko scenarios are closer to Flash One's "static"/"normal" than to its worst case.

---

## 5. Measurements in this session

### 5.1 Environment and method

- **Machine:** KVM guest, Intel Xeon (family 6 model 85 stepping 7, i.e. Cascade Lake), "@ 2.80GHz", 4 vCPU, 1 socket, L1d 32 KB, L2 1 MB and "L3 33 MiB" per lscpu. Flags include AVX-512, BMI1/2, `constant_tsc` and `tsc_known_freq`.
- **Software:** kernel 6.18.44; THP mode `madvise`; GCC 13.3.0; Clang 18.1.3; rustc 1.94.1; valgrind 3.22.0.
- **No PMU** (`perf` absent) and no core isolation. Runs were pinned with `taskset -c 2`.
- **Timing:**
  - Throughput is `clock_gettime(CLOCK_MONOTONIC)` over the whole replay divided by the op count.
  - Per-op latency uses `lfence; rdtsc; lfence … rdtscp; lfence`, with TSC calibrated at 2.800 GHz. This is the Paoloni (Intel 2010) CPUID/RDTSC … RDTSCP pattern with lfence as the serialiser; overhead is measured and reported, not silently subtracted [F method].
  - The empty timed region costs **p50 17.5 ns (49 TSC ticks)**.
- **Workload** (`generate()` in `book.cpp`):
  - Kichiko-shaped flow on ticks 1..999.
  - The mid price random-walks by ±1 tick with 2% probability per message.
  - Passive orders are placed at the half-spread + 1 + Exp(mean d) ticks from mid, sized 1–100 shares (in micro-shares).
  - Takers cross the opposite best by 0..s ticks, sized 20–320 shares.
  - Cancels target actually-resting orders, chosen by driving a reference book during generation, plus ~2% stale or duplicate cancels.
  - A controller keeps resting depth near the target.
  - STP (cancel resting on same account) is active with 50–5,000 accounts.
  - Every implementation must reproduce the same **fill hash**; all did.

| Scenario | Avg resting orders | Takers | Max levels crossed | Mean distance of passive orders from mid |
|---|---|---|---|---|
| thin | 156 | 12% | 2 | 6 ticks |
| normal | 3,524 | 12% | 3 | 12 ticks |
| deep | 80,949 | 5% | 3 | 60 ticks |
| sweep | 453 | 25% | 40 | 12 ticks |

### 5.2 Throughput (2M ops per run, 3 runs; range shown)

| Scenario | fast (bitmap) | fast (linear scan) | `std::map`+`list`+`unordered_map` | Speed-up |
|---|---|---|---|---|
| thin | **21.8–23.3 ns** (42.9–45.9 M/s) | 22.4–22.9 | 87.1–93.2 | ~4.0× |
| normal | **21.5–25.2 ns** (39.8–46.5 M/s) | 21.8–24.4 | 105.1–112.0 | ~4.8× |
| deep | **24.6–24.9 ns** (40.1–40.7 M/s) | 23.8–33.4 | 187.5–227.6 | ~8× |
| sweep | **33.8–34.4 ns** (29.1–29.6 M/s) | 38.6–40.0 | 111.7–130.1 | ~3.4× |

Clang 18 build of the same C++: thin 21.3–21.5, normal 21.7–21.9, deep 25.1–29.0, sweep 32.9–33.1 ns/op. With `-march=native` the generator's floating-point code compiles differently under clang (FMA contraction), so the streams differ slightly and the hashes differ. Distributions are equivalent [M].

### 5.3 Per-operation latency (fast book, raw p50 / p99 / p99.9 in ns, including the 17.5 ns timer)

| Scenario | add (rests, no fill) | taker (≥1 fill) | cancel ok | cancel reject |
|---|---|---|---|---|
| thin | 35 / 66 / 284 | 65 / 155 / 338 | 34 / 63 / 279 | 36 / 55 / 226 |
| normal | 36 / 58 / 293 | 65 / 149 / 342 | 37 / 60 / 298 | 38 / 61 / 290 |
| deep | 38 / 130 / 385 | 61 / 271 / 519 | 53 / 151 / 458 | 54 / 134 / 347 |
| sweep | 37 / 63 / 302 | 74 / 192 / 371 | 41 / 116 / 345 | 41 / 71 / 328 |
| `std::map` normal | 100 / 244 / 483 | 167 / 599 / 974 | 144 / 306 / 606 | 55 / 164 / 512 |
| `std::map` deep | 123 / 605 / 1,328 | 229 / 2,073 / 4,834 | 509 / 1,094 / 5,814 | 179 / 751 / 988 |

- Net of timer overhead: add ≈ 18–21 ns (~50–60 TSC cycles), cancel ≈ 17–36 ns, taker ≈ 44–56 ns for ~2.4 fills per taker (normal: 762,491 fills / 314,914 takers).
- The deep cancel is slower (36 vs 20 ns) because a random resting order among 81k × 32 B = 2.6 MB of nodes misses L1 and L2. It is **the only cold access**, because the handle is the address.
- `std::map`'s deep cancel p50 is 509 ns. That covers a hash lookup (node pointer chase), list erase, and possibly a map erase with rebalancing.
- Whole-distribution tails (fast/normal): p99.99 ≈ 4.6 µs, max 0.5 ms. These are VM and timer-interrupt artefacts without `isolcpus`/`nohz_full` [I]. itch-book's published setup isolates cores for exactly this reason [F].

### 5.4 Instruction and simulated cache-miss counts (cachegrind, no PMU)

Setup: `valgrind --tool=cachegrind --cache-sim=yes --D1=49152,12,64 --LL=2097152,16,64` (the LL is modelled as a Golden Cove-like 2 MB L2); `-march=x86-64-v3`; 300k ops; only the replay loop is instrumented (`CACHEGRIND_START/STOP_INSTRUMENTATION`). The command stream itself (32 B/cmd, 9.6 MB) accounts for ~150k D1 and LL misses in every run, and that baseline is subtracted below [M].

| Scenario | Instr/op fast | Instr/op linscan | Instr/op `std::map` | D1 miss/op fast | D1 miss/op map | LL (2 MB) miss/op fast | LL miss/op map |
|---|---|---|---|---|---|---|---|
| thin | 115.0 | 114.1 | 454.6 | ~0.00 | 0.01 | ~0 | ~0 |
| normal | 116.8 | 115.6 | 463.0 | 0.89 | 3.97 | 0.01 | 0.02 |
| deep | 101.9 | 100.6 | 421.3 | 1.72 | 6.02 | 0.76 | 2.99 |
| sweep | 179.2 | 188.3 | 701.0 | 0.15 | 1.01 | ~0 | 0.02 |

Interpretation [I]:
- The fast book does **~4× fewer instructions**, and **4.5× fewer L1D misses** on normal.
- On the deep book it is ~4× fewer L2 misses. The residual 0.76 L2 misses/op are node lines of random cancels and deep-queue fills, which only a smaller node or a hot/cold split can reduce.
- These counts include ~15 instructions/op of harness loop and fill hashing.

### 5.5 Language: Rust port, bounds-checked vs `get_unchecked`

Same algorithm and same binary command stream; the hashes are identical to C++ for all 4 scenarios [M].

| Scenario | Rust checked | Rust unchecked | C++ GCC (-O2 -march=native) |
|---|---|---|---|
| thin | 21.1–21.7 | 19.7–20.2 | 21.8–23.3 |
| normal | 20.5–21.0 | 19.3–20.4 | 21.5–25.2 |
| deep | 24.2–25.0 | 23.0–25.3 | 24.6–24.9 |
| sweep | 31.5–32.0 | 29.7 | 33.8–34.4 |

- Cachegrind (normal, whole process): 240.4M vs 221.6M instructions, i.e. **+9.4 instructions/op for bounds checks (+8.5%)**, but **+3–7% time**. The checks are compare + predicted-not-taken branch, which retire in parallel with the loads that dominate [M].
- This matches the external evidence: the direct cost is negligible, and the indirect cost comes from lost optimisations. In matklad's `bounds-check-cost` repo, a sequential sum ran at 34.5 ms checked vs 17.7 ms unchecked (vectorisation blocked), while indirect access showed no difference (63.6 vs 64.9 ms) [F].
- `&mut` noalias has been emitted by default since Rust 1.54, on LLVM 12 or later. It was re-enabled via PR #82834 after several LLVM miscompiles [S: rust-lang issues #54878, #84958].
- [I] For a linked-list book the aliasing information matters little: every access is a load from a computed index anyway.

### 5.6 Many books: the cache-cold regime and look-ahead prefetch

Setup: M independent "thin"-shaped books (150 resting each, 2,048-slot pool each), 2M ops routed uniformly at random [M].

| Books M | ns/op (no prefetch) | ns/op with prefetch 4 commands ahead |
|---|---|---|
| 1 | 28.8 | — |
| 10 | 28.0 | — |
| 100 | 45.3 | — |
| 1,000 | 80.7–102.0 | 81.0–83.2 (no gain) |
| 10,000 | 197–248 | **165–177** |

- The prefetch issues `prefetcht0` for the book header, opposite bitmap, target level, opposite best level and free-list head. For cancels it prefetches the order node.
- A two-stage variant (headers at 2D, dependents at D) showed no reliable further gain on this VM. Run-to-run noise at M = 10k is ±10–15%.
- [I] At 10k books each op makes ~2–3 *dependent* DRAM misses (header → level → node). Prefetching turns part of that chain into MLP across commands. The gain is bounded because some prefetch addresses depend on data (`best`, `freeHead`) that is itself missing.
- A production sequencer can prefetch from the *input ring*, which it reads in batches anyway.
- **THP for 64 KB pools had no effect.** Regions smaller than 2 MB cannot use a PMD huge page; the "differences" seen were noise. This is an argument for **one shared slab and one body arena per core**, on 2 MiB pages, instead of per-book allocations [I/M].

---

## 6. Language, runtime and measurement choices

### 6.1 C++ vs Rust vs Java

- **C++**
  - Full control: `[[likely]]`, `__attribute__((cold, noinline))`, `alignas`, placement into arenas, `__builtin_prefetch`, intrinsics.
  - Pitfalls from Cook: pre-C++17 placement-new null checks; old COW `std::string` on some ABIs; static-local guard 5–10%; `std::function` allocating; `std::pow` slow path (53 ns vs 478,195 ns for a nearby exponent on glibc 2.17) [F].
- **Rust**
  - Parity in our test [M].
  - Bounds checks: +8.5% instructions, +3–7% time.
  - `unsafe get_unchecked` confined to a tiny audited module brings it level.
  - Benefits: memory safety for the parts that are *not* hot (gateway, persistence, risk), `#[repr(C, align(64))]`, and const generics for side specialisation (what Cook does with templates).
  - [I] For a small team, Rust gives most of C++'s speed with fewer foot-guns.
- **Java (LMAX, exchange-core, CoinTossX)**
  - Viable with discipline: preallocated ring entries "immortal as far as garbage collector is concerned" [F: Disruptor]; object pools and "Low GC pressure" [F: exchange-core]; off-heap memory and huge pages [F: CoinTossX].
  - ZGC max pauses "rarely exceed 250 microseconds", averaging tens of µs; Generational ZGC keeps pauses <1 ms [S: JEP 377/439].
  - Array-of-objects layouts carry pointer indirection until value types exist; the Disruptor paper names this limitation [F].
  - The Flash One harness's JVM engines measured 1.2–2.0 M/s with JNI per-message overhead [F].
  - [I] Not recommended for a new Kichiko core, because nothing requires it.
- **Node / TypeScript** (Kichiko's current app stack): possible for the book logic with typed arrays (`Uint32Array` links, `BigUint64Array`/`Float64Array` quantities). JIT de-optimisation and GC are the tail-latency risks [I/U]. Not measured here.

### 6.2 How to measure (the VM has no PMU)

- **Cycle timing.**
  - Use `rdtsc` with `lfence` (or `cpuid`) before it and `rdtscp; lfence` after.
  - Measure the empty region's overhead and report it (we got 17.5 ns / 49 ticks).
  - TSC must be invariant (`constant_tsc nonstop_tsc`), calibrated against `CLOCK_MONOTONIC` [F: Paoloni; M].
  - In production, log TSC deltas to an SPSC queue and write them out on another thread (Gross's `ScopedTrace` pattern) [F].
- **Instruction and miss counts without a PMU.**
  - `valgrind --tool=cachegrind --cache-sim=yes` with explicit `--D1/--LL` geometry, instrumenting only the region of interest (valgrind ≥3.22 client requests).
  - Build with `-march=x86-64-v3`, because AVX-512 is unsupported under valgrind [M].
  - `callgrind` gives per-function inclusive costs.
  - Caveats: cachegrind simulates only 2 levels, uses no prefetchers, and has no timing. Use it for *relative* instruction and miss counts, not time [I].
  - Cook warns instrumentation profilers are "too intrusive" and "don't catch I/O slowness/jitter" [F].
  - On real hardware, use `perf stat -M Frontend_Bound,Backend_Bound,Bad_Speculation,Retiring` first (top-down), then PAPI counters around the region [F: Gross].
- **Micro-benchmarks.**
  - `criterion` (Rust) or Google Benchmark (C++), with `black_box` / `DoNotOptimize`.
  - They are not end-to-end truth. Cook's preferred method is hardware-timestamped replay through a switch [F].
- **Coordinated omission.**
  - Closed-loop generators stop sending while the system stalls, so they omit the worst samples.
  - wrk2's fix is constant-throughput generation, measuring from when a request *should* have been sent. In its example, the uncorrected p99 was ~6 ms and the corrected p99 ~1.27 s during a 1.4 s stall [F].
  - HdrHistogram: 3 significant digits over a configurable range; ~185 KB for 0–3.6e9 at 3 digits; "3-6 nanoseconds" per record (circa-2012 Intel); `recordValueWithExpectedInterval()` for CO correction [F].
  - Flash One measured latency open-loop and CO-free, reporting latency vs offered load up to the saturation knee [F README].

---

## 7. Recommended design for Kichiko's in-memory book (ranked)

Assumptions:
- one engine thread per shard (core);
- a shard owns many option-books;
- prices are YES-space ticks 1..999 (0.1¢ grid; a 1¢ market uses every 10th tick, with the grid step kept as a per-book multiplier);
- quantities are `u64` micro-shares;
- money is `i64` micro-USD.

### 7.1 Exact layout (bytes)

```c
// ---------- per shard (one pinned core), all arenas on 2 MiB pages (THP madvise or hugetlbfs) ----------

struct OrderHot {            // 32 B, slab[N], alignas(32): two per cache line
  u64 qty;                   //  0  remaining, micro-shares
  u64 oid;                   //  8  engine sequence number (also ABA/generation check for handle reuse)
  u32 next;                  // 16  slab index, 0xFFFFFFFF = nil
  u32 prev;                  // 20
  u32 acct;                  // 24  dense account index (STP, risk)
  u16 tick;                  // 28  YES-space tick 1..999
  u8  kind;                  // 30  BUY_YES | SELL_YES | BUY_NO | SELL_NO  (bit0 = ladder side)
  u8  flags;                 // 31  post-only, STP mode, TIF, synthetic
};

struct OrderCold {           // 32 B, cold[N], same index; touched at accept/terminal only
  u8  client_uuid[16];       //  0
  u64 accept_ts_ns;          // 16
  u64 orig_qty;              // 24
};

struct Level {               // 16 B, four per line
  u32 head, tail;            // FIFO ends (slab indices)
  u64 qty;                   // total resting qty at this tick (depth feed without walking)
};

struct alignas(64) BookHdr { // 64 B = 1 line; hdr[book_id]
  i16 best_bid;              //  0  -1 if empty
  i16 best_ask;              //  2  1024 if empty
  u16 sum_bid, sum_ask;      //  4  bit w <=> bits[side][w] != 0  (1,024 ticks -> 16 words -> 16 bits)
  u32 body_off;              //  8  index of BookBody in the body arena
  u32 resting;               // 12
  u64 seq;                   // 16  per-book event sequence (market data, gap detection)
  u64 volume_micro;          // 24
  u32 option_id;             // 32
  u16 last_tick;             // 36
  u8  status;                // 38  open / halted / post-only-after-restart / settled
  u8  tick_mult;             // 39  1 (0.1c) or 10 (1c)
  u8  _pad[24];              // 40..63 (room for fee tier, band limits)
};

struct alignas(128) BookBody {       // 32,256 B -> padded to 32,768 (64 bodies per 2 MiB page)
  u64   bits[2][16];                 // 256 B: bid bitmap (128 B, one prefetch pair) + ask bitmap
  Level lv[2][1000];                 // 32,000 B  (lv[side][tick-1])
};

struct alignas(64) AccountHot {      // 64 B; acct[a]
  i64 cash_avail_micro, cash_reserved_micro;
  u32 open_orders, flags;            // flags: STP group, frozen, market-maker
  u32 stp_group; u32 _p;
  u8  _pad[32];
};
// positions: open-addressing (Swiss/Robin Hood) map keyed (acct<<32 | option) -> {i64 yes, i64 no, i64 yes_reserved, i64 no_reserved}
// output: SPSC ring (FastQueue/Disruptor style), counters each in their own 128 B block
```

Footprint [I, arithmetic]:
- 10,000 active books: 640 KB of headers plus 320 MB of bodies.
- 4M-slot order slab: 128 MB hot plus 128 MB cold.
- With 2 MiB pages that is ~290 pages, a working set whose translations fit the 2,048-entry STLBs of Golden Cove and V2, subject to the STLB page-size sharing caveat above [U].
- If memory matters more than one extra dependent load, the 32 KB body can be split into 16 lazily allocated 2 KB chunks (64 ticks × 2 sides × 16 B) behind a `u16 chunk[16]` table. Most books would then use 2–4 KB [I].

### 7.2 Operations and expected costs

Warm figures are for an L1/L2-resident book, using the Golden Cove / SPR latencies from §1 (L1 5 cycles, L2 ~16, `lzcnt` 3, mispredict 14). "Cold" assumes every distinct line misses to DRAM (~100–130 ns server bare metal [S], 130–250 ns in this VM [M]) and counts *serial* misses.

| # | Operation | Steps | Warm critical path | Cold | Measured here [M] |
|---|---|---|---|---|---|
| 1 | Best bid/ask | load `hdr.best_*` | 1 L1 load ≈ 5 cycles (~1.5 ns) | 1 miss | — |
| 2 | Rest passive (no cross) | cross test vs `hdr.best_opp` (predicted) → pop `free_head` (load `slab[free].next`) → write node (32 B, same line) → load `lv[tick]` → link: store `slab[tail].next`, or set bit + summary if the level was empty → `best = max/min` via cmov → append output record | ~3 dependent L1/L2 loads + ~40–60 instructions ≈ **35–60 cycles** | header → level → tail node: ~3 serial misses | **~18–21 ns net p50** (≈50–60 TSC cycles) |
| 3 | Cancel by (handle, oid) | load node (the lookup) → compare oid → load prev and next nodes in parallel and the level → unlink, `lv.qty -= q` → push the slot on the free list → if the level empties: clear bit; if it was best, rescan (2 loads + 2 `lzcnt`) | 1 + 1 dependent hops, prev/next/level overlapped; ≈ **30–60 cycles**, +~17 if the best is rescanned | node → level/neighbours: 2 serial misses | **~17–20 ns net** (normal); ~36 ns (81k-order book, node misses L2) |
| 4 | Match, per fill | load maker node (prefetch `next` one ahead) → STP compare (rare branch) → `f = min` (cmov) → 3 subtractions → emit 32 B fill record → if the maker is done, unlink its head and free it | 1 dependent load per maker (5 cycles L1, overlapped with prefetch) + ~20–25 instructions ≈ **10–15 cycles per fill** | 1 miss per maker node | taker p50 **~44–56 ns net for ~2.4 fills** (includes the rest of any remainder) |
| 5 | Level transition during a sweep | clear bit (RMW), maybe clear summary bit, recompute best (header summary → `bits[w]` → 2× `lzcnt`) | ≈ **17 cycles Intel, ~11 AMD** | 1 miss (bitmap line) | sweep scenario: bitmap 33.8 vs linear scan 38.6 ns/op |
| 6 | Mint/merge classification | `kind = table[taker.kind][maker.kind]`; maker leg price = maker is NO ? 1000 − tick : tick | 2–3 ALU ops, no branch | — | [I] |
| 7 | Risk pre-check (cash/position reservation) | `acct[a]` line + position map probe (control group + slot) | ~2–3 L1/L2 loads | 2–3 misses | not measured [I] |
| 8 | Depth snapshot, top N levels | iterate set bits with `BLSR`/`tzcnt`, reading `lv.qty` | ~3–4 cycles per level | — | [I] |

### 7.3 The ranked design decisions

1. **Direct-indexed 1,000-tick ladder, 16 B level header, cached best in the header.** Measured 3.4–9× vs the textbook tree book, with 4× fewer instructions [M]. It matches the "no node containers" principle, Gross's Principle #1 [F].
2. **Engine-issued `u32` handles and a `u64` oid, so the id map is removed from the hot path.** Cancel p50 ≈ 17–20 ns vs 127 ns for `std::map` + `unordered_map` [M]. The Flash One harness adopts the same principle, citing OUCH's dense UserRefNum [F].
3. **32 B hot node, 32-bit links, LIFO free list, one slab per core on 2 MiB pages.** Two nodes per line; the freed slot is reused hot; huge pages cut TLB walks (−25–30% on 1 GiB random access in this VM) [M, F].
4. **Two-level bitmap with the 16-bit summaries in the header line.** Bounded worst case for "next best"; ~12% faster on sweeps; neutral on dense books [M].
5. **Look-ahead software prefetch in the command loop** (shard with thousands of books). −15–20% at 10k books [M]. It needs a batched input ring (Disruptor-style batching [F]).
6. **Single writer; SPSC output ring with cached remote counters and 128 B padding; persistence thread on the same CCD/SNC domain and NUMA node.** Disruptor: 52 ns per hop vs 32.8 µs for a locked queue [F]. Gross shows the counter-caching optimisations and the final FastQueue results [F]; that the caching is what produces the gain is [I]. crossbeam/folly use 128 B padding [F].
7. **Branch and i-cache hygiene.**
   - Cold error paths `noinline`/`cold`.
   - Side specialised by template or const generic.
   - cmov for min/max.
   - A periodic warm-up path at low traffic (Cook's "dummy path"), because at Kichiko's rates every real order otherwise arrives cold [F, I].
8. **Hot/cold split and integer fixed point.** 32 B cold record; `u64` micro-shares; `i64` micro-USD. The notional `qty × tick` fits in `u64` (1e14 × 999 < 1.8e19), with the division by 1,000 done once per fill with explicit rounding [I].
9. **Rust with a small `unsafe` core** (or C++) [M: parity]. **Not** Java or a managed runtime for the core [I].

**Deliberately not recommended:**
- `std::map`/`BTreeMap`/skip-lists for levels (measured 4–9× slower; skip-list class best 1.62 M/s in the Flash One harness [F]);
- a hash map on the matching path;
- per-level `std::deque`/`Vec` that reallocates;
- AVX-512 in the matching loop;
- multi-writer lock-free books (Cook: "Multithreading is best avoided for latency-sensitive code" [F]);
- per-book `malloc` arenas (defeats huge pages, §5.6).

**Option B to benchmark:** per-level contiguous FIFO chunks with tombstones (PIN-like). Expected to win on long queues at one price, where it is sequential and prefetch-friendly, and to lose some cancel simplicity [I].

---

## 8. Benchmark plan to prove it

**Harness.**
- Keep the design of `scratchpad/bench/book.cpp`:
  - a deterministic generator that drives a reference book so cancels hit live orders, including a stale share;
  - a pre-generated binary command stream (32 B/cmd), so generation is out of the timed loop;
  - the same stream replayed on every candidate.
- **Correctness first:**
  - every candidate must match the fill-sequence hash, *and* the book state (best bid/ask, depth) at random probe points. This is Flash One's audit idea [F].
  - the reference is **Kichiko's PL/pgSQL engine (071)**: replay the same stream through `clob_place_order` on a local Postgres and diff fills. This extends the existing 12,500-operation differential test in the brain doc §3 to ≥10⁸ ops against the in-memory book [I].

**Scenarios** (each at ≥10⁷ ops, 10 trials, report the median and the range):

| ID | Scenario | What it stresses |
|---|---|---|
| S1 | thin binary market (≈150 resting, 12% takers) | typical Kichiko market; i-cache and branch warmth |
| S2 | normal (≈3.5k resting) | L1 → L2 transition of nodes |
| S3 | deep (≈80–100k resting) | L2 → L3 node misses, cancel cost |
| S4 | sweep (takers cross 1–40 ticks) | bitmap vs linear scan; fill emission rate |
| S5 | mint/merge-heavy (≥50% of resting orders are NO-side, so complement fills dominate) | kind-table path; share/collateral conservation checks on the output |
| S6 | many books: 100 / 1k / 10k / 50k books, uniform and Zipf(s = 1.1) routing | cold-book regime; prefetch distance D ∈ {0, 2, 4, 8, 16}; 4 KiB vs 2 MiB arenas |
| S7 | open-loop bursts at 25 / 50 / 80 / 95 / 110% of measured S2 capacity, 1–10 ms microbursts | latency vs load knee; CO-correct recording (intended send time, HdrHistogram 3 significant digits) |
| S8 | STP- and cancel-storm (95% cancels, 10% duplicates; STP on 20% of crosses) | reject paths; STP unlink correctness |
| S9 | pathological queue: 50k orders on one tick, then sweeps and random cancels; plus option B | long FIFO; list vs chunked-FIFO comparison |
| S10 | restart / replay: snapshot + journal replay of 10⁸ events | determinism (identical hashes); replay throughput |

**Metrics** (per scenario, per candidate):
1. throughput, ns/op and M ops/s;
2. per-op-type latency p50 / p90 / p99 / p99.9 / p99.99 / max, with timer overhead reported separately;
3. instructions/op, simulated D1 and LL misses/op (cachegrind with SPR-like and Zen 4-like geometries);
4. on a PMU host: IPC, top-down split, branch-misses/op, dTLB-misses/op;
5. RSS and huge-page coverage (`AnonHugePages`);
6. hash parity (pass/fail).

**Environment protocol:**
- Bare metal or a dedicated host with PMU access (e.g. a c7i/c7a/c8g metal instance) for the final numbers. This 4-vCPU KVM guest is for relative results only.
- `isolcpus=… nohz_full=… rcu_nocbs=…` (as itch-book used [F]), performance governor, SMT sibling idle, `taskset`/`numactl --membind`.
- Record CPU model, microcode, kernel, compiler and flags in every result file.

**Acceptance targets** [I]. These are for a production-like host; the VM numbers already meet them except the tails:
- S1–S4: p50 ≤ 50 ns/op; p99.9 ≤ 1 µs.
- S6 at 10k books: ≥3 M ops/s.
- S7: p99.9 ≤ 5 µs at ≤80% of capacity.
- 100% hash parity with the PL/pgSQL engine and across C++ and Rust builds.

---

## 9. What remains unverified or inferred

- Full text of arXiv 2606.01183 (Flash One), including the PIN and neighbor-aware tree internals, Tables 5 and 8, and the 41.08 M/s EPYC figure. arXiv was blocked, so only the repo README (fetched) and the abstract extract [S] were used.
- Chips and Cheese numbers are search-engine extracts [S], not full-page reads. The Agner Fog and uops.info tables were not reachable. Bit-scan latencies come from LLVM scheduling models [F], which are what compilers use but are not microbenchmarks.
- STLB sharing between 4 KiB and 2 MiB entries on Golden Cove, Zen 5 and V2 [U]. Neoverse V2 L1D size [U].
- Gross's order-book benchmark hardware is not stated on the slides [U].
- Deutsche Börse T7 per-partition ceiling (~300k/s) is second-hand, via the Flash One README [U].
- All [M] numbers come from a noisy, unisolated KVM guest on Cascade Lake without a PMU. Treat absolute values as ±15% and tails as environment-dominated. Relative comparisons (same stream, same core, repeated) are the robust part.

---

## References

Primary material fetched in full (GitHub-hosted or cloned):
1. LMAX Disruptor paper, "Disruptor: High performance alternative to bounded queues…", source `src/docs/asciidoc/en/disruptor.adoc`, https://github.com/LMAX-Exchange/disruptor. Lock/CAS cost table; throughput tables (Nehalem 2.8 GHz / Sandy Bridge 2.2 GHz / EPYC 9374F); latency table (i7-2720QM).
2. David Gross, "When Nanoseconds Matter: Ultrafast Trading Systems in C++", CppCon 2024 keynote, 19 Sep 2024. Slides: https://github.com/CppCon/CppCon2024/blob/main/Presentations/When_Nanoseconds_Matter.pdf. Video: https://www.youtube.com/watch?v=sX2nF1fW7kI. Chart values read from the embedded images (slides 30–52, 92, 103, 130).
3. Carl Cook, "When a Microsecond Is an Eternity: High Performance Trading Systems in C++", CppCon 2017. Slides: https://github.com/CppCon/CppCon2017/tree/master/Presentations/When%20a%20Microsecond%20Is%20an%20Eternity
4. Flash One Technologies, matching-engine-benchmark (README, `docs/METHODOLOGY.md`, `CONSENSUS_CONFORMING_ENGINES.md`), https://github.com/flash1-dev/matching-engine-benchmark. Companion paper: J. Yoon, "The World's Fastest Matching Engine Algorithm", arXiv:2606.01183, https://arxiv.org/abs/2606.01183. The abstract was seen only via search extracts; the paper was not fetched.
5. exchange-core README and `OrderBookDirectImpl.java`, https://github.com/exchange-core/exchange-core
6. Liquibook README, https://github.com/enewhuis/liquibook
7. CoinTossX README, https://github.com/dharmeshsing/CoinTossX. Paper: Jericevich, Sing, Gebbie, SoftwareX 2022, arXiv:2102.10925 (abstract via search extract).
8. itch-book README (Zen 5 9700X numbers and setup), https://github.com/groovg/itch-book
9. LLVM scheduling models:
   - `llvm/lib/Target/X86/X86SchedSapphireRapids.td`
   - `llvm/lib/Target/X86/X86ScheduleZnver4.td`
   - `llvm/lib/Target/AArch64/AArch64SchedNeoverseV2.td`
   - https://github.com/llvm/llvm-project
10. crossbeam `CachePadded` rationale (128 B on x86_64/aarch64), `crossbeam-utils/src/cache_padded.rs`, https://github.com/crossbeam-rs/crossbeam
11. Linux kernel docs: `Documentation/admin-guide/mm/transhuge.rst` and `hugetlbpage.rst`, https://github.com/torvalds/linux
12. G. Paoloni, "How to Benchmark Code Execution Times on Intel IA-32 and IA-64 Instruction Set Architectures", Intel, Sept 2010 (324264-001). Mirror: https://github.com/tpn/pdfs
13. Abseil Swiss tables design, https://github.com/abseil/abseil.github.io/blob/master/about/design/swisstables.md
14. martinus/robin-hood-hashing README (archived; successor `unordered_dense`), https://github.com/martinus/robin-hood-hashing
15. HdrHistogram README, https://github.com/HdrHistogram/HdrHistogram
16. wrk2 README (coordinated omission), https://github.com/giltene/wrk2. Gil Tene, "How NOT to Measure Latency" (QCon), https://www.youtube.com/watch?v=lJ8ydIuPFeU (not watched; cited for the term).
17. matklad, bounds-check-cost, https://github.com/matklad/bounds-check-cost

Search-extract only (page fetch blocked) [S]:

18. Chips and Cheese:
    - "Sapphire Rapids: Golden Cove Hits Servers", https://chipsandcheese.com/p/a-peek-at-sapphire-rapids
    - "Intel's Redwood Cove: Baby Steps are Still Steps", https://chipsandcheese.com/p/intels-redwood-cove-baby-steps-are-still-steps
    - "A Look into Intel Xeon 6's Memory Subsystem", https://chipsandcheese.com/p/a-look-into-intel-xeon-6s-memory
    - "AMD's Zen 4, Part 2", https://chipsandcheese.com/p/amds-zen-4-part-2-memory-subsystem-and-conclusion
    - "Zen 5's Leaked Slides", https://chipsandcheese.com/p/zen-5s-leaked-slides
    - "AMD's EPYC 9355P", https://chipsandcheese.com/p/amds-epyc-9355p-inside-a-32-core
    - "Evaluating Uniform Memory Access Mode on AMD's Turin", https://chipsandcheese.com/p/evaluating-uniform-memory-access
    - "Arm's Neoverse V2, in AWS's Graviton 4", https://chipsandcheese.com/p/arms-neoverse-v2-in-awss-graviton-4
19. Intel spatial prefetcher 128 B pairing (Intel Optimization Manual text as quoted), https://community.intel.com/t5/Software-Tuning-Performance/Why-behavior-of-L2-adjacent-line-prefetcher-are-different-in/td-p/1176568
20. Phoronix, "AVX-512 Performance Comparison: AMD Genoa vs. Intel Sapphire Rapids", https://www.phoronix.com/review/intel-sapphirerapids-avx512/8
21. OpenJDK JEP 377 (https://openjdk.org/jeps/377) and JEP 439 (https://openjdk.org/jeps/439)
22. rust-lang/rust issues #54878 (https://github.com/rust-lang/rust/issues/54878) and #84958 (noalias history)
23. Readyset, "How much does Rust's bounds checking actually cost?", https://readyset.io/blog/bounds-checks (blocked; not used for numbers)

Kichiko internal:

24. `docs/design/BRAIN-ARCHITECTURE-2026-09.md` §3 (PL/pgSQL 1.3 ms/order, ~500 orders/s)
25. `docs/research/brain-2026-09/03-ENGINE-ENGINEERING.md` §2, §4
26. `docs/design/CLOB-TWO-SIDED-ENGINE.md`
27. `supabase/migrations/*` (`clob_orders` schema; `071_clob_index_ordered_ladder.sql`)

Code and data produced in this session:

28. `/tmp/claude-0/-home-user-kichiko/385cc00d-340c-5f67-955a-0a985fc3ce7d/scratchpad/bench/`:
    - `book.cpp`: prototype, baseline, generator, multi-book and prefetch experiments;
    - `memlat.cpp`: pointer-chase latency;
    - `rbook/`: Rust port;
    - `cachegrind.txt`, `latency_breakdown.txt`, `rust_results.txt`, `book_O2_gcc.txt`, `memlat_*.txt`, `m4k_2.txt`, `m2m_2.txt`: raw outputs.
