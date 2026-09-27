// app/not-found.tsx — rendered for unknown URLs and every notFound() call
// (market, trader and creator pages), which previously fell to Next's default.
// No <main>: the root layout owns it.
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
}

export default async function NotFound() {
  const t = await getTranslations()

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-sm font-semibold text-text-muted">404</p>
      <h1 className="text-2xl font-semibold text-text-primary">{t('shell.notFoundTitle')}</h1>
      <p className="text-text-secondary">{t('shell.notFoundBody')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/markets" className="btn btn-primary min-h-11">
          {t('common.browseMarkets')}
        </Link>
        <Link href="/" className="btn btn-secondary min-h-11">
          {t('shell.goHome')}
        </Link>
      </div>
    </div>
  )
}
