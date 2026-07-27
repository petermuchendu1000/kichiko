# Module 4 — Trading (Orders & Positions)

## CLOB engine — authoritative, atomic

Trading runs on a **central limit order book (CLOB)**, not an automated market
maker. The legacy `place_bet` AMM/LMSR RPC was dropped in migration
`035_drop_amm_lmsr_functions.sql`; every market is now `pricing_engine='clob'`
and all order flow routes through the CLOB RPCs, each a single
`SECURITY DEFINER` transaction:

| RPC | Migration(s) | What it does |
| --- | --- | --- |
| `clob_place_order` | `030`, `033` (two-sided), `043` (settlement) | Validate → lock market/wallet → match against resting orders by **price-time priority** → mint/burn or transfer shares → debit/credit wallet → record fills, position, activity, and new price. Any failure rolls the whole order back. |
| `clob_cancel_order` | `030` | Cancel a resting order and release its escrowed funds/shares. |
| `clob_get_book` | `030`, `033` | Return the two-sided book (bids/asks) with depth per candidate. |
| `clob_expire_orders` | `044` | Background sweeper that expires lapsed resting orders and releases escrow. |

Supporting migrations harden the engine: `042` (authz), `045` (rounding
conservation), `046` (open-order caps + placement rate limits).

### Matching & pricing

- Orders are quoted in **cents** on a fixed tick grid (`CLOB_TICK = 0.1`,
  bounded `0.1c – 99.9c`); a YES price of `c` implies NO at `100 − c`
  (`complementCents`).
- A **limit** order rests on the book at its `price_cents` until it is matched,
  cancelled, or expires. A **market** order crosses the spread and fills against
  the best resting orders until its `size` (shares) or `amount_local` ($ budget)
  is exhausted; partial fills are supported.
- Price-time priority: better prices fill first; ties break by resting time.
- The last fill sets the displayed market price; the best bid/ask bound it.

## Fees (`lib/trading.ts`)

```
feeUsd           = amountUsd · platform_fee_rate          (default 2%)
creatorRewardUsd = min(amountUsd · creator_reward_rate, feeUsd)   (default 0.25%)
platformNetUsd   = feeUsd − creatorRewardUsd
netStakeUsd      = amountUsd − feeUsd
```

The creator reward is skipped on self-trades (anti wash-trading). `meetsMinBet`
enforces the $0.10 minimum. The UI order ticket estimates fills with
`estimateClobBuyShares` / `estimateClobSellProceedsUsd` from `lib/clob.ts` so the
on-screen preview and the submitted order can never drift.

## Orders API (`/api/orders`)

- `POST` → `clob_place_order` RPC. Body validated by `clobOrderSchema`
  (`lib/clob.ts`): `engine:'clob'`, `market_id`, `market_option_id`,
  `outcome_side` (`yes`|`no`), `action` (`buy`|`sell`), `order_type`
  (`market`|`limit`), plus `price_cents` (**required for limit orders**),
  `size` (shares) and/or `amount_local` ($ for market buys), `currency`,
  optional `client_order_id` and `expires_at` (must be in the future).
- `DELETE`/cancel → `clob_cancel_order` RPC.
- `GET` → user's orders (paginated), joined with market summary.

The `CLOB_ERRORS` map (`lib/clob.ts`, via `clobErrorFor`) maps each RPC
SQLSTATE → HTTP status:

| Code | HTTP | Meaning |
| --- | --- | --- |
| P0001 | 404 | market not found / not active |
| P0002 | 409 | market closed for betting |
| P0003 | 400 | unsupported currency |
| P0005 | 400 | wallet not found for this currency |
| P0006 | 402 | insufficient balance |
| P0007 | 400 | selected option not found for this market |
| P0101 | 400 | a candidate (`market_option_id`) is required |
| P0102 | 400 | order size must be > 0 |
| P0103 | 409 | market is not an order-book market |
| P0104 | 400 | limit order missing `price_cents` |
| P0105 | 400 | below the market minimum size |
| P0110 | 404 | order not found (cancel) |
| P0111 | 403 | can only cancel your own orders |
| P0112 | 409 | order no longer cancellable |
| P0113 | 409 | not enough shares to sell |
| P0121 | 403 | not authorized to act for another user (authz guard, mig 042) |
| P0130 | 429 | too many open orders (max 250) |
| P0131 | 429 | too many open orders on this market (max 60) |
| P0132 | 429 | placement rate limit exceeded (max 100 / 10s) |

> `P0100` ("sells not available") is retained for back-compat only; the
> two-sided engine (migration 033) accepts sells, so it is no longer raised.

## Positions

Aggregated per `(user_id, market_id, side)` (unique) via `ON CONFLICT DO UPDATE`:
shares and invested USD accumulate, `avg_entry_price` is re-weighted, and
`current_value_usd` re-marked at the new price. Detailed P&L surfacing is
Module 5 (Portfolio).

## Gate (all green)
- DB-live (rolled back): a market buy fills via MINT and debits the wallet; a
  sell credits and reduces the position; the oversell guard (`P0113`) fires; the
  `clob_get_book` invariant returns an uncrossed two-sided book.
- Unit: trading fee tests (fee split, cap, min-bet FX) + `lib/__tests__/clob.test.ts`
  (ticks, complement pricing, book shaping, estimates, `clobOrderSchema`,
  `CLOB_ERRORS`) + 10 lifecycle tests. `tsc` clean · `next build`.
