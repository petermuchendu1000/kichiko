# Polymarket's Page Architecture, and What We're Missing — 2026-10-15

Measured, not inferred. Capture method as in `01-POLYMARKET-GROUND-TRUTH.md`.

---

## 1. How their landing actually works

Whole page, 1440×1000, `scrollHeight` **3,363px**:

| y | block |
|---|---|
| 0 – 116 | nav (68px bar + 48px category rail), sticky, never collapses |
| 116 – 744 | hero carousel (left) + Breaking News / Hot topics (right rail) |
| **744** | **`All markets`** — 20px/600, the page's only market heading |
| 744 – 2699 | the grid, plus a news feed in the right rail |
| **2699 – 3363** | **footer, 664px** |

**There is no explainer content anywhere on it.** Every `<p>` between the grid
and the footer is a news headline. No "how it works", no steps, no trust
section, no stats strip, no closing CTA band.

### Where their teaching lives

| URL | Result |
|---|---|
| `polymarket.com/how-it-works` | **HTTP 404** — but still serves `<title>How It Works Prediction Markets & Live Odds 2026 \| Polymarket` |
| `learn.polymarket.com` | **302 → `docs.polymarket.com/polymarket-101`** |
| `docs.polymarket.com/polymarket-101` | 4,967px, 962 words. Headings: Self-Custody · How Polymarket Works · **Prices Are Probabilities** · Collateral and Tokens |

Education is a **separate documentation domain**, reached from a footer "Learn"
link. It is deliberately not competing with the markets for landing-page space.

---

## 2. Their footer is a product surface, not a legal afterthought

664px, four groups:

| Group | Contents |
|---|---|
| **Markets by category and topics** | **14 SEO links** — "Tesla Roadster Predictions & odds", "UCL Matchday Predictions & odds", "Derivatives…", "Fable…", "Iran…", "Yemen…", "Ballon d'Or…", "AI…", "Israel Election…", "Serbia Elections…", "Trump…", "Spain Elections…", "MLB Playoffs…", "Cockroach Party…" + **View more** |
| **Support & Social** | Learn · 𝕏 (Twitter) · Instagram · Discord · TikTok · News · Contact us · Help Center · Status |
| **Polymarket** | Rewards · APIs · Leaderboard · Institutional · Accuracy · Brand · Activity · Careers · Press |
| **Legal row** | Privacy · Terms of Use · Market Integrity · Transparency · Help Center · Docs |

Plus the tagline *"The World's Largest Prediction Market™"*.

The first group is the important one. Every link is a `<topic> Predictions &
odds` landing target — this is how they harvest organic search for the long
tail of topics. It is a growth mechanism sitting in the footer.

---

## 3. What we had, and what changed today

Our landing, signed-out, before: **5,659px / 1,062 words**.

| section | height | words |
|---|---|---|
| hero · movers · grid | 2,050px | 502 |
| Three easy steps | 518px | 122 |
| Buy or sell any time | 419px | 68 |
| People set the price, not us | 624px | 100 |
| Safe, clear, and fair | 600px | 82 |
| stats strip | 200px | 15 |
| Ready to try? (CTA) | 462px | 30 |
| **explainer subtotal** | **2,823px** | **417** |

Those five sections duplicated `/help`, which already carried the same four
topics — *How predicting works*, *Money*, *Play responsibly*, *Policies* — in
one short paragraph each.

**Moved, not deleted.** `components/content/how-it-works.tsx` now renders on
`/help`. The landing lost exactly 417 words; `/help` gained exactly 417.

| | before | after |
|---|---|---|
| landing | 5,659px / 1,062 w | **2,834px / 645 w** |
| /help | 1,913px / 343 w | 5,280px / 760 w |

The landing is now **shorter than Polymarket's 3,363px**, and the signed-out
cookie gate is gone — it existed only to hide that stack.

Three queries went with the stats strip: a 1,000-row `total_volume_usd` scan,
an exact active-market count, and an `exchange_rates` read, all on every
landing render.

---

## 4. What we are missing

Our footer is 603px, three groups:

| Group | Contents |
|---|---|
| Events | All events · Create an event · Search |
| Account | Get started · Sign in · My predictions · Verify identity |
| Help & legal | Terms · Privacy · Responsible play · Help |

### 4.1 Gaps that cost us growth

1. **No SEO topic surface.** They run 14 `<topic> Predictions & odds` links; we
   run zero. We already have the categories (`politics`, `economics`, `sports`,
   `crypto`, `technology`, `weather`, `business`, `entertainment`) and the
   routes (`/markets?category=…`), so the links can be real today. Longer term
   these want dedicated pages with their own `<title>`/`<meta>`.
2. **`/leaderboard` exists and is linked from nowhere in the footer, and is
   absent from `sitemap.ts`.** A built page that search engines are not told
   about.
3. **`/traders/[id]` and `/search` are also missing from the sitemap.**
4. **No social links at all.** They carry five (𝕏, Instagram, Discord, TikTok,
   News). For a Kenyan launch, WhatsApp and X are the relevant pair.

### 4.2 Gaps in trust and operations

5. **No status page**, no "Contact us" link in the footer (the support email is
   only reachable by opening `/help`), no Careers/Press.
6. **No Market Integrity / Transparency page.** They have both, and for a
   money product in a new market these carry weight disproportionate to their
   size.
7. **No public API or docs destination.** They list APIs, Institutional and
   Docs.

### 4.3 The one real functional gap

8. **News attached to markets.** Their landing carries a feed of genuine
   journalism — *Reuters・22h ago*, *Bloomberg.com・1d ago*, *BBC・1d ago*,
   *CNN・5d ago*, *The New York Times・1d ago* — where each headline links to
   **the market it moves**, not to the article.

   Our "Breaking News" rail is `movers.map(...)`: markets ranked by probability
   change, relabelled. Their equivalent rail is also markets, so that part is
   parity — but the journalism feed has no counterpart here, and the database
   has no table for it (52 tables, none news-shaped). This needs ingestion
   (RSS or a news API) plus a market-to-article association, so it is a backend
   feature rather than a design change.

---

## 5. Recommended order

| # | Change | Cost | Why |
|---|---|---|---|
| 1 | Footer: add topic links, social, leaderboard, contact | small | pure growth and discoverability, all targets already exist |
| 2 | `sitemap.ts`: add `/leaderboard`, `/search`, trader pages | tiny | built pages search engines cannot see |
| 3 | Category landing pages with their own metadata | medium | turns footer links into real SEO targets |
| 4 | Market Integrity / Transparency page | small | trust, disproportionate weight for a new money product |
| 5 | Status page | medium | needs uptime plumbing |
| 6 | News ingestion + market association | large | the only true functional gap; needs a pipeline and a table |

Items 1 and 2 are mechanical and carry no design risk. Item 6 is the one that
would put us ahead rather than at parity — and it is the one nobody in this
category does well outside Polymarket.
