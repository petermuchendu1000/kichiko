# 11: Architecture, durability and correctness of matching engines and money ledgers, and a target design for Kichiko

Research date: 2026-09-26. Track: architecture, durability and correctness at mechanism level. This report builds on and does not repeat `docs/research/brain-2026-09/03-ENGINE-ENGINEERING.md` (R03) and `docs/design/BRAIN-ARCHITECTURE-2026-09.md` (BRAIN). Where it relies on a fact that R03 fetched, it says "via R03".

## How to read this report

**Evidence labels**
- **[M-…] Measured here.** Run in this sandbox for this report. Conditions are stated with each result.
- **[G-…] Primary source fetched in full.** Source code or official documentation read from GitHub in this session (raw.githubusercontent.com).
- **[S-…] Search result only.** The primary page was **blocked by the network egress proxy** in this session. That applied to jepsen.io, tigerbeetle.com, aws.amazon.com, usenix.org, arxiv.org, martinfowler.com, aeron.io, kalshi, hyperliquid, eurex, nasdaq, cmegroup, antithesis and others; only GitHub was reachable. The claim therefore comes from the search engine's extract of that page. Treat [S] numbers as **secondary**. They are reported exactly as extracted and should be re-checked before anyone relies on them.
- **INFERENCE** marks my own reasoning or arithmetic.
- **UNVERIFIED** marks something I could not confirm.

**Kichiko facts used** (from BRAIN and R03, not re-measured here)
- The engine is PL/pgSQL `clob_place_order`: 046, with the ladder from 071.
- Each order costs about 1.3 ms of database work, which caps one market at about 500 orders/s on local NVMe.
- The database is Supabase Postgres 17 in eu-west-1, on gp3 by default ([G-SB-DISK]).
- Users are in Nairobi, about 178 ms RTT from Dublin (via R03).

---

## 0. Executive summary (the numbers that matter)

1. **The winning pattern everywhere is the same: one writer per shard, a sequenced log, and a deterministic state machine.** The venues that do this are LMAX, Aeron Cluster/Coinbase, TigerBeetle, dYdX's memclob and Hyperliquid. What differs between them is **where durability happens**:
   - TigerBeetle: an fsynced WAL on a quorum of 3 of 6 replicas, hash-chained, using O_DIRECT and io_uring [G-TB-ARCH].
   - Aeron Cluster: the log is recorded by a majority, but the archive **defaults to no fsync** (`FILE_SYNC_LEVEL_DEFAULT = 0`) [G-AERON-SRC].
   - LMAX: journaled and replicated before the business logic runs [S-LMAX].
   - For Kichiko, durability is **Postgres's WAL fsync**. That is the only durable log it has, and it should stay the only one.
2. **Measured here: application-level group commit multiplies Postgres write throughput about 20×.** The test models the full write set of applying fills to Postgres (orders, fills, 4 ledger legs, wallets, positions, outbox, fenced sequence number):
   - **Batch = 1:** about 540 orders/s, commit p50 1.65 ms.
   - **Batch = 10:** 4,144/s.
   - **Batch = 100:** 10,732/s.
   - **Batch = 500:** 14,155/s.
   - **Four shards at batch 100:** 18,894/s on 2 vCPUs.
   - Commit latency fits **C(b) ≈ 1.6 ms + 0.064 ms × b** [M-GC].
   - Batch = 1 matches the current in-DB engine's measured ~500/s. The whole gap is per-transaction fixed cost: flush, round trip and executor startup.
3. **The flush is priced per flush, not per byte.**
   - pg_test_fsync on this disk: fdatasync 275 µs for an 8 kB write. One 16 kB O_SYNC write costs 279 µs, but sixteen 1 kB O_SYNC writes cost 25.4 ms [M-FSYNC].
   - Cloud disks make this worse: gp3 is "single-digit millisecond" and io2 Block Express averages under 500 µs for 16 KiB I/O [S-EBS]. Power-loss-protected NVMe is around 20–50 µs [S-PLP].
   - So on Supabase's default gp3 disk, the current per-order transaction is probably **flush-bound at a few hundred orders/s per market** (INFERENCE), and batching is the lever.
4. **Postgres already does group commit, but only across concurrent sessions.** In `XLogFlush`, a leader holds `WALWriteLock` while followers wait on `LWLockAcquireOrWait` and find their record already flushed [G-PG-XLOG]. Measured: 16 concurrent single-order writers produced 32,000 commits with 9,593 WAL syncs, about 3.3 commits per flush [M-GC]. A per-market lock serialises commits, so this help is lost exactly where Kichiko needs it. That is why application-level batching per market shard is the right fix.
5. **Recommended target architecture: "B-lite", evolved from A with no new durable system.**
   - One lease-holding **matcher-sequencer per shard**. It keeps an in-memory book as a cache of Postgres and matches in memory.
   - It applies each **batch of commands and their results in one Postgres transaction**, fenced by `(epoch, last_seq)` compare-and-set.
   - Balances live only in Postgres. Funds are reserved at order entry inside the same batch transaction, so makers are always pre-funded.
   - Market data leaves through a transactional outbox with per-book sequence numbers.
   - Recovery is: take the lease (epoch+1), reload the live book from SQL (measured: 200k live orders in 0.40 s [M-REC]), then resume from `last_seq`. A zombie matcher's write is rejected by the fence (demonstrated [M-REC]).
6. **Budget**
   - Nairobi end to end: ≈ 178 ms WAN plus 4–15 ms server time. That is **≈ 185–195 ms p50**, against about 1 s today.
   - Per-shard throughput: 2–10k orders/s at batch 10–100. This is scaled down from [M-GC] for gp3 (INFERENCE).
   - That is 5–20× the current per-market ceiling, and far above any plausible Kichiko load.
7. **Correctness strategy (§6).** It targets the classes of bug found in Kichiko's own audits:
   - A deterministic pure matcher core.
   - A tiny reference model plus stateful property-based tests.
   - A **batch-partition invariance** property: the same command stream must give identical results for any batching.
   - Differential tests against the existing SQL engine (`diff_engine.py`).
   - Crash-point enumeration with real Postgres.
   - A Jepsen-style bank checker for money conservation.
   - A small TLA+ spec of the lease, fence and retry protocol.
   - Continuous invariant reconciliation, plus a hash-chained batch log for replay audits.
   - The relevant failure classes are well documented. ACIDRain found **22 critical attacks in 12 e-commerce apps** caused by weak isolation [S-ACIDRAIN]. Jepsen found PostgreSQL SERIALIZABLE was not serializable (G2-item) before 12.4 [S-JEPSEN-PG12], and RDS Multi-AZ clusters exhibit Long Fork [S-JEPSEN-RDS]. Coinbase lost quorum when **3 of 5** Raft nodes in one placement group went down, and trading was unavailable for about 8 hours [S-CB-PM].

---

## 1. Sequencer and single-writer architectures: how each keeps book and balances consistent and recovers

### 1.1 Why single-writer at all? The CPU-level argument

The LMAX Disruptor paper measures one 64-bit counter incremented 500 million times on a 2.4 GHz Westmere [G-DISRUPTOR]:

| Method | Time (ms) |
|---|---|
| Single thread | 300 |
| Single thread with lock | 10,000 |
| Two threads with lock | 224,000 |
| Single thread with CAS | 5,700 |
| Two threads with CAS | 30,000 |
| Single thread with volatile write | 4,700 |

**Mechanism** [G-DISRUPTOR]:
- A lock in contention means "a context switch to the operating system kernel… execution context can lose previously cached data and instructions".
- A CAS is `lock cmpxchg`, which forces the processor to "lock its instruction pipeline… and employ a memory barrier".
- Two variables written by different threads in the same 64-byte cache line suffer false sharing, which produces write contention just as if they were one variable.
- Linked lists and trees defeat the hardware prefetcher, "which can be more than 2 orders of magnitude less efficient".

The paper's conclusion is the design rule used below: "The ideal algorithm would be one with only a single thread owning all writes to a single resource."

**Disruptor versus queues** [G-DISRUPTOR]:
- Mean per-hop latency is 52 ns against 32,757 ns for `ArrayBlockingQueue`.
- 99% of hops finish under 128 ns against 2,097,152 ns.
- Conditions: three-stage pipeline, Core i7-2720QM at 2.2 GHz, Java 1.6.
- On an AMD EPYC 9374F, Disruptor 4 unicast reaches 160M ops/s against 20.9M for ABQ.

TigerBeetle states the same thesis for ledgers [G-TB-ARCH]:
- "Transfers between hot accounts inherently sequentialize the system. Trying to make transactions parallel doesn't make it faster."
- "A single core can easily scale to 1mil TPS" if the core is kept busy with useful work.

**What this means for Kichiko (INFERENCE):**
- Kichiko's per-market lock in Postgres is already a single writer. It is just a very expensive one.
- Each order runs about 20 SQL statements. Each statement goes through executor startup, snapshot acquisition, the buffer-manager hash lookup plus pin plus content LWLock, heap tuple formation, WAL record assembly with CRC32C ([G-PG-XLOGREC]: `xl_crc` is a `pg_crc32c`), and B-tree descents that miss cache.
- 1.1–1.3 ms is about 3–3.6 M cycles at 2.8 GHz. That is 10³–10⁴ times what an array-ladder match costs.
- The measured marginal cost of a set-based batched write is **~64 µs per order**, or about 6 µs per row write [M-GC]. That confirms most of the per-order cost is per-row and per-statement database machinery, not matching logic.

### 1.2 LMAX (journal before logic, replication, snapshots)

**Structure** [S-LMAX], and via R03 from Fowler's article:
- An input Disruptor whose consumers are a **journaler**, a **replicator** and an **un-marshaller**.
- The Business Logic Processor (BLP) consumes an event only after it has been journaled and replicated: "Business logic can only progress on an event that was first journalled, un-marshaled and replicated".
- The BLP is single-threaded and event-sourced: "you can always recreate the current state by replaying the events".
- Throughput is 6M orders/s on one JVM thread (3 GHz dual-socket quad-core Nehalem).
- Snapshots are taken nightly, and a full restart takes under a minute (via R03).

**How consistency holds.** Book and balances live in the same BLP memory and are mutated by the same thread, so they cannot diverge. Durability comes from the journal plus replication, both done *before* processing.

**Recovery.** Load the snapshot and replay the journal. The replicas are hot BLPs fed the same input.

### 1.3 Aeron Cluster (Raft, archive, snapshots)

From the Aeron Cluster README [G-AERON-CL]:
- "The leader sequences the log and is responsible for replicating the log to other cluster members."
- "Aeron Archive records the log to durable storage. **Services consume the log once a majority of the cluster members have safely recorded the log**."
- "Snapshots enable recovery by loading the most recent snapshot and replaying logs from that point forward."
- Recommended cluster sizes are 3 or 5 members.

**Mechanism details from source** [G-AERON-SRC]:
- `Archive.Configuration.FILE_SYNC_LEVEL_DEFAULT = 0`. Level 0 is "normal writes to the OS page cache". Level 1 forces data, and level 2 forces data and metadata [G-AERON-WIKI-ARCHIVE].
  - INFERENCE: by default, "safely recorded" means held in a majority's page cache, **not fsynced**. A correlated power loss across a majority can lose acknowledged commands unless file sync is raised, which adds fsync latency to every log write.
- `ConsensusModule` defaults:
  - leader heartbeat interval 200 ms;
  - **leader heartbeat timeout 10 s**;
  - election timeout 1 s;
  - session timeout 10 s.
  - INFERENCE: with defaults, detecting a dead leader takes about 10 s before election starts.

**Published latency** [S-AERON-AWS]: Aeron Cluster (open source) round trip p50/p99 95/136 µs at 100k msg/s, single-AZ, c6in.16xlarge. Across a partition placement group, p99.9 was 3,428 µs (Aeron Premium: 2,109 µs), for 288-byte messages at 100k msg/s. UNVERIFIED beyond the search extract.

### 1.4 Coinbase (Raft cluster in one placement group, and its failure)

Via R03, from the re:Invent 2023 FSI309 slides:
- One leader and multiple followers. A majority is required before processing.
- "same code with same input", "single-threaded and deterministic".
- Aeron UDP with SBE encoding.
- p99 internal round trip under 1 ms. About 80% of that is networking over 10 hops.
- Core systems built for 100k msg/s.

Talk [S-CB-TALK]: Frank Yu, QCon SF 2025, "How to Build an Exchange". Determinism enables "zero-downtime rolling deployments and the ability to replay production logs for perfect bug reproduction".

**Failure: the May 7, 2026 postmortem** [S-CB-PM]:
- A chiller failure in one us-east-1 data hall (use1-az4) took down EC2 and EBS in that building.
- The matching engine runs "as a Raft-based replicated cluster inside an AWS Cluster Placement Group". It **lost quorum when 3 of 5 nodes went offline**.
- Trading and money movement were unavailable or degraded for about 8 h, and full recovery took another 12 h. Recovery was also slowed by a "silent failure in AWS's managed Kafka".

**Lesson (INFERENCE).** Latency-driven co-location concentrates failure domains. A Raft cluster tolerates independent faults, not correlated ones. Kichiko already has one failure domain, a single Supabase primary. It should not add a second, differently-shaped one without a reason.

### 1.5 Nasdaq INET, CME Globex, Eurex T7 (published latency figures)

All of these figures are search extracts. The vendor PDFs were blocked.

| Venue | Figure | Conditions | Source |
|---|---|---|---|
| Nasdaq OMX X-stream INET at SIX | Mean round trip 37 µs; 99% < 78 µs; 99.9% < 150 µs | OUCH over 10 GbE, measured at the exchange network boundary | [S-NASDAQ] |
| CME Globex | Median inbound 52 µs from router to match engine; "variability 39 µs" | First phase of a Globex performance release; date unclear | [S-CME]; weak, secondary press |
| Eurex T7 | Fastest participant reaction ≈ 2.79 µs between market data and order measurement points; LF gateway about 12 µs slower than PS gateways | "Insights into Trading System Dynamics", March 2025 | [S-EUREX] |

**Takeaway (INFERENCE).** These engines run at 10–100 µs because they avoid synchronous storage entirely on the order path. Durability comes from replicated in-memory sequencing and hardware fault tolerance, not per-order fsync to cloud block storage. Kichiko's users see 178 ms of WAN, so matching even at 1 ms is below 1% of what they experience.

### 1.6 Hyperliquid (book as consensus state)

[S-HL]:
- A fully on-chain CLOB per asset in HyperCore, ordered by HyperBFT.
- End to end for a co-located client: **median 0.2 s, p99 0.9 s**. About **200,000 orders/s**.
- Via R03: within a block, the deterministic order is non-order actions, then cancels, then GTC/IOC orders.

**Consistency.** The book and the balances are both replicated state machine state. Every validator executes the same block deterministically.

**Recovery.** Replay or state sync of blocks. The mechanism details are UNVERIFIED because the docs were blocked.

**Lesson (INFERENCE).** Batching with a deterministic within-batch rule is legitimate. But reordering inside a batch (cancels first) changes outcomes compared with pure arrival order. Kichiko should choose arrival order and make batch boundaries invisible (§6.3).

### 1.7 Kalshi (engine sharding and per-shard collateral)

[S-KAL], plus R03:
- There are several exchange shards: 0 is the default, 1 exotics, 2 crypto and commodities, 3 some sports. "All child markets of an event" live on the same shard.
- "Programmatic traders must preallocate collateral on a given exchange shard."
- With opt-in auto-rebalancing, "every 10 seconds" Kalshi computes each shard balance (account balance minus resting-order value) and makes an intra-exchange transfer to restore the target allocation.

INFERENCE: this means each shard engine holds its own authoritative balance. Kalshi accepted a user-visible cost (fragmented collateral) to avoid cross-shard balance coordination. Kichiko can avoid that cost because Postgres row locks can serialise the rare cross-shard wallet touch (§5.4).

### 1.8 dYdX v4 (off-chain book in validator memory)

[G-DYDX]:
- `MemClobPriceTimePriority` keeps `orderbooks map[ClobPairId]*Orderbook` plus `operationsToPropose`: the matches the block proposer will put into its block.
- Constants: `ShortBlockWindow uint32 = 40`. Short-term orders expire within 40 blocks. `StatefulOrderTimeWindow = 95 * 24 * time.Hour`.
- On restart, `InitStatefulOrders` is "called during app initialization in `app.go`, before any ABCI calls are received and after all MemClob orderbooks are instantiated". It re-inserts long-term orders from chain state in time priority.
- INFERENCE from the code structure and [S-DYDX-DOCS]: short-term orders live only in memory and gossip, and are lost on a validator restart by design. They are bounded by the 40-block window.
- Consistency of balances: subaccount balances are consensus state, and matches only take effect when included in a block and executed by every validator.

**Lesson.** The book can be a *rebuildable cache* as long as the thing that moves money (the block, or for Kichiko the Postgres commit) is the single point of truth. That is the model proposed for Kichiko in §5.

### 1.9 TigerBeetle (a ledger built like an exchange core)

Everything here comes from source and docs fetched from GitHub [G-TB-*].

**Replicated state machine.**
- "The ground state of the system is an immutable, hash-chained, append-only log of prepares. Each prepare is a batch of 8 thousand individual transfer objects."
- The primary assigns an op number and timestamp, "appends the prepare to the WAL… adding a checksum 'pointer' to the previous log entry", and replicates.
- It commits on a replication quorum. With 6 replicas the replication quorum is 3 and the view-change quorum is 4 (flexible quorums) [G-TB-VSR].

**Two-phase execution.**
- Prefetch: all IO, in parallel.
- Commit: "synchronous… decides in a single tight CPU loop per transfer… the `commit` function itself doesn't do any reading from storage. This is the key to performance."

**Static allocation.** "For every 'object type'… computes the worst-case upper bound… allocates exactly that number… After startup, no new objects are created." Backpressure emerges from limits, with no explicit code for it [G-TB-ARCH].

**WAL layout.**
- Two on-disk rings, `wal_headers` and `wal_prepares`. The `journal_slot_count` default is 1,024.
- Prepare slots are padded to `message_size_max` = 1 MiB. The sector size is 4,096.
- "In each ring, the `op` for reserved headers is set to the corresponding slot index. This helps WAL recovery detect misdirected reads/writes."
- A comptime assert ensures the replica "doesn't write all redundant headers simultaneously… a crash could lead to a series of torn writes making the entire journal faulty" [G-TB-JOURNAL].
- Recovery uses a 16-row decision table (`recovery_cases`, @A…@P) over header and prepare validity, checksum match, op ordering and view. Decisions are `vsr` (repair via consensus), `fix`, `cut` (truncate) or `nil`, plus a special `@TruncateTorn` case for prepares torn mid-append. At most `journal_iops_write_max` (32) torn slots are considered [G-TB-JOURNAL], [G-TB-CONFIG].

**Checksums.** AEGIS-128L used as a MAC with a zero key, i.e. a checksum. It is hardware accelerated through AES-NI (`vaesenc`), and is used for disk bitrot, network message validation and hash-chaining [G-TB-CKSUM].

**Hash-chaining.**
- Block pointers are `(u64 address, u128 checksum)`. Checksums are stored *outside* the block, which "protect[s] from misdirected IO".
- The superblock is kept in 4 copies. On startup the replica picks the latest version with at least 2 copies, because a misdirected read could hide the sole latest copy.
- Each client request carries the checksum of the previous reply [G-TB-ARCH], [G-TB-DATAFILE].

**Checkpoints and log compaction.**
- Grid blocks are copy-on-write. The superblock atomically swaps the root, and the WAL holds the diff since the checkpoint.
- Batching levels: 32 prepares aggregated before disk writes (`lsm_compaction_ops = 32`), and roughly 1,024 prepares per checkpoint.
- From the constants: `vsr_checkpoint_ops = journal_slot_count − lsm_compaction_ops − lsm_compaction_ops × ⌈2·pipeline_prepare_queue_max / lsm_compaction_ops⌉` = 1024 − 32 − 32·⌈16/32⌉ = **960** (INFERENCE: arithmetic on [G-TB-CONST] and [G-TB-CONFIG] defaults).
- After a crash: "reads the previous checkpoint/superblock… replaying the suffix of the log… Determinism guarantees that the replica ends up in the exact same state."

**Direct I/O and io_uring.**
- "Bypassing page cache is required for correctness… `fsync`… doesn't allow handling errors reliably", citing Rebello et al.
- io_uring is used "exclusively for IO".

**Integration with an OLGP database** [G-TB-SYSARCH], [G-TB-RTS]:
- TigerBeetle sits in the data plane and Postgres in the control plane.
- "initiating a transfer should not require fetching metadata from the general purpose database."
- The **client generates and persists the id before submitting**. Retries return `exists`, which gives end-to-end idempotency.
- The "Write Last, Read First" rule is referenced but the blog post was blocked (UNVERIFIED detail).

**Independent testing.** Jepsen tested TigerBeetle 0.16.11 through 0.16.30 [S-JEPSEN-TB]:
- Two safety issues: multi-filter queries omitted results before 0.16.17, plus a debug-API timestamp bug.
- Seven crashes, "many… an assertion which turned what would have been a safety hazard into a simple crash".
- From 0.16.26, results were consistent with strong serializability under pauses, crashes, partitions, clock errors, disk corruption and upgrades.

### 1.10 Summary table

| System | Sequencer / writer | Durability point before ack | Book and balance consistency | Recovery |
|---|---|---|---|---|
| LMAX | 1 BLP thread | Journal + replication, then logic | Same thread, same memory | Nightly snapshot + replay, under 1 min (via R03) |
| Aeron Cluster / Coinbase | Raft leader, deterministic services | Majority recorded; **page cache by default** [G-AERON-SRC] | Same replicated service | Snapshot + log replay; election after a 10 s default heartbeat timeout |
| TigerBeetle | Primary, single core | WAL fsync (O_DIRECT) on a quorum of 3 of 6 | Single state machine | Checkpoint + WAL suffix replay; peer repair of corrupt blocks |
| dYdX v4 | Block proposer | Block commit (consensus) | Balances in state; book in memory | Stateful orders re-inserted from state; short-term orders dropped |
| Hyperliquid | HyperBFT | Block commit | Both in consensus state | Replay / state sync (UNVERIFIED) |
| Kalshi | Per-shard engine | UNVERIFIED | Per-shard collateral | UNVERIFIED |
| **Kichiko today** | Per-market row lock in PL/pgSQL | Postgres WAL fsync per order | One ACID transaction | Postgres crash recovery |
| **Kichiko target** | Per-shard matcher with a lease | Postgres WAL fsync per **batch** | One ACID transaction per batch | Reload book from SQL + resume from `last_seq` |

---

## 2. Durability mechanics

### 2.1 What a commit costs, and why batching works (measured)

**[M-FSYNC] conditions**
- `pg_test_fsync -s 3` (PostgreSQL 16 binary) on this sandbox's root filesystem: ext4 on `/dev/vda`, a virtio disk in a Firecracker VM (kernel 6.18).
- The disk reports `write_cache = write back`. Whether the host honours flushes all the way to stable media is **UNVERIFIED**, so treat these as a fast-disk lower bound, not production numbers.

| Test | Result |
|---|---|
| fdatasync, one 8 kB write | 3,639 ops/s, **275 µs/op** |
| open_datasync (O_DIRECT supported), one 8 kB write | 314 µs |
| fsync, one 8 kB write | 288 µs |
| 1 × 16 kB open_sync | 279 µs |
| 2 × 8 kB open_sync | 536 µs |
| 16 × 1 kB open_sync | **25,447 µs** |
| Non-synced 8 kB write | ~0 µs (2.5M ops/s) |

**Mechanism (INFERENCE, consistent with the data).** A synchronous write costs a device FLUSH/FUA round trip regardless of payload up to tens of kB. Sixteen syncs cost about 16 times one sync, and 91× more than one 16 kB sync. Any design that turns N commits into one flush gains up to N× throughput until CPU or bandwidth binds. This is TigerBeetle's "batching, batching, batching" [G-TB-PERF] and Postgres's `commit_delay` rationale [G-PG-WALDOC].

**Device classes (secondary):**
- EBS gp3: "single-digit millisecond latency… 99% of the time". io2 Block Express: "average latency of under 500 microseconds for 16KiB I/O", with over 10× fewer I/Os above 800 µs than General Purpose volumes [S-EBS].
- Durability: gp3 has an AFR of at most 0.2%; io2 BX is at most 0.001% [S-EBS-DUR].
- A power-loss-protected enterprise NVMe (Samsung PM9A3) shows "20–50 microseconds" write latency. SSDs without PLP show "fsync… typically 1–4ms" [S-PLP]. Mark Callaghan's Jan 2026 Small Datum post compares a Samsung 990 Pro (no PLP) with a PM-9a3 (PLP) [S-PLP]; its exact numbers were not retrievable.
- A gp2 search extract reports fsync latency around 4 ms without a queue [S-GP2]. This is a weak source.
- Supabase: "The default disk type is gp3… baseline… 3,000 IOPS"; io2 is optional [G-SB-DISK].

INFERENCE: on Supabase gp3, each Kichiko commit probably pays 1–4 ms of flush. That is 2–8× the 275 µs measured here, which is why the per-market ceiling on production disks is likely below the 500/s measured on local NVMe.

### 2.2 Postgres group commit, mechanism and measured effect

**Mechanism** [G-PG-XLOG], REL_17 `XLogFlush`. A committing backend loops:
1. If its record is already flushed (`record <= LogwrtResult.Flush`), it is done. Some other backend flushed it.
2. Otherwise it calls `WaitXLogInsertionsToFinish` and then `LWLockAcquireOrWait(WALWriteLock)`. "If we can't get it immediately, wait until it's released, and recheck if we still need to do the flush or if the backend that held the lock did it for us already."
3. The lock holder optionally sleeps `commit_delay` if at least `commit_siblings` other backends are active. It then calls `XLogWrite` up to the latest *inserted* position, flushing everyone's commit records together.

The docs recommend starting `commit_delay` at "half of the average time [pg_test_fsync] reports it takes to flush after a single 8kB write" [G-PG-WALDOC].

**Why Kichiko cannot benefit from this today (INFERENCE).** Group commit needs *concurrent* committers. Kichiko serialises each market on one lock, so within a market there is never a second committer to share a flush. Across markets it helps, but only up to CPU.

**[M-GC] conditions**
- A private throwaway container `supabase/postgres:17.6.1.011` (PostgreSQL 17.6), `--cpus=2`, with default config: `synchronous_commit=on`, `wal_sync_method=fdatasync`, `full_page_writes=on`, `shared_buffers=128MB`.
- The client is Python/psycopg2 over localhost TCP.
- Other agents' containers were running on the same 4-vCPU host, so there is noise.
- Workload per order, applied set-based by a PL/pgSQL `apply_batch`:
  - insert a taker order;
  - update a maker order (random among 200k);
  - insert a fill;
  - insert 4 ledger legs;
  - aggregate and update wallets (random among 10k);
  - upsert 2 positions;
  - 1 outbox row per batch;
  - a fenced CAS on `(shard, epoch, last_seq)`.
- `CHECKPOINT` before each run. Script: `scratchpad/bench/groupcommit_bench.py`.

| Batch (orders/commit) | Writers | sync | Orders/s | Commit p50 / p99 (ms) | µs/order | WAL bytes/order | FPI/order |
|---|---|---|---|---|---|---|---|
| 1 | 1 | on | 523 / 559 (2 runs) | 1.69 / 5.27 | 1,790–1,913 | 7,413 | 0.79 |
| 1 | 1 | off | 798 | 1.15 / 2.71 | 1,254 | 7,412 | 0.79 |
| 10 | 1 | on | 4,144 | 2.15 / 5.45 | 241 | 3,453 | 0.19 |
| 50 | 1 | on | 8,193 | 5.36 / 12.1 | 122 | 2,711 | 0.07 |
| 100 | 1 | on | 10,732 | 8.62 / 14.9 | 93 | 2,462 | 0.04 |
| 500 | 1 | on | 14,155 | 33.3 / 54.6 | 71 | 2,343 | 0.03 |
| 1,000 | 1 | on | 12,217 | 64.0 / 193.7 | 82 | – | – |
| 1,000 | 1 | off | 15,515 | 60.5 / 93.1 | 64 | – | – |
| 1 | 4 | on | 1,178 | 2.88 / 9.65 | – | 4,580 | 0.31 |
| 1 | 16 | on | 1,495 | 9.78 / 26.9 | – | 3,358 | 0.12 |
| 100 | 4 | on | **18,894** | 19.1 / 48.2 | – | 2,327 | 0.02 |

The batch-1000 rows come from the first run, which had no WAL accounting.

**Readings**
1. **Batch 1 ≈ today's engine.** 523–559/s with p50 1.65 ms matches the measured 508/s and p50 1.31 ms for 071. This is a good calibration: the in-DB engine is bounded by per-transaction fixed cost.
2. **The fixed per-commit cost is ≈ 1.5 ms.** Of that, about 0.5 ms is the synchronous flush (sync on minus sync off). The rest is round trip, function call, executor startup and fixed statements. Linear fit: **C(b) ≈ 1.6 ms + 0.064 ms·b**. Check: b=100 gives 8.0 against 8.6 measured, and b=500 gives 33.6 against 33.3.
3. **Batch 10 buys 7.7×. Batch 100 buys 20×.** Beyond about 500 the batch is CPU-bound (≈ 64–71 µs/order marginal), and `synchronous_commit=off` adds only about 27% at batch 1,000.
4. **Built-in group commit is visible but CPU-capped.**
   - 16 writers at batch 1: 32,000 commits and 9,593 WAL syncs, about 3.3 commits per flush.
   - 4 writers: 12,000 commits and 9,158 syncs, 1.3 per flush.
   - Throughput still only reached about 1.5k/s on 2 vCPUs.
5. **WAL per order falls from 7.4 kB to 2.3 kB.** Part of this is full-page images: after a checkpoint, the first modification of each 8 kB page logs the whole page. The batch-1 runs were short (4k orders just after a checkpoint), so their FPI rate (0.79/order) is **confounded by run length**. Longer runs amortise first-touch FPIs. Do not read the whole WAL reduction as a batching effect.

**Projection to Supabase gp3 (INFERENCE).**
- Assume flush ≈ 1–3 ms instead of 0.5 ms. Then C(b) ≈ 2.5–4.5 ms + 0.064·b ms.
- Batch 10: ≈ 3–5 ms per commit, so **2–3k orders/s per shard**.
- Batch 100: ≈ 9–11 ms, so **~9–11k/s per shard** if CPU keeps up.
- Batch 1, today's model: ≈ 250–400/s per market.
- Measure on the real tier before relying on this (§7).

### 2.3 fsync failure semantics, O_DIRECT and Postgres

**Rebello et al., USENIX ATC 2020** [S-REBELLO]:
- Tested ext4, XFS and Btrfs against PostgreSQL, LMDB, LevelDB, SQLite and Redis.
- "pages are always marked clean after fsync failures", and "none [of the applications' strategies] are sufficient: fsync failures can cause catastrophic outcomes such as data loss and corruption".
- TigerBeetle cites this as the reason it uses O_DIRECT [G-TB-ARCH].

**Postgres's answer** [G-PG-CONFIG18]:
- `data_sync_retry` defaults to `off`, which will "raise a PANIC-level error on failure to flush modified data files… the only way to avoid data loss is to recover from the WAL after any failure is reported".
- WAL records carry `xl_prev` (a back pointer) and a CRC32C (`xl_crc`) [G-PG-XLOGREC].
- INFERENCE: that is a *pointer chain with per-record CRC*, not a cryptographic hash chain. It detects torn and corrupt records but not misdirected writes that carry a valid CRC. Torn data pages are covered by `full_page_writes` (the FPI cost measured above).

**Kichiko cannot control this layer.** Supabase manages Postgres. What Kichiko *can* control:
- keep `synchronous_commit=on` for every money transaction;
- acknowledge a fill to users only after COMMIT returns;
- keep PITR on. Supabase archives WAL "at two-minute intervals… in the worst case scenario, PITR achieves a Recovery Point Objective (RPO) of two minutes" [G-SB-BACKUP]. Without PITR, daily backups mean up to about 24 h of loss.

### 2.4 io_uring, O_DIRECT, SQPOLL, registered buffers (for completeness, if Kichiko ever builds C)

- TigerBeetle: io_uring "combines batching and concurrency… the only reasonable way to have truly asynchronous disk io on Linux". Resumption contexts are statically allocated per component and threaded on an intrusive list, so there is no heap per I/O [G-TB-ARCH].
- Reported numbers (secondary):
  - io_uring paper: **1.7M 4k IOPS in polled mode** on the author's reference machine [S-AXBOE].
  - Haas & Leis (VLDB 2023, p2090): multiple NVMe devices give ≥10M IOPS, but storage engines reach only a fraction, and CPU per I/O becomes the bottleneck [S-HAAS].
  - arXiv 2512.04859 (2025): single-thread gains of +21% with completion polling (IOPOLL, 376k tx/s), **+32% with SQPOLL** (≈546k tx/s, dedicating a core), +20% with NVMe passthrough, and about 11% from registered-buffer zero-copy [S-IOURING-DB].
- SQPOLL mechanism: a kernel thread polls the submission ring, so the application submits without calling `io_uring_enter`. Registered files and buffers remove per-I/O `fget` and page-pinning cost.
- Security: io_uring was disabled for untrusted workloads after exploits, per Google kCTF. TigerBeetle argues its trusted, fixed-size integer data makes this acceptable [G-TB-SAFETY].
- Postgres 18 adds `io_method = worker | io_uring | sync` (default `worker`) [G-PG-CONFIG18]. The AIO README names WAL `fdatasync()`/O_DSYNC asynchrony as a motivation [G-PG-AIO]. Whether PG 18 already issues WAL writes asynchronously is UNVERIFIED. **None of this is available on Supabase PG 17.** INFERENCE: io_uring is irrelevant to Kichiko unless it builds architecture C.
- A contemporary open-source reference: Melin (Rust, io_uring, LMAX-style) [G-MELIN]. These are vendor-published and not independently verified.
  - Default ack policy: "one fsynced copy plus a second copy in another node's memory".
  - p99 245 µs at 1M events/s over kernel TCP, 40 µs with DPDK.
  - A single closed-loop event: p50 38 µs / p99 62 µs, including persistence.
  - Hardware: EPYC 9275F, Micron 7450 PRO NVMe **with PLP**, 100 GbE, measured Aug 2026.
  - This shows what a PLP NVMe flush plus replication costs when done right: tens of µs, against 1–4 ms on gp3.

### 2.5 Snapshotting and log compaction

- **Raft:** "the entire current system state is written to a snapshot on stable storage, then the entire log up to that point is discarded". A lagging follower is caught up by `InstallSnapshot` [S-RAFT].
- **Aeron:** the service and consensus module snapshot at a log position, and the Archive stores snapshots for local and remote replay [G-AERON-CL].
- **TigerBeetle:** copy-on-write grid with a checkpoint every ~960 ops; WAL slots are only overwritten after checkpoint [G-TB-VSR], [G-TB-CONST].
- **LMAX:** nightly (via R03).
- **Kichiko target (INFERENCE):**
  - Postgres *is* the snapshot. The live book is `clob_orders WHERE status IN (open, partially_filled)`, which can be reloaded in about 0.4 s for 200k orders [M-REC].
  - The command/batch log is kept in the same database for audit and replay tests, partitioned by day, and detached or archived after reconciliation. That is log compaction without any snapshot file.

---

## 3. Correctness: testing and formal methods, with evidence

### 3.1 Deterministic simulation testing (DST)

**FoundationDB** [G-FDB-TEST]:
- "deterministic simulation of an entire FoundationDB cluster within a single-threaded process… perfect repeatability".
- "tens of thousands of simulations every night", an estimated "one trillion CPU-hours" equivalent, and a "10-1 factor of real-to-simulated time".
- A **cycle test**: a ring of keys whose integrity must survive concurrent transactions, which is a direct analogue of conservation invariants.
- "swizzle-clogging": stop the network links of a random node subset one by one, then restore them in random order.

**TigerBeetle VOPR** [G-TB-VOPR], [G-TB-SAFETY]:
- Clock, network and disk are stubbed and seeded. Faults include drop, reorder, partition and read/write corruption.
- "One minute of VOPR time is equivalent to days of real-world testing."
- It runs "24/7 on 1024 cores".
- Assertions stay on in production: "far better to stop operating than to continue operating in an incorrect state".
- Checkers verify that replicas' data files are byte-for-byte identical.
- The TigerBeetle team's caution [G-TB-ARCH]: TLA+ is "invaluable to debug an algorithm", but "of little help if you want to check if your code implements the algorithm correctly".

**Antithesis** [S-ANTITHESIS]:
- A deterministic hypervisor that controls thread scheduling, network and clocks, with checkpoint-and-branch exploration.
- MongoDB reports "100+ critical bugs" over 4 years, and a replication bug seen once in years of stress testing that Antithesis reproduced "in about 24 hours". These are vendor case-study claims.

### 3.2 Model checking and TLA+

**AWS** [S-AWS-TLA]:
- In DynamoDB replication, the model checker found a data-loss bug whose "shortest error trace… included 35 high-level steps". It had passed design review, code review and testing.
- Seven teams were using TLA+ at the time, and it was also applied to S3, EBS and a lock manager.

**Public matching-engine specs.**
- Searches found only hobby projects claiming TLA+-verified matching cores, e.g. "171M distinct states" [S-TLA-OB]. I found **no production exchange's public TLA+ spec** (UNVERIFIED that none exists).
- INFERENCE, consistent with TigerBeetle's caution: use TLA+ for the **protocol** (lease, fencing, batch commit, client retry, outbox), where interleavings are the risk. Use property-based and differential tests for the **matching function**, where the risk is arithmetic and priority bugs.

### 3.3 Property-based and model-based testing

- John Hughes, "Experiences with QuickCheck": translating 3,000+ pages of AUTOSAR specifications into models "resulted in over 200 issues raised" for Volvo, and race detection found the dets/Mnesia bug that affected Klarna [S-HUGHES].
- Stateful PBT with shrinking reduces a failing 100-operation sequence to a minimal subsequence (via R03, Hypothesis).
- An order-book QE project applying differential testing against a reference engine found that "partial fills could permanently strand trader funds due to escrow fee rounding" [S-OBQE]. That is the same class as Kichiko's R2 (rounding and clamps).

### 3.4 Jepsen findings relevant to money systems

- **Bank workload.** Accounts with random transfers. The total must be conserved and no account may go negative. It detects read skew and lost updates [S-JEPSEN-BANK]. It is the right shape for Kichiko's invariant I2.
- **PostgreSQL 12.3.** SERIALIZABLE allowed **G2-item**. "present since… 9.1", involving concurrent inserts and updates where the updater aborts. Fixed in 12.4 (Aug 2020) [S-JEPSEN-PG12].
- **Amazon RDS for PostgreSQL 13.15–17.4 Multi-AZ clusters.** They exhibit **Long Fork** at Repeatable Read, which violates snapshot isolation. That behaviour is consistent with Parallel SI [S-JEPSEN-RDS]. INFERENCE for Kichiko: never make money decisions from reads on a replica or reader endpoint. Keep all money reads and writes on the primary inside the writing transaction.
- **TigerBeetle 0.16.x.** See §1.9 [S-JEPSEN-TB].

### 3.5 ACIDRain: the application-level failure class

- 12 self-hosted e-commerce applications, deployed on over 2M sites, yielded **22 critical attacks**: over-spending gift cards, corrupting inventory, stealing goods. One such attack "bankrupted a popular Bitcoin exchange" [S-ACIDRAIN].
- Cause: weak isolation plus check-then-act without locks.
- INFERENCE: Kichiko's audits found the same shape. Examples:
  - R1: `reconcile_wallet_reservations` "writes without locks".
  - A-W4: `admin_adjust_balance` bypass.
  - A-P3: an IPN that credits a different deposit.
- The target design removes check-then-act from the matching path, because the single writer checks and writes in one transaction. The test plan must still attack every other money path concurrently (§6.6).

### 3.6 Formal invariants for complementary (YES/NO) books

**Sources for the matching semantics:**
- Gnosis CTF `splitPosition` / `mergePositions` [G-CTF].
- Polymarket CTF Exchange [G-PM-CTFX]:
  - `_deriveMatchType`: BUY/BUY → **MINT**, SELL/SELL → **MERGE**, otherwise **COMPLEMENTARY**.
  - `_isCrossing`: bid/bid crosses iff `priceA + priceB >= ONE`; ask/ask crosses iff `priceA + priceB <= ONE`; bid/ask crosses iff `bid >= ask`.
- Kichiko's 071 normalisation: `yes_px = price` for YES orders and `100 − price` for NO orders. `book_side = 'bid'` iff (buy AND yes) OR (sell AND no).

**Integer domain.** Prices are integer ticks `t ∈ {1..999}` (tenths of a cent), and one complete pair = 1000 ticks of collateral. Quantities are integer shares. Cash is integer minor units scaled so that price × quantity is exact. INFERENCE: this removes R2-class rounding entirely.

For each option o (a binary market has one; a multi-outcome event has one per outcome, plus the negRisk relation), the invariants are:

| # | Invariant | Formal statement |
|---|---|---|
| C1 | Share conservation | Σ_u YES_u(o) + escrowed YES in resting sells = Σ_u NO_u(o) + escrowed NO = P(o), where P = outstanding pairs |
| C2 | Collateral | Collateral(o) = 1000·P(o) ticks, exactly |
| C3 | Match-type accounting | MINT: P += q and cash in = (y + (1000 − y))·q = 1000q. MERGE: P −= q and cash out = 1000q. COMPLEMENTARY: P unchanged and cash moves buyer → seller. Every fill's ledger legs sum to 0 |
| C4 | No cross at rest | After every command, max{yes_px of bids} < min{yes_px of asks} on the unified ladder. Equivalently, for resting orders, best YES bid + best NO bid < 1000 and best YES ask + best NO ask > 1000 |
| C5 | Limit respected | Every fill for a taker buy has yes_px ≤ taker limit (in YES terms); for a sell, ≥ |
| C6 | Maker price | Fill price = the maker's resting price (price-time convention) |
| C7 | Price-time priority | If a fill executes against maker m, then every opposite-side maker m′ with better yes_px, or equal yes_px and smaller `seq`, that was resting when the taker arrived is fully filled, unless excluded by a stated rule (self-trade prevention) |
| C8 | Escrow exactness | reserved_cash_u = Σ over u's open buys of remaining × limit + withdrawal holds; reserved_shares_u(o, side) = Σ over open sells of remaining |
| C9 | Non-negativity | available, reserved, positions and remaining ≥ 0 |
| C10 | Settlement | On resolution: Σ payouts = 1000·P(o) ticks to winners, collateral → 0, open orders cancelled with escrow released |
| C11 | Cash conservation (global) | Σ user cash + Σ reserved + Σ collateral + fees = deposits − withdrawals (BRAIN I2) |
| C12 | Determinism | state_hash(replay(snapshot_k, log_{k+1..n})) = state_hash_n |
| C13 | Batch-partition invariance | For any partition of a command stream into batches, the event stream and final state are identical (§6.3) |

For multi-outcome negRisk (INFERENCE, see BRAIN §5 row 3): NO on outcome i ≡ YES on all j ≠ i. The conversion must conserve Σ collateral across the event, and C1 and C2 must hold per outcome after conversion.

---

## 4. Integration patterns with Postgres as the system of record

### 4.1 Transactional outbox and idempotent consumers

- **Outbox:** write the event row in the same transaction as the state change. A relay publishes it. Delivery is at least once, so "consumers must be idempotent" (via R03, microservices.io).
- **Debezium:** "An outbox pattern implementation avoids inconsistencies between a service's internal state… and state in events consumed by services". Its event router exposes an id "to remove duplicate messages" [G-DBZ-OUTBOX].
- **For Kichiko:**
  - Each batch transaction inserts one outbox row per affected book, with `(market, book_seq_from, book_seq_to, deltas)`.
  - A relay reads outbox rows in `id` order and calls Realtime Broadcast. That can be Supabase `realtime.send()`, which is itself WAL-delivered (via R03), or a tiny Node relay.
  - Clients apply deltas only if `seq = last + 1`; otherwise they re-snapshot. Duplicate deliveries are harmless.
  - Do not use `pg_net` (lost on crash) or `NOTIFY` in the hot transaction, which takes a global lock at commit (both via R03).

### 4.2 Exactly-once fill application

"Exactly once" is at-least-once delivery plus an idempotent effect:
1. The **client** generates `client_order_id` and persists it before sending. This is TigerBeetle's rule [G-TB-RTS].
2. `UNIQUE (user_id, client_order_id)` on commands/orders. This fixes E4.
3. The matcher assigns `seq` per shard. Fills get `fill_id = (shard, seq, k)` with a UNIQUE constraint, and ledger legs get `UNIQUE (fill_id, leg)`. The benchmark schema used exactly this [M-GC].
4. The batch transaction's fenced CAS `UPDATE shard SET last_seq = new WHERE shard = s AND epoch = e AND last_seq = prev` is the **single idempotency point** for the whole batch. A replayed or duplicated batch fails the CAS and writes nothing.

### 4.3 Batching many orders per transaction (application-level group commit)

Measured in §2.2. Other published figures:
- **DBOS:** 144K single-row-insert transactions/s on RDS `db.m7i.24xlarge` (96 vCPU, io2 at 120K IOPS), with each row its own transaction from many concurrent clients [S-DBOS]. That relies on Postgres's built-in group commit across many sessions; the bottleneck they found is not in the extract.
- **CYBERTEC:** `commit_delay` raised pgbench simple-update from 1,576 to 2,738 TPS on throttled NVMe (via R03).
- **Modern Treasury:** 1,200 tx/s, and hot accounts go through a batching queue (via R03).

**The self-clocking batch rule (INFERENCE).** Do not batch on a timer. Batch "whatever arrived while the previous commit was in flight":
- With commit time C(b) = F + m·b and arrival rate λ, steady state is b = λ·C(b), so **b = λF / (1 − λm)**, and latency ≈ C(b) plus up to one C of waiting.
- Example, gp3 estimate F = 4 ms, measured m = 0.064 ms:
  - λ = 100/s: b ≈ 0.4, latency ≈ 4–8 ms.
  - λ = 1,000/s: b ≈ 4.3, C ≈ 4.3 ms.
  - λ = 10,000/s: b ≈ 111, C ≈ 11 ms.
  - Saturation at λ = 1/m ≈ 15.6k/s per shard.
- Under light load a batch is one order, so this is never worse than today. This matches TigerBeetle's "under light load, the batches automatically become smaller" [G-TB-PERF].

### 4.4 Fencing tokens and leases for a single writer

- **Kleppmann:** a lease alone is unsafe because a paused holder (GC, stop-the-world "several minutes") can wake after expiry. The storage must reject stale tokens: "the storage server… rejects the request with token 33" [S-KLEPPMANN].
- **Implementation in Postgres (INFERENCE, demonstrated [M-REC]):**
  - `shard_lease(shard, epoch, holder, last_seq, expires_at)`.
  - Acquire: `UPDATE … SET epoch = epoch + 1, holder = me, expires_at = now() + 10 s WHERE shard = s AND (expires_at < now() OR holder = me) RETURNING epoch, last_seq`.
  - Every batch transaction includes the `(epoch, last_seq)` CAS. **Postgres is the storage, so the fence is enforced by the only thing that matters.**
  - In [M-REC], after bumping the epoch, the old holder's batch failed with `P0901 fenced or out-of-sequence` and wrote nothing.
- Session advisory locks are *not* a sufficient lease through Supavisor transaction pooling (via R03). The epoch CAS works through any pooler.

### 4.5 Recovery from database state

**Measured [M-REC]:**
- A server-side cursor streamed 200,000 live orders (64 books), ordered by `(option, side, price, id)`, into Python dictionaries in **0.38–0.42 s** over 3 trials.
- Same container and conditions as [M-GC], with a partial index on live orders.

**Recovery procedure (INFERENCE):**
1. Take the lease (epoch+1).
2. `SELECT last_seq`.
3. Stream live orders for the shard in priority order `(yes_px, seq)` into the array ladder.
4. Optionally verify: recompute C1–C9 for the shard's books against SQL aggregates, and compare the latest batch `state_hash`.
5. Start accepting commands.

Commands that were in flight in an uncommitted batch are lost. Clients retry with the same `client_order_id`, and the command is either found (already committed: return the stored result) or applied now.

Expected recovery time is 1–3 s for a Kichiko-sized shard (INFERENCE). Compare Aeron's 10 s default heartbeat timeout [G-AERON-SRC] and LMAX's under one minute (via R03).

---

## 5. Target architecture for Kichiko

### 5.1 Principles

1. **Postgres is the only source of truth for money, positions and orders.** The matcher's in-memory book is a derived cache, the way dYdX's memclob is to chain state.
2. **One writer per shard, fenced by the database.**
3. **Batch the commit, never the semantics.** Batch boundaries must be unobservable (C13).
4. **Reserve at entry.** Makers are always fully funded, so matching needs no maker balance check. This closes A-M1 by construction.
5. **Integer ticks and minor units throughout.**
6. **Acknowledge after COMMIT.**

### 5.2 Components and order flow

```
Nairobi client ──TLS (keep-alive)──► Order API (Vercel dub1 / Fly lhr; local JWT verify)  [~178 ms RTT]
                                         │  gRPC/HTTP2, intra-region, ~0.3 ms
                                         ▼
                           Matcher-sequencer for shard S (holds lease epoch e)
                           ┌──────────────────────────────────────────────────┐
                           │ inbox (arrival order) → assign seq               │
                           │ while commit k in flight, accumulate batch k+1   │
                           │ BEGIN                                            │
                           │  1 fence: UPDATE shard SET last_seq=… WHERE      │
                           │           epoch=e AND last_seq=prev              │
                           │  2 insert commands (UNIQUE user,client_order_id) │
                           │  3 reserve funds for new orders, wallets locked  │
                           │    ORDER BY user_id → accepted/rejected set      │
                           │  4 match accepted orders in memory (µs)          │
                           │  5 set-based write: fills, ledger legs, orders,  │
                           │    positions, wallet deltas, refunds of surplus  │
                           │  6 outbox rows (book_seq ranges), batch_hash     │
                           │ COMMIT (synchronous_commit=on)                   │
                           │ → reply to API with per-order results            │
                           └──────────────────────────────────────────────────┘
                                         │ outbox relay (at least once, ordered)
                                         ▼
                           Supabase Realtime Broadcast: book:<market> (seq), user:<id> (private)
```

**Details and justifications:**
- **Shard = event.** All child markets of an event go to the same shard, like Kalshi [S-KAL], so negRisk conversion and multi-outcome atomicity stay inside one writer. Shards are assigned by consistent hashing over events. Start with 1–4 shards on one process, which is enough (§5.5).
- **Step 3 reads the truth under row locks.** Deposits, withdrawals and admin adjustments lock the same wallet rows, so all balance changes serialise correctly with trading. There is no second balance copy to reconcile.
  - Cost: one extra intra-region round trip inside the transaction, since the result of step 3 feeds step 4. This is roughly +0.3–1 ms (INFERENCE).
  - Alternative: push the matcher's decisions *into* SQL as one `apply_batch` call that re-checks reservations and aborts the batch on any shortfall. The matcher then retries without the failing order. This is one round trip, but needs abort handling.
  - Start with the two-round-trip version for simplicity.
- **Cross-shard wallets.** A user trading in two shards makes two batches lock the same wallet row. Deadlock-freedom comes from each batch taking wallet locks in one `SELECT … WHERE user_id = ANY($1) ORDER BY user_id FOR UPDATE`, i.e. a global order.
  - Contention is bounded by batch duration (ms).
  - If a market-maker account becomes hot across all shards, give it per-shard escrow sub-accounts that are topped up transactionally. That is Kalshi's design, applied only where needed (INFERENCE).
- **Cancels** are commands in the same sequenced stream, so priority and cancel races resolve deterministically by `seq`.
- **Time** (GTD expiry, heartbeat cancel-all) is injected as sequenced commands carrying a timestamp from the matcher, never read inside the matching function. This is TigerBeetle's primary-assigned timestamp [G-TB-ARCH] and Aeron's cluster time.
- **Settlement, voids and negRisk conversion** are also commands for the owning shard, so they cannot interleave with matching.
- **Audit hash chain (INFERENCE).** `batch_hash = sha256(prev_hash ‖ canonical(commands) ‖ canonical(events))` is stored per batch. It gives the tamper evidence and "binds intent" property of TigerBeetle's hash chaining [G-TB-ARCH] on top of Postgres's CRC-only WAL chain [G-PG-XLOGREC], and it is the replay oracle for C12.

### 5.3 Who is the source of truth for balances?

**Postgres `wallets` plus the ledger (`transactions`), always.**
- The matcher keeps no balance state across batches. At most it keeps a within-batch working copy of what step 3 returned.
- This rejects architecture C's dual truth, where you would need Polymarket-style MATCHED→MINED→FAILED states (via R03), reconciliation, and the failure modes of §1.4.
- TigerBeetle as the balance store (D) stays rejected for now:
  - it is not managed on Supabase;
  - it recommends 6 replicas across three providers [G-TB-SAFETY];
  - it would add a second consensus system.
  - Revisit if a single Postgres primary can no longer absorb the ledger write rate, i.e. above roughly 10⁴ fills/s sustained per [M-GC] (INFERENCE).

### 5.4 Durability and recovery summary

| Failure | Effect | Recovery | Data at risk |
|---|---|---|---|
| Matcher process crash | Orders in the open batch unanswered | New holder: epoch+1, reload book (0.4 s per 200k orders [M-REC]), resume at `last_seq`; clients retry by `client_order_id` | None acknowledged |
| Zombie matcher (paused past lease) | Tries to commit a batch | CAS fails with P0901 [M-REC] | None |
| API crash | Client gets no reply | Client retries with the same id and gets the stored result | None |
| Postgres crash (process) | All shards stall | Postgres WAL redo; matchers reconnect and reload | None committed (`synchronous_commit=on`) |
| Supabase primary disk or AZ loss | Outage | PITR restore | **Up to 2 min** with PITR [G-SB-BACKUP], ~24 h without. EBS gp3 AFR ≤ 0.2% [S-EBS-DUR] |
| fsync error on the DB host | Postgres PANICs (`data_sync_retry=off`) | WAL redo | None, by design [G-PG-CONFIG18] |
| Outbox relay crash | Feed gap | Relay resumes from last published id; clients re-snapshot on seq gap | None |

INFERENCE and recommendation:
- The 2-minute RPO for primary loss is the largest residual durability risk for real money. It is a Supabase platform property, not an engine one.
- Mitigations:
  - io2 disk (AFR ≤ 0.001%) [S-EBS-DUR];
  - keep PITR on;
  - have the matcher append each committed batch's commands to an off-box append-only store after commit. For example, object storage every few seconds lets the last minutes of trading be re-derived after a PITR restore. Deposits and withdrawals already have external records (M-Pesa) to reconcile.

### 5.5 Latency and throughput budget

Nairobi user; API in eu-west-1 (or London +11 ms); p50 unless stated.

| Segment | Budget | Basis |
|---|---|---|
| Nairobi ↔ Dublin RTT (warm TLS) | 178 ms | WonderNetwork, via R03 |
| API: auth (local JWT), validation, rate limit | 0.5–1 ms | INFERENCE |
| API ↔ matcher (intra-region) | 0.2–0.5 ms | INFERENCE |
| Wait for current batch to commit (self-clocking) | 0–C(b) | §4.3 |
| Batch commit C(b) on gp3 | ~3–5 ms at b ≤ 10 | [M-GC] fit + gp3 flush 1–3 ms (INFERENCE) |
| Reservation round trip inside the transaction | 0.3–1 ms | INFERENCE |
| **Server total** | **~4–12 ms p50, ~15–25 ms p99** | INFERENCE |
| **End to end** | **~185–195 ms p50** | vs ≈ 1 s today (BRAIN L1) |

**Throughput per shard:**
- About 2–3k orders/s at b = 10 and about 9–11k/s at b = 100 on gp3 (INFERENCE from [M-GC]).
- CPU-bound near 15k/s per shard, measured at 64–71 µs per order marginal on 2 vCPUs.
- Four shards reached 18.9k/s total on 2 vCPUs [M-GC], so with a dedicated-CPU tier (Large or XL) tens of thousands per second is plausible (INFERENCE, measure).
- Today's per-market ceiling is about 500/s local and probably 250–400/s on gp3.

**Matcher CPU** is negligible. R03 cites exchange-core at 5M ops/s, and an array ladder at 28M ops/s.

**When to go further (architecture C).** Only if market makers need under 5 ms order-to-ack *at the venue* or sustained load above ~10k orders/s per shard. Kichiko's WAN floor of 178 ms makes the first unlikely to matter to retail.

### 5.6 Migration path (INFERENCE, extends BRAIN §8)

1. **Phase 1 (A+):** in the existing SQL engine, add `seq` per market, `UNIQUE(user, client_order_id)`, ordered wallet locks and the outbox. These are required by B anyway.
2. **Phase 2a (A-batched):** a per-shard worker drains an inbox and calls the *existing* PL/pgSQL engine for N orders inside one transaction.
   - This amortises the flush without touching the matching logic.
   - The ceiling rises from about 1/(CPU + flush) to about 1/CPU: roughly 250–400/s on gp3 up to about 800–900/s per market (INFERENCE; the sync-off batch-1 number was 798/s [M-GC]).
   - Differential-test it: batch-partition invariance against the per-order engine.
3. **Phase 2b (B-lite):** move matching into the worker's memory with set-based writes. Shadow-run it: compute fills in memory, compare with the SQL engine's fills per batch, and alert on any difference. Then flip shard by shard behind a flag.
4. **Throughout:** keep the SQL engine as the differential oracle.

---

## 6. Test strategy that makes it provably (or at least credibly) correct

### 6.1 Architecture for testability

- The matching core is a **pure function** `step(State, Command) → (State′, [Event])`. It has no clock, IO, randomness or hash-map iteration order dependency: use ordered containers or arrays.
- The same core is used by the live matcher, the replay verifier and the simulator. This is TigerBeetle's determinism principle [G-TB-ARCH].
- Assertions stay on in production for C1–C9 inside `step`, at O(1) per event. On violation the shard halts, which is TigerBeetle's "far better to stop operating" [G-TB-VOPR].

### 6.2 Reference model and stateful property-based testing

- Write a ~150-line reference model: a list of orders, a naive O(n) scan for the best maker by `(yes_px, seq)`, and big-integer cash.
- Generate command sequences with Hypothesis stateful or proptest:
  - place, with every type, side, outcome and tick class, including 0.1¢ ticks;
  - cancel, amend, expire, heartbeat, settle, void;
  - negRisk convert;
  - deposit and withdraw.
- After **every** step, assert C1–C11 and compare implementation state with model state. Shrink failures.
- Seed the generators with adversarial shapes: exact-crossing prices (bid + bid = 1000), self-trades, dust quantities, a max-depth sweep of 1,000 levels, and orders that exhaust balance exactly.

### 6.3 Metamorphic properties specific to this design

- **Batch-partition invariance (C13).** For a random stream and random partitions into batches (including all size-1), events and final state are byte-identical. This catches any within-batch aggregation bug, such as wallet deltas summed wrongly or position upserts collapsed incorrectly.
- **YES/NO duality.** Mirror every command (YES↔NO, p ↔ 1000 − p, buy/sell per book side). Fills must mirror.
- **Replay determinism (C12).** Snapshot at a random k, then replay. The hash must equal the live hash.
- **Crash-idempotency.** Apply batch k twice. The second attempt must fail the fence and change nothing.

### 6.4 Differential testing

- The existing `scripts/ops/clob/diff_engine.py` found 071 fill-identical to 046 over 12,500 operations (BRAIN §3). Extend it to three engines: SQL per-order, SQL batched (phase 2a) and in-memory (phase 2b). Use seeded streams and **sanitised replays of production command logs**.
- Run in CI on every change to matching code, with a nightly job at 10⁶+ operations.

### 6.5 Deterministic simulation and crash-point enumeration of the integration layer

- **Simulation harness.**
  - Model the API, the matcher, the lease table and the DB as actors in one seeded, single-threaded scheduler, in the FoundationDB/VOPR style [G-FDB-TEST], [G-TB-VOPR].
  - Inject faults: message drop, duplicate, reorder; matcher pause beyond lease; crash at every await point; DB commit that succeeds while the reply is lost; client retries.
  - Check C1–C13, exactly-once per `client_order_id`, and that every acknowledged fill is in the DB.
- **Real-Postgres crash tests.**
  - Run against a throwaway container. `kill -9` the matcher and `docker kill` Postgres at randomised points: before BEGIN, after the fence, after reservation, mid-write, after COMMIT but before the reply.
  - Restart, recover, and check invariants from SQL.
  - Include an **acknowledged ⇒ durable** check: record every result acknowledged to the client, then verify that after any crash each one exists.

### 6.6 Concurrency attack suite against every money path (ACIDRain-style)

- Jepsen "bank" checker over Kichiko's ledger [S-JEPSEN-BANK]. Run concurrently:
  - trades through the matcher;
  - deposits, including callback retries and duplicate IPNs;
  - withdrawals and approvals;
  - admin adjustments;
  - settlement and void;
  - the reconciliation job.
- Check C11 at quiescent points and at every snapshot read. Check no negative balances.
- Specifically target the audit findings: A-P3, A-W1, A-W4, R1 and D2.
- Run at Read Committed, which is what Kichiko uses. Treat any reliance on SERIALIZABLE as suspect given [S-JEPSEN-PG12]. Never read money state from replicas [S-JEPSEN-RDS].

### 6.7 TLA+ (or Quint/PlusCal) for the protocol only

Spec variables: lease `(epoch, holder, expiry)`, `last_seq`, the batch commit, API retries, and the outbox relay.

Properties:
- **Safety:** at most one committed batch per `(shard, seq)`; every acknowledged command is committed; no command committed twice; outbox `seq` is gap-free per book.
- **Liveness:** under weak fairness, a submitted command is eventually acknowledged or rejected.

The state space is small (2 matchers, 3 commands, 2 crashes), so it can be checked exhaustively with TLC. AWS's 35-step bug [S-AWS-TLA] is the argument for doing this: lease and fence bugs hide in long interleavings.

### 6.8 Production verification

- Continuous reconciliation of C1–C11 (BRAIN I1–I5), as SQL plus pg_cron, paging on any drift.
- A nightly **replay audit**: rebuild each shard's book from the command log and verify the `batch_hash` chain and final state against live tables.
- A per-batch `state_hash` of each touched book is emitted to the outbox, so clients and the relay can detect divergence.

---

## 7. What to measure next (to replace INFERENCE with data)

1. `pg_test_fsync` is not runnable on Supabase. Instead, run the [M-GC] script unchanged on a Supabase **branch or throwaway project of the production tier (gp3)**, and again with io2. Report C(b) for b ∈ {1, 10, 100}. **Do not run against production.**
2. The same with the matcher in `dub1`/`lhr` and TCP to the pooler, to get real intra-region round-trip and Supavisor overhead in C(b).
3. Phase 2a prototype: N orders through the existing `clob_place_order` in one transaction, to measure the flush-amortised per-market ceiling on gp3.
4. Recovery drill: kill the matcher under load and measure time to first acknowledged order after the new lease.

---

## 8. References

### Measured in this session
- **[M-FSYNC]** `pg_test_fsync -s 3` (PG 16 binary), Firecracker VM, ext4 on virtio `/dev/vda` (write-back cache), 2026-09-26. Raw output reproduced in §2.1.
- **[M-GC]** `scratchpad/bench/groupcommit_bench.py`, run twice. Results in `gc_results.jsonl` and `gc_results2.jsonl`. Container `supabase/postgres:17.6.1.011`, `--cpus=2`, default configuration; host has 4 vCPU (Xeon 2.8 GHz) and 15 GB RAM, shared with other agents' containers.
- **[M-REC]** `scratchpad/bench/recovery_read.py`, same container: rebuild of 200k live orders, and the fencing rejection demo.

### Primary sources fetched in full (GitHub)
- **[G-TB-ARCH]** TigerBeetle, `docs/ARCHITECTURE.md`. https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/ARCHITECTURE.md
- **[G-TB-DATAFILE]** `docs/internals/data_file.md`. https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/data_file.md
- **[G-TB-VSR]** `docs/internals/vsr.md`. https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vsr.md
- **[G-TB-VOPR]** `docs/internals/vopr.md`. https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md
- **[G-TB-SAFETY]** `docs/concepts/safety.md`; **[G-TB-PERF]** `docs/concepts/performance.md`. https://github.com/tigerbeetle/tigerbeetle/tree/main/docs/concepts
- **[G-TB-SYSARCH]** `docs/coding/system-architecture.md`; **[G-TB-RTS]** `docs/coding/reliable-transaction-submission.md`. https://github.com/tigerbeetle/tigerbeetle/tree/main/docs/coding
- **[G-TB-JOURNAL]** `src/vsr/journal.zig`; **[G-TB-CKSUM]** `src/vsr/checksum.zig`; **[G-TB-CONFIG]** `src/config.zig`; **[G-TB-CONST]** `src/constants.zig`. https://github.com/tigerbeetle/tigerbeetle/tree/main/src
- **[G-DISRUPTOR]** LMAX Disruptor technical paper, `src/docs/asciidoc/en/disruptor.adoc`. https://github.com/LMAX-Exchange/disruptor/blob/master/src/docs/asciidoc/en/disruptor.adoc
- **[G-AERON-CL]** Aeron Cluster README. https://github.com/aeron-io/aeron/blob/master/aeron-cluster/README.md
- **[G-AERON-SRC]** `aeron-archive/.../Archive.java` (`FILE_SYNC_LEVEL_DEFAULT = 0`) and `aeron-cluster/.../ConsensusModule.java` (timeouts). https://github.com/aeron-io/aeron
- **[G-AERON-WIKI-ARCHIVE]** Aeron Archive wiki. https://github.com/aeron-io/aeron/wiki/Aeron-Archive
- **[G-DYDX]** dYdX v4-chain: `protocol/x/clob/memclob/memclob.go`, `protocol/x/clob/types/constants.go`, `protocol/x/clob/keeper/{keeper,orders}.go` (`InitStatefulOrders`, via GitHub code search). https://github.com/dydxprotocol/v4-chain
- **[G-CTF]** Gnosis `ConditionalTokens.sol`. https://github.com/gnosis/conditional-tokens-contracts/blob/master/contracts/ConditionalTokens.sol
- **[G-PM-CTFX]** Polymarket CTF Exchange: `src/exchange/mixins/Trading.sol`, `libraries/OrderStructs.sol`, `libraries/CalculatorHelper.sol`. https://github.com/Polymarket/ctf-exchange
- **[G-PG-XLOG]** PostgreSQL REL_17 `src/backend/access/transam/xlog.c` (`XLogFlush`). https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/access/transam/xlog.c
- **[G-PG-WALDOC]** PostgreSQL REL_17 `doc/src/sgml/wal.sgml` (`commit_delay`). https://github.com/postgres/postgres/blob/REL_17_STABLE/doc/src/sgml/wal.sgml
- **[G-PG-CONFIG18]** PostgreSQL REL_18 `doc/src/sgml/config.sgml` (`io_method`, `data_sync_retry`). https://github.com/postgres/postgres/blob/REL_18_STABLE/doc/src/sgml/config.sgml
- **[G-PG-XLOGREC]** PostgreSQL REL_17 `src/include/access/xlogrecord.h`. https://github.com/postgres/postgres/blob/REL_17_STABLE/src/include/access/xlogrecord.h
- **[G-PG-AIO]** PostgreSQL REL_18 `src/backend/storage/aio/README.md`. https://github.com/postgres/postgres/blob/REL_18_STABLE/src/backend/storage/aio/README.md
- **[G-FDB-TEST]** FoundationDB `documentation/sphinx/source/testing.rst`. https://github.com/apple/foundationdb/blob/main/documentation/sphinx/source/testing.rst
- **[G-DBZ-OUTBOX]** Debezium outbox event router docs. https://github.com/debezium/debezium/blob/main/documentation/modules/ROOT/pages/transformations/outbox-event-router.adoc
- **[G-SB-DISK]** Supabase docs `compute-and-disk.mdx`. https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/compute-and-disk.mdx
- **[G-SB-BACKUP]** Supabase docs `backups.mdx`. https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/platform/backups.mdx
- **[G-MELIN]** Melin sequencer README (vendor-published benchmarks, Aug 2026). https://github.com/melin-engine/melin

### Search-result extracts only (primary page blocked by egress proxy; secondary, re-verify)
- **[S-LMAX]** Fowler, "The LMAX Architecture". https://martinfowler.com/articles/lmax.html. Snippets via search; LMAX numbers via R03, which fetched it.
- **[S-AERON-AWS]** AWS, "Aeron on AWS: 2025 Performance Benchmark Results". https://aws.amazon.com/blogs/industries/aeron-on-aws-2025-performance-benchmark-results/
- **[S-CB-PM]** Coinbase, "A postmortem of our May 7, 2026 outage". https://www.coinbase.com/blog/a-postmortem-of-our-may-7-2026-outage ; InfoQ coverage https://www.infoq.com/news/2026/06/coinbase-aws-failure-postmortem/
- **[S-CB-TALK]** Frank Yu, "How to Build an Exchange", QCon SF 2025 / InfoQ. https://www.infoq.com/presentations/exchange-systems-cloud/
- **[S-NASDAQ]** A-Team Insight, "With SIX rollout, Nasdaq OMX pushes matching latency below 40 microseconds". https://a-teaminsight.com/blog/with-six-rollout-nasdaq-omx-pushes-matching-latency-below-40-microseconds/ ; SIX PDF https://www.six-group.com/dam/download/the-swiss-stock-exchange/trading/trading-platform/x-stream-inet-performance-measurement-details.pdf
- **[S-CME]** Markets Media, "Taking Variability Out of Velocity". https://www.marketsmedia.com/taking-variability-out-of-velocity/ (weak)
- **[S-EUREX]** Deutsche Börse, "Insights into Trading System Dynamics", March 2025. https://www.eurex.com/resource/blob/48918/e8d4df56f75c9a96fb0f6fff6b18a14f/data/presentation_insights-into-trading-system-dynamics_en.pdf
- **[S-HL]** Hyperliquid Docs, HyperCore overview. https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/overview
- **[S-KAL]** Kalshi API docs, Exchange Sharding. https://docs.kalshi.com/getting_started/exchange_sharding
- **[S-DYDX-DOCS]** dYdX v4 Technical Architecture Overview. https://www.dydx.xyz/blog/v4-technical-architecture-overview
- **[S-EBS]** AWS EBS volume types / General Purpose SSD. https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volume-types.html ; https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html
- **[S-EBS-DUR]** AWS EBS Provisioned IOPS (durability / AFR). https://docs.aws.amazon.com/ebs/latest/userguide/provisioned-iops.html
- **[S-PLP]** M. Callaghan, "SSDs, power loss protection and fsync latency", Small Datum, Jan 2026. http://smalldatum.blogspot.com/2026/01/ssds-power-loss-protection-and-fsync.html
- **[S-GP2]** pg_test_fsync outputs gist. https://gist.github.com/mrnugget/b6bff62b3265761e640e9124947fe293 (weak)
- **[S-REBELLO]** Rebello et al., "Can Applications Recover from fsync Failures?", USENIX ATC 2020. https://www.usenix.org/conference/atc20/presentation/rebello
- **[S-AXBOE]** J. Axboe, "Efficient IO with io_uring" (1.7M IOPS polled), via search extract.
- **[S-HAAS]** Haas & Leis, "What Modern NVMe Storage Can Do, And How To Exploit It", PVLDB 16(9):2090–2102, 2023. https://www.vldb.org/pvldb/vol16/p2090-haas.pdf
- **[S-IOURING-DB]** "High-Performance DBMSs with io_uring: When and How to Use It", arXiv:2512.04859. https://arxiv.org/abs/2512.04859
- **[S-RAFT]** Ongaro & Ousterhout, Raft §7 log compaction (via explanatory extracts).
- **[S-JEPSEN-TB]** Jepsen, "TigerBeetle 0.16.11". https://jepsen.io/analyses/tigerbeetle-0.16.11
- **[S-JEPSEN-RDS]** Jepsen, "Amazon RDS for PostgreSQL 17.4". https://jepsen.io/analyses/amazon-rds-for-postgresql-17.4
- **[S-JEPSEN-PG12]** Jepsen, "PostgreSQL 12.3". https://jepsen.io/analyses/postgresql-12.3 ; pgsql-bugs thread https://www.postgresql.org/message-id/db7b729d-0226-d162-a126-8a8ab2dc4443@jepsen.io
- **[S-JEPSEN-BANK]** Jepsen bank workload, as described in Jepsen analyses (e.g. TiDB 2.1.7, CockroachDB). https://jepsen.io/analyses/tidb-2.1.7
- **[S-ACIDRAIN]** Warszawski & Bailis, "ACIDRain", SIGMOD 2017, DOI 10.1145/3035918.3064037. http://www.bailis.org/papers/acidrain-sigmod2017.pdf
- **[S-AWS-TLA]** Newcombe et al., "How Amazon Web Services Uses Formal Methods", CACM 58(4), 2015, DOI 10.1145/2699417 ; https://lamport.azurewebsites.net/tla/formal-methods-amazon.pdf
- **[S-TLA-OB]** Hobby TLA+-verified matching engine. https://github.com/AtharvaPatil466/Order-Matching-Engine (not production)
- **[S-ANTITHESIS]** Antithesis MongoDB case study. https://antithesis.com/case_studies/mongodb_productivity/ ; hypervisor post https://antithesis.com/blog/deterministic_hypervisor/
- **[S-HUGHES]** J. Hughes, "Experiences with QuickCheck: Testing the Hard Stuff and Staying Sane", 2016. https://www.cs.tufts.edu/~nr/cs257/archive/john-hughes/quviq-testing.pdf
- **[S-OBQE]** orderbook-qe (differential testing against a reference matching engine). https://github.com/alexvervloet/orderbook-qe
- **[S-KLEPPMANN]** M. Kleppmann, "How to do distributed locking", 2016. https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html
- **[S-DBOS]** DBOS, "Benchmarking How Workflow Execution Scales on Postgres". https://www.dbos.dev/blog/benchmarking-workflow-execution-scalability-on-postgres

### Prior Kichiko documents (not repeated)
- **R03:** `docs/research/brain-2026-09/03-ENGINE-ENGINEERING.md`. LMAX, exchange-core, Coinbase FSI309, Polymarket, Hyperliquid in-block order, RTT tables, Supabase limits, outbox, idempotency keys.
- **BRAIN:** `docs/design/BRAIN-ARCHITECTURE-2026-09.md`. Measured engine numbers and bug register.
- **Repo:** `supabase/migrations/071_clob_index_ordered_ladder.sql` (`yes_px` / `book_side` normalisation), and `scripts/ops/clob/{diff_engine,bench_engine,fuzz_invariants}.py`.

### Could not fetch
- jepsen.io, tigerbeetle.com (including "The Write Last, Read First Rule"), martinfowler.com, aeron.io, AWS blogs and docs, usenix.org, arxiv.org, vldb.org, kalshi and hyperliquid docs, eurex, nasdaq and cmegroup PDFs, antithesis.com, and gist raw content. All were blocked by the egress proxy (HTTP 403 on CONNECT). Only GitHub was reachable.
