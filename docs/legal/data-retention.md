# Data Retention Policy

> **Launch template — pending legal review.** Defines how long Kichiko keeps
> each category of data and when it is deleted or anonymised.

_Last updated: July 2026_

## Principles
- Keep data only as long as necessary for the purpose collected.
- Retain financial/AML records for the legally mandated period even after account
  closure.
- Delete or anonymise once no legal/operational basis remains.

## Schedule (indicative — confirm against local law)

| Data category | Retention | Notes |
| --- | --- | --- |
| Account profile | Life of account + up to 30 days after closure | Then deleted/anonymised |
| KYC documents & results | Per AML law (commonly 5–7 years after relationship ends) | Legal obligation |
| Financial transactions (deposits, withdrawals, trades, ledger) | Per financial record-keeping law (commonly 5–7 years) | Legal obligation |
| Support communications | Up to 2 years | Service quality |
| Technical logs / telemetry | 30–90 days | Security & performance |
| Audit logs (admin actions) | ≥ 1 year (often longer) | Security/compliance |
| Marketing consent records | Until withdrawn + proof period | Consent evidence |
| Backups (PITR/snapshots) | Per backup policy window | See `docs/DR.md` |

## Deletion & anonymisation
- On a valid erasure request, we delete/anonymise data not subject to a legal
  hold; data under legal retention is restricted, not deleted, until the period
  lapses.
- Backups age out on their own cycle; restored data is re-subjected to deletion
  rules. See [data-subject-requests.md](./data-subject-requests.md).
