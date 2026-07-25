// components/layout/site-footer.tsx — institutional site footer (WCAG 1.3.1 landmark).
//
// Closes every page with brand confidence + the compliance surface a real-money
// prediction market must carry: settlement currencies, payment rails, structured
// link columns, and an always-visible risk / responsible-play disclosure.
//
// Design notes (Pip system):
// - Token-only styling; correct light AND dark hover states (no `hover:text-white`).
// - Grid-aligned to the landing body: `max-w-6xl px-5 sm:px-8` so the footer's
//   left edge lines up pixel-for-pixel with the hero, sections, and CTA band.
// - Only links to routes that exist in the app (no dead links).
import Link from 'next/link'
import { LocaleSwitcher } from './locale-switcher'
import { LogoMark, IconArrowRight } from '@/components/ui/icons'

const YEAR = new Date().getFullYear()

// Settlement currencies + payment rails. These mirror what actually exists in the
// platform today: wallets are provisioned in KES/UGX/TZS/RWF, and the only enabled
// payment gateway is M-Pesa (Kenya pilot). Keep this list in step with the live
// `wallets` currencies and enabled `payment_gateways` as new rails go live.
const CURRENCIES = ['KES', 'UGX', 'TZS', 'RWF']
const PAYMENTS = ['M-Pesa']

type FooterLink = { href: string; label: string }
type FooterColumn = { heading: string; links: FooterLink[] }

// Every href below resolves to a real route in `app/`.
const COLUMNS: FooterColumn[] = [
  {
    heading: 'Events',
    links: [
      { href: '/markets', label: 'All events' },
      { href: '/leaderboard', label: 'Leaderboard' },
      { href: '/markets/create', label: 'Create an event' },
      { href: '/search', label: 'Search' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { href: '/auth/register', label: 'Get started' },
      { href: '/auth/login', label: 'Sign in' },
      { href: '/portfolio', label: 'My predictions' },
      { href: '/kyc', label: 'Verify identity' },
    ],
  },
  {
    heading: 'Help & legal',
    links: [
      { href: '/legal/terms', label: 'Terms' },
      { href: '/legal/privacy', label: 'Privacy' },
      { href: '/legal/responsible-play', label: 'Responsible play' },
      { href: '/help', label: 'Help' },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer
      className="mt-20 border-t"
      style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}
      aria-label="Site footer"
    >
      <div className="max-w-6xl mx-auto px-5 sm:px-8">

        {/* Upper: brand + link columns */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_2fr] gap-10 lg:gap-16 py-14">

          {/* Brand column */}
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="MarketPips home">
              <LogoMark size={30} />
              <span className="font-display text-[17px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                MarketPips
              </span>
            </Link>

            <p className="mt-4 text-[0.95rem] leading-relaxed max-w-[38ch]" style={{ color: 'var(--text-2)' }}>
              See what people think will happen next. A simple, honest way to predict
              real events, made for East Africa. Deposit and withdraw with M-Pesa.
            </p>

            {/* Settlement currencies */}
            <div className="mt-7">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
                You get paid in
              </span>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {CURRENCIES.map((c) => (
                  <span
                    key={c}
                    className="font-mono text-[12px] px-2 py-1 rounded"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--hairline)', color: 'var(--text-2)' }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>

            {/* Payment rails */}
            <div className="mt-5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-3)' }}>
                Deposit with
              </span>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {PAYMENTS.map((p) => (
                  <span
                    key={p}
                    className="text-[12px] font-medium px-2.5 py-1 rounded"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--hairline)', color: 'var(--text-2)' }}
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-8">
            {COLUMNS.map((col) => (
              <nav key={col.heading} aria-label={col.heading}>
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text)' }}>
                  {col.heading}
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="footer-link text-[0.92rem] transition-colors"
                        style={{ color: 'var(--text-2)' }}
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        {/* Risk / responsible-play disclosure */}
        <div
          className="rounded-xl px-5 py-4 mb-10 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}
        >
          <p className="text-[12.5px] leading-relaxed flex-1" style={{ color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--text-2)' }}>Play with care.</strong>{' '}
            This is real money and you can lose what you put in. You must be 18 or older.
            Ask us any time to set a limit, take a break, or close your account.
          </p>
          <Link
            href="/legal/responsible-play"
            className="footer-link flex-none inline-flex items-center gap-1.5 text-[12.5px] font-semibold"
            style={{ color: 'var(--pip-text)' }}
          >
            Ways to stay safe <IconArrowRight size={13} />
          </Link>
        </div>

        {/* Bottom bar */}
        <div
          className="py-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-t"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <p className="text-[13px]" style={{ color: 'var(--text-3)' }}>
            © {YEAR} MarketPips · Made for East Africa
          </p>
          <LocaleSwitcher />
        </div>
      </div>
    </footer>
  )
}
