import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/content/legal-page'
import { HowItWorks } from '@/components/content/how-it-works'
import { createClient } from '@/lib/supabase/server'
import { buildRatesMap, usdToLocal } from '@/lib/currency'
import { formatCompact } from '@/lib/format'

export const metadata: Metadata = {
  title: 'Help & Support',
  description: 'Guides and support for using Elopis.',
}

const GUIDES: { href: string; label: string; desc: string }[] = [
  { href: '/markets', label: 'Browse events', desc: 'Find an event to predict on.' },
  { href: '/portfolio', label: 'Your portfolio', desc: 'See what you hold and your profit or loss.' },
  { href: '/kyc', label: 'Verify your identity', desc: 'Needed to withdraw.' },
  { href: '/notifications', label: 'Notifications', desc: 'Choose how we reach you.' },
]

// Live figures, never hardcoded. A share settles at KSh 100 since migration
// 113, so the worked example reads cleanly (a Yes at 65% costs KSh 65 and pays
// KSh 100) — but it is still derived rather than written down, so that the
// page cannot fall out of step with the unit the way it did under live FX.
async function getFigures() {
  const supabase = await createClient()
  const [{ data: fxRows }, { data: settings }, activeCount, { data: volRows }, { data: cats }] =
    await Promise.all([
      supabase.from('exchange_rates').select('from_currency, rate').eq('to_currency', 'USD'),
      supabase.from('platform_settings').select('platform_fee_rate').limit(1),
      supabase.from('markets').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('markets').select('total_volume_usd').eq('status', 'active').limit(1000),
      supabase.from('markets').select('category').eq('status', 'active').limit(1000),
    ])
  const rates = buildRatesMap(fxRows ?? [])
  const kesPerUsd = usdToLocal(1, 'KES', rates)
  const sharePayoutKes = Math.round(kesPerUsd)
  const exampleBuyKes = Math.round(0.65 * kesPerUsd)
  const feeRate = Number(
    (settings?.[0] as { platform_fee_rate?: number } | undefined)?.platform_fee_rate ?? 0.02,
  )
  const totalVolumeKes =
    (volRows ?? []).reduce((sum, m: { total_volume_usd: number | null }) => sum + (m.total_volume_usd ?? 0), 0) * kesPerUsd
  const open = activeCount.count ?? 0
  const topics = new Set((cats ?? []).map((c: { category: string }) => c.category)).size
  const platformFeePct = Number((feeRate * 100).toFixed(2).replace(/\.?0+$/, ''))
  return {
    exampleBuyKes,
    sharePayoutKes,
    exampleProfitKes: sharePayoutKes - exampleBuyKes,
    platformFeePct,
    stats: [
      { n: open > 0 ? `${open}` : '-', l: 'Events open now' },
      { n: totalVolumeKes > 0 ? `KSh ${formatCompact(totalVolumeKes)}` : '-', l: 'Money traded so far' },
      { n: topics > 0 ? `${topics}` : '-', l: 'Topics' },
      { n: `${platformFeePct}%`, l: 'Our fee' },
    ],
  }
}

export default async function HelpPage() {
  const figures = await getFigures()
  return (
    <LegalPage title="Help & Support">
      <p>
        New to Elopis? Start with the basics below, or jump straight into the
        app. For anything else, contact our support team and we&rsquo;ll help.
      </p>

      <h2>Quick links</h2>
      <ul className="!list-none !pl-0 grid gap-3 sm:grid-cols-2">
        {GUIDES.map((g) => (
          <li key={g.href} className="!m-0">
            <Link
              href={g.href}
              className="!no-underline block rounded-lg border border-gray-200 p-4 hover:border-green-500 dark:border-gray-800"
            >
              <span className="font-medium text-gray-900 dark:text-gray-100">{g.label}</span>
              <span className="mt-1 block text-sm text-gray-500 dark:text-gray-400">{g.desc}</span>
            </Link>
          </li>
        ))}
      </ul>

      <h2>How predicting works</h2>
      <p>
        You buy YES or NO shares on a question about the future. The price (0–100%)
        is the market&rsquo;s estimate of how likely the outcome is. Winning shares
        pay out; losing shares expire. Prices move as people trade (your orders
        are matched on a live order book), and you can never lose more than you
        stake.
      </p>

      {/* The full walkthrough, moved off the landing page where it ran 2,823px
          in front of the markets. Polymarket's landing carries no explainer at
          all; theirs lives on a separate docs site behind a footer link. This
          is the destination that already covered the same four topics. */}
      <div className="not-prose my-10">
        <HowItWorks {...figures} />
      </div>

      <h2>Money</h2>
      <p>
        Deposit and withdraw with M-Pesa, MTN MoMo, Airtel Money, or PesaPal.
        Fees and exchange rates are always shown before you confirm. Withdrawals
        may require identity verification.
      </p>

      {/* Anchored so the footer's "Contact us" lands on the address itself. */}
      <h2 id="contact">Contact support</h2>
      <p>
        Reach us by email at{' '}
        <a href="mailto:support@elopis.com">support@elopis.com</a> with
        your account email and any transaction reference. We aim to respond
        quickly during business hours (East Africa Time).
      </p>

      <h2>Play responsibly</h2>
      <p>
        Please see <a href="/legal/responsible-play">Responsible play</a>. This is
        real money and real risk. Only stake what you can afford to lose.
      </p>

      <h2>Policies</h2>
      <p>
        <a href="/legal/terms">Terms of Service</a> ·{' '}
        <a href="/legal/privacy">Privacy Policy</a>
      </p>
    </LegalPage>
  )
}
