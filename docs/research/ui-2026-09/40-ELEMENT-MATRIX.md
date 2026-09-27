# 40 — Element-by-element matrix: Polymarket × Kalshi × Kichiko → ruling

Written 2026-09-27. Supersedes the comparative sections of [20-WORK-PLAN](20-WORK-PLAN.md) §1–§3.
Every cell cites where its number came from. Nothing is recalled.

**Sources.**
[PM] `captures-v2/polymarket/REPORT.md` (live polymarket.com, 2026-09-27, M1/M3) ·
[KA] `captures-v2/kalshi/REPORT.md` (demo.kalshi.co = **D**, help centre M3, API M2, store S) ·
[KI] `captures-v2/kichiko/` (live production data via a local production build, 2026-09-27, M1;
`NOTATION-AUDIT.md` = code, V) ·
[31] `research-v2/31-PSYCH-MONEY-RISK.md` · [32] `research-v2/32-PSYCH-MOBILE-TRUST.md` ·
[LN112] `research-v2/33-KENYA-LN112-EXCERPT.md` (gazetted text, verified first-hand) ·
[GCA] Gambling Control Act 2025, s.71(1) "shall not bet an amount of less than twenty shillings"
(verified first-hand from gra.go.ke, 2026-09-27).

**Grades.** M1 measured · M2 API · M3 transcribed · D Kalshi demo (design system only; production
equivalence unverified; mock prices) · S store listing · V verified in our code · BINDING law.

**Ruling vocabulary.** **ADOPT** (take their pattern) · **REJECT** (do the opposite, with the
evidence) · **INVENT** (neither does it; evidence says we should) · **KEEP** (ours already wins,
measured) · **FIX** (ours is wrong, measured).

Headline contrast figures in this document were recomputed independently by the lead from the hex
values: PM `#8b929b`/white 3.14, `#04af52` 2.89, `#f6c030` 1.68, `#bfc3ca` 1.77, white/`#2e5cff`
5.13; KA white/`#0AC285` 2.32, white/`#28CC95` 2.07, white/`#D91616` 5.15, `#0A0C0F`/`#28CC95` 9.48.

---

## A. System-wide

| # | Element | Polymarket | Kalshi | Kichiko today | Evidence | Ruling |
|---|---|---|---|---|---|---|
| A1 | Money notation | `$`, `¢` with one decimal (`58.6¢`), four volume formats (`$14M`, `$69,753,899`, `$187.04K`, `$4.5K Liq.`) [PM #19] | % + multiplier on cards (`85%`, `1.15x`), ¢ in ticket (`YES 86¢`, `97.4¢`) [KA #1] | KSh + %, but `¢` still rendered by `formatCents` in the ticket limit row and order book; error text "0.1¢ and 99.9¢"; a11y name "Limit price in cents"; `KSh` vs `Ksh` in one sheet; three `formatPercent` implementations [KI N1–N5] | Owner ruling 2026-09-27: KES + %. Multiplier/return headlines mislead (Weiss-Cohen 2025, STRONG) [31 FR-2] | **FIX**: one formatter module (`formatKsh`, `formatPct`), `KSh` everywhere, integer % [31 PR-1], no ¢/multiplier anywhere. Gate: a unit test that greps rendered output of every route for `¢`, `$`, `\d+x\b`, `Ksh\b` |
| A2 | Yes + No display | Asks shown separately: 16¢ + 85¢ = 101¢ [PM #8] | 86 + 15 = 101 (demo); API asks 0.20 + 0.85 = 1.05 [KA #2] | % on buttons (not yet summed in capture) | A reader who adds the two sides gets >100%: a comprehension trap. No study tests it (INFERENCE) | **INVENT**: show one probability per market (mid or last), and each side's **KSh price to buy** only inside the ticket. Never two % that sum ≠ 100 on one surface |
| A3 | Text contrast (share of text nodes failing AA) | Light **20.1–22.0%**, dark 4.0–4.1% [PM #1] | Every product page has critical/serious axe issues; primary green CTA **2.32:1**, header Sign up **2.07:1** [KA #4, #16] | Light **0.4%**, dark **0.1%** — but the failures sit in the ticket: "To win" green `#42c772` on white **2.18:1**, "To win" label dark **2.03:1**, inactive "No" **1.91:1**; volume `#aeb4bc` on white 2.09 [KI] | WCAG 1.4.3; sunlight collapses ratios (≈4.5→2.7 at 10k lux) [32 §0.5] | **KEEP** the system, **FIX** the ticket. New floor [32 rule 6]: money figures ≥7:1 **and** ΔY ≥0.80 in both themes; other text ≥4.5:1 and ΔY ≥0.50. Extend `a11y-contrast.test.ts` to every token pair used in the ticket |
| A4 | Touch targets (mobile, share ≥44 px) | 13.0% (41.5% <24) [PM #17] | 7–10%; row Yes/No 167×32; ticket pills 96×28 [KA #15] | **31.5%** (23.7% <24, mostly chrome); multi-outcome page **158 targets <24** [KI] | WCAG 2.5.8 floor 24; Apple 44 pt; Material 48 dp; error rises at edges [32 rule 1, MODERATE] | **KEEP** lead, **FIX**: every control ≥44×44; Yes/No/Buy/Confirm/Cancel ≥48 tall; ≥8 px apart. Gate: Playwright assertion on every money route at 360×800 |
| A5 | Pinch-zoom | Disabled (`maximum-scale=1`), axe on 52/56 [PM #3] | not measured | Allowed (our viewport has no max-scale) | WCAG 1.4.4; 6.3% presbyopia correction among Kenyan over-50s [32] | **KEEP**. Gate: test that the viewport meta never contains `maximum-scale` or `user-scalable=no` |
| A6 | Keyboard focus | None on ticket Trade/Yes/No (0 px changed) [PM #4] | not measured | Not yet measured by pixel-diff | WCAG 2.4.7 / 2.4.11 | **INVENT**: visible 2 px focus ring on every control; pixel-diff test on the ticket |
| A7 | Theme default | Light default; dark via switch **and** OS [PM] | Dark follows OS [KA #14] | **Forced dark** (`defaultTheme="dark"`), ignoring OS | Dark-mode greys collapse worse than light in sunlight [32 §0.5]; follow-system [32 rule 9, MODERATE/CONTESTED] | **FIX**: follow the OS setting; both themes pass A3 |
| A8 | Spacing grid | 2 px grid fits ≥97% of values [PM #20] | 2/4/6/8/16 radii, 1320 content [KA #13] | No explicit scale (Tailwind default) | Convention | **ADOPT** a 2 px-based scale with 6/10/14 first-class (as 20 §2) |
| A9 | Radii | 5.2 / 7.2 / 9.2 / 15.2 + pill [PM #20] | 2/4/6/8/16/100 | 7.2 / 9.2 / 11.2 / 16 / 999 (Pip) | Convention | **KEEP** Pip (3 of 5 already converge with PM) |
| A10 | Type | Inter, variable weights 400–700 in odd steps, 9–56 px [PM] | Regular + condensed face for big numbers; body 12/13/15/18 [KA #12] | Inter + Geist Mono | Floor: body ≥16, money ≥20, nothing <12, tabular numerals [32 rule 8] | **ADOPT** Kalshi's idea of a *distinct numeric face for money* (we have Geist Mono, tabular); **REJECT** PM's 9 px and 11 px text |
| A11 | Page weight (mobile, throttled) | 4.7–5.1 MB, JS 3.2–3.5 MB, long tasks 10–12 s, **LCP 7.5–7.8 s** [PM #9–10]; 12.55 MB unthrottled home [32] | not measurable (bot challenge) | **515–550 KB total, JS 250–400 KB**, long tasks 1.3–2.1 s; LCP 2.1–3.6 s (inflated by a US→Dublin hop in this sandbox) [KI perf] | Budget: JS ≤150 KB, total ≤400 KB, render-critical ≤60 KB, LCP ≤2.5 s Slow 4G, ≤4.0 s 3G [32 §3.3] | **KEEP** the 9–10× lead; **FIX** to budget (JS −40 to −62%). Gate: Lighthouse CI mobile, 360×800, Slow 4G + 3G, `error` not `warn` |
| A12 | Bottom tab bar (mobile) | 4 tabs 97.5×59: Home, Search, Breaking, More [PM] | none logged-out (app has 5) [KA P16] | 4 tabs: Home, Search, **Breaking**, More (copied) | Attention lists precede negative returns (Barber); gamification selects low-literacy users (Chapkovski) [31 edge 4] | **KEEP** the bar, **REJECT** "Breaking": rename to "New" (it already routes to `?sort=newest`) |
| A13 | Data integrity of charts | — | — | **Hero/feed series truncated**: `.in(market_id).order(asc)` with no range hits PostgREST's 1,000-row cap (market `ke-2027-president` has 1,908 rows, 24 Apr–13 Aug; chart shows 24–30 Apr). Movers `changePct` computed from the same truncated data (`app/page.tsx:139`). **Market pages too:** `app/markets/[slug]/page.tsx` orders oldest-first with `.limit(1000)` (multi-outcome, l.97–103) and `.limit(200)` (binary, l.127–133), so detail charts show the *oldest* window (screens end in Jun/Jul on 27 Sep). The API route `/api/markets/[id]/price-history` already orders newest-first — the correct pattern exists [KI, V] | Every number traceable (Mathur 2019) [31 DP-1] | **FIX** (P0 bug): per-market latest-N query (or an RPC); gate: test that each series' last point is within 24 h of `markets.last_trade_at` or the latest price row |

## B. Home / feed (P01, P02, P17)

| # | Element | Polymarket | Kalshi | Kichiko today | Evidence | Ruling |
|---|---|---|---|---|---|---|
| B0 | Volume notation | `$14M Vol.` | `$4,095,797 vol` | Three spellings rendered: `KSh 17.5M Vol` (home), `KSH 22M Vol.` (search, CSS uppercase), `Ksh 636.56` (ticket) [KI screenshots] | Owner ruling (KES); consistency (A1) | **FIX** via the A1 formatter; no `text-transform` on currency |
| B1 | Above-the-fold density (mobile) | ≈2.5 markets; card 358×180 fixed, 12 px gap [PM #13] | outcome rows + 80×38 % pill | **One** hero market fills the fold (auto-rotating carousel) [KI screenshot] | Scanning; cards for browsing, rows for deciding (20 §2) | **ADOPT** PM density: fixed-height 180 px cards on mobile; hero only on desktop, not auto-rotating (WCAG 2.2.2) |
| B2 | Primary CTA copy on cards/hero | "Trade" | "Sign up to trade" | **"Predict & Earn →"** (`hero-section.tsx:421`) | "Earn"/income/investment framing prohibited in Kenyan gambling advertising (L.N. 114 per [31]; BINDING) | **FIX** now: neutral verb ("View market"). Gate: copy-lint test bans `earn`, `income`, `invest`, `profit` in UI strings |
| B3 | Feed Yes/No chips | 40×27, tints fail AA in light (4.36 / 4.28) [PM #2] | 167×32 row buttons | cards link to market | Targets + contrast (A3, A4) | **REJECT** chips <44 px. If quick-buy exists, 44×48 and word-first |
| B4 | Chart axis | Detail chart **auto-scaled** (gridlines 15/30/45/60%) with a `▲2%` delta [PM P03 screenshot] | step chart, 1D/1W/1M/ALL, `ALL` active by default [KA P03 screenshot] | Detail charts **fixed 0–100%** (correct); home hero auto 0–60%; ranges include 1H/6H; repeated month labels ("May May May") [KI screenshots] | Truncation exaggerates; full range under-states — a deliberate choice [31 CH-1, OVERSTATED→decision] | **FIX**: fixed 0–100% axis, default `All`, no 1H/candles |
| B5 | Attention machinery | "Breaking", "Hot topics 🔥", promo codes (July), leaderboard `+$5,086,914` | promo codes in stores; "Unlock the leaderboard" | "Breaking" tab, `/leaderboard`, profile "Biggest win" | Winners' identities confidential without written consent (L.N. 112 Reg. 87, per [31]); ads: no testimonials/former winners (L.N. 114) | **REJECT** (see H1) |
| B6 | Sign-up pressure | Geo gate on every load | **Auto-opening sign-up modal 7.5–10.6 s after load** on 44/60 captures [KA #10] | None; sign-in only when needed | Browse and preview without an account; KYC before first deposit [32 rule 13] | **KEEP**: never auto-open auth |

## C. Market page (P03, P04, P05, P18)

| # | Element | Polymarket | Kalshi | Kichiko today | Evidence | Ruling |
|---|---|---|---|---|---|---|
| C1 | Price hierarchy | "16% chance" 20/600 mobile; 28/600 desktop (July) | "87% chance"; condensed 24 px names | 46% style legend + chart | Magnitude, not weight (20 §2) | **ADOPT** one hero probability per market, integer %, ≥28 px |
| C2 | Rounding consistency | Row "59%" vs button "58.6¢" on the same row [PM P04] | 87% vs 86¢ | Row "46%" vs button "Buy Yes 46.4%"; ticket `78.6%`; "1 options" [KI screenshots, N8] | Integer % [31 PR-1] | **FIX**: integer % everywhere; one formatter (A1) |
| C3 | Resolution source + close time | Rules below the fold | "Don't be lazy - read the rules!" (2025) | description + criteria present | Rules before wager (L.N. 112 Reg. 45(1), 23(1)); independent approved mechanism (Reg. 45(6)) [LN112] | **INVENT**: question, close time and resolution source *inside* the price block and inside the ticket (PR-2) — BINDING |
| C4 | Multi-outcome rows | Buy 173×44 mobile / 136×48 desktop, radius 7.2 [PM P04] | 167×32 | 158 targets <24 px on mobile [KI] | A4 | **ADOPT** PM row geometry at ≥48 px; **FIX** our <24 targets |
| C5 | Chart legend contrast | `#f6c030` 1.68:1 [PM #15] | range tabs 1.99:1 [KA P03] | series colours NOT MEASURED for 3:1 | Non-text contrast 3:1 (1.4.11) | **INVENT**: series colours pass 3:1 on both surfaces; labels carry the number, not the colour |
| C6 | Resolved state | Sticky "✓ Outcome: Up" 5.13:1 replaces the bar; "Go to live market" [PM P18] | "FULL-TIME 35–14", ✓/✗ rows; side panel still "To be determined" (inconsistent) [KA P18] | **No resolved market exists in production yet** — NOT MEASURABLE | Reg. 45(6)/(8): evidence and records [LN112] | **ADOPT** PM's sticky outcome; **INVENT** resolution evidence link + resolved time (LW-4) |
| C7 | Banned subjects | — | — | Live: `ke-gachagua-appeal-upheld` (resolves on a pending appeal); `ke-gachagua-on-ballot-2027` ("hinges on the courts") [KI DB] | L.N. 112 Reg. 45(7)(a): no market concerning "proceedings pending before a court in Kenya" [LN112, verified] | **FIX — owner + legal decision**; plus a creation-time validator and a `gra_approval_ref` required to publish (Reg. 45(5)) |

## D. Order ticket (P06) — the money path

| # | Element | Polymarket | Kalshi | Kichiko today | Evidence | Ruling |
|---|---|---|---|---|---|---|
| D1 | Container | Mobile bottom sheet 390×486; desktop rail 308×357 [PM P06] | Mobile bottom sheet "Order panel"; desktop card 352×400, radius 16, no shadow [KA #5, #11] | Mobile bottom sheet; desktop rail | Split-attention (MODERATE for tickets) [32] | **KEEP** sheet/rail; **ADOPT** Kalshi's URL-encoded ticket state (linkable, restorable after auth) |
| D2 | Side pre-selection | Yes pre-selected (solid `#007e26`) [PM P06] | Not established: the page shows both sides outlined (`Yes 86¢` / `No 15¢`); the sheet opens on the tapped side [KA P06 default screenshot] | Side comes from the tapped button (tested path selected Yes) | Defaults move choice, d=0.68, stronger for low-probability options [31 DF-1, STRONG] | **REJECT**: no pre-selected side on any viewport when opened from a neutral entry point |
| D3 | Stake default | Empty; "To win $0.00" | `$25` shown (entered) | **Pre-filled KSh 130** when opened untouched (`pm-ticket.tsx:568`) [KI N9] | Suggested amounts anchor stakes [31 DF-2, STRONG]; minimum KSh 20 [GCA s.71] | **FIX**: empty stake, min KSh 20 enforced inline |
| D4 | Quick amounts | +$1 / +$5 / +$10 / +$100 additive [PM] | $50 / $100 / $250 presets (2025) | **+KSh130 / +648 / +1.3k / +13.0k** = USD 1/5/10/100 converted (`pm-ticket.tsx:560`) [KI N6, V] | Anchoring; min stake 20 | **FIX**: set-to chips {20, 50, 100, 200} KSh; no Max, no %-of-balance [31 DF-2] |
| D5 | Outcome framing | "To win $0.00 · Avg. Price 0¢" | "Max payout $28.77", "Odds 87% chance"; fee-inclusive [KA #5, #7] | "To win Ksh 636.56 · 78.6% · 4.9 shares" [KI] | Money block BINDING (Reg. 45(1), 23(1); Act s.72(6)); behaviour untested → E2 [31 FR-1] | **INVENT** the three-line block: `You pay KSh X` · `If Yes: you get KSh Y` · `If No: you lose KSh X` — same sheet, above confirm, ≥20 px, ≥7:1 |
| D6 | Fees | **No fee text anywhere** [PM #19] | Fee inside the price; ⓘ "Includes a fee of $0.07" (2025) [KA #8] | Not shown | All-in pricing (StubHub field experiment, STRONG) [31 FE-1]; 27% of Kenyan adults misread a fee SMS [32 rule 5] | **ADOPT** Kalshi's all-in principle, **INVENT** the fee as a visible KSh line (not a tooltip) that sums exactly |
| D7 | Validation | None: "0", "-5", "abc", 99,999,999 → no error, Trade enabled [PM #5] | not measured | 99,999,999 accepted visually (capture); no inline error observed | WCAG 3.3.1 / 3.3.3 | **INVENT**: inline error text + `aria-invalid`, disabled confirm, messages in KSh ("Minimum KSh 20", "You have KSh 1,240") |
| D8 | Focus + pressed feedback | Focus 0 px; hover shift 1.5 px [PM P06] | "cta-pressed" state captured | not pixel-measured | Tap delays of ~69 ms are noticed; pressed paint ≤100 ms [32 rule 10] | **INVENT**: pure-CSS pressed state; Playwright trace gate |
| D9 | Jargon | "Avg. Price", "shares" | "contracts", "Dollars/Contracts" toggle | "4.9 shares" | Plain language [32 §2.9] | **FIX**: no "shares"/"contracts" on the default path |
| D10 | Limit orders | ¢ price + stepper | Limit panel (not measured) | ¢ stepper, "Limit price in cents" [KI N1, N3] | KES + % ruling | **FIX**: limit price in % (integer), converted to KSh per share in the money block |
| D11 | Auth gate on submit | US geo modal every time; escape is a 169×16 text button [PM #6] | Log in modal; Google card covers ticket bottom (mobile) [KA #10] | "Log in to trade" opens the auth dialog, ticket state kept? (verify) | KYC before first deposit; preview allowed [32 rule 13] | **KEEP** gate-at-commit; **INVENT**: after auth, return to the same ticket with amount restored (from D1 URL state) |

## E. Confirm, receipt, deposit, withdraw (P06-confirm, P12)

| # | Element | Polymarket | Kalshi | Kichiko today | Evidence | Ruling |
|---|---|---|---|---|---|---|
| E1 | Confirm step | not measurable (geo) | "You're buying $1.75 · Includes a fee of $0.07 · Submit" (2025) | not captured (needs account) | WCAG 3.3.4 (reversible/checked/confirmed) | **INVENT**: confirm shows the D5 block again + fee + close time; Confirm and Cancel equal size [32 rule 2] |
| E2 | Payment verification | crypto/card | card/ACH/wire; min $10; card 2% [KA #18] | M-Pesa STK | **70% of Kenyan mobile-money losses are accidental sends** (FinAccess 2024, n=20,871) [32 §0.2, STRONG] | **INVENT**: before STK push show recipient name, amount in numerals **and words**, masked number; withdrawals only to the verified owner's number |
| E3 | Receipt | — | "Order completed" panel (2025) | not captured | M-Pesa SMS mental model [32 rule 4] | **INVENT**: receipt shows the M-Pesa code in Safaricom's SMS order; history searchable by code |
| E4 | Pending state | — | — | not captured | Never show a balance change before server confirmation [32 rule 11] | **INVENT**: explicit "Pending" state |
| E5 | Flow symmetry | — | Deposit cap cannot be lifted until expiry [KA #17] | not measured | Withdrawal and self-exclusion ≤ deposit in taps (L.N. 112 Reg. 84, 67(3)) [31 RG-5] | **INVENT** gate: tap-count test, withdraw ≤ deposit |

## F. Auth & onboarding (P10, P11)

| # | Element | Polymarket | Kalshi | Kichiko today | Evidence | Ruling |
|---|---|---|---|---|---|---|
| F1 | Auth surface | Modal 448×446; Google 400×52; 8 provider tiles, **3 unnamed** [PM P11] | `/sign-up`; 4-digit email+SMS codes; live ID photo; ≈48 h review [KA #18] | `/auth/register`, `/auth/login`, email 6-digit code dialog | axe button-name | **KEEP** single-method email code; every control named |
| F2 | Age gate | 18+ (US) | 18+ | not audited | **KE 18, UG 25, TZ 18, RW 18**, on verified ID before deposit [31 LW-1; UG Act s.1 verified by 31] | **INVENT**: per-country age rule in the KYC step; UG 25 |
| F3 | When KYC | at trade | at sign-up (ID photo) | — | Reg. 82 (gazetted numbering per 31): ID, location, age before activation and before any deposit | **INVENT**: browse → preview ticket → account → KYC → deposit (no KYC before browsing) |

## G. Search (P07)

| # | Element | Polymarket | Kalshi | Kichiko today | Ruling |
|---|---|---|---|---|---|
| G1 | Empty state | **None**: nonsense query keeps showing unrelated markets [PM #18] | not measured | **NOT MEASURED**: `/search` ignores `?q=` (`search-view.tsx:91` initialises `query` to `''`), so both captures show "Trending now"; searches are not linkable [KI, V] | **FIX**: read and write `?q=` (linkable, back-button safe); **INVENT** explicit "No markets match 'x'" + suggestions; measure by typing in Phase 1 |
| G2 | Input size | 16 px mobile (no iOS zoom), 14 px desktop | — | measure in Phase 1 | **ADOPT** 16 px on mobile |

## H. Social, leaderboard, profile (P08, P09, P17)

| # | Element | Polymarket | Kalshi | Kichiko today | Evidence | Ruling |
|---|---|---|---|---|---|---|
| H1 | Leaderboard | Public, `+$5,086,914`, win amounts 2.89:1 [PM P08] | Behind login; **users opted out by default** [KA #20] | Public `/leaderboard`; profile "Biggest win" | Winners' identity confidential unless written consent (L.N. 112 Reg. 87 per 31); no former-winner ads (L.N. 114); leaderboards/winner feeds → risk-taking [31 DP-3/DP-4] | **REJECT** profit leaderboards. Decision owed (§6 of 41): remove, or replace with an opt-in, non-monetary **accuracy** board |
| H2 | Social feed | Activity tape "user · Up · 58¢ · ($11.64)" [PM P17b] | `/ideas/feed`, P&L cards with leverage [KA #20] | none | Social interaction + warnings raised betting 13% (Barasa 2026, Kenya RCT, per 31) | **REJECT** at launch |

## I. Responsible-play tools (P14)

| # | Element | Polymarket | Kalshi | Kichiko today | Evidence | Ruling |
|---|---|---|---|---|---|---|
| I1 | RG link | **No responsible-gambling link anywhere** [PM P14] | Breaks ≥1 day, self-exclusion, SelfExclude.io, monthly deposit cap, Birches Health, 988 [KA #17] | `/legal/responsible-play` page | Reg. 84: deposit/loss/session limits, reality checks, self-exclusion ≥24 h, national register [31] | **ADOPT** Kalshi's cross-operator exclusion idea (→ national register); **INVENT** tools per Reg. 84 |
| I2 | Limits | — | Monthly deposit cap; increases next month | not audited | Prompts alone: null on losses (Ivanova et al., MODERATE) [31 DF-3, rule 8 WRONG] | **INVENT**: limits as the default path, free text; decrease immediate, increase ≥24 h + reconfirm (TZ 7 days) |
| I3 | Self-exclusion | not found | Available | not audited | ≤2 taps, immediate (Reg. 84(2)(d), 67(3)) | **INVENT** gate: 2-tap test |
| I4 | Outreach | — | — | — | Phone contact to heaviest losers −30% loss at 12 months, d=0.44 (Jonsson 2020) [31 RG-3] | **INVENT**: human outreach to top 0.5% losers — the best evidence-to-cost edge in [31] |

## J. Shell pages (P13, P15)

| # | Element | Polymarket | Kalshi | Kichiko today | Ruling |
|---|---|---|---|---|---|
| J1 | 404 | HTTP 404; "Page not found … Intercom"; title from slug [PM P15] | HTTP 404; illustration; "Go to home page" [KA P15] | HTTP 404; on-token page, two 44 px actions (shipped 2026-09-27) | **KEEP** |
| J2 | Error boundary | not measured | not measured | `error.tsx` with refresh-and-retry, digest; per-segment loading without breaking 404 status | **KEEP** |
| J3 | Help centre | separate site, no dark theme, 0/22 contrast failures | separate site, 85% targets <24 px (M1) | `/help` in-app | **KEEP** in-app help |

---

## What the matrix says, in one paragraph

Kichiko already beats both incumbents on the dimensions users feel but never name: contrast
(0.1–0.4% vs 4–22% failing), touch targets (31.5% ≥44 px vs 13% and 7–10%), page weight (≈0.5 MB vs
≈5 MB) and zoom. It loses on density, number discipline and the ticket: the ticket carries every
serious defect we measured (2.18:1 payout text, USD-derived chips, a pre-filled stake, ¢ in the
limit row, no fee line, no max-loss line). Two findings outrank design entirely because they are
legal: two live markets on pending court proceedings, and "Predict & Earn" as the hero CTA. The
edge is not novelty. It is finishing a lighter, more legible system and making the ticket the most
honest money screen in the category, in the currency and payment rail our users already trust.
