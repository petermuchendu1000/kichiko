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
