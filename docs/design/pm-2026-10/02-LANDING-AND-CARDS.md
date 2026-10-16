# Landing & Cards — What Changed and Why, 2026-10-15

Companion to `01-POLYMARKET-GROUND-TRUTH.md`. That document records what
Polymarket measures at; this one records what we did about it, and what we
deliberately did not do.

---

## 1. The headline number

Elopis's landing page, measured at 1440×900:

| | Before | After |
|---|---|---|
| Signed-out visitor | 7,950px | **7,145px** |
| Signed-in trader | 7,950px | **4,310px** |
| Polymarket (reference) | 3,363px | — |

A signed-in trader's landing is now 46% shorter than it was.

---

## 2. Where the height was going

Measured section by section, before any change:

| Section | Height | Share |
|---|---|---|
| Hero carousel | 638px | 8% |
| Six market rails | 3,300px | 41% |
| **Explainer stack (5 sections)** | **3,227px** | **41%** |
| CTA band + footer | ~785px | 10% |

The explainer stack — *Three easy steps · Buy or sell any time · People set the
price, not us · Safe, clear, and fair · Ready to try?* — was as large as the
entire market inventory it was selling.

---

## 3. Changes made

### 3.1 Elevation: ring, not drop shadow

Their card treatment is a 1px hairline ring at 6% plus two soft blurs at 2.5%
(`--shadow-pk-minimal-soft`, 36 uses). Ours was a conventional downward
shadow, which reads flat beside it. `--e1/--e2/--e3` now carry the ring, and
the ring flips to low-alpha **white** under `.dark` — a black ring is
invisible on a dark canvas.

The Tailwind `boxShadow` utilities previously held hard-coded `rgba()`, so
`shadow-md` painted a black shadow on the dark canvas regardless of theme.
They now point at the theme-aware vars.

`.market-card` had hard-coded its own `border` + `box-shadow` pair, so it
ignored the token scale entirely. It now uses `--e1`, and the ring *is* the
border.

### 3.2 Radius: three steps → six

Measured frequency on their landing: `7.2px` (172 uses), `5.2px` (134), `2px`
(105), `15.2px` (37), `9.2px` (31), `11.2px` (19), pill. We ran three steps,
which forces unrelated elements onto the same corner.

Tailwind's `xl` was an alias of `lg` at 11.2px — two scale steps collapsed into
one. `xl` now carries 15.2px, and `.market-card` uses it (their measured card
corner).

### 3.3 Motion: one canonical transition

753 of ~800 transitions on their landing are the *same* one: 150ms
`cubic-bezier(.4,0,.2,1)`. We declared three durations and two easings. `--dur`
drops 200ms → 150ms and `--transition` is the default pair to reach for.

### 3.4 Card rows: the probability is data, Yes/No are actions

Measured, a Polymarket card row reads:

```
Label ···················· 77%  [Yes] [No]
```

Ours read:

```
Label ·········· [Yes 78%] [No 22%]
```

78 and 22 are complements — they always sum to 100 — so the row printed the
same fact twice, in two tinted fills. That cost roughly 90px of row width and
truncated most labels in the grid: *Rigathi Gach…*, *Khaligraph J…*, *Equity
Grou…*. It also pushed the surface toward the casino register the design
system explicitly rules out.

The number now shows **once**, as plain bold text in the row's strongest
weight, and the chips carry only their action label. Every label in the grid
now fits.

### 3.5 Card: two structural defects

- A one-outcome card restated its own title in the row beneath it, truncated:
  *"Kenyan political hashtag hits #1 on X in 2026?"* over a row labelled
  *"Kenyan politi…"*. Suppressed when the label normalises to the title.
- `justify-content: space-between` floated a one-row card's body into the
  middle of a stretched grid cell, with dead air above and below. Content now
  stacks from the top; the footer carries `margin-top:auto`.

### 3.6 Rail rhythm

Their largest section heading is ~20px and they carry no uppercase eyebrow.
Ours were 27.2px stacked over an uppercase eyebrow — two lines and ~56px per
rail, across six rails. Headings are now 20px with the eyebrow inline as quiet
meta beside the title. The eyebrow keeps its words because some carry real
information (*"Most active · 24h"*).

Explainer-section padding dropped from `py-16 sm:py-24` to `py-12 sm:py-16`.

### 3.7 The explainer stack renders for signed-out visitors only

This is the 2,835px decision, and it is a judgement call, so it is written down.

Prediction markets are a new category for most Kenyan visitors, and the stack
explains M-Pesa deposits, selling before resolution, and who sets the price.
For a first-time visitor that is doing real work, and deleting it would be
wrong.

For a signed-in trader it is 40% of the page standing between them and markets
they already understand, on **every visit**. So it renders for signed-out
visitors only. The footer's "How it works" link still reaches it for everyone,
and `#how-it-works` still resolves.

---

## 4. Deliberately NOT done

### 4.1 Six rails were not consolidated

Polymarket runs **one** grid with a chip-rail filter. We run six rails —
*Browse · Featured events · Movers & hot topics · All events · Trending now ·
Just added* — over 3,300px, drawing from substantially the same inventory. A
market can appear three times before a visitor reaches the fold.

Consolidating them into one grid plus the chip rail we already have would be
the single largest remaining win. It is not done here because it is an
information-architecture change with editorial and merchandising consequences
(featured placement, creator promotion, "newest" discovery) that should be a
product decision, not a side effect of a design pass.

### 4.2 Yes/No was not removed from multi-outcome rows

Their multi-outcome rows carry **no** buy buttons at all — just
`avatar · name · sub-label · % · volume`. Ours carry Yes/No on every row.
Removing them would be the cleanest possible grid, but buy affordance on the
card is plausibly load-bearing for conversion (see
`BETTING-PANEL-CONVERSION.md`), and that trade is not mine to make silently.

### 4.3 Their chart palette was not copied

Their chart green `#42c772` is **2.18:1 on white** and fails WCAG 1.4.11 (3:1
for informational graphics). Copying it would have been a regression. Our
chart tokens clear 3:1 in both themes — see `01-POLYMARKET-GROUND-TRUTH.md`
§2.2.

---

## 5. Verification

- 1,593 unit tests pass; 284 token utilities resolve; lint and typecheck clean.
- Captured at 1440 light, 1440 dark and 390 touch.
- The signed-in gate was verified by forcing the flag and re-measuring
  (7,145px → 4,310px), then reverting.
