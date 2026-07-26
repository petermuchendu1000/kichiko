# Polymarket / Kalshi Parity — Betting Flow, Multi-Outcome Markets & Option Avatars

Status: **Design approved for phased implementation** · Owner: Platform Eng · Modules: 3.x (Markets Engine), 7.x (Trading), Media
Supersedes the "pick-one-option" assumption baked into `020_multi_outcome_markets.sql` for the *display + trading* layer. The storage engine evolves in phases (§6) with the binary path never breaking.

This dossier is the source of truth for reaching visual + functional parity with Polymarket and Kalshi on:
1. **Per-option (candidate/entity) avatars** — the photos/logos every option carries.
2. **The multi-outcome market page + betting flow** — the "each candidate is its own Yes/No line" layout in the attached references.

---

## 0. What the reference images show (ground truth)

- **Image 1 — ranked option list with avatars.** A vertical, numbered ranking (1..N) where every row leads with a small square/circle avatar (a person's photo, a split-colour placeholder for the not-yet-imaged). A sticky `All / …` filter chip sits on top. Takeaway: **avatars are mandatory per option**, and there is a **deterministic placeholder** (the split colour block) when no photo exists — exactly our monogram slot.
- **Image 2 — Kalshi multi-candidate market.** Each candidate is a **self-contained row**: portrait avatar · name · one-line subtitle (role) · a bold **standalone probability %** on the right · and **two price buttons underneath — `Yes 48¢` (green) and `No 54¢` (red)**. Rows are separated by hairlines; a header carries sort / search / filter controls. Critically, **each candidate is an independent Yes/No line** — the percentages do NOT sum to 100% across rows, because each row is its own binary market.

The gap between Image 2 and Kichiko today is architectural, not cosmetic — see §2.

---

## 1. How Polymarket & Kalshi actually model these markets

| Concept | Polymarket | Kalshi | Kichiko today |
|---|---|---|---|
| Grouping | **Event** = group of related **markets** | **Event/Series** groups **markets** | Single `markets` row |
| A "candidate" | Its **own binary market** (Yes/No ERC1155 pair) | Its **own binary contract** | A `market_options` row (mutually exclusive) |
| Probabilities | Per-candidate, **independent** (Σ ≠ 100%) | Per-candidate, independent | Options **sum to 1** (simplex) |
| Trade a candidate | Buy **Yes** or **No** on that candidate | Buy **Yes** or **No** | Buy the option (one side only) |
| Resolution | Each sub-market resolves Yes/No; event may be "one winner" | Same | Exactly one winning option |
| Liquidity | CLOB order book per market | CLOB per market | LMSR per market / per option pool |

**The decisive difference:** on Polymarket/Kalshi a multi-candidate market is a **collection of independent binary lines**, so a user can hold `Yes Trump` *and* `No Biden` simultaneously, and each line has a full Yes/No two-sided book. Kichiko models it as one probability simplex where you pick a single winner. Both are valid market designs, but **only the event→binary-lines model reproduces Image 2**.

---

## 2. Full feature inventory — HAVE / PARTIAL / MISSING

### 2.1 Market discovery (cards, grid, ticker)
- ✅ HAVE: category filter, market cards, front-runner on multi cards, skeletons, ticker.
- ⚠️ PARTIAL: option avatars on cards (monogram only — no real photos yet).
- ❌ MISSING: "event card" that previews the top 2–3 candidate lines with mini Yes/No, like Polymarket's grouped cards.

### 2.2 Multi-outcome market detail (the Image-2 page)
- ✅ HAVE: option list, per-option probability, single order ticket, price/outcomes charts, activity, comments, related.
- ⚠️ PARTIAL: option rows show `label + ¢` but **no Yes/No pair per row**, **no per-option chart**, **no subtitle/role line**, **no real avatar**.
- ❌ MISSING (parity blockers):
  1. **Per-candidate Yes/No buy affordance** on each row (Image 2's `Yes 48¢ / No 54¢`).
  2. **Independent per-candidate probability** (requires engine change §6).
  3. **Row expand → inline order ticket / mini price history** (Polymarket accordion).
  4. **Candidate subtitle** (role/description) + **candidate avatar** (photo/logo).
  5. **Sort controls** on the option list (by probability, volume, A–Z, recent) — Image 2 header.
  6. **Search within options** for large fields (e.g. "who wins the election" with 20+ names).
  7. **Volume / 24h change** per candidate row.

### 2.3 Order ticket / betting flow
- ✅ HAVE: BUY/SELL tabs, $/contracts toggle, Market/Limit (binary), presets, slippage-aware preview = execution, fee line, reward-forward CTA, deposit hand-off, success receipt, mobile sticky bar + bottom sheet.
- ⚠️ PARTIAL: SELL disabled (no sell endpoint), Limit only on binary, no order book depth.
- ❌ MISSING: sell/close position, per-option limit orders, order-book/depth view (Polymarket pro), position-aware ticket ("You own 12 Yes — sell?").

### 2.4 Option / entity avatars (this dossier's first ask)
- ✅ HAVE: `EntityAvatar` primitive + deterministic `monogram()` fallback (Layers 1 & 3 of ENTITY-IMAGERY).
- ❌ MISSING (shipping now — §4):
  1. `market_options.image_url` column (+ entity metadata).
  2. Ingestion pipeline (resolve → normalise → store to Supabase Storage → persist URL).
  3. Backfill of the 22 existing multi-choice markets (people → Wikipedia, orgs → Brandfetch).
  4. Create-wizard: per-option image (auto-suggest + manual URL/upload).
  5. Real avatars rendered on cards, option rows, order ticket, portfolio.

---

## 3. Target UX for the multi-outcome page (replicating Image 2, improved)

Layout (desktop 2-col; mobile single col + sticky trade bar):

```
┌ Market header (title, category, volume, closes, ⋯) ─────────────┐
│                                                                 │
│  ┌ Candidates list ───────────────┐   ┌ Order ticket (sticky) ┐ │
│  │ [sort ▾] [search] [filter ▾]   │   │  (context: selected    │ │
│  │ ─────────────────────────────  │   │   candidate + side)    │ │
│  │ ⬤ Christopher Luxon      47% ▸ │   │  BUY/SELL · $/contracts│ │
│  │   PM of New Zealand            │   │  Yes 48¢ | No 54¢      │ │
│  │   [ Yes 48¢ ] [ No 54¢ ]       │   │  amount presets        │ │
│  │ ─────────────────────────────  │   │  odds · fee · to-win   │ │
│  │ ⬤ Benjamin Netanyahu     38% ▸ │   │  [ Buy Yes · win X ]   │ │
│  │   PM of Israel                 │   └────────────────────────┘ │
│  │   [ Yes 38¢ ] [ No 63¢ ]       │                              │
│  │ … (expand ▸ → mini chart)      │                              │
│  └────────────────────────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

Interaction contract:
- Clicking a **candidate row** selects it (keyboard: ↑/↓ + Enter). Clicking `Yes`/`No` selects the row **and** the side and focuses the ticket amount.
- Selected row is highlighted; the ticket header mirrors the candidate avatar + name + side colour.
- Row `▸` expands an inline **mini price-history sparkline** + volume/24h without leaving the page.
- Empty/edge states: 0-volume candidate shows "New" chip; resolved market pins the winner with a check and greys losers.
- A11y: rows are a `radiogroup`; Yes/No are `button`s with `aria-pressed`; ≥44px targets; reduced-motion safe; full contrast on green/red (never colour-only — always the ¢ label + Yes/No text).

Improvements **over** the references (our edge, not a copy):
- **"To win" always on the CTA** (checkout best practice) — Polymarket buries the payout.
- **Preview == execution** (LMSR authoritative) — no surprise slippage.
- **Deterministic monogram** so the list never has a blank/broken avatar (Image 1's split block, but colour-hashed and AA-safe).
- **Deposit hand-off** inline instead of a dead "insufficient funds" end.

---

## 4. Option avatars — concrete implementation plan (ship now)

Follows ENTITY-IMAGERY's "resolve once, store once, serve from CDN; never hotlink at render".

**4.1 Schema (migration `022_option_entity_media.sql`, additive):**
```sql
alter table public.market_options
  add column if not exists image_url   text,        -- stored CDN url (nullable → monogram)
  add column if not exists entity_kind text,        -- 'person'|'company'|'crypto'|'place'|'team'|'other'
  add column if not exists entity_ref  text;        -- domain (company) | wiki title (person) | symbol (crypto)
alter table public.markets
  add column if not exists cover_entity_kind text,
  add column if not exists cover_entity_ref  text;
```
Reversible (drop columns); no data migration required; monogram covers nulls.

**4.2 Ingestion (`lib/media/ingest.ts` + `app/api/admin/media/backfill/route.ts`, service-role):**
Waterfall per entity, cheap→rich, deduped by `(entity_kind, entity_ref)`:
1. explicit admin URL →
2. company → **Brandfetch** (connected) by domain → logo.dev / Clearbit → Google S2 favicon →
3. person → Wikipedia/Wikimedia REST thumbnail →
4. crypto → CoinGecko/token-list logo →
5. else monogram (no store).
Chosen source is **downloaded, `sharp`-normalised to square WebP (128+256), uploaded to Supabase Storage bucket `entity-media`** (`public, immutable, max-age=31536000`, content-hash filename), URL persisted to `image_url`. No third-party call at render.

**4.3 Backfill the 22 live multi-choice markets** via the route (or a one-off script) — classify each option (person/org/place) heuristically, resolve, store, persist. Places (counties) & abstract options ("None of the above") stay on monogram by design.

**4.4 Create-wizard:** per-option row gains an avatar preview + "Auto-suggest" (types name → guesses kind → previews resolved image) + manual URL/upload override.

**4.5 Render:** `EntityAvatar` already consumes `imageUrl`; pass `option.image_url` on cards, option rows, ticket, portfolio (mostly wiring).

---

## 5. Betting-flow parity — phased build

- **Phase A (UI, no engine change):** rebuild the option list as the Image-2 candidate rows (avatar · name · subtitle · % · row select), add sort/search, wire selection into the existing ticket. Keeps the simplex engine; renders each option's price as its probability and offers **Buy** on the option (No shown as `100¢ − price` preview only until Phase C). Low risk, high visual parity.
- **Phase B (media):** §4 avatars.
- **Phase C (engine):** introduce **event→binary-line** model: a `market_events` grouping + per-candidate binary sub-markets (or extend `market_options` with independent `yes_price/no_price` + two-sided LMSR pools and a `place_bet_option(side)` path). Enables true independent Yes/No per candidate + sell/close. Ships behind a feature flag; binary + legacy simplex markets keep working.
- **Phase D (pro):** per-option limit orders, order-book/depth, position-aware ticket, per-candidate charts.

Cross-cutting for every phase: migrations reversible; unit tests on `outcomes.ts` + preview math; e2e on the trade flow; a11y audit on the radiogroup; perf budget (avatars lazy + CDN, no CLS); audit log on order placement; feature flag gating Phase C/D.

---

## 6. Rollout, risk & backout
- Each phase is a small PR to `main` with green CI before merge; DB changes are additive + reversible.
- Phase C is the only high-risk change → dual-write + shadow-read behind `ff_independent_options`, migrate market-by-market, keep the simplex path until parity is proven, backout = flip the flag.
- Success metrics: trade conversion, time-to-first-trade, avatar coverage %, zero broken/blank avatars, no CLS regression, LMSR preview==execution invariant holds.
