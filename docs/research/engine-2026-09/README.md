# Engine program 2026-09: research reports and experiments

Seven workstreams run in parallel on 2026-09-26 (brief: `docs/design/BRAIN-ARCHITECTURE-2026-09.md` roadmap), each written to a report here. They build on, and do not repeat, `docs/research/brain-2026-09/`.

| Report | Question | Key result |
|---|---|---|
| [10-MICROARCH](10-MICROARCH.md) | Fastest in-memory book for a <=1,000-tick grid, at CPU level | Tick array + 2-level bitmap + 32-byte nodes in a u32 slab: 21.5-34 ns/op (C++ and Rust), 3.4-9x faster than `std::map` books |
| [11-ARCHITECTURE-PERSISTENCE-CORRECTNESS](11-ARCHITECTURE-PERSISTENCE-CORRECTNESS.md) | Single-writer designs, durability, provable correctness | Batching orders per Postgres commit: 523/s at 1, 10.7k/s at 100; target "B-lite": Postgres stays source of truth, one fenced matcher per event |
| [12-PREDICTION-MARKET-ALGORITHMS](12-PREDICTION-MARKET-ALGORITHMS.md) | Complementary and multi-outcome matching, batch clearing, exact money | Polymarket V2 match rules from source; 3 riskless-match patterns (O(1) checks); Kichiko's batch LP is totally unimodular (whole lots, whole ticks) |
| [13-POSTGRES-HOT-PATH](13-POSTGRES-HOT-PATH.md) | What one PL/pgSQL order costs inside Postgres 17 | 1.54 ms DB time + 0.36-0.50 ms flush; 103 locks, 48 WAL records per crossing order; ranked fixes 414/s -> 577-660/s |
| [14-FX-SOURCES](14-FX-SOURCES.md) | Most official free FX source per currency | CBK, BNR, NBE, BoZ machine-readable; BoT HTML, BRB PDF, BoU none; FX cron is scheduled nowhere |
| [15-CURRENCY-FLOW](15-CURRENCY-FLOW.md) | How currency is chosen end to end; design for country-derived settlement currency | Every money route trusts the request's currency; design for one country / one settlement currency |
| [16-ENGINE-TWIN](16-ENGINE-TWIN.md) | Native Rust twin of `clob_place_order`, proven fill-for-fill | 0 divergences over 40,000 ops (re-run after 073: still 0); ~2M orders/s single core |

**Evidence tags used in the reports:** [F] fetched, [G] read on GitHub, [M] measured here, [S] search-engine extract of a page the sandbox proxy blocked (re-check), [I] inference, [U] unverified.

**Paths.** The reports were written in a scratch directory and cite it (`/tmp/claude-0/.../scratchpad/...`). In the repo:
- `scratchpad/engine/...` is [`engine/`](../../../engine) (the Rust workspace; proof data and build output are not committed);
- `scratchpad/bench/...`, `hp.py`, `runv.sh`, `mb*.sql`, `w_*.txt`, `k12exp/...` are under [`experiments/`](experiments) (`microarch/`, `architecture/`, `postgres/`, `pm-clearing/`). Large generated command streams (`cmds_*.bin`) are not committed; `book.cpp` regenerates them.

All database measurements used local throwaway Postgres containers (Supabase `17.6.1.011` image); no remote database was contacted.
