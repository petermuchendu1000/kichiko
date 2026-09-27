#!/bin/bash
# Polls the Wayback CDX endpoint with exponential backoff until it answers 200.
# Plain request, honest UA; no evasion. Log -> ../data/wayback-retry-log.txt
LOG=../data/wayback-retry-log.txt
d=120
for i in $(seq 1 12); do
  r=$(curl -sS -o /tmp/cdx-probe.txt -w '%{http_code}' --max-time 60 "https://web.archive.org/cdx/search/cdx?url=kalshi.com/&from=2026&limit=3&fl=timestamp,statuscode" 2>&1 | tail -c 200 | tr '\n' ' ')
  echo "$(date -u +%FT%TZ) attempt $i -> $r $(head -c 120 /tmp/cdx-probe.txt 2>/dev/null | tr '\n' ' ')" >> $LOG
  case "$r" in *200*) echo OK >> $LOG; exit 0;; esac
  sleep $d; d=$(( d*3/2 )); [ $d -gt 900 ] && d=900
done
exit 1
