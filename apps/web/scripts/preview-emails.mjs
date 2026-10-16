// scripts/preview-emails.mjs
// ---------------------------------------------------------------------------
// Render every notification email to disk so they can be LOOKED AT.
//
// Email is the one surface with no dev server and no hot reload: the only way
// to know what lands in an inbox is to render the exact HTML the worker will
// send and open it. This writes one file per type plus an index, from the same
// renderer the delivery worker calls — not a copy of it.
//
//   npx tsx scripts/preview-emails.mjs          -> .preview-emails/*.html
//
// The fixtures below are shaped from the real payloads: `system_announcement`
// and `withdrawal_failed` are copied verbatim out of the live notifications
// table (including the ugly internal error string, which is exactly the case
// the reason-field guard exists for). The rest follow the jsonb_build_object
// shapes the payment and trading RPCs construct.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = join(process.cwd(), '.preview-emails')
mkdirSync(OUT, { recursive: true })

const { renderNotificationEmail, TEMPLATED_TYPES } = await import(
  '../lib/notifications/templates/render.ts'
)

const FIXTURES = {
  bet_won: {
    title: 'You won KSh 2,400',
    body: 'Your Yes position on "Will William Ruto win the 2027 election?" paid out.',
    data: { payout: 2400, currency: 'KES', market_title: 'Will William Ruto win the 2027 election?', outcome: 'William Ruto', shares: 24, slug: 'ke-2027-president' },
  },
  bet_lost: {
    title: 'Market resolved',
    body: 'Your No position on "Will Rigathi Gachagua win the 2027 election?" did not pay out.',
    data: { market_title: 'Will Rigathi Gachagua win the 2027 election?', outcome: 'William Ruto', slug: 'ke-2027-president' },
  },
  bet_filled: {
    title: 'Order filled',
    body: 'You bought 24 Yes shares of William Ruto at 46%.',
    data: { amount: 1104, currency: 'KES', market_title: 'Will William Ruto win the 2027 election?', side: 'yes', shares: 24, price: 0.46, slug: 'ke-2027-president' },
  },
  market_resolved: {
    title: 'Market resolved',
    body: '"Will the Kenyan shilling close below 130 in Q4?" resolved to Yes.',
    data: { market_title: 'Will the Kenyan shilling close below 130 in Q4?', outcome: 'Yes', slug: 'kes-below-130-q4' },
  },
  market_created: {
    title: 'New market in Politics',
    body: '"Who will be the 2027 opposition flagbearer?" just opened for trading.',
    data: { market_title: 'Who will be the 2027 opposition flagbearer?', slug: 'ke-2027-opposition-flagbearer' },
  },
  market_closing_soon: {
    title: 'Closing in 1 hour',
    body: '"Who wins AFCON 2027?" stops accepting orders at 18:00 EAT.',
    data: { market_title: 'Who wins AFCON 2027?', slug: 'afcon-2027-winner' },
  },
  price_alert: {
    title: 'William Ruto crossed 46%',
    body: 'The chance you are watching moved past your alert level.',
    data: { price: 0.46, market_title: 'Will William Ruto win the 2027 election?', slug: 'ke-2027-president' },
  },
  deposit_completed: {
    title: 'Deposit received',
    body: 'Your M-Pesa deposit has been added to your Elopis wallet.',
    data: { amount: 5000, currency: 'KES', provider: 'mpesa', deposit_id: '8a987c36-97dc-4dc0-9e18-0fdc2394fb2d' },
  },
  withdrawal_completed: {
    title: 'Withdrawal sent',
    body: 'Your withdrawal has been sent to your M-Pesa number.',
    data: { net_amount: 2950, currency: 'KES', provider: 'mpesa', withdrawal_id: '3f2a91cc-11ab-4e0f-9c77-7a1d55e0b210' },
  },
  // Verbatim from the live notifications table — note the internal error text.
  withdrawal_failed: {
    title: 'Withdrawal Failed',
    body: 'Your withdrawal of 100.00 KES could not be completed and has been refunded to your wallet.',
    data: { amount: 100, reason: 'Unexpected end of JSON input', currency: 'KES', withdrawal_id: '8a987c36-97dc-4dc0-9e18-0fdc2394fb2d' },
  },
  withdrawal_under_review: {
    title: 'Withdrawal under review',
    body: 'Your withdrawal of KSh 120,000 is being checked before it is sent.',
    data: { amount: 120000, currency: 'KES', withdrawal_id: 'c71e0a55-3d2b-49aa-8e11-6f0b2c9d4a73' },
  },
  referral_bonus: {
    title: 'Referral bonus',
    body: 'Grace Simiyu joined using your link. Your bonus has been credited.',
    data: { amount: 200, currency: 'KES' },
  },
  kyc_approved: {
    title: 'You are verified',
    body: 'Your identity documents were approved. Your account is fully open.',
    data: {},
  },
  kyc_rejected: {
    title: 'We could not verify your documents',
    body: 'The ID photo you uploaded could not be read.',
    data: { reason: 'The back of the ID was cut off. Please upload the full document.' },
  },
  // Verbatim from the live notifications table.
  system_announcement: {
    title: 'Market awaiting resolution',
    body: 'Market "Kenyan wins 2026 Berlin Marathon?" is past its resolution time and needs a resolver.',
    data: { event: 'resolution_due', market_id: '32553f05-fd96-45b9-9b5f-378e21cc5aed' },
  },
  // Not a declared type: proves the fallback produces a branded card.
  some_future_type: {
    title: 'A type this build has never seen',
    body: 'This renders through the default branch, which must still be branded and must not throw.',
    data: {},
  },
}

const rows = []
for (const [type, f] of Object.entries(FIXTURES)) {
  const mail = renderNotificationEmail({ type, ...f })
  const file = `${type}.html`
  writeFileSync(join(OUT, file), mail.html)
  writeFileSync(join(OUT, `${type}.txt`), mail.text)
  rows.push({ type, file, subject: mail.subject, html: mail.html.length, text: mail.text.length })
}

writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Elopis emails</title>
<body style="font-family:system-ui;background:#eef0f2;margin:0;padding:24px">
<h1 style="font-size:18px">Elopis notification emails (${rows.length})</h1>
<table cellpadding="8" style="background:#fff;border-radius:12px;font-size:13px;border-collapse:collapse">
<tr style="text-align:left"><th>type</th><th>subject</th><th>html</th><th>text</th></tr>
${rows.map((r) => `<tr><td><a href="${r.file}">${r.type}</a></td><td>${r.subject}</td><td>${r.html}B</td><td>${r.text}B</td></tr>`).join('')}
</table></body>`,
)

console.log(`rendered ${rows.length} emails -> ${OUT}`)
for (const r of rows) console.log(`  ${r.type.padEnd(26)} ${String(r.html).padStart(6)}B html  ${String(r.text).padStart(5)}B text  "${r.subject}"`)
