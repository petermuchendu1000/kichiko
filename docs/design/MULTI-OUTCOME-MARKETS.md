# Multi-Outcome Markets — System Design & Evolution Dossier

Status: **Design approved for phased implementation** · Owner: Platform Eng · Module: 3.x (Markets Engine)

This dossier evolves the Kichiko prediction engine from **binary (YES/NO)** to
**true multi-outcome** markets (N mutually-exclusive options), without breaking the
live binary path. It is the source of truth for the data model, business logic,
API, migration, rollout, and the cross-cutting engineering concerns below.

---

## 1. Problem & Requirements

### 1.1 Current state (binary, hard-wired)
- `markets.yes_price` / `no_price`, `yes_volume_usd` / `no_volume_usd`.
- `order_side` / `position_side` enums = `('yes','no')`.
- `positions.side`, `orders.side` are `order_side`.
- `place_bet(..., p_side order_side, ...)` — 2-outcome LMSR (`lmsr_price(q_yes,q_no,b)`).
- `resolve_market(p_market_id, p_outcome order_side)` — pays positions where `side = outcome`.
- `market_resolution_type` enum already has `'multiple_choice'`, and a
  `market_options` table exists — but neither is wired into the hot path.

### 1.2 Functional requirements
- FR1. A market MAY have **2..N** mutually-exclusive outcomes (N default cap = 12).
- FR2. Binary markets remain a first-class, unchanged special case (2 outcomes: YES/NO).
- FR3. Users place a bet on **one option**; pricing updates all option prices so
  Σ price = 1 (proper probability simplex).
- FR4. Resolution designates exactly **one winning option**; holders of that option
  are paid `shares × $1`, losers forfeit stake (parimutuel-consistent with binary).
- FR5. Cancellation refunds all option holders their net stake (unchanged semantics).
- FR6. Portfolio, price history, activity, admin consoles, and analytics all read a
  **single normalized outcome model** regardless of binary vs multiple_choice.

### 1.3 Non-functional requirements
- NFR1. **Backward compatible**: existing binary markets/positions/RPCs keep working
  unchanged; migration is additive (no destructive column drops).
- NFR2. **Atomicity**: bet + resolution remain single-transaction, row-locked, race-safe.
- NFR3. **Numerical integrity**: prices ∈ [0,1], Σ prices = 1 ± ε; money in `DECIMAL`,
  never float, at rest and in RPCs.
- NFR4. **Observability**: every bet/resolution emits structured logs + audit rows.
- NFR5. **Gradual rollout** behind a feature flag; instant rollback with no schema revert.

---

## 2. Architecture & System Design

### 2.1 Domain model — the Outcome abstraction
Introduce a canonical `Outcome` read-model that the entire app consumes:

```
Outcome { id, key, label, price∈[0,1], volumeUsd, isWinner|null, displayOrder }
```

- **Binary market** → two synthesized outcomes: `YES @ yes_price`, `NO @ no_price`
  (derived from existing columns; zero migration for binary rows).
- **Multiple-choice market** → rows of `market_options`, ordered by `display_order`.

This normalization lives in `apps/web/lib/markets/outcomes.ts` (pure, unit-tested),
so UI/API never branch on resolution type. **Anti-corruption layer** = the only place
that knows about the binary↔multi difference.

### 2.2 Pricing — generalized LMSR
Binary uses `lmsr_price(q_yes,q_no,b)`. Generalize to the standard multi-outcome LMSR:

```
price_i = exp(q_i / b) / Σ_j exp(q_j / b)      (Σ price_i = 1 by construction)
cost(q)  = b · ln( Σ_j exp(q_j / b) )
```

- `b` (liquidity) derived from `liquidity_pool_usd` as today.
- A buy on option *i* increases `q_i` by net USD; prices recomputed and persisted to
  `market_options.price`; `markets.yes_price/no_price` kept in sync for binary.
- Numerically stabilized with a max-subtraction (`exp(q_i-qmax)`) to avoid overflow.

### 2.3 Component / data flow
```
Client ──► /api/markets/[id]/bet ──► RPC place_bet_option(market, option, amount)
                                        │ locks market + wallet
                                        │ multi-LMSR reprice → market_options.price[]
                                        │ upsert positions(market_option_id)
                                        │ transactions + price_history + market_activity
                                        ▼
Resolution ► admin ► resolve_market_options(market, winning_option)
                                        │ pay option holders, mark is_winner
                                        ▼
Read path ► normalizeOutcomes(market, options) ► UI / portfolio / analytics
```

---

## 3. Database Design & Data Modeling (migration `020_multi_outcome_markets.sql`)

Additive only. All column adds are `IF NOT EXISTS`.

- `markets.resolved_option_id UUID REFERENCES market_options(id)` — winning option for
  multiple_choice (binary keeps `resolved_outcome`).
- `market_options` gains: `q_shares DECIMAL(20,6)` (LMSR inventory), `total_invested_usd`,
  `is_active BOOLEAN`, `updated_at`, and a `UNIQUE(market_id, display_order)`.
- `positions.market_option_id UUID` (nullable; binary rows stay NULL) + partial unique
  index `(user_id, market_id, market_option_id)` where option is not null.
- `orders.market_option_id`, `transactions.market_option_id`,
  `price_history.market_option_id`, `market_activity.market_option_id` (all nullable).
- Functions:
  - `lmsr_price_multi(q DECIMAL[], b DECIMAL) RETURNS DECIMAL[]` — stabilized softmax.
  - `place_bet_option(p_user_id, p_market_id, p_option_id, p_amount_local, p_currency, …)`
    — mirror of `place_bet` for a chosen option (wallet lock, fee, reprice, position,
    transaction, price_history, activity, market stats).
  - `resolve_market_options(p_market_id, p_winning_option_id, p_resolver_id, …)` — pays
    winners, marks `is_winner`, sets `resolved_option_id`, closes positions.
  - `seed_binary_options(p_market_id)` — optional helper to materialize YES/NO option
    rows for a binary market if a caller wants unified storage (not run in bulk).
- **RLS**: existing `market_options` policies (public SELECT, service_role ALL) already
  cover new columns; new option-scoped rows inherit them. No policy weakening.
- Binary RPCs (`place_bet`, `resolve_market`, `cancel_market`) are **left intact**.

### 3.1 Integrity constraints
- `CHECK (price >= 0 AND price <= 1)` on `market_options.price`.
- App- and RPC-level assertion `abs(Σ price − 1) < 1e-4` after every reprice.
- `market_options` count per market validated 2..12 at creation (API + DB trigger).

---

## 4. Business Logic

- **Bet**: identical guardrails to binary (`min 0.10 USD`, market active, not closed,
  wallet balance, `platform_fee_rate`). Only the pricing + position keying differ.
- **Resolve**: single winner; payout `shares × $1`; losers forfeit; idempotent via the
  same `win_/lose_` idempotency keys, extended with option id.
- **Cancel**: unchanged — refund net stake to every holder across all options.
- **Invariant**: for a multiple_choice market the sum of option `q_shares`-implied
  prices is a valid probability distribution at all times.

---

## 5. API Design & Integration

- `POST /api/markets/[id]/bet` — body `{ optionId?, side?, amountLocal, currency }`.
  `optionId` for multiple_choice, `side` for binary; server validates against the
  market's `resolution_type` and rejects mismatches (`400 outcome_mismatch`).
- `GET /api/markets/[id]` — returns normalized `outcomes[]` (never raw yes/no for
  multi). Backward-compatible: binary responses still include `yes_price/no_price`.
- `POST /api/admin/markets/[id]/resolve` — `{ winningOptionId | outcome }`, capability
  `markets:resolve`, audit-logged.
- Contract tested; OpenAPI/type-safe via generated `types/supabase.ts` after migration.

---

## 6. Cross-Cutting Concerns (mapped to this feature)

- **AuthN/AuthZ & RBAC**: bet requires authenticated + KYC gate (unchanged); resolve/
  cancel/feature require `markets:*` capabilities via existing `page-guard`/`rbac`.
- **Session management**: unchanged (Supabase auth cookies); no new surface.
- **Input validation & sanitization**: zod schema on bet/resolve payloads; option id
  must belong to the market; amount bounds; label sanitation on market create.
- **Rate limiting & abuse prevention**: reuse per-user bet rate limit; add per-market
  option-flip guard; idempotency keys prevent double-spend on retries.
- **Encryption & secrets**: no new secrets; DB TLS + at-rest encryption via Supabase;
  service_role only server-side.
- **Caching & CDN**: market read model cached with short TTL + tag invalidation on
  bet/resolve; price history served via existing route with revalidate.
- **Performance & capacity**: LMSR is O(N) per bet; N≤12 ⇒ negligible. New partial
  indexes keep position lookups O(log n). Price history rows grow with bets — retained
  by existing retention/backup policy.
- **Error handling & tracking**: RPC raises typed `ERRCODE`s (`P00xx`); API maps to
  stable error codes; client shows friendly copy; errors reported to the tracker.
- **Logging / monitoring / alerting / observability**: structured bet/resolve logs with
  market_id, option_id, amount, new prices; metrics: bets/sec, reprice latency, price-sum
  drift; alert if `|Σprice−1| > 1e-3` or resolution touches 0 winners unexpectedly.
- **Testing**: unit (outcome normalization + LMSR softmax + validation), integration
  (place_bet_option atomicity, resolve payout math), e2e (create N-option market → bet →
  resolve → portfolio reflects payout), load (concurrent bets on same option), security
  (RLS, capability, injection on labels).
- **Migrations & DR**: forward-only additive migration; backup before apply; rollback =
  disable feature flag (schema stays, unused). Point-in-time restore covers data.
- **HA / redundancy / scalability**: stateless API; DB is the single source of truth with
  Supabase HA; horizontal scale unaffected (per-market row locks localize contention).
- **Feature flags**: `markets.multiOutcome` flag gates creation UI + bet routing;
  default off in prod until integration + load tests pass.
- **Analytics & telemetry**: emit `market_created{type,optionCount}`, `bet_placed{optionId}`,
  `market_resolved{winningOptionId}` events.
- **Auditing & audit logs**: resolve/cancel/feature already audit-logged; extend payload
  with option id. Immutable audit table.
- **Compliance & privacy**: no new PII; geo restrictions (`allowed_countries`) unchanged.
- **Accessibility (WCAG AA+)**: outcome selector is a radiogroup; each option a labelled
  radio with visible focus, price as text (not color-only), keyboard operable.
- **Localization / i18n**: option labels user-authored; UI chrome via existing i18n;
  numbers/currency via `Intl`. Preferred locale already persisted (migration 018).
- **Documentation**: this dossier + generated API types + inline SQL comments + a
  runbook for resolution.
- **Deployment & release / rollback**: ship code dark (flag off) → apply migration in a
  maintenance window → enable flag for internal cohort → GA. Rollback = flag off.
- **Maintenance & tech-debt**: the Outcome abstraction removes scattered yes/no branching
  (net debt reduction); a follow-up can migrate binary storage onto `market_options` for
  full uniformity once multi is GA.
- **Cost optimization**: no new infra; O(N) compute; price_history retention tuned.
- **Extensibility & long-term evolution**: the Outcome model + generalized LMSR are the
  substrate for future scalar/range markets and combinatorial markets.

---

## 7. Implementation Roadmap (phased, each CI-gated on `main`)

1. **A — this dossier** (docs).
2. **B — migration `020`** (additive schema + `lmsr_price_multi` + `place_bet_option` +
   `resolve_market_options` + `seed_binary_options`). Committed, applied in a window.
3. **C — domain lib** `lib/markets/outcomes.ts` + Vitest unit tests (normalization,
   probabilities, favorite, validation).
4. **D — API** bet/resolve/read routes accept option id; zod validation; contract tests.
5. **E — Frontend**: market create (add/remove N options), market detail/trading
   (outcome radiogroup + per-option price bars), portfolio + admin markets show outcomes.
6. **F — feature flag, telemetry, e2e + load tests, GA**.

Phases A–C land now (safe/additive); D–F follow behind the flag.
