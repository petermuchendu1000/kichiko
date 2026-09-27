# Notation audit against the KES-and-% ruling (2026-09-27)

Ruling (product owner, 2026-09-27): money in `KSh`, probability in `%`; no `¢`, no `$`.
Method: static grep of `apps/web/{app,components,lib}` (tests excluded) plus rendered
screenshots from this capture. Grade **V** (verified against code) unless noted.

| # | Finding | Where | Rendered? |
|---|---|---|---|
| N1 | `formatCents()` renders prices as `52¢` | `lib/clob.ts:35`, used by `components/trading/pm-ticket.tsx` (limit row, average price) and `components/trading/order-book-table.tsx` | Yes, in limit-order and order-book views |
| N2 | User-facing error "Limit price must be between 0.1¢ and 99.9¢" | `lib/clob.ts:184` (`P0106`) | Yes, on an out-of-band limit price |
| N3 | Accessible name "Limit price in cents" | `components/trading/pm-ticket.tsx:243` | Yes, to screen readers |
| N4 | Three independent `formatPercent` implementations | `lib/clob.ts:41`, `lib/utils.ts:57`, `lib/format.ts:54` | Risk of the same probability rendering differently on two surfaces |
| N5 | Two spellings in one sheet: `KSh 500` and `To win Ksh 636.56` | ticket, mobile (screenshot `shots/P06-ticket-amount-mobile-light-fold.png`) | Yes |
| N6 | Quick-amount chips `+KSh130 · +KSh648 · +KSh1.3k · +KSh13.0k` — non-round values consistent with USD presets ($1/$5/$10/$100) converted at ≈129.6 KES/USD | ticket, same screenshot | Yes. **Confirmed in code** (V): `pm-ticket.tsx:559-560` builds chips as `[1, 5, 10, 100].map((usd) => usdToLocal(usd, …))`. Arithmetic at the observed rate: 1×129.6 = 130, 5×129.6 = 648, 10×129.6 = 1,296 ≈ 1.3k, 100×129.6 = 12,960 ≈ 13.0k. The comment on line 558 says "+$1/+$5/+$20/+$100" while the code uses 10, not 20 |
| N9 | **Seeded default stake**: when the sheet opens untouched, the amount is pre-filled with the first chip (KSh 130) | `pm-ticket.tsx:568` (`if (!touched && !amount && isOpen …) setAmount(String(chips[0]))`) and `:1022` | Yes — the pre-armed-stake pattern work-plan rule 7 forbids |
| N7 | "To win" payout framing with no "Most you can lose" line and no fee line | ticket | Yes — conflicts with work-plan rules 2–3 (subject to the psychology re-verification) |
| N8 | Probability shown to one decimal (`78.6%`) alongside "4.9 shares" jargon | ticket | Yes |

A `$1` hit in the home page's served HTML was checked and is React's RSC serialisation
(`"$1"` element reference), **not** visible text — not a finding.

### Added during execution (2026-09-27)

| # | Finding | Where | Status |
|---|---|---|---|
| N10 | Average price rendered as `52¢` via the HTML entity `&#162;` — missed by the first grep, which searched for the `¢` glyph | `components/trading/position-summary.tsx:132` | Fixed: whole-number `%` |
| N11 | "Invested" label (investment framing, banned in promotional copy) | `position-summary.tsx:136`, `portfolio/holdings-table.tsx:154` | Fixed: "You paid" |
| N12 | `formatUSD()` is misnamed: it converts to and renders **KSh** (`lib/utils.ts:29`). Not a notation violation | many | Rename in the Phase 0.7 formatter clean-up |
