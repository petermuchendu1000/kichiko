# Polymarket Data Model — Ground Truth

> Part of the [Polymarket Research Corpus](./README.md). Field enumerations below are taken
> **verbatim from live API responses** (snapshot 2026-07-22 14:42 UTC), not from docs alone.

---

## 1. The core hierarchy

```
Event  (top-level question / grouping)
  └── Market  (a tradable condition; usually binary YES/NO)
        └── Outcome token  (ERC-1155; one per outcome, e.g. YES token + NO token)
              └── Order book  (bids/asks over the price lattice)
```

- **Event**: a top-level object (e.g. *"Who will win the 2028 election?"*). Contains one or
  more markets. Used for organization, discovery, and multi-outcome grouping.
- **Market**: the fundamental tradable unit. Maps to **a pair of CLOB token IDs**, a market
  (maker) address, a **questionID**, and a **conditionId**.
- **Single-market event**: *"Will Bitcoin reach $100k?"* → 1 market (Yes/No).
- **Multi-market event**: *"Where will X attend college?"* → N markets (one per candidate),
  each an independent Yes/No, often linked by **negRisk**.

> **Critical modeling note:** "the most fundamental element is always markets — events simply
> provide additional organization." Do **not** model events as the tradable unit. Kichiko
> already gets this right: `markets` + `market_options` with `020_multi_outcome_markets.sql`.

---

## 2. Identifier graph (the join keys)

| Identifier        | Type       | Scope         | Example                                                              |
|-------------------|------------|---------------|---------------------------------------------------------------------|
| `event.id`        | int (str)  | Gamma         | `"2890"`                                                             |
| `market.id`       | int (str)  | Gamma         | `"540817"`                                                           |
| `slug`            | string     | Gamma/URL     | `"new-rhianna-album-before-gta-vi-926"`                              |
| `conditionId`     | bytes32    | on-chain      | `0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be` |
| `questionID`      | bytes32    | on-chain/UMA  | resolution question identity                                        |
| `clobTokenIds[0]` | uint256    | CLOB/on-chain | `98022490269692409998126496127597032490334070080325855126491859374983463996227` (YES) |
| `clobTokenIds[1]` | uint256    | CLOB/on-chain | `53831553061883006530739877284105938919721408776239639687877978808906551086026` (NO)  |

**Rules of thumb**
- `conditionId` ↔ market (1:1). Use it to join Gamma ↔ CLOB (`/book?market=`) ↔ Data (`/holders?market=`).
- `clobTokenIds[i]` ↔ outcome `outcomes[i]` ↔ price `outcomePrices[i]` — **all three arrays are index-aligned.**
- CLOB per-token endpoints (`/book`, `/price`, `/midpoint`, `/spread`, `/prices-history`) key on **token_id**, not conditionId.

---

## 3. The Gamma `market` object — full field enumeration

Enumerated live (89 fields). Grouped by concern:

**Identity & routing**
`id`, `slug`, `question`, `questionID`, `conditionId`, `marketMakerAddress`,
`clobTokenIds`, `events`, `resolvedBy`, `submitted_by`, `createdBy`(via events).

**Outcomes & pricing** *(strings containing JSON arrays — must be parsed)*
`outcomes` → `"[\"Yes\", \"No\"]"`, `outcomePrices` → `"[\"0.505\", \"0.495\"]"`,
`lastTradePrice`, `bestBid`, `bestAsk`, `spread`, `oneYearPriceChange`.

**Liquidity & volume** *(note the `...Clob` variants isolate on-book activity)*
`liquidity`, `liquidityNum`, `liquidityClob`, `volume`, `volumeNum`, `volumeClob`,
`volume24hr`, `volume24hrClob`, `volume1wk`, `volume1wkClob`, `volume1mo`, `volume1moClob`,
`volume1yr`, `volume1yrClob`.

**Trading constraints**
`enableOrderBook`, `orderPriceMinTickSize`, `orderMinSize`, `acceptingOrders`,
`acceptingOrdersTimestamp`, `rfqEnabled`, `clearBookOnStart`.

**Fees & rewards**
`feesEnabled`, `feeType`, `feeSchedule`, `makerBaseFee`, `takerBaseFee`,
`rewardsMinSize`, `rewardsMaxSpread`, `holdingRewardsEnabled`.

**neg-risk (multi-outcome)**
`negRisk`, `negRiskOther`, `negRiskRequestID`, `groupItemTitle`, `groupItemThreshold`.

**Resolution (UMA)**
`umaBond`, `umaReward`, `umaResolutionStatuses`, `resolutionSource`, `customLiveness`,
`endDate`, `endDateIso`, `startDate`, `startDateIso`.

**Lifecycle / state flags**
`active`, `closed`, `archived`, `approved`, `funded`, `ready`, `new`, `featured`,
`restricted`, `competitive`, `deploying`, `deployingTimestamp`, `pendingDeployment`,
`automaticallyActive`, `manualActivation`, `comboStatus`, `cyom`.

**Presentation & i18n**
`image`, `icon`, `description`, `seriesColor`, `showGmpOutcome`, `showGmpSeries`,
`requiresTranslation`, `createdAt`, `updatedAt`.

> **Gotcha #1 — stringified JSON.** `outcomes`, `outcomePrices`, and `clobTokenIds` are
> **JSON strings**, not native arrays. Every consumer must `JSON.parse` them. Our collector
> handles this in `parse_token_ids()` / `jloads()`.
>
> **Gotcha #2 — dual volume/liquidity.** `volumeClob`/`liquidityClob` isolate order-book
> activity from AMM-era/legacy figures. For microstructure work, prefer the `...Clob` fields.

---

## 4. Outcomes and prices = implied probabilities

Each market's `outcomes` and `outcomePrices` map 1:1. **Price = implied probability**; a
winning share redeems for **$1**.

```json
{ "outcomes": "[\"Yes\", \"No\"]", "outcomePrices": "[\"0.20\", \"0.80\"]" }
// YES → 0.20 (20% implied), NO → 0.80 (80% implied)
```

**No-arbitrage duality:** for a binary market, `P(YES) + P(NO)` must ≈ 1. We verified this
empirically across all 600 markets:

- **100.0%** of markets have `YES + NO` within **1%** of 1.0 (Gamma `outcomePrices`).
- **97.25%** coherence when computed independently from **live CLOB book midpoints** (the
  small gap is quoting latency between the two token books, not true arbitrage).

See [04-QUANT-PROCESSING § dual-leg](./04-QUANT-PROCESSING.md) for the full distribution.

---

## 5. CLOB order book schema (`GET /book?token_id=`)

Verified live shape:

```json
{
  "market": "0x1fad…772be",         // conditionId
  "asset_id": "98022…996227",        // token_id (the YES/NO outcome)
  "timestamp": "1784731263515",      // ms epoch
  "hash": "f983043f…",               // book state hash
  "bids": [ { "price": "0.01", "size": "9574.32" }, … ],   // ascending price
  "asks": [ { "price": "…",    "size": "…" }, … ]          // descending price
}
```

- Prices and sizes are **strings** (decimal, avoid float ingestion errors).
- **Best bid** = max bid price; **best ask** = min ask price; **mid** = (best_bid+best_ask)/2.
- `size` is in **shares** (contracts). Notional = `price × size` USDC.
- Books are **deep**: median **93 levels** per token, up to **353** (see microstructure doc).

Companion endpoints (all keyed on `token_id`):
`GET /midpoint` → `{"mid":"0.505"}`, `GET /spread` → `{"spread":"0.01"}`,
`GET /price?side=buy|sell` → best executable price.

---

## 6. Price history schema (`GET /prices-history`)

```json
{ "history": [ { "t": 1784645406, "p": 0.505 }, { "t": 1784646017, "p": 0.505 }, … ] }
```

- `t` = unix seconds, `p` = price (probability) at that time.
- Params: `market` = **token_id** (not conditionId), `interval` (`1h`,`6h`,`1d`,`1w`,`1m`,`max`),
  `fidelity` = minutes between points. Our snapshot pulled `interval=1d, fidelity=10`.

---

## 7. Holders / open interest (`Data API /holders?market=conditionId`)

```json
[ { "token": "98022…996227",
    "holders": [ { "proxyWallet": "0x1615…8f2b", "pseudonym": "Finished-Wheel",
                   "name": "alihanyer", "amount": 5578.14655, "outcomeIndex": 0,
                   "displayUsernamePublic": true, "verified": false,
                   "profileImage": "https://…" }, … ] } ]
```

- Grouped by **token** (outcome side); `amount` is shares held; `outcomeIndex` maps to
  `outcomes[i]`. This is the "Top Holders" surface (Kichiko migration
  `026_top_holders_and_trader_profile.sql`).
- Open interest per market via `GET /oi`.

---

## 8. Canonical mapping to Kichiko schema

| Polymarket concept        | Gamma/CLOB field(s)                        | Kichiko today                     | Status |
|---------------------------|--------------------------------------------|--------------------------------------|--------|
| Event                     | `event.id`, `event.slug`, `title`          | discovery layer (no `events` table)  | grouping only |
| Market                    | `market.id`, `conditionId`, `question`     | `markets` (`id`, `slug`, `title`)    | ✅ core; ❌ no `condition_id` |
| Outcome                   | `outcomes[i]`, `clobTokenIds[i]`           | `market_options` (`label`, `price`)  | ✅ core; ❌ no `clob_token_id` |
| Implied price             | `outcomePrices[i]`, `lastTradePrice`       | `markets.yes_price/no_price`, `market_options.price`, `price_history` | ✅ |
| Order book                | `/book` bids/asks                          | `clob_orders` (resting) + `price_cents` | ✅ (see precision note) |
| Fills / trades            | Data `/trades`, CLOB fills                 | `clob_fills`                          | ✅ |
| Positions / holders       | Data `/holders`, `/positions`              | `positions` (+ top-holders view)     | ✅ |
| Tick / min size           | `orderPriceMinTickSize`, `orderMinSize`    | — (not stored on `markets`)          | ❌ gap |
| negRisk grouping          | `negRisk`, `negRiskRequestID`              | multi-outcome via `market_options` (`020_…`, `023_…`) | ⚠️ no neg-risk conversion |
| Resolution                | `umaResolutionStatuses`, `resolvedBy`      | `markets.status/resolved_outcome`, `audit_log` | ✅ centralized |

> The actual Kichiko schema was introspected live (Supabase, `information_schema`). Columns
> like `condition_id`, `clob_token_id`, `tick_size` **do not currently exist** — they are
> recommended additions tracked in
> [06-KICHIKO-GROUND-TRUTH-MAPPING](./06-KICHIKO-GROUND-TRUTH-MAPPING.md).

Full gap analysis in [06-KICHIKO-GROUND-TRUTH-MAPPING](./06-KICHIKO-GROUND-TRUTH-MAPPING.md).
