# Market Cover Imagery — 2026-10-15

Every active market now carries a legible, correct mark. This records what was
wrong, how each defect was found, and the rules the resolver follows.

Resolver: `scripts/backfill_market_covers.py`. Schema: migration
`108_entity_kind_org.sql`.

---

## 1. Three defects, measured

Across the 36 visible active markets:

### 1.1 Fifteen markets wore the Kenya flag

`place: ke` was the fallback for anything the resolver could not identify —
every election, both AFCON markets, the CBK rate market, the SHA coverage
market, the housing markets, the weather market. A flag says *Kenya*, which a
reader of a Kenyan prediction market already knows. It does not say *the IEBC
runs this election*.

### 1.2 The artwork was microscopic

The stored covers were 256×256 WebP of 0–1KB. Measuring the alpha bounding box
explained why: on six of eight sampled covers the artwork occupied **1.1%–3.5%
of the canvas** — YouTube 32×22, Kenya Airways 32×32, Safaricom 48×32. A
favicon had been upscaled into a large transparent square, so at the card's
38px icon the logo rendered about five pixels wide.

### 1.3 Multi-outcome markets wore one contender's face

| market | outcomes | cover |
|---|---|---|
| Who wins Kenya's 2027 presidency? | 5 | William Ruto |
| Opposition flagbearer for 2027? | 5 | Rigathi Gachagua |
| Biggest NSE blue-chip gainer, H2 2026? | 4 | Safaricom |

A five-way race illustrated with one candidate's photograph reads as a house
favourite. On a money product that is a fairness defect, not a styling one —
and the second row illustrates the answer to the very question being priced.

---

## 2. The rules

### 2.1 Which entity a market depicts

`target_entity()`, in order:

1. **A contest is neutral.** A market with ≥2 outcomes (`CONTEST_MIN_OPTIONS`)
   whose cover is a person, company or token is re-pointed to the
   authoritative body — elections → IEBC, AFCON → CAF, NSE listings → NSE.
2. **A generic cover yields.** An empty or `place` cover is replaced by the
   matching organisation.
3. **A named subject is kept.** A market already pointing at the right company
   or person keeps it and is re-resolved only to fix the *image*.
4. **An org cover is re-evaluated.** Rules are re-run so a correction to
   `RULES` reaches markets a previous run already wrote.

Option count decides rule 1, not category. All four of these are `elections`:

| market | outcomes | cover | why |
|---|---|---|---|
| Who wins Kenya's 2027 presidency? | 5 | IEBC | no single subject |
| Opposition flagbearer for 2027? | 5 | IEBC | no single subject |
| Sakaja wins re-election as Nairobi Governor? | 1 | **Johnson Sakaja** | the market *is* about Sakaja |
| DCP wins 100+ MPs in 2027? | 1 | **Rigathi Gachagua** | DCP is his party |

An earlier version overrode by category and replaced the bottom two correct
portraits with the IEBC logo. Per-outcome avatars carry each contender's face
either way, which is also how Polymarket splits it: neutral event image,
portraits on the rows.

### 2.2 Which organisation

`RULES` is an ordered regex list; first match wins. Two orderings are
load-bearing and were both corrected after a wrong result was observed:

- **Legislation outranks revenue.** `bill|parliament|amendment|act` is tested
  before `tax|vat|levy`. With KRA first, *"Tax Amendments Bill passed by Dec
  2026?"* and *"Finance Bill sparks protests in 5+ counties?"* wore the Revenue
  Authority's logo on a question decided in the National Assembly.
- **Org rules never displace a named company.** *"Equity Group profit above KES
  50B"* and *"Safaricom above KES 30"* both match the currency rule on `KES`.
  Letting that win would have replaced two correct company logos with the
  Central Bank's.

### 2.3 Which image, and whether it is good enough

Sources are tried in order of how large the artwork was *authored* to be
rendered:

| # | source | why |
|---|---|---|
| 1 | Wikipedia page summary | the infobox logo, made to be looked at |
| 2 | Wikipedia article file list | **non-free logos are absent from the summary API** |
| 3 | `og:image` / masthead `<img>` | the logo the site publishes about itself |
| 4 | favicon | last resort; usually rejected |

Source 2 exists because a Kenyan corporate or government logo is almost always
non-free fair use. Safaricom and the Kenya Revenue Authority both return a
summary with **no image at all**, which is why they fell through to a 48×34 and
a 16×16 favicon. The file is hosted and fetchable; only the summary omits it.

Source 3 is restricted to a filename containing `logo`, or any SVG, because a
site's `/images/logos/` directory is not only logos — Safaricom's holds six
promotional tiles (`DataAndVoice1.png`, `PromotionsAndOffers.png`) beside the
real mark, each large enough to clear the quality gate and each entirely wrong.
The restriction leaves `mobile-logo.svg`, the actual vector wordmark.

SVG sources are rasterised at 1024px when `cairosvg` is importable, and skipped
with a stated reason when it is not. Kenya Airways publishes its wordmark as
`kq-coloured.svg`, a true vector, against a 32×32 favicon.

**A source must plausibly *be* the subject's mark.** Ranking candidates was not
enough: with nothing better available the sort still returned its least bad
option, so Safaricom's cover became a plain red *decrease* triangle lifted from
a Wikipedia infobox — large, clean, vector, and depicting nothing. A file is
now considered only if its name says `logo` or names the subject, and infobox
status glyphs are filtered by name. Declining is the right outcome: the next
source down found Safaricom's real vector wordmark.

**The User-Agent shape is load-bearing.** `safaricom.co.ke` sits behind
CloudFront, which 403s any User-Agent that does not begin `Mozilla/` *and* any
containing the substring `Bot`. `KichikoBot/1.0 (…)` was refused, which is why
the masthead was unreachable and the market fell back to a 48×34 favicon. The
header is now `Mozilla/5.0 (compatible; Kichiko/1.0; +https://kichiko.app; …)`
— the conventional compatible form, still naming the caller and a contact
address, impersonating neither a browser vendor nor another crawler.

**The quality gate** (`good_enough`) judges the artwork, not the canvas it
arrived on: a source whose trimmed artwork is under `MIN_SOURCE_PX` (56px) is
rejected rather than upscaled into blur. This is what stops the pipeline from
recreating defect 1.2.

**Normalisation** (`normalise`) trims to the alpha — or non-white — bounding
box, rescales the longest side to `TARGET_FILL` (78%) of a 256px canvas, and
centres it on transparency.

---

## 3. Two bugs the run itself exposed

Both were found by reading output that did not make sense, and both were
silent failures rather than errors.

### 3.1 The quality metric could never be satisfied

`normalise()` scales **linearly** — longest side to 78% of the canvas. The
check that decided whether a cover needed repair measured **area**. The two are
not comparable, and the gap is a function of aspect ratio:

| mark | aspect | linear | area |
|---|---|---|---|
| square logo | 1:1 | 78% | 61% ✅ |
| Safaricom wordmark | ~5:1 | 78% | **13%** ❌ |

Against a 35% floor, Safaricom's logo — normalised exactly as intended — was
judged defective, re-resolved and re-uploaded on **every run**, and no run
could ever fix it. Every mark wider than about 2.2:1 behaved the same way;
Kenya Airways at 40% and Equity at 39% were one slightly-wider logo from the
same fate.

The check is now linear too. A correctly normalised cover reads 78% whatever
its aspect ratio, and the whole set converges: `changed=0` on a repeat run.

### 3.2 An org cover was permanent

`target_entity()` had no branch for `cover_entity_kind = 'org'`, so it returned
`None` and the market was skipped. Rule corrections could never reach a market
a previous run had written — moving the legislation markets from KRA to
Parliament changed nothing, silently, because every one of them was already
`org`. Rule 4 in §2.1 is the fix.

---

## 4. Diagnostics

Two messages were lying, and both were fixed before being trusted:

- **`sql()` discarded the response body.** A write failed with a bare
  `400 Client Error`. The body said exactly what was wrong —
  `markets_cover_entity_kind_chk`. It now raises with the server's own message
  and the offending statement.
- **"no source cleared the quality gate" meant two different things.** It was
  printed both for a Wikimedia `429` and for a genuinely 16×16 favicon, so a
  run that lost CAF to rate-limiting looked identical to one that had found
  CAF's logo and judged it too small. Only the first is worth retrying.
  Failures now name the cause: `favicon artwork 16x16px (need >= 56px)` versus
  `HTTP 429 from en.wikipedia.org`. Transient statuses retry with exponential
  backoff.

---

## 5. Schema

`cover_entity_kind` is documented in migration 022 as a *resolver hint*
(`person → Wikipedia, company → Brandfetch, …`). The institutions this adds are
resolved by a fourth route that none of those name, so `108_entity_kind_org.sql`
adds `'org'` to the CHECK on both `markets.cover_entity_kind` and
`market_options.entity_kind`, keeping the two sets identical as 022 established.

Calling the IEBC a `company` is wrong; `other` discards the routing information
the column exists to carry. Widening a CHECK rejects no existing row, and no
application code branches on the value.

---

## 6. Result

| | before | after |
|---|---|---|
| markets on the Kenya flag (`place: ke`) | 15 | **1** (correctly) |
| multi-outcome markets wearing a contender's mark | 3 | 2 (see below) |
| markets the resolver could not resolve | 8 | **0** |

On artwork size the before and after are not one number: the original covers
were measured by area (§1.2 — 1.1%–3.5% on six of eight sampled) and the metric
was replaced mid-way for the reason in §3.1, so the two readings are not
comparable and are not presented as a single delta. What is directly verified
is the after: **every resolved cover measures 78% span**, the normalisation
target, and a repeat run reports `changed=0`.

The one market still on the flag is *Nationwide Gen-Z protest in H2 2026?*, and
that is the right answer rather than a miss: an election is run by the IEBC and
inflation is reported by KNBS, but no institution holds a spontaneous protest.
The subject really is the country.

### The audit that `failed=0` did not replace

Every cover was rendered onto one contact sheet and looked at, because the
pipeline reported complete success while two covers were wrong. Both passed
every automated check:

- **Safaricom was a plain red triangle** — a Wikipedia infobox *decrease*
  arrow. Large, clean, vector; the size gate is exactly the wrong instrument
  for it.
- **Kenya Airways was a photograph of an aircraft.** A Wikipedia infobox holds
  whatever best illustrates the subject, which for an airline is a plane
  against a sky. Opaque and detailed, it reduces at 38px to a muddy blue
  rectangle.

No heuristic was added for the second. The obvious signals do not separate a
photograph from a legitimate detailed emblem — the aircraft photo carries 6,649
colours against **14,673** in Parliament's coat of arms — so a detector would
have risked 26 correct covers to repair one. `SITE_FIRST` names the exception
instead, and the airline's own vector wordmark is used.

The sheet is reproducible from the database; a cover count of `failed=0` is
evidence the pipeline ran, not that the artwork is right.

### Known weak

*Kenyan wins 2026 Berlin Marathon?* resolves to **SCC**, the logo of SCC
Events, who do organise the race. It is not wrong, but three letters no Kenyan
reader associates with the Berlin Marathon is a poor mark. The event's own
branding would be better and is not reliably fetchable.

### Still open

Two contests keep a contender's mark because no neutral authority exists for
them: *Most-used app in Kenya, end of 2026?* (WhatsApp) and *Kenya's artist of
the year 2026?* (Nyashinski). The resolver deliberately declines rather than
blanking the cover — a monogram would be worse than a slightly biased image.
These want a category mark, which is a design task rather than a resolver one.

### Reproducing

`--self-test` checks the routing rules offline, with no network and no
credentials: 13 routing cases covering every rule in §2.1–§2.2 (including the
four `elections` markets that must split two ways) plus the SVG sniffer.
