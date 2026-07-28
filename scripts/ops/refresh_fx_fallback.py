#!/usr/bin/env python3
"""
scripts/ops/refresh_fx_fallback.py - regenerate the emergency FX bootstrap.

The app's runtime FX source is the DB `exchange_rates` table, refreshed
autonomously by the `update-exchange-rates` cron from the live, free
ExchangeRate-API. `lib/generated/fx-fallback.json` is ONLY the last-resort
bootstrap used if both the live provider and the DB are unreachable.

To keep it from becoming a stale, hand-maintained set of magic numbers, this
script regenerates it from the SAME live provider. Run it periodically (or in
CI) so the bootstrap tracks reality. KES is included like every other currency:
it is a real market FX quote (~129 KES/USD), NOT a fixed peg, so its last-known-
good value must track the live provider too.

    python3 scripts/ops/refresh_fx_fallback.py
"""
from __future__ import annotations
import json, os, sys, urllib.request, datetime as dt

ERAPI = os.environ.get("FX_PROVIDER_URL", "https://open.er-api.com/v6/latest/USD")
# Every supported currency except USD (base = 1). KES is a real market quote.
SUPPORTED = ["KES", "UGX", "TZS", "RWF", "ZMW", "ETB", "BIF"]
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", "lib", "generated", "fx-fallback.json")


def main() -> int:
    req = urllib.request.Request(ERAPI, headers={"User-Agent": "kichiko-fx/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.load(r)
    if d.get("result") != "success" or "rates" not in d:
        print("provider did not return success", file=sys.stderr)
        return 1
    rates = d["rates"]
    out = {"_generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
           "_source": d.get("provider", ERAPI),
           "_note": "Auto-generated emergency FX bootstrap. Do not hand-edit; run scripts/ops/refresh_fx_fallback.py.",
           "rates": {}}
    for c in SUPPORTED:
        per_usd = rates.get(c)
        if isinstance(per_usd, (int, float)) and per_usd > 0:
            out["rates"][c] = round(1.0 / per_usd, 10)  # local->USD
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(os.path.abspath(OUT), "w") as f:
        json.dump(out, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"wrote {os.path.abspath(OUT)} with {len(out['rates'])} rates from {out['_source']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
