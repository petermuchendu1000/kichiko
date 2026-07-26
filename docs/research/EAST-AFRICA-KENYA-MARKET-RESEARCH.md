# Kichiko — East Africa / Kenya Pilot Market Research

**Scope:** Deep market research to ground the landing page (and, by extension, the whole
product's language, currency, and framing) in the reality of the target populace.
**Pilot market:** Kenya. **Broader target:** East Africa (Uganda, Tanzania, Rwanda, Zambia,
Ethiopia, Burundi already present in the currency model).
**Prepared:** 2026-07-25. **Status:** Research foundation for the landing-page rebuild.
**Governing principle (from product brief):** *Every single word in the system brings either
**clarity**, **confusion**, **friction**, or **obstruction**. This document exists so that we
choose clarity, deliberately and defensibly, for a populace that has **never** used a
prediction market.*

> **Reading note on figures.** Where public sources disagree (e.g. betting-participation %,
> market share), both the range and the source are given. Treat single-source numbers as
> directional, not precise. All money figures are KES unless stated; USD conversions use
> ~1 USD ≈ 129 KES (2026).

---

## 0. Executive summary — the seven things that must shape every word

1. **The user has never seen a prediction market.** Polymarket/Kalshi mental models
   (contracts, shares, order books, "trading probability") do **not** exist here. We are
   creating a category from zero. Comprehension is the entire battle; cleverness is the enemy.
2. **English is the language of money — even over Swahili.** In money apps Kenyans
   overwhelmingly choose English (in the M-Pesa study, **83% preferred the English menu**,
   65% never used Kiswahili). Swahili/Sheng build *warmth and belonging*, not *instructions*.
   → **Plain, simple English for anything transactional; Swahili/Sheng only for emotional
   framing, and only if it is natural, not textbook.**
3. **This populace is primed to smell a scam.** Kenya has a long, painful history of Ponzi /
   pyramid / "get-rich-quick" schemes (DECI, Ekeza, crypto scams up 73% in 2024). Regulators
   (CMA, CBK, DCI) publicly and repeatedly warn against "guaranteed / daily / high returns" and
   "earn" language. **A prediction market looks *dangerously* similar to those scams.** Our
   copy must actively *distance* itself from that pattern, not flirt with it.
4. **"Earn / win / cash out daily" is a legal and trust landmine.** Kenya banned all gambling
   advertising in 2025 and imposed strict BCLB ad rules: no call-to-action, no glamorizing, no
   testimonials, no "shortcut to wealth", mandatory addiction + 18+ + licence disclosures.
   The current hero string **"Predict & Earn" is exactly the wrong phrase** on both the scam
   axis and the regulatory axis.
5. **Money is KES, and it moves on M-Pesa.** ~88% of bettors transact by phone; M-Pesa is the
   rail. Users expect **STK-push, instant, name-verified (Hakikisha)** flows and **Kenyan
   Shillings (KSh)** everywhere. **Showing USD ($) volumes on the landing page is friction and
   quiet distrust** — a Kenyan first-timer reads "$" as "foreign / not for me / maybe a scam".
6. **Mobile-first, Android, data-cost-aware.** ~67–91% of access is mobile, ~94% Android,
   many low-end devices. Data is the region's *cheapest* (≈1.97% of monthly income for 2GB)
   but income is low (working-youth avg ≈ **KES 5,616/month**). The page must be light, fast,
   and legible on a small cheap screen in bright sun.
7. **Trust before money, always.** The user must understand *what this is*, *how a question
   resolves*, and *who regulates us* **before** any ask to deposit. This is both the ethical
   stance and the highest-converting one for a skeptical, first-time audience.

---

## 1. Market fundamentals (who they are)

| Dimension | Figure | Source |
|---|---|---|
| Population | ~55–58M (median age ~21) | iGamingAfrika; GeoPoll |
| Internet users | ~15.4M (~26%); other est. ~40.8% | iGamingAfrika; iGamingToday |
| Mobile share of web traffic | ~67% | iGamingAfrika |
| Smartphone penetration | ~80.5% smartphones; 59.3% feature phones | GeoPoll (CA data) |
| Android share of mobile users | ~94.2% | GeoPoll |
| Working-youth avg income | ~**KES 5,616/month** (Shujaaz) | Shujaaz Kenya Youth Trends |
| Youth unemployment (15–24) | ~15.2% (2025, ILO/World Bank) | FRED / World Bank |
| Mobile money transfer value | KSh ~5,213B → ~8,698B (growth) | KNBS 2025 Economic Survey |
| 2GB data affordability | ~**1.97% of monthly income** (cheapest in E. Africa) | World Bank / Business Daily |

**Implications for the page**
- Design for a **young (median ~21), mobile, Android, budget-device** user.
- Assume **low disposable income** → talk in *small, real* KES amounts (e.g. "from KES 20"),
  never in thousands or dollars.
- Keep the page **light** (few images, no heavy autoplay) — data is cheap *relative to the
  region* but every MB still costs a real fraction of a small income.

---

## 2. The betting / gambling landscape (the closest existing mental model)

Kenya is one of Sub-Saharan Africa's largest betting markets (3rd after South Africa &
Nigeria; previously #1). This is the **only** adjacent behaviour our users already understand —
so it is both our biggest comprehension bridge **and** our biggest positioning risk.

- **Participation:** ~79% of Kenyans reported online betting (GeoPoll 2025); ~70% of *young*
  Kenyans have wagered on sport. Historically 82–84%.
- **Channel:** ~88–91% bet via mobile phone; ~94% Android.
- **Frequency:** 35% weekly, 22% monthly, 14% daily, 9% multiple times/day.
- **Spend:** majority **< $10/month**; 28% $10–$25; ~3% $100–$500+. → *stakes are small.*
- **Incumbents / mental models the user carries in:**
  - **SportPesa** (pioneer, ~35%), **Betika** (football-heavy, ~25%), GameMania, Betway,
    Maybets. Top 3 ≈ 56%+ of demand.
  - **Aviator** (~19% of bettors) — a fast "crash" game. Users know *instant, tap, win/lose*.
  - Core is **football**, overwhelmingly **English Premier League**.
- **Turnover scale:** ~KSh 2.1B wagered **daily** (~KSh 766B/yr); 2024 market ~$100M+.

**Strategic read.** Users arrive with a **SportPesa/Aviator** frame: *pick a side, stake
small, win or lose fast, cash to M-Pesa.* We can **borrow the familiarity** (small stakes,
M-Pesa, yes/no simplicity) while **rejecting the harm frame** (addiction, "shortcut to
wealth", chasing losses). The winning positioning is **"informed prediction, not blind
betting"** — *you decide based on what you know about the real world.*

---

## 3. Regulatory & legal environment (hard constraints on copy)

**This section is binding, not advisory. The landing page copy is legally constrained.**

### 3.1 Structural reform (2025)
- **Gambling Control Act, 2025 (Act No. 14 of 2025)** establishes a new **Gambling
  Regulatory Authority (GRA)**, replacing the **Betting Control & Licensing Board (BCLB)**.
- Objectives explicitly include **promoting responsible gambling**, social protections
  (e.g. savings components), real-time electronic monitoring, and KRA tax-compliance linkage.
- During transition, new/renewal licence applications are frozen; existing licences run to
  expiry (99 companies approved for 2025/26).

### 3.2 Taxation (Finance Act 2025, effective 1 July 2025)
- **Excise duty: 5% on the amount *deposited*** into a betting/gaming wallet (down from 15%,
  and moved from "amount wagered" to "amount deposited").
- **Withholding tax: 5% on *withdrawals*** from a punter's wallet (replaced prior 20% on net
  winnings). → tax base is now deposit-in / withdraw-out, **not** winnings.
- **30% corporation tax** on taxable income.
- Digital-economy taxation broadened to online betting/gaming/advertising, residents and
  non-residents.

> **Product implication.** If Kichiko is regulated as betting/gaming, **users are taxed on
> deposit (5%) and on withdrawal (5%)**. This *must* be surfaced honestly and simply
> ("A 5% government tax applies when you deposit and when you withdraw — set by law, not by
> us"). Hidden tax = the #1 trust-breaker for this audience. **Open question for legal: is
> Kichiko classified under the Gambling Control Act, or as something else?** The answer
> changes the entire copy and disclosure set (see §12).

### 3.3 Advertising ban & BCLB marketing rules (2025) — **directly shapes the landing page**
In April 2025 Kenya **suspended all gambling advertising** (TV, radio, social, print,
billboards, branded vehicles) for 30 days over youth-addiction concern, then imposed
**permanent strict rules**. If we are treated as gambling advertising, the landing page (a
public marketing surface) must:
- **NOT** glamorize, use celebrity/influencer endorsements, testimonials, "former winners",
  or **"call-to-action" hype**.
- **NOT** appeal to minors; **NOT** be placed near schools/religious sites.
- **MUST** carry standardized disclosures: **"Gambling is addictive! Play responsibly"**,
  **minimum age 18**, operator name/address, customer-care number, and
  **"authorized and regulated by the [BCLB/GRA]"**.
- Digital ads: mandatory **age-verification** and anti-predatory safeguards.
- Public sentiment (faith groups, educators, mental-health advocates) is **actively hostile**
  to betting normalization.

> **Copy implication.** The landing page must read as **calm, informative, protective** — the
> opposite of "WIN BIG TODAY!". This *aligns perfectly* with the dossier's "never a casino /
> trust before money" north star. The regulatory environment and good UX point the **same
> direction**: restraint, clarity, disclosure.

---

## 4. Money & payments (how value moves — and how trust is signaled)

- **Currency is the Kenyan Shilling (KES / "KSh").** Codebase already defaults to KES and
  supports UGX, TZS, RWF, ZMW, ETB, BIF, USD.
- **M-Pesa is the rail** (~88% adoption); Airtel Money secondary; crypto <2% and
  **scam-associated** (avoid crypto framing on the pilot landing page).
- **UX expectations set by M-Pesa** (the trust benchmark we are measured against):
  - **STK Push** — a prompt pops on the phone, user enters M-Pesa PIN, done. Instant.
  - **Hakikisha** — name verification before sending ("you are paying KICHIKO — correct?").
    *This is a core Kenyan trust ritual; replicating a "confirm who you're paying" moment
    builds instant credibility.*
  - **Paybill / Till** numbers are a recognized, trusted merchant pattern.
  - **Reversal** capability exists → users expect a path to fix mistakes.
- **Fees matter and must be transparent.** With 5% deposit excise + 5% withdrawal WHT, the
  net a user gets back is materially less than face value. Surfacing this plainly *before*
  deposit is a trust win, not a conversion loss, for this audience.

> **Landing-page implications**
> - **Show KSh, never $.** Replace all `$`/USD volume displays on public surfaces with KES.
>   (Internal USD accounting can stay; the *display* must be local.) This is currently a
>   **friction/obstruction** bug: the home page reduces and shows `total_volume_usd`.
> - **Lead with M-Pesa** as the deposit method, with the Safaricom-green cue already present
>   (`IconMpesa` exists in the codebase). "Deposit with M-Pesa" is a *clarity + trust* phrase.
> - **Name the amounts small and real:** "Start from as little as KSh 20."

---

## 5. Language & localization (the core of "every word")

**Headline finding: for money, Kenyans trust and prefer clear ENGLISH.** The M-Pesa Kiswahili
localization study found 83% preferred English, 65% never used the Swahili menu, and the
Swahili that existed felt "hard/unfamiliar." Swahili and **Sheng** (Swahili-English youth
slang) are the languages of *identity, humor, and belonging* — powerful for a tagline or a
reassurance, weak and even alienating for instructions and forms.

**Practical language policy for the pilot:**
1. **Default UI language: plain, simple English.** Short words. Everyday words. No finance
   jargon. Reading level ~ a 12-year-old. (The repo already ships `en`, `sw`, and a `en-XA`
   pseudo-locale + `next-intl`; keep `en` as the primary, keep `sw` available but treat it as
   secondary and **professionally, warmly** translated — not textbook Swahili.)
2. **Use Swahili/Sheng sparingly for warmth**, where it's genuinely natural
   (e.g. a friendly empty-state or a reassurance line), never for critical actions,
   money amounts, legal text, or error messages.
3. **Avoid Sheng in core UI** — it varies by neighborhood, dates fast, and excludes older /
   rural / non-Nairobi users. Reserve for optional marketing moments.
4. **Code-switching is normal in speech** but should not leak into transactional copy; keep
   one language per sentence.
5. **Numbers, dates, currency:** Kenyan conventions — `KSh 1,250`, 24h or 12h clock as
   locally shown, East Africa Time (EAT), day-month-year.

---

## 6. Trust, scams & the psychological landscape (why restraint converts)

Kenya's audience is **simultaneously** eager to make money **and** highly alert to being
conned. Both are true at once, and both must be respected.

- **Scam history is vivid:** DECI, Ekeza Sacco, Amazon Web Worker, and a 73% rise in crypto
  fraud (2024, ~$43.3M). Regulators (CMA, CBK, DCI crypto unit) issue frequent public
  warnings.
- **The exact red flags regulators tell people to fear** are: *guaranteed/high/fixed returns,
  "earn daily/weekly", referral/recruitment pressure, upfront fees, unregistered platforms,
  withdrawal problems, no verifiable contact/regulator.*
- **A prediction market trips several of these on first glance** (put money in → maybe get
  more out; percentages that look like "returns"; a novel platform). **We must pre-empt every
  one of them.**

**Anti-scam trust checklist the landing page must satisfy (each is a conversion lever here):**
- [ ] **Name a regulator / licence** prominently (once classification is confirmed).
- [ ] **Real, verifiable contact** — a phone number and physical presence (Kenyans check).
- [ ] **"You can lose money" stated plainly** — honesty reads as legitimacy here, not weakness.
- [ ] **No "guaranteed", "earn", "daily returns", "double your money", referral-bait.**
- [ ] **Explain resolution transparently:** *who decides the answer, and from what public
      source.* ("When the match ends / when the official result is published, the market pays
      out. The source is shown on every market.")
- [ ] **Clear withdrawal promise:** *your money is yours; here's exactly how you take it out
      to M-Pesa, and the tax that applies.*
- [ ] **Show real, live activity** (volumes in KES, number of people) — social proof of a
      functioning, non-empty market — **without** testimonials/"winners" (ad-rule compliant).

---

## 7. Explaining a prediction market to someone who has never seen one

The comprehension gap is the whole game. Canonical (Polymarket/Kalshi/Kalshi-press)
definition, and how to translate it for Kenya:

**What it actually is (canonical):** you buy Yes/No "shares/contracts" in whether a real
event happens; each pays a fixed amount (e.g. $1 / KSh 100) if you're right, KSh 0 if wrong;
the price (0–100%) reflects the crowd's estimated probability and moves with the news; you can
sell before it ends.

**Why the canonical words fail here:** *contract, share, order book, liquidity, "trade
probability", position, settle* — all are finance jargon that this audience does not carry.
Using them = **confusion + scam-suspicion** (jargon is how scams sound clever).

**Recommended plain-language model (English, ~grade-6):**
> **"Answer a question about the future. If you're right, you win."**
> - Pick a real question — *"Will it rain in Nairobi this weekend?"*, *"Will Arsenal win on
>   Saturday?"*, *"Will fuel prices go up next month?"*
> - Choose **Yes** or **No**.
> - The **price shows what most people think will happen** (e.g. *Yes costs KSh 65 out of
>   100 → the crowd thinks it's likely*).
> - If you're right when the result is known, **each KSh 100 answer pays KSh 100.** If you're
>   wrong, you don't get that money back.
> - You can **change your mind and sell** before the result if you want.

**Framing pillars:**
- **"It's about what you KNOW, not luck."** (differentiates from Aviator/casino → aligns with
  responsible-gambling posture and dodges the "blind betting" stigma).
- **"The price is the crowd's opinion, updating live."** (the genuinely novel, honest hook).
- **Concrete local examples beat abstractions** every time.

---

## 8. Cultural relevance (what questions will actually convert)

Markets/examples on the landing page should reflect what Kenyans *care about and discuss*:

- **Football, above all — EPL.** ~96% EPL followership in Kenya; **Arsenal** the most-supported
  club (Arsenal's 2026 title sparked mass Nairobi celebration, cross-party public figures
  joining in). Football is the safest, most-understood, most-engaging entry category.
- **Politics** — high engagement, **2027 general election** already a live topic. Powerful but
  **sensitive**; handle with neutral, factual, clearly-resolvable questions and strict
  moderation (and mind BCLB "public interest" sensitivities).
- **Cost of living / economy** — fuel prices, forex, inflation: deeply felt daily concerns,
  excellent for "about the real world, not luck" positioning.
- **Weather / rain** — agriculture and daily life; intuitive, non-sensitive, great for
  teaching the concept.
- **Entertainment / culture** — Big Brother, music, local events: light, social, youth-friendly.

> Lead the landing page with **football + weather + cost-of-living** examples (understandable,
> non-sensitive, resolvable). Keep politics present but not the first thing a nervous newcomer
> sees.

---

## 9. Income, affordability & stake sizing

- Working-youth income ≈ **KES 5,616/month**; typical betting spend **< $10/month**.
- → **Minimum stakes and deposits must be tiny and explicit** ("from KSh 20"). Anything that
  implies you need real capital will obstruct the exact users we want.
- Data is affordable *for the region* but the page must still be **light and fast** on 3G and
  cheap Android hardware.
- **Responsible-play must be real, not decorative:** deposit/loss limits, self-exclusion,
  cool-off — both a legal expectation and a genuine trust signal to a wary, low-income
  audience and a hostile public.

---

## 10. Lexicon audit — the words themselves ("clarity / confusion / friction / obstruction")

The brief's core instruction. This table is the actionable heart of the research and should
drive the copy pass on the landing page and beyond.

| Word/phrase (candidate) | Verdict | Why | Use instead |
|---|---|---|---|
| **"Earn" / "Predict & Earn"** (current hero) | ❌ **Obstruction** | Top scam-ad trigger *and* likely violates BCLB "no shortcut-to-wealth / call-to-action" rules | "Predict what happens next" / "Back what you believe" |
| **"Win big" / "Cash out daily"** | ❌ Obstruction | Glamorizing; scam + ad-rule violation | (avoid entirely) |
| **"Guaranteed / returns / double"** | ❌ Obstruction | Exact CMA/CBK scam red-flag vocabulary | "You can win — and you can lose" |
| **"Bet / Betting"** | ⚠ Friction | Familiar (bridges from SportPesa) **but** invokes gambling frame, stigma, and ad-ban regime | Prefer **"predict / your answer / your call"**; use "bet" only where legally required |
| **"Trade / Trading"** | ⚠ Confusion | Finance jargon; also forex-scam-adjacent | "Buy Yes / Buy No", "change your mind and sell" |
| **"Contract / Share / Position"** | ❌ Confusion | Pure jargon; zero existing mental model | "your answer", "Yes/No", "what you're holding" |
| **"Order book / Liquidity / Market maker"** | ❌ Confusion | Institutional jargon; hide from novices | (surface visually, not verbally) |
| **"Implied probability" / "Odds"** | ⚠ Friction | Correct but cold; "odds" also gambling-coded | "What most people think will happen", "chance" + a live % |
| **"Resolve / Settle"** | ⚠ Friction | Unfamiliar verb usage | "When the result is known, we pay out" |
| **"$ / USD" volume displays** | ❌ **Friction+distrust** | Reads as foreign/not-for-me; currently shown on home page | **KSh** everywhere on public surfaces |
| **"Wallet / Deposit / Withdraw"** | ✅ Clarity | Directly familiar from M-Pesa/betting apps | keep — pair with M-Pesa |
| **"M-Pesa"** | ✅ Clarity+trust | Highest-trust money word in Kenya | feature prominently |
| **"Regulated / Licensed by [GRA/BCLB]"** | ✅ Trust | Directly answers the #1 scam fear | keep — but only if true & verifiable |
| **"Play responsibly / 18+"** | ✅ Trust+compliance | Required disclosure *and* reassuring | keep, visible not buried |
| **"KSh 100 pays KSh 100"** style | ✅ Clarity | Concrete, no jargon, teaches the mechanic | use in the explainer |

**Rule of thumb going forward:** if a word requires a finance dictionary, a casino, or a
foreign currency to understand, it is **confusion, friction, or obstruction** — replace it
with a plain-English, KES-native, real-world phrasing, and reserve Swahili/Sheng for warmth.

---

## 11. Landing-page conversion implications (research → design directives)

1. **Comprehension-first hero.** One sentence a newcomer instantly gets ("Answer questions
   about the future. If you're right, you win.") + one concrete local example (football or
   weather). Kill "Predict & Earn."
2. **KES everywhere.** Remove USD from all public displays; show `KSh` volumes/prices. (Code
   change: home page currently sums/show `total_volume_usd`.)
3. **Trust band above the fold / before any deposit ask:** regulator/licence, "you can lose
   money", how questions resolve + public source, real contact, M-Pesa + Hakikisha-style
   confirmation, responsible-play + 18+.
4. **M-Pesa-led money story.** "Deposit with M-Pesa in seconds." Be honest about the 5%
   deposit / 5% withdrawal government tax.
5. **Small, real numbers.** "From KSh 20." No thousands, no dollars, no "big wins."
6. **Plain English UI; warm Swahili/Sheng accents only.** No jargon (contract/trade/position/
   order book/implied probability) in primary copy.
7. **Culturally lead with football + weather + cost-of-living**; politics present but not the
   first thing a nervous newcomer meets; strict, neutral resolution.
8. **Light, fast, Android-first, bright-sun-legible.** Minimal heavy media; strong contrast
   (WCAG AA+, already a stated gate); works on cheap devices and 3G.
9. **Restraint as strategy.** Calm, Bloomberg×Stripe×Linear, "never a casino." This
   simultaneously satisfies BCLB ad rules, the hostile public mood, *and* converts a wary
   first-timer.

---

## 12. Risks, open questions & things to confirm before copy is finalized

1. **Legal classification (BLOCKER for final copy).** Is Kichiko licensed/regulated under
   the **Gambling Control Act 2025** (→ full BCLB ad rules + 5%/5% taxes + gambling
   disclosures apply), or positioned as a different regulated instrument? Every disclosure,
   the use of the word "bet", and the tax messaging depend on this answer. **Confirm with
   legal/founder before shipping public marketing copy.**
2. **Which regulator name to display** (BCLB is being dissolved into the GRA during a
   transition) — display the currently-correct authority and a verifiable licence reference.
3. **USD volume display** is a live friction/obstruction issue in the current home page —
   should be fixed to KES as part of the landing work.
4. **`sw` (Swahili) locale strategy:** keep available but do not force; ensure any Swahili is
   *natural and clear*, not textbook (per the M-Pesa study failure mode). Decide whether
   Swahili is a full UI locale or only marketing warmth for the pilot.
5. **Tax transparency mechanics:** confirm exact points at which 5% excise (deposit) and 5%
   WHT (withdrawal) are applied and how they'll be shown to users.
6. **Responsible-play features** (limits, self-exclusion, cool-off) must exist and be linked
   from the landing page — both compliance and trust.
7. **Ad-placement compliance:** if run as paid marketing, pre-approval/age-gating obligations
   may apply.

---

## 13. Sources

- iGamingAfrika — *Kenya iGaming market overview: growing through the reset* (2026).
- iGamingToday — *Kenya iGaming Market Research Report* (2025).
- GeoPoll / technext24 — *79% of Kenyans engage in online betting* (2025); *Africa Football
  Survey 2026* (EPL/Arsenal).
- E-Play Africa — *Kenya drops from top gambling country* (2025).
- Finance Uncovered — *Kenya's £235m-a-month gambling* (leaked BCLB 2019 data).
- Kenya Law — *Gambling Control Act, 2025 (Act No. 14 of 2025)*; *Finance Act 2025 amendments*.
- KPMG — *Finance Act 2025 Analysis* (excise/WHT changes, eff. 1 Jul 2025).
- McKay Advocates — *Client alert: tax changes for betting & gaming operators* (2025).
- BCLB / Executive Office of the President — *Press release & advertising guidelines*
  (30 May 2025); Switch TV, The Star, Jumuiya — 2025 ad-ban coverage.
- JoSTrans (2015) — *Acceptance & usability of Kiswahili-localised M-Pesa app* (83% prefer
  English).
- Appen / CLEAR Global — *Sheng language*; arXiv — *State of NLP in Kenya*.
- Kenyans.co.ke, TechTrendsKE, Huduma Global, BBC, K24 — Kenya scam / Ponzi / CMA warnings.
- World Bank / Business Daily — mobile-data affordability (2GB ≈ 1.97% of income).
- Shujaaz Inc. — *Kenya Youth Trends* (avg working-youth income ≈ KES 5,616/mo).
- KNBS — *2025 Economic Survey (Popular Version)*; FRED/World Bank — youth unemployment.
- Safaricom / reply.cash — M-Pesa services, STK Push, Hakikisha, Paybill/Till UX.
- Beacon Journal, NerdWallet, USA Today, getaitoolhub — prediction-market beginner explainers.

*Internal cross-references:* `docs/design/LANDING-PAGE-DOSSIER.md` (positioning north star),
`docs/05-CURRENCY.md` (KES-native, multi-currency model), `docs/i18n/TRANSLATION.md`,
`apps/web/lib/currency.ts` (KES default + FX), `apps/web/app/page.tsx` (⚠ shows USD volume).
