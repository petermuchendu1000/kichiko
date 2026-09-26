# kengine: native Rust twin of the SQL matching engine

An exact semantic twin of `clob_place_order` (migrations 071 + 073), `clob_cancel_order` and `clob_expire_orders` (045), with two interchangeable books (a `BTreeMap` baseline and a tick array + two-level bitmap + u32 slab). Money is exact: an i128 emulation of Postgres `numeric` scale and half-away-from-zero rounding.

It exists to (1) prove a native engine can reproduce the SQL engine fill-for-fill, (2) measure what a native core costs, and (3) find SQL engine bugs by differential testing (it found the 073 bug).

Design, evidence and benchmarks: [`docs/research/engine-2026-09/16-ENGINE-TWIN.md`](../docs/research/engine-2026-09/16-ENGINE-TWIN.md).

```bash
cargo test --release                      # unit, no-allocation and quirk tests
# differential proof; needs the local replica on localhost:54323 (hardcoded and asserted in scripts/sql_run.py)
bash scripts/run_all.sh
cargo bench                               # criterion
```

The proof scripts connect only to the local replica URL; they pause that replica's pg_cron expire/remark jobs during a run and restore them afterwards.
