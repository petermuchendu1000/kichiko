# Kichiko UI Research Corpus — Faithful Catalogue by Product Surface

Audit date: **2026-09-27**. Repo: `/home/claude/kichiko`.
Scope read in full: `docs/design/*POLYMARKET*.md`, `docs/design/*PM-*.md`,
`KALSHI-ORDER-TICKET.md`, `docs/design/*DOSSIER*.md`, `LANDING-REBUILD-PLAN.md`,
`LANDING-REVIEW-2026-07.md`, `TYPOGRAPHY.md`, `COPY-REWRITE-SPEC.md`,
`ENTITY-IMAGERY.md`, `PM-PARITY-SPEC.md`, `MULTI-OUTCOME-MARKETS.md`,
`docs/research/polymarket/*.md` (all 8). Also read for coverage/staleness
context: `AUTH-MODAL-M3.md`, `AUTH-PASSWORDLESS-M4.md`, `AUTH-AUTOADVANCE-M5.md`,
`BETTING-PANEL-CONVERSION.md`, `HERO-CHART-VERIFICATION-2026-07.md`,
`CLOB-ARCHITECTURE.md`, `CLOB-TWO-SIDED-ENGINE.md`, `CLOB-AUDIT-2026-07.md`,
`CLOB-SETTLEMENT-2026-09.md`, `BRAIN-ARCHITECTURE-2026-09.md`,
`SECURITY-AUDIT-2026-07.md`, `docs/holder-page-pm-parity-spec.md` (adjacent),
`docs/08-ADMIN.md` (adjacent, headings only).

**No document in the corpus uses `[F]`/`[M]`/`[S]`/`[I]`/`[U]` evidence tags.**
(Verified by grep across all 51 files — zero hits.) Evidence signalling is done
instead through prose: filename suffixes `-MEASURED`, `-GROUNDTRUTH`, `-PARITY`,
`-DOSSIER`, and per-doc method paragraphs ("computed styles via Playwright
`getComputedStyle`", "read from pixels", "not a guess", "synthesized, then
improved upon", "Design approved"). Section 0 below defines the grading scheme
this catalogue applies.

---

## 0. Evidence-quality grading used in this catalogue

| Grade | Meaning | Typical marker in the corpus |
|---|---|---|
| **M1 — instrument-measured** | Values read from a running page via Playwright `getComputedStyle` / `getBoundingClientRect` / pixel sampling, with a named harness and viewport | `PM-*-MEASURED`, `HERO-POLYMARKET-GROUNDTRUTH`, `TYPOGRAPHY`, `PM-PARITY-SPEC`, `PM-CLOB-DRAWER`, `PM-BUY-SHEET`, `holder-page-pm-parity-spec` |
| **M2 — API/data-measured** | Numbers computed from live API snapshots by committed scripts, reproducible | `docs/research/polymarket/*` (snapshot 2026-07-22 14:42 UTC, `analyze.py`, `stats.json`) |
| **M3 — DOM-transcribed** | Values transcribed from a captured DOM dump / compiled CSS rather than computed styles on a live page | `POLYMARKET-DETAIL-MOBILE-PARITY`, parts of `POLYMARKET-DETAIL-MOBILE-GROUNDTRUTH` |
| **O — observational** | "Observed/rendered and studied pixel-by-pixel" with no numbers attached, or ranges ("28–32px") | `POLYMARKET-DETAIL-PARITY-2026-07`, `HERO-POLYMARKET-ANALYSIS` (partly) |
| **A — asserted / designed** | Internally authored design decisions, token tables, IA, review gates; no external measurement | all `*-DOSSIER.md`, `LANDING-*`, `COPY-REWRITE-SPEC`, `MULTI-OUTCOME-MARKETS`, `ENTITY-IMAGERY` |
| **V — verified in our own system** | Claim checked against our DB/code/tests, with a named test or query | `HERO-CHART-VERIFICATION-2026-07`, `CLOB-*`, `BRAIN-ARCHITECTURE-2026-09`, research `06` (live `information_schema` introspection) |

---

## 1. LANDING PAGE

### 1.1 Documents
| Doc | Date stated | Grade |
|---|---|---|
| `docs/design/LANDING-PAGE-DOSSIER.md` | no date; "Phase 0 complete"; cites "Avark 2026 prediction-market UX design guide" | **A** (research is synthesized prose, not captured) |
| `docs/design/LANDING-REBUILD-PLAN.md` | no date; status "✅ Complete" | **A** + **V** (§5 pixel audit) |
| `docs/design/LANDING-REVIEW-2026-07.md` | 2026-07 (filename) | **A** (code-read findings) |
| `docs/design/HERO-POLYMARKET-ANALYSIS.md` | captured **2026-07-13**, Chromium 1440×900 DSF2 | **M1/O mixed** |
| `docs/design/HERO-POLYMARKET-GROUNDTRUTH.md` | contains a "CORRECTION (2026-07…)" block | **M1** (strongest measured doc for the hero) |
| `docs/design/HERO-CHART-VERIFICATION-2026-07.md` | 2026-07 | **V** (our data + our code) |
| `docs/design/README.md` | none | **A** (index) |
| assets: `docs/design/assets/polymarket_hero_carousel_live.png`, `…_slide_live.png`; `docs/design/landing-prototype/{index.html,app.js,styles.css}` | — | capture + reference build exist on disk |

### 1.2 Measured / specified values

**Pip design system (LANDING-PAGE-DOSSIER §2 — asserted, our own):**
- Neutrals "Slate": `ink-950 #0A0C10 · 900 #111419 · 800 #1A1F27 · 700 #2A303B · 600 #3C4453 · 500 #5A6473 · 400 #808A99 · 300 #AAB2BF · 200 #D2D7DE · 100 #E8EBEF · 50 #F5F7FA · paper #FFFFFF`.
- Brand "Pip Blue": `600 #1E44C9 · 500 #2B50E4 (core) · 400 #5C82F2 · 300 #A9C0FB · 100 #E7EEFE`.
- Accent "Brass" (≤5% of surface): `600 #B57E22 · 500 #D9A036 · 100 #F7ECD4`.
- Market semantics: YES `#1F9D6B` (green-600 `#177C54`, tint `#E3F3EC`); NO `#D1495B` (red-700 `#B23446`, tint `#FBE7EA`); Warning `#C98A1E`; neutral change `ink-500`.
- Data-viz ramp: Pip Blue 500 → Teal `#1E9C9C` → Brass 500 → Violet `#7A5AF0` → Clay `#D1495B` → Slate 500. Probability line = single brand blue, **area fill 8% alpha**.
- Type: *Hanken Grotesk* (UI) + *IBM Plex Mono* (`font-variant-numeric: tabular-nums`) for all numerics; fallback `-apple-system, "Segoe UI", Roboto, sans-serif`.
- Type scale (1.200 minor third, 16px base): Display `clamp(2.5–4rem)/1.05, 700, -0.03em` · H1 `2.25rem/1.1, 700, -0.02em` · H2 `1.75rem/1.15, 650, -0.02em` · H3 `1.25rem/1.25, 600, -0.01em` · Body-lg `1.125rem/1.6` · Body `1rem/1.6` · Small `0.875rem/1.5, 450` · Caption `0.75rem/1.4, 500, +0.01em`.
- Spacing: 8px base w/ 4px sub-step; scale `2·4·8·12·16·24·32·48·64·96·128`.
- Grid: 12 col, max content **1200px** (wide **1320px**), gutter **24px**, page margin `clamp(20px,5vw,48px)`; section padding `clamp(64px,9vw,128px)`.
- Radii: inputs/buttons **8px**, cards **12px**, modals **16px**, pills **999px**; explicit rule "**No oversized 24px+ card radii**".
- Elevation: E1 `0 1px 2px rgba(10,12,16,.04), 0 0 0 1px hairline`; E2 `0 4px 16px rgba(10,12,16,.08)`; E3 `0 16px 48px rgba(10,12,16,.16)`. "No colored glows, no glassmorphism."
- Icons: 24px grid, **1.5px** stroke, round joins, 2px keyline padding, custom inline SVG only.
- Motion: micro **120ms**, standard **200ms**, entrance **280ms**; easing `cubic-bezier(.2,0,0,1)` entrances / `cubic-bezier(.4,0,.2,1)` moves; probability **roll 240ms**; `prefers-reduced-motion` disables rolls/parallax.
- Breakpoints: `xs <480 · sm 480 · md 768 · lg 1024 · xl 1280 · 2xl 1536`; design at **375px** first.
- A11y: focus ring **2px** Pip Blue at **2px** offset; target ≥ **44×44**; WCAG 2.2 AA+.
- Perf budget: **LCP < 2.0s, INP < 200ms, CLS < 0.05** on a mid-range Android over 3G-fast.
- Branding: wordmark tracking **-0.02em**; clear space ≥ mark height; min size **20px mark / 96px lockup**.
- Copy: North Star "**The clearest view of what happens next.**"; IA = 12 numbered sections (nav → hero → ticker → category browse → featured grid → how it works → LMSR → trust → by the numbers → app/access → final CTA → footer); wireframe copy includes "Will CBK cut rates by Sept? 68% · YES 68¢ / NO 32¢ · Vol KES 4.2M · 3d", "KES 240M / 1,280 markets / 84k traders".
- Component spec: market card title H3 2-line clamp; CTA min height **44px**; hover E1→E2.

**LANDING-REBUILD-PLAN (gap table + verification):**
- Wrong-state values it removed: brand green `#16a34a`/`#22c55e`; fonts Sora + Inter + JetBrains Mono; radii `2xl 24px`/`3xl 32px`; `shadow-glow`; headline "Predict the future. Get paid."; emoji 📊💰🌍👥🔮.
- Token bridge: `--green → --yes`, `--red → --no`, `--bg-secondary → --surface`, `--text-primary → --text`, `--border → --hairline`, brand primary → `--pip-500`. "Legacy token names referenced by **23+ files**."
- Verification (**V**): `tsc --noEmit` clean; `next build` green **45/45 routes**; headless Chromium at **1440px and 390px**; automated pixel audit "casino green `#22c55e`/`#16a34a` = **0.00%**"; hero server-rendered.

**LANDING-REVIEW-2026-07 (findings, measured from our code):**
- F1 footer: light-mode bug `hover:text-white` (white-on-white); grid misalignment — footer/navbar `max-w-7xl px-4` vs body `max-w-6xl px-5 sm:px-8`; missing risk/responsible-play disclosure; no brand anchor.
- F2 container width inconsistency (same two values). F3 no JSON-LD on live page. F4 orphaned locale switcher.
- Fix target: standardize everything to **`max-w-6xl px-5 sm:px-8`**.

**HERO — Polymarket measured (M1; the densest numbers in the corpus):**
- Hero row `flex flex-row gap-8 pt-6 items-stretch`, wrapper `max-w-[1350px] mx-auto px-4 lg:px-6`; two columns ~`1.7fr | 1fr`, gap ~20px (ANALYSIS) / `gap-8` (GROUNDTRUTH).
- Featured card **907×480**, `min-h: min(480px,60vh)`, `max-h: 500px`, radius **18px**, border `1px solid rgba(37,99,235,0.10)`, bg `#fff`, shadow `0 4px 16px rgba(59,130,246,0.07)`, `overflow:hidden`; slide padding **20px 20px 16px 20px**; slide transition `opacity 120ms ease-in` + `translateX(±300%)`.
- Header: icon **56×56**, radius **9.2px**, `hidden md:block`, `min-width:56px`. Breadcrumb category/sub `14px/20px, weight 540, ls -0.09px, #77808d`; separator `·` `16px/24px/400`. Title **24px/32px, 600, ls normal, #0e0f11**. Action buttons `w-7 h-7` circular ghost, icon **18×18** at **1.5px** stroke, `hover:bg-black/5`, `active:scale-[97%]`, `transition duration-150`.
- Body split: outcomes ≈**40%** / chart ≈**60%** (plot svg measured **496** wide).
- Outcome rows: `min-h-10`, divider `1px solid #e6e8ea`, `pb-2`; name `15px/22.5px, 450, ls -0.15px, #18181b`, optional **30px** squircle avatar (`gap-1.5`); percentage `20px/24px, 600, ls -0.2px, #18181b`, tabular-nums; binary shows Yes/No chip green `#42c772` / red `#e23939`.
- Comment peek: avatar **20px** circle (`size-5`); author **13px/400** text-primary (explicitly *not* bold); body **12px/400 `#77808d`, 2-line clamp**. News variant: **12px** `rounded-[2px]` source logo, `AP News` 12px secondary + `・` + `5d ago` tertiary, headline 13px primary `line-clamp-1 lg:line-clamp-2`.
- Chart: SVG **496×276** (height varies 276/300/306), plot **446×236** inside `translate(0,10)`, ~**50px** right gutter. Gridlines: **5** horizontal, `stroke #aeb4bc`, `stroke-width 1`, `stroke-dasharray 1,3`, at y = **0/59/118/177/236** (59px apart), x 0→458. Right Y axis: 5 labels, auto-domain (e.g. 0/10/20/30/40% or 0/15/30/45/60%), `font-size 12`, `text-anchor start`, **+8px** gap, `#77808d`. X axis: 4–5 ticks, `font-size 12`, middle anchor, `#caced3`, `translateY(+12)`, ~**104px** apart, format `Jun 21`.
- Chart lines (post-correction): smooth cubic-bézier `<path>` (400+ `C`, **zero `L`**), `fill:transparent`, `shape-rendering:geometricPrecision`, `pathLength=1`. Three stacked paths per series: main `sw 1.75`, `clip-path inset(-13px …)`; faded history `color-mix(in srgb, COLOR 40%, transparent)`, `sw 1.75`, `stroke-dasharray "2 2"`, `clip-path inset(-13px 432px -13px -13px)`; accent `sw 2.75`, `stroke-opacity 0` at rest.
- Endpoint at `cx=446`: solid `r=4` dot + pulsing halo ring (same `r=4`, `transform-origin:50% 50%`, `transform-box:fill-box`), animating **scale 1→~3.95** while **opacity 0.34→0**, looping (measured frames scale 2.28/op .34 and 3.95/op .011).
- Series palette (hero): `#87BFFF · #4378FF · #FDC503 · #FF7F0E`. Y-axis glyphs via visx: `Arial 12`, weight 400.
- Legend chips: swatch **27×14** line-svg, name `13/16 w490 #77808d`, value `13/16 w600 #31353a`. Trade annotations `+ $N` `13px/19.5px, 600`, per-line colored.
- Footer: `$X Vol` `13px/16px, w490, ls -0.1px, #aeb4bc`; right `Ends Mon D, YYYY · Polymarket`, logo mark ~**98×18**.
- Carousel controls: 7 dots, active elongated pill; prev/next rounded-full ghost pills showing adjacent slide titles, `text-body-base font-semibold`, `active:scale-[97%]`; "Show more markets" outline pill `h-10 rounded-full px-4`.
- Right rail: promo (blue `blue-500` bg, "Download the US app", "Use code POLY50 for $50"), Breaking News (2-line title `14px medium`, `%` `18px semibold`, delta `12px` green/red ↗/↘), Hot topics (title `13px`, `$X today` + 🔥), Explore all full-width outline pill.
- PM tokens (hero doc): neutral ramp `0 #fff · 25 #f9fafb · 50 #f4f5f6 · 100 #e6e8ea · 200 #caced3 · 300 #aeb4bc · 400 #939aa5 · 500 #77808d · 600 #5f6772 · 700 #484e56 · 800 #31353a · 900 #1a1c1f · 950 #0e0f11`; YES `#42c772`, NO `#e23939`, `blue-500 #1652f0`, `blue-600 #0c3ec1`; Inter with features `"liga" "calt" "cv01" "cv02" "cv03" "cv04" "cv11" "cv15"` on, `cv09` off; mono = Geist Mono. Outcome-name near-black measured `#18181b` — doc itself flags "slightly ≠ title #0e0f11".
- HERO-POLYMARKET-ANALYSIS data availability (**V**): top-4 featured markets have real `price_history` (276 pts for the 2027 presidential multi; ~46 pts each for binaries; window **2026-05-27 → 07-11**); `market_options.image_url` carries entity photos.

**HERO-CHART-VERIFICATION-2026-07 (V, our system):**
- Ruto market `fd87f013-3819-4f68-be5b-8460beb0de60`: **90** price_history points Apr 14 → Jul 13; endpoint `0.46` == market `yes_price`; series min/max `0.46 / 0.71618`; computed auto-domain **40/50/60/70/80%**; endpoint 15% up from the bottom.
- `niceDomain` bug: exhaustive 1%-granular scan found **240 inputs** where data max exceeded `hi` and was clamped (example `min=0.07,max=0.21` → old domain `[0,0.20]`). Fixed in `lib/markets/chart-domain.ts`; guard `lib/__tests__/chart-domain.test.ts`. Ruto case unchanged `[0.4,0.8]`.
- Binary line color: trend-based (green if current ≥ period-start, else red) is **correct**; a prior prose note saying "always green" is explicitly retracted as an unimplemented assumption.

### 1.3 Explicit gaps
- LANDING-REVIEW gates are **unchecked boxes** (`[ ]`) — the elevation pass (footer rebuild, gutter alignment, JSON-LD) is planned, not verified in the doc.
- F3: JSON-LD documented in the prototype but **absent from shipped `app/page.tsx`**; "implemented in this pass only if it stays fully additive and typed".
- LANDING-PAGE-DOSSIER Phases 1–6 are roadmap only (Storybook, Chromatic, axe CI, WebSocket data layer, RTL-readiness, CWV budget in CI).
- Hero parity checklist (GROUNDTRUTH §10) still lists fixes needed on card shell (border/shadow/min-h/max-h), icon radius, divider token, and the full chart sub-step list.
- Hero doc has no dark-theme measurements ("dark: no shadow" is the only dark note); PM was captured in light theme only.
- No measured values at all for our own landing (only the negative pixel audit and route count).

### 1.4 Staleness risk
- **High.** The hero is a *live Polymarket carousel* captured 2026-07-13; PM ships redesigns frequently (the corpus itself records a PM contract retirement on 2026-07-17 and two self-corrections within July). Card geometry (907×480), promo copy ("Download the US app", "POLY50 for $50"), rail composition, and the 7-dot carousel are the most volatile items. Re-capture before trusting any of it.
- Our own side: the "45/45 routes" build and the 0.00% casino-green audit are ~2.5 months old and predate the CLOB/settlement work of 2026-09.
- The gutter inconsistency (F2) may or may not still exist; LANDING-REVIEW's plan was written but its gates are unticked.

---

## 2. MARKET DISCOVERY / LIST (feed cards, `/markets`, search grid, ticker)

### 2.1 Documents
| Doc | Date | Grade |
|---|---|---|
| `MARKETS-DISCOVERY-DOSSIER.md` | none ("Phase 1") | **A** |
| `MARKET-CARD-POLYMARKET-PARITY-2026-07.md` | 2026-07 (+ "Addendum — full-DOM rebuild (measured 2026-07)") | **M1** (main) + **M3** (addendum) |
| `ENTITY-IMAGERY.md` | "Status (2026-07)" | **A** + **V** (backfill counts) |
| `POLYMARKET-KALSHI-PARITY.md` §2.1 | none; "Design approved" | **O/A** (reference *images*, not captures) |
| `SUPPORTING-PAGES-DOSSIER.md` §2 (`/search`) | none | **A** |

### 2.2 Measured / specified values
**Card container (measured PM → our token):** bg `#fff` → `--surface`; border `1px solid #e6e8ea` → `var(--hairline)`; radius **12px** → `--r-md`; padding **12px** compact → **16px** regular; rest shadow none / `0 1px 2px rgba(0,0,0,.04)` → `--e1`; hover border → `--pip-400` + `--e2` + `translateY(-2px)`; transition `border-color/box-shadow/transform ~150ms ease-out`.
**Interaction model:** full-bleed overlay `<a>` at `z-0`; controls `z-10 pointer-events-auto`; inner content `pointer-events-none`; deep link `?side=yes|no&option=<id>`; server component, zero card JS.
**Header:** icon **40×40** regular / **34×34** compact, radius **8px**, `object-cover`; title **15px** regular / **14px** compact, **weight 600**, `line-height 1.3`, `--text` (`#0e0f11`), **`line-clamp-2`**.
**Binary gauge:** **44px donut**, track `--hairline`, arc to `yes_price` in `--yes`, `stroke-width 4`, round caps, starts 12 o'clock; centered `%` **15px/700 tabular-nums**; `role="img"` + `aria-label="72% chance Yes"`.
**Buy buttons:** `grid-cols-2 gap-2`, `mt-auto`; height **40px**, radius **8px**, weight 600; Yes `--yes-tint` bg / `--yes-700` text → hover solid `--yes` + white; labels `Yes 72¢` / `No 28¢`.
**Multi-outcome rows:** `min-h 40px`, hairline dividers; avatar **22px** circle; label **13px/500** truncate; probability **13px/700 tabular**, ranked desc; compact `Yes`/`No` outlined pills; rows shown **up to 4** regular / **3** compact; `+N more` at **12px/500 `--text-3`**.
**Footer:** volume `$1.2m Vol.` at **11–12px** `--text-muted`; comment count `💬 128`; bookmark toggle; bettors `👤 N`; top hairline; `11px tabular-nums`.
**Type cheat-sheet (measured):** title 15/1.3/600 · outcome name 13/500 · outcome % 13/700 · gauge % 15/700 · button label 13/600 · footer meta 11–12/500 · "+N more" 12/500. Card gap rhythm `gap-3` (12px); row padding `py-2`.
**Addendum (full-DOM rebuild, measured 2026-07):** PM base spacing `--spacing: .25rem`; card radius `rounded-xl` (`--radius .7rem` + 4px ≈ **15px**) → ours **14px**; PM green fill/text `#42c772` / `#30a159`; red `#e23939`; text `#0e0f11` / `#77808d` / border `#e6e8ea`; font Inter variable weights **440 / 590**.
- Shell: `relative flex flex-col justify-between rounded-xl shadow-md shadow-black/4 min-h-[180px] pt-3 overflow-hidden border`, hover `-translate-y-px`; sections own `px-3`.
- Header `h-[42px] px-3 gap-2`; icon **38×38 `rounded-sm` square**; title `text-body-base font-[590] line-clamp-3`.
- Multi board rows `min-h-10`; label `font-[440] line-clamp-1`; `%` `text-[15px] font-semibold`; Yes `bg-green-500/15 text-green-600`, No `bg-red-500/9 text-red-500`, micro-buttons **h-[27px] w-10 `rounded-xs`**; resting label cross-fades to ¢ on hover then fills solid.
- Binary: semicircular chance meter `w-[58px]` top-right; two `flex-1` bottom buttons carrying ¢; Up/Down adds red ping dot + "Live" + floating `+$N` fly-ups.
**Parity matrix:** 16 rows, legend ✅ parity / ➕ intentional superset / ⛔ intentional omission. `⛔` = rewards gift glyph ("no rewards program"). `➕` = bettors count, live countdown, deep-link ticket.
**Deliberate deviation (explicit):** "Polymarket's neon `#42c772` green fails WCAG AA (4.5:1) as small Yes/No text, so we keep this repo's desaturated `--yes/--no-700` semantic palette (commit `704547f`). Structure, geometry, and interactions are 1:1; only the two semantic hues are AA-corrected."
**Discovery page (asserted):** URL state `?q&category&status&sort&page`; **24 results/page**; sorts `relevance|volume|newest|closing|bettors`; status `active|resolved|all`; grid **1→2→3→4 cols**; search debounce **300 ms**; `search_markets` RPC; JSON-LD `ItemList`; `MarketCardSkeleton` was `rounded-2xl bg-card` (off-system) and was realigned.
**Search page (asserted):** debounce **250–300 ms**; up to **6** recent-search chips in `localStorage` key `mp:recent-searches`; `/` focuses, `Esc` clears; `robots: noindex`; highlight mark uses `--pip-100` "not amber".
**Entity imagery (V):** monogram via FNV-1a hash; `sharp`-normalised square WebP **128 + 256**; bucket `entity-media`, `Cache-Control: public, max-age=31536000, immutable`, content-hash filenames; first backfill populated **32 of 107** live options (all 12 politicians, the social/finance apps, 3 country flags); abstract options stay on monogram.

### 2.3 Explicit gaps
- Discovery dossier's 7 review gates are all **unchecked**.
- Rewards gift glyph deliberately omitted (documented, not forgotten) — but see contradictions §16.
- `POLYMARKET-KALSHI-PARITY` §2.1 lists as **❌ MISSING** the "event card" previewing top 2–3 candidate lines with mini Yes/No.
- Entity imagery next steps: front-runner avatar on discovery cards (thread `image_url` through `leading_option` RPC), create-wizard auto-suggest, admin backfill route + nightly cron, Brandfetch as highest-confidence company source. 75 of 107 options still monogram-only.
- No measured values for the live ticker, category rail, or pagination.
- No dark-mode measurements anywhere for cards.

### 2.4 Staleness risk
- **Medium-high.** Two *different* measured card specs coexist in one file (main body: radius 12px, icon 40px `rounded-lg`, title 15/600 clamp-2, gauge 44px donut; addendum: radius 14px, icon 38px `rounded-sm`, title `font-[590]` clamp-3, semicircular `w-[58px]` meter, buttons `h-[27px] w-10`). The addendum is later and claims to have rebuilt the component end-to-end, so the main body's numbers are probably stale — but the doc never says which supersedes which.
- Backfill coverage (32/107) is a 2026-07 snapshot and will have moved.

---

## 3. MARKET DETAIL (desktop + mobile)

### 3.1 Documents
| Doc | Date | Grade |
|---|---|---|
| `MARKET-DETAIL-DOSSIER.md` | none ("Phase 1") | **A** |
| `POLYMARKET-DETAIL-PARITY-2026-07.md` | reference captured **2026-07-09**, 1440px | **O** (anatomy, ranges, no computed styles) |
| `PM-MARKET-DETAIL-MEASURED.md` | base capture undated (1280×900 DPR2); addenda **re-captured 2026-07-18** (1440×1024 DPR2) | **M1** |
| `PM-PARITY-SPEC.md` | captures 1440×1024 + 390×844 @2x; §6 progress list | **M1** |
| `POLYMARKET-DETAIL-MOBILE-PARITY-2026-07.md` | 2026-07, 390×844 | **M3** |
| `POLYMARKET-DETAIL-MOBILE-GROUNDTRUTH-2026-07.md` | 2026-07 "refresh"; 390×844 @2x | **M3 + M1** (screenshots + live Playwright) |
| `POLYMARKET-DETAIL-M7-COMMUNITY-CHART-2026-07.md` | 2026-07, 1440px + 390px | **M1** (dasharray read off compiled SVG) |
| `TYPOGRAPHY.md` | "Captured 2026-07" | **M1** |
| `POLYMARKET-MULTI-OUTCOME-PARITY-2026-07.md` | 2026-07; activation record **2026-07-11** | **O** (screenshots) + **V** (activation) |

### 3.2 Measured / specified values

**Global tokens (PM-PARITY-SPEC §1, resolved from PM's `@theme`):**
- Neutral ramp `0 #ffffff · 25 #f9fafb · 50 #f4f5f6 · 100 #e6e8ea · 200 #caced3 · 300 #aeb4bc · 400 #939aa5 · 500 #77808d · 600 #5f6772 · 700 #484e56 · 800 #31353a · 900 #1a1c1f · 950 #0e0f11`.
- Brand ramp `50 #e7edfd · 100 #c4d3fb · 200 #a1b9f9 · 300 #7d9ff6 · 400 #4e7df3 · 500 #1452f0 · 600 #1249d8 · 700 #1041c0 · 800 #0e39a8 · 900 #0c3190`.
- Yes `50 #ecf9f1 · 500 #42c772 · 600 #30a159`; No `50 #fcebeb · 500 #e23939 · 600 #c61d1d`. Explicit note: "PM uses **saturated** green/red (not desaturated)."
- Semantic: text primary `#0e0f11`, secondary `#77808d`, tertiary `#aeb4bc`, border `#e6e8ea`, border-hover `#caced3`, surface `#f4f5f6`, bg-brand `#1452f0`.
- Radii from `--radius: 0.7rem`: sm `−4px` = **7.2px**, md `−2px` = **9.2px**, lg = **11.2px**; base spacing `0.25rem`; fonts Inter + openSauce display; "**Numerics render in the UI font at PM (no separate mono for prices).**"
- Mobile compiled-CSS tokens: `--navbar-height: 104px`; shadow `--shadow-md: 0 8px 16px #0000000f`; ease hover `cubic-bezier(.26,.08,.25,1)`, in-out `cubic-bezier(.4,0,.2,1)`; weights 300–800; tracking tight `-.025em` … widest `.1em`; radius xs `−6px`, 2xl `1rem`, 3xl `1.5rem`; primary `#111827`, secondary bg `#f3f4f6`, card `#fff` / fg `#030712`.
- `PM-MARKET-DETAIL-MEASURED` states a different global: "`--navbar-height: 116px`".

**Header (measured):** H1 **24px / 600 / lh 28px / ls −0.36px / `#0E0F11`** (explicitly "static, not larger on desktop"); title box binary `x142 y308 w402 h28`. Breadcrumb link **14px/600/lh20/ls −0.09px/`#77808D`**, pad 4/10, gap 6, radius **9.2px**, transition `0.15s cubic-bezier(.4,0,.2,1)`. Identity avatar **64×64, radius 7.2px**. Action icon button **36×36 circular**. Mobile: avatar `!h-10 !w-10` (**40px**) default → `min-[480px]:!h-16 !w-16` (**64px**); sticky `top-(--navbar-height)`, `z-20 bg-background mb-2 pt-2 pb-3`, hairline fades `0→1` on scroll; embed `</>` icon **dropped on mobile**.

**Typography scale (TYPOGRAPHY.md, measured — the single best type source):**
fonts loaded: **Inter variable** (`InterVariable.woff2`, 100..900) ≈90% of text; **Geist Mono** 400/500/600 (select numerics, promo codes, `<kbd>`); Suisse Intl declared but not computed; Open Sauce One rare; Arial fallback + SVG `<tspan>`.
Global features: `font-feature-settings: "liga","calt","cv01","cv02","cv03","cv04","cv09" 0,"cv11","cv15"`; **no global letter-spacing**.
Non-standard weights in use: **440 / 450 / 490 / 540 / 580 / 590**.
| token | size | weight | lh | tracking |
|---|---|---|---|---|
| `.pm-body` | 13 | 490 | 16 | −0.1 |
| `.pm-body-regular` | 13 | 400 | 16 | −0.1 |
| `.pm-body-strong` | 13 | 600 | 16 | −0.1 |
| `.pm-caption` | 12 | 400 | 16 | −0.1 |
| `.pm-caption-strong` | 12 | 600 | 16 | −0.1 |
| `.pm-micro` | 12 | 500 | 16 | normal |
| `.pm-text` | 14 | 440 | 20 | −0.09 |
| `.pm-text-medium` | 14 | 500 | 20 | −0.09 |
| `.pm-text-semibold` | 14 | 600 | 20 | −0.09 |
| `.pm-nav` | 14 | 540 | 20 | −0.09 |
| `.pm-heading-sm` | 14 | 590 | 20 | −0.09 |
| `.pm-book` | 15 | 450 | 22.5 | −0.15 |
| `.pm-num-15` | 15 | 600 | 22.5 | normal |
| `.pm-body-16` | 16 | 400 | 24 | normal |
| `.pm-yesno` | 16 | 600 | 20 | −0.18 |
| `.pm-price` | 16 | 600 | 24 | −0.09 |
| `.pm-heading-md` | 18 | 580 | 27 | normal |
| `.pm-pct-18` | 18 | 600 | 18 | normal |
| `.pm-num-20` | 20 | 600 | 24 | −0.2 |
| `.pm-title` | 24 | 600 | 32 | normal |
| `.pm-headline` | 24 | 600 | 28 | −0.36 |
| `.pm-display` | 28 | 600 | 28 | −0.42 |
Tracking is size-scaled ≈ −0.006em → −0.015em: 12–13px → −0.1 · 14 → −0.09 · 15 → −0.15 · 16 → −0.18 · 20 → −0.2 · 24 → −0.36 · 28 → −0.42.
Corrections applied to us: removed global `body { letter-spacing:-0.011em }`; added PM's feature settings; added the `.pm-*` scale; `.font-display` tracking `-0.02em → -0.015em`.

**Outcome board (desktop, measured 2026-07-18):** row = one line, `flex flex-row justify-between`, **h≈48px**, borderless, list `divide-y`.
`[avatar 40 circle for person] [name 16px/600 #18181B + "$… Vol." 13px/490 #77808D (flex-1)] [price 28px/600 #0E0F11] [Δ chip 12px/600] [Buy Yes 136×48] [Buy No 136×48]`
- Name **16px/600 `#18181B`** (PM-PARITY-SPEC says `#0e0f11`), ls −0.18px; volume `$12,190,948 Vol.` with full commas, **13px/~400/lh 19.5/ls −0.09px/#77808D**.
- Big % **28px/600/ls −0.42px/`#0E0F11`**, shown in **¢** on desktop (`20¢`).
- Δ chip `▲8%` green `rgb(66,199,114)` / `▼7%` red `rgb(231,93,93)`, **12px/600** — "needs 24h change data — not yet wired".
- Buy Yes **136×48**, radius **7.2px**, **14px/600**; LEADING = solid `#30A159` + white; other = `rgba(48,161,89,0.15)` → hover `0.25`. Buy No = `rgba(226,57,57,0.09)` → hover `0.13`, text `#E23939`. Transition `background-color+color 0.15s cubic-bezier(.4,0,.2,1)`.
- Mobile rows: integer `%` (19.9→`20%`), sub-1% shows **`<1%`**; cents 1-dp with **Yes + No = 100¢** (`19.9¢ / 80.2¢`); verbatim samples: JD Vance 20% `19.9¢/80.2¢` $14.66M · Marco Rubio 14% `14.2¢/85.9¢` $11.20M · Gavin Newsom 12% `12.0¢/88.1¢` $17.41M · AOC 8% `8.0¢/92.1¢` $12.58M · Donald Trump 1% `1.4¢/98.7¢`; 37 rows total on a $662M event.
- Click a candidate **name**: URL does not change; arms the right ticket and expands an inline drawer (see §5).
- **Section boxing:** "Audited every `h1/h2/h3` container: **0 framed**. PM is BORDERLESS everywhere" — Rules, Market Context, Comments, Top Holders, Positions, Activity, FAQ, chart, board. Only the Buy ticket keeps a subtle frame. Our fix removed `.card` frames from board/Rules/Comments/FAQ/chart.

**Chart (detail):** mobile SVG `overflow-visible` ≈**358×240** outer, ≈**290×218** inner plot; explicitly **not a `<canvas>`**; plot is **unbounded** — no border box, no card frame, no vertical gridlines, no left axis line, endpoint dots unclipped. Mobile series palette sampled: `JD Vance #fa534d · Marco Rubio #87bfff · Gavin Newsom #e2bf6c · AOC #456bd5`; background pure white; halo on endpoint dots. Reserves `min-h-[var(--chart-height)]`. Right Y axis dynamically scaled (observed `0/10/20/30%`), X axis month ticks `Sep … Jul`, faint centered "Polymarket" watermark.
- M7 (measured off compiled SVG): horizontal Y gridlines `<line>` `stroke-dasharray: 1px 3px`, `stroke: rgb(174,180,188)`, **1px**; series main body solid **~2.75px**; series trailing segment `stroke-dasharray: 1px 1px`, **~1.75px**. Observed Y ticks step **15%** (`0% 15% 30% 45% 60%`); X labels month abbreviations. Our mapping: `CHART_GRID_DASH = '1 3'` over a new `--chart-grid` token (= `--ink-300` light / `--ink-600` dark), `CartesianGrid horizontal vertical={false}`; binary `PriceChart` retuned from `3 3` to `1 3`. `OutcomesChart` previously had **no gridlines at all** — fixed. Trailing dashed tail deliberately **not fabricated** ("documented seam, no invented geometry").
- Chart control strip (mobile): left trophy icon + `$662,055,529 Vol.` chip; right timeframe group — two variants observed: compact `1H 1D 1W 1M MAX` + gear + clock, full DOM `1H 6H 1D 1W 1M ALL` (aria "Select chart window"); a secondary strip repeats `$Vol. · Nov 7, 2028 · Earn 3.25%`.
- Timeframe buttons (measured desktop): text **14px/600**, **h36**, pad `4px 6px`, radius **9.2px**, transparent bg; inactive `#77808d`, active `#0e0f11`; order `1H · 6H · 1D · 1W · 1M · ALL`; active state is a **color swap only, no pill background**. Footer left = `$… Vol.` + resolution date `MMM D, YYYY` with clock icon; footer right = timeframes → sort/shuffle icon → settings gear.

**Related markets:** desktop rail rows ~**332×59**, borderless, no bg, ~**8px** gap; icon ~**40–44** circular/rounded, text offset ~**60px**; title **14px/500 `rgb(24,24,27)`** 2-line clamp (PM-MARKET-DETAIL-MEASURED) vs **13px/600/lh 19.5/ls −0.09px/`#18181b`** (PM-PARITY-SPEC §2.5); price **18px/500** right-aligned in **¢** (`41¢ 20¢ 59¢`) — "ours showed `%` → fixed to `¢`"; sub-entity **12px/400 `rgb(119,128,141)`** (leading outcome, e.g. "J.D. Vance"). Mobile compact list shows **mini-%** (`Republican Presidential Nominee 2028 — 42% J.D. Vance`, `Democratic … 20% Gavin Newsom`, `Which party wins … 59% Democratic`). Binary related list has a filter tab row above it (`All · <Category> · World`).
- **Right rail below ticket = RELATED markets, NOT contract specs**: "There is no 'Contract specs' card in PM's desktop rail." Our fix removed it and moved `<RelatedMarkets>` into the rail; specs grid stays mobile-only (`<ContractSpecs className="lg:hidden">`).

**Mobile page skeleton (exact DOM order, 12 blocks):** sticky header → legend row (top-4) → chart → chart control strip → outcome board (37 rows) → Rules/Market Context (2 tabs) → contract specs grid → AI-generated summary → Market Context news feed → Related → Community → FAQ. Capture facts: viewport 390×844 @2x → full page **20,914px** tall; two DOM trees via **Fresnel** (`fresnel-lessThan-lg` / `fresnel-greaterThanOrEqual-lg`), `lg` boundary **1024px**. Root: desktop `--event-detail-width: calc(100vw - 24px - 24px - 340px - 24px)` → **340px** right rail; mobile `max-lg:w-[calc(100vw-2rem)] max-lg:mb-5`.
**Legend row:** `flex flex-col items-start gap-y-1 sm:flex-row sm:items-center` (stacks < sm); entry = `size-2 rounded-full` dot · name `text-text-secondary text-body-sm` · percent `text-neutral-800 font-semibold ml-0.5`; **top-4 series only** (`JD Vance 19.9%` red, `Marco Rubio 14.1%` light-blue, `Gavin Newsom 11.9%` gold, `AOC 8.0%` dark-blue).
**Contract specs grid (mobile, verbatim):** Volume `$662,055,529` · End Date `Nov 7, 2028` · Market Opened `Jul 11, 2025, 2:44 PM ET` · Resolver `0x2F5e3684c…` (middle-truncated link) + footnote about a new rewards/oracle-resolution system.
**AI summary:** paragraph + `<small>` "**Experimental AI-generated summary referencing Polymarket data. This is not trading advice … · Updated Jun 18, 2026, 2:31 AM UTC**"; wrapped in JSON-LD `Article`.
**Market Context news feed:** DOM 412–7121 (the bulk of the page). Card = date (`Jul 2 2026`) · headline · summary · source logo (`The New York Times`, `Fox News`, `AP News`, `CBS News`; some cards carry two) · probability-move chip `<candidate> <verb> to <N>% <±M>%`, verb ∈ {`rises to`, `dips to`, `jumps to`}, delta colored. Verbatim examples: `Jon Ossoff rises to 7% +2%`, `Gavin Newsom dips to 12% -3%`, `JD Vance jumps to 28% +9%`. Terminated by `Show more`.
**FAQ:** `<h2>Frequently Asked Questions` + **~13** `<h3>`/button accordion rows, `data-state` toggled, bodies templated with the market title; topics include what a `20¢` price means and a link to an **`accuracy page`**; ends with `View more`.
**Rules / Market Context:** `role=tablist`, two tabs, body paragraphs + inline resolution-source mentions (AP, Fox News, NBC), truncated with `Show more` chevron (accordion `data-state=open|closed`, slide animation).
**Community:** tab order `Comments (999)` | `Top Holders` | `Positions` | `Activity`; composer `<textarea placeholder="Add a comment…">` + `Post` + "**Beware of external links.**" pill; controls `Newest ▾` sort + `Holders` filter; item = avatar · username · **position badge** (`5 JD Vance`) · timestamp (`14h ago`) · body · like + count · `N Replies` · `⋯`. Section id `#comments`, `max-lg:mt-8`.

**Our own detail spec (MARKET-DETAIL-DOSSIER, asserted):** IA = breadcrumb → main `lg:col-span-2` (header, probability history, recent activity, comments) + sidebar `sticky lg:top-20` (order ticket, resolution rules, contract specs) → related full-width. Component mapping: `.card`, `.card-hover`, `.badge-green/amber/red/muted` by status, `.prob-bar`/`.prob-bar-fill`, `.btn-yes`/`.btn-no` `.active`, `.input.input-lg` + preset chips `bg-pip-100 text-pip-500`, preview `dl` in `bg-surface-2` + `.divider`, icon chips `bg-pip-100 text-pip-500`. State machine `draft → pending → active → closed → resolved | disputed | cancelled`. Legacy bug recorded: header used `price-bar`/`price-bar-yes` which are not in the Pip stylesheet (tokens are `.prob-bar`/`.prob-bar-fill`). Forbidden-import bug recorded: `market-header.tsx` imported **lucide-react** (`Share2`, `Bookmark`, `ExternalLink`).
**Multi-outcome parity status (POLYMARKET-MULTI-OUTCOME-PARITY):** 12-row desktop element table and 8-row mobile table with ✅/🟡/❌ per element. Key gaps: category scroll rail on detail (🟡), 2-level breadcrumb (🟡), embed `</>` + bookmark (🟡), per-row 24h change chip (❌), timeframe missing **6H** (🟡), live "**200.00 matching**" liquidity hint (❌), chart-options sheet with Autoscale/X-Y-Axis/H-V-Grid/Annotations/Embed toggles (❌), `⇄` side-swap affordance (🟡).

### 3.3 Explicit gaps
- `PM-MARKET-DETAIL-MEASURED` **TODO block** (still open): Yes/No big toggle buttons in the ticket (markup uses a `.trading-button` wrapper); amount input (`$0`) computed styles; chart Y/X tick typography, gridline dash pattern, scrubber; comments composer + tab-bar active-underline metrics; **mobile 390px re-measure of header / legend (stacked) / board**.
- `PM-PARITY-SPEC` §6 unchecked: header title/breadcrumb verification; outcome-board fine-tune (avatar 7.2px, 28px % / −0.42px); related-markets category filter tabs on binary lists; related sublabel color → text-muted.
- Δ change chip: "needs 24h change data — not yet wired".
- Buy No on pick-one: "Our LMSR pick-one only supports Yes → needs independent order books (Phase C)" (since resolved by POLYMARKET-MULTI-OUTCOME-PARITY §7, which the older doc does not know).
- Inline order-book drawer "needs a CLOB/order-book data model" (since built — see §5).
- M7 deferrals: comment→position join for the position chip, replies tree, denser mobile Related list variant, trailing dashed series segment.
- Mobile build plan M4/M5/M5.5/M6/M8/M9 unbuilt at time of writing (outcome rows parity, Rules/specs, AI summary, news feed, FAQ, final polish). Bundle budget cited: **130KB first-load** (CI `check-bundle-budget`); i18n CI `check-i18n-keys`.
- MARKET-DETAIL-DOSSIER: all 6 review gates unchecked; explicit note "the working sandbox validated TSX syntax via esbuild only".
- No dark-theme measurements; PM captured light-only throughout.

### 3.4 Staleness risk
- **High.** Everything is a July capture of a live competitor. Specifically volatile: the `--navbar-height` value (two different numbers already in-corpus), the timeframe set (two variants already observed in one session), the `Earn 3.25%` yield chip, the AI-summary block, the news feed (PM ships these fast), the 340px rail width, and the FAQ topic list.
- Our side: `POLYMARKET-MULTI-OUTCOME-PARITY` §7 records a **live production change on 2026-07-11** (22 markets converted to independent pricing). Later docs in the corpus (`MULTI-OUTCOME-MARKETS`, `MARKET-CREATE-DOSSIER`, research `06`) were written against the *pre*-conversion world and are now wrong about the engine.
- 2026-09 docs (`CLOB-SETTLEMENT-2026-09`, `BRAIN-ARCHITECTURE-2026-09`) report that settlement was double-paying winners and that **64 of 64 production order books hold unbacked positions** — so any "✅ done / CI green" claim from July about trading correctness must be treated as superseded.

---

## 4. ORDER TICKET / BUY SHEET

### 4.1 Documents
| Doc | Date | Grade |
|---|---|---|
| `PM-BUY-SHEET-MOBILE-MEASURED-2026-07.md` | captured **2026-07-18**, 390×844 @3x iPhone UA; §9/§10 re-captured 2026-07-18 | **M1** (best in corpus for mobile) |
| `PM-PARITY-SPEC.md` §2.3 | 1440×1024 | **M1** |
| `PM-MARKET-DETAIL-MEASURED.md` (Order ticket table + 2026-07-18 addendum) | 1280×900 / 1440×1024 | **M1** |
| `KALSHI-ORDER-TICKET.md` | market `kalshi.com/markets/kxipo/ipos/kxipo-26`, 1440×1000 EST | **M1** (partial) + **A** |
| `BETTING-PANEL-CONVERSION.md` | none; "implemented" | **A** (+ benchmark prose) |
| `POLYMARKET-DETAIL-PARITY-2026-07.md` §1.8 | 2026-07-09 | **O** (ASCII wireframe) |
| `POLYMARKET-MULTI-OUTCOME-PARITY-2026-07.md` §3 | 2026-07 | **O** (10-row element table) |

### 4.2 Measured / specified values

**PM mobile buy sheet (Radix `role="dialog"` bottom sheet):**
- Overlay `fixed inset-0`, black **40%** (`rgba(0,0,0,.4)`), **z 1100**; sheet root fixed bottom, full width **390**, white, **border-radius 24px 24px 0 0**, **z 1101**.
- Content H-padding **24px** (Buy pill x=24; Trade btn x=24 w=342 → 390−48); section rhythm ~**20px** (`gap-5`); drag handle **60×5px**, `rgb(243,244,246)`, radius **16px**, ~**9px** below sheet top; font `Inter`.
- Header row h=**32**: `Buy` pill h**32**, pad-x **16px**, bg `rgb(244,245,246)`, text `rgb(14,15,17)`, **14px/600**, lh20, radius **full**; settings icon button **32×32**, radius **7.2px**, sliders icon **18×18** stroke **1.5**.
- Identity row h≈**44**: entity icon **42×42** radius **7px**; text left offset **78px** (= 24 + 42 + 12); market sublabel **14px/500 `rgb(119,128,141)`** lh20; outcome name **16px/600 `rgb(14,15,17)`** lh24; separator `·` `rgb(174,180,188)`; side Yes `rgb(66,199,114)` / No `rgb(226,57,57)` at 16px/600.
- Amount display: `text-align:center`, **56px/600**, letter-spacing **−1.4px**, `inputmode="decimal"`; placeholder `$0` `rgb(174,180,188)`; typed `rgb(14,15,17)` tabular-nums; section padding pt-8 (32) / pb-4 (16), px-8 (32).
- Yes/No segmented toggle: track **118×40** (2-option), bg `rgb(244,245,246)`, radius full, padding **4px**; thumb white h**32** radius full, width = active label width; label **14px/500**, active `rgb(14,15,17)` / inactive `rgb(174,180,188)`, pad-x 16 / py 6 / h32.
- Quick chips h=**30**: set `+$1 +$5 +$10 +$100`, centered; border **1px `rgb(230,232,234)`**, radius **9.2px**, text `rgb(119,128,141)` **12px/600**, ls **−0.1px**, pad-x **10px**; gap ~**4px**.
- Trade button: full width **342**, h**44**, bg `rgb(20,82,240)` (#1452F0), radius **9.2px**; label "Trade" white **16px/600**.
- Typed-amount payout block occupies a **reserved ~40px slot** between toggle and chips so the Trade button never shifts: "To win" label `rgb(72,78,86)` **16px/500**; payout value outcome-tinted **18px/600** tabular; avg-price line (`60.4¢`) `rgb(119,128,141)` **12px/500** centered below.
- Order-type popover (shown on **all** markets): card white, ~`rounded-xl`, 1px `rgb(230,232,234)`, drop shadow, ~**120px** wide, 4–6px inner padding; items `Market` / `Limit` each **32px** tall, `rgb(14,15,17)` **14px/500**, padding **6px/12px**, selected row gets `surface-2` fill.
- **Limit layout** (replaces the whole body; no big `$` amount, no Yes/No pill): identity side gets a **swap ⇄ icon** ~18px; `Limit price` label left **16px/500**; stepper box **150×40** radius **9.2px** border 1px, layout `[− | value¢ | +]`, input centered **18px/600** placeholder `0.0¢` with **¢** suffix; full-width **1px** hairline divider; `Shares` label **16px/500**; shares box **150×40**, input right-aligned **18px/600** placeholder `0`; shares quick-adds `−100 −10 +10 +100 +200` right-aligned, same chip shell, **last chip `+200` is accent** (pip-blue text + border); "matching" pill e.g. **"217.00 matching"** **12px/600** green `rgb(66,199,114)` on light-green tint with leading ⓘ; `Expires` row label `rgb(119,128,141)` **14px/500** / value **"Never ⌄"** `rgb(174,180,188)` 14px/500; `Total` row label `rgb(14,15,17)` 16px/500 / value **18px/500 blue `rgb(20,82,240)`**; `To win` row label 16px/500 / value **24px/500 green `rgb(48,161,89)`**. Client math `total = shares × (limitCents/100)`, `toWin = shares × $1`.
- Micro-interaction easing (re-verified): Buy pill / toggle labels / chips `color,background-color,border-color… 0.15s cubic-bezier(.4,0,.2,1)`; toggle **thumb** slide **`0.2s cubic-bezier(0,0,0.2,1)`**; Trade button **`transform 0.12s cubic-bezier(.4,0,.2,1)`** + `box-shadow/opacity/background-color/color 0.1s ease-in-out`.
- **Two distinct greens documented:** side label "Yes" + **market**-mode "To win" = `rgb(66,199,114)` `#42C772`; **limit**-mode "To win" = `rgb(48,161,89)` `#30A159`; No/red `rgb(226,57,57)`.
- Token map → repo: `rgb(14,15,17)`→`--text`; `rgb(119,128,141)`→`text-muted`; `rgb(174,180,188)`→placeholder; `rgb(244,245,246)`→surface fill; `rgb(230,232,234)`→border; `rgb(66,199,114)`→yes; `rgb(226,57,57)`→no; `rgb(20,82,240)`→pip blue; radius 24px sheet / 9.2px button-chip (`rounded-[9px]`) / 7.2px icon button.

**PM desktop ticket (measured):** container width **372px**, 1px hairline `#e6e8ea`. Buy/Sell tab **16px/600/ls −0.18px**, active `#0e0f11` w/ 2px underline element, inactive `#77808d`. Market dropdown **14px/500/ls −0.09px** `#0e0f11`, gap 4 (90×20 trigger, `rgb(14,15,17)`, inline right of the tab row). Yes pill (leading) filled green `#30a159` white **15px/600**; No pill neutral `#0e0f11` 15px/600; **unselected** (either side) fill `#F4F5F6` `rgb(244,245,246)` with muted text `#818283` `rgb(129,130,131)` — "ours was `--text-2 #5F6772` (too dark) → fixed to `--text-3`". Geometry: two-up grid, gap ~**12px**, radius ~**8px**, height ~**47px**. **Price format: one decimal `19.8¢` / `80.3¢`, trailing `.0` dropped (`20¢`)** — "ours rounded to whole → fixed `cents()` to 1-dp". Amount label **16px/500/−0.18px**; amount entry **40px/600 `#0e0f11`**, transparent, right-aligned inline `$`+number, with the explicit note "(re-measured; the small 14px input was a mis-note)". Quick chip **12px/600/−0.1px** `#77808d` h**30** radius **9.2px** 1px hairline, hover bg `#f9fafb`, 0.15s; chips `+$1 · +$5 · +$10 · +$100`. Trade button bg `#1452f0` h**43** radius **9.2px** white, **no hover recolor** (active-scale only), 0.12s. Legal line "By trading you agree to Terms of Use" small `#77808d`. Market-title line in ticket **14px/500 `#77808D`** truncate; outcome line **16px/600 `#18181B`** + green "Yes"; quick chip alt reading h30 pad 0/10 radius 9.2px.

**Behaviour parity (hard-observed):** desktop sidebar ticket **pre-selects the leading candidate**; **mobile has NO pre-armed ticket and NO auto-selected candidate** — "Repo bug to fix: our mobile auto-selects the leader (bias). Gate auto-select to desktop viewports only"; recorded as fixed in §6.

**Kalshi ticket (measured, partial):** YES accent `#0AC285` `rgb(10,194,133)`; NO accent `#D91616` `rgb(217,22,22)`; pills & CTA radius **999px**; price value **16px/400**; side label **13px/500**; tabs **13px/700** tracking ~**0.08em**; prices in cents (`YES 53¢`, `NO 52¢`); active side = solid fill, inactive = light grey; `55% chance` odds row; max payout two-line label with resolution date `Dec 31, 2026`; each contract pays **$1**; CTA full-width fully-rounded solid green with state-driven copy (`Sign up to trade` → `Buy Yes` / `Review order`). Order types from Help Center: Market (taker) / Limit (maker) with expiry **GTC / EOD / IOC / custom**.
Adopted → ours: BUY/SELL tabs with accent underline (**SELL honestly gated, disabled, "coming soon"** — `/api/orders` is buy-only); `DOLLARS ⌄` menu → `{CURRENCY} amount` vs `Contracts` (−/+ stepper, `contracts × price`, `usdToLocal`); `rounded-pill` YES/NO with `¢`; segmented `Market · Limit` (binary only) + `Limit price (¢)` input accepting **0.01–0.99**; `Odds` row; `Max payout` with `resolves_at ?? closes_at`; full-width pill CTA `Buy YES · to win …`. Deliberately not copied: Kalshi's exact greens/reds, "3.25% Interest on balance", social/activity rail.

**Our conversion strategy (BETTING-PANEL-CONVERSION, asserted):** P0 = ticket buried below 4 sections on mobile; P1 no sticky CTA; P2 payout hidden until typing; P3 empty amount cold start; P4 insufficient balance dead end; P5 outcome buttons under-sell payout. Shipped: `fixed bottom-0` `lg:hidden` bar with direct Buy YES / Buy NO (or `Buy {front-runner}`), tap opens a bottom sheet hosting the **same** `BettingPanel` pre-selected with stake pre-filled ("**2 meaningful taps**"); default stake = first balance-aware preset so the preview (shares, avg fill, fee, bold "To win") shows before typing; CTA `Buy YES · to win <amount>`; over-balance flips CTA to "Add funds to trade" dispatching `kichiko:open-deposit`; ≥44px targets, `aria-pressed`/`role=dialog`, focus trap/restore, body-scroll lock. Benchmarks cited: Kalshi bottom dock, Polymarket bottom panel, Robinhood sticky review bar, Razorpay/Baymard (CTA in bottom 40% thumb zone, LCP < 2.5s / INP < 200ms).
**Economics (source of truth `lib/trading.previewBet`):** local→USD at live `useRates`; `platform_fee_rate` + `creator_reward_rate`; numerically-stable LMSR inverse `sharesForBudget`; preview shows est. shares · avg fill price · **price impact (avg − marginal, in pts)** · fee · max payout (+profit %); `meetsMinBet` enforces a **$0.10** floor in the user's currency. Guarantee: "preview == execution" mirroring `place_bet` / `place_bet_option`.

### 4.3 Explicit gaps
- SELL path does not exist (no endpoint); limit orders binary-only in the Kalshi doc, and `POLYMARKET-MULTI-OUTCOME-PARITY` §3.3/3.4 target enabling Market/Limit and Yes/No pills "for all multi".
- Live "matching"/depth hint (❌), `⇄` side-swap affordance (🟡), order-type popover on multi rows (🟡).
- `PM-MARKET-DETAIL-MEASURED` TODO: ticket Yes/No big toggle buttons and the amount input still unmeasured (despite §2.3 of PM-PARITY-SPEC later giving 40px/600 — the TODO was never struck).
- No measured spec for the success receipt, error states, or the deposit sheet the CTA hands off to.
- Kalshi doc measures only colours/radii/3 type roles — no spacing, no geometry, no dark mode.

### 4.4 Staleness risk
- **High.** The buy sheet is a competitor surface measured on a single day (2026-07-18) at one viewport with an iPhone UA. Chip sets, the accent `+200` chip, the "Earn"/matching pill and the two-greens quirk are exactly the sort of detail that changes silently.
- Our own ticket: `BETTING-PANEL-CONVERSION` predates the PM-ticket rebuild and the `flags.pm_ticket` flag; the "2 meaningful taps" pre-selection strategy sits in direct tension with the later "mobile must not pre-arm" ruling (see contradictions).

---

## 5. CLOB DRAWER / ORDER BOOK

### 5.1 Documents
| Doc | Date | Grade |
|---|---|---|
| `PM-CLOB-DRAWER-MEASURED-2026-07.md` | captured **2026-07-18**, desktop 1440, harnesses `capture_drawer.py`/`capture_drawer2.py` | **M1** |
| `PM-CLOB-END-TO-END.md` | live-measured **2026-07-18**, 1440 @2×; §4/§4b hard-data appendices | **M1 + V** |
| `CLOB-ARCHITECTURE.md` | "Phase 1 in progress" | **A** |
| `CLOB-TWO-SIDED-ENGINE.md` (migration 033) | none | **A + V** |
| `CLOB-AUDIT-2026-07.md` | 2026-07, "complete" | **V** |
| `CLOB-SETTLEMENT-2026-09.md` (migration 069) | **2026-09** | **V** |
| `BRAIN-ARCHITECTURE-2026-09.md` | **2026-09** | **V** |
| research `00`, `01`, `03` | snapshot 2026-07-22 | **M2** |

### 5.2 Measured / specified values
**Interaction:** clicking a candidate row (avatar/name/big %, **not** the Buy pills) does not navigate; it expands an inline accordion drawer directly under that row: **+276 DOM nodes, +409px page height**. Only one drawer open at a time. The right-rail ticket simultaneously arms (`Presidential Election Winner 2028 / JD Vance · Yes`). Clicking again collapses.
**Tab bar** (`Order Book` default · `Graph` · `Resolution`), row at y≈**502**: font **14px/600** Inter; active `rgb(24,24,27)`; inactive `rgb(119,128,141)`; **hover on inactive lightens to `rgb(174,180,188)`** (active unchanged); ls **−0.09px**; lh **16px**; transition `color/background/border 0.15s cubic-bezier(0.4,0,0.2,1)`; tab gap ~**16px**.
**Right chrome:** Maker Rebate **14px/600** gold `lab(72.72 31.87 97.94)` ≈ `#F5B23B` at x≈**712**; Rewards **14px/600** pip-blue link at x≈**844**; refresh icon; `0.1¢` tick chip **12px/500** muted in a bordered chip at x≈**957**.
**Depth table:** heading `TRADE YES` **10px/600** uppercase, ls **0.5px**, muted, y≈**545**; four columns with x positions at 1440vp — Toggle **64**, PRICE **506**, SHARES **684**, TOTAL **872**; column headers 10px/600 uppercase muted. **Row pitch = 36px.** Order: asks descending → Last/Spread divider → bids descending.
- Price cell two-part: `XX.X%` bold side-colored + `(XX.X¢)` muted. Asks red `rgb(226,57,57)`; bids green `rgb(48,161,89)`. Shares & Total near-black **`rgb(24,24,27)`** tabular-nums (doc flags: "desktop uses zinc-900, not the mobile sheet's `rgb(14,15,17)`").
- Asks pill: white **10px/500** on red badge, absolute, ~**36×20**, x≈**70**, on the last ask row. Bids pill: white on green, ~**33×20**, x≈**70**, on the first bid row.
- Depth bars: left-anchored at x≈**62**, height **36px** (full row), width ∝ cumulative size ÷ deepest cumulative on that side; measured asks **7–8px** wide at these levels, bids **20–35px**.
- Last/Spread divider: `Last: 19.7% (19.7¢)` left, `Spread: 0.1¢` at x≈**484**, both **12px/600** muted `rgb(119,128,141)`.
- Two full ladders captured verbatim (JD Vance, 2026-07-18) with PRICE/SHARES/TOTAL — e.g. `20.3% (20.3¢) 3,300.62 $11,838.53` … `19.8% (19.8¢) 3,911.33 $774.44 [Asks]` / `Last: 19.7% (19.7¢) Spread: 0.1¢` / `19.7% (19.7¢) 29,879.72 $5,886.30 [Bids]` … `19.1% (19.1¢) 6,712.00 $13,391.48`. **TOTAL is cumulative from the inside price outward**, confirmed twice.
- Book auto-refreshes live (top ask observed moving 20.3% → 20.5% between polls); refresh icon forces re-fetch.
**Scroll behaviour (desktop == mobile):** container `<div class="relative h-full max-h-[var(--max-height)] overflow-y-auto w-full">`; window **`max-height: 360px`**, `height: 360px`; `scrollHeight` ≈ **8100px** (~225 rows @36px); column header **`position: sticky; top: 0`**; Last/Spread divider `position: static`; initial auto-scroll to the inside (desktop `scrollTop` 4896/7740, mobile 600/2528); ~**10 rows visible**.
**Graph tab:** large **blue** current value (`19.7%`) + change chip (`▼7%` red); single blue line (this candidate only); y auto-scaled ~10%→35%; faint Polymarket watermark; ranges `1H · 6H · 1D · 1W · 1M · ALL`, default `ALL`.
**Resolution tab:** `Propose resolution` outlined button (left) + `View details ↗` link (right). No table.
**Board observations:** expanded candidate + drawer wrapped in a single rounded hair-lined card (subtle 1px border); collapsed rows borderless with bottom hairline; change chips `▲ green` (Marco Rubio `▲8%`) / `▼ red` (Newsom `▼2%`, AOC `▼2%`, Vance `▼7%`) 12px/600; **rewards gift icon 🎁 after `$Vol.` on liquidity-rewards-eligible candidates only** (Rubio, Newsom, AOC, Ossoff); Buy buttons truncate the side word when the % is wide (`Buy Y... 19.8%`, `Buy ... 80.3%`).
**Our implementation (V):** `GET /api/markets/[id]/book?option=&side=` → `clob_get_book` (SECURITY DEFINER), returns `bids`, `asks`, `last`, `best_bid`, `best_ask`, `spread`; NO side **synthesized** from the YES book (resting BUY NO @ q ≡ SELL YES @ 100−q); public, cached **1–2s**; cumulative TOTAL + depth ratios added client-side via `shapeBook`/`withCumulativeTotals` in `lib/clob.ts`. States: loading skeleton · empty "No open orders on this book yet." · error "Could not load the order book" · live **polled every 4s while the tab is visible** (stops on tab switch). Graph tab lazy-loads `GET /api/markets/[id]/price-history?option=&max_points=200`. Components: `order-book-drawer.tsx`, shared `order-book-table.tsx` (`useClobBook`, `BookTable`, `OrderBookPanel`), `market-drawer.tsx` mobile sheet; mobile gaps tighten `gap-6 sm:gap-10`; `BookTable` mirrors `max-h-[360px] overflow-y-auto`, sticky `top-0` header, static divider, one-time center-on-divider. Tokens: asks `--no #E23939`, bids `--yes #30A159`, muted `--text-3 #77808D`, tab-hover `--ink-300 #AEB4BC`, gold `--amber`, links `--pip-text`. Drawer hairline `rgb(230,232,234)` == `--ink-100 #E6E8EA`.
**Engine (asserted + verified):** `markets.pricing_engine 'amm' | 'clob'` (default `amm`); tick **0.1¢** stored `price_cents numeric(4,1)` in `[0.1, 99.9]`; `clob_orders` / `clob_fills` (`match_kind direct|mint|burn`); match taxonomy table (direct / mint / burn with execution price = maker's price, `100 − maker's C price` for synthetics); escrow: resting BUY reserves `size × limit/100` cash, resting SELL reserves shares; invariants I1 share conservation (Σ YES ≡ Σ NO), I3 price-time priority, I4 self-trade prevention, I5 no negatives; `flags.clob` kill-switch; pgTAP + vitest + fuzzer `fuzz_invariants.py`; remediation migrations **042–045**; two-sided engine **033**; settlement fix **069**; maker-scan fix **071**.
**Research numbers that bound this surface (M2, snapshot 2026-07-22 14:42 UTC, n=600 markets / 140 books / 218 tokens):** median **93** price levels per outcome token (min 37, mean 108, p95 221, max 353); top-of-book spread median **0.002 (0.2¢)**, p25 at the **minimum tick 0.001**, p95 0.014, max 0.040; spread in bps of mid median **175.5**, p95 **6,666.7**; notional depth within 5¢ median **$38,813**, mean $726,847, p95 **$5,918,576**, max $11,103,708 (one market held **$7.73M**); book imbalance median **0.00**; tick **0.001 for 388 markets (64.7%)** / **0.01 for 212 (35.3%)**; min order ≈ **$5** (CLOB shows 15 on some sports markets); 24h volume median $25,683 / mean $87,683 (**3.4×**) / max $8,410,845; lifetime volume median $148,668 / mean $2,273,925 (**15×**); resting liquidity median $68,022 / p95 $538,444.

### 5.3 Explicit gaps
- Sell/burn, expiries and maker rebates were "1b′" at the time of the July docs (`CLOB-TWO-SIDED-ENGINE` later covers burn; `BRAIN-ARCHITECTURE-2026-09` says fees are still **not charged at all**).
- Per-user order rate cap listed as "1b′".
- Research `06` P1: tick size / min order size / max spread **not stored per market**; proposed migrations `031_market_trading_constraints.sql` and `032_price_coherence_guard.sql` are explicitly "**not applied**".
- No neg-risk conversion economics; no explicit mutual-exclusivity constraint.
- Depth-aware "walk-the-book" order preview is a documented gap (research `04` §4, `06` P1-5).
- **2026-09 open defects:** settlement fixed only on a branch, "not yet applied to production"; 64/64 production books hold unbacked positions; 2,280 of 2,291 production orders carry no engine metadata (i.e. did not come through the engine — seed orders); order latency ~1s driven by app `jnb` ↔ DB `eu-west-1` topology; `BRAIN-ARCHITECTURE` §9 lists decisions still needed from the owner.

### 5.4 Staleness risk
- **The competitor measurements are the most likely to survive** (a depth ladder's geometry is stable), but the gold `Maker Rebate` / `Rewards` chrome and the `0.1¢` chip are promo-adjacent and may move.
- **Our own CLOB claims from July are the most dangerous stale content in the corpus**: `CLOB-AUDIT-2026-07` says "Status: complete … applied to the live database", and `PM-CLOB-END-TO-END` reads as shipped; `CLOB-SETTLEMENT-2026-09` and `BRAIN-ARCHITECTURE-2026-09` then document 8 settlement defects, money-minting deposits, and unbacked books. Treat July's ✅ as unverified.

---

## 6. PORTFOLIO

### 6.1 Documents
`PORTFOLIO-DOSSIER.md` — undated, "Status: rebuild on the Pip design system". Grade **A**. References IBKR web portfolio + Tremor/Next.js finance dashboards as prose research (no captures, no measured values).

### 6.2 Values present
- IA: KPI band (total value · unrealized P&L % · today's P&L · cash USD) → Holdings (allocation donut + holdings table) → Recent activity.
- Valuation model (single source `lib/portfolio.ts`): open positions marked to the **live** market price (never the stale `positions.current_value_usd` snapshot); settled positions use `$1/$0` payout; cash = Σ `localToUsd(wallet.available_balance)` via `fetchRatesMap()` (anon-readable `exchange_rates`, falls back to last-known); total value = open MTM + cash; **today's P&L** = per position mark at the earliest `price_history` point since **00:00 UTC**, markets with no tick today contribute **0**; weight = `currentValue / Σ open currentValue`.
- Components: `SummaryCards` (4 KPI tiles, `.card`, signed values `--yes/--no`, neutral when flat); `AllocationDonut` (recharts `PieChart`, tokenized categorical palette, center = total holdings value, legend rows show weight %); `HoldingsTable` (semantic table in `.table-wrapper`; columns Position, Avg cost (¢), Live (¢), Mkt value, P&L ($ + %), Weight with a `.prob-bar`-style meter; per-row expand → shares, invested, entry price, side, market link); `TransactionHistory` (custom-icon rows, signed amounts).
- A11y/perf: `<th scope>`, `<button aria-expanded>`, donut `aria-label` text summary, `force-dynamic` + `noindex`, server-computed figures, client bundle = donut + expand only.

### 6.3 Gaps
- **Zero measured values**: no px, no type sizes, no colors, no breakpoints, no competitor capture. Everything is structural.
- No PM/Kalshi portfolio teardown exists anywhere in the corpus (the nearest is the trader-profile portfolio table in `TOP-HOLDERS-DOSSIER` addendum + `docs/holder-page-pm-parity-spec.md`).
- No empty/error/loading specifics beyond "Empty state when no open positions".
- "Today's P&L" is honest-but-degraded by design (0 when no tick) — an accepted limitation, not a TODO.

### 6.4 Staleness risk
- **Low-medium** (it is our own structure, not a competitor snapshot), but it is undated and predates the CLOB conversion: a CLOB/secondary-trading world changes P&L semantics, and `CLOB-SETTLEMENT-2026-09` defect 6 says "Realized P&L and payout history overwritten … secondary-trading P&L lost at resolution". The portfolio numbers may therefore have been wrong in production.

---

## 7. AUTH / ONBOARDING

### 7.1 Documents
| Doc | Date | Grade |
|---|---|---|
| `AUTH-ONBOARDING-DOSSIER.md` | none | **A** |
| `AUTH-MODAL-M3.md` (adjacent, read for coverage) | none; "implemented" | **A + V** |
| `AUTH-PASSWORDLESS-M4.md` | none; "implemented" | **A + V** |
| `AUTH-AUTOADVANCE-M5.md` | none; "implemented" | **A + V** |

### 7.2 Values present
- Model **Preview → Gate → Bridge**; routes `/auth/login`, `/auth/register`. Login = email + password only; register = name, email, password, country, referral on demand.
- `AuthShell` 2-col grid, bridge `hidden lg:flex`; brand-led in **Pip blue**, "never the market-green (green is reserved for YES semantics)". `PasswordInput` uses a **Show/Hide text toggle**, not an eye glyph; correct `autoComplete` (current- vs new-password); `aria-describedby` to the strength meter. **0–4** password-strength meter; emoji-free country select ("Kenya · KES").
- Removed undefined legacy `var(--green-dim/faint/light)` styles.
- M3 dialog: single `AuthDialog` mounted in `Providers`, opened via `window` CustomEvent **`kichiko:open-auth`** (siblings `kichiko:open-deposit`, `:select-option`); shared logic `lib/auth-form.ts`; contextual reason line "*Sign in to place KSh 500 on Yes.*"; states login/register/loading/error/emailSent; tokens reused verbatim (`--surface`, `bg-surface-2`, `border-hairline`, `bg-pip-100/500`, `text-pip-text`, `.btn .btn-primary .btn-lg`, `.input`, `.tab-pill`, `rounded-pill`, `font-display`, `shadow-[var(--e3)]`, `animate-fade-in` / `animate-scale-in` / `animate-slide-up`); responsive **≥lg** centered `max-w-md` `animate-scale-in`, **<lg** full-width bottom sheet with grab handle, `env(safe-area-inset-bottom)`, `max-h-[88vh]`; 16-row QA scenario matrix; **21 unit + 15 e2e** tests.
- M4 OTP: `OTP_LENGTH = 6`; `otp_length = 6`, `otp_expiry = 3600` pinned in `supabase/config.toml`; branded `supabase/templates/magic_link.html` renders `{{ .Token }}` and **no** `ConfirmationURL`; `signInWithOtp` without `emailRedirectTo`; auto-verify on the 6th digit; `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength=6`; **+5 unit → 682 unit total**, **+2 e2e → 19 e2e**.
- M5 auto-advance: on guest→auth transition, funded (`balance ≥ stake`) → scroll + focus the Trade CTA (**never auto-execute**); underfunded → open deposit sheet prefilled with `shortfall = ceil(amount − balance)`; `planFunding` floors bad input to 0; `kichiko:open-deposit` accepts `{ amountLocal }` ("Pay KES 300"); **+4 unit → 686**, **+2 e2e → 23**.

### 7.3 Gaps
- No measured values (no px/type/colour) anywhere in the auth docs; they are structural + token-reuse only.
- Follow-ups listed: resend-code cooldown/countdown; **phone (SMS) OTP** pending an SMS provider (Supabase phone auth + Twilio/Africa's Talking); progressive migration of navbar "Sign in" links to `openAuthDialog`; post-deposit focus return (needs a wallet-balance subscription).
- No competitor capture; research is prose (Stripe, themasterly.com, Robinhood).
- Tiered identity T0→T3 is promised in `LANDING-PAGE-DOSSIER` §1.4/§4 but the auth dossier does not define it.

### 7.4 Staleness risk
- **Low-medium.** Test counts (682/686 unit, 19/23 e2e) are point-in-time and will have moved. `COPY-REWRITE-SPEC` D15–D17 proposes copy changes to these exact screens ("End-to-end encrypted · No credit card needed" → "Safe and private · No credit card needed.") which are **awaiting approval**, so shipped copy may now differ from either doc.

---

## 8. KYC

### 8.1 Documents
`KYC-DOSSIER.md` — undated; "Status: **v2 — Institutional 'Verification Console'** (complete UI redesign)". Grade **A**.

### 8.2 Values present
- Route `/kyc`. Layout = two-pane **Verification Console** mirroring `AuthShell`: sticky left trust bridge (brand lockup, `VerificationMeter` Basic→Enhanced ladder, vertical 5-step stepper with `aria-current`, `TrustRail` chips: AES-256 encryption, data-protection compliance, human compliance review, "never sold / never shared", review SLA) + right gate pane. Mobile: rail collapses to a compact "Step X of N" bar + live `LevelBadge`.
- Flow `Overview → Email → Phone → ID document → Selfie → Address → Submit`; overview pre-informs "~3 min"; email read-only (already confirmed at signup) with a Verified badge; phone → `profiles.phone_number`; ID type = National ID / Passport / Driver's licence + number, country, optional expiry, front (+back when applicable) with camera capture; selfie front-camera; address unlocks Enhanced.
- Levels: **Basic** = email + phone → trading + smaller limits; **Enhanced** = + ID, selfie, address → full deposits, withdrawals, highest limits.
- Backend: existing `kyc_documents` (type/number/country/expiry + front/back/selfie URLs in bucket `kyc-documents`), flips `profiles.kyc_status → pending`; **Migration 019** adds nullable `address_line1/city/postal_code/country`; the address write is a best-effort try/catch follow-up so submission succeeds pre-migration.
- Components: `KycConsole`, `VerificationMeter`, `KycStepper` (`orientation="vertical"` / `"compact"`), `TrustRail`, `FileDrop` (drag-drop + browse + `capture` camera hook, live preview, type + size validation), `LevelBadge`, `KycWizard`.
- A11y: real `<label htmlFor>`, errors `role="alert" aria-live`, `aria-current="step"`, never colour-only, client-rendered / no indexable content.

### 8.3 Gaps
- **No measured values at all** — no px, type sizes, colors, breakpoints, file-size limits, or copy strings beyond a few phrases.
- Research is prose (greenmoov.app, shadcn.io identity block, Stripe Identity / Persona / Onfido) — no captures.
- Tier ladder here is **Basic/Enhanced (2 levels)**; the landing dossier promises **T0→T3 (4 tiers)**.
- No spec for rejection/resubmission, document-expiry re-verification, or the compliance reviewer's side.
- No limit values stated ("smaller limits" / "highest limits" are unquantified).

### 8.4 Staleness risk
- **Low-medium**; undated and self-describing as a v2 redesign. `COPY-REWRITE-SPEC` D11 touches these strings and is unapproved.

---

## 9. PROFILE (own profile + settings entry)

### 9.1 Documents
`SUPPORTING-PAGES-DOSSIER.md` §3 (`/profile`). Grade **A**. Cross-page rules in the same doc's preamble.

### 9.2 Values present
- Cross-page system rules: shell `mx-auto max-w-* px-4 py-6/8`; page title `font-display text-2xl text-text-primary`; section headers `text-sm font-semibold text-text-secondary`; all numbers `.mono`/`font-mono` tabular, money neutral ink, only P&L/deltas take `--yes/--no`; custom SVG icons only; every async surface ships skeleton/empty/error; **390px first**; tables in `.table-wrapper`; motion `animate-fade-in`/`animate-slide-up` on mount only, row hovers are border/elevation "never scale-bounce".
- IA: identity header (avatar · display name · @username · joined · KYC badge · referral chip) → KPI strip (Total bets · Win rate · Volume · P&L) → two-column body (left: positions history + link to `/portfolio`; right rail: wallets + settings entries Notifications/KYC/Deposit) → edit profile form (name, username, bio, phone, currency; inline Save; "Saved" pill with `aria-live`).
- Components `ProfileHeader`, `StatStrip` (4 `.stat-chip` tiles with `IconTrophy`, `IconPercent`, `IconTrendUp`, `IconPortfolio`), `PositionsHistory`, `WalletsCard`, `EditProfileForm`. Guard → `/auth/login`; `robots: noindex`.
- Legacy language being removed: DaisyUI `tabs-boxed`, `table-zebra`, `bg-base-200`, `badge-success`, emoji headings 🏆🔍👤🔔.
- Backends unchanged: Supabase `profiles`/`wallets`/`positions`/`notifications`, `GET/PATCH /api/notifications/preferences`.

### 9.3 Gaps
- No measured values; no competitor capture (research prose: Stripe Dashboard settings, Robinhood/eToro headers).
- `/settings` itself has **no dossier** (only "settings entries" links from profile and nav).
- No spec for avatar upload, username uniqueness/validation, or the referral program surface.

### 9.4 Staleness risk
- **Medium.** Undated. `COPY-REWRITE-SPEC` D20 explicitly defers profile/notifications/settings labels to "during implementation", so this page's copy is unspecified-by-design.

---

## 10. LEADERBOARD

### 10.1 Documents
`SUPPORTING-PAGES-DOSSIER.md` §1 (`/leaderboard`). Grade **A**. This is the **only** documentation for the surface.

### 10.2 Values present
- IA: header (title + period × metric context) → controls (metric segmented ×3: Volume / Win rate / P&L; period pills ×3: All-time / Month / Week) → podium (#2 · #1 · #3) → standings table (`#` · Trader avatar+name+@user · Metric · Bets · Win% · P&L).
- `MetricControl` = Pip segmented control, active pill `--pip-100`/`--pip-text`, `role="tablist"`, arrow-key roving focus. `Podium` = three plinths, **#1 taller and brass-accented**, rank numeral in a rounded medallion, stacks to a 1-2-3 list under `sm`, explicitly "no confetti, no gold gradients — brass hairline accents only". `StandingsTable` = real `<table>`, sticky header, `.mono` right-aligned, win rate as `.badge-green/.badge-muted`, signed P&L, rank medals as tinted numerals not emoji. States: **8-row skeleton**; empty "No ranked traders yet" + custom trophy SVG.
- Backend already shipped: `GET /api/leaderboard` (SWR headers set server-side).

### 10.3 Gaps
- **No measured values whatsoever** — no px, type, colors, row heights, breakpoints, or copy beyond labels. No Kalshi/Polymarket leaderboard capture exists in the corpus (research is one paragraph of prose).
- No tie-break rule specified beyond "rank-stable with tie-breaks".
- "you-row highlight **ready**" — i.e. not implemented.
- Roadmap step 2 of 6; review-loop checklist unchecked.

### 10.4 Staleness risk
- **Medium.** Undated; `COPY-REWRITE-SPEC` D8 rewrites the whole description line and proposes "trader → player" (unapproved, §F item 5).

---

## 11. TOP HOLDERS / TRADER PROFILE

### 11.1 Documents
| Doc | Date | Grade |
|---|---|---|
| `TOP-HOLDERS-DOSSIER.md` (base) | none | **A** (PM described element-by-element from a capture of an `Argentina` World-Cup market, but no numbers) |
| `TOP-HOLDERS-DOSSIER.md` **Addendum v2 — live Polymarket teardown** | none | **M1** for the avatar gradient; **A/O** elsewhere |
| `POLYMARKET-DETAIL-M7-COMMUNITY-CHART-2026-07.md` §1 | 2026-07 | **M1/O** |
| `docs/holder-page-pm-parity-spec.md` (adjacent, outside the requested set) | desktop **1280px** + mobile **390px** | **M1** |

### 11.2 Values present
- **Gradient orb avatar (the measured centrepiece):** PM uses no letter monograms; computed `background-image` is four stacked radial gradients at **fixed anchors `66% 77%`, `29% 97%`, `99% 86%`, `29% 88%`**, each fading to transparent at **50%**, `border-radius: 50%`. Ours: `lib/trader.ts › traderOrb(id)` — FNV-1a → xorshift PRNG → 4 HSL colours (**S 62–88%, L 46–66%**) at those exact positions over a darker base `hsl(h,42%,26%)`; **12 unit tests** lock determinism and geometry.
- Model **Board → Peek → Profile**. Board = outcome `<select>` (multi only) + two mirrored columns (`Yes holders` | `No holders`) with right-aligned uppercase `SHARES` headers, **10 rows each** + "Show more", `grid-cols-1 sm:grid-cols-2`; shares colored `text-yes`/`text-no`; ranked desc via `market_top_holders` (`side_rank`), RPC returns **≤20 rows/side**, indexed on `(market_id, market_option_id, side, shares desc)`.
- Peek = `role="dialog"`, labelled, `Esc` to close, opens on hover **and** focus **and** tap; orb + name + "Joined Mon YYYY" + 3-up **Positions / Profit-Loss / Volume** from `trader_card_stats`.
- Profile `/traders/[id]`: `TraderHeader` (identity + stat strip Positions value · Biggest win · Predictions), `PnlCard` (big signed $ + range switch `1D 1W 1M 1Y YTD ALL` + inline-SVG sparkline, aligned daily ticks), `TraderPortfolio` (Positions/Activity tabs, Active|Closed segmented, search, sortable). Active cols `MARKET · AVG · CURRENT · VALUE` with outcome chip (`Yes 10¢`), qty, current value, unrealized P/L %; Closed cols `RESULT · MARKET · TOTAL TRADED · AMOUNT WON` with `✓ Won` chip and realized P/L. Sort toggles `Value ▾` / `Profit/Loss`.
- RPCs: `market_top_holders`, `trader_card_stats`, `trader_public_profile`, `trader_pnl_series`, `trader_positions` — all `SECURITY DEFINER` + read-only, public aggregates only ("never phone, email, wallet, KYC"). Migration `026_top_holders_and_trader_profile.sql`; `profile_views`.
- Tokens: radii **8/12/16**, shadows **e1–e3**, `text-yes`/`text-no` use AA-safe `--yes-700/--no-700` at small sizes.
- Our 6 improvements over PM (explicit): real usernames not hex; a **"You"** anchor row; keyboard/touch-accessible peek; share count translated into value + P&L; a **share-of-book concentration bar** (off by default on mobile); teaching empty state.
- Demo data: `scripts/seed_demo_traders.py` seeds ~**60** orb-only traders, Yes+No books on featured binaries and **every option** of multi markets, closed won/lost positions, **45-day** aligned price history, activity feed, recomputed aggregates; idempotent by `@demo.kichiko`.
- Adjacent `holder-page-pm-parity-spec.md` (measured): font Inter; body 16/24/400 `#000` on `#fff`; primary `#0E0F11` *and* `#18181B`; muted `#77808D`; blue `#1452F0`; green `#42C772`; red `#E23939`; hairline `#E6E8EA`; surface tint `#F4F5F6`; transition `0.15s cubic-bezier(0.4,0,0.2,1)`, search focus `box-shadow 0.2s`; control radius **7.2px** (buttons/segments) / **9.2px** (pills/range/search); avatar gradient identicon **44px desktop** (64px in the mobile ref); display name h1 ~**24px** bold; sub-line "Joined {Mon YYYY} · {N} views" **12–14px** `#77808D`.
- M7 parity table: PM decorates each commenter with their own position chip (e.g. "223 Spain") and shows "N Replies" — both **deferred** (need a comment→position join and a replies tree) "rather than mocked — consistent with the project's 'data-ready, never fabricated' rule".

### 11.3 Gaps
- Base dossier has **no px/type measurements** for the board, rows, or peek; the addendum measures only the avatar gradient precisely.
- Milestones 2–6 (migration, components, profile page, seed data, tests) were listed as pending when written; only step 1 is ticked.
- Comment position chip + replies tree deferred. Denser mobile Related list deferred.
- PM profile route recorded as `/profile/0x…` (or `/@username`) vs ours `/traders/[id]` — no redirect/canonical policy stated.

### 11.4 Staleness risk
- **Medium.** The orb technique is stable; the profile page layout and the stat-strip composition are PM product surfaces likely to drift. Two documents describe the same surface with different avatar sizes (44px vs the dossier's `sm|md|lg` abstraction) and different primary-text hexes.

---

## 12. ADMIN

### 12.1 Documents
**None in the requested corpus.** No `docs/design/*ADMIN*` file exists.
Adjacent, outside `docs/design/`: `docs/08-ADMIN.md` (859 lines — roles/permissions, route IA, feature specs, data model, API & security, rollout, acceptance criteria, superadmin invariants) and `docs/ADMIN-AUDIT.md`. Neither is a UI/visual spec: `docs/08-ADMIN.md` §5 is titled "UX & non-functional requirements" but the design corpus carries no tokens, measurements, or component specs for admin.
`COPY-REWRITE-SPEC` §E covers admin only mechanically: apply `market → event`, `bet → prediction`, USD → `KSh`, em-dash removal; "**Wording, structure, and technical labels stay as-is**" (Ledger, Disputes, Gateways, KYC, Payouts, Audit log).

### 12.2 Gaps
- No Pip-system port documented for admin; no measured values; no competitor reference; no a11y/dark-mode pass; no skeleton/empty/error inventory.
- Admin resolution UI is implicated in a **2026-09 production defect**: `CLOB-SETTLEMENT-2026-09` defect 5 — "Admin-console resolution inserts notifications without the 062 opt-in → every admin resolution with a winner fails with `P0121`".

### 12.3 Staleness risk
- **High by omission.** The admin surface has shipped features (resolve, dispute, gateways, payouts) with no design record in this corpus.

---

## 13. SUPPORTING PAGES (search, notifications, help, legal, offline, 404)

### 13.1 Documents
`SUPPORTING-PAGES-DOSSIER.md` (`/leaderboard`, `/search`, `/profile`, `/notifications`) — Grade **A**.
`COPY-REWRITE-SPEC.md` D9–D14, D19 — Grade **A**, and explicitly **awaiting approval**.

### 13.2 Values present
- `/notifications`: IA = header (title + unread count chip + "Mark all read") → type filters (All · Trades · Money · Markets · Account) → collapsible `DeliveryPreferences` → feed grouped **Today / This week / Earlier**; row = medallion icon + title + body + relative time (`date-fns`) + unread dot + subtle `--pip` left rule; whole row is a `<button>` when unread (Enter/Space marks read), links via `data.href`. Type→icon map given for all 13 notification types (bet_filled, bet_won, bet_lost, deposit_completed, withdrawal_completed, withdrawal_failed, referral_bonus, market_created, market_resolved, market_closing_soon, price_alert, kyc_approved, kyc_rejected, system_announcement) with group colouring pip/yes/no/brass. In-app row shown as "Always on" (disabled, explained); optimistic PATCH with revert on error; realtime INSERT subscription preserved; **6-row skeleton**; empty "You're all caught up" + custom bell SVG; `robots: noindex`.
- `/search`: see §2.2.
- Copy spec: legal/help/responsible-play/offline strings enumerated (e.g. "Trading involves real risk — only stake what you can afford to lose." → "This is real money and real risk. Only stake what you can afford to lose."; "Never bet essential funds." → "Never stake money you need for essentials."; support email `support@kichiko.app` vs DB `support@kichiko.co.ke`).

### 13.3 Gaps
- No measured values on any supporting page.
- **No documentation at all** for: `/settings`, deposit/withdraw sheets and M-Pesa STK flow, responsible-play tooling UI (limits, cooldown, self-exclusion — promised in `LANDING-PAGE-DOSSIER` Phase 4), legal page **layout** (copy only), `/offline` (copy only), 404/500/error pages, email templates other than `magic_link.html`, an empty-state/illustration library, and any onboarding tour.
- `COPY-REWRITE-SPEC` §F carries **7 unresolved judgment calls** blocking the whole rewrite (trade/trading wording, responsible-play harm verbs, M-Pesa-only payment list, support email, "trader" vs "player", "Portfolio" vs "My predictions", route-rename blast radius).

### 13.4 Staleness risk
- **High for COPY-REWRITE-SPEC**: it is an unapproved plan that, if executed, changes routes (`/markets → /events` with 301s), currency display (KES only, `KSh 1,250`), and price notation (`%` not `¢`) across every other surface in this corpus. Its approval state as of 2026-09-27 is unknown from the docs.

---

## 14. MULTI-OUTCOME MARKETS (cross-surface)

### 14.1 Documents
| Doc | Date | Grade |
|---|---|---|
| `MULTI-OUTCOME-MARKETS.md` | none; "Design approved for phased implementation"; migration `020` | **A** |
| `POLYMARKET-KALSHI-PARITY.md` | none; "Design approved"; migration `022` | **O/A** (reference *images*, Kalshi `kxipo` + a ranked list) |
| `POLYMARKET-MULTI-OUTCOME-PARITY-2026-07.md` | 2026-07; **activation record 2026-07-11** | **O + V** |
| `PM-MARKET-DETAIL-MEASURED.md`, `PM-PARITY-SPEC.md`, mobile groundtruth | 2026-07 | **M1/M3** (board geometry — see §3) |
| research `02`, `05`, `06` | 2026-07-22 | **M2 + V** |

### 14.2 Values present
- `MULTI-OUTCOME-MARKETS`: FR1 **2..N outcomes, N default cap = 12**; FR3 Σ price = 1 (proper simplex); FR4 winner pays `shares × $1`; NFR3 prices ∈ [0,1], `|Σ price − 1| < 1e-4` (`CHECK (price >= 0 AND price <= 1)`, app assertion `abs(Σ price − 1) < 1e-4`, alert if `> 1e-3`); min bet **0.10 USD**; LMSR `price_i = exp(q_i/b)/Σ exp(q_j/b)`, `cost = b·ln(Σ exp(q_j/b))`, stabilized by max-subtraction; `Outcome { id, key, label, price∈[0,1], volumeUsd, isWinner|null, displayOrder }` normalized in `lib/markets/outcomes.ts`; migration `020` column list; error `400 outcome_mismatch`; flag `markets.multiOutcome` default off; a11y = radiogroup of labelled radios.
- `POLYMARKET-KALSHI-PARITY`: model comparison table (PM/Kalshi = N independent binary lines, Σ ≠ 100%; Kichiko = simplex, pick-one); avatars **mandatory per option** with a deterministic placeholder; migration `022_option_entity_media.sql` (`market_options.image_url/entity_kind/entity_ref`, `markets.cover_entity_kind/cover_entity_ref`); ingestion waterfall (admin URL → Brandfetch/logo.dev/Clearbit/S2 favicon → Wikipedia → CoinGecko → monogram) normalised to **square WebP 128+256** in bucket `entity-media`; backfill of **22** existing multi-choice markets; target UX ASCII layout with `Yes 48¢ / No 54¢` rows, sort/search/filter header, row `▸` expand to a mini sparkline; interaction contract (rows are a `radiogroup`, `aria-pressed` on Yes/No, ≥44px, "New" chip on 0-volume, resolved pins winner and greys losers); phases A–D; Phase C flag `ff_independent_options`.
- `POLYMARKET-MULTI-OUTCOME-PARITY` — the decisive doc: it **supersedes `POLYMARKET-KALSHI-PARITY` §2**. Two real engines exist — `options_pricing_mode = 'simplex'` (one shared pool, Σ price = 1, **Yes only**, `place_bet_option`, `resolve_market_options`) and `'independent'` (per-candidate binary LMSR, **Yes + No**, `place_bet_option_binary`, `resolve_market_options_binary`). "All **22** live multi markets are `simplex`, and `flags.independent_options` does not exist … → **no No buttons**. That is the whole gap." **Blocker found:** both resolve routes (`app/api/markets/[id]/resolve/route.ts`, `app/api/admin/markets/[id]/action/route.ts`) hard-coded the simplex resolver, so an independent market would let users buy No and never pay No holders — "silent fund mis-settlement". Decision: **Option A** (flip live markets to independent) over Option B (complement-No in the simplex engine). Settlement semantics: a position wins iff `(option = winner AND side='yes') OR (option ≠ winner AND side='no')`. Row code detail: `noCents = cents(o.noPrice ?? 1 − o.price)`, `dualPills()` rendered only when `independent`; ticket syncs from `kichiko:select-option` carrying `{ optionId, side }`.
- **Activation record 2026-07-11 (V):** M-A + M-B merged (PR #6, squash `5d3f4ce`) with lint · type-check · **unit 534** · build · migration-lint · security · i18n · a11y green; migration `027` applied live; `platform_settings.flags.independent_options = true`; **all 22 active `multiple_choice` markets converted** with `set_market_pricing_independent()`, probabilities preserved (Ruto stays 44¢ Yes / 56¢ No); E2E verified in a rolled-back txn (bought No on a 5% candidate, resolved a different winner, No holder paid). Rollback SQL given; pre-conversion snapshot `phase2_pre_conversion_snapshot.json`.
- Research side: **50.17%** of PM's universe is `negRisk`; neg-risk identity `NO(k) ≡ YES(union of others)`; augmented neg-risk needs `negRisk` + `enableNegRisk` and supports named / placeholder / explicit **"Other"** (`negRiskOther`) outcomes; `negRiskRequestID` ties a market to its group; `Σ P(YESᵢ) = 1` is the multi-outcome generalization.

### 14.3 Gaps
- `POLYMARKET-KALSHI-PARITY` §2.2 ❌ list: per-candidate Yes/No, independent probability, row-expand ticket/mini history, candidate subtitle + avatar, sort controls, search-within-options, per-candidate volume / 24h change.
- `POLYMARKET-MULTI-OUTCOME-PARITY` M-E follow-ups: per-row 24h change chip, matching/depth hint, chart-options sheet, embed action, `⇄` side-swap, category scroll rail on detail.
- Research `06` P1-4: no neg-risk conversion economics, no explicit mutual-exclusivity constraint, no "Other" bucket.
- `ENTITY-IMAGERY`: 75/107 options still monogram; create-wizard auto-suggest unbuilt.

### 14.4 Staleness risk
- **Critical.** `MULTI-OUTCOME-MARKETS.md` and `MARKET-CREATE-DOSSIER.md` describe a world that production left on 2026-07-11. Anyone implementing `MULTI-OUTCOME-MARKETS`' Σ price = 1 DB constraint (or research `06`'s proposed `032_price_coherence_guard.sql`) would break the 22 live independent markets.

---

## 15. MARKET CREATE (extra surface found in the corpus)

`MARKET-CREATE-DOSSIER.md` — undated. Grade **A**. Route `/markets/create`; 4-step wizard `Structure → Question & outcomes → Resolution → Review & publish` with a sticky live `MarketPreview`. Validation: title **10–200**, description **20–2000**, criteria **20–1000**; close ≥ **1h** in the future; resolution ≥ close; URL-validated source with a source-quality prompt. Backend additive: reuses `resolution_type`, `resolution_source`, `metadata`, `yes_price`/`no_price`; POST `/api/markets` Zod extended with `resolution_type` (default binary), `resolution_source`, `initial_probability`, `metadata`; user markets land in `pending`, admins/mods publish to `active`. Components `CreateWizard`, `WizardProgress`, `StructureCard`, `ProbabilityField`, `MarketPreview`.
**Gap/staleness:** §2 asserts "The trading engine is **binary LMSR** … There is no outcomes table and the market detail/ticket render binary only … **Multi-outcome** is … gated *Coming soon*". This is contradicted by `MULTI-OUTCOME-MARKETS` (migration 020, `market_options`), `POLYMARKET-KALSHI-PARITY` (22 live multi markets), `ENTITY-IMAGERY` (107 live options) and the 2026-07-11 activation. **Treat as the single most stale document in the corpus.** No measured values; per-option image preview / auto-suggest in the wizard remains unbuilt.

---

## 16. SURFACES WITH NO DOCUMENTATION

Within the audited corpus (`docs/design` + `docs/research/polymarket`):

1. **Admin console UI** — no design doc at all (only non-design `docs/08-ADMIN.md`, `docs/ADMIN-AUDIT.md`).
2. **Deposit / withdraw / wallet** — the highest-stakes money UI in the product. Mentioned only in passing (`kichiko:open-deposit`, "Pay KES 300", DepositSheet in navbar, "Instant via M-Pesa" copy). No dossier, no M-Pesa STK-push UX spec, no failure/timeout/retry states.
3. **Global chrome** — navbar, bottom nav, category/home rails, mobile drawer. Only fragments: `LANDING-REVIEW` F2 (gutter), `COPY-REWRITE` D1–D3 (strings), `POLYMARKET-MULTI-OUTCOME-PARITY` 1.1–1.2 (PM's nav/rail described). No measured spec, no component doc.
4. **`/settings`** — referenced as a destination; never specified.
5. **Responsible play / limits / self-exclusion / age gate** — promised by `LANDING-PAGE-DOSSIER` (§1.5 table, Phase 4, footer) and `LANDING-REVIEW` F1; no spec anywhere.
6. **Legal / help / terms / privacy page layouts** — copy-level only (`COPY-REWRITE` D10–D14).
7. **404 / 500 / error boundaries / `/offline` layout** — nothing (only the string "You're offline").
8. **Empty-state and illustration library** — repeatedly referenced ("custom trophy SVG", "custom bell SVG", "illustrative, never a big emoji") but never defined as a set.
9. **Email / SMS / push notification templates** — only `supabase/templates/magic_link.html` from M4.
10. **Up/Down crypto live-window markets** as a surface — treated as a card superset (LIVE pill, countdown, `Settling…`, `BtcLiveChart`) with no dedicated spec.
11. **Embed (`</>`) surface** — PM's embed action is documented as a gap; no Kichiko embed spec.
12. **Market Context news feed / AI summary / FAQ accordion (our side)** — PM side measured in detail; our implementation exists only as build-plan lines M5.5/M6/M8.
13. **Comments/community components (our side)** — measured only as PM's; no Kichiko component spec with numbers (M7 doc is a parity table).
14. **Onboarding tour / first-run education**, **referral program surface**, **dispute/appeal UI for users**, **market resolution transparency page** (`accuracy page` analogue) — none.
15. **Dark theme, at measurement level** — every competitor capture is light-only; no doc carries dark-mode measured values (only token-pair assertions).

---

## 17. DIRECT CONTRADICTIONS BETWEEN DOCUMENTS

Ordered by how much damage acting on the wrong side would cause.

**C1 — Brand + semantic colour tokens and radii (load-bearing, unresolved).**
- `LANDING-PAGE-DOSSIER` §2.2/§2.5: Pip Blue **#2B50E4**; YES **#1F9D6B**; NO **#D1495B**; radii **8 / 12 / 16px**.
- `PM-PARITY-SPEC` §4 "Repo → PM token remap (**to apply**)": `pip.500 #2B50E4 → #1452F0`; YES `#1F9D6B → #30a159`; NO `#D1495B → #e23939`; radii `8/12/16 → 7.2 / 9.2 / 11.2px`. §6 marks this **[x] done** ("Design tokens aligned to PM").
- `MARKET-CARD-POLYMARKET-PARITY` addendum "Deliberate deviation": keeps `--yes/--no-700` **because PM's `#42c772` fails WCAG AA** (commit `704547f`).
- `KALSHI-ORDER-TICKET` §3: "we keep our accessible Pip `--yes`/`--no` tokens".
- `PM-CLOB-END-TO-END` §3 and `PM-CLOB-DRAWER` token map state our repo tokens **already are** `--yes #30A159` / `--no #E23939`.
→ Three incompatible positions on the same two hexes and the same radius scale, all written in July, none retracted. A11y vs parity is unresolved.

**C2 — Price notation and currency (system-wide).**
- Every PM parity doc mandates **cents** (`Yes 72¢`, 1-decimal `19.8¢`, `Yes + No = 100¢`, dual `XX.X% (XX.X¢)`, related rows in ¢) and **$ volumes** (`$1.2m Vol.`, `$662,055,529`).
- `COPY-REWRITE-SPEC` §B mandates the opposite: "**KES only**, USD hidden everywhere", money as `KSh 1,250`, "Prices / odds → **probability %**", "**Remove any cents/`¢` or USD price framing**".
→ Directly incompatible. The copy spec is also unapproved (§F), so neither side is authoritative.

**C3 — Multi-outcome invariant Σ price = 1 (would break production).**
- `MULTI-OUTCOME-MARKETS` FR3/NFR3/§3.1/§4: Σ price = 1 as a hard invariant, DB CHECK + assertion `< 1e-4` + alert at `1e-3`.
- Research `06` P0-2 and proposed `032_price_coherence_guard.sql`: "enforce `Σ market_options.price = 1` … as a DB constraint".
- `POLYMARKET-MULTI-OUTCOME-PARITY` §0/§4/§7: chose independent per-candidate books where "per-row Yes prices need **not** sum to 100%", and **converted all 22 live markets on 2026-07-11**.
→ Applying the documented constraint would reject live production data.

**C4 — Does a multi-outcome market even exist? (`MARKET-CREATE-DOSSIER` vs everything).**
"There is no outcomes table and the market detail/ticket render binary only … Multi-outcome … gated *Coming soon*" vs `market_options` shipped in migration 020, 22 live multi markets, 107 live options, and independent Yes/No activated in July.

**C5 — Cents vs percent in Related-markets rows, and its type spec.**
- `PM-MARKET-DETAIL-MEASURED` (2026-07-18): related price "shown in **¢** (`41¢`, `20¢`, `59¢`) — ours showed `%` → **fixed to ¢**"; title **14px / 500** `rgb(24,24,27)`.
- `PM-PARITY-SPEC` §2.5: related sublabel is "**`NN%` + leading-outcome name**"; title **13px / 600 / lh 19.5px / −0.09px**.
- Mobile groundtruth §10: related shows **mini-%** (`42% J.D. Vance`).
→ Same component, opposite notation, two different type specs.

**C6 — `--navbar-height`: 116px vs 104px.**
`PM-MARKET-DETAIL-MEASURED` header: "Global token: `--navbar-height: 116px`". Both mobile docs: "`--navbar-height: 104px`". Both are sticky-offset-critical.

**C7 — Detail H1 size: 24px vs "28–32px".**
`POLYMARKET-DETAIL-PARITY-2026-07` §1.2.3: "Title — **28–32px**, bold, single line where possible". `PM-MARKET-DETAIL-MEASURED`, `PM-PARITY-SPEC` §2.1 and `TYPOGRAPHY` `.pm-headline` all measure **24px / 600 / lh 28 / ls −0.36px** and explicitly note "static (not larger on desktop)". The observational doc is wrong; it is not marked as superseded.

**C8 — Chart Y axis: fixed 0/25/50/75/100 vs dynamic.**
`POLYMARKET-DETAIL-PARITY` §1.3: "right-hand Y axis at **0/25/50/75/100%**". Mobile groundtruth §3: "**dynamically scaled** … here `0%/10%/20%/30%` (**NOT fixed 0–100** — PM zooms to the leader's range)". M7 observed a **15%** step (`0 15 30 45 60`); hero observed 10% and 15% steps.

**C9 — Chart line geometry and endpoint marker (internal to `HERO-POLYMARKET-GROUNDTRUTH`).**
The doc's CORRECTION block says lines are **smooth cubic-bézier, zero `L`, no step-after**, with a **pulsing** endpoint halo (scale 1→3.95, opacity 0.34→0). The original bullet list immediately below still says "dense-bezier **step** render" and a **static** glow (`opacity 0.34, transform: scale(2.28)`). Both remain in the file; §10's checklist adds a third framing ("dashed 1,3 neutral-300 **@op .5** + crispEdges").

**C10 — Is `TRADE YES` a toggle or a static heading?**
`PM-CLOB-DRAWER` column table: "**Trade Yes** … + switch icon → **flips book to Trade No**". Same doc, Tab-states section: "this is a **static heading** … it is **not** a Yes/No flip". `PM-CLOB-END-TO-END` §4b: it *is* a working side toggle, and ours implements it (`onToggleSide`, `showSideToggle`).

**C11 — Contract specs in the desktop right rail.**
`MARKET-DETAIL-DOSSIER` §2 IA and `POLYMARKET-DETAIL-PARITY` §2 ("Keep specs") put Contract specs in the sticky sidebar. `PM-MARKET-DETAIL-MEASURED` (2026-07-18): "**There is no 'Contract specs' card in PM's desktop rail**" → we removed it and moved `<RelatedMarkets>` in, specs becoming `lg:hidden`.

**C12 — Card frames vs borderless sections.**
`MARKET-DETAIL-DOSSIER` §3 specifies `.card` for every block (and `MARKETS-DISCOVERY-DOSSIER`/`SUPPORTING-PAGES` build everything on `.card`). `PM-MARKET-DETAIL-MEASURED`: "Audited every `h1/h2/h3` container: **0 framed** … Our fix: **removed `.card` frames** from the board, Rules, Comments, FAQ and the chart."

**C13 — Numerics font: mono or not.**
`LANDING-PAGE-DOSSIER` §2.3 mandates **IBM Plex Mono** with tabular-nums for all prices/probabilities/volume; `PORTFOLIO-DOSSIER` and `SUPPORTING-PAGES-DOSSIER` require "every figure monospaced". `PM-PARITY-SPEC` §1 measured: "**Numerics render in the UI font at PM (no separate mono for prices)**"; `TYPOGRAPHY` confirms Geist Mono is used only for "select numerics, promo codes, `<kbd>`". Parity and our system disagree on the price font.

**C14 — Ticket / rail width: 372px vs 340px.**
`PM-PARITY-SPEC` §2.3: "Ticket container width **372px**". Mobile parity §0: desktop `--event-detail-width: calc(100vw − 24 − 24 − **340px** − 24)`, i.e. a **340px** rail. Cannot both be the measured ticket width.

**C15 — Mobile pre-arming of the ticket.**
`PM-PARITY-SPEC` §3.2: "**Mobile: PM has NO pre-armed ticket and NO auto-selected candidate** … Repo bug to fix … mobile stays neutral until tap" (marked done in §6). `BETTING-PANEL-CONVERSION` §4A/4B ships the opposite on mobile: a sticky bar whose tap opens a sheet **pre-selected** on the tapped side with the **stake pre-filled** from a default preset, explicitly to reach "2 meaningful taps". (Arguably reconcilable — pre-select *after* an explicit tap vs pre-select *on load* — but the two docs never reconcile it, and "seeds a sensible default stake" is a load-on-open behaviour.)

**C16 — Rewards / maker rebates: omitted, documented, or required.**
`MARKET-CARD-POLYMARKET-PARITY` matrix row 13: rewards gift glyph "**⛔ omitted (no rewards program)**". `PM-CLOB-DRAWER` documents the 🎁 per-candidate rewards glyph, the gold **Maker Rebate** chip and the **+ Rewards** link as measured parity targets. Research `06` P2-7 recommends modelling maker rebates + ~4% holding yield. `COPY-REWRITE` D21 edits an existing string "Rewards available on this market → …event", implying the feature already surfaces. `BRAIN-ARCHITECTURE-2026-09` says a fee curve must be introduced *to pay for* market making. Four positions.

**C17 — Fees: three models.**
Research `00` §4 (verified 10/10): PM fee = `C · feeRate · p · (1−p)`, taker-only, per-category rates (Crypto 0.07 … Geopolitics 0.00), 5-dp rounding. `MARKET-DETAIL-DOSSIER` / `MULTI-OUTCOME-MARKETS`: flat `platform_fee_rate` + `creator_reward_rate` applied in `previewBet`. `BRAIN-ARCHITECTURE-2026-09` §2: "**Fees: None charged on trades**". Research `00` §6-3 even warns "a flat bps fee is visibly wrong near the extremes".

**C18 — Tick size: one global 0.1¢ vs per-market {0.001, 0.01}.**
`CLOB-ARCHITECTURE` §2 and the drawer docs hard-code a **0.1¢** tick (`price_cents numeric(4,1)`, `[0.1, 99.9]`). Research `03` §4 / `06` P1-3: PM uses **0.01 for 35.3%** of markets and tick must be **stored per market** and enforced server-side; the enabling migration `031` is "not applied".

**C19 — Yes-green has two values, and the corpus disagrees on which is canonical.**
`HERO-POLYMARKET-GROUNDTRUTH` §0: "YES / up = green-500 **#42c772**". `PM-MARKET-DETAIL-MEASURED` colours: "PM green (Yes): **#30A159**". `PM-PARITY-SPEC`: both, as 500/600, with "Yes-leading fills use `#30a159`". `PM-BUY-SHEET` §"Payout-green nuance" is the only doc that resolves it (market-mode To-win = `#42C772`, limit-mode To-win = `#30A159`). Anyone reading only one of the first two gets it wrong.

**C20 — Desktop vs mobile primary-text hex for table numerals.**
`PM-CLOB-DRAWER`: Shares/Total are `rgb(24,24,27)` (**#18181B**) and the doc explicitly flags "desktop uses zinc-900, **not** the mobile sheet's `rgb(14,15,17)`". `HERO-POLYMARKET-GROUNDTRUTH` flags the same split for outcome names vs titles (`#18181b` vs `#0e0f11`). Not a contradiction so much as a documented trap — but `PM-PARITY-SPEC`'s semantic table collapses everything to `--color-text-primary #0e0f11`, which loses it.

**C21 — KYC tiers: 2 levels vs 4.**
`KYC-DOSSIER` §5: **Basic / Enhanced**. `LANDING-PAGE-DOSSIER` §1.4/§4: "tiered identity (**T0 browse → T1 email → T2 basic KYC → T3 full KYC**)".

**C22 — Trader-profile route and avatar size.**
`TOP-HOLDERS-DOSSIER` §1c says PM's profile is `/profile/0x…` (or `/@username`) and ours is `/traders/[id]`; `docs/holder-page-pm-parity-spec.md` measures the identity avatar at **44px desktop / 64px in the mobile ref** while the dossier only specifies abstract `sm|md|lg`. Minor, but the two specs for one component were written independently.

**C23 — "Complete/CI-green" claims vs the 2026-09 findings.**
`CLOB-AUDIT-2026-07` ("Status: complete … applied to the live database"), `PM-CLOB-END-TO-END` (reads as shipped), `POLYMARKET-MULTI-OUTCOME-PARITY` §7 (all checks green, activated live) vs `CLOB-SETTLEMENT-2026-09` (8 settlement defects, winners paid `shares + cost basis`, escrow drained, admin resolution failing with `P0121`, fix **not yet in production**) and `BRAIN-ARCHITECTURE-2026-09` ("64 of 64 production order books hold unbacked positions"; "2,280 of 2,291 production orders … did not come through the engine"). The July docs' success claims are not annotated as superseded.

---

## 18. Cross-cutting staleness ledger (as of 2026-09-27)

| Item | Dated | Age | Risk |
|---|---|---|---|
| All PM competitor captures (hero, detail desktop/mobile, buy sheet, drawer, typography, board) | 2026-07-09 … 2026-07-22 | ~10 weeks | **High** — live third-party product; corpus already contains two intra-July self-corrections and records a PM contract retirement on 2026-07-17 |
| Kalshi ticket capture | undated | ? | **High** — no date at all; Kalshi was mid-rollout of a "Bloomberg-Terminal-style" UI per `LANDING-PAGE-DOSSIER` §1.2 |
| Research snapshot `stats.json` | **2026-07-22 14:42 UTC** | ~9.5 weeks | **Medium** — the corpus itself says "structure is stable, absolute numbers are snapshot-specific"; prices, volumes, depth, and the 64.7/35.3 tick split will have drifted |
| Our own "shipped/✅" claims in design dossiers | mostly undated, Phase 0/1 era | ? | **High** — superseded by the 2026-07-11 engine conversion and the 2026-09 settlement findings |
| `COPY-REWRITE-SPEC` | undated, awaiting approval (§F, 7 open items) | ? | **High** — if approved it invalidates ¢/$ notation across ~15 documents and moves `/markets` → `/events` |
| `MARKET-CREATE-DOSSIER` "binary only / no outcomes table" | undated | ? | **Stale — factually wrong** |
| `MULTI-OUTCOME-MARKETS` Σ price = 1 doctrine | undated | ? | **Stale — would break production** |
| Entity-media backfill coverage 32/107 | 2026-07 | ~10 weeks | Medium |
| Test-count and route-count anchors (45/45 routes; 534 / 682 / 686 unit; 19 / 23 e2e; 130KB bundle budget) | 2026-07 | ~10 weeks | Medium — useful only as historical markers |
| Dark-mode: no measured values anywhere | — | — | Structural gap, not staleness |

---

## 19. Reproducibility assets referenced by the corpus

Harnesses named in the docs (presence not verified by this audit unless noted):
`tools/pm-parity/extract.py`, `capture_desktop_buttons.py`, `capture_board.py`, `capture_drawer.py`, `capture_drawer2.py`; `/home/user/pm_extract_specs.py`, `/home/user/pm_extract_ticket.py`; `/home/user/pm-live/` (incl. `scroll/`); `tools/polymarket-research/{collect.py,analyze.py,verify_conditionid.py,verify_tokenid.py}` with `data/stats.json` + `data/*.json.gz`; `scripts/ops/clob/{test_two_sided.py,fuzz_invariants.py,test_settlement.py,bench_engine.py}`; `scripts/seed_demo_traders.py`; `scripts/backfill_entity_media.py`.
On disk and verified: `docs/design/assets/polymarket_hero_carousel_live.png`, `…_slide_live.png`; `docs/design/reference/{polymarket-presidential-2028-mobile, polymarket-world-cup-2026-07, polymarket-world-cup-2026-07-m7}/`; `docs/research/polymarket/assets/{spread_distribution,prob_distribution,dual_leg_coherence,volume_vs_liquidity}.png`; `docs/design/landing-prototype/{index.html,app.js,styles.css}`.
Raw PM DOM dumps are **not** in the repo (referenced as `pasted-text-…441370.txt` etc., 1.86M chars) — the mobile groundtruth/parity numbers are therefore **not independently re-verifiable** from the repo alone.
