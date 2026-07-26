# Polymarket → Kichiko — Market Detail **Mobile** GROUND-TRUTH Teardown (2026-07, refresh)

> Authoritative, element-by-element teardown of the **live Polymarket mobile** market-detail
> page, captured this session for the multi-outcome event _Presidential Election Winner 2028_
> (37 candidates, $662M volume). Grounded in **(a)** the full mobile DOM dump
> (`pasted-text-…441370.txt`, 1.86M chars), **(b)** the compiled CSS token sheet
> (`pasted-text-…436660.txt`), and **(c)** live Playwright mobile screenshots captured at
> 390×844 @2x (`docs/design/reference/polymarket-presidential-2028-mobile/section_*.png`).
>
> This supersedes/extends `POLYMARKET-DETAIL-MOBILE-PARITY-2026-07.md` (the M0 spec) by adding
> several **sections that were not in the original plan**: the Market-Context **news feed** with
> per-article probability-move chips, the **AI-generated summary** block, the mobile
> **contract-specs grid**, and the large **FAQ / SEO accordion**.
>
> Directive (unchanged): match PM **element by element, feature by feature, behaviour by
> behaviour** on mobile, keeping our LMSR economics, token system (light+dark), and WCAG AA+.

Capture facts: viewport 390×844 @2x → full page **20,914px** tall. Two DOM trees via **Fresnel**
(`fresnel-lessThan-lg` = mobile, `fresnel-greaterThanOrEqual-lg` = desktop). `lg` boundary = 1024px.

---

## 0. Page skeleton (exact top-to-bottom DOM order)

```
#event-detail-container  (mobile: w=calc(100vw-2rem), mb-5)
├─ 1  Sticky header block            (sticky top-(--navbar-height))
├─ 2  Legend row (top-4 series)
├─ 3  Chart block (multi-line + watermark + right Y axis + live end dots)
├─ 4  Chart control strip           (Vol chip · timeframe toggles · clock)
├─ 5  Outcome / order-flow board     (37 rows: avatar+name+Vol · big% · Buy Yes/No ¢)
├─ 6  Rules / Market Context  (2-tab)  + Show more
├─ 7  Contract specs grid            (Volume · End Date · Market Opened · Resolver)
├─ 8  AI-generated summary           (“Experimental AI-generated summary … · Updated <ts>”)
├─ 9  Market Context news feed       (article cards w/ source, date, headline, Δ-chip) + Show more
├─ 10 Related                        (compact sibling-market list w/ mini-%)
├─ 11 Community                      (Comments(N) | Top Holders | Positions | Activity)
│     composer · sort(Newest) · Holders filter · comment items(like/replies/⋯)
└─ 12 Frequently Asked Questions     (SEO accordion, ~13 Q&A) + View more
```

---

## 1. Sticky header block  (DOM 0–5)

- Wrapper: `w-full flex flex-col z-20 bg-background mb-2 pt-2 pb-3 **sticky top-(--navbar-height)**`.
  Re-sticks under the global navbar (`--navbar-height: 104px`) on scroll; a hairline bottom
  border fades in (`opacity 0→1`) once scrolled.
- Left group `flex gap-3 items-start`:
  1. **Square avatar** — `rounded-sm`; `!h-10 !w-10` (40px) default, `min-[480px]:!h-16 !w-16`
     (64px) ≥480px. Skeleton shimmer underlay while lazy `img` (`object-cover`, `data-nimg=fill`).
  2. **Category breadcrumb** — small gray, dot-separated: `Elections · Global Elections`.
  3. **Title `<h1>`** — bold, up to 2 lines: `Presidential Election Winner 2028`.
- Right group actions (icon buttons): **link/copy** icon + **bookmark** (`aria-label="Add to favorites"`).
  A separate **info** icon (`aria-label="Market information"`) exists. The desktop `</>` embed icon is **dropped on mobile**.

## 2. Legend row  (DOM 6–13)

- `flex flex-col items-start gap-y-1 sm:flex-row sm:items-center` — **stacks < sm, inline ≥ sm**.
- Entry = `size-2 rounded-full` colored dot · name (`text-text-secondary text-body-sm`) ·
  **percent** (`text-neutral-800 font-semibold ml-0.5`).
- **Top-4 series only**: `JD Vance 19.9%` (red) · `Marco Rubio 14.1%` (light-blue) ·
  `Gavin Newsom 11.9%` (gold) · `Alexandria Ocasio-Cortez 8.0%` (dark-blue).

## 3. Chart block  (DOM 14–20)

**Live render facts (captured this session):** the chart is an **SVG** with class
`overflow-visible` (≈358×240 outer, ≈290×218 inner plot) — **NOT a `<canvas>`** (the
full-viewport canvas on the page is an unrelated animation layer). `overflow-visible`
is the key parity detail: **the plot is UNBOUNDED** — no border box, no card frame, no
vertical gridlines, no left axis line; series lines and their live endpoint dots render
directly on the page background and may extend past the axes (dots are not clipped).

Exact series palette sampled from the rendered chart (top→bottom by current %):
`JD Vance #fa534d` (red) · `Marco Rubio #87bfff` (light-blue) · `Gavin Newsom #e2bf6c`
(gold) · `AOC #456bd5` (navy). Background pure white; endpoint dots carry a lighter halo.

- Reserves height (`min-h-[var(--chart-height)]`) to avoid layout jump.
- **Multi-line** probability chart; faint centered **“Polymarket” watermark** in the plot.
- **Right-hand Y axis**, **dynamically scaled** to data: here `0% / 10% / 20% / 30%` (NOT fixed 0–100 —
  PM zooms to the leader’s range).
- **X axis** month ticks (`Sep … Jul`).
- **Live endpoint dots**: each series ends in a glowing colored dot at “now”.

## 4. Chart control strip  (DOM 21–48)

- Left: **trophy icon + `$662,055,529 Vol.`** money chip.
- Right: **timeframe toggle group**. Two variants observed:
  - Compact (screenshot): `1H  1D  1W  1M  MAX` + **gear/settings** icon + **clock** toggle.
  - Full (DOM): `1H  6H  1D  1W  1M  ALL` (aria `Select chart window`).
- A secondary strip repeats `$Vol. · Nov 7, 2028 · **Earn 3.25%**` (yield chip).

## 5. Outcome / order-flow board  (DOM 49–383, 37 rows)

Per row (`flex items-center` divider between rows):
- **Left**: circular avatar (`icon for <name>`) · name (`font-semibold text-base`, ellipsized) ·
  `$X,XXX,XXX Vol.` (`text-xs text-neutral-500`).
- **Center**: large **integer %** (`text-[28px] font-semibold`); rounds (e.g. 19.9%→`20%`, 1.4%→`1%`);
  sub-1% shows **`<1%`**. (A colored delta may appear on movers.)
- **Right**: two buttons — **`Buy Yes N.N¢`** (green tint) and **`Buy No N.N¢`** (red/pink tint).
  Cents are raw price to 1 decimal; **Yes + No = 100¢** (e.g. `19.9¢` / `80.2¢`).
- Rows are sorted by probability desc. Binary markets collapse to one Yes/No pair driving the ticket.

Sample rows (verbatim): JD Vance 20% `19.9¢/80.2¢` $14.66M · Marco Rubio 14% `14.2¢/85.9¢` $11.20M ·
Gavin Newsom 12% `12.0¢/88.1¢` $17.41M · AOC 8% `8.0¢/92.1¢` $12.58M · … Donald Trump 1% `1.4¢/98.7¢` ·
tail candidates render `<1%` with `0.3¢/99.8¢` etc.

## 6. Rules / Market Context tabs  (DOM 386–407)

- `role=tablist` with two tabs: **`Rules`** | **`Market Context`** (`<h2>` + button per tab).
- **Rules** body: resolution paragraphs + inline **resolution-source** mention (AP, Fox News, NBC).
- Truncated with **`Show more`** chevron (accordion `data-state=open|closed`, slide animation).

## 7. Contract specs grid  (DOM 395–404)

Key/value grid rendered on mobile:
- **Volume** → `$662,055,529`
- **End Date** → `Nov 7, 2028`
- **Market Opened** → `Jul 11, 2025, 2:44 PM ET`
- **Resolver** → address link `0x2F5e3684c…` (`<a>`, truncated middle).
- Footnote: “We anticipate rolling out a new rewards and oracle-resolution system…”.

## 8. AI-generated summary  (DOM 408–411)

- Paragraph of AI summary text + `<small>`: **“Experimental AI-generated summary referencing
  Polymarket data. This is not trading advice … · Updated `Jun 18, 2026, 2:31 AM UTC`”**.
- Rendered under a JSON-LD `Article` script (SEO).

## 9. Market Context **news feed**  (DOM 412–7121)  ⟵ NEW, large

A dated feed of article cards (this is the bulk of the DOM). Each card:
- **Date** (`Jul 2 2026`) · **headline** (`<TXT>`) · **summary paragraph** · **source** (logo `img` alt =
  publisher, e.g. `The New York Times`, `Fox News`, `AP News`, `CBS News`).
- **Probability-move chip**: `<candidate> <verb> to <N>% <±M>%` where verb ∈
  {`rises to`, `dips to`, `jumps to`} and the delta is colored (green up / red down). Examples:
  `Jon Ossoff rises to 7% +2%`, `Gavin Newsom dips to 12% -3%`, `JD Vance jumps to 28% +9%`.
- Some cards carry **two** source logos.
- Terminated by a **`Show more`** button.

## 10. Related  (DOM 7122–7138)

- `<h3>Related`; compact list of sibling markets, each an `<a>`:
  icon · market title · **mini-%** · leading outcome name. Verbatim:
  - `Republican Presidential Nominee 2028` — **42%** J.D. Vance
  - `Democratic Presidential Nominee 2028` — **20%** Gavin Newsom
  - `Which party wins 2028 US Presidential Election?` — **59%** Democratic

## 11. Community block  (DOM 7139–7245, `#comments`)

- Tab set (order): **`Comments (999)`** | **`Top Holders`** | **`Positions`** | **`Activity`**.
- Composer: `<textarea placeholder="Add a comment…">` + **`Post`** button + **“Beware of external links.”** pill.
- Controls: **`Newest ▾`** sort + **`Holders`** filter.
- Comment item: avatar · username (`<a>`) · **position badge** (`5 JD Vance` = holds 5 shares) ·
  timestamp (`14h ago`) · body · **like** button (count) · **`N Replies`** · replies may `@mention`.

## 12. Frequently Asked Questions  (DOM 7246–7300)  ⟵ NEW (SEO accordion)

- `<h2>Frequently Asked Questions`; ~13 `<h3>`/button accordion rows, each expandable
  (`data-state`), body text templated with the market title. Topics: what the market is, trading
  activity, how to trade, current odds, resolution, follow-without-trading, why odds are reliable
  (links **`accuracy page`**), how to start, what a `20¢` price means, when it closes, what traders
  are saying, what Polymarket is. Ends with a **`View more`** toggle.

---

## 13. Design tokens (compiled CSS, confirmed)

| Token | Value |
| --- | --- |
| `--radius` base | `.7rem` → sm `-4px`, md `-2px`, lg `=`, xl `+4px`, 2xl `1rem`, 3xl `1.5rem` |
| `--spacing` | `.25rem` |
| `--navbar-height` | `104px` (mobile sticky offset) |
| Fonts | body **inter** (`--font-inter`), display **openSauce** (`--font-sauce`), mono Geist Mono |
| Weights | 300/400/500/600/700/800 |
| Primary | `#111827`; secondary bg `#f3f4f6`; card `#fff` / fg `#030712` |
| Scales | red/yellow/green/blue/neutral 50–950 via `--color-*` |
| Shadow | `--shadow-md: 0 8px 16px #0000000f` |
| Ease | hover `cubic-bezier(.26,.08,.25,1)`; in-out `cubic-bezier(.4,0,.2,1)` |
| Chip radius (mobile) | `rounded-sm ≈ 6.4px` (square-ish avatars & Yes/No buttons) |

---

## 14. Revised gap analysis — current mobile vs PM (refresh)

Current page: `app/markets/[slug]/page.tsx`. Legend/chart/rows partially done through M1–M3.
The **bold** rows below are the newly-surfaced gaps not in the original M0 plan.

| # | Element | PM mobile | Action |
| --- | --- | --- | --- |
| G1 | Sticky header under navbar | `sticky top-navbar` + hairline on scroll | Verify M1 impl matches |
| G2 | Responsive square avatar | 40px<480 / 64px≥480, `rounded-sm` | Verify M1 |
| G3 | Top-4 legend, stacks<sm | dot+name+% | Verify M2 |
| G4 | Chart: dynamic right Y axis, watermark, live end dots | 0/10/20/30% | Verify/finish **M3 (current)** |
| G5 | Timeframe toggles | `1H 6H 1D 1W 1M ALL` (+ compact `…MAX` + clock/gear) | Align set + clock/gear |
| G6 | Outcome rows | cents Yes/No, `<1%`, integer %, $Vol, avatar, delta | M4 |
| G7 | Rules/Context 2-tab + Show more | labels exact | M5 |
| **G7b** | **Contract specs grid (mobile)** | **Volume/End Date/Opened/Resolver link** | **NEW → M5** |
| **G8b** | **AI-generated summary block** | **text + “Experimental… · Updated ts”** | **NEW → M5.5** |
| **G8c** | **Market Context news feed** | **article cards + Δ-chip (rises/dips/jumps to N% ±M%)** | **NEW → M6 (large)** |
| G8 | Community tabs | Comments(N)\|Top Holders\|Positions\|Activity + composer/sort/holders | M7 |
| G10 | Related compact list | icon·title·mini-%·leading name | M7 |
| **G11** | **FAQ / SEO accordion** | **~13 templated Q&A + View more** | **NEW → M8** |

---

## 15. Revised build plan (incremental · CI-gated · flag-guarded)

Each item = **sub-milestone → commit to `main` → wait CI green**. Visual changes behind a flag.

- **M1 — Sticky header parity** (G1,G2) — *done* (commit `f27cedc`). Audit only.
- **M2 — Legend + chip strip** (G3) — *done* (commit `2683ee7`). Audit only.
- **M3 — Chart axis/watermark/end-dots** (G4,G5) — *current* (commit `06c46ce`). Finish + verify.
- **M4 — Outcome rows parity** (G6): integer %, `<1%`, cents Yes/No summing to 100¢, $Vol, delta.
- **M5 — Rules/Context tabs + contract-specs grid** (G7,G7b).
- **M5.5 — AI-summary block** (G8b) — flagged, i18n’d, dark-mode.
- **M6 — Market Context news feed** (G8c): article card + colored Δ-chip; data model + API + UI.
- **M7 — Community tabs + Related** (G8,G10). — *done*. Tabs/labels/sort/Post
  verified against live PM; multi-outcome charts gained PM's dotted `1 3`
  gridlines. See `POLYMARKET-DETAIL-M7-COMMUNITY-CHART-2026-07.md`.
- **M8 — FAQ / SEO accordion** (G11): templated Q&A, JSON-LD, accordion a11y.
- **M9 — Final mobile polish**: spacing, contrast, dark mode, i18n keys, a11y, bundle budget.

### Non-negotiables
- LMSR economics unchanged (`lib/trading.previewBet` → `place_bet`); Yes+No=100¢ display only.
- Token system only (no hard-coded hex); light + dark; WCAG AA+.
- Every new string via i18n (CI `check-i18n-keys`); pseudo-locale in sync.
- Bundle within budget (CI `check-bundle-budget`, 130KB first-load).
