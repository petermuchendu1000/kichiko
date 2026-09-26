# 04 — Academic Literature: The Market-Design "Brain" for Kichiko

**Scope:** Research papers on automated market makers (AMMs), multi-outcome/combinatorial markets, matching and microstructure, Chinese-institution research, and order-book engineering. Each area is read for what it means for Kichiko: a Postgres/Supabase binary and multi-outcome prediction market with a central limit order book (CLOB), for East African mobile-money users who trade small tickets, with thin liquidity on long-tail markets.

**Date compiled:** 2026-09-26

**How the sources were checked.** Every paper listed here was checked on the day of writing against one of the following:
- the arXiv abstract page (title, authors, date and abstract taken from the page's metadata);
- the Crossref API (DOI, title, authors, venue, volume and pages);
- a publisher, RePEc/IDEAS, SSRN, Federal Reserve or university page, or the PDF itself.

For arXiv papers where the report names an institution, the affiliation was read from page 1 of the PDF. If no abstract or full text could be retrieved, the reference is marked **[title-level only]** and the report makes no claims about what it says.

**Labels used in this report:**
- **INFERENCE** marks my own reasoning or my application of a paper to Kichiko. It is not a claim made by the paper.
- **[preprint]** marks work that is not peer-reviewed (arXiv or SSRN only).

**Access problems (logged as required):**
- The Springer page for Guéant–Lehalle–Fernandez-Tapia (2013) was blocked by rate-limiting (HTTP 429). I used the arXiv version of the same paper (1105.3115) instead.
- The ACM DL (403), ResearchGate (429) and some SSRN pages (429) refused automated fetches. Metadata for those papers came from Crossref or RePEc.
- CNKI could not be queried directly. The Chinese-language papers cited here were checked through the publishers' or institutions' own PDFs, which carry DOIs or institutional URLs.

---

## 0. Executive summary and ranked recommendations

**In one paragraph:** The literature points to a hybrid design. Keep a price-time (FIFO) CLOB on an integer tick grid as the primary venue. Give every market a bounded-loss cost-function market maker (LMSR, or liquidity-sensitive LMSR) that posts into that book and quotes when nobody else does. Make coherence across mutually exclusive outcomes native: minting and merging complete sets, plus two-way "NO ⇔ all other YES" conversion. Use a Kalshi-style taker fee proportional to P(1−P). For the thinnest markets, consider periodic uniform-price call auctions instead of continuous matching. Subsidy should be budgeted per market and follow a schedule over time, not be left open-ended.

### Ranked recommendations

| Rank | Recommendation | Main evidence | Counter-evidence / caveats |
|---|---|---|---|
| 1 | **Price-time (FIFO) priority on a fixed tick grid** (1¢, i.e. 99 levels per outcome). Represent the book as a **direct-indexed price-level array**, not a tree. | Pro-rata worsened depth and spreads at LIFFE [R52]. FIFO gives more efficient prices, while pro-rata inflates order sizes and cancellations [R53, R54]. A bounded tick grid makes O(1) level indexing possible, and tree-plus-list books pay pointer-chasing costs [R102, preprint]. | Queue priority reduces risk-sharing among makers; one model estimates quoted depth could change by up to 8.4% [R55]. At Kichiko's scale the data structure is not the bottleneck; Postgres locking is (INFERENCE). |
| 2 | **Hybrid CLOB + automated market maker (LMSR / LS-LMSR) that posts limit orders into the book**, with a per-market subsidy cap. | Hanson designed market scoring rules to solve the "thin market problem" [R1] and described merging book orders with a market scoring rule [R3]. A general ε-fair algorithm for combining market makers with limit orders exists [R21]. LMSR beat a continuous double auction (CDA) on accuracy, **especially on low-activity questions** [R24]. LMSR produced about 3× more trades and lower volatility in simulation [R25]. | In a CDA simulation, an LMSR maker narrowed spreads and raised trader surplus but **did not consistently improve price discovery** [R22]. LMSR is subsidised by construction: worst-case loss is b·ln n (see §A). |
| 3 | **Native complete-set and negRisk conversions in both directions** for multi-outcome markets, plus a coherent multi-outcome market maker (one LMSR over all n outcomes, so prices sum to 1 by construction). | Polymarket arbitrage: about US$40M realised [R39]. When the protocol offered only NO→YES conversion, violations clustered on the unsupported YES side [R41]. | Depth-limited arbitrage is small at retail scale: a median of 14.8 executable shares in NBA markets [R40]. Pricing a full combinatorial LMSR is #P-hard [R33], so offer only flat mutually exclusive sets, not arbitrary combinations. |
| 4 | **Taker-only fee of the form θ·P(1−P)**, with zero or rebated maker fees. | Kalshi charged takers $0.07·P(1−P) and makers nothing during the period studied. Makers lost 9.6% on average versus 31.5% for takers [R70]. Shifting the fee split toward makers narrows quoted spreads, leaves all-in taker costs unchanged, and draws more aggressive retail flow [R57]. | A favourite–longshot bias remains under this fee schedule: contracts priced ≤10¢ lose more than 60% on average [R70]. Fee design alone will not fix mispricing (INFERENCE). |
| 5 | **Periodic call auctions ("frequent batch auctions") for thin or long-tail markets**, possibly every 1–5 s or on demand. Continuous matching stays on for liquid markets. | Batch auctions remove structural latency arbitrage [R44] and restore the liquidity–information trade-off [R46]. In lab tests they reduced predation, speed investment, transaction costs and spread volatility [R47]. A periodic auction "can function where continuous mechanisms fail" [R48]. Chinese exchanges' open call auctions improved depth and reduced volatility [R93]. | Batch auctions sacrifice continuity and raise information costs [R48]. Without incentives, a toy illiquid periodic auction produced **no trade**; fees indexed to the half-spread were needed [R49]. Mobile users may find batch timing confusing (INFERENCE). |
| 6 | **Inventory-aware quoting in logit space** for any house or partner market maker. This adapts Avellaneda–Stoikov and Guéant–Lehalle–Fernandez-Tapia to [0,1] contracts: widen near 50/50 and near resolution, and skew by inventory. | Classic inventory models [R60, R61]. Prediction-market-specific optimal quotes that account for settlement risk [R62, preprint]. A logit jump-diffusion kernel [R63, preprint]. Structural volatility is highest near 50/50 and rises near resolution [R64, preprint]. | All three prediction-market papers are 2025–26 preprints. Calibration on Kichiko-scale data is untested. |
| 7 | **Time-scheduled subsidy for the automated market maker** (uniform-loss or pm-AMM-style liquidity withdrawal) and, later, **adaptive liquidity**. | Uniform-loss AMMs and liquidity schedules that shape loss across price and time [R14]. The dynamic pm-AMM spreads LP loss evenly over time instead of concentrating it near expiry [R13]. Online-learning mixtures over liquidity levels keep bounded loss [R17, preprint]. | Theory and simulation only; no field results. |
| 8 | **Surveillance: self-trade prevention, network or cluster wash-trade detection, and manipulation monitoring on thin markets.** Do not rely on VPIN. | Wash trading peaked near 60% of Polymarket volume and was about 20% in October 2025 [R77]. Field experiment: manipulations remained visible 60 days later, and thinner markets were easier to move [R76]. VPIN is a poor predictor of short-run volatility [R59]. | Cong et al.'s 70%+ estimate [R78] covers unregulated crypto exchanges, not prediction markets. KYC through mobile money reduces anonymity (INFERENCE). |

---

## A. Automated market makers for prediction markets

### A.1 Key findings

**Market scoring rules and LMSR (foundations)**
- **Hanson (2003) [R1]** frames the core problem as the "thin market and irrational participation problems." Market scoring rules avoid both by becoming automated market makers in the thick-market case and simple scoring rules in the thin-market case. "Logarithmic versions have cost and modularity advantages." The paper also covers representing conditional estimates and "how to avoid becoming a money pump via errors in calculating probabilities."
- **Hanson (2007) [R2]:** logarithmic market scoring rules preserve conditional probabilities and independence relations. They let a market estimate all combinations of base events at no additional cost.
- **Hanson (2003, 3-page note) [R3]:** "explains how to smoothly integrate booked orders with a combinatorial market maker." This is the original hybrid LMSR + order-book design.
- **Berg & Proebsting (2009) [R4]:** implementation formulae for Hanson's market maker, covering rounding error and fraud prevention, with a numerical example from Microsoft's internal prediction market. **INFERENCE:** this is directly relevant to fixed-point or NUMERIC implementation in Postgres.

**Loss bounds and the space of cost functions**
- **Chen & Pennock (utility framework) [R5]:**
  - LMSR is equivalent to a negative-exponential-utility market maker.
  - "For a fixed bound on worst-case loss, some market makers exhibit greater liquidity near uniform prices and some … near extreme prices, but no market maker can exhibit uniformly greater liquidity in all regimes."
  - **INFERENCE:** there is no free lunch in choosing a cost function. Pick one based on where Kichiko's markets usually trade. Long-tail markets often sit near extremes.
- **Abernethy, Chen & Wortman Vaughan (2013) [R8]:**
  - Any market satisfying intuitive conditions must price securities through a convex cost function (built by conjugate duality).
  - Market making reduces to convex optimisation over a convex hull. Relaxing the hull gains tractability without breaking the bounded budget.
  - The paper also draws the correspondence to online learning.
- **Othman, Pennock, Reeves & Sandholm (2013), LS-LMSR [R6]:**
  - Standard market makers "are unable to adapt to liquidity" and "run at a deficit."
  - LS-LMSR has bounded loss for any initial liquidity, and worst-case loss → 0 as initial liquidity → 0.
  - There is a region of state space where the market maker "books a profit regardless of the realized outcome."
  - Mechanism, from the paper: b(q) = α·Σqᵢ, and prices sum to more than 1 (a built-in "vig", up to 1 + α·n·log n).
- **Related adaptive-liquidity work [title-level only]:** Othman & Sandholm (2012) on profit-charging market makers with bounded loss and vanishing spreads [R7]; the axiomatic characterisation of adaptive-liquidity market makers [R9]; volume-parameterised market makers [R10].

**Learning market makers**
- **Brahma et al. (2012), Bayesian Market Maker [R11]:**
  - Built for binary/[0,1] markets. By giving up the bounded-loss guarantee, it achieves "significantly lower expected loss at the same level of liquidity" and "rapid convergence when there is a jump."
  - It was evaluated with trading agents and human subjects.
  - Stated trade-off: "an inherent tradeoff between adaptability to market shocks and convergence during market equilibrium."
- **Della Penna & Reid (2011) [R12]:** combines cost-function market makers with bandit algorithms. It gets profit-regret guarantees within a class of "overround" cost functions while keeping bounded worst-case loss.

**Loss-versus-rebalancing (LVR) and the prediction-market AMMs of 2024–26**
- **Milionis, Moallemi, Roughgarden & Zhang (2022) [R15]:** LP returns split into market-risk beta and a microstructure alpha (fees minus losses to arbitrageurs). This is the framework used by the next two items.
- **Moallemi & Robinson (2024), pm-AMM [R13]** (Paradigm research post, not peer-reviewed):
  - Built for "Gaussian score dynamics."
  - A uniform AMM "loses money at a constant rate proportional to its value."
  - The dynamic version withdraws liquidity on a schedule so that "the expected rate of loss is constant over time." About "half the initial wealth is lost by the end."
- **Moallemi, Robinson & Zhu (2026) [R14, preprint]:**
  - The existing literature bounds total worst-case loss "but has not addressed how that loss is distributed across price states or over time."
  - Defines uniform AMMs, where instantaneous LVR is proportional to pool value and independent of price.
  - Shows a correspondence between "win-martingales" (processes converging to 0 or 1 at resolution) and pricing functions.
  - Shows that liquidity can be scheduled to hit a "prescribed target expected cumulative loss schedule."
  - Links constant-product market makers and LMSR to canonical processes (Wright–Fisher, logistic, Gaussian score).

**Liquidity provisioning, adaptive liquidity and subsidy recovery (2023–26)**
- **Bhaskara, Frongillo, Lindgren & Papireddygari (2023; EC 2026) [R16]:**
  - A general protocol lets third-party LPs supply arbitrary cost functions.
  - With three or more securities, liquidity is matrix-valued, and "natural axioms on the design of these fees are incompatible."
  - **INFERENCE:** outside LP pools are much harder to design for multi-outcome markets. Keep the Kichiko market maker house-funded at first.
- **Nueve, Nguyen, Frongillo & Waggoner (2026) [R17, preprint]:** treat liquidity selection as online learning. The paper mixes a family of cost-function markets with learnable weights, while preserving no-arbitrage, bounded loss and "positive upside," with switching-regret guarantees. Results are from simulation only.
- **Papireddygari, Wang, Waggoner & Pennock (2025; EC 2026) [R18, preprint]:**
  - The Constant Log Utility Market Maker (CLUM) "has constant worst-case loss," unlike LMSR, whose loss grows with the number of outcomes. Outcomes can be added on the fly.
  - Pricing securities is #P-hard. An approximation algorithm is given, and it runs in polynomial time for interval securities.
- **Chen et al. (2026), Seed Capital Flow [R19, preprint]:**
  - A direction-conditioned levy in a binary cost-function market improves expected recovery of prefunded liquidity when order composition differs by direction.
  - The authors themselves say it is "a mechanism-design tradeoff rather than an empirical prediction."
- **Amini, Bichuch & Feinstein (2025) [R20]:** a liquidity-based AMM for prediction markets, with pooling/withdrawal and fees that compensate LPs (Mathematical Finance).

**Hybrid market maker + order book: theory, simulation and field evidence**
- **Heidari, Lahaie, Pennock & Wortman Vaughan (2018; EC 2015) [R21]:**
  - "The first concrete algorithm for combining market makers and limit orders in a prediction market with continuous trade."
  - Defines ε-fair trading paths. Under supermodularity, an efficient endpoint is reachable fairly; in general it is not. They give an algorithm that respects ε-fairness and simulate it on 2008 US election combinatorial data.
  - **INFERENCE:** this is the most directly usable blueprint for an "AMM that posts into a CLOB."
- **Chakraborty, Das & Peabody (2015) [R22]:** an LMSR-based market maker built on Hanson's book-order idea, inside a CDA with zero-intelligence traders. It "reduces bid-ask spreads and enhances trader surplus" but "does not consistently strengthen price discovery," more so when trader beliefs vary widely.
- **Wah, Lahaie & Pennock (2016) [R23]:** empirical game-theoretic analysis (EGTA) of an LMSR market maker, with lagged signals built from Betfair NBA data. It studies how the maker's liquidity and spread settings affect price discovery and welfare.
- **Atanasov, Witkowski, Mellers & Tetlock (2025) [R24]:** in a multi-year forecasting tournament, the "LMSR market produces more accurate forecasts than the CDA market, especially on low-activity questions." **This is the most Kichiko-relevant empirical result in topic A.**
- **Klingert & Meyer (2018) [R25]:** in a lab-validated agent-based model, LMSR produced about 3× more trades and lower volatility. Its accuracy advantage was context-dependent and reversed under extreme information distributions.
- **Jian & Sami (2012) [R26]:** in the lab, the direct probability-report and indirect security-trading forms of the market scoring rule performed about the same. Structured trade order beat unstructured.

**AMM–CLOB coexistence, from DeFi**
- **Aoyagi & Ito (2025) [R27]:**
  - Informed traders move to the AMM when it is deeper.
  - "Liquidity on the DEX has a positive spillover effect on CEX liquidity," because adverse selection on the CLOB falls.
  - AMM LPs can profit from noise flow through convexity, even without fees.
- **Lehar & Parlour (2025) [R28]:** using 95.8M Uniswap interactions, they find no long-lived arbitrage and set out "conditions under which the AMM dominates a limit order market."
- **Tran, Tran & Nguyen (2024) [R29]:** an AMM whose implied order-book shape imitates real order books, reducing impermanent loss and slippage.
- **Baggiani, Herdegen & Sánchez-Betancourt (2025) [R30, preprint]:** optimal dynamic AMM fees fall into two regimes, high to deter arbitrageurs and low to attract noise traders. Fees linear in inventory are a good approximation.

**Gnosis/Omen FPMM.** No peer-reviewed or arXiv paper analysing the Gnosis fixed-product market maker as such was found. The Gnosis contract source and documentation exist, but they are not scholarship.
- The closest academic treatment is R14. It maps constant-product-style pricing to a win-martingale class, so the FPMM can be analysed in the uniform-LVR framework.
- **INFERENCE:** treat FPMM as one point in the R5/R14 design space: a constant-product-like curve with more liquidity near 50/50. It has no advantage over LMSR for a centralised operator, apart from being self-funding through LP deposits.

### A.2 Worked subsidy numbers (INFERENCE, derived from the standard LMSR cost function in R1/R2/R5)

For a binary LMSR with liquidity parameter b:
- **Worst-case loss** = b·ln 2 ≈ 0.693·b. For n outcomes it is b·ln n; for example, 2.30·b at n = 10.
- **Cost to move YES from 0.50 to p** = b·ln(1 / (2(1−p))).
  - 0.50 → 0.60 costs 0.223·b.
  - 0.50 → 0.90 costs 1.609·b.
- **Example with b = KES 1,000:** the maximum subsidy is KES 693 per binary market. A KES 223 purchase moves the price 10 points.
- For thin, small-ticket markets, set b small enough that a typical ticket (say KES 50–200) moves the price only a few points, and cap the total per-market subsidy.
- LS-LMSR [R6] makes b grow with volume, so a new market starts sensitive and deepens as flow arrives. This matches long-tail markets well.

### A.3 Applicability to Kichiko

- **Thin books.** Of everything reviewed, the hybrid design has the strongest empirical support for low-activity questions [R24], and the ε-fair algorithm [R21] shows how to build it. A pure CLOB leaves long-tail markets with no quotes.
- **Small tickets.** LMSR prices are defined for fractional quantities. Round to the platform's minimum share unit, and always round in the house's favour, as Berg & Proebsting stress for rounding and fraud [R4].
- **Postgres.** LMSR needs exp/ln. Computing in NUMERIC or double inside PL/pgSQL is fine, provided the log-sum-exp is computed in the numerically stable way (INFERENCE).
- **Subsidy governance.** Per-market worst-case loss is known in advance (b·ln n). Fund it from a treasury ledger, and optionally recover some of it through the LS-LMSR "vig" [R6] or fees [R19].

---

## B. Combinatorial and multi-outcome markets

### B.1 Key findings

**Complexity**
- **Chen, Fortnow, Lambert, Pennock & Wortman (2008) [R33]:**
  - Even with "severely limited languages," LMSR pricing over permutation and Boolean combinatorics is #P-hard, "even when the same language admits polynomial-time matching without the market maker."
  - They propose an approximation for permutation markets based on online permutation learning.
- **CLUM [R18]:** pricing is also #P-hard. It becomes polynomial for interval securities.
- **Hossain, Wang & Yu (2024) [R37, preprint]:** combinatorial LMSR price queries and updates are equivalent to range query and range update problems. Sublinear algorithms exist when the VC dimension is bounded, and do not exist when it is unbounded.

**Arbitrage-free pricing across linked outcomes**
- **Kroer, Dudík, Lahaie & Balakrishnan (2016) [R35]:** arbitrage-free pricing with bounded subsidy is #P-hard in the worst case. They solve it in practice with Frank–Wolfe Bregman projection using an integer-programming oracle, on 2010 NCAA bracket data with an outcome space of 2⁶³.
- **[title-level only]:** Dudík, Lahaie & Pennock's constraint-generation market maker [R34]; Laskey et al.'s graphical-model market maker [R36].
- **Rana et al. (2026), ParlayMarket [R38, preprint]:**
  - A pairwise exponential-family belief state compresses the 2^M outcome space to O(M²) statistics. All base and parlay prices are then marginals of one coherent distribution.
  - Market-maker loss grows at most quadratically in M.
  - The model was tested on Kalshi combo data.

**Empirical arbitrage and mispricing on Polymarket (2025–26)**
- **Saguillo, Ghafouri, Kiffer & Suarez-Tangil (AFT 2025) [R39]:** identifies "Market Rebalancing Arbitrage" (within one market, where prices fail to sum to $1) and "Combinatorial Arbitrage" (across markets). A "realized estimate of 40 million USD of profit extracted."
- **Gebele, Mutzel & Matthes (2026) [R41, preprint]:**
  - Separates payoff-space no-arbitrage from **protocol-executable** no-arbitrage.
  - Polymarket's NegRisk Adapter supports only NO→YES before settlement. Positive violations cluster on the unsupported YES side, while the supported NO-side violations are "less frequent and shorter-lived."
  - Estimates about $1.12M in arbitrage profit.
  - Prototypes a **bidirectional** adapter, and concludes that efficiency depends on "whether protocols expose payoff equivalences as executable primitives."
- **Cheng, Yang & Zou (2026) [R40, preprint]:** 75M order-book snapshots across 173 NBA games.
  - Single-market anomalies were very rare: 7 episodes, median duration 3.6 s.
  - There were 290 combinatorial episodes, with a median return of 101 bp, but 76.9% were limited to an average executable size of 14.8 shares. Extraction is confined "to the retail scale."
- **Across platforms:**
  - Semantically equivalent markets on different venues show persistent execution-aware deviations of 2–4% [R42, preprint].
  - In 2024 US election markets, identical contracts had divergent prices across exchanges, with arbitrage opportunities peaking in the final two weeks [R43].

### B.2 Applicability to Kichiko

- **Coherence by construction.** For an n-outcome mutually exclusive market, one LMSR over all n outcomes gives prices that sum exactly to 1 (the standard LMSR property from R1/R2). With LS-LMSR, the sum slightly exceeds 1 by design [R6].
- **Coherence through conversion.** In the CLOB, provide these operations as atomic Postgres functions (INFERENCE based on R41):
  - mint a complete set (1 KES → one YES of each outcome);
  - merge a complete set back into 1 KES;
  - NO(i) → YES(all j ≠ i);
  - **and** the reverse, YES(all j ≠ i) → NO(i).
  
  R41's evidence is that one-directional conversion leaves exploitable, persistent violations.
- **Do not offer arbitrary combinatorial bets.** The complexity results [R33, R18] and the subsidy results [R35] argue against it. If parlays are wanted later, R38's pairwise model is the tractable design to follow.
- **Arbitrage bots as liquidity.** The Polymarket evidence [R39, R40] shows arbitrageurs enforce sum-to-one only as far as depth allows. On thin books, the house market maker plus native conversions is what enforces coherence (INFERENCE).

---

## C. Matching and microstructure

### C.1 Priority rules: price-time vs pro-rata

- **Lepone & Yang (2012) [R52]:** after LIFFE moved Euribor futures to pure pro-rata, "both best and total depth fall" and "quoted spreads widen." Volume and trade frequency rose, and liquidity demanders submitted smaller market orders.
- **Haynes & Onur (2020) [R53]:** in a natural experiment where a Treasury futures contract switched from pro-rata to FIFO, "orders placed later in time are significantly more profitable under pro-rata," while "FIFO matching produces more efficient pricing." Order sizes and cancellations rose under pro-rata.
- **Field & Large (2008) [R54]:** in one-tick pro-rata futures markets, displayed depth is about two orders of magnitude larger than market orders and cancellations exceed 96%. Traders submit oversized orders they expect to cancel.
- **Counterpoint, Garriott, van Kervel & Zoican (2025) [R55]:** queue position affects adverse selection and inventory management, and queuing can reduce risk-sharing among market makers. "Optimizing risk sharing through queue reordering decreases quoted depth by up to 8.4%."
- **Applicability (INFERENCE):** with small tickets, pro-rata splits create fractional allocations and invite order-size inflation. FIFO is simpler, fairer to retail, and easier to explain.

### C.2 Continuous matching vs frequent batch auctions; speed bumps

- **Budish, Cramton & Shim (2015) [R44]:** continuous serial processing "implies that even symmetrically observed public information creates arbitrage rents," which harm liquidity. Frequent batch auctions (uniform-price double auctions, for example every 100 ms) "directly address the flaws."
- **Aquilina, Budish & O'Neill (2022) [R45]:** latency-arbitrage races occur about once per minute per FTSE 100 symbol and make up about 20% of volume. They impose a roughly 0.5 bp tax. Eliminating them would cut the cost of liquidity by 17%.
- **Baldauf & Mollner (2020) [R46]:** high-frequency trading pushes outcomes inside the liquidity–information frontier. Frequent batch auctions, or delaying all orders except cancellations, restore it.
- **Aldrich & López Vargas (2020) [R47], lab:** compared with a continuous double auction, frequent batch auctions showed less predation, lower speed investment, lower transaction costs and lower spread volatility.
- **Madhavan (1992) [R48]:** a periodic auction "offers greater price efficiency and can function where continuous mechanisms fail, [but] traders must sacrifice continuity and bear higher information costs."
- **Derchu et al. (2023) [R49, preprint]:** in a toy two-player periodic auction with no incentives, "the market is inefficient and does not lead to any trade." Quadratic fees indexed to each player's half-spread produce trade.
- **Speed bumps:**
  - Lab: asymmetric speed bumps cut speed investment by only about 20%, and a symmetric speed bump performed no better than none [R50].
  - Eurex's 2019 asymmetric speed bump on French equity options reduced spreads and increased depth, with spillover benefits to Euronext [R51].
- **Applicability (INFERENCE):**
  - Kichiko users arrive over USSD, SMS, app and web with very different latencies. For small-ticket retail flow, the "structural arbitrage rent" argument [R44] becomes a fairness argument: a batch every few seconds neutralises channel latency.
  - A batch also lets Postgres process a market's orders in one transaction per interval, which reduces lock contention.
  - Madhavan's result [R48] supports call auctions specifically for thin markets. Derchu et al. [R49] warn that an illiquid periodic auction may need maker incentives or a house market maker to produce any trade at all.
  - Suggested pattern: continuous matching for the top markets, and periodic calls with the automated market maker participating for long-tail markets.

### C.3 Tick size

- **Chung, Lee & Rösch (2020) [R56], SEC Tick Size Pilot (larger tick):** "liquidity for small orders (e.g., the quoted and effective spreads) decreases, [while] liquidity for large orders … improves." Pricing efficiency and trade size rose, and the number of trades fell.
- **Dubach (2026) [R79, preprint], Polymarket:** documents a "longshot spread premium," with depth "closer to uniform than to top-of-book."
- **Applicability (INFERENCE):**
  - Kichiko's users are small-order traders, so R56 argues against coarse ticks.
  - 1¢ (99 levels) is a sensible default. A finer 0.1¢ tick near the extremes (below 5¢ or above 95¢) would reduce the proportional cost of longshot contracts, where R79 finds spread premiums.
  - A mixed-tick grid is still a bounded array of about 190 levels, which keeps the O(1) indexing in §E.

### C.4 Maker-taker fees and rebates

- **Malinova & Park (2015) [R57], Toronto Stock Exchange:** "transaction costs for liquidity demanders remain unaffected once fees are taken into account," but as posted spreads fall, "traders (particularly retail) use aggressive orders more frequently, and adverse selection costs decrease."
- **Bürgi, Deng & Whelan (2025/26) [R70], Kalshi:**
  - Taker fee of $0.07·P(1−P); makers paid no fee in the period studied.
  - Across 313,972 price observations, makers returned −9.64% on average and takers −31.46%.
- **Applicability (INFERENCE):**
  - A P(1−P)-shaped fee is proportional to the variance of the binary payoff, is symmetric in YES and NO, and falls to near zero at extreme prices.
  - Zero maker fees reward resting liquidity, which is what thin books lack most.
  - For KES micro-tickets, compute fees at order level with ceiling rounding to the smallest currency unit, and publish the formula.

### C.5 Order-flow toxicity

- **Easley, López de Prado & O'Hara (2012) [R58]:** introduce VPIN, a toxicity metric computed in volume time.
- **Andersen & Bondarenko (2014) [R59]:** "VPIN is a poor predictor of short run volatility." It peaked **after** the Flash Crash, not before, and its predictive power comes from its mechanical link to trading intensity.
- **Applicability (INFERENCE):**
  - In prediction markets, the main toxic flow is news and insider information about the event, not microstructure-horizon toxicity.
  - Measure per-account markouts and the market maker's P&L by counterparty.
  - Pause or widen the house market maker around scheduled resolution events (see C.6 on volatility near resolution).
  - Do not build on VPIN.

### C.6 Optimal market making, adapted to bounded [0,1] contracts

- **Avellaneda & Stoikov (2008) [R60]:** the dealer computes an inventory-dependent "indifference valuation," then calibrates quotes to the book. This produces P&L and final inventories with "significantly less variance" than symmetric quoting.
- **Guéant, Lehalle & Fernandez-Tapia (2013) [R61]:** the HJB equations reduce to a system of linear ODEs. The paper solves the problem under inventory constraints and gives closed-form approximations of optimal quotes.
- **Feil & Nendel (2026) [R62, preprint]:**
  - The price is a conditional probability generated by a transformed latent belief diffusion. The market maker controls both mark-to-market inventory risk and **settlement risk at resolution**.
  - Proves existence and uniqueness of optimal quotes.
  - The strategy "substantially improves downside protection while preserving most of its expected profit" compared with a myopic benchmark.
- **Dalen (2025) [R63, preprint]:** a logit jump-diffusion with risk-neutral drift, where the price p_t is a Q-martingale, with a calibration pipeline that separates diffusion from jumps.
- **Xi, Moallemi, Pai & Wang (2026) [R64, preprint], Kalshi panel:**
  - Volatility combines Wright–Fisher deadline resolution with Glosten–Milgrom order flow.
  - "Volatility is highest near fifty-fifty prices, rises near resolution."
  - The structural model dominates ARCH/GARCH.
- **Applicability (INFERENCE):** quote in logit space, set half-spreads to scale with the estimated belief volatility (largest near 0.5 and near the deadline), skew by inventory as in A-S/GLFT, and hard-cap inventory per outcome. Treat every quoting parameter as provisional until Kichiko's own data is available.

### C.7 Favourite–longshot bias (FLB) and calibration

- **Snowberg & Wolfers (2010) [R68]:** in horse-racing data, "misperceptions of probability drive the favorite-longshot bias," consistent with Prospect Theory.
- **Page & Clemen (2013) [R69]:** prediction markets "are reasonably well calibrated when time to expiration is relatively short, but prices are significantly biased for events farther in the future," in the FLB direction.
- **Bürgi et al. [R70], Kalshi:** a "clear favorite–longshot bias." Contracts at ≤10¢ lose more than 60% on average, and the average return is about −20%.
- **Le (2026) [R71, preprint]:** 353M trades across 429k Kalshi and Polymarket contracts show "persistent underconfidence in political markets, where prices compress toward 50%." Calibration depends on domain, horizon and trade size.
- **Maresca (2026) [R72, preprint], LLM-agent simulation:** paying interest on positions removed about 83% of the horizon effect on accuracy.
- **Applicability (INFERENCE):**
  - Long-dated long-tail markets will be biased because capital is locked up [R69, R72]. Consider interest-like incentives or shorter horizons with rollover.
  - Retail users disproportionately buy cheap longshots [R70]. Consider consumer-protection disclosures showing the historical realised return by price bucket.

### C.8 Empirical studies of Polymarket and Kalshi

- **Accuracy:**
  - The Iowa Electronic Markets were closer to the outcome than 964 polls 74% of the time, and outperformed them more than 100 days ahead [R74].
  - Polymarket was superior to polling in 2024, especially in swing states [R82, preprint].
  - Clinton & Huang [R43] give a more critical view: across more than 2,500 markets, the share of correct predictions was 93% on PredictIt, 78% on Kalshi and 67% on Polymarket, with "little evidence of efficiency."
- **Volume measurement and price impact:**
  - Because Polymarket mints and burns shares inside trades, naive volume overstates turnover: $958M naive vs $391M actual for the Trump market in October 2024. Moving the price 5 points cost $9.1M [R80, preprint]. The overstatement is "largest in thin, young ones."
  - Price responses track what the news reveals about linked candidates, not trading volume [R81, preprint].
- **Microstructure [R79, preprint]:**
  - 30B events.
  - Self-counterparty wash share: median 1%, upper tail 22%.
  - Trade direction taken from the public feed matches on-chain ground truth in only about 59% of buckets.
- **Wash trading:**
  - Network-based detection finds suspicious patterns peaking near 60% of Polymarket volume in December 2024, and about 20% by early October 2025 [R77, SSRN]. This is the "Columbia study."
  - On unregulated crypto exchanges, wash trading exceeds 70% of reported volume [R78].
- **Manipulation:**
  - A field experiment shocked 817 markets. Effects were visible 60 days later and faded gradually. Markets with more traders, higher volume and an external probability source were harder to manipulate [R76, preprint].
  - Intrade data suggested manipulation by a single large trader [R75].
- **Macro forecasts:** Kalshi-implied macro forecasts are a real-time, distributional benchmark useful to policymakers [R73, Federal Reserve FEDS].
- **Applicability (INFERENCE):**
  - Kichiko's thin markets are exactly where manipulation persists [R76] and volume figures are most distorted [R80].
  - Record the true trade direction (aggressor side) in the ledger, which a Postgres engine can do trivially.
  - Report net turnover separately from mint/burn volume.
  - Run self-trade prevention and cluster detection on the counterparty graph [R77].

---

## D. Chinese scholarship (researchers at Chinese institutions)

Affiliations were read from page 1 of each paper unless noted otherwise. English translations of Chinese titles are my own.

### D.1 Matching mechanisms: SSE and SZSE call and continuous auctions

- **Li Ping 李平, Xu Xiangcun 许香存, Zeng Yong 曾勇, University of Electronic Science and Technology of China (UESTC), School of Management, [R93].** 《不可撤单模式开放式集合竞价研究：理论与实证》 ("Open call auctions with a no-cancellation phase: theory and evidence"), CFRN working paper PDF, NSFC grant 70703002.
  - Under rational expectations, open call auctions (which show an indicative price, matched volume and unmatched volume during order collection) reveal more private information, give **better market depth and lower volatility** than blind call auctions.
  - The gap narrows as the share of informed traders rises.
  - Empirically, the paper studies China's move to open call auctions: the SZSE SME board from June 2004, and SSE/SZSE main-board openings from 1 July 2006.
  - It describes the Chinese design as: no market makers; limit orders only; real-time indicative information; no cancellation in the latter part of the call; a fixed end time.
- **Shi Donghui 施东晖, SSE Research Center (2006) [R94].** 《收盘集合竞价设计与股价操纵》 ("Closing call auction design and stock-price manipulation"), per a WebFetch summary of the PDF.
  - Different matching algorithms can produce different closing prices. Large orders near the close can create imbalances that allow manipulation, and less liquid stocks are cheaper to manipulate.
  - Recommends safeguards such as "volatility extensions and random ending times."
  - The PDF's embedded CJK fonts could not be extracted locally; this summary is from WebFetch.
- **Han Qian, Zhao Chengzhi, Chen Jing & Guo Qian (2022) [R95],** natural experiment from SSE's August 2018 closing call auction. Per the RePEc abstract:
  - "no significant impact on market liquidity";
  - trading shifted to the pre-close, and pre-close volatility rose;
  - closing-price continuity improved significantly, but price efficiency did not;
  - the effect was strongest in small caps.
- **Li Mengyu, Qi Tiange, Huang Yongjian, Feng Panpan & Zhao Yingying (2024/25) [R96]:** the same 2018 SSE reform "can effectively reduce closing price manipulation."
- **Li, Luo & Zhou (2021), "Call auction, continuous trading and closing price formation" [R97, title-level only; abstract not retrieved].**
- **Applicability (INFERENCE):**
  - The Chinese design is well tested and suits Kichiko's thin markets: an open (indicative-price) call auction, with a no-cancel window before the uncross and a random end time to deter last-second manipulation.
  - Use it for market opening, for long-tail markets that trade in calls, and for the final window before a market closes to trading.
  - The uncross rule is the standard maximum-volume rule, then minimum imbalance, then reference price.

### D.2 High-performance matching engines and order-book hardware

- **Zheng Yile (supervised by Wei Zhang), HKUST, MPhil thesis (2023), "FPGA-based acceleration for high frequency trading" [R98]:** an FPGA local order-book reconstruction system cut memory use by 1.98–93.21× while keeping latency low. The accelerated predictive model ran up to 6.63× faster.
- I found no peer-reviewed matching-engine or lock-free order-book paper from a mainland-Chinese institution with verifiable metadata. Chinese-language material on 撮合引擎 (matching engines) that turned up was blogs (Zhihu, CSDN, Tencent Cloud) or SSE's in-house trade magazine 《交易技术前沿》 ("Trading Technology Frontier"). Its issue pages carry no machine-readable article metadata, so it is not cited.

### D.3 Limit order book modelling and deep-learning LOB prediction

- **Yang Jiahao, Fang Ran, Zhang Ming & Zhou Jun, Institute of Acoustics, CAS / University of CAS (2025) [R86, preprint]:**
  - A Siamese architecture processes the ask and bid sides with shared weights, exploiting bid/ask symmetry.
  - On 14 Chinese A-share stocks it improved strong baselines "in over 75% of cases." Multi-head attention helped at short horizons.
- **Wu Yucheng, Wang Shuxin & Fu Xianghua, Shenzhen University / Shenzhen Technology University (2024) [R87]:** a Long Short-Term Temporal Fusion Transformer, with candlestick-style framing to reduce noise, for short-term LOB forecasting in Chinese markets (Applied Intelligence).
- **Huang, Ge, Chou & Du (2021) [R88]:** "Benchmark Dataset for Short-Term Market Prediction of Limit Order Book in China Markets" (Journal of Financial Data Science). Existence was checked via Crossref; affiliations were not checked, because ResearchGate returned 429.
- **Li Junjie, Liu Yang, Liu Weiqing, Fang Shikai, Wang Lewen, Xu Chang & Bian Jiang, Microsoft Research Asia (ICLR 2025) [R85]:**
  - MarS is an order-level generative "Large Market Model" for realistic, interactive market simulation. It shows scalability with data and model size and "robust and practicable realism in controlled generation with market impact."
  - **INFERENCE:** a candidate tool for stress-testing Kichiko's matching rules before launch.
- **Counter-evidence (non-Chinese):**
  - Deep LOB forecasting power "does not necessarily correspond to actionable trading signals" [R106].
  - With preprocessing, simple models match or beat DeepLOB on crypto LOB data [R107].
  - **INFERENCE:** deep LOB models are not a priority for Kichiko's thin books.

### D.4 Market making with reinforcement learning

- **Guo Hong, Lin Jianwu (Tsinghua Shenzhen International Graduate School) & Huang Fanlin (Microsoft Beijing) (2023) [R83, preprint]:** an RL market-making agent with Attn-LOB feature extraction (convolution + attention), a continuous action space and a hybrid reward. Experiments on latency and interpretability.
- **Niu Hui (Tsinghua), Li Siyuan (HIT), Zheng Jiahao, Lin Zhouchi, Guo Jian (IDEA), Li Jian (Tsinghua) & An Bo (NTU), IJCAI 2024 [R84]:**
  - IMM combines imitation of signal-based expert strategies with RL to learn multi-price-level market making.
  - A representation-learning unit captures short- and long-term trends to reduce adverse selection.
  - It beat RL baselines on four real datasets.
- **Note:** Jiang et al. (2022), "Market Making via Reinforcement Learning in China Commodity Market," is a KU Leuven MSc thesis, not a Chinese institution [R101].
- **Applicability (INFERENCE):** RL market making needs dense data and a simulator. For Kichiko it is a phase-3 option at best. The analytical logit-space quoter in C.6 is the practical choice.

### D.5 Prediction markets and information aggregation

- **Kong Yuqing, Peking University (with Schoenebeck, Michigan) (2022) [R92, preprint]:** when agents' private information is conditionally independent (given the outcome) whenever their beliefs are similar, information is aggregated and there is no "false consensus." The expected reward for revealing information in a prediction market equals the conditional mutual information of what is revealed.
- **Yang Zichao, Zhongnan University of Economics and Law (with Tsang, Virginia Tech) [R80, R81]:** the Polymarket 2024 studies summarised in C.8.
- **Li Guoqiu 李国秋 & Lü Bin 吕斌 (2014), 《预测市场：理论基础、运行机制及其应用》 ("Prediction markets: theoretical foundations, operating mechanisms and applications"), 图书情报工作 (Library and Information Service) 58(1), DOI 10.13266/j.issn.0252-3116.2014.01.009 [R99]:** a Chinese-language review of more than 100 foreign prediction-market studies, covering mechanisms, theory, applications and accuracy evidence. Institutional affiliation was not machine-readable in the PDF.
- **Xiong Haowen 熊浩文, Fudan Development Institute (2026), seminar report 《预测市场：原理、现状与展望》 ("Prediction markets: principles, status and outlook") [R100]:**
  - Not peer-reviewed.
  - It stresses manipulation and insider-information risks and misaligned platform incentives.
  - **Caution:** it describes Polymarket as using AMM/LMSR, which conflicts with the order-book evidence in R39–R41 and R79. Treat its mechanism description as unreliable.

### D.6 Blockchain DEX order books and AMMs

- **Xue Dong He, Chen Yang & Yutian Zhou, CUHK SEEM [R89, preprint]:** "Optimal Design of Automated Market Makers on Decentralized Exchanges." For a risk-averse LP, the optimal unit trading fee rises with fundamental volatility, and the optimal pricing function makes the pool allocation efficient for the LP.
- **Same authors [R90, preprint]:** "Arbitrage on Decentralized Exchanges." An equilibrium model of gas-fee competition between arbitrageurs. There is no pure symmetric equilibrium, but there are unique mixed equilibria. Validated on Binance and Uniswap V2.
- **Wang Ye (ETH), Chen Yan (Zhejiang University), Wu Haotian (Xi'an Jiaotong University), Zhou Liyi (Imperial), Deng Shuiguang (Zhejiang University) & Wattenhofer (ETH), WWW 2022 Companion [R91]:** "Cyclic Arbitrage in Decentralized Exchanges." Empirical cyclic arbitrage across AMM pools.
- **Applicability (INFERENCE):** R89's finding that the fee should rise with volatility supports volatility-scaled fees or spreads for the Kichiko market maker near resolution, which is consistent with C.6.

---

## E. Engineering-relevant algorithms: order-book data structures and benchmarks

### E.1 Findings

- **Yoon (2026), "The World's Fastest Matching Engine Algorithm" [R102, preprint; single author, industry, not peer-reviewed]:**
  - Ran 247 open-source FIFO engines through one harness on 10⁹+ messages. "Only 47 are correct as shipped."
  - "Every classical book, linked lists in a balanced tree, pays a pointer chase on every operation and an O(log n) root-to-leaf search to open each new price level."
  - The proposed design uses contiguous slots with O(1) insertion plus a neighbour-aware tree. It reports 33.2M messages/s worst case on one core, with sub-microsecond P99.
  - It also notes that per-symbol matching logic is strictly serialised, so Amdahl's law makes it the bottleneck.
- **Jericevich, Sing & Gebbie (2022), CoinTossX, University of the Witwatersrand [R103]:** an open-source Java matching engine (UDP, Aeron). Reported 90th-percentile latencies of 106–248 ns on a high-spec server (1–10 clients) and 123–393 ns on an Azure VM. **Caveat:** the same summary reports Azure throughput of "77–274 orders per second," which is internally odd; check it against the paper before relying on it.
- **Kashera, Jain, Banerjee & Purini (FPL 2023) [R104, title-level only]:** hybrid binary/linear search structures for low-latency FPGA order books.
- **Zheng (HKUST, 2023) [R98]:** FPGA order-book reconstruction with 1.98–93.21× memory reduction.
- **Moosavi & Clark (2021), Lissy [R105]:** an on-chain call-market exchange is "too heavy for Ethereum today" (a few hundred executions per block) but cut gas cost by 99.88% on Arbitrum. **INFERENCE:** relevant only if Kichiko ever moves settlement on-chain.
- **Gap:** I found **no peer-reviewed paper benchmarking price-level arrays vs red-black trees vs skip lists on bounded tick grids** such as the 99–999 levels of a prediction market. The array argument comes from complexity reasoning and R102, which is a preprint.

### E.2 Recommended data structures for Kichiko (INFERENCE, grounded in E.1 and C.1)

1. **Price-level array, per (market, outcome, side), indexed by integer tick 1..99 (or 1..999).**
   - Best-price lookup can use a bitmap of non-empty levels, or a cached best-tick pointer updated on insert and fill.
   - With at most 999 levels, even a linear scan is trivial.
   - Trees and skip lists add nothing on a bounded grid.
2. **FIFO queue within each level.**
   - In Postgres, use a B-tree index on `(market_id, outcome, side, price_tick, seq)`, where `seq` is a per-market sequence (bigint). This gives price-time priority as an index-ordered scan.
   - Keep a denormalised `levels` table (tick → aggregate size) for O(1) depth snapshots and bitmap-style best-price queries.
3. **Single writer per market.**
   - Serialise matching for each market with `SELECT … FOR UPDATE` on the market row, or `pg_advisory_xact_lock(market_id)`, inside one PL/pgSQL function. This mirrors the strictly serialised per-symbol core in R102.
   - Different markets run in parallel.
4. **Unified binary book.**
   - Store every order as YES-equivalent: a NO bid at p is a YES ask at 1−p. Two buys that sum to at least 1 mint a new complete set; two sells merge one.
   - Report mint/burn separately from secondary turnover [R80].
5. **Batch mode.**
   - For long-tail markets, collect orders and run a uniform-price uncross every N seconds.
   - Uncross rule: maximum volume, then minimum imbalance, then closest to the reference price, following the SSE/SZSE practice described in R93 and R94.
   - The house market maker's curve participates as a set of synthetic limit orders at each tick, derived from the LMSR cost function in the spirit of R3 and R21.
6. **Correctness first.** R102 found only 47 of 247 engines correct as shipped. Build a replay oracle: property-based tests comparing the Postgres engine against a reference in-memory FIFO matcher on random order streams.

---

## F. Consolidated design sketch for Kichiko (INFERENCE, with evidence pointers)

| Layer | Choice | Evidence |
|---|---|---|
| Book | Unified YES-equivalent CLOB; integer ticks (1¢, optionally 0.1¢ near the extremes); price-level array; FIFO | R52–R56, R79, R102 |
| Matching mode | Continuous for liquid markets; periodic open call auction (indicative price, no-cancel window, random end) for thin markets and for market open and close | R44, R46–R48, R93–R96; caveat R49 |
| Liquidity backstop | LMSR, or LS-LMSR for markets that should deepen with volume, posting ε-fair synthetic orders into the book; per-market subsidy cap b·ln n | R1–R3, R6, R21, R24, R25; caveat R22 |
| Subsidy schedule | Reduce b as resolution approaches, to target a flat expected loss rate (uniform-LVR idea); later, adaptive b | R13, R14, R17 |
| Multi-outcome | One LMSR over all n outcomes (prices sum to 1); native mint/merge and bidirectional NO⇔YES-others conversion; no arbitrary combinations | R33, R35, R39–R41 |
| Fees | Taker fee θ·P(1−P); maker fee 0 (or rebate); ceiling rounding for micro-tickets | R57, R70; R19 (theory) |
| House or partner market maker | Logit-space A-S/GLFT-style quoter with settlement-risk term; spreads scale with belief volatility (widest near 0.5 and near the deadline); inventory caps | R60–R64, R89 |
| Surveillance | Self-trade prevention; counterparty-graph wash detection; manipulation alerts on thin markets; ledger-level aggressor side; no VPIN | R59, R76–R79 |
| User protection | Disclose historical realised returns by price bucket (FLB); consider interest on long-dated positions | R68–R72 |

---

## G. Gaps and cautions

- **No field evidence on hybrid designs in thin retail settings.** Every piece of evidence on hybrid market-maker + CLOB designs is simulation, lab or tournament data [R21–R25]. None comes from a mobile-money or African retail setting.
- **Much of the 2025–26 literature is preprints.** This includes the prediction-market microstructure papers (R40, R41, R62–R64, R71, R79–R81). Many are very recent (July–September 2026).
- **No academic FPMM paper was found.** The pm-AMM source [R13] is a research blog post; its formal counterpart is R14 (a preprint).
- **The data-structure benchmark gap noted in E.1 remains open.**
- **Chinese-language coverage is limited** to material with verifiable PDFs or DOIs. CNKI itself was not reachable. Mainland-Chinese peer-reviewed work on matching-engine engineering was not found.

---

## References

Identifiers were checked on 2026-09-26. **[TL]** = title-level only (existence checked; abstract not read, and no claims made). **[PP]** = preprint / not peer-reviewed.

**A. Automated market makers**
- R1. Hanson, R. (2003). Combinatorial Information Market Design. *Information Systems Frontiers* 5(1):107–119. DOI 10.1023/A:1022058209073
- R2. Hanson, R. (2007). Logarithmic Market Scoring Rules for Modular Combinatorial Information Aggregation. *Journal of Prediction Markets* 1(1):3–15. DOI 10.5750/jpm.v1i1.417 (RePEc buc:jpredm:v:1:y:2007:i:1:p:3-15)
- R3. Hanson, R. (2003). Book Orders for Market Scoring Rules. Working note, George Mason University. https://hanson.gmu.edu/msrbook.pdf (listed as [O-10] on Hanson's vita)
- R4. Berg, H., & Proebsting, T. A. (2009). Hanson's Automated Market Maker. *Journal of Prediction Markets* 3(1):45–59. RePEc buc:jpredm:v:3:y:2009:i:1:p:45-59
- R5. Chen, Y., & Pennock, D. M. A Utility Framework for Bounded-Loss Market Makers. arXiv:1206.5252 (UAI 2007 paper, posted 2012)
- R6. Othman, A., Pennock, D. M., Reeves, D. M., & Sandholm, T. (2013). A Practical Liquidity-Sensitive Automated Market Maker. *ACM TEAC* 1(3). DOI 10.1145/2509413.2509414 (EC'10 version DOI 10.1145/1807342.1807402)
- R7. [TL] Othman, A., & Sandholm, T. (2012). Profit-charging market makers with bounded loss, vanishing bid/ask spreads, and unlimited market depth. *ACM EC'12*, 790–807. DOI 10.1145/2229012.2229074
- R8. Abernethy, J., Chen, Y., & Wortman Vaughan, J. (2013). Efficient Market Making via Convex Optimization, and a Connection to Online Learning. *ACM TEAC* 1(2):1–39. DOI 10.1145/2465769.2465777
- R9. [TL] Li, X., & Wortman Vaughan, J. (2013). An axiomatic characterization of adaptive-liquidity market makers. *ACM EC'13*, 657–674. DOI 10.1145/2482540.2482575
- R10. [TL] Abernethy, J. D., Frongillo, R. M., Li, X., & Wortman Vaughan, J. (2014). A general volume-parameterized market making framework. *ACM EC'14*. DOI 10.1145/2600057.2602900
- R11. Brahma, A., Chakraborty, M., Das, S., Lavoie, A., & Magdon-Ismail, M. (2012). A Bayesian Market Maker. *ACM EC'12*. DOI 10.1145/2229012.2229031
- R12. [PP] Della Penna, N., & Reid, M. D. (2011). Bandit Market Makers. arXiv:1112.0076
- R13. Moallemi, C., & Robinson, D. (2024, Nov 5). pm-AMM: A Uniform AMM for Prediction Markets. Paradigm Research. https://www.paradigm.xyz/2024/11/pm-amm
- R14. [PP] Moallemi, C. C., Robinson, D., & Zhu, B. (2026). Uniform-Loss Automated Market Making for Prediction Markets. arXiv:2607.17428
- R15. [PP] Milionis, J., Moallemi, C. C., Roughgarden, T., & Zhang, A. L. (2022). Automated Market Making and Loss-Versus-Rebalancing. arXiv:2208.06046
- R16. Bhaskara, A., Frongillo, R., Lindgren, E., & Papireddygari, M. (2023). A General Theory of Liquidity Provisioning for Prediction Markets. arXiv:2311.08725 (listed among EC 2026 accepted papers)
- R17. [PP] Nueve, E., Nguyen, B., Frongillo, R., & Waggoner, B. (2026). Adaptive Liquidity in Prediction Markets via Online Learning. arXiv:2605.09599
- R18. Papireddygari, M., Wang, X., Waggoner, B., & Pennock, D. M. (2025). Efficiency of Constant Log Utility Market Makers. arXiv:2510.12952 (listed among EC 2026 accepted papers)
- R19. [PP] Chen, Y., He, B., Xie, Z., Liu, Z., Zhang, F., Peng, X., Wang, Y., Qian, L., & Liu, X. (2026). Prediction-Market Seed Capital Recovery from Noise-Dominant Flow. arXiv:2609.14038
- R20. Amini, H., Bichuch, M., & Feinstein, Z. (2025). Decentralized Prediction Markets and Sports Books. *Mathematical Finance* 36(3):465–480. DOI 10.1111/mafi.70017
- R21. Heidari, H., Lahaie, S., Pennock, D. M., & Wortman Vaughan, J. (2018). Integrating Market Makers, Limit Orders, and Continuous Trade in Prediction Markets. *ACM TEAC* 6(3–4):1–26. DOI 10.1145/3274643 (EC'15 DOI 10.1145/2764468.2764532)
- R22. Chakraborty, M., Das, S., & Peabody, J. (2015). Price Evolution in a Continuous Double Auction Prediction Market With a Scoring-Rule Based Market Maker. *AAAI* 29(1). DOI 10.1609/aaai.v29i1.9313
- R23. Wah, E., Lahaie, S., & Pennock, D. M. (2016). An Empirical Game-Theoretic Analysis of Price Discovery in Prediction Markets. *IJCAI-16*, p. 510ff. https://www.ijcai.org/Proceedings/16/Papers/079.pdf (ACM DL 10.5555/3060621.3060693)
- R24. Atanasov, P., Witkowski, J., Mellers, B., & Tetlock, P. (2025). Crowd prediction systems: Markets, polls, and elite forecasters. *International Journal of Forecasting* 41(2):580–595. DOI 10.1016/j.ijforecast.2023.12.009 (EC'22 version DOI 10.1145/3490486.3538265)
- R25. Klingert, F. M. A., & Meyer, M. (2018). Comparing Prediction Market Mechanisms: An Experiment-Based and Micro Validated Multi-Agent Simulation. *JASSS* 21(1):7. DOI 10.18564/jasss.3577
- R26. Jian, L., & Sami, R. (2012). Aggregation and Manipulation in Prediction Markets: Effects of Trading Mechanism and Information Distribution. *Management Science* 58(1):123–140. DOI 10.1287/mnsc.1110.1404
- R27. Aoyagi, J., & Ito, Y. (2025). Coexisting Exchange Platforms: Limit Order Books and Automated Market Makers. *Journal of Political Economy Microeconomics* 3(3):611–648. DOI 10.1086/732831 (SSRN 3808755)
- R28. Lehar, A., & Parlour, C. (2025). Decentralized Exchange: The Uniswap Automated Market Maker. *Journal of Finance* 80(1):321–374. DOI 10.1111/jofi.13405
- R29. Tran, T., Tran, D. A., & Nguyen, T. (2024). Order Book Inspired Automated Market Making. *IEEE Access* 12. DOI 10.1109/ACCESS.2024.3372402
- R30. [PP] Baggiani, L., Herdegen, M., & Sánchez-Betancourt, L. (2025). Optimal Dynamic Fees in Automated Market Makers. arXiv:2506.02869
- R31. Chen, Y., & Pennock, D. M. (2010). Designing Markets for Prediction. *AI Magazine* 31(4):42–52. DOI 10.1609/aimag.v31i4.2313
- R32. [PP] Rahman, N., Al-Chami, J., & Clark, J. (2025). SoK: Market Microstructure for Decentralized Prediction Markets (DePMs). arXiv:2510.15612

**B. Combinatorial and multi-outcome**
- R33. Chen, Y., Fortnow, L., Lambert, N., Pennock, D. M., & Wortman, J. (2008). Complexity of Combinatorial Market Makers. *ACM EC'08*. DOI 10.1145/1386790.1386822; arXiv:0802.1362
- R34. [TL] Dudík, M., Lahaie, S., & Pennock, D. M. (2012). A tractable combinatorial market maker using constraint generation. *ACM EC'12*, 459–476. DOI 10.1145/2229012.2229047
- R35. Kroer, C., Dudík, M., Lahaie, S., & Balakrishnan, S. (2016). Arbitrage-Free Combinatorial Market Making via Integer Programming. *ACM EC'16*. DOI 10.1145/2940716.2940767; arXiv:1606.02825
- R36. [TL] Laskey, K. B., Sun, W., Hanson, R., Twardy, C., Matsumoto, S., & Goldfedder, B. (2018). Graphical Model Market Maker for Combinatorial Prediction Markets. *JAIR*. DOI 10.1613/jair.1.11249
- R37. [PP] Hossain, P. S., Wang, X., & Yu, F.-Y. (2024). Designing Automated Market Makers for Combinatorial Securities: A Geometric Viewpoint. arXiv:2411.08972
- R38. [PP] Rana, R., Nadkarni, V., Moshrefi, N., & Viswanath, P. (2026). ParlayMarket: Automated Market Making for Parlay-style Joint Contracts. arXiv:2603.22596
- R39. Saguillo, O., Ghafouri, V., Kiffer, L., & Suarez-Tangil, G. (2025). Unravelling the Probabilistic Forest: Arbitrage in Prediction Markets. *AFT 2025*, LIPIcs. DOI 10.4230/LIPIcs.AFT.2025.27; arXiv:2508.03474
- R40. [PP] Cheng, G., Yang, J., & Zou, H. (2026). Arbitrage Analysis in Polymarket NBA Markets. arXiv:2605.00864
- R41. [PP] Gebele, J., Mutzel, T., & Matthes, F. (2026). Executable Arbitrage and Market Efficiency in Prediction Markets. arXiv:2608.00666
- R42. [PP] Gebele, J., & Matthes, F. (2026). Semantic Non-Fungibility and Violations of the Law of One Price in Prediction Markets. arXiv:2601.01706
- R43. [PP] Clinton, J. D., & Huang, T. (2025). Prediction Markets? The Accuracy and Efficiency of $2.4 Billion in the 2024 Presidential Election. SocArXiv. DOI 10.31235/osf.io/d5yx2 (RePEc osf:socarx:d5yx2_v1)

**C. Matching and microstructure**
- R44. Budish, E., Cramton, P., & Shim, J. (2015). The High-Frequency Trading Arms Race: Frequent Batch Auctions as a Market Design Response. *QJE* 130(4):1547–1621. DOI 10.1093/qje/qjv027
- R45. Aquilina, M., Budish, E., & O'Neill, P. (2022). Quantifying the High-Frequency Trading "Arms Race". *QJE* 137(1):493–564. DOI 10.1093/qje/qjab032
- R46. Baldauf, M., & Mollner, J. (2020). High-Frequency Trading and Market Performance. *Journal of Finance* 75(3):1495–1526. DOI 10.1111/jofi.12882
- R47. Aldrich, E. M., & López Vargas, K. (2020). Experiments in high-frequency trading: comparing two market institutions. *Experimental Economics* 23(2):322–352. DOI 10.1007/s10683-019-09605-2
- R48. Madhavan, A. (1992). Trading Mechanisms in Securities Markets. *Journal of Finance* 47(2):607–641. DOI 10.1111/j.1540-6261.1992.tb04403.x
- R49. [PP] Derchu, J., Kavvathas, D., Mastrolia, T., & Rosenbaum, M. (2023). Equilibria and incentives for illiquid auction markets. arXiv:2307.15805
- R50. Khapko, M., & Zoican, M. (2021). Do speed bumps curb low-latency investment? Evidence from a laboratory market. *Journal of Financial Markets*. DOI 10.1016/j.finmar.2020.100601; arXiv:1910.03068
- R51. Le Moign, C. (2025). Securing passive liquidity: The impact of Europe's first asymmetric speed bump on market liquidity. *J. Int. Financial Markets, Institutions & Money* 101. DOI 10.1016/j.intfin.2025.102145
- R52. Lepone, A., & Yang, J. Y. (2012). The impact of a pro-rata algorithm on liquidity: Evidence from the NYSE LIFFE. *Journal of Futures Markets* 32(7):660–682. DOI 10.1002/fut.20536
- R53. Haynes, R., & Onur, E. (2020). Precedence rules in matching algorithms. *Journal of Commodity Markets* 19:100109. DOI 10.1016/j.jcomm.2019.100109
- R54. Field, J., & Large, J. (2008). Pro-rata matching and one-tick futures markets. CFS Working Paper 2008/40. RePEc zbw:cfswop:200840
- R55. Garriott, C., van Kervel, V., & Zoican, M. (2025). Queuing and inventories in limit order markets. *Journal of Financial Markets* 75:100982. DOI 10.1016/j.finmar.2025.100982
- R56. Chung, K. H., Lee, A. J., & Rösch, D. (2020). Tick size, liquidity for small and large orders, and price informativeness: Evidence from the Tick Size Pilot Program. *JFE* 136(3):879–899. DOI 10.1016/j.jfineco.2019.11.004
- R57. Malinova, K., & Park, A. (2015). Subsidizing Liquidity: The Impact of Make/Take Fees on Market Quality. *Journal of Finance* 70(2):509–536. DOI 10.1111/jofi.12230
- R58. Easley, D., López de Prado, M. M., & O'Hara, M. (2012). Flow Toxicity and Liquidity in a High-frequency World. *RFS* 25(5):1457–1493. DOI 10.1093/rfs/hhs053
- R59. Andersen, T. G., & Bondarenko, O. (2014). VPIN and the flash crash. *Journal of Financial Markets* 17:1–46. DOI 10.1016/j.finmar.2013.05.005
- R60. Avellaneda, M., & Stoikov, S. (2008). High-frequency trading in a limit order book. *Quantitative Finance* 8(3):217–224. DOI 10.1080/14697680701381228
- R61. Guéant, O., Lehalle, C.-A., & Fernandez-Tapia, J. (2013). Dealing with the inventory risk: a solution to the market making problem. *Mathematics and Financial Economics*. DOI 10.1007/s11579-012-0087-0; arXiv:1105.3115
- R62. [PP] Feil, D., & Nendel, M. (2026). Optimal Market Making in Prediction Markets. arXiv:2607.17991
- R63. [PP] Dalen, S. (2025). Toward Black Scholes for Prediction Markets: A Unified Kernel and Market Maker's Handbook. arXiv:2510.15205
- R64. [PP] Xi, W., Moallemi, C. C., Pai, M., & Wang, S. (2026). Volatility in Prediction Markets: A Structural Approach. arXiv:2607.08199
- R66. [TL] Wolfers, J., & Zitzewitz, E. (2004). Prediction Markets. *Journal of Economic Perspectives* 18(2):107–126. DOI 10.1257/0895330041371321
- R68. Snowberg, E., & Wolfers, J. (2010). Explaining the Favorite–Long Shot Bias: Is it Risk-Love or Misperceptions? *JPE* 118(4):723–746. DOI 10.1086/655844 (NBER w15923)
- R69. Page, L., & Clemen, R. T. (2013). Do Prediction Markets Produce Well-Calibrated Probability Forecasts? *Economic Journal* 123(568):491–513. DOI 10.1111/j.1468-0297.2012.02561.x
- R70. [PP] Bürgi, C., Deng, W., & Whelan, K. (2025/2026). Makers and Takers: The Economics of the Kalshi Prediction Market. SSRN 5502658; UCD WP2025_19; https://www.karlwhelan.com/Papers/Kalshi.pdf
- R71. [PP] Le, N. A. (2026). Decomposing Crowd Wisdom: Domain-Specific Calibration Dynamics in Prediction Markets. arXiv:2602.19520
- R72. [PP] Maresca, C. (2026). Can Interest-Bearing Positions Solve the Long-Horizon Problem in Prediction Markets? arXiv:2602.21091
- R73. Diercks, A. M., Katz, J. D., & Wright, J. H. (2026). Kalshi and the Rise of Macro Markets. FEDS 2026-010, Federal Reserve Board. DOI 10.17016/FEDS.2026.010
- R74. Berg, J. E., Nelson, F. D., & Rietz, T. A. (2008). Prediction market accuracy in the long run. *International Journal of Forecasting* 24(2):285–300. DOI 10.1016/j.ijforecast.2008.03.007
- R75. Rothschild, D., & Sethi, R. (2016). Trading Strategies and Market Microstructure: Evidence from a Prediction Market. *Journal of Prediction Markets* 10(1):1–29. DOI 10.5750/jpm.v10i1.1179
- R76. [PP] Rasooly, I., & Rozzi, R. (2025). How manipulable are prediction markets? arXiv:2503.03312
- R77. [PP] Sirolly, A., Ma, H., Kanoria, Y., & Sethi, R. (2025). Network-Based Detection of Wash Trading. SSRN 5714122
- R78. Cong, L. W., Li, X., Tang, K., & Yang, Y. (2023). Crypto Wash Trading. *Management Science*. DOI 10.1287/mnsc.2021.02709
- R79. [PP] Dubach, P. D. (2026). The Anatomy of a Decentralized Prediction Market: Microstructure Evidence from the Polymarket Order Book. arXiv:2604.24366
- R80. [PP] Tsang, K. P., & Yang, Z. (2026). The Anatomy of a Blockchain Prediction Market: Polymarket in the 2024 U.S. Presidential Election. arXiv:2603.03136
- R81. [PP] Tsang, K. P., & Yang, Z. (2026). Political Shocks and Price Discovery in Prediction Markets: Evidence from the 2024 U.S. Presidential Election. arXiv:2603.03152
- R82. [PP] Cutting, L. E., Hughes-Berheim, S. S., Johnson, P. M., Baroud, H., & Goldstein, B. (2025). Are Betting Markets Better than Polling in Predicting Political Elections? arXiv:2507.08921

**D. Chinese-institution scholarship**
- R83. [PP] Guo, H., Lin, J., & Huang, F. (2023). Market Making with Deep Reinforcement Learning from Limit Order Books. arXiv:2305.15821 (Tsinghua SIGS; Microsoft Beijing)
- R84. Niu, H., Li, S., Zheng, J., Lin, Z., An, B., Li, J., & Guo, J. (2024). IMM: An Imitative Reinforcement Learning Approach with Predictive Representation Learning for Automatic Market Making. *IJCAI-24*, 5999–6007. DOI 10.24963/ijcai.2024/663; arXiv:2308.08918 (Tsinghua; IDEA; HIT; NTU)
- R85. Li, J., Liu, Y., Liu, W., Fang, S., Wang, L., Xu, C., & Bian, J. (2025). MarS: a Financial Market Simulation Engine Powered by Generative Foundation Model. *ICLR 2025*. arXiv:2409.07486 (Microsoft Research Asia)
- R86. [PP] Yang, J., Fang, R., Zhang, M., & Zhou, J. (2025). An Efficient deep learning model to Predict Stock Price Movement Based on Limit Order Book. arXiv:2505.22678 (Institute of Acoustics, CAS; UCAS)
- R87. Wu, Y., Wang, S., & Fu, X. (2024). Long short-term temporal fusion transformer for short-term forecasting of limit order book in China markets. *Applied Intelligence*. DOI 10.1007/s10489-024-05789-0 (Shenzhen University; Shenzhen Technology University)
- R88. [TL] Huang, C., Ge, W., Chou, H., & Du, X. (2021). Benchmark Dataset for Short-Term Market Prediction of Limit Order Book in China Markets. *Journal of Financial Data Science*. DOI 10.3905/jfds.2021.1.074
- R89. [PP] He, X. D., Yang, C., & Zhou, Y. (2024, rev. 2026). Optimal Design of Automated Market Makers on Decentralized Exchanges. arXiv:2404.13291; SSRN DOI 10.2139/ssrn.4801468 (CUHK SEEM)
- R90. [PP] He, X. D., Yang, C., & Zhou, Y. (2025, rev. 2026). Arbitrage on Decentralized Exchanges. arXiv:2507.08302 (CUHK SEEM)
- R91. Wang, Y., Chen, Y., Wu, H., Zhou, L., Deng, S., & Wattenhofer, R. (2022). Cyclic Arbitrage in Decentralized Exchanges. *WWW '22 Companion*. DOI 10.1145/3487553.3524201; arXiv:2105.02784 (ETH Zurich; Zhejiang University; Xi'an Jiaotong University; Imperial)
- R92. [PP] Kong, Y., & Schoenebeck, G. (2022). False Consensus, Information Theory, and Prediction Markets. arXiv:2206.02993 (Peking University; University of Michigan)
- R93. 李平, 许香存, 曾勇 [Li Ping, Xu Xiangcun, Zeng Yong]. 不可撤单模式开放式集合竞价研究：理论与实证 [Open call auctions with a no-cancellation phase: theory and evidence]. UESTC School of Management; CFRN working paper. https://www.cfrn.com.cn/uploads/fileupload/1750/paper/20080620091522.PDF
- R94. 施东晖 [Shi Donghui] (2006, Sept). 收盘集合竞价设计与股价操纵 [Closing call auction design and stock-price manipulation]. Shanghai Stock Exchange Research Center. PDF hosted at https://www.econ.sdu.edu.cn/__local/E/0A/4A/2D1404E5361259CA663B5EAE9C0_0DE2EBDA_14E7A.pdf
- R95. Han, Q., Zhao, C., Chen, J., & Guo, Q. (2022). Reexamining the impact of closing call auction on market quality: A natural experiment from the Shanghai stock exchange. *Pacific-Basin Finance Journal* 74:101821. DOI 10.1016/j.pacfin.2022.101821
- R96. Li, M., Qi, T., Huang, Y., Feng, P., & Zhao, Y. (2024; 2025 issue). Can call auction reduce closing price manipulation in the stock market? *Asia-Pacific Journal of Accounting & Economics* 32(1):145–162. DOI 10.1080/16081625.2024.2336116
- R97. [TL] Li, J., Luo, S., & Zhou, G. (2021). Call auction, continuous trading and closing price formation. *Quantitative Finance*. DOI 10.1080/14697688.2020.1849782
- R98. Zheng, Y. (2023). FPGA-based acceleration for high frequency trading. MPhil thesis, HKUST (supervisor Wei Zhang). https://researchportal.hkust.edu.hk/en/studentTheses/fpga-based-acceleration-for-high-frequency-trading/
- R99. 李国秋, 吕斌 [Li Guoqiu, Lü Bin] (2014). 预测市场：理论基础、运行机制及其应用 [Prediction markets: theoretical foundations, operating mechanisms and applications]. 图书情报工作 [Library and Information Service] 58(1). DOI 10.13266/j.issn.0252-3116.2014.01.009
- R100. [PP] 熊浩文 [Xiong Haowen] (2026, Apr 24). 金融学术前沿丨预测市场：原理、现状与展望 [Prediction markets: principles, status and outlook]. Fudan Development Institute seminar report. https://fddi.fudan.edu.cn/dc/dc/c21253a777436/page.htm (contains a mechanism error; see D.5)
- R101. [PP] Jiang, J., Dierckx, T., Xiao, D., & Schoutens, W. (2022). Market Making via Reinforcement Learning in China Commodity Market. arXiv:2205.08936 (KU Leuven MSc thesis; not a Chinese institution)

**E. Engineering**
- R102. [PP] Yoon, J. (2026). The World's Fastest Matching Engine Algorithm. arXiv:2606.01183 (Flash One Technologies LLC)
- R103. Jericevich, I., Sing, D., & Gebbie, T. (2022). CoinTossX: An open-source low-latency high-throughput matching engine. *SoftwareX*. DOI 10.1016/j.softx.2022.101136
- R104. [TL] Kashera, V., Jain, S., Banerjee, A., & Purini, S. (2023). Building Low-Latency Order Books with Hybrid Binary-Linear Search Data Structures on FPGAs. *FPL 2023*. DOI 10.1109/FPL60245.2023.00051
- R105. [PP] Moosavi, M., & Clark, J. (2021). Lissy: Experimenting with on-chain order books. arXiv:2101.06291
- R106. [PP] Briola, A., Bartolucci, S., & Aste, T. (2024). Deep Limit Order Book Forecasting. arXiv:2403.09267
- R107. [PP] Wang, H. (2025). Exploring Microstructural Dynamics in Cryptocurrency Limit Order Books: Better Inputs Matter More Than Stacking Another Hidden Layer. arXiv:2506.05764

(R65 and R67 were removed during verification because only titles could be confirmed and they were not needed.)
