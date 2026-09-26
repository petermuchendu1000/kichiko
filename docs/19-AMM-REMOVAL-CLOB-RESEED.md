# 19 — AMM Removal & CLOB Reseed (runbook)

Status: **executed** on production (`postgres` @ project `uzkphkvzoeypcljntlih`).
Owner: platform / trading. Tool: `scripts/sim/reseed_amm_to_clob.py`.

## What & why

The platform is now **CLOB-only**. The legacy AMM/LMSR engine is retired: every
`pricing_engine='amm'` market was removed and replaced with a fresh, finquant-
simulated **CLOB** catalog. This completes the "use CLOB explicitly / remove AMM"
direction (order-book middleware fix #17, CLOB Sell + routing #18, AMM→CLOB RPC
guard #19, reseed tooling #20).

Before this migration the DB held 39 AMM markets (35 active + 4 resolved, incl. 5
recurring BTC up/down windows) alongside 7 CLOB markets. After: **0 AMM, 38 CLOB**
(7 pre-existing + 31 reseeded).

## Design decisions

* **Binary → single-option CLOB.** The order-book UI (`markets/[slug]/page.tsx`
  `clob` gate) only activates for `isMulti` markets. A `resolution_type='binary'`
  market falls back to the retired AMM panel (which the #19 guard now rejects with
  `P0120`). So each binary question is modelled as a `multiple_choice` +
  `independent` market with **one per-event option** — the Polymarket binary model
  — which the tested candidate-list UI and `clob_place_order`/`clob_get_book`
  engine support unchanged. Verified: single-option markets render identically to
  the pre-existing multi-outcome CLOB markets.
* **BTC up/down excluded.** The 5 recurring BTC windows are an AMM-only, time-
  windowed product (`btc_windows` + self-tick migration 024/029); they were
  removed, not recreated. `btc_series_config` / `btc_price_ticks` feed infra is
  left dormant (not FK'd to markets).
* **Existing 7 CLOB markets untouched.** All reseed simulation is scoped to the
  new catalog slugs only.

## Finquant simulation (scripts/sim/quant.py)

* **price_history** — `ou_logit_path`: OU mean-reversion in logit space toward a
  drifting fair value + AR(1) stochastic vol + rare Poisson jumps, loaded on a
  shared `market_factor_path` so the whole board co-moves on macro days. Each
  path is anchored so its endpoint equals the market's fair value.
* **clob_orders** — `clob_book`: geometric depth decay away from the mid + a
  bid/ask spread, multi-maker per level; YES asks emitted as BUY NO @ (100−a) per
  the migration-030 book contract.
* **clob_fills** — `taker_flow`: autocorrelated (herding) signed order flow over
  the trailing week; realistic direct/mint/burn mix.
* **positions** — whale→minnow holder distribution across the 60 demo traders,
  both Yes and No sides; aggregates (volume, bettors, option prices) recomputed
  from seeded rows.

## Run order

```bash
# writes: needs a non-production target (local, or its project ref listed in
# NONPROD_PROJECT_REFS) and the explicit flag (scripts/ops/destructive_guard.py)
SEED_DB_URL="postgresql://…:5432/postgres" NONPROD_PROJECT_REFS="<ref>" \
  python3 scripts/sim/reseed_amm_to_clob.py --i-know-this-is-not-prod all   # backup→remove→seed→simulate→verify
# or granular: backup | remove | seed | simulate | verify   (all idempotent)
```

Executed result (seed=2027): removed 39 markets (1310 positions, 7278 activity,
18739 price rows, 971 comments, 6 btc_windows); created 31 markets; simulated
1488 orders, 5580 fills, 8900 price points, 868 positions, 1725 activity rows.
DB size 47 MB.

## Verification (all green)

* `markets_by_engine = {clob: 38}` — zero AMM; zero positions on non-CLOB markets.
* `clob_get_book` returns a valid, **uncrossed** two-sided book for all 31 markets.
* Public book API `GET /api/markets/{id}/book?option=…&side=yes` → 200 with depth.
* Market pages → 200; UI renders candidate + Buy Yes/No identically to known-good
  CLOB markets; 0 console errors.
* Live engine invariant (rolled back) on a seeded market: market BUY fills via
  MINT and debits the wallet; SELL credits and reduces the position; the oversell
  guard (`P0113`) fires. Price-history bounds within 0.029–0.89; fills 8.4–82.2¢.

## Rollback / disaster recovery

A full pre-removal snapshot of every AMM market + dependents (markets, positions,
comments, market_activity, price_history, btc_windows) was taken to JSON BEFORE
the destructive step (`reseed_amm_to_clob.py backup`, and a separate exported
`amm_removal_backup.json.gz`). To restore, re-insert those rows from the snapshot.
The reseed itself is idempotent: re-running `seed`/`simulate` refreshes the
catalog deterministically (`--seed`) without duplicating.

## Follow-ups (technical debt)

* Delete dormant AMM/LMSR code paths (`place_bet*` RPCs, LMSR helpers) and the
  betting-panel/guided-flow AMM economics now that no market uses them. The #19
  DB guard keeps them safe in the meantime.
* Optional: vary maker spreads per market for richer microstructure (currently a
  uniform 1.2¢ top-of-book spread from `clob_book`'s default half-spread).
