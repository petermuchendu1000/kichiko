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
import { SEO_CATEGORIES, categoryHref, categoryLinkLabel } from '@/lib/seo/categories'

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
      { href: '/help', label: 'Help' },
      // Anchors to the support address rather than repeating it. A hardcoded
      // mailto would be a third copy of an address the codebase already
      // disagrees about: /help says support@elopis.com, while the
      // `branding.support_email` admin setting and the outbound mail sender
      // both say elopis.com. Linking the page keeps one source of truth.
      { href: '/help#contact', label: 'Contact us' },
      { href: '/legal/terms', label: 'Terms' },
      { href: '/legal/privacy', label: 'Privacy' },
      { href: '/legal/responsible-play', label: 'Responsible play' },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer
      className="mt-14 border-t lg:mt-20"
      style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}
      aria-label="Site footer"
    >
      <div className="max-w-6xl mx-auto px-5 sm:px-8">

        {/* Upper: brand + link columns */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_2fr] gap-8 py-10 lg:gap-16 lg:py-14">

          {/* Brand column */}
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Elopis home">
              <LogoMark size={30} />
              <span className="font-display text-[17px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                Elopis
              </span>
            </Link>

            <p className="mt-4 text-[0.95rem] leading-relaxed max-w-[38ch]" style={{ color: 'var(--text-2)' }}>
              See what people think will happen next. A simple, honest way to predict
              real events, made for East Africa. Deposit and withdraw with M-Pesa.
            </p>

            {/* Settlement currencies.
                Two separately labelled chip blocks cost ~130px of a phone
                screen to say "KES UGX TZS RWF" and "M-Pesa". The labels stay
                on sm+ where there is room; on mobile the chips sit in one
                unlabelled row, which is all they ever needed to be. */}
            <div className="mt-6 lg:mt-7">
              <span className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] sm:inline" style={{ color: 'var(--text-3)' }}>
                You get paid in
              </span>
              <div className="flex flex-wrap gap-1.5 sm:mt-2.5">
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
            <div className="mt-1.5 sm:mt-5">
              <span className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] sm:inline" style={{ color: 'var(--text-3)' }}>
                Deposit with
              </span>
              <div className="flex flex-wrap gap-1.5 sm:mt-2.5">
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
          {/* ACCORDIONS ON A PHONE, COLUMNS ON A DESKTOP.
              The 2-column mobile grid ran three unequal lists down the page
              and left the cell beside "Help & legal" empty, which is most of
              why the footer measured 1446px on a 390px screen: nearly two
              phone screens of links under a page that already has a bottom tab
              bar. <details> collapses them by default on mobile; sm+ is
              untouched (see .footer-acc in globals.css). */}
          <div className="flex flex-col sm:grid sm:grid-cols-3 sm:gap-8">
            {COLUMNS.map((col) => (
              <details key={col.heading} className="footer-acc border-b sm:border-0" style={{ borderColor: 'var(--hairline)' }}>
                <summary className="flex cursor-pointer list-none items-center justify-between py-3.5 text-[12px] font-semibold uppercase tracking-[0.12em] sm:hidden" style={{ color: 'var(--text)' }}>
                  {col.heading}
                  <span className="footer-acc-mark" aria-hidden>+</span>
                </summary>
                <h2 className="hidden text-[12px] font-semibold uppercase tracking-[0.12em] sm:block" style={{ color: 'var(--text)' }}>
                  {col.heading}
                </h2>
                <div className="footer-acc-body">
                <ul className="space-y-2.5 pb-4 sm:mt-4 sm:pb-0">
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
                </div>
              </details>
            ))}
          </div>
        </div>

        {/* Markets by category — the SEO topic surface.
            Polymarket runs 14 "<topic> Predictions & odds" links here; we ran
            none, so none of our category pages had an internal link pointing
            at it. Laid out as a wrapped row rather than a fourth column: it
            keeps the 3-column grid above intact and costs ~70px instead of a
            full column's height. */}
        <details className="footer-acc border-b pb-0 sm:border-0 sm:pb-10 sm:-mt-4" style={{ borderColor: 'var(--hairline)' }}>
          <summary className="flex cursor-pointer list-none items-center justify-between py-3.5 text-[12px] font-semibold uppercase tracking-[0.12em] sm:hidden" style={{ color: 'var(--text)' }}>
            Markets by category
            <span className="footer-acc-mark" aria-hidden>+</span>
          </summary>
          <h2 className="hidden text-[12px] font-semibold uppercase tracking-[0.12em] sm:block" style={{ color: 'var(--text)' }}>
            Markets by category
          </h2>
          <div className="footer-acc-body">
          <ul className="flex flex-wrap gap-x-5 gap-y-2.5 pb-4 sm:mt-3.5 sm:pb-0">
            {SEO_CATEGORIES.map((c) => (
              <li key={c}>
                <Link
                  href={categoryHref(c)}
                  className="footer-link text-[0.92rem] transition-colors"
                  style={{ color: 'var(--text-2)' }}
                >
                  {categoryLinkLabel(c)}
                </Link>
              </li>
            ))}
          </ul>
          </div>
        </details>

        {/* Risk / responsible-play disclosure */}
        <div
          className="mt-6 mb-8 flex flex-col gap-3 rounded-xl px-5 py-4 sm:mt-0 sm:mb-10 sm:flex-row sm:items-center sm:gap-5"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}
        >
          <p className="text-[12.5px] leading-relaxed flex-1" style={{ color: 'var(--text-2)' }}>
            <strong style={{ color: 'var(--text-2)' }}>Play with care.</strong>{' '}
            This is real money and you can lose what you put in. You must be 18 or older (25 in Uganda).
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
            © {YEAR} Elopis · Made for East Africa
          </p>
          <LocaleSwitcher />
        </div>
      </div>
    </footer>
  )
}
