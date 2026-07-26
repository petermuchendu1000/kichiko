# Holder / Trader Profile — Polymarket Parity Spec (hard data)

> Source of truth: live Polymarket profile page, extracted via Playwright
> (computed styles, pixel geometry, font stacks, gradients, hover states) at
> **desktop 1280px** and **mobile 390px** viewports, cross-checked against
> supplied reference screenshots. These are functional design measurements used
> to build Kichiko' own equivalent components — no PM source/assets copied.

## Global tokens
| Token | Value |
|---|---|
| Font family | `Inter, "Inter Fallback", sans-serif` |
| Body base | 16px / 24px, weight 400, color `#000` on `#fff` |
| Primary text | `#0E0F11` (rgb 14,15,17) / also `#18181B` (rgb 24,24,27) |
| Muted text | `#77808D` (rgb 119,128,141) |
| Brand blue | `#1452F0` (rgb 20,82,240) |
| Positive / green | `#42C772` (rgb 66,199,114) |
| Negative / red | `#E23939` (rgb 226,57,57) |
| Hairline / border | `#E6E8EA` (rgb 230,232,234) |
| Surface tint (search, segмented track) | `#F4F5F6` (rgb 244,245,246) |
| Transition | `0.15s cubic-bezier(0.4,0,0.2,1)` (color/bg/border); search focus `box-shadow 0.2s` |
| Control radius | 7.2px (buttons/segments), 9.2px (pills/range/search) |

## Header / identity
- Avatar: gradient identicon circle **44px** desktop (64px in supplied mobile ref), fully rounded.
- Display name: `h1`, ~24px, bold, `#0E0F11`.
- Sub-line: "Joined {Mon YYYY} · {N} views" — 12–14px, `#77808D`.
- Right-aligned icon actions: expand + share (ghost icon buttons).

## Stats row (Positions Value · Biggest Win · Predictions)
- 3 columns, left aligned.
- Value: **18px / 28px, weight 500**, `#0E0F11`, tabular-nums.
- Label: **12px / 16px, weight 500**, `#77808D`.
- Desktop x: 166 / 291 / 395; mobile x: 16 / 149 / 261 (even thirds).

## Profit / Loss card
- Label "Profit/Loss": **14px / 20px, weight 500**, `#77808D` (with small ▲ caret on mobile ref).
- Headline P&L number: **~28–30px, bold**, tabular-nums; black when neutral, green/red by sign on share card.
- Subtitle (range label) "Past Day": **12px, weight 500**, `#77808D`, NOT uppercase.
- Range toggle `1D 1W 1M 1Y YTD ALL`:
  - button **h 28px**, radius **9.2px**, padding `0 8px`, **12px / 16px, weight 600, UPPERCASE**.
  - active text `#1452F0`, inactive `#77808D`, transparent background (active is color-only, no filled pill).
- Chart (visx-style SVG line):
  - Line: **stroke = linear-gradient `#1452F0` → `#9B51E0` (rgb 155,81,224)`**, **stroke-width 2px**, round joins.
  - Area fill: same gradient, opacity **0.25 → 0.005** top→bottom.
  - Hover: vertical **crosshair line** `#0E0F11`, **1.5px**, solid; focus dot + floating value/date tooltip that tracks the cursor.
  - Chart height ~130px inline.

## Positions / Activity tabs
- Text tabs (underline style): **16px / 20px, weight 600, letter-spacing -0.18px**.
- Active `#18181B`, inactive `#77808D`.

## Active | Closed segmented + sort
- Two equal segments; each **h 36px**, radius **7.2px**, padding `8px 16px`, **14px / 20px, weight 600, letter-spacing -0.09px**.
- Active `#0E0F11` (raised/filled on light track `#F4F5F6`), inactive `#77808D`.
- Sort control ("Value") right-aligned, 14px weight 600.

## Search positions
- Input **h 40px**, radius **9.2px**, bg `#F4F5F6`, padding `4px 12px 4px 44px` (leading search icon), 14px.
- Focus: `box-shadow 0.2s cubic-bezier(0.4,0,0.2,1)` ring.

## Position row
- Row: market avatar (rounded) + market title (line-clamp) + outcome chip (Yes/No + cents) + shares, with right-aligned Value + signed P&L `(+$x.xx (x.xx%))`.
- Border-bottom hairline `#E6E8EA`.
- P&L green `#42C772` / red `#E23939`, tabular-nums.
- Cents formatted `NN¢`.

## Responsive
- Mobile: identity + stats stack full-width; P&L card full-width with range toggle wrapping to the label row; Active/Closed segments expand to equal halves; table becomes horizontally scrollable / condensed rows.
