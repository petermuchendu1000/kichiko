#!/usr/bin/env bash
# Differential proof: seeds x N ops through SQL (kdb2) and both twin ladders.
#   SEEDS      : standard profile (10% cancels, cap-avoiding)
#   DEEP_SEEDS : deep-book profile (2% cancels, runs into the 60/market cap)
# Odd seeds use a 1c tick, even seeds 0.1c; seeds divisible by 3 use min_order_size 5.00.
set -e
D=$(cd "$(dirname "$0")/.." && pwd); OUT=${OUT:-$D/runs}; N=${N:-2000}
SEEDS=${SEEDS:-"101 102 103 104 105 106 107 108 109 110 111 112"}
DEEP_SEEDS=${DEEP_SEEDS:-"201 202 203 204"}
CAP_SEEDS=${CAP_SEEDS:-"301 302"}   # 4,000 ops, no cancels: hits the 60-open-orders/market cap (P0131)
mkdir -p $OUT
cargo build --release --manifest-path $D/Cargo.toml --bin replay 2>/dev/null
one() {
  local s=$1; shift
  if [ $((s % 2)) -eq 0 ]; then TICK=0.001; else TICK=0.01; fi
  if [ $((s % 3)) -eq 0 ]; then MIN=5.00; else MIN=0.50; fi
  python3 $D/scripts/sql_run.py --seed $s --n ${N} --tick $TICK --min $MIN --out $OUT "$@"
  $D/target/release/replay $OUT/stream_$s.json $OUT/twin_$s
}
for s in $SEEDS; do one $s; done
for s in $DEEP_SEEDS; do one $s --cancel 0.02 --capcancel 0; done
for s in $CAP_SEEDS; do N=4000 one $s --cancel 0 --capcancel 0; done
python3 $D/scripts/compare.py $OUT $SEEDS $DEEP_SEEDS $CAP_SEEDS
