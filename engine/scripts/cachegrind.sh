#!/usr/bin/env bash
# Per-op simulated costs: cachegrind(N ops) - cachegrind(0 ops), divided by N.
# Built for x86-64-v3 (AVX2/BMI2/LZCNT): valgrind 3.22 cannot execute the
# AVX-512 instructions a target-cpu=native build on this host may contain.
set -e
D=$(cd "$(dirname "$0")/.." && pwd); N=${N:-20000}
RUSTFLAGS="-C target-cpu=x86-64-v3" CARGO_TARGET_DIR=$D/target-vg cargo build --release --bin cgrun --manifest-path $D/Cargo.toml 2>/dev/null
B=$D/target-vg/release/cgrun; OUT=$D/cg; mkdir -p $OUT
num() { grep -E "$1" "$2" | head -1 | sed -E 's/.*: *([0-9,]+).*/\1/' | tr -d ,; }
printf "%-13s %-6s %9s %9s %9s %9s %9s %9s %9s\n" scenario ladder "Ir/op" "Dr+Dw/op" "D1miss/op" "LLmiss/op" "Br/op" "Mispr/op" "fills/op"
for s in shallow deep3000 sweep cancel_heavy mixed; do for l in btree tick; do
  for n in 0 $N; do
    valgrind --tool=cachegrind --cache-sim=yes --branch-sim=yes --cachegrind-out-file=$OUT/cg.$s.$l.$n.out $B $s $l $n $N > $OUT/cg.$s.$l.$n.log 2>&1
  done
  a=$OUT/cg.$s.$l.0.log; b=$OUT/cg.$s.$l.$N.log
  fills=$(grep -oE "fills=[0-9]+" $b | cut -d= -f2)
  awk -v s=$s -v l=$l -v n=$N -v f=$fills \
    -v ir=$(( $(num "I *refs" $b) - $(num "I *refs" $a) )) \
    -v dr=$(( $(num "D *refs" $b) - $(num "D *refs" $a) )) \
    -v d1=$(( $(num "D1 *misses" $b) - $(num "D1 *misses" $a) )) \
    -v ll=$(( $(num "LL misses" $b) - $(num "LL misses" $a) )) \
    -v br=$(( $(num "Branches" $b) - $(num "Branches" $a) )) \
    -v mp=$(( $(num "Mispredicts" $b) - $(num "Mispredicts" $a) )) \
    'BEGIN{printf "%-13s %-6s %9.0f %9.0f %9.2f %9.3f %9.0f %9.2f %9.2f\n", s, l, ir/n, dr/n, d1/n, ll/n, br/n, mp/n, f/n}'
done; done
grep -E "^==[0-9]+== (I1|D1|LL) " $OUT/cg.mixed.tick.0.log | head -3 || true
grep -E "warning" $OUT/cg.mixed.tick.0.log | head -3 || true
