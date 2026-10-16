# /markets/[slug] — head-to-head capture, 2026-10-16

Section C of `40-ELEMENT-MATRIX.md`, worked the way section M was: capture the
rendered page first, measure what is on it, **then** open our own code.

## What was captured

| key | page |
|---|---|
| `PM-binary` | `polymarket.com/event/will-the-us-invade-iran-before-2027` — single-market event |
| `PM-multi` | `polymarket.com/event/brazil-presidential-election` — 32 candidates, the direct analogue of `ke-2027-president` |
| `EL-multi` | our `/markets/ke-2027-president` |
| `KA-binary` | **not captured** — Kalshi's market URLs sit behind a Vercel bot checkpoint. No comparison is claimed from it. |

Both PM slugs came from `gamma-api.polymarket.com/events?closed=false&order=volume24hr`,
not from guessing a URL — the first attempt guessed, got an empty page, and the
census silently recorded it as a real capture.

Desktop 1440×900 and mobile 390×844; ours additionally in both colour schemes.
No login, no form submitted, TLS on, ≥3 s between navigations.

## A defect in the instrument, found before any finding was reported

The DOM census returned **147 nodes** for a PM page plainly showing more than
that. The walk did:

```js
if (r.width < 1 || r.height < 1) return
```

— it *returned* on a zero-sized element instead of descending through it, and
PM lays its entire right rail inside 0×0 wrappers. The order ticket was
invisible to the instrument measuring it. Skipping the *record* while
continuing the *descent* took the same page to **275 nodes**, which is where
every ticket number below comes from.

Same class as the chart gate that passed the broken chart (§2.17): the
measurement was wrong, not the thing measured.

## Order ticket, element by element

| element | PM | Elopis | |
|---|---|---|---|
| context title | 14px/500 | 14px/500 | ✅ |
| selected outcome | 16px/600 | 16px/600 | ✅ |
| Buy / Sell tabs | 16px/600 | 16px/600 | ✅ |
| order type | 14px/500 | 14px/500 | ✅ |
| price on outcome buttons | 16px/600 | 15px/600 | — |
| **amount** | **40px/600** | **40px/600** | ✅ |
| `Amount` label | 16px/500 | 16px/500 | ✅ |
| quick-amount chips | 12px/600, **30px tall** | 14px/600, **44px tall** | ✅ ours (A4) |
| CTA label | 14px/600 | 14px/600 | ✅ |
| legal line | 13px/490 | 13px/400 | — |

Two things only the capture shows:

- **PM's outcome buttons are both buy-side asks, not a probability pair.**
  Binary reads `Yes 17¢ / No 84¢` → **101¢**; multi reads `79.3¢ / 20.8¢` →
  **100.1¢**. The excess *is* the spread.
- **Precision splits by context.** Candidate rows show integers
  (`Buy Yes 21¢`); the ticket shows one decimal (`79.3¢`). Rounded where you
  scan, precise where you commit.

## Candidate row

| element | PM | Elopis |
|---|---|---|
| name | 16px/600 | 16px/600 ✅ |
| volume | 13px/490, exact `$20,919,017 Vol.` | 12px/400, abbreviated `KSh 8.5M Vol.` |
| probability | 28px/600 | 28px/600 ✅ |
| **change since** | **12px/600, colour-coded** | **absent** |
| buy button | `Buy Yes` 14px/600 + price **16px/600** | whole label 14px/600 |

PM sets the *price* larger than the button's own label: the number being
committed to is emphasised inside the control.

## Where we are ahead

Our ticket says **"No one is selling Yes right now, so a market order can't
fill → Place a limit order at your price."** PM has no equivalent; it accepts
the order and fails. Our chips clear 44px where PM's are 30px.

## Rulings this capture settles or sharpens

- **C/chart range tabs — FIXED.** PM renders `1H 6H 1D 1W 1M ALL`; we rendered
  **none**. `outcomes-chart.tsx` offered a range only when ≥2 ticks fell inside
  it, `price_history` stops in July, so every window but ALL was empty and
  "ALL alone needs no tab row" collapsed the row. The fallback underneath —
  `allRows.slice(-2)` — meant 1D would have drawn **two July samples under a
  "1D" label**. Both fixed by carrying the last known price to both ends of the
  window, which is migration 112's rule on its second surface. Verified: tabs
  `1H 6H 1D 1W 1M ALL`; 1D a flat line at today's price (x-axis `06:36`);
  1W `Oct 9 → Oct 16`; ALL unchanged at 868 points.
- **B4 vs K3, fixed 0–100% axis — DECISION OWED, now priced.** Ours labels
  `0/25/50/75/100` with a 46% leader, so **54% of the plot is empty**. PM's
  binary page auto-scaled to `0–60%` for a 17% market. B4's case against
  auto-scaling (truncation exaggerates movement on a money surface) still
  stands; it now has a measured cost on the other side.
- **The KSh price unit — DECISION OWED.** `Yes KSh 60 + No KSh 70 = KSh 130`,
  because a share settles at $1 ≈ KSh 130. Deliberate and documented in
  `candidate-list.tsx` ("the shilling price is what the buyer actually pays
  with M-Pesa"), and the reasoning is good. But `lib/currency.ts:66` states
  that "KES is a first-class market quote here — **NOT a fixed peg**". Two
  parts of the codebase disagree about whether 130 is a constant or a
  variable. Structurally: an unchanged 46% market shows a different KSh price
  as the shilling moves; `34 + 96 = KSh 130` stops being true tomorrow; a
  holder's position gains or loses on FX with no change in belief. Only one FX
  observation is stored (129.81, 2026-10-15), so the drift is **not
  quantified here** rather than guessed. The alternative is pegging the
  contract at **KSh 100/share**, restoring the price≡probability identity that
  PM gets free from a $1 settlement.

## A measurement deliberately discarded

The census put 83% of our controls under 44px against PM's 65%. It is not
reported as a finding: it ran at 1440px and counted every anchor including
footer and in-sentence text links, while `e2e/target-size.spec.ts` runs at
390px on money routes and applies WCAG 2.5.8's exemption for targets
"constrained by the line-height of non-target text". Different populations.
The gate is the meaningful one, and it passes.
