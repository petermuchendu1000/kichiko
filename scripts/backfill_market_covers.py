#!/usr/bin/env python3
"""
backfill_market_covers.py — give every market the logo of the body that
actually decides it, sized so it is legible at card scale.

WHY THIS EXISTS (measured 2026-10-15, 36 visible active markets)

1. Fifteen markets fell back to `place: ke` — the Kenya flag — including every
   election, both AFCON markets, the CBK rate market and the SHA coverage
   market. A flag says "Kenya", which the reader already knows; it does not say
   "the IEBC runs this election".

2. The stored covers were 256x256 WebP of 0-1KB. Measuring the alpha bounding
   box showed why: the artwork occupied 1.1%-3.5% of the canvas on six of eight
   sampled covers (YouTube 32x22, Kenya Airways 32x32, Safaricom 48x32). A
   favicon had been upscaled into a large transparent square, so at a 38px card
   icon the logo rendered about five pixels wide.

THE THREE RULES THIS ADDS

  • An ORGANISATIONS registry plus ordered RULES, so a market resolves to the
    authoritative body (election -> IEBC, AFCON -> CAF, rates/FX -> CBK) rather
    than to a country.
  • A QUALITY GATE. A source whose artwork is natively smaller than
    MIN_SOURCE_PX is rejected and the waterfall continues, so a 16x16 favicon
    can never become a 256px cover again.
  • TRIM AND FILL. The artwork is cropped to its own bounding box and rescaled
    to occupy TARGET_FILL of the canvas, so every logo carries the same optical
    weight regardless of how much padding its source shipped with.

Idempotent: content-hashed filenames, and `--only-poor` re-does just the covers
that fail the fill test, so a rate-limited run can be repeated safely.

Network note: Wikimedia rate-limits by IP and will 429 a shared egress; the
waterfall falls through to favicons in that case and `--only-poor` picks the
rest up on a later run from a normal address.

Secrets come from the environment — never hardcode:
  SUPABASE_URL            https://<ref>.supabase.co
  SUPABASE_SERVICE_ROLE   service_role JWT (storage write)
  SUPABASE_ACCESS_TOKEN   management API token (SQL over HTTPS)
  SUPABASE_PROJECT_REF    project ref

Usage:
  python3 scripts/backfill_market_covers.py --dry-run
  python3 scripts/backfill_market_covers.py --only-poor
  python3 scripts/backfill_market_covers.py --apply
Deps: pip install pillow requests
"""
from __future__ import annotations

import argparse
import hashlib
import io
import os
import re
import sys
import time
from urllib.parse import urljoin, urlparse

import requests
from PIL import Image

UA = {"User-Agent": "KichikoBot/1.0 (https://kichiko.app; media-ingest; contact support@kichiko.app)"}
BUCKET = "entity-media"
CANVAS = 256

# A source whose artwork is natively smaller than this is a favicon, not a
# logo. Upscaling one is what produced the 1.1%-fill covers this replaces.
MIN_SOURCE_PX = 56
# Share of the canvas the artwork should occupy once trimmed and rescaled.
# Measured against the two covers that already looked right: WhatsApp filled
# 57% and Equity 28%; 78% reads cleanly at 38px without touching the edges.
TARGET_FILL = 0.78
# Below this, an existing cover counts as "poor" for --only-poor.
POOR_FILL = 0.35
# Wikimedia asks for paced access; this is deliberately generous.
WIKI_PAUSE_S = 2.5


# --------------------------------------------------------------------------
# Registry: the bodies that actually decide these markets.
# `wiki` is an English Wikipedia page title; `domain` is the official site.
# Both are tried, best quality first.
# --------------------------------------------------------------------------
ORGANISATIONS: dict[str, dict] = {
    "iebc":        {"name": "IEBC",                 "wiki": "Independent Electoral and Boundaries Commission", "domain": "iebc.or.ke"},
    "caf":         {"name": "CAF",                  "wiki": "Africa Cup of Nations",                           "domain": "cafonline.com"},
    "fkf":         {"name": "Football Kenya Federation", "wiki": "Football Kenya Federation",                  "domain": "footballkenya.org"},
    "cbk":         {"name": "Central Bank of Kenya", "wiki": "Central Bank of Kenya",                          "domain": "centralbank.go.ke"},
    "knbs":        {"name": "KNBS",                 "wiki": "Kenya National Bureau of Statistics",             "domain": "knbs.or.ke"},
    "kra":         {"name": "KRA",                  "wiki": "Kenya Revenue Authority",                         "domain": "kra.go.ke"},
    "parliament":  {"name": "Parliament of Kenya",  "wiki": "Parliament of Kenya",                             "domain": "parliament.go.ke"},
    "treasury":    {"name": "The National Treasury", "wiki": None,                                             "domain": "treasury.go.ke"},
    "sha":         {"name": "SHA",                  "wiki": None,                                              "domain": "sha.go.ke"},
    "nse":         {"name": "NSE",                  "wiki": "Nairobi Securities Exchange",                     "domain": "nse.co.ke"},
    "meteo":       {"name": "Kenya Met Department", "wiki": None,                                              "domain": "meteo.go.ke"},
    "bomayangu":   {"name": "Affordable Housing",   "wiki": None,                                              "domain": "bomayangu.go.ke"},
    "berlin":      {"name": "Berlin Marathon",      "wiki": "Berlin Marathon",                                 "domain": "bmw-berlin-marathon.com"},
    "dcp":         {"name": "DCP",                  "wiki": "Democracy for the Citizens Party",                "domain": None},
}

# Domain -> English Wikipedia title, so a company whose favicon is too small to
# clear the quality gate can still reach its real logo. Measured: Safaricom,
# Equity, Kenya Airways, Starlink and KRA all ship favicons under 56px, which
# is precisely how they ended up as 2%-fill covers.
COMPANY_WIKI: dict[str, str] = {
    "safaricom.co.ke": "Safaricom",
    "equitygroupholdings.com": "Equity Group Holdings",
    "kenya-airways.com": "Kenya Airways",
    "starlink.com": "Starlink",
    "x.com": "Twitter",
    "youtube.com": "YouTube",
    "whatsapp.com": "WhatsApp",
    "kra.go.ke": "Kenya Revenue Authority",
}

# Categories where the market is about the PROCESS, not any one candidate, so
# the administering body belongs on the cover. The candidates keep their faces
# on the option rows (market_options.image_url), which is where a person
# actually identifies something.
# A market with this many outcomes or more is a contest between contenders, so
# its cover must be neutral. See target_entity().
CONTEST_MIN_OPTIONS = 2

# Ordered; first match wins. (regex over the title, optional category, org key)
RULES: list[tuple[str, str | None, str]] = [
    # Sport — the competition's own body, not a flag.
    (r"\bafcon\b|africa cup",                      None,         "caf"),
    (r"\bberlin marathon\b",                       None,         "berlin"),
    (r"\bqualifier\b|\bgroup stage\b|harambee",    "sports",     "fkf"),
    (r"\btalanta\b|\bstadium\b",                   "sports",     "caf"),
    # Elections — the commission that runs and declares them.
    # "presiden" not "president": "presidency" shares only the stem
    # (presiden-cy vs presiden-t), so the longer form silently missed the
    # 2027 presidency market.
    (r"presiden|flagbearer|governor|\bmps?\b|ballot|re-election|election", "elections", "iebc"),
    (r"\bdcp\b",                                   None,         "dcp"),
    # Money — the institution that sets or reports the number.
    (r"base rate|\bcbk\b|\bkes\b|shilling|/usd",   None,         "cbk"),
    (r"inflation|\bcpi\b",                         None,         "knbs"),
    # Legislation outranks revenue: a market on whether a bill PASSES is about
    # the legislature, whoever collects the money afterwards. With KRA first,
    # "Tax Amendments Bill passed by Dec 2026?" and "Finance Bill sparks
    # protests in 5+ counties?" both wore the Revenue Authority's logo on a
    # question that is decided in the National Assembly.
    (r"\bbill\b|parliament|amendment|\bact\b",     None,         "parliament"),
    (r"\btax\b|\bvat\b|levy|\bkra\b|revenue",      None,         "kra"),
    (r"\bnse\b|blue-chip|securities exchange",     None,         "nse"),
    # Public services and weather.
    (r"\bsha\b|health|insurance",                  None,         "sha"),
    (r"housing|\bhouses?\b|affordable",            None,         "bomayangu"),
    (r"el ni|flood|drought|rainfall|weather",      None,         "meteo"),
]


def pick_org(title: str, category: str) -> str | None:
    """First matching rule wins; None means keep whatever the market has."""
    t = title.lower()
    for pattern, cat, key in RULES:
        if cat and cat != category:
            continue
        if re.search(pattern, t):
            return key
    return None


def target_entity(m: dict) -> tuple[str, dict] | None:
    """
    What this market's cover SHOULD depict.

    Org rules only displace the generic country flag. They must not displace a
    specific company, person or token: "Equity Group profit above KES 50B" and
    "Safaricom above KES 30" both match the currency rule on "KES", and letting
    that win would have replaced two correct company logos with the Central
    Bank's. A market already pointing at the right subject keeps it, and is
    re-resolved only to fix the IMAGE.

    THE ONE EXCEPTION is a contest. A market with several candidate outcomes
    has no single subject, so a contender's own mark on the cover reads as a
    house favourite — "Who wins Kenya's 2027 presidency?" (5 candidates) wore
    Ruto's photograph, and "Opposition flagbearer for 2027?" (5 candidates)
    wore Gachagua's, which illustrates the answer to the very question being
    priced. On a money product that is a fairness defect, not a styling one.
    So an org mark displaces a contender's mark when, and only when, the market
    has CONTEST_MIN_OPTIONS outcomes or more.

    Option count decides this, not category. Both the markets above are
    `elections`, but so are "Sakaja wins re-election as Nairobi Governor?" and
    "DCP wins 100+ MPs in 2027?", which have one outcome each and are genuinely
    about Sakaja and about Gachagua's party. Overriding by category replaced
    those two correct portraits with the IEBC logo; overriding by option count
    keeps them and still neutralises the two contests. Per-outcome avatars keep
    carrying each contender's face either way, which is also how Polymarket
    splits it: neutral event image, portraits on the rows.
    """
    kind = (m.get("cover_entity_kind") or "").lower()
    ref = m.get("cover_entity_ref") or ""
    category = (m.get("category") or "").lower()
    options = int(m.get("option_count") or 0)

    if kind in ("person", "company", "crypto") and options >= CONTEST_MIN_OPTIONS:
        key = pick_org(m["title"], category)
        if key:
            return key, ORGANISATIONS[key]

    if kind in ("", "place"):
        key = pick_org(m["title"], category)
        if key:
            return key, ORGANISATIONS[key]
        return None

    # Already pointed at an organisation. Re-run the rules so a correction to
    # RULES actually reaches markets a previous run has written: without this
    # branch an org cover was permanent, and moving legislation markets from
    # KRA to Parliament changed nothing because every one of them was already
    # kind='org'. A market whose rules no longer match keeps the org it has.
    if kind == "org":
        key = pick_org(m["title"], category) or (ref if ref in ORGANISATIONS else None)
        if key:
            return key, ORGANISATIONS[key]
        return None

    # Specific subject already set: keep it, re-resolve from its own reference.
    if kind == "company" and ref:
        return f"company:{ref}", {"name": ref, "wiki": COMPANY_WIKI.get(ref), "domain": ref}
    if kind == "person" and ref:
        return f"person:{ref}", {"name": ref, "wiki": ref, "domain": None}
    return None


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------
SESSION = requests.Session()
SESSION.headers.update(UA)


# Rasterising SVG is optional. A vector mark is the best source there is — it
# trims and rescales without ever softening — but the script must still run on
# a machine without cairo, so the import is guarded and SVG sources are simply
# skipped when it is missing.
try:
    import cairosvg  # type: ignore
except Exception:  # pragma: no cover - environment-dependent
    cairosvg = None

SVG_RASTER_PX = 1024


def _is_svg(content: bytes) -> bool:
    head = content[:400].lstrip()
    return head.startswith(b"<svg") or (
        head.startswith(b"<?xml") and b"<svg" in content[:2000]
    )


def _open(content: bytes) -> Image.Image | None:
    if _is_svg(content):
        if cairosvg is None:
            _note("SVG source but cairosvg is not installed")
            return None
        try:
            content = cairosvg.svg2png(bytestring=content, output_width=SVG_RASTER_PX)
        except Exception:
            return None
    try:
        im = Image.open(io.BytesIO(content))
        im.load()
        return im.convert("RGBA")
    except Exception:
        return None


TRANSIENT = {408, 425, 429, 500, 502, 503, 504}
FETCH_TRIES = 4

# Why the last resolve() failed. "no source cleared the quality gate" was
# reported for both a 429 and a genuinely 32px favicon, so a run that lost CAF
# to Wikimedia rate-limiting looked identical to one that had found CAF's logo
# and judged it too small. Only the first is worth retrying.
_last_err: str = ""


def _note(msg: str) -> None:
    global _last_err
    _last_err = msg


def _get_image(url: str, timeout: int = 25) -> Image.Image | None:
    """GET an image, retrying transient failures with exponential backoff."""
    for attempt in range(FETCH_TRIES):
        try:
            r = SESSION.get(url, timeout=timeout)
            if r.status_code in TRANSIENT:
                _note(f"HTTP {r.status_code} from {urlparse(url).netloc}")
                if attempt < FETCH_TRIES - 1:
                    time.sleep(2 ** attempt * 1.5)
                    continue
                return None
            if r.status_code != 200:
                _note(f"HTTP {r.status_code} from {urlparse(url).netloc}")
                return None
            if len(r.content) < 200:
                _note(f"{len(r.content)}-byte body from {urlparse(url).netloc}")
                return None
            im = _open(r.content)
            if im is None:
                _note(f"undecodable image from {urlparse(url).netloc}")
            return im
        except Exception as exc:  # network/TLS/timeout — all worth a retry
            _note(f"{type(exc).__name__} from {urlparse(url).netloc}")
            if attempt < FETCH_TRIES - 1:
                time.sleep(2 ** attempt * 1.5)
                continue
            return None
    return None


def wiki_image(title: str) -> Image.Image | None:
    """Original (not thumbnail) image from the page summary. Paced."""
    time.sleep(WIKI_PAUSE_S)
    try:
        slug = requests.utils.quote(title.replace(" ", "_"))
        r = SESSION.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{slug}", timeout=25)
        if r.status_code != 200:
            _note(f"HTTP {r.status_code} from en.wikipedia.org (summary)")
            return None
        j = r.json()
        src = (j.get("originalimage") or j.get("thumbnail") or {}).get("source")
        if not src:
            return None
        time.sleep(WIKI_PAUSE_S)
        return _get_image(src)
    except Exception:
        return None


def _wiki_api(params: dict) -> dict:
    """Paced action-API call with the same backoff as _get_image."""
    for attempt in range(FETCH_TRIES):
        time.sleep(WIKI_PAUSE_S)
        try:
            r = SESSION.get("https://en.wikipedia.org/w/api.php",
                            params={**params, "format": "json"}, timeout=30)
            if r.status_code in TRANSIENT:
                _note(f"HTTP {r.status_code} from en.wikipedia.org (api)")
                time.sleep(2 ** attempt * 4)
                continue
            if r.status_code != 200:
                _note(f"HTTP {r.status_code} from en.wikipedia.org (api)")
                return {}
            return r.json()
        except Exception as exc:
            _note(f"{type(exc).__name__} from en.wikipedia.org (api)")
            time.sleep(2 ** attempt * 4)
    return {}


def wiki_file_image(title: str, name: str) -> Image.Image | None:
    """
    The logo from the article's FILE LIST rather than its summary.

    Wikipedia's summary API omits non-free files, and a Kenyan company or
    agency logo is almost always non-free fair use — Safaricom and the Kenya
    Revenue Authority both return a summary with no image at all, which is why
    they fell through to a 48x34 and a 16x16 favicon. The file is still hosted
    and still fetchable; it is only the summary that leaves it out.
    """
    j = _wiki_api({"action": "query", "titles": title, "prop": "images", "imlimit": "80"})
    files = [
        i["title"]
        for p in j.get("query", {}).get("pages", {}).values()
        for i in p.get("images", [])
        if i["title"].lower().endswith((".svg", ".png", ".jpg", ".jpeg"))
    ]
    if not files:
        return None

    first = name.split()[0].lower() if name.split() else ""

    def rank(f: str) -> tuple:
        low = f.lower()
        # Prefer a file that says "logo", then one naming the subject, then
        # vectors over rasters. Commons chrome (flags, icons, maps) sinks.
        return (
            0 if "logo" in low else 1,
            0 if first and first in low else 1,
            0 if low.endswith(".svg") else 1,
            len(low),
        )

    noise = ("commons-logo", "wikidata", "wiktionary", "folder", "edit-", "question_book",
             "ambox", "symbol_", "flag_of", "location_map", "red_pog", "wikisource",
             # Infobox status glyphs. These are large, clean vectors that sail
             # through the quality gate while depicting nothing: Safaricom's
             # cover became a plain red "decrease" triangle this way.
             "decrease", "increase", "steady", "arrow", "nochange", "divided")
    files = [f for f in files if not any(n in f.lower() for n in noise)]

    # The file must plausibly BE the subject's mark. Ranking alone was not
    # enough: with nothing better available the sort still returned its least
    # bad option, and an article's images include charts, photographs and
    # national symbols that are not the logo. Declining here is the right
    # outcome, not a failure — Safaricom's own masthead carries the real
    # vector wordmark, which the next source finds.
    files = [f for f in files if "logo" in f.lower() or (first and first in f.lower())]
    if not files:
        return None

    for cand in sorted(files, key=rank)[:3]:
        info = _wiki_api({"action": "query", "titles": cand, "prop": "imageinfo",
                          "iiprop": "url", "iiurlwidth": str(SVG_RASTER_PX)})
        for p in info.get("query", {}).get("pages", {}).values():
            for ii in p.get("imageinfo", []):
                # thumburl renders SVG server-side; url is the original.
                src = ii.get("thumburl") or ii.get("url")
                if not src:
                    continue
                im = _get_image(src)
                if im is not None and good_enough(im):
                    return im
    return None


OG_RE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]*content=["\']([^"\']+)',
    re.I,
)


IMG_RE = re.compile(r'<img[^>]+>', re.I)
SRC_RE = re.compile(r'(?:data-src|src)=["\']([^"\']+)', re.I)


def _masthead_candidates(html: str, page_url: str) -> list[str]:
    """
    Logo images declared in the page's own markup, best first.

    Restricted to a filename containing "logo" or any SVG, because a site's
    /images/logos/ directory is not only logos: Safaricom's holds six
    promotional tiles (DataAndVoice1.png, PromotionsAndOffers.png) beside the
    real mark, each large enough to clear the quality gate and each completely
    wrong. The restriction leaves mobile-logo.svg, which is the actual vector
    wordmark, and KRA's logoKRA.webp.
    """
    out: list[str] = []
    seen: set[str] = set()
    for tag in IMG_RE.findall(html):
        if "logo" not in tag.lower():
            continue
        m = SRC_RE.search(tag)
        if not m:
            continue
        url = urljoin(page_url, m.group(1).split("#")[0])
        name = urlparse(url).path.rsplit("/", 1)[-1].lower()
        if "logo" not in name and not name.endswith(".svg"):
            continue
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
    # A vector never pixelates, so it wins regardless of where it appeared.
    out.sort(key=lambda u: (0 if u.lower().endswith(".svg") else 1,))
    return out[:4]


def site_logo_image(domain: str) -> Image.Image | None:
    """
    The logo a site publishes about itself: its share image, then its masthead.

    Kenya Airways serves `og:image` as `kq-coloured.svg` — the actual vector
    wordmark — while its favicon is 32x32. A share image is authored to be
    seen at size, so it clears the quality gate where an icon cannot. Sites
    with no share image (KRA, Safaricom) still render a real logo in the
    masthead: 152x37 and a 1024px vector respectively, against the 16x16 and
    48x34 favicons that were all this script could previously find.
    """
    for base in (f"https://www.{domain}/", f"https://{domain}/"):
        try:
            r = SESSION.get(base, timeout=25, allow_redirects=True)
            if r.status_code != 200 or len(r.text) < 500:
                continue
            m = OG_RE.search(r.text)
            if m:
                im = _get_image(urljoin(r.url, m.group(1)))
                if im is not None and good_enough(im):
                    return im
            for url in _masthead_candidates(r.text, r.url):
                im = _get_image(url)
                if im is not None and good_enough(im):
                    return im
            return None
        except Exception as exc:
            _note(f"{type(exc).__name__} from {domain}")
    return None


def favicon_image(domain: str) -> Image.Image | None:
    for url in (
        f"https://www.google.com/s2/favicons?domain={domain}&sz=256",
        f"https://icons.duckduckgo.com/ip3/{domain}.ico",
        f"https://{domain}/apple-touch-icon.png",
    ):
        im = _get_image(url, timeout=18)
        if im is not None:
            return im
    return None


def artwork_box(im: Image.Image) -> tuple[int, int, int, int] | None:
    """
    Bounding box of the real artwork. Uses alpha when present, otherwise the
    non-white region, so a logo on a flat white background trims too.
    """
    alpha = im.split()[-1]
    if alpha.getextrema()[0] < 250:
        return alpha.getbbox()
    grey = im.convert("L")
    # Anything meaningfully darker than paper counts as ink.
    mask = grey.point(lambda p: 255 if p < 246 else 0)
    return mask.getbbox()


def good_enough(im: Image.Image) -> bool:
    """Reject favicons: judge the ARTWORK, not the canvas it arrived on."""
    box = artwork_box(im)
    if not box:
        return False
    w, h = box[2] - box[0], box[3] - box[1]
    return max(w, h) >= MIN_SOURCE_PX


def normalise(im: Image.Image) -> bytes:
    """Trim to the artwork, then rescale it to fill TARGET_FILL of a square."""
    box = artwork_box(im)
    if box:
        im = im.crop(box)
    target = int(CANVAS * TARGET_FILL)
    scale = min(target / im.width, target / im.height)
    new = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    im = im.resize(new, Image.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((CANVAS - new[0]) // 2, (CANVAS - new[1]) // 2))
    buf = io.BytesIO()
    canvas.save(buf, "WEBP", quality=92, method=6)
    return buf.getvalue()


def resolve(org: dict) -> tuple[bytes, str] | None:
    """
    Best source first, quality-gated throughout.

    Order is by how large the artwork was authored to be rendered: a Wikipedia
    infobox image and a social share image are made to be looked at, a favicon
    is made to be 16px. Favicons stay last and are usually rejected by the
    gate — they are the fallback that produced the 1.1%-3.5% fills this script
    exists to repair.
    """
    _note("")
    too_small: list[str] = []

    def gate(im: Image.Image | None, label: str) -> bytes | None:
        if im is None:
            return None
        if good_enough(im):
            return normalise(im)
        box = artwork_box(im)
        too_small.append(
            f"{label} artwork {box[2] - box[0]}x{box[3] - box[1]}px" if box
            else f"{label} artwork empty"
        )
        return None

    if org.get("wiki"):
        out = gate(wiki_image(org["wiki"]), "wikipedia")
        if out:
            return out, "wikipedia"
        # Non-free logos are absent from the summary but present in the
        # article's file list.
        out = gate(wiki_file_image(org["wiki"], org.get("name") or org["wiki"]), "wikifile")
        if out:
            return out, "wikifile"
    if org.get("domain"):
        out = gate(site_logo_image(org["domain"]), "og:image")
        if out:
            return out, "og:image"
        out = gate(favicon_image(org["domain"]), "favicon")
        if out:
            return out, "favicon"

    if too_small:
        _note("; ".join(too_small) + f" (need >= {MIN_SOURCE_PX}px)")
    return None


def fail_reason() -> str:
    return _last_err or "no source reachable"


# --------------------------------------------------------------------------
# Supabase over HTTPS (direct Postgres is not reachable from every runner)
# --------------------------------------------------------------------------
def sql(query: str) -> list[dict]:
    r = SESSION.post(
        f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/database/query",
        headers={"Authorization": f"Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
                 "Content-Type": "application/json"},
        json={"query": query},
        timeout=60,
    )
    if r.status_code >= 400:
        # raise_for_status() discards the body, which is where Postgres puts the
        # actual reason (constraint name, column, hint). Surface it.
        raise RuntimeError(
            f"query failed {r.status_code}: {r.text[:600]}\n--- sql ---\n{query[:600]}"
        )
    out = r.json()
    return out if isinstance(out, list) else []


def upload(webp: bytes, key: str) -> str:
    digest = hashlib.sha256(webp).hexdigest()[:16]
    path = f"org/{key}-{digest}.webp"
    base = os.environ["SUPABASE_URL"].rstrip("/")
    service = os.environ["SUPABASE_SERVICE_ROLE"]
    r = SESSION.post(
        f"{base}/storage/v1/object/{BUCKET}/{path}",
        headers={"Authorization": f"Bearer {service}", "apikey": service,
                 "Content-Type": "image/webp",
                 "Cache-Control": "public, max-age=31536000, immutable",
                 "x-upsert": "true"},
        data=webp, timeout=60,
    )
    if r.status_code not in (200, 201):
        raise RuntimeError(f"upload {path}: {r.status_code} {r.text[:120]}")
    return f"{base}/storage/v1/object/public/{BUCKET}/{path}"


def current_fill(url: str) -> float | None:
    """
    How much of a cover's width the artwork spans. None if unreadable.

    LINEAR, deliberately, because normalise() scales linearly: it sets the
    artwork's longest side to TARGET_FILL of the canvas. Measuring area
    instead made the two incomparable, and the error was not academic — a
    wordmark is wide, so Safaricom's logo, normalised exactly as intended,
    measured 13% by area against a 35% floor. It was judged defective,
    re-resolved and re-uploaded on every single run, and no run could ever
    fix it. Any mark wider than about 2.2:1 behaved the same way.

    Measured linearly, a correctly normalised cover reads TARGET_FILL whatever
    its aspect ratio, and POOR_FILL means what it says: the artwork spans less
    than a third of the icon.
    """
    im = _get_image(url, timeout=18)
    if im is None:
        return None
    box = artwork_box(im)
    if not box:
        return 0.0
    span = max(box[2] - box[0], box[3] - box[1])
    return span / float(max(im.width, im.height))


# (title, category, cover_entity_kind, cover_entity_ref, option_count, expected key)
ROUTING_CASES = [
    # A contest is neutral: 5 candidates must not wear one candidate's face.
    ("Who wins Kenya's 2027 presidency?", "elections", "person", "William Ruto", 5, "iebc"),
    ("Opposition flagbearer for 2027?", "elections", "person", "Rigathi Gachagua", 5, "iebc"),
    ("Biggest NSE blue-chip gainer, H2 2026?", "business", "company", "safaricom.co.ke", 4, "nse"),
    # ... but a single-subject market keeps its subject, same category.
    ("Sakaja wins re-election as Nairobi Governor?", "elections", "person",
     "Johnson Sakaja", 1, "person:Johnson Sakaja"),
    ("DCP wins 100+ MPs in 2027?", "elections", "person",
     "Rigathi Gachagua", 1, "person:Rigathi Gachagua"),
    # A contest with no neutral authority keeps its mark rather than blanking.
    ("Most-used app in Kenya, end of 2026?", "technology", "company",
     "whatsapp.com", 5, "company:whatsapp.com"),
    # Org rules never displace a named company matched only on a currency word.
    ("Equity Group profit above KES 50B in 2026?", "business", "company",
     "equitygroupholdings.com", 1, "company:equitygroupholdings.com"),
    ("Safaricom above KES 30 by Dec 2026?", "business", "company",
     "safaricom.co.ke", 1, "company:safaricom.co.ke"),
    # Legislation outranks revenue; a pure levy still goes to KRA.
    ("Tax Amendments Bill passed by Dec 2026?", "economics", "org", "kra", 1, "parliament"),
    ("Finance Bill sparks protests in 5+ counties?", "politics", "org", "kra", 1, "parliament"),
    ("Housing Levy scrapped before 2027 vote?", "economics", "org", "kra", 1, "kra"),
    # An org cover is re-evaluated, not frozen.
    ("CBK cuts base rate below 9% in 2026?", "economics", "org", "cbk", 1, "cbk"),
    ("AFCON 2027 winner?", "sports", "place", "ke", 6, "caf"),
]

SVG_CASES = [
    (b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', True),
    (b'<?xml version="1.0"?>\n<svg xmlns="x"></svg>', True),
    (b'<?xml version="1.0"?>\n<rss><channel/></rss>', False),   # a feed is not a logo
    (b"\x89PNG\r\n\x1a\n", False),
    (b"RIFF....WEBP", False),
]


def self_test() -> int:
    """Routing and sniffing only — no network, no credentials."""
    bad = 0
    for title, cat, kind, ref, opts, want in ROUTING_CASES:
        picked = target_entity({"title": title, "category": cat, "cover_entity_kind": kind,
                                "cover_entity_ref": ref, "option_count": opts})
        got = picked[0] if picked else None
        bad += got != want
        print(f"  {'PASS' if got == want else 'FAIL'}  {title[:46]:48s} opts={opts} -> {got}")
    for content, want in SVG_CASES:
        got = _is_svg(content)
        bad += got != want
        print(f"  {'PASS' if got == want else 'FAIL'}  _is_svg {content[:26]!r} -> {got}")
    print("\n" + ("all pass" if not bad else f"{bad} FAILURES"))
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to storage and the database")
    ap.add_argument("--dry-run", action="store_true", help="resolve and report, change nothing")
    ap.add_argument("--only-poor", action="store_true",
                    help="only markets whose current cover is missing or under-filled")
    ap.add_argument("--self-test", action="store_true",
                    help="check routing rules offline; no network or credentials")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    if not args.apply and not args.dry_run:
        ap.error("pass --apply, --dry-run or --self-test")

    for var in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE", "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"):
        if not os.environ.get(var):
            print(f"missing env: {var}", file=sys.stderr)
            return 2

    # option_count drives the contest rule in target_entity().
    markets = sql(
        "select m.id, m.title, m.category, m.cover_image_url, m.cover_entity_kind, "
        "       m.cover_entity_ref, count(o.id) as option_count "
        "from markets m left join market_options o on o.market_id = m.id "
        "where m.status = 'active' and m.is_hidden = false "
        "group by m.id, m.title, m.category, m.cover_image_url, m.cover_entity_kind, "
        "         m.cover_entity_ref "
        "order by m.category, m.title"
    )
    print(f"{len(markets)} active markets\n")

    cache: dict[str, str | None] = {}
    changed = skipped = failed = 0

    for m in markets:
        picked = target_entity(m)
        if not picked:
            skipped += 1
            continue
        key, org = picked
        repoint = not key.startswith(("company:", "person:"))
        # Already on the organisation the rules ask for, so this is the same
        # "right subject" case as a company or a person: fix the image if it
        # needs fixing, but do not re-upload a cover that is already correct.
        if repoint and key == (m.get("cover_entity_ref") or ""):
            repoint = False

        # A correct subject with a legible cover needs nothing done to it.
        fill = current_fill(m["cover_image_url"]) if m.get("cover_image_url") else None
        if not repoint and fill is not None and fill >= POOR_FILL:
            print(f"  ok    {m['title'][:40]:42s} {org['name'][:22]:24s} fill {fill * 100:.0f}%")
            skipped += 1
            continue
        if args.only_poor and repoint and fill is not None and fill >= POOR_FILL:
            skipped += 1
            continue

        if key not in cache:
            got = resolve(org)
            if not got:
                cache[key] = None
                print(f"  FAIL  {org['name'][:28]:30s} {fail_reason()}")
            else:
                webp, via = got
                cache[key] = upload(webp, key.replace(":", "-")) if args.apply else f"(dry-run:{via})"
                print(f"  got   {org['name'][:28]:30s} via {via}  {len(webp) // 1024}KB")

        url = cache[key]
        if not url:
            failed += 1
            continue

        was = f"{fill * 100:.0f}%" if fill is not None else "none"
        print(f"  ->    {m['title'][:40]:42s} {org['name'][:22]:24s} (was {was})")
        if args.apply:
            if repoint:
                sql(
                    "update markets set cover_image_url = '%s', cover_entity_kind = 'org', "
                    "cover_entity_ref = '%s' where id = '%s'"
                    % (url.replace("'", "''"), key, m["id"])
                )
            else:
                # Same subject, better picture: only the URL changes.
                sql(
                    "update markets set cover_image_url = '%s' where id = '%s'"
                    % (url.replace("'", "''"), m["id"])
                )
        changed += 1

    print(f"\nchanged={changed} skipped={skipped} failed={failed}"
          f"{'  (dry run — nothing written)' if args.dry_run else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
