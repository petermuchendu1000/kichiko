# 32 — Interaction, perception and trust on the phones our users actually hold

**Scope.** Binding interaction rules for Kichiko (layout, touch, type, colour, motion, performance,
onboarding, trust) derived from primary sources, for a mostly-Android, mobile-money, bilingual
audience in Kenya, Uganda, Tanzania and Rwanda. Money in KES, probability in %.

**Compiled:** 2026-09-27. Every source was retrieved on that date (full text, official abstract,
standard text, or the data publisher's own file). Where a primary source could not be retrieved it is
marked **UNVERIFIED** and nothing rests on it.

**Grades.**
- **STRONG**: meta-analysis, replicated experiments, a normative standard (W3C), or a national
  regulator's or statistics office's own data.
- **MODERATE**: one or two good experiments, a large but single dataset, or platform guidance
  (Apple HIG, Material 3). Platform guidance is convention, not experiment.
- **WEAK**: small n, observational, grey literature, or old device classes.
- **CONTESTED**: the literature disagrees.
- **INFERENCE**: my arithmetic or my transfer of a finding to Kichiko. The source does not make
  the claim.
- **M1**: I measured it myself this session with an instrument. The raw data is in
  [`data-32/`](data-32/).
- **Transfer** notes say when a finding comes from another population or device class.

**Access notes.** The ACM Digital Library, ScienceDirect, Oxford Academic, ITU DataHub, kenyalaw.org,
Safaricom's investor PDFs and DiVA all returned bot challenges or 403 to this sandbox. For ACM papers I
used full texts the authors host themselves (Microsoft Research, nhenze.net, tactuallabs.com,
research.google.com, ucalgary.ca). For Elsevier and OUP abstracts I used PubMed, ERIC or the
authors' institutional repository. Every such substitution is named in §6.

---

## 0. What changes as a result of this report

1. **The prior rules are mostly right but over-graded, and four citations were wrong.** Details in §1.
   The target-size rule, the "bottom half" reach rule and the "one block, no scroll" rule are
   defensible product decisions. They are not STRONG findings.
2. **The dominant way Kenyans lose mobile money is by sending it to the wrong place, not fraud.**
   FinAccess 2024 (n = 20,871 households, run by CBK, KNBS and FSD Kenya): 9.8% of mobile-money users
   reported losing money. Of those, **70.0% lost it through an accidental send**, against 19.5%
   through external fraud. This is the strongest local evidence in this report. It turns the
   "Hakikisha" verify-before-commit pattern from an inference (MODERATE) into a data-backed rule.
3. **Roughly 1 in 4 Kenyan adults cannot correctly read a standard transaction-cost SMS.** FinAccess
   2024: 72.7% could read one. The figure is 59.0% among people with primary education only, and 81%
   of people with no schooling could not read it. Fee display must be a single all-in KSh figure,
   not a breakdown the user has to add up.
4. **The audience is 36–44% on 360-CSS-px-wide screens, and 80–94% on Android.** Opera is 30% of
   Kenyan mobile page views. The design floor is 360×800 at DPR 2, not an iPhone.
5. **In sunlight, WCAG ratios lose their meaning.** A physical ambient-contrast model (Chen et al.
   2017) shows that on a 450-nit budget LCD at 10,000 lux, a text pair with a 4.5:1 WCAG ratio falls
   to about 2.7:1. A dark-mode secondary grey with an 8.9:1 WCAG ratio falls to about 2.5:1, which is
   *worse* than the light-mode AA grey. Contrast rules need a luminance-difference floor (ΔY), not
   only a ratio.
6. **Polymarket's mobile home page weighs 10–12.5 MB, including about 5.5–6 MB of compressed
   JavaScript across 204–211 scripts.** Its LCP is 6.1 s on Slow 4G with a 4× CPU slowdown (M1, one
   run). At Safaricom's KSh 250 per GB, one visit costs about KSh 2.50, which is 12.5% of a KSh 20
   stake. Our budget (§3) comes to about KSh 0.10.
7. **KYC must happen before the first deposit, not before browsing.** GRA Conduct Regulations 2026,
   Reg. 85 (draft Legal Notice, number blank): identity, location and age checks come "prior to player
   account activation and receipt of any wagering deposit". Everything up to the deposit can be done
   without an account.

---

## 1. Re-verification of prior claims

Scope: `24-PSYCHOLOGY.md` §4, §7 and §8, rules 14–15 of `20-WORK-PLAN.md` §3, and the §0 claims those
sections rely on.

| # | Prior claim (where) | Verdict | What the primary source says / correction |
|---|---|---|---|
| 1 | Mobile-money trust rests on verify-before-commit (Hakikisha) plus a durable receipt; R14 (24 §4.1) | **CONFIRMED, and strengthened** | Hakikisha is real. It shows the recipient's name before the transaction completes (Safaricom FAQ page; CGAP blog, 28 Oct 2015). CGAP 2015: erroneous transfers were "at least 60–70%" of calls to Safaricom's call centre, about 12,000 reversal calls a day [GREY]. **New primary:** FinAccess 2024 finds 70.0% of mobile-money losses come from accidental sends. The rule now rests on national survey data. |
| 2 | Safaricom material shows "fake confirmation SMS" is a prevalent attack (24 §4.1) | **UNVERIFIABLE** | `safaricom.co.ke/fraud-awareness/m-pesa-fraud` returned 403. Nothing may rest on this claim. |
| 3 | "Kotut, L., et al. (2025). *Financial Grift* (COMPASS 2025)" (24 §4.1) | **WRONG citation** | The paper is Doğan, A. L., Gilbert, M., & Kotut, L. (2025), *Easy Come, Easy Go: Phone Enabled Small-Scale Financial Grift*, COMPASS '25, doi:10.1145/3715335.3736315. It is a **survey of 73 Kenyans**. The most common scams were M-PESA impersonation, lucky draws, loan offers, job offers and education-related scams. WEAK (n = 73). |
| 4 | Nturibi (2018) USIU MSc thesis (24 §4.1) | **UNVERIFIABLE** | The server's TLS chain fails verification. I did not bypass TLS. |
| 5 | "No controlled study … measures which interface signals raise trust" (24 §4.1, §8 item 1) | **OVERSTATED** | It holds for East African mobile money: I found none. It is not true in general. Ozpolat, Gao, Jank & Viswanathan (SSRN 2010) is a **randomised field experiment** (more than 250,000 transactions, 493 US retailers) in which a trust seal raised the odds of completing a purchase, and *too many* seals lowered completion. Transfer to Kenya is unknown. |
| 6 | Jack & Suri 2014 (AER 104(1):183–223) (24 §4.1) | **CONFIRMED** | The exact title is "…Risk Sharing and Trans*actions* Costs…". This is a cosmetic error. |
| 7 | Mathur et al. 2019: 157 fake countdown timers, 29 fabricated activity notifications, 17 deceptive low-stock messages (24 §4.2; 20 rule 12) | **CONFIRMED** | Full text (arXiv 1907.07032): 157 *deceptive* countdown timers on 140 sites, 29 deceptive activity notifications on 20 sites, and 17 deceptive low-stock messages on 17 sites. These come from about 53K product pages on about 11K shopping sites (1,818 dark-pattern instances in total). The population is US-centric e-commerce. |
| 8 | Medhi 2009 (CHI) and Medhi 2011 (TOCHI) (24 §4.3) | **CONFIRMED** (metadata) | The studies were run in India and are 15 or more years old. That was already flagged. |
| 9 | "Nalwadda / Chaudry-style guidance: *Actionable UI Design Guidelines… Low-Literate Users*, PACM HCI 2021" (24 §4.3) | **WRONG attribution** | Crossref lists the authors as Srivastava, Kapania, Tuli & Singh (2021), doi:10.1145/3449210. "Nalwadda / Chaudry" appears nowhere. |
| 10 | "Sweller, J. (2010) … *Cognitive load theory, educational research, and instructional design: some food for thought*" (24 §7.1) | **WRONG attribution** | The author is **T. de Jong** (Instructional Science 38; online 2009, doi:10.1007/s11251-009-9110-0). It is a *critique* of cognitive load theory, not Sweller's own work. |
| 11 | Split-attention is "STRONG", so R22 and work-plan rule 15 are STRONG (24 §7.1; 20 rule 15) | **OVERSTATED** | Ginns 2006 meta-analysis (50 independent studies; abstract via ERIC) supports spatial and temporal contiguity, especially for *complex learning material*. The effect is STRONG in instructional settings. Applying it to a trade ticket is an **inference**, so the grade for this UI rule is **MODERATE**. |
| 12 | R22: the decision block must fit a "360×640 logical viewport" (24 §7.1) | **OVERSTATED / ambiguous** | StatCounter reports *screen* sizes. 360×640 screens are only 1.5–3.4% of mobile page views. The modal screens are 360×800 and 360×806. The browser *viewport* is shorter than the screen because of the status bar, URL bar and navigation bar. The rule must name a viewport (see K32-06), not a screen. |
| 13 | Progressive disclosure is WEAK (IUI 2026, Anik & Bunt) (24 §7.2) | **CONFIRMED** | The metadata is correct. The study is about ML training-data explanations, so its relevance is weak, as the prior report said. |
| 14 | Heading "One-handed reach: the bottom third is the reliable zone"; R24 "money actions in the bottom half" (24 §7.3; 20 rule 14) | **OVERSTATED** | (a) Parhi et al. 2006 (n = 20): **no significant effect of screen location on error rate**. Comfort was lowest in the NW and SW regions (3.7/7), and users wanted the largest targets in the NW, SW and **SE corners**. (b) Henze et al. 2011 (120.6M touches, in the wild): error is higher **at every screen border**, 31.68% against 17.59% in the centre (HTC Wildfire, targets under 12 mm). (c) Bergstrom-Lehtovirta & Oulasvirta 2014 model a reach region that depends on grip, hand size and device size. They do not prescribe "bottom half". The reliable zone is the **centre-to-lower-middle band, away from the bottom edge and the corners**. |
| 15 | Le, H. V., Mayer, S., **Bachynskyi, M.**, Henze, N. (2018) (24 §7.3) | **WRONG author** | Crossref lists Le, Mayer, **Bader**, Henze. The study has n = 16 and is mainly about back-of-device and edge reach for fingers other than the thumb. |
| 16 | "Eardley, R., et al. *Understanding One-Handed Use of Mobile Devices*" (24 §7.3) | **WRONG attribution** | Crossref: that title is **Karlson, Bederson & Contreras-Vidal (2008)**, a chapter in an IGI handbook (doi:10.4018/978-1-59904-871-0.ch006). |
| 17 | One-handed use is common in the field (24 §7.3) | **CONFIRMED, WEAK** | Hoober 2013 (UXmatters, grey): 1,333 observations in US public places, 780 of people touching the screen. 49% were one-handed, 36% cradled the phone, 15% used two hands. There is no demographic data and no device data, and the largest phone seen was a Galaxy Note 2. Transfer to 2026 Kenya on 6.7″ phones is **unknown**. |
| 18 | WCAG 2.2: 24×24 AA (2.5.8), 44×44 AAA (2.5.5), 4.5:1 / 3:1 (1.4.3) (24 §7.4) | **CONFIRMED** | W3C Recommendation, 12 Dec 2024. Large text means ≥ 18 pt, or ≥ 14 pt bold (24 px / 18.66 px). |
| 19 | "44×44 minimum targets … STRONG" (20 rule 14; R25) | **OVERSTATED** | The *normative minimum* is 24×24 (AA). 44×44 is AAA. Apple's HIG gives **44×44 pt as the iOS *default* and 28×28 pt as the *minimum***. Material recommends **≥ 48×48 dp**. Choosing 44/48 is well supported (Parhi's 9.2 mm ≈ 47 CSS px on a 360-wide Android phone), but it is a **product rule graded MODERATE**, not a STRONG finding. |
| 20 | "≥ 4.5:1 contrast, verified outdoors" (20 rule 14; R25) | **OVERSTATED** (insufficient) | Outdoors, WCAG ratios collapse, and they collapse *differently* in dark mode. See §2.3 and §2.4. A ratio floor alone does not guarantee sunlight legibility. |
| 21 | "83% preferred the English menu, 65% never used Kiswahili" (EAST-AFRICA §, relied on in 24 §0 and §4.3) | **OVERSTATED** | Wandera, A. S. (2015), JoSTrans 24. **30 questionnaires, Nairobi County only**, plus key-informant interviews. The numbers are quoted correctly, but the evidence is **WEAK** and must not drive a language policy on its own (§2.9). |
| 22 | M-Pesa is the rail, "~88%" (24 §0) | **CONFIRMED in a different sense** | CA Kenya Q4 FY2025/26: **Safaricom holds 88.8% of mobile-money subscriptions** (54.0M subscriptions, June 2026). The separate claim that "88% of bettors transact by phone" was **not verified**. |
| 23 | Safaricom fraud page, GSMA cyber page, ResearchGate item (24 §4.1, §7.3) | **UNVERIFIABLE** (403) | Rest of World 2023 and the CGAP 2015 recourse brief are reachable (HTTP 200). Their content was not re-read. |

**Pattern.** The substantive direction of the prior work holds. The errors are **over-grading**
(convention presented as evidence) and **citation hygiene** (four wrong author attributions). None
of the errors reverses a rule. Three rules change shape: reach (K32-05), contrast (K32-28) and the
single-block viewport (K32-06).

---

## 2. Findings → rules → acceptance criteria, by topic

Rule IDs are `K32-nn`. Each rule has a grade and a test a PR can fail on. "Money routes" means
market detail, the ticket or sheet, confirm, receipt, deposit, withdraw, wallet and portfolio.

### 2.1 Device and network reality

**Findings**

| Measure | Kenya | Uganda | Tanzania | Rwanda | Source, grade |
|---|---|---|---|---|---|
| Mobile OS, Android / iOS, 13-month mean (Aug 2025–Aug 2026) | 93.6 / 5.9 | 91.8 / 8.1 | 92.8 / 6.8 | 80.3 / 19.4 | StatCounter, page-view share, STRONG as a page-view sample |
| Same, Aug 2026 only | 92.9 / 6.7 | 91.0 / 9.0 | 88.8 / 10.9 | 78.0 / 21.7 | StatCounter |
| Mobile browsers (mean) | Chrome 62.2, **Opera 30.1** (Opera 15+ 28.1, Opera Mini 1.7), Safari 3.9, Samsung Internet 1.9 | Chrome 82.0, Opera 8.1 (Mini 2.5), Safari 5.9 | Chrome 77.0, Opera 14.0 (Mini 2.4), Safari 5.2, KaiOS 0.3 | Chrome 75.1, Safari 12.1, Opera 9.6 (Mini 2.0) | StatCounter browser and version |
| Vendor (mean) | Samsung 27.5, Unknown 14.2, Tecno 14.1, Oppo 8.1, Infinix 7.0, Nokia 6.6, Apple 5.8 | Samsung 33.2, Tecno 20.9, Infinix 8.5, Apple 7.9, itel 4.8 | Samsung 33.7, Unknown 15.3, Infinix 14.3, Tecno 8.4, Apple 6.7 | Samsung 25.0, Apple 19.0, Tecno 16.5, Infinix 9.6 | StatCounter |
| Screen width = 360 CSS px (% of all mobile page views) | **34.9** | **43.9** | **35.6** | **33.1** | StatCounter resolution, aggregated Aug 2025–Aug 2026 |
| Width < 360 | 1.2 | 2.3 (320×640 = 2.26) | 3.1 | 1.5 | same |
| Top 4 screens | 360×800 16.1 · 360×806 10.6 · 385×854 9.6 · 412×915 8.4 | 360×806 16.2 · 360×800 13.5 · 385×854 7.9 · 412×915 4.9 | 360×800 12.5 · 360×806 11.7 · 385×854 8.7 · 412×915 8.4 | 360×806 13.3 · 360×800 10.3 · 414×896 6.2 · 385×854 4.7 | same; "Other" = 24.6–29.3% not resolved |
| Screen height < 700 (% of identified) | 3.7 | 7.5 | 8.6 | 13.4 | same (RW: 384×684 3.6, 375×667 1.6) |
| Android ≤ 9 (% of Android page views) | 9.3 | 16.9 | 14.1 | 14.5 | StatCounter Android version |
| Android ≥ 13 | 57.5 | 47.7 | 52.7 | 47.2 | same |

**StatCounter caveat (important).** In StatCounter, Kenya's *desktop* share jumps from 38.1% (Aug 2025)
to 70.0% (Aug 2026). Mobile was 66–75% throughout 2021–2024. Uganda and Tanzania show the same drift.
This is almost certainly a change in the sample (tracked sites, or non-human traffic), not people
abandoning phones. **Do not cite StatCounter's desktop-vs-mobile split for 2026.** The within-mobile
distributions above (OS, resolution, browser) are unaffected by that split, but they remain page-view
samples from sites that run StatCounter, not a user census. Grade: **MODERATE** for design decisions.

**Kenya, regulator data (CA Kenya, *Sector Statistics Report Q4 2025/26*, Apr–Jun 2026, published Sept 2026).** STRONG.
- 88.0M SIMs (165.0% penetration), 97.1% prepaid. **54.0M mobile-money subscriptions** (101.3%);
  568,463 agents. **Safaricom share: 69.8% of subscriptions, 64.4% of mobile broadband, 88.8% of
  mobile money.**
- Mobile data subscriptions 64.26M: **2G 9.34M (14.5%) · 3G 4.51M (7.0%) · 4G 48.31M (75.2%) ·
  5G 2.10M (3.3%)**.
- Broadband traffic, Apr–Jun 2026, 933.9M GB: 3G 4.0%, **4G 81.5%**, 5G 14.5%. That is about 17.0 GB
  per broadband subscription per quarter.
- Devices on network: **52.26M smartphones and 27.42M feature phones (34.4% feature phones)**.

**Speed.**
- Ookla Speedtest Intelligence, H1 2025 (article, 5 Nov 2025): Safaricom median download 43 Mbps and
  upload 15.11 Mbps, more than 2.4× Airtel Kenya. Airtel Kenya's upload of 6.15 Mbps was the lowest
  of 19 operators reviewed in sub-Saharan Africa. 4G availability is about 91% for both operators.
- Speedtest Global Index, Aug 2026: Kenya, Uganda and Rwanda mobile are **not ranked** (they fall
  below the precision threshold). Tanzania mobile median is 32.61 down / 10.96 up / 26 ms.
- Grade: MODERATE. These are medians of user-initiated tests, which skew towards engaged users on
  better devices, and they measure throughput. Page-load time on phones is dominated by RTT and CPU,
  not by peak throughput.

**Price of data (Safaricom tariff page, 27 Sep 2026).** 1 GB = KSh 250 (30 days), 2.5 GB = KSh 500,
7 GB = KSh 1,000, 20 GB = KSh 2,000. At the 1 GB tier that is **KSh 0.244 per MB**. The A4AI and ITU
country price tables could not be retrieved (ITU DataHub 403). ITU's *Affordability of ICT services
2025* PDF gives only regional medians against the Broadband Commission's 2%-of-GNI target.

**Devices.**
- Omdia press release, 20 Aug 2026: Africa smartphone shipments fell 7% year on year in 2Q26. Sub-$100
  fell 34%. **Kenya fell 15%, "demand concentrated in the sub-$150 segment."** Africa ASP rose to
  **$202**. Samsung Galaxy **A07** and **A17** are named as key volume models.
- Samsung Africa's A07s SKU: 4 GB RAM, 64 GB, 6.7″ 90 Hz, CPU "2.2 GHz, 2 GHz" (spec page).
- Russell 2026 (grey, but methodical) puts the *global* P75 device at Galaxy A24 4G class (Helio G99 /
  Exynos 1330; A07 4G listed as equivalent) and the P75 network at 9 Mbps / 3 Mbps / 100 ms.
  **INFERENCE:** our audience sits *below* global P75, given sub-$150 demand, 21.5% of data
  subscriptions on 2G/3G, and 9–17% of page views on Android ≤ 9.

**Rules**

- **K32-01 Design floor = 360×800 at DPR 2, Android Chrome.** Every layout is designed and reviewed
  here first. 320 px must reflow without horizontal scroll (WCAG 1.4.10). Grade MODERATE (data).
  *Test:* Playwright visual snapshots of every route at 360×800@2 and 320×640@2. At 320,
  `document.documentElement.scrollWidth <= 320`.
- **K32-02 Opera and Opera Mini are supported browsers.** Opera (Chromium-based) runs the full app.
  Opera Mini (Presto proxy, 1.7–2.5%) receives server-rendered read-only pages with a working "open in
  your browser" path. Grade MODERATE (data).
  *Test:* e2e happy path on Opera for Android (real device, monthly). The SSR HTML of the market page
  contains the question, the % and the close time with JS disabled (Playwright, `javaScriptEnabled:false`).
- **K32-03 Ship real-user monitoring (RUM) before trusting any of the above.** Collect viewport,
  DPR, `navigator.deviceMemory`, `hardwareConcurrency`, `connection.effectiveType`, UA-CH platform
  version, and CWV. Replace StatCounter with our own users' data within 30 days of launch. Grade:
  required by the evidence gaps.
  *Test:* the RUM beacon is present on all routes, weighs ≤ 2 KB, and sends nothing when the page is hidden.

### 2.2 Touch ergonomics

**Findings**

| Source | Population and method | Key numbers | Grade, transfer |
|---|---|---|---|
| Parhi, Karlson & Bederson 2006 (MobileHCI; author PDF via Microsoft Research) | n = 20 (17 M, 3 F), right-handed, 19–42 y. HP iPAQ h4155, 3.5″, 240×320. One-handed thumb | No significant error difference for discrete targets **≥ 9.6 mm**, or serial targets ≥ 7.7 mm. Recommend **9.2 mm discrete, 9.6 mm serial**. No significant location effect on errors. Comfort lowest NW and SW (3.7/7); largest targets wanted NW, SW, SE | MODERATE; 2006 hardware, small n |
| Henze, Rukzio & Boll 2011 (MobileHCI; author PDF) | 91,731 installs, 120,626,225 touches, Android game in the wild, circles under time pressure | Error "dramatically increases" **below 15 mm**, and exceeds 40% below 8 mm. Border 31.68% vs centre 17.59% (targets under 12 mm). An offset compensation function cut errors by 7.79% (12,201 installs) | MODERATE; absolute rates inflated by time pressure; authors say relative differences transfer |
| Bergstrom-Lehtovirta & Oulasvirta 2014 (CHI) | Model of the thumb's functional area | Reach depends on surface size, hand size and index-finger position. Quadratic maximum-range curves, average R² = .958 (as reported in Le et al. 2018) | MODERATE; full text unavailable (ACM block; author host outside allowlist) |
| Hoober 2013 (UXmatters) | 1,333 street observations, US | One-handed 49%, cradled 36%, two-handed 15%. Of one-handed users, 67% used the right thumb | WEAK (grey, no demographics, pre-2013 phones) |
| Lagun et al. 2014 (SIGIR; Google PDF) | n = 24 analysed (30 recruited), eye tracking on a phone | Attention concentrated in the **top half**. Mean gaze y = 224 px against a screen centre of 290 px | MODERATE; search task |
| WCAG 2.2 | Normative | 2.5.8 AA: 24×24 CSS px, or 24 px spacing circles. 2.5.5 AAA: 44×44 | STRONG (normative) |
| Apple HIG, Accessibility and Buttons (2025–26) | Platform guidance | iOS control **default 44×44 pt, minimum 28×28 pt**. Buttons "hit region of at least 44x44 pt". Padding about 12 pt around bezeled elements, about 24 pt around non-bezeled | MODERATE (convention) |
| Material 3, Structure → Target sizes | Platform guidance | **≥ 48×48 dp**, "about 9mm". 7–10 mm recommended. **8 dp** between targets. Pointer 44 dp | MODERATE (convention). Note: nominal 48 dp = 48/160″ = 7.6 mm, so "9 mm" holds only on devices whose density bucket rounds up (INFERENCE) |

**Physical-size arithmetic (INFERENCE; assumes typical panel sizes).** A 6.7″ 20:9 phone at
360×800 CSS px is 69.8 mm wide, so **1 CSS px ≈ 0.194 mm**:
- 44 px = 8.5 mm; 48 px = 9.3 mm; Parhi's 9.2 mm = **47 px**.
- A 6.7″ 412×915 phone: 1 px ≈ 0.170 mm, so 48 px = 8.1 mm.
- iPhone 390×844 (6.1″): 1 px ≈ 0.166 mm, so 44 px = 7.3 mm.

A CSS pixel is physically *larger* on the budget Androids that dominate our traffic than on iPhones.
Apple's 44 pt is therefore more generous on our users' phones than on Apple's own.

**Rules**

- **K32-04 Target sizes.**
  - Every interactive element on money routes has a hit box of **≥ 44×44 CSS px**.
  - **Commit actions** (Yes, No, Buy, Confirm, Deposit, Withdraw, Cancel) are **≥ 48 px tall**.
  - Adjacent targets have **≥ 8 px** between hit boxes.
  - Inline text links are exempt only outside the commit block (WCAG inline exception).
  - Grade MODERATE (Parhi + platform convention; the normative floor is 24).
  - *Test:* a Playwright crawl at 360×800 of every money route, over `a, button, input, select,
    [role=button|tab|radio|checkbox|switch|link], [tabindex="0"]`. Fail if the rect is under 44 on
    either axis, if a `[data-commit]` element is under 48 tall, or if the edge gap to another target
    is under 8 px.
- **K32-05 Placement.**
  - Information sits top and centre (where attention lands: Lagun).
  - Commit actions sit in the **lower-middle band**: vertical centre between 55% and 85% of the
    viewport height, horizontally inset ≥ 16 px from the edges, never in a bottom corner.
  - Confirm and Cancel are the same size and equally reachable.
  - Destructive and irreversible actions are never the bottom-most, edge-adjacent element.
  - Grade MODERATE (Parhi, Henze, BL&O).
  - *Test:* in the ticket, `[data-commit]` rect centre y ∈ [0.55, 0.85] × innerHeight at 360×800 and
    at 412×915. Yes/No and Confirm/Cancel pairs have equal width and height (±1 px).
- **K32-06 One decision per screen, measured on a viewport.** The commit group (amount, "Most you
  can lose", "If right you get", all-in fee, Confirm) is never split by a scroll boundary at a
  **360×640 CSS viewport**. INFERENCE: a 360×800 screen minus the status bar, URL bar and navigation
  bar leaves roughly 650–700 px; 640 leaves margin. At 360×560 (the short-screen cohort) the
  commit group may sit below the fold but must still be contiguous. Grade MODERATE.
  *Test:* at viewport 360×640, the commit group's bounding box sits wholly inside `innerHeight`
  after the ticket opens. At 360×560 the group is contiguous (no element outside it lies between
  its first and last child).

### 2.3 Legibility

**Findings**

- **Viewing distance.** Bababekova et al. 2011 (Optom Vis Sci; n = 129 and n = 100, US): mean phone
  distance **36.2 cm for texting and 32.2 cm for web** (ranges 17.5–58 cm and 19–60 cm). MODERATE.
- **Print size.** Legge & Bigelow 2011 (J Vision, review): fluent reading holds across x-heights of
  about **0.2° to 2°** of visual angle. The lower end, about 0.2°, is the critical print size for
  normal vision. STRONG (psychophysics).
- **Arithmetic (INFERENCE).** Roboto-like x-height ≈ 0.53 em, viewed at 32.2 cm, on a 360-wide 6.7″
  phone:
  - 11 px = 0.200°, 12 px = 0.219°, 13 px = 0.237°, **16 px = 0.291°**, 20 px = 0.364°.
  - On a 412-wide phone, 12 px falls to 0.191°, *below* the critical print size.
  - 16 px gives about a 1.3–1.45× reserve over the critical size for normal vision.
- **Presbyopia and near vision in our population.**
  - Fricke et al. 2018 (Ophthalmology, meta-analysis plus model): 1.8 bn people with presbyopia in
    2015, 826 M of them with near-vision impairment from no or inadequate correction; the burden is
    greatest in rural areas of low-resource countries.
  - GBD 2020 (Lancet Glob Health 2021): 510 M people with near-vision impairment from uncorrected
    presbyopia.
  - **Kenya (Sherwin et al. 2008, Rift Valley, ages ≥ 50, n = 130): functional presbyopia 85.4%,
    only 5.4% wore reading glasses, correction coverage 6.3%.**
  - STRONG (global), WEAK-MODERATE (Kenya-specific: small and old). **Implication:** older users
    are largely uncorrected. Any text below about 13 px locks them out.
- **Platform type scales (verified tables).**
  - Apple iOS Dynamic Type at the default "Large" size: Large Title 34/41, Title 1 28/34, Title 2
    22/28, Title 3 20/25, Headline 17/22 semibold, **Body 17/22**, Callout 16/21, Subhead 15/20,
    **Footnote 13/18**, Caption 1 12/16, Caption 2 11/13. HIG minimum 11 pt; the default body is 17 pt.
  - Material 3: Headline M 28/36, Title L 22/28, **Body L 16/24**, Body M 14/20, Body S 12/16,
    Label L 14/20, Label S 11/16. Sizes are identical across the baseline and emphasized sets; I read
    the emphasized weights only.
- **Polarity.**
  - Buchner & Baumgartner 2007: proofreading better on positive polarity (dark on light),
    independent of ambient light.
  - Piepenbrock et al. 2013: the advantage holds for younger *and* older adults.
  - Piepenbrock et al. 2014: pupils are smaller with positive polarity; the proposed mechanism is
    display luminance.
  - Dobres et al. 2017: legibility thresholds were worst for **negative polarity in the dark**; under
    bright ambient light, all conditions performed similarly.
  - Grade: STRONG that positive polarity is at least as legible. The dark-mode penalty is
    **CONTESTED** in bright light.
- **Sunlight.** Chen, Tan & Wu 2017 (Optics Express) give the physical ambient contrast ratio:
  ACR = (L_on + R_L·E/π) / (L_off + R_L·E/π). The cover-glass reflectance of a smartphone without an
  anti-reflection coating is **4.2%**. STRONG (physics). I applied it to real colour pairs (INFERENCE;
  the 450-nit peak is an assumption until we measure):

| Pair | WCAG | 450 nit, 1k lx | 450 nit, **10k lx** | 450 nit, 50k lx | 300 nit, 10k lx |
|---|---|---|---|---|---|
| #1a1a1a on #fff (body) | 17.4 | 25.7 | **4.2** | 1.7 | 3.2 |
| #595959 on #fff (7:1 grey) | 7.0 | 7.9 | **3.3** | 1.6 | 2.7 |
| #767676 on #fff (4.5:1 grey) | 4.5 | 4.9 | **2.7** | 1.5 | 2.3 |
| Polymarket YES tint #007e26 on #d9f0e2 (from [23]) | 4.36 | 4.7 | **2.5** | 1.4 | 2.1 |
| #fff on #121212 (dark primary) | 18.7 | 28.8 | **4.3** | 1.7 | 3.2 |
| #b3b3b3 on #121212 (dark secondary) | **8.9** | 13.4 | **2.5** | 1.3 | 2.0 |

  Outdoors, legibility tracks the **luminance difference ΔY** (0–1), not the WCAG ratio. The dark
  secondary grey has 1.9× the WCAG ratio of the light AA grey but *less* outdoor contrast, because its
  ΔY is 0.45 against 0.82.
- **Tabular figures.** OpenType `tnum` "replaces figure glyphs set on proportional widths with …
  uniform (tabular) widths". CSS `font-variant-numeric: tabular-nums` maps to it. No empirical study
  found; the rule is typographic practice plus the need to align changing prices (normative / INFERENCE).
- **Line length.** WCAG 1.4.8 (AAA): no more than 80 characters. At 360 px with 16 px margins, 16 px
  text gives about 40–45 characters, so the limit binds only on tablet and desktop.

**Rules**

- **K32-07 Type floor.**
  - Body and decision text **≥ 16 px**.
  - **Money figures and probability in the ticket ≥ 20 px.** The hero number on the detail page
    follows the PM-derived 28 px / 600 (work-plan §2).
  - Secondary text ≥ 14 px. Captions ≥ 13 px.
  - **Nothing essential below 13 px, and nothing below 12 px at all.**
  - Legal disclosures (18+, licence, risk) ≥ 14 px, because they are required content, not decoration.
  - Grade MODERATE (Legge, HIG and M3 convergence, local presbyopia data).
  - *Test:* walk every text node on all routes at 360×800. Fail on any computed `font-size` < 12 px,
    any node < 13 px unless it carries `[data-nonessential]`, and any `[data-money]` or `[data-prob]`
    in the ticket < 20 px.
- **K32-08 Text scales.** All type in `rem`, and layout survives **200% text zoom** (WCAG 1.4.4) and
  the WCAG 1.4.12 spacing overrides. Grade STRONG (normative).
  *Test:* Playwright sets the root font-size to 200% and injects the 1.4.12 CSS. No clipped text
  (`scrollHeight ≤ clientHeight + 1` on text containers) and no horizontal scroll at 360 px.
- **K32-09 Tabular numerals everywhere a number can change.** `font-variant-numeric: tabular-nums
  lining-nums` on `[data-money]`, `[data-prob]`, tables and counters. The font chosen must ship a
  `tnum` feature. Grade: normative (OpenType, CSS Fonts 4).
  *Test:* computed style check on every `[data-money]` and `[data-prob]`. When a price updates, the
  element's width stays within ±1 px.

### 2.4 Colour

**Findings**

- **Colour-vision deficiency in African populations.**
  - Tilahun et al. 2024 (PLoS One, systematic review and meta-analysis, 16 African studies): pooled
    prevalence **2.71%** (95% CI 2.28–3.14); **males 2.13%, females 0.34%**; highest in Ethiopia at
    3.63%. STRONG, though mostly school samples, and Ethiopia dominates.
  - Jeong et al. 2025 (Ophthalmology; 56 studies, 1.70 M children and adolescents, 21 countries):
    African descent 2.69%, Africa region 2.86%, global males 4.38% vs females 0.64%. **Deutan types
    are the most common.** STRONG.
  - Kenya specifically: Sunderland & Rosa 1976 (n = 504; lower than Libya); Oppolzer & Winkler 1980
    (1,008 Bantu: 0.55% of males; 295 Nilotes: 1.03% of males; none among females; a single Ishihara
    plate, 11). WEAK (old, single-plate).
  - Birch 2012 (review): about 8% of European men.
  - **Correction to a common assumption:** red-green CVD is roughly **one-third to one-half** as
    common here as in Europe. It is **not negligible**: about 1 in 45 male users.
- **Colour semantics in East Africa.**
  - The only primary source I found is a Kenyan qualitative front-of-pack study (Nutrients 2024;
    12 focus groups, n = 137, 4 counties). Red/green octagon labels caused **"confusion with the
    colour meanings"**. The black warning label *with text* was best understood.
  - Apple HIG: red "communicates danger in some cultures, but has positive connotations in other
    cultures". Apple's own example is that red marks a rising price in the Chinese Stocks app.
  - **No primary source was found on red/green meaning for money or probability in Kenya, Uganda,
    Tanzania or Rwanda.**

**Rules**

- **K32-10 YES/NO are carried by words and position, never by hue.** Every outcome control shows
  the word (Yes / No, or Ndiyo / Hapana in sw). Hue is a redundant cue only, and is **equal in
  luminance and saturation** across YES and NO so that neither side reads as favoured. Directional
  price changes carry a sign glyph (▲ +3 / ▼ −3), not colour alone. Grade STRONG (WCAG 1.4.1,
  normative) + MODERATE (Kenyan red/green confusion; CVD data).
  *Test:* (a) every `[data-outcome]` has visible `innerText` matching the outcome label; (b) a
  screenshot of the ticket under a deuteranopia colour-matrix filter and under `grayscale(1)` still
  passes (a) and the layout snapshot; (c) the relative luminance of the YES and NO fills differs by
  ≤ 0.05.
- **K32-11 Positive polarity by default; honour the system theme.** With no stated preference the
  app renders light. When `prefers-color-scheme: dark` is set, it renders the tuned dark theme. The
  theme is never auto-switched by time of day. Grade MODERATE (polarity literature; the dark penalty
  in bright light is contested).
  *Test:* Playwright `emulateMedia({colorScheme:'no-preference'})` gives light;
  `colorScheme:'dark'` gives dark.

### 2.5 Perceived performance, feedback and motion

**Findings**

- **Touch latency perception.**
  - Deber, Jota, Forlines & Wigdor 2015 (CHI; author PDF; n = 14, 24 sessions): mean just-noticeable
    latency difference for **direct-touch tapping = 69 ms**, dragging 11 ms. Indirect input: 96 ms
    tapping, 55 ms dragging.
  - Jota et al. 2013 (CHI; n = 45 in the performance study): performance falls as latency rises;
    "no participant could discern latency for land-on below 20 ms".
  - The commercial devices studied then showed 50–200 ms of latency.
  - STRONG for the psychophysics. The hardware is lab touch rigs.
- **Web response thresholds (normative industry).** web.dev (updated 2025): **LCP ≤ 2.5 s, INP ≤ 200 ms,
  CLS ≤ 0.1**, all at p75, segmented by mobile and desktop. Poor means > 4 s, > 500 ms and > 0.25.
- **The "0.1 s / 1 s / 10 s" limits** (Miller 1968; Card, Robertson & Mackinlay 1991) are
  **UNVERIFIED** here: the ACM full text was blocked. Crossref confirms the metadata only. Nothing
  below depends on them.
- **Skeletons vs spinners.** Mejtoft, Långström & Söderström 2018 (ECCE) is the usual citation. Its
  primary text and abstract were **not retrievable** (ACM block; DiVA reset), so it is UNVERIFIED.
  Apple HIG *Loading*: "Show something as soon as possible… consider showing placeholder text,
  graphics, or animations as content loads". That is convention.
- **Motion guidance.**
  - Apple HIG *Motion*: add motion purposefully; make it optional; "brevity and precision in feedback
    animations"; "avoid adding motion to UI interactions that occur frequently"; let people cancel
    motion. With Reduce Motion on, replace x/y/z transitions with fades and avoid z-axis depth
    animation.
  - Material 3 tokens:
    - Durations: short 50–200 ms, medium 250–400 ms, long 450–600 ms.
    - Standard easing `cubic-bezier(0.2, 0, 0, 1)`; emphasized decelerate `(0.05, 0.7, 0.1, 1)`;
      emphasized accelerate `(0.3, 0, 0.8, 0.15)`.
    - Suggested pairs: enter 250–400 ms, exit 200 ms, on-screen 300–500 ms.
    - **Note:** M3 now marks easing and duration "no longer maintained" in favour of springs.
  - Grade MODERATE (convention).
- **Vestibular.**
  - WCAG 2.3.3 (AAA): interaction-triggered motion can be disabled. 2.2.2 (A): pause, stop or hide
    auto-moving content that lasts more than 5 s. 2.3.1 (A): no more than 3 flashes per second.
  - Media Queries Level 5 (WD, 19 Feb 2026) §12.1 `prefers-reduced-motion`.
  - Agrawal et al. 2009 (NHANES, n = 5,086, US adults ≥ 40): 35.4% had vestibular dysfunction on a
    postural test. WEAK transfer: a US sample, and postural balance is not the same as motion
    sensitivity.

**Rules**

- **K32-12 Feedback inside one frame, independent of JavaScript.** Every tappable element has a CSS
  `:active` state (colour or opacity change, no layout shift) that does not wait for hydration or a
  handler. Money commits switch to an in-button pending state ("Confirming…") on the same frame. Grade
  STRONG (69 ms tap JND) + normative (INP).
  *Test:* (a) a CSS audit finds an `:active` rule for every interactive component class; (b) a
  Playwright trace at 4× CPU measures pointerdown to the next paint as ≤ 100 ms on the ticket buttons;
  (c) field **INP p75 ≤ 200 ms** on money routes (RUM).
- **K32-13 No optimistic money state.** Balances, positions and receipts change only on server
  confirmation. Until then the UI shows an explicit *Pending* state carrying the amount. Non-money UI
  (watchlist, filters) may be optimistic. Grade MODERATE (FinAccess: 21.1% of mobile-money users
  cite system downtime; a falsely optimistic balance is an integrity failure under work-plan rule 12).
  *Test:* e2e with a mocked 5 s confirm delay. The balance is unchanged and a `Pending` label is
  visible. With a mocked failure, the balance is unchanged and an error with a retry is shown.
- **K32-14 Motion budget.**
  - Tap and feedback transitions ≤ 150 ms. Sheet or dialog enter ≤ 300 ms, exit ≤ 200 ms.
  - Easing: standard `cubic-bezier(0.2,0,0,1)`, or decelerate for enter.
  - No motion on price ticks except a ≤ 150 ms opacity or colour fade.
  - No looping animation on money routes except a pending spinner.
  - No auto-moving content longer than 5 s without a pause control (WCAG 2.2.2).
  - Under `prefers-reduced-motion: reduce`, spatial transitions become ≤ 150 ms fades or nothing.
  - Grade MODERATE (convention) + STRONG (normative 2.2.2 / 2.3.1).
  - *Test:* Playwright reads computed `transition-duration` and `animation-duration` and fails any
    value above the caps. Under `emulateMedia({reducedMotion:'reduce'})` there is no `transform`
    transition and no animation with iteration-count `infinite` outside `[data-pending]`.
- **K32-15 Placeholders match the final geometry.** Loading states reserve the exact box of the
  content they stand in for. Money figures never shift layout when they arrive. Skeleton vs spinner is
  **tested, not assumed** (E4). Grade: normative (CLS) + UNVERIFIED preference evidence.
  *Test:* CLS ≤ 0.1 on all routes and **≤ 0.02 on money routes**, measured in the lab at Slow 4G.
  `layout-shift` entries whose sources include a `[data-money]` node = 0.

### 2.6 Cognitive load

**Findings**

- **Choice overload is CONTESTED.**
  - Scheibehenne, Greifeneder & Todd 2010 (J Consumer Research; abstract via the University of Geneva
    repository): 63 conditions from 50 experiments, **N = 5,036**, "mean effect size of virtually
    zero but considerable variance".
  - Chernev, Böckenholt & Goodman 2015 (J Consumer Psychology; Crossref abstract): 99 observations,
    **N = 7,202**. Overload is significant once moderators are counted: **choice-set complexity,
    decision difficulty, preference uncertainty, and an effort-minimising goal**.
  - A novice facing a probabilistic money decision is high on all four moderators (INFERENCE), so
    the conditions for overload are present.
- **Hick–Hyman applies to experts, not novices.** Hick 1952: the rate of gain of information is
  roughly constant, about 5 bits/s. Cockburn, Gutwin & Greenberg 2007 (CHI; author PDF): menu
  performance is modelled as Fitts pointing + **visual search when novice** + **Hick–Hyman decision
  when expert**, and the model matched empirical data "extremely well". For first-time users,
  selection time grows with the number of items to *scan*, not with log₂ n. MODERATE-STRONG.
- **Split attention.** Ginns 2006: 50 studies; contiguity helps, especially for complex material.
  STRONG in learning; MODERATE for UI transfer.
- **Forms.** Seckler et al. 2014 (CHI; Google PDF), a controlled eye-tracking experiment (N = 65): 20
  web-form guidelines applied to real company forms gave faster completion, fewer submission attempts
  and fewer eye movements. MODERATE (desktop forms).
- **Progressive disclosure.** No primary evidence found for consumer mobile UIs (see §1 row 13).
  **INFERENCE** from the above.

**Rules**

- **K32-16 At most two primary actions per view; one decision per screen.** A market card offers
  exactly the two symmetric outcome actions and one tap target to open the market. The ticket asks for
  one thing at a time: side is already chosen, so the ticket asks amount, then confirm. Grade MODERATE
  (Chernev moderators, Cockburn novice search).
  *Test:* at 360×800, the number of visible `[data-primary-action]` elements ≤ 2 in any card or sheet;
  the ticket has exactly one focused input.
- **K32-17 Short, scannable lists for novices.** Category and filter lists show ≤ 7 items before a
  "More" control. Market lists sort by an explicit, labelled key. Grade WEAK (INFERENCE from
  novice visual-search cost; the "7" is a product choice, not a law).
  *Test:* the chip rail renders ≤ 7 chips plus "More" at 360 px.

### 2.7 Trust in fintech and mobile money

**Findings**

- **FinAccess 2024** (CBK, KNBS, FSD Kenya). 28,275 households sampled, 24,684 eligible, **20,871
  interviewed** (84.6% response). STRONG.
  - **9.8% of mobile-money users reported losing money.** Mechanism among mobile-money losses:
    **accidental send 70.0%**, external fraud 19.5%, genuine reversal 15.5%, agent fraud 3.2%,
    internal fraud 2.4% (multiple response). Mobile-money loss incidence by survey year: 11.8% (2013),
    13.8% (2016), 8.4% (2019), 17.7% (2021), 9.8% (2024).
  - Mobile-money problems: **system downtime 21.1%**, money lost 9.8%.
  - **72.7% could accurately read a typical SMS showing a transaction value and its cost** (M 76.3%,
    F 69.1%). Primary-educated 59.0%; secondary 90.2%; tertiary 97.1%. **81.0% of those with no
    schooling could not read it.**
  - Financial literacy: interest 80.0% correct, inflation 86.8%, **risk diversification 54.9%**; all
    three correct 42.1%.
  - **Betting: 11.2% actively bet** (urban 14.4%, rural 8.9%; ages 26–35 15.2%, 18–25 14.3%).
- **CGAP 2015** (grey, but quotes Safaricom's Director of Financial Services). Before Hakikisha,
  erroneous transfers made up 60–70% of call-centre calls, about 12,000 reversal calls a day. Hakikisha
  was rolled out to 21.7 M customers by 30 Oct 2015.
- **GSMA State of the Industry Report on Mobile Money 2026** (press release, 24 Mar 2026). Over $2 tn
  transacted in 2025; 2.3 bn registered accounts; **593 M 30-day active (+15%)**; 25.7% monthly
  active; "fraud remaining widespread". MODERATE (global).
- **Doğan, Gilbert & Kotut 2025** (n = 73 Kenyans): M-PESA impersonation is the most common scam type. WEAK.
- **Ozpolat et al. 2010** (randomised field experiment, US). A trust seal raised purchase completion;
  too many seals lowered it. MODERATE, transfer unknown.
- **Kenyan regulation** (GRA *Conduct of Gambling Operations Regulations 2026*, gra.go.ke PDF dated
  18.03.26; **Legal Notice number blank, so gazettal status is unverified**):
  - Reg. 45(1): game rules displayed before any wager.
  - **Reg. 45(3): theoretical return-to-player % "publicly disclosed"**. This is in tension with the
    loss-framing rule (work-plan rule 1). Show both, with the KSh framing first.
  - Reg. 85: identity, location and age checks using "reliable, independent and electronically
    verifiable data sources prior to player account activation and receipt of any wagering deposit";
    winners verified before payout.
  - Reg. 86: anonymous gambling prohibited.
  - Reg. 87: deposit, loss and session limits, reality checks, self-exclusion of ≥ 24 h, linked to the
    national register.
  - Reg. 88: PCI-DSS-compliant gateway; KYC under POCAMLA.
  - Third Schedule: prizes up to **KES 500,000 are paid "automatically to the player's registered
    mobile money wallet… immediately"**.

**Rules**

- **K32-18 Verify-before-commit, M-Pesa grammar.** Before any STK push or withdrawal, show one screen
  with the **recipient name exactly as M-Pesa will show it**, the **amount in numerals and words**
  ("KSh 200 — two hundred shillings"), the M-Pesa number masked except for the last 3 digits, and a
  single Confirm. Withdrawals go only to the verified KYC-owner number. Grade **STRONG (local)**:
  FinAccess 70% accidental-send, CGAP call data.
  *Test:* e2e for deposit and withdraw. The confirm screen contains the payee name, the numeric amount
  and the amount in words. The STK request is only issued after the Confirm click (network assertion).
  The withdraw destination equals the KYC MSISDN.
- **K32-19 Receipt parity with the M-Pesa SMS.** Within 5 s of the M-Pesa callback, show a receipt
  with the **M-Pesa transaction code**, amount, fee, net, time and new balance, in the **same order as
  the Safaricom SMS**, and copyable. Transaction history is searchable by that code. Grade MODERATE
  (trust grammar; FinAccess SMS literacy).
  *Test:* e2e with a sandbox callback. The receipt renders the code, and a history search by the code
  returns the row.
- **K32-20 One all-in number for cost.** Before commit, show "**You pay KSh X (all-in)**". The
  breakdown (excise, fee, WHT) is one tap away and **sums exactly** to the all-in figure. Never make
  the user add. Grade MODERATE-STRONG (27% cannot read a fee SMS; drip-pricing literature in 24 §2.3).
  *Test:* a unit test on the ticket model: sum of breakdown lines = all-in total, to the shilling.
  The all-in figure is visible without expansion.
- **K32-21 Trust signals: few, verifiable, never manufactured.** Show the GRA licence number linked
  to the regulator, a real support contact, and "How we make money" (a single page). Show one trust
  mark, not a wall of badges (Ozpolat). No testimonials (BCLB/GRA advertising rules, prior report).
  Grade MODERATE / WEAK (transfer).
  *Test:* review gate. At most one third-party trust badge per page (DOM count). The licence number
  string equals the configured value, and its link targets the regulator's domain.
- **K32-22 Downtime honesty.** When M-Pesa or our backend is degraded, show a status banner with the
  last-success time **before** the user starts a deposit. Grade MODERATE (21.1% downtime complaints).
  *Test:* with a mocked `/status` degraded state, the deposit entry screen shows the banner and the CTA
  label changes to reflect the delay.

### 2.8 Onboarding and KYC

**Findings**

- **Legal.** Reg. 85 (above) puts KYC **before account activation and the first deposit**. The Act
  itself (Gambling Control Act No. 14 of 2025) could not be retrieved from kenyalaw.org (403). The
  regulations are primary but their gazettal status is unverified.
- **Apple HIG *Onboarding*:** "Teach through interactivity… context-specific tips instead of a single
  onboarding flow… If you need to present a prerequisite onboarding flow, design a brief… experience
  … make [a tutorial] optional." Convention.
- **WCAG 2.2:** 3.3.7 Redundant Entry (A): do not ask for the same data twice. 3.3.8 Accessible
  Authentication (AA): no cognitive test; allow paste and password managers.
- **Forms:** Seckler 2014 (above).
- **Drop-off per KYC step: no primary source found.** Vendor "abandonment" statistics are grey
  marketing and are not cited.

**Rules**

- **K32-23 Browse, understand and preview without an account.** Markets, probabilities, rules,
  resolution sources, and a **full ticket preview with KSh outcomes** are available logged out. The
  account wall appears at "Deposit" or "Confirm". Grade: legal (Reg. 85 permits it) + HIG convention.
  *Test:* e2e logged out. Open a market, open the ticket, enter an amount, and see "Most you can
  lose" and "If right you get" with no auth prompt. The first auth prompt appears only on Confirm or
  Deposit.
- **K32-24 KYC is the minimum ordered set.** Phone (+254 or local prefix, `inputmode=tel`,
  `autocomplete=tel`) → OTP (`autocomplete=one-time-code`, paste allowed) → national ID number → name
  match against the M-Pesa KYC name → date of birth (age ≥ 18) → location consent. Each field is asked
  once (3.3.7) and one decision per screen. Grade: legal + WCAG + MODERATE.
  *Test:* an e2e tap and field count from landing to first deposit ≤ a budget fixed after E7. The OTP
  field accepts paste. No field value is requested twice (DOM audit across steps).
- **K32-25 Teach in context, not in a tour.** No mandatory carousel. First-use tips sit next to the
  element they explain ("57% means about 57 in 100"), can be dismissed, and stay findable in Help.
  Grade MODERATE (HIG).
  *Test:* the landing to market route has no modal before first interaction (Playwright: no
  `[role=dialog]` on load).

### 2.9 Language, literacy and plain language

**Findings**

- **Adult literacy** (World Bank WDI from UNESCO UIS, latest available):
  - Kenya 82.2% (**year 2000, stale**); youth 15–24 93.2% (2014).
  - Uganda 77.0% (2024); youth 85.2%.
  - Tanzania 78.2% (2022); youth 87.1%.
  - Rwanda 78.8% (2022); youth 90.0%.
  - Grade: STRONG as published, but Kenya's figure is too old to use.
- **Functional numeracy and financial reading (Kenya).** FinAccess 2024: 72.7% read a fee SMS
  correctly; 80.1% calculated 10% interest on KSh 1,000. **Risk diversification was answered correctly
  by only 54.9%**. This is the closest proxy we have for probability reasoning.
- **Language preference.** Wandera 2015 (JoSTrans): 30 questionnaires in Nairobi; 83% preferred the
  English M-Pesa menu and 65% had never used the Kiswahili menu, citing "unfamiliar terms". WEAK.
- **Plain language.** Masson & Waldron 1994 (Applied Cognitive Psychology): simplifying words and
  sentence structure reliably improved comprehension of contracts, **but absolute comprehension stayed
  very low**, because concepts, not wording, were the barrier. MODERATE. Plain words are necessary,
  not sufficient.
- **WCAG 3.1.5 (AAA):** text needing more than lower-secondary reading ability needs a simpler version.

**Rules**

- **K32-26 Numbers lead; words are short; concepts are shown.** On money screens:
  - Sentences ≤ 15 words. No word outside a controlled glossary (maintained in-repo, with an sw
    equivalent).
  - Every money concept is shown as a KSh number, not described ("If right you get KSh 350",
    never "2.3× payout").
  - Grade MODERATE (Masson & Waldron; FinAccess numeracy).
  - *Test:* a CI lint over i18n strings tagged `money:*`. Fail if a sentence exceeds 15 words, a
    term is missing from the glossary, or a string lacks an sw translation.
- **K32-27 English and Kiswahili at full parity; the default follows the device, and a switch is
  one tap away.** Grade WEAK (n = 30 prior); **E6 decides the default copy strategy**.
  *Test:* every key in `en` exists in `sw` (CI). The language switcher is reachable in ≤ 1 tap from
  any money route.

### 2.10 Platform conventions: Apple-level quality on a mostly-Android audience

**Evidence for the choice.**
- 80–94% of our page views are Android (StatCounter). Our users' *reflexes* are therefore Android's:
  the system Back gesture, bottom sheets, Material-style inputs, Chrome's URL bar.
- M3 breakpoints (verified): compact < 600 dp, medium 600–839, expanded 840–1199, large 1200–1599.
- Apple HIG's *principles* (restraint, hierarchy by size, purposeful motion, Dynamic Type, safe areas,
  44 pt default targets, 7:1 contrast for small custom text in Dark Mode) are platform-neutral quality
  criteria. Its *idioms* (edge-swipe back, action sheets, SF Symbols) are not.
- **Decision (INFERENCE, argued):** follow **Android interaction idioms** and **Apple's quality bar**.
  Where they conflict, the stricter number wins: target 48 (M3) over 44 (HIG); body 16 (M3) is kept,
  since iOS 17 pt ≈ 16 CSS px on our DPR-2 Androids once physical px size is accounted for.

| Concern | Apple HIG (verified) | Material 3 (verified) | Kichiko rule |
|---|---|---|---|
| Target | 44×44 pt default, 28 pt minimum; 12–24 pt padding | ≥ 48×48 dp; 8 dp spacing | 44 minimum, 48 for commit, 8 px gaps (K32-04) |
| Body type | 17 pt default, 11 pt minimum | Body L 16 / 24 | 16 px minimum, 20 px money (K32-07) |
| Contrast | 4.5:1 up to 17 pt; **strive for 7:1 in Dark Mode for small text** | (tokens) | AA everywhere + 7:1 and ΔY floor for money (K32-28) |
| Motion | purposeful, optional, brief; Reduce Motion → fades | 50–600 ms tokens; standard / emphasized easing | K32-14 caps |
| Back | edge swipe | system back / predictive back | **System Back closes the top sheet first** (K32-29) |
| Loading | show something ASAP; placeholders | progress indicators | K32-15 |
| Layout | size classes, safe areas | breakpoints: compact < 600 | K32-01; tablet band 600–839 addressed |
| Font | SF (system) | Roboto (system) | **System font stack; no web font on the critical path** (K32-30) |

- **K32-28 Contrast for sunlight.**
  - Money numerals, probability and commit labels meet **WCAG ≥ 7:1 *and* ΔY ≥ 0.80** in both
    themes.
  - All other text meets ≥ 4.5:1 and **ΔY ≥ 0.50**.
  - Non-text UI boundaries meet ≥ 3:1 (1.4.11).
  - This corrects R25: a ratio alone fails in sunlight, especially in dark mode.
  - Grade MODERATE (physics STRONG; device brightness assumed; E2 confirms).
  - *Test:* extend the existing token contrast unit test. For each tagged token pair in both themes,
    assert the ratio and |Y_fg − Y_bg|.
- **K32-29 Android Back is sacred.** Opening a sheet, dialog or full-screen step pushes a history
  entry. Back closes it and never leaves the route with a half-filled ticket. The draft ticket is
  restored if the user returns within the session. Grade: platform convention (strong user expectation).
  *Test:* Playwright opens the ticket, then `page.goBack()`. The sheet is closed, the URL is the
  market, and a second `goBack()` leaves the market.
- **K32-30 System fonts.** `font-family: system-ui, -apple-system, Roboto, "Segoe UI", sans-serif`
  (with verified `tnum` support). At most one optional brand face for display headings, subset to
  ≤ 25 KB WOFF2, `font-display: optional`, never on money numerals. Grade INFERENCE: platform-native
  feel plus the critical-path budget in §3 (Polymarket ships 699 KB of fonts, M1).
  *Test:* no `@font-face` resource in the money-route critical chain (Lighthouse
  `critical-request-chains`). Font transfer ≤ 25 KB per route.

---

## 3. Performance budget and device test matrix

### 3.1 The gate conditions (primary definitions)

| Profile | Definition (source) |
|---|---|
| **Slow 4G** (merge gate) | 150 ms RTT, 1.6 Mbps down / 750 kbps up. Lighthouse describes it as "roughly the bottom 25% of 4G connections and top 25% of 3G connections" (Lighthouse `throttling.md`; DevTools `Slow4GConditions`) |
| **3G** (money-route stress) | 400 ms RTT, 500 kbps down and up (DevTools `Slow3GConditions`) |
| **Fast 4G** (sanity) | 60 ms RTT, 9 Mbps / 1.5 Mbps (DevTools) ≈ Russell's 2026 global P75 |
| **CPU** | Lighthouse constant **4× slowdown**, calibrated against `benchmarkIndex` (Lighthouse docs), plus real devices (below) |
| **Lighthouse mobile emulation** | Moto G Power, 412×823, DPR 1.75 (`constants.js`). **We add 360×800 DPR 2** because that is our modal screen |

Why Slow 4G and not the Kenyan medians? The Ookla medians (Safaricom 43 Mbps) describe people who run
speed tests on good networks. In the CA data, 21.5% of data subscriptions are on 2G or 3G, and
Airtel's median is about 2.4× lower. A merge gate must protect the bottom quartile, not the median.

### 3.2 Derivation (INFERENCE: arithmetic shown so anyone can recheck it)

- **Slow 4G.**
  - Effective throughput = 1.6 Mbps × 0.9 = 1.44 Mbps ≈ **180 KB/s**.
  - A cold first visit needs DNS + TCP + TLS 1.3 + request = 4 RTT = 0.60 s. Add a server budget of
    0.20 s: **TTFB ≈ 0.80 s**.
  - Render-critical bytes C (HTML + blocking CSS) arrive after C / 180 KB/s, plus about one extra RTT
    of TCP slow start (initcwnd ≈ 14.6 KB against a bandwidth-delay product of 27 KB). Allow 0.40 s
    for low-end style, layout and paint.
  - LCP ≈ 0.80 + C/180 + 0.15 + 0.40. With **C = 60 KB, LCP ≈ 1.68 s** (0.8 s margin to the 2.5 s
    "good" line).
- **3G.**
  - Throughput = 500 kbps × 0.8 = 50 KB/s. TTFB = 4 × 0.40 + 0.20 = 1.80 s.
  - LCP ≈ 1.80 + 60/50 + 0.40 + 0.40 = **3.80 s**, just inside the 4.0 s "poor" line. At C = 75 KB
    it is 4.1 s, over the line. **This is what sets C ≤ 60 KB.**
- **JS.** 150 KB compressed at 180 KB/s is 0.83 s, loaded in parallel after the HTML, so it is fully
  downloaded at about 2.2 s. Allow 0.5–1.0 s of hydration on a low-end device: interactive at about
  **2.7–3.2 s on Slow 4G**. The total of 400 KB is about 2.2 s of transfer after TTFB.
- **Cross-check against Russell 2026** (global P75 at 9 Mbps / 100 ms). A 3 s page gets 1.2 MiB
  total (0.62 MiB JS) when JS-heavy, or 2.0 MiB (0.3 MiB JS) when JS-light. Our gate has 5.6× less
  bandwidth and 1.5× the RTT. Scaling the transfer window (3.0 − 0.8 s) × 180 KB/s gives about 400 KB,
  which is consistent.
- **Data cost.** 400 KB × KSh 0.244/MB ≈ **KSh 0.10 per first visit**, 0.5% of a KSh 20 stake.
  Polymarket's measured 10.25 MB ≈ **KSh 2.50**, 12.5% of the same stake.

### 3.3 The budget (money routes; binding)

| Metric | Budget | Measured how | Fails the build? |
|---|---|---|---|
| Render-critical bytes (HTML + blocking CSS, compressed) | **≤ 60 KB** | Lighthouse `resource-summary` / custom byte counter | yes |
| Web fonts on the critical path | **0**; ≤ 25 KB per route total | Lighthouse `critical-request-chains` | yes |
| Initial JS (compressed, incl. framework) | **≤ 150 KB** | build-time bundle report per route | yes |
| Total first-visit transfer | **≤ 400 KB** (images lazy, AVIF/WebP, above-fold ≤ 50 KB) | Lighthouse `total-byte-weight` | yes |
| Repeat-visit transfer | ≤ 50 KB | Playwright, second navigation with a warm cache | yes |
| LCP, lab, Slow 4G + 4× CPU, 360×800@2 | **≤ 2.5 s** (target 1.7) | Lighthouse CI, median of 5 | yes |
| LCP, lab, 3G + 4× CPU | **≤ 4.0 s** | Lighthouse CI, median of 3 | yes |
| LCP element on money routes | text, never an image | Lighthouse `largest-contentful-paint-element` | yes |
| TBT, lab (proxy for INP) | ≤ 200 ms | Lighthouse | yes |
| INP, field p75 (KE, mobile) | **≤ 200 ms** | RUM (K32-03) | release blocker |
| CLS | ≤ 0.1 all routes; **≤ 0.02 money routes** | Lighthouse + RUM | yes |
| Tap to pressed paint (4× CPU) | ≤ 100 ms | Playwright trace (K32-12) | yes |
| Live-price data while visible | ≤ 2 KB per update; ≤ 100 KB per 10 min; **0 when `document.hidden`** | Playwright network log over 10 min | yes |

These numbers are derived. They may move **down** after measurement on real devices. They move **up**
only with a written reason that recomputes §3.2.

### 3.4 Device and browser test matrix

| ID | Viewport (CSS) | DPR | Represents (data) | Browser | Network / CPU | Cadence |
|---|---|---|---|---|---|---|
| D1 | **360×800** | 2 | 34–44% of mobile page views at width 360 (all four countries) | Chrome Android | Slow 4G, 4× | every PR |
| D2 | 385×854 | 2.8 | 8–10% (Transsion FHD+ class) | Chrome | Slow 4G, 4× | every PR (layout only) |
| D3 | 412×915 | 2.625 | 5–8% (Galaxy A1x/A3x FHD+) | Chrome | Fast 4G, 4× | every PR (layout only) |
| D4 | 320×640 | 2 | Uganda 2.3%; WCAG 1.4.10 reflow floor | Chrome | 3G, 4× | nightly |
| D5 | 360×640 (viewport) | 2 | short-viewport cohort (K32-06) | Chrome | Slow 4G | every PR (layout) |
| D6 | 390×844 | 3 | iOS: RW 19%, TZ 7–11% | Safari (WebKit) | Fast 4G | every PR (layout + e2e) |
| D7 | 360×800 | 2 | Opera 15+ (KE 28%) | Opera for Android, **real device** | field | monthly |
| D8 | 360×800 | 2 | Opera Mini (1.7–2.5%) | Opera Mini extreme mode, real device | field | monthly (read-only SSR check) |
| R1 | real **Samsung Galaxy A07/A06 class** (4 GB, Helio G85/G99 class) | — | Omdia's named volume models; Russell's low-end cohort | Chrome | Safaricom + Airtel SIMs, outdoors | before every release |
| R2 | real **Tecno Spark / itel A-series** (Transsion; KE 14–21% vendor share) | — | sub-$150 segment | Chrome + Opera | Airtel SIM | before every release |
| R3 | real **Android 9 device** | — | KE 9.3%, UG 16.9% of Android on ≤ 9 | its last available Chrome | Slow 4G | monthly |
| R4 | real iPhone SE / 11 class | — | iOS cohort | Safari | — | before every release |

Contrast, target-size and motion tests (K32-04, 07, 10, 12, 14, 28) run at D1 and D6 in **both
themes** and under `reducedMotion: 'reduce'`.

---

## 4. The edge: what Polymarket and Kalshi structurally miss

Both are US-built. Polymarket is desktop-first and crypto-rail; Kalshi is a CFTC-regulated,
bank-card and ACH product. Every point below is tied to evidence. Where a point is inference it says
so.

1. **Weight is a cost that US users do not see and ours do.** Polymarket mobile home, measured today
   (M1, one run, 360×800, non-Kenyan egress): **364 requests, 12.55 MB**, of which 211 scripts total
   **5.96 MB** compressed and fonts **699 KB**. Under Slow 4G + 4× CPU: **LCP 6.09 s**, load 58 s.
   At KSh 0.244/MB, a visit costs about KSh 2.50, 12.5% of a KSh 20 stake. Our budget (§3.3) is about
   25× lighter. **Kalshi was not measured**: a bot challenge was served (2 requests, 67 KB).
2. **Their money rail is not the one our users trust.** 54.0 M Kenyan mobile-money subscriptions,
   88.8% of them Safaricom (CA). The dominant loss mode is the **accidental send (70%, FinAccess)**.
   A product built on cards or USDC has no reason to design name-and-amount verification or M-Pesa-code
   receipts. We make them the centre of the flow (K32-18, K32-19). US competitors cannot copy this
   without rebuilding their payments layer.
3. **Their number formats assume US numeracy.** Both price contracts in cents and describe returns
   as payouts. In Kenya, 27.3% of adults misread a fee SMS and only 54.9% answer the diversification
   question correctly (FinAccess). KSh-only outcomes, one all-in cost figure and a frequency gloss
   (K32-20, K32-26, work-plan rules 1–4) are a comprehension edge they are not built to need.
4. **Their visual design is tuned for indoor, high-end, young eyes.**
   - Polymarket's YES tint (4.36:1 WCAG, already failing AA [23]) falls to about **2.5:1 at 10k lux**
     on a 450-nit panel.
   - Its most common feed target is 27 px tall [23], which is 5.2 mm on a 360-wide phone, below every
     error threshold in §2.2.
   - Kenya's presbyopia correction coverage is 6.3% among over-50s.
   - Sunlight-robust ΔY contrast, 48 px commit targets and a 16/20 px type floor serve an audience
     their defaults exclude.
5. **Low-end reach is a market, not a fallback.**
   - 34.4% of devices on Kenyan networks are feature phones, and 21.5% of data subscriptions are on
     2G or 3G (CA).
   - STK Push works on any handset.
   - A lean SSR page that works on Opera Mini (K32-02) and on 3G (LCP ≤ 4 s) reaches users that a
     6 MB JS app cannot. **INFERENCE:** conversion from those users is unmeasured (E11).
6. **Colour-independent symmetry.** Kenyan consumers were confused by red/green labels (FOPL study),
   and about 2% of African males have red-green CVD. Word-first YES/NO (K32-10) is safer here than
   the red/green convention US traders are used to.
7. **Local compliance as UX, not friction.** Reg. 85 permits a full logged-out preview up to the
   deposit (K32-23). Reg. 87 tools and the national self-exclusion register are integrations a US
   entrant has not built. The Third Schedule's immediate wallet payout for prizes up to KES 500,000
   lets a winning outcome settle straight to M-Pesa, a trust moment that no US prediction market's
   card or crypto rail offers our users.
8. **Honest limits of this edge.** Polymarket's strengths (IA, density, hierarchy by size) still
   stand (work plan §2). Nothing here claims Kichiko will out-convert them. These are the conditions
   under which they are structurally weak and we are not. The claim is falsified if our RUM shows
   LCP p75 > 2.5 s, or if E3 and E5 show no comprehension or error advantage.

---

## 5. Where the evidence is thin, and the experiments that fix it

| # | Gap | Why it matters | Experiment (pre-register; decision rule) |
|---|---|---|---|
| E1 | Target size and position on 2026 budget Androids, one-handed, Kenyan users (Parhi was 2006 and n = 20; Henze used circles under time pressure) | Sets K32-04 and K32-05 | Within-subjects. Sizes 40/44/48/56 px × 9 screen zones × one-handed/cradled. n ≥ 24 on R1/R2 devices, seated and walking. Outcomes: error rate, time. **Adopt the smallest size whose error rate is ≤ 1.5 × that of 56 px.** |
| E2 | Outdoor legibility of our tokens (the ACR model uses an assumed 450 nit) | Validates ΔY floors (K32-28) and dark-mode behaviour | Measure panel luminance with a meter on R1/R2. Read-back of 20 KSh amounts under 1k / 10k / 50k lux (lux meter), light vs dark, n ≥ 20, ages 18–65 including ≥ 5 presbyopic without correction. Outcome: read-back error, time. **Raise ΔY floors if error > 2% at 10k lux.** |
| E3 | Comprehension of the ticket and receipt (all-in cost, max loss, frequency gloss) | Core of work-plan rules 1–4 | Unmoderated field A/B (WhatsApp-recruited, KSh airtime incentive). n ≥ 400 per arm, stratified by education. Outcome: correct read-back of what you pay, what you can lose and what you get, modelled on the FinAccess SMS item. **Ship the variant with the higher correct rate among primary-educated users.** |
| E4 | Skeleton vs spinner vs progressive SSR (the primary evidence was unretrievable) | K32-15 | Randomised in production at 1:1:1, money routes. Outcomes: abandonment before LCP, perceived-speed micro-survey, task completion. |
| E5 | Verify-before-commit cost and benefit | K32-18 | Moderated test with a seeded wrong amount or number. Outcome: detection rate, added time. Hypothesis: detection ≥ 80% at ≤ 3 s added. |
| E6 | English vs Kiswahili vs mixed copy (prior n = 30) | K32-27 default | Between-subjects, n ≥ 300 per arm across KE/TZ. Outcomes: comprehension (E3 items), trust rating, completion. |
| E7 | KYC step order and drop-off (no primary data found) | K32-24 budget | Instrumented funnel. Test phone-first vs ID-first, and KYC-at-deposit vs KYC-at-signup, within Reg. 85. Outcome: first-deposit completion within 24 h. |
| E8 | Which trust signals change behaviour here (none in the EA literature) | K32-21 | A/B one signal at a time: licence badge, "How we make money", receipt-code emphasis. Outcomes: deposit initiation and **support contacts per 1,000 deposits** (complaints must not rise). Pre-register guardrails against dark patterns. |
| E9 | Commit-button placement: sticky bottom vs inline lower-middle | K32-05 | A/B. Outcomes: mis-tap (undo within 5 s), time to commit. |
| E10 | Motion preference and vestibular comfort | K32-14 | Survey plus A/B at 150 vs 300 ms sheet transitions. Outcome: task time, comfort rating. |
| E11 | Actual device and network mix of *our* users (StatCounter is a proxy with a 2025–26 sampling anomaly) | Everything in §3 | RUM (K32-03), then re-derive §3.2 with measured RTT, throughput and `deviceMemory`. |

Other gaps, unsolved and stated plainly:
- No primary source on East African colour semantics for money.
- No reading-level target validated for Kiswahili.
- Kenya's adult literacy figure in WDI dates from 2000.
- Uganda, Tanzania and Rwanda regulator data (UCC, TCRA, RURA) and their mobile-money statistics were
  not retrieved; only Kenya's CA data is primary here.
- Safaricom FY26 M-PESA customer figures were not verified (403).

---

## 6. Sources (all accessed 2026-09-27)

**Standards and platform guidance**
- W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*, Recommendation, 12 Dec 2024. https://www.w3.org/TR/WCAG22/ (SC 1.4.1, 1.4.3, 1.4.4, 1.4.6, 1.4.8, 1.4.10, 1.4.11, 1.4.12, 2.2.1, 2.2.2, 2.3.1, 2.3.3, 2.4.11, 2.5.5, 2.5.8, 3.1.5, 3.2.6, 3.3.4, 3.3.7, 3.3.8)
- W3C, *Media Queries Level 5*, WD 19 Feb 2026, §12.1, §12.6. https://www.w3.org/TR/mediaqueries-5/
- W3C, *CSS Fonts Module Level 4* (`font-variant-numeric: tabular-nums`). https://www.w3.org/TR/css-fonts-4/
- Microsoft, *OpenType feature registry: 'tnum'*. https://learn.microsoft.com/en-us/typography/opentype/spec/features_pt
- Apple, *Human Interface Guidelines*, rendered in Chromium: Accessibility (change log to 9 Jun 2025), Typography (Dynamic Type tables), Layout (updated 9 Sep 2026), Motion, Color, Dark Mode, Buttons, Loading, Feedback, Onboarding. https://developer.apple.com/design/human-interface-guidelines/
- Google, *Material Design 3*, rendered: Structure → Target sizes; Type scale tokens; Easing and duration tokens and "Applying easing and duration"; Window size classes / breakpoints. https://m3.material.io/foundations/designing/structure · https://m3.material.io/styles/typography/type-scale-tokens · https://m3.material.io/styles/motion/easing-and-duration/tokens-specs · https://m3.material.io/foundations/layout/applying-layout/window-size-classes
- Google, web.dev: *LCP* (updated 4 Sep 2025), *INP* (updated 2 Sep 2025), *CLS*, *Defining the Core Web Vitals thresholds* (updated 7 May 2025). https://web.dev/articles/lcp · /inp · /cls · /defining-core-web-vitals-thresholds
- GoogleChrome/lighthouse, `docs/throttling.md` and `core/config/constants.js` (main). https://github.com/GoogleChrome/lighthouse
- ChromeDevTools/devtools-frontend, `front_end/core/sdk/NetworkManager.ts` (throttling presets). https://github.com/ChromeDevTools/devtools-frontend

**Device, network and market data**
- StatCounter Global Stats, KE/UG/TZ/RW, Aug 2025–Aug 2026: mobile OS, mobile screen resolution, mobile browser and browser version, Android version, mobile vendor, platform comparison (CSV exports in `data-32/statcounter/`). https://gs.statcounter.com/
- Communications Authority of Kenya, *Sector Statistics Report Q4 2025/2026* (Apr–Jun 2026). https://www.ca.go.ke/sites/default/files/2026-09/Sector%20Statistics%20Report%20Q4%202025-2026_0.pdf
- Ookla, *MTN opcos generally outperformed Airtel, Orange and Vodacom in SSA during H1 2025* (5 Nov 2025). https://www.ookla.com/articles/sss-groups-h1-2025
- Ookla, *Speedtest Global Index*, Kenya, Uganda, Tanzania, Rwanda (Aug 2026). https://www.speedtest.net/global-index/kenya (etc.)
- Safaricom, *Data tariffs* and *Monthly data plans* pages. https://www.safaricom.co.ke/personal/data/data-tariffs · https://www.safaricom.co.ke/personal/data/monthly-plans-data
- Omdia, *Africa smartphone market expected to decline 26% in 2026…* (20 Aug 2026). https://omdia.tech.informa.com/pr/2026/aug/africa-smartphone-market-expected-to-decline-26percent-in-2026-following-first-contraction-in-three-years
- Samsung Africa, *Galaxy A07s* product and spec page. https://www.samsung.com/africa_en/smartphones/galaxy-a/galaxy-a07s-light-violet-64gb-sm-a077flvdafb/
- ITU, *The affordability of ICT services 2025* (regional only). https://www.itu.int/dms_pub/itu-d/opb/ind/D-IND-ICT_PRICES.01-2025-PDF-E.pdf
- Russell, A., *The Performance Inequality Gap, 2026* (Infrequently Noted, 28 Nov 2025) **[GREY]**. https://infrequently.org/2025/11/performance-inequality-gap-2026/
- World Bank WDI API, SE.ADT.LITR.ZS and SE.ADT.1524.LT.ZS (source: UNESCO UIS). https://api.worldbank.org/v2/
- M1 measurements: `data-32/perf-probe-results-2026-09-27.json` (harness `data-32/perf-probe.cjs`, run from `apps/web`).

**Touch, reach, attention**
- Parhi, P., Karlson, A. K., & Bederson, B. B. (2006). Target size study for one-handed thumb use on small touchscreen devices. MobileHCI '06. doi:10.1145/1152215.1152260. Full text: https://www.microsoft.com/en-us/research/wp-content/uploads/2006/01/parhi-mobileHCI06.pdf
- Henze, N., Rukzio, E., & Boll, S. (2011). 100,000,000 taps. MobileHCI '11. doi:10.1145/2037373.2037395. Full text: https://nhenze.net/uploads/100000000-Taps-Analysis-and-Improvement-of-Touch-Performance-in-the-Large.pdf
- Bergstrom-Lehtovirta, J., & Oulasvirta, A. (2014). Modeling the functional area of the thumb on mobile touchscreen surfaces. CHI '14, 1991–2000. doi:10.1145/2556288.2557354 (metadata only, via Crossref; content via Le et al. 2018)
- Le, H. V., Mayer, S., Bader, P., & Henze, N. (2018). Fingers' range and comfortable area for one-handed smartphone interaction beyond the touchscreen. CHI '18. doi:10.1145/3173574.3173605. Full text: https://nhenze.net/uploads/Fingers%E2%80%99-Range-and-Comfortable-Area-for-One-Handed-Smartphone-Interaction-Beyond-the-Touchscreen.pdf
- Karlson, A. K., Bederson, B. B., & Contreras-Vidal, J. L. (2008). Understanding one-handed use of mobile devices. In *Handbook of Research on User Interface Design and Evaluation for Mobile Technology*. doi:10.4018/978-1-59904-871-0.ch006 (metadata)
- Hoober, S. (2013). How do users really hold mobile devices? UXmatters **[GREY]**. https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
- Lagun, D., Hsieh, C.-H., Webster, D., & Navalpakkam, V. (2014). Towards better measurement of attention and satisfaction in mobile search. SIGIR '14. doi:10.1145/2600428.2609631. Full text: https://research.google.com/pubs/archive/43224.pdf

**Legibility, vision, colour**
- Legge, G. E., & Bigelow, C. A. (2011). Does print size matter for reading? J Vision 11(5):8. doi:10.1167/11.5.8 (PubMed 21828237)
- Bababekova, Y., et al. (2011). Font size and viewing distance of handheld smart phones. Optom Vis Sci 88(7):795–797. doi:10.1097/OPX.0b013e3182198792 (PubMed 21499163)
- Buchner, A., & Baumgartner, N. (2007). Ergonomics 50(7):1036–63. doi:10.1080/00140130701306413
- Piepenbrock, C., Mayr, S., Mund, I., & Buchner, A. (2013). Ergonomics 56(7):1116–24. doi:10.1080/00140139.2013.790485
- Piepenbrock, C., Mayr, S., & Buchner, A. (2014). Ergonomics 57(11):1670–7. doi:10.1080/00140139.2014.948496
- Dobres, J., Chahine, N., & Reimer, B. (2017). Appl Ergon 60:68–73. doi:10.1016/j.apergo.2016.11.001
- Chen, H., Tan, G., & Wu, S.-T. (2017). Ambient contrast ratio of LCDs and OLED displays. Optics Express 25(26):33643. doi:10.1364/OE.25.033643 (full text, opg.optica.org)
- Fricke, T. R., et al. (2018). Global prevalence of presbyopia and vision impairment from uncorrected presbyopia. Ophthalmology 125(10):1492–9. doi:10.1016/j.ophtha.2018.04.013
- GBD 2019 Blindness and Vision Impairment Collaborators (2021). Lancet Glob Health 9(2):e130–43. doi:10.1016/S2214-109X(20)30425-3
- Sherwin, J. C., Keeffe, J. E., Kuper, H., Islam, F. M., Muller, A., & Mathenge, W. (2008). Functional presbyopia in a rural Kenyan population. Clin Exp Ophthalmol 36(3):245–51. doi:10.1111/j.1442-9071.2008.01711.x
- Tilahun, M. M., et al. (2024). Prevalence of color vision deficiency in Africa: systematic review and meta-analysis. PLoS One 19(12):e0313819. doi:10.1371/journal.pone.0313819
- Jeong, Y. D., et al. (2025). Global prevalence of congenital color vision deficiency among children and adolescents, 1932–2022. Ophthalmology 132(12):1431–44. doi:10.1016/j.ophtha.2025.07.031
- Birch, J. (2012). Worldwide prevalence of red-green color deficiency. JOSA A 29(3):313–20. doi:10.1364/JOSAA.29.000313
- Sunderland, E., & Rosa, P. J. (1976). Am J Phys Anthropol 44(1):151–6. doi:10.1002/ajpa.1330440121
- Oppolzer, A., & Winkler, E. M. (1980). Anthropol Anz 38(2):117–20 (PubMed 6968538)
- *Exploring consumer understanding and perceptions of front-of-pack labelling … in Kenya* (2024). Nutrients 16(22):3892. doi:10.3390/nu16223892

**Latency, motion, vestibular**
- Deber, J., Jota, R., Forlines, C., & Wigdor, D. (2015). How much faster is fast enough? CHI '15. Full text: https://www.tactuallabs.com/papers/howMuchFasterIsFastEnoughCHI15.pdf
- Jota, R., Ng, A., Dietz, P., & Wigdor, D. (2013). How fast is fast enough? CHI '13. Full text: https://www.tactuallabs.com/papers/howFastIsFastEnoughCHI13.pdf
- Agrawal, Y., et al. (2009). Disorders of balance and vestibular function in US adults. Arch Intern Med 169(10):938–44. doi:10.1001/archinternmed.2009.66
- UNVERIFIED (metadata only, via Crossref): Miller 1968 doi:10.1145/1476589.1476628; Card, Robertson & Mackinlay 1991 doi:10.1145/108844.108874; Dabrowski & Munson 2011 doi:10.1016/j.intcom.2011.05.008; Mejtoft, Långström & Söderström 2018 doi:10.1145/3232078.3232086; Harrison, Yeo & Hudson 2010 doi:10.1145/1753326.1753556

**Cognitive load and forms**
- Scheibehenne, B., Greifeneder, R., & Todd, P. M. (2010). J Consumer Research 37:409–25. doi:10.1086/651235 (abstract via archive-ouverte.unige.ch/unige:76440)
- Chernev, A., Böckenholt, U., & Goodman, J. (2015). J Consumer Psychology 25(2):333–58. doi:10.1016/j.jcps.2014.08.002 (Crossref abstract)
- Hick, W. E. (1952). Q J Exp Psychol 4:11–26. doi:10.1080/17470215208416600 · Hyman, R. (1953). J Exp Psychol 45:188–96. doi:10.1037/h0056940 (metadata)
- Cockburn, A., Gutwin, C., & Greenberg, S. (2007). A predictive model of menu performance. CHI '07. Full text: https://grouplab.cpsc.ucalgary.ca/grouplab/uploads/Publications/Publications/2007-PredictiveModelMenus.CHI.pdf
- Ginns, P. (2006). Learning and Instruction 16:511–25. doi:10.1016/j.learninstruc.2006.10.001 (abstract via ERIC EJ747512)
- Sweller, J., van Merriënboer, J., & Paas, F. (1998). Educ Psych Rev 10:251–96. doi:10.1023/A:1022193728205; de Jong, T. (2010). Instructional Science 38. doi:10.1007/s11251-009-9110-0
- Seckler, M., Heinz, S., Bargas-Avila, J. A., Opwis, K., & Tuch, A. N. (2014). Designing usable web forms. CHI '14. doi:10.1145/2556288.2557265. Full text: https://research.google.com/pubs/archive/42513.pdf
- Masson, M. E. J., & Waldron, M. A. (1994). Applied Cognitive Psychology 8(1):67–85. doi:10.1002/acp.2350080107
- Anik, A. I., & Bunt, A. (2026). IUI '26. doi:10.1145/3742413.3789087 (metadata)

**Trust, mobile money, regulation, language**
- CBK, KNBS & FSD Kenya (2024). *2024 FinAccess Household Survey* (Dec 2024). https://www.centralbank.go.ke/wp-content/uploads/2024/12/2024-FINACCESS-HOUSEHOLD-SURVEY-MAIN-REPORT.pdf
- CGAP (28 Oct 2015). *Safaricom launches feature to stop erroneous transfers: Hakikisha* **[GREY]**. https://www.cgap.org/blog/safaricom-launches-feature-to-stop-erroneous-transfers-hakikisha
- Safaricom, *Hakikisha FAQ* (updated 22 Sep 2023). https://www.safaricom.co.ke/media-center-landing/frequently-asked-questions/hakikisha
- GSMA (24 Mar 2026). *Mobile money accounted for $2 trillion in transactions in 2025…* (SOTIR 2026 press release). https://www.gsma.com/newsroom/press-release/mobile-money-accounted-for-2-trillion-in-transactions-in-2025-doubling-since-2021-as-active-accounts-continue-to-grow/
- Doğan, A. L., Gilbert, M., & Kotut, L. (2025). Easy come, easy go: phone enabled small-scale financial grift. COMPASS '25. doi:10.1145/3715335.3736315. https://faculty.washington.edu/kotut/papers/COMPASS-2025-Financial-Grift.pdf
- Ozpolat, K., Gao, G., Jank, W., & Viswanathan, S. (2010). The value of online trust seals. SSRN. doi:10.2139/ssrn.1592480
- Mathur, A., et al. (2019). Dark patterns at scale. PACM HCI 3(CSCW). https://arxiv.org/abs/1907.07032
- Jack, W., & Suri, T. (2014). AER 104(1):183–223. doi:10.1257/aer.104.1.183
- Medhi, I., Gautama, S. N. N., & Toyama, K. (2009). CHI '09. doi:10.1145/1518701.1518970 · Medhi, I., et al. (2011). ACM TOCHI 18(1). doi:10.1145/1959022.1959024 · Srivastava, A., Kapania, S., Tuli, A., & Singh, P. (2021). PACM HCI. doi:10.1145/3449210 (metadata)
- Gambling Regulatory Authority (Kenya). *The Gambling Control (Conduct of Gambling Operations) Regulations, 2026* (Legal Notice No. blank; PDF dated 18.03.26). https://gra.go.ke/wp-content/uploads/2026/03/18.03.26-GRA-THE-GAMBLING-CONTROL-CONDUCT-OF-GAMBLING-OPERATIONS-REGULATIONS-2026.pdf
- *Gambling Control Act No. 14 of 2025*: kenyalaw.org returned 403; **not read**.
- Wandera, A. S. (2015). Evaluating the acceptance and usability of Kiswahili localised mobile phone app in Kenya: a case of M-Pesa app. JoSTrans 24 (July 2015). doi:10.26034/cm.jostrans.2015.325. https://www.jostrans.org/article/view/7710/7288

**Could not retrieve (nothing rests on these):** Safaricom fraud-awareness page (403); GSMA
cybersecurity page (403); Nturibi 2018 thesis (TLS failure); Safaricom FY26 results booklet (403);
ITU DataHub country baskets (403); A4AI price data (not attempted after ITU failed; no alternative
primary); ACM DL, ScienceDirect and OUP landing pages (bot challenge); Bergstrom-Lehtovirta 2014 full
text (host outside the proxy allowlist); DiVA (connection reset).
