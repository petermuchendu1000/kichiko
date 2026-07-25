# Friction & Dead-End Audit

Every point in the product where a user could get stuck without a clear next
step. Principle: **never dead-end — always show what happened and what to do
next.** Status: ✅ fixed this pass · ⬜ open (prioritized P1–P3).

_Last updated: 2026-07-25._

## Money path (highest impact)
1. ✅ **Trade — insufficient balance (client check).** Was: "Insufficient
   balance" and stop. Now: opens the deposit sheet prefilled with the exact
   shortfall + explains why. (`pm-ticket` buy branch.)
2. ✅ **Trade — insufficient balance (server 402).** Fees/reserve can push the
   true cost just over a balance that passed the client check. Now the 402
   response also opens the deposit sheet.
3. ✅ **Trade — order errors were all generic 500** ("Failed to place order").
   Fixed the SQLSTATE mapping so users see the real reason (insufficient
   balance, market closed, etc.). (`clobErrorFor`, prior commit.)
4. ✅ **Deposit sheet — silent failure.** Any error just reset the form with no
   message. Now surfaces the exact API error (min amount, bad phone, gateway
   down) with an alert + retry; network errors too.
5. ✅ **Deposit sheet — wrong currency label.** Hardcoded "Amount (KES)" while
   submitting the user's preferredCurrency. Now labelled with the real currency.
6. ✅ **Trade — "no ask liquidity"** message softened to actionable copy.
7. ✅ **No user-facing withdraw UI.** Added a WithdrawSheet (navbar dropdown +
   `marketpips:open-withdraw` event): shows available balance + Max, validates
   amount ≤ balance, surfaces every rejection reason (min, insufficient,
   suspended, review hold), routes to `/kyc` when `kyc_required`, and offers
   "Deposit first" at zero balance. DB reserve path verified E2E (funded
   reserves + fee/net; unfunded → P0006). Live disbursement still needs the B2C
   initiator + security credential (see GO-LIVE-PROVISIONING.md).
8. ⬜ **[P2] Deposit success is a dead "Check your phone" screen.** No STK
   status polling; the user doesn't learn if it succeeded without leaving. Poll
   deposit status and reflect pending/credited in the wallet + a toast.
9. ⬜ **[P2] Deposit quick-amounts are KES-only** (500/1k/2k/5k) regardless of
   currency; make presets currency-aware.
10. ⬜ **[P2] Deposit phone** has no format validation/help and doesn't default
    from the profile country; add validation + country prefix.
11. ⬜ **[P3] Portfolio has no deposit/withdraw buttons** — funding is only
    reachable from the navbar. Add primary actions on `/portfolio`.

## Auth / identity
12. ✅ **Sell tab — "Log in to view positions"** was dead text; now a button
    that opens the in-context auth dialog.
13. ⬜ **[P2] "Add funds" while logged out** should open auth first, then the
    deposit sheet (currently opens deposit which then needs auth).
14. ⬜ **[P2] Full-page `/auth/login`** offers only password; the dialog also
    offers an email code. Align surfaces so neither is a lesser path.
15. ⬜ **[P2] KYC** — after submitting (status `pending`) the wizard should
    route the user back to what they were doing (resume the pending action),
    not leave them on a confirmation.
16. ⬜ **[P1] Withdraw KYC gate is deferred** (commented in the API). When
    enabled it must return `kyc_required` and the UI must route to `/kyc` with a
    clear "verify to withdraw" message rather than a bare 403.

## Markets / trading
17. ✅ **Closed/resolved market ticket** showed a message with no next step; now
    has a "Browse open markets" CTA.
18. ⬜ **[P2] "Account is not active" (403 on trade)** dead-ends; explain why and
    link to support / the relevant remediation.
19. ⬜ **[P2] Fresh market with no resting asks** — market buys can't fill and
    buys are market-only; offer a limit-buy path so the user can still act.
20. ⬜ **[P3] Market detail empty states** (no positions / no activity / no
    comments) are fine but could nudge the first action.

## Cross-cutting
21. ⬜ **[P2] Rate-limited (429)** responses surface generic errors; show a
    "please wait a moment" message with a disabled-then-enabled retry.
22. ⬜ **[P2] Network errors** on actions (trade, deposit) show a message but no
    explicit Retry button; add one.
23. ⬜ **[P3] Todifferentiate "loading" vs "empty"** on slow lists so a slow
    fetch doesn't read as an empty dead-end.
24. ⬜ **[P3] Success confirmations** should offer the obvious next step (after a
    trade: "View in portfolio"; after deposit: "Place your order").
25. ⬜ **[P3] Dead import cleanup** (`IconWithdraw` in navbar) once the withdraw
    UI lands.

## Notes
Many empty states already guide well (markets, home, holdings, profile, search,
admin queues all have CTAs), so the concentration of real dead-ends is in the
money and identity flows above.
