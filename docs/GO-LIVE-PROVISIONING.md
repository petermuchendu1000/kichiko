# Go-Live Provisioning Status

Live configuration applied to the hosted Supabase project (ref
`uzkphkvzoeypcljntlih`) and its database during setup. Secrets are NEVER stored
in this repo; this file records what was set and where, plus the remaining
go-live steps. Values are referenced by last-4 only.

_Last updated: 2026-07-25._

---

## 1. Auth emails (Supabase Auth)

> **CORRECTED 2026-10-16.** The table below previously claimed these values were
> applied in July. They were **not** — the live config was read back during the
> Fly go-live and every branded field still pointed at **MarketPips**, the
> project's pre-rename identity:
>
> | setting | found live (2026-10-16) | now set to |
> |---|---|---|
> | `site_url` | `https://marketpips.co.ke` | `https://elopis.com` |
> | `uri_allow_list` | `https://marketpips.co.ke/**,…` | `https://elopis.com/**,https://www.elopis.com/**` |
> | `smtp_sender_name` | `MarketPips` | `Elopis` |
> | `smtp_admin_email` | `noreply@marketpips.co.ke` | `noreply@elopis.com` |
> | 5 subjects + 6 HTML templates | all "MarketPips" | all "Elopis", pushed from `supabase/templates/*.html` |
>
> Either the July change was never applied or the rename overwrote it. The
> consequence was not cosmetic: every magic link and confirmation email would
> have sent users to **marketpips.co.ke**, and because `elopis.com` was absent
> from the redirect allow-list, a return to our own site would have been
> **rejected**. The repo's templates were already correctly Elopis-branded —
> only the live project was stale.
>
> Lesson for this file: it records intent, and intent is not state. Read the
> live config back before trusting any row here.

Applied via the Management API (`PATCH /v1/projects/{ref}/config/auth`):

| Setting | Value | Notes |
|---|---|---|
| `mailer_otp_length` | `6` | Matches the in-app dialog, which accepts exactly 6 digits. |
| `mailer_otp_exp` | `3600` | 60-minute single-use code. |
| `site_url` | `https://elopis.com` | **Verified live 2026-10-16.** |
| `uri_allow_list` | `https://elopis.com/**, https://www.elopis.com/**` | **Verified live 2026-10-16.** |
| Email templates (all 6) | branded Elopis, from `supabase/templates/*.html` | `magic_link` + `reauthentication` render a CODE (`{{ .Token }}`); the rest are links (`{{ .ConfirmationURL }}`). Verified: 11 branded fields Elopis, 0 MarketPips. |
| Custom SMTP | Resend (`smtp.resend.com:465`, user `resend`, sender `noreply@elopis.com`) | Required on the free tier to use custom templates at all. |
| `mailer_autoconfirm` | `true` | Sign-up does not wait on a clicked link; magic-link/OTP sign-in still needs mail to deliver. |

### STILL PENDING — Resend domain verification
The DNS is now live and correct (zone moved to Cloudflare 2026-10-16; DKIM TXT,
`send` + `rsend` CNAMEs and DMARC all resolving). What remains is pressing
**Verify** on the domain in the Resend dashboard. Until Resend marks
`elopis.com` verified, sends from `noreply@elopis.com` are rejected and **no
auth email is delivered**, so nobody can sign in with a code.

## 2. M-Pesa (Safaricom Daraja) - PRODUCTION

Configured in the database (`payment_gateways` + encrypted `gateway_secrets`),
which is how the app resolves gateway config (`lib/payments/mpesa.ts` ->
`getGatewayConfig`). Nothing is hardcoded in the repo.

| Field | Value |
|---|---|
| provider / country / currency / env | `mpesa` / `KE` / `KES` / `production`, enabled |
| Business shortcode (paybill) | `4326383` |
| Base URL | `https://api.safaricom.co.ke` |
| Transaction type | `CustomerPayBillOnline` |
| STK callback | `https://elopis.com/api/webhooks/mpesa` |
| B2C result URL | `https://elopis.com/api/webhooks/mpesa-b2c` |
| Consumer key | set (`...bAGE6Nl2C`) |
| Consumer secret | encrypted (`...mYXv`) |
| Passkey | encrypted (`...8ea7`) |

**Verified:** the production Consumer Key/Secret authenticate successfully
against `https://api.safaricom.co.ke/oauth/v1/generate` (live access token
returned).

### PENDING before M-Pesa is fully live
- **Set `PAYMENTS_ENV=production`** in the production host environment
  (Vercel/Fly). The resolver defaults to `sandbox`; only `production` selects the
  gateway above. Real money will not move until this is set.
- **Register the callback URLs with Safaricom** (C2B Register URL) so STK
  confirmations reach `/api/webhooks/mpesa`. Requires the app to be live at
  `https://elopis.com` first.
- **B2C withdrawals** additionally need `initiator_name` and an encrypted
  `security_credential` (the initiator password encrypted with Safaricom's
  production public cert). These are not yet set; deposits (STK) work without
  them, withdrawals do not.
- **Harden the gateway encryption key.** Secrets are encrypted with pgcrypto
  using the key from the `app.gateway_encryption_key` GUC, which cannot be set on
  Supabase-managed Postgres from the SQL role, so the migration fallback key is
  currently in effect. Set a strong key via Supabase support / project settings
  and re-enter the M-Pesa secrets through the admin gateway console afterwards.

---

## 3. Credential rotation
All credentials shared in chat during setup (GitHub PAT, the original Supabase
DB password / publishable / secret keys, and the M-Pesa keys) should be rotated
per the owner's stated intent. The M-Pesa secrets live only in the encrypted
`gateway_secrets` table and can be rotated from the admin gateway console.
