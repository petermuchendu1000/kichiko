import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/content/legal-page'

export const metadata: Metadata = {
  title: 'Help & Support',
  description: 'Guides and support for using Kichiko.',
}

const GUIDES: { href: string; label: string; desc: string }[] = [
  { href: '/markets', label: 'Browse events', desc: 'Find an event to predict on.' },
  { href: '/portfolio', label: 'Your portfolio', desc: 'See what you hold and your profit or loss.' },
  { href: '/kyc', label: 'Verify your identity', desc: 'Needed to withdraw.' },
  { href: '/notifications', label: 'Notifications', desc: 'Choose how we reach you.' },
]

export default function HelpPage() {
  return (
    <LegalPage title="Help & Support">
      <p>
        New to Kichiko? Start with the basics below, or jump straight into the
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
        pay out; losing shares expire. Prices move as people trade (via an
        automated market maker), and you can never lose more than you stake.
      </p>

      <h2>Money</h2>
      <p>
        Deposit and withdraw with M-Pesa, MTN MoMo, Airtel Money, or PesaPal.
        Fees and exchange rates are always shown before you confirm. Withdrawals
        may require identity verification.
      </p>

      <h2>Contact support</h2>
      <p>
        Reach us by email at{' '}
        <a href="mailto:support@kichiko.app">support@kichiko.app</a> with
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
