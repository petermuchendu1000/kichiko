# 12 — Prediction-market matching and clearing algorithms, beyond a plain CLOB

Research track: algorithms specific to prediction-market matching and clearing (complementary YES/NO books, multi-outcome events, batch auctions, AMM-in-book, exact integer money, Chinese exchange systems), ending in a concrete algorithm specification for Kichiko.

Date: 2026-09-26. Scope builds on, and does not repeat, `docs/research/brain-2026-09/01..03` and `docs/design/BRAIN-ARCHITECTURE-2026-09.md` (cited below as R01, R02, R03, ARCH).

---

## How to read the evidence tags

The network proxy blocked almost every publisher host in this session: arxiv.org, dl.acm.org, usenix.org, sse.com.cn, szse.cn, cffex.com.cn, docs.kalshi.com, help.kalshi.com, docs.polymarket.com, docs.cow.fi, euronext.com, londonstockexchange.com, lance.fortnow.com, optimization-online.org, users.ece.utexas.edu, and others. Both WebFetch and curl got `EGRESS_BLOCKED` or `CONNECT 403`. Only GitHub (`git clone`, `raw.githubusercontent.com`) and the search engine were reachable. Every claim therefore carries one of these tags:

| Tag | Meaning | Strength |
|---|---|---|
| **[C]** | I read the source code or document myself, from a git clone at a named commit | Primary, verified |
| **[E]** | I ran the experiment myself. Code and conditions are given in §9 | Measured, synthetic workload |
| **[S]** | Text returned by the search engine for the named URL. I could not open the page itself because the host was blocked | Secondary; wording may be the search tool's paraphrase |
| **[R01/R02/R03/ARCH]** | Established in an earlier Kichiko report; not re-fetched here | As in that report |
| **INFERENCE** | My own reasoning or derivation | Proof sketch given where possible |
| **UNVERIFIED** | A claim I could not check | Do not rely on it |

Experiment hardware for every [E] result: a shared sandbox with 4 vCPU (Intel Xeon @ 2.80 GHz) and 15 GB RAM, CPython 3.11.15 on one core, scipy 1.17.1 with HiGHS. Other agents were running on the same host, so timings are noisy upper bounds.

---

## 0. Executive summary

1. **Complementary matching needs no division, and should never divide.**
   - Polymarket CTF Exchange V2 derives the match type from the two order sides with one assembly expression: `matchType = (takerSide+1) * (takerSide == makerSide)`, giving 0 = COMPLEMENTARY, 1 = MINT, 2 = MERGE. [C]
   - It checks crossing exactly by cross-multiplication: `Mt·Mm ≥ Tt·Tm` for a buy against a sell, `Tt·Mm + Tm·Mt ≥ Tt·Tm` for MINT, and `≤ Mt·Mm` for MERGE. [C]
   - It then floors in `taking = making·takerAmount/makerAmount`, so dust arises because orders are expressed as amount ratios. [C]
   - V1 computed 1e18-scaled floor prices, then compared them. [C]
   - **Kichiko recommendation:** orders carry `(price_ticks, lots)`. Every fill moves exactly `price_ticks × lots` integer cash units. The only divisions left in the system are fees, pro-rata splits and FX, and each has a fixed rounding direction (§5).
2. **Mutually exclusive events have a clean, complete matching rule.** INFERENCE, with proof sketch and fuzz evidence [E]. With single-outcome YES/NO orders, every riskless match decomposes into three patterns:
   - **P1:** bid vs ask on one outcome's unified ladder (direct, binary mint or binary merge);
   - **P2:** YES-perspective bids on all n outcomes with Σ prices ≥ T, which mints a complete set;
   - **P3:** asks on all n outcomes with Σ ≤ T, which merges a complete set.

   A continuous engine that checks P1–P3 for every taker keeps this **no-cross invariant**: every outcome has best bid < best ask, Σ best bids < T and Σ best asks > T. The invariant is equivalent to "no riskless profitable match exists among resting orders."
   - The P2/P3 price check is O(1) using cached Σ of best prices.
   - Fuzzing: 2.4 M random operations over n = 2…12, all integer invariants exact. With self-trade prevention off, 0 residual crosses in 30 runs of 40 k operations each. [E]
   - Betfair has run the same idea ("cross matching") in production since 2008. [S]
3. **Optimal batch clearing of a multi-outcome event is an easy LP, not a hard combinatorial problem**, provided orders are single-outcome YES/NO and the event is mutually exclusive. In general the problem is hard: Boolean-combination matching is co-NP-complete (divisible) and Σ2p-complete (indivisible) [S, Fortnow et al.]; pair betting is NP-hard [S]; LMSR pricing is #P-hard [R02].
   - After the YES-perspective change of variables, the constraint matrix is **totally unimodular**. INFERENCE with proof sketch; confirmed on 15 of 15 random instances [E].
   - So both the fills (lots) and the clearing prices (ticks) come out integral, and **Σ prices = T exactly**. HiGHS returned integral duals summing to 1000.000 in 24 of 24 checks, and integral fills in 15 of 15. [E]
   - A combinatorial algorithm (concave integer search over the number m of complete sets minted) matched the LP optimum in 15 of 15 instances, in 0.9–37 ms in CPython for n ≤ 20 and K ≤ 10 k orders. HiGHS took 3–114 ms. [E]
4. **Batch auctions beat continuous matching on allocative efficiency in simulation.**
   - Feeding the same random order sets through the continuous engine realised a median of about 0.74 of the batch optimum's gains from trade (range 0.41–0.99 over 15 instances). [E]
   - Caveat: synthetic i.i.d. orders and no strategic timing; this supports, but does not prove, R02's recommendation of periodic auctions for thin markets.
5. **The uncross rule is small and well-specified.**
   - SSE: maximum volume, then minimum unexecuted volume, then midpoint. [S]
   - SZSE: maximum volume, then minimum imbalance, then closest to previous close / last trade. [S]
   - Euronext and LSE Millennium: maximum volume, then minimum surplus/imbalance, then market pressure, then reference price. [S]
   - The algorithm is O(K + L), with L ≤ 1000 levels. CPython: 0.7 ms at K = 1 k, 5.3 ms at 10 k, 90 ms at 100 k orders; always equal to brute force; cash conservation exact. [E]
   - In thin books the three rule chains picked **different prices in 92% of cases** (1622 of 1770), so the tie-break is effectively the price rule for Kichiko's long tail. [E]
   - Median distance from the reference price: 18 ticks under the SZSE rule, 23 under SSE, 24 under Euronext (p90: 52, 60, 67). [E]
   - **Recommendation:** use the Euronext/LSE chain with the last trade as reference.
6. **LMSR can sit inside the book as integer synthetic orders on the tick grid** (Hanson's book orders; Heidari et al.'s ε-fair paths [S]).
   - Each tick step's quantity is `floor(LOTS × b × Δlogit)`, sold at the far tick. So the AMM always receives at least the LMSR cost, and its loss stays ≤ b·ln n.
   - Measured: adversarial worst-case loss 68.87 vs bound 69.31 (n = 2, b = 100); 160.43 vs 160.94 (n = 5); 114.85 vs 115.13 (n = 10, b = 50). Maximum extra charge 0.52 tick per lot, so ε ≤ 1 tick. [E]
   - One subtlety, INFERENCE: in a batch where the AMM trades several outcomes in opposite directions, LMSR's negative cross-partials (∂²C/∂q_i∂q_k = −p_i p_k / b) can push the true cost above what the per-outcome steps charged. Re-verify after clearing and trim the AMM if needed (§4.6).
7. **Integer money design.** Proposal: T = 10,000 ticks per unit of face value, LOTS = 100 per share, and cash unit = 1/(T·LOTS) = 10⁻⁶ of the face currency.
   - That unit matches the 6-dp wallet columns Kichiko already has.
   - PostgreSQL's own docs say `numeric` is "very slow compared to the integer types". [C, PG17 docs]
   - Locally on PG 17.6, a PL/pgSQL fill-arithmetic loop cost 0.98 µs per iteration in `numeric` vs 0.30 µs in `bigint`; `SUM(p*q)` over 5 M rows took 1.50–1.67 s vs 0.28–0.29 s. [E]
   - At about 1.3 ms per order and a few fills, the speed-up is under 1% of order latency. **The reason to switch is exact conservation, not speed.**
8. **Published figures for Chinese exchange trading systems** (all [S]; the sites were blocked):

   | Exchange and system | Throughput | Latency | Other |
   |---|---|---|---|
   | SSE 新一代交易系统 ("new-generation trading system", 2009) | about 80,000 orders/s peak | average order latency cut by more than 30% | capacity 120 M trades/day |
   | SZSE 第五代 (fifth generation, 2016) | 300,000 orders/s capacity | about 1.1 ms average order processing | more than 400 M orders/day; multi-stage pipeline, lock-free queues, partitioned message bus on x86 |
   | SZSE system brief | ≥ 200,000 orders/s (cash auction) | order-confirm loop 1,818–1,932 µs at 3 k orders/s; fill loop 1,945–2,070 µs; confirm 2,744–3,522 µs at 50 k/s; < 10 ms CoLo end to end | |
   | CFFEX 新一代 (new generation, launched 2019-03) | 70,000 orders/s on one matching core; 200,000 on three parallel cores | < 100 µs average | the CFFEX figures could not be tied to a specific page (UNVERIFIED attribution) |

   - The design lesson for Kichiko: every one of these systems partitions by instrument, with one sequencer per partition.
   - For mutually exclusive events, **the partition key must be the event, not the option**, because P2/P3 touch every option's book.

---

## 1. Complementary-outcome matching in one engine (binary)

### 1.1 Polymarket CTF Exchange V2: exact mechanics from source [C]

Repo `Polymarket/ctf-exchange-v2`, commit `ccc0596074f4dfd62c944fbca4de252893b82b4b` (2026-04-13), files `src/exchange/mixins/Trading.sol`, `src/exchange/libraries/{Structs,CalculatorHelper}.sol`, `src/exchange/mixins/{Fees,AssetOperations}.sol`.

**Order representation.**
- An order is `{tokenId, makerAmount, takerAmount, side, …}` (`Structs.sol:30-57`).
- For a BUY, the maker gives `makerAmount` collateral and wants at least `takerAmount` tokens: price = M/T collateral per token.
- For a SELL, the maker gives `makerAmount` tokens and wants at least `takerAmount` collateral: price = T/M.
- Price is therefore an **implicit rational**. There is no price field and no tick check on-chain; grep finds no tick logic in `src/exchange`, so tick sizes are enforced off-chain by the operator.

**Match type.** `_deriveMatchType` (`Trading.sol:577-590`):
```solidity
assembly ("memory-safe") {
    matchType := mul(add(takerOrderSide, 1), eq(takerOrderSide, makerOrderSide))
}
```
- With BUY = 0 and SELL = 1: different sides give 0 = `COMPLEMENTARY`; both BUY gives 1 = `MINT`; both SELL gives 2 = `MERGE` (`Structs.sol:77-84`).
- V1 did the same with `if` statements (`Polymarket/ctf-exchange` commit `ed5c7708…`, `Trading.sol:275-278`).

**Crossing checks, exactly as coded** (`Trading.sol:640-674`). Subscripts: t = taker, m = maker; M = makerAmount, T = takerAmount.

| Match type | Condition in the code | Equivalent price condition |
|---|---|---|
| COMPLEMENTARY (BUY vs SELL, same token) | `Mt·Mm ≥ Tt·Tm`, else `NotCrossing` | buy price M_b/T_b ≥ sell price T_s/M_s |
| MINT (two BUYs, different tokens) | `Tt·Mm + Tm·Mt ≥ Tt·Tm` | divide by Tt·Tm: M_m/T_m + M_t/T_t ≥ 1, i.e. p_YES + p_NO ≥ 1 |
| MERGE (two SELLs) | `Tt·Mm + Tm·Mt ≤ Mt·Mm` | divide by Mt·Mm: T_t/M_t + T_m/M_m ≤ 1, i.e. p_YES + p_NO ≤ 1 |

All of this is exact uint256 arithmetic; the overflow headroom with 6-decimal amounts is enormous.

**V1 by contrast** (`ctf-exchange/src/exchange/libraries/CalculatorHelper.sol:58-84`):
- It computed `price = makerAmount*1e18/takerAmount`, a floored fixed-point value, and then tested `priceA + priceB >= ONE`.
- Flooring both prices can turn an exact 1.0 sum into 0.999…, so a legitimately crossing MINT could be rejected. INFERENCE from the code.
- V2's cross-multiplication removes this.

**Fill amounts and dust.**
- `CalculatorHelper.calculateTakingAmount(making, M, T) = making*T/M` (V2 `CalculatorHelper.sol:5-11`) is a floor division, so each maker receives at most its proportional amount.
- The taker's actual receipt is measured as a balance delta: `taking = balanceAfter - balanceBefore` (`Trading.sol:125, 330`).
- Leftover maker-asset balance is refunded to the taker ("Refund any leftover tokens", `Trading.sol:385`).
- So the taker captures both price improvement and rounding dust, and the exchange contract ends each match holding nothing.

**Batching.**
- `_settleMakerOrders` first prepares every maker, then executes **one** CTF `splitPosition` for all MINT legs and **one** `mergePositions` for all MERGE legs (`Trading.sol:390-444`, "Phase 2" at 426-428).
- Proceeds are distributed in phase 3.
- `_mint` and `_merge` call CTF with the binary partition `[1,2]` (`AssetOperations.sol:40-58`).

**Fees in V2.**
- The contract no longer computes the fee.
- The operator passes a fee per fill, and the contract only checks `fee ≤ cashValue·maxFeeRateBps/10_000`, with a default cap of 500 bps (`Fees.sol:17, 44-51`; `Trading.sol:563-575`).
- V1 computed `feeRateBps·min(p,1−p)·tokens` on-chain (`ctf-exchange/.../CalculatorHelper.sol:27-48`).
- The live taker formula `C·rate·p(1−p)` is in R01.

**Token-id validation.**
- `_validateTokenIds` requires every order in a match to be one of the **two** position ids of **one** `conditionId` (`Trading.sol:623-638`).
- **The exchange never matches across outcomes of a negRisk event.** Cross-outcome coherence on Polymarket comes only from arbitrageurs using the NegRiskAdapter (§2.1).
- This is the root cause of the "protocol-executable" arbitrage gap documented by Gebele, Mutzel & Matthes (arXiv:2608.00666 [S]; see also R02).

### 1.2 Gnosis Conditional Tokens: how Σ YES = Σ NO = collateral is exact [C]

Repo `gnosis/conditional-tokens-contracts`, commit `eeefca66…` (2020-09-17), `contracts/ConditionalTokens.sol`.
- `splitPosition` transfers `amount` collateral in and mints `amount` of **each** position in the partition (`amounts[i] = amount`).
- `mergePositions` burns equal amounts and returns `amount` collateral.
- ERC-1155 supplies of YES and NO therefore always equal the collateral held for that condition. This is **conservation by construction**: no code path creates one side without the other.
- `redeemPositions` pays `stake·payoutNumerator/den` with integer division. For a 50/50 resolution (`[1,1]`, den = 2), an odd stake loses ½ unit per redemption to the contract. Rounding goes against the redeemer, which keeps the contract solvent (INFERENCE from the code).

### 1.3 Kalshi's representation of YES/NO

- The order book API returns **only bids**, `yes_dollars` and `no_dollars`: "a yes bid at price X is equivalent to a no ask at (100−X)". [S: docs.kalshi.com/api-reference/market/get-market-orderbook; R01 K2]
- Prices are fixed-point dollar strings on a per-market grid of `price_ranges: [{start,end,step}]`, and contract counts are fixed-point with fractional sizes. [S: docs.kalshi.com/getting_started/fixed_point_migration; R01 K4]
- Mechanically this is Kichiko 071's `yes_px` / `book_side` normalisation. One ladder per market, keyed by YES price; NO orders are mirrored at T − p.

### 1.4 Integer crossing arithmetic Kichiko should use (INFERENCE)

Every order carries the **own-token price** `p ∈ grid ⊂ {1..T−1}` and `lots`. Normalise it into YES-perspective terms:

```
ypx      = p          if token = YES     else  T − p
bookside = BID        if (YES,BUY) or (NO,SELL)
           ASK        if (YES,SELL) or (NO,BUY)
```

A taker bid crosses a resting ask iff `ypx_bid ≥ ypx_ask`. This is an integer comparison, with no multiplication.

Execution is at the maker's YES price e. Each leg's own-token execution price is `e` for YES legs and `T − e` for NO legs. Cash moved per leg is `own × lots`, with no division. The match's net cash is then:

| Match | Net cash into the pool | Change in outstanding sets |
|---|---|---|
| YES buy vs YES sell | `e·q − e·q = 0` | 0 |
| YES buy vs NO buy (mint) | `e·q + (T−e)·q = T·q` | +q sets |
| YES sell vs NO sell (merge) | `−T·q` | −q sets |

So `collateral = T × S` holds **identically, in integers**. [E: asserted on every fill, §9.1]

If Kichiko ever accepts Polymarket-style amount orders (maker/taker amounts), use V2's cross-multiplications verbatim. Compute fills as `floor(making·T/M)` and send the remainder to the taker, as V2 does. Better still, reject amount orders whose implied price is not exactly on the tick grid.

### 1.5 Where Kichiko's current engine stands (from the repo, read-only)

`supabase/migrations/071_clob_index_ordered_ladder.sql`:
- Prices are `numeric(4,1)` cents; shares and cash are `numeric(20,6)`.
- Per-fill USD is `ROUND(v_fill * v_maker_price / 100.0, 8)`.
- Budget orders use `FLOOR(…*1e6)/1e6` (lines 318-322, 351, 380, 403).
- Migration 045 notes that wallet rounding previously leaked about half a cent per fill, and fixed it to a ≤ 1e-6 residual per operation (`045:1-15`). That is bounded, not exact.
- The direct/mint/merge logic and the `yes_px` ladder are already exactly the P1 pattern of §2.3.

---

## 2. Multi-outcome (mutually exclusive) events

### 2.1 negRisk conversion, from source [C]

Repo `Polymarket/neg-risk-ctf-adapter`, commit `f78b35b0…` (2026-01-08). `convertPositions(marketId, indexSet, amount)` is at `NegRiskAdapter.sol:244-356`.
1. It counts the k NO positions selected by `indexSet` (the "no positions" loop at 258-269).
2. It mints `yesCount·amount` **WrappedCollateral** (`wcol.mint`, line 277) and, for every *other* question, `splitPosition`s `amount` into YES + NO (lines 286-313).
3. It sends the caller's k NO tokens **and** the freshly split NO tokens of the other questions to `NO_TOKEN_BURN_ADDRESS` (lines 318-327). The constant is at line 54.
4. It deducts `feeAmount = amount·feeBips/10_000` (`FEE_DENOMINATOR` at line 55), then releases `(k−1)·amountOut` real collateral to the caller (`wcol.release`, lines 333-341) and sends `amountOut` of each complementary YES (lines 343-353).

**The identity behind it (INFERENCE).** Assume exactly one of n outcomes w wins, and let S be the set of k converted outcomes:

```
Σ_{i∈S} NO_i  pays  |{i∈S : i≠w}| = (k−1) + 1[w∉S]
(k−1)·cash + Σ_{j∉S} YES_j  pays  (k−1) + 1[w∉S]
```

The payoffs are identical in every state, so conversion is value-neutral.
- The repo's own doc warns that if **all** questions resolve false, the converted position is worth less (`docs/NegRiskAdapter.md`, `convertPositions` section) [C].
- Consequence for Kichiko: an exclusive event must guarantee exactly one winner, for example with an explicit "Other" outcome, or the equivalences in this section break.
- The adapter only goes NO → YES. The reverse (YES on all j ∉ S → NO on S plus cash) is the direction Gebele et al. show is missing and exploitable [S, arXiv:2608.00666; R02].

### 2.2 Kalshi collateral return [S]

Help Center example (help.kalshi.com/trading/advanced-options/collateral-return [S]; R01 K23): No on "Hillary Clinton" at 60¢ plus No on "John Kerry" at 70¢ costs $1.30, but at least $1 is guaranteed.
- Kalshi takes only $0.30 and marks the position value down by the returned $1.
- The feature is off by default for new users, and positions whose collateral was returned may become unsellable.

**Mechanics (INFERENCE).** Define the account's payoff vector over states s:

```
payout(s) = YES_s + Σ_{j≠s} NO_j = (YES_s − NO_s) + Σ_j NO_j
guaranteed = min_s payout(s)              (O(n) per update)
```

Collateral return credits `guaranteed × face` back as cash. It is the same equivalence as negRisk convert, done as a margin calculation instead of a token transformation. "Unsellable after return" follows: selling a NO would lower `min_s payout(s)` below the cash already released.

### 2.3 Matching across outcomes: the three patterns and a completeness argument (INFERENCE + [E])

**Canonical basis.** In an exclusive event, write exposures as vectors over outcomes: YES_j = e_j and NO_j = **1** − e_j. A complete set **1** is worth exactly 1 unit of face value in every state.

In YES-perspective every order is ±e_j at a YES price:
- a bid on j is `+e_j` (YES buy, or NO sell with a value-neutral set adjustment);
- an ask on j is `−e_j`.

A multiset of fills is *riskless for the exchange* iff its net exposure is c·**1** for an integer c (c sets minted if c > 0, merged if c < 0) and net cash ≥ c·T.

**Claim.** Let B_j = bid-units and A_j = ask-units filled on outcome j. Any riskless multiset satisfies B_j − A_j = c for all j, so it decomposes into:
- min(B_j, A_j) **P1 pairs** (bid vs ask on j);
- plus, if c > 0, c **P2 sets** (one bid on every outcome); if c < 0, |c| **P3 sets** (one ask on every outcome).

Surplus is additive over the components. At best prices:
- a P1 component's surplus ≤ bb_j − ba_j;
- a P2 component's ≤ Σ bb_j − T;
- a P3 component's ≤ T − Σ ba_j.

So the resting book admits a profitable riskless match **iff** some best-price component is profitable. **No-cross invariant I6:**

```
∀j: bb_j < ba_j        (when both exist)
Σ_j bb_j < T           (when every outcome has a bid)
Σ_j ba_j > T           (when every outcome has an ask)
```

A continuous matcher that, for each taker, compares P1 against the synthetic P2/P3 price and fills the better one, preserves I6. The synthetic prices are:
- taker bid on j: `T − Σ_{k≠j} bb_k`;
- taker ask on j: `T − Σ_{k≠j} ba_k`.

With multi-outcome orders (bundles such as "A or B"), the decomposition fails and the problem becomes an LP (§2.4).

**Evidence [E].** A reference engine (`k12exp/engine_multi.py`) checked, every 25–100 operations plus at the end:
- I1: Σ_accounts h_j = S for every j;
- collateral = S·T;
- Σ cash + reserved + collateral = deposits;
- reservations equal open-order needs;
- nothing negative;
- and on every fill, net holdings change = c·**1** and net cash = c·T·q.

Results:
- **2.4 M operations** (n ∈ {2,3,4,6,8,12} × 5 seeds × 2 STP modes × 40 k operations) passed.
- With STP off, every run ended with zero residual P1/P2/P3 crosses (asserted).
- With STP on, a few residual crosses remain, as expected, where the only counterparty is the same account.
- Match mix at n = 5, seed 0: P1 9,537 (3,902 mint, 1,084 merge), P2 1,616, P3 1,798. At n = 12: 3.3 ledger legs per match on average.
- P2/P3 volume falls with n under this generator, because all n books must be simultaneously non-empty at complementary prices.

**Production precedent.** Betfair's "cross matching" matches a back bet against lays on the same runner **and** against bets on other runners once the book reaches 100%. It was introduced on most sports in 2008 and uses best execution. [S: betfair.com.au/hub/help/cross-matching-on-exchange-markets; Betfair developer forum "Virtual Bets (Cross Matching) Algorithm"]

**Cost in Kichiko's Postgres engine (INFERENCE).**
- A P2/P3 fill writes n order rows and n+1 position rows, instead of 2 and 2.
- It needs **every** option book of the event under one serialisation point.
- One event-level advisory lock, taken first, then wallet/position rows in id order (ARCH's deadlock fix), keeps it deadlock-free. It removes the per-option parallelism ARCH hoped for in exclusive events.
- The measured serial ceiling of about 500 orders/s (ARCH §3) then applies per **event**. That is still orders of magnitude above Kichiko's volumes.
- Alternative: keep per-option locks and run a P2/P3 "sweep" under the event lock every 100 ms – 1 s. The cost is transient I6 violations, where takers can briefly get worse prices than a synthetic cross would give.

### 2.4 Optimal clearing literature: complexity and practicality

| Problem | Complexity / algorithm | Practical for real time? | Source |
|---|---|---|---|
| Arbitrary Boolean-formula securities over n events, divisible orders | co-NP-complete; Σ2p-complete if indivisible; polynomial (divisible) or NP-complete (indivisible) with log n events | No, in general | Fortnow, Kilian, Pennock, Wellman, EC'03 / DSS 39(1) 2005 [S] |
| Permutation betting: subset bets / pair bets | poly-time for divisible subset bets; NP-hard for pair bets | Only restricted languages | Chen, Fortnow, Nikolova, Pennock, EC'07 [S] |
| LMSR pricing over permutations / Boolean combos | #P-hard | No | Chen, Fortnow, Lambert, Pennock, Wortman, EC'08 [R02] |
| Arbitrage-free combinatorial market maker | #P-hard worst case; Frank–Wolfe + IP oracle in practice | Seconds-scale, offline | Kroer, Dudík, Lahaie, Balakrishnan, EC'16 [R02]; Dudík, Lahaie, Pennock constraint generation, EC'12 (used for 2012 US elections) [S] |
| Parimutuel call auction (CPCAM) | convex program, unique state prices, FPTAS / polynomial; gives the same state prices as the Lange–Economides model, whose allocation then becomes an LP | Yes, for moderate size | Peters, So, Ye; Agrawal, Wang, Ye [S] (web.stanford.edu/~yyye/cpcam-ec.pdf; US patent 20090099955) |
| CoW Protocol fair combinatorial batch auction | per directed pair, pick the best bid; drop batched bids that give any pair less than its reference; choose the winning combination maximising score "subject to some computational constraints"; uniform directional clearing prices | Yes (off-chain solvers, ~3-block deadline on mainnet) | cowprotocol/docs @ `068fe8c4` [C] (`fair-combinatorial-auction.md`, `competition_rules.md`, `the_problem.md`) |
| SPEEDEX Arrow-Debreu batch exchange | Tâtonnement approximates prices, then an LP whose size is linear in asset pairs and independent of the number of offers corrects them; guarantees asset conservation and no internal arbitrage | Yes: >100 k tx/s on 32 cores with 70 M open offers (arXiv v3); >200 k tx/s on 48 cores (NSDI'23 final) | Ramseyer, Goel, Mazières [S]; code scslab/speedex @ `e4ca7c5c` [C] |
| Batch exchange + CFMM | axioms (asset conservation, uniform valuations, limit-order best response, non-decreasing CFMM trading function) and equilibrium computation | Yes | Ramseyer, Goyal, Goel, Mazières, EC'24, arXiv:2210.04929 [S] |
| Flow trading (portfolio orders as piecewise-linear flow demand) | market-clearing prices exist; a quadratic program solved by interior point; design goal "less than one second" | Seconds-scale batches | Budish, Cramton, Kyle, Lee, Malec, NBER w31098 [S]. A figure of "2000 assets, 100,000 orders ≈ 1.1 s" appeared in one search summary; **UNVERIFIED** |
| **Kichiko special case:** exclusive event, single-outcome YES/NO orders | LP with n equality rows, K+1 columns; totally unimodular after the YES-perspective change of variables, so integral fills and integral tick prices summing to T; combinatorial O(n·L·log Q) algorithm | Yes: ≤ 37 ms (Python) / ≤ 114 ms (HiGHS) at n = 20, K = 10 k | this report, §2.5 [E] |

Recent empirical work (2025–26) is in R02 and not repeated: Saguillo et al. (AFT'25), Cheng–Yang–Zou, Gebele et al. The operationally relevant lesson is that arbitrage persists exactly where the protocol does **not** expose the equivalence as an executable primitive. P2/P3 in the matcher, plus a two-way convert, close that gap by construction.

### 2.5 The Kichiko batch LP, its total unimodularity, and a combinatorial solver

**Formulation.**
- Variables: x_k ∈ [0, Q_k] lots per order, and m ∈ ℤ, the net complete sets minted.
- Objective: maximise `Σ_buy p_k x_k − Σ_sell p_k x_k − T·m`, the gains from trade at limit prices.
- Constraints: `Σ_k A_kj x_k − m = 0` for every outcome j, where the column A_k is e_j (YES buy), −e_j (YES sell), **1** − e_j (NO buy) or −(**1** − e_j) (NO sell).

**Duality (INFERENCE).** Let y_j be the multiplier of row j.
- Stationarity in m gives **Σ_j y_j = T**.
- Stationarity in x_k gives: order k fills fully if its limit beats its bundle price A_k·y, not at all if worse, and partially only at the money.
- So y is a vector of uniform clearing prices: a competitive equilibrium, as in CPCAM without the parimutuel term.

**Total unimodularity (INFERENCE, proof sketch).**
1. Substitute m' = m − Σ_{NO buys} x + Σ_{NO sells} x. This is a unimodular change of variables that also shifts the objective by ±T·x, which is exactly the "NO buy at p ≡ YES ask at T−p" rule.
2. Every order column is now ±e_j: one nonzero. The m' column is all −1.
3. Take any square submatrix and expand along the single-nonzero columns. What remains is either a 1×1 (±1), or has two identical rows, giving determinant 0. So all subdeterminants are in {0, ±1}.
4. TU with integral Q and integral prices means an LP vertex solver returns integral fills in lots, and the dual (TU transpose, integral T and p) has integral optimal vertices: integral tick prices with Σ = T.

Empirically [E]:
- HiGHS returned integral x in 15 of 15 instances.
- Duals were integral and summed to 1000.000 in 24 of 24 checks.
- MILP (integrality forced) gave the same optimum as LP in every K ≤ 1 k case.

**Combinatorial algorithm (no LP solver).** W_j(m) = maximum welfare on outcome j's ladder given net fill m (take m extra top bids if m > 0, or |m| extra bottom asks if m < 0, then pair bids with asks while bid > ask). It is concave in m. The steps:
1. Maximise F(m) = Σ_j W_j(m) − T·m over integers m ∈ [−min_j Σasks_j, min_j Σbids_j] by integer ternary search. Each F evaluation is O(n·L) using level arrays, so the total is O(n·L·log Q).
2. Prices: pick y_j ∈ [ΔW_j(m*+1), ΔW_j(m*)] with Σ y_j = T, where ΔW_j(m) = W_j(m) − W_j(m−1). Such a vector exists by optimality of m*. Choose the vector closest to the reference prices by water-filling, O(n log n).
3. Run each outcome's single-book uncross at y_j, with the "mint desk" supplying m* units (or absorbing −m*).

The prototype checked welfare equality with the LP in 15 of 15 instances. Price extraction in the prototype came from LP duals; step 2 is specified but not separately tested (UNVERIFIED in code).

**Timings [E]** (CPython and HiGHS via scipy, 1 core, generator in §9.2):

| n | K | HiGHS LP ms | MILP ms | combinatorial ms | LP = comb welfare | continuous / batch welfare |
|---|---|---|---|---|---|---|
| 2 | 100 | 3.9 | 9.7 | 0.9 | yes | 0.781 |
| 2 | 10,000 | 55.0 | – | 12.0 | yes | 0.741 |
| 5 | 1,000 | 8.3 | 66.6 | 6.0 | yes | 0.739 |
| 5 | 10,000 | 93.8 | – | 23.1 | yes | 0.690 |
| 10 | 1,000 | 15.6 | 93.3 | 6.2 | yes | 0.811 |
| 10 | 10,000 | 85.3 | – | 31.0 | yes | 0.697 |
| 20 | 1,000 | 11.4 | 97.7 | 6.1 | yes | 0.780 |
| 20 | 10,000 | 114.4 | – | 37.2 | yes | 0.695 |

The full 15-row table is in §9.2. "Continuous / batch" is the realised gains from trade when the same orders arrive one by one through the continuous engine (P1–P3, maker-price execution), divided by the batch optimum. Range 0.41–0.99; median about 0.74.

---

## 3. What the Chinese exchange systems publish

All figures are [S]. The official hosts sse.com.cn, szse.cn and cffex.com.cn were blocked, so each figure is quoted from search results that point at those pages. Translations are mine.

| System | Published figures | Architecture notes | Source (as indexed) |
|---|---|---|---|
| SSE 新一代交易系统 ("new-generation trading system"), cut over 2009-11-23, formal operation 2009-12-04 | peak order processing about **80,000 orders/s**; average order latency **>30% lower** than the previous system; daily capacity ≥ 120 M trades ("4× historical peak") | – | sse.com.cn/aboutus/mediacenter/hotandd/c/c_20150912_3988342.shtml [S] |
| SSE new bond trading system, live 2021-12-20 ("股债分离", equities and bonds separated) | first SSE matching system on **x86**; 5.826 M cash-bond orders/day on average in the first days; no latency number published in the snippet | x86, in-house | sse.com.cn/…/c_20211223_5666377.shtml [S] |
| SSE 2026 "新竞价 / 新综业" (new auction and new comprehensive-business platforms) | participant technical implementation guide v1.3 (July 2026); old and new systems coexist during a switchover window | – | sse.com.cn/services/tradingtech/development/…/5f5c235d….pdf [S] |
| SZSE 第五代交易系统 (fifth-generation trading system; trial run 2016-05-09 to 06-03) | capacity **300,000 orders/s** ("3× the old system"); trial peak > 130,000/s; **average order processing ≈ 1.1 ms** ("1/100 of the old system"); > 400 M orders/day; > 300 M accounts; securities capacity 5 k → 50 k | in-house **multi-stage pipelined trading engine, high-speed lock-free queues, thread-safe shared-memory pool**, low-latency message bus with **partitioned parallel processing, horizontally scalable by partition**; moved to open (x86) platforms | news.cnstock.com/news,zxk-201606-3811859.htm; tmtpost.com/2404538.html; blog.sina.com.cn/s/blog_45b4a51c0102wnq8.html [S] |
| SZSE 《新一代交易系统简介》 ("Introduction to the new-generation trading system") | cash centralised auction **≥ 200,000 orders/s**; CoLo gateway end-to-end fill latency **< 10 ms**; at an average 3 k orders/s the order-confirm loop is **1,818–1,932 µs** and the order-fill loop **1,945–2,070 µs**; at **50 k orders/s** the confirm loop is **2,744–3,522 µs** | platforms: cash auction, integrated financial services, non-trading, derivatives auction, international interconnect | szse.cn/marketServices/technicalservice/introduce/P020191019360308096075.pdf [S] |
| CFFEX 新一代交易系统 ("new-generation trading system"), live 2019-03-15 | **70,000 orders/s per matching core**; **200,000 orders/s with three parallel matching cores**; average order latency **< 100 µs** | standard four-layer architecture; dual-node hot redundancy from network to application, "zero switch-over"; fully in-house | cffex.com.cn/jysdt/20190315/23680.html and cffex.com.cn/xtjj/ [S]. The numbers came from one search summary and a second query could not re-find them: **UNVERIFIED attribution** |
| Standard JR/T 0145—2016 《资本市场交易结算系统核心技术指标》 ("core technical indicators for capital-market trading and settlement systems") | defines daily order-processing capacity (10k orders/day, including cancels and non-trading orders); the test method replays 3 months of desensitised production orders for 4 h in a production-like environment while monitoring CPU, memory and disk | drafted by CSRC IT centre, SSE, SZSE, SHFE, ZCE, DCE, CFFEX, CSDC | sse.com.cn/lawandrules/regulations/csrcannoun/c/10117497/files/d92b808c….pdf; csrc.gov.cn [S] |

Earlier Chinese-scholarship material (UESTC and SSE research on call auctions, the 2018 SSE closing-auction reform) is in R02 §D.

**Lessons for Kichiko (INFERENCE):**
1. Every system scales by **partitioning the instrument space with one sequencer per partition**. SZSE: partitioned bus; CFFEX: three parallel matching cores. The per-core number (70 k/s at CFFEX) is the relevant comparison for Kichiko's per-event serial ceiling of about 500/s in Postgres, a ratio of about 140×. That ratio is irrelevant while Nairobi round trips are 130–180 ms (R03).
2. For exclusive events, the partition must be the **event**, because P2/P3 touch every option.
3. The latencies exchanges publish are **gateway-to-gateway loops** (1.8–3.5 ms at SZSE), not matching time alone. When Kichiko publishes numbers, it should use the same loop definition and a JR/T 0145-style replay test.

---

## 4. Periodic (frequent) batch auctions

### 4.1 Published uncross rules

| Venue / design | 1st | 2nd | 3rd | 4th | Rationing at the price | Source |
|---|---|---|---|---|---|---|
| SSE (上交所) call auction | maximum executable volume | buys above and sells below the price fully executed; at least one side at the price fully executed | minimum unexecuted volume ("未成交量最小") | **midpoint** of remaining candidates ("中间价") | price-time | SSE Trading Rules 2023 rev. [S] (sse.com.cn/lawandrules/sselawsrules2025/stocks/exchange/c/c_20250519_10779396.shtml) |
| SZSE (深交所) | maximum volume, same conditions | minimum difference between cumulative buys at or above and sells at or below | **closest to previous close** (open) or **to the last trade** (intraday and close) | – | price-time | SZSE Q&A via cls.cn, xueqiu [S] |
| Euronext | maximum executable volume | minimum surplus | (market pressure) | **reference price**, normally the last traded price | – | Euronext Trading Manual (2019–2024 editions) [S] |
| LSE Millennium (MIT201) | volume maximising | minimum order imbalance | market pressure | dynamic reference price | – | MIT201 Guide to the Trading System 15.6 [S] |
| Budish–Cramton–Shim frequent batch auctions | supply meets demand at a uniform price | if a range of clearing prices, **midpoint** | – | – | **pro-rata** at the clearing price | AER P&P 104(5), 2014 [S] |

### 4.2 Algorithm for Kichiko's unified binary ladder (exact integers)

Inputs: orders normalised to (ypx, BID/ASK, lots, seq); the tick grid 1..T−1 with L live levels (≤ 1000); a reference price `ref` (last trade, previous uncross, or the AMM price).

```
bidq[p], askq[p]              ← bucket lots                         O(K)
D[p] = Σ_{x≥p} bidq[x]        (suffix sums)                         O(L)
S[p] = Σ_{x≤p} askq[x]        (prefix sums)                         O(L)
V(p) = min(D[p], S[p]);  imb(p) = D[p] − S[p]
C1 = argmax V   (stop if max V = 0)
C2 = argmin_{C1} |imb|
if |C2| > 1:
   all imb > 0 → max(C2)          # buy pressure
   all imb < 0 → min(C2)          # sell pressure
   else        → ref clamped to [min C2, max C2], snapped to nearest candidate
price p*; volume V* = min(D[p*], S[p*])
allocate: bids with ypx > p*, asks with ypx < p* fill fully;
          at p*, the long side is rationed by seq (time priority), in integer lots
```

**Conservation (proved in §1.4 and asserted in code [E]).** Let YB, YS, NB, NS be filled lots by type. Filled bids = YB + NS = V* = YS + NB = filled asks, so YB − YS = NB − NS = ΔS. Cash in is `p*·YB + (T−p*)·NB − p*·YS − (T−p*)·NS = T·ΔS`. Mint and merge inside the auction come for free.

**Measured [E]:**
- 300 random books × 3 rule sets: volume equalled brute force in every case, and cash conservation was exact.
- CPython time for L = 999: 0.7 ms (K = 1 k), 5.3 ms (10 k), 90 ms (100 k). PL/pgSQL over an index scan should be of the same order (INFERENCE; not measured).
- The rule chains disagreed on price in 1622 of 1770 thin books (K ∈ {4, 8, 16}). With a reference near fair value (K ∈ {4, 8, 16, 64}, 2,726 books), median |price − ref| in ticks was 24 (Euronext), 23 (SSE), 18 (SZSE), with p90 67, 60, 52.

**Recommendation.** Use the Euronext/LSE chain with the last trade as reference (or SZSE's closest-to-reference). **Avoid** SSE's plain midpoint for thin prediction books: the candidate interval is often tens of ticks wide, and the midpoint then invents a price no order asked for. Keep time-priority rationing rather than pro-rata, because it needs no division and is consistent with continuous trading.

### 4.3 Anti-manipulation around the uncross

R02 already covers the open (indicative) call, the no-cancel window and random end times (Chinese evidence). In addition:
- Mastrolia & Xu (arXiv:2405.09764, 2024) model a strategic trader who arrives at the last moment before a periodic auction closes, and quantify two remedies: a **randomised closing time** and an optimised fee policy. [S]
- Kichiko: end each call uniformly at random in the last r seconds, and publish the indicative price and volume continuously.

### 4.4 Multi-outcome batch

Use §2.5: combinatorial m-search (or HiGHS as an oracle in tests), then per-outcome uncross at y_j with the mint desk. Tie-breaks among the dual-optimal price vectors: closest to the reference vector (for example, last trades renormalised to Σ = T), found by water-filling.

### 4.5 Where the AMM enters a batch

See §4.6 and §6.4. The AMM is a set of step orders per outcome, generated from its state at batch start and at most k ticks deep.

### 4.6 AMM (LMSR) as synthetic orders: mechanics and exactness

**Literature.**
- Hanson's "book orders": the market maker gets first look at incoming orders, and a parallel implementation splits a trade between the AMM and the resting book. [S, via Heidari et al.]
- Heidari, Lahaie, Pennock, Wortman Vaughan (EC'15; ACM TEAC 6(3–4) 2018) define an **ε-fair trading path**: "no order executes at a price more than ε above its limit, and every order executes when its market price falls more than ε below its limit".
  - Under a supermodularity condition, a fair path to an efficient endpoint exists; in general it does not.
  - They give an ε-fair algorithm for continuous trade. [S]
- Ramseyer, Goyal, Goel, Mazières (EC'24) give the batch-plus-CFMM axioms: asset conservation, uniform valuations, a limit-order best response, and a non-decreasing trading function. [S]

**Tick-grid construction (INFERENCE, tested [E]).**
- For LMSR with liquidity b over n outcomes, buying Δ of YES_i with the other outcomes fixed moves logit(p_i) by exactly Δ/b, because p_i/(1−p_i) = e^{q_i/b} / Σ_{k≠i} e^{q_k/b}.
- So the lots between ticks t and t+1 are `Δq(t) = floor(LOTS·b·(logit((t+1)/T) − logit(t/T)))`, shifted by the current ln R_i.
- The AMM posts an **ask** of Δq(t) at the **upper** tick t+1 and a bid at the lower tick. The buyer pays tick × lots ≥ ∫ LMSR price, and quantity is floored.
- Both roundings favour the AMM, so its liability can never exceed the LMSR bound b·ln n.

Measured over 300 random paths per configuration plus a worst-case informed trader:

| n | b | adversarial loss | bound b·ln n | max charge over the LMSR integral |
|---|---|---|---|---|
| 2 | 100 | 68.87 | 69.31 | 0.52 tick/lot |
| 5 | 100 | 160.43 | 160.94 | 0.52 tick/lot |
| 10 | 50 | 114.85 | 115.13 | 0.52 tick/lot |

So the AMM's quotes are ε-fair with ε ≤ 1 tick.
- The ledger stays integer: floats are used only to decide **quote sizes**, never to move money.
- Guard float error with an extra 1-lot haircut.

**Continuous mode.** Do not store AMM depth as rows; that would cost n × depth writes on every AMM fill.
- Evaluate the AMM as a **virtual maker** inside the matching loop: at each step compute its best quote on the taker's outcome from its integer state (q in lots, cash).
- Treat it as one more candidate alongside P1/P2/P3, ranked after resting orders at the same price (INFERENCE: protects human makers' queue priority).
- Only the AMM's account rows change.

**Batch mode caveat (INFERENCE).** LMSR's Hessian has negative off-diagonals: ∂²C/∂q_i∂q_k = −p_i p_k / b.
- If the AMM sells several outcomes in one batch, the joint cost is ≤ the sum of the per-outcome step costs, which is safe.
- If it **sells i and buys k** in the same batch, the interaction term has the wrong sign. The joint cost change can exceed what the per-outcome steps collected, so the b·ln n bound could be breached by a second-order amount.
- Fix: after clearing, compute the exact C(q′) − C(q) in float with a safety margin. If AMM receipts fall short, drop AMM fills in reverse order of surplus and re-clear. Alternatively, restrict the AMM to one net direction per batch.
- Heidari et al.'s supermodularity condition is exactly this kind of interaction assumption.

---

## 5. Integer and fixed-point money design for exact conservation

### 5.1 Units

| Quantity | Type | Unit | Range and overflow |
|---|---|---|---|
| price | `int2` | tick = 1/T of face value, **T = 10,000** (0.01¢ resolution; grid subsets for the tapered 1¢ / 0.1¢ ladder) | 1..9,999 |
| quantity | `int8` | lot = 1/100 share (Kalshi-like 0.01 contract granularity [S/R01]) | CHECK lots ≤ 5·10⁹ per order (fee headroom, below) |
| cash | `int8` | 1 tick × 1 lot = 1/(T·LOTS) = **10⁻⁶ face currency** (matches today's 6-dp wallet columns) | 9.2·10¹⁸ units = 9.2·10¹² currency units per row |
| sets S_j, V | `int8` | lots | – |
| fee accumulator numerator | `int8` | θ_num·lots·p·(T−p), θ in per-mille (0.07 → 70) | ≤ 70 × 5·10⁹ × 2.5·10⁷ = 8.75·10¹⁸ < 2⁶³ |

The PostgreSQL 17 documentation (datatype.sgml, REL_17_STABLE, lines 518-527) [C]: `numeric` is "especially recommended for storing monetary amounts … Calculations with numeric values yield exact results where possible … However, calculations on numeric values are very slow compared to the integer types." It also stores 2 bytes per 4 decimal digits plus 3–8 bytes of overhead (lines 627-634).

Measured locally on supabase/postgres 17.6.1.011 (a fresh container, removed afterwards) [E]:

| Workload | numeric | bigint |
|---|---|---|
| PL/pgSQL loop, 1 M fill computations | 974–998 ms | 293–306 ms |
| `SUM(p*q)` over 5 M rows (no parallelism) | 1,497–1,671 ms | 285–292 ms |

Per order that is about 0.7 µs × fills of saving. Against 1.3 ms of order work it is negligible. **Integers are for exactness.**

### 5.2 Rounding-direction rules (the only divisions in the system)

| Operation | Formula | Direction | Residual goes to |
|---|---|---|---|
| fill cash | `px × lots` | exact | – |
| budget-cap order (spend ≤ B) | `lots = floor(B / px)` | down (user never overspends) | unspent B stays with the user |
| taker fee, per fill | `acc += θ_num·lots·p·(T−p)`; `due = ceil(acc / (1000·T))`; `charge = due − charged`; `charged = due` | up, but on the **cumulative** order total | overpayment is < 1 cash unit per order |
| maker rebate | `floor(…)` cumulative, symmetric to the fee | down | fee pool |
| pro-rata split (if ever used) | `floor(q·w_i/Σw)`, then remainder lots one by one in seq order | exact total | no dust |
| 50/50 or split resolution | pay `T/2` per YES and per NO lot | exact because T is even | – |
| AMM quote size / price | size `floor`, price at the far tick | favours the AMM | AMM |
| FX / M-Pesa boundary (whole KES) | withdraw `floor`, deposit exact | against the user at the boundary only | explicit per-user `dust` sub-account, never silently dropped |

The fee formula: C = lots/LOTS, P = p/T. So θ·C·P·(1−P) face units = θ·lots·p·(T−p)/T cash units. With θ = θ_num/1000, `fee = ceil(θ_num·lots·p·(T−p) / (1000·T))`.

Kalshi does the same thing:
- Fees round up so that fee + position cost lands on a centicent ($0.0001 for direct members, $0.01 for others).
- A per-order accumulator carries rounding across taker and maker fills "so that the total fee converges to what a single equivalent fill would cost".
- Net fee = trade fee + rounding fee − rebate, and is ≥ 0. [S: docs.kalshi.com/getting_started/fee_rounding; R01 K5, K18]

The cumulative-ceil form above is my integer restatement (INFERENCE).

### 5.3 Invariants, stated in integers (extends ARCH I1–I5)

- **I1b (binary option j):** Σ_accounts YES_j = Σ_accounts NO_j = S_j (lots, including reserved).
- **I1m (exclusive event), vault form:**
  - n-way mints and NO→YES converts leave the system *vault* account holding V lots of NO_j for every j;
  - pool cash = T·(Σ_j S_j − (n−1)·V);
  - at settlement, the winner's S_w·T plus the non-winners' NO payouts, minus the vault's internal (n−1)·V·T, equals the pool **exactly** (INFERENCE: this is Polymarket's WrappedCollateral design in ledger form).
- **I1m', canonical form:** per account an exposure vector h ∈ ℤⁿ, Σ_accounts h_j = S for every j, and pool = S·T. This is what the fuzzer checks [E]. It is simpler, but loses the per-token display.
- **I2:** Σ(cash + reserved) + pools + fee pool + dust = deposits − withdrawals. Exact.
- **I4:** reserved cash = Σ_open buys p·rem (plus the fee reserve); reserved tokens = Σ_open sells rem. Checked in the fuzz [E].
- **I6 (new):** the no-cross conditions of §2.3.
- **I7 (new):** every fill's legs satisfy net exposure = c·**1** and net cash = c·T·q. Assert inside the matcher, like `_settle_match` in the prototype.

---

## 6. Specification: what Kichiko should implement

### 6.1 Data model (Postgres, integers throughout)

```
events(id, kind ENUM('binary','exclusive'), n int2, T int2 DEFAULT 10000,
       lots_per_share int2 DEFAULT 100, face_currency, grid_id, seq int8,
       vault_sets int8 DEFAULT 0, status, amm_b_lots int8 NULL)
options(id, event_id, idx int2, S int8 DEFAULT 0,                 -- sets outstanding for this binary leg
        best_bid int2, best_ask int2)                             -- cached top of book (YES px)
event_book_sums(event_id, sum_best_bid int4, n_with_bid int2,
                sum_best_ask int4, n_with_ask int2)                -- O(1) P2/P3 check
orders(id int8, event_id, option_id, user_id, tok ENUM('Y','N'), side ENUM('B','S'),
       px int2, ypx int2 GENERATED, book_side GENERATED, lots int8, rem int8,
       reserved_cash int8, fee_acc int8, fee_charged int8, seq int8,   -- per-event sequence
       tif, post_only, reduce_only, stp_mode, client_order_id, status, expires_at)
  partial index (option_id, book_side, ypx, seq) WHERE status IN ('open','partial')
positions(user_id, option_id, yes int8, no int8, res_yes int8, res_no int8, cost_micro int8)
wallet_ledger(double-entry, amount int8 in cash units)             -- no numeric money
fills(id, event_id, seq, pattern ENUM('P1','P2','P3','AMM','AUCTION'), taker_order,
      legs jsonb or child table fill_legs(order_id, px_own, lots, cash))
```

Replace `created_at` time priority with `seq` (ARCH already recommends this).

### 6.2 Continuous matching (binary and exclusive)

1. **Validate:** px on the grid; lots ≥ min; idempotency on (user, client_order_id).
2. **Lock:** `pg_advisory_xact_lock(event_id)` first. Then, only at the end, wallet and position rows in id order.
3. **Reserve:** buy reserves px·lots plus the maximum fee. A sell reserves tokens: YES_j for a YES sell. A NO_j sell reserves NO_j tokens; in the canonical form, every h_k for k ≠ j. The collateral-return variant reserves `px·lots − Δguaranteed`.
4. **Loop** while rem > 0:
   - P1 = best opposite on the taker's option: the first row from the index-ordered cursor (071).
   - If the event is exclusive and every other option has the needed side: P2/P3 synthetic price = `T − (sum_best_side − best_side[own option])`.
   - AMM candidate, if enabled.
   - Choose the best price for the taker. Tie order: P1, then AMM, then P2/P3, i.e. fewer legs first.
   - Quantity = min over the involved makers' rem and the taker's rem.
   - Execute legs at the makers' own prices, with the taker at the residual price. Apply the rounding table.
   - Assert I7. Update S_j / vault / pool. Refresh the cached bests and sums.
5. **STP:** if any leg would be the taker's own order, apply the mode. For P2/P3, skip the pattern and fall back to P1 or rest, so a self-leg never creates an event-wide cancel cascade (INFERENCE).
6. **Rest** the remainder. Post-only rejects if a P1/P2/P3/AMM match exists. Assert I6 in debug builds.

**Complexity:** O(log B) to start the cursor, plus O(F·n) legs, with O(1) per P2/P3 availability check. Lock hold = transaction time. Throughput per event ≈ 1/txn: about 500/s measured for the binary P1 case (ARCH). Each P2/P3 fill adds roughly (n−1) × (order + position row) writes.

### 6.3 Batch mode (market open, close, thin markets, halts)

- **Call phase:** accept, amend and cancel; broadcast indicative price and volume (open call); a no-cancel window in the last w seconds; random end in the last r seconds.
- **Uncross, binary:** the §4.2 algorithm, O(K + L).
- **Uncross, exclusive:** §2.5, O(n·L·log Q) + O(K log K) allocation. Integral fills and integral prices with Σ = T, guaranteed by total unimodularity. Keep HiGHS (or a PL/pgSQL port of the m-search) as the reference in tests.
- **Tie-breaks:** maximum volume (welfare for exclusive), then minimum |imbalance|, then market pressure, then closest to reference, then lower price (determinism).
- **Allocation:** price, then seq. Integer lots only.
- **Post-uncross:** unfilled remainders rest in the continuous book (or roll into the next call). The first continuous trades must respect I6, and they do by construction.

### 6.4 AMM in the book

- One LMSR per event: n outcomes, liquidity b in lots, bounded loss b·ln n × face; subsidy schedule per R02/ARCH.
- Continuous: a virtual maker, with the §4.6 tick-step quantities (floor) and prices (far tick). The AMM account is an ordinary integer ledger account, so I2 covers it.
- Batch: step orders ≤ k ticks deep from the start-of-batch state, then an exact cost re-check (§4.6 caveat).
- Display the AMM depth as synthetic levels, clearly labelled.

### 6.5 Exactness guarantees (what CI must assert)

- **G1:** no division on any fill path; cash = px·lots.
- **G2:** I1b / I1m and pool equalities after every transaction (a reconciliation job plus CI fuzz).
- **G3:** fees are cumulative-ceil; per-order overcharge is < 1 cash unit (10⁻⁶ face).
- **G4:** settlement pays exactly T per winning lot (T/2 each for 50/50), so the pool drains to exactly 0. A void with cost-basis refunds needs an explicit rule for the vault's NO basket; owner decision (UNVERIFIED design).
- **G5:** I6 after every continuous transaction.
- **G6:** batch conservation `Σ payments − Σ receipts = T·ΔS`.
- **G7:** a differential test of the PL/pgSQL engine against a reference engine (the prototype in §9, or its successor), in the style of 071's 12,500-operation differential test.

### 6.6 Migration notes (INFERENCE; check against production before acting)

- `numeric(4,1)` cents → `int2` ticks at T = 10,000 is exact (37.5¢ → 3,750).
- `numeric(20,6)` shares → lots at LOTS = 100 is **lossy** if any position or order carries more than 2 decimals. The current budget code floors to 6 dp, so this is likely. Count such rows in a production snapshot first. Either choose LOTS = 10⁴ (cash unit becomes 10⁻⁸ face; per-row headroom 9.2·10¹⁰ face), or floor legacy dust into per-user dust balances. Owner decision.

---

## 7. Items that remain UNVERIFIED

- Every [S] item: the text came through the search tool, not the page. In particular:
  - the CFFEX 70 k / 200 k / < 100 µs figures (attribution to a specific cffex.com.cn page not re-confirmed);
  - the "2000 assets, 100,000 orders ≈ 1.1 s" flow-trading figure;
  - the exact article numbers of the SSE and SZSE rules.
- Whether Kalshi or Polymarket run P2/P3-style cross-outcome matching internally. Polymarket's on-chain exchange cannot: [C] `_validateTokenIds` allows one condition per match. Kalshi's internals are not public.
- The price-extraction step of the combinatorial algorithm (§2.5 step 2) was specified, not separately tested. Prices in the experiments came from LP duals.
- PL/pgSQL performance of P2/P3 and of the uncross was not measured; only CPython reference timings were.
- The continuous-vs-batch welfare ratio comes from a synthetic generator (Gaussian prices around a random probability vector, σ = 0.05, i.i.d. arrivals, no strategic timing).

---

## 8. Honest limits of this study

- The publisher blockade forced reliance on search summaries for all papers. Where the argument matters (TU, the P1–P3 completeness claim, conservation), I proved it or tested it directly instead of citing.
- Every experiment is single-threaded CPython on a shared 4-vCPU sandbox. Absolute times are indicative; the relative comparisons (LP vs combinatorial, numeric vs bigint) are like for like.

---

## 9. Experiments (code in `/tmp/claude-0/-home-user-kichiko/385cc00d-340c-5f67-955a-0a985fc3ce7d/scratchpad/k12exp/`)

### 9.1 `engine_multi.py`, `run_fuzz.py`: continuous exclusive-event engine

- Exact integers: T = 1000, lots, cash = ticks × lots.
- Canonical basis; P1/P2/P3 matching; optional collateral-return normalisation; STP switch.
- Invariants I1m′, collateral = S·T, I2, I4, non-negativity, and per-fill I7, all asserted.
- Result: 2,400,000 operations passed. The STP-off runs asserted zero residual crosses (I6).

### 9.2 `batch.py`, `extra.py`: uncross and joint clearing

- Binary uncross (3 rule chains) vs brute force, a conservation check, and timings.
- Exclusive LP (HiGHS via `scipy.optimize.linprog`), MILP, the combinatorial m-search, and the continuous-engine welfare ratio.
- Full results:

```
n, K, LP ms, MILP ms, comb ms, LP welfare, comb welfare, sum(duals), LP x integral?, continuous/batch
2, 100, 3.9, 9.7, 0.9, 360258, 360258, 1000.000, True, 0.7814
2, 1000, 7.6, 43.1, 5.2, 4678975, 4678975, 1000.000, True, 0.7911
2, 10000, 55.0, nan, 12.0, 45710661, 45710661, 1000.000, True, 0.7413
3, 100, 3.0, 6.0, 0.9, 524507, 524507, 1000.000, True, 0.7735
3, 1000, 8.5, 55.8, 5.9, 3777674, 3777674, 1000.000, True, 0.6753
3, 10000, 62.3, nan, 15.6, 44804987, 44804987, 1000.000, True, 0.6762
5, 100, 3.3, 7.7, 1.0, 578780, 578780, 1000.000, True, 0.9596
5, 1000, 8.3, 66.6, 6.0, 4465388, 4465388, 1000.000, True, 0.7389
5, 10000, 93.8, nan, 23.1, 41512143, 41512143, 1000.000, True, 0.6896
10, 100, 3.2, 7.9, 0.9, 227938, 227938, 1000.000, True, 0.4070
10, 1000, 15.6, 93.3, 6.2, 4149501, 4149501, 1000.000, True, 0.8107
10, 10000, 85.3, nan, 31.0, 41679941, 41679941, 1000.000, True, 0.6970
20, 100, 4.0, 10.5, 1.4, 50073, 50073, 1000.000, True, 0.9932
20, 1000, 11.4, 97.7, 6.1, 3021066, 3021066, 1000.000, True, 0.7797
20, 10000, 114.4, nan, 37.2, 37900564, 37900564, 1000.000, True, 0.6950
LP dual vectors non-integral: 0 of 24
```

### 9.3 `lmsr_table.py`: LMSR tick-step synthetic orders

Random paths (300 × 300 steps) plus an adversarial informed trader; results in §4.6.

### 9.4 `numbench.sql`: numeric vs bigint

Run on a throwaway local `supabase/postgres:17.6.1.011` container. No remote database was contacted. Results in §5.1.

---

## 10. References

**Source code and documents read directly [C]**
- Polymarket, ctf-exchange-v2 @ `ccc0596074f4dfd62c944fbca4de252893b82b4b` (2026-04-13): https://github.com/Polymarket/ctf-exchange-v2. Files `src/exchange/mixins/Trading.sol` (L78-147, 300-353, 385, 390-444, 540-575, 577-606, 623-674), `libraries/Structs.sol` (L30-84), `libraries/CalculatorHelper.sol` (L5-11), `mixins/Fees.sol` (L17, 44-51), `mixins/AssetOperations.sol` (L40-58).
- Polymarket, ctf-exchange (V1) @ `ed5c7708b7be3aa98bf5f0c6602b57cc498e2ef4`: https://github.com/Polymarket/ctf-exchange, `src/exchange/libraries/CalculatorHelper.sol` (L7-84), `mixins/Trading.sol` (L275-278).
- Polymarket, neg-risk-ctf-adapter @ `f78b35b0863b4308a431ca307d06f49b2ea65e78`: https://github.com/Polymarket/neg-risk-ctf-adapter, `src/NegRiskAdapter.sol` (L54-55, 244-356), `docs/NegRiskAdapter.md`.
- Gnosis, conditional-tokens-contracts @ `eeefca66eb46c800a9aaab88db2064a99026fde5`: https://github.com/gnosis/conditional-tokens-contracts, `contracts/ConditionalTokens.sol` (split, merge, redeem).
- CoW Protocol docs @ `068fe8c409644ba7b493bd88b04d3ee55772e879`: https://github.com/cowprotocol/docs, `docs/cow-protocol/concepts/introduction/fair-combinatorial-auction.md`, `reference/core/auctions/competition_rules.md`, `reference/core/auctions/the_problem.md`.
- SPEEDEX implementation @ `e4ca7c5c9a9c1885b0941850387899026d06721f`: https://github.com/scslab/speedex (`README.md`, `utils/price.h` PRICE_RADIX = 24, `orderbook/orderbook.cc` L519-552 rounding direction).
- PostgreSQL 17 docs, `doc/src/sgml/datatype.sgml` (REL_17_STABLE) L518-527, 627-634: https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/doc/src/sgml/datatype.sgml
- Kichiko repo (read-only): `supabase/migrations/045_clob_rounding_conservation.sql`, `071_clob_index_ordered_ladder.sql`; `docs/design/BRAIN-ARCHITECTURE-2026-09.md`; `docs/research/brain-2026-09/01..03`.

**Search-engine level [S]** (hosts blocked; see the tag note)
- Fortnow, Kilian, Pennock, Wellman. Betting Boolean-style. EC'03, DOI 10.1145/779928.779946; DSS 39(1):87-104 (2005). https://courses.cs.duke.edu/spring07/cps296.3/fortnow-dss-2004-compound-markets.pdf
- Chen, Fortnow, Nikolova, Pennock. Betting on permutations. EC'07, DOI 10.1145/1250910.1250957. https://courses.cs.duke.edu/spring12/cps173/ranking_securities.pdf
- Chen, Fortnow, Lambert, Pennock, Wortman. Complexity of Combinatorial Market Makers. EC'08, arXiv:0802.1362 (also R02).
- Agrawal, Wang, Ye. Parimutuel Betting on Permutations. WINE'08, arXiv:0804.2288.
- Peters, So, Ye. Pari-mutuel markets: mechanisms and performance (https://web.stanford.edu/~yyye/scpmfinal.pdf). Peters, Ye et al., A Convex Parimutuel Formulation for Contingent Claim Markets (https://web.stanford.edu/~yyye/cpcam-ec.pdf). US patent application 20090099955.
- Dudík, Lahaie, Pennock. A tractable combinatorial market maker using constraint generation. EC'12, DOI 10.1145/2229012.2229047.
- Kroer, Dudík, Lahaie, Balakrishnan. Arbitrage-free combinatorial market making via integer programming. EC'16, DOI 10.1145/2940716.2940767 (also R02).
- Heidari, Lahaie, Pennock, Wortman Vaughan. Integrating Market Makers, Limit Orders, and Continuous Trade in Prediction Markets. ACM TEAC 6(3-4), 2018, DOI 10.1145/3274643. https://www.cs.cmu.edu/~hheidari/heidari2015integrating.pdf
- Hanson. Logarithmic Market Scoring Rules for Modular Combinatorial Information Aggregation. J. Prediction Markets 1(1), 2007 (https://hanson.gmu.edu/mktscore.pdf). Hanson, Book Orders for Market Scoring Rules (2003).
- Ramseyer, Goel, Mazières. SPEEDEX. NSDI'23, https://www.usenix.org/system/files/nsdi23-ramseyer.pdf; arXiv:2111.02719.
- Ramseyer, Goyal, Goel, Mazières. Augmenting Batch Exchanges with Constant Function Market Makers. EC'24, DOI 10.1145/3670865.3673569; arXiv:2210.04929.
- Budish, Cramton, Shim. The HFT Arms Race: Frequent Batch Auctions. QJE 130(4), 2015. Budish, Cramton, Shim, Implementation Details for Frequent Batch Auctions, AER P&P 104(5):418-424, 2014, DOI 10.1257/aer.104.5.418.
- Budish, Cramton, Kyle, Lee, Malec. Flow Trading. NBER WP 31098 (2023). https://www.nber.org/papers/w31098
- Mastrolia, Xu. Clearing time randomization and transaction fees for auction market design. arXiv:2405.09764 (2024).
- Gebele, Mutzel, Matthes. Executable Arbitrage and Market Efficiency in Prediction Markets. arXiv:2608.00666 (2026-08-01).
- SoK: Market Microstructure for Decentralized Prediction Markets. arXiv:2510.15612.
- Betfair. Cross matching on Exchange markets. https://www.betfair.com.au/hub/help/cross-matching-on-exchange-markets/ ; Betfair Developer Forum, "Virtual Bets (Cross Matching) Algorithm".
- Kalshi. Get Market Orderbook (https://docs.kalshi.com/api-reference/market/get-market-orderbook); Fixed-Point Representation (https://docs.kalshi.com/getting_started/fixed_point_migration); Fee Rounding (https://docs.kalshi.com/getting_started/fee_rounding); Collateral Return (https://help.kalshi.com/trading/advanced-options/collateral-return).
- Polymarket. Neg-risk overview. https://docs.polymarket.com/developers/neg-risk/overview
- Euronext Trading Manual (e.g. https://www.euronext.com/sites/default/files/2023-03/Notice%204-01%20-%20Trading%20Manual.pdf). LSE MIT201 Guide to the Trading System 15.6 (https://docs.londonstockexchange.com/sites/default/files/documents/mit201-guide-to-the-trading-system-15_6_20240429.pdf).
- 上海证券交易所交易规则（2023年修订）(SSE Trading Rules, 2023 revision): http://www.sse.com.cn/lawandrules/sselawsrules2025/stocks/exchange/c/c_20250519_10779396.shtml. 深交所投教, 集合竞价成交价确定原则 (SZSE investor-education note on how the call-auction price is set): https://m.cls.cn/detail/1234472
- 上交所新一代交易系统正式运行 (SSE new-generation trading system enters formal operation): http://www.sse.com.cn/aboutus/mediacenter/hotandd/c/c_20150912_3988342.shtml. 上交所新债券交易系统上线 (SSE new bond trading system goes live): http://www.sse.com.cn/aboutus/mediacenter/hotandd/c/c_20211223_5666377.shtml. SSE 新竞价新综业 technical implementation guide v1.3 (2026-07).
- 解密深交所第五代交易系统 ("Decoding SZSE's fifth-generation trading system"): https://news.cnstock.com/news,zxk-201606-3811859.htm. 日交易4亿笔，秒交易30万笔 ("400 M trades a day, 300 k a second"): https://www.tmtpost.com/2404538.html. 深交所《新一代交易系统简介》: https://www.szse.cn/marketServices/technicalservice/introduce/P020191019360308096075.pdf
- 中金所新一代交易系统成功上线 (CFFEX new-generation trading system goes live, 2019-03-15): http://www.cffex.com.cn/jysdt/20190315/23680.html. 系统简介 (system introduction): http://www.cffex.com.cn/xtjj/
- JR/T 0145—2016 资本市场交易结算系统核心技术指标 (core technical indicators for capital-market trading and settlement systems): http://www.sse.com.cn/lawandrules/regulations/csrcannoun/c/10117497/files/d92b808c4edb46dc97111130a33bf4f9.pdf
