#!/bin/sh
# Full re-runnable pipeline, strictly sequential (one browser at a time).
H=/home/user/kichiko/docs/research/ui-2026-09/captures-v2/polymarket/harness
cd /home/user/kichiko/apps/web || exit 1
echo "== capture $(date -u +%FT%TZ)"; FORCE=1 node $H/capture.js P01 P02 P03 P04 P05 P07 P08 P09 P13 P14 P15 P17a P17b P18
echo "== interactions $(date -u +%FT%TZ)"; node $H/interactions.js all
echo "== perf $(date -u +%FT%TZ)"; node $H/perf.js P01 P03 P04
echo "== post $(date -u +%FT%TZ)"; python3 $H/pixeldiff.py; node $H/summarize.js -q; node $H/coverage.js
echo "== done $(date -u +%FT%TZ)"
