# Hero Section — Polymarket Teardown & Kichiko Implementation Spec

> Ground-truth analysis of Polymarket's homepage "Featured markets" hero,
> captured live (Chromium, 1440×900, DSF 2) + computed-style extraction from the
> live DOM on 2026-07-13, cross-checked against a full-resolution reference
> screenshot. This is the spec the Kichiko hero is built to.

## 1. What the hero *is*

Polymarket's hero is **not** a marketing splash — it is a **carousel of live
"event" cards**. The centrepiece of each slide is a spotlight market rendered as
a data dashboard: ranked outcomes on the left, a multi-line probability chart on
the right, a live comment peek, and a volume/close footer. A static right rail
sits beside the carousel with product promos, a "Hot topics" leaderboard, and an
"Explore all" pill.

Structural signal from the live DOM:
```
<section class="group/carousel hidden lg:flex flex-col gap-4 w-full">  // carousel, 16px gap, desktop-only multi-panel
  featured card (907 × 536 px)  +  right rail (~1fr)
```

## 2. Layout

- Outer: centered container; two columns `~1.7fr | 1fr`, gap ~20px.
- LEFT = carousel; each slide is ONE featured card (`907×536` at 1440 vw).
- Card body = two sub-columns: **ranked outcomes (left)** | **chart (right)**.
- Controls BELOW the card: pagination dots (left) + prev/next **title pills**
  on the right that name the adjacent slides (e.g. `‹ Fed decision in July`,
  `Iran Deal ›`).
- RIGHT = static rail: promo card, promo card, "Hot topics" list, "Explore all".

## 3. Typography (Inter throughout)

| Element | size / weight / color | notes |
|---|---|---|
| Card title (`World Cup Winner`) | **24px / 600 / #0E0F11** | not a giant headline |
| Breadcrumb (`Sports · Soccer`) | 13px / secondary #77808D | above title |
| Outcome big % (`39%`) | **20px / 600 / #18181B**, letter -0.2px | `text-heading-xl` |
| Legend chip name (`France`) | 13px / ~490 / #77808D | secondary |
| Legend chip % (`39.0%`) | 13px / **600** / #31353A, letter -0.1px | `text-neutral-800` |
| Footer vol / ends | 13px / secondary | |
| Sign Up button | 14px / 600 / #fff on #1452F0, radius ~8px, pad 8×16 | |
| Log In | 14px / 600 / #1452F0, transparent | |

Hairline/border color: **#E6E8EA**. Page bg: **#FFFFFF** (light theme).

## 4. The chart (per-outcome "event" chart)

- ONE smooth line per outcome; color is categorical (blue / indigo / gold /
  orange for the 4 leaders). Endpoint dot on each line.
- **Y-axis auto-scaled to the data range** (0–40% in the sample), labels on the
  **RIGHT** edge (`0% 10% 20% 30% 40%`). Dashed light gridlines.
- **X-axis = real dates** below (`Jun 21 · Jun 28 · Jul 5 · Jul 12`).
- Legend chips (dot + name + %) sit **above** the chart.
- Hover shows a crosshair + per-line value bubbles (`+ $4` style annotations).

## 5. Ranked outcomes column

- Up to 4 rows: entity avatar (flag/photo) + name + big % (right-aligned).
- Below: **comment peek** — commenter avatar + username + one-line content;
  a couple of recent comments. Degrades gracefully to nothing when a market has
  no comments.

## 6. Card chrome

- Header: breadcrumb left; **link/share** + **bookmark** icon buttons right.
- Footer (hairline top): `$4B Vol` left; `Ends Jul 20, 2026 · Polymarket` right.
- Whole card is a link to the market; inner controls opt back in.

## 7. Right rail

1. Promo card A — "Perps are here" (leverage product) + `Start trading`.
2. Promo card B — "Build a combo" + `Get started` (gradient tint).
3. **Hot topics** heading (chevron link) → numbered list: rank, topic,
   `$XXXk today` + 🔥 + chevron.
4. `Explore all` — full-width rounded-pill outline button.

## 8. Kichiko adaptation (on-brand, not a clone)

We replicate the **structure, sizing, spacing, behavior, and polish** exactly,
themed to the existing **Pip** design system (do NOT hard-code Polymarket blue
or copy their product promos):

- Fonts: Hanken Grotesk (UI) + IBM Plex Mono (numerics) via existing tokens.
- Colors: `--pip-*` brand blue, `--yes/--no` desaturated semantics, `--surface`,
  `--hairline`, `--text/-2/-3`. Full light + dark support via CSS vars.
- Title 24px/600 (`text-heading` scale), outcome % 20px/600 mono tabular-nums,
  legend chips 13px (name `--text-3`, % `--text` 600).
- Chart: extend `ProbLines` with auto Y-domain, right axis, and dated X-axis
  (additive props; existing callers unchanged).
- Data: real featured/trending KE markets (candidate photos = flag analog),
  real per-option price history (May–Jul window), real 24h "Hot topics".
- Rail promos map to real Kichiko features: instant **M-Pesa / MoMo / Airtel**
  funding ("How it works"), and "Create a free account" ("Get started").
- Carousel: pre-rendered server slides (0 chart JS) wrapped in a thin client
  controller — dots, prev/next title pills, autoplay w/ pause-on-hover, swipe,
  keyboard, and `prefers-reduced-motion` respected.

## 9. Data availability (verified)

- Top-4 featured markets have real `price_history` (276 pts for the 2027
  presidential multi; ~46 pts each for the binaries; window 2026-05-27 → 07-11).
- `market_options.image_url` carries entity photos (candidate faces).
- `profiles` exposes `username / display_name / avatar_url` for comment authors.
