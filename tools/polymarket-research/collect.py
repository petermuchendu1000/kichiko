#!/usr/bin/env python3
"""
Polymarket ground-truth data collector.

Pulls live, public data from Polymarket's four REST APIs and persists raw JSON
snapshots for reproducible quantitative analysis:

  * Gamma API   (https://gamma-api.polymarket.com)  -> markets, events (discovery/metadata)
  * CLOB  API   (https://clob.polymarket.com)       -> order books, midpoints, spreads, price history
  * Data  API   (https://data-api.polymarket.com)   -> holders (open interest distribution)

All endpoints used here are public and require no authentication.

Usage:
  python collect.py --markets 600 --books 120 --outdir data

Design goals:
  * Deterministic, resumable, and polite (rate limited).
  * Raw snapshots saved verbatim so analysis is reproducible & auditable.
  * A MANIFEST.json records provenance: timestamps, endpoints, counts, params.
"""
from __future__ import annotations
import argparse, json, os, sys, time, datetime as dt
from typing import Any, Dict, List, Optional
import requests

GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
DATA = "https://data-api.polymarket.com"

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "kichiko-research/1.0 (+ground-truth-collector)"})


def _get(url: str, params: Optional[Dict[str, Any]] = None, retries: int = 4,
         backoff: float = 0.6, timeout: int = 30) -> Any:
    last = None
    for attempt in range(retries):
        try:
            r = SESSION.get(url, params=params or {}, timeout=timeout)
            if r.status_code == 429:  # rate limited
                time.sleep(backoff * (2 ** attempt) + 0.5)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(backoff * (2 ** attempt))
    raise RuntimeError(f"GET failed after {retries} tries: {url} :: {last}")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def collect_gamma_markets(limit_total: int, page: int = 100, order: str = "volume24hr",
                          only_orderbook: bool = True) -> List[Dict[str, Any]]:
    """Paginate active, open Gamma markets ordered by 24h volume (most liquid first)."""
    out: List[Dict[str, Any]] = []
    offset = 0
    while len(out) < limit_total:
        batch = _get(f"{GAMMA}/markets", {
            "limit": page, "offset": offset,
            "active": "true", "closed": "false", "archived": "false",
            "order": order, "ascending": "false",
        })
        if not isinstance(batch, list) or not batch:
            break
        for m in batch:
            if only_orderbook and not m.get("enableOrderBook"):
                continue
            out.append(m)
        offset += page
        time.sleep(0.25)
        if len(batch) < page:
            break
    return out[:limit_total]


def collect_gamma_events(limit_total: int, page: int = 100) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    offset = 0
    while len(out) < limit_total:
        batch = _get(f"{GAMMA}/events", {
            "limit": page, "offset": offset,
            "active": "true", "closed": "false", "archived": "false",
            "order": "volume24hr", "ascending": "false",
        })
        if not isinstance(batch, list) or not batch:
            break
        out.extend(batch)
        offset += page
        time.sleep(0.25)
        if len(batch) < page:
            break
    return out[:limit_total]


def parse_token_ids(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        try:
            return [str(x) for x in json.loads(raw)]
        except Exception:  # noqa: BLE001
            return []
    return []


def collect_books(markets: List[Dict[str, Any]], n_markets: int) -> List[Dict[str, Any]]:
    """For the top-N markets by 24h volume, pull the full L2 order book, midpoint & spread
    for each outcome token, plus a 1-day price history."""
    books: List[Dict[str, Any]] = []
    picked = markets[:n_markets]
    for i, m in enumerate(picked):
        tok_ids = parse_token_ids(m.get("clobTokenIds"))
        outcomes = m.get("outcomes")
        try:
            outcomes = json.loads(outcomes) if isinstance(outcomes, str) else outcomes
        except Exception:  # noqa: BLE001
            outcomes = None
        rec: Dict[str, Any] = {
            "market_id": m.get("id"), "question": m.get("question"),
            "slug": m.get("slug"), "condition_id": m.get("conditionId"),
            "outcomes": outcomes, "token_ids": tok_ids,
            "gamma_spread": m.get("spread"), "gamma_bestBid": m.get("bestBid"),
            "gamma_bestAsk": m.get("bestAsk"), "gamma_lastTradePrice": m.get("lastTradePrice"),
            "volume24hr": m.get("volume24hr"), "liquidityNum": m.get("liquidityNum"),
            "orderPriceMinTickSize": m.get("orderPriceMinTickSize"),
            "orderMinSize": m.get("orderMinSize"), "negRisk": m.get("negRisk"),
            "tokens": [],
        }
        for j, tid in enumerate(tok_ids):
            tok: Dict[str, Any] = {"token_id": tid,
                                   "outcome": outcomes[j] if outcomes and j < len(outcomes) else None}
            try:
                tok["book"] = _get(f"{CLOB}/book", {"token_id": tid})
            except Exception as e:  # noqa: BLE001
                tok["book_error"] = str(e)
            try:
                tok["midpoint"] = _get(f"{CLOB}/midpoint", {"token_id": tid}).get("mid")
            except Exception:  # noqa: BLE001
                tok["midpoint"] = None
            try:
                tok["spread"] = _get(f"{CLOB}/spread", {"token_id": tid}).get("spread")
            except Exception:  # noqa: BLE001
                tok["spread"] = None
            rec["tokens"].append(tok)
            time.sleep(0.15)
        # 1-day price history keyed on the first (YES) token
        if tok_ids:
            try:
                rec["price_history_1d"] = _get(f"{CLOB}/prices-history",
                                               {"market": tok_ids[0], "interval": "1d", "fidelity": "10"}).get("history")
            except Exception:  # noqa: BLE001
                rec["price_history_1d"] = None
        books.append(rec)
        time.sleep(0.15)
    return books


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--markets", type=int, default=600)
    ap.add_argument("--events", type=int, default=200)
    ap.add_argument("--books", type=int, default=120)
    ap.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "data"))
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    started = now_iso()
    print(f"[{started}] collecting up to {args.markets} markets ...", flush=True)
    markets = collect_gamma_markets(args.markets)
    print(f"  -> {len(markets)} order-book markets", flush=True)

    print("collecting events ...", flush=True)
    events = collect_gamma_events(args.events)
    print(f"  -> {len(events)} events", flush=True)

    print(f"collecting order books for top {args.books} markets ...", flush=True)
    books = collect_books(markets, args.books)
    print(f"  -> {len(books)} book snapshots", flush=True)

    with open(os.path.join(args.outdir, "markets.json"), "w") as f:
        json.dump(markets, f)
    with open(os.path.join(args.outdir, "events.json"), "w") as f:
        json.dump(events, f)
    with open(os.path.join(args.outdir, "books.json"), "w") as f:
        json.dump(books, f)

    manifest = {
        "collector": "kichiko/tools/polymarket-research/collect.py",
        "started_utc": started, "finished_utc": now_iso(),
        "endpoints": {"gamma": GAMMA, "clob": CLOB, "data": DATA},
        "counts": {"markets": len(markets), "events": len(events), "books": len(books)},
        "params": vars(args),
        "note": "All endpoints public; no auth used. Snapshots are point-in-time.",
    }
    with open(os.path.join(args.outdir, "MANIFEST.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("MANIFEST:", json.dumps(manifest["counts"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
