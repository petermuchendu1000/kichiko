# Kichiko — Markets Discovery Page (`/markets`) Design Dossier
### Research → Requirements → IA → Flow → Wireframe → Component spec → Review gates
**Prepared by:** Product Design Org (Principal PD · UX · Design Systems · Frontend Arch · Visual · Brand · A11y · SEO · Perf · Sr. Eng)
**Status:** Phase 1 — spec complete, implemented against the "Pip" system (`docs/design/LANDING-PAGE-DOSSIER.md`).

---

## 0. Why this page is being rebuilt

The shipped `/markets` was never ported to the Pip system. Audit findings:

- **Off-system styling:** generic Tailwind primitives (`bg-primary`, `text-muted-foreground`, `rounded-xl`, `container`, `text-2xl font-black`) instead of design tokens — clashes with the landing.
- **Emoji as UI language:** 🔮 empty-state, 📊/🆕/⏰/👥 sort labels, ⚡ "All" category — violates the no-emoji rule the rest of the app follows (custom `CategoryIcon` exists and is unused here).
- **A broken control:** `SortDropdown` is a static `<a href="?sort=…">` that drops every other active filter; its own comment admits "Client component needed in production."
- **Two divergent implementations:** a server `page.tsx` (queries the `markets` table directly, no full-text ranking) and a client `markets-grid.tsx` (hits `/api/search`, load-more) — inconsistent behavior and duplicated logic.
- **No SEO surface:** no dynamic per-filter metadata, no structured data.

## 1. Competitive research (synthesized, then improved)

- **Polymarket — card feed.** Market card is the atomic nav unit: prominent probability, category, volume, time-left. Onboarding-friendly; weak for multi-market scanning. Heavy client app → poor crawlability.
- **Kalshi — broker grid.** Category-driven browse, visible contract specs, status filters, professional density; regulation cues build trust. Can feel dense for newcomers.
- **Aggregators (Kalshi+Polymarket unified grids).** Confirm the winning filter taxonomy: **Status** (Open/Closed/Resolved/All), **Category**, **Sort** (price/volume/liquidity/expiry), keyword search, and **responsive 1-col → 2-col → dense grid**. (Sources: avark.agency prediction-market patterns; previa unified grid; alphascope research UX.)

**Where Kichiko improves on all three**
1. **Content-first server render.** Competitors are client SPAs; our grid is server-rendered through the same `search_markets` RPC — instant FCP, fully crawlable, no client fetch waterfall.
2. **URL-as-state.** Every filter combination is a shareable, bookmarkable, back-button-correct URL. Filters compose (never reset each other) — directly fixing the old `SortDropdown` bug.
3. **One calm system.** Custom `CategoryIcon` (no emoji), tokenized YES/NO semantics, restrained motion, skeleton streaming — reads Bloomberg×Stripe, not casino.
4. **Trust legibility.** Result count + active-filter summary + one-tap clear; honest empty/loading/edge states.

## 2. Requirements & user goals

**Primary user goal:** "Find a market I want to trade, fast, and understand it at a glance."
- Browse everything; narrow by category; filter by lifecycle (open vs resolved); sort by what matters (volume, closing soon, newest, most traders, relevance when searching); search by keyword; page through results; open a market.

**Functional requirements**
- Server-render the filtered/sorted/paginated set via `search_markets` (q, category, status, sort, limit, offset).
- All state lives in the URL (`?q&category&status&sort&page`), validated by `lib/search.ts` (safe, bounded).
- 24 results/page; accessible pagination.
- Dynamic SEO metadata per category/query; JSON-LD `ItemList`.

**Non-functional:** WCAG AA+, CWV budget (no CLS from cards; skeletons reserve space), dark+light, keyboard + SR verified, tokens-only, zero new deps, `tsc` clean.

## 3. Information architecture

```
/markets
├─ Page header      … H1 "Markets" + one-line purpose + "Create market" CTA
├─ Controls (client island, writes URL)
│   ├─ Search (debounced)      → ?q
│   ├─ Status segmented        → ?status = active|resolved|all
│   └─ Sort select             → ?sort  = relevance|volume|newest|closing|bettors
├─ Category rail (client island, writes URL) → ?category
├─ Results meta   … "N markets" · active-filter summary · Clear all
├─ Grid           … MarketCard × N   (server-rendered; 1→2→3→4 cols)
│   └─ Empty state (on-brand, reset action)
└─ Pagination     … Prev · numbered window · Next  (?page)  [server links]
```

## 4. User flow

Land → (optional) pick category chip → (optional) set status/sort → (optional) type query (debounced, URL updates, grid streams) → scan cards → click card → market detail. Back button restores exact filter state (URL-driven). Deep links (e.g. `/markets?category=politics&sort=closing`) render server-side, crawlable.

## 5. Wireframe (desktop ≥ md)

```
┌───────────────────────────────────────────────────────────────┐
│  Markets                                   [ + Create market ]  │
│  Read live probabilities across every domain.                   │
├───────────────────────────────────────────────────────────────┤
│  [🔍 Search markets…            ]   [ Open | Resolved | All ]  [Sort ▾] │
│  ‹  All  Politics  Economy  Sports  Crypto  Tech  …  ›          │
├───────────────────────────────────────────────────────────────┤
│  128 markets · Politics · Closing soon            Clear all     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                    │
│  │ card   │ │ card   │ │ card   │ │ card   │   (MarketCard)      │
│  └────────┘ └────────┘ └────────┘ └────────┘                    │
│                    ‹ Prev   1 2 3 … 6   Next ›                   │
└───────────────────────────────────────────────────────────────┘
```
Mobile: search full-width; status + sort on a second row; category rail horizontally scrollable (existing pattern); grid 1-col.

## 6. Component specification

- **`app/markets/page.tsx`** (server, `force-dynamic`) — parse+validate URL via `lib/search.ts`, call `search_markets`, render header + controls + rail + meta + grid + pagination + JSON-LD. `generateMetadata` sets title/description per category/query. Results wrapped in `<Suspense>` keyed on the serialized params so skeletons stream on navigation.
- **`MarketsControls`** (new client island) — search input (300 ms debounce), status segmented control, sort `<select>`; all write the URL via `router.replace`, resetting `page` to 1; tokens-only; labelled for SR.
- **`CategoryFilter`** (rebuilt, token-only) — custom `CategoryIcon` instead of emoji; `.tab-pill` active state; scrollable rail with arrow affordances; preserves its existing controlled/URL-driven API (used by `markets-grid` too).
- **`MarketCard`** — reused unchanged (already Pip-system, shared with the landing — no regression).
- **`MarketCardSkeleton`** — standalone file realigned to the `card` token style (was `rounded-2xl bg-card`) to match the live card and prevent CLS.
- **Pagination** — server-rendered `<Link>`s, `aria-current`, prev/next, windowed numbers; preserves all params.

## 7. Review gates (must pass)

- [ ] Would Stripe/Kalshi ship this? Density, hierarchy, restraint.
- [ ] Every filter composes; URL is the single source of truth; back button correct.
- [ ] No emoji; custom iconography only; tokens-only (no magic values); light+dark.
- [ ] Keyboard: search, segmented, sort, chips, cards, pagination all reachable with visible focus; SR labels present.
- [ ] Loading (skeleton, no CLS), empty (on-brand + reset), edge (0 results, 1 market, last page) states handled.
- [ ] SEO: dynamic title/description + JSON-LD `ItemList`; server-rendered markup crawlable.
- [ ] `tsc --noEmit` clean; `next build` green; no new deps.
