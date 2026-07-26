# Kichiko ↔ Polymarket Ground-Truth Mapping & Parity Gaps

> Part of the [Polymarket Research Corpus](./README.md). The Kichiko side was **introspected
> live** from Supabase (`information_schema`) on 2026-07-22; the Polymarket side from the
> snapshots + docs in this corpus. This document is the authoritative parity checklist.

---

## 1. What Kichiko is (and isn't)

Kichiko is a **centralized, off-chain** prediction-market platform that presents a
**Polymarket-parity UX**. It is **not** on-chain: there is no CTF, no Polygon settlement, no
UMA oracle. Instead it uses Supabase/Postgres as the system of record with:

- Two pricing engines: **AMM/LMSR-style** (`market_options.q_yes`, `q_no`, `options_pricing_mode`,
  `pricing_engine`) **and** an **internal CLOB** (`clob_orders`, `clob_fills`, `price_cents`).
- Fiat/mobile-money rails (M-Pesa etc. via `transactions.payment_provider`, `payment_phone`),
  not USDC.
- Centralized, dual-control resolution (`markets.status`, `resolved_outcome`, `resolver_id`,
  `audit_log`).

This is a legitimate architecture for East-Africa fiat markets — but it means "parity" is about
**product behavior and data fidelity**, not protocol replication. The gaps below are scoped to
that goal.

---

## 2. Schema alignment (live-verified columns)

| Domain        | Polymarket ground truth                        | Kichiko columns (verified)                                              | Verdict |
|---------------|------------------------------------------------|---------------------------------------------------------------------------|---------|
| Market core   | `id`, `slug`, `question`, `conditionId`        | `markets.id, slug, title, description, status, category`                   | ✅ / ❌ no `condition_id` |
| Outcomes      | `outcomes[]`, `clobTokenIds[]`, `outcomePrices`| `market_options.label, price, yes_price, no_price, q_yes, q_no, display_order` | ✅ / ❌ no token id |
| Prices        | `midpoint`, `bestBid/Ask`, `lastTradePrice`    | `markets.yes_price/no_price`, `market_options.price`, `price_history.price`| ✅ |
| Order book    | `/book` (price×size levels, ≥93 levels median) | `clob_orders(price_cents, size, filled, status, outcome_side, order_type)` | ✅ |
| Fills         | CLOB fills / Data `/trades`                    | `clob_fills(price_cents, size, taker/maker_order_id, match_kind)`          | ✅ |
| Positions     | Data `/positions`, `/holders`                  | `positions(shares, avg_entry_price, unrealized_pnl_usd, realized_pnl_usd)` | ✅ |
| Volume/liq    | `volume24hr`, `liquidityNum`, `...Clob`        | `markets.total_volume_usd, volume_24h_usd, liquidity_pool_usd, trades_24h` | ✅ |
| Fees          | `makerBaseFee`, `takerBaseFee`, `feeSchedule`  | `markets.platform_fee_rate`, `orders.fee_usd`, `commission_plans`          | ✅ |
| Resolution    | UMA `umaResolutionStatuses`, `resolvedBy`      | `markets.resolved_outcome, resolver_id, resolution_notes, resolution_flagged_at` | ✅ centralized |

---

## 3. Parity gaps (prioritized, actionable)

### P0 — correctness / data fidelity

1. **Sub-cent price precision.** Polymarket tick is **0.001** for 64.7% of markets;
   `clob_orders.price_cents` and price displays must carry **≥1 sub-cent decimal** (0.1¢).
   *Action:* confirm `price_cents numeric` stores `50.5`, not integer 50; add a CHECK that
   price respects the market's tick; store tick per market (P1 below). *Risk if unfixed:* the
   majority of the universe (the [0,0.10] longshot band) becomes unrepresentable.
2. **Dual-leg / multi-leg invariant.** Enforce `yes_price + no_price = 1` (binary) and
   `Σ market_options.price = 1` (multi-outcome) as a DB constraint or ingestion assertion.
   Empirically Polymarket holds this to 100% (Gamma) / 97.25% (live books). *Action:* add a
   test + a data-quality alarm (see [04 § 3](./04-QUANT-PROCESSING.md)).

### P1 — parity feature gaps

3. **Store trading constraints per market:** `tick_size`, `min_order_size`, `max_spread`
   (rewards). *Action:* extend `markets` (new migration) with these; enforce server-side in the
   order-placement RPC. Ground truth: tick ∈ {0.001, 0.01}, min order ≈ $5.
4. **Neg-risk / mutual-exclusivity for multi-outcome events.** No conversion economics and no
   `Σprice=1` coupling today. *Action:* group-level invariant, an explicit **"Other"** option,
   and (if AMM) shared-liquidity coupling. Ground truth: 50.17% of markets are neg-risk.
5. **Depth-aware order preview (walk-the-book).** Quote `effective_price(Q)` and slippage from
   the live book, not the touch. *Action:* a preview RPC over `clob_orders`. Ground truth:
   median 5¢ depth $38.8k, p95 $5.9M — slippage is real on the tail.
6. **On-chain / external identifiers (optional but future-proof).** If Kichiko ever ingests
   or mirrors Polymarket data, add nullable `markets.condition_id` and
   `market_options.clob_token_id` as external-reference keys.

### P2 — incentives & depth quality

7. **Liquidity rewards & holding yield.** Model maker rebates + a holding-reward job to keep
   books deep near resolution. *Action:* extend `commission_plans`/`campaigns`; a `job_runs`
   task samples position value hourly. Ground truth: Polymarket pays ~4% holding + maker rebates.
8. **Volume/liquidity are independent signals.** Track and cache both (they correlate loosely,
   log-log). *Action:* keep `volume_24h_usd` and `liquidity_pool_usd` as separate cache keys /
   ranking inputs. Tier cache TTLs by `volume_24h_usd` (power-law head vs tail).

---

## 4. Numeric parity targets (calibrate Kichiko against these)

| Property                         | Polymarket ground truth (2026-07-22) | Kichiko target |
|----------------------------------|--------------------------------------|-------------------|
| Tick size                        | 0.001 (65%) / 0.01 (35%)             | support 0.001     |
| Min order size                   | ~$5                                  | configurable ≥ local min |
| Typical top-of-book spread       | median 0.002 (0.2¢)                  | ≤ 1 tick on liquid |
| Book depth                       | median 93 levels/token               | deep synthetic/MM book |
| 5¢ notional depth (median)       | $38,813                              | scale to local volume |
| YES+NO coherence                 | 100% within 1%                       | 100% (hard constraint) |
| Longshot mass ([0,0.05])         | 46% of markets                       | precision must cover band |
| Intraday range (median)          | 0.0575                               | charts preserve jumps |

---

## 5. Recommended next migrations (not yet applied)

```sql
-- 031_market_trading_constraints.sql  (P1)
ALTER TABLE public.markets
  ADD COLUMN tick_size       numeric NOT NULL DEFAULT 0.001,
  ADD COLUMN min_order_size  numeric NOT NULL DEFAULT 5,
  ADD COLUMN rewards_max_spread numeric,        -- maker-rebate eligibility band
  ADD COLUMN condition_id    text,              -- nullable external ref (Polymarket parity)
  ADD CONSTRAINT tick_positive CHECK (tick_size > 0);

ALTER TABLE public.market_options
  ADD COLUMN clob_token_id   text;              -- nullable external ref

-- 032_price_coherence_guard.sql  (P0)  — enforce Σ option price = 1 per market
--   (implement as a deferred constraint trigger or ingestion-time assertion + test)
```

> These are **proposals** documented as ground truth; they are **not** applied in this research
> pass (which is analysis + documentation only). Apply behind CI + a reversible migration in a
> dedicated change.
