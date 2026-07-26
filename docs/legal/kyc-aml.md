# KYC / AML Posture

> **Launch template — pending legal & compliance review.** Summarises Kichiko'
> Know-Your-Customer and Anti-Money-Laundering approach.

_Last updated: July 2026_

## Objectives
Prevent fraud, money laundering, and underage/prohibited use, and meet East-
African financial regulations.

## Customer due diligence (CDD)
- **Identification:** collect and verify government ID; capture name, DOB,
  country, and phone.
- **Risk-based levels:** basic access for browsing/deposits; **verified KYC
  required to withdraw** and above activity/amount thresholds.
- **Enhanced due diligence** for higher-risk profiles or large flows.

## Ongoing monitoring
- Transaction monitoring for unusual patterns (velocity, structuring, mismatched
  identities).
- Sanctions/PEP screening where applicable.
- Re-verification when details change or risk indicators appear.

## Controls in the platform
- KYC gating enforced in the withdrawal flow (Module 8).
- Admin review workflow with per-capability RBAC (`kyc:review`) and **audit
  logging** of every decision.
- Money-path operations are atomic and ledgered; admin balance adjustments are
  capability-gated and audited.
- Withdrawal **limits** per transaction/period.

## Record-keeping
KYC and transaction records retained per law — see
[data-retention.md](./data-retention.md).

## Reporting
Suspicious activity is escalated and reported to the relevant authority as
required by law. Freeze/suspension procedures: `docs/RUNBOOK.md` (money-path
freeze).

## Age & eligibility
18+ (or local legal age); prohibited where not permitted by law. See
[terms.md](./terms.md) and [responsible-play.md](./responsible-play.md).
