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
| D2 | High (data) | 3 wallets with pending/processing withdrawals (KES 39,552.54) have no hold in `reserved_balance` | V | open: repair in phase 1 |
| R1 | High | `reconcile_wallet_reservations` (064) ignores partially filled orders, releases withdrawal holds, writes without locks; it already ran once | V (code) | open: phase 1 |
| R2 | Low | Per-fill rounding plus `GREATEST(0, …)` clamps create or destroy 1e-6 per affected fill | V (diff test) | open: phase 1 |
| E3 | Medium | Deadlocks between concurrent takers: each taker locked its own wallet first, then maker wallets (and, through the ledger trigger, profiles) in book order | V (reproduced: 15-23 per concurrency run on 080; server log cycles all on `wallets`) | fixed 081 (all wallet then profile locks taken together in id order after the walk; recorded maker updates replayed in original order): 0 deadlocks in every run; residual resolution-vs-trading KEY SHARE path documented |
| E4 | Medium | `client_order_id` was used raw as the taker ledger idempotency key (unique across ALL users): a retried resting order escrowed twice, a retried filled order 500'd (23505), and one user could block another by pre-claiming ids | V (reproduced, `test_client_order_id.py`; 8-way race test) | fixed 080 (unique per user, idempotent replay, P0107 on reuse with other parameters, ledger key from order id) |
| E5 | Low | Time priority uses transaction start (`created_at`); ties inside a transaction | V | open: phase 1 |
| E6 | Medium | The post-match market-sell dust guard (071 L512-515) also rejected LIMIT sells: a $54.60 limit sell whose immediate fill was $0.60 was rolled back whole with P0105 instead of filling and resting. The buy side was unaffected (asymmetric). Found by the native engine twin's differential proof (32 of 40,000 ops) | V (reproduced, `test_min_size.py` L1) | fixed 073 |
| E7 | Low | Fully filled buy orders keep sub-cent `reserved_usd` escrow dust (275 orders, $0.000287 in total over the twin's 40,000-op proof) that never returns to available; 064's reconciler only looks at open orders | twin diff test, not yet re-verified | open: phase 1 (with R1/R2) |
| E8 | Low | `clob_place_order` surfaced raw SQLSTATEs: limit price > 999.9 overflowed `numeric(4,1)` before the clamp (22003), prices in (99.9, 999.9] or < 0.1 were silently clamped, sizes < 0.0000005 hit the size CHECK (23514), and >6-decimal sizes were compared raw against holdings (P0113) | V (reproduced, `test_order_inputs.py`) | fixed 074 (P0106, size normalised) |
| L1 | High (latency) | 5–7 sequential round trips per order from Johannesburg to Ireland (≈1 s) | V (code + RTT data) | open: phase 1 |
| O1 | High (ops) | Exchange-rate cron not running; KES rate last fetched 2026-07-28 and used for settlement | V (read-only) | open: phase 1 |
| F1 | High | `upsert_exchange_rates` accepted any positive rate: one bad datapoint (KES at 5/USD) or a single-source 8% jump replaced the rate used for escrow, deposits, withdrawals and settlement; no value date, no record of provider quotes | V (reproduced, `test_fx_gates.py`) | fixed 075 (bands, move and consensus gates, `fx_observations`) |
| F2 | Medium | `exchange_rates.rate` is USD per unit at 8 decimals: UGX loses 1.9e-5 relative precision (BIF 7.4e-6, TZS 5.5e-6) in every conversion. 075 stores the exact published quote in `units_per_usd`; money paths still convert with `rate` | V (computed; seen in `test_fx_gates.py` fixtures) | open |
| F3 | Medium | FX came from one commercial aggregator (ExchangeRate-API, attribution required, called twice per run), never from the central banks | V (code) | fixed: official sources CBK, BNR, NBE + independent cross-check, official preferred (076); live endpoints verified 2026-09-26 by a dry run of `fx-rates.yml` on GitHub Actions (official vs aggregator 0.06-0.39%, ETB 1.4%) |
| F4 | High | `upsert_fx_observations` (075/076) failed on every API call: Supabase preloads pg-safeupdate for PostgREST sessions and the function's temp-table reset was a WHERE-less DELETE (21000) | V (end-to-end through PostgREST; `test_fx_gates.py` G14 red on 076) | fixed 077 (+ migration lint rule) |
| F5 | High | Admin FX override (`admin_upsert_exchange_rate`) accepted any positive rate (typo 1.95 ZMW/USD) and, after 075, left `units_per_usd` stale, so the next refresh was gated against the old quote and the correction ignored | V (reproduced, `test_fx_gates.py` G15-G17) | fixed 078 (band check, consistent columns, trigger, override logged) |
| C3 | Medium | Signup defaulted every user to KE/KES when no country was sent and created KES, UGX, TZS and RWF wallets regardless of country | V (code, 003) | fixed 079 (supported country or none; one settlement wallet) |
| S8 | Low (ops) | `admin_void_market` (072) was client-executable but missing from the definer allowlist, so the daily security audit would fail once 072 reached production | V (live audit) | fixed (allowlisted) |
| U1 | Medium (UX) | The profile page's edit form wrote `preferred_currency` directly and ignored errors, so a failed save looked successful | V (code) | fixed (field removed, errors shown) |
| O2 | Low (DR) | `public.schema_migrations` is referenced (032) but created by no migration; a fresh rebuild fails | V | open |
| A-P3 | Critical | PesaPal IPN can credit a different, unpaid deposit | V (reproduced, `pesapal-ipn.test.ts`) | fixed: deposit found only by its stored tracking id; status must name this deposit, amount and currency must match; idempotency per deposit |
| A-W1 | High | Ambiguous disbursement exceptions auto-refunded, so a paid-out withdrawal can be refunded (double pay) | A2 §6.5 | open |
| A-W2 | High | Withdrawals approved after review, and admin retries, are never disbursed | A2 §6.6 | open |
| A-W3 | High | Withdrawal KYC gate can never turn on (read through an RLS client) | A2 §6.7 | open |
| A-W4 | High | `admin_adjust_balance` ceiling and separation of duties bypassable; no idempotency | A2 §6.8 | open |
| A-S1 | High | Client IP for rate limits and the M-Pesa allowlist is spoofable | A2 §6.9 | open |
| A-R1 | High | No deposit/withdrawal reconciliation; lost callbacks are permanent | A2 §6.10 | open |
| A-W5 | High | Airtel/MTN disbursement status checks use the wrong endpoint or config | A2 §6.11–6.12 | open |
| A-B1 | High | BTC window engine can stall permanently, settle on a stale price, or duplicate windows | A2 §6.13 | open |
| A-U1 | High | Portfolio values CLOB NO positions at the YES price | A2 §6.16 | open |
| A-M1 | High | Matcher does not verify that a maker holds the shares or escrow it trades | A1 #9 | open |
| A-F1 | Critical (latent) | KES un-peg re-denominated positions opened at the peg | A1 #2 | open: settlement-currency decision |
| A-O1 | High (ops) | `scripts/ops/reconcile_ledger.py` rewrites the ledger with fabricated deposits and falls back to `DATABASE_URL` | A2 §6.36 | open |
| A-X | Medium/Low | About 30 further items: dust lock on sells, order-cap race, direct market inserts bypass RBAC, crossed books, incomplete ledger, new markets default to AMM, price history returns the oldest points, legacy `GET /api/orders`, 30 s CDN cache on the book, stuck notifications, FX without sanity bounds, wrong leaderboard P&L, ignored PesaPal reversals, staging image promoted to production, withdrawals to any phone | A1, A2 | open |
