#!/usr/bin/env python3
"""
backfill_entity_media.py — resolve & store per-option avatars (Layer 2 of
docs/design/ENTITY-IMAGERY.md). "Resolve once, store once, serve from CDN."

For every multiple_choice option (and, optionally, market cover) this:
  1. classifies the entity  (person | company | place | crypto | other)
  2. resolves a source image via a cheap→rich waterfall
       person  -> Wikipedia/Wikimedia REST thumbnail
       company -> DuckDuckGo icon  -> Google S2 favicon  -> Wikipedia logo
       place   -> flagcdn (country ISO-2)
  3. normalises to a square 256px WebP (people/flags: cover-crop; logos: contain+pad)
  4. uploads to the public Supabase Storage bucket `entity-media` (immutable, hashed name)
  5. persists image_url + entity_kind + entity_ref onto market_options

Idempotent: only fills rows where image_url IS NULL; filenames are content-hashed
so re-runs upsert the same object. Abstract options (issues, slogans, "None of the
above", numeric ranges) are intentionally left on the deterministic monogram.

Secrets come from the environment — NEVER hardcode them:
  SUPABASE_DB_URL         postgres connection string (pooler ok)
  SUPABASE_URL            https://<ref>.supabase.co
  SUPABASE_SERVICE_ROLE   service_role JWT (storage write + DB via REST if desired)

Usage:  python3 scripts/backfill_entity_media.py [--dry-run]
Deps:   pip install psycopg2-binary pillow requests
"""
from __future__ import annotations
import os, io, sys, json, time, hashlib, argparse
import requests
from PIL import Image

UA = {"User-Agent": "KichikoBot/1.0 (+https://kichiko.dev; media-ingest)"}
BUCKET = "entity-media"
SIZE = 256

# --- Curated classification. Extend as new entities appear. -------------------
# label -> wiki page title
PEOPLE = {n: n for n in [
    "William Ruto", "Rigathi Gachagua", "Kalonzo Musyoka", "Fred Matiang'i",
    "Kithure Kindiki", "Musalia Mudavadi", "Gladys Wanga", "Anne Waiguru",
    "Johnson Sakaja", "Hassan Joho", "Jimi Wanjigi", "Polycarp Igathe",
]}
# label -> primary domain (for logo services)
COMPANIES = {
    "TikTok": "tiktok.com", "X (Twitter)": "x.com", "WhatsApp": "whatsapp.com",
    "WhatsApp groups": "whatsapp.com", "YouTube": "youtube.com",
    "Instagram": "instagram.com", "Facebook": "facebook.com",
    "M-PESA": "safaricom.co.ke", "KCB": "kcbgroup.com",
    "Equity / Equitel": "equitygroupholdings.com", "Tala / Branch": "tala.co",
}
# label -> ISO-2 (flagcdn)
COUNTRIES = {"Kenya": "ke", "Ethiopia": "et", "Uganda": "ug"}
# company labels whose logo lives best on Wikipedia (icon services block them)
COMPANY_WIKI = {"Equity / Equitel": "Equity Group Holdings", "KCB": "Kenya Commercial Bank"}


def classify(label: str):
    if label in PEOPLE:   return "person", PEOPLE[label]
    if label in COMPANIES: return "company", COMPANIES[label]
    if label in COUNTRIES: return "place", COUNTRIES[label]
    return "other", None


def wiki_thumb(title: str):
    u = f"https://en.wikipedia.org/api/rest_v1/page/summary/{requests.utils.quote(title.replace(' ', '_'))}"
    r = requests.get(u, headers=UA, timeout=20)
    if r.status_code != 200:
        return None
    j = r.json()
    return (j.get("originalimage") or j.get("thumbnail") or {}).get("source")


def resolve_source(label: str, kind: str, ref: str | None):
    if kind == "person":
        return wiki_thumb(ref)
    if kind == "place":
        return f"https://flagcdn.com/w320/{ref}.png"
    if kind == "company":
        for u in (f"https://icons.duckduckgo.com/ip3/{ref}.ico",
                  f"https://www.google.com/s2/favicons?domain={ref}&sz=256"):
            try:
                r = requests.get(u, headers=UA, timeout=15)
                if r.ok and r.content and len(r.content) > 500:
                    return u
            except requests.RequestException:
                pass
        if label in COMPANY_WIKI:
            return wiki_thumb(COMPANY_WIKI[label])
    return None


def to_square_webp(content: bytes, cover: bool) -> bytes:
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


def upload(supa_url: str, service: str, webp: bytes) -> str:
    name = f"{hashlib.sha1(webp).hexdigest()[:16]}.webp"
    r = requests.post(
        f"{supa_url}/storage/v1/object/{BUCKET}/{name}",
        headers={"Authorization": f"Bearer {service}", "apikey": service,
                 "Content-Type": "image/webp", "x-upsert": "true"},
        data=webp,
    )
    r.raise_for_status()
    return f"{supa_url}/storage/v1/object/public/{BUCKET}/{name}"


def ensure_bucket(supa_url: str, service: str):
    requests.post(
        f"{supa_url}/storage/v1/bucket",
        headers={"Authorization": f"Bearer {service}", "apikey": service,
                 "Content-Type": "application/json"},
        json={"id": BUCKET, "name": BUCKET, "public": True,
              "file_size_limit": 5_242_880,
              "allowed_mime_types": ["image/webp", "image/png", "image/jpeg"]},
    )  # 200 created or 409 exists — both fine


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dsn = os.environ["SUPABASE_DB_URL"]
    supa_url = os.environ["SUPABASE_URL"].rstrip("/")
    service = os.environ["SUPABASE_SERVICE_ROLE"]

    import psycopg2
    conn = psycopg2.connect(dsn, connect_timeout=15)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT mo.label
        FROM market_options mo JOIN markets m ON m.id = mo.market_id
        WHERE m.resolution_type = 'multiple_choice' AND mo.image_url IS NULL
    """)
    labels = [r[0] for r in cur.fetchall()]

    if not args.dry_run:
        ensure_bucket(supa_url, service)

    filled = 0
    for label in labels:
        kind, ref = classify(label)
        if kind == "other":
            continue  # monogram by design
        src = resolve_source(label, kind, ref)
        if not src:
            print(f"skip  {label!r}: no source ({kind})")
            continue
        if args.dry_run:
            print(f"would {label!r} [{kind}] <- {src[:70]}")
            continue
        try:
            raw = requests.get(src, headers=UA, timeout=25)
            raw.raise_for_status()
            url = upload(supa_url, service, to_square_webp(raw.content, cover=(kind in ("person", "place"))))
            cur.execute(
                "UPDATE market_options SET image_url=%s, entity_kind=%s, entity_ref=%s "
                "WHERE label=%s AND image_url IS NULL",
                (url, kind, ref, label),
            )
            filled += cur.rowcount
            print(f"ok    {label!r} [{kind}] -> {url.rsplit('/', 1)[-1]} ({cur.rowcount} rows)")
        except Exception as e:  # noqa: BLE001
            print(f"error {label!r}: {e}")
        time.sleep(0.05)

    cur.close(); conn.close()
    print(f"\nDone. {filled} option rows updated.")


if __name__ == "__main__":
    main()
