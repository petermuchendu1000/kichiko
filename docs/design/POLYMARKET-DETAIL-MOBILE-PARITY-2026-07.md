# Polymarket → Kichiko — Market Detail **Mobile** Parity Spec (2026-07)

> Companion to `POLYMARKET-DETAIL-PARITY-2026-07.md` (desktop @1440px). This document
> is grounded in the **live Polymarket mobile DOM + compiled CSS** captured for the
> _Presidential Election Winner 2028_ multi-outcome event (37 candidates) plus the
> mobile screenshot. Every measurement/label below is transcribed from that DOM, not
> inferred. Directive: match PM **element by element, feature by feature, behaviour by
> behaviour** on mobile, while keeping our LMSR economics and token system (light+dark,
> WCAG AA+).

Source artifacts (this session): `pasted-text-…535019.txt` (full detail DOM,
1.86M chars), `pasted-text-…552082.txt` (compiled CSS tokens), `pasted-image-…648923.png`
(mobile screenshot).

---

## 0. Responsive strategy (how PM switches mobile ↔ desktop)

PM renders **two DOM trees** and shows one via the **Fresnel** media-query container
pattern, not pure CSS breakpoints:
- `fresnel-lessThan-lg` → **mobile** tree (our target).
- `fresnel-greaterThanOrEqual-lg` → **desktop** tree.
- Breakpoint boundary is **`lg` (1024px)**.

Root container:
- `#event-detail-container`
- Desktop width: `--event-detail-width: calc(100vw - 24px - 24px - 340px - 24px)` → i.e. a **340px** right rail (the sticky ticket) + gutters.
- Mobile width: `max-lg:w-[calc(100vw-2rem)]`, `max-lg:mb-5`.

**Implication for us:** we currently use a single tree with Tailwind `lg:` prefixes and
a `grid lg:grid-cols-3`. That is acceptable, but the mobile *ordering* and *sticky*
behaviours below must be reproduced exactly.

---

## 1. Mobile anatomy — top to bottom (exact DOM order)

### 1.1 Sticky header block
- Wrapper: `w-full flex flex-col z-20 bg-background mb-2 pt-2 pb-3 **sticky top-(--navbar-height)**` — the header re-sticks under the global navbar (`--navbar-height: 104px`) as you scroll.
- Left group (`flex gap-3 items-start`):
  1. **Square avatar** — `rounded-sm`, `!h-10 !w-10` default, upgrades to `min-[480px]:!h-16 !w-16` (**40px < 480px, 64px ≥ 480px**). Skeleton shimmer underlay while the image lazy-loads (`object-cover`, `data-nimg=fill`).
  2. **Category breadcrumb** — small gray, dot-separated: `Elections · Global Elections`.
  3. **Title** — bold, ~2 lines allowed on mobile (`Presidential Election Winner 2028`).
- Right group actions: **link/copy** icon + **bookmark** icon (the `</>` embed icon from desktop is **dropped on mobile**).
- Hairline bottom border appears on scroll (opacity toggled `0`→`1`).

### 1.2 Legend row (multi-outcome summary)
- `flex flex-col items-start gap-y-1 sm:flex-row sm:items-center sm:gap-x-*` — **stacks vertically < sm, inline ≥ sm**.
- Each entry: `size-2 rounded-full` colored dot · name `text-text-secondary text-body-sm` · **percent** `text-neutral-800 font-semibold ml-0.5`.
- **Top 4 series only** shown in the legend: `JD Vance 19.9%`, `Marco Rubio 14.1%`, `Gavin Newsom 11.9%`, `Alexandria Ocasio-Cortez 8.0%`. (Colors: red / light-blue / gold / dark-blue per screenshot.)

### 1.3 Chart block (centrepiece)
- Container reserves height: `min-h-[var(--chart-height)]` so layout doesn't jump before data.
- **Multi-line** probability chart; **faint "Polymarket" watermark** inside the plot.
- **Right-hand Y axis**, **dynamically scaled** to the data — here `0% / 10% / 20% / 30%` (NOT a fixed 0–100). This is a key detail: PM zooms the axis to the leader's range.
- **X axis** month ticks (`Sep … Jul`).
- **Live endpoint dots**: each series terminates in a glowing colored dot at "now".
- Footer / controls:
  - Left: `＋$2` money chip (screenshot) / on this event `$662,055,529 Vol.` · `Nov 7, 2028` date · **`Earn 3.25%`** yield chip.
  - Right: **timeframe toggle group** `1H  6H  1D  1W  1M  ALL` + a **clock** toggle button. (A secondary picker uses `1H 1D 1W 1M Max`.)

### 1.4 Outcome / order-flow rows (multi-outcome board)
One row per candidate (37 here), each:
- **Left**: circular avatar + name (`font-semibold text-base`, ellipsized) + `$X,XXX,XXX Vol.` (`text-xs text-neutral-500`).
- **Center**: large **%** (`text-heading-2xl text-[28px] font-semibold`); shows **`<1%`** for sub-1% outcomes; a colored **delta** may appear.
- **Right**: two buttons — **`Buy Yes N¢`** (green tint) and **`Buy No N¢`** (red/pink tint). Cents are the raw price (`19.9¢` yes / `80.2¢` no; they sum to 100¢).
- Binary markets collapse to a single Yes/No pair that drives the ticket.

### 1.5 Rules / Market Context
- Tabbed control (`role=tablist`): **Rules** | **Market Context**.
- Body = paragraphs + inline resolution-source link; truncated with **`Show more`** / **`View more`** chevron toggles (accordion `data-state=open|closed` with slide animation).

### 1.6 Community block (`#comments`, `max-lg:mt-8`)
- Tabs: **`Comments (999)`** | **`Top Holders`** | **`Positions`** | **`Activity`**.
- Composer: input + emoji + image + **Post**; "Beware of external links." pill.
- Sort `Newest ▾`, `Holders` filter.
- Items: avatar · username · timestamp · body · like count · replies · `⋯` menu.

### 1.7 Related
- Heading **Related**; compact list of sibling markets with mini-% (e.g. `Republican Presidential Nominee 2028 42% J.D. Vance`).

### 1.8 Mobile trade affordance
- On mobile the inline right-rail ticket is **not** shown; PM surfaces Yes/No entry via the per-row `Buy Yes/Buy No` buttons which open the order flow. (We already have `MobileTradeBar` sticky sheet — keep, but align styling to PM.)

---

## 2. Design tokens observed (compiled CSS)

| Token | Value |
| --- | --- |
| `--radius` (base) | `.7rem` → xs `calc(-6px)`, sm `-4px`, md `-2px`, lg `=`, xl `+4px`, 2xl `1rem`, 3xl `1.5rem` |
| `--spacing` | `.25rem` |
| `--navbar-height` | `104px` (mobile sticky offset) |
| Fonts | body **inter** (`--font-inter`), display **openSauce** (`--font-sauce`), mono Geist Mono |
| Weights | light300 / normal400 / medium500 / semibold600 / bold700 / extrabold800 |
| Tracking | tight `-.025em` … widest `.1em`; leading tight1.25 … relaxed1.625 |
| Primary | `#111827`; secondary bg `#f3f4f6`; card `#fff` / fg `#030712` |
| Color scales | red/yellow/green/blue/neutral 50–900 (semantic via `--color-*`) |
| Shadow | `--shadow-md: 0 8px 16px #0000000f` |
| Ease | hover `cubic-bezier(.26,.08,.25,1)`; in-out `cubic-bezier(.4,0,.2,1)` |

**Chip/pill radius on mobile is small (`rounded-sm` = `.7rem - 4px ≈ 6.4px`)** — matches the square-ish avatar and Yes/No buttons.

---

## 3. Gap analysis — current mobile vs PM

Current page: `app/markets/[slug]/page.tsx` → `grid lg:grid-cols-3`; main col = `MarketHeader`
→ `CandidateList` (multi) → chart `card` (OutcomesChart / BtcLiveChart / PriceChart) →
`MarketRules` → `MarketComments` → `MarketFaq`; right rail = ticket + `PositionSummary`
+ Contract specs; plus `RelatedMarkets` and a `MobileTradeBar` sheet.

| # | Element | PM mobile | Ours today | Action |
| --- | --- | --- | --- | --- |
| G1 | Header stickiness | Re-sticks under navbar on scroll (`sticky top-navbar`) | Static `card p-5` | Add mobile sticky header variant |
| G2 | Avatar sizing | 40px < 480px, 64px ≥ 480px, `rounded-sm` | Fixed `EntityAvatar` | Responsive size + square-ish radius |
| G3 | Legend | Top-4 dot+name+% row, stacks<sm | Inside chart component only | Add compact legend above chart on mobile |
| G4 | Chart Y axis | **Dynamic** max (0–30%), right side, watermark, live end dots | Verify OutcomesChart scaling/watermark | Audit + align |
| G5 | Timeframe toggles | `1H 6H 1D 1W 1M ALL` + clock | Verify present on mobile | Align labels/order |
| G6 | Outcome rows | avatar+name+Vol · big% (+delta, `<1%`) · Buy Yes/No ¢ | `CandidateList` — audit vs cents & delta | Align copy, `<1%`, cents |
| G7 | Rules/Context | 2-tab + Show more | `MarketRules` tabs — audit labels | Align to "Rules \| Market Context" + Show more |
| G8 | Community tabs | Comments(N) \| Top Holders \| Positions \| Activity | `MarketComments` — audit tab set/order | Align order & counts |
| G9 | Vol/date/earn chips | `$Vol.` · date · `Earn %` | Contract specs card (desktop) | Add mobile chip strip under chart |
| G10 | Related | "Related" compact list w/ mini-% | `RelatedMarkets` grid | Align to compact list on mobile |

---

## 4. Build plan (incremental · CI-gated · flag-guarded)

Each item is a **sub-milestone → commit to `main` → wait for CI green**. New visual
behaviour gated behind an existing/new feature flag (deploy ≠ release).

1. **M0 — Spec (this doc).** Commit; CI green. ✅
2. **M1 — Mobile sticky header parity** (G1,G2): responsive avatar, sticky-under-navbar, breadcrumb, action icons trimmed for mobile.
3. **M2 — Chart legend + chip strip** (G3,G9): top-4 legend, `$Vol · date · Earn%` strip.
4. **M3 — Chart axis/watermark/end-dot audit** (G4,G5): dynamic Y max, right axis, watermark, timeframe `1H 6H 1D 1W 1M ALL`.
5. **M4 — Outcome rows parity** (G6): cents Yes/No, `<1%`, delta, volume, avatar.
6. **M5 — Rules/Context + Community tabs** (G7,G8): tab labels/order, Show more.
7. **M6 — Related + final mobile polish** (G10): compact related, spacing, a11y/contrast, dark mode, i18n keys.

### Non-negotiables
- LMSR economics unchanged (`lib/trading.previewBet` → `place_bet`).
- Token system only (no hard-coded hex); light + dark; WCAG AA+ contrast.
- Every new string routed through i18n (CI `check-i18n-keys`).
- Keep bundle within budget (CI `check-bundle-budget`).
