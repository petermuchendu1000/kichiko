# Polymarket Research Corpus — Ground Truth

**Purpose.** A rigorous, empirical, reproducible technical analysis of Polymarket's markets,
data model, market microstructure, quantitative processing, and resolution mechanics — to serve
as the **ground truth** for building and calibrating Kichiko.

**Method.** Every empirical claim is backed by a **live snapshot** of Polymarket's four public
APIs, collected and analyzed by the toolkit in
[`/tools/polymarket-research`](../../../tools/polymarket-research/README.md). Protocol/contract
claims are sourced from official docs (`docs.polymarket.com`) and cross-checked against live
responses. Numbers trace to `tools/polymarket-research/data/stats.json`.

> **Snapshot provenance:** 2026-07-22 14:42 UTC · 600 order-book markets · 200 events ·
> 140 markets with full L2 books (**218 outcome-token books**). Point-in-time; re-run to refresh.

---

## Documents

| # | Doc | Covers |
|---|-----|--------|
| 00 | [Protocol Primitives (First Principles)](./00-PRIMITIVES-AND-PROTOCOL.md) | **Byte-level ground truth**: conditionId/collectionId/positionId cryptography (verified 100%), contracts, EIP-712 Order struct, MINT/MERGE matching, fee formula (verified), L1/L2 auth |
| 01 | [System Architecture](./01-SYSTEM-ARCHITECTURE.md) | Hybrid-decentralized CLOB, 4 public APIs, on-chain substrate (Polygon/CTF/UMA), trading params, parity lessons |
| 02 | [Data Model](./02-DATA-MODEL.md) | Event→market→token hierarchy, identifier graph, full 89-field Gamma enumeration, book/history/holders schemas, Kichiko mapping |
| 03 | [Market Microstructure](./03-MARKET-MICROSTRUCTURE.md) | Spreads, depth, book shape, tick lattice, volume↔liquidity — empirical |
| 04 | [Quantitative Processing](./04-QUANT-PROCESSING.md) | Price=probability pipeline, favorite-longshot structure, no-arbitrage, walk-the-book, volatility |
| 05 | [Resolution, CTF & Neg-Risk](./05-RESOLUTION-CTF-NEGRISK.md) | UMA optimistic oracle, split/merge/redeem, negative-risk conversion, fees/incentives |
| 06 | [Kichiko Mapping & Gaps](./06-KICHIKO-GROUND-TRUTH-MAPPING.md) | Live schema alignment, prioritized parity gaps, numeric targets, proposed migrations |

---

## Headline findings (all live-verified)

0. **On-chain identity is reproducible from raw bytes.** We re-derived Polymarket's identifiers
   from canonical CTF source and matched them against live data: `conditionId` **295/295** and
   full YES/NO `clobTokenId` derivation **299/299** for standard markets (100%); **0/301** for
   neg-risk (different scheme — a clean byte-level neg-risk detector). Fee formula
   `C·rate·p·(1−p)` verified **10/10** vs published tables. See [00](./00-PRIMITIVES-AND-PROTOCOL.md).
1. **Architecture.** Polymarket = off-chain CLOB matching + **atomic on-chain settlement**
   (CTF Exchange on Polygon) + **UMA** resolution. Reads are fully public; only trading is
   authenticated. Three cleanly separable planes: matching / settlement / resolution.
2. **The universe is longshot-dense & power-law.** Median YES price **0.085**; **46%** of
   markets price YES in **[0, 0.05]**; 24h-volume mean is **3.4×** its median. Precision and
   caching must be built for the [0,0.10] band and the volume tail.
3. **Books are deep and tight.** Median **93** price levels per outcome token; median
   top-of-book spread **0.2¢** (often one tick wide); median **$38.8k** resting within 5¢ of mid
   (flagships hold **$7M+**).
4. **No-arbitrage holds empirically.** `P(YES)+P(NO)` is within 1% of 1.0 for **100%** of
   markets (Gamma) and **97.25%** from independently-fetched live books — a strong integrity
   signal and a cheap ingestion invariant.
5. **Half the universe is multi-outcome.** **50.17%** of markets are `negRisk`, using
   capital-efficient NO→YES-of-others conversion; the binary duality generalizes to `Σp=1`.
6. **Tick matters.** 64.7% of markets quote to **0.001** (0.1¢); cents-only math corrupts the
   majority of the universe.
7. **Parity is about data fidelity, not protocol.** Kichiko is a centralized fiat clone; the
   actionable gaps are sub-cent precision, per-market tick/min-size, `Σp=1` invariants,
   neg-risk economics, and depth-aware order preview (see [06](./06-KICHIKO-GROUND-TRUTH-MAPPING.md)).

---

## Reproduce

```bash
cd tools/polymarket-research
pip install -r requirements.txt
python collect.py --markets 600 --events 200 --books 140   # refresh live snapshot
python analyze.py                                           # recompute stats + charts
python verify_conditionid.py                               # verify conditionId derivation (100% standard)
python verify_tokenid.py                                   # verify clobTokenId derivation end-to-end
python -c "import verify_tokenid as v; v.run_full_snapshot()"   # full-snapshot match rates
```

Raw snapshots are stored compressed (`data/*.json.gz`); derived numbers in `data/stats.json`;
charts in [`./assets`](./assets). The analysis is deterministic given a snapshot.

---

## Caveats & follow-ups

- **Point-in-time.** Prices/liquidity drift; conclusions about *structure* are stable, absolute
  numbers are snapshot-specific.
- **Favorite–longshot bias** requires resolved-outcome calibration data (documented follow-up in
  [04 § 7](./04-QUANT-PROCESSING.md)); this pass establishes the longshot-dense prior, not the
  calibration curve.
- **Contract-level** claims (exact addresses, delay constants) are from docs; on-chain
  verification against Polygon is a further step if byte-level parity is ever required.
