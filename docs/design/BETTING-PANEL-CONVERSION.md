# Betting Panel — Conversion & Friction Analysis (Mobile-First)

Status: **implemented** · Owner: Product Design + Frontend · Audience skew: **mobile-majority**

The order ticket is the single most important conversion surface in the product —
every other screen exists to funnel a user here. This document critiques the
current implementation, benchmarks how the best products solve the same problem,
and specifies the strategy we shipped.

---

## 1. Current state (before)

The market detail page (`app/markets/[slug]/page.tsx`) uses a two-column grid:

```
grid-cols-1  lg:grid-cols-3
├── main (lg:col-span-2)         ← DOM first
│   ├── MarketHeader
│   ├── Probability history chart
│   ├── Recent activity (5 rows)
│   └── Comments
└── sidebar                       ← DOM second
    └── (lg:sticky)
        ├── BettingPanel          ← the CTA
        ├── PositionSummary
        ├── Resolution rules
        └── Contract specs
```

The `BettingPanel` (`components/trading/betting-panel.tsx`) supports binary
(YES/NO) and multiple_choice (N options), previews via LMSR, and posts to
`/api/orders`. The trading logic is solid. **The problems are placement and
friction, not correctness.**

---

## 2. What's wrong — prioritised by conversion impact

### P0 — The order ticket is buried on mobile (biggest single leak)
On a phone the grid collapses to one column and stacks the DOM: header → chart →
activity → comments → *then* the sidebar. The order ticket — the entire reason
the page exists — renders **below four full-height sections**. A mobile user
must scroll past a chart, an activity feed and a comment thread before they can
even see a "buy" control. There is no persistent CTA. This is a textbook
conversion killer: the primary action is off-screen on load for the majority of
our traffic.

### P1 — No always-reachable trade affordance on mobile
Best-in-class trading and checkout flows keep the primary action pinned in the
thumb zone (bottom 40% of the viewport). We have nothing sticky; the CTA scrolls
away entirely.

### P2 — Payout hook is hidden until the user does work
The "if you bet X you win Y" framing — the core dopamine of a prediction market —
only appears *after* the user types an amount. Before that the panel shows no
outcome value. Users can't see the reward before committing effort.

### P3 — Empty amount by default → cold start
`amount` starts empty (`placeholder="0"`). The user must think of a number and
type it before anything happens. Presets exist but none is pre-selected, so the
preview stays blank on load.

### P4 — Insufficient-balance is a dead end
When `amount > balance` we show a red error and disable the button — with no path
forward. The correct move is to convert the objection into a deposit: an
"Add funds" CTA that opens the deposit sheet.

### P5 — Outcome buttons under-sell the payout
Binary YES/NO buttons show price in cents but not the implied "to win" value.
Kalshi/Polymarket surface the reward directly on the buy control.

---

## 3. How the best products solve this

| Product | Mobile trade pattern | Takeaway we adopt |
|---|---|---|
| **Kalshi** | Clean fintech UI, large readable contract prices, a focused **bottom-dock** order ticket; market/limit only, no clutter. | Thumb-zone docked ticket; large prices; minimal fields. |
| **Polymarket** | Compact market row + a focused bottom trading panel; quick Yes/No; reward shown on the action. | Single-task bottom sheet; payout on the CTA. |
| **Robinhood / sportsbooks** | Persistent sticky "Review/Place" bar that expands into a bottom sheet; prefilled quick-stake chips. | Sticky bar → bottom sheet; preset stakes. |
| **Mobile checkout research (Razorpay, Baymard)** | CTA in bottom 40% thumb zone; full-width, high-contrast, ≥44px; **sticky** while scrolling; **prefill** values; minimise fields; keep the **total always visible**; surface costs early; LCP < 2.5s / INP < 200ms. | Every point maps directly onto the ticket. |

Consensus: on mobile, trading is a **thumb-zone, single-task, bottom-anchored**
surface with the reward and total always visible and the stake pre-seeded.

---

## 4. Strategy shipped

**A. Mobile: sticky trade bar + bottom sheet (decouples mobile from desktop).**
- A `fixed bottom-0` bar (`lg:hidden`) in the thumb zone carries **direct-action
  buttons**, not a hollow gateway: binary shows tappable **Buy YES / Buy NO**
  (with live price); multiple_choice shows **Buy {front-runner}**. The entry tap
  *is* the decision.
- Tapping a button opens a bottom sheet (slide-up, backdrop, focus-managed,
  `Esc`/swipe-down/backdrop to close) that hosts the **same** `BettingPanel`
  **pre-selected** on the tapped side/option with the stake pre-filled — so the
  flow is **2 meaningful taps** (decide → confirm), not a wasted "Trade" tap
  followed by an in-sheet decision.
- The desktop sticky sidebar is unchanged; the sidebar panel is hidden on mobile
  so there's exactly one visible ticket per breakpoint.

**B. Instant payout hook.** The panel seeds a sensible default stake (first
balance-aware preset) so the live preview — shares, avg fill, fee, and a bold
**"To win"** total — is visible immediately, before any typing. The selected
preset is highlighted.

**C. Reward-forward CTA + outcome buttons.** The primary button reads
"Buy YES · to win <amount>" once a stake is set, keeping the reward and total on
the action itself (checkout best practice: total always visible).

**D. Insufficient balance → deposit.** Over-balance flips the CTA to
"Add funds to trade", which dispatches a global `kichiko:open-deposit` event
the navbar listens for, opening the existing deposit sheet. The objection becomes
a funded wallet instead of a dead end.

**E. Accessibility & performance.** ≥44px targets, `aria-pressed`/`role=dialog`,
focus trap and restore, body-scroll lock, reduced-motion friendly (reuses
existing `slide-up`/`fade-in` tokens). No new dependencies — the sheet is a thin
client component over the existing design system, so bundle impact is minimal.

---

## 5. Success metrics to watch

- Detail-page → order-submit conversion rate (mobile), primary.
- Time-to-first-interaction with the ticket on mobile (should collapse to ~0
  scroll).
- Deposit-sheet opens attributed to the over-balance CTA.
- No regression in desktop conversion or Core Web Vitals (INP from the sheet).
