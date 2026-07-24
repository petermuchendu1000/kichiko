# Milestone 4 — Passwordless email OTP (in-dialog code)

Status: implemented · Extends: M3 AuthDialog · Surface: market → order-ticket gate

## Why
The lowest-friction way to authenticate a new guest is no password at all. But a
**magic link** would defeat M3's whole premise — it opens the user's inbox in a
new tab and navigates them away from the market. So we use a **6-digit email
code entered inside the dialog**: the guest requests it, alt-tabs to their mail
app, reads the number, types it back — the market and their ticket never leave
the screen.

## Flow
```
[form]  email (+ name/country for register)
        │  "Email me a code"  → signInWithOtp({ email, shouldCreateUser: mode==='register', data })
        ▼
[otp]   "Enter your code · we emailed a 6-digit code to you@x.com"
        big numeric input · Verify & continue · Resend · ← Use a different email
        │  auto-verify on 6th digit → verifyOtp({ email, token, type:'email' })
        ▼
   session live → onAuthStateChange re-enables the ticket (bet intact) → dialog closes
```
- **Register via code**: profile metadata (`display_name`, `country_code`,
  `preferred_currency`, `referral_code_used`) is passed on the OTP request so the
  account is created complete on first verify. `shouldCreateUser` is `true` only
  for register — sign-in never silently creates an account.
- **Auto-submit**: verifying fires the instant a full 6-digit code is present
  (paste or last keystroke), guarded by a ref so it can't double-submit.
- **Password path unchanged**; passwordless is an additive "OR" option on both tabs.

## Shared logic (`lib/auth-form.ts`, pure + unit-tested)
- `OTP_LENGTH = 6`, `sanitizeOtpInput` (digits only, capped), `isCompleteOtp`.
- `canRequestCode(mode, {name,email})` — email plausible; register also needs a name.
- `normalizeAuthError` extended for expired/invalid codes → *"That code is invalid
  or has expired. Request a new one."*

## Accessibility
- Focus moves to the code field on entering the OTP step.
- `inputMode="numeric"`, `autoComplete="one-time-code"` (iOS/Android SMS-style
  autofill for the email code), `maxLength=6`, `aria-describedby` → error, `sr-only`
  label. Error is `role="alert" aria-live="assertive"`. Esc / scrim / focus-trap
  from M3 still apply.

## ✅ Supabase configuration (codified — no manual dashboard step)
The old default **Magic Link** template rendered `{{ .ConfirmationURL }}` (a
link), which is exactly why sign-in emails arrived as a *link* and no *code* —
issues #1 and #2. The fix is now checked into the repo as Infrastructure-as-Code:

- **`supabase/templates/magic_link.html`** — branded template that renders
  **`{{ .Token }}`** (the 6-digit code) and *no* `ConfirmationURL`.
- **`supabase/config.toml`** — `[auth.email.template.magic_link]` points at that
  file; `otp_length = 6`, `otp_expiry = 3600` pin a 6-digit, 60-minute code.
- **Client** — `requestCode()` calls `signInWithOtp` **without** `emailRedirectTo`,
  so Supabase never mints a magic-link URL; the email is code-only. `verifyOtp({
  type: 'email' })` validates the typed token.

Apply to any environment with:

```bash
supabase link --project-ref <ref>   # once per env
supabase config push                # syncs auth config + email templates
```

Local `supabase start` picks it up automatically. There is intentionally **no
magic link** in the email anymore — the code is the single, in-dialog path, so a
guest never leaves the market they were betting on.

## Tests
- **+5 unit** (`auth-form`): `sanitizeOtpInput`, `isCompleteOtp`, `canRequestCode`
  (login/register), OTP error mapping. Suite: **682 unit tests** green.
- **+2 e2e** (`auth-modal`, chromium+mobile) with the Supabase OTP/verify endpoints
  **network-mocked** (no real emails): request-code → OTP entry transition; verify
  gating + auto-submit → error path. Suite: **19 e2e** green.
- Local gates: `tsc` clean · `next lint` clean · prod build green · visual review.

## Follow-ups
- Cooldown/countdown on "Resend code" (rate-limit friendliness).
- Phone (SMS) OTP once an SMS provider is wired (natural fit for M-Pesa users) —
  requires Supabase phone auth + Twilio/Africa's Talking.
