# Kichiko's trading brain: architecture decision, evidence and roadmap (2026-09)

Status: decision proposed; phase 0 shipped on branches, not merged. Owner sign-off needed on the items in §9.

Scope: the backend "brain" only. That means the matching engine, settlement, ledger and money paths, market design (fees, ticks, order types, liquidity), latency topology, market data and risk controls. UI is out of scope.

## 1. Verdict

Kichiko does not need a new database or a rewrite of the engine into another language to beat Polymarket and Kalshi. It needs four things, in this order:

1. **Stop losing money.** Settlement double-paid every winner, deposits could mint balance, and 64 of 64 production order books hold unbacked positions.
2. **Cut order latency from about 1 s to about 0.15 s.** Today's latency is a network-topology problem, not a database problem.
3. **Make thin markets tradable.** A bounded-loss automated market maker should quote into the existing order book, with a fee curve that pays for it.
4. **Keep Postgres as the single source of truth for money.** Scale the matcher only when measurements say so.

The measured evidence and the research both point this way. The current in-database engine is correct in shape. Its biggest algorithmic flaw, an O(book) maker scan, is removed on a branch (071), and each order then costs about 1.3 ms of database work locally. Dedicated in-memory engines are 3–4 orders of magnitude faster, but they add a second source of truth for balances. That costs more than it earns while network round trips from Nairobi are 130–180 ms and volume is modest (research report 03 §7).

## 2. What exists today (verified in code and on a replica)

Everything in this section was checked against the code, or reproduced on a local Supabase Postgres 17.6 replica built from all migrations. Production was only ever read, with GET requests.

| Layer | Current state | Evidence |
|---|---|---|
| Engine | PL/pgSQL `clob_place_order` (046). One unified book per option with direct, mint and merge matches, walked in price-time order under a `markets … FOR UPDATE` lock | `046:21-498` |
| Invariant | Per option, Σ YES shares = Σ NO shares = collateral. Pays exactly $1 per winning share only if settlement is right | fuzz, two-sided and 069 harnesses |
| Settlement (before 069) | AMM-era: paid `shares + cost basis`, drained escrow, left orders live | `052:450-454`, reproduced (test_settlement red run) |
| Money in/out (before 070) | Any currency with any provider; M-Pesa charges and pays shillings | `deposit/route.ts:9-15`, `mpesa.ts:170-177`, `payments/index.ts:240` |
| Order API | 5–7 sequential round trips to Supabase per order | `app/api/orders/route.ts:20-140` |
| Topology | App on Fly `jnb` (Johannesburg); database in eu-west-1 (Ireland, from the pooler host); Supabase has no African region | `fly.toml`, DB URL, [Supabase regions](https://supabase.com/docs/guides/platform/regions) |
| Fees | None charged on trades | `046` (no fee columns); audit 01 §1 |
| Liquidity | Pure order book, and the book is almost entirely seed orders. 2,280 of 2,291 production orders carry none of the `engine` metadata `clob_place_order` always writes, so they did not come through the engine | read-only production snapshot, 2026-09-26 |

## 3. Measured performance (local replica, `scripts/ops/clob/bench_engine.py`)

These numbers cover database work only, on local NVMe with no WAN. Absolute values on Supabase's cloud disks will be lower. The comparisons between engine versions are like for like. Profile of the current engine at a 60-deep book: 1.9 ms per order in total. Of the statement time, the ladder scan was 23.6%, the two ledger inserts per fill plus the profile trigger were 12.5%, and the non-HOT `markets` row update was 7.4%.

| One hot market | 046 (current) | 071 (shipped on branch) |
|---|---|---|
| 60-deep book, 1 client | 414 orders/s, p50 1.94 ms | 508 orders/s, p50 1.31 ms |
| 3,000-deep book, 1 client | 263 orders/s, p50 3.11 ms | 485 orders/s, p50 1.38 ms |
| 3,000-deep book, 8 clients | 265 orders/s, p99 74.6 ms | 512 orders/s, p99 42.7 ms |

Findings that shaped the design:

1. **The 046 ladder is O(book).** It sorts by a computed `CASE` expression, so no index can supply the order. `EXPLAIN ANALYZE` at 4,749 live orders showed 5,553 rows read, 5,247 discarded, then a sort taking 6.4 ms, all while holding the market lock. 071 fixes this. It is fill-for-fill identical to 046 over 12,500 differential-test operations.
2. **Per-market work is serial.** On a fixed book, adding clients does not add throughput: the 046 engine did 414 orders/s with 1 client and 409 with 8. It only adds queueing latency (p99 5 → 54 ms). An early uncontrolled run seemed to show throughput collapsing with more clients, but that was the book growing during the run, which is finding 1. So what matters is cutting transaction time and lock-hold time.
3. **Deadlocks between concurrent takers were confirmed.** A baseline run with no settlement at all still produced 18. The cause is lock order: the taker wallet is locked first, then maker wallets in book order, and profile rows are updated by a trigger in fill order. This is scheduled for phase 1.
4. **`markets` updates are never HOT** because `total_volume_usd` is indexed. Removing it from the index was measured and rejected: the homepage listing goes from 0.089 ms to 4.27 ms at 10k markets, and reads are hotter than trades. The right fix is to take the per-trade counter update out of the order transaction (phase 1, option B1).
5. **The sandbox had 2 vCPUs.** Multi-market runs were CPU-bound and noisy (584–862 orders/s across every version), so they are not used as evidence.

## 4. Where the competition is (2026, sourced)

Full detail and sources are in research report 01. Every item below carries a source there. Load-bearing facts were independently re-checked for this document.

- **Polymarket:**
  - Rebuilt its exchange (CLOB V2, live 2026-04-28) with a new collateral token, pUSD.
  - Now charges takers `C × rate × p(1−p)`, with rate 0.04–0.07 by category; makers pay nothing and get 15–25% back.
  - Price-time priority is widely assumed but **not documented** anywhere by Polymarket.
  - Its market feed has no sequence numbers, only book hashes.
  - It halted for 4 h 24 min on 2026-08-31 without publishing a root cause.
- **Kalshi:**
  - Price-time priority is binding under Rulebook 5.9. Self-trade prevention is a required field.
  - Taker fee `round up(0.07 × C × P × (1−P))` ([Kalshi fee schedule](https://kalshi.com/fee-schedule); formula cross-checked at [whirligigbear](https://whirligigbear.substack.com/p/makertaker-math-on-kalshi)). Maker multiplier 0.0175, defaulting to 0 (report 01 §9.5, primary source K18).
  - Is sharding its engine by category, which forces traders to pre-fund collateral per shard.
  - Pauses trading every Thursday.
  - **Explicitly excludes Kenya.**
- **Both venues have had trust failures:**
  - a UMA whale vote on a $7M Polymarket market;
  - a wash-trading study estimating about 25% of Polymarket volume;
  - Kalshi's "death carve-out" settlement;
  - Kalshi paying $18.6M to the wrong side after settling early.
- **East Africa is open ground.** Neither venue offers mobile-money rails. M-Pesa transfers under KES 100 are free, so micro-tickets are viable.

**What to borrow:**
- documented price-time priority with a queue-position API;
- one ladder for YES and NO (mint and merge);
- the p(1−p) taker fee, with zero maker fee plus rebates;
- Kalshi's fee-rounding accumulator;
- a tapered tick grid;
- mandatory self-trade prevention;
- a heartbeat cancel-all;
- post-only reopen after maintenance;
- a settlement timer and dispute window before any M-Pesa payout;
- snapshot plus delta feeds with a monotonic sequence number.

**Weaknesses to exploit:**
- fast, local mobile money;
- accountable, named resolution with the rules shown on the ticket;
- one wallet across every market (no per-shard collateral);
- no order wipes on upgrades;
- a public status page.

## 5. What the literature says (ranked, with counter-evidence)

Full detail is in research report 02: 105 references, each with a DOI, arXiv, SSRN, RePEc or URL identifier. Preprints are marked. Key papers were re-checked for this document.

| # | Choice | Evidence for | Evidence against / caveat |
|---|---|---|---|
| 1 | FIFO price-time priority on an integer tick grid, stored as a direct-indexed ladder | Pro-rata widened spreads and cut depth at LIFFE; FIFO priced more efficiently (Lepone & Yang 2012; Haynes & Onur 2020) | Queue priority can reduce risk-sharing among makers, cutting quoted depth by up to 8.4% (Garriott et al. 2025) |
| 2 | Bounded-loss automated market maker (LMSR / LS-LMSR) quoting **into** the order book, with a per-market subsidy cap | LMSR beat a double auction on accuracy "especially on low-activity questions" ([Atanasov et al., IJF 2025](https://ideas.repec.org/a/eee/intfor/v41y2025i2p580-595.html)). There is an ε-fair algorithm for combining a market maker with limit orders (Heidari et al. 2018) | In simulation it narrowed spreads but did not consistently improve price discovery (Chakraborty et al. 2015). The subsidy is real: worst-case loss b·ln n |
| 3 | Native complete-set mint and merge, plus **two-way** NO ⇔ YES-on-all-others conversion for multi-outcome events | About $40M of arbitrage extracted on Polymarket (Saguillo et al. 2025). With one-way conversion, violations clustered on the unsupported side (Gebele et al. 2026, preprint) | Arbitrage at retail scale is depth-limited. Arbitrary combinations are #P-hard to price (Chen et al. 2008), so don't offer them |
| 4 | Taker-only fee θ·P(1−P), with zero or rebated maker fees | Under Kalshi's schedule, makers returned −9.6% against −31.5% for takers (Bürgi et al.). Narrower posted spreads attract retail flow (Malinova & Park 2015) | Favourite–longshot bias persists: contracts at ≤10¢ lose more than 60% on average |
| 5 | Periodic call auctions for thin and long-tail markets: indicative price, no-cancel window, random end time (Shanghai/Shenzhen design) | [Budish, Cramton & Shim, QJE 2015](https://academic.oup.com/qje/article/130/4/1547/1916146); Madhavan 1992; UESTC and SSE studies of open call auctions (better depth, lower volatility) | An illiquid batch auction may produce no trades without maker incentives (Derchu et al. 2023, preprint) |
| 6 | House market maker quoting in logit space with inventory skew, widest near 50/50 and near resolution | Avellaneda–Stoikov; Guéant–Lehalle–Fernandez-Tapia | The three prediction-market adaptations are all 2025–26 preprints |
| 7 | Time-scheduled subsidy (pm-AMM / uniform-loss) | Moallemi & Robinson 2024; Moallemi, Robinson & Zhu 2026 | Theory and simulation only |
| 8 | Surveillance: self-trade prevention, wash-trade detection on the counterparty graph, manipulation alerts. **No VPIN.** | Wash trading peaked near 60% of Polymarket weekly volume (Columbia study). Manipulations stayed visible 60 days later in thin markets | VPIN is a poor predictor (Andersen & Bondarenko 2014) |

**Chinese scholarship** (report 02 §D):
- Tsinghua work on RL market making (IJCAI 2024), treated here as a later-phase option.
- Microsoft Research Asia's MarS market simulator (ICLR 2025), a candidate for stress-testing the matching rules.
- CUHK work on AMM design: the optimal fee rises with volatility, which supports volatility-scaled fees near resolution.
- UESTC and SSE Research Center studies of call-auction design, the basis for recommendation 5.
- No peer-reviewed matching-engine paper from a mainland institution with verifiable metadata was found. That gap is reported, not filled.

## 6. Candidate brains compared

Engineering options are from report 03 §7, with this document's measurements added.

| | A: optimise the in-DB engine | B: single writer per market shard, Postgres as truth | C: in-memory engine + journal + Postgres ledger | D: C + TigerBeetle |
|---|---|---|---|---|
| Nairobi end-to-end latency | ~0.15–0.22 s once co-located | +2–20 ms of queue/batch delay | ~0.14–0.19 s (still dominated by WAN) | same as C |
| Per-market throughput | measured ~500 orders/s locally (071); lower on cloud disks | 10³–10⁴/s, set by batch write cost (to be measured) | 10⁵+/s (LMAX 6M/s; exchange-core 5M ops/s) | 10⁵+/s |
| Source of truth for money | Postgres | Postgres | journal + Postgres (two copies, reconciled) | three systems |
| Correctness risk | lowest (one ACID transaction) | low (one writer, one DB) | medium | medium–high |
| Ops complexity / migration risk | low / low | medium / medium (shadow-run, move shard by shard) | high / high | very high / high |

**Decision: do A now, keep B ready, and don't build C or D.** A is where every measured bottleneck sits today. B's pure-function matcher `(book, order) → (book′, fills)` can be built and differential-tested against the SQL engine using the `diff_engine.py` harness already in the repo. C and D only make sense once market makers need under 10 ms and 10k+ orders/s sustained.

## 7. The target brain

**Correctness core (non-negotiable).** One settlement core pays exactly $1 per winning share, with a solvency guard (shipped in 069). Required invariants, checked continuously by a reconciliation job and in CI:
- I1: per option, Σ YES = Σ NO.
- I2: user cash + escrow + collateral + fees = deposits − withdrawals.
- I3: every cached wallet balance equals its ledger sum.
- I4: reserved amounts equal the sum of open-order requirements plus withdrawal holds.
- I5: nothing is negative.

**Engine (A).**
- The index-ordered ladder (shipped in 071).
- Per-book advisory lock in place of `markets FOR UPDATE`.
- Every wallet and profile lock taken in id order at the end of the transaction, which removes the measured deadlocks.
- Per-trade market counters moved off the order transaction (B1: a narrow stats table plus periodic roll-up). That gives multi-outcome events real per-option parallelism.
- A per-market sequence number in place of `created_at` for time priority. Timestamps collide, and inside one transaction they are all equal.

**Market design.**
- **Tick grid:** a tapered integer grid, 1¢ in the middle and 0.1¢ below 10¢ and above 90¢, which suits small longshot tickets.
- **Order types:** GTC, GTD, IOC (FAK), FOK, post-only and reduce-only. Market orders are always sent as limit orders with a price guard.
- **Self-trade prevention:** mandatory, with maker-cancel and taker-cancel modes.
- **Idempotency:** a unique `(user, client_order_id)`, fixing today's un-namespaced ledger key.
- **Fees:** taker θ·P(1−P) with a per-category θ below Polymarket's and Kalshi's; maker fee zero, plus a rebate. Use a fee-rounding accumulator settled to whole shillings.
- **Liquidity:** an LMSR market maker with capped b·ln n and a subsidy withdrawn on a schedule, posting ε-fair synthetic orders into the book on every market with fewer than N resting orders. Periodic open call auctions for the thinnest markets and for market open and close.
- **Multi-outcome:** complete-set mint and merge, and two-way NO ⇔ YES-others conversion, as atomic functions.
- **Settlement currency:** one settlement currency per market (KES first). This removes the FX gap the platform carries today, where USD-unit contracts are held in shilling wallets and paid at a stale rate.

**Latency topology.**
- Serve `/api/orders` next to the database: Vercel `dub1` (in eu-west-1 itself) or Fly `lhr` (about 11 ms from Dublin).
- Collapse auth, profile, flag, market, FX and book reads into one RPC, with local JWT verification (`getClaims`).
- Expected result: about 1 s → about 0.15–0.19 s per order from Nairobi (report 03 §3.4).

**Market data.** Realtime Broadcast (not Postgres Changes), carrying snapshot plus delta messages with the per-book sequence number, and clients re-snapshot on any gap.

**Risk and operations.**
- Per-user token-bucket throttles, a max order size, and price collars against a reference price.
- A per-market halt, a global kill switch, and a post-only reopen window.
- A heartbeat cancel-all.
- Payouts only after a settlement timer and dispute window.
- Named resolvers with a written rationale.
- A public status page.

## 8. Roadmap (one issue at a time; each item tested before merge)

| Phase | Item | Status |
|---|---|---|
| 0 | Settlement correctness, solvency guard, void/cancel (069) | **Done on branch**: 50/50 scenarios, concurrency-tested |
| 0 | Payments provider/currency binding (070) | **Done on branch**: 14 exploit cases red → green; DB constraints |
| 0 | Index-ordered ladder, HOT positions (071) | **Done on branch**: identical fills over 12,500 operations; +84% throughput on a deep book |
| 0 | Owner decisions on the production data (§9) | **Blocking** |
| 1 | Reservation integrity: split withdrawal holds from order escrow, rewrite 064 correctly, remove `GREATEST` clamps, repair the 3 affected wallets | next |
| 1 | Remaining critical/high money bugs from the audits (PesaPal IPN cross-credit, ambiguous disbursements auto-refunded, stuck withdrawals, admin adjust bypass, spoofable IP, reconciliation job) | next |
| 1 | Deadlock-free lock order; per-book advisory lock; counters off the hot path; sequence-number priority; unique client order ids | after that |
| 1 | Single order RPC, co-located order API, FX cron fixed with sanity bounds | after that |
| 2 | Fees + accumulator; tapered ticks; order types; self-trade prevention modes; heartbeat; halts | design ready |
| 2 | LMSR market maker into the book; call auctions for thin markets; two-way negRisk conversion | design ready |
| 3 | Architecture B matcher, only if phase-1 measurements show per-market demand near the ceiling | on evidence |

## 9. Decisions needed from the owner

1. **Is the production data real customer money or seed data?**
   - Every one of the 64 option books fails the collateral check: 2,224,769 YES against 1,091,430 NO shares.
   - With 069 live, resolving any market correctly stops with `P0141` until this is decided.
   - The first market closes on 2026-09-27 at 00:00 UTC.
2. **Merging to `main` applies migrations 069–071 to production,** through the staging deploy's `supabase db push`.
3. **Void policy:** conserving settlement at a chosen YES price (Polymarket pays 50/50 when unresolvable) versus the old cost-basis refund, which collateral does not back.
4. **Settlement currency per market:** KES-denominated contracts (recommended) versus USD units in local wallets.
5. **Fee coefficient per category,** and the market-maker subsidy budget per market (b·ln n).

## 10. Evidence and tools in the repo

- **Research:** `docs/research/brain-2026-09/`
  - `01-POLYMARKET-KALSHI-2026.md` (79 sources);
  - `02-ACADEMIC-LITERATURE.md` (105 references);
  - `03-ENGINE-ENGINEERING.md` (about 75 sources).
- **Harnesses (CI, rolled back):**
  - `scripts/ops/clob/test_settlement.py`;
  - `scripts/ops/payments/test_provider_currency_constraints.py`;
  - plus the existing fuzz, two-sided and 046 harnesses.
- **Engineering tools (local databases only; they refuse remote hosts):**
  - `scripts/ops/clob/diff_engine.py` (differential equivalence);
  - `scripts/ops/clob/bench_engine.py` (load).
- **Changes:** `docs/design/CLOB-SETTLEMENT-2026-09.md` and migrations 069–071.

## Appendix: bug register (2026-09)

Key:
- **Status:** `fixed` means fixed on a branch and tested (not yet merged). `open` means not yet fixed.
- **Verified:**
  - `V`: reproduced or traced first-hand for this document;
  - `A1` / `A2`: from the DB-core audit or the API/lib audit respectively, with file:line evidence there, not yet re-verified here.

The two code-audit reports contain step-by-step detail for open critical issues and are held outside the repo until those are fixed.

| ID | Severity | Finding | Verified | Status |
|---|---|---|---|---|
| S1 | Critical | Resolution paid `shares + cost basis` to every winner | V (reproduced) | fixed 069 |
| S2 | High | Resolution and cancel subtracted cost basis from `reserved_balance` (escrow and withdrawal holds) | V | fixed 069 |
| S3 | Medium | Resting orders never released at settlement | V | fixed 069 |
| S4 | High | Admin-console resolution failed with P0121 whenever a winner existed | V (reproduced) | fixed 069 |
| S5 | High | Simplex resolver paid by option and ignored side on CLOB books; (market, user) key collisions | V (reproduced) | fixed 069 |
| S6 | High | `cancel_market` refunded cost basis (not collateral-backed) and had no status check | V (reproduced) | fixed 069 (P0144 + `void_market`) |
| S7 | Critical | No solvency check before payout | V | fixed 069 (P0141) |
| P1 | Critical | Deposit currency not bound to provider: "USD 100 via M-Pesa" charged KSh 100 and credited $100 | V | fixed 070 |
| P2 | Critical | M-Pesa B2C paid any wallet currency's number as KES | V | fixed 070 |
| P3 | Medium | Unimplemented payout providers accepted, failing only after funds were reserved | V | fixed 070 |
| P4 | Critical (UX) | Every in-app deposit failed with 400: the deposit sheet sent `phone_number` (`navbar.tsx:409`) but the route requires `phone` (`deposit/route.ts:13`) | V (reproduced, `sheet-route-contract.test.ts`) | fixed (deposit field) |
| P5 | High | Deposit and withdraw sheets hardcode M-Pesa and send no country, so only KES can be deposited or withdrawn; non-KES balances are stuck | currency-flow map (code) | open: settlement-currency work |
| C1 | High | `preferred_currency` was user-editable at any time and every money route trusted the request's `currency`: buy in one currency, sell or settle in another, i.e. free FX conversion at a stale platform rate | currency-flow map (code) | fixed 079 + routes: currency derived from `user_settlement` in orders, deposits and withdrawals (client value only an assertion, 409 on mismatch) |
| C2 | Low | Settlement adds USD amounts to `wallets.total_won` / `total_lost`, which are otherwise local-currency (069:284-285) | currency-flow map (code) | open |
| E1 | High (perf) | O(book) ladder scan and sort under the market lock | V (measured) | fixed 071 |
| E2 | Low (perf) | Position updates not HOT | V (measured) | fixed 071 |
| D1 | Critical (data) | All 64 production option books unbacked: 2.22M YES vs 1.09M NO shares; 2,280 of 2,291 orders lack engine metadata (seeded directly) | V (read-only snapshot) | open: owner decision |
| D2 | High (data) | 3 wallets with pending/processing withdrawals (KES 39,552.54) have no hold in `reserved_balance` | V | fixed 082: `reconcile_wallet_reservations(true)` sets reserved = live buy escrow + pending/processing withdrawal holds (total unchanged, each wallet change written to `audit_log`); a wallet that cannot fund the holds is reported, not touched (`test_escrow_exact.py` X6) |
| R1 | High | `reconcile_wallet_reservations` (064) ignores partially filled orders, releases withdrawal holds, writes without locks; it already ran once | V (code) | fixed 082 (replaced: counts open AND partially filled buy escrow plus withdrawal holds, locks wallets in id order, audits every change, never changes a wallet's total; old signature dropped) |
| R2 | Low | Per-fill rounding plus `GREATEST(0, …)` clamps create or destroy 1e-6 per affected fill | V (diff test; reproduced X1: 0.000001 left reserved after a full fill) | fixed 082 (`clob_orders.reserved_local`: pro-rata release per maker fill, the completing fill releases the remainder; exact wallet move, P0150 instead of a clamp) |
| E3 | Medium | Deadlocks between concurrent takers: each taker locked its own wallet first, then maker wallets (and, through the ledger trigger, profiles) in book order | V (reproduced: 15-23 per concurrency run on 080; server log cycles all on `wallets`) | fixed 081 (all wallet then profile locks taken together in id order after the walk; recorded maker updates replayed in original order): 0 deadlocks in every run; residual resolution-vs-trading KEY SHARE path documented |
| E4 | Medium | `client_order_id` was used raw as the taker ledger idempotency key (unique across ALL users): a retried resting order escrowed twice, a retried filled order 500'd (23505), and one user could block another by pre-claiming ids | V (reproduced, `test_client_order_id.py`; 8-way race test) | fixed 080 (unique per user, idempotent replay, P0107 on reuse with other parameters, ledger key from order id) |
| E5 | Low | Time priority uses transaction start (`created_at`); ties inside a transaction | V (reproduced: a maker whose transaction started earlier but reached the book later was filled ahead of a resting one; `test_time_priority.py` red) | fixed 089: `clob_orders.book_seq` from a sequence at INSERT (under the market lock, so arrival order); ladder indexes and walk cursors order by (yes_px, book_seq); existing rows numbered by (created_at, id); proof on 089 ALL IDENTICAL |
| E6 | Medium | The post-match market-sell dust guard (071 L512-515) also rejected LIMIT sells: a $54.60 limit sell whose immediate fill was $0.60 was rolled back whole with P0105 instead of filling and resting. The buy side was unaffected (asymmetric). Found by the native engine twin's differential proof (32 of 40,000 ops) | V (reproduced, `test_min_size.py` L1) | fixed 073 |
| E7 | Low | Fully filled buy orders keep sub-cent `reserved_usd` escrow dust (275 orders, $0.000287 in total over the twin's 40,000-op proof) that never returns to available; 064's reconciler only looks at open orders | V (reproduced, `test_escrow_exact.py` X1) | fixed 082 (escrow tracked exactly in wallet currency; existing dust returned by the one-time reconcile) |
| E8 | Low | `clob_place_order` surfaced raw SQLSTATEs: limit price > 999.9 overflowed `numeric(4,1)` before the clamp (22003), prices in (99.9, 999.9] or < 0.1 were silently clamped, sizes < 0.0000005 hit the size CHECK (23514), and >6-decimal sizes were compared raw against holdings (P0113) | V (reproduced, `test_order_inputs.py`) | fixed 074 (P0106, size normalised) |
| E9 | High (money) | Cancel and expiry credited `available` with the order's full computed escrow while clamping `reserved_balance` at 0: a wallet whose reserved balance was short (drift, E7/R2 history) gained money on every cancel (X3: +1 KES; X4: +0.000053 on a plain expiry) | V (reproduced, `test_escrow_exact.py` X3/X4) | fixed 082 (release = LEAST(order escrow, wallet reserved), exact move, shortfall recorded in the order's metadata as `escrow_shortfall_local`; `wallet_reservation_drift()` exposes any wallet off the invariant) |
| E10 | High (FX policy) | Mixed-currency books carry stale FX: a SELL maker's proceeds convert at the rate stored on its order (placement time) while the taker pays at the current rate; a BUY maker's escrow is fixed in local currency at placement. Every fill between users of different settlement currencies therefore moves USD collateral by the FX change since placement (db-core audit #7) | V (code) | open: needs an FX-exposure policy (owner decision), for example (a) hold order escrow in USD and convert at fill, with the platform bearing FX between placement and fill; (b) re-price and re-reserve buy escrow at fill time, refusing the fill if the wallet cannot cover it; (c) single-currency books per market. Fixing only the seller side would create a new asymmetry, so nothing is changed until chosen |
| L1 | High (latency) | 5–7 sequential round trips per order from Johannesburg to Ireland (≈1 s) | V (code + RTT data) | fixed 090: one database round trip. `place_order_for` (service-role; the route passes FLAG_* env overrides, so users cannot call it) checks account, maintenance, flags.clob, settlement currency, market engine and converts dollar market buys, then calls `clob_place_order`; the route identifies the user with `getClaims` (local JWT verification with asymmetric signing keys; one Auth call otherwise). 6-8 Supabase calls -> 1 (`test_place_order_for.py`, route tests). Open: co-locate the order API with the database (Fly lhr / Vercel dub1) |
| O1 | High (ops) | Exchange-rate cron not running; KES rate last fetched 2026-07-28 and used for settlement | V (read-only) | fixed: `.github/workflows/fx-rates.yml` refreshes every 6 hours through the validated `upsert_fx_observations` path (run 36252250928 accepted KES, UGX, TZS, RWF, ETB, BIF; ZMW held for a one-time admin confirmation) |
| F1 | High | `upsert_exchange_rates` accepted any positive rate: one bad datapoint (KES at 5/USD) or a single-source 8% jump replaced the rate used for escrow, deposits, withdrawals and settlement; no value date, no record of provider quotes | V (reproduced, `test_fx_gates.py`) | fixed 075 (bands, move and consensus gates, `fx_observations`) |
| F2 | Medium | `exchange_rates.rate` is USD per unit at 8 decimals: UGX loses 1.9e-5 relative precision (BIF 7.4e-6, TZS 5.5e-6) in every conversion. 075 stores the exact published quote in `units_per_usd`; money paths still convert with `rate` | V (computed; seen in `test_fx_gates.py` fixtures) | open |
| F3 | Medium | FX came from one commercial aggregator (ExchangeRate-API, attribution required, called twice per run), never from the central banks | V (code) | fixed: official sources CBK, BNR, NBE + independent cross-check, official preferred (076); live endpoints verified 2026-09-26 by a dry run of `fx-rates.yml` on GitHub Actions (official vs aggregator 0.06-0.39%, ETB 1.4%) |
| F4 | High | `upsert_fx_observations` (075/076) failed on every API call: Supabase preloads pg-safeupdate for PostgREST sessions and the function's temp-table reset was a WHERE-less DELETE (21000) | V (end-to-end through PostgREST; `test_fx_gates.py` G14 red on 076) | fixed 077 (+ migration lint rule) |
| F5 | High | Admin FX override (`admin_upsert_exchange_rate`) accepted any positive rate (typo 1.95 ZMW/USD) and, after 075, left `units_per_usd` stale, so the next refresh was gated against the old quote and the correction ignored | V (reproduced, `test_fx_gates.py` G15-G17) | fixed 078 (band check, consistent columns, trigger, override logged) |
| C3 | Medium | Signup defaulted every user to KE/KES when no country was sent and created KES, UGX, TZS and RWF wallets regardless of country | V (code, 003) | fixed 079 (supported country or none; one settlement wallet) |
| S8 | Low (ops) | `admin_void_market` (072) was client-executable but missing from the definer allowlist, so the daily security audit would fail once 072 reached production | V (live audit) | fixed (allowlisted) |
| U1 | Medium (UX) | The profile page's edit form wrote `preferred_currency` directly and ignored errors, so a failed save looked successful | V (code) | fixed (field removed, errors shown) |
| O2 | Low (DR) | `public.schema_migrations` is referenced (032) but created by no migration; a fresh rebuild fails | V (reproduced: a Supabase-image rebuild without the bootstrap's stub stopped at 032:42, relation does not exist) | fixed: 032's REVOKE runs only if the table exists (production has it, so nothing changes there; migrations are tracked by version, the file edit is never re-run). A rebuild from scratch now applies all 97 migrations, and all 25 CI harness steps pass on it. Both bootstraps stubbed the table as a workaround; CI's stub is removed so CI keeps proving a from-scratch rebuild |
| A-P3 | Critical | PesaPal IPN can credit a different, unpaid deposit | V (reproduced, `pesapal-ipn.test.ts`) | fixed: deposit found only by its stored tracking id; status must name this deposit, amount and currency must match; idempotency per deposit |
| A-W1 | High | Ambiguous disbursement exceptions auto-refunded, so a paid-out withdrawal can be refunded (double pay) | V (reproduced: `withdraw-outcome.test.ts`, `disbursement-outcome.test.ts`, 18 red before the fix) | fixed: `processWithdrawal` returns accepted / rejected / unknown (`lib/payments/disbursement-outcome.ts`); only an explicit refusal, or a request never sent, refunds; timeouts, unreadable replies and provider 5xx stay `processing` with the reserve held and the uncertainty recorded in `raw_response`; payout timeouts bounded (30 s); M-Pesa sends the withdrawal id as `OriginatorConversationID` and the B2C webhook matches a lost-reply payout by it. Airtel's HTTP-200 failures are no longer taken as success (6.11, initiation part). Settling unknowns needs A-R1 (status re-query sweep) |
| A-W6 | High | Every real admin `reject` and `complete` of a withdrawal failed with P0121: `fail_withdrawal` / `complete_withdrawal` insert a notification and the delivery trigger (052/062) refuses a user JWT unless the caller opts in; only `admin_adjust_balance` did. Also: rejecting refunded even a payout already sent to the provider | V (reproduced under a finance JWT) | fixed 083: both admin RPCs opt in; rejecting a dispatching/sent/unknown payout needs `confirmed_not_paid` (P0160, HTTP 409 from the admin route) |
| A-W8 | Medium (money) | M-Pesa B2C queue timeouts went to the result endpoint, where a non-zero code refunded the reserve although Safaricom may still pay (audit 6.37) | V (red: QueueTimeOutURL was the result URL) | fixed: `/api/webhooks/mpesa-b2c/timeout` verifies the source, records the timeout on the withdrawal and never settles |
| A-P4 | Medium (money) | A PesaPal REVERSED (chargeback) after the credit was ignored: `fail_deposit` returns early for completed deposits, so the user kept the money (audit 6.30) | V (reproduced: R0 in `test_deposit_reversal.py`; IPN test red) | fixed 086: `reverse_deposit` takes the amount back from the available balance, records any shortfall and suspends the account, audits and notifies; idempotent; `credit_deposit` never re-credits a reversed deposit; the IPN and the deposit sweep call it on REVERSED |
| A-W2 | High | Withdrawals approved after review, and admin retries, are never disbursed | V (code: no sender existed) | fixed 083: `withdrawals.payout_state`; approve and retry queue the payout (trigger), the payout worker (`/api/cron/payouts`, `kichiko-payouts` every minute) sends it after an atomic claim; the request route claims too, so a payout is sent by exactly one caller (`test_payout_dispatch.py` P1-P12, 30-way claim race; `payouts.e2e.test.ts` through PostgREST). Legacy live rows are never sent automatically: finance queues them explicitly (`admin_queue_withdrawal_dispatch`, audited) |
| A-W3 | High | Withdrawal KYC gate can never turn on (read through an RLS client) | V (reproduced: `platform-gate-routes.test.ts`, red on the old route) | fixed: settings a route enforces are read with the service role (`lib/platform-gate.ts`) |
| A-W7 | High (ops) | The admin console's kill switches (`flags.deposits_enabled`, `flags.withdrawals_enabled`, `flags.market_creation_enabled`) and `maintenance.enabled` were enforced nowhere: flipping one during an incident changed nothing | V (grep: no reader; reproduced red) | fixed: deposit, withdraw, order and market-creation routes check them via `platformGate` (service role, env override `FLAG_*`, fails closed if settings cannot be read); defaults unchanged. Open (owner decision): the numeric limits in the same console (deposit min/max, withdraw min/max, daily withdraw cap, min bet, max open markets per creator) are also enforced nowhere; enforcing them as configured changes what users can do |
| A-W4 | High | `admin_adjust_balance` ceiling and separation of duties bypassable; no idempotency | V (reproduced: an admin credited themselves 1,000,000 USD straight through the RPC) | fixed 085: in the RPC, self-adjust P0180, 1,000,000-in-currency ceiling P0181, 10,000 USD ceiling P0182, idempotency key (replay; P0184 on reuse for a different adjustment); old unguarded signature dropped; console sends one key per distinct adjustment (`test_admin_adjust_balance.py` incl. 8 concurrent double clicks -> one credit). Open (owner decision): dual approval above a threshold |
| A-S1 | High | Client IP for rate limits and the M-Pesa allowlist is spoofable | V (reproduced: rotating cf-connecting-ip/XFF changed the rate-limit key; a forged `X-Forwarded-For: <Safaricom IP>` passed the allowlist; 7 red) | fixed in code: `lib/security/client-ip.ts` trusts `Fly-Client-IP` (the TCP peer), believes `cf-connecting-ip` only from a Cloudflare peer, else uses the peer; without Fly the last XFF hop. Used by rate limiting, the M-Pesa allowlist and the admin audit log. B2C results always need the shared secret (an allowlist alone is refused). Open (infra): lock the Fly origin to Cloudflare (Tunnel / private networking) |
| A-R1 | High | No deposit/withdrawal reconciliation; lost callbacks are permanent | A2 §6.10 | fixed: payouts 083 (stale sends become `unknown`; sent/unknown payouts re-queried with backoff and settled only on an authoritative answer; M-Pesa payouts by the B2C callback, matched by our id when the initiation reply was lost). Deposits 084: `/api/cron/deposit-sweep` re-queries pending/processing deposits (2 min to 7 days) with backoff through the webhooks' own rules and idempotency keys (`deposit-settle.ts`, `test_deposit_sweep.py`); the M-Pesa webhook no longer fails a deposit whose query says 4999 "still under processing" (reproduced red). Open: exempting `/api/webhooks/*` from per-IP limits (6.9 area) |
| A-W5 | High | Airtel/MTN disbursement status checks use the wrong endpoint or config | V (reproduced: MTN re-query sent `X-Target-Environment: production`; Airtel payouts re-queried on `/standard/v1/payments/`) | fixed: one config resolver per provider (`mtn-config.ts`, `resolveAirtelConfig`; DB gateway first, env fallback) for collection, payout and re-query; MTN production target by country (UG `mtnuganda`, others must be configured, sandbox refused in production); one disbursement key (legacy name still read); Airtel payouts re-queried on `/standard/v1/disbursements/{id}` with the withdrawal's country and currency; dead `mtnTransfer`/`airtelDisburse` removed (`mtn-airtel-config.test.ts`, `airtel-disbursement.test.ts`). Open: the Airtel PIN is sent as configured; Airtel production expects it RSA-encrypted with their public key |
| A-B1 | High | BTC window engine can stall permanently, settle on a stale price, or duplicate windows | V (`test_btc_windows.py`) | fixed 088: each window settles in its own subtransaction (a failure is reported, the run continues); a window whose market is no longer active/closed is voided; settle only on the first tick in [close, close + 10 min], never a pre-close price; `open_btc_windows` takes an advisory lock (8 concurrent openers -> one window per series). Both schedulers kept (the in-database job may be the only one running while the app is undeployed) |
| A-U1 | High | Portfolio values CLOB NO positions at the YES price | V (reproduced: `portfolio-clob.test.ts`, 4 red) | fixed: option positions keep their side (NO valued at 1 - option price, NO wins when the option loses); CLOB P&L realized by partial sells is included, and a position the database settled uses its stored realized P&L (no double count) |
| A-M1 | High | Matcher does not verify that a maker holds the shares or escrow it trades | V (reproduced: a forged SELL was paid for shares it did not have, a forged BUY got shares free; YES 20 vs NO 10 on the option; `test_maker_backing.py` red) | fixed 087: before each fill a SELL maker's position must hold the shares (reserved_shares is bookkeeping: seeded asks never reserved theirs and still fill), a BUY maker's remaining escrow must cover the fill (1% slack for pre-082 dust); an unbacked maker is cancelled (`unbacked_maker_087`), what it holds is released, and the walk continues; one-off cancel of live orders that can never fill (counts in audit_log). Orders merely not created by the engine (seeded) are not bulk-cancelled: reseed vs wipe is an open owner decision. Twin mirrors it; differential proof on 087 |
| A-F1 | Critical (latent) | KES un-peg re-denominated positions opened at the peg | A1 #2 | open: settlement-currency decision |
| A-O1 | High (ops) | `scripts/ops/reconcile_ledger.py` rewrites the ledger with fabricated deposits and falls back to `DATABASE_URL`; the seeders likewise | A2 §6.36 | fixed: `scripts/ops/destructive_guard.py` on all four writing scripts (reconcile_ledger, rebase_to_kes_peg, reseed_amm_to_clob, seed_intensive): SEED_DB_URL only, `--i-know-this-is-not-prod` unless `--dry-run`, and the target must be local or listed in NONPROD_PROJECT_REFS (a Supabase URL whose project ref cannot be read is refused); `test_destructive_guard.py` runs each script against a production-shaped URL and checks it refuses before connecting. Whether it ever ran against production remains undetermined |
| A-X | Medium/Low | About 30 further items: dust lock on sells, order-cap race, direct market inserts bypass RBAC, crossed books, incomplete ledger, new markets default to AMM, price history returns the oldest points, legacy `GET /api/orders`, 30 s CDN cache on the book, stuck notifications, FX without sanity bounds, wrong leaderboard P&L, ignored PesaPal reversals, staging image promoted to production, withdrawals to any phone | A1, A2 | open |
| A-X2 | Medium | Audit 6.17-6.31 status after this pass | A2 | 6.17 disputed resolution and 6.18 per-position settlement keys: fixed 069 (`settle_<position>`; `cancel_market` defers to `void_market`); 6.20 reference race: fixed 083 (reference chosen before sending, our id as correlation key); 6.21 M-Pesa payload id: fixed (only the stored CheckoutRequestID; the deposit route stores NULL, not '', checks and retries the update); 6.23 `GET /api/orders`: fixed (clob_orders, bounded paging); 6.24: fixed 080; 6.26: fixed 069 (orders released at settlement); 6.28: fixed 075; 6.30: fixed 086; 6.31 failed profile read treated as active: fixed (fails closed); 6.27 deliveries stuck in `sending`: fixed 091 (10-minute lease, re-claimed or failed; `test_delivery_lease.py`). 6.25: fixed for the order, cancel, deposit, market, resolve and status routes (malformed JSON is a 400) and the public error-text leaks (leaderboard, search, health, resolve, status now log and return a generic message); staff-only admin routes still return RPC messages (intended: they are our own explicit reasons). 6.22 per-IP limits under carrier NAT: fixed (a signed-in caller is limited per user, with a per-IP ceiling 20x higher; before, 200 users behind one IP placing one order each: 170 refused; after: 0). Owner decision: payments still fail CLOSED on a rate-limit store outage (F3) although 6.22 suggests falling back to the per-instance memory limit. 6.19 CDN 30 s book cache: fixed in Terraform (`/book` and `/price-history` respect the origin's cache headers; the 30 s rule excludes them; `terraform fmt` clean in CI). NOT YET LIVE: the Terraform workflow cannot init/plan/apply because the `TF_API_TOKEN` secret (and the Cloudflare secrets) are not set, so no Terraform change has ever reached Cloudflare; owner action: add them and approve the gated `infra` apply). 6.15 price history returned the OLDEST `limit` points once a market had more: fixed (newest `limit` rows, returned oldest first; `price-history.test.ts`, red before the fix). 6.29 leaderboard P&L: fixed 092 (A-L1). 6.32, 6.40 and 6.41: see A-X3 |
| A-K1 | High (security) | The payment-gateway secret encryption key was callable by anyone with the public anon key (`POST /rest/v1/rpc/_gateway_enc_key`) | V (db-core audit #38; reproduced on the replica: as anon and as authenticated the function returned the 50-character key; `test_gateway_key_private.py` red) | fixed 098: EXECUTE revoked from PUBLIC, anon, authenticated and service_role; only its owner runs it, through the SECURITY DEFINER `admin_rotate_gateway_secret` / `admin_get_gateway_secret` (verified end to end as a superadmin after the revoke: rotate then read back). It was SECURITY INVOKER, so the definer-exposure audit never covered it; a scan of every public function reading a database setting found no other secret exposed. The ciphertexts themselves were never readable by clients (RLS without policies, grants revoked in 049). Owner action: the staging report prints whether `app.gateway_encryption_key` is set or the repo's dev fallback (a constant in 012) is in use; if it is the fallback, or if the key may have been read while exposed, set a new key and re-encrypt the gateway secrets (rotate each through the admin console), and consider rotating the provider credentials themselves |
| A-D1 | High (availability) | Residual deadlocks after 081: a user's first order vs concurrent takers, and the per-minute re-mark vs trades | V (CI run 635 on main: `test_deadlock_free.py` 2 x 40P01 in 1,800 orders, no SQL change in that commit; reproduced locally 6 deadlocks in 20 runs; with lock-wait logging every victim sat in 081's ordered wallet/profile lock statements, i.e. the other side held a lock taken out of order; deterministic reds: `test_settlement_lock_order.py` (NOWAIT on the profile of an open first order: 55P03), `test_remark_skip_locked.py` (re-mark blocked until its statement timeout)) | fixed. 095: `trg_lock_settlement_on_order` (079) ran at order insert, before the walk; on a user's first order (`settlement_locked_at` NULL) its UPDATE locked the profile outside 081's order, and a taker on another market needing that profile (a maker's owner) waited while holding a wallet the first needed. Now a DEFERRABLE INITIALLY DEFERRED constraint trigger: at commit the profile is already held in the ordered phase (or, with no maker touched, is locked after the taker's own wallet: the global order); 079's guarantee is unchanged (same transaction, every insert path). 096: `remark_positions` (pg_cron, every minute) updated changed positions in no order while the matcher locks them in book order; it now locks with SKIP LOCKED (never waits; a held position is re-marked next run), values verified identical to 063 on all 194 replica positions and idempotent. CI's pg_cron shim never ran the re-mark, so CI could not see the second one. Measured on the replica: 095 alone, 1 run of 30 still failed and all 3 deadlocks in the log were the old re-mark (2 aborted user orders); 095+096: 0 deadlocks in 30 runs (54,000 orders) and 0 in 10 more runs with the re-mark called in a tight loop alongside (3,884 re-marks, 0 errors); the old re-mark under the same stress: 24 deadlocks in 3 runs (14 orders and 9 re-marks aborted). Why deferring is safe: other transactions see the order and the lock together (atomic commit); `set_my_country` also refuses on any non-zero committed wallet balance (P0172) and reads the profile FOR UPDATE, so no country change can slip in around a first order; `test_settlement_currency.py` S9a now fires the deferred trigger with SET CONSTRAINTS ... IMMEDIATE (the harness never commits), same assertion. Deposit/withdrawal settlement triggers unchanged (wallet, then profile: already the global order). Every CI step green on a fresh replica with 96 migrations |
| A-L1 | Medium | Trader P&L, win rate and bet counts wrong under the order book (profiles, all-time and week/month leaderboards, trader card and page) | V (reproduced: `test_leaderboard_pnl.py`, 8 red: buy 10 at 40 and sell at 70 showed -4.00 not +3.00; a void refund ignored (-13 not -2); one bid filled by 3 takers counted 3 bets; 29 replica profiles' P&L differed from their positions') | fixed 092: `positions.realized_pnl_usd` is the source (sales add (price - avg entry) x shares, settlement payout - remaining cost; both engines). `position_pnl_events` (insert-only, trigger on positions, no foreign keys so the 081 lock order is unchanged; backfilled under a table lock) attributes P&L to when it was realized for week/month. Profile counters are recomputed by `sync_profile_trading_stats()` inside `refresh_leaderboard()` (every 2 min), taking only unlocked profile rows (SKIP LOCKED: never waits on a trade; L7 is red without it, statement timeout); the ledger trigger keeps only volume. Definitions: P&L = realized (open positions' unrealized excluded); bets = positions taken; win/loss = closed position with P&L > 0 / < 0; voided markets count in P&L, not as wins or losses; win rate = wins / (wins + losses). Week/month bets = market options bought (the ledger has no side). Trade-off: profile figures lag up to ~2 min (the trader card and page compute live). Verified: harness 14/14 and every CI step green on a fresh replica built from all 92 migrations; migration lint, definer audits (static and runtime) clean; no client grants on the new objects; kengine differential proof with 092 in the matcher ALL IDENTICAL (`engine/results/proof_092.txt`) |
| A-X3 | Medium/Low | Audit 6.32-6.43 status | A2 | 6.35 markets list: fixed (sort_by is a whitelist incl. the documented aliases `volume`/`bettors`, which were not columns and returned 500; prototype keys like `constructor` fall back; page/per_page clamped (NaN or negative offsets were a 500); status/category normalised as in search; `markets-list.test.ts`, red before). 6.40 impersonation: CONFIRMED, owner decision. The route mints an ordinary magic link: the operator gets a full session for the user that is indistinguishable from the user's own (users also sign in by email OTP and PKCE, so the auth method is no marker) and outlives `expires_at`, which only the `impersonation_sessions` row records; the operator can trade and withdraw (with 6.41, to any phone). Options: (a) recommended: remove login-as and give support a read-only admin view of the user; (b) keep it, with a Supabase custom-access-token hook that tags sessions born from the link, rejects refreshes after `expires_at`, and a middleware/RPC gate that makes tagged sessions read-only (needs the hook enabled in the dashboard; not testable against the local replicas, which have no GoTrue). 6.39 CSV exports: fixed for the whole class (`lib/admin/export-pages.ts`): the ledger and audit log stopped at 500 rows, users at 200, moderation/marketers/creators at 1,000, and a payout-run statement at PostgREST's `max_rows` (1,000) with no `.limit` at all; each now reads every page (advancing by rows returned, so a lower server cap still reads everything), orders by a unique `id` tiebreak (rows of one transaction share `created_at`; without it a page boundary drops rows: proven in `export-pages.test.ts`), de-duplicates, refuses above 50,000 rows with 413 instead of a short file, and fails with 500 on a query error (the audit and moderation fetchers swallowed errors; they now report them); `export-completeness.test.ts` red on the old routes (500/500/1,000/200 rows). 6.34: fixed. (a) The review notice went out as `withdrawal_completed` (completed-payout email+SMS policy, preference and UI); now `withdrawal_under_review` (093 adds the enum value, 094 its channel default: email, no SMS; verified on the replica: enqueues email only). (b) M-Pesa moved different money from what was booked: STK charged `Math.ceil(amount)` but credited `amount` (100.40 charged 101), B2C paid `Math.floor(amount)` but debited `amount`; both routes now refuse non-whole M-Pesa amounts (400, before anything is touched), B2C sends the exact amount and refuses a fractional one as not sent (a queued legacy one is refunded, never paid short), STK refuses one instead of rounding. (c) B2C normalised the phone with `replace('+','').replace(/^0/,'254')` only; it now uses `formatMpesaPhone` (spaces, dashes, bare 9-digit) and the withdraw route refuses a non-Kenyan MSISDN before reserving funds. Tests red before: `provider-currency-routes.test.ts`, `disbursement-outcome.test.ts`. 6.33: fixed. Airtel and MTN re-queries already derived the country from the currency (A-W5); the M-Pesa STK status query (webhook and deposit sweep) was made with no country, so with a Kenya-specific gateway row (the admin console allows one per country) it used the global row or env credentials, not the push's shortcode and passkey, and a paid deposit could never settle (live: production has an enabled KE-specific M-Pesa row, run 465); it now uses `mpesaCountryForCurrency(deposit.currency)` (the push's country is the user's settlement country, whose currency is the deposit's, 079), with `MPESA_COUNTRY_CURRENCY` also driving the deposit binding. `getProvidersForCountry`/`selectBestProvider` (no caller; offered M-Pesa in TZ, MTN in ZM, PesaPal for ETB/BIF, all refused by the binding) removed. Tests: `deposit-settle.test.ts`, `mpesa-webhooks.test.ts` (red before). 6.38: `initiateMpesaB2C` (an unused second B2C sender whose QueueTimeOutURL had no webhook token) removed; `mtnTransfer`/`airtelDisburse` were already gone; the unused Redis cache, Redis rate limiter and Polymarket client carry no risk and stay. Owner/ops decision (6.38e): M-Pesa payouts read env config only (`MPESA_CONSUMER_KEY`, `MPESA_B2C_SHORTCODE`, ...) while deposits read the admin console's gateway row, so rotating M-Pesa credentials in the console does not reach payouts. Not switched blindly: Safaricom usually issues B2C on a separate Daraja app (its own consumer key and secret), and `resolveMpesaConfig` ignores `MPESA_B2C_SHORTCODE`; moving payouts to a row holding the STK app's credentials would stop them. The staging report now prints, per M-Pesa gateway row, which B2C fields are set (booleans only). Production (run 465): `production/KE enabled=true consumer_key=true b2c_shortcode=true initiator=false security_credential=false`: the row cannot drive B2C (no initiator, no security credential), so switching payouts to it would have stopped them; keep env until the row is completed and the B2C app's credentials are confirmed. 6.32: partly fixed. Deploy Staging exited 0 when the database was unreachable (and "skipped cleanly" without credentials), so a run with no migrations looked green and, with Fly configured, would deploy code against the old schema; both now fail the run. Deploy Production still used the access-token `supabase link` path (the one that failed with "Unauthorized" in staging) with no dry run or history guard; it now uses staging's pooler-URL method with the dry run and the 001 guard (bash -n checked; the production workflow has never run: no tag, no FLY_API_TOKEN). Owner decision: production promotes the staging-built image, whose NEXT_PUBLIC_SUPABASE_* are baked in at build time; today "staging" migrates the same Supabase project production uses, so they agree; a separate staging project needs runtime public config or a production build. 6.42 (middleware auth call): fixed. The middleware called `getUser()` (a network round trip to Supabase Auth) on every request; it now uses `getClaims()`, which refreshes the session and verifies the JWT locally (signature against the project's JWKS, cached process-wide for 10 minutes in `GLOBAL_JWKS`, and expiry; symmetric keys fall back to `getUser`). The only check dropped from the middleware is server-side revocation before expiry, which the routes that act on the user still do (`getUser`/`requireUser`), as PostgREST trusts the same JWT. `middleware-auth.test.ts` (red before: getUser called, getClaims ignored). The serial awaits inside `POST /api/orders` were removed by 090 (one RPC). 6.43 (card options): fixed, and it was a correctness bug, not only over-fetch: `getCardOptions` (cards, search) and `getLeadingOptions` (related-markets rail) read every option of every market on the page, unordered, in one request; past PostgREST's max_rows (1,000) the tail was cut arbitrarily, so cards showed the wrong front-runners and "+N more" (test: count 1,000 for 1,200, leader B999 instead of B1199). 097 `market_card_options` (SECURITY INVOKER, RLS as before; at most 100 markets x 5) ranks in the database with the app's order (yes_price, else price; display_order, id on ties); verified equal to a brute-force ranking on the replica including a 1,200-option market; an RPC error degrades as before (cards without option rows). The comment-realtime refetch fan-out (6.43b) is UI (deferred). Open: 6.41 (policy), 6.43b (UI); CSV injection (found in this pass, CWE-1236): fixed; user-controlled text in admin exports (usernames and display names, market titles inside ledger descriptions, report details) was written raw, so `=HYPERLINK(...)` / `+cmd|...` ran as a formula when an admin opened the file; `csvCell` now prefixes text starting with = + - @ tab or CR (after spaces) with `'`, leaving numbers and numeric text (e.g. `-5.00`) as numbers; every export goes through it (`admin-users.test.ts`, red before) |
