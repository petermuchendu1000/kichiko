# 42 — Where the element matrix actually stands, 2026-10-15

[40-ELEMENT-MATRIX](40-ELEMENT-MATRIX.md) is the canonical page-by-page,
element-by-element comparison (Polymarket × Kalshi × Elopis → ruling). It holds
73 rulings across ten sections, A–J. [50-EXECUTION-LOG](50-EXECUTION-LOG.md)
records what was executed on 2026-09-27.

This file says which rulings are **live in the product today**, measured rather
than assumed, and what is still open. It exists because the October work drifted
into fixing whatever was tripped over — covers, news, the footer — instead of
walking the matrix. The matrix is the plan; this is its status.

Sections A–E, G, I and J have now been worked end to end. Of the three claims
this file still carries that are NOT measured against the running app, each
says so where it appears: C6's banner (no market has resolved anywhere), I4's
telephone outreach (a commitment the business has not made), and the rulings
marked `L`, which are taken from the execution log and have not been
re-measured since.

**Evidence grades.** `M` measured by me on 2026-10-15 against the running app ·
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
| C5 | Chart series colours ≥3:1 both themes | done | V — `--chart-yes/no/brand`, contrast-verified |
| A4 | **Every control ≥44×44 on money routes** | **done + gated** | M |
| B4 | Fixed 0–100% axis, default All, no dead ranges | done | M |
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

### 2.9 Remaining

F2/F3 (below); A11's one over-budget route (`/markets/[slug]`, 257 kB against
a 130 kB budget — splitting the ticket and the chart is work in its own
right); H2's decision on an opt-in accuracy board to replace the profit
leaderboard H1 removed; and I4's calls, which are a commitment rather than a
commit.

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
4. Re-measure Polymarket and Kalshi before trusting a competitor column — the
   captures are from 2026-09-27.
