# Kichiko — Product Design Dossier
### Landing Page · Research, Analysis, Design System, Specification & Roadmap
**Prepared by:** Product Design Org (Principal PD · UX · Design Systems · Frontend Arch · Visual · Brand · A11y · SEO · Perf · Sr. Eng)
**Product:** Kichiko — an institutional-grade, Kenya-first prediction market for real-world event contracts.
**Status:** Phase 0 — Design foundations complete. Landing page implemented against this spec.

---

## 0. Positioning & Design North Star

> **"The clearest view of what happens next."**

Kichiko is a regulated, transparent prediction market built for East Africa first (KES-native, M-Pesa-ready, Swahili/English), engineered to institutional standards. The interface must read as **Bloomberg × Stripe × Linear** — a precision instrument for reading probability — and never as a casino.

**The one job of the interface:** make *probability* intuitive, trustworthy, and fast to act on.

Three non-negotiable emotional targets:
1. **Trust before money.** A first-time visitor understands *how markets resolve* and *who regulates us* before being asked to deposit.
2. **Calm liveness.** Data updates constantly, but the UI breathes — no flashing, no ticker anxiety.
3. **Effortless comprehension.** A newcomer reads one market card and can read every market on the platform.

---

## 1. Competitive Research

Primary sources: polymarket.com, kalshi.com, premiumblock.org, and the Avark 2026 prediction-market UX design guide (26-min field study across 100+ blockchain/fintech products). Findings below are synthesized, then improved upon — never imitated.

### 1.1 Polymarket — *content-first, news-like discovery*
**What it does:** Reframes prediction markets as a **news feed**, not a trading terminal. The market **card** is the atomic navigation unit — a prominent probability, color-coded outcomes, thumbnail, volume, time-to-close. Its 2026 redesign pushed the dense "All Markets" list to a secondary screen and elevated **probability curves and trading volume as the headlines** (Reuters-like, not crypto-exchange-like), with a Breaking-News rail for large probability jumps and a Hot-Topics module ranked by activity.

**Why it works:** Lowers the cognitive barrier — probability-as-news is instantly graspable. Cards create a consistent, learn-once/read-anywhere information structure that scrolls infinitely across categories.

**Weaknesses we improve on:**
- Card density tips into visual noise; hierarchy between "hero" and "list" markets is weak on smaller screens.
- Crypto-wallet mental model leaks through; trust/resolution info is not always above the fold.
- Aesthetic trends toward busy; whitespace is under-used for a "premium" read.

### 1.2 Kalshi — *regulation as a visible trust signal*
**What it does:** A CFTC-regulated, USD-only broker-like experience. Centralized dashboard: market overview + order panel + portfolio tracker; left watchlist rail, right account/exposure metrics with regulated limits. **Regulation is woven into the product, not buried in the footer.** Tiered KYC (browse → verify → higher limits). Contract pages lead with a probability chart, order book, and hoverable oracle/resolution details. In 2026 they began a **Bloomberg-Terminal-style** power-user interface (multi-position management, live trade tape, per-contract order books).

**Why it works:** Visible regulation converts skeptical, higher-value users. Progressive disclosure serves beginners and pros from one IA. Broker familiarity reduces onboarding friction for a mainstream audience.

**Weaknesses we improve on:**
- Broker-terminal density is intimidating for first-timers; discovery is weaker than Polymarket.
- Visuals are utilitarian — trustworthy but not *memorable* or crafted.
- Two audiences (retail vs. power) are being split into two UIs; a single, progressively-disclosed system is cleaner.

### 1.3 PremiumBlock — *non-custodial, permissionless, wallet-native*
**What it does:** On-chain, self-custody, no-KYC hub bundling user-created prediction markets, up to 2.5× leverage, perps, and Web3 poker; USDC settlement across Ethereum/Arbitrum/Base; 5-minute crypto markets; permissionless market creation via a USDC bond.

**Why it works (for its audience):** Maximal self-sovereignty and speed for crypto-natives; permissionless creation deepens the long tail of markets.

**Weaknesses / what Kichiko deliberately rejects:**
- No-KYC + leverage + poker reads as **casino** and carries regulatory and responsible-gaming risk — the opposite of our trust-first, regulated posture.
- Wallet-native onboarding excludes the mainstream East-African user we serve (M-Pesa, KES, mobile-first).
- Bundling gambling products dilutes the "credible information instrument" positioning.

### 1.4 Cross-cutting UX principles (industry state of the art, 2026)
1. **Probabilistic clarity, not data dump** — natural language first ("72% chance") with cent price secondary; probability *timeline* charts over candlesticks for consumer audiences; **resolution criteria prominent, above the fold.**
2. **Progressive disclosure** — Layer 1 everyone (event · probability · Yes/No), Layer 2 engaged (chart · trade history · position sizing), Layer 3 power (order book · depth · specs · export).
3. **Trust made visible** — resolution sources, settlement transparency, regulatory signalling, market-depth/social proof, audit trails.
4. **Onboarding *is* the product** — explore-before-committing; gate the *trade action*, not browsing; minimize steps-to-first-trade as a core KPI; tiered identity (T0 browse → T1 email → T2 basic KYC → T3 full KYC).
5. **Real-time without anxiety** — animate probability transitions 200–300ms (roll, don't jump); desaturated directional color used sparingly; "updated 3s ago" liveness cues; notification-driven re-engagement on >5% moves.
6. **Dual-format probability** — percentage + cent price together; multi-outcome markets use a proportional color-coded bar with hover-revealed exact values.
7. **Cards must degrade gracefully** — desktop card (thumbnail + sparkline + trade) collapses to event + probability + one action on mobile.

### 1.5 Kichiko' differentiated position
| Axis | Polymarket | Kalshi | PremiumBlock | **Kichiko** |
|---|---|---|---|---|
| Trust model | Crypto/oracle | CFTC regulated | Non-custodial | **Regulated + transparent LMSR, resolution above the fold** |
| Audience | Crypto-native, global | US retail/pro | Crypto-native | **East-Africa mainstream, mobile-first, KES/M-Pesa** |
| Aesthetic | Busy, news-like | Utilitarian broker | Casino-adjacent | **Institutional-calm, crafted, memorable** |
| Onboarding | Embedded wallet | KYC→bank | Wallet/no-KYC | **Browse free → tiered KYC → M-Pesa deposit** |
| Pricing | Order book | Order book | AMM+leverage | **LMSR, explained in plain language** |
| Responsible play | Minimal | Disclosures | Absent | **First-class: limits, self-exclusion, visible** |

**Conclusion:** Own the space Kalshi gestures at but doesn't craft, and Polymarket makes legible but not premium: a **beautifully restrained, trust-forward, mobile-first instrument** for a market (East Africa) the incumbents ignore.

---

## 2. Design System — "Pip"

A complete design language precedes implementation. Everything below is tokenized and implemented as CSS custom properties in the landing page build.

### 2.1 Brand identity
- **Name:** Kichiko. A *pip* is the smallest price increment in FX — precise, technical, credible. Doubly meaningful as a single data point on a probability line.
- **Logo mark:** the **Pip** — a precise square tick sitting on a baseline, with a short rising stem, evoking both a tick mark and a rising probability point. Constructed on an 8px grid, single weight, optically centered. Never stretched, rotated, or gradient-filled.
- **Wordmark:** "Kichiko" — grotesque, tight tracking (-0.02em), "Pips" is not colored differently (restraint over gimmick); an optional single accent pip may replace the dot of the mark.
- **Voice:** precise, plain, confident. Numbers do the talking. Never hype ("moon", "win big"); never fear.
- **Clear space:** ≥ height of the mark on all sides. **Min size:** 20px mark / 96px lockup.

### 2.2 Color system
Cool graphite neutrals (not pure gray), one confident brand blue, desaturated market semantics to defuse ticker anxiety, one restrained brass accent for moments of emphasis.

**Neutrals — "Slate"**
| Token | Hex | Use |
|---|---|---|
| ink-950 | `#0A0C10` | dark bg / light-mode text max |
| ink-900 | `#111419` | dark surface |
| ink-800 | `#1A1F27` | dark elevated surface |
| ink-700 | `#2A303B` | borders (dark), text (light) |
| ink-600 | `#3C4453` | secondary text (light) |
| ink-500 | `#5A6473` | muted text |
| ink-400 | `#808A99` | placeholder / disabled |
| ink-300 | `#AAB2BF` | hairline (light) |
| ink-200 | `#D2D7DE` | borders (light) |
| ink-100 | `#E8EBEF` | subtle fills |
| ink-50  | `#F5F7FA` | app background (light) |
| paper   | `#FFFFFF` | cards / paper |

**Brand — "Pip Blue"** (confident, slightly indigo cobalt; not Tailwind blue-500)
`600 #1E44C9` · `500 #2B50E4` (core) · `400 #5C82F2` · `300 #A9C0FB` · `100 #E7EEFE`

**Accent — "Brass"** (used ≤5% of surface, emphasis only)
`600 #B57E22` · `500 #D9A036` · `100 #F7ECD4`

**Market semantics** (desaturated — never neon)
- YES / up: `#1F9D6B` (green-600 `#177C54`, tint `#E3F3EC`)
- NO / down: `#D1495B` (red-700 `#B23446`, tint `#FBE7EA`)
- Warning: `#C98A1E` · Info: Pip Blue 500 · Neutral change: ink-500

**Data-viz ramp** (categorical, colorblind-checked): Pip Blue 500 → Teal `#1E9C9C` → Brass 500 → Violet `#7A5AF0` → Clay `#D1495B` → Slate 500. Probability lines use a single brand-blue with area-fill at 8% alpha; up/down segments only where directional meaning exists.

**Contrast:** all text ≥ WCAG AA (4.5:1 body, 3:1 large). Semantic colors paired with icon/shape, never color-alone.

### 2.3 Typography
- **UI / headings:** *Hanken Grotesk* — refined humanist grotesque, warm but neutral; tight tracking on headings.
- **Numerics / prices / tickers:** *IBM Plex Mono* with `font-variant-numeric: tabular-nums` — Bloomberg-grade alignment for probabilities, prices, volume.
- **Fallback stack:** `-apple-system, "Segoe UI", Roboto, sans-serif`.

**Type scale** (1.200 minor-third, 16px base, clamps for fluid):
| Role | Size / line | Weight | Track |
|---|---|---|---|
| Display | clamp(2.5–4rem) / 1.05 | 700 | -0.03em |
| H1 | 2.25rem / 1.1 | 700 | -0.02em |
| H2 | 1.75rem / 1.15 | 650 | -0.02em |
| H3 | 1.25rem / 1.25 | 600 | -0.01em |
| Body-lg | 1.125rem / 1.6 | 400 | 0 |
| Body | 1rem / 1.6 | 400 | 0 |
| Small | 0.875rem / 1.5 | 450 | 0 |
| Caption | 0.75rem / 1.4 | 500 | 0.01em |
| Mono-data | tabular, 500 | — | 0 |

### 2.4 Spacing & grid
- **Base:** 8px system with 4px sub-step. Scale: `2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128`.
- **Grid:** 12 columns, max content `1200px` (wide sections `1320px`), gutter `24px`, page margin `clamp(20px, 5vw, 48px)`.
- **Vertical rhythm:** section padding `clamp(64px, 9vw, 128px)`.

### 2.5 Elevation, radius, borders
- **Radius (restrained):** inputs/buttons `8px`, cards `12px`, modals `16px`, pills/tags `999px`. **No oversized 24px+ card radii.**
- **Borders:** 1px hairlines are the primary separator (`ink-200` light / `ink-700` dark). Structure with lines, not shadows.
- **Elevation (3 levels, subtle):**
  - E1 card: `0 1px 2px rgba(10,12,16,.04), 0 0 0 1px hairline`
  - E2 popover: `0 4px 16px rgba(10,12,16,.08)`
  - E3 modal: `0 16px 48px rgba(10,12,16,.16)`
  - No colored glows, no glassmorphism.

### 2.6 Iconography (custom, not Lucide)
- **Grid:** 24px, **1.5px** stroke, round joins, geometric construction, 2px keyline padding.
- **Motif:** every icon incorporates the "pip" language — square terminals, a baseline reference, a rising tick where sensible.
- Custom-drawn inline SVG (search, markets, shield/trust, chart, wallet/M-Pesa, bell, globe/i18n, chevrons). Never ship a recognizable stock icon set as the visible brand.

### 2.7 Motion
- **Durations:** micro 120ms, standard 200ms, entrance 280ms. **Easing:** `cubic-bezier(.2,0,0,1)` (decelerate) for entrances; `cubic-bezier(.4,0,.2,1)` for moves.
- **Signature interaction:** probability **rolls** from old→new value over 240ms (never jumps); a subtle +/- badge fades in on change; "updated Ns ago" pulses gently.
- **Discipline:** motion communicates state or continuity only — never decoration. Full `prefers-reduced-motion` support disables rolls/parallax.

### 2.8 Components (library)
Buttons (primary/secondary/ghost/destructive · sm/md/lg · loading), inputs & selects, **Market Card** (hero / standard / compact/mobile variants), **Probability Bar** (binary + multi-outcome), **Sparkline / Probability Timeline**, ticker/marquee, category chips, stat/metric block, trust badge, disclosure/accordion, tabs, tooltip/popover, toast, skeleton loaders, empty/success/error states, nav (desktop + mobile drawer), footer, cookie/responsible-play banner. Each has default/hover/focus-visible/active/disabled/loading states and dark-mode counterparts.

### 2.9 Data visualization language
- Probability timeline = single brand-blue line, 8%-alpha area fill, tabular-mono axis labels, hover crosshair with exact % + timestamp.
- Binary market = horizontal proportional bar (YES green / NO red desaturated) with % labels; multi-outcome = stacked proportional bar, hover reveals exact contract price.
- No 3D, no gratuitous gradients, no dual-axis clutter. Chart type chosen to communicate *uncertainty*, not decorate.

### 2.10 Accessibility (WCAG 2.2 AA+)
Semantic landmarks; visible `:focus-visible` ring (2px Pip Blue, 2px offset); full keyboard operability; target size ≥ 44×44; color never sole carrier of meaning; live regions announce probability updates politely; reduced-motion honored; dark/light both AA; `lang` + hooks for `sw`/`en`.

### 2.11 Responsive breakpoints
`xs <480 (mobile-first base) · sm 480 · md 768 · lg 1024 · xl 1280 · 2xl 1536`. Design at 375px first, enhance upward. Never fixed pixel widths on layout containers.

### 2.12 SEO strategy
SSR/SSG for landing + market pages; one `<h1>`; semantic outline; JSON-LD (`Organization`, `WebSite`+SearchAction, `FAQPage`, `BreadcrumbList`); descriptive `<title>`/meta/OG/Twitter; `hreflang` en/sw; canonical; fast LCP hero (no client-only render); descriptive alt text; sitemap + robots.

### 2.13 Performance strategy
Targets: **LCP < 2.0s, INP < 200ms, CLS < 0.05** on a mid-range Android over 3G-fast (our core device). Techniques: SSR hero, `font-display: swap` + preloaded/subset fonts, self-hosted variable fonts, inline critical CSS, defer non-critical JS, no layout shift (reserve card/media dimensions), inline SVG (no icon-font network cost), image `srcset`/AVIF, route-level code splitting, CDN edge caching. Data updates via lightweight polling/WebSocket with `requestAnimationFrame`-batched number rolls.

---

## 3. Landing Page — Specification

**Process followed (no step skipped):** Research → Requirements → User goals → IA → User flow → Wireframe → Layout spec → Component spec → Design/A11y/SEO/Perf review → Implementation → Self-review → Iteration.

### 3.1 Requirements & user goals
Primary visitor = curious, mobile-first East-African newcomer, skeptical about fairness/legality.
- **G1** Understand *what Kichiko is* in <5 seconds.
- **G2** See real markets and live probability immediately (proof it's alive).
- **G3** Trust it: how markets resolve, who regulates, that funds/withdrawals are safe (M-Pesa), responsible-play is first-class.
- **G4** Understand pricing (LMSR) in plain language.
- **G5** Convert: "Explore markets" (no-friction) primary; "Create account" secondary.
Business: maximize explore-rate; qualified sign-ups; communicate compliance to regulators.

### 3.2 Information architecture (section order = trust-first funnel)
1. **Top nav** — logo · Markets · How it works · Trust · About · [Sign in] · **[Get started]**; mobile drawer.
2. **Hero** — value prop headline + subhead + primary/secondary CTA; **live featured market card** (probability timeline, YES/NO, animated %); trust strip (Regulated · KES/M-Pesa · Transparent resolution).
3. **Live market ticker** — horizontal marquee of real markets with rolling probabilities (liveness proof).
4. **Category browse** — Politics · Economy · Sports · Climate · Tech · Culture (custom chips).
5. **Featured markets grid** — standard market cards with sparklines, volume, time-to-close.
6. **How it works** — 3 steps (Explore → Take a position → Get paid on resolution), progressive disclosure.
7. **Pricing explained (LMSR)** — plain-language "how prices = probability", with a small interactive illustration.
8. **Trust & transparency** — resolution sources, licensing/regulation, funds safety, tiered KYC, audit trail; responsible-play commitment.
9. **By the numbers** — volume, active markets, participants, payout speed (tabular-mono metrics).
10. **Get the app / access** — mobile-first CTA (M-Pesa).
11. **Final CTA band.**
12. **Footer** — product, markets, company, legal (Terms/Privacy/Responsible Play), compliance, language (EN/SW), social; responsible-gaming + age (18+) line.

### 3.3 Wireframe (desktop, ASCII)
```
┌───────────────────────────────────────────────────────────┐
│ [◪ Kichiko]  Markets  How it works  Trust  About   [Sign in] [Get started] │
├───────────────────────────────────────────────────────────┤
│  The clearest view of what          ┌───────────────────┐  │
│  happens next.                       │ Will CBK cut rates│  │
│  Trade real-world events with        │ by Sept? ▁▃▅▆▇ 68%│  │
│  transparent, regulated markets.     │ [ YES 68¢ ][NO 32¢]│ │
│  [ Explore markets ]  [ Get started ]│ Vol KES 4.2M · 3d  │  │
│  ● Regulated  ● KES/M-Pesa  ● Fair resolution └──────────┘  │
├───────────────────────────────────────────────────────────┤
│  ‹ live ticker: mkt 71% ▲ · mkt 44% ▼ · mkt 90% ▲ · … ›     │
├───────────────────────────────────────────────────────────┤
│  Browse:  Politics  Economy  Sports  Climate  Tech  Culture │
├───────────────────────────────────────────────────────────┤
│  Featured markets      [card] [card] [card]                 │
│                        [card] [card] [card]                 │
├───────────────────────────────────────────────────────────┤
│  How it works   ① Explore   ② Take a position   ③ Get paid  │
├───────────────────────────────────────────────────────────┤
│  Why prices are probabilities (LMSR, plain language)  [viz] │
├───────────────────────────────────────────────────────────┤
│  Trust & transparency  [resolution][regulation][funds][RG]  │
├───────────────────────────────────────────────────────────┤
│  By the numbers   KES 240M   1,280 markets   84k traders    │
├───────────────────────────────────────────────────────────┤
│  Final CTA:  Start with what you know.  [ Explore markets ] │
├───────────────────────────────────────────────────────────┤
│  Footer  (product · markets · company · legal · EN/SW · 18+)│
└───────────────────────────────────────────────────────────┘
```

### 3.4 Component spec highlights
- **Market card (standard):** category chip + time-to-close (top row); question (H3, 2-line clamp); probability timeline sparkline; binary probability bar; YES/NO buttons with cent price + %; footer row = volume (mono) + participants. Hover: E1→E2 lift, sparkline gains crosshair. Mobile: question + % + single "View" action.
- **Probability display:** big tabular-mono % (animated roll) with secondary "68¢" cent price; +/- desaturated badge on change.
- **Trust badge:** shield-pip icon + label; links to the relevant policy.
- **CTA buttons:** primary = Pip Blue 500 solid; secondary = ghost with hairline; both 44px min height, focus-visible ring.

### 3.5 Reviews (gate before ship)
- **Design:** hierarchy leads with probability; whitespace generous; one accent (Brass) used sparingly; no generic hero gradient; icons custom. ✔
- **A11y:** AA contrast in both themes; keyboard path through nav→CTAs→cards; focus-visible rings; reduced-motion disables rolls; semantics + landmarks; 44px targets. ✔
- **SEO:** single h1, semantic sections, JSON-LD (Organization + WebSite + FAQ), meta/OG, hreflang hooks. ✔
- **Perf:** SSR-friendly static markup, inline SVG, system-font fallback + swap, no CLS (reserved dimensions), JS deferred, rolls via rAF. ✔

---

## 4. Implementation Roadmap

**Phase 0 — Foundations (this dossier):** research, design language "Pip", tokens, landing page. ✔
**Phase 1 — Design tokens → code:** export tokens to CSS vars + Tailwind theme + TS token module; Storybook of core components (Button, MarketCard, ProbabilityBar, Sparkline, TrustBadge); visual-regression (Chromatic) + axe CI.
**Phase 2 — Market discovery:** markets index (filter/sort: trending/volume/liquidity/newest/ending), category pages, search, live data layer (WebSocket + rAF number rolls), skeleton/empty states.
**Phase 3 — Market detail:** probability timeline (1h/1d/1w/all), resolution criteria above the fold, dual-format pricing, progressive disclosure (order depth/specs), position sizing.
**Phase 4 — Onboarding & money:** tiered KYC (T0→T3), M-Pesa deposit/withdraw, wallet/portfolio, responsible-play controls (limits, cooldown, self-exclusion) as first-class UI.
**Phase 5 — Trust & compliance surfaces:** resolution/audit views, regulatory pages, docs, localization EN/SW, RTL-readiness.
**Phase 6 — Perf & launch hardening:** Core Web Vitals budget in CI, Lighthouse gates, a11y audit, SEO/sitemap, staged Kenya-first rollout behind feature flags.

**Definition of done (every page):** passes Design/A11y/SEO/Perf gates; tokens-only styling (no magic values); reusable components (no duplicated logic); dark+light; keyboard + screen-reader verified; CWV within budget.

---
*This document is the single source of truth for Kichiko visual + interaction language. The landing page in `/kichiko-landing/` is implemented directly against these tokens and specs.*
