# 42 — Where the element matrix actually stands, 2026-10-15

[40-ELEMENT-MATRIX](40-ELEMENT-MATRIX.md) is the canonical page-by-page,
element-by-element comparison (Polymarket × Kalshi × Kichiko → ruling). It holds
73 rulings across ten sections, A–J. [50-EXECUTION-LOG](50-EXECUTION-LOG.md)
records what was executed on 2026-09-27.

This file says which rulings are **live in the product today**, measured rather
than assumed, and what is still open. It exists because the October work drifted
into fixing whatever was tripped over — covers, news, the footer — instead of
walking the matrix. The matrix is the plan; this is its status.

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

### 2.2 A3 — money figures below the 7:1 floor

Measured on the market page, 390×844 light: **16 money figures between 4.56:1
and 5.23:1** `[M]`. All clear WCAG AA for text (4.5:1); all sit under the
stricter money floor this project set ([32] rule 6: money ≥7:1 and ΔY ≥0.80).

| element | ratio |
|---|---|
| Buy Yes price | 4.56:1 |
| Buy No price | 5.14:1 |
| Volume | 5.23:1 |

No plain-text failures remain, which matches the 0.4% figure in the original
audit. The gate the matrix asks for — extending `a11y-contrast.test.ts` to every
token pair used in the ticket — is still unwritten.

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

### 2.4 Section E — confirm, receipt, deposit, withdraw

E1–E5 are all `INVENT` and all open. E2 carries the strongest local evidence in
the whole document: **70% of Kenyan mobile-money losses are accidental sends**
(FinAccess 2024, n=20,871). Nothing has been built against it.

### 2.5 Remaining

A6 (focus rings + pixel-diff gate), A8 (2px spacing scale), A11 (JS budget —
we lead 9–10× but are over our own budget), A12 ("Breaking" → "New"), B1 (fixed
180px mobile cards; hero must not auto-rotate — **WCAG 2.2.2**), B3, C4, C6,
F2, F3, G2, and sections I and J.

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
