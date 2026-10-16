# 42 — Where the element matrix actually stands, 2026-10-16

[40-ELEMENT-MATRIX](40-ELEMENT-MATRIX.md) is the canonical page-by-page,
element-by-element comparison (Polymarket × Kalshi × Elopis → ruling). It holds
**95 rulings across thirteen sections, A–M** — K, L and M were added on
2026-10-16 for the chart, the hero and the public trader profile, which the
first ten sections covered in four cells between them. [50-EXECUTION-LOG](50-EXECUTION-LOG.md) records what was executed on
2026-09-27.

This file says which rulings are **live in the product today**, measured rather
than assumed, and what is still open. It exists because the October work drifted
into fixing whatever was tripped over — covers, news, the footer — instead of
walking the matrix. The matrix is the plan; this is its status.

Sections A–E, G, I, J and now K–L have been worked end to end. Of the three
claims this file still carries that are NOT measured against the running app,
each says so where it appears: C6's banner (no market has resolved anywhere),
I4's telephone outreach (a commitment the business has not made), and the
rulings marked `L`, which are taken from the execution log and have not been
re-measured since.

Two entries in §1 below were **wrong and are corrected in place** (B4, C5).
Both were recorded as done on an honest measurement that happened to miss —
which is its own lesson, and §2.9 spells out how each one hid.

**Evidence grades.** `M` measured by me on 2026-10-15 or 2026-10-16 against the
running app ·
`V` verified in code · `L` taken from the execution log, not re-measured ·
`DB` queried against production.

---

## 1. Closed since the last status

| # | Ruling | Status | Evidence |
|---|---|---|---|
| A1 | KES + % one formatter, no ¢/multiplier | done | L |
| A7 | Theme follows OS | done | L |
| A13 | Charts newest-anchored, untruncated | done | L |
| B2 | No "earn"/income framing; copy-lint gate | done | L |
| C2 | Integer % everywhere | done | L |
| D3 | Empty stake, KSh 20 minimum | done | L |
| D4 | Set-to chips 20/50/100/200 | done | L |
| G1 | `/search` reads and writes `?q=` | done | L |
| H1 | Profit leaderboard removed | done | L + M |
| C5 | Chart series colours ≥3:1 both themes | done for `--chart-yes/no/brand`; **the multi-outcome palette was never covered and failed both halves** — see §2.9 K1 | V, then M |
| A4 | **Every control ≥44×44 on money routes** | **done + gated** | M |
| B4 | Fixed 0–100% axis, default All, no dead ranges | **re-opened and closed 2026-10-16** — the axis half was never applied; see §2.9 | M |
| C1 | Hero probability ≥28px, integer | done | M — 28px |
| C3 | **Resolution source on every market (BINDING)** | **done** — 28 of 36; 8 named below | DB |
| D1 D2 D5 D7 D9 D10 | the money path | **done** — see §2.3 | M |
| D8 D11 | pressed state, auth round-trip | already satisfied | V |
| E2 E3 E5 | read-back, M-Pesa code, flow symmetry | **done** — see §2.4 | M, DB |
| E4 | explicit pending state | already satisfied | V |
| G2 | 16px inputs, no iOS zoom | **done** — §2.6 | M |
| C6 | Resolved banner: outcome, date, what decided it | **built**, not observable — §2.6 | V |
| I1 I3 | RG tools reachable; self-exclusion in 2 taps | **done** — §2.7 | DB + M |
| I2 | Deposit and loss limits, 24h to loosen | **done** — §2.7 | DB + M |
| I4 | Call list for the heaviest losers | **script**; the calls are not committed | DB |
| J1 J2 J3 | 404, error boundary, in-app help | **KEEP confirmed + gated** — §2.8 | M |
| K1 | Series colours distinguishable from each other, and from their surface | **done + gated** — §2.9 | M |
| K2 | SVG chart text meets 1.4.3 | **done + gated** (the gate is new; axe never saw charts) — §2.9 | M |
| K3 K4 K8 | Fixed axis, one watermark rule, no single-tab row | **done** — §2.9 | M |
| K5 K9 | Hover readout, no emoji in the data strip | **KEEP confirmed** | M, V |
| K6 K7 | End labels at rest, on-chart trade ticker | **REJECT, with the reasoning** — §2.9 | M |
| L1 L2 L5 | Hero legend, line count, ranked rails | **done** — §2.9 | M |
| L3 L6 | Labelled pager + stop control; no mobile hero | **KEEP confirmed** | M |
| L4 | News in the hero | **ADOPT, blocked on data** — §2.11 | DB |

### A4, in detail

The ruling carried a gate that was never built: *"Playwright assertion on every
money route at 360×800."* Without it the pages drifted. Measured at 390×844 on
the market page: **58 controls under 24px and 22 more under 44px** — chart range
tabs 28×28, Share/Save 34×34, "Sign in" 72×34, comment Like/Reply/Share 35×16,
section tabs 36px, sort select 40px, search input 43px.

`apps/web/e2e/target-size.spec.ts` is now that gate. axe-core does not cover
this — its `target-size` rule is off by default and checks WCAG 2.5.8's 24px
floor, not the 44px this project adopted.

Two findings worth carrying forward:

- The sort select carried an inline `style={{minHeight:40}}`. **Inline styles
  outrank every stylesheet rule**, so no media query could raise it. Height
  moved to a class.
- Scope is controls, not text links. WCAG 2.5.8 exempts a target "in a sentence
  or whose size is otherwise constrained by the line-height of non-target text".
  Commenter names and footer list links qualify; sizing them to 44px would
  inflate the footer and help nobody.

---

## 2. Worked since, and what remains

### 2.1 C3 — CLOSED 2026-10-15. 28 of 36 sourced; the 8 below still have no independent authority

Every active market had `resolution_source` NULL. The UI had always rendered
the field; the data was never populated. `scripts/backfill_resolution_sources.py`
now fills it for **28 of 36**, and the panel reads "Resolution source:
iebc.or.ke" so the authority survives a link that will not open.

The source was not chosen editorially: each market's own criteria already named
it ("declared winner … by the IEBC", "BTC/USD (Coinbase spot)"), so the script
maps the named authority to its public record and fetches every URL before
storing it. Three verdicts, because they are not the same failure — *bot-walled*
(403 to an automated client; Coinbase serves humans, so it is stored),
*cert-chain* (`www.iebc.or.ke` omits its intermediate certificate: desktop
browsers recover via AIA, **older Android does not**), and *dead* (404 or no
connection, never stored — this caught five wrong URLs).

**The 8 left NULL are the finding that remains.** Their criteria name no
independent authority at all: "major-media confirmed", "a reputable 2026
year-end analytics report", "the leading 2026 Kenyan music awards", "appear
jointly at a political event". Writing a source would assert a resolver the
rules do not. Those criteria need rewriting before a source can exist, which is
a Reg. 45(6) question rather than data entry. `NO_INDEPENDENT_SOURCE` lists each
with its reason.

### 2.2 A3 — CLOSED 2026-10-15

Measured 390×844 in both themes, fixed, re-measured:

| route | light before | light after | dark after |
|---|---|---|---|
| `/` | 10 | **0** | 1 |
| `/markets` | — | **0** | **0** |
| `/markets/[slug]` | 16 | **0** | **0** |

The yes/no text tokens were AA-tuned and reached 4.56:1 and 5.14:1 on their
**composited** tints — the tints render at 15% and 9% alpha, so the raw token
values flatter the real figure. The new values are the darkest shades of the
same hues clearing 7:1 on the composited background.

Volume was the other half, and the matrix had caught it in September: *"volume
`#aeb4bc` on white 2.09"*. Still there a month later — the hero's largest
number and the hardest to read on the site. At 2.09:1 the word "Vol" and the
close date beside it were failing plain WCAG AA, not just the money rule.

One left: a 12px probability at **6.65:1** in dark against the 7:1 aspiration.
Clear of AA; not worth moving a token for 0.35.

### 2.3 Section D — closed

| # | Ruling | Outcome |
|---|---|---|
| D1 | URL-encoded ticket state | **done** — choosing a side writes `?side=`/`?option=` via `replaceState`; history stays flat |
| D2 | No pre-selected side | **done** — `sideChosen` gates arming and submit, only where a toggle is offered |
| D5 | Three-line money block (BINDING) | **done** — `components/trading/outcome-block.tsx`, both layouts and both order types |
| D6 | Fee as a visible KSh line | **not applicable, see below** |
| D7 | Inline validation | **done** — `aria-invalid`, `aria-describedby`, over-balance stated while typing |
| D8 | Pressed state | already satisfied — `.btn:active` |
| D9 | No `shares`/`contracts` on the default path | **done** — remains only in prose that defines the word |
| D10 | Limit price in % | **done**; the *integer* half rejected, see below |
| D11 | Return to the ticket after auth | already satisfied, more thoroughly than asked |

**D6 — there is no fee to show.** All 36 active markets run
`pricing_engine = 'clob'`, and the live `place_order_for` contains zero
occurrences of "fee" `[DB]`. The 2% `platform_fee_rate` on every market belongs
to the legacy AMM path (`place_bet`) and is dead data that contradicts the live
engine — a trap for anyone reading that column. The all-in principle the ruling
is drawn from is already satisfied: what you pay is what you pay. Adding a fee
line would have misstated the cost.

**D10 — the integer half would break order placement.** `tick_size` is `0.0010`
on all 36 markets `[DB]`, so the book trades in 0.1% increments and the
stepper's 0.1 matches it exactly. Rounding the input to whole percent would stop
people placing orders at valid prices and make it impossible to improve an order
by a single tick. Integer % is right for a displayed *probability* (PR-1); a
limit price is an order parameter, not a readout.

**D11 — already built.** `lib/pending-bet.ts` carries a built ticket across the
auth round-trip on two carriers: localStorage for same-device, plus a base64url
param that rides inside the auth `next` path so an email confirmation opened on
another device still rebuilds the exact ticket. With a freshness window and
market scoping. The matrix listed it as unverified, not missing.

**Not verified in a browser:** the neutral open itself (the harness could not
surface the mobile trade bar) and the limit panel (the rail does not expose it
signed out). Both rest on type-checked code paths rather than a browser run.

### 2.4 Section E — worked

| # | Ruling | Outcome |
|---|---|---|
| E1 | Confirm step on a trade | **declined** — a conversion decision, not a defect; see below |
| E2 | Read-back before the transfer | **done** (numerals + words + number); the verified-number half is **blocked** |
| E3 | Receipt shows the M-Pesa code | **done** — the data was always there, nothing rendered it |
| E4 | Explicit pending state | already satisfied |
| E5 | Withdraw no harder than deposit | **done**, structurally |

**E2.** Withdrawal had no defence against the one failure this market actually
suffers. A person typed an amount and a free-text number, tapped once, and the
money went; `checkProviderDestination` only checks the number is *well-formed*,
never that it is theirs, so a typo forming a valid Kenyan number is a real
payment to a stranger. Both flows now read the transfer back — amount in
numerals **and words**, plus the destination — before anything is sent. Digits
fail quietly: "5,000" and "50,000" differ by one glyph. Withdraw also gained the
dial-code prefill and `isValidPhone` that deposit has always had and it never
did.

**Closed 2026-10-15.** Binding withdrawals to a verified number no longer waits
on anything: a completed deposit is an STK push the holder authorised on the
handset carrying that SIM, with their own M-Pesa PIN, so deposit history *is*
the proof. `lib/payments/verified-phones.ts` derives it, the withdraw sheet
offers those numbers as chips, and the route enforces it behind
`flags.withdraw_verified_phone_only`.

An SMS code was the obvious route and was rejected on evidence: the Africa's
Talking sender exists, no API key does, and a payout control that has never run
is not a control.

The flag **ships off**, which is a measurement rather than caution. On this
database 0 of 9 withdrawals would pass, because the seeder gives every deposit
its own random number — one account shows 47 distinct "verified" numbers across
47 deposits. Real history does not look like that, but enforcement cannot be
demonstrated against data that does not model phone reuse. The setting's help
carries the query to run before switching it on.

`profiles.phone_number` is deliberately **not** backfilled: 60 of the 61 funded
accounts have more than one distinct deposit number here, so picking one would
be inventing a fact. The derived set is the better model regardless — people
hold more than one number, which a single column cannot express.

**E5 nearly broke on E2.** Adding a step to withdraw made cashing out one tap
longer than paying in, which Reg. 84 and 67(3) forbid. Deposit therefore takes
the same step — which E2 asks for anyway ("before STK push"). Both sheets now
type their state as `FundingStep` from one module, so neither can gain or lose a
step without changing something the other shares. A true tap-count gate needs an
authenticated session with a funded wallet, and this project has no e2e fixture
for that; the structural guarantee stands in for it.

**E3 was never a data problem.** `credit_deposit` has always written the
provider's receipt into `transactions.payment_reference`. Nothing rendered it,
so the identifier people reconcile money by was visible only in the admin
console. (Production rows read NULL there because the 1,468 deposits are seeded
and bypassed the RPC.) *Searchable* by code remains open.

**E1 declined.** A confirm step on every trade is a conversion decision rather
than a defect fix; Polymarket and Kalshi both submit directly, and the money
block it would re-show is already on the ticket (D5). Worth a deliberate call,
not a silent one.

### 2.5 Sections A and B — worked

| # | Ruling | Outcome |
|---|---|---|
| A3 | Money ≥7:1 | **done** — §2.2 |
| A4 C4 | 44px targets; 48px for money | **done + gated** |
| A6 | Visible focus ring | ring already existed; **gate added** |
| A8 | 2px spacing scale | **already satisfied** by Tailwind's default |
| A11 | JS budget | **measured**: 102 kB shared (budget 130); `/markets/[slug]` 257 kB first load, over |
| A12 B5 | Drop the attention framing | **done** |
| B1 | Hero must not auto-rotate (**WCAG 2.2.2**) | **done** — stop control |
| B3 | No chips under 44px | **done** via A4 |

**B1.** The hero paused on hover and focus and honoured
`prefers-reduced-motion` — more care than most carousels — but none of that is
2.2.2's mechanism: no hover on a phone, nothing advertises it, and an OS
setting is not an in-page control. There is now a 44×44 stop toggle, and it is
sticky.

The first attempt looked right and did nothing: `aria-pressed` flipped and the
label changed while the carousel stayed frozen, because the control sits inside
a region carrying `onFocusCapture={pause}` — pressing it pauses via focus, and
focus then stays on the button so the matching blur never arrives. Verified
afterwards with a MutationObserver rather than by sampling.

**A12/B5.** The labels were selling rather than describing. The bottom-nav tab
read "Breaking" under a flame while routing to `?sort=newest`; the hero rail's
"Breaking News" is `movers.map()` and was about to collide with the real
journalism now on market pages. Now "New", "Biggest moves", "Most traded" —
every sub-label was already accurate.

**A11.** Measured on a clean production build. The remaining gap is one route,
and splitting the ticket and chart is a piece of work in its own right.

### 2.6 C6 and G2 — worked

| # | Ruling | Outcome |
|---|---|---|
| C6 | Resolved state | **built**, unit-tested; **not observable** — no resolved market exists anywhere |
| G2 | 16px inputs (no iOS zoom) | **done** — measured 16px on every probed route |

**C6.** A settled market said `Resolved: YES` in a badge the size of a category
chip, beside the volume: the one fact that decides whether someone's money came
back was styled as metadata. It is now a status banner carrying the outcome,
the date it resolved, and what decided it — the last two are things neither
incumbent shows, and Reg. 45(6)/(8) require both the independent mechanism and
the records of it. Kalshi's version is the warning: its side panel still read
"To be determined" beside a full-time score.

All 38 markets are active, so the banner cannot be exercised in a browser
without writing a fake outcome into a real-money ledger. The date logic is
unit-tested; the banner itself is unverified by measurement and says so here.

**G2.** Every text input and select was 13–15px, under the 16px below which
Safari zooms the viewport on focus — and leaves it zoomed, so the next tap
lands somewhere else. The first fix was silently ineffective: inside
`@layer components` the rule lost to the Tailwind `text-[13px]` utilities on
the elements themselves. It sits outside the layer with `!important` and is
measured at 16px.

### 2.7 Section I — responsible play

| # | Ruling | Outcome |
|---|---|---|
| I1 | RG tools exist and are reachable | **done** — limits and break on `/legal/responsible-play` |
| I2 | Limits as the default path, free text, asymmetric change | **done** — migration 110 |
| I3 | Self-exclusion in ≤2 taps, immediate | **done** — migration 109 |
| I4 | Human outreach to the heaviest losers | **list built**; the calling is an operational commitment, not made here |

**What was there before.** Two sentences. "Contact us via the Help page and
we'll set it up" for a break, and "contact us … while we finish building them"
for limits. An email, a wait, and a human, for the two controls Reg. 84 says
must be immediate and no harder to reach than the things that take money.

**I3.** Four lengths, two taps, in force at once. A break cannot be shortened
or cancelled: `play_breaks` grants the owner INSERT and SELECT and nothing
else, and the route has no DELETE or PATCH. A cooling-off that can be
cancelled in the moment of wanting to play is not a cooling-off. It stops
**play, never payout** — buying and depositing are blocked; selling and
withdrawing stay open, because trapping someone's money at the moment they ask
to stop is the opposite of what the regulation is for.

**I2.** Lowering a limit binds immediately; raising one, or removing it, waits
24 hours and must then be confirmed again, and any new request for that limit
drops a pending raise. The amount is free text: a ladder of presets makes the
operator's convenient numbers the easy answer.

The loss limit is **not** a cap on realised P&L, and the distinction is the
whole ruling. Our markets settle weeks or months out, so a realised-loss cap
would not notice someone staking everything on a Monday until the market
resolved — a protection in name and an ornament in effect. It counts money out
and not back in the window (buys − sells − payouts), which is realised loss
plus the cost of open positions: the most the person can be down, counting
every open position as if it lost. It binds at placement.

Both gates, and the break gate, moved **inside `place_order_for`**. A check one
round trip away from the wallet debit lets two orders sent together both pass a
limit only one should; inside, it shares the transaction — and it restores
migration 090's finding L1, one round trip per order, which the first cut of
I3 had broken.

Three defects were found by testing the first cut, and all three are recorded
in `supabase/migrations/110_play_limits.sql`: limits ordered only by
`effective_at` returned an arbitrary row when two requests shared a transaction
timestamp; `REVOKE … FROM PUBLIC` left Supabase's default grants intact, so any
signed-in user could execute the SECURITY DEFINER functions that take a
`p_user_id` and read another user's figures; and a confirmation message named a
clock time in server UTC to users spread over UTC+2 and UTC+3.

**I4.** `scripts/ops/responsible/outreach_candidates.py` ranks the window's
heaviest net losers, excluding anyone already on a break, and prints
identifiers only unless `--with-contact` is passed. Jonsson et al. (2020) is
the strongest evidence in [31] — ~30% lower losses at twelve months, d = 0.44 —
and it came from a telephone conversation, which is why this script stops at
the list. Making the calls is a commitment the business has not yet made, and
this document should not pretend otherwise.

### 2.8 Section J — verified, and three defects it found

| # | Ruling | Outcome |
|---|---|---|
| J1 | 404 | **KEEP confirmed + gated** — real 404s, two ≥44px ways out, noindex/follow |
| J2 | Error boundary | **KEEP confirmed** — retry refetches the RSC payload, digest shown |
| J3 | In-app help centre | **KEEP confirmed + scanned** |

KEEP is a claim like any other, and no gate had ever scanned these pages. The
scan found three live defects, none of them cosmetic:

* `/help` served the "See the events" primary button in **green-700 on the blue
  primary fill — 1.19:1**, an invisible label on the page people reach when
  they are already stuck. The legal-page layout coloured every descendant link,
  buttons included.
* The home page carried a **critical** `aria-required-children`: B1's new
  stop-rotation button sat inside the `role="tablist"`, which may contain only
  tabs.
* The chart placeholder's label was gray-400 on its gray-100 fill — 2.3:1.

And two gates were themselves wrong, which is worse than a page being wrong.
`focus-visible` read the computed outline at t+0 and reported a ring that was
real but **animated** (0px at t+0, 2px at t+120, via `transition-all`);
`target-size` was right and had been failing — the comment Like buttons were
39×44, because the coarse-pointer rule set a minimum height and no minimum
width.

Both are fixed on both sides: the gates measure correctly, and the three
focusable controls that eased everything now ease only colour.

### 2.9 Sections K and L — the chart and the hero, 2026-10-16

Sections A–J spent three cells on the chart (A13 data, B4 axis, C5 series
colour against the background) and none on how it behaves while you watch it.
[40-ELEMENT-MATRIX](40-ELEMENT-MATRIX.md) now carries **K** (the chart as a
live object) and **L** (hero composition), measured against polymarket.com and
demo.kalshi.co on 2026-10-16 — re-measured rather than read from the September
capture, because both heroes had been rebuilt since.

Nine defects, all measured, all fixed in this pass:

| # | Defect | Measurement |
|---|---|---|
| K1 | Two palette slots were the same colour | slots 3/11 **ΔE2000 2.5**; 2/9 = 7.0; 8/12 = 9.5 |
| K1 | The leader's own line failed contrast | slot 1 = raw `--pip-500` = **2.88:1** on `--surface` dark (1.4.11 floor is 3:1) |
| K2 | Chart axis labels failed AA | hero x-axis dates `--ink-300` on white = **2.09:1** |
| K2 | The detail chart's watermark failed AA *and* was announced | 1.5:1 light / 1.7:1 dark, no `aria-hidden` |
| K3 | **B4 was recorded closed and was not** | hero `autoDomain` (0/20/40/60/80, no 100%, four slides); detail `niceProbScale(max×1.3)` |
| K4 | Two charts, two watermark rules | 47 px / 143×56 px centred vs 13 px cornered |
| K8 | A tab row with one permanently-selected tab | its own comment said "never collapse to a single control"; the line was never written |
| L1 | The hero legend duplicated the panel | four names and four percentages twice, 200 px apart |
| L2 | The chart drew fewer lines than the panel listed | 4 drawn, 5 listed, nothing saying so |
| L5 | A ranked list of one | "Most traded · 1 · … KSh 6.9K today" — 1 of 36 markets has 24 h volume |
| — | `1 options` | flagged in the matrix as C2/N8 in September; still shipping |

**The finding behind four of these: axe cannot see charts.** axe-core's
`color-contrast` rule evaluates HTML text only — SVG text is out of scope by
design, because it cannot resolve what is painted behind a glyph in a vector
scene. Every number we draw on a chart is SVG text. So §2.2's "0 failures on
`/`" was true, carefully measured, and blind to the entire chart layer.
`e2e/svg-text-contrast.spec.ts` is now that gate: both themes, compositing the
real background down the ancestor chain, with a decorative exemption that only
applies when the node is *both* `aria-hidden` and under 20% opacity, so the
exemption cannot become a hiding place. It found both K2 rows on its first run.

**K1 is the one worth reading twice.** C5 asked whether a series colour clears
3:1 against the surface. Nothing asked whether two series colours can be told
apart, which is the comparison a reader actually makes, and the twelve-slot
palette had a pair 2.5 ΔE apart — below the just-noticeable difference, at a
1.75 px stroke, with the legend as the only way to recover which line was
which. Twelve mutually-distinguishable hues do not exist inside the lightness
band two surfaces both permit; that was searched exhaustively (best achievable
minimum was 9.0, still a collision) before being given up on. The palette is
now **six** theme-aware slots — Okabe & Ito's colour-universal hues, shifted as
a set to the lightness each canvas needs — and ranks past the sixth repeat the
hues with a dash, so the repeat is carried by a channel that is not colour.

Shifting *as a set* is load-bearing and was learned by getting it wrong:
flattening the eight hues to one lightness (for palette coherence) collapsed
vermillion and orange to **ΔE 0.3 under deuteranopia**, because under
dichromacy those two differ almost only in lightness. Okabe-Ito's CVD safety
*is* its lightness spread.

Six is not a ceiling we are pressed against: the widest market in production
has six outcomes, the detail chart caps inline labels at six anyway, and the
hero now draws exactly the six its panel lists.

`lib/__tests__/series-palette.test.ts` gates all of it, and was checked against
the retired values before being trusted — it fails them on the dark slot-1
contrast and on slots 3/4 at 1.6 ΔE under deuteranopia. A gate nobody has seen
fail is not yet a gate (§2.8).

**K3 is a correction to this document.** §2.5 recorded B4 — "fixed 0–100% axis"
— as done and measured. The measurement was honest: it was taken on markets
whose leaders reach ~75%, where `niceProbScale(max × 1.3)` returns 0–100%
anyway. The code was auto-scaling and said so in its own comment ("Polymarket
does NOT pin the probability axis to 0–100%"), written for parity *before* B4
ruled against that parity. Both charts are now fixed at 0–100% with five ticks.

The cost is stated rather than hidden: a market where every outcome sits under
10% now draws flat lines along the bottom of the plot. B4 took that trade
deliberately on [31] CH-1 ("truncation exaggerates"), which on a product where
people stake money on the number is the safer direction to be wrong in. It is
still worth the owner re-confirming for low-probability markets.

**One measured thing we are not copying** (K6), and one the owner overruled
(K7, see §2.12):

* **End-of-series labels on the detail chart** (K6). Polymarket paints the name
  and a large percentage at each line's last point and runs no legend row at
  all. It works for them because they draw **two** lines (Brazil: 32 markets,
  2 lines) into a ~180 px right gutter. Ours draws five, three bunched under
  20%; five stacked end-labels would sit on the lines they annotate. The legend
  row above does the same job in less ink. On the **hero** the opposite was
  true, and that legend was deleted — see L1.

### 2.10 Remaining

F2/F3 (below); **A11 is effectively closed (§2.15)** — every route is inside
the ruling's 150 kB, one is over the gate's stricter 130, and the remainder of
`/markets/[slug]` is the order ticket, whose split is a design decision;
**M4's cost basis**, which would turn the trader profile's
value card into real profit and loss; **M7's ruling** on what the platform
invites people to share; H2's decision on an opt-in accuracy board to replace the profit
leaderboard H1 removed; I4's calls, which are a commitment rather than a
commit; **the news matcher (§2.11)**; and the one open question K3 leaves for
the owner — whether a fixed 0–100% axis is right for a market whose every
outcome sits under 10%.

**F2/F3 — a correction.** These were recorded as sharing E2's phone blocker.
That was wrong, and phone verification does not move them. F2 is a per-country
age rule, and its blocker is that **no date of birth is captured anywhere**:
the KYC wizard's five steps are email, phone, ID document, selfie, address. F3
is the ordering — KYC before any deposit — which would stop today's unverified
users funding their accounts.

Both are the product decision recorded as D4 in
[51-PROPOSED-DB-CHANGES](51-PROPOSED-DB-CHANGES.md), not engineering work
waiting on a dependency. A DOB field is trivial; deciding to block existing
depositors is not.

### 2.12 K7 and L4 shipped — the owner's call, 2026-10-16

Section 2.9 recorded the live trade ticker as **REJECT** on three findings in
[31], and L4 as blocked on data. The owner overruled the first and redirected
the second the same day:

> "note, I said our focus is global, the company will be registered in US. if
> polymarket as are doing it, we can! Once we register a subsidiary with
> kenyan jurisdiction, we'll need to abide by their rules and not 'show' the
> price animations. For now, implement it so we can progress. Also, implement
> the news animations"

That is a scoping decision, not a reversal of the evidence, and the build
reflects it: **`flags.live_trade_ticker`** is the whole of the Kenyan switch.
It ships ON (US/global), it is a public boolean in the settings console with
the reasoning in its help text, and the chart renders complete without the
overlay — so turning it off is one toggle, not a code change. The API route is
gated on the same flag, so a disabled ticker cannot be revived from the client.

**The ticker.** `market_activity` inside a 90-minute window, server-rendered
for the first frame, then polled every 6 s against
`/api/markets/[id]/trades?since=`. Labels are 13 px/600 in the outcome's own
series colour, in a `pointer-events-none` overlay at the plot's `bottom-10
left-2.5` — Polymarket's measured geometry, reproduced, with our own palette
so a label and its line always agree.

Three deliberate divergences:

* **Stoppable.** Theirs cannot be stopped; WCAG 2.2.2 asks for a mechanism and
  `prefers-reduced-motion` is not one (B1's lesson). Stopping **freezes**
  rather than blanks: the trades on screen stay readable. One control covers
  everything that moves — the carousel's existing 44x44 toggle now writes a
  shared preference (`lib/motion-stop.ts`) that the ticker and the news card
  both read, because three stop buttons in one card satisfies 2.2.2 and
  defeats its purpose.
* **Honest about staleness.** Nothing outside the window renders, so the
  ticker never loops old rows to imply a market is busy. On this database that
  means it is invisible today: the newest `market_activity` row is months old.
  `scripts/seed_activity.py` is how to make it visible locally.
* **Clamped.** The overlay lives inside the plot's own positioned box, so a
  label cannot travel over a control — which Polymarket's does, on their own
  mobile cards, where `+ $100` lands on the "Up" button.

The gate (`e2e/trade-ticker.spec.ts`) stubs the trades route, because a test
that waited for real trades would pass vacuously for as long as the market is
quiet. It asserts a trade arriving **after load** reaches the chart (so the
poller is exercised, not just the server frame), that labels wear their own
outcome's colour, that the overlay stays inside the chart box, that the stop
control is >=44 px and freezes without blanking, and that `enabled: false`
renders nothing at all.

**Two things seeding real trades then exposed**, both found by gates rather
than by looking:

* **The fade was illegible.** Older labels receded by opacity, 0.13 a step,
  which put the sixth at 0.35. The series palette clears WCAG 1.4.11's 3:1
  floor with modest headroom — slot 1 is 4.02:1 on the dark surface — so any
  alpha reduction spends it, and the new per-label contrast assertion measured
  one at **2.55:1**. A figure on a price chart that cannot be read is not a
  softer version of the information. There is no fade now: position carries
  the ordering, the way a trade tape reads, and the label leaves outright when
  its time is up.
* **The kill-switch was not immediate.** The client trusted only the
  server-rendered flag, so an operator turning `flags.live_trade_ticker` off
  left trades animating on every page already open until the next navigation.
  For a jurisdiction switch that is the wrong half-life. The poller now honours
  `enabled: false` from the route by clearing and standing down.

The per-label contrast check exists because axe cannot see this either: the
overlay is `aria-hidden`, and axe skips aria-hidden subtrees — the same shape
of blind spot that hid the chart axis labels (§2.9 K2). Two gates now, for the
two things no general-purpose scanner looks at on a chart.

`scripts/seed_ticker_activity.py` puts trades inside the 90-minute window so
the ticker has something to animate, and `--live` trickles genuinely new rows
so the poller can be watched rather than inferred. Every row it writes carries
`metadata->>'seed' = 'ticker-demo'` and `--purge` removes exactly those; it
writes to `market_activity` only, which is a display feed, never the ledger.

**The news (L4), relocated and why.** Per-slide was measured impossible: six
links across 36 markets and **none on a featured market**, so the slot would
have been empty on every slide — the hero activity feed's mistake, twice. The
rotating card went into the rail instead, where it is always populated and
answers a better question: what moved the *board*, not what this slide is
about. It is also the honest version of a card Polymarket only pretends to
run — their rail is headed "Breaking News" and its rows are markets with a
probability and a delta, no journalism at all.

It holds a headline 7 s and cross-fades in 420 ms. **A scrolling ticker was
rejected**: a headline is prose, and text that moves while you read it cannot
be read — which is why 2.2.2 exists. Stopped, it freezes *and* lists the other
stories underneath, so the choice costs motion and never content. Each story
links out to its publisher (`noopener nofollow`) and in to the market it
bears on.

**And one defect the new work surfaced by accident.** Adding the ticker shifted
the market page's hydration timing, and the a11y gate started failing on the
chart's loading placeholder: `text-gray-600` composited to **#9aa0a8 on
#f8f9fa — 2.5:1**, serious. §2.8 recorded fixing that exact label (gray-400 at
2.3:1 → gray-600 at 7.6:1) and the fix was real. What undid it was
`animate-pulse`, which animates opacity on whatever carries it: the box, the
wash **and the label**, so the text's contrast halved on every cycle. 7.6:1 at
rest, 2.5:1 at the trough.

That also made the gate non-deterministic — whether axe caught it depended on
where the pulse happened to be when it ran, which is why it passed for weeks
and then failed on an unrelated change. The pulse is now a background wash and
the label holds full opacity: legible throughout, and the gate passes twice in
a row on purpose rather than by luck.

### 2.13 A11 — the budget gate was watching the wrong number

**Not one over-budget route. Fourteen of fifty-eight.** §2.5 recorded A11 as
"measured: 102 kB shared (budget 130); `/markets/[slug]` 257 kB first load,
over", and that was the whole of it. Measured properly on 2026-10-16, the
routes over a 130 kB first load were:

| | | | |
|---|---|---|---|
| `/markets/[slug]` 257 | `/profile` 198 | `/settings` 194 | `/traders/[id]` 193 |
| `/auth/login` 190 | `/notifications` 184 | `/markets/create` 184 | `/kyc` 184 |
| `/auth/register` 182 | `/auth/reset-password` 179 | `/admin/marketers` 179 | `/admin/marketers/campaigns` 178 |
| `/admin/marketers/[id]` 178 | `/` 132 | | |

The reason only one was known is the same shape of blind spot as K1, K2 and
B4: `scripts/check-bundle-budget.mjs` asserts **"First Load JS shared by
all"**, which Next computes as the chunks on *every* page. That figure was 102
kB against a 130 kB budget, green, and it stayed green while most of the
product shipped 180–260 kB. The gate was watching the number that was fine.

**Thirteen of the fourteen had one cause.** Reading the build manifest,
chunk `2230` (184 kB raw, ~66 kB gzipped) landed on exactly the fourteen, and
it is `@supabase/ssr` + `@supabase/supabase-js`. The pattern that put it
there, repeated across nineteen files:

```ts
const supabase = createClient()            // during render
...
await supabase.auth.signInWithPassword()   // only when a button is pressed
```

A visitor downloads the whole auth library before they can read the page, to
serve a call that happens only if they act. `lib/supabase/client-lazy.ts`
loads it on first use instead, and the call sites await it where they already
await something.

| route | before | after |
|---|---|---|
| `/markets/[slug]` | 257 kB | **193 kB** |
| `/auth/login` | 190 kB | **125 kB** |
| `/auth/register` | 182 kB | **116 kB** |
| `/auth/reset-password` | 179 kB | **113 kB** |
| `/markets/create` | 184 kB | **119 kB** |
| `/admin/marketers` ×3 | 178–179 kB | **under budget** |

Fourteen over budget → **seven**. Four routes came in under 130 kB outright.

`/markets/[slug]` took two changes: the client out of `pm-ticket`,
`position-summary` and `market-drawer` — all three read positions behind a
`user` guard, so **a signed-out visitor now downloads no auth library at
all**, which is most of the traffic a shared market link brings — and the
Community section (comments, top holders, positions, activity) code-split
behind `market-comments.lazy.tsx`. It sits below the rules and the news,
nothing above it depends on it, and its realtime channel was opening on every
visit for a section most visitors never scroll to.

**What is left, and why it ranks where it does.** Five of the seven
(`/profile`, `/settings`, `/traders/[id]`, `/kyc`, `/notifications`) still
pull the client through a view component. They are all **authenticated**
routes, where the chunk is usually already cached from an earlier page, so
they rank below the public ones — A11's evidence ([32] §3.3) is about a cold
first load on Slow 4G. `/markets/[slug]` at 193 kB is now its own page code —
the ticket, the candidate list, the mobile trade bar — and getting under 130
means splitting the ticket itself, which delays the primary action on the
money path and is a design decision rather than a refactor. `/` is 2 kB over.

**The gate now measures per route.** `ROUTE_ALLOWANCES` carries each remaining
offender with the figure measured on the day; a route not on the list must
come in under budget, and one on it may not get worse. So the list can only
shrink, and a new over-budget route fails immediately. It was checked against
a tightened allowance before being trusted, and it prints which routes have
improved enough to lower their entry.

### 2.14 The five authenticated routes — finished, and measured against PM

**Bundle.** All five converted (`/profile`, `/settings`, `/traders/[id]`,
`/kyc`, `/notifications`), plus the layout's navbar and bottom-nav, whose only
use of the client is a sign-out click and which sit on every page in the
product.

| route | before | after |
|---|---|---|
| `/kyc` | 184 kB | **118 kB** |
| `/notifications` | 184 kB | **118 kB** |
| `/traders/[id]` | 193 kB | **127 kB** |
| `/settings` | 194 kB | **128 kB** |
| `/profile` | 199 kB | **133 kB** |

**Fourteen routes over budget → three**: `/markets/[slug]` 193 (its own ticket
code), `/profile` 133 and `/` 132, both a couple of kB over on page-specific
client code. The Supabase client is no longer in any route's first load.

Two conversions needed more than a moved line. `notifications-view` opens a
realtime channel in an effect: it now subscribes **before** the first read, so
a notification arriving between the two is not dropped, and it holds a
teardown the cleanup can call even when the import resolves after unmount —
otherwise a fast navigation would leave a live channel pushing rows into a
dead component for the rest of the session. `use-auth` got the same treatment
plus a failure path: a chunk that will not load now reports "not signed in"
rather than leaving the page on a spinner for ever.

**Design, head-to-head.** Section **M** of the matrix is the element-by-element
comparison against `polymarket.com/profile/…`, measured the same day. The
short version: we match their anatomy — identity card, three-column stats, a
value card with range tabs, Positions/Activity tabs, an Active/Closed
segmented control, search, sort, and the same four table columns — and we
differ in exactly the places [31] says to.

Theirs leads with **Biggest Win** as one of three headline stats, a
`Total PnL +$7.2M` in green, a `$1,069,729.43` hero, per-row gains like
`(1,924.72%)`, a **share icon on every position row**, and a referral code
under the name. Ours carries none of that, which is H1 and B5 applied one
level down from the leaderboard they were written about. Our prices are in %
where theirs are in ¢ (A1).

**Two defects the comparison found in ours**, both on the value card:

* It was **two different quantities in one card**. The headline was
  `profiles.profit_loss_usd` — a lifetime figure — under a caption naming the
  selected range, so switching the range changed the chart and never the
  number. And the series it charts (`trader_pnl_series`, migration 026) sums
  `shares × price` across held positions and subtracts **no cost basis**, so
  the card headed "Profit/Loss" was plotting **position value**. On a trader
  with no recent price history it rendered **`KSh 0` under "Past Day"** — a
  money figure asserting a measured zero where there was no measurement.
  Both halves now come from the same series, the card is named for what the
  series is, and absence reads as absence. Turning it into real P&L needs
  `positions.avg_entry_price × shares` subtracted inside the RPC; that is the
  open item.
* **Thirteen controls under 44px**, including range tabs at 30×28 — the same
  28px the market chart's range tabs carried before A4 was gated there. The
  fix landed on one chart and not the other because only one was ever
  measured. `/traders/[id]` is now in `e2e/target-size.spec.ts`.

**And four routes joined the axe scan.** The comment at the top of
`e2e/a11y.spec.ts` deferred authenticated journeys to a manual audit, and the
authenticated *shells* went with them — every one of these renders signed-out.
`/traders/[id]`, `/profile`, `/notifications` and `/kyc` are scanned now; all
four pass.

**One ruling owed (M7).** Polymarket invites sharing on the P&L headline and
on every position row. We have it on the headline only. Reg. 87 binds the
operator publishing a winner's identity, not a person sharing their own
result — but what the platform *invites* is the platform's choice, and that
belongs with H2 rather than with me. The card now shares a **value** instead
of a signed green profit, which is the honest version whichever way the
decision goes.

### 2.15 /markets/[slug] under budget — by measuring, not by splitting

**193 kB → 149 kB.** Ruling A11's own figure is "JS ≤ 150 kB" ([32] §3.3), so
the money page is now inside it; the 130 kB the gate enforces is the
shared-bundle number reused per route, deliberately stricter so there is
somewhere to fall before the real line.

The first three attempts moved **10 kB between them**: splitting the market
drawer, the order-book drawer and the limit panel out of the first load. All
three were sensible, all three were guesses about where the weight was, and
the weight was not there.

So I turned on `productionBrowserSourceMaps` and read the chunk. It was not our
components at all:

| source | kB | why it was there |
|---|---|---|
| `zod/v3/types.js` | **128** | `clobOrderSchema` lived in `lib/clob.ts`, beside the pure helpers the ticket imports |
| `tailwind-merge` | **72** | `cn` lived in `lib/utils.ts`, beside the number formatters |
| `date-fns/format` + formatters | **47** | four fixed patterns: `MMM`, `MMM d`, `HH:mm`, `MMM d, yyyy` |
| `buffer` polyfill | **27** | a dead `typeof Buffer !== 'undefined'` branch in `pending-bet.ts` |

All four are the same defect, and it is the one this whole pass keeps finding:
**a heavy dependency parked in a module people import for a neighbour.** Twenty
of `lib/utils`'s twenty-one importers want `formatUSD` and get a class-name
resolver. Nothing on the client validates an order payload — the API route
does, after the request has left the browser. The `Buffer` branch never ran in
a browser; naming the global was enough to ship the polyfill.

Fixed by drawing module boundaries around what callers actually need:
`lib/clob-schema.ts`, `lib/cn.ts`, `lib/date-display.ts` (Intl, cached
formatters), and deleting the dead branch. Four one-line import changes and
three new files; no component restructured.

`big.js` (23 kB) **stays**. It is arbitrary-precision decimal on the currency
conversion path and `lib/currency.ts` says why. Trading float error for 23 kB
on the money path is the wrong direction, and A11 does not ask for it.

Knock-on, because these modules are imported everywhere: `/` 133 → **126**,
`/profile` 133 → **126**, `/traders/[id]` 128 → **121**. **One route over the
gate's 130, none over the ruling's 150.**

The rest of `/markets/[slug]` is the order ticket. Splitting that delays the
primary action on the money path, which is a design decision rather than a
refactor, and it stays recorded as one.

### 2.16 The value chart's default range — a question I should have asked

§2.14 fixed the card's honesty: it stopped reporting `KSh 0` where there was
no measurement. It did not ask why the chart was empty in the first place,
which the owner did:

> "instead of always having a blank graph under positions, why dont we have a
> like 1yr as default split. user can the select the time as i please and the
> graph populates beased on the selected time."

Right question, and the fix is a step past the suggestion. Measured on a real
account: 1D, 1W and 1M each returned **zero** points; 1Y, YTD and ALL returned
620. The '1D' default was Polymarket's, and Polymarket's markets trade
continuously — ours are long-dated and trade in bursts. Parity borrowed
without the condition that makes it right.

A fixed 1Y fixes the empty box and breaks the other case: someone who traded
this morning lands on a year in which today is one pixel. So the default is
**derived — the shortest range that holds data**. Active account opens on 1D;
quiet one falls through to 1M, 1Y, YTD or ALL. Ranges with nothing in them are
disabled rather than clickable into a blank, and with nothing held at all the
tab row is hidden instead of offering six dead controls.

Which is, again, the rule the market chart already had ("a range is offered
only when it actually contains something to draw") and that had never been
applied here. `lib/markets/pnl-range.ts` holds it now, with ten tests —
including the one that matters: in October YTD is the shorter window and in
January 1Y is, so the right default moves through the year and cannot be
written down as a constant.

### 2.11 The news matcher — two bugs fixed, one left standing

Section L4 wanted the hero to carry the headline that moved the market, which
is the one thing both incumbents put there and we do not. Checking whether the
data existed found a worse problem than a missing slot:

| table | rows |
|---|---|
| `news_articles` (ingested) | **234** |
| `market_news` (attached to a market) | **8**, across 36 markets |

A 3.4% attach rate would just be thin. The matches themselves are the finding:

* `ke-ruto-gachagua-reconcile` ← *"These are Ruto, Gachagua children"* —
  **score 0.571, the highest in the whole table.** A listicle about their
  children, attached to a market on whether the two reconcile. The market page
  orders by score, so the worst match leads.
* `ke-housing-45k-units-2026` ← *"Govt targets 20,766 schools in digital
  learning rollout as 64,000 teachers…"* — unrelated; presumably matched on
  the shape of a large number plus "targets".
* Three are genuinely right (Talanta stadium, the fuel-tax bill, Passaris on
  Sakaja), and one is arguable.

Also in `news_articles`: a row whose `source` is **Facebook** and whose title
is written in Unicode mathematical-bold characters
(`𝗚𝗼𝘃𝗲𝗿𝗻𝗺𝗲𝗻𝘁 𝗧𝗮𝗸𝗲𝘀 …`). That is a scraped social post rather than
journalism, and screen readers announce mathematical alphanumerics letter by
letter or skip them, so the headline is unreadable to the people most likely
to need it read aloud.

**Fixed 2026-10-16**, both bugs in one place — the corpus's capitalisation
rule, which decides what counts as a name:

* **Title-case headlines.** The rule already ignored ALL-CAPS headlines, on the
  grounds that one capitalising every word is no evidence any word is a name.
  Kenyan outlets are split roughly evenly between title case and sentence case,
  and a title-case headline does exactly the same thing. "Motorists Threaten
  Protests Over EPRA Fuel Price Hikes" promoted **Protests** to a name.
* **Sentence-initial capitals.** An earlier fix removed the first-position
  exclusion so a name leading its only headline would still be found. That
  traded one false negative for a class of false positives: every headline
  capitalises its opening word. "Govt targets 20,766 schools…" promoted
  **Govt**. Leading now counts only when a term leads more than one headline.

Thresholds were set against the corpus rather than by feel. At the obvious
"4+ content words, 75% capitalised" the title-case detector swallowed "These
are Ruto, Gachagua children" — four content words, three capitalised because
two are names and one opens the sentence — and that headline is the only
sentence-case sighting of **Gachagua**, so a real name was lost. Five words at
85% separates them.

The cost, stated: **Talanta** is no longer read as a name, because it appears
once and in a title-case headline. Its market still matches that story on two
terms (talanta *and* stadium), so nothing is lost in practice — and measured
against the live table, no correct link depended on a title-case-only name
while two wrong ones did.

**The pipeline had no retraction path**, which is why fixing the matcher alone
would have changed nothing: the cron upserts the links a batch produces and
never removes one, so both false links were permanent. `?rematch=1` on the
ingest route re-matches every stored article and **replaces** the link set. It
works day by day rather than over the whole table at once, because the
matcher's rules are explicitly properties of one day's news (`PROPER_NOUN_MAX_DF`
is an absolute cut, and feeding it a month would silently tighten it).

Run against production: **234 articles, 4 days, 36 markets → 6 links,
2 retracted.** Exactly the two diagnosed false positives, and nothing else.

**One is left standing, and it is the honest limit of the approach.** The
Ruto/Gachagua children listicle still scores highest (0.568) on
`["ruto", "gachagua"]`. The market asks whether the two *reconcile*; the story
shares both names and none of the event. A title-only bag-of-words matcher
cannot tell "mentions the same people" from "is about the same thing", and no
capitalisation rule reaches it. Worth naming as the next question rather than
papering over with a threshold — the threshold would have to exclude the
highest-scoring link in the table.

**No outright WCAG failure is known to be open.** B1's auto-rotating hero
(2.2.2 Pause, Stop, Hide) was the last one, and the three found while
verifying section J are fixed. That claim is only as good as its gates: axe
now scans the shell pages, the 44px rule is enforced on both axes, and the
focus gate no longer mistakes an animated ring for a missing one. E2's second
half and **F2/F3** remain, and share a blocker that is a product decision, not
a dependency: no date of birth is captured anywhere, and nothing stops an
unverified user funding an account.

---

## 3. How to work this

1. One section at a time, in the matrix's own order, money path first.
2. Measure before changing — the October work produced two false findings from
   an unverified audit script (a 9% background tint read as opaque; CSS Color 4
   `color(srgb …)` parsed as 0–255), and both would have been reported as
   defects. Colours are now normalised through a canvas.
3. Every ruling that carries a gate gets the gate, or it drifts back. A4 is the
   proof: a ruling with no gate was 58 controls out of compliance within weeks.
4. Re-measure Polymarket and Kalshi before trusting a competitor column. The
   September captures were already stale a month later: both had rebuilt the
   home hero into a split panel + live chart + ranked rails, and both had added
   an on-chart trade ticker that did not exist in the September DOM. K and L
   were measured fresh for that reason, on 2026-10-16.
5. **Ask what the gate cannot see.** Every K-section defect but one survived
   because the instrument had a blind spot, not because nobody looked: axe does
   not evaluate SVG text, so no chart label had ever been contrast-checked; C5
   asked colour-vs-background and nothing asked colour-vs-colour; B4 was
   verified on the markets where the auto-scale happens to return the fixed
   answer. Before recording a ruling closed, write down what its measurement
   would miss.
