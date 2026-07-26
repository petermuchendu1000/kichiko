# Resolution, Conditional Tokens & Negative Risk — Ground Truth

> Part of the [Polymarket Research Corpus](./README.md). Protocol mechanics from official docs
> (`docs.polymarket.com/concepts/resolution`, `/advanced/neg-risk`, `/trading/ctf`),
> cross-checked against live fields (`umaBond`, `umaReward`, `umaResolutionStatuses`,
> `negRisk`, `negRiskRequestID`, `conditionId`).

---

## 1. Conditional Token Framework (CTF)

Polymarket outcome positions are **Gnosis CTF ERC-1155 tokens** collateralized 1:1 by USDC.

| Operation | Input                         | Output                                  | When |
|-----------|-------------------------------|-----------------------------------------|------|
| **Split** | $N USDC                       | N YES + N NO tokens                     | mint a full set to provide/inventory both sides |
| **Merge** | N YES + N NO                  | $N USDC                                 | redeem a complete set back to cash (exit) |
| **Redeem**| winning tokens (post-resolve) | $1 each; losing tokens → $0             | after resolution |

**Invariant:** 1 YES + 1 NO = $1 at all times (a complete set is fungible with a dollar). This
is the on-chain enforcement of the **no-arbitrage duality** measured empirically at
100% / 97.25% coherence in [04-QUANT-PROCESSING § 3](./04-QUANT-PROCESSING.md).

Trading only ever moves **one leg**; split/merge move both. A CLOB "buy YES" is either matched
against a resting YES ask *or* synthesized by split-then-sell-NO — the exchange abstracts this.

---

## 2. Resolution via UMA's Optimistic Oracle

Polymarket does **not** resolve its own markets. Each market carries pre-defined resolution
rules (`resolutionSource`, `endDate`, edge cases) and finalizes through **UMA's Optimistic
Oracle**, escalating to the **DVM** (Data Verification Mechanism, a token-holder vote) only on
dispute.

### 2.1 Three resolution paths

| Path            | Flow                                                        | Latency (typical) |
|-----------------|------------------------------------------------------------|-------------------|
| **No dispute**  | Propose → Resolve                                           | ~2 hours          |
| **One dispute** | Propose → Challenge → re-Propose → Resolve                 | +hours            |
| **Two disputes**| Propose → Challenge → re-Propose → Challenge → **DVM vote**| ~48–96 hours      |

### 2.2 Bond economics (from docs)

- **Proposer** selects the winning outcome and posts a bond (**~$750 pUSD** typical) to the
  Oracle. Fields `umaBond` / `umaReward` expose the per-market values.
- **Disputer** posts a matching counter-bond within the **~2-hour challenge window**.
- On dispute escalation: **24–48h** evidence/debate (UMA Discord), then **~48h** DVM vote.
- **Payouts:** winner recovers their bond **+ half** the loser's bond.
- **Edge outcomes:** *Too Early* (event not concluded) → disputer refunded + half proposer bond;
  *Unknown / 50-50* → each token redeems for **$0.50**.

### 2.3 Aftermath

Trading halts; winning tokens redeem for **$1** via the CTF collateral adapter (burns ERC-1155,
returns pUSD); losing tokens are worthless. `umaResolutionStatuses` tracks the live state.

> **Parity lesson:** resolution is an **external, adversarial, time-boxed, appealable** process.
> Even a centralized clone should model it as a *state machine with an audit trail and a
> dispute window*, not a single admin boolean. Kichiko centralizes resolution
> (`markets.status`, `resolved_outcome`, `resolver_id`, `resolution_notes`, `audit_log`,
> `resolution_flagged_at`) — the right primitives exist; the discipline is to enforce the
> window + dual-control + immutable audit.

---

## 3. Negative Risk (neg-risk) — capital-efficient multi-outcome

**50.17%** of the live universe is `negRisk: true`. Neg-risk links the mutually-exclusive
outcomes of one event so capital isn't wasted holding redundant NO positions.

### 3.1 The conversion

Via the **Neg Risk Adapter** contract, atomically:

```
hold 1 NO(outcome_k)  ──convert──▶  receive 1 YES(outcome_j) for every j ≠ k
```

Economic identity: **NO on outcome k ≡ YES on the union of all other outcomes**. This makes
`Σ P(YESᵢ) = 1` the multi-outcome generalization of the binary `P(YES)+P(NO)=1` invariant.

### 3.2 Augmented neg-risk (outcomes added after launch)

Requires both `negRisk` **and** `enableNegRisk`. Supports:
- **Named** outcomes (e.g. specific candidates),
- **Placeholder** reserved slots (fill in later),
- an explicit **"Other"** bucket (`negRiskOther`) capturing the uncategorized tail.

Separate contracts are used: **Neg Risk Adapter** + **Neg Risk CTF Exchange**;
`negRiskRequestID` ties a market to its neg-risk group.

> **Parity lesson & gap:** Kichiko models multi-outcome markets (`market_options`,
> migrations `020`, `023`) but has **no neg-risk conversion economics** (NO→YES-of-others) and
> no explicit mutual-exclusivity constraint enforcing `Σ price = 1` across options. For true
> parity on multi-candidate events, add (a) a group-level `Σ price = 1` invariant, (b) an
> "Other" bucket option, and (c) — if AMM-priced — a shared-liquidity coupling so option
> prices move coherently. Tracked in [06](./06-KICHIKO-GROUND-TRUTH-MAPPING.md).

---

## 4. Fees & incentives that shape resolution-era behavior

- **Maker rebates / liquidity rewards** (`rewardsMinSize`, `rewardsMaxSpread`) and a documented
  **~4% annualized holding reward** on eligible position value (sampled hourly, paid daily)
  incentivize resting liquidity *right up to* resolution — which is why books stay deep even on
  near-decided markets (recall the 0.9985-mid market holding **$7.73M** within 5¢).
- Per-market fee config: `feesEnabled`, `feeType`, `feeSchedule`, `makerBaseFee`, `takerBaseFee`.
  A parity build must store fee config per market and apply it in fill accounting
  (Kichiko: `commission_plans`, `platform_fee_rate`, `orders.fee_usd`).
