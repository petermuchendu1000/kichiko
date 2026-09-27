# 31 — Decision psychology of money and risk: re-verified evidence and binding rules

**Scope.** The order ticket, market pages, charts, notifications and responsible-gambling (RG)
tools of Kichiko, a real-money binary prediction market for Kenya first, then Uganda, Tanzania
and Rwanda. Money is shown in KSh and probability in % (decided 2026-09-27; not re-argued here).

**Compiled:** 2026-09-27. **Supersedes** the evidence claims of [`24-PSYCHOLOGY.md`](../24-PSYCHOLOGY.md)
and the citations in §3 "Binding design law" of [`20-WORK-PLAN.md`](../20-WORK-PLAN.md) wherever they differ.

## 0. Method, grades and what "verified" means here

- **Primary sources only.** Every claim below was checked on 2026-09-27 against one of: the full
  text (publisher, author PDF, arXiv/PsyArXiv, regulator PDF); or the official abstract (Europe PMC
  mirror of PubMed, Crossref publisher deposit, NBER, RePEc/IDEAS, Nature). The access level is
  stated per source in §7 as **[FT]** full text or **[ABS]** abstract only. Where only the abstract
  could be read, numbers that appear only in the body are marked **UNVERIFIED**.
- **Blocked sources.** ScienceDirect (captcha), SSRN, OUP, ULII, econstor, ifo.de, UCD, ZORA and
  Radboud repositories (Cloudflare/Anubis/403) were attempted with curl and with Playwright
  Chromium. Nothing was taken from search snippets.
- **Evidence grades** (as specified by the product owner):
  - **STRONG**: replicated RCT or field experiment, or a meta-analysis.
  - **MODERATE**: a single well-powered experiment.
  - **WEAK**: small, observational, or single-lab.
  - **CONTESTED**: failed replications or conflicting results.
  - **BINDING** is not an evidence grade. It marks a legal obligation, quoted by section number
    from the gazetted text.
- **Transfer.** Almost none of this literature studies prediction markets. Each finding says which
  domain it comes from (slots, equities, health risk and so on) and argues whether it transfers.
- **The regulatory ground moved.** Doc 24 quoted the Kenyan Conduct Regulations from an **unsigned
  March 2026 draft**: "Made on the …… 2026" is left blank, and it contains tracked-change residue,
  "for at least five three years". The **gazetted** text is **L.N. 112 of 2026** (Kenya Gazette
  Supplement No. 163, 30 June 2026, made 29 June 2026). It **renumbers** the regulations, drops or
  changes several provisions, and **adds rules specific to prediction markets** (Reg. 45(5)–(8)).
  All regulation numbers below are the gazetted ones.

---

## 1. Re-verification of prior rules 1–13 and the "Forbidden" list

Verdicts: **CONFIRMED** · **OVERSTATED** (with the corrected statement) · **WRONG** · **UNVERIFIABLE**.

| # | Prior claim (20-WORK-PLAN §3) | Verdict | What the primary source actually says; corrected statement | Source checked |
|---|---|---|---|---|
| 1 | Never express economics as a payout %; BIT 2022 loss framing raised comprehension 27%→52% and cut willingness to play ~9pp; Weiss-Cohen 2025 RTP raised perceived chance vs no information. **STRONG** | **OVERSTATED** | **Accurate:** in the BIT study (n=5,311 UK online panel, slots), the ratio item was 27%→52% for the "simplified loss-volatility" arm. The other claims need correcting. **(a)** Answering all three items correctly rose only **11%→14%**. The item "not guaranteed any wins" **fell** 47%→43% (p<.05). BIT itself says the loss framing **increased the misreading that there is a maximum loss** ("lose £7 per £100" read as "lose no more than £7"). **(b)** Decision to play fell **75%→68% (−7pp)** in the loss-volatility arm and to 64% in the graphic arm. The "~9pp" is BIT's average of the two. **(c)** There was **no substantive difference in amount lost, stakes or spins** among those who played. **(d)** Among **PGSI 4+ (problem gambling, n=542) play was 91–95% in every arm: no effect.** **(e)** Weiss-Cohen et al. 2025 (N=6,062, UK+US, 2 studies): a 90% RTP message raised perceived chance vs no information (ORs>5). **House-edge messages beat RTP but were no better than no information.** **Corrected:** do not headline economics as a return/payout %, because RTP-style framing misleads (**STRONG**, replicated). Money-loss framing improves understanding of one ratio (**MODERATE**). Its behavioural effect is small and limited to entry (**WEAK**), and it is **null for problem gamblers**. **Legal note:** Kenya L.N. 112 Reg. 20(2)–(3) requires casinos, and online operators "with the necessary modification", to display "house edge and average return to the player". Reg. 45(4) requires the theoretical RTP to be disclosed **to the Authority** (the draft said "publicly"). If the GRA applies Reg. 20 to Kichiko, the RTP goes in the rules layer, not the headline. | BIT 2022 [FT]; Weiss-Cohen 2025 [ABS]; L.N. 112 [FT] |
| 2 | Show `You pay` / `Most you can lose` / `If right you get`, in KSh, before confirm; Newall 2022; GRA Reg 45; WCAG 3.3.4. **STRONG + normative** | **OVERSTATED** | **Normative basis CONFIRMED.** L.N. 112 Reg. 45(1) (rules displayed "before a player … places any wager"); Reg. 23(1) ("clearly display betting odds, rules and terms applicable to each bet"); Act s.72(6) (all rules and "the particulars of any processing fee"). WCAG 2.2 SC 3.3.4 requires "at least one of" reversible, checked or confirmed. **Behavioural claim unsupported.** Newall et al. 2022 (US, N=2,433, incentivised slots) tested house-edge and volatility statements against RTP (spins OR 1.40 and 1.57, "rather small"). It did not test a pay/max-loss/payout triad. No study was found that tests this triad. **Corrected:** BINDING display duty; behavioural effect **UNTESTED** (see E2). | L.N. 112 [FT]; Act [FT]; W3C WCAG source [FT]; Newall 2022 preprint [FT] |
| 3 | All-in fees up front, never dripped; OFT 2010, Rasch 2020, Santana 2020. **STRONG** | **CONFIRMED** (sources upgraded) | Blake, Moshary, Sweeney & Tadelis 2021 ran a **large-scale StubHub field experiment**: disclosing fees up front reduced both quantity and quality purchased, and obfuscation made consumers spend more. Santana et al. 2020 (6 studies) found dripped surcharges lead people to pick higher-total options and stick with them. Rasch et al. 2020 (lab) found sellers maximise drips and consumer surplus falls. The **FTC 2022 staff report** lists drip pricing as a dark pattern. **BINDING in Kenya:** Act s.72(6)(b). OFT 2010 was not re-fetched and is not needed. **Commercial cost stated honestly:** in Blake et al., up-front pricing **reduced purchases**. | Blake 2021 [ABS/NBER]; Santana 2020 [ABS]; Rasch 2020 [ABS]; FTC 2022 [FT]; Act [FT] |
| 4 | Probability as % with a co-located frequency gloss `57% · about 57 in 100`; Gigerenzer 2007, Galesic 2009, Garcia-Retamero & Cokely 2017. **STRONG** (transfer is inference) | **OVERSTATED → CONTESTED** | Natural frequencies help **Bayesian inference** tasks: meta-analysis of 35 articles and 226 estimates (McDowell & Jacobs 2017); Galesic 2009 (n=162), positive predictive value correct 15–18% vs 55–58%. A market price is a **single-event** probability. For single-event forecasts, **Joslyn & Nichols 2009** found participants understood **"90%" better than "9 times in 10" or "90 out of 100"**, and adding a reference-class phrase did **not** help. **Slovic et al. 2000** found frequency formats ("2 out of 10") produce **higher perceived risk** than the equivalent %, through vivid imagery. For a longshot, that imagery could make the win feel more attainable. This is the ratio bias of Denes-Raj & Epstein 1994, which correlated with self-reported gambling. **Corrected:** the % is primary. A frequency gloss is a **hypothesis to test (E1), not a rule**. | McDowell 2017 [ABS]; Galesic 2009 [ABS]; Joslyn 2009 [ABS]; Slovic 2000 [ABS]; Denes-Raj 1994 [ABS] |
| 5 | Never a count without its denominator; Garcia-Retamero 2010. **STRONG** | **OVERSTATED** (transfer) | Garcia-Retamero, Galesic & Gigerenzer 2010 show denominator neglect when **comparing treatment risk reductions across different sample sizes**, and show that icon arrays remove it. Moving this to activity or volume counts on a market page is a reasonable inference, not a tested finding. **Corrected grade: MODERATE (inference)**. The rule stands as a clarity and integrity rule. | Garcia-Retamero 2010 [ABS] |
| 6 | Numbers lead; verbal probability words only bound to a number; Budescu 2009/2014; Wintle 2019. **STRONG** | **CONFIRMED** (and sharpened) | Budescu et al. 2014: 25 samples, 24 countries, 17 languages. Lay readings regress toward 50%; adding numeric ranges improves correspondence and makes readings more similar **across languages**. **Wintle et al. 2019 (n=924): only numbers bracketed inline improved correspondence (66% vs 32%). Click-to-see tables and tooltips did not.** This **contradicts** doc 24's R3 ("band … visible on tap"): the number must be inline. | Budescu 2009 [ABS]; Budescu 2014 [ABS]; Wintle 2019 [ABS] |
| 7 | YES/NO symmetric, no favoured side, no pre-selected stake; Tversky & Kahneman 1981. **STRONG** | **OVERSTATED** (mis-cited; conclusion holds) | Tversky & Kahneman 1981 is a **framing** result (Problem 1, N=152, 72% chose the sure option; Problem 2, N=155, 78% chose the risky option). It says nothing about defaults or seeded stakes. The correct support: Jachimowicz et al. 2019 meta-analysis of defaults (58 studies, n=73,675, **d=0.68** [0.53, 0.83]). Lanier et al. 2025 (N=317): the default was chosen 38–39% of the time vs a 25% chance baseline, and **default reliance was higher at a low (25%) win probability**. Amount defaults anchor: Haggag & Paci 2014 (13M+ NYC taxi rides); Goswami & Urminsky 2016 (11,508 participants, including a field experiment). EU DSA recital 67 lists non-neutral presentation of choices as a dark pattern (comparative, not binding here). **Rule CONFIRMED; grade STRONG for defaults shifting choice.** | T&K 1981 [FT]; Jachimowicz 2019 [ABS]; Lanier 2025 [ABS]; Haggag 2014 [ABS]; Goswami 2016 [ABS]; DSA [FT] |
| 8 | Ship a pre-set default limit, not a prompt; **Auer, Hopfgartner & Griffiths 2019 RCT (n=4,328)**: prompts raised limit-setting 11-fold with zero effect on losses (OR=1.0, p=.921). **STRONG null.** Increases delayed, decreases immediate. | **WRONG** (attribution) + **OVERSTATED** (inference) | The RCT is **Ivanova, Magnusson & Carlbring 2019**, *Front Psychol* 10:639: Paf customers from mainland Finland, slots, **N=4,328**, 90 days. The numbers are right: pooled net-loss OR=1.0, p=.921; B=−0.1, p=.291; null in the top decile. "11-fold" is the **odds ratio of 11.9** in the at-registration arm (9.2 pre-deposit, 4.1 post-deposit); limits were set by 45%/39%/22% vs 6.5% of controls. It is **one RCT → MODERATE**, not STRONG. The authors state that it **cannot tell whether *setting* a limit reduces gambling**, and call for a trial of **mandatory limits**. **A default limit is therefore untested.** Auer, Hopfgartner & Griffiths 2020 (Kindred, n=49,560) is **observational**: top-decile limit-setters gambled less a year later. Tørdal et al. 2026 (Norway, **mandatory** personal loss limits, n=104,413) found **no clear association** between limit and later expenditure. "Increases delayed, decreases immediate" matches the **UKGC RTS 12D** standard (increases after ≥24h plus positive confirmation; reductions immediate). **Tanzania GN 478T reg. 50(3)–(4) differs:** *any* amendment or revocation waits 7 days. | Ivanova 2019 [FT]; Auer 2020 [ABS]; Tørdal 2026 [ABS]; UKGC RTS 12 [FT]; TZ GN 478T [FT] |
| 9 | Y-axis always 0–100%; never auto-scale; Correll CHI 2020: axis-break markers don't fix it; Yang 2021. **STRONG** | **OVERSTATED** | **The effect is CONFIRMED.** Correll et al. ran three within-subject crowd experiments (n=40, 32, 25). Truncation raised perceived severity (F(2,76)=89). Broken-axis and gradient designs did not remove it, and asking for exact values did not either. Yang et al. 2021 (5 studies) found a truncation effect in 83.5% of participants, persisting after instruction. **The prescription is not in the source.** Correll et al.: "we resist the interpretation … that all charts … should include 0". **Witt 2019** (5 small experiments): a **full-range axis makes effects look small and lowers sensitivity**. **Corrected:** a fixed 0–100 axis is a *deliberate* choice to de-emphasise short-term moves, and costs sensitivity to small moves. Grade: effect STRONG; prescription is a value judgement. Polymarket's graph tab was auto-scaled (~10%→35%, July capture, doc 21). | Correll 2020 [FT]; Yang 2021 [ABS]; Witt 2019 [FT] |
| 10 | Default chart range = full market life; no intraday view; Borsboom 2022 (n=1,041): +38pp trading, ~50% higher fees, ~18% lower profits. **MODERATE-STRONG** | **OVERSTATED / partly UNVERIFIABLE** | **Abstract verified:** a controlled experiment with **1,041 retail investors**. Shorter time frames led to more trading, higher fees and welfare losses, with **no effect on average risk-taking**. **The +38pp, +50% and −18% magnitudes could not be verified** (ScienceDirect captcha; ZORA, Radboud and SSRN blocked). It is a single lab experiment on equities, so **MODERATE**. "No intraday view" is an extrapolation. Polymarket's graph tab already defaults to `ALL` (doc 21), so this is **not a differentiator**. | Borsboom 2022 [ABS/RePEc] |
| 11 | 100-mark dot array as primary graphic; no hard-edged bands; Padilla 2022, Kay 2016, Fernandes 2018. **STRONG/MODERATE** | **OVERSTATED** | Icon arrays improve risk understanding: Galesic et al. 2009 (n=59+112); systematic review by Garcia-Retamero & Cokely 2017 (36 publications, 27,885 participants, 60 countries). **But** Galesic 2009 also found risks shown as icon arrays were **perceived as less serious** than the same numbers, which is a hazard when the icons show a chance of losing money. Kay 2016 (n=320) and Fernandes 2018 (n=408, incentivised) study **continuous** predictions (bus arrival). "No hard-edged bands" does not apply to a binary price. Padilla 2022 was not re-fetched. **Corrected:** the number is primary; an icon array is optional and secondary, **pending E1**. | Galesic 2009 [ABS]; Garcia-Retamero & Cokely 2017 [ABS]; Kay 2016 [FT]; Fernandes 2018 [FT] |
| 12 | No on-screen number without a traceable DB source; Mathur 2019: 157 fake countdowns, 29 fabricated activity feeds, 17 deceptive stock counters. **STRONG** | **CONFIRMED** | Exact figures: **157** deceptive countdown timers on 140 sites; **29** deceptive activity notifications on 20 sites; **17** deceptive low-stock messages on 17 sites; 1,818 dark-pattern instances on 1,254 of ~11K shopping sites. Mathur is a **prevalence crawl**, not an effect study. Effect evidence: **Luguri & Strahilevitz 2021**. Mild dark patterns doubled sign-up and aggressive ones roughly quadrupled it. Hidden information, trick questions and **obstruction** were most effective; **"must act now" messages had no effect**. **BINDING in Kenya** for advertising: L.N. 114 r.9(g) (no "false, misleading or deceptive message"). | Mathur 2019 [FT]; Luguri 2021 [ABS]; L.N. 114 [FT] |
| 13 | Flow symmetry as a merge gate: withdrawal and self-exclusion ≤ deposit/purchase in taps, time, fields; GRA Reg 87. **STRONG** | **CONFIRMED** (citation updated) | The gazetted provisions are **Reg. 84(1)** ("accessible and real-time tools"), **84(2)(d)** ("an easy to access option for self-exclusion for a period of at least twenty-four hours") and **Reg. 67(3)** ("a real-time self-exclusion mechanism" online). Evidence: Motka et al. 2018 (systematic review, 16 studies) found **"complicated enrollment processes"** are the main barrier to self-exclusion; Luguri 2021 found obstruction among the most effective dark patterns. EU DSA Art. 25(3)(c) (terminating harder than subscribing) is comparative. The flow-symmetry test is a sound operationalisation. **BINDING + MODERATE.** | L.N. 112 [FT]; Motka 2018 [ABS]; Luguri 2021 [ABS]; DSA [FT] |

### Forbidden list

| Item | Verdict | Finding |
|---|---|---|
| Variable or intermittent reward; surprise bonuses | **UNVERIFIABLE** as cited | Neither pass cites a primary source; doc 24 says "foundational operant-conditioning literature". Keep it as **precautionary Kichiko policy**. It is not a Kenyan legal requirement: Act s.74(3) permits bonus bets. |
| Near-miss framing ("it was at 48% an hour ago") | **OVERSTATED** (transfer) | Clark et al. 2009, a slot-machine fMRI task: near-misses were less pleasant but **increased desire to play, only when the player had personal control**. No study covers prediction markets. Keep it as a precaution and label it that way. |
| Any celebration where net proceeds ≤ stake (UKGC 2021) | **CONFIRMED** | UKGC announced the ban on 2 Feb 2021, in force by 31 Oct 2021, now **RTS 14F** ("must not celebrate a return which is less than or equal to the total stake"). Myles, Bennett & Newall 2026: **17 of 26** popular UK slots still used win-associated sounds after losses disguised as wins (validated with 400 gamblers). The rule must be **operationally defined** (see FR-5). Behavioural evidence: Graydon et al. 2018, lab, n=132 (WEAK). |
| Countdown timers not tied to a real close | **CONFIRMED** | Mathur 2019 (157 deceptive). |
| Manufactured social proof or winner feeds | **CONFIRMED + BINDING** (for ads) | Kenya L.N. 114 r.9(e) no testimonials; r.9(f) no "former winners". L.N. 112 **Reg. 87**: winners' identities are confidential unless they consent in writing. **Barasa 2026 (Kenya, n=905, lab-in-the-field RCT):** peer interaction plus warnings **increased betting rounds by 13%**, undermining the warning's effect. |
| Any notification or banner triggered by a loss (*Sci Rep* 2024) | **OVERSTATED citation; rule CONFIRMED** | Zhang et al. 2024 is observational eCasino data: players bet more and played longer **after immediate losses**. It does not test notifications. The rule is supported by UKGC **RTS 14A** (products must not encourage chasing losses; comparative), **Uganda Betting Regs 2017 r.4(c)** (ads must not encourage "recovering past … losses"; BINDING in Uganda), and Russell et al. 2018 (EMA, n=202: **texts raised betting likelihood and spend within 24h**). |
| Streaks, badges or confetti on money surfaces (Barber & Odean 2022) | **OVERSTATED** (mis-cited) | Barber, **Huang**, Odean & **Schwarz** 2022 is about **attention-induced trading**: the top-bought stocks had −4.7% 20-day abnormal returns. The direct evidence is **Chapkovski, Khapko & Zoican 2026** (*Management Science*, randomised): hedonic gamification (confetti, badges) raised trading volume **5.17%**. 70% of the platform gap is self-selection, 30% causal, and **low financial literacy predicts preferring the gamified platform**. Grade MODERATE. |
| Deposit bonuses, free stakes or credit ("prohibited outright by the Gambling Control Act 2025") | **WRONG** for bonuses and free bets | Act **s.72(7)** bans inducing bets "by advancing credits, the use of credit cards or meeting third party costs", then adds the proviso: "**shall not apply to free bets and bonus bets** conducted in the ordinary course of business". **s.74(1)(a)** bans credit, but **s.74(3)**: "Nothing in this section shall be construed as limiting an operator from **offering free bets and bonus bets**". **Credit is prohibited; bonuses and free bets are lawful in Kenya.** s.74(1)(b) (no "offer designed to induce persons to participate or increase their participation") sits in tension with 74(3). **Keep the ban as Kichiko policy**, on evidence: Challet-Bouju et al. 2020 RCT (n=171; inducements raised money wagered and perceived loss of control); Balem et al. 2022 (observational, n≈15,000); BIT 2022 free spins raised play 70%→75%. Tanzania's Advertising Code 2023, cl. 2.2.1(h), bans credit, vouchers or rewards as inducements in ads. |
| Confirmshaming | **CONFIRMED** (catalogued) | A Mathur 2019 category. Luguri 2021 found "loaded language" moderately effective. |
| Drip-priced fees | **CONFIRMED** | See rule 3. |
| Asymmetric YES/NO defaults | **CONFIRMED** (re-cited) | See rule 7. Polymarket's desktop ticket **pre-selects the leading candidate**, and the event page renders "Yes 58.7¢" selected (doc 21 §4 and §17 C15; doc 23 §5, measured). |
| Push-notifying sell-back | **CONFIRMED as precaution; evidence CONTESTED** | Bennett et al. 2024 (*Psych Sci*, 2 experiments, N=240): cash-out availability **raised bet amounts by up to 35%**. Hayes et al. 2026 (preprint RCT, N=377): more engagement and larger bets. **Szaszi et al. 2026 (registered report, N=595, real money): no effect.** Ngieng et al. 2026 (n=145): cashing out is *less* common at higher PGSI. Sinclair et al. 2024 (n=224): users report more distress. |

### Other corrections to doc 24 found on the way

1. **Draft vs gazetted Kenyan regulations.** L.N. 112 renumbers draft Regs. 85→**82** (ID/age),
   87→**84** (RG tools), 96→**93** (data/marketing consent) and 97→**94** (RG messaging).
   Draft 87(2)(f) "**player savings tool**" is **dropped**. Draft 45 "RTP publicly disclosed" became
   45(4) "disclosed **to the Authority**". The draft's ad-audience threshold ("more than twenty-five
   per centum … under the age") became "audience … **reasonably expected to be under the age**" (46(d)).
2. **New and binding for Kichiko: L.N. 112 Reg. 45(5)–(8).** No prediction market "except with the
   prior approval of the Authority". Outcomes must be determined by "a transparent, verifiable and
   independent resolution mechanism approved by the Authority". **No markets on** pending Kenyan court
   proceedings, "the physical safety, health or death of an identifiable natural person", or matters
   contrary to national security, public order or public interest. Records of all event contracts
   and settlements must be kept.
3. **Uganda's minimum age of 25 is CONFIRMED from the Act.** Lotteries and Gaming Act 2016, s.1:
   "'minor' means a person below twenty five years". s.57(1)/(3): a licensee "shall not accept
   payments from a minor", including "by electronic means". The 2018 Amendment Act (read page by
   page as images) adds "betting intermediary" and does not amend "minor". One internal
   inconsistency: Schedule 3 para. 2 (lottery rules) refers to "persons below eighteen years".
4. **Kenya has a statutory minimum online stake of KES 20** (Act s.71(1); an operator who permits
   less commits an offence, s.71(3)). It includes a yet-to-be-set "saving component" (s.71(2)).
5. **Misattributions in doc 24:**
   - "Tagoe, V. N. K., et al. (2022)" (PMC9595076) is **Bitanihirwe, Adebisi, Bunn, Ssewanyana,
     Darby & Kitchin 2022**.
   - "Newall et al., *Cue the sad trombone*" is **Myles, Bennett & Newall 2026**.
   - The deposit-limit RCT is **Ivanova et al.** (rule 8).
6. Doc 24 R3's "band … visible on tap" is contradicted by Wintle 2019.
7. **Kenya Act s.87 advertising provisions CONFIRMED:**
   - 06:00–22:00 TV/radio ban except during live sport (s.87(2)(e));
   - 20% of aired advertising for responsible gambling (s.87(2)(g));
   - penalty up to **KES 20M or 20 years** (s.87(4)).

---

## 2. Findings → element-level rules → acceptance criteria, by topic

Rule IDs are new: PR price · FR framing · FE fees · DF defaults · SE selling · CH charts ·
HM harm · RG tools · DP dark patterns · LW law. Every rule has a criterion a test or reviewer can
fail a PR on.

### 2.1 Price and probability representation

**Findings**
- **Single-event format.** % beat frequency for a single-event forecast (Joslyn & Nichols 2009;
  **MODERATE**, one study, n not in abstract). Frequency formats raise perceived magnitude through
  imagery (Slovic et al. 2000; forensic clinicians; **MODERATE**). Natural frequencies help Bayesian
  tasks (**STRONG**, meta-analysis), which **do not transfer** to reading one price.
- **Reference class.** Without it, "30% chance of rain" was read in contradictory ways across five
  cities (Gigerenzer et al. 2005; **MODERATE**). But Joslyn 2009 found adding a reference-class
  phrase did not help. **CONTESTED** on the remedy; the ambiguity itself is well documented.
- **Verbal probabilities.** Words regress toward 50% across 24 countries and 17 languages; only
  **inline** numbers fix it (Budescu 2014; Wintle 2019). **STRONG.** Transfers directly: it is
  about reading probability words, independent of domain.
- **Price = probability.** Prices are "usually close to the mean beliefs of traders" but "sometimes
  biased" (Wolfers & Zitzewitz 2006, theory and data; **MODERATE**). Kalshi (>300,000 contracts):
  prices are informative and improve toward close, but show a **favourite–longshot bias**.
  Low-price contracts "win far less often than required to break even", and high-price contracts
  yield small positive returns (Bürgi, Deng & Whelan 2026, **abstract only**; bucket magnitudes
  UNVERIFIED). In horse racing the bias is driven by **misperception of probability**, not risk-love
  (Snowberg & Wolfers 2010; **MODERATE**). But **two-outcome** sports markets often show *favourite*
  bias (Newall & Cortis 2021, review). **CONTESTED** on direction in binary markets, so Kichiko must
  measure its own.
- **Binary-option precedent.** ESMA banned binary options for EU retail clients (Decision
  (EU) 2018/795). Its reasons: pricing "requires retail clients to accurately assess the value of
  the option in relation to the expected probability"; "the more positions an investor takes, the
  more likely they are to lose money"; and "the existence of a secondary market … does not change
  the fundamental characteristics". A Kichiko contract is structurally a binary option on a trading
  venue. The price-comprehension problem **transfers fully**. Kichiko's P2P structure has no house
  counterparty, but fees make the aggregate expected return negative in the same way.
- **Numeracy.** Less numerate people are more swayed by framing and irrelevant affect (Peters et
  al. 2006; **MODERATE**). Problem gamblers had the lowest comprehension: 2% all-correct vs 14% of
  non-risk gamblers (BIT 2022). No numeracy data for the Kenyan target population was found
  (§4, gap).

**Rules**
- **PR-1. Format.** The probability is an integer percent next to the side label: `Yes 57%`.
  `<1%` below 0.5% and `>99%` above 99.5%. **Never** ¢, decimal odds, fractional odds, or
  multipliers such as `2.3×`. *Accept:* the formatter unit test covers 0.2→`<1%`, 0.6→`1%`,
  57.4→`57%`, 99.7→`>99%`. A CI grep fails on `¢`, `odds`, or a `\d+(\.\d+)?x` pattern in
  user-facing strings under `apps/web`.
- **PR-2. Event and resolution with the number.** Wherever a price is shown with a buy
  affordance, the same block carries the full question, the close date/time (EAT) and the named
  resolution source. This is **BINDING** under Reg. 45(6) and 23(1); CFTC's customer-rights page
  (comparative) lists settlement terms: "how settlement determinations will be made, who decides,
  and how". *Accept:* an e2e test on the ticket asserts that the question text, close time and
  resolution-source link are all inside the ticket container and inside the 360×640 viewport
  without scrolling.
- **PR-3. No mandatory frequency gloss.** "about 57 in 100" ships only as an arm of experiment E1.
  *Accept:* the reviewer fails any PR that adds it outside a flag named in E1.
- **PR-4. Verbal words only inline with the number.** For example `57% (likely)`. Never in a
  tooltip, never alone. *Accept:* lint rejects `likely|unlikely|probable|almost certain` in any
  string template that has no `%` token in the same string.
- **PR-5. Kichiko's own calibration, disclosed.** A public calibration page shows, per price
  bucket (0–10, 10–20 … 90–100), resolved contracts n, the realised win rate and the average
  money result per KSh 100 staked, with 95% CIs. The ticket shows a static bucket line (money
  framing, FR-3) **only** when that bucket has n ≥ 200 resolved contracts and its CI excludes zero.
  *Accept:* a job test on fixture data. The ticket line renders if and only if both conditions
  hold, and every figure maps to a query in `docs/` (DP-1).

### 2.2 Framing money outcomes

**Findings**
- **RTP framing.** RTP/"payout %" framing raises perceived chance of winning (Weiss-Cohen 2025,
  2 studies, N=6,062, ORs>5; Newall et al. 2020, n=399 and n=407: house edge understood by 66.5%
  vs RTP 45.6%; BIT 2022 RTP backfire). **STRONG.**
- **Money-loss framing.** It improves understanding of the loss ratio (BIT 2022 Q1 27%→52%;
  **MODERATE**, single large experiment). Its behavioural effect is small (Newall 2022 OR 1.40/1.57;
  BIT: no in-game change) and **null among PGSI 4+** (**WEAK** behaviour).
- **Averages misread as caps.** "Lose £7 per £100" increased the belief that losses are capped
  (BIT RQ1). **MODERATE.**
- **Losses disguised as wins.** A moderate frequency of LDWs made higher-risk gamblers persist
  longer (Graydon et al. 2018, n=132; **WEAK**). Regulators ban celebrating them (UKGC RTS 14F), and
  the rule is circumvented when "celebration" is undefined (Myles 2026).
- **Transfer.** Slots have a house edge. A binary contract's "if right you get KSh 100" is a
  *gross* return, which structurally resembles RTP (money back, including stake). A sell-back at a
  loss that returns KSh 40 on KSh 57 paid is **structurally an LDW**. Transfer is argued, not tested
  (E2).

**Rules**
- **FR-1. The money block.** On the buy sheet, before the confirm control and in the same viewport,
  show three lines, fixed order, KSh, body size or larger, equal visual weight:
  `You pay KSh 57` (all-in, FE-1) ·
  `If Yes happens: you get KSh 100 (KSh 43 more than you paid)` ·
  `If No happens: you get KSh 0 — you lose the KSh 57`.
  BINDING basis: Reg. 23(1), Reg. 45(1), Act s.72(6). WCAG 3.3.4 "confirmed". Behaviour
  UNTESTED (E2). *Accept:* component test: the arithmetic is exact for 20 fixtures including fees
  and rounding. All three lines render inside the viewport with the confirm button at 360×640, and
  none is behind a disclosure, tooltip or accordion.
- **FR-2. No return-% headlines.** No `+75%`, `2.3×`, `ROI`, `payout %` or `return %` on the
  ticket, cards or portfolio headline. Profit appears only as KSh. *Accept:* CI grep and a reviewer
  checklist item.
- **FR-3. Economics in money per KSh 100, with volatility.** Any aggregate statement uses the form
  `Across all resolved markets priced under 10%, buyers got back about KSh 38 for every KSh 100
  they paid. Your result on any one market can be the full KSh you pay.`
  (Placeholder numbers: real ones come from PR-5.) The second sentence addresses BIT's
  max-loss misreading. If the GRA requires an RTP figure under Reg. 20(2), it goes on the rules
  page next to the money statement, never in place of it. *Accept:* any string containing
  "per KSh 100" or "for every KSh 100" must be followed in the same component by the volatility
  sentence (snapshot test).
- **FR-4. Never frame sell-back as a safety net before purchase.** No "sell any time", "cash out
  any time" or "exit whenever you like" on the ticket or market page. Bennett 2024: cash-out
  availability raised bets by up to 35% "by allowing bettors to avoid losing their entire stake".
  CONTESTED (Szaszi 2026 null), so kept as a precaution. *Accept:* grep over ticket and market
  strings.
- **FR-5. No celebration unless net > 0.** For any settlement or sale where proceeds ≤ total paid
  (including fees): no green or `--yes` token, no success haptic, no sound, no animation, no
  confetti, no "You won", no emoji. Copy: `Returned KSh 40 · Net −KSh 17`. **"Celebration" is
  defined** as any of: colour tokens reserved for gains, audio, haptics, motion over 150 ms, or the
  words won/win/winner/congrats. *Accept:* a unit test maps `net ≤ 0` to the neutral/loss token set
  and asserts no `navigator.vibrate` or audio call. A visual-regression snapshot for net −1, 0, +1.

### 2.3 Fees

**Findings**
- **Drip pricing.** Up-front all-in pricing changes choices and reduces spend in the field (Blake
  2021, StubHub field experiment; **STRONG** with Santana 2020's 6 studies and Rasch 2020's lab
  market). Consumers who met dripped surcharges stuck with worse options even after seeing the
  total (Santana).
- **Transfer.** Directly transferable: a trading fee revealed at confirm is a mandatory surcharge.
  Kenya makes it binding (Act s.72(6)(b)). The FTC notes that an honest seller is "at a significant
  disadvantage" to one that drips, which is the commercial cost Kichiko accepts.

**Rules**
- **FE-1. All-in first, everywhere.** The first price the user sees for an action already includes
  every mandatory charge: trading fee, and any levy or tax that applies at that step. The fee is
  itemised in KSh on the same sheet as `You pay`. Deposit shows `KSh 500 from M-Pesa → KSh X
  available to trade`; withdrawal shows `KSh X to your M-Pesa`. *Accept:* an e2e test on the buy,
  deposit and withdraw flows asserts that the amount on the first screen equals the confirm-screen
  total, which equals the receipt total. No new monetary line may appear after the first screen.
- **FE-2. Fee in KSh, not only %.** The % may appear in the rules layer. *Accept:* component test.
- **FE-3. Fee changes are announced and not retroactive to open orders.** Reg. 23(2) forbids
  altering "the terms of a bet after it has been accepted". *Accept:* a DB test shows a fee change
  does not alter fills of orders placed earlier.

*The tax treatment, 5% deposit excise and 5% withholding, is carried over from
`EAST-AFRICA-KENYA-MARKET-RESEARCH.md` and was **not re-verified** in this pass.*

### 2.4 Defaults: sides, stakes, amount chips, limits

**Findings**
- **Defaults shift choice.** Meta-analysis d=0.68 (**STRONG**). The effect is stronger when the win
  probability is low (Lanier 2025; **WEAK-MODERATE**, N=317). That is exactly the longshot case.
- **Suggested amounts anchor.** In the field (Haggag & Paci 2014, 13M+ rides; Goswami & Urminsky
  2016): **STRONG**. Low default amounts *raise participation* ("lower-bar") while lowering
  amounts ("scale-back"). Too-high suggestions provoke opt-out.
- **Limit prompts.** A one-off voluntary prompt raised limit-setting but **did not change net loss**
  (Ivanova 2019; **MODERATE**, single RCT). Messages raised limit uptake from 0.08% to 0.71%
  (Heirene & Gainsbury 2021, RCT, 26,560 customers). Setters then reduced wagering, but that
  comparison is **self-selected**. Norway's **mandatory** personal loss limits showed no clear
  association with later expenditure (Tørdal 2026; observational).
- **Limit efficacy overall.** **WEAK/CONTESTED** as a harm reducer; **BINDING** as a facility
  (Kenya Reg. 84(2)(a)–(b); Tanzania reg. 50).
- **Regulator design model (comparative).** UKGC RTS 12:
  - 12B: a **free-text** box for limits;
  - 12E: setting a limit is the **default** choice and declining requires an action;
  - 12D: increases only after ≥24h plus reconfirmation; decreases immediately;
  - 12D: a statement prompt at least every 6 months.
- **Competitor (measured, July, doc 21):** Polymarket's ticket uses additive chips
  `+$1 · +$5 · +$10 · +$100`. Our own `BETTING-PANEL-CONVERSION` seeded "the first balance-aware
  preset".

**Rules**
- **DF-1. No pre-selected side on any viewport.** Before user input, neither side is
  `aria-pressed="true"` and no side is visually filled. A side becomes selected only through an
  explicit tap on that side. This applies to multi-outcome markets too: no "leading candidate"
  auto-selection. *Accept:* e2e on desktop and mobile loads `/markets/[slug]` and asserts that no
  `aria-pressed=true` exists in the ticket, and that computed background colours of the YES and NO
  controls are equal.
- **DF-2. Stake starts empty.** Placeholder `Min KSh 20`. No seeded amount. Amounts below KSh 20
  are rejected with `The minimum is KSh 20` (BINDING, Act s.71). If quick amounts exist, they
  **set** (not add) a fixed amount from `{20, 50, 100, 200}`. They are **never** balance-
  proportional, and there is **no `Max`, `25%` or `All-in` chip**. *Accept:* unit test: chip values ⊆
  the set; the initial field value is empty; submitting 19 fails client and server side.
- **DF-3. Limit setup is default-on, free-text, asymmetric.**
  - At registration or first deposit, limit-setting is the default path. Proceeding without a limit
    requires an explicit `Not now` (neutral copy, DP-6).
  - Daily, weekly and monthly deposit limits and a loss limit are entered as **free text** in KSh.
    No preset amounts (anchoring).
  - A decrease takes effect **immediately**. An increase takes effect after **≥24 hours** and
    **only after the user confirms again** at that point. **For Tanzania:** any amendment or
    revocation takes effect after 7 calendar days (GN 478T reg. 50(3)–(4)).
  - The lowest applicable limit binds.

  *Accept:* e2e: a new account cannot reach the deposit STK push without either a saved limit or a
  recorded `declined_limit_at`. A DB test: an increase row has `effective_at ≥ requested_at + 24h`
  and `status = 'pending_reconfirm'`; a decrease has `effective_at = requested_at`.
- **DF-4. No auto-selected market or outcome from a notification deep link.** The link opens the
  market in the neutral state of DF-1. *Accept:* e2e via a deep link.

### 2.5 Selling and cashing out

**Findings**
- **Cash-out.** Availability raises bet size (Bennett 2024, 2 experiments, N=240) and engagement
  (Hayes 2026 preprint, N=377). A registered report with real money found **no effect** (Szaszi
  2026, N=595). **CONTESTED.** Users who cash out report more distress and "cut losses" motives
  (Sinclair 2024, n=224, cross-sectional). Cashing out is *less* frequent at higher PGSI and
  impulsivity (Ngieng 2026, n=145).
- **Disposition effect.** Investors realise winners and hold losers (Odean 1998, 10,000 accounts;
  **STRONG** as a phenomenon, replicated widely, though only Odean was verified here). In a lab,
  removing the purchase price from the display cut the disposition effect by **25%** (Frydman &
  Rangel 2014; **WEAK**, single lab).
- **Price-trend notifications** "reinforce trading mistakes for those with incorrect beliefs"
  (Chapkovski 2026; **MODERATE**).
- **Transfer.** Sell-back is intrinsic to an order-book market: it *is* the cash-out. ESMA notes a
  secondary market "does not change the fundamental characteristics". The harm mechanism in Bennett
  (avoiding total loss of stake) applies directly.

**Rules**
- **SE-1. Sell exists, and is reached from the position, not pushed.** A sell action is available
  on the position view and in the portfolio. **No** sell/cash-out prompt on the market page for
  non-holders, **no** automatic "cash out now" offers, **no** notification whose purpose is to
  prompt a sale, and no partial-cash-out nudges. *Accept:* the notification-type enum contains no
  sell or price-move type, and a reviewer checklist item covers prompts.
- **SE-2. The sell sheet leads with forward-looking money.** Order of lines:
  `Sell now: you get KSh X` · `If you keep it: KSh 100 if Yes, KSh 0 if No` ·
  `You paid KSh P · Net if you sell now: ±KSh (X−P)`.
  Purchase price and net result stay **visible**, because honesty and account-information duties
  outrank the de-biasing idea, but they come third (Frydman & Rangel, WEAK; test in E6). *Accept:*
  a component snapshot fixes the line order, and the arithmetic test covers fees.
- **SE-3. Neutral treatment of unrealised results.** Unrealised gains are not green-celebrated.
  Unrealised losses are shown in the same neutral style with a minus sign (FR-5 tokens). *Accept:*
  visual regression.

### 2.6 Charts

**Findings**
- **Truncation.** It exaggerates perceived change, and warning glyphs do not fix it (Correll 2020;
  Yang 2021; **STRONG** for the effect). A full-range axis under-sells differences (Witt 2019;
  **WEAK**, n per experiment as small as 9).
- **Time horizon.** Shorter chart horizons raise trading and fees without changing risk-taking
  (Borsboom 2022, n=1,041; **MODERATE**, equities, lab). The churn mechanism transfers, because fees
  make trading costly on Kichiko too. The magnitude should not be assumed.
- **Distributions.** For continuous forecasts, quantile dotplots improve incentivised decisions
  (Fernandes 2018, n=408: 97% of optimal payoff, +5pp vs control) and estimate precision (Kay 2016,
  n=320). **MODERATE**. This applies only to range or numeric markets.
- **Competitor (July capture, doc 21):** Polymarket's graph tab auto-scaled the y-axis (~10–35%)
  with default range `ALL`. It shows green relative-change chips (`+26%`, accent green 2.89:1,
  failing AA; doc 23).

**Rules**
- **CH-1. The probability y-axis is fixed at 0–100%,** gridlines 0/25/50/75/100, labels visible.
  This is a deliberate trade-off: we under-emphasise short-term moves because the churn evidence
  says emphasising them costs users money. *Accept:* the chart component test asserts
  `domain == [0, 100]` for fixtures with ranges 48–52 and 2–98.
- **CH-2. Default range = full market life (`All`).** Offered ranges: `1D · 1W · 1M · All`. No
  `1H`, no candlesticks. The range selection is not persisted as a new default across markets.
  *Accept:* e2e: first render of every market has `All` selected.
- **CH-3. Changes shown in percentage points, neutral colour.** For example `▲ 3 pts since
  yesterday`, never `+26%` and never green/red. A relative % change of a probability is ambiguous
  by construction: 2%→2.5% is "+25%". This is an argument from logic, not from a study. *Accept:*
  grep for `%` adjacent to `▲▼+−` in change components; token check.
- **CH-4. No bands on binary price charts.** For numeric-range markets only, the forecast
  distribution is a **quantile dotplot (20–50 dots)**, not a shaded band. *Accept:* reviewer
  checklist.

### 2.7 Harm specific to event contracts: in-play, speed, notifications, loss-triggered prompts

**Findings**
- **Prediction-market harm evidence.** No peer-reviewed **empirical** study of harm among
  prediction-market users was found in Europe PMC (searched 2026-09-27). There are commentaries: a
  *Science* 2026 policy forum on "gambling-like design" and "new behavioral addiction"
  (Packin & Rabinovitz, abstract only), and an *Addiction* 2026 commentary (Johnson & Chan, no
  abstract). **The strongest regulator statement on the structurally identical product is ESMA
  2018/795**: binary options "attract compulsive gambling behaviour", and many bets are placed
  within days despite cumulative losses.
- **US regulator.** The CFTC (Staff Letter 26-08, 12 Mar 2026) addresses **integrity**, not
  psychology. It flags heightened manipulation risk for contracts on "injuries to individual sports
  participants", altercations and officiating. Kenya's Reg. 45(7)(b) is broader and binding.
- **In-play.** In-play bettors report higher problem-gambling severity and harms (Vieira 2023,
  N=920, cross-sectional; **WEAK**). Inducement uptake predicts impulsive in-play betting (Hing
  2018, N=1,813; **WEAK**).
- **Speed.** Slowing online roulette to one spin per 60 s reduced the amount gambled (Newall et al.
  2022, N=1,002, incentivised RCT; **MODERATE**). A review finds fast games preferred, especially by
  problem gamblers, with inconsistent behavioural results (Harris & Griffiths 2018).
- **Notifications.** Operator **texts** raised the likelihood of betting and spend within 24h
  (Russell 2018, EMA; **WEAK-MODERATE**).
- **Chasing.** Players chase within sessions after immediate losses (Zhang 2024; Edson 2025,
  n≈71,000; observational, **MODERATE** for existence).
- **Transfer.** Live sports markets on Kichiko resolving within minutes are the in-play product.
  Speed transfers as time-between-decisions.

**Rules**
- **HM-1. Market eligibility (BINDING).** Market creation rejects, and the admin publish step
  blocks, any market whose underlying event concerns (a) proceedings pending before a Kenyan court,
  (b) the safety, health, injury or death of an identifiable person, or (c) national security or
  public order. No market goes live in Kenya without the GRA approval reference stored on the
  market (Reg. 45(5)). *Accept:* a validation test suite with a blocked-topic taxonomy. The
  `markets` row requires `gra_approval_ref` when `jurisdiction='KE'`, and publishing fails without
  it.
- **HM-2. No in-play micro-markets at launch.** No market may close less than 60 minutes after it
  opens, and no market may resolve on a single in-game action (next goal, next card, next corner).
  Aggregate outcomes such as the final result are allowed. The 60-minute value is a policy choice
  pending E7. *Accept:* the market-schema validator rejects single-action templates and
  `closes_at − opens_at < 60 min`.
- **HM-3. No repeat-order shortcuts.** No `Buy again`, `Repeat last`, one-tap reorder or
  auto-rebuy. Every order requires amount entry and the FR-1 sheet (cf. UKGC RTS 14A). *Accept:*
  reviewer checklist, and e2e showing that the post-trade screen has no buy control.
- **HM-4. The notification whitelist is the law of the notification service.**
  - Allowed without marketing consent: deposit/withdrawal receipts, order filled/cancelled,
    market resolved (neutral copy, FR-5), limit reached, limit-change effective, reality check,
    self-exclusion confirmations, security.
  - **Anything that promotes participation is an "advertisement"** under Kenya L.N. 114 r.2 ("any
    form of communication that promotes or is intended to promote participation … electronic or
    digital"). It needs GRA approval (r.5), **may not contain a call-to-action** (r.9(a)), must
    carry the r.8 elements, needs prior **marketing consent** (Reg. 93(3); Tanzania Code 2.2.6), and
    **must never go to a self-excluded person** (Reg. 70(5)(c)).
  - **No notification is ever triggered by** a lost position, a falling balance, a losing streak,
    inactivity after a loss, or a price move.

  *Accept:* an enum whitelist test; a trigger-source test that no job subscribes to `position_lost`,
  `balance_decreased` or `price_moved`; marketing sends fail without `consent_at` and
  `gra_ad_approval_id`; a self-exclusion check at send time.
- **HM-5. The loss screen is a dead end.** After a resolution against the user, the result screen
  shows the outcome and the net KSh, plus links to Portfolio and to limits and help. It shows no
  market carousel, no "try another", and no "win it back" copy (UKGC RTS 14A; Uganda r.4(c)).
  *Accept:* snapshot and reviewer checklist.
- **HM-6. Reality check (BINDING in KE).** A pop-up shows **time elapsed** since the session began
  (Reg. 84(2)(d)) and, as Kichiko policy, **the session net in KSh**. The user must acknowledge it
  before the next order. It offers `Stop for now` and a link to history. The frequency is
  user-settable, and the default is the **shortest** interval offered (cf. RTS 13B). Efficacy:
  pop-ups meta g≈0.5 short-term, with heterogeneity (Bjørseth 2021; **MODERATE**). Mandatory breaks
  had little lasting effect (Hopfgartner 2022/2023). *Accept:* an e2e with a fake clock: at the
  interval, the order submit is blocked until acknowledgement.

### 2.8 Responsible-gambling tool efficacy: what reduces harm, with effect sizes

| Tool | Best evidence | Effect | Grade | Transfer |
|---|---|---|---|---|
| Operator outreach to highest-loss customers (phone or letter) | Jonsson et al. RCT 2019/2020, Norsk Tipping top 0.5%, 1,003 triplets | 12 weeks: theoretical loss −29% phone, −15% letter, −3% control. 12 months (per-protocol n=596): −30% (d=0.44), −13% (d=0.18), −7% (d=0.11). >93% still customers | **MODERATE-STRONG** (RCT + follow-up) | Good: the mechanism is personal feedback on spend, not product-specific |
| Pop-up messages | Bjørseth 2021 meta, 18 studies | g=0.505 behavioural [0.256, 0.746]; g=0.413 cognitive; short-term; unexplained heterogeneity | **MODERATE** | Fair |
| Warning messages in Kenya | Barasa 2026, lab-in-the-field RCT, n=905 Kenyan gamblers | Wagered −8%, rounds −4%; **with peer interaction, rounds +13%** | **MODERATE** (only local RCT) | **Direct** |
| Personalised feedback interventions | Smith 2025 meta, 18 RCTs, n=9,869 | Post g=−0.06 (NS); follow-up g=−0.10; therapist-facilitated/MI g≈−0.18/−0.19 vs −0.02/−0.03 non-facilitated | **STRONG that automated PFIs are weak** | Fair |
| One-off deposit-limit prompt | Ivanova 2019 RCT, N=4,328 | Limit-setting OR 4.1–11.9; **net loss OR 1.0** | **MODERATE null** | Good |
| Limit-setting itself / mandatory limits | Auer 2020 (n=49,560); Heirene 2021; Tørdal 2026 (n=104,413) | Setters reduce (self-selected); mandatory personal limits: no clear expenditure association | **WEAK / CONTESTED** | Unknown |
| Mandatory play breaks | Hopfgartner 2022 (n=21,129) and 2023 (n=23,234), randomised durations | 15-min breaks lengthen voluntary pauses; no effect on amount wagered after resuming | **MODERATE null** for spend | Fair |
| Self-exclusion | Gainsbury 2014 review; Motka 2018 SR; Hopfgartner 2023 (n=3,203) | Under-used; barrier is complicated enrolment; short (≤38 days) exclusions mostly return, >90 days did not | **WEAK** efficacy; **MODERATE** on barriers | Good for barrier design |
| Speed-of-play limit | Newall 2022 RCT, N=1,002 | Reduced amount gambled | **MODERATE** | Partial (time between orders) |
| Removing inducements | Challet-Bouju 2020 RCT n=171; Balem 2022 observational | Inducements raise wagering and loss of control | **MODERATE** | Good |

**Rules**
- **RG-1. Self-exclusion: ≤2 taps, real time, irreversible until expiry.**
  - Reachable in **≤2 taps from every money screen** (ticket, deposit, portfolio, reality check).
  - Periods: 24 hours, 7 days, 30 days, 6 months, 1 year, permanent (Reg. 69(2), 84(2)(d)).
  - Effective **immediately** (Reg. 67(3)): open orders are cancelled, deposits are blocked,
    **withdrawal stays available**, and marketing stops (70(5)(c)).
  - **No self-service reversal before expiry** (Reg. 72(1)); permanent means ≥3 years (71(3)).
    Tanzania: no reinstatement for 6 months unless the Board approves (GN 478T reg. 48(3)).
  - Synced with the national register (84(2)(e), 73).
  - No retention offer, survey gate or confirmshaming on the path.

  *Accept:* a tap-count e2e from 5 screens, each ≤2. A post-exclusion order returns 403, withdrawal
  still succeeds, and no "undo" route exists. The register-sync job has a test.
- **RG-2. Limits:** see DF-3. *Plus* a limit-reached screen that states the limit, when it resets,
  and how to lower it. It does not offer to raise it on that screen.
- **RG-3. High-loss outreach workflow.** A daily job flags accounts in the top 0.5% by net loss
  (rolling 90 days) or with a limit raised twice in 30 days (a marker per Ivanova 2019 and
  Hopfgartner 2023). They go to a trained human outreach queue (phone first). The in-app message is
  neutral and has **no** call-to-action to play. *Accept:* job test on fixtures. The queue exists
  before launch; the reviewer verifies the SLA in the runbook.
- **RG-4. Activity statement.** A monthly in-app statement: deposits, withdrawals, fees and net
  result in KSh, plus a prompt at least every 6 months to review limits (cf. RTS 12D). Efficacy is
  weak (Smith 2025), so it is built as a floor, not claimed as protection. *Accept:* statement
  totals reconcile to the ledger in a DB test.
- **RG-5. No reverse withdrawals.** A submitted withdrawal cannot be cancelled back into the
  trading balance (UKGC 2021 permanent ban; RTS 14B; comparative). The withdrawal flow's taps are ≤
  the deposit flow's (rule 13). *Accept:* the API has no cancel endpoint for `withdrawals.status in
  (requested, processing)`; tap-count test.

### 2.9 Dark patterns

**Findings**
- **Prevalence.** Documented by Mathur 2019 (STRONG, descriptive).
- **Behavioural power.** Luguri & Strahilevitz 2021 (**MODERATE**, two large representative US
  experiments; n not in abstract):
  - mild patterns more than doubled acceptance and aggressive ones nearly quadrupled it;
  - less-educated people were more susceptible;
  - with dark patterns in place, **price became immaterial**.
- **Regulatory taxonomy.** The FTC 2022 staff report and EU DSA Art. 25 + recital 67 give usable
  taxonomies (comparative, not binding in East Africa).
- **Gamification.** Confetti and badges raise volume, and low-literacy users select into them
  (Chapkovski 2026; **MODERATE**).
- **Rankings.** They raise risk-taking **among underperformers** (Kirchler, Lindner & Weitzel 2018:
  657 professionals + 432 students; **MODERATE**, lab-in-the-field).
- **Peers.** Peer interaction undermined warnings in Kenya (Barasa 2026).
- **Attention lists.** Top lists drive attention-induced buying with −4.7% 20-day abnormal returns
  (Barber et al. 2022; **MODERATE**, observational). Smartphone trading raises lottery-type
  purchases (Kalda et al. 2021, working paper; **WEAK-MODERATE**).
- **Transfer.** Strong: these are interface-level mechanisms on money apps.

**Rules**
- **DP-1. Every displayed number is traceable.** Every dynamic number (price, volume, participant
  count, change, countdown, P/L) is produced by a named query or function documented in code
  (`// source: <query>`). *Accept:* a CI script lists numeric render sites in `apps/web/components`
  that lack a source annotation. Zero is the pass condition.
- **DP-2. The only countdown is the market's `closes_at`.** *Accept:* the countdown component's
  prop type accepts only a `Market` object, not a free timestamp.
- **DP-3. No profit leaderboards, winner feeds, "X just won", biggest-win stats, or public P/L
  rankings on any surface at launch.** This covers the existing `/leaderboard` and the profile
  "Biggest win" stat (doc 21 §10, §11). BINDING basis: Reg. 87 (winners' confidentiality), and for
  ads L.N. 114 r.9(e)–(f). Evidence: Kirchler 2018; Barasa 2026. *Accept:* the route is removed or
  gated behind a flag that defaults off, and the reviewer checklist covers it.
- **DP-4. No gamification on money surfaces.** No streaks, badges, levels, confetti, XP, or
  "hot" / 🔥 / "trending" lists on the home or market pages. Polymarket's "Hot topics 🔥" and
  "Breaking News" deltas appear in the July capture (doc 21). *Accept:* grep for
  `confetti|streak|badge|🔥|trending|hot` in `apps/web`, with an allow-list for non-money surfaces.
- **DP-5. No inducements at launch.** No deposit bonus, free bet, referral cash, promo code, or
  "earn X% on balance". This is **Kichiko policy, not a Kenyan legal requirement** (Act s.74(3)).
  Polymarket's July capture shows "Use code POLY50 for $50" and "Earn 3.25%" (doc 21). *Accept:*
  reviewer checklist, and no `promo_code` column in production migrations.
- **DP-6. Neutral decline.** Decline options read `Not now` or `No limit for now`: no guilt, no
  sad faces, no "Are you sure you want to stop protecting yourself?". *Accept:* copy review list.
- **DP-7. Exit ≤ entry.** Withdrawal ≤ deposit and self-exclusion ≤ first purchase, in taps, screens
  and fields, with median time measured each release (rule 13, confirmed). *Accept:* the tap-count
  assertion in CI.
- **DP-8. No skill, investment, income or "earn" framing in product or marketing copy.**
  - Kenya L.N. 114 r.6(1)(c)(i): no "means of financial success, investment"; r.9(c): no "source of
    investment or income".
  - Uganda Betting Regs r.4(e)(iii)–(iv): must not imply betting "primarily involves skill" or "is
    a form of investment".
  - Tanzania Code 2.2.2: no suggestion that skill influences non-skill gaming.

  The prediction-market pitch "trade on your knowledge" is therefore a legal risk in Uganda and
  Tanzania. *Accept:* a CI grep denylist (`earn`, `invest`, `income`, `skill`, `profit from your
  knowledge`, `beat the market`) over i18n files, with legal sign-off for exceptions.

### 2.10 Regulation as a design constraint (primary legislation)

| Constraint | Kenya | Uganda | Tanzania | Rwanda |
|---|---|---|---|---|
| **Minimum age** | **18.** Act s.72(2)–(3): proof of "age of majority" before registration; s.109 prohibits betting with a child. L.N. 112 Reg. 82: ID, **location** and age assurance before account activation and before any deposit | **25.** Act 2016 s.1 "minor … below twenty five years"; s.57 no payments from a minor, including electronic. Betting Regs 2017 r.5(1): National ID or passport before participation | **18.** Gaming Act Cap. 41 R.E. 2023 s.74(1)(c). GN 478T reg. 47(5): homepage notice that no under-18 may play, plus a link to a filtering program | **18.** Law 58/2011 art. 2 ("minor: under 18") and art. 31 |
| Rules before wager | Reg. 45(1); Reg. 23(1); Act s.72(6) | — (not found in texts read) | GN 478T reg. 44(2): rules, "any cost associated with participating", and the statement that the "player may set limits" | Art. 28: chances of winning and operator advantage in the game description; rules on request |
| Prediction markets | **Reg. 45(5)–(8)**: prior approval; approved resolution mechanism; banned subjects; records | "Betting intermediary" (2018 Amendment s.2) likely covers an exchange; **no PM-specific text found** | No PM-specific text found | No PM-specific text found |
| RG tools | Reg. 84: deposit limits (day/week/month); loss, session, expenditure limits; reality checks showing duration; self-exclusion ≥24h; national register link | Not found in texts read | Reg. 47 warnings, RG policy link, self-assessment link; reg. 48 self-exclusion (6-month minimum before reinstatement); reg. 50 limits (7-day change delay) | Art. 32 exclusion register (self or court); art. 34 RG programme |
| Advertising | Act s.87; L.N. 114: GRA approval, **no call-to-action**, no testimonials or former winners, no "investment/income", no jingles/hooks, mandatory licence no., helpline and "authorized and regulated by the Gambling Regulatory Authority" | Betting Regs r.3(2): **"Betting is addictive and can be psychologically harmful"** on every ad **including websites**, translated if not in English; r.4 bans | Advertising Code 2023: RG message; radio/TV blackout 06:00–14:00 weekdays; no unsolicited SMS/calls without prior consent | Art. 33: addiction warning; must not encourage removal from the exclusion register |
| Credit / bonuses | Credit banned (s.74(1)(a)); **free bets and bonus bets permitted** (s.74(3)) | Not found in texts read | Credit banned unless the Board authorises (reg. 46); ad inducements banned (Code 2.2.1(h)) | Not found |
| Minimum stake | **KES 20 online** (s.71) | — | — | — |

**Rules**
- **LW-1. Country-parameterised age gate.** `min_age = {KE:18, UG:25, TZ:18, RW:18}`, checked
  against verified ID before deposit. Uganda's 25 is not a typo. *Accept:* a unit test per country;
  e2e with a 24-year-old UG identity is blocked.
- **LW-2. Jurisdictional warning strings are verbatim and non-dismissable in the footer and ticket
  rules layer.** Uganda: `Betting is addictive and can be psychologically harmful.` (plus its
  Luganda/Swahili translations if the UI is not in English). Kenya: the RG message, licence number
  and helpline per L.N. 114 r.8 on marketing surfaces, and RG messages on the platform (Reg. 94).
  Tanzania: homepage RG policy link, self-assessment link, and under-18 notice. *Accept:* per-locale
  snapshot tests.
- **LW-3. Market eligibility:** see HM-1.
- **LW-4. Reg. 45(6) resolution transparency.** Every market page links its resolution source and
  mechanism, and each resolved market shows the evidence used and the time. *Accept:* the resolved
  state renders `resolution_evidence_url` and `resolved_at`; publishing fails if they are null.

---

## 3. The edge: where evidence points to an advantage Polymarket and Kalshi do not take

The argument has three parts: (1) a measured competitor behaviour; (2) primary evidence that the
behaviour costs users; (3) a local condition that turns avoiding the cost into an advantage rather
than a sacrifice. Where (3) is an inference, it is labelled.

1. **Money-first prices instead of ¢ prices.**
   - *Competitor (measured):* Polymarket's ticket shows `Yes 58.7¢`, with $ additive chips
     (doc 23 §5; doc 21).
   - *Evidence:* retail clients struggle to value a binary contract against its probability (ESMA
     2018/795, a regulator finding). Payout-style framing raises perceived chance (Weiss-Cohen 2025,
     STRONG).
   - *Local condition:* KSh plus % is already decided. The FR-1 block states the three money
     outcomes in the currency on the user's M-Pesa SMS.
   - *Honest limit:* nobody has tested ¢ against % for comprehension. The edge is plausible, not
     proven, and E1/E2 measure it.
2. **A published, locally computed calibration record (PR-5).**
   - *Evidence:* the favourite–longshot bias exists on Kalshi (Bürgi et al., abstract), driven by
     probability misperception (Snowberg & Wolfers). Its direction is contested in two-outcome
     markets (Newall & Cortis).
   - *Competitor:* no per-bucket realised-return disclosure appears in any captured Polymarket
     surface (docs 21/23). Kalshi was not measurable this session.
   - *Why it is an edge:* a scam-primed audience (EAST-AFRICA doc) is told "we might be wrong, here
     is our record with CIs". This is also the only disclosure whose numbers cannot be accused of
     marketing, because they come from settled contracts. Kenya's Reg. 45(6)/(8) transparency and
     record duties make the data exist anyway.
   - *Limit:* disclosures alone have small behavioural effects (Newall 2022) and none on problem
     gamblers (BIT). This is a trust asset, not a safety system.
3. **Neutral tickets.**
   - *Competitor (measured):* Polymarket desktop pre-selects the leader; its chips are additive,
     from +$1 to +$100.
   - *Evidence:* defaults move choice (d=0.68), more so for low-probability options (Lanier 2025).
     Suggested amounts anchor stakes (Haggag & Paci; Goswami & Urminsky).
   - *Cost to us:* near zero in engineering. It may lower conversion, as the "lower-bar" finding
     implies.
   - *Advantage (inference):* in a market that is being newly regulated (Reg. 45(5) prior approval),
     "we do not nudge your side or your stake" is a demonstrable property. A regulator can audit it
     with the DF-1/DF-2 tests.
4. **No attention machinery and no inducements.**
   - *Competitor (measured, July):* "Breaking News" deltas, "Hot topics 🔥", "Use code POLY50 for
     $50", and "Earn 3.25%".
   - *Evidence:* attention lists precede negative returns (Barber et al.). Gamification raises
     volume and selects low-literacy users (Chapkovski). Inducements raise wagering and loss of
     control (Challet-Bouju RCT).
   - *Local condition (binding):* in Kenya, "earn" and investment framing and calls-to-action are
     banned in ads (L.N. 114 r.6, r.9). In Uganda, skill and investment claims are banned (r.4).
     Copying the competitor pattern is not merely unethical here; much of it is unlawful here.
5. **Operator outreach as a product feature (RG-3).**
   - *Evidence:* the only intervention in this review with a durable, moderate RCT effect is
     personal contact with the heaviest losers: phone −30% theoretical loss at 12 months, d=0.44,
     >93% retained (Jonsson 2020).
   - *Why incumbents do not use it:* incumbents at global scale do not phone users. At Kichiko's
     launch scale the top 0.5% is a handful of people.
   - *Local condition (inference):* voice contact matches how M-Pesa customer care already works
     for this audience. This is the edge with the best evidence-to-cost ratio in the document.
6. **Legality as a feature.**
   - *Competitor:* Polymarket geo-blocks this region (doc 23), and the CFTC tells consumers that
     with unregistered entities "you may have little or no protections".
   - *Kichiko:* a GRA-approved prediction market with an approved resolution mechanism (Reg. 45(5)–
     (6)), linked to the national self-exclusion register, can say so on every ticket (LW-4).
   - *Honest limit:* whether the licence line raises trust or conversion among Kenyan users is
     untested (E9).

**What the edge is not.** It is not "more engagement". The consistent finding across Blake
(fees), Borsboom (charts), Chapkovski (gamification) and BIT (framing) is that honest design
**reduces** activity. The commercial case rests on licence durability, trust and retention of
the non-harmed majority. These are hypotheses with measurable proxies: 90-day retention,
complaint rate and self-exclusion rate, defined as guardrails in §4.

---

## 4. Where evidence is thin, and the experiments that would settle it

**Ethics constraint on all tests.** Every arm must be at least as protective as the current
production policy. No arm may add a pattern forbidden in §2 (for example, we never test adding
confetti). Pre-register each test in `docs/research/experiments/`, with a stopping rule on
guardrails. **Guardrails for every test:** self-exclusion rate, limit-hit rate, deposit frequency in
the top decile, and complaint rate. Stop any arm whose guardrail worsens by more than the
pre-registered margin.

Sample sizes use α=0.05 two-sided and 80% power (computed; formulas in §7 notes).

| # | Question (why thin) | Arms | Primary metric | Minimum n per arm |
|---|---|---|---|---|
| E1 | Does a frequency gloss or icon array help or hurt single-event price comprehension *and* longshot demand? (Joslyn vs Gigerenzer; Slovic's imagery effect; Galesic's "less serious") | A: `57%` · B: `57% · about 57 in 100` · C: `57%` + 10×10 array | (1) comprehension quiz ("how likely is Yes?", "what happens to your KSh if No?"), % correct; (2) share of orders at prices <15% | (1) 70%→80%: **291**. (2) 20%→17%: **2,626** (on-platform) |
| E2 | Does the FR-1 money block improve understanding of max loss and profit, and does gross vs net framing change stake? (no study of the triad) | A: FR-1 as specified · B: gross only (`If right you get KSh 100`) · C: net only (`profit KSh 43`) | Correct statement of loss-if-wrong and profit-if-right; mean log stake | 70%→80%: **291**; stake d=0.1: **1,570** |
| E3 | Does calibration disclosure (PR-5) shift longshot buying without harming comprehension? (FLB direction contested in binary markets) | A: no line · B: money-per-KSh-100 line with volatility sentence | Share of orders <15%; net loss per user over 30 days | 20%→17%: **2,626**; net loss d=0.1: **1,570** |
| E4 | Does default-on limit setup (DF-3) change 90-day net loss vs prompt-only? (Ivanova's authors asked for exactly this; untested) | A: prompt-only (the known null) · B: DF-3 default-on free text | 90-day net loss distribution, top decile | Continuous d=0.1: **1,570**; for the top-decile rate 10%→8%: **3,211** |
| E5 | Does the chart default (All vs 1W) change trading frequency on binary contracts? (Borsboom is equities, and its magnitudes are unverified) | A: All · B: 1W (both fixed 0–100) | Orders per active user per week; fees paid | d=0.1: **1,570** |
| E6 | Does sell-sheet ordering (SE-2) reduce the disposition pattern? (Frydman & Rangel is single-lab) | A: SE-2 order · B: purchase price and net first | Ratio of gains realised to losses realised (Odean's PGR/PLR) | d=0.15: **698** |
| E7 | Does a minimum market duration or no in-play reduce session intensity? (in-play evidence is cross-sectional) | A: ≥60 min · B: ≥24 h for sports | Orders per session; session length | d=0.1: **1,570** |
| E8 | Kiswahili vs English money lines: comprehension (M-Pesa localisation evidence favours English for money; untested for this block) | A: English · B: Kiswahili · C: both | Quiz % correct | 70%→80%: **291** |
| E9 | Does the licence/approval line raise trust without raising stakes? (no East African trust-signal study exists) | A: without · B: `Approved by the Gambling Regulatory Authority · Licence …` | Deposit completion; complaint rate; first-deposit size | 60%→65%: ~**1,470** |

The comprehension tests (E1-quiz, E2, E8) can run **off-platform** as unmoderated tasks with Kenyan
adults. Recruit by stratified quota on age (18–24, 25–34, 35+), gender, and Nairobi vs other
counties. Screen with PGSI-SF, and report PGSI 4+ separately. BIT's central lesson is that pooled
comprehension hides a subgroup that does not benefit.

**Other thin areas, with no experiment proposed yet:**
- Numeracy norms for Kenyan, Ugandan, Tanzanian and Rwandan adults: none were found in primary
  sources this pass.
- Whether prediction-market users have gambling-harm profiles like sports bettors: no empirical
  study found.
- Rwanda: whether Law 58/2011 has been amended or replaced since its 2012 version could not be
  confirmed.
- Kenya's s.71(2) "saving component": not yet defined by the Authority.

---

## 5. Items I could not verify

- **Borsboom et al. 2022 magnitudes** (+38pp propensity to trade, ~50% higher fees, ~18% lower
  profits). The full text was blocked everywhere (ScienceDirect captcha; ZORA, Radboud and SSRN).
  Only the abstract-level claims are used.
- **Bürgi, Deng & Whelan: bucket magnitudes** (for example "≤10¢ lose >60%, ≈−20% average").
  The ifo, econstor, UCD and SSRN copies were all bot-walled. Only the abstract is used.
- **Page & Clemen 2013** (calibration vs horizon). OUP was behind Cloudflare and the QUT eprint
  returned 500. Not used.
- **Luguri & Strahilevitz 2021 sample sizes.** OUP and Chicago Unbound were behind Cloudflare. The
  abstract is used.
- **Weiss-Cohen 2025 per-study split** (2,019 / 4,043). The abstract gives only the total N=6,062
  (which matches).
- **Joslyn & Nichols 2009 n.** Not in the abstract.
- **Not re-fetched this pass** and so not relied on: OFT/London Economics 2010, Padilla-Kay-Hullman
  2022, the CHI 2026 truncation follow-up, Delfabbro & King 2021, Ladouceur 2012, Kim 2024, Arkes &
  Blumer 1985, the EU UCPD Guidance 2021, and Kenya's excise and withholding-tax rates.
- **The variable-reward and "surprise bonus" prohibition** has no primary source in either pass.
- **Uganda:** a post-2018 amendment to the "minor" definition could not be ruled out. ULII was
  behind Cloudflare, and the regulator's own site lists only the 2016 Act, the 2018 Amendment and
  a fees amendment.

---

## 6. Summary checklist of rules

| ID | Rule | Grade |
|---|---|---|
| LW-1 | Age gate KE 18 / **UG 25** / TZ 18 / RW 18 on verified ID before deposit | BINDING |
| HM-1 / LW-3 | GRA approval ref per market; banned subjects (court, health/death of a person, security) | BINDING |
| FE-1 | All-in price first; fees itemised in KSh on the same sheet; no line appears later | STRONG + BINDING |
| FR-1 | `You pay` / `If Yes … get` / `If No … lose` in KSh, in the viewport with confirm | BINDING; behaviour untested (E2) |
| FR-2 | No payout %, return % or multiplier headlines | STRONG (RTP misleads) |
| PR-1 | Integer %, never ¢ or odds; frequency gloss only in E1 | MODERATE / CONTESTED |
| PR-2 | Question, close time and resolution source in the price block | BINDING + MODERATE |
| PR-4 | Verbal probability words only inline with a number; never in tooltips | STRONG |
| DF-1 | No pre-selected side on any viewport | STRONG |
| DF-2 | Empty stake, min KSh 20, fixed low set-chips, no Max/%-of-balance | STRONG (anchoring) + BINDING (min) |
| DF-3 | Default-on, free-text limits; decrease now, increase ≥24h + reconfirm (TZ 7 days) | MODERATE null (prompts); WEAK (efficacy); BINDING (facility) |
| RG-1 | Self-exclusion ≤2 taps, immediate, withdrawal kept, no early reversal | BINDING + MODERATE |
| RG-3 | Human outreach to top-0.5% losers | MODERATE-STRONG |
| HM-4 | Notification whitelist; promotions = ads (approval, consent, no CTA); none on loss | BINDING + WEAK-MODERATE |
| HM-5 | Loss screen is a dead end | Normative (comparative) + MODERATE |
| HM-6 | Reality check with duration and session net; acknowledge to continue | BINDING + MODERATE |
| FR-5 | No celebration when net ≤ 0, operationally defined | Normative (comparative) + WEAK |
| SE-1 / FR-4 | Sell exists but is never promoted, pre-sold or pushed | CONTESTED (precaution) |
| CH-1 / CH-2 | Fixed 0–100 axis; default `All`; no 1H or candles | STRONG (effect) / MODERATE |
| DP-3 / DP-4 | No profit leaderboards, winner feeds, streaks, confetti or hot lists | BINDING (ads, winners' confidentiality) + MODERATE |
| DP-5 | No inducements at launch (policy, not KE law) | MODERATE |
| DP-8 | No skill, investment, income or "earn" copy | BINDING (KE/UG/TZ) |
| DP-1 / DP-2 | Every number traceable; the only countdown is `closes_at` | STRONG (prevalence) |
| RG-5 | No reverse withdrawals; exit ≤ entry | Normative (comparative) + MODERATE |

---

## 7. Sources

All accessed **2026-09-27**. [FT] = full text read; [ABS] = official abstract only (with the mirror
named). "EPMC" = Europe PMC mirror of the PubMed/publisher abstract.

### Legislation and regulators
- Kenya. *The Gambling Control Act, 2025* (No. 14 of 2025), Kenya Gazette Supplement No. 141, assent 7 Aug 2025, commencement 26 Aug 2025. https://gra.go.ke/wp-content/uploads/2026/03/Gambling-Control-Act.pdf [FT] (the kenyalaw.org copy returned 403).
- Kenya. *Gambling Control (Conduct of Gambling Operations) Regulations, 2026*, **L.N. 112**, Kenya Gazette Supplement No. 163, 30 Jun 2026. https://gra.go.ke/wp-content/uploads/2026/06/L.N.-112-THE-GAMBLING-CONTROL-CONDUCT-OF-GAMBLING-OPERATIONS-REGULATIONS-2026-1.pdf [FT]
- Kenya. Unsigned **draft** of the same regulations (March 2026), cited by doc 24. https://gra.go.ke/wp-content/uploads/2026/03/18.03.26-GRA-THE-GAMBLING-CONTROL-CONDUCT-OF-GAMBLING-OPERATIONS-REGULATIONS-2026.pdf [FT]
- Kenya. *Gambling Control (Advertising) Regulations, 2026*, **L.N. 114**, made 29 Jun 2026. https://gra.go.ke/wp-content/uploads/2026/07/Advertising-Regulations.pdf [FT]
- Uganda. *Lotteries and Gaming Act, 2016* (Act 7), Acts Supplement No. 6, 8 Apr 2016. https://lgrb.go.ug/download/lotteries-and-gaming-act-2016/?wpdmdl=589 [FT]
- Uganda. *Lotteries and Gaming (Amendment) Act, 2018* (scanned; pages read as images). https://lgrb.go.ug/download/the-lotteries-and-gaming-amendment-act-2018/?wpdmdl=590 [FT]
- Uganda. *Lotteries and Gaming (Betting) Regulations, 2017*, S.I. 2017 No. 9. https://lgrb.go.ug/download/lotteries-and-gaming-betting-regulations-2017/?wpdmdl=600 [FT]
- Tanzania. *The Gaming Act, Cap. 41 R.E. 2023*. https://www.gamingboard.go.tz/uploads/documents/en-1753987035-GAMING%20ACT%20CAP%2041%20RE%202023.pdf [FT]
- Tanzania. *Gaming (Internet Gaming) Regulations, 2022*, G.N. No. 478T, 1 Jul 2022. https://www.gamingboard.go.tz/uploads/documents/en-1715420504-GN%20NO.%20478T%20THE%20GAMING%20(INTERNET%20GAMING)%20REGULATIONS,%202022.pdf [FT]
- Tanzania. *Gaming Advertising Code of Practice, 2023*. https://www.gamingboard.go.tz/uploads/documents/en-1715420223-ADVERTISING%20CODE%20OF%20PRACTICE%20FOR%20WEBSITE.pdf [FT]
- Rwanda. *Law No. 58/2011 governing gaming activities* (O.G. No. 13, 26 Mar 2012), RwandaLII. https://rwandalii.org/akn/rw/act/law/2011/58/eng@2012-03-26 [FT, via Chromium]
- UK Gambling Commission. Press release, 2 Feb 2021, "package of changes which make online games safer by design". https://www.gamblingcommission.gov.uk/news/article/gambling-commission-announces-package-of-changes-which-make-online-games [FT]
- UKGC. Remote gambling and software technical standards, **RTS 3, 12, 13, 14** (last updated 31 Oct 2025). https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards/rts-12-financial-limits (and the `rts-3-…`, `rts-13-…`, `rts-14-…` pages) [FT]
- ESMA. Decision (EU) 2018/795 of 22 May 2018 (binary options), OJ L 136/31. https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32018X0601(01) [FT]
- EU. Regulation (EU) 2022/2065 (Digital Services Act), Art. 25 and recital 67. https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065 [FT]
- US FTC. *Bringing Dark Patterns to Light*, staff report, Sept 2022. https://www.ftc.gov/system/files/ftc_gov/pdf/P214800%20Dark%20Patterns%20Report%209.14.2022%20-%20FINAL.pdf [FT]
- US CFTC. *Understanding Prediction Markets and Event Contracts*. https://www.cftc.gov/LearnandProtect/PredictionMarkets [FT]
- US CFTC. Staff Letter No. 26-08, *Prediction Markets Advisory*, 12 Mar 2026. https://www.cftc.gov/csl/26-08/download [FT]
- W3C. WCAG 2.2 SC 3.3.4, from the W3C source repository: https://raw.githubusercontent.com/w3c/wcag/main/guidelines/sc/20/error-prevention-legal-financial-data.html [FT] (w3.org was behind Cloudflare)

### Gambling information, framing and responsible-gambling tools
- Behavioural Insights Team (2022). *Comprehension of gambling odds*. https://www.bi.team/wp-content/uploads/2022/05/2022-05-Comprehension-of-gambling-odds-BIT-experimental-results.pdf [FT]
- Weiss-Cohen, Palmer, Torrance & Newall (2025). *Addictive Behaviors*. doi:10.1016/j.addbeh.2025.108363 [ABS, EPMC]
- Newall, Byrne, Russell & Rockloff (2022). *Addictive Behaviors* 130:107308. doi:10.1016/j.addbeh.2022.107308 [ABS, EPMC]; preprint https://osf.io/c46jt [FT]
- Newall, Walasek & Ludvig (2020). *Addiction* 115(9). doi:10.1111/add.14954 [ABS, EPMC]
- Newall, Weiss-Cohen, Singmann, Boyce, Walasek & Rockloff (2022). Speed-of-play limit. *Addictive Behaviors*. doi:10.1016/j.addbeh.2021.107229 [ABS, EPMC]
- Ivanova, Magnusson & Carlbring (2019). *Frontiers in Psychology* 10:639. doi:10.3389/fpsyg.2019.00639 [FT]
- Auer, Hopfgartner & Griffiths (2020). *Cyberpsychology, Behavior, and Social Networking*. doi:10.1089/cyber.2019.0202 [ABS, EPMC]
- Auer, Hopfgartner & Griffiths (2018). *J Behav Addict*. doi:10.1556/2006.7.2018.106 [ABS, EPMC]
- Heirene & Gainsbury (2021). *Addiction*. doi:10.1111/add.15471 [ABS, EPMC]
- Tørdal, Leino & Pallesen (2026). *J Gambl Stud*. doi:10.1007/s10899-025-10446-3 [ABS, EPMC]
- Bjørseth et al. (2021). *Frontiers in Psychiatry*. doi:10.3389/fpsyt.2020.601800 [ABS, EPMC]
- Jonsson, Hodgins, Munck & Carlbring (2019). *Psychol Addict Behav*. doi:10.1037/adb0000447; (2020) *Addiction* doi:10.1111/add.14982 [ABS, EPMC]
- Smith, Free, Ginley, Whelan & Pfund (2025). *J Gambl Stud*. doi:10.1007/s10899-025-10444-5 [ABS, EPMC]
- Hopfgartner et al. (2022). *J Gambl Stud*. doi:10.1007/s10899-021-10078-3; (2023) *IJMHA* doi:10.1007/s11469-022-00996-7; (2023) *J Gambl Stud* doi:10.1007/s10899-023-10198-y [ABS, EPMC]
- Motka et al. (2018). *J Behav Addict*. doi:10.1556/2006.7.2018.96 [ABS, EPMC]
- Gainsbury (2014). *J Gambl Stud*. doi:10.1007/s10899-013-9362-0 [ABS, EPMC]
- Clark, Lawrence, Astley-Jones & Gray (2009). *Neuron*. doi:10.1016/j.neuron.2008.12.031 [ABS, EPMC]
- Graydon, Dixon, Stange & Fugelsang (2018). *Addiction*. doi:10.1111/add.14406 [ABS, Crossref]
- Myles, Bennett & Newall (2026). *Behavioural Public Policy*. doi:10.1017/bpp.2026.10035 [ABS, Crossref]
- Zhang, Rights, Deng, Lesch & Clark (2024). *Scientific Reports*. doi:10.1038/s41598-024-70738-3 [ABS, EPMC]
- Edson, Louderback, Tom & LaPlante (2025). *J Gambl Stud*. doi:10.1007/s10899-025-10391-1 [ABS, EPMC]
- Bennett et al. (2024). *Psychological Science*. doi:10.1177/09567976241266516 [ABS, EPMC]
- Hayes, Bennett, Albertella, Walasek & Ludvig (2026). PsyArXiv preprint. doi:10.31234/osf.io/2z3eu_v5 [ABS]
- Szaszi et al. (2026). Registered Report, PsyArXiv. doi:10.31234/osf.io/rkb7a_v1 [ABS]
- Ngieng et al. (2026). *Addictive Behaviors Reports*. doi:10.1016/j.abrep.2025.100645 [ABS, EPMC]
- Sinclair, Clark, Wohl, Keough & Kim (2024). *Addictive Behaviors*. doi:10.1016/j.addbeh.2024.108008 [ABS, EPMC]
- Russell, Hing, Browne & Rawat (2018). *J Behav Addict*. doi:10.1556/2006.7.2018.99 [ABS, EPMC]
- Hing, Russell, Li & Vitartas (2018). *J Behav Addict*. doi:10.1556/2006.7.2018.17 [ABS, EPMC]
- Balem et al. (2022). *Addiction*. doi:10.1111/add.15665 [ABS, EPMC]
- Challet-Bouju et al. (2020). *Frontiers in Psychiatry*. doi:10.3389/fpsyt.2020.593789 [ABS, EPMC]
- Vieira et al. (2023). *J Behav Addict*. doi:10.1556/2006.2023.00030 [ABS, EPMC]
- Harris & Griffiths (2018). *J Gambl Stud*. doi:10.1007/s10899-017-9701-7 [ABS, EPMC]
- Barasa (2026). *J Gambl Stud*. doi:10.1007/s10899-025-10445-4 [ABS, EPMC]
- Anyanwu et al. (2023). *J Gambl Stud*. doi:10.1007/s10899-023-10205-2 [ABS, EPMC]
- Kaggwa et al. (2022). *BMC Public Health*. doi:10.1186/s12889-021-12306-2 [ABS, EPMC]
- Bitanihirwe et al. (2022). *Current Addiction Reports*. doi:10.1007/s40429-022-00449-0 (identified via EPMC; used only to correct the doc 24 attribution)
- Packin & Rabinovitz (2026). *Science*. doi:10.1126/science.aee3932 [ABS, EPMC]; Johnson & Chan (2026). *Addiction*. doi:10.1111/add.70272 (no abstract)

### Probability, numeracy and markets
- McDowell & Jacobs (2017). *Psychological Bulletin* 143(12). doi:10.1037/bul0000126 [ABS, EPMC]
- Galesic, Gigerenzer & Straubinger (2009). *Medical Decision Making*. doi:10.1177/0272989x08329463 [ABS, EPMC]
- Galesic, Garcia-Retamero & Gigerenzer (2009). *Health Psychology*. doi:10.1037/a0014474 [ABS, EPMC]
- Garcia-Retamero, Galesic & Gigerenzer (2010). *Medical Decision Making*. doi:10.1177/0272989x10369000 [ABS, EPMC]
- Garcia-Retamero & Cokely (2017). *Human Factors*. doi:10.1177/0018720817690634 [ABS, EPMC]
- Zikmund-Fisher et al. (2014). *Medical Decision Making*. doi:10.1177/0272989x13511706 [ABS, EPMC]
- Gigerenzer et al. (2005). *Risk Analysis*. doi:10.1111/j.1539-6924.2005.00608.x [ABS, EPMC]
- Joslyn & Nichols (2009). *Meteorological Applications* 16(3):309–314. doi:10.1002/met.121 [ABS, Crossref]
- Slovic, Monahan & MacGregor (2000). *Law and Human Behavior*. doi:10.1023/a:1005595519944 [ABS, EPMC]
- Denes-Raj & Epstein (1994). *JPSP*. doi:10.1037//0022-3514.66.5.819 [ABS, EPMC]
- Peters et al. (2006). *Psychological Science*. doi:10.1111/j.1467-9280.2006.01720.x [ABS, EPMC]
- Budescu, Broomell & Por (2009). *Psychological Science*. doi:10.1111/j.1467-9280.2009.02284.x [ABS, EPMC]
- Budescu, Por, Broomell & Smithson (2014). *Nature Climate Change* 4:508. doi:10.1038/nclimate2194 [ABS, nature.com]
- Wintle et al. (2019). *PLOS ONE*. doi:10.1371/journal.pone.0213522 [ABS, EPMC]
- Tversky & Kahneman (1981). *Science* 211:453. PDF https://sites.stat.columbia.edu/gelman/surveys.course/TverskyKahneman1981.pdf [FT]
- Wolfers & Zitzewitz (2006). NBER w12200. https://www.nber.org/papers/w12200 [ABS]
- Snowberg & Wolfers (2010). NBER w15923 / *JPE* 118(4). https://www.nber.org/papers/w15923 [ABS]
- Bürgi, Deng & Whelan (2026). *Makers and Takers: The Economics of the Kalshi Prediction Market*. CESifo WP 12122. doi:10.65864/s9kc4p0b7t [ABS, Crossref]
- Newall & Cortis (2021). *Risks* 9(1):22. doi:10.3390/risks9010022 [ABS, Crossref]
- Newall (2015). *Judgment and Decision Making* 10(3). doi:10.1017/s1930297500004630 [ABS, Crossref]

### Defaults, fees and dark patterns
- Jachimowicz, Duncan, Weber & Johnson (2019). *Behavioural Public Policy* 3(2). doi:10.1017/bpp.2018.43 [ABS, Crossref]
- Lanier, Wang & Xie (2025). *Scientific Reports*. doi:10.1038/s41598-025-19051-1 [ABS, EPMC]
- Goswami & Urminsky (2016). *J Marketing Research* 53(5). doi:10.1509/jmr.15.0001 [ABS, Crossref]
- Haggag & Paci (2014). *AEJ: Applied* 6(3). doi:10.1257/app.6.3.1 [ABS, Crossref]
- Blake, Moshary, Sweeney & Tadelis (2021). *Marketing Science* 40(4). doi:10.1287/mksc.2020.1261 [ABS, Crossref + NBER w25186]
- Rasch, Thöne & Wenzel (2020). *JEBO* 176. doi:10.1016/j.jebo.2020.04.007 [ABS, RePEc]
- Santana, Dallas & Morwitz (2020). *Marketing Science* 39(1). doi:10.1287/mksc.2019.1207 [ABS, RePEc]
- Mathur et al. (2019). *PACM HCI* 3(CSCW):81. doi:10.1145/3359183; https://arxiv.org/pdf/1907.07032 [FT]
- Luguri & Strahilevitz (2021). *J Legal Analysis* 13(1):43. doi:10.1093/jla/laaa006 [ABS, Crossref]
- Chapkovski, Khapko & Zoican (2026). *Management Science* 72(1). doi:10.1287/mnsc.2022.02650 [ABS, Crossref]
- Kirchler, Lindner & Weitzel (2018). *Journal of Finance* 73(5). doi:10.1111/jofi.12701 [ABS, Crossref]
- Barber, Huang, Odean & Schwarz (2022). *Journal of Finance* 77(6). doi:10.1111/jofi.13183 [ABS, Crossref]
- Kalda, Loos, Previtero & Hackethal (2021). NBER w28363 / SSRN 3765652 [ABS, Crossref]
- Odean (1998). *Journal of Finance* 53(5); SSRN doi:10.2139/ssrn.94142 [ABS, Crossref]
- Frydman & Rangel (2014). *JEBO* 107. doi:10.1016/j.jebo.2014.01.017 [ABS, RePEc]

### Charts and uncertainty
- Correll, Bertini & Franconeri (2020). CHI. doi:10.1145/3313831.3376222; https://arxiv.org/pdf/1907.02035v2 [FT]
- Yang, Vargas Restrepo, Stanley & Marsh (2021). *JARMAC* 10(2). doi:10.1016/j.jarmac.2020.10.002 [ABS, Semantic Scholar mirror]
- Witt (2019). *Meta-Psychology* 3. doi:10.15626/mp.2018.895 [FT]
- Borsboom, Janssen, Strucks & Zeisberger (2022). *J Banking & Finance* 134:106351. doi:10.1016/j.jbankfin.2021.106351 [ABS, RePEc]
- Kay, Kola, Hullman & Munson (2016). CHI. doi:10.1145/2858036.2858558; https://users.eecs.northwestern.edu/~jhullman/busUncertaintyVis.pdf [FT]
- Fernandes, Walls, Munson, Hullman & Kay (2018). CHI. https://www.mjskay.com/papers/chi2018-uncertain-bus-decisions.pdf [FT]

### Internal (measured competitor facts)
- `docs/research/ui-2026-09/23-COMPETITOR-CAPTURE.md` (Sept 2026 capture, Polymarket M1; Kalshi not measured)
- `docs/research/ui-2026-09/21-CORPUS-CATALOGUE.md` (July corpus; Polymarket ticket, chips, promo rail, chart defaults)

**Sample-size notes.** Two proportions: n = (z₀.₉₇₅+z₀.₈)²·[p₁(1−p₁)+p₂(1−p₂)]/(p₁−p₂)².
Continuous: n = 2(z₀.₉₇₅+z₀.₈)²/d². Computed values: 70→80% = 291; 60→65% ≈ 1,470; 20→17% = 2,626;
10→8% = 3,211; d=0.1 → 1,570; d=0.15 → 698; d=0.2 → 393 (per arm).
