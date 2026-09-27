# 41 — UI program work plan v2 (supersedes 20)

Written 2026-09-27. Supersedes [20-WORK-PLAN](20-WORK-PLAN.md) in full; 20 remains as history.
Evidence: [40-ELEMENT-MATRIX](40-ELEMENT-MATRIX.md) (every page and element, three products),
the three captures in `captures-v2/`, [31](research-v2/31-PSYCH-MONEY-RISK.md) and
[32](research-v2/32-PSYCH-MOBILE-TRUST.md) (primary-source research), and
[33](research-v2/33-KENYA-LN112-EXCERPT.md) (gazetted law, verified first-hand).

**Standing decisions.** KES and % (owner, 2026-09-27). Kichiko keeps its own design system (Pip);
it borrows *patterns*, never branding.

**What changed since 20, in one list** (each is measured or verified, none is opinion):
1. Four of 20's thirteen "binding" psychology rules hold as written; eight were overstated; one was
   wrong (rule 8). The corrected set is [31 §6] and [32 rules 1–15].
2. The Kenyan regulations 20 cited were an unsigned draft. The gazetted **L.N. 112 (30 June 2026)**
   regulates prediction markets directly (Reg. 45(5)–(8)).
3. The audit's "~725 dead classes / colourless legal links" was wrong; the real defect (442 + 8) is
   fixed and gated in CI.
4. Competitors are now measured page by page, in both themes, including throttled performance.
5. Kichiko's own UI is measured against live production data for the first time.

---

## 0. Do we start with the landing page?

**No. Start with what is unlawful, then what is untrue, then the ticket.** The landing page is
Phase 4. Four measured reasons, strongest first.

1. **Acquisition would currently drive people to unlawful surfaces.** Two live markets concern
   proceedings pending before a Kenyan court (L.N. 112 Reg. 45(7)(a), text verified): the
   Gachagua appeal market and the Gachagua ballot market that "hinges on the courts". The hero
   CTA reads "Predict & Earn"; "earn" framing is prohibited in Kenyan gambling advertising
   (L.N. 114, per [31]). A landing page multiplies traffic into exactly these surfaces.
2. **The home page shows numbers that are not true.** The hero and feed charts are truncated by a
   1,000-row cap (market with 1,908 points shows only 24–30 April on 27 September), and the
   "movers" percentages are computed from the truncated rows. Market pages are worse: they fetch the
   *oldest* 200 (binary) or 1,000 (multi-outcome) points, so the chart a trader decides on ends months
   ago [40 A13]. A landing page built on these components inherits the defect.
3. **The ticket carries every serious money defect we measured** [40 §D]: payout text at 2.18:1,
   quick amounts that are converted US dollars (+KSh 130/648/1.3k/13.0k), a stake pre-filled
   with KSh 130, ¢ in the limit row, no fee line, no "if No you lose" line. The landing page's
   whole purpose is to send people here.
4. **The landing page is the most token-dense surface.** Theme default (forced dark → follow the
   OS), the contrast floor (ratio **and** ΔY for sunlight), the type floor and the spacing scale are
   all set in Phase 1. Built first, it gets built twice.

**The condition that flips this.** A dated acquisition event (campaign, press, investor demo). Then
Phase L and Phase 0 still come first (days, not weeks), landing moves to right after Phase 1, and we
accept one rebuild. Launching traffic before Phase L is the one ordering we should never accept.

---

## 1. What "Apple-level" means here, as things a test can fail

"Apple-level" is not a look. It is a set of properties, each of which we can measure. Apple's HIG
and Material 3 are *conventions* (MODERATE evidence [32 §2.10]); our audience is 80–94% Android
[32 §0.4], so we meet Apple's quality bar on Android's conventions (Back closes the top sheet;
system fonts on the critical path).

| Principle | Property | Gate |
|---|---|---|
| Clarity | One number per decision, largest on screen; integer %; `KSh` only; no ¢, `$`, multipliers | Formatter unit tests + rendered-text lint on every route (G-NOTATION) |
| Clarity | Money figures ≥20 px, body ≥16, nothing <12; tabular numerals | Computed-style assertion on money routes (G-TYPE) |
| Legibility outdoors | Money ≥7:1 and ΔY ≥0.80; other text ≥4.5:1 and ΔY ≥0.50; both themes | `a11y-contrast.test.ts` over every token pair (G-CONTRAST) |
| Deference | Content first: no auto-rotating hero, no auto-opening modals, no attention lists | Review checklist + test that no dialog opens without input (G-NO-AUTO) |
| Direct manipulation | Every control ≥44×44, commit ≥48 tall, ≥8 px apart; pressed paint ≤100 ms at 4× CPU | Playwright geometry + trace (G-TARGET, G-PRESS) |
| Feedback | Inline validation in KSh; `aria-invalid`; "Pending" until the server confirms | Ticket unit + e2e (G-VALIDATE, G-PENDING) |
| Depth | Sheets trap focus, return focus, close on Back and Escape | Focus-trap tests on all 8 dialogs (G-FOCUS) |
| Motion | Feedback ≤150 ms, sheets ≤300 ms, reduced-motion honoured, nothing auto-moves >5 s | CSS audit + reduced-motion snapshot (G-MOTION) |
| Speed | JS ≤150 KB, total ≤400 KB, render-critical ≤60 KB, LCP ≤2.5 s Slow 4G and ≤4.0 s 3G at 360×800 | Lighthouse CI mobile, `error` level (G-PERF) |
| Honesty | Every number traceable to a DB row; the only countdown is `closes_at` | Series-freshness test + review gate (G-TRUTH) |
| Consistency | One formatter, one token source, one component per pattern | Lint: no second `formatPercent`; Tailwind class checker (exists) |

---

## 2. The hybrid: what we take, what we refuse, what we invent

Every line points to its row in [40].

**Adopt from Polymarket:** information density with fixed 180 px feed cards (B1); the 2 px spacing
scale (A8); hierarchy by magnitude (C1); multi-outcome row geometry at ≥48 px (C4); the sticky
resolved outcome (C6); 16 px mobile search input (G2).

**Adopt from Kalshi:** a distinct numeric face for money (A10); fees inside the price (D6);
URL-encoded ticket state, so it survives auth and is shareable (D1); OS-following dark mode (A7);
cross-operator self-exclusion (→ Kenya's national register) and a deposit cap that cannot be
raised early (I1, I2).

**Refuse from both:** ¢ and multiplier pricing (A1); two sides that sum to more than 100 on one
surface (A2); sub-44 px targets (A4, B3); disabled zoom (A5); no focus ring (A6); auto-opening
sign-up (B6); profit leaderboards and winner feeds (H1, H2); attention tabs like "Breaking" (A12);
multi-megabyte pages (A11); silent tickets with no validation (D7); hidden or missing fees (D6).

**Invent (neither does it; evidence says we should):**
1. **The money block** on the ticket and confirm: `You pay KSh X` · `If Yes: you get KSh Y` ·
   `If No: you lose KSh X`, with the fee as a visible KSh line (D5, D6). BINDING display duty;
   behaviour tested in E2.
2. **Verify-before-commit for M-Pesa**: recipient name, amount in numerals and words, masked
   number, before the STK push; withdrawals only to the owner's number (E2). Answers the dominant
   local loss mode (70% accidental sends).
3. **M-Pesa-shaped receipts**, searchable by transaction code (E3).
4. **Resolution transparency**: question, close time and resolution source inside the price block
   and the ticket; resolved markets show evidence and time (C3, C6). BINDING (Reg. 45(1), 45(6)).
5. **Human outreach to the heaviest losers** (I4): the best evidence-to-cost ratio in [31].
6. **A published calibration record**: how often our 70% markets resolved Yes, with intervals
   [31 edge 2]. A trust asset for a scam-primed audience, built from settled data we must keep
   anyway (Reg. 45(8)).
7. **Legality as a feature**: the GRA approval line on every market, once approval exists [31 edge 6].

---

## 3. Binding design law (v2)

The rule text, grades and acceptance criteria live in [31 §6] and [32 §2]. This is the index.
Law-backed rules are marked **L**.

| Area | Rules | Source |
|---|---|---|
| Legal gates | LW-1 age KE 18 / **UG 25** / TZ 18 / RW 18 on verified ID before deposit (**L**); HM-1 GRA approval ref per market and banned subjects (**L**); min stake KSh 20 (Act s.71, **L**); DP-8 no skill/investment/income/"earn" copy (**L**) | [31], [33], Act |
| Money display | FE-1 all-in price, fees itemised in KSh on the same sheet (**L** + STRONG); FR-1 money block (**L**); FR-2 no payout/return/multiplier headlines; PR-1 integer %; PR-2 question, close, source in the price block (**L**); PR-4 verbal probability only inline with a number | [31] |
| Defaults | DF-1 no pre-selected side; DF-2 empty stake, set-chips {20, 50, 100, 200}, no Max; DF-3 limits default-on, free text; decrease now, increase ≥24 h (TZ 7 days) | [31] |
| Harm | HM-4 notification allow-list, none on loss (**L** for promotions); HM-5 loss screen is a dead end; HM-6 reality checks (**L**); FR-5 no celebration when net ≤0; RG-1 self-exclusion ≤2 taps (**L**); RG-3 outreach; RG-5 exit ≤ entry (**L**); DP-3/4 no profit leaderboards, winner feeds, streaks, confetti; DP-5 no inducements at launch | [31], [33] |
| Charts | CH-1/CH-2 fixed 0–100 axis, default `All`, no 1H or candles | [31] |
| Interaction | K32 rules 1–15: targets, reach band, verify-before-commit, receipts, all-in cost, ΔY contrast, word-first Yes/No, type floor, follow-system theme, pressed state, pending state, motion, logged-out preview, system fonts + Android Back, RUM | [32] |

Where [31] and [32] disagree, the verified document wins: [33] settles the regulation numbering
(gazetted L.N. 112, not the March draft [32] read).

---

## 4. Phases

Each phase has an entry condition and an exit gate that is a test, not an opinion.

### Phase L — Legal exposure *(now; needs the owner and counsel)*

Entry: none.
- **L.1** Decide on `ke-gachagua-appeal-upheld` and `ke-gachagua-on-ballot-2027` (Reg. 45(7)(a)).
  Owner decision; I will not change production data unasked.
- **L.2** Replace "Predict & Earn" (`hero-section.tsx:421`) with neutral copy; add a copy-lint test
  banning `earn`, `income`, `invest`, `profit`, `guaranteed` in UI strings.
- **L.3** Market publishing requires `gra_approval_ref` (Reg. 45(5)) and passes a banned-subject
  validator (court proceedings; safety, health or death of an identifiable person; security).
- **L.4** Per-country age rule in KYC (UG 25) and min stake KSh 20 enforced server-side and in the
  ticket.

Exit gate: no live market fails the validator · copy-lint green · schema requires the approval ref
for `KE` · age and min-stake unit tests green.

### Phase 0 — Make the ground true *(finish)*

Done 2026-09-27: 0.1 dead classes (CI-gated), 0.3 re-capture (captures-v2), 0.4 shell, 0.5
viewport. Remaining:
- **0.2 Spec of record.** `docs/design/SPEC-OF-RECORD.md`, with [40] as the ruling source for every
  element it covers; the remaining corpus contradictions from [21] each get one ruling; supersession
  headers on every replaced doc.
- **0.6 Chart truth** (A13): newest-first, per-market series on home, feed and market pages (the
  API route's pattern), downsampled to the display width; freshness test.
- **0.7 One formatter** (A1, B0): `formatKsh` / `formatPct` only; remove `formatCents` from UI,
  two of the three `formatPercent`, all `text-transform` on currency.
- **0.8 Search URL state** (G1): read and write `?q=`.

Exit gate: G-NOTATION and G-TRUTH green on every route · spec of record merged.

### Phase 1 — Foundation *(tokens, contrast, targets, speed)*

Entry: Phase L and 0.2.
- **1.1** Follow the OS theme (A7); both themes pass the v2 contrast floor, including ΔY (A3).
- **1.2** Fix the ticket's failing pairs first (2.18, 2.03, 1.91), then every pair the capture
  flagged.
- **1.3** Spacing scale on 2 px with 6/10/14 (A8); type floor (A10).
- **1.4** Targets: every control ≥44, commit ≥48; fix the 158 sub-24 px targets on multi-outcome
  pages (A4, C4).
- **1.5** Visible focus ring everywhere (A6); pinch-zoom test (A5).
- **1.6** Performance to budget (A11): JS 250–400 KB → ≤150 KB; Lighthouse CI mobile at 360×800,
  Slow 4G and 3G, `error` level; the device matrix of [32 §3.4] (D1–D6 in CI, R1–R4 real devices
  before release).
- **1.7** Rename the "Breaking" tab to "New" (A12).

Exit gate: G-CONTRAST, G-TARGET, G-TYPE, G-PERF, G-FOCUS green on D1 and D6 in both themes.

### Phase 2 — The money path *(highest leverage)*

Entry: Phase 1.
- **2.1** Split `pm-ticket.tsx` (1,877 LOC), stop importing it twice.
- **2.2** Ticket per [40 §D]: no pre-selected side; empty stake; chips {20, 50, 100, 200}; money
  block; fee line; integer %; limit price in %; inline validation in KSh; no "shares"; URL-encoded
  state restored after auth.
- **2.3** Confirm, receipt, pending, verify-before-commit, M-Pesa-code receipts [40 §E].
- **2.4** First UI tests: RTL + jsdom; render and arithmetic tests for the ticket.
- **2.5** An e2e that places an order on staging (never production), and the tap-count test
  withdraw ≤ deposit.

Exit gate: G-VALIDATE, G-PENDING, G-PRESS, flow symmetry, e2e order placement, axe clean at
*moderate* and above on all money routes.

### Phase 3 — Discovery

Entry: Phase 2.
Fixed-height feed cards (B1); no auto-rotating hero; fixed 0–100 chart axis, default `All` (B4);
series colours ≥3:1 (C5); search empty state (G1); `next/image` for remote images; the leaderboard
decision (H1) implemented.

Exit gate: no ragged card heights · every feed affordance ≥44 · LCP budget green on the feed.

### Phase 4 — Landing and acquisition

Entry: Phase L and Phase 1. May run alongside Phase 3.
Built once on settled tokens. Ad rules apply to promotional surfaces (L.N. 114 per [31]: licence
number, helpline, "authorized and regulated by the Gambling Regulatory Authority", no testimonials
or former winners, no call-to-action in ads). Measured values for *our* landing (today: none), JSON-LD,
the same performance budget.

### Phase 5 — Responsible play, compliance depth, language

Entry: Phase 2.
Reg. 84 tools (deposit/loss/session limits, reality checks, self-exclusion ≥24 h, national
register); DF-3 default-on limits; RG-3 outreach; the calibration record; Kiswahili for real (2 of
174 files use i18n today), with E8 deciding money-line language; admin design record.

---

## 5. Verification regime

1. **Every measurement is JSON and re-runnable.** Harnesses: `captures-v2/{polymarket,kalshi,kichiko}/harness/`.
   Re-run monthly and before any design review; the diff is the report.
2. **Gates in CI** (named above): G-NOTATION, G-TRUTH, G-CONTRAST, G-TARGET, G-TYPE, G-PRESS,
   G-VALIDATE, G-PENDING, G-FOCUS, G-MOTION, G-PERF, G-NO-AUTO, plus the existing Tailwind class
   checker. A rule with no gate is a preference.
3. **Suites fail rather than skip.** 6 of 7 e2e specs call `test.skip` on empty data today [22].
4. **Field truth.** RUM for LCP/INP/CLS by country and network within 30 days of launch; re-derive
   the budget from it [32 rule 15].
5. **Experiments, pre-registered, every arm at least as protective as production.** [31 §4] E1–E9
   (comprehension, money block, calibration line, default limits, chart default, sell sheet,
   market duration, Kiswahili money lines, licence line) and [32 §5] E1–E11 (target size on budget
   Androids, outdoor legibility, ticket comprehension, skeleton vs SSR, verify-before-commit,
   language, KYC order, trust signals, commit placement, motion, our real device mix). Guardrails on
   every test: self-exclusion rate, limit-hit rate, top-decile deposit frequency, complaints.

---

## 6. Decisions owed by you

1. **The two court-case markets** (Phase L.1). Recommendation: hide both today and have counsel
   confirm against Reg. 45(7)(a).
2. **Is Kichiko approved by the GRA to offer prediction markets** (Reg. 45(5))? If not, every market
   is exposed, not only these two. This decides whether "legality as a feature" is available.
3. **Leaderboard** (H1): remove, or replace with an opt-in, non-monetary accuracy board.
   Recommendation: replace; winners' identities are confidential without written consent (Reg. 87
   per [31]).
4. **Theme default** (A7): follow the OS (recommended) or keep forced dark.
5. **Fee model** (still open from 20): whichever you choose must be shown as one all-in KSh figure
   with a visible line (FE-1).
6. **Inducements** (from 20's rewards question): Kenyan law permits free bets and bonus bets
   (s.72(7), 74(3) per [31]); the evidence says they raise wagering and loss of control.
   Recommendation: none at launch (DP-5).
7. **Uganda launch** implies the age-25 gate (L.4).
8. **Public repository** (still open from the handoff).

---

## 7. Not verified — do not treat as fact

- **Kalshi production UI.** kalshi.com blocked this server; all rendered Kalshi values are from
  demo.kalshi.co (grade D). Wayback retrievals failed.
- **Kalshi and Polymarket confirm/submit/receipt flows** (need accounts), and Polymarket
  portfolio/deposit (no logged-out entry).
- **Polymarket non-US performance**: its LCP element was the US geo sheet on every page.
- **Our own timings** include a US→Dublin hop from this sandbox; byte counts are exact.
- **L.N. 114 advertising rules, Reg. 82/84/87** are as read by [31] from gazetted texts; only
  Reg. 45(5)–(8) and Act s.71(1) were re-read first-hand by the lead.
- **Uganda's age 25**: verified by [31] from the 2016 Act; a post-2018 amendment could not be ruled
  out (ULII blocked).
- **Borsboom 2022 and Bürgi et al. magnitudes**: abstracts only.
- **Our logged-in surfaces** (portfolio, deposit, withdraw, KYC, settings): not captured; needs a
  staging test account.
