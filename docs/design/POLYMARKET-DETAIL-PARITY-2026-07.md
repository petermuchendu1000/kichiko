# Polymarket → Kichiko — Market Detail Parity Dossier (2026-07)

### Research → element-by-element teardown → gap analysis → build plan
**Reference captured live (2026-07-09):** Polymarket market-detail pages rendered at 1440px in headless Chromium and studied pixel-by-pixel:
- Binary/multi (live ticket + order book): `/event/fed-decision-in-july-181`
- BTC 5-minute Up/Down (resolved): `/event/btc-updown-5m-1783639800`
- Multi-outcome index: `/event/world-cup-winner`

**Our current pages rendered for the same viewport:**
- Binary: `/markets/ke-ruto-reelection-2027`
- Multi-outcome: `/markets/ke-2027-president`

> Directive: match Polymarket **element by element, feature by feature**, precisely — while
> keeping our LMSR trading economics (`lib/trading.previewBet` → `place_bet`) as the source of
> truth and staying on our token system (light + dark, WCAG AA+). Deploy ≠ release: gate the
> new ticket behind a feature flag.

---

## 1. Anatomy of the Polymarket market-detail page (observed)

### 1.1 Global chrome
| Element | Polymarket | Notes |
| --- | --- | --- |
| Top bar | Logo · Search (full-width, "Search polymarkets…") · "How it works" (info, blue) · Log In · **Sign Up** (blue) · hamburger | Light, hairline bottom border |
| Category rail | Trending · World Cup · Combos · Breaking ‖ Politics · Sports · Crypto · … · `›` | Active item gold/underlined; horizontally scrollable |

### 1.2 Header (left column, above chart)
1. **Square market avatar** ~64px, rounded, image or entity glyph.
2. **Category breadcrumb** — small, gray: `Economy · Fomc`.
3. **Title** — 28–32px, bold, single line where possible.
4. **Action icons** (top-right of header): `</>` embed · link/share · bookmark.

### 1.3 Chart block (the visual centrepiece — always present)
- **Sub-market/date chips** top-left: `Past ▾`, `Jul 29` (active/black pill), `Sep 16`, `Oct 28`.
- **Legend row**: colored dot + label + **current %** per series (`No change 85%`, `25 bps increase 14.7%`, …).
- **Faint "Polymarket" watermark** inside plot.
- **Multi-line** area/line chart; **right-hand Y axis** at 0/25/50/75/100%.
- **X axis** month/time ticks; a **clock toggle** at the right end.
- **Footer strip**: `🏆 $48,406,746 Vol.` · `🕐 Jul 29, 2026` (left); range toggles `1H 6H 1D 1W 1M ALL` + sort + gear (right).

### 1.4 Order-book / outcome rows (multi-outcome)
Each row = one outcome:
- **Left**: outcome name (bold) + `$X Vol.` (muted) + optional gift glyph.
- **Center**: large **%** + colored delta (`▲10%` green / `▼16%` red).
- **Right**: **`Buy Yes 85¢`** (green tint) and **`Buy No 16¢`** (red/pink tint) buttons.

Binary markets collapse to a single Yes/No pair driving the ticket.

### 1.5 Rules / Market Context
- Tabbed: **Rules** | **Market Context**.
- Body paragraphs + inline resolution-source link + **`Show more`** truncation.

### 1.6 Comments block
- Tabs: **Comments (N)** | **Top Holders** | **Positions** | **Activity**.
- Composer: input + emoji + image + **Post**.
- Controls: sort `Newest ▾`, `Holders` filter, "Beware of external links" pill.
- Items: avatar · username · timestamp · body · like count · replies · `…` menu.

### 1.7 FAQ + footer
- Auto-generated **FAQ accordion** ("What is …", "How do I trade …", "How will … be resolved?").
- Rich footer: logo, tagline, Related topics, Popular/New markets, socials, legal, locale.

### 1.8 Right rail — the trading ticket (core)
```
┌──────────────────────────────┐
│ [icon] Fed Decision in July?  │  ← context: market + selected outcome (green)
│        50+ bps decrease · Yes │
│ Buy   Sell           Market ▾ │  ← mode tabs + order-type dropdown
│ ┌ Yes 0.2¢ ┐ ┌ No 99.9¢ ┐    │  ← side pills w/ ¢ price
│ Amount               $0       │  ← label + big live figure
│ [+$1][+$5][+$10][+$100]       │  ← quick-add chips
│ [      Trade (blue)       ]   │
│ By trading, you agree to Terms│
└──────────────────────────────┘
```
Plus below the ticket: promo card + a filtered "related markets" mini-list.

---

## 2. Our current page (observed) — deltas vs Polymarket

| Area | Ours today | Polymarket | Action |
| --- | --- | --- | --- |
| Theme default | Dark | Light | Keep both; ensure light matches PM's paper-white centrepiece |
| Header | Category + Open + Trending badges + hashtags + big "46% chance YES" | avatar + tiny category + title + action icons | **Rebuild** to PM identity strip; move probability into chart legend/rows |
| Chart | Empty "No price history yet" | Always-on multi-line w/ legend, vol, presets, watermark | **Rebuild**: never blank — seed baseline, add legend/vol footer/presets `1H 6H 1D 1W 1M ALL` |
| Outcome rows | In `CandidateList` (Yes/No), separate | Inline order-book rows w/ vol + delta + Buy Yes/Buy No | Align styling: add `$Vol`, delta chip, `Buy Yes ¢ / Buy No ¢` |
| Ticket | Guided 2-step "How much?" (stake + slider) | Buy/Sell · Market/Limit · Yes/No ¢ pills · Amount · +$ chips · Trade | **New PM-style ticket** behind `flags.pm_ticket`, wired to `previewBet`/`place_bet` |
| Rules | Single "Resolution rules" card | Rules / Market Context tabs + Show more | Add tabs + truncation |
| Comments | "Discussion (N)" only | Comments / Top Holders / Positions / Activity tabs | Add Top Holders / Positions / Activity tabs |
| FAQ | none | Auto FAQ accordion (SEO) | Add JSON-LD `FAQPage` + accordion |
| Stats strip | In Contract specs card | Vol under chart + specs | Keep specs; surface Vol on chart footer |

---

## 3. Build plan (incremental, CI-gated, flag-guarded)

Each is one sub-milestone → commit → CI (type-check + build + tests) → merge to `main`.

- **M1** — this dossier (docs only). ✅ safe baseline commit; validates push + CI.
- **M2** — Chart parity: `PriceChart`/`OutcomesChart` never blank; legend w/ live %, vol + date footer, `1H 6H 1D 1W 1M ALL` presets, faint watermark, right-axis %.
- **M3** — Header parity: avatar + category breadcrumb + title + embed/share/bookmark actions; probability demoted into chart/rows.
- **M4** — Order-book rows: `$Vol`, delta chip, `Buy Yes ¢ / Buy No ¢` styling; click pre-arms ticket.
- **M5** — PM-style ticket (`flags.pm_ticket`): Buy/Sell, Market/Limit, Yes/No ¢ pills, Amount + big figure, +$ chips, Trade — all numbers from `previewBet`; falls back to guided flow when flag off.
- **M6** — Rules/Market-Context tabs + Show more.
- **M7** — Comments tabs (Comments / Top Holders / Positions / Activity) backed by `positions`/`orders`/`market_activity`.
- **M8** — FAQ accordion + `FAQPage` JSON-LD.
- **M9** — Full-page a11y + light/dark + Lighthouse/perf pass; visual diff vs reference.

### Non-negotiables carried from the Pip dossier
Tokens only · no lucide/emoji as UI · trading numbers equal `place_bet` · SSR-crawlable · skeletons (no CLS) · `tsc --noEmit` clean · `next build` green · no dead-end states.
