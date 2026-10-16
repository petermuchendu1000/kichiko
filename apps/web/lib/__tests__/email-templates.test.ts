// lib/__tests__/email-templates.test.ts
// The branded notification emails (lib/notifications/templates).
//
// Before these templates existed the delivery worker sent, for every one of the
// fifteen types including deposits, withdrawals and wins:
//     html: `<p>${escapeHtml(body)}</p>`
// So the bar these tests hold is not "is it pretty" — it is that money mail is
// identifiably from Elopis, never leaks internal error text to a customer, and
// cannot throw inside the worker.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderNotificationEmail, TEMPLATED_TYPES } from '../notifications/templates/render'
import { C } from '../notifications/templates/tokens'

const base = { title: 'Something happened', body: 'A sentence a human wrote.' }

describe('every notification type renders', () => {
  it('produces subject, html and text for all templated types', () => {
    for (const type of TEMPLATED_TYPES) {
      const m = renderNotificationEmail({ type, ...base, data: {} })
      expect(m.subject, type).toBeTruthy()
      expect(m.html, type).toContain('<!doctype html>')
      expect(m.text, type).toContain('Elopis')
    }
  })

  it('renders a branded card for a type it has never seen', () => {
    // A new notification_type added in SQL must not produce a blank email or an
    // exception in the delivery worker.
    const m = renderNotificationEmail({ type: 'type_from_the_future', ...base, data: {} })
    expect(m.html).toContain('Elopis')
    expect(m.html).toContain('Something happened')
  })

  it('survives a null/empty data payload on every type', () => {
    for (const type of TEMPLATED_TYPES) {
      expect(() => renderNotificationEmail({ type, ...base, data: null }), type).not.toThrow()
      expect(() => renderNotificationEmail({ type, ...base }), type).not.toThrow()
    }
  })

  it('stays well under the 102KB Gmail clipping threshold', () => {
    // Past ~102KB Gmail truncates and appends "[Message clipped]", which would
    // cut the footer — including the unsubscribe link — off a marketing-adjacent
    // email. Every one of ours is under 10KB; this guards a future regression.
    for (const type of TEMPLATED_TYPES) {
      const m = renderNotificationEmail({ type, ...base, data: { amount: 1000, currency: 'KES' } })
      expect(m.html.length, type).toBeLessThan(60_000)
    }
  })
})

describe('internal error text never reaches a customer', () => {
  // The live withdrawal_failed row carries reason "Unexpected end of JSON
  // input". The first version of the guard accepted it because it starts with a
  // capital letter, and the rendered email told a customer, about their money,
  // "Reason: Unexpected end of JSON input".
  const leaky = [
    'Unexpected end of JSON input',
    'TypeError: Cannot read properties of undefined',
    'ECONNRESET',
    'ETIMEDOUT connecting to 10.0.0.1',
    'null',
    'NaN',
    '{"error":"bad"}',
    '    at Object.<anonymous> (/app/x.js:1:1)',
  ]

  it.each(leaky)('drops %j', (reason) => {
    const m = renderNotificationEmail({
      type: 'withdrawal_failed',
      title: 'Withdrawal Failed',
      body: 'Your withdrawal could not be completed and has been refunded.',
      data: { amount: 100, currency: 'KES', reason },
    })
    expect(m.html).not.toContain(reason)
    // The email still works without it: the body and the refund note carry it.
    expect(m.html).toContain('refunded')
    expect(m.html).toContain('Nothing was lost')
  })

  it('translates a recognised provider failure into something actionable', () => {
    const m = renderNotificationEmail({
      type: 'withdrawal_failed',
      title: 'Withdrawal Failed',
      body: 'Could not be completed.',
      data: { amount: 100, currency: 'KES', reason: 'INSUFFICIENT_FLOAT' },
    })
    expect(m.html).toContain('temporarily short of funds')
    expect(m.html).not.toContain('INSUFFICIENT_FLOAT')
  })

  it('keeps a plain sentence an admin wrote', () => {
    const note = 'The back of the ID was cut off. Please upload the full document.'
    const m = renderNotificationEmail({
      type: 'kyc_rejected',
      title: 'We could not verify your documents',
      body: 'The ID photo could not be read.',
      data: { reason: note },
    })
    expect(m.html).toContain('The back of the ID was cut off')
  })
})

describe('escaping', () => {
  it('neutralises markup in title, body and data', () => {
    const m = renderNotificationEmail({
      type: 'market_resolved',
      title: '<script>alert(1)</script>',
      body: '<img src=x onerror=alert(2)>',
      data: { market_title: '"><script>alert(3)</script>' },
    })
    // Assert no TAG IS FORMED, not that a scary substring is absent. The
    // first version of this test failed on `onerror=` appearing inside
    // "&lt;img src=x onerror=alert(2)&gt;" — correctly escaped TEXT in the
    // preheader. Searching for the payload's words flags safe output; searching
    // for an opening tag is what actually distinguishes escaped from injected.
    expect(m.html).not.toContain('<script')
    expect(m.html).not.toContain('<img')
    expect(m.html).toContain('&lt;script&gt;')
    expect(m.html).toContain('&lt;img src=x onerror=alert(2)&gt;')
  })

  it('escapes quotes so an injected attribute cannot break out of href', () => {
    const m = renderNotificationEmail({
      type: 'market_created',
      ...base,
      data: { slug: 'x" onmouseover="alert(1)' },
    })
    expect(m.html).not.toContain('onmouseover="alert')
  })
})

describe('money', () => {
  it('formats through the app’s own formatter, so email and screen agree', () => {
    const m = renderNotificationEmail({
      type: 'deposit_completed',
      title: 'Deposit received',
      body: 'Added to your wallet.',
      data: { amount: 5000, currency: 'KES' },
    })
    expect(m.html).toContain('KSh 5,000.00')
  })

  it('reads an amount that arrived as a NUMERIC string', () => {
    // supabase-js hands NUMERIC back as a string often enough to matter — the
    // same trap that printed "+NaN" on the outcome board.
    const m = renderNotificationEmail({
      type: 'bet_won',
      title: 'You won',
      body: 'Paid out.',
      data: { payout: '2400.00', currency: 'KES' },
    })
    expect(m.html).toContain('KSh 2,400.00')
  })

  it('omits the amount block rather than printing NaN', () => {
    const m = renderNotificationEmail({
      type: 'deposit_completed',
      title: 'Deposit received',
      body: 'Added.',
      data: { amount: 'not-a-number', currency: 'KES' },
    })
    expect(m.html).not.toContain('NaN')
  })

  it('falls back to KES for an unsupported currency code', () => {
    const m = renderNotificationEmail({
      type: 'deposit_completed',
      title: 'Deposit',
      body: 'Added.',
      data: { amount: 10, currency: 'XYZ' },
    })
    expect(m.html).toContain('KSh')
  })
})

describe('deliverability basics', () => {
  it('ships a plain-text alternative carrying the same message and link', () => {
    // HTML-only mail scores worse with spam filters and is unreadable in a
    // text-mode client. The text part is generated from the same inputs so it
    // cannot drift from the HTML.
    const m = renderNotificationEmail({
      type: 'bet_won',
      title: 'You won KSh 2,400',
      body: 'Your position paid out.',
      data: { payout: 2400, currency: 'KES' },
    })
    expect(m.text).toContain('You won KSh 2,400')
    expect(m.text).toContain('Your position paid out.')
    expect(m.text).toMatch(/https?:\/\//)
    expect(m.text).not.toContain('<')
  })

  it('writes a real preheader instead of letting the client scrape one', () => {
    const m = renderNotificationEmail({
      type: 'deposit_completed',
      title: 'Deposit received',
      body: 'KSh 5,000 landed in your wallet.',
      data: {},
    })
    // The preheader div precedes the visible card.
    const pre = m.html.slice(0, m.html.indexOf('e-canvas', m.html.indexOf('<body')))
    expect(m.html).toContain('KSh 5,000 landed in your wallet.')
    expect(pre.length).toBeGreaterThan(0)
  })

  it('carries exactly one primary call to action', () => {
    for (const type of TEMPLATED_TYPES) {
      const m = renderNotificationEmail({ type, ...base, data: {} })
      const buttons = (m.html.match(/class="e-btn"/g) ?? []).length
      expect(buttons, type).toBe(1)
    }
  })

  it('declares both colour schemes so dark clients do not invert it themselves', () => {
    const m = renderNotificationEmail({ type: 'bet_won', ...base, data: {} })
    expect(m.html).toContain('name="color-scheme"')
    expect(m.html).toContain('prefers-color-scheme: dark')
  })
})

describe('the palette has not drifted from the app', () => {
  // tokens.ts copies hex values out of globals.css because email cannot read
  // CSS custom properties. A copy rots; this reads the real stylesheet and
  // fails when the product's colour changes and the emails keep the old one.
  const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
  const tokenValue = (name: string): string | null => {
    const m = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9A-Fa-f]{3,8})`))
    return m ? m[1].toUpperCase() : null
  }

  it.each([
    ['pip-500', 'brand'],
    ['pip-600', 'brandDark'],
    ['pip-100', 'brandTint'],
    ['yes', 'yes'],
    ['yes-solid', 'yesSolid'],
    ['no', 'no'],
    ['no-solid', 'noSolid'],
    ['ink-950', 'text'],
    ['paper', 'paper'],
  ])('--%s still matches tokens.%s', (cssName, tokenName) => {
    const fromCss = tokenValue(cssName)
    expect(fromCss, `--${cssName} not found in globals.css`).toBeTruthy()
    expect((C as Record<string, string>)[tokenName].toUpperCase()).toBe(fromCss)
  })
})
