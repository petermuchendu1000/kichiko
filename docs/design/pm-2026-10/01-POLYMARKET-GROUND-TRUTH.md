# Polymarket Ground Truth — Measured Capture, 2026-10-15

**Method.** Headless Chromium (Playwright) against live `polymarket.com` at 1440×900,
1920×1080 and 390×844. Every number below is a *computed style* read out of the live
DOM, not an estimate from a screenshot. Capture harness and raw JSON are in
`assets/`; the harness itself lives in the session scratchpad.

**Capture caveat.** Polymarket serves a US geo-block modal (`.us-geoblock-prepaint-modal`,
`z-[250]`) that covers the viewport on first paint. Three nodes carry the same copy and
the first two are zero-sized, so a naive `.first()` click misses it. The harness clicks
the *visible* "Continue in view only mode" button at DOM level and verifies dismissal
by rendered geometry, never by text presence — the copy survives in hidden prepaint
nodes after dismissal and a text check false-positives. In view-only mode the page is
complete; only the trade actions are inert.

---

## 1. Their token system

Polymarket ships **350 CSS custom properties** on `:root`, namespaced `--pk-*` in
Tailwind (`bg-pk-elevated`, `text-pk-content-secondary`, `shadow-pk-minimal-soft`).
Many colours are authored in **CIE Lab** (`lab(44.7153% 32.3672 -86.8665)`), not hex —
a deliberate choice for perceptually even ramps. Resolved values below.

### Neutrals — identical to Kichiko's `ink` ramp

| Token | Value | Kichiko `ink` |
|---|---|---|
| `--neutral-950` | `#0e0f11` | `--ink-950` ✅ same |
| `--neutral-900` | `#1a1c1f` | `--ink-900` ✅ |
| `--neutral-800` | `#31353a` | `--ink-800` ✅ |
| `--neutral-700` | `#484e56` | `--ink-700` ✅ |
| `--neutral-600` | `#5f6772` | `--ink-600` ✅ |
| `--neutral-500` | `#77808d` | `--ink-500` ✅ |
| `--neutral-400` | `#939aa5` | `--ink-400` ✅ |
| `--neutral-300` | `#aeb4bc` | `--ink-300` ✅ |
| `--neutral-200` | `#caced3` | `--ink-200` ✅ |
| `--neutral-100` | `#e6e8ea` | `--ink-100` ✅ |
| `--neutral-50`  | `#f4f5f6` | `--ink-50` ✅ |

Kichiko's prior parity work on neutrals is **exact**. No change needed.

### Market semantics — also already matched

| Token | Value | Kichiko |
|---|---|---|
| `--market-positive` | `#30a159` | `--yes` ✅ same |
| `--market-negative` | `#e23939` | `--no` ✅ same |
| `--green-600` | `#30a159` | ✅ |
| `--red-600` | `#c61d1d` | `--no-700` ✅ |

### Brand blue — a real discrepancy

| Source | Value |
|---|---|
| `--blue-500` (palette token) | `#1652f0` |
| **Chart series stroke (computed)** | `rgb(20, 82, 240)` = **`#1452f0`** |
| Kichiko `--pip-500` | `#1452F0` |

Kichiko matches the **rendered** brand blue. Their palette token is 2/255 off in the
red channel from what they actually paint. Kichiko is correct — leave it.

### Layout constants

| Token | Value | Kichiko |
|---|---|---|
| `--page-max-width` | **1350px** | `--maxw:1200px` / `--maxw-wide:1320px` ⚠️ narrower |
| `--navbar-height` | **116px** | n/a |
| `--navbar-collapsed-height` | **68px** | n/a ⚠️ no collapse behaviour |
| `--radius` | `.7rem` = 11.2px | `--r-lg:11.2px` ✅ |

The nav **collapses 116px → 68px on scroll**. Kichiko has no equivalent.

### Typography — the density signal

Inter variable, with an explicit feature string Kichiko does not set:

```
--inter-font-features: "liga" 1, "calt" 1, "cv01" 1, "cv02" 1,
                       "cv03" 1, "cv04" 1, "cv09" 0, "cv11" 1, "cv15" 1;
```

`cv01`–`cv04`, `cv11`, `cv15` are Inter character variants (single-storey `a`,
open `g`, straight-tail `l`, disambiguated `1`/`I`). This is what makes their
numerals and lowercase read "fintech" rather than "default Inter".

**Kichiko already sets this**, identically, at `app/globals.css:179` — verified
after the capture. Parity, not a gap.

Measured size frequency across the landing page:

| Size | Uses | Role |
|---|---|---|
| **13px** | 517 | primary body / card text |
| **12px** | 506 | meta, labels, axis |
| 14px | 252 | emphasis, timeframe pills |
| 16px | 118 | card titles |
| 15px | 96 | list rows |
| 11px | 32 | micro-labels |
| 20/24/26/32px | 52 total | headings only |

**Polymarket is a 12–14px dense information surface.** Headings are rare and small.
Weight `450` appears alongside 500/600 — a variable-font intermediate most systems
never use. Letter-spacing tightens optically with size: `-0.15px` @15px,
`-0.1px` @12px, `-0.09px` @14px.

### Elevation — a ring, not a drop shadow

The signature card treatment (36 uses on the landing page) is
`--shadow-pk-minimal-soft`:

```
inset 0 0 0 0 transparent,
0 0 0 1px  lab(0 0 0 / .06),   /* 1px hairline RING  */
0 2px 6px -0.5px lab(0 0 0 / .025),
0 2px 10px 0     lab(0 0 0 / .025);
```

A 6%-opacity 1px ring plus two 2.5% blurs. Kichiko's `--e1 (0 1px 2px rgba(10,12,16,.05))`
is a conventional drop shadow with **no ring** — visibly flatter and less crisp.

Radius frequency: `7.2px` (172), `5.2px` (134), `2px` (105), `15.2px` (37),
`9.2px` (31), `11.2px` (19), pill. A *six-step* radius scale; Kichiko has three.

### Motion — one canonical micro-transition

| Duration + easing | Uses |
|---|---|
| **`0.15s cubic-bezier(0.4,0,0.2,1)`** | **753** |
| `0.12s cubic-bezier(0,0,0.2,1)` | 13 |
| `0.3s cubic-bezier(0.4,0,0.2,1)` | 13 |
| `0.7s cubic-bezier(0.22,1,0.36,1)` | 10 |

**One** transition does 95% of the work: 150ms standard-ease. Large reveals use
700ms easeOutQuint. Kichiko declares `--dur-micro:120ms / --dur:200ms / --dur-in:280ms`
with two custom eases — more tokens, less discipline.

---

## 2. The chart — this is where they win

**Engine: `visx`** (Airbnb's D3-primitives-for-React). Not Recharts, not Highcharts.
Confirmed by `[class*="visx"]` and by the hand-built axis/grid structure.
Kichiko uses **Recharts** — a higher-level, less controllable wrapper.

Plot geometry on a 1440px viewport: **922 × 240px**, 8 `path`, 24 `line`, 17 `text`,
4 `circle`, 32 `g`. Pure SVG, zero canvas on the detail chart.

### 2.1 Each series is THREE stacked paths

Measured, per series:

| Layer | Stroke | Width | Dash | Purpose |
|---|---|---|---|---|
| A | `#f4f5f7` (`pk-gray-100`) | **2px** | `1px,1px` | ghost track under the line |
| B | series colour | **1.75px** | `1px,1px` | the line itself |
| C | series colour | **2.75px** | `0px,1px` | thickened active/hover overlay |

Plus two more paths that do the clever work:

| Layer | Stroke | Width | Dash | Purpose |
|---|---|---|---|---|
| D | `var(--chart-bg, --color-pk-surface)` | 1.75px | `1px,1px` | **knockout halo** |
| E | series colour @ **0.4 alpha** | 1.75px | **`2px,2px`** | **future / projection segment** |

**Layer D is the detail nobody copies.** A *background-coloured* stroke painted over
the line creates a halo so that where two series cross, the upper one keeps a clean
gap and both stay readable. No library gives you this for free.

**Layer E** renders the un-elapsed portion of the window as a 40%-opacity **dashed**
continuation — visually honest about "this is not data yet".

### 2.2 Series palette ≠ semantic palette

| Series | Value |
|---|---|
| 1 (blue) | `rgb(20,82,240)` = `#1452f0` |
| 2 (red) | `rgb(255,89,82)` = **`#ff5952`** |

The chart red is **far brighter** than the semantic `--market-negative #e23939`.
Charts get their own, more saturated palette tuned for thin 1.75px strokes against
white — a thin line needs more chroma than a filled chip to read at the same strength.
Kichiko currently paints chart series with the semantic red; at 1.75px it will look
muddier than theirs.

### 2.3 Hover: no tooltip box at all

This is the single best interaction on the site, and it is **not** a tooltip.

On hover (see `assets/pm-chart-hover-50.png`):

1. A **1px vertical crosshair** tracks the cursor across the full plot height.
2. The **timestamp renders centred above the plot** ("May 31, 12:00 PM") — not in a
   floating box, so it never occludes the data.
3. Each series' value renders **inline, to the right of the crosshair**, as the
   series name in 13px grey over the value in ~28px bold **in the series colour**:
   `Ken Paxton (R) / 61%`, `James Talarico (D) / 39%`.
4. A filled **dot** marks each series at the crosshair intersection.
5. Everything **right of the crosshair de-saturates** to near-grey — the "future"
   relative to the hovered instant dims away.

Why it beats a tooltip: a tooltip box occludes the very data you are reading, chases
the cursor, and forces a colour-to-label lookup. Polymarket's readout keeps values
*on the line they describe*, in the line's own colour, with zero occlusion. Point 5
turns a passive hover into a **time-scrubbing** gesture — the chart reads as a
timeline being played, not a static picture.

### 2.4 Axes and chrome

| Element | Measured |
|---|---|
| Axis labels | **12px / weight 400 / `#6b727b`** |
| Axis font-family | **`Arial`** ⚠️ (see below) |
| Y labels | right side, `text-anchor:start`, `0% 25% 50% 75% 100%` |
| X labels | month abbreviations, `text-anchor:middle` |
| Gridlines | horizontal only, **dotted**, very light |
| Timeframe pills | 14px / **weight 600** / radius 9.2px / padding 4px 6px / height 36px |
| Pill active | `#23272d`, **no background** |
| Pill inactive | `#6b727b`, no background |
| Attribution | "Source: Polymarket.com" chip bottom-left + wordmark watermark top-right |

**⚠️ Their bug, not ours:** SVG `<text>` resolves to **`Arial`** — the axis labels do
not inherit Inter, because SVG text does not inherit `font-family` from a Tailwind
body class in their setup. 244 nodes on the page render in Arial. On a site this
polished it is a genuine defect, and it is free for us to beat: set `font-family`
explicitly on SVG text.

Timeframe pills carry **no background in either state** — only a colour and weight
change. Far quieter than the filled-pill pattern most dashboards use.

---

## 3. Landing page architecture

Measured at 1440×900, `scrollHeight` 3363px (desktop) / 8647px (mobile @390).

```
┌ nav 116px (collapses to 68px on scroll)
│   wordmark · search (⌘/ hint) · CTA · help · menu
├ category rail — Trending/Combos/Perps/Breaking/New │ Politics/Sports/…
├ geo banner (view-only mode)
├ ─────────────── two-column, max-width 1350px ───────────────
│  ┌ LEFT  (~865px)                    ┌ RIGHT (~365px)
│  │ hero carousel card                │ Breaking News  (ranked 1..n,
│  │   radius 11.2px, ring shadow      │   % + Δ% with ↗/↘ arrows)
│  │   title 24px, rows 15px/450       │ Hot topics     (ranked, $ today,
│  │   candidate rows: avatar 32px,    │   flame icon, chevron)
│  │   name 15px, sub 12px, % 14px/600,│ "Explore all" button
│  │   vol 12px grey                   │
│  │ carousel dots + prev/next pills   │
│  ├ "All markets" + search/filter/bookmark icons
│  ├ chip rail (All · Fed · Brazil · …) horizontally scrollable
│  └ market card grid
```

Card measurements (hero card): **388 × 334px**, `border-radius: 11.2px`,
`background: transparent`, `border: 0`, `padding: 0`, elevation via the ring shadow,
`display:flex; flex-direction:column`. Padding lives on inner elements, not the card.

Card grid tile types observed: **percentage-ring card** (BTC Up/Down, 51% with a
circular arc gauge), **binary Yes/No card** (77% + green Yes / red No buttons),
**multi-outcome list card**, **image-led editorial card**.

---

## 4. Scorecard — where Kichiko stands

| Dimension | Polymarket | Kichiko today | Verdict |
|---|---|---|---|
| Neutral ramp | 11 steps | identical | ✅ parity |
| Market semantics | `#30a159` / `#e23939` | identical | ✅ parity |
| Brand blue | `#1452f0` rendered | `#1452F0` | ✅ parity |
| Radius scale | 6 steps | 3 steps | ⚠️ coarser |
| Elevation | ring + 2 soft blurs | plain drop shadow | ❌ flatter |
| Inter features | 9 variants set | identical, `globals.css:179` | ✅ parity |
| Type density | 13/12px dominant | 13px footer, 10px axis | ⚠️ axis too small |
| Motion | 1 canonical 150ms | 3 durations, 2 eases | ⚠️ unfocused |
| Chart engine | visx (SVG primitives) | Recharts | ❌ less control |
| Chart series palette | dedicated bright set | semantic set | ❌ muddier |
| Knockout halo | yes | no | ❌ missing |
| Future segment | dashed @40% | no | ❌ missing |
| Hover readout | inline, no box | floating Recharts tooltip | ❌ occludes data |
| Time-scrub dimming | yes | no | ❌ missing |
| Nav collapse | 116→68px | none | ❌ missing |
| Page max-width | 1350px | 1200/1320px | ⚠️ narrower |
| SVG axis font | **Arial (their bug)** | — | 🎯 free win |

---

## 5. Where we go past them

Parity is the floor. These are the places their design leaves value on the table.

1. **Fix the Arial axis bug.** Free, immediate, visible.
2. **Keep the inline hover readout, add a committed state.** Their readout evaporates
   on mouse-out. A click should *pin* the scrub position so a value can be read,
   compared, screenshotted, or linked — hover is lost on touch devices entirely.
3. **Make the chart legible on mobile.** At 390px their landing is 8647px tall and
   the detail chart hover is unreachable. A touch-first scrub with a draggable handle
   has no equivalent on their site.
4. **Earn the density.** 13px body is right for a trading surface, but their
   hierarchy is nearly flat — everything is 12–14px, so nothing leads. We keep the
   density and reintroduce *one* decisive step of contrast at the decision point
   (the price), so the eye lands where the money is.
5. **Ring elevation + a six-step radius scale**, adopted wholesale. Cheap, and it is
   most of why their surface reads crisper than ours.
6. **One canonical 150ms transition.** Replace our three durations with their
   discipline.
7. **Honest uncertainty.** Their dashed-future trick is good; a prediction market can
   go further and render *liquidity-weighted confidence* — a thin band where the book
   is thin, tightening where it is deep. Nobody in this category does this.

Items 1–6 are parity-or-better with known cost. Item 7 is the differentiator.

---

## Appendix — artefacts

| File | Contents |
|---|---|
| `assets/pm-landing-desktop.json` | full computed-style extraction, 1440×900 |
| `assets/pm-landing-mobile.json` | same, 390×844 |
| `assets/pm-chart-info.json` | per-path stroke/dash/curve, axes, timeframe pills |
| `assets/pm-chart-hover.json` | crosshair / dot / tooltip probe per hover position |
| `assets/pm-chart-timeframes.json` | active-state styling per timeframe |
| `assets/pm-landing-desktop-*.png` | landing, viewport + full page |
| `assets/pm-detail-desktop-*.png` | market detail, viewport + full page |
| `assets/pm-chart-hover-*.png` | hover readout at 50% and 78% of plot width |
