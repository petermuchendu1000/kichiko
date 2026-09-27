# 04 — Behavioural Science for the Kichiko UI

**Scope.** What the behavioural-science, risk-communication, HCI and responsible-gambling literatures
actually establish about presenting a real-money binary prediction market on a mid-range Android
phone, to first-time users in Kenya, Uganda, Tanzania, Rwanda and Zambia paying by mobile money.

**Compiled:** 2026-09-27. Every source below was retrieved or its metadata confirmed on that day.

**Labels.**
- **Evidence: STRONG** — replicated experiments, RCTs, meta-analyses or a standards body's normative text.
- **Evidence: MODERATE** — one or two good experiments, or a well-conducted single large trial.
- **Evidence: WEAK / CONTESTED** — single study, practitioner research, non-peer-reviewed, or the
  literature disagrees. Flagged explicitly.
- **INFERENCE** — my reasoning or my transfer of a finding to Kichiko. Not a claim the source makes.
- **[PP]** — preprint / not peer reviewed. **[GREY]** — grey literature or practitioner research.

**Every rule is written to be testable**: a design rule plus the outcome measure that would falsify it.

---

## 0. What the repo already establishes (do not duplicate)

### `docs/research/brain-2026-09/02-ACADEMIC-LITERATURE.md`
This is a **market-design and microstructure** document, not a UI document. It establishes:
- AMM/LMSR design, liquidity-sensitive market making, subsidy budgeting, complete-set and negRisk
  conversions, price-time vs pro-rata priority, tick size, maker-taker fees, batch auctions for thin
  markets, order-book data structures, wash-trade and manipulation surveillance.
- **The one behaviourally relevant section is C.7 (favourite–longshot bias).** It already establishes:
  Snowberg & Wolfers (2010) — misperceptions of probability drive FLB, consistent with prospect
  theory; Page & Clemen (2013) — prediction markets are well calibrated near expiry and biased for
  distant events; Bürgi et al. on Kalshi — contracts priced ≤10¢ lose **more than 60%** on average,
  average return ≈ −20%; Le (2026)[PP] — prices compress toward 50% in political markets. It already
  draws the inference that **retail users disproportionately buy cheap longshots** and that Kichiko
  should consider "consumer-protection disclosures showing the historical realised return by price
  bucket."
- It contains **no** risk-communication, framing, dark-pattern, chart-cognition, trust or
  cognitive-load literature. Everything in §1–§7 below is new.
- Its own stated gaps: no field evidence on hybrid designs in thin retail settings; much of the
  2025–26 literature is preprints; **nothing from a mobile-money or African retail setting.**

### `docs/research/EAST-AFRICA-KENYA-MARKET-RESEARCH.md`
Establishes the market and copy context. Already settled, and not re-argued here:
- **Comprehension is the whole battle**; the prediction-market mental model does not exist locally.
- **Plain English for anything transactional** (M-Pesa localisation study: 83% preferred the English
  menu, 65% never used Kiswahili); Swahili/Sheng for warmth only.
- **Scam-primed audience**; the exact regulator red flags are "guaranteed/high/fixed returns",
  "earn daily", referral pressure, upfront fees, withdrawal problems, no verifiable contact.
- **"Predict & Earn" must die**; full lexicon audit (clarity / confusion / friction / obstruction)
  already exists in §10, including verdicts on *bet*, *trade*, *contract*, *odds*, *resolve*, *$*.
- **KES everywhere, never USD**; M-Pesa is the rail (~88%); **STK Push**, **Hakikisha** name
  verification, Paybill/Till, reversal expectations are the trust benchmark.
- **Fee/tax transparency**: 5% deposit excise + 5% withdrawal WHT must be surfaced before deposit.
- **Income**: working-youth ≈ KES 5,616/month; typical betting spend < $10/month → "from KSh 20".
- **Regulation**: Gambling Control Act 2025; 2025 advertising ban and BCLB ad rules; no
  call-to-action, no glamorising, no testimonials, mandatory 18+/addiction/licence disclosures.
- **Restraint as strategy**; WCAG AA+ contrast and bright-sun legibility already a stated gate.
- Open blocker: legal classification under the Gambling Control Act 2025.

**Therefore this document adds:** the primary literature on probability *format*, framing and loss
display, friction/confirmation/cooling-off, trust mechanics with citable evidence, chart and numeric
cognition, the dark-pattern catalogue with the 2026 Kenyan regulations that bind it, and mobile
cognitive-load and reach constraints.

---

## 1. Probability presentation

### 1.1 Natural frequencies beat conditional probabilities for Bayesian reasoning
**Claim.** Presenting statistical information as natural frequencies ("10 out of every 1,000")
rather than probabilities or percentages substantially raises the proportion of people who reason
correctly — including older adults and people with low numeracy.

**Sources.**
- Gigerenzer, G., Gaissmaier, W., Kurz-Milcke, E., Schwartz, L. M., & Woloshin, S. (2007).
  *Helping Doctors and Patients Make Sense of Health Statistics.* Psychological Science in the
  Public Interest 8(2):53–96. https://journals.sagepub.com/doi/10.1111/j.1539-6053.2008.00033.x
- Galesic, M., Gigerenzer, G., & Straubinger, N. (2009). *Natural Frequencies Help Older Adults and
  People with Low Numeracy to Evaluate Medical Screening Tests.* Medical Decision Making 29(3).
  https://doi.org/10.1177/0272989x08329463
- Hoffrage, U., Gigerenzer, G., Krauss, S., & Martignon, L. (2002). *Representation facilitates
  reasoning: what natural frequencies are and what they are not.* Cognition 84(3):343–352.
  https://www.sciencedirect.com/science/article/abs/pii/S0010027702000501
- Kim, S. (2024). *Natural Frequencies Improve Public Understanding of Medical Test Results.*
  Medical Decision Making. https://doi.org/10.1177/0272989x241275191
- Garcia-Retamero, R., & Cokely, E. T. (2017). *Designing Visual Aids That Promote Risk Literacy:
  A Systematic Review of Health Research and Evidence-Based Design Heuristics.* Human Factors 59(4).
  https://journals.sagepub.com/doi/abs/10.1177/0018720817690634
- Garcia-Retamero, R., Galesic, M., & Gigerenzer, G. (2010). *Do Icon Arrays Help Reduce Denominator
  Neglect?* Medical Decision Making 30(6). https://doi.org/10.1177/0272989x10369000

**Evidence: STRONG.** Replicated across decades, populations and task types; a 2024 replication and a
2017 systematic review both hold. **Caveat:** the effect is established for *Bayesian inference*
tasks (combining a base rate with a test result). A prediction-market price is a *single-event*
probability with no base-rate combination, so the transfer is an INFERENCE, supported by the
uncertainty-visualisation review in §5.1 which independently recommends frequency framing for
single-event risk.

**Design rule R1.** Present every market price in **two co-located forms**: the percentage *and* a
frequency gloss on the same line — `57%  ·  about 57 times in 100`. Never the percentage alone on a
first-run surface.
**Testable as:** in a comprehension task ("out of 100 markets priced like this, how many happen?"),
the dual format beats percentage-only by ≥10 percentage points correct.

### 1.2 Single-event probabilities are systematically misread, and the reference class is the failure point
**Claim.** People asked what "a 30% chance of rain tomorrow" means do not converge on one meaning;
they disagree about the *reference class* (30% of the area, 30% of the time, 30% of days like
tomorrow). The original multi-country study found widespread non-normative readings; a later
reassessment found the public does rather better than first claimed, so the size of the problem is
contested — but the *reference-class ambiguity* is not.

**Sources.**
- Gigerenzer, G., Hertwig, R., van den Broek, E., Fasolo, B., & Katsikopoulos, K. V. (2005).
  *"A 30% Chance of Rain Tomorrow": How Does the Public Understand Probabilistic Weather Forecasts?*
  Risk Analysis 25(3):623–629.
  https://www.academia.edu/24287640/_A_30_Chance_of_Rain_Tomorrow_How_Does_the_Public_Understand_Probabilistic_Weather_Forecasts
- Fleischhut, N., Herzog, S. M., & Hertwig, R. (2020). *Weather forecasts, warnings, and warning
  behaviour* / and the reassessment literature: *Not as gloomy as we thought: reassessing how the
  public understands probability of precipitation forecasts.* Author manuscript, Essex repository.
  https://repository.essex.ac.uk/23541/1/Not%20as%20gloomy%20as%20we%20thought_Probability%20of%20precipitation_manuscript.pdf
- US National Weather Service, *Precipitation Probability* explainer (standards-body style guidance
  that the reference class must be stated). https://www.weather.gov/media/pah/WeatherEducation/pop.pdf

**Evidence: MODERATE and explicitly CONTESTED.** The 2005 paper and the reassessment disagree on how
bad lay comprehension is. Both agree the statement is incomplete without a reference class.

**Design rule R2.** Every probability must carry its **reference class and its resolution event in
the same visual block**: not `Rain: 57%` but `Will it rain in Nairobi on Sat 3 Oct? — Yes 57%`,
with the resolution source named. Never show a bare number next to a bare noun.
**Testable as:** users can correctly restate, in their own words, what event the number refers to
≥90% of the time.

### 1.3 Verbal probability words are worse than numbers, and translations vary wildly
**Claim.** Verbal quantifiers ("likely", "probable", "good chance") are interpreted across enormous
ranges, and adding a numeric range narrows the spread. Budescu et al. found that even when the IPCC
supplied a numeric key, readers' interpretations regressed toward 50% and remained inconsistent; the
effect replicated in a 24-country, 17-language study.

**Sources.**
- Budescu, D. V., Broomell, S., & Por, H.-H. (2009). *Improving Communication of Uncertainty in the
  Reports of the Intergovernmental Panel on Climate Change.* Psychological Science 20(3):299–308.
  https://journals.sagepub.com/doi/10.1111/j.1467-9280.2009.02284.x
- Budescu, D. V., Por, H.-H., Broomell, S. B., & Smithson, M. (2014). *The interpretation of IPCC
  probabilistic statements around the world.* Nature Climate Change 4:508–512.
  https://www.nature.com/articles/nclimate2194
- Wintle, B. C., Fraser, H., Wills, B. C., Nicholson, A. E., & Fidler, F. (2019). *Verbal
  probabilities: Very likely to be somewhat more confusing than numbers.* PLOS ONE 14(4):e0213522.
  https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0213522

**Evidence: STRONG.** Cross-cultural, multi-language, replicated.

**Design rule R3.** Never use a word alone where a number is available. If a verbal label is used for
warmth ("very likely"), it must be **bound to the number** and to a fixed published band, and the
band must be visible on tap. Because our audience spans five countries and at least three working
languages, **numbers are the interoperable channel; words are decoration.**
**Testable as:** removing verbal labels does not reduce comprehension; removing numbers does.

### 1.4 Percentage "payout" formats inflate perceived chance of winning; loss framing in money units is better understood
**Claim.** This is the single most transferable experimental result for Kichiko. In a 5,311-person UK
randomised experiment, five ways of stating the same house economics were compared. Presenting the
information as a **simplified money loss with volatility** ("Players lose £7 for every £100 bet on
average") beat return-to-player percentage on comprehension — **52% vs 27%** correct on the key
ratio item — and reduced stated willingness to play by about **9 percentage points** (68% vs 75%).
The "discreet RTP" presentation (small font, low prominence) actually *reduced* comprehension.
Separately, two studies (n=2,019 and n=4,043) found that a typical RTP message ("average percentage
payout of 90%") **significantly increased** perceived chances of winning relative to no information
at all, while house-edge "cost" framing did not.

**Sources.**
- Behavioural Insights Team (2022). *Comprehension of gambling odds: BIT experimental results.*
  https://www.bi.team/wp-content/uploads/2022/05/2022-05-Comprehension-of-gambling-odds-BIT-experimental-results.pdf
  **[GREY]** but a large pre-registered randomised experiment.
- Weiss-Cohen, L., Newall, P. W. S., et al. (2025). *Never tell me the odds: Typical
  return-to-player information increases gamblers' perceived chances of winning.* Addictive
  Behaviors. https://www.sciencedirect.com/science/article/pii/S0306460325001248 ·
  PubMed https://pubmed.ncbi.nlm.nih.gov/40286385/ · research snapshot
  https://www.greo.ca/Modules/EvidenceCentre/files/Weiss-Cohen%20et%20al%20(2025)_Research%20Snapshot_Typical%20return-to-player%20information%20increases%20gamblers%20perceived_final.pdf
- Newall, P. W. S., Walasek, L., Ludvig, E. A., & Rockloff, M. J. (2022). *House-edge information and
  a volatility warning lead to reduced gambling expenditure.* Addictive Behaviors 130:107308.
  https://www.sciencedirect.com/science/article/abs/pii/S0306460322000740
- Newall, P. W. S., Walasek, L., & Ludvig, E. A. (2020). *Equivalent gambling warning labels are
  perceived differently.* Addiction 115(9). https://onlinelibrary.wiley.com/doi/full/10.1111/add.14954
- Walasek, L., Newall, P. W. S., & Ludvig, E. A. (2023). *How does the phrasing of house edge
  information affect gamblers' perceptions and level of understanding? A Registered Report.*
  Addiction Research & Theory. https://www.tandfonline.com/doi/full/10.1080/16066359.2023.2195171

**Evidence: STRONG for comprehension; MODERATE for behaviour.** Multiple large randomised
experiments, one registered report, one incentivised behavioural study (n=2,433) that found real
behavioural change but with the authors' own explicit warning that the **effect sizes were small**
and "a public health approach to gambling should not rely on informational provisions only."

**Design rule R4.** Never state Kichiko's economics as a payout percentage. State them as **money
lost per KSh 100 staked, on average**, plus a volatility sentence. Concretely, the fee and the
favourite–longshot warning should read like `On average, people who buy at prices under KSh 10 get
back about KSh 4 of every KSh 10 they put in` — money units, loss direction, no percentage headline.
**Testable as:** A/B the money-loss framing against a percentage framing on a four-item
comprehension quiz; expect ≥15pp improvement on the ratio item, and expect stake sizes to fall.

### 1.5 The cents/price display is the most dangerous format for a novice
**Claim.** INFERENCE, grounded in 1.4 and in the repo's own §10 lexicon audit. Polymarket/Kalshi
display a probability as a *price* (57¢). For this audience that is a triple hazard: it is a foreign
currency unit; it reads as a *cost* rather than a *chance*; and it invites the RTP-style misread
documented in 1.4 (a bigger number looks better). The repo already flags `$`/USD as
"friction+distrust" and "contract/share/position" as pure jargon.

**Design rule R5.** Price is displayed as a **probability with a frequency gloss** (R1), and the
money the user will actually pay is a **separate, explicitly labelled line** (`You pay KSh 57` /
`If right you get KSh 100`). Never let one number do both jobs.
**Testable as:** ask users "how much will leave your M-Pesa?" and "how likely is Yes?" — both must be
answered correctly ≥90% of the time from the purchase screen alone.

---

## 2. Framing and loss aversion on a binary YES/NO purchase

### 2.1 Prospect theory: the same choice framed as gain or loss flips preferences
**Claim.** Outcomes are evaluated as changes from a reference point, losses loom larger than
equivalent gains, and the framing of an identical prospect as a gain or a loss reverses majority
preference. This is the foundational result and it is not seriously disputed.

**Sources.**
- Kahneman, D., & Tversky, A. (1979). *Prospect Theory: An Analysis of Decision under Risk.*
  Econometrica 47(2):263–291.
- Tversky, A., & Kahneman (1981). *The Framing of Decisions and the Psychology of Choice.*
  Science 211(4481):453–458. https://www.science.org/doi/10.1126/science.7455683 ·
  PDF https://sites.stat.columbia.edu/gelman/surveys.course/TverskyKahneman1981.pdf
- Kahneman, D., & Tversky, A. (1984). *Choices, Values, and Frames.* American Psychologist 39(4).
  https://www.psy.miami.edu/_assets/pdf/rpo-articles/kahneman-and-tversky-1984.pdf
- Tversky, A., & Kahneman, D. (1992). *Advances in Prospect Theory: Cumulative Representation of
  Uncertainty.* Journal of Risk and Uncertainty 5:297–323. (Probability weighting: small
  probabilities are overweighted — the mechanism behind the favourite–longshot bias the repo
  documents in C.7.)

**Evidence: STRONG.** Nobel-recognised, replicated; the *parameters* of the weighting function are
debated but the qualitative pattern is not.

**Design rule R6.** Because framing flips preference, Kichiko must **hold the frame constant and
symmetric** rather than pick the flattering one. YES and NO must be rendered with identical visual
weight, identical wording structure, and identical disclosure. Any asymmetry (bigger button, warmer
colour, "popular" badge on one side) is a thumb on the scale.
**Testable as:** swap the left/right and colour assignment of YES/NO between cohorts; the split of
choices should not move more than a few points. If it moves a lot, the UI is framing, not informing.

### 2.2 Maximum loss must be shown as a concrete amount, at the point of commitment
**Claim.** Concretely quantified worst-case amounts change behaviour where percentages do not
(§1.4). The Kenyan 2026 regulations independently make the same demand in normative form, and WCAG
2.2 requires that financial submissions be reversible, checked or confirmed.

**Sources.**
- Newall et al. (2022), as §1.4 — money-unit loss framing reduced expenditure.
- BIT (2022), as §1.4 — loss-volatility framing raised comprehension from 27% to 52% on the key item.
- Gambling Regulatory Authority of Kenya, *The Gambling Control (Conduct of Gambling Operations)
  Regulations, 2026*, **Reg. 45**: "Game rules are clearly displayed on the approved platform or
  system **before** a player or punter places any wager or bet"; **Reg. 20**: operators must "display
  clearly rules of games, odds, house edge and average return to the player"; **Reg. 23**: "clearly
  display betting odds, rules and terms applicable to each bet."
  https://gra.go.ke/wp-content/uploads/2026/03/18.03.26-GRA-THE-GAMBLING-CONTROL-CONDUCT-OF-GAMBLING-OPERATIONS-REGULATIONS-2026.pdf
- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*, SC **3.3.4 Error Prevention (Legal,
  Financial, Data)** — Level AA: for submissions with legal or financial consequences, at least one
  of reversible / checked / confirmed must apply. https://www.w3.org/TR/WCAG22/

**Evidence: STRONG** (regulation and standard are normative; the behavioural half is MODERATE with
small effect sizes).

**Design rule R7.** On the buy sheet, **before** the confirm action, show three lines in fixed order,
in KSh, at body-text size or larger: `You pay KSh X` · `Most you can lose: KSh X` · `If right you get
KSh Y`. "Most you can lose" is never collapsed, never in a tooltip, never smaller than the payout
line. Note the regulation says *before* — so a post-hoc receipt does not satisfy it.
**Testable as:** eye-tracking or a forced-recall probe immediately after purchase; ≥90% of users can
state their maximum loss in KSh.

### 2.3 Fee and tax transparency: drip pricing measurably harms consumers
**Claim.** Revealing mandatory charges progressively through a flow ("drip pricing") raises what
consumers pay and reduces search quality, relative to showing the all-in price up front. This is one
of the best-evidenced consumer-protection findings, and it is why the UK regulated the practice.

**Sources.**
- Office of Fair Trading (2010). *Advertising of Prices* market study, with the accompanying
  behavioural experiment by London Economics.
  https://londoneconomics.co.uk/blog/publication/partitioned-pricing-research-behavioural-experiment/
- Rasch, A., Thöne, M., & Wenzel, T. (2020). *Drip pricing and its regulation: Experimental
  evidence.* Journal of Economic Behavior & Organization 176:353–370.
  https://www.sciencedirect.com/science/article/abs/pii/S0167268120301189
- Santana, S., Dallas, S., & Morwitz, V. (2020). *Consumer Reactions to Drip Pricing.* Marketing
  Science 39(1). https://doi.org/10.1287/mksc.2019.1207
- UCL impact case study on the regulation that followed.
  https://www.ucl.ac.uk/impact/case-studies/2014/dec/applied-research-leading-regulation-drip-pricing
- CGAP, *Making Disclosure Work for Low-Income Financial Consumers* **[GREY]** — argues a
  take-away "Key Facts" statement and a **total cost** figure beat percentage rates, because "most
  people – lower-income or not – are confused by percentages", and recommends pre-testing formats
  with the actual segment. https://www.cgap.org/blog/making-disclosure-work-for-low-income-financial-consumers

**Evidence: STRONG for drip pricing. WEAK/GREY for the CGAP disclosure-format specifics** (a
practitioner argument, not an experiment).

**Design rule R8.** The **all-in number is the headline number**. The deposit screen states the net
amount that will reach the balance after the excise duty, and the withdrawal screen states the net
amount that will reach M-Pesa after withholding — as a KSh total, not a percentage, before the user
commits. No fee is revealed after a confirm step.
**Testable as:** "how much of your KSh 500 will you be able to bet with?" answered correctly ≥90% on
the deposit screen; abandonment at the confirm step should not rise (the repo's position that honesty
converts for this audience is testable, not assumed).

### 2.4 Mobile money reduces the "pain of paying" — a hazard, not a feature
**Claim.** More transparent, more tangible payment forms produce a larger immediate disutility of
paying and reduce spending; frictionless digital payments reduce it and increase spending. The
mechanism is well theorised and there is field and experimental support, but the mobile-money-specific
work is mostly correlational.

**Sources.**
- Prelec, D., & Loewenstein, G. (1998). *The Red and the Black: Mental Accounting of Savings and
  Debt.* Marketing Science 17(1):4–28. (Origin of the pain-of-paying / payment-decoupling account.)
- Soman, D. (2003). *The Effect of Payment Transparency on Consumption: Quasi-Experiments from the
  Field.* Marketing Letters 14:173–183.
  https://www.researchgate.net/publication/226485295_The_Effect_of_Payment_Transparency_on_Consumption_Quasi-Experiments_from_the_Field
- Ma, et al. (2024). *Why does mobile payment promote purchases? Revisiting the pain of paying…*
  PsyCh Journal. https://onlinelibrary.wiley.com/doi/full/10.1002/pchj.765
- Lia, D. A. Z., & Natswa, S. L. (2022) and related: *Financial Vulnerability, Financial Literacy,
  and the Use of Digital Payment Technologies.* Journal of Consumer Policy.
  https://link.springer.com/article/10.1007/s10603-022-09512-9
- Context, journalism **[GREY]**: MIT Technology Review, *How mobile money supercharged Kenya's
  sports betting addiction* (2022).
  https://www.technologyreview.com/2022/04/14/1049239/kenya-sports-betting-mobile-money/

**Evidence: MODERATE for the general effect; WEAK for the mobile-money-in-Kenya specifics** (the
strongest statement of that link I found is journalism, and the academic mobile-payment work is
largely cross-sectional and from other markets). Flagged as thin.

**Design rule R9.** Because the M-Pesa STK-push rail is *designed* to be frictionless, Kichiko must
supply the tangibility the rail removes: **every amount in KSh, never in points, credits, chips,
"units" or a token**; a running session-spend figure the user can see; and the balance shown in the
same units as the M-Pesa message. No abstraction layer between money and money.
**Testable as:** users can state their cumulative spend for the session within ±KSh 50.

---

## 3. Decision friction, confirmation, undo and cooling-off

### 3.1 What responsible-gambling research finds *does not* work: prompts and voluntary limits alone
**Claim.** The best available RCT of a deposit-limit prompt found **no effect on gambling intensity**.
Among 4,328 newly registered Finnish online slot players randomised to receive a limit-setting prompt
at registration, pre-deposit or post-deposit, the prompt raised limit-setting elevenfold but the
pooled intervention group did not differ from control on net losses (OR = 1.0, p = .921) or on the
size of losses (B = −0.1, p = .291), including among the most active decile. The authors also found
that players who *raised or removed* limits lost more — i.e. limit-setting without a prompt may be a
*marker* of a problem rather than a remedy.

**Sources.**
- Auer, M., Hopfgartner, N., & Griffiths, M. D. (2019). *Deposit Limit Prompt in Online Gambling for
  Reducing Gambling Intensity: A Randomized Controlled Trial.* Frontiers in Psychology 10:639.
  https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2019.00639/full
- Delfabbro, P., & King, D. L. (2021). *The value of voluntary vs. mandatory responsible gambling
  limit-setting systems: A review of the evidence.* International Gambling Studies 21(2).
  https://www.tandfonline.com/doi/abs/10.1080/14459795.2020.1853196
- Ladouceur, R., Blaszczynski, A., & Lalande, D. R. (2012). *Pre-commitment in gambling: A review of
  the empirical evidence.* International Gambling Studies 12(2).
  https://www.researchgate.net/publication/254297181_Pre-commitment_in_gambling_A_review_of_the_empirical_evidence
- Hansen, M. B., et al. (2025). *Limit-setting in online gambling: a comparative policy review of
  European approaches.* Harm Reduction Journal.
  https://harmreductionjournal.biomedcentral.com/articles/10.1186/s12954-024-01150-3 ·
  PMC https://pmc.ncbi.nlm.nih.gov/articles/PMC11823029/

**Evidence: STRONG that a one-off voluntary prompt does not work** (a real RCT with a null result).
**MODERATE/CONTESTED on whether mandatory global limits work** — the policy reviews find low uptake
of voluntary tools and argue mandatory systems are more promising, but there is no clean
randomised evaluation; Norway's Norsk Tipping global loss limit is the main real-world case and its
evaluations are operator-run **[GREY]**
(https://igamingbusiness.com/sustainable-gambling/care-calls-linked-reduced-gambling-among-norsk-tipping-customers-study-finds/).

**Design rule R10.** Do not ship a nag. Ship a **default**: every account gets a pre-set daily
deposit/loss limit at signup (a low default, e.g. tied to the minimum stake), which the user can
adjust. **Limit increases take effect after a delay; decreases take effect immediately.** This is the
asymmetry the evidence supports, and it is also what Kenya's Reg. 87 requires the tooling to exist
for.
**Testable as:** compare a pre-set default cohort against a prompt-only cohort on 90-day net loss
distribution, especially the top decile. The prompt-only arm is the known-null control.

### 3.2 Informational interventions work, but weakly — do not over-claim
**Claim.** Personalised behavioural feedback and pop-up messages based on actual play data show
small real-behaviour effects in operator-data studies; static warnings show little. Newall's own
incentivised experiment (n=2,433) that *did* find behavioural change reported mean spins of 15.7
(SD 28.2) with house-edge information versus 19.3 (SD 31.3) with RTP — a real difference with a
**small effect size**, and the authors say so explicitly.

**Sources.**
- Auer, M., & Griffiths, M. D. (2015). *The use of personalized behavioral feedback for online
  gamblers: an empirical study.* Frontiers in Psychology 6:1406.
  https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2015.01406/full
- Auer, M., & Griffiths, M. D. (2020). *The use of personalized messages on wagering behavior of
  Swedish online gamblers.* Computers in Human Behavior 110:106402.
  https://www.sciencedirect.com/science/article/abs/pii/S0747563220301552
- Newall et al. (2022), as §1.4.
- BIT (2022), as §1.4 — note that **only 2% of PGSI 4+ respondents answered all comprehension items
  correctly**, versus 13% of non-problem gamblers: the people most at risk understand the disclosure
  least.

**Evidence: MODERATE, with a clear ceiling.** Operator-data studies are not randomised in the
strongest sense and are authored by researchers working with operators. Treat all informational
measures as necessary-but-insufficient.

**Design rule R11.** Disclosure is a floor, not a safety system. Pair every informational measure
with a structural one (a default limit, a cap, a delay). Never cite "we told them" as the control.
**Testable as:** report comprehension *and* behaviour separately; a comprehension win with no
behaviour change is a failed intervention, not a success.

### 3.3 Confirmation versus undo: confirm only what cannot be undone
**Claim.** Confirmation dialogs prevent errors only when they are rare and specific; habituation
erodes them, and for reversible actions an undo is superior because it does not tax the common case.
The strongest *normative* statement is WCAG 2.2 SC 3.3.4, which accepts **any one** of reversible,
checked, or confirmed for financial submissions — i.e. the standard treats undo and confirmation as
substitutes, not as a stack.

**Sources.**
- W3C, *WCAG 2.2*, SC 3.3.4 Error Prevention (Legal, Financial, Data), Level AA; SC 3.3.6 at AAA.
  https://www.w3.org/TR/WCAG22/
- Nielsen Norman Group, *Confirmation Dialogs Can Prevent User Errors* **[GREY, practitioner]**.
  https://www.nngroup.com/articles/confirmation-dialog/
- Aza Raskin, *Never Use a Warning When you Mean Undo* (A List Apart) **[GREY, practitioner]**.
  https://alistapart.com/article/neveruseawarning/

**Evidence: STRONG for the standard; WEAK/PRACTITIONER for the confirm-vs-undo design claim.** I did
not find a clean controlled experiment comparing confirmation dialogs with undo in a financial
context. **Flagged as thin — this rule rests mainly on a standards body plus practitioner
consensus.**

**Design rule R12.** Exactly **one** confirm step per money-moving action, and it must be a
*summary*, not a nag: it restates pay / max loss / payout (R7) and nothing else. Provide a **short,
explicit cancel window** for the trade itself (sell-back at the current price is not the same thing
as an undo, and must not be described as one). Do not stack an interstitial, a checkbox and a modal
— the evidence on habituation says three weak gates are worse than one real one.
**Testable as:** measure the rate of self-reported "I did not mean to do that" and the rate of
immediate reversals; adding gates should reduce it, and if it does not, remove the gates.

### 3.4 Cooling-off: mandated, but the consumer evidence is genuinely weak
**Claim.** Kenya's 2026 regulations require a self-exclusion facility of **minimum 24 hours** and
integration with a national self-exclusion registry, plus reality-check pop-ups showing duration of
play (Reg. 87). The general consumer-law evidence that cooling-off periods change outcomes is
surprisingly thin — one long-horizon natural-experiment analysis concluded written cooling-off
notices were largely illusory protection.

**Sources.**
- GRA Kenya, *Conduct of Gambling Operations Regulations, 2026*, **Reg. 87**: "accessible and
  real-time tools" — daily/weekly/monthly deposit limits; loss, session and expenditure limits;
  "reality checks, pop-up notifications indicating duration of play"; self-exclusion for a minimum
  of 24 hours; national registry integration; a player savings tool.
  https://gra.go.ke/wp-content/uploads/2026/03/18.03.26-GRA-THE-GAMBLING-CONTROL-CONDUCT-OF-GAMBLING-OPERATIONS-REGULATIONS-2026.pdf
- *Written Notice of Cooling-Off Periods: A Forty-Year Natural Experiment in Illusory Consumer
  Protection…* University of Pittsburgh Law Review.
  https://lawreview.law.pitt.edu/ojs/lawreview/article/view/337
- Model-based evaluation of cooling-off policies, Games and Economic Behavior.
  https://www.sciencedirect.com/science/article/abs/pii/S0899825621000695

**Evidence: STRONG that it is required in Kenya; WEAK that it changes behaviour.** Build it because
the law says so and because it is the right thing, not because the literature promises an effect.

**Design rule R13.** Self-exclusion and cool-off must be reachable in **two taps from any screen**
(the regulation's word is "accessible and real-time"), must not require a support conversation, and
must never be placed behind a retention offer.
**Testable as:** time-to-self-exclude, measured in an unmoderated task. Target under 15 seconds.

---

## 4. Trust in a financial interface in these markets

### 4.1 Mobile money's trust is built on *verification before commitment* and a durable receipt
**Claim.** The M-Pesa interaction pattern — a confirm-the-recipient step (Hakikisha), a PIN entry, an
immediate SMS receipt with a transaction code — is the trust benchmark, and it works because it is
verifiable and auditable after the fact. Safaricom's own fraud-awareness material shows the flipside:
**fake confirmation SMS** is a named, prevalent attack, which means users are trained to check the
*content* of the receipt, not just its existence.

**Sources.**
- Safaricom, *M-PESA Fraud | ATM Fraud | Fake Reversal SMS* (operator security guidance) **[GREY]**.
  https://www.safaricom.co.ke/fraud-awareness/m-pesa-fraud
- Rest of World (2023), *M-Pesa has become a tool for SIM swap fraud* **[GREY, journalism]**.
  https://restofworld.org/2023/mpesa-sim-swap-fraud/
- Nturibi, B. M. (2018). *A mobile money social engineering framework for detecting voice & SMS
  fraud.* MSc thesis, United States International University–Africa.
  https://erepo.usiu.ac.ke/bitstream/handle/11732/4148/BRYAN%20MUTETHIA%20NTURIBI%20%20MSCIT%202018.pdf
- Kotut, L., et al. (2025). *Financial Grift* (ACM COMPASS 2025) — scam practices in African
  digital-finance contexts.
  https://faculty.washington.edu/kotut/papers/COMPASS-2025-Financial-Grift.pdf
- CGAP (2015), *Recourse in Digital Financial Services: Opportunities for Innovation* **[GREY]** —
  recourse and complaint-resolution as a driver of trust and continued use.
  https://www.cgap.org/sites/default/files/Brief-Recourse-in-Digital-Financial-Services-Dec-2015.pdf
- GSMA, *Cybersecurity and mobile money: prioritising consumer trust and awareness* **[GREY]**.
  https://www.gsma.com/mobilefordevelopment/uncategorized/cybersecurity-and-mobile-money-prioritising-consumer-trust-and-awareness/
- Jack, W., & Suri, T. (2014). *Risk Sharing and Transaction Costs: Evidence from Kenya's Mobile
  Money Revolution.* American Economic Review 104(1):183–223.
  https://www.aeaweb.org/articles?id=10.1257/aer.104.1.183 (establishes M-PESA's real welfare role —
  i.e. why the M-PESA interaction grammar is the one users have internalised).

**Evidence: MODERATE.** Jack & Suri is STRONG but is about risk-sharing economics, not UI. The UX
trust claims rest on operator guidance, a thesis, one CHI-adjacent conference paper and GSMA/CGAP
practitioner work. **Flagged: there is no controlled study I could find that measures which interface
signals raise trust for Kenyan/Ugandan/Tanzanian mobile-money users.** This is the biggest evidence
gap in this document, and it is exactly where Kichiko should run its own research.

**Design rule R14.** Mirror the M-Pesa grammar exactly: (a) a **name-and-amount verification step**
before the PIN-equivalent ("You are paying KICHIKO — KSh 200 — correct?"); (b) an **immediate
in-app receipt with a copyable reference code**, matching what the SMS says, character for character;
(c) a permanent, searchable transaction history the user can reconcile against their M-Pesa
statement.
**Testable as:** users can find and read back the reference code for a transaction made five minutes
ago, and can state where the money went, without help.

### 4.2 What reads as untrustworthy
**Claim.** Synthesis of the repo's §6 (regulator red-flag vocabulary: guaranteed/high/fixed returns,
"earn daily", referral pressure, upfront fees, withdrawal problems, no verifiable contact) with the
dark-pattern literature in §6 below. The dark-pattern crawl found **157 fake countdown timers**,
**29 fabricated activity notifications** and **17 deceptive low-stock messages** in the wild — these
are precisely the patterns a scam-primed audience is trained to spot.

**Sources.** Mathur, A., et al. (2019). *Dark Patterns at Scale: Findings from a Crawl of 11K
Shopping Websites.* PACM HCI 3(CSCW):81. https://arxiv.org/abs/1907.07032 ·
https://arxiv.org/pdf/1907.07032 · plus the repo's §6.

**Evidence: STRONG that these patterns exist and are deceptive; INFERENCE that they specifically read
as scam signals to this audience** (that inference is supported by the repo's regulator-warning
analysis, not by a controlled study).

**Design rule R15.** A fixed prohibition list, enforced in code review: no countdown timer that is
not tied to a real market close; no "N people are looking at this" unless it is a true live count
with a documented query; no synthetic winner feed; no number on screen that cannot be traced to a
database row.
**Testable as:** every dynamic social/urgency number in the UI has a named source query in the
codebase. Zero exceptions is the pass condition.

### 4.3 Low-literacy and novice-user interface design
**Claim.** For non-literate and semi-literate users, rich multimedia interfaces produce higher task
completion than text-only interfaces for money transfer, but at a cost in speed; and novices do
markedly better with a small number of strongly signposted paths. Note the repo's counter-finding
that this audience *prefers English for money* — so the lesson here is about **redundant coding
(icon + number + word)**, not about removing text.

**Sources.**
- Medhi, I., Gautama, S. N. N., & Toyama, K. (2009). *A comparison of mobile money-transfer UIs for
  non-literate and semi-literate users.* CHI 2009.
  https://dl.acm.org/doi/pdf/10.1145/1518701.1518970
- Medhi, I., Patnaik, S., Brunskill, E., Gautama, S. N. N., Thies, W., & Toyama, K. (2011).
  *Designing mobile interfaces for novice and low-literacy users.* ACM TOCHI 18(1):2.
  https://dl.acm.org/doi/10.1145/1959022.1959024
- Medhi Thies, I., et al. *User Interface Design for Low-literate and Novice Users: Past, Present and
  Future.* https://www.semanticscholar.org/paper/aac5e2c78008f158ec0d2f4195a7808641c9d3a3
- Nalwadda / Chaudry-style guidance: *Actionable UI Design Guidelines for Smartphone Applications
  Inclusive of Low-Literate Users*, PACM HCI (2021). https://dl.acm.org/doi/10.1145/3449210

**Evidence: MODERATE.** Real controlled studies, but with small samples, in South Asian contexts, and
now 15 years old — device familiarity has changed a great deal. Flagged as dated.

**Design rule R16.** Every critical number is coded **three ways**: numeral, word, and a
visual/spatial cue (a filled bar for the probability, a coin/note motif for KSh). Never rely on
colour alone — this is also WCAG 1.4.1.
**Testable as:** comprehension holds in a greyscale build and at 200% text zoom.

---

## 5. Numeric and chart cognition

### 5.1 Frequency-format and dot-based uncertainty displays outperform intervals; "deterministic construal" is the documented misread
**Claim.** The uncertainty-visualisation literature converges on three things: (1) frequency-framed
displays (icon arrays, quantile dotplots) are among the best-performing for lay single-event
probability; (2) people commit **deterministic construal error** — they substitute the uncertainty
display for a simpler deterministic reading, e.g. reading an interval's ends as "the high and the
low", and they do this **even when given a correct key**; (3) drawn boundaries create false
categories (the Cone of Uncertainty problem: inside = safe, outside = not).

**Sources.**
- Padilla, L. M., Kay, M., & Hullman, J. (2022). *Uncertainty Visualization.* In *Wiley StatsRef* /
  Computational Statistics. http://space.ucmerced.edu/Downloads/publications/Uncertainty_Visualization_Padilla_Kay_Hullman_2022.pdf
- Kay, M., Kola, T., Hullman, J., & Munson, S. A. (2016). *When (ish) is My Bus? User-centered
  Visualizations of Uncertainty in Everyday, Mobile Predictive Systems.* CHI 2016.
  https://dl.acm.org/doi/10.1145/2858036.2858558 ·
  PDF https://users.eecs.northwestern.edu/~jhullman/busUncertaintyVis.pdf
- Fernandes, M., Walls, L., Munson, S., Hullman, J., & Kay, M. (2018). *Uncertainty Displays Using
  Quantile Dotplots or CDFs Improve Transit Decision-Making.* CHI 2018.
  https://www.mjskay.com/papers/chi2018-uncertain-bus-decisions.pdf
- Spiegelhalter, D., Pearson, M., & Short, I. (2011). *Visualizing Uncertainty About the Future.*
  Science 333(6048):1393–1400. https://www.science.org/doi/abs/10.1126/science.1191181 ·
  PDF https://www.stat.berkeley.edu/~aldous/157/Papers/spiegelhalter_visualizing.pdf
- Spiegelhalter, D. (2017). *Risk and Uncertainty Communication.* Annual Review of Statistics and Its
  Application 4:31–60. https://www.annualreviews.org/content/journals/10.1146/annurev-statistics-010814-020148
- Zikmund-Fisher, B. J., et al. (2014). *Blocks, Ovals, or People? Icon Type Affects Risk Perceptions
  and Recall of Pictographs.* Medical Decision Making 34(4). https://doi.org/10.1177/0272989X13511706

**Evidence: STRONG for frequency formats and for deterministic construal; MODERATE for the specific
superiority of quantile dotplots** (a handful of CHI experiments, mostly transit decisions, on
desktop and mobile, Western samples).

**Design rule R17.** Show the current probability as a **dot/icon array of 100 marks** (or a
100-segment bar) as the primary graphic, not a smooth gauge and not a confidence band. If any
interval or range is ever shown, it must be drawn as a **graded or dotted** density rather than a
hard-edged band, because hard edges are read as categories.
**Testable as:** ask "how many of these 100 happen?" and "is 62% inside or outside the likely range?"
— the second question should not produce a categorical answer.

### 5.2 Y-axis truncation strongly distorts perceived effect size, and labelling it does not fix it
**Claim.** Correll, Bertini & Franconeri tested truncated axes with and without broken-axis markers
and below-axis gradients. Truncation had a strong, consistent effect on perceived trend/effect
magnitude; the mitigations **did not remove it** — "just indicating that something screwy is going on
with the y-axis was not sufficient." Bars and lines behaved the same. A separate line of work finds
truncated bar graphs mislead *persistently*, even after explicit instruction.

**Sources.**
- Correll, M., Bertini, E., & Franconeri, S. (2020). *Truncating the Y-Axis: Threat or Menace?*
  CHI 2020. https://doi.org/10.1145/3313831.3376222 · arXiv https://arxiv.org/abs/1907.02035 ·
  author summary https://www.tableau.com/blog/truncating-y-axis-threat-or-menace
- Yang, B. W., Vargas Restrepo, C., Stanley, M. L., & Marsh, E. J. (2021). *Truncating Bar Graphs
  Persistently Misleads Viewers.* Journal of Applied Research in Memory and Cognition 10(2).
  https://www.sciencedirect.com/science/article/abs/pii/S2211368120300978
- Follow-up, task-dependence: *Taking Truncation to Task: A Task-Based Exploration of Axis Truncation
  in Bar Charts*, CHI 2026. https://dl.acm.org/doi/10.1145/3772318.3790617

**Evidence: STRONG.** Multiple independent experiments; the 2026 follow-up adds task-dependence
nuance but does not overturn the direction.

**Design rule R18.** A probability chart's y-axis is **always 0–100%**, always, with no per-market
auto-scaling and no "zoom to fit". A 3-point move must look like a 3-point move. Do not rely on an
axis-break glyph to excuse truncation — the evidence says it does not work.
**Testable as:** ask users to estimate the size of a move from the chart alone; error versus the true
value should not exceed a few points, and should not differ across markets with different volatility.

### 5.3 Short default time windows cause more trading and worse outcomes
**Claim.** In a controlled experiment with 1,041 participants, investors shown short-horizon price
charts had a roughly **38 percentage-point higher propensity to trade** than those shown long-horizon
charts, paid about **50% higher transaction fees**, and ended with about **18% lower average
profits**. The effect persisted even when both chart types were shown together. Notably, the chart
horizon did *not* change average risk allocation — so this is a churn effect, not a risk-appetite
effect.

**Source.** Borsboom, C., Janssen, D.-J., Strucks, M., & Zeisberger, S. (2022). *History matters:
How short-term price charts hurt investment performance.* Journal of Banking & Finance 134:106351.
https://doi.org/10.1016/j.jbankfin.2021.106351 ·
https://www.sciencedirect.com/science/article/pii/S0378426621003022

**Evidence: MODERATE-to-STRONG.** One large, well-designed lab experiment with a clear mechanism and
a large effect; not yet replicated in the field, and the population was not East African retail.

**Design rule R19.** The **default chart range is the full life of the market**, not 1H or 24H. Short
ranges are available but never the default, and there is no intraday/candlestick view. There is no
"most active in the last hour" ranking on the home surface.
**Testable as:** A/B full-life default versus 24H default on trades-per-user and on net fees paid;
the prediction is fewer trades and higher net returns on the full-life default. If churn is a revenue
target, this rule will be commercially uncomfortable — that is the point.

### 5.4 Denominator neglect and ratio bias
**Claim.** People attend to numerators and neglect denominators when comparing ratios; visual aids
that make the denominator explicit (icon arrays) reduce the error.

**Sources.** Garcia-Retamero, Galesic & Gigerenzer (2010), as §1.1; Padilla, Kay & Hullman (2022),
as §5.1 (which names denominator neglect explicitly).

**Evidence: STRONG.**

**Design rule R20.** Never show a count without its base. `1,240 answers` alone is meaningless and
mildly manipulative; `1,240 of 2,000 chose Yes` is information. Same for volume: always pair with the
number of participants.
**Testable as:** users can state what share of activity was on each side after viewing the market
header.

---

## 6. Dark patterns and the ethical line

### 6.1 The catalogue, with the evidence for each
| Pattern | What it is | Evidence it works / harms | Verdict for Kichiko |
|---|---|---|---|
| **Variable / intermittent reward** | Unpredictable reinforcement schedules; spinning, reveals, surprise bonuses | Foundational operant-conditioning literature; the gambling-harm case rests on it | **Never.** No reveal animation, no surprise bonus, no spin |
| **Near-miss framing** | Presenting a loss as almost-a-win | Clark et al. (2009), *Neuron* 61(3):481–490, *Gambling Near-Misses Enhance Motivation to Gamble and Recruit Win-Related Brain Circuitry*, https://www.sciencedirect.com/science/article/pii/S0896627309000373 ; Chase & Clark striatal findings, https://pmc.ncbi.nlm.nih.gov/articles/PMC4987843/ ; review: *The Near-Miss Effect in Slot Machines*, J Gambling Studies, https://link.springer.com/article/10.1007/s10899-019-09891-8 | **Never.** A market that resolved against the user is shown as a plain loss. No "you were so close", no "it was at 48% an hour ago" |
| **Losses disguised as wins / celebratory sound on a net loss** | Audio-visual win cues on a losing outcome | UKGC 2021 remote-slots package banned celebratory presentation of returns ≤ stake; Newall et al., *Cue the sad trombone*, Behavioural Public Policy, https://www.cambridge.org/core/journals/behavioural-public-policy/article/5EDC0F428BC06371179A8636250BA204 found the rules were still being circumvented | **Never.** No celebration sound or animation on any outcome where net proceeds ≤ stake |
| **False urgency / fake scarcity** | Countdown timers, "only N left", "N viewing now" | Mathur et al. (2019): 679 scarcity and 481 urgency instances across 11K sites; **157 fake countdowns**, **29 fabricated activity feeds**, **17 deceptive stock counters**. https://arxiv.org/abs/1907.07032 | **Never**, except a true market-close countdown |
| **Manufactured social proof** | Invented winners, testimonials, activity | Mathur et al. (2019), 325 social-proof instances; 22 third-party vendors, at least two openly advertising *fake* social proof | **Never.** Also independently banned by Kenyan ad rules (no testimonials) |
| **Loss-chasing prompts** | Nudging a user to bet again right after a loss | Within-session chasing is measurable and associated with harm: *Within-session chasing of losses and wins in an online eCasino*, Scientific Reports 14 (2024), https://www.nature.com/articles/s41598-024-70738-3 ; *Multidimensional Loss Chasing among Online Gamblers*, J Gambling Studies (2025), https://link.springer.com/article/10.1007/s10899-025-10391-1 | **Never.** No re-engagement push, banner or notification triggered by a loss event. This must be an explicit rule in the notification service |
| **Gamified streaks, leaderboards, badges, confetti** | Engagement mechanics borrowed from games | Barber, Huang, Odean & Schwarz (2022), *Attention-Induced Trading and Returns: Evidence from Robinhood Users*, Journal of Finance 77(6):3141–3190, https://onlinelibrary.wiley.com/doi/abs/10.1111/jofi.13183 — herding into attention-grabbing stocks, with negative abnormal returns; critical analysis: *Financial playthings: Interrogating gamification in retail trading interfaces*, https://intellectdiscover.com/content/journals/10.1386/jgvw_00062_1 | **Never on money surfaces.** No streaks, no confetti, no leaderboards of winnings |
| **Drip-priced fees** | Charges revealed late | §2.3, STRONG | **Never.** All-in first |
| **Obstruction / roach motel on withdrawal or self-exclusion** | Easy in, hard out | Mathur et al. (2019) "Obstruction"; Reg. 87 requires "accessible and real-time" tools | **Never.** Withdrawal and self-exclusion at parity with deposit, or better |
| **Asymmetric defaults on the YES/NO choice** | Pre-selection, visual weighting | Mathur's "asymmetric" and "restrictive" dimensions; §2.1 framing | **Never.** No pre-selected side, no pre-filled stake above the minimum |
| **Confirmshaming** | Guilt-framed decline options | Mathur et al. (2019) Misdirection | **Never.** The decline option is neutral: "Not now" |
| **Inducements, free bets, credit** | Bonuses to start or continue | Kenya's Gambling Control Act 2025 restricts inducing players and **prohibits providing credit to players** (Bowmans summary, https://bowmanslaw.com/insights/kenya-the-gambling-control-act-2025-key-provisions/); BIT (2022) found free-spins promotions raised willingness to play by ~5pp, partly cancelling the disclosure gain | **Never.** No credit, no deposit bonus, no free stake |
| **Cash-out-style features that encourage churn** | Early settlement pushed to the user | Lopez-Gonzalez & Griffiths (2017), *"Cashing out" in sports betting: implications for problem gambling and regulation*, Gaming Law Review 21(4):323–326; *Cash outs during in-play sports betting: Who, why, and what it reveals*, Addictive Behaviors (2024), https://www.sciencedirect.com/science/article/pii/S0306460324000571 ; and *Greater impulsivity is associated with a reduced propensity to cash out*, https://www.sciencedirect.com/science/article/pii/S235285322500063X | **Sell-back must exist** (users must be able to exit) **but must never be promoted, animated or push-notified.** Evidence here is MODERATE/MIXED — the last paper finds *less* impulsive users cash out more, which complicates the harm story |

### 6.2 The regulatory position
- **Kenya — binding.** *Gambling Control Act No. 14 of 2025*
  (https://new.kenyalaw.org/akn/ke/act/2025/14/eng@2025-08-12/source.pdf) and the
  *Gambling Control (Conduct of Gambling Operations) Regulations, 2026*
  (https://gra.go.ke/wp-content/uploads/2026/03/18.03.26-GRA-THE-GAMBLING-CONTROL-CONDUCT-OF-GAMBLING-OPERATIONS-REGULATIONS-2026.pdf).
  UI-relevant obligations, quoting regulation numbers:
  - **Reg. 20** — display clearly the rules of games, odds, house edge and average return to player.
  - **Reg. 23** — clearly display betting odds, rules and terms applicable to each bet.
  - **Reg. 45** — game rules displayed **before** any wager; theoretical RTP publicly disclosed.
  - **Reg. 85** — mandatory identity check, location verification and age assurance **before**
    participation, using "reliable, independent and electronically verifiable data sources."
  - **Reg. 87** — accessible, real-time self-control tools: daily/weekly/monthly deposit limits;
    loss, session and expenditure limits; reality-check pop-ups showing duration of play;
    self-exclusion for a minimum of 24 hours; national self-exclusion registry integration; a player
    savings tool.
  - **Reg. 46** — marketing approval; must not target minors or vulnerable persons; not on media
    where >25% of the audience is expected to be under age.
  - **Reg. 96** — personal data limited to purposes directly related to the operation; **no marketing
    use without prior consent.**
  - **Reg. 97** — responsible-gambling messaging and problem-gambler assistance information displayed.
  - From the Act itself (per the Bowmans analysis): GRA approval for advertising; prohibition on
    "enticing" and celebrity/lifestyle advertising that glamorises gambling; **TV/radio watershed —
    nothing between 06:00 and 22:00** except during live sport; **20% of aired advertising time must
    be responsible-gambling messaging**; no inducement of players and **no credit to players**;
    local bank account and Kenyan customer-care centre; licence displayed publicly on the platform;
    real-time monitoring data to the regulator; penalties to KES 50M (unlicensed) and KES 20M
    (advertising).
- **The other four jurisdictions.** All five are legal-and-regulated, but the minimum age is **not**
  uniform: Kenya 18, **Uganda 25**, Tanzania 18, Rwanda 18, Zambia 18, per the supplementary table to
  the Glasgow systematic review of gambling in sub-Saharan Africa
  (https://eprints.gla.ac.uk/275630/6/275630Suppl.pdf), citing Uganda's *Lotteries and Gaming Act
  No. 7 of 2016*, Tanzania's *Gaming Act 2003* plus *Internet Gaming Regulations 2021*, Rwanda's 2016
  gambling regulations and Zambia's *Betting Act 1994*. Background: Tagoe, V. N. K., et al. (2022),
  *Gambling in Sub-Saharan Africa: Traditional Forms and Emerging Technologies*,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC9595076/. **Evidence: MODERATE — this is a secondary
  table and the Kenyan row is already out of date (it cites the 2021 Act, superseded by the 2025
  Act), so the other four rows must be verified against primary legislation before launch.**
- **Comparative, non-binding but indicative.** EU **DSA Article 25** prohibits designing online
  interfaces in a way that deceives, manipulates or materially distorts users' ability to make free
  and informed decisions (https://www.eu-digital-services-act.com/Digital_Services_Act_Article_25.html);
  the proposed **Digital Fairness Act** would extend this
  (https://www.europarl.europa.eu/RegData/etudes/ATAG/2025/767191/EPRS_ATA(2025)767191_EN.pdf).
  The **UK CMA**'s *Online Choice Architecture* evidence review
  (https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/1069423/OCA_Evidence_Review_Paper_14.4.22.pdf)
  and the **OECD** *Dark Commercial Patterns* report
  (https://one.oecd.org/document/DSTI/CP(2021)12/FINAL/en/pdf) are the clearest
  regulator-side taxonomies and are worth adopting as an internal standard even where not binding.
  See also Mills & Sætra, *Dark patterns and sludge audits: an integrated approach*, Behavioural
  Public Policy, https://doi.org/10.1017/bpp.2023.24 — a usable audit method.

**Design rule R21.** Maintain a written **dark-pattern prohibition list** (the Verdict column above)
as a merge gate, and run a **sludge audit** on the two flows that matter most: deposit-vs-withdrawal
and play-vs-self-exclude. The pass condition is symmetry: **withdrawal and self-exclusion must take
no more taps, no more time and no more fields than deposit and purchase.**
**Testable as:** count taps, screens, fields and median seconds for each of the four flows in an
unmoderated test; publish the numbers internally each release.

---

## 7. Cognitive load and mobile constraints

### 7.1 Cognitive load is a real constraint, and the fix is chunking and removing split attention
**Claim.** Working memory is narrowly limited; extraneous load imposed by presentation (having to
integrate information split across places on screen, or redundant duplicated information) measurably
degrades performance. This is the best-established part of the instructional-design literature.

**Sources.**
- Sweller, J., van Merriënboer, J. J. G., & Paas, F. (1998). *Cognitive Architecture and
  Instructional Design.* Educational Psychology Review 10:251–296.
  https://link.springer.com/article/10.1023/A:1022193728205
- Sweller, J. (2010) and the critique/response literature: *Cognitive load theory, educational
  research, and instructional design: some food for thought.* Instructional Science 38.
  https://link.springer.com/article/10.1007/s11251-009-9110-0
- Split-attention effect: https://en.wikipedia.org/wiki/Split_attention_effect (secondary; the
  primary work is in the Sweller papers above).

**Evidence: STRONG for split-attention and redundancy effects; the theory's measurement apparatus is
CONTESTED** in education research, but the design implications (co-locate what must be integrated;
do not duplicate) are not.

**Design rule R22.** Everything the user must integrate to make one decision lives in **one visual
block with no scrolling between parts**: question, probability, frequency gloss, amount paid, maximum
loss, payout, resolution source. If it does not fit on a 360×640 logical viewport, cut content, do
not split it across a scroll boundary.
**Testable as:** on the smallest supported device, the entire decision set is visible without
scrolling; measure task time and error rate against a scrolling variant.

### 7.2 Progressive disclosure — supported in principle, thin in specifics
**Claim.** Layering detail behind a deliberate expansion reduces initial load without losing access.
The *principle* follows from 7.1; the *empirical* literature on progressive disclosure specifically
in consumer mobile UIs is mostly practitioner writing, with some recent experimental work in
explanation interfaces.

**Sources.**
- Sweller et al. (1998), as above, for the load rationale.
- *Designing Effective Training Dataset Explanations: The Impact of Information Depth and Progressive
  Disclosure*, ACM IUI 2026. https://dl.acm.org/doi/10.1145/3742413.3789087
- Practitioner sources exist in volume but are **[GREY]** and not cited as evidence here.

**Evidence: WEAK for the specific pattern. Flagged.** Use it, but do not claim the literature proves
it; and note the hard constraint that **anything legally required (max loss, fees, resolution source,
18+/licence) may not be hidden behind a disclosure**, per Reg. 45's "before any wager" and the
drip-pricing evidence in §2.3.

**Design rule R23.** Two tiers only: **Tier 1 (always visible)** — question, probability + frequency,
close time, amount paid, maximum loss, payout, resolution source, and the responsible-play entry
point. **Tier 2 (one tap)** — order book, chart history, full rules, fee breakdown, historical
calibration by price bucket. Nothing legally required lives in Tier 2.
**Testable as:** a content audit each release: every Tier-2 item is justified in writing; any
required disclosure found in Tier 2 is a release blocker.

### 7.3 One-handed reach: the bottom third is the reliable zone
**Claim.** The thumb's functional area on a phone held in one hand is a constrained arc governed by
grip and hand size; reachability degrades sharply toward the top opposite corner, and one-handed use
is common in the field.

**Sources.**
- Bergstrom-Lehtovirta, J., & Oulasvirta, A. (2014). *Modeling the functional area of the thumb on
  mobile touchscreen surfaces.* CHI 2014. https://dl.acm.org/doi/10.1145/2556288.2557354
- Le, H. V., Mayer, S., Bachynskyi, M., Henze, N. (2018). *Fingers' Range and Comfortable Area for
  One-Handed Smartphone Interaction Beyond the Touchscreen.* CHI 2018.
  https://dl.acm.org/doi/10.1145/3173574.3173605
- Eardley, R., et al. *Understanding One-Handed Use of Mobile Devices.*
  https://www.researchgate.net/publication/285703832_Understanding_One-Handed_Use_of_Mobile_Devices
- *Action Bar Adaptations for One-Handed Use of Smartphones* (2022). https://arxiv.org/html/2208.08734v1

**Evidence: MODERATE-to-STRONG for the biomechanics; MODERATE for real-world grip prevalence** (the
observational studies are small and pre-date very large phones).

**Design rule R24.** All primary money actions live in the **bottom half** of the screen, and the
**confirm** action sits in the reachable arc while the **cancel/back** action is equally reachable and
equally large — no "easy yes, awkward no". Destructive or high-consequence controls are never placed
where an accidental thumb press lands.
**Testable as:** mis-tap rate on the confirm/cancel pair, measured one-handed, on a 6"+ device.

### 7.4 Touch target and contrast minima are normative, not a matter of taste
**Claim.** WCAG 2.2 sets **24×24 CSS px** as the AA minimum target size (SC 2.5.8), **44×44** at AAA
(SC 2.5.5), and **4.5:1** contrast for body text (SC 1.4.3), with 3:1 for large text.

**Source.** W3C, *WCAG 2.2*. https://www.w3.org/TR/WCAG22/

**Evidence: STRONG (normative standard).**

**Design rule R25.** Target the **AAA 44×44** figure, not the AA 24×24 floor, for every money control
— the users are outdoors, on cheap capacitive digitisers, often one-handed. Contrast is checked
against 4.5:1 in the *sunlight* case, which in practice means designing for a higher ratio.
**Testable as:** automated axe/Lighthouse gate on target size and contrast in CI; plus one outdoor
legibility session per release.

---

## 8. Where the evidence is thin — read this before citing anything above

1. **No controlled study of trust signals for East African mobile-money users.** §4 is the weakest
   section. The M-Pesa grammar recommendation (Hakikisha-style verification, receipt code,
   reconcilable history) is a well-motivated inference from operator guidance, a Kenyan MSc thesis,
   and GSMA/CGAP practitioner work — not from an experiment. **This is Kichiko's highest-value own
   research opportunity.**
2. **The whole probability-format literature is about health, weather and climate**, not about buying
   a binary contract with your own money. The single closest evidence — the BIT odds-comprehension
   experiment and Newall's house-edge work — is about *gambling odds*, which is the right hazard class
   but the wrong product. Transfer is an inference.
3. **Informational interventions have small effect sizes and their authors say so.** Do not build a
   compliance story on "we disclosed it." Newall et al. (2022) explicitly warn against relying on
   informational provisions.
4. **The people who most need the disclosure understand it least.** BIT found only 2% of PGSI 4+
   respondents got all comprehension items right versus 13% of non-problem gamblers. Comprehension
   testing on a general sample will overstate real-world protection.
5. **Confirm-vs-undo has no clean experiment** in a financial mobile context that I could find. R12
   rests on WCAG 3.3.4 plus practitioner consensus.
6. **Progressive disclosure specifically** is under-evidenced (§7.2).
7. **Cooling-off periods** are mandated but their consumer-behaviour evidence base is weak (§3.4).
8. **Mandatory vs voluntary limits** is genuinely contested; the only RCT-grade result is a **null**
   for prompts. Norway's global-limit evidence is operator-produced.
9. **Low-literacy UI studies are 15 years old** and from South Asia; device familiarity has changed.
10. **The cross-country regulatory table is secondary and partly stale** — its Kenya row cites the
    superseded 2021 Act. Uganda's minimum age of **25** in particular must be confirmed against the
    *Lotteries and Gaming Act 2016* before any Ugandan launch, because it changes age-gating logic.
11. **Chart-horizon and Robinhood findings are from equities**, not binary contracts with a fixed
    terminal payoff. The churn mechanism should transfer; the magnitude should not be assumed.
12. **The near-miss literature is about slot machines.** A prediction market resolving against a user
    who was "winning" at 80% is structurally a near-miss, but no study I found tests that. The
    prohibition in §6.1 is precautionary.

---

## 9. The 25 design rules, as a checklist

| # | Rule | Evidence |
|---|---|---|
| R1 | Percentage **and** frequency gloss, co-located, always | STRONG (transfer: INFERENCE) |
| R2 | Reference class + resolution event in the same block as the number | MODERATE / CONTESTED |
| R3 | Numbers lead; verbal probability words only bound to numbers | STRONG |
| R4 | Economics stated as money lost per KSh 100, never as a payout % | STRONG (comprehension) |
| R5 | Probability and money-paid are separate, separately labelled numbers | INFERENCE on strong base |
| R6 | YES/NO visually and verbally symmetric; no favoured side | STRONG |
| R7 | `You pay` · `Most you can lose` · `If right you get`, in KSh, before confirm | STRONG (normative) |
| R8 | All-in fees and net amounts up front; no drip | STRONG |
| R9 | Real money units everywhere; visible session spend; no tokens or credits | MODERATE (thin locally) |
| R10 | Pre-set default limits; increases delayed, decreases immediate. Not a prompt | STRONG (null for prompts) |
| R11 | Every informational measure paired with a structural one | MODERATE |
| R12 | One real confirm step, not three weak gates; explicit cancel window | WEAK — flagged |
| R13 | Self-exclusion and cool-off within two taps, no support call, no retention offer | STRONG (normative) |
| R14 | Mirror M-Pesa: verify name+amount, immediate receipt with code, reconcilable history | MODERATE — flagged |
| R15 | No on-screen number without a traceable database source | STRONG |
| R16 | Every critical number coded three ways; never colour alone | MODERATE (dated) |
| R17 | 100-mark dot/icon array as the primary probability graphic; no hard-edged bands | STRONG / MODERATE |
| R18 | Y-axis always 0–100%; never auto-scale; axis-break glyphs do not excuse truncation | STRONG |
| R19 | Default chart range = full market life; no intraday view; no "hot in the last hour" | MODERATE-STRONG |
| R20 | Never a count without its denominator | STRONG |
| R21 | Written dark-pattern prohibition list as a merge gate; sludge audit for flow symmetry | STRONG |
| R22 | One decision = one visual block, no scroll boundary inside it | STRONG |
| R23 | Two tiers only; nothing legally required in Tier 2 | WEAK for the pattern, STRONG for the constraint |
| R24 | Money actions in the bottom half; confirm and cancel equally reachable and equally large | MODERATE-STRONG |
| R25 | Target WCAG AAA 44×44 and ≥4.5:1 contrast, verified outdoors | STRONG (normative) |

---

## 10. Full source list

Grouped by section; all URLs retrieved 2026-09-27.

**Probability presentation and numeracy**
Gigerenzer et al. 2007 (Psych Sci Public Interest) · Galesic, Gigerenzer & Straubinger 2009 (Med
Decis Making) · Hoffrage et al. 2002 (Cognition) · Kim 2024 (Med Decis Making) · Garcia-Retamero &
Cokely 2017 (Human Factors) · Garcia-Retamero, Galesic & Gigerenzer 2010 (Med Decis Making) ·
Zikmund-Fisher et al. 2014 (Med Decis Making) · Gigerenzer et al. 2005 (Risk Analysis) · "Not as
gloomy as we thought" (Essex repository) · NWS Precipitation Probability · Budescu, Broomell & Por
2009 (Psych Science) · Budescu et al. 2014 (Nature Climate Change) · Wintle et al. 2019 (PLOS ONE) ·
Spiegelhalter, Pearson & Short 2011 (Science) · Spiegelhalter 2017 (Annu Rev Stat Appl) · Fischhoff,
Brewer & Downs (eds.) 2011, *Communicating Risks and Benefits: An Evidence-Based User's Guide*, FDA,
https://www.fda.gov/media/81597/download

**Framing, loss aversion, payment psychology**
Kahneman & Tversky 1979 (Econometrica) · Tversky & Kahneman 1981 (Science) · Kahneman & Tversky 1984
(Am Psychologist) · Tversky & Kahneman 1992 (J Risk Uncertainty) · Prelec & Loewenstein 1998
(Marketing Science) · Soman 2003 (Marketing Letters) · Ma et al. 2024 (PsyCh Journal) · J Consumer
Policy 2022 on digital payment and financial vulnerability · OFT/London Economics 2010 partitioned
pricing · Rasch, Thöne & Wenzel 2020 (JEBO) · Santana, Dallas & Morwitz 2020 (Marketing Science) ·
CGAP disclosure blog **[GREY]**

**Responsible gambling, friction, limits**
Auer, Hopfgartner & Griffiths 2019 (Frontiers in Psychology) · Delfabbro & King 2021 (Int Gambling
Studies) · Ladouceur, Blaszczynski & Lalande 2012 (Int Gambling Studies) · Harm Reduction Journal
2025 limit-setting policy review · Auer & Griffiths 2015 (Frontiers) · Auer & Griffiths 2020 (Comput
Human Behav) · BIT 2022 **[GREY]** · Newall et al. 2022 (Addictive Behaviors) · Newall, Walasek &
Ludvig 2020 (Addiction) · Walasek, Newall & Ludvig 2023 (Addiction Research & Theory, registered
report) · Weiss-Cohen, Newall et al. 2025 (Addictive Behaviors) · Clark et al. 2009 (Neuron) · Chase
& Clark (striatal near-miss, PMC) · J Gambling Studies 2019 near-miss review · Scientific Reports
2024 within-session chasing · J Gambling Studies 2025 multidimensional loss chasing ·
Lopez-Gonzalez & Griffiths 2017 (Gaming Law Review) · Addictive Behaviors 2024 cash-outs ·
Newall et al. *Cue the sad trombone* (Behavioural Public Policy) · Pitt Law Review cooling-off
natural experiment · Games and Economic Behavior cooling-off model

**Trust, mobile money, low-literacy UI**
Jack & Suri 2014 (AER) · Safaricom fraud-awareness **[GREY]** · Rest of World 2023 **[GREY]** ·
Nturibi 2018 (USIU-Africa MSc thesis) · Kotut et al. 2025 (ACM COMPASS) · CGAP 2015 recourse brief
**[GREY]** · GSMA cybersecurity and mobile money **[GREY]** · Medhi, Gautama & Toyama 2009 (CHI) ·
Medhi et al. 2011 (ACM TOCHI) · PACM HCI 2021 low-literate guidelines · MIT Technology Review 2022
**[GREY]**

**Charts, uncertainty, numeric cognition**
Padilla, Kay & Hullman 2022 · Kay et al. 2016 (CHI) · Fernandes et al. 2018 (CHI) · Correll, Bertini
& Franconeri 2020 (CHI) · Yang et al. 2021 (JARMAC) · CHI 2026 truncation follow-up · Borsboom et al.
2022 (J Banking & Finance) · Barber, Huang, Odean & Schwarz 2022 (J Finance)

**Dark patterns and regulation**
Mathur et al. 2019 (PACM HCI / CSCW) · Gray et al., *What Makes a Dark Pattern… Dark?*
https://arxiv.org/pdf/2101.04843 · Narayanan et al., *Dark Patterns* (Communications of the ACM /
ACM Queue) https://cpb-us-w2.wpmucdn.com/voices.uchicago.edu/dist/1/2826/files/2020/12/darkpatternsqueue.pdf ·
Luguri & Strahilevitz, *Shining a Light on Dark Patterns*, J Legal Analysis 13(1):43
https://academic.oup.com/jla/article/13/1/43/6180579 · Mills & Sætra, *Dark patterns and sludge
audits*, Behavioural Public Policy · OECD 2022 *Dark Commercial Patterns* · CMA 2022 *Online Choice
Architecture* discussion paper and evidence review · BIT 2024 *Review of Online Choice Architecture
and Vulnerability* https://www.bi.team/wp-content/uploads/2024/07/Review-of-Online-Choice-Architecture-and-Vulnerability-July-2024-.pdf ·
EU DSA Art. 25 · EPRS 2025 Digital Fairness briefing · CHI 2026 *Dark Patterns and the EU Digital
Services Act* https://dl.acm.org/doi/full/10.1145/3772318.3791479

**Kenyan and regional law**
Gambling Control Act No. 14 of 2025 (Kenya Law) · GRA Conduct of Gambling Operations Regulations 2026
· Bowmans, *Kenya: The Gambling Control Act, 2025 — Key provisions* **[GREY, law-firm analysis]** ·
CM Advocates, *Gambling Control Act 2025: Rules & Compliance* **[GREY]**
https://cmadvocates.com/blog/regulatory-alert-enactment-of-the-gambling-control-act-2025/ ·
Glasgow systematic-review supplement, legal status by country ·
Tagoe et al. 2022, *Gambling in Sub-Saharan Africa* (PMC)

**Standards and cognitive load**
W3C WCAG 2.2 · Sweller, van Merriënboer & Paas 1998 (Educ Psych Rev) · Sweller 2010 (Instructional
Science) · Bergstrom-Lehtovirta & Oulasvirta 2014 (CHI) · Le et al. 2018 (CHI) · Eardley et al.
one-handed use · arXiv 2208.08734 action-bar adaptations · ACM IUI 2026 progressive disclosure
