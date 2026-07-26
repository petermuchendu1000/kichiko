# Polymarket Protocol Primitives — First Principles (Byte-Level Ground Truth)

> Part of the [Polymarket Research Corpus](./README.md). This is the **deepest layer**: the
> on-chain cryptographic identifiers, the EIP-712 order object, matching, fees, and auth —
> reproduced from canonical contract source and **verified against live data**, not paraphrased.
>
> **Verification harnesses** (runnable, in this toolkit):
> [`verify_conditionid.py`](../../../tools/polymarket-research/verify_conditionid.py) ·
> [`verify_tokenid.py`](../../../tools/polymarket-research/verify_tokenid.py).
> Snapshot: 2026-07-22 14:42 UTC, 596 markets with complete identifiers.

---

## 0. TL;DR — what we proved from raw bytes

| Primitive | Formula | Empirical result |
|-----------|---------|------------------|
| **conditionId** | `keccak256(abi.encodePacked(oracle, questionId, uint256 outcomeSlotCount))` | **295/295** standard markets match (100%); **0/301** neg-risk (different scheme) |
| **collectionId** | alt_bn128 hash-to-point of `keccak256(conditionId, indexSet)` | (intermediate; see §2.2) |
| **positionId** (= CLOB `clobTokenId`) | `uint256(keccak256(abi.encodePacked(collateral, collectionId)))` | **299/299** standard markets match both YES+NO tokens (100%); 0/301 neg-risk |
| **fee** | `fee = C · feeRate · p · (1−p)` (taker-only) | **10/10** points match published fee tables |

The complete on-chain identity of every *standard* Polymarket market — from oracle+question all
the way to the two ERC-1155 token IDs traded on the CLOB — is reproducible deterministically.

---

## 1. The stack, bottom to top

```
Polygon PoS (chainId 137)
  └── USDC.e collateral  (0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174, 6 decimals)
        └── Gnosis Conditional Token Framework (CTF)  → ERC-1155 outcome tokens
              └── CTF Exchange (EIP-712 signed orders, atomic settlement)
                    └── off-chain CLOB operator (matching, order book, price/time priority)
                          └── Gamma / CLOB / Data REST APIs  (public reads)
```

### 1.1 Canonical contracts (Polygon mainnet, chainId 137)

| Contract | Address | Role |
|----------|---------|------|
| **CTF Exchange V2** | `0xE111180000d2663C0091e4f400237545B87B996B` | EIP-712 order settlement (standard markets) |
| **Conditional Tokens (CTF)** | Gnosis CTF | ERC-1155 outcome tokens; split/merge/redeem |
| **Collateral (USDC.e)** | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` | positionId collateral (empirically verified) |
| **Collateral token (V2 proxy)** | `0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB` | V2 collateral / reward asset (`sampling-simplified-markets.rewards.asset_address`) |
| **NegRiskCtfCollateralAdapter** | `0xadA2005600Dec949baf300f4C6120000bDB6eAab` | current neg-risk collateral adapter (old Neg Risk Adapter retired 2026-07-17) |

**Resolution oracles/adapters actually observed** in the snapshot (`market.resolvedBy`):

| Address | Markets | Note |
|---------|--------:|------|
| `0x65070BE91477460D8A7AeEb94ef92fe056C2f2A7` | 292 | standard UMA CTF adapter |
| `0x69c47De9D4D3Dad79590d61b9e05918E03775f24` | 191 | neg-risk-associated adapter |
| `0x2F5e3684cb1F318ec51b00Edba38d79Ac2c0aA9d` | 110 | adapter variant |
| `0x157Ce2d672854c848c9b79C49a8Cc6cc89176a49` | 3 | adapter variant |

> The `oracle` used inside `getConditionId` for a **standard** market **is** its `resolvedBy`
> address — this is exactly why our 295/295 verification passes (see §2.1).

---

## 2. Identifier cryptography (verified)

Source of truth: Gnosis `CTHelpers.sol`. Reproduced in Python; matched against live IDs.

### 2.1 conditionId — VERIFIED 295/295 (standard)

```solidity
function getConditionId(address oracle, bytes32 questionId, uint outcomeSlotCount)
    returns (bytes32) {
    return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
}
```

- `abi.encodePacked(address, bytes32, uint256)` = **20 + 32 + 32 = 84 bytes**, keccak-256'd.
- For binary markets `outcomeSlotCount = 2`.
- **Neg-risk markets fail this formula (0/301)** because their conditions are prepared by the
  Neg Risk machinery (wrapped collateral + adapter-supplied oracle/questionId), *not* by the
  raw `resolvedBy`. This is a clean, empirical way to detect neg-risk from bytes alone.

### 2.2 collectionId — alt_bn128 hash-to-point

For a top-level market `parentCollectionId = 0`. Outcome `i` uses an **indexSet bitmask**:
outcome 0 → `0b01 = 1`, outcome 1 → `0b10 = 2`.

```
P = 21888242871839275222246405745257275088696311157297823662689037894645226208583   # bn128 field
B = 3                                                                                # curve: y² = x³ + 3

x1   = uint256(keccak256(abi.encodePacked(conditionId, indexSet)))
odd  = (x1 >> 255) != 0                       # remember the sign bit
do:                                            # find the smallest x on-curve ≥ x1+1
    x1  = (x1 + 1) mod P
    yy  = (x1³ + B) mod P
    y1  = sqrt(yy)                             # see note
while (y1² mod P != yy)
if (odd XOR (y1 is odd)):  y1 = P − y1         # pick the correct branch
# parentCollectionId==0 ⇒ skip the ecAdd(precompile 0x06) step
if (y1 is odd):  x1 ^= (1 << 254)              # pack parity into bit 254
collectionId = bytes32(x1)
```

- **`sqrt` note:** `P mod 4 == 3` (verified), so the modular square root is the closed form
  `sqrt(a) = a^((P+1)/4) mod P` — no Tonelli–Shanks needed. The on-chain assembly is an
  addition-chain that computes exactly this exponent.
- The top two bits of `x1` are **flags** (sign + parity), not coordinate data — a subtle,
  easy-to-miss detail that breaks naive implementations.

### 2.3 positionId (= CLOB clobTokenId) — VERIFIED 299/299 (standard)

```solidity
function getPositionId(IERC20 collateral, bytes32 collectionId) returns (uint) {
    return uint(keccak256(abi.encodePacked(collateral, collectionId)));   // 20 + 32 = 52 bytes
}
```

- `collateral = USDC.e (0x2791…4174)` — **empirically the collateral that reproduces live token
  IDs** (299/299). The uint256 result **is** the `clobTokenIds[i]` returned by Gamma and the
  `token_id` used by every CLOB per-token endpoint.
- End-to-end, deterministically: `(oracle, questionId) → conditionId → collectionId(indexSet)
  → positionId → clobTokenId`. Run `verify_tokenid.py` to reproduce.

---

## 3. The order object (EIP-712)

Every trade is a signed `Order`. Type hash from `OrderStructs.sol` (CTF Exchange):

```
ORDER_TYPEHASH = keccak256(
 "Order(uint256 salt,address maker,address signer,address taker,uint256 tokenId,"
 "uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,"
 "uint256 feeRateBps,uint8 side,uint8 signatureType)")
```

| Field | Type | Meaning |
|-------|------|---------|
| `salt` | uint256 | random entropy → unique order hash |
| `maker` | address | source of funds (the account whose balance moves) |
| `signer` | address | who signed (may differ from maker for proxy/Safe) |
| `taker` | address | allowed counterparty; **`0x0` = public order** |
| `tokenId` | uint256 | the ERC-1155 outcome token (BUY: asset bought; SELL: asset sold) |
| `makerAmount` | uint256 | max the maker gives (base units, 6 dp) |
| `takerAmount` | uint256 | min the maker receives (base units, 6 dp) |
| `expiration` | uint256 | unix seconds; 0 = no expiry (GTC) |
| `nonce` | uint256 | on-chain cancellation nonce |
| `feeRateBps` | uint256 | fee rate (bps) bound to the order |
| `side` | uint8 | `BUY = 0`, `SELL = 1` |
| `signatureType` | uint8 | see below |
| `signature` | bytes | the EIP-712 signature (not part of the hash) |

**SignatureType enum:** `EOA = 0` (ECDSA), `POLY_PROXY = 1` (Polymarket proxy wallet),
`POLY_GNOSIS_SAFE = 2` (Safe), `POLY_1271 = 3` (EIP-1271 contract signatures).

### 3.1 Price & amount economics (the core math)

Amounts are in **6-decimal base units** (USDC.e and outcome shares both use 6 dp). Price is the
implied probability in `[tick, 1−tick]`.

```
BUY  (buying shares with USDC):  makerAmount = USDC in,  takerAmount = shares out
     price = makerAmount / takerAmount
SELL (selling shares for USDC):  makerAmount = shares in, takerAmount = USDC out
     price = takerAmount / makerAmount
```

**Worked example** — BUY 10 shares of a YES token at price 0.50, tick 0.01:
`makerAmount = 10 × 0.50 = 5.00 USDC = 5_000_000` base units; `takerAmount = 10 shares =
10_000_000`; `price = 5_000_000 / 10_000_000 = 0.50` ✓. Price must be a multiple of the market
`tick` (0.001 or 0.01 — see [03](./03-MARKET-MICROSTRUCTURE.md)); size ≥ `orderMinSize` (~$5).

### 3.2 Matching semantics — `MatchType`

The exchange settles a taker order against makers in one of three ways (from `OrderStructs.sol`):

| MatchType | What happens | When |
|-----------|--------------|------|
| **COMPLEMENTARY** | direct token↔token transfer (YES buyer ⇄ YES seller) | both sides trade the same token |
| **MINT** | collateral is **split** into a full YES+NO set to satisfy two opposing buyers | BUY YES matched with BUY NO |
| **MERGE** | a YES+NO set is **merged** back to collateral to satisfy two opposing sellers | SELL YES matched with SELL NO |

This is why a "buy YES" can be filled even when no one is *selling* YES: the exchange mints a
set (MINT) by pairing your BUY-YES with someone's BUY-NO. It is the on-chain expression of the
`P(YES) + P(NO) = 1` duality measured at 100%/97.25% in [04 §3](./04-QUANT-PROCESSING.md).

### 3.3 Order types

| Type | Class | Behavior |
|------|-------|----------|
| **GTC** | limit | rests until filled/cancelled (default) |
| **GTD** | limit | rests until `expiration`; auto-expires **60 s early** (security threshold); must be **≥ 3 min** in the future or rejected |
| **FOK** | market | fill **entirely** immediately or cancel |
| **FAK** | market | fill what's available now, cancel the rest |

Market orders are limit orders with a **marketable / worst-price** limit for slippage protection
(BUY specifies USDC to spend; SELL specifies shares).

---

## 4. Fees — VERIFIED against published tables (10/10)

```
fee = C × feeRate × p × (1 − p)        # C = shares traded, p = share price
```

- **Taker-only** (makers pay 0; fees fund maker rebates). Applied by the protocol at match time —
  you do **not** put the fee in the order (the on-order `feeRateBps` bounds it).
- **Symmetric about p = 0.5**: a fill at 30¢ costs the same USDC as at 70¢ (since `p(1−p)` is
  symmetric); the dollar fee **peaks at p = 0.5**.
- **Rounded to 5 dp**; minimum charge **0.00001 USDC**; smaller rounds to 0.
- **Per-category taker rate** (verified reproducing the tables): Crypto 0.07 · Sports 0.05 ·
  Finance 0.04 · Politics 0.04 · Economics 0.05 · Culture 0.05 · Weather 0.05 · Tech 0.04 ·
  Mentions 0.04 · Other 0.05 · **Geopolitics 0.00 (fee-free)**.
- Query live per-market fee via `getClobMarketInfo(conditionId)` → `fd = { r: rate, e: exponent,
  to: takerOnly }`. Markets with fees have `feesEnabled = true`.

**Verification:** Crypto p=0.5 → `100·0.07·0.25 = 1.75` ✓; Finance p=0.5 → `100·0.04·0.25 = 1.00`
✓; Sports p=0.25 → `100·0.05·0.1875 = 0.94` ✓ (matches the published 100-share tables exactly).

---

## 5. Authentication (CLOB trading only)

Two levels; reads (Gamma/Data/CLOB books) need **none**.

### 5.1 L1 — private key (EIP-712)
Sign an EIP-712 message with the wallet key. **Used to create/derive** API credentials and to
**sign each order** locally. Non-custodial: the key never leaves the user.

### 5.2 L2 — API key (HMAC-SHA256)
Credentials `{ apiKey, secret, passphrase }` (derived from L1 + a **nonce** — save the nonce or
the creds are unrecoverable). Every authenticated request carries **5 headers**:

| Header | Value |
|--------|-------|
| `POLY_ADDRESS` | the wallet address |
| `POLY_API_KEY` | the api key (uuid) |
| `POLY_PASSPHRASE` | the passphrase |
| `POLY_TIMESTAMP` | unix seconds |
| `POLY_SIGNATURE` | `base64url(HMAC_SHA256(secret, timestamp + method + requestPath + body))` |

> Even with valid L2 headers, order-**creating** calls still require the per-order EIP-712
> signature (§3) — L2 authenticates the *request*, L1 authorizes the *funds*.

### 5.3 Heartbeat
Trading sessions post a rolling `heartbeat_id` (empty string on first call); an expired ID
returns `400` with the correct ID to retry.

---

## 6. Why this matters for Kichiko (first-principles parity)

1. **You cannot fake identity.** If Kichiko ever mirrors or reconciles against Polymarket,
   store `condition_id` + `clob_token_id` as external keys and **validate them with the
   derivation above** — a cheap integrity gate that catches ingestion corruption instantly.
2. **The MINT/MERGE insight drives the matching engine.** A credible internal CLOB must be able
   to fill BUY-YES against BUY-NO by minting a set (and the reverse by merging) — not just
   COMPLEMENTARY token↔token matches. This is the mechanism that keeps `Σ price = 1` true and
   liquidity efficient. Kichiko `clob_fills.match_kind` should encode `complementary | mint |
   merge`.
3. **Fees are a smooth `p(1−p)` curve, not a flat %.** Port the exact formula (taker-only,
   symmetric, 5-dp rounding, per-category rate, geopolitics free) into fill accounting
   (`orders.fee_usd`, `commission_plans`) — a flat bps fee is visibly wrong near the extremes.
4. **Amounts are 6-dp integers; price is tick-quantized.** Do arithmetic in integer base units
   and quantize price to the market tick to avoid float drift in P&L and settlement.
5. **Auth separates request-auth (L2/HMAC) from fund-auth (L1/EIP-712).** Even a centralized
   build benefits from this separation: session/api-key auth for requests, a distinct
   authorization step for balance-moving actions.
