import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import './globals.css'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Navbar } from '@/components/layout/navbar'
import { SubNav } from '@/components/layout/sub-nav'
import { BottomNav } from '@/components/layout/bottom-nav'
import { SiteFooter } from '@/components/layout/site-footer'
import { Providers } from '@/components/layout/providers'
import { ThemeProvider } from '@/components/layout/theme-provider'
import { WebVitals } from '@/components/perf/web-vitals'
import { ServiceWorkerRegister } from '@/components/perf/service-worker-register'

// UI typeface — Inter (variable, full 100–900 range), Polymarket's primary UI face.
// Loaded as a variable font so every weight (incl. 490/500/600) is available.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

// Numerics — Geist Mono for tabular prices/probabilities (Polymarket parity).
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: {
    default: 'MarketPips: East Africa Prediction Markets',
    template: '%s · MarketPips',
  },
  description: 'Predict what will happen next in real events. Pay with M-Pesa. Made for East Africa.',
  keywords: ['prediction market', 'M-Pesa', 'Kenya', 'East Africa', 'sports betting', 'elections', 'crypto'],
  // Locale-aware SEO (Module 17.4). We use cookie/profile-based locale selection
  // (no per-locale URL segment), so every language is served from the same
  // canonical URL; the hreflang map advertises the supported languages and an
  // x-default for crawlers. See docs/i18n/TRANSLATION.md §SEO for rationale.
  alternates: {
    canonical: '/',
    languages: {
      en: '/',
      sw: '/',
      fr: '/',
      am: '/',
      'x-default': '/',
    },
  },
  authors: [{ name: 'MarketPips' }],
  creator: 'MarketPips',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    siteName: 'MarketPips',
    title: 'MarketPips: The clearest view of what happens next',
    description: 'A simple, honest way to predict real events like elections, the economy, sports and more. Made for East Africa, pay with M-Pesa.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'MarketPips' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MarketPips',
    description: 'A simple way to predict what happens next, made for East Africa',
    images: ['/og-image.png'],
  },
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2B50E4',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Active locale + messages (next-intl, cookie/profile-based). `lang` reflects
  // the real locale for assistive tech & SEO (WCAG 3.1.1).
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={`${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="antialiased">
        {/* Skip-to-content: first focusable element, visible on keyboard focus (WCAG 2.4.1). */}
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {/* ThemeProvider (next-themes) sets the `dark` class on <html> before
            paint — defaultTheme="dark" keeps the institutional look for new
            visitors while letting the navbar toggle switch to light. */}
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <Providers>
              <Navbar />
              {/* Under-nav category rail — persists across pages (except auth /
                  admin / offline), so the browse context is never lost. */}
              <SubNav />
              <main id="main-content" tabIndex={-1}>
                {children}
              </main>
              <SiteFooter />
              {/* Mobile bottom navigation (Home · Search · Breaking · More).
                  Fixed to the bottom on <lg; the spacer below reserves scroll
                  room so page/footer content is never hidden behind it. */}
              <BottomNav />
              <div
                aria-hidden
                className="lg:hidden"
                style={{ height: 'calc(3.5rem + env(safe-area-inset-bottom))' }}
              />
              <WebVitals />
              <ServiceWorkerRegister />
            </Providers>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
