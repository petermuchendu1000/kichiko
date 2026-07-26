# Polymarket System Architecture — Ground Truth

> Part of the [Polymarket Research Corpus](./README.md). Empirical claims are backed by
> live snapshots in [`/tools/polymarket-research`](../../../tools/polymarket-research/README.md)
> collected **2026-07-22 14:42 UTC** (n = 600 order-book markets, 200 events, 140 order books).
> Protocol/contract claims are sourced from Polymarket's official documentation
> (`docs.polymarket.com`) and cross-checked against live API responses.

---

## 1. Executive summary

Polymarket is a **hybrid-decentralized central limit order book (CLOB)** prediction market
built on **Polygon PoS**. It separates three concerns cleanly:

1. **Off-chain matching** — a centralized operator runs the order book, accepts
   [EIP-712](https://eips.ethereum.org/EIPS/eip-712)-signed limit orders, matches them, and
   sequences execution. This gives a CEX-like UX (sub-second quotes, deep books).
2. **On-chain settlement** — matched trades settle **atomically** through an audited
   `CTF Exchange` smart contract. The operator **cannot** set prices, move funds without a
   signed order, or execute unauthorized trades. Trading is **non-custodial**.
3. **Decentralized resolution** — outcomes are finalized by **UMA's Optimistic Oracle**, not
   by Polymarket itself.

This tripartite split (matching / settlement / resolution) is the single most important
architectural fact to internalize when building a parity system: **the order book is a
product surface; correctness and custody live on-chain.**

---

## 2. The four public APIs

All read APIs are **public — no key, no auth, no wallet** required (verified live: every
endpoint below returned HTTP 200 without credentials).

| API        | Base URL                            | Responsibility                                                            | Auth |
|------------|-------------------------------------|--------------------------------------------------------------------------|------|
| **Gamma**  | `https://gamma-api.polymarket.com`  | Discovery: events, markets, tags, series, sports, search, public profiles | none |
| **CLOB**   | `https://clob.polymarket.com`       | Order books, prices, midpoints, spreads, price history; order lifecycle   | public reads; **auth for trading** |
| **Data**   | `https://data-api.polymarket.com`   | Positions, trades, activity, holders, open interest, leaderboards         | none |
| **Bridge** | `https://bridge.polymarket.com`     | Cross-chain deposits / withdrawals                                        | wallet |

### 2.1 Endpoint map (verified live)

**Gamma** — `GET /events`, `GET /events/{id}`, `GET /markets`, `GET /markets/{id}`,
`GET /public-search`, `GET /tags`, `GET /series`, `GET /sports`, `GET /teams`.

**CLOB** — `GET /price`, `GET /prices`, `GET /book`, `POST /books`, `GET /prices-history`,
`GET /midpoint`, `GET /spread`, `GET /markets`, `GET /sampling-simplified-markets`.

**Data** — `GET /positions?user=`, `GET /closed-positions?user=`, `GET /activity?user=`,
`GET /value?user=`, `GET /oi`, `GET /holders`, `GET /trades`.

> **Design implication for Kichiko:** the read/trade split is a clean seam. A parity
> backend can expose an identical read surface (discovery + book + history + holders) as a
> thin, cache-friendly layer, and gate the write surface (orders) behind auth. Our Supabase
> schema already mirrors this: `markets`/`market_options` (discovery), `clob_orders`/`clob_fills`
> (book + trades), `positions` (Data-API analog). See [06-KICHIKO mapping](./06-KICHIKO-GROUND-TRUTH-MAPPING.md).

---

## 3. The CLOB: hybrid-decentralized trading

### 3.1 Order flow

```
   Trader                Operator (off-chain)              Polygon (on-chain)
     │                          │                                │
     │  1. EIP-712 sign order   │                                │
     │─────────────────────────▶│                                │
     │                          │  2. validate sig, balance,     │
     │                          │     allowance, tick, min-size  │
     │                          │  3. insert into order book     │
     │                          │  4. match maker⇄taker          │
     │                          │────────────────────────────────▶│
     │                          │                                │ 5. CTF Exchange verifies
     │                          │                                │    sigs, transfers ERC-1155
     │                          │                                │    outcome tokens + USDC,
     │                          │                                │    settles atomically
     │◀─────────────────────────────────────────────────────────│ 6. fill event
```

Key properties (from official docs, corroborated by book/market responses):

- **Orders are EIP-712 signed messages.** The operator relays; it cannot forge them.
- **Settlement is atomic** on the `CTF Exchange` contract (audited by ChainSecurity).
- **Makers add liquidity, takers remove it.** Price improvement accrues to the taker; a
  buyer pays the best available resting ask.
- **Taker delays**: some markets enforce a matching delay (docs cite ~250 ms; sports/event
  markets may add event-specific delays) to reduce latency-arbitrage and toxic flow.
- **Order states**: `live`, `matched`, `delayed`, `unmatched`, `cancelled`. Open unmatched
  orders can be cancelled unless inside a pending delay window.

### 3.2 Trading parameters observed live

Per-market trading constraints are exposed on both Gamma (`orderPriceMinTickSize`,
`orderMinSize`) and CLOB (`minimum_tick_size`, `minimum_order_size`).

| Parameter        | Observed values (n=600)                                  | Interpretation |
|------------------|---------------------------------------------------------|----------------|
| **Tick size**    | `0.001` → 388 markets (64.7%), `0.01` → 212 (35.3%)     | High-liquidity/politics markets quote to **0.1¢**; sports/low-liq to **1¢** |
| **Min order**    | median **$5** (Gamma `orderMinSize`); CLOB shows 15 on some sports markets | Dust protection; varies by market class |
| **negRisk**      | **50.17%** of markets flagged `negRisk: true`           | Half the universe is multi-outcome capital-efficient (see [§ CTF/negRisk](./05-RESOLUTION-CTF-NEGRISK.md)) |

> Tick size is not cosmetic — it defines the price lattice, the minimum spread, and the
> rounding rules for every downstream P&L and depth calculation. Parity systems **must**
> store tick size per market and enforce it server-side. Kichiko migration `030_clob_foundation.sql`
> is the correct home for these constraints.

### 3.3 Rewards / liquidity mining

`sampling-simplified-markets` exposes a `rewards` block per market:
`{ rates: [{ asset_address, rewards_daily_rate }], min_size, max_spread }`. Polymarket pays
**maker rebates** for resting liquidity within `max_spread` of the midpoint at ≥ `min_size`.
Gamma also exposes `rewardsMinSize`, `rewardsMaxSpread`, `holdingRewardsEnabled`, and a
documented **~4% annualized holding reward** on eligible position value (sampled hourly, paid
daily). This is a core liquidity-bootstrapping mechanism a parity system must model as a
background job (Kichiko: `job_runs` + `commission_plans`/`campaigns`).

---

## 4. On-chain substrate

| Layer               | Component                                    | Role |
|---------------------|----------------------------------------------|------|
| Chain               | **Polygon PoS**                              | Low-fee settlement |
| Collateral          | **USDC** (referred to as pUSD in resolution docs) | 1 share redeems for $1 |
| Outcome tokens      | **Gnosis Conditional Token Framework (CTF)**, ERC-1155 | YES/NO (and multi-outcome) positions |
| Matching+settlement | **CTF Exchange** contract                    | Atomic, non-custodial trade settlement |
| Multi-outcome       | **Neg Risk Adapter** + **Neg Risk CTF Exchange** | Capital-efficient mutually-exclusive baskets |
| Resolution          | **UMA Optimistic Oracle (+ DVM)**            | Decentralized outcome finalization |

The **conditionId** (a `bytes32`, e.g. `0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be`)
is the on-chain identity of a market's condition; **clobTokenIds** are the ERC-1155 token IDs
of its outcomes. These are the join keys between the off-chain product and the on-chain truth.
See [02-DATA-MODEL](./02-DATA-MODEL.md) for the full identifier graph.

---

## 5. Architectural lessons for a parity build

1. **Separate the read plane from the write plane.** Reads (discovery, book, history) are
   cacheable and public; writes (orders) are signed and gated. Different scaling, caching,
   and auth stories.
2. **Persist on-chain identifiers as first-class keys** (`conditionId`, token IDs, question ID).
   They are the only stable joins across product, settlement, and resolution.
3. **Enforce market constraints server-side** (tick, min-size, max-spread). The client is a
   convenience; the server is the authority.
4. **Model resolution as an external, adversarial, time-boxed process** — not an admin toggle.
   Even a centralized parity build should keep a resolution audit trail (`audit_log`).
5. **Treat liquidity incentives as first-class** — rewards, holding yield, maker rebates —
   because they materially shape the microstructure documented in
   [03-MARKET-MICROSTRUCTURE](./03-MARKET-MICROSTRUCTURE.md).
