# Module 3 — Markets & CLOB Pricing

## CLOB (central limit order book)

Prices are **not** set by an automated market maker. Each market runs a central
limit order book: participants post limit orders that rest on the book, and
incoming orders match against the best available price by **price-time
priority**. The last fill sets the displayed market price, and the best bid/ask
quotes bound it. There is no LMSR cost function — the legacy AMM/LMSR engine
(`place_bet`, `lmsr_price`, `lmsr_cost_to_buy`, `lmsr_price_multi`) was dropped
in migration `035_drop_amm_lmsr_functions.sql`; the platform is now CLOB-only
(`pricing_engine = 'clob'`).

Prices are quoted in **cents** on a fixed tick grid (`CLOB_TICK = 0.1`, bounded
`0.1c – 99.9c`); a YES price of `c` implies a NO price of `100 − c`.

### Authority & parity

The order-book RPCs are **authoritative** and run server-side, atomically:

| RPC | Purpose |
| --- | --- |
| `clob_place_order` | Place a limit/market order; match against the book, mint/burn or transfer shares, debit/credit the wallet, record fills |
| `clob_cancel_order` | Cancel a resting order and release its reserved funds/shares |
| `clob_get_book` | Read the current two-sided (bids/asks) book with depth |
| `clob_expire_orders` | Sweep expired resting orders (background job) |

`lib/clob.ts` is the matching TypeScript reference used for UI previews and
validation: price clamping/ticks (`clampPriceCents`, `complementCents`), book
shaping (`shapeBook`, `withCumulativeTotals`), buy/sell estimates
(`estimateClobBuyShares`, `estimateClobSellProceedsUsd`), the Zod order schema
(`clobOrderSchema`), and the canonical error map (`CLOB_ERRORS` / `clobErrorFor`).
Behaviour is asserted in `lib/__tests__/clob.test.ts`.

> Note: order matching, settlement, rounding conservation, and the expiry
> sweeper live in the CLOB migration set (`030`–`046`, e.g.
> `033_clob_two_sided`, `043_clob_settlement_correctness`,
> `044_clob_expire_orders_sweeper`, `045_clob_rounding_conservation`). The order
> ticket and API route exclusively through `clob_place_order` / `clob_cancel_order`.

## Market lifecycle (`lib/market-lifecycle.ts`)

State machine over the `market_status` enum:

```
draft ──submit──▶ pending ──approve──▶ active ──close──▶ closed ──resolve──▶ resolved
  │ activate(admin) ▲ return                  │ dispute        │ dispute
  └────────────────┘                          ▼                ▼
        (cancel from draft/pending/active/closed) ──▶ cancelled   disputed ──▶ resolved/cancelled
```

- `resolved` and `cancelled` are **terminal**.
- `canTransition` / `validateTransition` are the single source of truth; the
  admin status route validates every change through them.

## API

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/markets` | GET | public | List w/ filters, sort, pagination |
| `/api/markets` | POST | active user | Create (→ `pending`, or `active` for admins) |
| `/api/markets/[id]` | GET | public | Fetch one by UUID **or** slug |
| `/api/markets/[id]/status` | PATCH | admin/mod | Lifecycle transition (state-machine enforced, audited) |
| `/api/markets/[id]/resolve` | POST | resolver | Resolve via `resolve_market` RPC (separate: needs outcome) |

The status route uses an **optimistic concurrency guard** (`.eq('status', from)`)
so two concurrent transitions can't race, routes cancellations through the
atomic `cancel_market` RPC (handles refunds), and writes an `audit_log` row for
every change.

### Create-market validation
Title/description/criteria length bounds (Zod), category enum, ≥1-hour trading
window, and `resolves_at ≥ closes_at`. Regular users land in `pending` for
review; admins/moderators activate directly.

## Tests & gate
- `lib/__tests__/clob.test.ts` — order-book unit tests: price clamping/ticks,
  complement pricing, book shaping + cumulative depth totals, buy/sell estimates,
  `clobOrderSchema` validation, and the `CLOB_ERRORS` / `clobErrorFor` mapping.
- `lib/__tests__/market-lifecycle.test.ts` — 10 tests: legal/illegal transitions,
  terminal guards, structured `validateTransition` errors.

Gate: `tsc --noEmit` clean · `next build` · DB-live CLOB checks (`clob_get_book`
returns an uncrossed two-sided book) + rolled-back create-market verifying
defaults (`draft`).
