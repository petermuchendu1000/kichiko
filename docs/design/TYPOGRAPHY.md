# Polymarket Typography — Measured Source of Truth

**Method:** Playwright navigation of the **live** `polymarket.com` (homepage +
`/event/world-cup-winner` detail page), reading real `@font-face` rules,
`document.fonts`, and `getComputedStyle()` on every visible text node. All
values below are *measured*, not inferred. Captured 2026-07.

## Fonts actually loaded

| Family | Source file | Weights | Role |
|---|---|---|---|
| **Inter** (variable) | `InterVariable.woff2` | `100..900` axis | **Primary UI/body/headings** (≈90% of text) |
| **Geist Mono** | `GeistMono-{Regular,Medium,SemiBold}.ttf` | 400 / 500 / 600 | Select numerics, promo codes, `<kbd>` |
| Suisse Intl | `SuisseIntl-{Regular,Book,Medium}.woff2` | 400 / 450 / 500 | Declared; **not computed** on sampled pages |
| Open Sauce One | `OpenSauceOne_*.woff2` | 400 / 500 / 600 / 700 | Rare (rotating promo text) |
| Arial | `local("Arial")` | — | Inter/OpenSauce fallback + SVG chart `<tspan>` |

**Weights are applied via `font-weight` on the variable axis**
(`font-variation-settings: normal`). Non-standard weights **440 / 450 / 490 /
540 / 580 / 590** appear throughout and only render with the variable face.

## Global Inter feature settings (measured, exact)

```css
font-feature-settings: "liga", "calt", "cv01", "cv02", "cv03", "cv04", "cv09" 0, "cv11", "cv15";
```

`cv09` is explicitly **off**. There is **no** global `letter-spacing` — most
roles are `normal`; negative tracking is applied per-role (table below).

## Measured type scale (px sizes / weights / px line-height / px tracking)

| Token (globals.css) | size | weight | line-height | letter-spacing | Example |
|---|---|---|---|---|---|
| `.pm-body` | 13 | 490 | 16 | -0.1 | most common body text |
| `.pm-body-regular` | 13 | 400 | 16 | -0.1 | comment text |
| `.pm-body-strong` | 13 | 600 | 16 | -0.1 | inline `38.9%` |
| `.pm-caption` | 12 | 400 | 16 | -0.1 | secondary caption |
| `.pm-caption-strong` | 12 | 600 | 16 | -0.1 | small label |
| `.pm-micro` | 12 | 500 | 16 | normal | meta (`Jul 13`) |
| `.pm-text` | 14 | 440 | 20 | -0.09 | list body |
| `.pm-text-medium` | 14 | 500 | 20 | -0.09 | link / button |
| `.pm-text-semibold` | 14 | 600 | 20 | -0.09 | `How it works` |
| `.pm-nav` | 14 | 540 | 20 | -0.09 | top-nav items |
| `.pm-heading-sm` | 14 | 590 | 20 | -0.09 | `World Cup Winner` (h3) |
| `.pm-book` | 15 | 450 | 22.5 | -0.15 | outcome name |
| `.pm-num-15` | 15 | 600 | 22.5 | normal | `39%` |
| `.pm-body-16` | 16 | 400 | 24 | normal | **base paragraph** |
| `.pm-yesno` | 16 | 600 | 20 | -0.18 | Yes/No pill |
| `.pm-price` | 16 | 600 | 24 | -0.09 | `38.9¢` |
| `.pm-heading-md` | 18 | 580 | 27 | normal | `Breaking News` (h2) |
| `.pm-pct-18` | 18 | 600 | 18 | normal | medium % |
| `.pm-num-20` | 20 | 600 | 24 | -0.2 | large outcome % |
| `.pm-title` | 24 | 600 | 32 | normal | home card title |
| `.pm-headline` | 24 | 600 | 28 | -0.36 | detail-page h1 |
| `.pm-display` | 28 | 600 | 28 | -0.42 | big probability |

### Tracking is size-scaled, not a single em value
Measured px tracking ≈ **-0.006em → -0.015em**, tightening as size grows:
12–13px → -0.1px · 14px → -0.09px · 15px → -0.15px · 16px → -0.18px (headings) ·
20px → -0.2px · 24px → -0.36px · 28px → -0.42px. The base 16px/400 body is
`normal`. Encode tracking per token (px), never as one global value.

## Corrections applied to Kichiko (this milestone)
1. Removed the incorrect global `body { letter-spacing:-0.011em }` → `normal`
   (PM's base body is untracked; the global value tightened all text).
2. Added PM's exact `font-feature-settings` to `body` (was previously absent).
3. Added the measured `.pm-*` scale with exact variable-font weights.
4. `.font-display` tracking `-0.02em` → `-0.015em` (matches measured headings).
