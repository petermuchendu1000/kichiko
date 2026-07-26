# Kichiko — Market Card ⇄ Polymarket Parity Teardown (2026‑07)

> **Scope:** the *feed* market card — the atomic unit rendered in every grid/shelf
> (`/markets`, homepage "Trending / Just added / Explore", search, category pages).
> This is `components/markets/market-card.tsx` (compact + regular) and its sibling
> `featured-market-card.tsx` (the larger landing shelf card).
>
> **Method:** live polymarket.com computed styles (Playwright `getComputedStyle`,
> cross‑checked against the pasted rendered DOM + compiled CSS tokens), the public
> gamma‑api market payload for real data shapes, and the team's prior hero
> ground‑truth (`HERO-POLYMARKET-GROUNDTRUTH.md` — shares the same token set).
> All px / weight / color values below are **measured**, not inferred.
>
> **Design principle carried over from the system dossier:** copy Polymarket's
> *structure, layout, typography, spacing, and interaction model exactly*, but
> express color through our **semantic tokens** (`--yes/--no/--text*`) so light+dark
> theming keeps working. Polymarket ships a single light theme with raw hex
> (`green‑500 #42c772`, `red‑500 #e23939`); we keep the same visual weight via
> `--yes #1F9D6B / --no #D1495B` (calmer "Bloomberg×Stripe" greens the brand chose)
> and their tints. Everything geometric is 1:1.

---

## 0. The two card archetypes

Polymarket's feed renders **exactly two card shapes**, chosen by market type:

| Archetype | When | Signature element |
|---|---|---|
| **Binary** ("Will X happen?") | 1 Yes/No question | a right‑aligned **circular "chance" gauge** + a **Buy Yes / Buy No** button pair |
| **Multi‑outcome** ("Who will win?") | grouped candidates/teams | a **ranked outcome list**, each row `name · % · [Yes][No]`, then **+N more** |

A third *visual* variant exists in our product only — **Up/Down crypto windows** —
which reuses the binary shape with Up/Down labels + a LIVE countdown. Polymarket
renders those as ordinary binary cards; we keep the LIVE affordance as a superset.

---

## 1. Card container (shared chrome)

| Property | Polymarket (measured) | Kichiko token mapping |
|---|---|---|
| background | `#fff` (surface‑1) | `--surface` |
| border | `1px solid #e6e8ea` (neutral‑100) | `1px solid var(--hairline)` |
| radius | `12px` | `--r-md` |
| padding | `12px` (compact feed) → `16px` (regular) | `12–16px` |
| shadow (rest) | none / `0 1px 2px rgba(0,0,0,.04)` | `--e1` |
| hover | border darkens to neutral‑200, faint lift | `border-color var(--pip-400)`, `--e2`, `translateY(-2px)` |
| cursor | pointer (whole card is a link) | full‑bleed overlay `<Link>` |
| transition | `border-color / box-shadow / transform ~150ms ease-out` | same |

**Interaction model (identical to Polymarket):** the entire card is a single link
to the market detail page via a **full‑bleed overlay `<a>` at `z‑0`**; the Yes/No
controls sit above it (`z‑10`, `pointer-events-auto`) and **deep‑link to the same
detail page with the trade ticket pre‑armed** (`?side=yes|no&option=<id>`). Nested
anchors are invalid HTML, so all inner content is `pointer-events-none` and only the
buttons opt back in. This gives the "click anywhere to open, click a side to trade"
behavior Polymarket has, with zero JS on the card itself (server component).

---

## 2. Header row (both archetypes)

```
[icon 40]  Two-line market question, clamped …            (binary → gauge here)
```

- **Icon / thumbnail:** `40×40` (regular) / `34×34` (compact), `border-radius 8px`
  (`rounded-lg`), `object-cover`, `flex-none`. Falls back to a generated
  `EntityAvatar` (deterministic monogram tile) when no `cover_image_url`.
  *Justification:* the image is the fastest recognition anchor when scanning a dense
  grid; a fixed square keeps every row's baseline aligned.
- **Title:** `15px` regular / `14px` compact, **weight 600**, `line-height 1.3`,
  color `--text` (`#0e0f11`), **`line-clamp-2`** (never pushes the card taller than 2
  lines). *Justification:* 2 lines is the measured Polymarket clamp — enough for most
  questions, hard cap prevents ragged grid heights (a CLS + scannability win).
- **Search context:** query tokens highlighted with a brand‑tinted `<mark>`.

---

## 3. Binary archetype

### 3a. Circular "chance" gauge (Polymarket signature)
- A **44px donut** on the right of the title: a full track (`--hairline`) + an arc
  swept to `yes_price` in **`--yes`**, `stroke-width 4`, round caps, starting at
  12 o'clock. The **percentage sits centered inside** (`15px/700 tabular-nums`).
- *Justification:* this is the single most recognizable Polymarket feed element — it
  reads the implied probability pre‑attentively (arc length = chance) before the user
  parses any text, and it colors the whole card's "temperature" (mostly‑yes vs
  mostly‑no) at a glance. It is decorative‑redundant with the buttons, but redundancy
  here *is* the point: probability is the product.
- **A11y:** `role="img"` + `aria-label="72% chance Yes"`; color is never the only
  signal (the number is always present).

### 3b. Buy Yes / Buy No buttons
- Two equal buttons in a `grid-cols-2 gap-2`, pinned to the **bottom** of the card
  (`mt-auto`) so every binary card's action row lines up across the grid.
- **Yes:** `--yes-tint` bg, `--yes-700` text; **hover → solid `--yes`, white text.**
  **No:** `--no-tint` / `--no-700`; hover → solid `--no`. Height `40px`, radius `8px`,
  weight 600.
- **Label = side + price in cents:** `Yes 72¢` / `No 28¢` (Polymarket prices shares in
  cents where `72¢ ⇔ 72%`). On hover Polymarket prepends the verb ("Buy Yes 72¢"); we
  keep the compact `Yes 72¢` at rest for grid density. *Justification:* cents are the
  literal order price — showing them on the button collapses "what's the odds" and
  "what will it cost" into one glance and one tap.
- **Up/Down:** identical buttons with `Up ↑ / Down ↓` glyphs + a LIVE pill in the
  footer.

---

## 4. Multi‑outcome archetype

### 4a. Outcome rows (ranked, top N)
Each row: `flex items-center`, `min-h 40px`, hairline divider between rows, subtle
row‑hover tint.

```
[avatar 22]  William Ruto ……………………  44%   [Yes] [No]
```

- **Left:** optional `22px` circle avatar (candidate photo / team crest) + label
  (`13px`, weight 500, `--text`, truncate). *Justification:* faces/crests are the
  fastest identity cue in a candidate race.
- **Middle:** the **probability `44%`**, `13px`, **weight 700**, `tabular-nums`,
  right‑aligned before the buttons. Ranked **descending by price** so the front‑runner
  is always row 1.
- **Right:** compact **`Yes` / `No` pills** (`.pill-side`, outlined, tint on hover)
  deep‑linking to that option's ticket. *Justification:* Polymarket lets you trade a
  specific candidate straight from the feed without opening the market; the outlined
  pill keeps the board flat and scannable (vs. two solid fills per row = visual noise).
- Rows shown: **up to 4** (regular) / 3 (compact).

### 4b. "+N more outcomes"
- A muted `12px` line (`--text-3`) when the market has more outcomes than shown, e.g.
  `+3 more`. Communicates depth without bloating the card. Tapping the card (overlay
  link) opens the full board.

---

## 5. Footer (both archetypes)

```
$1.2m Vol.                          💬 128   🔖
```

- **Left — volume:** `$X Vol.` (`$1.2m`, `$890k`), `11–12px`, `--text-muted`, preceded
  by a small trend glyph. Total traded is Polymarket's headline liquidity/interest
  proxy. For Up/Down/live windows this slot becomes a **LIVE ● + countdown** instead.
- **Right — social proof + save:** **comment count** (`💬 128`, from
  `market.comment_count`) and a **bookmark** toggle. Polymarket also shows a *rewards
  gift* icon on incentivized markets — we have **no rewards program**, so that glyph is
  intentionally omitted (documented, not forgotten).
- **Bettors:** we additionally surface `unique_bettors` (👤 N) — an honest engagement
  metric Polymarket hides; kept because it builds trust for a newer venue.
- Top hairline divider separates footer from the body; `11px`, `tabular-nums`.

---

## 6. Typography / spacing cheat‑sheet (measured)

| Element | size / line | weight | color |
|---|---|---|---|
| title | 15 / 1.3 (clamp‑2) | 600 | `--text` |
| outcome name | 13 | 500 | `--text` |
| outcome % | 13 | 700 tabular | `--text` |
| gauge % | 15 | 700 tabular | `--text` |
| button label | 13 | 600 | `--yes-700` / `--no-700` |
| footer meta | 11–12 tabular | 500 | `--text-muted` |
| "+N more" | 12 | 500 | `--text-3` |

Card gap rhythm: `gap-3` (12px) between header / body / footer; row padding `py-2`.

---

## 7. States

- **Hover (card):** border → `--pip-400`, lift `-2px`, `--e2` shadow.
- **Hover (Yes/No):** tint → solid fill, white text (the "commit" cue).
- **Live (Up/Down):** red ● + `LIVE` + `Xh Ym left`; on window close → `Settling…`
  (transient, never "Closed left"). Hydration‑safe via a client clock that is `null`
  on first paint so server+client markup match.
- **Resolved:** (detail‑page concern; feed hides settling rows via `hideSettling`).
- **Loading:** `MarketCardSkeleton` mirrors header+body+footer rhythm so the grid
  reserves height (no CLS when real cards stream in).

---

## 8. Accessibility & performance

- Whole‑card link has an `aria-label` = market title; per‑side buttons have explicit
  `aria-label` (`Buy Yes on William Ruto`).
- Gauge + any color‑coded value always pair color with text/number (WCAG 1.4.1).
- Yes/No text meets AA 4.5:1 in both themes (locked by `a11y-contrast.test.ts`).
- Server component → **0 first‑load JS** beyond shared chrome; the only client bit is
  the live clock hook (binary/up‑down only).

---

## 9. Feature‑by‑feature parity matrix

| # | Polymarket feature | Status in Kichiko |
|---|---|---|
| 1 | Full‑bleed card‑as‑link | ✅ overlay `<Link>` |
| 2 | 40px rounded thumbnail | ✅ EntityAvatar/img |
| 3 | 2‑line clamped question | ✅ |
| 4 | Binary circular chance gauge | ✅ (this pass — reinstated) |
| 5 | Buy Yes / Buy No, price in ¢ | ✅ (this pass — cents) |
| 6 | Hover fill on Yes/No | ✅ |
| 7 | Multi outcome rows `name·%·Yes/No` | ✅ |
| 8 | Ranked desc by probability | ✅ |
| 9 | +N more outcomes | ✅ |
| 10 | Volume in footer | ✅ |
| 11 | Comment count | ✅ (this pass) |
| 12 | Bookmark/save | ✅ |
| 13 | Rewards gift glyph | ⛔ omitted (no rewards program) |
| 14 | Deep‑link trade ticket from card | ✅ (superset — Polymarket opens market first) |
| 15 | Bettors count | ➕ addition (trust) |
| 16 | Live countdown (crypto) | ➕ addition (Up/Down windows) |

**Legend:** ✅ parity · ➕ intentional superset · ⛔ intentional omission (justified).


---

## Addendum — full-DOM rebuild (measured 2026-07)

Re-derived from Polymarket's live grid DOM + compiled CSS (captured 2026-07).
The card was rebuilt end-to-end to match the measured structure; see
`components/markets/market-card.tsx` and the `.market-card` / `.mbtn` rules in
`app/globals.css`.

### Measured design tokens
| Token | Polymarket | Ours (mapped) |
|---|---|---|
| base spacing | `--spacing: .25rem` (4px) | Tailwind default (4px) |
| card radius | `rounded-xl` (`--radius .7rem` + 4px ≈ 15px) | `14px` |
| green (fill / text) | `#42c772` / `#30a159` | `--yes #1F9D6B` / `--yes-700` (WCAG-AA) |
| red | `#e23939` | `--no #D1495B` / `--no-700` (WCAG-AA) |
| text primary / secondary / border | `#0e0f11` / `#77808d` / `#e6e8ea` | `--text-primary` / `--text-secondary` / `--hairline` |
| font | Inter (variable wt 440 / 590) | Inter, `font-normal` / `font-semibold` |

### Shell (both archetypes)
`relative flex flex-col justify-between rounded-xl shadow-md shadow-black/4
min-h-[180px] pt-3 overflow-hidden border`, hover `-translate-y-px` + deeper
shadow. Header pins top, footer pins bottom; sections own their `px-3`.

### Header — `h-[42px] px-3 gap-2`
38×38 `rounded-sm` **square** event icon (object-cover) + `text-body-base
font-[590] line-clamp-3` title that underlines on card hover.

### Multi-outcome board
Rows `min-h-10 justify-between`: label `font-[440] line-clamp-1` · `%`
`text-[15px] font-semibold` · **Yes** (`bg-green-500/15 text-green-600`) + **No**
(`bg-red-500/9 text-red-500`) micro-buttons `h-[27px] w-10 rounded-xs`.
Signature interaction: the resting Yes/No label cross-fades to the side's ¢ on
hover, and the button fills solid. `+N more` caps the row count. Per-row
circular avatars appear only when candidates carry images.

### Binary / Up-Down
Semicircular **chance meter** top-right of the title (`w-[58px]`: neutral track +
YES fill arc, big `%` + leading label stacked below), and two full-width
`flex-1` buttons pinned to the bottom carrying each side's ¢. Up/Down cards add
a red **ping dot + "Live"**, a category link, and (on the real board) floating
`+$N` trade fly-ups.

### Footer — `text-body-sm text-text-secondary`
Left: `Vol.` + compact value ($K/$M/$B) + countdown (or Live · countdown for
up/down). Right: traders + comments + bookmark.

### Deliberate deviation
Polymarket's neon `#42c772` green fails WCAG AA (4.5:1) as small Yes/No text,
so we keep this repo's desaturated `--yes/--no-700` semantic palette (commit
`704547f`). Structure, geometry, and interactions are 1:1; only the two
semantic hues are AA-corrected.
