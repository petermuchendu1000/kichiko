# UI program 2026-09: work plan

Written 2026-09-27. Evidence: [`21-CORPUS-CATALOGUE`](21-CORPUS-CATALOGUE.md),
[`22-UI-AUDIT`](22-UI-AUDIT.md), [`23-COMPETITOR-CAPTURE`](23-COMPETITOR-CAPTURE.md),
[`24-PSYCHOLOGY`](24-PSYCHOLOGY.md). Every number below is traceable to one of those
four; nothing here is recalled or assumed.

Evidence grades used throughout: **M1** instrument-measured (Playwright computed
style / geometry, this session or a named prior harness), **M2** API snapshot,
**M3** DOM-transcribed, **V** verified against our own code or production DB,
**A** asserted or designed, **U** unverified.

---

> **Erratum, 2026-09-27 (same day, verified by compiling with Tailwind 3.4.19).**
> The dead-class figure below is wrong in part. Tailwind **deep-merges**
> `theme.extend.colors.green`, so the numeric `green-*`/`red-*`/`amber-*` ramps
> were never deleted: those 283 uses compile to stock Tailwind colours (off-palette,
> but visible). Consequently the legal-page links (`[&_a]:text-green-700` → `#15803d`)
> and the `/offline` Retry button (`bg-green-600`) were **never** colourless or unfilled.
> The shadcn-bridge half was right: **442 dead uses**, 431 of them in the admin console.
> The accurate total was 21 unresolvable classes / 442 uses, plus 8 more
> (opacity modifiers on `var()` colours, e.g. `bg-[var(--red)]/10`, which Tailwind
> 3.4 never compiles) that static grep could not see. User-facing casualties: the
> mobile trade bar and order-ticket dropdown rendered with **transparent** backgrounds,
> the chart-settings toggle track was invisible, the auth error alert had no tint.
> All fixed; `scripts/check-tailwind-classes.mjs` now fails CI on any recurrence.

---

## 0. Verdict: do we start with the landing page?

**No.** Start with foundation truth, then the money path. Landing is Phase 4.

Three measured reasons, in order of force.

**The spec corpus contradicts itself 23 ways, including four unretracted positions on
the core token palette** [21]. LANDING-PAGE-DOSSIER says `#2B50E4` / YES `#1F9D6B` /
radii 8-12-16. PM-PARITY-SPEC §4 says `#1452F0` / `#30a159` / radii 7.2-9.2-11.2 and
marks the remap done. MARKET-CARD and KALSHI docs refuse that remap on WCAG grounds
(commit `704547f`). The CLOB docs already treat `--yes #30A159` as ours. None is
retracted. A landing page is the single most token-dense surface we own — building it
first means building it against a palette that four documents disagree about, then
rebuilding it. You asked for zero guesswork: this contradiction *is* the guesswork,
and it has to die first.

**The shipped CSS is actively broken in a way that hits legal pages right now** [22].
`tailwind.config.ts` `extend.colors` deletes the numeric `green`/`red`/`amber` ramps
(283 uses across 41 files) and the shadcn HSL bridge in `globals.css` is never mapped
to Tailwind names (442 uses: `text-muted-foreground` 175, `bg-muted` 97,
`bg-background` 63, `text-primary` 49, `bg-primary` 36). Roughly **725 dead classes**.
Visible consequence today: **every link in Terms, Privacy, Responsible-play and Help
renders with no colour** (`legal-page.tsx`), the `/offline` Retry button has no fill,
admin muted labels render at full contrast and `bg-muted` panels are transparent.
Uncoloured links on a responsible-gambling page is a compliance surface, not a polish
item.

**The landing page is the least broken and least leveraged surface.** The audit found
54 page routes, 73 API handlers, **no stubs, zero `TODO`/`FIXME` in non-test UI code,
and every route reading live Supabase data** [22]. This is not a greenfield build. It
is a precision and quality program on a substantially complete product. The landing
page converts strangers; the ticket and the chart decide whether they stay and whether
they understand what they bought. The densest measured corpus we own (**M1**) is on
market detail and the buy sheet. The landing dossier, by contrast, contains **zero
measured values for our own system** [21].

**The one condition that flips this.** If the immediate business need is a specific
acquisition event — a campaign, a press moment, an investor demo on a date — then
landing moves to Phase 1 and we accept rebuilding it once after tokens settle. That is
a real business trade, not a design error. Absent such an event, the order below is
strictly better.

---

## 1. Baseline: what we actually have

Stated plainly, because the plan only makes sense against it.

| Dimension | Finding | Grade |
|---|---|---|
| Route coverage | 54 pages, 73 API handlers, 4 layouts. No stubs, no placeholders | V [22] |
| Unfinished features | Only 4: multi-outcome authoring gated "Coming soon", push notifications disabled, context-news feed unwired, per-candidate books deferred | V [22] |
| Design tokens | A real single-source system ("Pip", `globals.css`, 807 lines) mirrored into Tailwind, with ~12 inline notes carrying measured contrast ratios | V [22] |
| Contrast enforcement | `lib/__tests__/a11y-contrast.test.ts` parses the real CSS and asserts AA in **both** themes | V [22] |
| Mobile-first | Genuine for the trading funnel: `MarketCard` has zero breakpoint classes, desktop ticket is `hidden lg:block`, mobile gets a purpose-built `MobileTradeBar` + `MarketDrawer`, 49/54 pages are server components | V [22] |
| Server/client split | 49 of 54 pages are server components; Recharts correctly split into 4 lazies | V [22] |
| Settlement correctness | Migration **069 applied in production**; no resolver references `total_invested`. The doc's "not yet applied to production" line is **stale** | V (this session) |

So the honest framing: the skeleton is strong and the reasoning in the code is
unusually well documented. What is missing is *finish*, *enforcement*, and *a single
source of truth*.

### The deficits that matter, ranked by user impact

1. ~~**~725 dead Tailwind classes**~~ **442 dead uses (shadcn bridge) + 8 var-opacity classes; fixed 2026-09-27** — see erratum above. Transparent admin panels, trade bar, ticket dropdown. **V** (compiled)
2. **Zero UI tests.** 94 vitest files, **0 `*.test.tsx`**, no RTL/jsdom, `environment: 'node'`. The 1,877-LOC order ticket has no rendering test and e2e never places an order. **V** [22]
3. **No `error.tsx` / `loading.tsx` / `not-found.tsx` / `global-error.tsx` anywhere** across 54 pages. 8 `notFound()` calls fall to Next's default; admin pages `throw` with no boundary. **V** [22]
4. **No focus trap in 8 `role="dialog"` surfaces** — Tab escapes the trade sheet and the deposit/withdraw sheets. **V** [22]
5. **i18n plumbed but dead** — 51 keys × 3 locales, `useTranslations` imported by **2 of 174 files**. Switching to Kiswahili changes `<html lang>`, dates and timezone, and nothing else. For a five-country product this is a strategic gap, not a chore. **V** [22]
6. **`next/image` used in zero files** — 10 `remotePatterns` + `sharp` are dead config; no resizing, no AVIF/WebP, on a product whose users are on mid-range Android over metered data. **V** [22]
7. **Tablet band 768–1023px unaddressed** — `lg:` 152 uses vs `md:` 23 (6.6×). **V** [22]
8. **`viewport-fit=cover` missing**, so all 7 `env(safe-area-inset-bottom)` usages no-op on notched iOS standalone. **V** [22]
9. **`pm-ticket.tsx` (1,877 LOC) not code-split** and imported twice on the detail page; `market-comments` (617), `candidate-list` (400), `top-holders` (337) likewise. **V** [22]
10. **Lighthouse is `preset: "desktop"` with every assertion at `warn`** — nothing fails the build, and `/markets/[slug]` is not even in the URL list. **V** [22]
11. **`holdings-table.tsx` is `min-w-[600px]` inside `overflow-x-auto`** — a desktop table on the money screen. **V** [22]
12. **15 `@radix-ui/*` packages imported by zero files**, so tabs/selects/tooltips are hand-rolled — hence 14 `role="tab"` but only 2 `role="tabpanel"`. **V** [22]

---

## 2. The edge: what the measurement actually found

You asked for an edge over the giants, argued outside the box. Here it is, and it is
not speed and not novelty. **It is that Polymarket's most-rendered semantic treatment
fails WCAG AA, and we already pass it with a test that enforces it.**

### Measured Polymarket weaknesses we can beat

Captured live this session at 390×844 dpr3 and 1440×900, colours resolved to sRGB by
Chromium itself [23]:

| Treatment | Text | Surface | Ratio | AA |
|---|---|---|---|---|
| **YES tint (resting)** | `#007e26` | `#d9f0e2` | **4.36:1** | **FAIL** |
| **NO tint (resting)** | `#df0c10` | `#fce9e9` | **4.28:1** | **FAIL** |
| Accent green (price delta, 12px/600) | `#04af52` | `#ffffff` | **2.89:1** | **FAIL** |
| YES solid (selected) | `#ffffff` | `#007e26` | 5.23:1 | pass |
| Trade CTA | `#ffffff` | `#2e5cff` | 5.13:1 | pass |

The failing tint pair is **the most-rendered semantic treatment on the site** — every
YES/NO chip on both home viewports and the resting Buy Yes/No buttons on the event
page. At 14px/600 and 13px/490 the large-text 3:1 allowance does not apply. The tint
surfaces are also near-invisible against the page (**1.20:1** YES, **1.17:1** NO),
far below WCAG 1.4.11's 3:1 for non-text contrast.

And touch targets, measured heights [23]:

| Capture | ≥44px | <44px | Most common |
|---|---|---|---|
| home / mobile | 38 | **333 (89.8%)** | 27px ×84, 20px ×70, 28px ×62 |
| home / desktop | 71 | 513 | 27.5 ×116, 27 ×86 |
| event / mobile | 50 | 178 | 20 ×57, 24 ×32, 36 ×26 |

**The primary trading affordance in Polymarket's feed is a 27px-tall chip.** Their
event page does size correctly (Buy 44px mobile / 48px desktop, outcome selector
48px) — so the fix is known to them and simply not applied to the feed.

Why this is a real edge and not a checkbox: our users are on **mid-range Android, in
outdoor daylight, one-handed, on metered data**. Contrast and target size are not
accessibility theatre for that population — they are the difference between placing
the trade and mis-tapping it. We already have the token system and the enforcing test
[22]. We win here by *finishing what we have*, not by inventing anything.

Additionally: **Polymarket served no dark mode** in our capture (`data-theme="light"`),
and our system has a measured, tested dark theme [22][23]. And their US geo-block
means their logged-out auth CTA does not even render in our region — **NOT MEASURED**,
and a surface where we are unconstrained by parity.

### Measured Polymarket strengths we should adopt

These are earned, and copying them is correct [23]:

- **A 2px spacing grid, not 4 or 8.** Over 6,598 padding/gap declarations: 8px 31.6%, 4px 17.3%, 12px 15.1%, **6px 14.5%**, 16px 7.1%, **14px 5.4%**, **10px 3.7%**. Values used ≥20× are 100% covered by a 2px grid but only 74.6% by 4px. 6/10/14px are load-bearing (23.6% combined). Calling it a "4px grid" would be wrong. We currently have **no spacing scale at all** (Tailwind default) [22].
- **Borderless, shadow-as-border.** Market card `border: 0`, `box-shadow: 0 0 0 1px rgba(0,0,0,.06)` plus two soft layers. Our prior measured audit independently found "0 framed, PM is borderless" [21].
- **Hierarchy by magnitude, not weight.** The price is 15px/600 in the feed and jumps to **28px/600, line-height 28px (1.0), tracking −0.42px** on the event page. Same weight, radically different size. That is how they make the number the hero without bolding everything.
- **Fixed card height, flexing width.** 358×180 mobile, 316.5×180 desktop — height pinned at 180px. This is what makes their feed scan cleanly; ragged card heights are the most common prediction-market feed failure.
- **A radii family on the shadcn ±integer formula:** 5.2 (chips), 7.2 (buy buttons), 9.2 (search, Trade CTA), 11.2 (`--radius: .7rem`), 15.2 (market card, ticket, comment box). Our Pip radii (7.2/9.2/11.2/16/999) already align on three of five — convergent, which is reassuring.
- **Type is a hand-picked ramp, not a modular scale.** 11–28px, step ratios spanning 1.067–1.200; +1px through the body band (11→16), +2px above. Anyone imposing a clean 1.25 modular scale here is fighting the medium. Our 22-step measured `.pm-*` scale (12→28px) already reflects this [22].
- **Event page uses full-bleed rows split by 1px rules, no cards.** 358×140 mobile, 922×72 desktop. Cards for browsing, rows for deciding.

### The hybrid thesis, stated once

**Take Polymarket's information architecture, density system and typographic
hierarchy. Reject its accessibility and its touch ergonomics. Keep our token system,
our dark mode and our enforcing tests. Take Kalshi's order-ticket clarity** (we have
`KALSHI-ORDER-TICKET.md`, **M1** from July) **— but Kalshi could not be re-measured
this session** (three attempts, all HTTP 429 Vercel bot challenge; **all Kalshi tokens
NOT MEASURED** [23]), so any Kalshi-derived decision stays flagged as July-dated
until re-capture succeeds.

---

## 3. Binding design law

These are not preferences. They are the psychology findings with strong evidence,
restated as rules a reviewer can fail a PR against [24]. Where evidence is thin, it
says so — and thin evidence means we test rather than assert.

### Money comprehension

1. **Never express economics as a payout percentage.** State money lost per KSh 100. BIT 2022 (n=5,311): loss-in-money framing raised correct comprehension **27%→52%** and cut willingness to play ~9pp. Weiss-Cohen & Newall 2025 (n=2,019 + 4,043): RTP-style "90% payout" framing **increased** perceived chance of winning versus *no information at all*. **STRONG.** This directly forbids a pattern many trading UIs ship.
2. **Show `You pay` / `Most you can lose` / `If right you get`, in KSh, before confirm.** Newall et al. 2022; Kenya GRA Regs 2026 Reg. 45 requires rules before any wager; WCAG 2.2 SC 3.3.4. **STRONG + normative.**
3. **All-in fees up front, never dripped.** OFT 2010; Rasch et al. 2020 JEBO; Santana et al. 2020 Marketing Science. **STRONG.**
4. **Probability as percentage with a co-located frequency gloss** — `57% · about 57 in 100`. Gigerenzer et al. 2007; Galesic et al. 2009; Garcia-Retamero & Cokely 2017. **STRONG** (transfer to single-event probability is an inference).
5. **Never a count without its denominator** (denominator neglect). Garcia-Retamero et al. 2010. **STRONG.**
6. **Numbers lead; verbal probability words only ever bound to a number.** Budescu et al. 2009/2014; Wintle et al. 2019. **STRONG** — and it matters triply across five countries and three languages.

### Symmetry and defaults

7. **YES/NO perfectly symmetric. No favoured side, no pre-selected stake.** Tversky & Kahneman 1981. **STRONG.** This resolves a live contradiction: `BETTING-PANEL-CONVERSION` ships a pre-armed sheet with a seeded default stake, while the measured PM parity doc says "PM has NO pre-armed ticket" [21]. Psychology and parity agree — kill the pre-arm.
8. **Ship a pre-set default limit, not a limit-setting prompt.** Auer, Hopfgartner & Griffiths 2019 RCT (n=4,328): prompts raised limit-setting **11-fold** with **zero** effect on losses (OR=1.0, p=.921). **STRONG null.** Increases delayed, decreases immediate.

### Charts

9. **Y-axis always 0–100%. Never auto-scale.** Correll, Bertini & Franconeri CHI 2020: truncation strongly distorts perceived effect size and **axis-break markers do not fix it**; Yang et al. 2021. **STRONG.** This resolves corpus contradiction #8 (fixed 0/25/50/75/100 vs "dynamically scaled, NOT fixed") on evidence rather than taste.
10. **Default chart range = full market life. No intraday view.** Borsboom et al. 2022 (n=1,041): short-horizon charts → **+38pp** propensity to trade, ~50% higher fees, ~18% lower profits. **MODERATE-STRONG** (equities, lab). We adopt it and measure our own.
11. **A 100-mark dot array as the primary probability graphic; no hard-edged bands.** Padilla, Kay & Hullman 2022; Kay et al. CHI 2016; Fernandes et al. CHI 2018. **STRONG/MODERATE.**

### Integrity

12. **No on-screen number without a traceable DB source.** Mathur et al. 2019 (11K sites): 157 fake countdowns, 29 fabricated activity feeds, 17 deceptive stock counters. **STRONG.** Enforced as a code-review gate.
13. **Flow symmetry as a merge gate.** Withdrawal and self-exclusion must take no more taps, time or fields than deposit and purchase. GRA Reg. 87 requires tools "accessible and real-time". **STRONG.** This is measurable and belongs in CI as a tap-count assertion.

### Ergonomics

14. **44×44 minimum targets and ≥4.5:1 contrast, verified in outdoor conditions.** Money actions in the bottom half, confirm and cancel equally reachable. WCAG 2.2 SC 2.5.5 / 1.4.3; Bergstrom-Lehtovirta & Oulasvirta CHI 2014. **STRONG/MODERATE.** Note the audit found **45 controls at ≤36px** today [22].
15. **One decision = one visual block, with no scroll boundary inside it.** Sweller et al. 1998 split-attention. **STRONG.**

### Forbidden, explicitly

Variable or intermittent reward; surprise bonuses; near-miss framing ("it was at 48%
an hour ago"); any celebration where net proceeds ≤ stake (UKGC banned this in 2021);
countdown timers not tied to a real market close; manufactured social proof or winner
feeds; **any notification or banner triggered by a loss event** (loss-chasing,
*Scientific Reports* 2024); streaks, badges or confetti on money surfaces (Barber &
Odean 2022); deposit bonuses, free stakes or credit (**prohibited outright by the
Gambling Control Act 2025**); confirmshaming; drip-priced fees; asymmetric YES/NO
defaults; push-notifying sell-back.

---

## 4. Phases

Each phase has an entry condition, scope, and an **exit gate that is a test, not an
opinion**. No phase starts before its entry condition holds.

### Phase 0 — Make the ground true *(blocking everything)*

Entry: none. This is first.

- **0.1 Kill the dead classes.** ✅ **Done 2026-09-27** — bridge mapped, dark `--primary` fixed for AA, CI check + contrast tests added. Map the shadcn HSL bridge into Tailwind names (smaller, reversible diff) and restore or migrate the 283 numeric-ramp uses. Then add a CI check that fails on any Tailwind class not resolvable to a token. Fixes colourless legal links and the `/offline` button as a side effect.
- **0.2 Collapse 23 contradictions into one spec of record.** Produce `docs/design/SPEC-OF-RECORD.md`; add a supersession header to every doc it replaces. The four token positions, the KES-vs-¢ notation conflict, `--navbar-height` 116 vs 104, detail H1 24 vs 28–32, ticket 372 vs 340, and the Σ price = 1 conflict (a coherence guard would reject the 22 live independent markets converted 2026-07-11) all get a single ruling with a reason.
- **0.3 Re-capture the stale July numbers.** Hero, detail header / navbar height, timeframe set, buy sheet, related rows. The harness from [23] is committed under `experiments/competitor-capture/` and extends directly. Retry Kalshi on a different approach.
- **0.4 Add the missing shell.** `error.tsx`, `loading.tsx`, `not-found.tsx`, `global-error.tsx`, plus `sitemap.ts` / `robots.ts`.
  ✅ **Done 2026-09-27**, verified on a production build (standalone server + Chromium, both themes): unknown URL, missing market and missing trader return **404**; a throwing route returns **500** with the navbar still mounted; all shell buttons measure 44px. **Finding that changes the gate:** a root `app/loading.tsx` turned every `notFound()` on a dynamic page into a **200 soft-404** (status is committed once a Suspense boundary streams; measured on `/markets/[slug]` and `/traders/[id]`). So loading boundaries are **per segment**, only where the subtree never calls `notFound()`: portfolio, notifications, settings, profile, search, leaderboard, kyc, creator, marketer, and the `/markets` list (moved into a `(list)` route group; URL unchanged). `/markets/[slug]`, `/traders/[id]` and the admin `[id]` pages deliberately have none.
- **0.5 Fix `viewport-fit=cover`** so the 7 existing safe-area usages start working. ✅ **Done 2026-09-27** (meta verified in served HTML); `<body>` also pads `safe-area-inset-left/right` so landscape notches don't clip content.

**Exit gate:** CI fails on unresolvable classes ✅ · one spec of record exists and every superseded doc says so · re-measured numbers committed as JSON, not prose · every route has an error boundary ✅ and a loading boundary **except where one would break 404 status** ✅.

### Phase 1 — Foundation: tokens, spacing, dark mode, targets

Entry: 0.1 and 0.2 complete.

- **1.1 Canonical token set.** Keep Pip; it is measured, tested, and passes AA in both themes. Adopt PM's structural learnings: the **2px spacing grid** (we have none), the radii family, borderless + shadow-as-border.
- **1.2 Define the spacing scale explicitly** in Tailwind, on 2px, with 6/10/14 as first-class.
- **1.3 Measure our dark mode.** Nobody has, on either side [21][23]. Extend the contrast test to every token *pair* in both themes, not just the ~30 currently annotated.
- **1.4 Touch-target law.** 44px minimum on every interactive element on a money surface; fix the 45 controls at ≤36px. Add a lint or test that fails on a smaller target inside a money route.
- **1.5 Address the tablet band** 768–1023px (`md:` is used 23× against `lg:` 152×).
- **1.6 Turn Lighthouse into a gate:** `preset: "mobile"`, assertions `error` not `warn`, and add `/markets/[slug]`.

**Exit gate:** contrast test covers all token pairs in both themes · target-size test green on all money routes · Lighthouse mobile budgets failing the build on regression · no `min-w-[600px]` table on a money screen.

### Phase 2 — The money path *(highest leverage)*

Entry: Phase 1 exit. Scope: market detail → ticket → confirm → receipt.

This is where the densest **M1** corpus lives, where the psychology rules bite, and
where the accessibility edge over Polymarket is actually won.

- **2.1 Split `pm-ticket.tsx` (1,877 LOC)** and stop importing it twice.
- **2.2 Apply rules 1–3, 7:** `You pay` / `Most you can lose` / `If right you get` in KSh; remove any payout-% framing; all-in fees up front; symmetric YES/NO; **delete the pre-armed sheet and seeded default stake**.
- **2.3 Apply rules 4, 5, 11:** percentage + frequency gloss; 100-mark dot array; never a bare count.
- **2.4 Apply rules 9, 10:** fixed 0–100% y-axis; default range = full market life; drop intraday.
- **2.5 Focus traps** on all 8 dialogs (currently zero).
- **2.6 First UI tests:** add RTL + jsdom, and cover the ticket's render and arithmetic.
- **2.7 Adopt the event-page row treatment** (full-bleed rows, 1px rules, price 28px/600 lh 1.0 ls −0.42) and PM's 44/48px buy-button sizing.

**Exit gate:** an e2e that **actually places an order** (none exists today) · ticket render + arithmetic tests · axe clean at *moderate* and above, not just critical/serious · a tap-count test proving withdrawal ≤ deposit (rule 13) · no number on screen without a DB source (review gate, rule 12).

### Phase 3 — Discovery and cards

Entry: Phase 2 exit.

Market card, feed, search, category rails. Adopt fixed-height cards (180px), borderless
+ shadow-as-border, price 15px/600 in feed. **Reject the 27px chip — use 44px.**
Resolve the two incompatible measured card specs in the corpus (radius 12 vs 14, icon
40 `rounded-lg` vs 38 `rounded-sm`, 44px donut vs 58px semicircle) [21].
Introduce `next/image` here first, where the image density is highest.

**Exit gate:** no ragged card heights · every feed affordance ≥44px · `next/image` on all remote images with intrinsic dimensions · LCP budget green on mobile.

### Phase 4 — Landing and acquisition

Entry: Phase 1 exit (tokens frozen). Can run parallel to Phase 3.

Now the visual language is settled, so it is built once. Uses the **M1** PM hero
measurements already in the corpus (card 907×480, radius 18px, gridlines `1,3` at
y 0/59/118/177/236, endpoint pulse scale 1→3.95 opacity .34→0) [21], re-verified in
0.3. Resolve the hero-chart contradiction (smooth bézier + pulsing halo vs step render
+ static glow — both currently live in the same file).

**Exit gate:** measured values for *our* landing exist (today: zero) · JSON-LD present on the shipped page (today: absent) · every review gate in LANDING-REVIEW ticked · Lighthouse mobile green.

### Phase 5 — Compliance, i18n, long tail

Entry: Phase 2 exit.

- **5.1 Regulatory surfaces:** Reg. 45 rules-before-wager, Reg. 85 age/ID/location assurance, Reg. 87 limits + reality checks + ≥24h self-exclusion + registry, Reg. 96 consent. Rule 8 says ship **default** limits, not prompts.
- **5.2 Make i18n real.** 2 of 174 files use it today. Kiswahili first. Note rule 6: number-bound probability language survives translation; verbal-only language does not.
- **5.3 Design record for admin** (27 routes, currently undocumented) and for deposit/withdraw, settings, and the empty-state library.
- **5.4 Code-split** `market-comments`, `candidate-list`, `top-holders`; trim the always-on client bundle (`Navbar` 724 + `AuthDialog` 758 + `BottomNav` 241 mount on every route).
- **5.5 Adopt the 15 unused Radix packages** or remove them; fix the 14 `role="tab"` / 2 `role="tabpanel"` mismatch and the nested `<main>` in 5 files.

---

## 5. Verification regime

You asked to test, retest, confirm. The mechanism, not the intention:

1. **Every measured number lives as JSON, not prose.** The capture harness is committed; re-running it produces a diff. Prose specs rot — `MARKET-CREATE-DOSSIER` is factually wrong today [21], and two status lines we checked this session (`public.schema_migrations`, CLOB-SETTLEMENT) were stale.
2. **Contrast is a unit test over the real CSS**, in both themes, over all token pairs. This already exists in embryo and is our single best asset — Polymarket demonstrably has no equivalent.
3. **Target size is a test**, not a review note.
4. **Accessibility gate at `moderate` and above**, and the suite must **fail rather than skip**. Today `test.skip(true, …)` appears in 6 of 7 e2e specs; on an empty or slow DB the suite can go green having tested almost nothing [22]. That is worse than no gate, because it produces false confidence.
5. **Auth-gated surfaces get a storage-state fixture.** Admin, portfolio, KYC, settings and notifications are currently unmeasured for accessibility because no fixture exists (its own header comment admits this) [22].
6. **Visual regression on the money path** — none exists today.
7. **Flow symmetry assertion** (rule 13) as a merge gate.
8. **Every psychology rule maps to a named test or an explicit review checklist item.** A rule with no gate is a preference.

---

## 6. Decisions I need from you

These are genuinely yours; I will not guess them.

1. ✅ **DECIDED 2026-09-27 by the product owner: KES and %.** Money in `KSh` (e.g. `KSh 1,250`), probability as `%`; no ¢ and no $ anywhere in the UI. Every PM-parity doc mandating ¢/$ is superseded on this point. *(Original question follows.)* **Notation: KES-only or cents/¢?** Every PM parity doc mandates ¢ and $ volumes; `COPY-REWRITE-SPEC` mandates `KSh 1,250`, probability as %, and "remove any cents/¢" [21]. The East Africa research supports KES-not-USD. This decision propagates into every surface, so it is Phase 0. My recommendation: **KES and %**, because rule 1 requires money framing in the user's own currency and rule 4 prefers percentage.
2. **Fee model.** Three live positions: PM's `C·rate·p·(1−p)` per-category, our flat `platform_fee_rate`, and BRAIN-2026-09's "none charged on trades" [21]. Rule 3 forbids dripping whichever you choose, so this must be settled before the ticket is built.
3. **Is there an acquisition event that forces landing earlier?** (§0)
4. **Uganda's minimum gambling age may be 25, not 18** — Lotteries and Gaming Act 2016, per a secondary review [24]. **U, and it must be verified against primary legislation before any Ugandan launch**, because it changes age-gating logic. Flagging rather than assuming.
5. **Rewards surface:** four unretracted positions (omitted / parity target / recommended / already a live string) [21].
6. ~~**Push access for the repo** is currently blocked at the sandbox proxy.~~ **Resolved 2026-09-27** — pushed from a session with the repo attached. Whether the repo should stay *public* remains open (handoff §2).

---

## 7. What I did not verify

Stated so nothing here is mistaken for measurement.

- **All Kalshi tokens: NOT MEASURED.** Three attempts, HTTP 429 Vercel bot challenge [23]. Every Kalshi-derived decision remains July-dated.
- **Polymarket dark mode: NOT MEASURED** (served `data-theme="light"`).
- **Polymarket logged-out auth CTA: NOT MEASURED** — a US geo-block interstitial is served to this region, so Log in / Sign up do not render.
- **Nothing was built or run in the audit** — `node_modules` is not installed, so [22] is static source reading. Counts are reliable; runtime behaviour is inferred and should be confirmed once installed.
- **`networkidle` never fires on polymarket.com** (continuous polling); capture used a scripted scroll-and-settle plus a rendered-text gate, noted per record.
- The solvency-guard check on our resolvers errored on a SQL detail and was not retried; only settlement **defect 1** was positively verified fixed in production.
