// lib/notifications/templates/render.ts
// ---------------------------------------------------------------------------
// One branded email per notification type.
//
// WHAT WAS THERE BEFORE
//
// `app/api/cron/send-notifications/route.ts` sent, for every one of the fifteen
// types including deposits, withdrawals and wins:
//
//     html: `<p>${escapeHtml(d.body)}</p>`
//
// An unstyled paragraph on a white page, with no sender identity beyond the
// From line. For money mail that is not just unpolished — an email about a
// withdrawal that looks like nothing is indistinguishable from an email about a
// withdrawal sent by somebody else. (A `baseTemplate()` had been written in
// lib/notifications/email.ts and was never called from anywhere.)
//
// THE RULE THESE FOLLOW
//
// `title` and `body` are written by whatever created the notification, are
// always present, and are already human-readable — `close_due_markets` and the
// payment RPCs compose real sentences. So a template NEVER invents copy and
// never depends on a field being there. It presents the title and body, and
// *adds structure* — an amount, a receipt, one button — only from fields it can
// actually see in `data`. Every handler degrades to the generic card, so a new
// notification type, or an old one whose payload shape drifts, still produces a
// correct branded email instead of an exception in the delivery worker.
import { formatCurrency, isSupportedCurrency } from '@/lib/currency'
import type { CurrencyCode } from '@/types'
import { appUrl } from './tokens'
import { shell, heading, paragraph, hero, details, button, note, spacer, esc } from './layout'

export interface NotificationEmailInput {
  type: string
  title: string
  body: string
  data?: Record<string, unknown> | null
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

// ---------------------------------------------------------------------------
// Small readers. Every one tolerates a missing or wrong-typed field.
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return null
}

/** NUMERIC arrives from supabase-js as a string often enough to matter. */
function money(d: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  if (!d) return null
  for (const k of keys) {
    const n = num(d[k])
    if (n === null) continue
    const raw = str(d.currency) ?? 'KES'
    const cur: CurrencyCode = isSupportedCurrency(raw) ? raw : 'KES'
    return formatCurrency(n, cur)
  }
  return null
}

/**
 * A failure reason fit to show a customer — or nothing.
 *
 * THE LIVE DATA IS WHY THIS EXISTS. The one real `withdrawal_failed` row in the
 * database carries `reason: "Unexpected end of JSON input"`: a JSON parse error
 * from the payment provider's response. The first version of this guard only
 * required a capital letter and a sane length, so it rendered that string to
 * the customer as "Reason: Unexpected end of JSON input" — on an email about
 * their money. It says nothing they can act on and makes a working refund look
 * like a broken system.
 *
 * So the rule is inverted: a reason is shown only when it is RECOGNISED, never
 * merely when it looks tidy. Anything unrecognised is dropped, and the email
 * still reads correctly because `body` already states what happened and the
 * note already says the money came back.
 */
function humanReason(raw: string | null): string | null {
  if (!raw) return null
  const r = raw.trim()
  const low = r.toLowerCase()

  // Known provider/plat form conditions, mapped to what the customer should do.
  const KNOWN: [RegExp, string][] = [
    [/insufficient|float|balance/, 'The payout account was temporarily short of funds. Please try again.'],
    [/invalid.*(msisdn|number|phone)|number.*invalid/, 'The mobile money number was not accepted. Check it and try again.'],
    [/not.*registered|unregistered/, 'That number is not registered for mobile money.'],
    [/limit|exceed|maximum/, 'The amount is outside your provider’s transaction limits.'],
    [/timeout|timed out/, 'The payment provider did not respond in time.'],
    [/cancel/, 'The transaction was cancelled.'],
    [/declin|reject/, 'The payment provider declined the transaction.'],
  ]
  for (const [re, copy] of KNOWN) if (re.test(low)) return copy

  // Anything that smells like an exception, a stack frame or a protocol error
  // is internal detail. Drop it rather than dress it up.
  if (/json|undefined|null|nan|econn|etimedout|socket|stack|exception|parse|syntax|\bat\s|\{|\}|<|>/i.test(r)) {
    return null
  }
  // A plain sentence a human wrote (an admin note, say) is fine.
  return /^[A-Z][^|;=]{3,119}$/.test(r) ? r : null
}

function marketHref(d?: Record<string, unknown> | null): string {
  const slug = str(d?.slug) ?? str(d?.market_slug)
  if (slug) return appUrl(`/markets/${slug}`)
  // No slug in the payload: the markets board still lands them in the right
  // place, which beats a dead link built from an id the route cannot take.
  return appUrl('/markets')
}

/** Receipt rows from whatever identifiers the payload happens to carry. */
function refRows(d?: Record<string, unknown> | null): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const ref =
    str(d?.withdrawal_id) ?? str(d?.deposit_id) ?? str(d?.transaction_id) ?? str(d?.id)
  if (ref) out.push({ label: 'Reference', value: ref.slice(0, 8).toUpperCase() })
  const provider = str(d?.provider)
  if (provider) out.push({ label: 'Method', value: provider.toUpperCase() })
  return out
}

// ---------------------------------------------------------------------------
// Plain text. Not optional.
// ---------------------------------------------------------------------------
//
// A text/plain part is what a screen reader in a text-mode client reads, what
// Gmail shows when images and styles are stripped, and one of the things spam
// filters score an HTML-only message down for. It is generated from the same
// title/body/CTA so it can never drift from the HTML.
function plain(title: string, body: string, ctaLabel?: string, ctaHref?: string): string {
  const lines = ['Elopis', '', title, '', body]
  if (ctaLabel && ctaHref) lines.push('', `${ctaLabel}: ${ctaHref}`)
  lines.push(
    '',
    '—',
    'Elopis — prediction markets for East Africa.',
    `Notification settings: ${appUrl('/notifications')}`,
    '18+. Predict responsibly. Elopis never asks for your password or PIN by email.',
  )
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// The templates
// ---------------------------------------------------------------------------

export function renderNotificationEmail(input: NotificationEmailInput): RenderedEmail {
  const { type, title, body, data } = input
  const d = data ?? {}
  const safeBody = esc(body)

  // Default CTA: the notification centre, which can show anything.
  let cta: { label: string; href: string; tone?: 'brand' | 'yes' | 'no' } = {
    label: 'Open Elopis',
    href: appUrl('/notifications'),
  }
  let blocks = ''
  let footnote: string | undefined

  switch (type) {
    // ---- Trading ---------------------------------------------------------
    case 'bet_won': {
      const payout = money(d, 'payout', 'amount', 'net_amount', 'delta')
      cta = { label: 'View your winnings', href: appUrl('/profile'), tone: 'yes' }
      blocks =
        heading('You won', safeBody) +
        (payout ? hero(payout, 'Paid to your wallet', 'yes') : '') +
        details(
          [
            str(d.market_title) ? { label: 'Market', value: str(d.market_title)! } : null,
            str(d.outcome) ? { label: 'Outcome', value: str(d.outcome)! } : null,
            num(d.shares) !== null ? { label: 'Shares', value: String(num(d.shares)) } : null,
          ].filter(Boolean) as { label: string; value: string }[],
        )
      break
    }

    case 'bet_lost': {
      // Deliberately quiet. A loss needs no hero number and no colour shouting
      // at someone who just lost money; it needs to be clear and to offer the
      // next market rather than dwell.
      cta = { label: 'See the market', href: marketHref(d) }
      blocks =
        heading('Market resolved', safeBody) +
        details(
          [
            str(d.market_title) ? { label: 'Market', value: str(d.market_title)! } : null,
            str(d.outcome) ? { label: 'Resolved to', value: str(d.outcome)! } : null,
          ].filter(Boolean) as { label: string; value: string }[],
        )
      break
    }

    case 'bet_filled': {
      const amt = money(d, 'amount', 'cost', 'total')
      cta = { label: 'View your position', href: marketHref(d) }
      blocks =
        heading('Order filled', safeBody) +
        (amt ? hero(amt, 'Order value') : '') +
        details(
          [
            str(d.market_title) ? { label: 'Market', value: str(d.market_title)! } : null,
            str(d.side) ? { label: 'Side', value: str(d.side)!.toUpperCase() } : null,
            num(d.shares) !== null ? { label: 'Shares', value: String(num(d.shares)) } : null,
            num(d.price) !== null
              ? { label: 'Price', value: `${Math.round(num(d.price)! * 100)}%` }
              : null,
          ].filter(Boolean) as { label: string; value: string }[],
        )
      break
    }

    case 'market_resolved': {
      cta = { label: 'See the result', href: marketHref(d) }
      blocks =
        heading('Market resolved', safeBody) +
        details(
          [
            str(d.market_title) ? { label: 'Market', value: str(d.market_title)! } : null,
            str(d.outcome) ?? str(d.resolved_outcome)
              ? { label: 'Resolved to', value: (str(d.outcome) ?? str(d.resolved_outcome))!, strong: true }
              : null,
          ].filter(Boolean) as { label: string; value: string; strong?: boolean }[],
        )
      break
    }

    case 'market_created': {
      cta = { label: 'View market', href: marketHref(d) }
      blocks = heading('New market', safeBody)
      footnote = 'You get these because you follow this category.'
      break
    }

    case 'market_closing_soon': {
      cta = { label: 'Trade before it closes', href: marketHref(d), tone: 'brand' }
      blocks =
        heading('Closing soon', safeBody) +
        note('Once a market closes, no new orders are accepted and open positions wait for resolution.', 'warn')
      break
    }

    case 'price_alert': {
      cta = { label: 'View market', href: marketHref(d) }
      const price = num(d.price)
      blocks =
        heading('Price alert', safeBody) +
        (price !== null ? hero(`${Math.round(price * 100)}%`, 'Current chance', 'brand') : '')
      footnote = 'You set this alert. Turn alerts off any time in notification settings.'
      break
    }

    // ---- Money -----------------------------------------------------------
    case 'deposit_completed': {
      const amt = money(d, 'amount', 'net_amount', 'delta')
      cta = { label: 'Start trading', href: appUrl('/markets'), tone: 'yes' }
      blocks =
        heading('Deposit received', safeBody) +
        (amt ? hero(amt, 'Added to your wallet', 'yes') : '') +
        details(refRows(d))
      break
    }

    case 'withdrawal_completed': {
      const amt = money(d, 'net_amount', 'amount', 'delta')
      cta = { label: 'View wallet', href: appUrl('/profile') }
      blocks =
        heading('Withdrawal sent', safeBody) +
        (amt ? hero(amt, 'Sent to your mobile money', 'yes') : '') +
        details(refRows(d)) +
        note('Mobile money usually arrives within minutes. Your provider sends its own confirmation SMS.')
      break
    }

    case 'withdrawal_failed': {
      const amt = money(d, 'amount', 'refunded')
      const reason = humanReason(str(d.reason))
      cta = { label: 'Try again', href: appUrl('/profile'), tone: 'brand' }
      blocks =
        heading('Withdrawal failed', safeBody) +
        (amt ? hero(amt, 'Refunded to your wallet', 'no') : '') +
        details(
          [
            // humanReason() returns null for internal error text, so an
            // unrecognised failure simply shows no Reason row.
            reason ? { label: 'Reason', value: reason } : null,
            ...refRows(d),
          ].filter(Boolean) as { label: string; value: string }[],
        ) +
        note('Your money was returned to your Elopis wallet. Nothing was lost.', 'no')
      break
    }

    case 'withdrawal_under_review': {
      const amt = money(d, 'amount')
      cta = { label: 'View wallet', href: appUrl('/profile') }
      blocks =
        heading('Withdrawal under review', safeBody) +
        (amt ? hero(amt, 'On hold', 'warn') : '') +
        details(refRows(d)) +
        note('Reviews are a routine check on larger or unusual withdrawals. We will email you as soon as it clears.', 'warn')
      break
    }

    case 'referral_bonus': {
      const amt = money(d, 'amount', 'bonus', 'delta')
      cta = { label: 'View wallet', href: appUrl('/profile'), tone: 'yes' }
      blocks =
        heading('Referral bonus', safeBody) + (amt ? hero(amt, 'Added to your wallet', 'yes') : '')
      break
    }

    // ---- Account ---------------------------------------------------------
    case 'kyc_approved': {
      cta = { label: 'Start trading', href: appUrl('/markets'), tone: 'yes' }
      blocks =
        heading('You are verified', safeBody) +
        note('Deposits, withdrawals and trading are now open on your account.', 'yes')
      break
    }

    case 'kyc_rejected': {
      const reason = humanReason(str(d.reason) ?? str(d.notes))
      cta = { label: 'Resubmit documents', href: appUrl('/kyc'), tone: 'brand' }
      blocks =
        heading('We could not verify your documents', safeBody) +
        (reason ? details([{ label: 'What to fix', value: reason }]) : '') +
        note('This is usually a photo that is blurred, cropped, or expired. You can resubmit straight away.', 'warn')
      break
    }

    // ---- Platform --------------------------------------------------------
    case 'system_announcement':
    default: {
      blocks = heading(title, safeBody)
      break
    }
  }

  const html = shell({
    title,
    // The body doubles as the preheader: it is the sentence whoever raised the
    // notification already wrote for a human, so it is the best one-line
    // summary available without inventing copy.
    preheader: body,
    body: blocks + button(cta.label, cta.href, cta.tone ?? 'brand') + spacer(),
    footnote,
  })

  return {
    subject: title,
    html,
    text: plain(title, body, cta.label, cta.href),
  }
}

/** Every type this module renders a bespoke card for (not counting the fallback). */
export const TEMPLATED_TYPES = [
  'bet_won',
  'bet_lost',
  'bet_filled',
  'market_resolved',
  'market_created',
  'market_closing_soon',
  'price_alert',
  'deposit_completed',
  'withdrawal_completed',
  'withdrawal_failed',
  'withdrawal_under_review',
  'referral_bonus',
  'kyc_approved',
  'kyc_rejected',
  'system_announcement',
] as const
