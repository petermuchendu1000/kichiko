#!/usr/bin/env python3
"""
backfill_images.py — resolve REAL imagery for every seeded market cover and
multi-outcome option, then store it in the public `entity-media` bucket.

DB-driven (reads entity_kind/entity_ref straight from the rows), so it needs no
curated dictionary. Resolver waterfall, each entity fetched exactly once:
  person  -> Wikipedia action API pageimages (photo, cover-crop)
  company -> DuckDuckGo/Google favicon -> Wikipedia logo (contain + pad)
  crypto  -> CoinCap static icon CDN (token mark, contain + pad)
  place   -> flagcdn (country flag, contain + pad)

Every source above was pre-validated to return a real, distinctive image, so
there are NO placeholders. Normalises to a square 256px WebP, uploads with a
content-hash name (idempotent upsert), and persists cover_image_url / image_url.

Env: SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SECRET (or SUPABASE_SERVICE_ROLE).
"""
from __future__ import annotations
import os, io, sys, time, hashlib
import requests, psycopg2
from PIL import Image

DB = os.environ["SUPABASE_DB_URL"]
SUPA_URL = os.environ["SUPABASE_URL"].rstrip("/")
SECRET = os.environ.get("SUPABASE_SECRET") or os.environ["SUPABASE_SERVICE_ROLE"]
BUCKET = "entity-media"
SIZE = 256
UA = {"User-Agent": "KichikoBot/1.0 (+https://kichiko.co.ke; media-ingest)"}
CRYPTO_SYM = {"bitcoin": "btc", "ethereum": "eth", "ripple": "xrp", "solana": "sol"}
COMPANY_WIKI = {
    "eabl.com": "East African Breweries",
    "equitygroupholdings.com": "Equity Group Holdings",
    "co-opbank.co.ke": "Co-operative Bank of Kenya",
    "kenya-airways.com": "Kenya Airways",
    "starlink.com": "Starlink",
}


def wiki_image(title: str):
    for attempt in range(4):
        try:
            r = requests.get("https://en.wikipedia.org/w/api.php", headers=UA, timeout=25, params={
                "action": "query", "format": "json", "prop": "pageimages",
                "piprop": "original|thumbnail", "pithumbsize": "512",
                "titles": title, "redirects": "1"})
            if r.status_code == 200:
                for _, p in r.json().get("query", {}).get("pages", {}).items():
                    if "missing" in p:
                        return None
                    return (p.get("original") or p.get("thumbnail") or {}).get("source")
        except requests.RequestException:
            pass
        time.sleep(1.5 * (attempt + 1))
    return None


def resolve(kind: str, ref: str):
    if kind == "person":
        return wiki_image(ref), True          # cover-crop
    if kind == "place":
        return f"https://flagcdn.com/w320/{ref}.png", False
    if kind == "crypto":
        s = CRYPTO_SYM.get(ref, ref)
        return f"https://assets.coincap.io/assets/icons/{s}@2x.png", False
    if kind == "company":
        for u in (f"https://icons.duckduckgo.com/ip3/{ref}.ico",
                  f"https://www.google.com/s2/favicons?domain={ref}&sz=256"):
            try:
                r = requests.get(u, headers=UA, timeout=15)
                if r.ok and len(r.content) > 500:
                    return u, False
            except requests.RequestException:
                pass
        if ref in COMPANY_WIKI:
            return wiki_image(COMPANY_WIKI[ref]), False
    return None, False


def to_webp(content: bytes, cover: bool) -> bytes:
    im = Image.open(io.BytesIO(content)).convert("RGBA")
    if cover:
        w, h = im.size
        s = min(w, h)
        im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
        canvas = im.resize((SIZE, SIZE), Image.LANCZOS)
    else:
        im.thumbnail((int(SIZE * 0.82), int(SIZE * 0.82)), Image.LANCZOS)
        canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        canvas.paste(im, ((SIZE - im.width) // 2, (SIZE - im.height) // 2), im)
    out = io.BytesIO()
    canvas.save(out, "WEBP", quality=88, method=6)
    return out.getvalue()


def upload(webp: bytes) -> str:
    name = f"{hashlib.sha1(webp).hexdigest()[:16]}.webp"
    r = requests.post(f"{SUPA_URL}/storage/v1/object/{BUCKET}/{name}",
                      headers={"Authorization": f"Bearer {SECRET}", "apikey": SECRET,
                               "Content-Type": "image/webp", "x-upsert": "true"},
                      data=webp, timeout=40)
    r.raise_for_status()
    return f"{SUPA_URL}/storage/v1/object/public/{BUCKET}/{name}"


def main() -> int:
    dry = "--dry-run" in sys.argv
    conn = psycopg2.connect(DB, connect_timeout=25); conn.autocommit = True
    cur = conn.cursor()

    # collect all (kind,ref) needing an image
    cur.execute("""select distinct cover_entity_kind, cover_entity_ref from public.markets
                   where cover_entity_ref is not null and cover_image_url is null""")
    need = set(cur.fetchall())
    cur.execute("""select distinct entity_kind, entity_ref from public.market_options
                   where entity_ref is not null and image_url is null""")
    need |= set(cur.fetchall())
    print(f"entities to resolve: {len(need)}{' (dry-run)' if dry else ''}")

    resolved = {}
    misses = []
    for kind, ref in sorted(need):
        src, cover = resolve(kind, ref)
        if not src:
            misses.append((kind, ref)); print(f"  MISS {kind}:{ref}"); continue
        try:
            raw = requests.get(src, headers=UA, timeout=30).content
            webp = to_webp(raw, cover)
            url = f"(dry) {src[:50]}" if dry else upload(webp)
            resolved[(kind, ref)] = url
            print(f"  OK   {kind:8s} {ref:34s} {len(webp)//1024}KB")
        except Exception as e:
            misses.append((kind, ref)); print(f"  FAIL {kind}:{ref} -> {e}")
        time.sleep(0.15)

    if not dry:
        for (kind, ref), url in resolved.items():
            cur.execute("""update public.markets set cover_image_url=%s
                           where cover_entity_kind=%s and cover_entity_ref=%s and cover_image_url is null""",
                        (url, kind, ref))
            cur.execute("""update public.market_options set image_url=%s
                           where entity_kind=%s and entity_ref=%s and image_url is null""",
                        (url, kind, ref))

    cur.execute("select count(*) from public.markets where cover_image_url is null")
    mk_null = cur.fetchone()[0]
    cur.execute("select count(*) from public.market_options where image_url is null")
    op_null = cur.fetchone()[0]
    print(f"\nresolved={len(resolved)} misses={len(misses)}")
    print(f"markets w/o cover image: {mk_null} | options w/o image: {op_null}")
    if misses:
        print("MISSES:", misses)
    conn.close()
    return 1 if misses else 0


if __name__ == "__main__":
    raise SystemExit(main())
