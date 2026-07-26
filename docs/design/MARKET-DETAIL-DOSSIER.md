# Kichiko — Market Detail + Trading (`/markets/[slug]`) Design Dossier
### Research → Requirements → IA → Flow → Wireframe → Component spec → Review gates
**Prepared by:** Product Design Org (Principal PD · UX · Design Systems · Frontend Arch · Visual · Brand · A11y · SEO · Perf · Sr. Eng)
**Status:** Phase 1 — spec complete, implemented against the "Pip" system (`docs/design/LANDING-PAGE-DOSSIER.md`).

---

## 0. Why this page is being rebuilt

The shipped `/markets/[slug]` was functional but never ported to the Pip system. Audit findings:

- **Off-system styling:** generic Tailwind primitives (`bg-card`, `text-muted-foreground`, `rounded-2xl border`, `container`) instead of design tokens — clashes with the landing and the (already-rebuilt) markets discovery page.
- **Emoji as UI language:** `📈 Probability History`, `⚡ Recent Activity`, `📋 Resolution Criteria`, `📊 Market Stats`, plus `🟢/🟡/⚪/✅/❌` in the header — violates the no-emoji rule the rest of the app follows (custom `Icon*` / `CategoryIcon` exist and were unused here).
- **Forbidden icon set:** `market-header.tsx` imported **lucide-react** (`Share2`, `Bookmark`, `ExternalLink`), explicitly banned by the quality bar.
- **Legacy classes:** header used `price-bar` / `price-bar-yes`, which are not in the Pip stylesheet (the tokens are `.prob-bar` / `.prob-bar-fill`) — a latent rendering bug.
- **Trading correctness gap (most important):** the order ticket estimated `shares ≈ amount / price` and `payout = amount/price · (1 − 0.02)`. This ignores **LMSR slippage**, the **creator-reward split**, currency→USD conversion, and the **$0.10 minimum**. The trading module's entire premise (`docs/07-TRADING.md`) is that `lib/trading.previewBet` mirrors the authoritative `place_bet` RPC exactly — the UI must use it so the preview equals on-chain execution.

---

## 1. Requirements

**User goals.** Understand the claim and its odds → judge credibility (rules, source, fees) → size and place a trade with confidence → track it.

**Functional**
- Live YES/NO probability, price history chart, recent activity, comments, related markets.
- Order ticket: side toggle, amount + presets, **slippage-aware** preview (shares, avg fill, price impact, fee, max payout), min-bet guard, balance guard, auth gate, success receipt.
- Contract specs + settlement rules + fees surfaced **inline** (Kalshi credibility model).
- Market **state machine** reflected everywhere: `draft → pending → active → closed → resolved | disputed | cancelled` (`resolved`/`cancelled` terminal).

**Non-functional**
- Tokens only (no magic values); light + dark. WCAG AA+ (focus, contrast, SR labels, semantic `dl`/`section`/`h1`).
- SSR-crawlable; dynamic metadata + JSON-LD. Skeletons for streamed sections (no CLS). `tsc --noEmit` clean, `next build` green, no new deps.

---

## 2. Information architecture

```
/markets/[slug]
├─ Breadcrumb → /markets
├─ Main (lg:col-span-2)
│  ├─ MarketHeader        identity · status badge · live probability · provenance · share/source
│  ├─ Probability history (streamed, Suspense)
│  ├─ Recent activity     (streamed, Suspense)
│  └─ Comments
└─ Sidebar (sticky lg:top-20)
   ├─ Order ticket (BettingPanel)   ← previewBet, state-aware
   ├─ Resolution rules              criteria + source
   └─ Contract specs                type · volume · liquidity · bets · traders · closes · resolves · fee · creator reward
Related markets (full-width)
```

Split layout matches the reference pattern (chart/rules/activity left, sticky ticket right) [avark.agency/prediction-market-design-patterns].

---

## 3. Component spec (Pip system)

| Element | Tokens / classes |
| --- | --- |
| Cards | `.card` (+ `.card-hover` on related) |
| Status badge | `.badge` + `badge-green` (Open) / `badge-amber` (Pending, Awaiting resolution) / `badge-red` (Disputed) / `badge-muted` (Draft, Resolved, Cancelled) |
| Probability | `font-mono` numerals, `.prob-bar` / `.prob-bar-fill`, `text-yes` |
| Side toggle | `.btn-yes` / `.btn-no` (`.active`), `¢` prices in `font-mono` |
| Amount | `.input.input-lg` + preset chips (`bg-pip-100 text-pip-500` active) |
| Preview | `dl` in `bg-surface-2` + `.divider`; `text-yes`/`text-no` payout |
| Icons | custom `IconTrendUp/Clock/Info/Shield/Share/ExternalLink/ChevronLeft`, `CategoryIcon` — **no lucide, no emoji** |
| Section headings | icon chip `bg-pip-100 text-pip-500` + `text-text-secondary` |

**Trading economics (source of truth = `lib/trading.previewBet`).** Converts local→USD at live `useRates`, applies `platform_fee_rate` + `creator_reward_rate`, runs the net stake through the numerically-stable LMSR inverse (`sharesForBudget`) for shares, avg fill and marginal price after. Preview shows: est. shares · avg fill price · **price impact (avg − marginal, in pts)** · fee · max payout (+profit %). `meetsMinBet` enforces the $0.10 floor in the user's currency.

**State-machine behaviour.** Only `active` accepts orders; every other state shows tailored, non-dead-end copy (pending/draft/closed/resolved/disputed/cancelled). Resolved markets render the winning outcome in the header.

---

## 4. Review gates

- [ ] **Design:** on-system (tokens only), no emoji, no lucide, no magic values; light + dark.
- [ ] **A11y:** keyboard-reachable toggle/presets/input/submit with visible focus; `aria-pressed` on side toggle; `dl` semantics; SR labels; contrast AA+.
- [ ] **Trading parity:** preview numbers equal `place_bet` (fee split, LMSR shares, avg fill, min-bet, FX) per `docs/07-TRADING.md`.
- [ ] **States:** loading (skeleton, no CLS), each market status, 0-activity / 0-comments, not-found (404).
- [ ] **SEO:** dynamic title/description/OG/Twitter + JSON-LD `Question`; SSR markup crawlable.
- [ ] **Perf/build:** `tsc --noEmit` clean · `next build` green · no new deps.

> Verification note: the full Next build + `tsc` + vitest gate runs in CI on the PR — the working sandbox validated TSX syntax via esbuild only.
