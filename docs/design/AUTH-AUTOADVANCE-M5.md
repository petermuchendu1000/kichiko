# Milestone 5 — Post-auth auto-advance + exact-stake funding

Status: implemented · Extends: M3/M4 auth · Surfaces: order ticket + deposit sheet

## Why
M3/M4 removed the navigation and the password. The last friction between a guest
and their first position is the **gap after auth**: they were bounced to nothing,
had to find the Trade button again, and — if their new wallet was empty — had to
open funding manually and re-key the amount. M5 closes that gap: the moment a
guest returns authenticated on a staged bet, we advance them straight to the
action.

## Behaviour
On the guest→authenticated transition (set when `goToAuth` runs, consumed once
`user` is present **and** wallets have loaded):

- **Funded** (`balance ≥ stake`) → scroll the primary **Trade** CTA into view and
  focus it. One tap places the bet. We deliberately **do not** auto-execute a
  real-money order — the final confirmation always stays with the user (blast
  radius / reversibility).
- **Underfunded** → open the deposit sheet **prefilled with the exact shortfall**
  (`kichiko:open-deposit` with `{ amountLocal }`), so the user tops up precisely
  what the stake needs and nothing more.

This runs for both auth paths:
- **Modal (M3/M4)** — no remount; the new `awaitingAuth` effect drives it.
- **Redirect/email-confirmation (M1)** — the existing `resumePay` effect drives it,
  now also carrying the exact shortfall into the deposit sheet.

## Funding math (`lib/funding.ts`, pure + unit-tested)
`planFunding(balance, amount) → { funded, shortfall }`:
- funded when `balance ≥ amount` (or stake is 0);
- shortfall = `ceil(amount − balance)` (mobile money can't take fractions; a tiny
  over-top-up is always safe);
- bad/negative/non-finite inputs floor to 0 — never a negative shortfall, never a
  false "funded".

## Deposit prefill (`navbar` DepositSheet)
`kichiko:open-deposit` now accepts an optional `{ amountLocal }`. The navbar
reads it, `ceil`s it, and seeds the sheet's amount (Pay button reflects it, e.g.
"Pay KES 300"). No detail → empty sheet (unchanged behaviour for the header
"Deposit" button).

## Safety
- No automatic order placement — ever. The auto-advance only *positions* the user
  at the CTA or the funding step.
- Idempotent: `awaitingAuth` is consumed once; re-renders/balance updates can't
  re-fire the advance.
- Guarded on `selectedOutcome` so we never advance a half-built ticket.

## Tests
- **+4 unit** (`funding`): funded / exact-shortfall (rounded) / zero-stake /
  bad-input flooring. Suite: **686 unit tests** green.
- **+2 e2e** (`auth-modal`, chromium+mobile): `open-deposit` with an amount
  prefills the sheet ("300" + "Pay KES 300"); without an amount opens empty.
  Suite: **23 e2e** green.
- `tsc` clean · `next lint` clean · prod build green.

## Follow-ups
- After a successful deposit, optionally return focus to the ticket and re-assert
  the CTA (deposit completion is async via M-Pesa STK push, so this needs a
  wallet-balance subscription — out of scope here).
- A subtle "ready to place" affordance (pulse) on the focused CTA.
