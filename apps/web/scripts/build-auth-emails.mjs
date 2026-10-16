// scripts/build-auth-emails.mjs
// ---------------------------------------------------------------------------
// Generate the six Supabase auth email templates from ONE design source.
//
// WHY A GENERATOR AND NOT SIX HAND-WRITTEN FILES
//
// They were six hand-written files, and they drifted: all six were still the
// pre-rename dark design (#0b0f14 card, #3ddc84 green code, a 🎯 emoji for a
// logo) months after the product became white-and-blue with a real brand mark.
// Six copies of a layout are six places to forget. This writes them from the
// same tokens and the same shell as the notification emails, so "the Elopis
// email look" has exactly one definition.
//
//   node scripts/build-auth-emails.mjs           # write supabase/templates/*.html
//   node scripts/build-auth-emails.mjs --push    # ...and PATCH them into Supabase
//
// Supabase renders these with Go's text/template, so `{{ .Token }}` and
// `{{ .ConfirmationURL }}` must survive verbatim — they are injected raw below,
// never through the HTML escaper.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const { C, FONT, MONO } = await import('../lib/notifications/templates/tokens.ts')

const APP = process.env.NEXT_PUBLIC_APP_URL || 'https://elopis.com'
const LOGO = `${APP}/icon-192.png`

/** The same shell as the notification mail, minus the blocks it does not need. */
function shell({ title, preheader, inner }) {
  return `<!doctype html>
<html lang="en" style="margin:0;padding:0;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .e-canvas { background:#0B0D0F !important; }
    .e-card   { background:#1A1C1F !important; border-color:#484E56 !important; }
    .e-text   { color:#F3F5F8 !important; }
    .e-text2  { color:#C2C7CE !important; }
    .e-text3  { color:#9AA1AB !important; }
    .e-rule   { background:#484E56 !important; }
    .e-code   { background:#0B0D0F !important; border-color:#484E56 !important; color:#F3F5F8 !important; }
  }
  @media only screen and (max-width:480px) {
    .e-card { width:100% !important; border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
    .e-pad  { padding-left:24px !important; padding-right:24px !important; }
    .e-code { font-size:30px !important; letter-spacing:8px !important; }
  }
</style>
</head>
<body class="e-canvas" style="margin:0;padding:0;background:${C.canvas};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="e-canvas" style="background:${C.canvas};">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="e-card" style="width:600px;max-width:100%;background:${C.paper};border:1px solid ${C.hairline};border-radius:8px;">
        <tr><td class="e-pad" style="padding:28px 40px 0 40px;">
          <!-- The colour is stated even though the only child is an image: an
               anchor with no colour inherits the client's default link blue
               (measured rgb(0,0,238)), and several clients paint that as a
               border or focus ring around a linked image. -->
          <a href="${APP}" style="text-decoration:none;display:inline-block;color:${C.text};">
            <img src="${LOGO}" width="36" height="36" alt="Elopis" style="display:block;width:36px;height:36px;border:0;outline:none;text-decoration:none;border-radius:8px;">
          </a>
        </td></tr>
        <tr><td class="e-pad" style="padding:22px 40px 0 40px;">
          <div class="e-rule" style="height:1px;background:${C.hairline};font-size:0;line-height:0;">&nbsp;</div>
        </td></tr>
${inner}
        <tr><td class="e-pad" style="padding:6px 40px 32px 40px;">
          <div class="e-rule" style="height:1px;background:${C.hairline};font-size:0;line-height:0;margin:0 0 18px 0;">&nbsp;</div>
          <p class="e-text3" style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.text3};">
            Elopis &middot; prediction markets for East Africa
          </p>
          <p class="e-text3" style="margin:0;font-family:${FONT};font-size:11px;line-height:1.6;color:${C.text3};">
            18+. Predict responsibly. Elopis will never ask for your password, PIN or M-Pesa code by email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`
}

const head = (title, sub) => `        <tr><td class="e-pad" style="padding:26px 40px 0 40px;">
          <h1 class="e-text" style="margin:0 0 10px 0;font-family:${FONT};font-size:21px;line-height:1.35;font-weight:600;letter-spacing:-.2px;color:${C.text};">${title}</h1>
          <p class="e-text2" style="margin:0 0 22px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text2};">${sub}</p>
        </td></tr>
`

/** The 6-digit code. The only place a monospace face is used. */
const code = () => `        <tr><td class="e-pad" style="padding:0 40px 24px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" class="e-code" style="background:${C.surface};border:1px solid ${C.hairline};border-radius:8px;padding:22px 16px;font-family:${MONO};font-size:34px;line-height:1;font-weight:600;letter-spacing:10px;color:${C.text};">{{ .Token }}</td></tr>
          </table>
        </td></tr>
`

/**
 * EVERY EMAILED LINK POINTS AT ELOPIS.COM.
 *
 * Supabase's `{{ .ConfirmationURL }}` resolves to
 * `https://<project-ref>.supabase.co/auth/v1/verify?token=…&redirect_to=…`.
 * On a password-reset mail that is the exact shape of a phishing attempt — an
 * unfamiliar third-party host asking you to re-set credentials — and the
 * template prints it in full as copyable text, so the recipient reads the
 * strange domain whether or not they click. It also publishes the project ref
 * to every recipient, and a From/link domain mismatch is a signal spam filters
 * weigh, which matters most while a domain is new and has no reputation.
 *
 * `{{ .TokenHash }}` carries the same one-time token to our own route
 * (app/auth/confirm/route.ts), which verifies it server-side. Same security
 * properties — single use, same 60-minute expiry, the token never leaves the
 * link — and the recipient only ever sees elopis.com.
 *
 * `{{ .SiteURL }}` rather than a baked-in host, so a non-production project
 * cannot email links that point at the live site.
 */
const confirmUrl = (type, next) =>
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}` +
  (next ? `&amp;next=${encodeURIComponent(next)}` : '')

const cta = (label, type, next) => `        <tr><td class="e-pad" style="padding:0 40px 26px 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" bgcolor="${C.brand}" style="background:${C.brand};border-radius:6px;">
              <a href="${confirmUrl(type, next)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px;">${label}</a>
            </td></tr>
          </table>
        </td></tr>
`

/** The link as text, for clients that strip the button. */
const fallbackLink = (type, next) => `        <tr><td class="e-pad" style="padding:0 40px 22px 40px;">
          <p class="e-text3" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.text3};word-break:break-all;">
            Or paste this link into your browser:<br>${confirmUrl(type, next)}
          </p>
        </td></tr>
`

const note = (html) => `        <tr><td class="e-pad" style="padding:0 40px 22px 40px;">
          <p class="e-text3" style="margin:0;font-family:${FONT};font-size:13px;line-height:1.65;color:${C.text3};">${html}</p>
        </td></tr>
`

const IGNORE = 'If you did not request this, you can safely ignore this email.'

const TEMPLATES = {
  magic_link: {
    subject: 'Your Elopis sign-in code',
    file: 'magic_link.html',
    title: 'Your sign-in code',
    preheader: 'Use this code to finish signing in to Elopis.',
    sub: 'Enter this code to finish signing in. It expires in 60 minutes and can be used once.',
    inner: () => code() + note(`${IGNORE} No one can sign in without this code.`),
  },
  reauthentication: {
    subject: 'Confirm it is you',
    file: 'reauthentication.html',
    title: 'Confirm it is you',
    preheader: 'Enter this code to confirm a sensitive change.',
    sub: 'Enter this code to confirm this change to your account. It expires in 60 minutes.',
    inner: () => code() + note(`${IGNORE} Your account has not changed.`),
  },
  confirmation: {
    subject: 'Confirm your Elopis email',
    file: 'confirmation.html',
    title: 'Confirm your email',
    preheader: 'One tap to confirm your Elopis email address.',
    sub: 'Confirm this address to finish setting up your Elopis account.',
    inner: () => cta('Confirm email', 'signup') + fallbackLink('signup') + note(IGNORE),
  },
  recovery: {
    subject: 'Reset your Elopis password',
    file: 'recovery.html',
    title: 'Reset your password',
    preheader: 'Set a new password for your Elopis account.',
    sub: 'Use the button below to set a new password. The link expires in 60 minutes.',
    inner: () =>
      cta('Set a new password', 'recovery', '/auth/reset-password') +
      fallbackLink('recovery', '/auth/reset-password') +
      note(`${IGNORE} Your password will not change until you set a new one.`),
  },
  email_change: {
    subject: 'Confirm your new Elopis email',
    file: 'email_change.html',
    title: 'Confirm your new email',
    preheader: 'Confirm the new address on your Elopis account.',
    sub: 'Confirm <strong>{{ .NewEmail }}</strong> as the new email address on your Elopis account.',
    inner: () =>
      cta('Confirm new email', 'email_change', '/account') +
      fallbackLink('email_change', '/account') +
      note('If you did not ask to change your email, ignore this — your address stays as it is.'),
  },
  invite: {
    subject: 'You are invited to Elopis',
    file: 'invite.html',
    title: 'You are invited to Elopis',
    preheader: 'Accept your invitation to Elopis.',
    sub: 'You have been invited to join Elopis — prediction markets for East Africa.',
    inner: () => cta('Accept invitation', 'invite') + fallbackLink('invite') + note(IGNORE),
  },

  // ---- SECURITY NOTICES (ruling: these are emails too) --------------------
  //
  // Supabase sends seven more templates that nothing here had ever touched.
  // Measured on the live project 2026-10-16, every one of them was still the
  // stock `<h2>…</h2><p>…</p>` — no logo, no card, no footer, no dark mode,
  // no "we will never ask for your password" line.
  //
  // That matters most for exactly these: they are the mails that tell someone
  // their password, email address or phone number just changed. If that was
  // not them, this message is the only warning they get, and it arrived
  // looking like a system error rather than something from their bank. They
  // carry no link by design — a notice about a change you did not make must
  // not hand you a button; it tells you to contact support.
  password_changed_notification: {
    subject: 'Your Elopis password was changed',
    file: 'password_changed_notification.html',
    title: 'Your password was changed',
    preheader: 'The password on your Elopis account was just changed.',
    sub: 'The password for your Elopis account was changed just now.',
    inner: () =>
      note(
        'If this was you, nothing else is needed. <strong>If it was not</strong>, your account may be at risk — reset your password immediately and contact support.',
      ),
  },
  email_changed_notification: {
    subject: 'Your Elopis email address was changed',
    file: 'email_changed_notification.html',
    title: 'Your email address was changed',
    preheader: 'The email address on your Elopis account was changed.',
    sub: 'The email address on your Elopis account was changed to <strong>{{ .NewEmail }}</strong>.',
    inner: () =>
      note(
        'If this was you, nothing else is needed. <strong>If it was not</strong>, contact support straight away — whoever made this change can now receive your account email.',
      ),
  },
  phone_changed_notification: {
    subject: 'Your Elopis phone number was changed',
    file: 'phone_changed_notification.html',
    title: 'Your phone number was changed',
    preheader: 'The phone number on your Elopis account was changed.',
    sub: 'The phone number on your Elopis account was changed.',
    inner: () =>
      note(
        'If this was you, nothing else is needed. <strong>If it was not</strong>, contact support straight away — your withdrawals and M-Pesa alerts follow this number.',
      ),
  },
  identity_linked_notification: {
    subject: 'A new sign-in method was added',
    file: 'identity_linked_notification.html',
    title: 'A new sign-in method was added',
    preheader: 'A new way to sign in was added to your Elopis account.',
    sub: 'Your <strong>{{ .Provider }}</strong> account can now be used to sign in to Elopis.',
    inner: () =>
      note(
        'If this was you, nothing else is needed. <strong>If it was not</strong>, remove it in your account settings and contact support.',
      ),
  },
  identity_unlinked_notification: {
    subject: 'A sign-in method was removed',
    file: 'identity_unlinked_notification.html',
    title: 'A sign-in method was removed',
    preheader: 'A way to sign in was removed from your Elopis account.',
    sub: 'Your <strong>{{ .Provider }}</strong> account can no longer be used to sign in to Elopis.',
    inner: () =>
      note(
        'If this was you, nothing else is needed. <strong>If it was not</strong>, contact support straight away.',
      ),
  },
  mfa_factor_enrolled_notification: {
    subject: 'A new verification method was added',
    file: 'mfa_factor_enrolled_notification.html',
    title: 'A new verification method was added',
    preheader: 'Two-factor verification was added to your Elopis account.',
    sub: 'A <strong>{{ .FactorType }}</strong> verification method was added to your Elopis account.',
    inner: () =>
      note(
        'If this was you, nothing else is needed. <strong>If it was not</strong>, contact support straight away — someone else may be able to approve sign-ins.',
      ),
  },
  mfa_factor_unenrolled_notification: {
    subject: 'A verification method was removed',
    file: 'mfa_factor_unenrolled_notification.html',
    title: 'A verification method was removed',
    preheader: 'Two-factor verification was removed from your Elopis account.',
    sub: 'A <strong>{{ .FactorType }}</strong> verification method was removed from your Elopis account.',
    inner: () =>
      note(
        'If this was you, nothing else is needed. <strong>If it was not</strong>, add it back in your account settings and contact support.',
      ),
  },
}

const root = join(process.cwd(), '..', '..', 'supabase', 'templates')
const built = {}
for (const [key, t] of Object.entries(TEMPLATES)) {
  const html = shell({
    title: t.title,
    preheader: t.preheader,
    inner: head(t.title, t.sub) + t.inner(),
  })
  writeFileSync(join(root, t.file), html)
  built[key] = { html, subject: t.subject }
  console.log(`  ${t.file.padEnd(24)} ${String(html.length).padStart(5)}B  "${t.subject}"`)
}

if (process.argv.includes('--push')) {
  const ref = process.env.SUPABASE_PROJECT_REF
  const token = process.env.SUPABASE_ACCESS_TOKEN
  if (!ref || !token) throw new Error('SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN required to push')
  const payload = {}
  for (const [key, b] of Object.entries(built)) {
    payload[`mailer_templates_${key}_content`] = b.html
    payload[`mailer_subjects_${key}`] = b.subject
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  console.log(`\npush -> HTTP ${res.status}`)
  if (!res.ok) console.log((await res.text()).slice(0, 300))
}
