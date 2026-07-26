# Kichiko — Whole-System Copy & Terminology Spec (for one-time approval)

**Purpose:** One document covering every page so you can approve once, then I implement it all.
**Decisions applied** (from your answers):
1. **Event** replaces **Market** across all UI **and** routes (`/markets → /events`, with redirects).
2. **KES only**, USD hidden everywhere. 3. Money format **`KSh 1,250`**.
4. Prices shown as **probability %** (e.g. `65%`); KSh still used for the money you pay / receive.
5. **bet → prediction** everywhere. 6. Simplify **user-facing** pages; **admin stays professional** (mechanical changes only). 7. Remove em dashes from **all user-facing text** now. 8. **English only** for now. 9. This **one doc → you approve → I implement**.

> **How to read this:** Sections A–C are the global rules that apply to *every* string automatically.
> Section D is the page-by-page copy (user-facing) with notable **current → new** lines. Section E is
> admin (mechanical only). Section F is the short list of **things I need you to confirm**.

---

## A. Global terminology map (applies to every user-facing string)

| Current | New |
|---|---|
| market / markets (noun, UI) | **event / events** |
| Markets (nav label) | **Events** |
| Create market | **Create an event** |
| Browse markets / Search markets | **Browse events / Search events** |
| Market not found | **Event not found** |
| Create the first market | **Create the first event** |
| bet (verb) | **predict** |
| a bet (noun) | **a prediction** |
| betting | **predicting** (see Section F for harm-context lines) |
| position / holdings | **prediction(s)** / **what you hold** |
| P&L / P&amp;L | **profit or loss** |
| resolve / resolution / settles | keep on detail pages, but pair with plain wording ("when the event is decided") |

**Routes:** `app/markets/` → `app/events/`; `/markets`, `/markets/[slug]`, `/markets/create` →
`/events`, `/events/[slug]`, `/events/create`, with **301 redirects** from the old paths so existing
links/bookmarks keep working. **Internal identifiers stay the same** (DB table `markets`, `/api/markets…`,
slugs, code) to keep the change low-risk — only the user-visible route and UI text change.

## B. Currency & price rules (every money/price string)

- **KES only.** Any `$`/USD shown to a user becomes **KES**, formatted **`KSh 1,250`** (symbol first, thousands separators, no decimals for whole shillings).
- Values stored in USD (e.g. `total_volume_usd`, balances) are **converted via the live `exchange_rates` KES rate** before display (same approach already used on the landing).
- **Prices / odds → probability %** on market cards, the buy/sell ticket, and the detail page (e.g. `65%`). The **amount you pay and the amount you win stay in `KSh`** (e.g. "Pay KSh 65", "You win KSh 100").
- Remove any cents/`¢` or USD price framing.

## C. Punctuation / voice

- **Em dashes (—) removed** from all user-facing text (UI strings + aria-labels). Replaced with a period, comma, colon, or parentheses so the sentence still reads well. (Code comments untouched.)
- **User-facing pages:** short, everyday words; short sentences (Standard-8 reading level).
- **Admin pages:** keep current professional wording; apply only the mechanical changes (Event, KES, prediction, em-dash).

---

## D. Page-by-page (user-facing) — notable current → new

### D1. Top nav (`navbar.tsx`)
| Current | New |
|---|---|
| Search markets… | Search events… |
| Markets / Leaders (nav) | Events / Leaders |
| Balance / Available | Balance / Available (values now in `KSh`) |
| Deposit / Withdraw | Deposit / Withdraw *(keep — already correct terms)* |
| Deposit Funds · "Instant via M-Pesa · MTN · Airtel" | Deposit · **"Instant via M-Pesa"** *(only M-Pesa is live — see F)* |
| Withdraw Funds · "To M-Pesa · MTN · Airtel" | Withdraw · **"To M-Pesa"** |
| "Sign in to add funds to your wallet" | "Sign in to deposit to your wallet" |
| Funds added / View portfolio / Deposit not completed | Money added / View portfolio / Deposit not completed |
| "Large payouts may be held for a short review…" | keep (plain enough); values in KSh |
| Portfolio / Profile / Verify Identity / Settings / Sign out / Sign in / Get started | keep |

### D2. Bottom nav (`bottom-nav.tsx`)
- `Markets → Events`. Keep: Home, Search, Breaking, More, Leaderboard, Portfolio, Notifications, Profile, Verify Identity, Settings, Sign out.

### D3. Category bar (`home-category-bar.tsx`)
- aria "Browse markets by category" → "Browse events by category". Keep "Trending" + category names.

### D4. Events list (`markets/page.tsx` → `/events`)
| Current | New |
|---|---|
| Create market | Create an event |
| Couldn't load markets | Couldn't load events |
| Something went wrong fetching markets. Please try again. | Something went wrong loading events. Please try again. |
| Create the first market | Create the first event |
| Sort: Best match / Most volume / Closing soon / Newest / Most traders | Best match / **Most traded** / Closing soon / Newest / Most people |
| Status: Open / Resolved / Closed | **Open / Decided / Closed** |
| Reset / Clear filters / Prev / Next | keep |

### D5. Event detail (`markets/[slug]/page.tsx` → `/events/[slug]`)
- "Market not found" → "**Event not found**". Prices → `%`; amounts → `KSh`; "resolution/resolves" paired with "when the event is decided". (Detail page pulls many sub-components — all get the global rules.)

### D6. Create event (`markets/create/page.tsx` → `/events/create`)
- "Sign in to create a market" → "Sign in to create an event". Form labels get Event + plain wording.

### D7. Portfolio (`portfolio/page.tsx`)
| Current | New |
|---|---|
| My Portfolio | My Portfolio *(or "My predictions" — see F)* |
| Holdings | **What you hold** |
| Realized P&L (settled) | **Profit or loss (settled)** |
| Recent activity | Recent activity |
| Open / Refunded | Open / Refunded |
- All money in `KSh`; "positions" → "predictions".

### D8. Leaderboard (`leaderboard/page.tsx`)
- Description: "The top traders on Kichiko — ranked by volume, win rate and profit & loss…" →
  "**The top players on Kichiko, ranked by how much they have traded, their win rate, and profit or loss (all-time, this month, this week).**" (em dash removed; plain).

### D9. Search (`search/page.tsx`)
- "Search prediction markets on Kichiko by keyword, category and status." → "**Search events on Kichiko by word, topic and status.**"

### D10. Help (`help/page.tsx`)
| Current | New |
|---|---|
| How betting works | **How predicting works** |
| "Find something to trade on." | "**Find an event to predict on.**" |
| "Track positions and P&L." | "**See what you hold and your profit or loss.**" |
| "Trading involves real risk — only stake what you can afford to lose." | "**This is real money and real risk. Only stake what you can afford to lose.**" |
| Money / Contact support / Play responsibly / Policies / Terms / Privacy | keep |
| support@kichiko.app | **support@kichiko.co.ke** *(matches DB `branding.support_email` — see F)* |

### D11. Verify identity (`kyc/page.tsx`)
- Keep: "Identity verified", "Under review", "Your documents are encrypted and private." (already plain).

### D12. Legal — Terms (`legal/terms/page.tsx`)
- Section headings keep. "Trades involve real money and real risk of loss." → "**Predictions involve real money and a real risk of loss.**" "All trades are final once confirmed…" → "**All predictions are final once confirmed, until the event is decided.**" (Legal tone kept; bet/trade → prediction.)

### D13. Legal — Privacy (`legal/privacy/page.tsx`)
- Mostly keep (already clear). "trades, balances" → "predictions, balances". "settle trades" → "settle predictions". No em dashes present.

### D14. Legal — Responsible play (`legal/responsible-play/page.tsx`) — **see F for bet-grammar**
| Current | New (proposed) |
|---|---|
| Only stake what you can afford to lose. | keep |
| Never bet essential funds. | **Never stake money you need for essentials.** |
| Betting more than you planned or can afford. | **Staking more than you planned or can afford.** |
| Borrowing money to bet, or hiding your betting. | **Borrowing money to play, or hiding it.** |
| No guaranteed income / Don't chase losses / Take breaks | keep |
| "Tools we offer" (request via Help) | keep (accurate: request-based) |

### D15. Auth — Login (`auth/login/page.tsx`)
- "Welcome back" / "Sign in to your Kichiko account" keep. "Get a 6-digit sign-in code by email" keep. "End-to-end encrypted · No credit card needed" → "**Safe and private · No credit card needed.**"

### D16. Auth — Register (`auth/register/page.tsx`)
- "Create your account" / "Free to join · No credit card needed" / "Check your email" / "Your data is encrypted and never shared" keep (plain). Placeholder "John Kamau" keep (localised name — good).

### D17. Auth — Reset password (`auth/reset-password/page.tsx`)
- Keep (already plain): "Choose a new password", "Forgot your password?", "Send reset link", "Reset links are single-use and time-limited", etc. Em dashes removed.

### D18. Trader profile (`traders/[id]/page.tsx`)
- "Trader not found" → "**Player not found**" *(or keep "Trader" — see F)*. Money → `KSh`. Keep "Predictions", "Biggest win", "Positions value" → "**Value of what they hold**".

### D19. Offline (`offline/page.tsx`)
- "You're offline" keep.

### D20. Profile / Notifications / Settings (delegated client components)
- Titles keep; internal labels get the global rules (Event, KES, prediction, em-dash) during implementation.

### D21. Market card (`components/markets/market-card.tsx`)
- "Live" / "Settling…" keep; "Settling…" → "**Deciding…**" (plainer). Volume `$` → `KSh`. Price → `%`. "Rewards available on this market" → "Rewards available on this event".

### D22. Buy/sell ticket (`components/trading/market-drawer.tsx`)
- "chance" / "Yes" / "No" keep. Price → `%`; cost & payout → `KSh`. Any "bet" → "prediction". Buttons: **Buy / Sell** (kept as everyday finance terms). Back / Share / Bookmark / Embed keep.

---

## E. Admin (mechanical only — no voice rewrite)
Across all `/admin/**` pages and admin components, apply **only**: `market → event`, `bet → prediction`,
USD → `KSh`, and em-dash removal in user-facing admin strings. **Wording, structure, and technical
labels stay as-is** (e.g. "Ledger", "Disputes", "Gateways", "KYC", "Payouts", "Audit log" remain).

---

## F. Please confirm these judgment calls (I'll default as noted if you don't object)

1. **"trade / trading"** — not covered by "bet → prediction". On **user pages** I plan to prefer
   plain wording ("buy or sell", "predict", "traded"). **Default: soften on user pages, keep on admin.**
2. **Responsible-play harm lines** — "predict" is wrong there ("never predict essential funds"). I'll use
   **"stake / play"** (see D14). Confirm that reading is OK.
3. **Payment methods** — the deposit/withdraw modals say "M-Pesa · MTN · Airtel", but only **M-Pesa** is a
   live gateway. **Default: show M-Pesa only** (accurate). Say if MTN/Airtel are coming and should stay.
4. **support email** — code says `support@kichiko.app`; DB says `support@kichiko.co.ke`.
   **Default: use `…co.ke`** (matches the DB and the `.co.ke` domain used elsewhere).
5. **"Trader" vs "Player"** — leaderboard/trader pages. **Default: "player"** on user pages (less jargon);
   keep "trader" in admin. Or keep "trader" everywhere — your call.
6. **"Portfolio"** — keep as-is (widely understood) or rename to **"My predictions"**. **Default: keep "Portfolio"** in nav, use "My predictions" as the page subtitle.
7. **Route rename blast radius** — I will rename the **page route** `/markets → /events` (+redirects) and keep **API routes and DB** as `markets`. Confirm you don't also want `/api` + DB renamed (bigger, riskier).

---

## G. Rollout (after approval)
1. Global find/replace pass (Event, prediction, KES, price %) across `apps/web` user-facing code.
2. Route move `app/markets → app/events` + `next.config` redirects + update all `href="/markets…"`.
3. Per-page plain-language edits per Section D.
4. Admin mechanical pass (Section E).
5. Em-dash sweep on user-facing strings.
6. `tsc`/build check locally where possible; commit in small, reviewable chunks to `main`; **CI green before each merge**.
