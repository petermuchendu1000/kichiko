# How Polymarket and Kalshi's trading engines work (2025–2026), and what Kichiko should take from them

**Research date:** 2026-09-26. Every source was fetched on that date unless the entry says otherwise.
**Citation rule:** every factual claim carries a reference tag such as `[P3]`, `[K7]` or `[X1]`. Section 11 maps each tag to a URL and gives the source's own date or version where it shows one. Anything I could not verify from a source I actually saw is marked **UNVERIFIED**.
**Legend:** P = Polymarket primary sources (docs, GitHub, audits). K = Kalshi primary sources (API docs, rulebook, fee schedule, help centre). X = press, research and third-party sources.

---

## 0. Executive summary: what changed in 2026

Much of the common knowledge about both venues is out of date. The biggest 2026 changes:

1. **Polymarket rewrote its exchange ("CLOB V2", live 2026-04-28).** It shipped new Exchange contracts, a rewritten CLOB backend and a new collateral token, **pUSD**, an ERC-20 backed by USDC that replaces USDC.e for trading. The signed order struct dropped `nonce`, `feeRateBps`, `taker` and `expiration`, and added `timestamp` (ms), `metadata` and `builder`. All resting orders were wiped at cutover. [P23][P24][P31][P32]
2. **Polymarket is no longer fee-free.** Taker fees follow `fee = C × feeRate × p × (1−p)`, with rates from 0.04 to 0.07 by category. Geopolitics is still free. Makers pay nothing and receive 15–25% of taker fees as rebates. A tiered taker-rebate programme started 2026-05-28. [P3][P15][P16][P23]
3. **Kalshi moved to fixed-point prices and fractional contracts.** Prices are up to 4 dp in dollars and quantities go down to 0.01 contracts. Each market has its own tapered tick grid (`price_ranges`). Kalshi added a documented fee-rounding accumulator, dropped the `market` order type (all orders are limit orders), and began **sharding** its matching engine by category (Aug–Sep 2026). [K4][K5][K11][K17]
4. **Kalshi's matching rule is published and binding.** Rule 5.9 of its CFTC rulebook specifies **price-time priority**. [K19] Polymarket's current docs never state a priority rule. Price-time priority at Polymarket is widely assumed, including in Kichiko's own docs, but it is **UNVERIFIED** from primary sources.
5. **Both venues had costly trust failures in 2025–26:**
   - a UMA whale "governance attack" on a US$7M Polymarket market [X2];
   - a Columbia study estimating that about 25% of Polymarket volume was wash trading [X1];
   - Kalshi's Khamenei "death carve-out" settlement, which led to lawsuits and a fee-refund policy [X8][X9];
   - Kalshi paying US$18.6M to the wrong side after settling a football game early [X7];
   - multi-hour Polymarket CLOB halts on 2026-08-31 with no published root cause [X4].
6. **East Africa is under-served.** Kalshi's international launch (2025-10-10) explicitly excludes Kenya [X10]. Polymarket restricts Ethiopia, Burundi, Somalia, South Sudan, Sudan, DR Congo and Zimbabwe to close-only (Kenya, Uganda, Tanzania and Rwanda are not on its list as fetched) [P25]. Polymarket also needs crypto rails. Neither venue offers mobile-money rails.

---

## 1. Polymarket: architecture

### 1.1 Hybrid model: off-chain matching, on-chain settlement
- **Off-chain matching:** an operator matches compatible orders.
- **On-chain settlement:** matched trades settle through smart contracts on Polygon, and users keep custody. [P4]
- The operator "can match orders and enforce their ordering, but cannot set prices or execute trades that users did not authorize." [P1: trading/overview]
- Orders are EIP-712 signed messages. The operator validates the signature, the balance, the allowances and the tick size before matching. [P5]
- Settlement is **atomic**: `matchOrders()` takes one taker order and an array of maker orders. The contract validates signatures, checks that prices cross, and derives the match type. [P5][P31]
- The legacy V1 docs describe the maker-to-taker relationship as "always either one to one or many to one," with "any price improvement … captured by the taking agent." [P30] The current docs confirm that price improvement goes to the taker. [P5]

### 1.2 CLOB V2 (2026)
- **Announced:** 2026-04-06, as "the platform's biggest infrastructure change since launch." [X11]
- **Went live:** 2026-04-28 at ~11:00 UTC, with about 1 hour of downtime. There is no V1 compatibility, and open orders were wiped. [P23]
- **Contracts:** CTF Exchange V2 is at `0xE111180000d2663C0091e4f400237545B87B996B`; Neg Risk CTF Exchange V2 is at `0xe2222d279d744050d28e00520010520000310F59`. Both were audited by Quantstamp and Cantina (March 2026). [P9][P31] V1 was audited by ChainSecurity on 2022-11-03. [P34]
- **New in V2** [P31]:
  - operator **order preapproval**;
  - **user self-pause** with a block delay (default 100 blocks);
  - `builder` and `metadata` fields on orders;
  - the wrapped collateral token (called PMCT in the repo; pUSD in the docs);
  - an admin-configurable **maximum fee rate** (default 500 bps).
- **Removed in V2:** `fillOrder(s)`, the on-chain nonce manager (orders are now tracked by hash with `{filled, remaining}`), and the token registry. [P31]
- **Gas:** V2 batches CTF split/merge calls across all makers in a match, for up to 51% gas savings on 20-maker MINT/MERGE matches. [P31]
- **Faster responses (2026-07-24):** an "async commit pipeline cuts matching latency". `POST /order` no longer returns `transactionHashes` on FAK/FOK matches, only `tradeIDs`. No latency figures were published. [P23]
- **Trade status lifecycle:** `MATCHED → MINED → CONFIRMED`, with `RETRYING` and `FAILED` as other states. A match is therefore reported before it is final on-chain. [P5]

### 1.3 Operations: restarts and restricted modes
- The engine restarts periodically, with about two days' notice when possible, announced on Telegram and Discord. [P2]
- During a restart, order endpoints return **HTTP 425** with `Retry-After`. [P2][P22]
- After a restart the engine runs **post-only for 2 minutes**: cancels work, and only post-only maker orders are accepted. [P2]
- Cancel-only and fully disabled modes both return HTTP 503. [P2]
- Primary servers are in AWS **eu-west-2**. KYC'd market makers can co-locate there. [P25]

---

## 2. Polymarket: matching rules and order handling

| Topic | What the sources say |
|---|---|
| **Priority rule** | **UNVERIFIED.** No current Polymarket page I fetched states price-time or pro-rata priority. The docs say only that the operator "can match orders and enforce their ordering". [P1] Price-time is the common assumption, but it is not documented. |
| **Order types** | GTC; GTD; FOK; FAK (Fill-and-Kill, i.e. IOC, added 2025-05-28); plus a post-only flag (added 2026-01-06) that rejects the order if it would cross. [P5][P11][P23] |
| **Market orders** | "All orders on Polymarket are technically limit orders." A market order is a FAK/FOK with a `maxPrice` (buy) or `minPrice` (sell) guard and `expiration = 0`. Buys can set `maxSpend` to include fees. [P4][P11] |
| **GTD** | Expires **one minute before** its stated time "as a security threshold", and must be at least **3 minutes** in the future. [P11] In V2, `expiration` is sent in the wire body but is **not** part of the signed struct. [P24] |
| **Amend** | Not supported: "Orders cannot be edited in place". You cancel and replace. [P13] |
| **Batching** | `POST /orders` takes 1–15 signed orders, and each entry succeeds or fails on its own. The limit rose from 5 to 15 on 2025-08-21. `DELETE /orders` takes at most 1,000 IDs (2026-06-15). [P11][P23] |
| **Tick sizes** | Allowed ticks: 0.1, 0.01, 0.005, 0.0025 (World Cup markets only, since 2026-07-02), 0.001 and 0.0001. The CLOB rejects any price off the current tick, and the tick can change at runtime (`tick_size_change` WebSocket event). [P11][P19][P17][P23] The often-quoted rule that "the tick changes to 0.001 when price >0.96 or <0.04" is **UNVERIFIED**: current docs describe the event but give no threshold. [P17] |
| **Precision rules** | A per-tick table fixes price, size and amount decimals (size is always 2 dp). Amounts are encoded as 6-decimal integers. [P11] |
| **Minimum size** | `min_order_size` is **a number of shares**, e.g. `"5"`, not dollars. [P11][P18] |
| **Balance reservation** | `maxOrderSize = balance − Σ(openOrderSize − filledAmount)`. [P5] |
| **Taker delays** | Selected crypto and finance up/down markets hold marketable orders briefly, then re-validate them. The order-lifecycle page says 250 ms [P5]. The changelog shows the crypto delay moved 250→50 ms (2026-08-17), then 50→**150 ms** (2026-09-04) [P23], so the docs disagree. Sports markets use a configurable `secondsDelay`. Orders in a delay window **cannot be cancelled**. [P5][P19] |
| **Order statuses** | `live`, `matched`, `delayed`, `unmatched` (placed on the book after the delay). Only the unfilled remainder can be cancelled. [P5] |
| **Heartbeat (dead-man switch)** | Call `POST /v1/heartbeats` every 5 s. If no valid heartbeat arrives within 10 s, **all open orders for those API credentials are cancelled**; the check runs every 5 s. [P12] |
| **Self-trade prevention** | **UNVERIFIED for prediction markets.** The prediction-CLOB docs I fetched do not document STP. Polymarket **Perps** documents mandatory STP (CancelMaker mode, with account groups). [P26] The taker-rebate terms say wash trading and self-matching can void rebates. [P16] |
| **Size limits** | "Polymarket's orderbook has **no trading size limits**." [P4] |
| **Rate limits (IP-based, Cloudflare)** | `POST /order`: 5,000 per 10 s burst and 120,000 per 10 min sustained. `POST /orders`: 2,000 per 10 s and 21,000 per 10 min. Over-limit requests are **throttled (queued), not rejected**. [P20] |
| **Rate limits (per signer, token bucket)** | New in warning mode from 2026-07-24; enforcement date not yet announced. Tiers by 30-day volume run from Standard (40 orders/s, burst 60) to Elite (600/s, burst 900). A batch is admitted all-or-nothing against the bucket. [P21] |

---

## 3. Polymarket: how YES and NO relate

### 3.1 Conditional Token Framework (CTF) primitives
- **Split:** $1 of pUSD becomes 1 YES + 1 NO. [P10]
- **Merge:** 1 YES + 1 NO becomes $1. [P10]
- **Redeem:** after resolution, each winning token pays $1. [P10]
- Every YES/NO pair is backed by exactly $1 of collateral held in the CTF contract. [P10]
- **Collateral in V2:** trading and settlement use pUSD, which is wrapped and unwrapped through the CollateralOnramp and CollateralOfframp contracts. The CTF still derives position IDs from a separate `ctfCollateral` (e.g. USDC.e), through adapters. [P7][P32]

### 3.2 Three match types (V2 `MatchType` enum)
From [P31][P32]:
- **COMPLEMENTARY:** a BUY matched with a SELL of the same token; a direct transfer. (The V1 docs called this scenario `NORMAL` [P30].)
- **MINT:** a BUY of YES matched with a BUY of NO; collateral is split into a new pair.
- **MERGE:** a SELL of YES matched with a SELL of NO; the pair is merged back into collateral.

In V2 the match type is derived arithmetically from the two sides, and price crossing is checked by cross-multiplication: `makerAmount_A × makerAmount_B ≥ takerAmount_A × takerAmount_B`. [P31]

### 3.3 One book for both outcomes
- The first price in a new market comes from a MINT: a YES bid at $0.60 and a NO bid at $0.40 sum to $1, so they match. [P4]
- Market-maker guidance: "Buying NO at 0.48 … is economically equivalent to selling YES at 0.52." [P13]
- **Displayed price** is the midpoint, **or the last trade price if the spread is wider than $0.10**. [P4]
- The REST `/book` response includes `tick_size`, `min_order_size`, `neg_risk` and a book `hash`. [P18]
- Whether the operator merges both token books into a single matching ladder internally is not documented. The observable behaviour (MINT and MERGE fills) is equivalent.

### 3.4 Negative-risk ("negRisk") multi-outcome events
- In an event where exactly one outcome can win, a NO share in any market can be **converted into 1 YES in every other market** through the Neg Risk Adapter. [P6]
- **General form:** holding NO on k outcomes converts to YES on the remaining outcomes plus (k−1) USDC. The adapter wraps collateral (`WrappedCollateral`) so it can release USDC during conversion. A Vault collects conversion fees in USDC and YES tokens when the fee rate is positive. [P33]
- **Augmented negRisk** supports named outcomes, **placeholder** outcomes that are clarified later on an on-chain bulletin board, and an explicit **Other**. Traders are told to trade only named outcomes. [P6]
- **Constraint:** negRisk markets **cannot resolve 50/50 (`[1,1]`)**; the adapter reverts. They also must not end in a tie, or with every outcome resolving NO. [P33]
- **How prices stay coherent:** nothing on-chain forces the YES prices to sum to 1. Coherence comes from **arbitrage enabled by `convert`**: a cheap NO basket can be converted into a YES basket. (This is inference from [P6][P33]; no doc states an explicit Σp = 1 constraint.)
- Contracts: the old CLOB v1 Neg Risk Adapter `0xd91E…5296` was retired for relayer calls on 2026-07-17. [P23]
- **Address discrepancy:** the docs list `NegRiskCtfCollateralAdapter` at `0xadA2005600Dec949baf300f4C6120000bDB6eAab` [P9][P23], but the ctf-exchange-v2 README lists `0xAdA200001000ef00D07553cEE7006808F895c6F1` [P31]. `CtfCollateralAdapter` differs the same way. Verify on-chain before relying on either.
- Security: the NegRiskAdapter was audited by ChainSecurity (2024-04-11). [P35]

---

## 4. Polymarket: fees, rebates and rewards

### 4.1 Taker fee (current)
- **Formula:** `fee = C × feeRate × p × (1 − p)`, where C is the number of shares and p the price. **Makers are never charged.** The fee is applied at match time and is not part of the order. [P3]
- **Rates by category (taker / maker rebate share):**

  | Category | Taker rate | Maker rebate |
  |---|---|---|
  | Crypto | 0.07 | 20% |
  | Sports | 0.05 | 15% |
  | Finance, Politics, Mentions, Tech | 0.04 | 25% |
  | Economics, Culture, Weather, Other | 0.05 | 25% |
  | Geopolitics | 0 | — |

  [P3]
- **Worked values:** at p = 0.50, 100 shares pay $1.75 (Crypto), $1.25 (Sports) or $1.00 (Politics). [P3]
- **Rounding:** fees round to 5 dp, with a minimum of 0.00001. Smaller fees round to **zero**, so "very small trades near the extremes may incur no fee at all." [P3]
- **Per-market configuration:** read `feeSchedule {rate, exponent, takerOnly, rebateRate}` from the market (source of truth since 2026-03-31). [P19][P23]

### 4.2 Fee history
- 2026-01-05: fees on 15-minute crypto markets. [P23]
- 2026-02-18: NCAAB and Serie A markets. [P23]
- 2026-03-06: all new crypto markets. [P23]
- 2026-03-30: **Fee Structure V2** covers almost every category. [P23]
- 2026-07-10: the sports rate rose 0.03→0.05 and the sports maker rebate fell 25%→15%. [P23]
- The press reported a 2026-03-30/31 rollout error in which fees were computed on USD value instead of shares, reversed within 24 h. [X12] (Press report only.)
- An independent estimate put the blended effective rate at **0.76% of taker volume** (as of 2026-03-25). [X13]
- **V1 formula, for contrast:** `usdcFee = baseRate × min(price, 1−price) × shares`, with the rate signed into each order. [P30] That design is gone in V2.

### 4.3 Maker rebates (funded by taker fees)
- Rebates are paid daily in pUSD, with a US$1 minimum payout. [P15]
- Allocation is "fee-curve weighted": `rebate = (your_fee_equivalent / total_fee_equivalent) × pool`, computed **per market**. Only maker liquidity that actually gets filled earns. [P15]

### 4.4 Taker rebates (tiers, since 2026-05-28)
- **Weighted volume:** `wV = trade size × (1 − entry price) × category weight × bonuses`. Weights: Sports 1.0; Politics, Finance, Mentions, Tech 1.3; Economics, Culture, Weather, Other 1.7; Crypto 2.3; Geopolitics 0. [P16]
- **Tiers** (30-day wV): Bronze from $2k earns 3%, rising to Obsidian from $10M at 50%, with level-up bonuses of $10 to $25,000. [P16]
- Omnibus-wallet integrations are excluded. [P16]

### 4.5 Liquidity rewards (resting quotes near the midpoint)
- **Per-order score:** a quadratic function of distance from the size-adjusted midpoint, `S(v,s) = ((v − s)/v)² · b`, where v is the market's max spread, s the order's spread and b an in-game multiplier. [P14]
- **Two-sidedness:** each maker gets two side scores, `Q_one` (bids on m plus asks on its complement m′) and `Q_two` (the mirror).
  - If the midpoint is in [0.10, 0.90], single-sided quotes still score, at a discount: `Q_min = max(min(Q_one, Q_two), max(Q_one/c, Q_two/c))` with c = 3.0.
  - Outside that band, quotes **must be two-sided**: `Q_min = min(Q_one, Q_two)`. [P14]
- **Sampling:** the book is sampled once per minute at a random offset (up to 1,440 samples per UTC day). Scores are normalised per sample and again per epoch. Minimum payout is US$1. [P14]
- **Special campaigns:** US$2M+ for March Madness, where orders had to rest at least **3.5 s** to qualify [P23], and US$1M for crypto TWAP markets in August 2026 (ended). [P14]

### 4.6 Holding rewards
- Polymarket pays **4.00% annualised** on position value in eligible markets, sampled randomly once an hour and paid daily. The rate is variable. [P10]

---

## 5. Polymarket: settlement and resolution

- **Oracle:** the UMA Optimistic Oracle. Each market defines its resolution source, end date and edge cases. [P8]
- **Flow** [P8]:
  1. A proposer posts a **US$750 pUSD** bond (typical).
  2. A **2-hour challenge window** follows.
  3. A dispute requires a matching counter-bond and starts a new proposal round.
  4. A second dispute escalates to the UMA **DVM**: 24–48 h of debate, then about 48 h of voting.
  5. The winner gets its bond back plus half the loser's.
- **Timing:** undisputed ≈ 2 h; disputed **4–6 days** in total. [P8]
- **Edge outcomes:** "Too Early" refunds the disputer. "Unknown/50-50" pays **$0.50** per token (not possible for negRisk; see §3.4). [P8]
- **Clarifications** ("Additional context") are published on-chain through the bulletin board and "cannot change the fundamental intent". [P8]
- **Who can propose (sources conflict):** the Polymarket docs still say "Anyone can propose" [P8]. UMA's **Managed Proposers (MOOV2)**, launched 2025-08-12, restricts proposals to whitelisted addresses (20+ proposals in 3 months at above 95% accuracy; 37 addresses at launch). Disputes remain permissionless. UMA reported 99.7% accuracy for whitelisted proposers versus 85.8% for others. [X3]
- **Redemption:** through the CTF collateral adapter, which burns the ERC-1155 tokens, receives USDC.e, wraps it to pUSD and returns pUSD. [P8] Data API v1 `REDEEM` activity is reported per outcome from 2026-08-10. [P23]
- **Crypto up/down markets:** resolve on Chainlink TWAPs (from 2026-08-07); 5-minute markets use a 60-s TWAP since 2026-08-14. [P23]
- **Position limits:** none documented ("no trading size limits"). [P4]

---

## 6. Polymarket: liquidity bootstrapping and AMM history

- **AMM to CLOB:** the CLOB settlement contract (CTF Exchange) was audited on 2022-11-03. [P34] A secondary source says the move from AMM to CLOB "occurred in late 2022" to fix liquidity problems. [X15] The exact date and Polymarket's own stated rationale are **UNVERIFIED** from primary sources.
- **No AMM today:** the current docs describe only the CLOB. First prices form through MINT matches. [P4]
- **Tools for liquidity:** liquidity rewards per market (§4.5), maker rebates (§4.3), holding rewards (§4.6), co-location (§1.3), and a market-making guide (inventory via split and merge, batching, kill switches). [P13]
- **Combos:** multi-leg markets use RFQ instead of the book. Quoters have at most **400 ms** to respond, the requester has 10 s to accept, and an optional last look allows 1 s. [P28]

## 7. Polymarket: data and API surface

- **REST hosts:** Gamma (discovery), CLOB (books, prices, orders), Data API (**v2 since 2026-09-04**; v1 frozen), Bridge. [P23]
  - Price history moved to `data-api …/v2/prices-history`. [P23]
  - Gamma keyset pagination (`/markets/keyset`, `/events/keyset`, max 100 per page) replaces offset paging. [P23]
- **Market WebSocket:** `wss://ws-subscriptions-clob.polymarket.com/ws/market`. [P17]
  - **Keepalive:** the client sends `PING` every 10 s.
  - **Events:** `book` (a full snapshot with a `hash`), `price_change` (per-level updates with a per-change `hash`, `best_bid` and `best_ask`), `last_trade_price`, `tick_size_change`. With `custom_feature_enabled`, it adds `best_bid_ask`, `new_market` and `market_resolved`.
  - **No sequence number** is documented on the CLOB market channel. Consistency is checked by book hash (REST: "Compare it with the previous response's hash"). [P17][P18]
  - A 2025-05-28 change removed the 100-token subscription limit and added `initial_dump`. [P23]
- **User WebSocket:** `…/ws/user` streams order events (PLACEMENT, UPDATE, CANCELLATION) and trade events (MATCHED, MINED, CONFIRMED, …). [P29]
- **PolyBolt socket** (2026-09-15, reference prices only): has a "dense per-channel `seq`" and a snapshot on every subscribe. [P23] This shows Polymarket itself adopting sequence numbers.
- **Research note:** from 30B book events, an academic study found public-feed trade direction agrees with on-chain records only about 59% of the time. [X14]

## 8. Polymarket US (the CFTC-regulated sister venue)

- A fiat DCM + DCO, separate from the international crypto product. [P37]
- Fees, effective 2026-09-25: taker **Θ = 0.0695**, maker **rebate −0.0125**, both × C × p(1−p). The rebate is paid at trade time. [P36]
- Taker-volume rebates of 10–50% apply above US$250k in the prior month. [P36]
- Whole contracts only (no fractional contracts). [P1: docs.polymarket.us index]

---

## 9. Kalshi

### 9.1 Architecture
- **Centralised:** Kalshi is a CFTC-designated contract market. Contracts clear through a designated DCO ("Clearing House"), and member funds are held under the clearing house's rulebook. [K19]
- **Access:** REST, WebSocket and FIX; AWS PrivateLink for Premier tier and above; VPC peering for Prime. [K16]
- **Sharding (2026):** trading is split across matching engines by category. [K11]
  - Shard 1: combos. Shard 2: crypto and commodities. Shard 3: tennis, baseball and basketball.
  - "Collateralization checks will continue to run within the matching engine", so traders must **pre-allocate collateral per shard**. Optional auto-rebalancing runs every 10 s.
  - Order groups do not work across shards, and auto-routing adds latency.
- **Maintenance:** a trading pause every **Thursday 03:00–05:00 ET**, during which cancels are allowed. In a rare full exchange pause, cancels are not allowed. A per-order `cancel_order_on_pause` flag is available. [K10]
- **Event timestamps:** order responses carry the matching engine's `ts_ms` (2026-05-05). [K17] REST reads can lag exchange events; `GET user data timestamp` exists for this reason. [K1]

### 9.2 Matching rules
- **Price-time priority (Rule 5.9):** Kalshi's algorithms match "according first by price and then time priority … at the same price … from oldest to most recent." [K19]
- A **queue position** API reports how many contracts are ahead of an order, "determined using a price-time priority". [K14]
- **Fills are "or better"** (Rule 5.10): the unfilled remainder rests at the limit price. [K19]
- **Order API v2** (`POST /portfolio/events/orders`, spec 3.31.0) [K6]:
  - `side: bid|ask`, always on the YES leg;
  - `price` as fixed-point dollars;
  - `count` as fixed-point contracts;
  - `time_in_force: fill_or_kill | good_till_canceled | immediate_or_cancel`, with `expiration_time` for good-till-time;
  - flags: `post_only`, `reduce_only` (IOC only), `cancel_order_on_pause`;
  - `self_trade_prevention_type` (**required**), `order_group_id`, `subaccount`, `exchange_index`.
- **Self-trade prevention** [K6][K17]:
  - `taker_at_cross` cancels the taker, stops execution and keeps any partial fills;
  - `maker` cancels the resting order and continues matching;
  - a FOK order that self-crosses behaves like IOC (since 2025-10-01).
- **No market orders:** the market type was deprecated in 2025-09 and removed from CreateOrder on 2026-02-11. Use an aggressive limit price instead. [K17]
- **Amend and decrease endpoints exist.** Polymarket has no amend. [K1][K6]
- **Order groups:** automatically cancel every order in a group if its fills exceed a limit within a rolling **15 s** window. [K12]
- **RFQ** [K13][K19]:
  - quotes are private;
  - after acceptance, the maker has 30 s to confirm (3 s on high-volatility markets);
  - execution follows after 15 s (1 s on HVMs);
  - the resulting orders take **lowest time priority** at their price.
- **Block trades:** for Eligible Contract Participants, above minimum sizes. [K19]
- **Erroneous trades** (Rule 5.11): a review request must arrive within **15 minutes**. Trades inside a ±**20¢** "No Cancellation Range" around fair value stand. [K19]
- **Rate limits:** token buckets with separate Read and Write budgets. [K7]
  - Most requests cost 10 tokens; a batch cancel costs 2 tokens per order.
  - Per-second budgets range from Basic (Read 200, Write 100 tokens/s) to Prestige (12,000 / 9,600), with 3-second burst capacity above Basic.
  - A 429 carries no `Retry-After`.
  - A changelog entry on 2026-09-24 announced +20% for Premier and above; the page may not yet show it. [K17]
- **Latency figures:** none published. The only numbers are implicit ones, such as token refill time: 10 tokens refill in ≈8.3 ms at 1,200 tokens/s. [K7]

### 9.3 Price grid, fractional contracts and rounding
- Each market publishes `price_ranges` bands of `{start, end, step}`. [K4]
  - Examples: `linear_cent` (1¢ everywhere); `tapered_deci_cent` (0.1¢ below 10¢ and above 90¢, 1¢ in between); `center_deci_edge_centi_cent` (0.01¢ at the extreme edges, used for combos).
  - A structure change fires `price_level_structure_updated`.
- **Fractional contracts:** granularity is 0.01 contracts. Subpenny pricing and fractional trading reached live markets in March 2026. [K4][K17]
- **Fee rounding** [K5]:
  - the model fee rounds **up** to $0.000001;
  - a separate **rounding fee** brings the balance back to the user's precision ($0.0001 for direct members, $0.01 for FCM customers);
  - a **per-order accumulator** refunds accumulated rounding overpayment, so the total converges to what one equivalent fill would cost.

### 9.4 How YES and NO relate
- The order book API returns **only bids**: `yes_dollars` and `no_dollars`. "A YES BID at price X is equivalent to a NO ASK at (1 − X)", so the **best YES ask = 1 − best NO bid**. [K2]
- **Direction fields:** `outcome_side` (yes/no) and `book_side` (bid/ask), with `bid ≡ yes` and `ask ≡ no`. Buying YES and selling NO produce the same exposure. [K3]
- **WebSocket pricing:** orderbook deltas quote the NO side in NO-leg prices by default. `use_yes_price: true` gives one yes-leg price scale; that will become the default later. [K3]
- **Mutually exclusive events and collateral return:** buying NO on several candidates in a mutually exclusive group returns collateral immediately. Example: $1.30 of NOs, where at least $1 is guaranteed to pay out, requires only $0.30. The setting locks at your first order in the event, and positions whose collateral was returned may not be sellable. [K23]
- **Netting:** only net positions settle, and netting can be set per subaccount. [K9][K1]

### 9.5 Fees and interest
- **Fee schedule** (effective 2026-07-07) [K18]:
  - taker: `fees = round up(M × 0.07 × C × P × (1−P))`, default M = 1;
  - maker: `round up(M × 0.0175 × C × P × (1−P))`, with **M defaulting to 0** "unless otherwise indicated";
  - the schedule's non-standard table lists series where both multipliers are 1 (maker fees apply, e.g. KXCPI, KXEGGS) or both are 0 (fee-free, e.g. KXBTCY, KXDOED);
  - fees round up "such that the fee + positionCost is rounded to a centicent";
  - **no settlement fee**;
  - ACH is free; debit cards cost up to 2%.
- **Maker-fee exemption:** independent NFL-only combo markets created after 2026-08-19 have no maker fee. [K17]
- **Interest ("APY")** [K20]:
  - **3.25%**, variable, on available cash **and** end-of-day portfolio value;
  - requires at least **US$250** in the account;
  - accrues daily and is paid monthly;
  - **US users only** (article updated 2026-03-17).
  - The rulebook allows the clearing house ("Klear") to pay interest. [K19]

### 9.6 Settlement and resolution
- **Market states:** `initialized → active ⇄ inactive → closed → determined → (disputed → amended) → finalized`. [K8]
  - A `settlement_timer_seconds` window after determination is when disputes can be raised.
  - Reactivating a paused market cancels **all resting orders**.
  - After `close_time`, even cancels are rejected (`MARKET_INACTIVE`).
- **Rule 6.3(c):** if the outcome cannot be determined, Kalshi may settle at the **last traded price**. Otherwise an Outcome Review Committee decides, and its decision is **final**. [K19]
- **Rule 7.1:** the Outcome Review Committee rules within **24 h** of a review starting. [K19]
- **Rule 7.2:** Kalshi may change the source agency or expiration. [K19]
- **Payout:** $1 per winning contract. Payouts round to whole cents, and sub-cent scalar settlement may carry a fee. [K9]
- **Collateral:** USD, fully collateralised. The platform checks that the member can cover the maximum loss before executing (Rule 5.3(c)). [K19]
- **Position limits and accountability levels** are set in each contract's terms (Rules 5.18–5.19). Market makers get **10×** accountability levels and are exempt from position limits on contracts where they have quoting obligations (Rule 4.5). [K19]

### 9.7 Market making and liquidity
- **Designated market makers** (Rulebook ch. 4): Kalshi picks them at its discretion. Obligations include "maintaining two-sided markets within a defined spread and with a minimum depth". Benefits may include reduced fees and higher limits. [K19]
- **Liquidity Provider Program:** market makers bid in periodic **auctions** to become the designated LP for an incentivised series. [K22]
- **Liquidity Incentive Program** (retail, US) [K21]:
  - the book is snapshotted **once per second at a random moment**;
  - a Reference Price is found by walking down from the best bid to where cumulative size reaches 1/5 of a Target Size;
  - orders at or better than that price get full credit; worse orders are multiplied by a discount factor raised to the number of ticks away;
  - score = size × multiplier, normalised across makers;
  - US$1–1,000 per market per day, with a US$1 minimum payout.
- **Incentives API** filters by type: `liquidity`, `volume`, `margin_maker_volume`, `margin_taker_volume`. [K24]
- **AMM:** none; Kalshi is a CLOB (Rule 5.9). [K19]

### 9.8 Data and API surface
- **REST base:** `https://external-api.kalshi.com/trade-api/v2`. [K16]
- **WebSocket:** `wss://external-api-ws.kalshi.com/trade-api/ws/v2`. The server sends Ping frames every 10 s. [K15][K16]
- **Channels:** `orderbook_delta` (an `orderbook_snapshot` first, then deltas with `sid` and a sequential `seq` for gap detection; on-demand `get_snapshot`), `ticker`, `trade`, `fill`, `market_positions`, `market_lifecycle_v2`, `multivariate_market_lifecycle`, `communications` (RFQ), `order_group_updates`, `user_orders`. [K15]
- **Public order book:** no authentication needed. FIX is also available. Historical data endpoints exist. [K1][K2]

---

## 10. Weaknesses, incidents and criticism (Kichiko's openings)

| # | Venue | What happened | Source | Opening for Kichiko |
|---|---|---|---|---|
| 1 | Polymarket | "Ukraine agrees to Trump mineral deal before April?" (US$7M) resolved YES without a deal after an alleged UMA whale vote (2025-03-24/25). Polymarket called it "unprecedented" and refused refunds. | [X2] | Accountable resolution: named resolvers, a written rationale, an appeal path, and no token-weighted vote. |
| 2 | Polymarket / UMA | Proposals restricted to whitelisted proposers (2025-08-12) after non-whitelisted proposers were only 85.8% accurate. Polymarket's docs still say "anyone can propose". | [X3][P8] | Publish exactly who resolves, and track resolver accuracy publicly. |
| 3 | Polymarket | Columbia study: about 25% of historical volume flagged as wash trading, peaking near 60% of weekly volume in December 2024. One cluster of 43,000+ wallets traded mostly under 1¢, apparently farming airdrops. | [X1] | Mandatory self-trade prevention, KYC-linked accounts, and rewards that cannot be farmed with sub-cent churn. |
| 4 | Polymarket | CLOB halts on 2026-08-31: 32 min, then **4 h 24 min**, caused by "delayed open order read responses". No root cause published. | [X4] | A public status page and post-mortems; cancel-only degraded modes. |
| 5 | Polymarket | V2 cutover wiped all resting orders and broke V1 SDKs (2026-04-28). | [P23] | Migrate without wiping orders; keep versioned APIs. |
| 6 | Polymarket | Fee rollout error reported and reversed within 24 h (2026-03-30/31). | [X12] | Publish fee maths and test vectors before launch. |
| 7 | Polymarket | Taker delays (50/150/250 ms; sports seconds) during which orders cannot be cancelled; docs disagree on the value. | [P5][P23] | Keep delay policy explicit, per market and consistent. |
| 8 | Polymarket | Geo-restrictions include ET, BI, SO, SS, SD, CD and ZW (close-only), plus GB, FR, US and others. Primary servers are in London. | [P25] | Serve restricted East African neighbours where legally possible; host near users. |
| 9 | Kalshi | Khamenei market (US$50M+ lifetime) settled at the last traded price under a "death carve-out" that was not clear on the trading page. Fees were refunded, lawsuits followed. | [X8][X9] | Show special settlement rules on the order ticket itself, not only in filings. |
| 10 | Kalshi | Settled a college-football market **early** and paid US$18.6M to the wrong side, then clawed it back (2026-09-06). | [X7] | Settle only on a confirmed final result, with a hold window before payout. |
| 11 | Kalshi | Outage during the papal conclave (2025-05-08); trading halt on 2026-04-15, cause not stated. | [X6][X5] | Capacity planning for event spikes; honest status updates. |
| 12 | Kalshi | Wide discretion in settlement: Rule 6.3(c) lets Kalshi use the last traded price, and Outcome Review Committee decisions are final. A fee-refund policy for disputed settlements (2026-06-02) covers **self-clearing retail only**. | [K19][X9] | Narrower discretion, published precedents, refunds for everyone. |
| 13 | Kalshi | **Kenya explicitly excluded** from international service (2025-10-10). | [X10] | Kenya is open ground. |
| 14 | Kalshi | Weekly Thursday 03:00–05:00 ET trading pause; sharding forces collateral pre-allocation per shard. | [K10][K11] | One wallet across all markets (a single Postgres ledger); maintenance with little or no downtime. |
| 15 | Kalshi | Interest (3.25%) is US-only and needs at least US$250. | [K20] | Consider a small-balance-friendly incentive, if regulation allows. |
| 16 | Both | Kalshi's REST lags exchange events [K1]; Polymarket's market feed has no `seq`, only hashes [P17]. | [K1][P17] | Sequence-numbered deltas and read-your-writes responses. |

**Thin books on long-tail markets:** a 2026 academic study of Polymarket found a "longshot spread premium", meaning wider relative spreads on low-probability outcomes. [X14] Kichiko's own snapshot (`docs/research/polymarket/03`) measured relative spreads blowing out for longshots. That snapshot is internal data, not re-verified here.

---

## 11. Side-by-side comparison

| Dimension | Polymarket (intl.) | Kalshi | Kichiko takeaway |
|---|---|---|---|
| Custody / settlement | Non-custodial; atomic on-chain settlement on Polygon; pUSD collateral [P4][P7] | Custodial USD through a DCO clearing house [K19] | Custodial KES/USD ledger in Postgres; publish balance commitments (cf. Polymarket Perps state roots [P27]) |
| Matching priority | **UNVERIFIED** (not documented) | Price-time, in rulebook Rule 5.9 [K19] | Price-time, documented and tested |
| One book for YES/NO | MINT / MERGE / COMPLEMENTARY [P31] | Bids only; YES ask = 1 − NO bid [K2] | Already implemented (direct, mint, burn) |
| Order types | GTC, GTD, FOK, FAK, post-only; no amend [P5][P13] | GTC (+expiry), FOK, IOC, post-only, reduce-only, cancel-on-pause, amend/decrease [K6] | Kalshi's set, plus amend |
| Market orders | FAK/FOK with max/min price [P11] | None; aggressive limit orders [K17] | Always carry a slippage limit |
| Self-trade prevention | UNVERIFIED (Perps: CancelMaker) [P26] | Required field: taker_at_cross or maker [K6] | Required; default cancel-maker |
| Tick | Per market: 0.1 down to 0.0001; changes at runtime [P19] | Per market `price_ranges`, tapered at the edges [K4] | Tapered grid (finer below 10¢ and above 90¢) |
| Minimum size | e.g. 5 **shares** [P11] | 0.01 contracts (fractional markets) [K4] | Small minimum in shares; fractional to 0.01 |
| Taker fee | `rate × C × p(1−p)`, rate 0.04–0.07, geopolitics 0 [P3] | `0.07 × C × P(1−P)`, rounded up [K18] | Same curve; lower coefficient to win |
| Maker fee / rebate | 0 fee; 15–25% of taker fees as rebate [P3] | 0.0175 × multiplier, default 0 [K18] | 0 maker fee plus rebate |
| Quoting rewards | Quadratic spread score, 1/min random sampling [P14] | 1/s random snapshot, discount per tick [K21] | Kalshi-style 1 s sampling with Polymarket-style two-sided requirement |
| Interest | 4% holding reward on eligible positions [P10] | 3.25% on cash + positions, US only, ≥$250 [K20] | Optional |
| Resolution | UMA optimistic oracle; 2 h; disputed 4–6 days [P8] | Exchange-determined; settlement timer; Outcome Review Committee within 24 h [K8][K19] | Internal resolver, dispute window, published rationale |
| Multi-outcome | negRisk convert (NO → YES of others + USDC) [P33] | Collateral return for mutually exclusive groups [K23] | Collateral return (ledger-only) plus an optional convert |
| Real-time data | Snapshot + delta with book hash; no seq [P17] | Snapshot + delta with `seq` [K15] | Per-book `seq` from a Postgres sequence |
| Dead-man switch | Heartbeat: 10 s → cancel all [P12] | Order groups (15 s rolling); cancel-on-pause [K12][K10] | Both |
| Downtime pattern | Announced restarts, then 2 min post-only [P2] | Weekly 2 h pause [K10] | Post-only reopen window |
| Rate limits | Cloudflare IP limits + per-signer buckets [P20][P21] | Token buckets, Read/Write, volume tiers [K7] | Token bucket per user in Redis or Postgres |

---

## 12. Recommendations for Kichiko (M-Pesa users, small tickets, Postgres engine)

### 12.1 Strengths to borrow
1. **Documented price-time priority with a queue-position endpoint**, as in Kalshi Rule 5.9 and the queue-position API. [K19][K14] In Postgres, order the book by `(price DESC, seq ASC)` using a per-market `bigserial` sequence, not `created_at`, since timestamps can collide.
2. **Complementary matching on one ladder** (COMPLEMENTARY, MINT, MERGE) [P31]. Kichiko already has direct, mint and burn (`CLOB-TWO-SIDED-ENGINE.md`). Keep the conservation invariants.
3. **The p(1−p) fee curve with a per-market coefficient**, applied at match time rather than signed into orders. [P3][P24][K18] This avoids overcharging near-certain bets. Small bets on longshots are the typical M-Pesa ticket.
4. **Kalshi's fee-rounding accumulator** [K5]. M-Pesa settles in whole shillings, and fractional prices and sizes create sub-shilling remainders. Round against the user within a fill, then refund accumulated overpayment across an order's fills. This beats Polymarket's rule of rounding tiny fees to zero [P3], which can be farmed.
5. **A tapered tick grid** (`price_ranges`) [K4]: coarse ticks in the middle, fine ticks near 0 and 1. Nearly half of Polymarket's markets sit at longshot prices (internal snapshot), and a small KES bet needs a fine grid there.
6. **Mandatory self-trade prevention** with Kalshi-style modes [K6], plus account groups (Polymarket Perps [P26]). Exclude self-matches from every volume-based reward. [X1][P16]
7. **Safety controls:**
   - heartbeat cancel-all [P12];
   - order groups with a rolling fill limit [K12];
   - `cancel_order_on_pause` [K10];
   - `reduce_only` [K6];
   - post-only reopen after maintenance [P2].
8. **Collateral return for mutually exclusive events** [K23]. In a Postgres ledger this is only a reservation calculation, with no token wrapping. A convert operation (NO on k outcomes → YES on the rest + (k−1) cash) [P33] can come later.
9. **Snapshot + delta feeds with a monotonic `seq`**, as Kalshi does [K15] and Polymarket's new PolyBolt does [P23]. Emit from a `LISTEN/NOTIFY` or outbox table inside the matching transaction.
10. **Quoting rewards with random sampling** [P14][K21]: sample once per second at a random moment, require two-sided quotes near the extremes, and set a minimum resting time (e.g. 3.5 s [P23]) to stop quote flashing.
11. **Explicit lifecycle states and a settlement timer**: `closed → determined → disputed → amended → finalized` [K8]. Keep a dispute window before any payout to M-Pesa, because mobile-money payouts are hard to claw back.

### 12.2 Weaknesses to exploit
1. **Kenya is excluded by Kalshi** [X10]. **Polymarket requires crypto rails** and restricts several East African neighbours [P25]. Offer M-Pesa deposits and withdrawals: transfers **under KES 100 are free**, and M-Pesa caps are KES 250,000 per transaction and KES 500,000 per day (Safaricom page, updated 2026-08-04) [X16]. That makes micro-tickets viable.
2. **Resolution trust** [X2][X3][X7][X8][X9]:
   - no token-holder votes;
   - named resolvers and published rationales;
   - edge-case rules shown on the order ticket (no hidden "death carve-outs");
   - never settle before a confirmed final result;
   - automatic fee refunds on any reversed settlement, for all users.
3. **Wash trading** [X1]: KYC through the M-Pesa phone number combined with self-trade prevention makes Sybil farming expensive. Base rewards on filled maker liquidity and risk-weighted taker volume, never on raw volume.
4. **Operational transparency** [X4][X5][X6]: a public status page, sequence-numbered feeds, cancel-only degraded mode, and post-mortems.
5. **No wiped orders on upgrades** [P23], and no per-shard collateral juggling [K11]: one wallet across all markets.
6. **Fee clarity**: publish the formula, the coefficients and worked KES examples. Polymarket's fee maths was reportedly broken for a day at launch [X12].

### 12.3 Postgres-specific notes (design inference, not sourced facts)
- **Serialise matching per market.** Use `pg_advisory_xact_lock(market_id)` or a single-writer worker per book. This keeps price-time priority deterministic and avoids serialisation retries under load, which Kichiko's docs currently plan to handle with `SELECT … FOR UPDATE` plus retries (`CLOB-ARCHITECTURE.md`).
- **Integer arithmetic.** Store amounts as integer minor units (e.g. KES × 100, or 6 dp as Polymarket does [P11]). Store prices as integers on a tick grid (e.g. 1/10,000 of a unit).
- **Treat throughput as capacity, not a feature.** Polymarket and Kalshi both publish burst rates of hundreds of orders per second per client [P21][K7]. A Postgres engine should publish its own per-user limits and measure p99 match latency before advertising anything.

---

## 13. Corrections to Kichiko's local docs

Files reviewed: `docs/research/polymarket/*.md`, `docs/design/POLYMARKET-KALSHI-PARITY.md`, `docs/design/KALSHI-ORDER-TICKET.md`. None were modified.

| File | Claim in the doc | Finding | Source |
|---|---|---|---|
| research/polymarket/00 §3 | EIP-712 `Order` has `taker`, `expiration`, `nonce` and `feeRateBps`; the V1 type hash string | **Outdated since 2026-04-28 (CLOB V2).** V2 struct: `salt, maker, signer, tokenId, makerAmount, takerAmount, side, signatureType, timestamp, metadata, builder`. `expiration` travels only in the wire body. Exchange domain version is "2". | [P24][P32] |
| 00 §3.1, §3.3; 01 §3.2; 03 §4; 06 §3–5 | Minimum order ≈ **$5** / `orderMinSize` "$5"; migration proposes `min_order_size DEFAULT 5` in USD | `min_order_size` counts **shares**, e.g. "5". | [P11][P18] |
| 00 §1, §1.1; 01 §4; 02 §5 | Collateral is USDC.e; notional in USDC; "USDC (referred to as pUSD in resolution docs)" | Trading collateral is **pUSD**, a separate ERC-20 wrapper backed by USDC, since 2026-04-28. USDC.e remains only the CTF position-ID collateral through adapters. | [P7][P23][P32] |
| 00 §1 diagram; 01 §3.1 | "off-chain CLOB operator (… price/time priority)" | **UNVERIFIED:** current Polymarket docs do not state a priority rule. | [P1][P5] |
| 00 §4 | "the on-order `feeRateBps` bounds it"; query `fd = {r, e, to}` | V2 removed `feeRateBps` from orders; the operator sets fees at match time; the contract enforces an admin max fee rate (default 500 bps). The source of truth is `feeSchedule {rate, exponent, takerOnly, rebateRate}` (since 2026-03-31). | [P24][P31][P19][P23] |
| 00 §5.3 | Heartbeat: rolling `heartbeat_id`; "expired ID returns 400 with the correct ID" | Incomplete: its purpose is cancel-all after 10 s without a valid heartbeat (send every 5 s; checked every 5 s). The "400 with correct ID" behaviour is **UNVERIFIED** in the current docs. | [P12] |
| 01 §3.1 | CTF Exchange "audited by ChainSecurity" | That was V1 (2022-11-03). The live V2 was audited by **Quantstamp and Cantina (March 2026)**. | [P9][P31][P34] |
| 01 §3.1 | Taker delay "~250 ms" | The crypto taker delay has been **150 ms** since 2026-09-04 (it was 50 ms from 2026-08-17). The order-lifecycle page still says 250 ms. | [P23][P5] |
| 01 §3.2; 03 §4 | Tick ∈ {0.001, 0.01} | Snapshot-limited. Supported ticks are 0.1, 0.01, 0.005, 0.0025, 0.001 and 0.0001, and a tick can change at runtime. | [P19][P17] |
| 01 §3.3 | "Polymarket pays **maker rebates** for resting liquidity within `max_spread` … at ≥ `min_size`" | Conflates two programmes. That describes **Liquidity Rewards** (quadratic score on resting quotes). **Maker Rebates** are paid on *filled* maker volume from taker fees. | [P14][P15] |
| 01 §2.1 | CLOB `GET /prices-history`; Data API `/positions` etc. | Price history moved to `data-api …/v2/prices-history`; Data API v1 is frozen (2026-09-04). Offset `GET /markets` and `/events` are being replaced by keyset endpoints. | [P23] |
| 00 §3.2 | MatchType table | Correct for V2 (`COMPLEMENTARY`, `MINT`, `MERGE`). The V1 docs named the first scenario `NORMAL`. | [P30][P32] |
| 00 §1.1 | `NegRiskCtfCollateralAdapter 0xadA2005600…` | Matches the docs, but the ctf-exchange-v2 README lists `0xAdA200001000ef00D07553cEE7006808F895c6F1`. Unresolved discrepancy; verify on-chain. | [P9][P31] |
| 04 §3; 05 §3 | "the Neg Risk Adapter enforces the economic version [Σp = 1] on-chain" | Overstated. The adapter provides `convert` (NO on k outcomes → YES on the others + (k−1) USDC), which **makes arbitrage possible**. It does not constrain prices. NegRisk markets also cannot resolve 50/50. | [P6][P33] |
| 05 §2.1 | Two disputes ≈ "48–96 hours" | Polymarket docs: disputed resolution takes **4–6 days** in total (24–48 h debate + ~48 h vote). | [P8] |
| 05 §2.2 | Proposer is anyone posting a bond | Since 2025-08-12, UMA MOOV2 limits Polymarket proposals to **whitelisted** proposers; disputes remain open to anyone. (Polymarket's docs still say "anyone".) | [X3][P8] |
| 05 §4 | Fee config `makerBaseFee`, `takerBaseFee`, `feeType` | Legacy Gamma fields. Compute fees from `feeSchedule`. | [P23][P19] |
| 04 §1 | "`midpoint` — best default … fair-value probability" | As a UI parity note: Polymarket **displays** the midpoint unless the spread is > $0.10, in which case it shows the last trade price. | [P4] |
| POLYMARKET-KALSHI-PARITY §1 table | "Probabilities: Per-candidate, **independent** (Σ ≠ 100%)" for **both** venues | True only for **non-exclusive** events, such as the IPO reference market. For mutually exclusive events, Polymarket uses **negRisk** (convert links the NO and YES legs) and Kalshi uses **collateral return**. Both push YES prices toward Σ ≈ 100% by arbitrage. | [P6][P33][K23] |
| POLYMARKET-KALSHI-PARITY §1 table | "Liquidity: CLOB per market" (implying no linkage) | Both venues link capital across mutually exclusive markets (negRisk convert; collateral return). | [P6][K23] |
| KALSHI-ORDER-TICKET §1 "Order types (Help Center)" | "Market — immediate fill against the book"; expiry options **GTC, EOD, IOC**, custom time | In the API, the `market` type was **removed** (2025-09 deprecation; 2026-02-11 removal) and all orders are limit orders. API time-in-force values are `fill_or_kill`, `good_till_canceled` (+ `expiration_time`) and `immediate_or_cancel`; there is **no EOD** value. The UI may still show "Market" as an aggressive limit; **UNVERIFIED** for the current UI. | [K6][K17] |
| KALSHI-ORDER-TICKET §3 | "3.25% Interest on balance" | Confirmed at 3.25%, but it also applies to **portfolio value**, requires at least **US$250**, and is **US-only** (help article updated 2026-03-17). | [K20] |
| KALSHI-ORDER-TICKET §1 row 1 | "SELL closes/reduces an existing position" | In the API, "sell YES" is `book_side=ask` ≡ `outcome_side=no`, economically the same as buying NO; `reduce_only` enforces closing. UI semantics not re-verified. | [K3][K6] |
| *(Not in the requested files, but noticed)* design/CLOB-TWO-SIDED-ENGINE.md "Fees" | "Polymarket charges 0 taker/maker on the CLOB" | **Outdated:** taker fees have applied since 2026-01-05 (crypto) and across nearly all categories since 2026-03-30. | [P3][P23] |

---

## 14. Items that remain UNVERIFIED

- Polymarket's matching priority rule (price-time vs anything else).
- Polymarket self-trade prevention on the prediction-market CLOB.
- The "tick changes at 0.96/0.04" rule.
- Any published order or cancel latency for either venue, beyond Polymarket's taker-delay values and an academic finding of sub-50 ms median ingestion delay for Polymarket feeds [X14].
- The exact date and official rationale of Polymarket's move from AMM to CLOB (secondary sources say late 2022 [X15]).
- Which neg-risk adapter address is canonical (docs vs GitHub).
- Kalshi UI order-type labels ("Market", "EOD").
- Whether Kalshi's rate-limit page already shows the +20% change announced 2026-09-24.
- The size of the Ukraine-market whale's UMA holdings (one headline in search results said 5M; not verified from a primary source).

---

## 15. References

**Polymarket primary** (docs.polymarket.com unless noted; all fetched 2026-09-26)
- [P1] Docs index and trading overview: https://docs.polymarket.com/llms.txt ; https://docs.polymarket.com/trading/overview.md ; Polymarket US index: https://docs.polymarket.us/llms.txt
- [P2] Matching Engine Restarts: https://docs.polymarket.com/trading/matching-engine.md
- [P3] Fees: https://docs.polymarket.com/trading/fees.md
- [P4] Prices & Orderbook: https://docs.polymarket.com/concepts/prices-orderbook.md
- [P5] Order Lifecycle: https://docs.polymarket.com/concepts/order-lifecycle.md
- [P6] Negative Risk Markets: https://docs.polymarket.com/concepts/negative-risk.md
- [P7] Polymarket USD (pUSD): https://docs.polymarket.com/concepts/pusd.md
- [P8] Resolution: https://docs.polymarket.com/concepts/resolution.md
- [P9] Contracts: https://docs.polymarket.com/resources/contracts.md
- [P10] Positions & Tokens (holding rewards 4%): https://docs.polymarket.com/concepts/positions-tokens.md
- [P11] Place Orders: https://docs.polymarket.com/trading/place-orders.md
- [P12] Manage Orders (Order Heartbeats): https://docs.polymarket.com/trading/manage-orders.md
- [P13] Market Making: https://docs.polymarket.com/trading/market-making.md
- [P14] Liquidity Rewards: https://docs.polymarket.com/programs/liquidity-rewards.md
- [P15] Maker Rebates Program: https://docs.polymarket.com/programs/maker-rebates.md
- [P16] Taker Rebate Program (live 2026-05-28): https://docs.polymarket.com/programs/taker-rebates.md
- [P17] Real-time data (market WebSocket): https://docs.polymarket.com/market-data/realtime-data.md ; https://docs.polymarket.com/market-data/websocket/market-channel
- [P18] Prices & Order Books: https://docs.polymarket.com/market-data/prices-order-books.md
- [P19] Market Details (tick sizes, feeSchedule, rewards, secondsDelay): https://docs.polymarket.com/market-data/market-details.md
- [P20] Rate Limits (Cloudflare): https://docs.polymarket.com/api-reference/rate-limits.md
- [P21] CLOB Trading Rate Limits (per signer): https://docs.polymarket.com/api-reference/trading-rate-limits.md
- [P22] Error Codes: https://docs.polymarket.com/resources/error-codes.md
- [P23] Predictions Changelog (entries 2025-05-15 to 2026-09-15): https://docs.polymarket.com/changelog/predictions.md
- [P24] Migrating to CLOB V2: https://docs.polymarket.com/v2-migration.md
- [P25] Geographic Restrictions: https://docs.polymarket.com/api-reference/geoblock.md
- [P26] Perps Self-Trade Prevention: https://docs.polymarket.com/perps/learn-about-trading/self-trade-prevention.md
- [P27] Perps Architecture (state root commitments): https://docs.polymarket.com/perps/learn-about-trading/architecture.md
- [P28] How Combos Work (RFQ): https://docs.polymarket.com/trading/combos/overview.md
- [P29] Real-Time Order Updates (user WebSocket): https://docs.polymarket.com/trading/realtime-order-updates.md
- [P30] ctf-exchange (V1, archived) README and docs/Overview.md: https://raw.githubusercontent.com/Polymarket/ctf-exchange/main/README.md ; https://raw.githubusercontent.com/Polymarket/ctf-exchange/main/docs/Overview.md
- [P31] ctf-exchange-v2 README: https://raw.githubusercontent.com/Polymarket/ctf-exchange-v2/main/README.md (repo: https://github.com/Polymarket/ctf-exchange-v2)
- [P32] ctf-exchange-v2 Structs.sol: https://raw.githubusercontent.com/Polymarket/ctf-exchange-v2/main/src/exchange/libraries/Structs.sol
- [P33] neg-risk-ctf-adapter README: https://raw.githubusercontent.com/Polymarket/neg-risk-ctf-adapter/main/README.md
- [P34] ChainSecurity, Code Assessment of the Exchange Smart Contracts, 03 Nov 2022 (seen in search results): https://reports.chainsecurity.com/Polymarket/ChainSecurity_Polymarket_Exchange_Audit.pdf
- [P35] ChainSecurity, Code Assessment of the NegRiskAdapter, 11 Apr 2024 (seen in search results): https://reports.chainsecurity.com/Polymarket/ChainSecurity_Polymarket_NegRiskAdapter_Audit.pdf
- [P36] Polymarket US Fee Schedule (effective 2026-09-25): https://docs.polymarket.us/fees.md
- [P37] What is Polymarket US?: https://docs.polymarket.us/getting-started/what-is-polymarket-us.md

**Kalshi primary** (fetched 2026-09-26)
- [K1] Kalshi API docs index: https://docs.kalshi.com/llms.txt
- [K2] Orderbook Responses: https://docs.kalshi.com/getting_started/orderbook_responses.md
- [K3] Order direction (outcome_side / book_side): https://docs.kalshi.com/getting_started/order_direction.md
- [K4] Fixed-Point Representation (last updated 2026-08-20): https://docs.kalshi.com/getting_started/fixed_point_migration.md
- [K5] Fee Rounding: https://docs.kalshi.com/getting_started/fee_rounding.md
- [K6] Create Order (V2), OpenAPI v3.31.0: https://docs.kalshi.com/api-reference/orders/create-order-v2.md
- [K7] Rate Limits and Tiers: https://docs.kalshi.com/getting_started/rate_limits.md
- [K8] Market Lifecycle: https://docs.kalshi.com/getting_started/market_lifecycle.md
- [K9] Market Settlement: https://docs.kalshi.com/getting_started/market_settlement.md
- [K10] Maintenance and Pauses: https://docs.kalshi.com/getting_started/maintenance_and_pauses.md
- [K11] Exchange Sharding: https://docs.kalshi.com/getting_started/exchange_sharding.md
- [K12] Order Groups: https://docs.kalshi.com/getting_started/order_groups.md
- [K13] Request for Quote: https://docs.kalshi.com/getting_started/rfqs.md
- [K14] Get Order Queue Position ("price-time priority"): https://docs.kalshi.com/api-reference/orders/get-order-queue-position.md
- [K15] WebSockets (orderbook updates, connection, keep-alive): https://docs.kalshi.com/websockets/orderbook-updates.md ; https://docs.kalshi.com/websockets/websocket-connection.md ; https://docs.kalshi.com/websockets/connection-keep-alive.md
- [K16] API Environments and Endpoints: https://docs.kalshi.com/getting_started/api_environments.md
- [K17] API Changelog (entries 2025-04-15 to 2026-10-01): https://docs.kalshi.com/changelog/index.md
- [K18] Kalshi Fee Schedule PDF, "Last updated and effective: July 7, 2026" (read via WebFetch): https://kalshi.com/docs/kalshi-fee-schedule.pdf ; upcoming changes: https://kalshi.com/fee-schedule
- [K19] KalshiEX LLC Rulebook v1.29 (PDF created 2026-08-11), Rules 4.1–4.5, 5.3, 5.9–5.11, 5.17–5.19, 6.3, 7.1–7.2, 8.1: https://kalshi-public-docs.s3.amazonaws.com/regulatory/rulebook/Kalshi%20DCM%20Rulebook%20v.1.29.pdf
- [K20] Help Center, "APY on Kalshi" (updated 2026-03-17): https://help.kalshi.com/en/articles/13823847-apy-on-kalshi
- [K21] Help Center, "Liquidity Incentive Program": https://help.kalshi.com/en/articles/13823851-liquidity-incentive-program
- [K22] Help Center, "Liquidity Provider Program": https://help.kalshi.com/en/articles/15410219-liquidity-provider-program
- [K23] Help Center, "Collateral Return" (updated 2026-05-17): https://help.kalshi.com/en/articles/13823816-collateral-return
- [K24] Get Incentives API: https://docs.kalshi.com/api-reference/incentive-programs/get-incentives.md

**Third-party and press**
- [X1] CoinDesk, "Polymarket's Trading Volume May Be 25% Fake, Columbia Study Finds", 2025-11-07: https://www.coindesk.com/markets/2025/11/07/polymarket-s-trading-volume-may-be-25-fake-columbia-study-finds
- [X2] The Block, "Polymarket says governance attack by UMA whale … 'unprecedented'", 2025-03-26 (updated 03-27): https://www.theblock.co/post/348171/polymarket-says-governance-attack-by-uma-whale-to-hijack-a-bets-resolution-is-unprecedented
- [X3] UMA blog, "Improving Oracle Efficiency with Managed Proposers" (launch 2025-08-12): https://blog.uma.xyz/articles/managed-proposers
- [X4] The Crypto Times, "Polymarket Halts Trading for Four Hours After Same Failure Recurs Twice in a Day", 2026-08-31: https://www.cryptotimes.io/2026/08/31/polymarket-halts-trading-for-four-hours-after-same-failure-recurs-twice-in-a-day/
- [X5] GV Wire, "Kalshi Trading Temporarily Halted", 2026-04-15: https://gvwire.com/2026/04/15/kalshi-trading-temporarily-halted-website-shows/
- [X6] The Closing Line, "Kalshi Goes Down As Pope Is Announced" (event 2025-05-08): https://closingline.substack.com/p/the-takeaway-kalshi-goes-down-pope-betting-markets
- [X7] Prediction News, "Kalshi pays wrong side $18.6M…" (event 2026-09-06): https://predictionnews.com/story/kalshi-paid-wrong-winners-18-6-million-before-michigans-comeback
- [X8] The Block, "Kalshi CEO defends Khamenei market design…", 2026-03-01: https://www.theblock.co/post/391678/kalshi-ceo-defends-khamenei-market-design-after-backlash-says-platform-will-reimburse-all-fees
- [X9] Gaming America, "Kalshi Will Now Refund Trading Fees on Disputed Settlements", 2026-06-02: https://gamingamerica.com/news/1075098/kalshi-will-now-refund-trading-fees-on-disputed-settlements
- [X10] InGame, "Kalshi Expands From US To 140 Countries…", 2025-10-10: https://www.ingame.com/kalshi-expands-140-countries/
- [X11] The Block, "Polymarket unveils plans for trading engine overhaul, native stablecoin", 2026-04-06: https://www.theblock.co/post/396450/polymarket-unveils-plans-trading-engine-overhaul-native-stablecoin
- [X12] PokerNews, "Polymarket blunder prompts quick U-turn on new fees", 2026-04: https://www.pokernews.com/prediction-markets/news/2026/04/polymarket-blunder-prompts-quick-u-turn-new-polymarket-fees-50947.htm
- [X13] Pine Analytics, "Polymarket Fee Rollout" (data as of 2026-03-25): https://pineanalytics.substack.com/p/polymarket-fee-rollout
- [X14] P. D. Dubach, "The Anatomy of a Decentralized Prediction Market: Microstructure Evidence from the Polymarket Order Book", arXiv:2604.24366 (v1 2026-04-27, v2 2026-05-14): https://arxiv.org/abs/2604.24366
- [X15] Phemex News, "Polymarket Shifts from AMM to CLOB…", 2025-10-20 (secondary source): https://phemex.com/news/article/polymarket-shifts-from-amm-to-clob-to-enhance-liquidity-in-prediction-markets-28317
- [X16] Safaricom, "M-PESA Charges" (updated 2026-08-04): https://www.safaricom.co.ke/personal/m-pesa/mpesa-charges
- [X17] NautilusTrader, Polymarket integration docs (tick-size-change handling): https://nautilustrader.io/docs/nightly/integrations/polymarket/
