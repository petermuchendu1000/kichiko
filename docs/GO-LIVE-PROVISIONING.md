# Go-Live Provisioning Status

Live configuration applied to the hosted Supabase project (ref
`uzkphkvzoeypcljntlih`) and its database during setup. Secrets are NEVER stored
in this repo; this file records what was set and where, plus the remaining
go-live steps. Values are referenced by last-4 only.

_Last updated: 2026-07-25._

---

## 1. Auth emails (Supabase Auth)

Applied via the Management API (`PATCH /v1/projects/{ref}/config/auth`):

| Setting | Value | Notes |
|---|---|---|
| `mailer_otp_length` | `6` | Was `8`. The in-app dialog accepts exactly 6 digits, so 8-digit codes could never be entered. Now matched. |
| `mailer_otp_exp` | `3600` | 60-minute single-use code. |
| `site_url` | `https://marketpips.co.ke` | Was `http://localhost:3000` (broke every link email + OAuth redirect). |
| `uri_allow_list` | `https://marketpips.co.ke/**, https://www.marketpips.co.ke/**` | Redirect allow-list. |
| Email templates (all 6) | branded, from `supabase/templates/*.html` | `magic_link` + `reauthentication` render a CODE; `confirmation`, `recovery`, `email_change`, `invite` are links. |
| Custom SMTP | Resend (`smtp.resend.com:465`, user `resend`, sender `noreply@marketpips.co.ke`) | Required on the free tier to use custom templates at all. |

### PENDING before emails deliver (test after go-live)
- **Verify the sending domain in Resend.** The Resend account (`cosialm22@gmail.com`)
  has **no verified domain**, so sends from `noreply@marketpips.co.ke` are rejected
  (`403 domain not verified`) and the key can currently only send to the account
  owner's own address. In Resend > Domains, add `marketpips.co.ke`, publish the
  SPF + DKIM (and optional MX) DNS records it shows, and click Verify. Until then
  **no auth emails (or app notification emails) will be delivered.**
- After the domain is verified, send a real sign-in code to confirm the branded
  code email arrives end to end.
- This is intentionally left configured for the target state (code-based,
  branded) because the domain/system is not live yet.

---

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
| STK callback | `https://marketpips.co.ke/api/webhooks/mpesa` |
| B2C result URL | `https://marketpips.co.ke/api/webhooks/mpesa-b2c` |
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
  `https://marketpips.co.ke` first.
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
