# 50 — Execution log for work plan v2

Actions taken on the owner's instruction "proceed with your recommendations" (2026-09-27).
Production changes are listed first, with how to reverse them.

## Production data

### L.1 — Two markets hidden (2026-09-27 10:14:32 UTC)

| Market | id | Open orders | Positions | Accounts |
|---|---|---|---|---|
| `ke-gachagua-appeal-upheld` | `e9397966-def9-4ae5-9e53-8a604f870754` | 47 (+1 cancelled) | 28 | 29 |
| `ke-gachagua-on-ballot-2027` | `469ccab2-f9ee-4779-b165-5258ccb2b9da` | 48 | 28 | 29 |

- **Why:** L.N. 112 of 2026, Reg. 45(7)(a) — no prediction market where the underlying event
  "concerns proceedings pending before a court in Kenya" (text verified, [33](research-v2/33-KENYA-LN112-EXCERPT.md)).
- **What:** `is_hidden = true`, `hidden_at = now()`, `hidden_reason` citing the regulation, and one
  `audit_log` row per market (`action = 'moderation.take_down'`, `actor_id = NULL`,
  `new_data.via = 'management-api (service), owner-approved'`). Identical in effect to
  `admin_moderate_content('market', id, 'take_down', reason)`, which could not be called directly
  because it requires a logged-in moderator (`auth.uid()`).
- **Verified:** the public (anon) REST read of both slugs returns `[]`.
- **Not done, needs a decision:** the 95 open orders and 56 positions are untouched. Hiding is
  money-neutral. Whether to cancel orders (releasing reserved funds) and void or resolve the markets
  is for the owner and counsel.
- **Known gap:** `place_order_for` does not check `is_hidden` (migration 104 checks the account,
  option and wallet), so a caller who knows the market id can still place orders through the API.
  A migration that rejects orders on hidden markets is proposed below, not applied.
- **To reverse:** in the admin moderation console choose Restore on each market, or call
  `admin_moderate_content('market', '<id>', 'restore')` as a moderator.

## Code (branch `claude/trusting-clarke-vi106v`; reaches users only when merged and deployed)

### L.2 — Promotional money framing removed; copy lint added
- Hero CTA "Predict & Earn" → "View market" (`components/layout/hero-section.tsx`).
- Home "Take your profit early … keep the profit" → "Sell before the end … which may be more or
  less than you paid" (selling exists, is never promoted: rule SE-1). The how-it-works step now
  states the loss in KSh ("you lose the KSh X you paid").
- "Invested" → "You paid" (`position-summary.tsx`, `holdings-table.tsx`); average price `52¢`
  (via `&#162;`) → `52%`.
- Referral copy promised "you both earn a bonus"; **no user-to-user referral bonus exists** — the
  `referral_bonus` transaction type is only used for marketer commission payouts (migration 013).
  Both strings now promise nothing. (The one `bonus` transaction in production, $90 on
  2026-07-28, is a manual admin balance adjustment.)
- `lib/__tests__/copy-lint.test.ts` fails on earn / income / invest / guaranteed / risk-free /
  get rich / double your / sure win, and on "profit" outside Profit/Loss reporting, in consumer
  copy and message catalogs. Proven to fail on the original hero CTA.

### Leaderboard — profit ranking taken down (decision 3: replace)
- There are **no resolved markets in production**, so an accuracy board has nothing to score yet.
  `/leaderboard` now explains the board is paused and returns as an opt-in accuracy board
  (noindex); `/api/leaderboard` returns **410**; links removed from navbar, More sheet, footer,
  sitemap, Lighthouse URL list; smoke test expects 410; e2e journey asserts no profit/win-rate text.
- "Biggest win" removed from public trader profiles.
- `lib/leaderboard.ts` and its tests kept for the accuracy board.
- **Gap:** the `get_leaderboard` RPC is still executable by `anon` directly through PostgREST.
  Closing it needs `REVOKE EXECUTE … FROM anon, authenticated` (proposed migration, not applied).

### 0.6 — Charts use complete, newest-anchored history (`556d8e4`)
See the commit. Verified on a production build against live data: the 2027-presidency chart's
x-axis now runs to **Aug** (its data ends 13 Aug); before, it stopped in June. The binary
market's chart ends in **Jul**, matching its latest row (24 Jul). Regression test fails on the old
code.

### Ticket, stake, notation, theme, search
- **Minimum stake KSh 20** (Act s.71(1), verified): `lib/stake.ts`; inline notice in all three
  ticket layouts ("The minimum stake is KSh 20."), submit disabled below it, and the order API
  returns 400 `below_minimum_stake` for a KES market buy under 20. Binding enforcement for every
  currency and order type needs the database check (proposed migration).
- **Quick amounts** KSh 20 / 50 / 100 / 200, **set** the stake (were additive USD conversions),
  44 px tall. **No pre-filled stake** on the desktop rail or after "Place another trade".
- **KSh spelling** everywhere via `formatCurrency` (Intl en-KE rendered "Ksh").
- **Whole-number probabilities** via `formatProbability` (ticket pills, receipt, best-ask line,
  candidate buttons).
- ¢ removed from the last rendered strings: error P0106 and the limit input's accessible name.
- **Theme follows the phone's setting** (`defaultTheme="system"`).
- **Search reads and writes `?q=`.**
- Browser-verified at 390×844 on a production build with live data: empty stake on open; chips
  `KSh 20/50/100/200` at 44 px; tapping KSh 50 twice gives 50; "KSh 15" shows the minimum notice;
  "To win KSh 636.56"; light OS → light theme, dark OS → dark; `/search?q=ruto` restores the query
  and results and typing updates the URL; `/leaderboard` paused, `/api/leaderboard` 410.

### L.3 — Reg. 45(7) subject screen and approval attestation
- `lib/markets/banned-subjects.ts` screens question, description and resolution text for the three
  barred subjects (court proceedings; safety/health/death of an identifiable person; national
  security/public order), English and Kiswahili. It over-flags by design: it triggers review, it
  does not decide.
- **Creation:** a flagged market is stored `pending` even when staff create it (staff used to
  publish straight to `active`); the flags are saved in `metadata.subject_screen`.
- **Approval:** `approve` now requires `attest_permitted_subject: true` (the admin UI shows the
  attestation text as a checkbox); a flagged market also needs a written reason. Both are written
  into the audited reason passed to `admin_approve_market`, e.g.
  `[Reg. 45(7) attested; flagged: court_proceedings] <reason>`.
- **Run against all 38 production markets:** 6 flagged — the two hidden court markets, plus
  `ke-2027-president` (text mentions a court), `ke-finance-bill-protests-2026` and
  `ke-genz-protest-h2-2026` (protests: possible public-order question), and
  `ke-hashtag-number-one-2026` (text mentions a protest). **Not hidden** — these are for counsel.
- Not done: `gra_approval_ref` on markets (Reg. 45(5)) waits for the owner's answer on GRA
  approval status (decision 2).

### L.4 — Minimum stake done; age gate blocked on a product decision
- Minimum stake: see "Ticket, stake, notation" above.
- **Uganda's minimum age of 25 verified first-hand**: Lotteries and Gaming Act 2016 s.1 ("'minor'
  means a person below twenty five years") and s.57(1) ("A licensee shall not accept payments from
  a minor"), from the regulator's PDF (lgrb.go.ug).
- `lib/eligibility.ts` (tested): KE 18, UG 25, TZ 18, RW 18; unknown country → 25.
- Terms, responsible-play page and footer now say "18 or older (25 in Uganda)".
- **Blocked:** the product captures no date of birth and requires no KYC before deposits, which
  conflicts with L.N. 112 Reg. 82 (verified first-hand). Enforcing any age rule needs electronic
  ID verification and a deposit gate that would stop current unverified users. Written up as D4 in
  [51-PROPOSED-DB-CHANGES](51-PROPOSED-DB-CHANGES.md), with D1–D3 (hidden-market orders, the
  stake minimum in every currency, and the leaderboard RPC grant).
