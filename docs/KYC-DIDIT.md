# Identity verification (Didit)

Replaces the manual upload-and-review KYC flow. Migration `123_didit_verification.sql`.

## Flow

```
/kyc  About you -> Address -> ID check
                                 |
                                 v  POST /api/kyc/session
                       verify.didit.me (hosted: document, liveness, face match)
                                 |
            +--------------------+--------------------+
            v                                         v
   POST /api/webhooks/didit                  GET /api/kyc/session  (browser poll)
            |                                         |
            +------------> syncSession() <------------+
                                 |
                      rpc apply_didit_decision()
                 kyc_documents + profiles.kyc_status + notification
```

Both doors re-read the decision from Didit with our API key. Neither trusts a
request body or a query string, so a forged webhook cannot verify an account.
Verified by test: a correctly signed body claiming `"status":"Approved"` left
the profile `unverified`, because the live session said `Not Started`.

The poll exists because a webhook alone is one mis-configuration away from
leaving a verified user on "we're checking" forever.

## Environment

| Variable | Where from |
|---|---|
| `DIDIT_API_KEY` | Console, API & Webhooks. Server-side only. |
| `DIDIT_WORKFLOW_ID` | `GET /v3/workflows/` with the API key. |
| `DIDIT_WEBHOOK_SECRET` | Console, the destination's shared secret. |

`/api/webhooks/didit` answers **503** without the secret rather than trusting
the body. 503 and not 200, so Didit keeps retrying and nothing is lost.

## Which workflow

| Workflow | Checks | Price |
|---|---|---|
| Free KYC `3403dcb7…` | OCR, liveness, face match, IP analysis | $0.00 - 0.33 |
| KYC + AML `c3566d80…` | the same, plus sanctions and PEP screening | $0.42 - 0.65 |

Currently set to **Free KYC**. KYC + AML returns
`"You don't have enough credits"` until the Didit account is topped up.

AML screening is what POCAMLA 2009 expects of a platform moving money, and it
is the one control nobody here can perform by hand. Top up and switch:

```
flyctl secrets set DIDIT_WORKFLOW_ID=c3566d80-4a95-4d87-808f-90318adfd98a -a elopis-prod
```

Nothing else changes: `summariseChecks` already renders an AML row when one is
present, and `declineReason` already names it.

## Console setup

1. **Webhook** → API & Webhooks → add `https://elopis.com/api/webhooks/didit`,
   copy the shared secret into `DIDIT_WEBHOOK_SECRET`.
2. **Workflows are in `draft`.** Sessions still run and pin to `version: 1`, so
   this is not blocking, but publish them before relying on versioning.
3. **White label is off** (`is_white_label_enabled: false`), so the hosted page
   carries Didit branding.

## What is deliberately not stored

Didit's media URLs are presigned and expire. `stripMedia()` removes every
`*_image`, `video_url`, `source_image` and `target_image` before the decision
is written, so `kyc_documents.provider_decision` holds the extracted fields,
per-check statuses and scores, and nothing that will be a dead link next week.
Reviewers fetch fresh links through `provider_session_id`.

This also means no identity document ever lands in our storage bucket, which
is the cheapest way to satisfy DPA 2019 storage limitation.

## Status mapping

| Didit | Ours | Effect |
|---|---|---|
| Approved | `verified` | profile verified, notification, draft cleared |
| Declined | `rejected` | reason from the failing checks, user may retry |
| In Review | `pending` | goes to `/admin/kyc` with the vendor's findings |
| Kyc Expired | `unverified` | re-verify, not a rejection |
| everything else | *no decision* | draft status only |

`In Progress` maps to nothing on purpose. `/kyc` routes `pending` to a terminal
"under review" screen, so flipping the profile when someone opens the camera
would strand them mid-scan with no way back in.

A later non-verified decision never walks a verified account backwards; that is
a case for a reviewer, not an automatic revocation.

## Gotchas found while building this

- `expected_details.country` wants **alpha-3**. Sending our `CHAR(2)` gets a
  400 on every session. `issuing_state` comes back alpha-3 too. Converted
  through `lib/kyc/iso-country.ts`, never truncated: `DEU` to `DE` and `CHE` to
  `CH` are both wrong that way.
- Feature blocks are **plural arrays** (`id_verifications`), not the singular
  objects the v2 docs show. Reading the singular yields `undefined` for every
  field and writes a row with no document number, silently.
- Scores are not on one scale. Didit's own examples show liveness as both
  `0.98` and `89.92`, so they are displayed, never compared to a constant.
- `X-Signature-Simple` is **not accepted**. It signs only
  `{timestamp}:{session_id}:{status}:{webhook_type}` and does not cover the
  decision body, so a replayed envelope with a swapped `decision` would verify.
