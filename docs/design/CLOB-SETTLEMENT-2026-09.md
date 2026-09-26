# CLOB settlement correctness (migration 069), 2026-09

Status: fixed on branch `fix/clob-settlement-correctness`, not yet applied to
production. Reproduced first, then fixed, then re-verified on two databases:
the Supabase Postgres 17.6 image and the CI pipeline's vanilla Postgres 17.11.

## What was wrong

The resolvers in `052` were written for the AMM. Under the AMM a stake sat in
`wallets.reserved_balance` until resolution, so the resolver returned the stake
and paid winnings on top. On the CLOB a buyer's filled cost leaves the wallet
for good (`046:400-403`). Only the unfilled remainder of a resting buy sits in
`reserved_balance`. Nobody updated the resolvers when the engine changed, and no
test ever resolved a market, so this went unnoticed.

| # | Defect | Evidence | Effect |
|---|---|---|---|
| 1 | Winners paid `shares + total_invested_usd` | `052:450-453`, `784-786` | 100 YES bought at 60c paid $160, not $100. Money created from nothing on every resolution |
| 2 | Cost basis subtracted from `reserved_balance` for winners and losers | `052:454`, `786`, `823` | Drains escrow of the user's open orders on other markets and pending-withdrawal holds |
| 3 | Market's resting orders left live | no release in any resolver | Escrow and share reservations locked forever on a dead market |
| 4 | Simplex resolver pays by option, ignores side; keys ledger rows by (market, user) | `052:571-719`, `001:370` | Wrong holders paid on a CLOB book; any user with two positions aborts the whole resolution |
| 5 | Admin-console resolution inserts notifications without the 062 opt-in | `062:64-67` | Every admin resolution with a winner fails with `P0121` |
| 6 | Realized P&L and payout history overwritten | `052:459-465`, `791-796` | Secondary-trading P&L lost at resolution |
| 7 | `cancel_market` refunds cost basis, no status check | `052:860-947` | Not collateral-backed after secondary trading (the seller already received the buyer's cash); can be run twice |
| 8 | No solvency check | none | Pays out even when positions exist that no collateral backs |

The red run of `scripts/ops/clob/test_settlement.py` against the pre-069 schema
reproduces every row above. Scenario A printed `u1 avail=100100 want 100040`,
which is defect 1 exactly.

## The model the fix relies on

From `046`:

| Match | Both legs | Shares | Cash |
|---|---|---|---|
| mint | YES buy x NO buy | +1 YES, +1 NO | $1 leaves the two buyers |
| merge | YES sell x NO sell | -1 YES, -1 NO | $1 returns to the two sellers |
| direct | buy x sell, same side | transfer | buyer pays seller |

So for every option, `Sum(YES shares) == Sum(NO shares) == collateral in USD`.
A settlement that pays YES `p` and NO `1-p` per share, with `0 <= p <= 1`, pays
out exactly the collateral whatever `p` is. Resolution is `p` in {0, 1}. A void
is any `p`, for example 0.5.

## The fix

- **`_clob_settle_market` (internal).** The single settlement core that every path now goes through. In order, it:
  - locks the market;
  - rejects bad status (`P0002`);
  - rejects legacy or option-less positions (`P0142`);
  - validates the payout map (`P0145`);
  - enforces the **solvency guard**: refuses (`P0141`) when `Sum(YES) != Sum(NO)` on any option;
  - locks every affected wallet in id order;
  - cancels the market's live orders;
  - pays `shares x payout` per (option, side) at the live FX rate;
  - accumulates P&L;
  - writes one ledger row per position (`settle_<position_id>`);
  - opts into the 062 notification guard.
- **`_clob_release_market_orders` (internal).** Returns buy escrow and clears sell reservations. It moves `LEAST(order escrow, wallet reserved)`, so a wallet whose reserve is already short is never credited money it does not hold. Shortfalls are reported in the result.
- **`resolve_market`, `resolve_market_options`, `resolve_market_options_binary`, `cancel_market`.** Same signatures, same grants.
  - A yes/no outcome on a multi-option market is ambiguous and raises `P0143`.
  - The simplex and independent resolvers settle identically on a CLOB book.
  - `cancel_market` works only when no positions exist. Otherwise it raises `P0144` rather than paying unbacked refunds.
- **`void_market(market, yes_price, reason)`.** An explicit, conserving void. It is service_role only until a void policy is approved for the admin console.
- **Override for the solvency guard.** Only a trusted server session (`auth.uid() IS NULL`) that runs `SET LOCAL app.settlement_allow_unbacked = 'on'` can override it. PostgREST clients cannot set GUCs.
- **BTC windows.** They are `amm` markets with no positions, so they still resolve through `resolve_market` (status change only).

## Verification

| Check | Result |
|---|---|
| `test_settlement.py`: 16 scenarios plus 40 randomized books (459 orders, 153 fills), all zero-sum | 50 / 50 pass |
| `fuzz_invariants.py` N=4000 and 5000 | 0 violations |
| `test_two_sided.py` | 20 / 20 |
| `test_046.py` | all pass |
| Full CI script `scripts/ci/run_clob_invariants.sh` on vanilla PG 17.11 | all 4 harnesses pass |
| Concurrency: 6 resolutions racing 6 parallel traders (1,225 orders) on shared wallets | exact zero-sum, 0 orders accepted after resolution, 0 live orders left, 0 negative wallets |
| Grants | helpers owner-only; `void_market` service_role only; resolvers unchanged |
| BTC amm auto-resolve | `amm/resolved/yes` |

## Behaviour changes operators will see

1. **Resolution on the current production data will stop with `P0141`.** Every production option book fails the collateral check (read-only snapshot, 2026-09-26): 2,224,769 YES against 1,091,430 NO shares in total. Only 11 of 2,291 orders carry the `engine` metadata that `clob_place_order` writes. The rest were inserted directly (seed data). Paying those positions would pay out money nobody deposited as collateral. The owner has to decide how to treat the seeded positions. The guard stays in place until then.
2. Cancelling a market that has positions now fails with `P0144`. A void price has to be chosen (`void_market`).
3. Settlement returns more fields: `collateral_usd`, `orders`, `unbacked_override`. No app code reads the removed fields.

## Known issues found here, not fixed in 069

- **Deadlocks between concurrent takers.** They occur about 2% of the time under parallel load: 18 in a baseline run with no settlement at all. The cause is lock-order inversion on maker wallets in `clob_place_order`. This is scheduled with the engine work.
- **`clob_cancel_order` and `clob_expire_orders` clamp with `GREATEST(0, reserved - x)`.** When a wallet is under-reserved, they still credit the full amount. Scheduled with the reservation-integrity fix (064).
- **Profile P&L ignores sell proceeds.** Maker sell legs are `bet_refunded`, which `update_profile_stats` does not count. Void payouts use the same type.
- **FX staleness.** The live KES rate in production was last fetched 2026-07-28, and settlement converts at that rate. The exchange-rate cron is not running.
- **Settlement currency.** Contracts are USD units held in local-currency wallets, so the platform carries the FX gap between entry and settlement. A single settlement currency per market removes this. It is a design decision for the engine roadmap.
