# CLOB engine — deep audit & remediation (2026‑07)

Status: **complete.** Owner: platform. Scope: the per‑candidate Central Limit
Order Book (`clob_place_order`, `clob_cancel_order`, `clob_get_book`,
`clob_expire_orders`), its escrow/position/ledger accounting, the `/api/orders`,
`/api/orders/cancel`, `/api/markets/[id]/book` routes and `lib/clob.ts`.

This document is the definitive record of a rigorous, quant/finance‑grade audit
of the matching engine: what was tested, what was found, and how each defect was
fixed. All remediation shipped as sequential migrations `042`–`045`, each
behind CI and applied to the live database.

## 1. Methodology

Everything below was validated against the **live schema** inside **rolled‑back
transactions** (zero persistence), layered on the existing 20‑case two‑sided
harness (`scripts/ops/clob/test_two_sided.py`):

- **Invariant harness** — the pre‑existing 20 assertions (mint/direct/merge,
  self‑trade prevention, escrow exactness, over‑sell rejection, price‑time
  priority, share conservation).
- **Randomized fuzzer** — `scripts/ops/clob/fuzz_invariants.py`, thousands of
  random place/cancel ops across 6 users and 3 per‑candidate books, asserting
  the finance invariants continuously.

### Invariants asserted

| Id | Invariant |
|----|-----------|
| **I1** | per option, `Σ YES shares ≡ Σ NO shares` (mint +1/+1, merge −1/−1, direct transfer) |
| **CC** | global `Σ(user cash avail+reserved) + Σ(collateral = YES shares×$1)` is constant |
| **NEG** | no negative `available_balance`, `reserved_balance`, `shares`, or `reserved_shares` |
| **COSTBASIS** | every active position keeps `shares × avg_entry == total_invested` |
| **I3/I4** | price‑time priority; a user never matches their own resting order |

**Baseline (pre‑fix):** I1, NEG, I3, I4 held. CC drifted ~$0.27 / 4000 ops and
COSTBASIS was broken (21 positions off, worst **$115.67**).
**After remediation:** *all* invariants hold — CC shows **0 violations even at a
$0.005 threshold**, COSTBASIS is clean.

## 2. Findings & fixes

| # | Sev | Finding | Fix (migration) |
|---|-----|---------|-----------------|
| 1 | 🔴 CRITICAL | `clob_place_order`/`clob_cancel_order` were `SECURITY DEFINER`, granted to `anon`+`authenticated`, and trusted a caller‑supplied `p_user_id` with **no `auth.uid()` tie** → any caller (even anonymous) could trade/spend/cancel **as any user** via a direct PostgREST RPC. | **042** |
| 2 | 🟠 HIGH | **Market‑buy overspend** — API sized shares off the best ask only; the RPC then walked deeper (pricier) levels with no cost cap → a $60 budget spent $65. | **043** |
| 3 | 🟠 HIGH | **Cost‑basis corruption** — no sell path reduced `positions.total_invested_usd`, so avg cost / realized P&L / portfolio value drifted (worst $115). | **043** |
| 4 | 🟡 MED | **`min_order_size` never enforced** (computed then ignored) → dust‑order spam. | **043** |
| 5 | 🟡 MED | **Expired orders leaked escrow forever** — matcher/book exclude expired orders but nothing released their reserved cash/shares; no `expires_at > now()` validation. | **044** |
| 6 | 🟡 MED | **Cancel griefing** — same root cause as #1. | resolved by **042** |
| 7 | 🟡 MED/LOW | **Cash‑conservation drift** — wallets are `numeric(20,6)` but every wallet movement was rounded to 2dp, leaking ≤½¢/fill. | **045** |
| 8 | 🔵 NOTE | **Per‑market serialization** — every order takes `FOR UPDATE` on the market row, so all orders on a market are strictly serialized. Correct/safe, but caps per‑market throughput. See §4. | (recommendation) |

### 042 — authorization hardening (audit #1, #6)
- In‑function guard: in an end‑user session (`auth.uid()` present) the caller may
  act only as themselves, else `SQLSTATE P0121`. Server API calls run as
  `service_role` (`auth.uid()` NULL) and are unaffected.
- `REVOKE EXECUTE` from `PUBLIC`/`anon`/`authenticated`; `GRANT` only to
  `service_role`. `clob_get_book` stays public (aggregated depth, no identity
  leak). `lib/clob.ts` maps `P0121 → 403`.
- **Verified:** grants locked to `service_role`/`postgres`; guard blocks
  attacker→victim, allows self + service_role; harness green.

### 043 — settlement correctness (audit #2, #3, #4)
- **#2:** new `p_max_spend_usd` budget; each BUY fill is trimmed to what the
  remaining budget affords and the walk stops when spent. API passes
  `amount_local × rate`. (Signature change → old 11‑arg overload dropped and the
  042 lockdown re‑applied.)
- **#3:** every share‑reducing sale removes cost at the average entry price
  (`total_invested -= fill × avg_entry`), across all three sell paths
  (direct‑maker, merge‑maker, taker).
- **#4:** min‑order‑size enforced up‑front (limit / market‑buy notional) and
  post‑match for market sells → `SQLSTATE P0105` (`lib/clob.ts` maps to 400).
- **Verified:** $60 budget → $59.999999 spent; cost‑basis fuzz 21→**0** off;
  min‑size rejected; harness green; no I1/NEG regressions.

### 044 — expired‑order escrow sweeper (audit #5)
- `clob_expire_orders(p_limit)` — pure‑SQL sweeper releasing the exact unfilled
  escrow of due orders (mirrors `clob_cancel_order`) and marking them `expired`;
  `FOR UPDATE SKIP LOCKED` so it never contends with live matching; EXECUTE
  locked to `service_role`.
- Scheduled every minute via **pg_cron** (`clob-expire-orders`), same mechanism
  as `refresh-leaderboard`. `lib/clob.ts` rejects a past/instant `expires_at`.
- **Verified:** BUY cash + SELL shares released; orders flip to `expired`; cron
  job registered.

### 045 — cash‑conservation rounding (audit #7)
- Wallet movements rounded to **6dp** (the column scale) in `clob_place_order`,
  `clob_cancel_order`, `clob_expire_orders`; `clob_orders.reserved_usd` widened
  `numeric(20,2) → (20,6)` so reserve‑in and release‑out are symmetric.
- **Verified:** fuzz drift **0 violations at a $0.005 threshold** (was 90 at
  $0.10); cost‑basis clean; grants unchanged.

## 3. What was confirmed solid
Share conservation (mint/merge/direct), non‑negativity, strict price‑time
priority across the unified real+synthetic ladder, self‑trade prevention, and
atomic escrow/position/transaction/fill/price‑history writes under row locks —
all held across every fuzzed operation, before and after the fixes.

## 4. Remaining recommendations (non‑defects)
1. **#8 Throughput** — the `SELECT … markets FOR UPDATE` at the top of
   `clob_place_order` serializes all orders on a market. It is the simplest
   correct concurrency model and prevents deadlocks, but caps per‑market order
   throughput. If a single hot market becomes a bottleneck, narrow the lock to
   the `(market_option_id)` book row and move the `markets` volume/stat rollups
   to a deferred aggregate, so independent candidate books trade in parallel.
2. **Abuse prevention** — a per‑user max‑open‑orders cap and an order‑rate limit
   (the architecture doc's Phase‑2 item) are still open; add them at the API
   layer or as an in‑RPC count check when order‑spam becomes a concern.
3. **Server‑side FX staleness** — orders trust `exchange_rates`; ensure the FX
   refresh cron alerts on staleness so a frozen rate can't mis‑price escrow.

## 5. Regression tooling
- `scripts/ops/clob/test_two_sided.py` — 20‑case invariant harness.
- `scripts/ops/clob/fuzz_invariants.py` — randomized property fuzzer (I1/CC/NEG/
  cost‑basis). Supports `APPLY_MIG=…` to fuzz a candidate migration before it
  lands. Both run in rolled‑back transactions.

Run: `SEED_DB_URL=… python3 scripts/ops/clob/fuzz_invariants.py` (env: `FUZZ_N`,
`FUZZ_SEED`, `DRIFT_TOL`).
