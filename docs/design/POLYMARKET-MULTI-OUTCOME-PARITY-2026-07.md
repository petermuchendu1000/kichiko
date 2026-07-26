# Polymarket Multi‑Outcome Parity — Element‑by‑Element Mapping (2026‑07)

Status: **Implementation in progress** · Owner: Platform Eng · Modules: 3.x (Markets Engine), 7.x (Trading), UI
Ground truth: the six reference captures of Polymarket's **“World Cup Winner”** event (desktop event page,
mobile event page, mobile Buy sheet ×2, mobile auth modal, mobile chart‑options sheet), archived with this PR.

This dossier is the **authoritative gap list** for reaching visual + functional parity with Polymarket on
multi‑outcome (and binary) markets. It supersedes the display/trading assumptions in
`POLYMARKET-KALSHI-PARITY.md` §2 with a concrete, current‑code, element‑by‑element audit and closes the
open questions there (per‑candidate Yes/No, settlement of No positions).

Legend: ✅ HAVE (at parity) · 🟡 PARTIAL (exists, not at parity) · ❌ MISSING · 🎯 target after this PR.

---

## 0. The decisive model fact (why “No” is missing)

Polymarket models a multi‑outcome event as **N independent binary lines** — each candidate has its own
`Yes`/`No` pair where `No = 100¢ − Yes`. A user may hold *Yes France* **and** *No England* at once. Per‑row
Yes prices need **not** sum to 100% (they’re independent books linked by neg‑risk arbitrage).

Kichiko ships **two** engines, both real and tested:

| | Simplex (`options_pricing_mode = 'simplex'`) | Independent (`= 'independent'`) |
|---|---|---|
| LMSR | one shared pool, `Σ price = 1` | one binary LMSR **per candidate** |
| Sides | **Yes only** (buy the option) | **Yes + No** per candidate |
| Buy RPC | `place_bet_option` | `place_bet_option_binary` |
| Resolve RPC | `resolve_market_options` | `resolve_market_options_binary` |
| Reproduces Polymarket screenshot? | **No** (no No button) | **Yes** |

All 22 live multi markets are `simplex`, and `flags.independent_options` does not exist in
`platform_settings` → the UI never takes the independent path → **no No buttons**. That is the whole gap.

**Blocker discovered in this audit:** even with the flag on and markets converted, **both** resolution
routes hard‑code the simplex resolver:
- `apps/web/app/api/markets/[id]/resolve/route.ts` → `resolve_market_options`
- `apps/web/app/api/admin/markets/[id]/action/route.ts` → `admin_resolve_market_options`

Neither dispatches to `resolve_market_options_binary`, so an independent market would let users **buy** No
but would **never pay** No holders at settlement (silent fund mis‑settlement). Fixing this dispatch is
**M‑B of this PR** and is a hard prerequisite for Phase 2 (live activation).

---

## 1. Desktop event page — element‑by‑element (Screenshot 1)

| # | Polymarket element | Kichiko today | Status | Target |
|---|---|---|---|---|
| 1.1 | Global top nav: logo · search · “How it works” · Log In · Sign Up · menu | header + search present | ✅ | keep |
| 1.2 | Horizontally‑scrolling category rail (Trending, World Cup, Combos, Breaking, Politics…) | `markets-controls` category filter (grid, not a scroll rail on detail) | 🟡 | add sticky scroll rail on detail |
| 1.3 | Event breadcrumb “Sports · Soccer” | `MarketHeader` shows category chip | 🟡 | add 2‑level category · subcategory |
| 1.4 | Event title + cover art + embed / copy‑link / bookmark actions | `MarketHeader` title + cover; share present | 🟡 | add **embed `</>`** + bookmark |
| 1.5 | Colored legend row (France 38.4% · Spain 20.9% · …) above chart | `outcomes-chart` legend exists | ✅ | match dot + % inline style |
| 1.6 | **Multi‑line** probability chart, one colored line per outcome, watermark, right‑side % axis | `price-chart` / `MarketPriceHistory` renders per‑option lines | ✅ | verify top‑N + “others” fold |
| 1.7 | Volume + resolution date row (`$4.17B Vol. · Jul 20, 2026`) | present in header/stats | ✅ | tabular‑nums, trophy icon |
| 1.8 | Timeframe tabs `1H 6H 1D 1W 1M ALL` + chart‑options gear | `price-chart` has ranges | 🟡 | add **6H**, gear → options |
| 1.9 | Candidate row: avatar · name · `$vol` · gift · **big %** · tiny ▲change · **Buy Yes ¢** · **Buy No ¢** | `candidate-list` row: avatar · name · vol · big % · **Yes ¢ only** (No only when `independent`) | 🟡→🎯 | **Yes + No on every row** |
| 1.10 | Per‑row 24h change chip (▲21%) | not shown per row | ❌ | add `change24h` per option |
| 1.11 | Sidebar sticky order ticket (see §3) | `pm-ticket` | 🟡 | see §3 |
| 1.12 | Related/promo card under ticket (“World Cup Odds & Predictions →”) | `related-markets` | ✅ | keep |

**1.9 is the flagship gap.** The row already computes `noCents = cents(o.noPrice ?? 1 − o.price)` and renders
a `dualPills()` block — but only when `independent` is true. Target: show Yes+No on every multi row.

---

## 2. Mobile event page + sheets (Screenshots 2, 3, 4, 6)

| # | Polymarket element | Kichiko today | Status | Target |
|---|---|---|---|---|
| 2.1 | Stacked single‑column layout, sticky bottom nav | responsive detail + `mobile-trade-bar` | ✅ | keep |
| 2.2 | Candidate row → **Buy Yes / Buy No** full‑width pair on mobile | `candidate-list` stacks `dualPills('stack')` **only when independent** | 🟡→🎯 | stack Yes+No on every row |
| 2.3 | Tap Yes/No → bottom **Buy sheet** with side badge “France · Yes ⇄” (swap side) | `mobile-trade-bar` opens sheet; side arrows present | 🟡 | add **⇄ side‑swap** affordance |
| 2.4 | Sheet order‑type popover **Market / Limit** | ticket has Market/Limit (binary + independent) | 🟡 | expose on multi rows |
| 2.5 | Shares stepper + presets `-100 -10 +10 +100 +200` | preset chips present | ✅ | match labels/signs |
| 2.6 | Live **“200.00 matching”** liquidity hint | not shown | ❌ | add depth/matching hint |
| 2.7 | `Expires Never ▾` · `Total` · `To win` (green) | present in ticket | ✅ | match `To win` emphasis |
| 2.8 | Chart‑options sheet: Autoscale, X/Y‑Axis, H/V‑Grid, Annotations toggles + Embed | gear exists, no toggles sheet | ❌ | add chart‑options sheet |

---

## 3. Order ticket — element‑by‑element (Screenshots 1, 3, 4)

Reference selection context: **France · Yes**, Buy, Limit, Yes 38.4¢ / No 61.7¢.

| # | Polymarket element | Kichiko (`pm-ticket.tsx`) | Status | Target |
|---|---|---|---|---|
| 3.1 | Context header: outcome avatar + market title + `Candidate · Side` | present (`indepMulti` shows side) | 🟡 | show side for **all** multi |
| 3.2 | **Buy / Sell** tabs | Buy present; **Sell disabled** (no sell endpoint) | 🟡 | Sell = separate roadmap |
| 3.3 | **Market / Limit** dropdown | present (binary + independent) | 🟡 | enable for all multi |
| 3.4 | **Yes ¢ / No ¢** side pills (green/gray) | shown for binary + independent; **hidden for simplex multi** | 🟡→🎯 | show for all multi |
| 3.5 | Limit price stepper `− ¢ +` | present | ✅ | keep |
| 3.6 | Shares input + preset chips | present | ✅ | keep |
| 3.7 | `Expires` selector | present | ✅ | keep |
| 3.8 | `Total` (cost) + `To win` (payout, green) | present, slippage‑aware preview == execution | ✅ | keep |
| 3.9 | Primary **Trade** CTA + Terms line | present | ✅ | keep |
| 3.10 | Unauth → auth modal on Trade (Screenshot 5) | auth gate present | ✅ | keep |

The `pm-ticket` already syncs from the `kichiko:select-option` window event carrying `{ optionId, side }`.
When simplex rows begin emitting a `side`, the ticket needs a **complement‑priced No path for simplex**
(see §4) rather than routing to `place_bet_option_binary`.

---

## 4. Engine decision — how “No” works for a mutually‑exclusive market

Two faithful options were considered:

**Option A — flip live multi markets to `independent` (chosen).**
Each candidate becomes its own Yes/No binary line, exactly like Polymarket. Pros: 100% code already built
and tested (`place_bet_option_binary`, `resolve_market_options_binary`, side‑aware positions, independent
UI). No new engine math. Reversible per‑market. Cons: per‑row Yes prices drift from Σ=100% (this is
**also true on Polymarket** — acceptable and faithful).

**Option B — add a complement‑No to the simplex engine.** Buying *No France* ≡ buying the basket of all
other outcomes, priced `1 − p_France`, repricing siblings up. Pros: keeps Σ=100%. Cons: new RPC + resolution
math + new tests; higher risk; not needed since Polymarket itself doesn’t enforce Σ=100%.

**Decision: Option A.** It is the team’s already‑approved Phase C direction and the lowest‑risk path to true
parity. This PR completes the one missing piece (settlement dispatch) so Option A is safe to activate.

Settlement semantics (`resolve_market_options_binary`, already in migration 023): a position wins iff
`(option = winner AND side = 'yes') OR (option ≠ winner AND side = 'no')` — i.e. **No holders of every losing
candidate are paid**, winning‑candidate No holders and losing‑candidate Yes holders forfeit. This is exactly
Polymarket’s payoff.

---

## 5. Implementation milestones (this PR + follow‑ups)

- **M‑A** ✅ this dossier + screenshot archive.
- **M‑B** 🎯 Resolution dispatch fix: both resolve routes select the resolver by `options_pricing_mode`
  (`independent → *_binary`), plus `admin_resolve_market_options_binary` capability wrapper (migration 027).
  Unit + integration coverage. **Hard prerequisite for activation.**
- **M‑C** 🎯 `candidate-list`: show Yes+No on **every** multi row (not just `independent`), with No priced
  from the option’s `no_price` (independent) or `1 − price` (simplex fallback while transitioning).
- **M‑D** 🎯 `pm-ticket` + `mobile-trade-bar`: side‑aware for all multi; ⇄ side‑swap; Market/Limit on multi.
- **M‑E** (follow‑up) per‑row 24h change, matching/depth hint, chart‑options sheet, embed action.
- **Phase 2** (separate, gated on M‑B green in CI + explicit approval): enable `flags.independent_options`
  and convert the 22 live multi markets with `set_market_pricing_independent()`.

## 6. Rollback

Per‑market: `UPDATE markets SET options_pricing_mode='simplex'` (q_shares/price untouched) and/or flip
`flags.independent_options` off — instant, no redeploy, no schema revert. M‑B is additive (new dispatch +
new wrapper RPC) and safe for simplex markets (unchanged path).

---

## 7. Activation record — 2026‑07‑11 (Phase 2 executed)

- Merged M‑A + M‑B to `main` (PR #6, squash `5d3f4ce`) with all blocking CI checks green
  (lint · type‑check · unit 534 · build · migration‑lint · security · i18n · a11y).
- Migration `027` applied to the live DB.
- `platform_settings.flags.independent_options` = `true`.
- All **22** active `multiple_choice` markets converted with `set_market_pricing_independent()`.
  Existing per‑option `yes_price`/`no_price` were already seeded from the simplex `price`
  (`Σ yes = 1.0`), so probabilities were **preserved** (e.g. Ruto stays 44¢ Yes / 56¢ No) — not reset to 50/50.
- End‑to‑end verification (single transaction, **rolled back** — nothing persisted): bought **No** on a
  5% candidate → resolved a different winner → the No holder was **paid** (`total_won` credited),
  proving `place_bet_option_binary` + the new resolver dispatch settle No positions correctly.

**Rollback SQL** (pre‑conversion state snapshotted to `phase2_pre_conversion_snapshot.json`):
```sql
-- kill‑switch (instant, no redeploy):
UPDATE platform_settings SET value='false'::jsonb WHERE key='flags.independent_options';
-- or per‑market revert (prices/q untouched):
UPDATE markets SET options_pricing_mode='simplex'
WHERE resolution_type='multiple_choice';
```

### Remaining parity polish (follow‑up PRs, not blockers)
Per §1.10 / §2 / §3: per‑row 24h change chip, live matching/depth hint, chart‑options sheet, embed action,
`⇄` side‑swap affordance on mobile, category scroll rail on detail. Tracked as **M‑E**.
