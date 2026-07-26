# Kalshi Order Ticket — Analysis & Kichiko Implementation

Reference market studied: `https://kalshi.com/markets/kxipo/ipos/kxipo-26`
("Which companies will officially announce an IPO this year?" — a grouped /
multi-market event). Captured live (headless Chromium, 1440×1000, EST locale)
plus Kalshi Help Center research on order types.

> Principle (repo doctrine): **study, don't copy.** We adopt Kalshi's proven
> trade *flow* and information hierarchy, and re-express it in the Pip design
> system on top of our own LMSR pricing (`previewBet`/`previewOptionBet`, which
> mirror the `place_bet` / `place_bet_option` RPCs so the preview equals
> execution).

## 1. Anatomy of Kalshi's order ticket (top → bottom)

| # | Element | Observed behaviour |
|---|---------|--------------------|
| 1 | **BUY / SELL** tabs | Uppercase, letter-spaced (~13px, 700). Active = solid dark text with an accent underline; inactive = muted. SELL closes/reduces an existing position. |
| 2 | **DOLLARS ⌄** mode | Top-right dropdown toggling the entry unit between **Dollars** and **Contracts**. Dollars → enter cash, contracts derived; Contracts → enter quantity, cost derived. |
| 3 | **Market question** | Muted, small, 2-line clamp. |
| 4 | **Selected outcome** | Avatar (rounded square) + bold display name (e.g. *Discord*). |
| 5 | **YES / NO price pills** | **Fully-rounded (100px radius)** pills. Price shown in **cents** (`YES 53¢`, `NO 52¢`) — price == implied probability. Active side is a **solid fill** (YES green `rgb(10,194,133)` `#0AC285`, NO red `rgb(217,22,22)` `#D91616`); inactive is a light grey pill. |
| 6 | **Amount field** | Large rounded input; unit label left, value right (`Dollars … $0`). |
| 7 | **Odds** | Row → right-aligned `55% chance` (implied probability of the selection). Small info affordance. |
| 8 | **Max payout** | Two-line left label (`Max payout` / resolution date `Dec 31, 2026`); right = big payout figure. Each contract pays **$1** if correct → payout = contracts × $1. |
| 9 | **CTA** | Full-width, **fully-rounded**, solid green. Copy is state-driven: `Sign up to trade` (logged-out) → `Buy Yes` / `Review order` (logged-in). |

### Order types (Help Center)
- **Market** — immediate fill against the book (taker).
- **Limit** — set a max price + quantity; immediate fills for available depth,
  remainder rests on the book (maker). Expiry options: **GTC** (valid until
  market expiration), **EOD**, **IOC** (immediate-or-cancel), or a custom time.
  A limit order is *not guaranteed* to fill.

### Colour & shape tokens (measured)
- YES/green accent `#0AC285`; NO/red accent `#D91616`.
- Pills & CTA border-radius **999px** (full pill).
- Price value 16px/400; side label 13px/500. Tabs 13px/700, tracking ~0.08em.

## 2. What we adopted (and why)

| Kalshi behaviour | Kichiko implementation | Notes |
|------------------|---------------------------|-------|
| BUY / SELL tabs | Header tabs with accent underline | **SELL is honestly gated** (disabled, "coming soon") — we have no sell endpoint yet (`/api/orders` is buy-only). No fake affordance. |
| Dollars / Contracts | `DOLLARS ⌄` menu → `{CURRENCY} amount` vs `Contracts` | Contracts mode uses a −/+ stepper; stake ≈ `contracts × price`, converted to local via `usdToLocal`. The LMSR preview then recomputes the true slippage-aware fill. |
| Cents pricing on rounded pills | `rounded-pill` YES/NO (binary) & option pills (multi), price in `¢` | Uses our `--yes` / `--no` tokens (already green/red) for palette cohesion. |
| Market / Limit | Segmented `Market · Limit` (binary only) + `Limit price (¢)` input | **Fully wired** — the orders API already accepts `order_type` + `limit_price` (0.01–0.99); multi-choice stays market-only per the API refinement. |
| Odds → “X% chance” | `Odds` row → implied chance (limit orders price at the resting limit) | |
| Max payout + date | `Max payout` with `resolves_at ?? closes_at` + big `text-yes` figure and profit % | Payout in the user's preferred currency. |
| Solid pill CTA | Full-width `rounded-pill` CTA in the side colour, payout-forward copy (`Buy YES · to win …`) | State-driven: `Sign up to trade` / `Add funds to trade` / `Buy …`. |

## 3. What we deliberately did NOT copy
- Kalshi's exact greens/reds — we keep our accessible Pip `--yes`/`--no` tokens
  so the ticket stays consistent with the rest of the app.
- "3.25% Interest on balance" — not part of our product.
- Social/activity rail — out of scope for the ticket.

## 4. Fidelity guarantees preserved
- **Preview == execution**: pricing still flows through `previewBet` /
  `previewOptionBet`; no client-side re-pricing.
- One component powers both the desktop sidebar and the mobile bottom sheet
  (`MobileTradeBar` hosts `<BettingPanel/>`) — single source of truth.
- Accessibility: `role="tab"`/`aria-selected`, `aria-pressed` pills,
  `role="listbox"` menu, labelled inputs, disabled reasons via `title`.

_Artifacts: `kalshi_order_ticket.png`, `kalshi_market_rows.png`,
`kalshi_full_page.png` (captured this session)._
