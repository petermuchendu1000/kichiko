#!/usr/bin/env python3
"""
Populate markets.resolution_source — the independent authority whose published
record decides each market.

WHY THIS EXISTS
---------------
Measured 2026-10-15: all 36 active markets had `resolution_source` NULL. Close
times and resolution criteria were present, but the source that settles the
outcome was absent on every market, while the UI has always been built to show
it (market-rules.tsx renders it as a link, contract-specs.tsx alongside the
close date).

Ruling C3 of docs/research/ui-2026-09/40-ELEMENT-MATRIX.md marks this BINDING:
L.N. 112 Reg. 45(1) and 23(1) require the rules to be available before the
wager, and Reg. 45(6) requires an independent, approved resolution mechanism.

HOW THE SOURCE IS CHOSEN
------------------------
Not editorially. Each market's own `resolution_criteria` already names the
authority — "declared winner ... by the IEBC", "the CBK Central Bank Rate",
"KNBS reports 12-month inflation", "BTC/USD (Coinbase spot)". This script maps
that named authority to its public record. Where the criteria name no
independent authority ("major-media confirmed", "a reputable analytics
report"), the market is LEFT NULL and reported, because inventing an authority
would assert something the market's own rules do not say.

Every URL is fetched before it is written; a source that does not answer is not
stored. `resolution_source` renders through `safeHttpUrl`, so a dead or
non-HTTP value degrades to inert grey text rather than a working link.
"""
from __future__ import annotations

import argparse
import os
import sys
from urllib.parse import urlparse

import requests

# Same shape as scripts/backfill_market_covers.py, and for the same reason:
# CloudFront 403s a User-Agent that does not begin "Mozilla/" or that contains
# the substring "Bot".
UA = {"User-Agent": "Mozilla/5.0 (compatible; Kichiko/1.0; +https://kichiko.app; media-ingest; support@kichiko.app)"}
SESSION = requests.Session()
SESSION.headers.update(UA)

# slug -> (url, the authority as the market's own criteria name it)
SOURCES: dict[str, tuple[str, str]] = {
    # Elections — the commission that declares the result.
    "ke-2027-president":            ("https://www.iebc.or.ke/", "IEBC"),
    "ke-ruto-reelection-2027":      ("https://www.iebc.or.ke/", "IEBC"),
    "ke-sakaja-reelection-2027":    ("https://www.iebc.or.ke/", "IEBC"),
    "ke-dcp-100-mps-2027":          ("https://www.iebc.or.ke/", "IEBC"),

    # Money — the institution that sets or publishes the number.
    "ke-cbr-below-9-2026":          ("https://www.centralbank.go.ke/central-bank-rate/", "CBK Central Bank Rate"),
    "ke-kes-weaker-135-2026":       ("https://www.centralbank.go.ke/rates/forex-exchange-rates/", "CBK indicative exchange rates"),
    "ke-inflation-above-7-2026":    ("https://statistics.knbs.or.ke/", "KNBS statistics portal"),

    # Crypto — the venue the criteria name.
    "btc-above-75k-2026":           ("https://www.coinbase.com/price/bitcoin", "Coinbase spot"),
    "btc-below-60k-q3-2026":        ("https://www.coinbase.com/price/bitcoin", "Coinbase spot"),
    "eth-above-2500-2026":          ("https://www.coinbase.com/price/ethereum", "Coinbase spot"),
    "xrp-above-2-2026":             ("https://www.coinbase.com/price/xrp", "Coinbase spot"),
    "crypto-best-performer-h2-2026": ("https://www.coinbase.com/explore", "Coinbase spot"),

    # Listed companies — the issuer's own reporting, and the exchange.
    "ke-scom-above-30-2026":        ("https://www.nse.co.ke/", "Nairobi Securities Exchange"),
    "ke-nse-biggest-gainer-h2-2026": ("https://www.nse.co.ke/", "Nairobi Securities Exchange"),
    "ke-equity-profit-50b-2026":    ("https://equitygroupholdings.com/investor-relations/", "Equity Group investor relations"),
    "ke-kq-profit-2026":            ("https://www.kenya-airways.com/", "Kenya Airways"),
    "ke-mpesa-35m-users-2026":      ("https://www.safaricom.co.ke/investor-relation", "Safaricom results"),

    # Sport — the body that runs the competition.
    "afcon-2027-winner":            ("https://www.cafonline.com/", "CAF"),
    "ke-afcon-2027-group-exit":     ("https://www.cafonline.com/", "CAF"),
    "ke-talanta-stadium-ready":     ("https://www.cafonline.com/", "CAF"),
    "ke-beat-southafrica-qualifier": ("https://www.footballkenya.org/", "Football Kenya Federation"),
    "ke-berlin-marathon-2026":      ("https://www.bmw-berlin-marathon.com/", "BMW Berlin Marathon"),

    # Public bodies.
    "ke-elnino-floods-2026":        ("https://meteo.go.ke/", "Kenya Meteorological Department"),
    "ke-housing-45k-units-2026":    ("https://bomayangu.go.ke/", "Affordable Housing Programme (Boma Yangu)"),
    "ke-sha-20m-2026":              ("https://sha.go.ke/", "Social Health Authority"),
    "ke-tax-amendments-bill-2026":  ("http://www.parliament.go.ke/", "Parliament of Kenya"),
    "ke-housing-levy-scrapped-2027": ("http://www.parliament.go.ke/", "Parliament of Kenya"),
    "ke-starlink-100k-2026":        ("https://www.ca.go.ke/", "Communications Authority of Kenya"),
}

# Markets whose own criteria name no independent authority. Left NULL on
# purpose: the market says "major-media confirmed" or "a reputable analytics
# report", and writing a source would assert a resolver its rules do not.
# These need their CRITERIA rewritten before a source can exist — which is a
# Reg. 45(6) question, not a data-entry one.
NO_INDEPENDENT_SOURCE: dict[str, str] = {
    "ke-ruto-gachagua-reconcile":   "'appear jointly at a political event' — judgement call, no register of truces",
    "ke-2027-opposition-flagbearer": "'major-media confirmed' — names no outlet",
    "ke-most-used-app-2026":        "'a reputable 2026 year-end analytics report' — names no publisher",
    "ke-artist-of-year-2026":       "'the leading 2026 Kenyan music awards' — names no ceremony, with a fallback to 'most-streamed'",
    "ke-arbantone-10m-youtube-2026": "view count is on YouTube, but the qualifying song is not identified until it exists",
    "ke-hashtag-number-one-2026":   "X publishes no authoritative trending archive for Kenya",
    "ke-finance-bill-protests-2026": "'major-media' across 5+ counties — no single record",
    "ke-genz-protest-h2-2026":      "'reported in 5+ counties' — no single record",
}


def sql(query: str) -> list[dict]:
    r = requests.post(
        f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/database/query",
        headers={"Authorization": f"Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
                 "Content-Type": "application/json"},
        json={"query": query}, timeout=60,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"query failed {r.status_code}: {r.text[:500]}\n--- sql ---\n{query[:400]}")
    out = r.json()
    return out if isinstance(out, list) else []


# Not every failed fetch means a link a person cannot open, and treating them
# alike would have dropped four of the most important sources here.
#   OK        2xx/3xx.
#   BOTWALL   403/429 to an automated client. Coinbase serves humans normally;
#             so does Kenya Law. Storing these is correct.
#   CHAIN     The server omits its intermediate certificate. Desktop browsers
#             paper over it by fetching the issuer (AIA), so the page opens —
#             but older Android does not, and that is a large share of this
#             audience. Stored, and reported, because the authority is still
#             the authority.
#   DEAD      404 or no connection. Never stored.
OK, BOTWALL, CHAIN, DEAD = "ok", "bot-walled", "cert-chain", "dead"


def reachable(url: str) -> tuple[str, str]:
    last = "no attempt"
    for method in ("head", "get"):
        try:
            r = getattr(SESSION, method)(url, timeout=25, allow_redirects=True)
            if r.status_code < 400:
                return OK, str(r.status_code)
            if r.status_code in (403, 429):
                return BOTWALL, f"HTTP {r.status_code} to an automated client"
            last = f"HTTP {r.status_code}"
        except requests.exceptions.SSLError as exc:
            if "unable to get local issuer certificate" in str(exc):
                return CHAIN, "server omits its intermediate certificate"
            last = f"SSL: {str(exc)[:60]}"
        except Exception as exc:
            last = type(exc).__name__
    return DEAD, last


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to the database")
    ap.add_argument("--dry-run", action="store_true", help="check and report, change nothing")
    args = ap.parse_args()
    if not args.apply and not args.dry_run:
        ap.error("pass --apply or --dry-run")

    for var in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"):
        if not os.environ.get(var):
            print(f"missing env: {var}", file=sys.stderr)
            return 2

    markets = sql("select slug, resolution_source from markets "
                  "where status = 'active' and is_hidden = false order by slug")
    live = {m["slug"]: m["resolution_source"] for m in markets}
    print(f"{len(live)} active markets\n")

    # A slug that no longer exists is a silent no-op, so say so.
    unknown = sorted((set(SOURCES) | set(NO_INDEPENDENT_SOURCE)) - set(live))
    for s in unknown:
        print(f"  WARN  {s}: not an active market")

    checked: dict[str, str] = {}
    written = skipped = failed = 0

    for slug in sorted(live):
        if slug in NO_INDEPENDENT_SOURCE:
            print(f"  none  {slug:32s} {NO_INDEPENDENT_SOURCE[slug][:70]}")
            skipped += 1
            continue
        entry = SOURCES.get(slug)
        if not entry:
            print(f"  GAP   {slug:32s} no mapping and not declared sourceless")
            failed += 1
            continue
        url, authority = entry

        if url not in checked:
            verdict, detail = reachable(url)
            checked[url] = verdict
            print(f"  {verdict:<10s} {urlparse(url).netloc:32s} {detail}")
        if checked[url] == DEAD:
            failed += 1
            continue

        if live[slug] == url:
            skipped += 1
            continue
        if args.apply:
            sql("update markets set resolution_source = '%s' where slug = '%s'"
                % (url.replace("'", "''"), slug.replace("'", "''")))
        print(f"  ->    {slug:32s} {authority}")
        written += 1

    print(f"\nwritten={written} skipped={skipped} failed={failed}"
          f"{'' if args.apply else '  (dry run — nothing written)'}")
    print(f"{len(NO_INDEPENDENT_SOURCE)} markets left without a source on purpose; "
          f"their criteria name no independent authority.")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
