# Top Holders & Trader Profile — Design Dossier (Pip system)

Surfaces: market-detail **Top Holders** tab · **holder hover-card** · public
**trader profile** (`/traders/[id]`). Reference: Polymarket's holders + profile.
Model: **Board → Peek → Profile** (progressive disclosure of a trader's story).

---

## 1. Research — Polymarket, element-by-element (why it works)

### 1a. Top Holders board (market detail)
From the reference capture (`Argentina` market, World-Cup group):

- **Outcome selector** (`Argentina ▾`). On a multi-outcome market each candidate
  is its own Yes/No book, so holders are *per option*. A single dropdown scopes
  the whole board to one option. Binary markets skip this — the market itself is
  the book.
- **Two mirrored columns**: `Yes holders` and `No holders`, each with a right-
  aligned `SHARES` header. Splitting by side is the entire point: it answers
  "who is on my side, and who is fading me?" at a glance. Yes on the left (the
  affirmative reading order), No on the right.
- **Rows** are dense and rank-ordered by shares desc: circular **gradient
  avatar** → **username** → right-aligned **share count**, colored green (Yes) /
  red (No). No secondary metadata on the row — the row is a leaderboard line,
  not a card. ~10 rows per side, then scroll.
- **Gradient avatars**: Polymarket derives a deterministic multi-stop radial
  gradient from the wallet address. It reads as identity (recognizable per user)
  without requiring an uploaded photo — zero empty-avatar states, ever.
- Small **verification pip** (blue check / X-logo badge) overlaps the avatar for
  linked/notable accounts.

### 1b. Holder hover-card (the "peek")
Hovering a holder name opens a small popover anchored to the row:

- Avatar + username + **"Joined <Mon YYYY>"**.
- A 3-up stat strip: **Positions** ($ value of open positions) · **Profit/Loss**
  (green/red, all-time) · **Volume** (lifetime traded).
- It is *read-only* and instantaneous — a low-commitment preview that lets a
  trader triage "is this whale worth clicking?" without a full navigation. This
  is the crucial affordance: recognition over recall, and it keeps people on the
  market page.

### 1c. Trader profile page (the "profile")
Clicking through lands on `/profile/0x…` (or `/@username`):

- **Identity header card**: large gradient avatar (+ verification pip), display
  name, optional **X handle** chip, one-line bio ("Sports Arbs"), and
  **"Joined <Mon YYYY> · N views"**. A share + QR affordance on the right.
- **Stat strip** under the identity: **Positions Value** · **Biggest Win** ·
  **Predictions** (count). Terse, monetary, scannable.
- **Profit/Loss card** (right): a big signed number with a period label
  ("Past Day"), an area/line spark over a **range switcher** `1D 1W 1M 1Y YTD
  ALL`, and a subtle "Polymarket" provenance mark. The chart is the emotional
  center — it tells the win/lose story faster than any table.
- **Positions / Activity** tabs, then an **Active / Closed** segmented control.
  - **Active** table: `MARKET · AVG · CURRENT · VALUE` — each row shows the
    outcome chip (`Yes 10¢`), share qty, current value, and unrealized P/L %.
    Sort toggle (`Value ▾`).
  - **Closed** table: `RESULT · MARKET · TOTAL TRADED · AMOUNT WON` — a green
    `✓ Won` chip, and realized P/L in green under the amount. Sort by
    `Profit/Loss`.
  - A **search positions** field scopes long portfolios.

### Why the whole flow works
Board → Peek → Profile is textbook **progressive disclosure**: the board is a
scannable ranking, the hover is a zero-navigation preview, the profile is the
full dossier. Each step reveals exactly as much as the decision at that step
needs, and each is one gesture from the next. Money is always right-aligned and
tabular; green/red is reserved strictly for side/P&L; identity is always a
recognizable avatar. Nothing is decorative.

---

## 2. Weaknesses we will improve on

1. **Wallet-address usernames** (`0xa7b7…`) are unreadable. We key on real
   display-name/username and only fall back to a short monogram — no hex soup.
2. **No "you" anchor.** Polymarket never highlights *your own* row in the board.
   We mark the signed-in user's row ("You") so a trader can locate themselves.
3. **Hover-only peek is inaccessible** (no keyboard/touch path). Our peek opens
   on hover **and** focus **and** tap, is dismissible with `Esc`, and is fully
   labelled — WCAG-conformant, not mouse-only.
4. **Shares without context.** A raw share count is meaningless to a new trader.
   We keep the share count (parity) but the hover/profile translate it into
   position **value** and **P&L**, which is what actually matters.
5. **No concentration signal.** We add a thin **share-of-book bar** behind each
   row (the holder's % of that side's total shares) — instantly shows whether
   one whale dominates. Off by default on mobile to keep rows clean.
6. **Cold empty state.** Instead of "No holders yet", we explain the mechanic
   ("Be the first to take a side — holders rank here by shares") and link to the
   ticket. Empty states teach.

---

## 3. Information architecture & data flow

```
Market detail ──▶ Top Holders tab
                    │  (multi-outcome) outcome selector → market_option_id
                    ▼
             rpc: market_top_holders(market_id, option_id, side, limit)
                    │  → [ {user_id, name, username, avatar, shares, value,
                    │       share_of_book, joined_at} ]  ×  Yes | No
                    ▼
   HolderRow ──hover/focus/tap──▶ HolderPeek  (rpc: trader_card_stats)
        │  click / Enter
        ▼
   /traders/[id]  (server) ──▶ rpc: trader_public_profile(id)
                                 rpc: trader_pnl_series(id, range)
                                 rpc: trader_positions(id, status, q, sort)
```

- **Server-side** for the board and profile (SEO + fast first paint); the peek
  and range/sort switches are the only client interactions.
- **RPCs are `SECURITY DEFINER` + read-only** and expose only already-public
  aggregate columns (name, avatar, shares, value, P&L) — never phone, email,
  wallet, KYC. RLS on the base tables stays intact.

---

## 4. Component spec (Pip design system)

- `TraderAvatar` — deterministic conic/radial **gradient** from the user id
  (two hues + angle hashed from the uuid), optional monogram, optional
  verification pip. Sizes `sm|md|lg`. Replaces the flat `avatarColor` block for
  people (kept for comments to avoid churn).
- `TopHolders` — outcome `<select>` (only when `resolution_type =
  multiple_choice`), two `HolderColumn`s (`Yes` / `No`) with `SHARES` headers,
  10 rows each + "Show more". Uses `tabular-nums`, `text-yes`/`text-no`.
- `HolderRow` — avatar · name (link to profile) · right-aligned shares; optional
  `share_of_book` bar; `You` chip for self. The whole row is the hover/focus
  trigger for the peek.
- `HolderPeek` — popover (`role="dialog"`, labelled, `Esc` to close): avatar +
  name + joined; 3-up Positions / P&L / Volume. Anchored, flips to stay in view.
- `/traders/[id]` — `TraderHeader` (identity + stat strip), `PnlCard` (signed
  number + range switch + sparkline), `TraderPortfolio` (Positions/Activity
  tabs, Active/Closed segmented control, search, sortable table).
- Tokens only: `card`, `hairline`, `text-primary/secondary/muted`, `pip-*`,
  `yes/no`, radii `8/12/16`, shadows `e1–e3`. Brand blue for links/controls;
  green/red **only** for side & P&L. No new colors.

## 5. Accessibility

- Board is a real list; each holder name is a keyboard-focusable `<a>`.
- Peek opens on hover **and** `focus`, closes on blur/`Esc`; `aria-describedby`
  ties the trigger to the card. Color is never the only signal — Yes/No is also
  a text label; P&L carries a `+`/`−` sign.
- Range/sort controls are labelled buttons with `aria-pressed`.
- Contrast: `text-yes`/`text-no` use the AA-safe `--yes-700/--no-700` at small
  sizes; verified pip has a non-color label.

## 6. Performance / SEO

- Board RPC returns ≤ 20 rows/side, indexed on `(market_id, market_option_id,
  side, shares desc)`. Profile is server-rendered and cacheable; the sparkline
  is inline SVG (no chart lib → no bundle cost). Trader pages emit
  `ProfilePage` JSON-LD and canonical URLs.

## 7. Milestones (commit per step, CI green before next)

1. Dossier (this doc). ✅
2. Migration: holder/profile RPCs + indexes + `profile_views`. 
3. `TraderAvatar` + `HolderPeek` + rebuilt `TopHolders`; wire options into the
   market-detail community block.
4. `/traders/[id]` profile (header, P&L card, portfolio tabs).
5. Representative seed data (positions/activity/price history) so the surfaces
   render with real content.
6. Unit tests + a11y + lint/type-check/build; push; verify CI.


---

# Addendum v2 — live Polymarket teardown (element-by-element)

Captured by inspecting Polymarket's live DOM + computed styles
(`/event/world-cup-winner`, `/profile/0x…`) — not guesswork. This section is the
authoritative mapping the Kichiko surfaces are built to.

## 1. Identity avatar (the big correction)

Polymarket does **not** use letter monograms. Every account renders a smooth
multi-hue **gradient orb** generated deterministically from the wallet address.
Verified technique (computed `background-image`):

```
background-image:
  radial-gradient(at 66% 77%, rgb(R1,G1,B1) 0px, rgba(0,0,0,0) 50%),
  radial-gradient(at 29% 97%, rgb(R2,G2,B2) 0px, rgba(0,0,0,0) 50%),
  radial-gradient(at 99% 86%, rgb(R3,G3,B3) 0px, rgba(0,0,0,0) 50%),
  radial-gradient(at 29% 88%, rgb(R4,G4,B4) 0px, rgba(0,0,0,0) 50%);
border-radius: 50%;
```

* **Four layers, four fixed anchor positions** — `66% 77%`, `29% 97%`,
  `99% 86%`, `29% 88%` — constant across every avatar. Only the four colours
  change per account, so all orbs share the same "bloom from the lower-right"
  character while staying individually recognizable.
* Each layer fades to transparent at 50%; overlaps blend into organic mid-tones.
* Real uploaded photos win (`<img class="object-cover">`); a broken photo must
  fall back to the orb — never a blank.
* Verified accounts get a small corner pip/badge.

**Our implementation** — `lib/trader.ts › traderOrb(id)`:
FNV-1a hash → xorshift PRNG → 4 HSL colours (S 62–88%, L 46–66%) at the exact
four positions above, over a darker base fill (`hsl(h,42%,26%)`) so the top
never washes out. `TraderAvatar` renders the orb with no letter + optional pip.
12 unit tests lock determinism and geometry.

## 2. Top Holders board

| Element | Polymarket | Kichiko |
|---|---|---|
| Layout | Two mirrored columns: **Yes holders** \| **No holders** | ✅ `grid-cols-1 sm:grid-cols-2` (mobile stacks Yes→No) |
| Column header | Title left, `SHARES` right (uppercase, muted) | ✅ |
| Row | orb · name · right-aligned shares | ✅ orb + name + shares |
| Shares colour | green (Yes) / red (No) | ✅ `text-yes` / `text-no` |
| Ranking | by shares desc, top 10 | ✅ `market_top_holders` limit 10, `side_rank` |
| Multi-outcome | option selector → that option's Yes/No book (each option is its own Yes/No market) | ✅ `<select>` scopes the board via `p_option_id` |
| Interaction | hover name → peek; click → profile | ✅ hover/focus peek + `/traders/[id]` link |
| Extra (ours) | — | share-of-book concentration bar; "You" anchor |

## 3. Holder peek (hover/focus card)

`orb + display name + "Joined Mon YYYY"`, divider, then a 3-up stat row:
**Positions** (value) · **Profit/Loss** (green/red) · **Volume**. Fetched from
`trader_card_stats`. Ours matches 1:1 and is an accessible `role="dialog"` that
also opens on keyboard focus and closes on Escape.

## 4. Public trader profile (`/traders/[id]`)

| Block | Polymarket | Kichiko |
|---|---|---|
| Identity | orb (+pip) · name · `@handle` · "Joined … · N views" · bio | ✅ |
| Stat strip | Positions value · Biggest win · Predictions | ✅ `trader_public_profile` |
| P&L card | big signed $ (green/red) · `1D 1W 1M 1Y YTD ALL` · area chart | ✅ range-switched inline-SVG sparkline (aligned daily ticks → smooth) |
| Portfolio | **Positions** / **Activity** tabs; **Active** \| **Closed**; search; sort (Value/Profit-Loss) | ✅ `trader_positions` |
| Active cols | Market · Avg · Current · Value (+unrealized %) | ✅ `10¢` cents formatting, Yes/No chip |
| Closed cols | Result (Won/Lost) · Market · Total traded · Amount won (+realized %) | ✅ |

## 5. Mobile-first

400px is the design baseline: board stacks to one column, peek is width-capped,
profile stat strips wrap, portfolio table scrolls inside `.table-wrapper`. `sm:`
promotes the two-column board and inline profile layout on wider panels.

## 6. Demo data

`scripts/seed_demo_traders.py` seeds ~60 orb-only traders with Yes **and** No
books on featured binary markets and on **every option** of multi-outcome
markets, cross-market positions, closed (won/lost) positions, aligned 45-day
price history (smooth P&L curves), an activity feed, and recomputed market +
option aggregates ($Vol / bets / unique traders). Idempotent by
`@demo.kichiko`.
