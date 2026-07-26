# Polymarket → Kichiko — M7 Teardown: Chart dashed gridlines + Community/Related (2026-07)

### Live research → measurement → parity mapping

> Fresh live capture of a multi-outcome Polymarket event (`/event/world-cup-winner`)
> at desktop (1440px) and mobile (390px), driven headlessly with the graph fully
> settled before measurement. Companion reference frames in
> `reference/polymarket-world-cup-2026-07-m7/`. This closes M7 (Community tabs +
> Related, gaps G8/G10) and answers the explicit "confirm the dashed lines and
> apply them to our graph" request.

---

## 0. Chart dashed lines — CONFIRMED and applied

The Polymarket probability plot uses dashed strokes in two distinct places. Both
were read straight off the compiled SVG (computed `stroke-dasharray`), not eyeballed:

| Element | Measured on PM | Our implementation |
|---|---|---|
| Horizontal Y gridlines | `<line>` · `stroke-dasharray: 1px 3px` · `stroke: rgb(174,180,188)` · `1px` | `CHART_GRID_DASH = '1 3'` over the new `--chart-grid` token, `CartesianGrid horizontal vertical={false}` |
| Series line (main body) | `<path>` · solid · `~2.75px` | `<Line strokeWidth={2}>` (solid), unchanged |
| Series line (trailing) | `<path>` · `stroke-dasharray: 1px 1px` · `~1.75px` | n/a — see note |

- **Y ticks** step by 15% on the observed board (`0% 15% 30% 45% 60%`); X labels
  are month abbreviations (`Sep … Jul`). Our `niceProbScale()` already reproduces
  the dynamic 0-based, headroom-padded, round-tick axis (locked by unit tests).
- **Biggest gap fixed:** our multi-outcome `OutcomesChart` previously rendered
  **no gridlines at all**. It now paints PM's fine dotted horizontal grid, aligned
  to the same `yTicks` the right axis labels — so every dotted line lands exactly
  on a `%` label. The binary `PriceChart` already had a dashed grid; it was
  retuned from a coarse `3 3`/hairline to PM's `1 3`/`--chart-grid` (grid + the
  50% reference line) so both charts read identically.
- **Trailing dashed series segment:** PM draws the most-recent/extrapolated tail
  of each colored line as a thin dashed continuation. We intentionally did **not**
  fabricate one: our series are forward-filled to the live probability, so the
  last plotted point already *is* "now" — there is no real gap to dash across.
  A dashed tail is deferred until a real "last-trade → now" gap exists in the
  data (documented seam, no invented geometry).

Token: `--chart-grid` = `--ink-300` (light) / `--ink-600` (dark). Constant +
dark-mode behaviour covered by `chart-scale.test.ts`.

---

## 1. Community block — top-to-bottom (mobile + desktop identical order)

Observed tab bar, in order: **`Comments (N)` · `Top Holders` · `Positions` · `Activity`**.

| Feature | PM (observed) | Our state after M7 |
|---|---|---|
| Tab order/labels | Comments (N) · Top Holders · Positions · Activity | Matches — casing fixed to **Top Holders** |
| Comment composer | text **Post** button | text **Post** button (arrow kept only as in-flight glyph) |
| Comment sort | dropdown defaulting to **Newest** | Newest/Oldest control (client reorder by `created_at`) |
| Count summary | "N comments" header | "N comments" summary line |
| Top Holders | two mirrored Yes/No columns, ranked by shares, rank badge on avatar, hover peek → profile | already built (RPC `market_top_holders`, Board→Peek→Profile) |
| Positions | two Yes/No columns ranked by value; `avg ¢`, current value, `$ bought` | already built (RPC `market_positions`) |
| Activity | dated trade feed, side-tinted amount | already built (`market_activity`) |
| Multi-outcome scope | outcome selector scopes Holders/Positions | already built |

PM decorates each commenter with their own position chip (e.g. "223 Spain") and
shows "N Replies". These need a comment→position join and a replies tree; both
are **deferred** (require new data seams) rather than mocked — consistent with the
project's "data-ready, never fabricated" rule.

---

## 2. Related

- PM surfaces related context as category/tag chips plus a related list; our
  `RelatedMarkets` renders a compact `MarketCard` grid (same signal: icon · title ·
  leading option · mini-%), filtered to the same category by volume, `Settling…`
  windows hidden. Retained as-is for M7 (G10 satisfied by the compact card grid;
  a denser mobile list variant remains a future polish item).

---

## 3. Verification gates (per sub-milestone, CI-gated on `main`)

- **M7a** dotted gridlines — type-check ✓ lint ✓ unit (chart-scale) ✓ · CI green.
- **M7b** community/comments parity — type-check ✓ lint ✓ · CI green.
- **M7c** this teardown (docs-only).
