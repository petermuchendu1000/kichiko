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

## 2. Open, in priority order

### 2.1 C3 — resolution source is missing on every market (BINDING)

**All 36 active markets have `resolution_source` NULL** `[DB]`. Close times and
resolution criteria are present; the independent authority that decides the
outcome is not, on any market.

The UI already renders it (`market-rules.tsx`, `contract-specs.tsx` both take a
`resolutionSource` prop and link it) — the data was simply never populated.

The matrix marks C3 **BINDING**: L.N. 112 Reg. 45(1) and 23(1) (rules available
before the wager) and Reg. 45(6) (an independent, approved resolution
mechanism). This is the largest open gap in the product and it is not a design
question.

Most markets have an obvious authority, and it is usually the body already on
the cover after the October imagery work — IEBC for elections, CAF for AFCON,
CBK for rates and FX, KNBS for inflation, the Met Department for weather. That
mapping is a starting point, **not** something to write unreviewed: each value
asserts who decides where real money goes.

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

### 2.3 Section D — the money path, largely untouched

D1 (URL-encoded ticket state), D2 (no pre-selected side), D5 (the three-line
`You pay / If Yes / If No` block, BINDING), D6 (fee as a visible KSh line), D7
(inline validation), D8 (pressed state), D9 (`shares` still rendered `[M]`),
D10 (limit price in %), D11 (return to ticket after auth).

D5 and D6 are the two that change what a person understands before committing
money, and D6 has the strongest evidence behind it of anything in the matrix
(all-in pricing, StubHub field experiment).

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
