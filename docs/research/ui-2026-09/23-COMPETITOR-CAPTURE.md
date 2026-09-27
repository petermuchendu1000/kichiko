# Competitor design-token capture — measured, not estimated

**Captured:** 2026-09-27 · Playwright 1.56.0 · Chromium 141.0.7390.37 · via agent HTTPS proxy, TLS verification left enabled throughout.

Every number below comes from a live `getComputedStyle()` or `getBoundingClientRect()` on a
rendered, visible node. Colours authored in CSS Color 4 (`lab()`, `oklab()`, `color(srgb …)`)
were converted to sRGB **by Chromium itself** — each value was rasterised onto opaque white and
opaque black and the two readings solved for alpha and premultiplied RGB (`resolve-colors.js`).
No hand conversion, no eyeballing. Anything not observed is marked **NOT MEASURED**.

## Files

| File | What it is |
|---|---|
| `capture.js` | Main capture: 2 pages × 2 viewports, token extraction, screenshots |
| `resolve-colors.js` | Browser-exact CSS Color 4 → sRGB + alpha resolution |
| `analyze.js` | Scale-system detection and WCAG contrast computation |
| `supplement.js` | Targeted second pass for named CTAs rendered as `<a>` / `.trading-button` |
| `probe-modal.js` | One-off probe that located the geo-block interstitial |
| `raw-capture.json` | Full raw measurements (~1.3 MB) |
| `resolved-colors.json` | 67 distinct colour strings → sRGB |
| `analysis-summary.json` | Derived scales, contrast ratios, per-page rollup |
| `analysis-console.txt` | Full readable dump of the analysis |
| `shot-polymarket-*-{mobile,desktop}.png` | Full-page screenshots (CSS-pixel scale) |
| `shot-polymarket-*-fold.png` | Above-the-fold screenshots |

## Coverage

| Target | Viewport | Result |
|---|---|---|
| polymarket.com home | 390×844 dpr3 · 1440×900 dpr1 | **Captured**, HTTP 200 |
| polymarket.com `/event/los-angeles-mayoral-election-117` | 390×844 dpr3 · 1440×900 dpr1 | **Captured**, HTTP 200 |
| kalshi.com | — | **NOT MEASURED** |

The event URL was **discovered by following a link from the home page** (largest-area
`/event/` anchor), not guessed.

### Kalshi — could not reach

Three attempts, 60 s apart, all returned **HTTP 429** with the body
`We're verifying your browser — Vercel Security Checkpoint`. This is a bot challenge, not
plain rate limiting, so further retries would not have helped and none were made. **All Kalshi
tokens are NOT MEASURED.**

### Polymarket caveat

polymarket.com serves a **US geo-block interstitial** ("Trading is blocked in the United
States", view-only mode) from this exit IP. It was dismissed before measurement (the site
renders two copies of its dismiss button — one is zero-size — so the visibly-sized one is
clicked by measured box). Consequences:

- Trading UI renders and was fully measured (order ticket, outcome buttons, Trade CTA).
- **No logged-out auth CTA** (Log in / Sign up) is rendered in this region — `NOT MEASURED`.
- `networkidle` never fires (the site polls continuously); capture fell back to a scripted
  scroll-and-settle, then gated on >400 chars of rendered text. All four captures passed that gate.

---

## 1. Type scale

Family is **Inter** (`inter, "inter Fallback"`) everywhere; root and body font-size are both `16px`.

**Distinct font-sizes actually used on text nodes, union of all four captures (px):**

`11, 12, 13, 14, 15, 16, 18, 20, 24, 26, 28`

Per viewport:

| Capture | Sizes present (px) |
|---|---|
| home / mobile | 16, 15, 14, 13, 12, 11 |
| home / desktop | 26, 24, 20, 18, 16, 15, 14, 13, 12 |
| event / mobile | 28, 26, 16, 14, 13, 12, 11 |
| event / desktop | 28, 26, 24, 18, 16, 15, 14, 13, 12 |

Mobile home tops out at 16px; the big display sizes (24–28px) only appear on the event page
and on desktop home's featured modules.

### Is it a modular scale? No.

Step ratios, measured:

| Step | Δ | Ratio |
|---|---|---|
| 11→12 | +1 | 1.091 |
| 12→13 | +1 | 1.083 |
| 13→14 | +1 | 1.077 |
| 14→15 | +1 | 1.071 |
| 15→16 | +1 | 1.067 |
| 16→18 | +2 | 1.125 |
| 18→20 | +2 | 1.111 |
| 20→24 | +4 | 1.200 |
| 24→26 | +2 | 1.083 |
| 26→28 | +2 | 1.077 |

Ratio spans **1.067 – 1.200** (spread 0.133), and the px delta is not uniform either
(mean 1.7px, sd 0.9px). So it is **neither a modular/geometric scale nor a clean arithmetic
one** — it is a hand-picked ramp: a dense **+1px step through the body band (11–16)** where
text density matters, then a coarser **+2px (and one +4px) step for display sizes**.

### Line-height and tracking

Line-height is set in px, not unitless, and clusters at a few ratios:

- **1.5×** — 12/18, 13/19.5, 14/21, 15/22.5, 16/24 (long-form and card body)
- **1.43×** — 14/20 (the dominant UI ratio)
- **1.23×** — 13/16 (dense metadata; the single most-used combination, n=204–217)
- **1.33×** — 12/16
- **1.25×** — 16/20
- **1.0×** — 18/18, 26/26, 28/28 (large numerals set solid)

Letter-spacing is negative and scales with size: `-0.09px` @14, `-0.1px` @12–13,
`-0.18px` @16, `-0.2px` @20, `-0.36px` @24, `-0.42px` @28. `normal` for long-form copy.

### Weights

Measured in use: **400, 440, 450, 490, 500, 540, 580, 590, 600, 700.** The non-round values
(440/450/490/540/580/590) are a variable-font axis being set per component, not a named
weight ramp. 600 is the workhorse for emphasis and prices; 700 is rare.

---

## 2. Spacing scale

Distinct padding / margin / gap values (count ≥ 3), union of all captures (px):

`1, 2, 3, 3.3, 4, 6, 6.5, 8, 10, 12, 14, 16, 20, 24, 32, 37.5, 64`

### Is it a 4px or 8px grid? Neither — it's a 2px grid.

Frequency-weighted over every padding and gap declaration in all four captures (n = 6,598):

| Value | Uses | Share | Grid |
|---|---|---|---|
| 8px | 2,088 | 31.6% | 4 ✓ |
| 4px | 1,144 | 17.3% | 4 ✓ |
| 12px | 999 | 15.1% | 4 ✓ |
| **6px** | **954** | **14.5%** | 2 only |
| 16px | 468 | 7.1% | 4 ✓ |
| **14px** | **356** | **5.4%** | 2 only |
| **10px** | **244** | **3.7%** | 2 only |
| 2px | 109 | 1.7% | 2 only |
| 24px | 104 | 1.6% | 4 ✓ |
| 32px | 40 | 0.6% | 4 ✓ |
| 20px | 32 | 0.5% | 4 ✓ |

Coverage of values used ≥20 times: **2px grid 100.0%**, 4px grid 74.6%, 8px grid 41.3%.

So the base unit is **2px**. 4px multiples carry ~75% of the weight and form the backbone
(4/8/12/16/24/32), but **6, 10 and 14 are load-bearing** — together 23.6% of all spacing —
so calling it a 4px grid would misdescribe it. The off-grid values (`3.3`, `6.5`, `37.5`,
`1`) are sub-pixel layout artefacts and percentage-derived gaps, not design tokens.

---

## 3. Border radius

Distinct radii in use (px): `2, 4, 5.2, 6, 7, 7.2, 8, 9.2, 10, 11.2, 12, 15.2, 16, 18, 20, 50`,
plus a pill value that computes to `3.35544e+07px` (i.e. `rounded-full`).

The fractional family is derived from one token. The live root style exposes:

```
--radius: .7rem      →  11.2px
```

and every fractional radius is that base offset by an integer:

| Measured | Derivation | Where |
|---|---|---|
| 5.2px | `--radius − 6px` | YES/NO chips on market cards |
| 7.2px | `--radius − 4px` | Buy Yes / Buy No buttons |
| 9.2px | `--radius − 2px` | Search input, Trade CTA, outcome selector |
| **11.2px** | `--radius` | inner content blocks |
| 15.2px | `--radius + 4px` | market card, order ticket, comment box |

That is the shadcn/ui radius formula. The integer radii (2/4/6/8/10/12/16/18/20/50) come from
plain Tailwind utilities used alongside it — so there are effectively **two radius systems in
the same codebase**.

---

## 4. Colour palette and semantic YES/NO

Page background is `#ffffff` on all four captures (`lab(100 0 0)`), `color-scheme: light`,
`data-theme="light"`. Dark mode was **NOT MEASURED**.

Polymarket exposes its full token set as custom properties on `:root`; these were read off the
live computed style (not from source):

| Token | Authored | sRGB |
|---|---|---|
| `--color-pk-green-600` | `lab(45.7361% -45.2267 37.3056)` | `#007e26` |
| `--color-pk-green-400` / `accent-green` | `lab(62.7363% -54.8402 36.1505)` | `#04af52` |
| `--color-pk-red-500` | `lab(47.8918% 72.1772 58.3835)` | `#df0c10` |
| `--brand-500` / `accent-brand` | `lab(44.7153% 32.3672 -86.8665)` | `#2e5cff` |
| `--color-pk-content-primary` | `lab(15.4544% -.764295 -4.69404)` | `#23272d` |
| `--color-pk-content-secondary` | `lab(47.7217% -1.37293 -5.88264)` | `#6b727b` |
| `--color-pk-surface` | `lab(100% 0 0)` | `#ffffff` |

### The semantic YES/NO pairs, as rendered

YES and NO are expressed **two ways**, and the two differ sharply in accessibility.

**(a) Tinted / resting state** — a very low-alpha wash of the accent behind accent-coloured text:

| | Text | Surface (authored) | Surface composited on white | Contrast | AA (4.5 needed) |
|---|---|---|---|---|---|
| **YES / Buy Yes** | `#007e26` | `oklab(0.603598 -0.149933 0.0964872 / 0.15)` → base `#009a3c` @ α 0.149 | `#d9f0e2` | **4.36 : 1** | **FAIL** |
| **NO / Buy No** | `#df0c10` | `oklab(0.570509 0.201896 0.109506 / 0.09)` → base `#de0b0b` @ α 0.090 | `#fce9e9` | **4.28 : 1** | **FAIL** |

Both land just under the 4.5:1 threshold, at 14px/600 and 13px/490 — well inside normal-text
territory, so the 3:1 large-text allowance does not apply. This is the state used for **every
YES/NO chip on the market cards on both home viewports** (h=27px) and for the **resting
Buy Yes / Buy No buttons on the event page** (h=44px mobile, 48px desktop). It is the most
frequently rendered semantic treatment on the site, and it fails AA at both viewports.

The tint surfaces are also nearly invisible against the page: **1.20:1 (YES) and 1.17:1 (NO)
vs `#ffffff`**, far below the 3:1 that WCAG 1.4.11 asks of a UI component boundary — the
buttons are identified almost entirely by their text colour.

**(b) Solid / selected state** — accent as the fill, white label:

| | Text | Surface | Contrast | AA |
|---|---|---|---|---|
| **YES selected** (`Buy Yes`, `.trading-button[aria-checked=true]`) | `#ffffff` | `#007e26` | **5.23 : 1** | **PASS** |
| **Trade** primary CTA | `#ffffff` | `#2e5cff` | **5.13 : 1** | **PASS** |
| NO selected | NOT MEASURED — no solid-red state rendered; unselected NO is `#23272d` on `#ffffff` = **15.00 : 1** | | | |

Note the solid YES surface also gives **5.23:1 against the page background**, so it passes
1.4.11 as well. The asymmetry is deliberate-looking but worth flagging: **YES gets a solid
selected state, NO does not** — selected NO stays white with dark text.

One artefact to be aware of: the `.trading-button` wrapper's own `color` computes to
`#23272d`, which against the green fill would be 2.87:1, but the label is painted by a child
`<span>` at `#ffffff`. The rendered value is **5.23:1**; the 2.87 figure is the wrapper, not
what a user sees.

### Other measured text contrasts on white

| Role | Colour | Contrast | AA |
|---|---|---|---|
| Primary text | `#23272d` | 15.00 : 1 | PASS |
| Secondary text | `#6b727b` | 4.86 : 1 | PASS (normal text) |
| Red-500 as text | `#df0c10` | 5.00 : 1 | PASS |
| Green-600 as text | `#007e26` | 5.23 : 1 | PASS |
| **Accent-green `#04af52`** (used for the +26% delta chip, 12px/600) | | **2.89 : 1** | **FAIL** |

The bright accent green fails badly as text, and it is used at 12px for price-change deltas.

---

## 5. Buttons, inputs and touch targets

### Primary buttons (measured boxes)

| Button | Capture | Height | Width | Padding | Radius | Font | Fill |
|---|---|---|---|---|---|---|---|
| **Trade** (order ticket CTA) | event / desktop | **43px** | 308 | `0` (centred by flex) | 9.2px | 14px/600 | `#2e5cff`, white label |
| **Yes 58.7¢** outcome selector (selected) | event / desktop | **48px** | 148 | `0` | 9.2px | 15px/600 | `#007e26`, white label |
| **No 42.0¢** outcome selector (unselected) | event / desktop | **48px** | 148 | `0` | 9.2px | 15px/600 | `#ffffff`, dark label |
| **Buy Yes / Buy No** row buttons | event / desktop | **48px** | 136 | `8px 16px` | 7.2px | 14px/600 | tint or solid |
| **Buy Yes / Buy No** row buttons | event / mobile | **44px** | 173 | `8px 16px` | 7.2px | 14px/600 | tint |
| **Yes / No** chips on market cards | home / both | **27px** | 40 | `0 14px` | 5.2px | 13px/490 | tint |
| Category filter chip ("All") | home / both | 32px | 41 | `0 12px` | 6px | 14px/500 | `#eaeeff`, `#2e5cff` label |
| Logged-out auth CTA | — | **NOT MEASURED** (not rendered in this region) | | | | | |

### Inputs

| Input | Capture | Height | Padding | Radius | Font |
|---|---|---|---|---|---|
| Search (collapsed) | home / mobile | **40px** | `4px 12px 4px 40px` | 9.2px | 16px |
| Search (collapsed) | home / desktop | **40px** | `4px 12px 4px 36px` | 9.2px | 14px |
| Search (expanded header field) | desktop | 16px (bare input inside a padded 56px shell) | `0` | 0 | 14px |
| Comment box | event / mobile | **48px** | `14px 112px 14px 14px` | 15.2px | 16px |
| Comment box | event / desktop | **48px** | `14px 112px 14px 14px` | 15.2px | 14px |
| Order-ticket amount | event / desktop | **60px** | `0` | 0 | **40px** |

Mobile search and the mobile comment box use **16px** font — at or above the iOS
zoom-on-focus threshold. Desktop drops to 14px, where that does not matter.

### Touch targets

Census of every `button` / `a` / `input` / `select` / `textarea` / `[role=button|tab|link]`
with a non-zero box:

| Capture | ≥44px tall | <44px tall | Most common heights |
|---|---|---|---|
| home / mobile | 38 | **333** | 27px (×84), 20px (×70), 28px (×62), 40px (×42) |
| home / desktop | 71 | 513 | 27.5px (×116), 27px (×86), 20px (×75), 40px (×63) |
| event / mobile | 50 | **178** | 20px (×57), 24px (×32), 36px (×26), 48px (×24) |
| event / desktop | 50 | 196 | 20px (×63), 24px (×32), 36px (×29), 48px (×27) |

On mobile home, **~90% of interactive elements are under the 44px iOS / 48dp Android
minimum**. The dominant 27px height is the YES/NO chip — the primary trading affordance on
the market card is a 27px-tall target. The event page's Buy buttons do hit exactly **44px on
mobile / 48px on desktop**, so the deliberate touch sizing exists on the detail page but not
in the market feed.

---

## 6. The market / outcome card

### Home feed market card (the repeated grid unit)

Identified by clustering every price-bearing (`%`, `¢`, `$`) text node up to its nearest
rounded/painted ancestor, then taking the most-repeated measured size.

| | mobile 390×844 | desktop 1440×900 |
|---|---|---|
| Repeats found | **109** | **109** |
| Box | **358 × 180 px** | **316.5 × 180 px** |
| Padding | `12px 0 0 0` | `12px 0 0 0` |
| Border radius | **15.2px** (`--radius + 4`) | 15.2px |
| Border width | 0 | 0 |
| Background | `#ffffff` | `#ffffff` |
| Elevation | `0 0 0 1px rgba(0,0,0,.06)`, `0 2px 6px -0.5px rgba(0,0,0,.025)`, `0 2px 10px rgba(0,0,0,.025)` | same |

Card height is **fixed at 180px on both viewports**; only width flexes (358 = 390 − 32px
gutters on mobile). Horizontal padding is 0 on the card itself — the inner rows carry it.

**Price display inside the card:** `15px / weight 600 / line-height 22.5px (1.5) /
letter-spacing normal / #23272d`. Secondary metadata (volume, "$14M") is `13px / 490 /
16px / -0.1px / #6b727b`.

Other repeated clusters on desktop home: 362.9×215 and 362.9×219 at r 11.2px (Breaking News,
Hot topics), 346×184 at r 11.2px (Fed decision module), 907×480 at r 18px (hero).

### Event page outcome row

| | mobile | desktop |
|---|---|---|
| Box | **358 × 140 px** | **922 × 72 px** |
| Repeats | 1 per candidate (2 visible) | **8** |
| Padding | `16px 0` | `0` |
| Gap | `16px` | — |
| Radius | 0 (separated by a 1px rule, not a card) | 0 |
| Price | **28px / 600 / lh 28px (1.0) / ls −0.42px / #23272d** | same |

The event page abandons the card entirely: outcomes are **full-bleed rows divided by 1px
rules**, and the probability numeral jumps from 15px on the feed to **28px**. Mobile stacks
the row to 140px tall; desktop compresses it to a 72px single line.

### Order ticket (desktop only)

`340 × 389 px`, padding `16px`, gap `20px`, radius **15.2px**, background `#ffffff`.
Price legend inside: `16px / 600 / lh 24px / -0.09px`. **NOT MEASURED on mobile** — the
order ticket is not rendered inline at 390px width.

---

## 7. Summary of what to take from this

1. **Type is a hand-tuned px ramp, not a modular scale** — +1px through 11–16, +2px above.
   Don't try to reverse-engineer a ratio; there isn't one.
2. **Spacing is a 2px grid**, with 4px multiples carrying ~75% of the weight. 6px, 10px and
   14px are real, frequent tokens.
3. **Radius runs on two systems**: a shadcn-style `--radius: 0.7rem` ± integer family
   (5.2 / 7.2 / 9.2 / 11.2 / 15.2) and a plain Tailwind integer family.
4. **The most common YES/NO treatment fails WCAG AA** — 4.36:1 and 4.28:1 against their own
   tints, and ~1.2:1 surface-vs-page. The solid selected state passes at 5.23:1. If we copy
   the tint aesthetic, we need a darker accent: this is the clearest place to beat them.
5. **Touch targets in the market feed are small** — 27px for the primary YES/NO affordance,
   ~90% of mobile home interactives under 44px. The event page does it properly at 44/48px.
6. **The feed card is a fixed 180px-tall, 15.2px-radius, shadow-elevated white box** with a
   15px/600 price; the detail page drops cards for full-bleed 1px-ruled rows with a 28px/600 price.
