'use client'

// app/error.tsx — route-level error boundary for every segment under the root
// layout. Without it, a thrown render error (admin pages `throw` on a failed
// query) fell through to Next's unstyled default. Navbar and footer stay
// mounted, so the user keeps their bearings. No <main>: the root layout owns it.
import { useEffect, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('shell')
  const router = useRouter()
  const [retrying, startRetry] = useTransition()

  // reset() alone only re-renders the client tree; a server component that
  // failed on a transient Supabase error needs its RSC payload refetched too.
  const retry = () =>
    startRetry(() => {
      router.refresh()
      reset()
    })

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div
      role="alert"
      className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-2xl font-semibold text-text-primary">{t('errorTitle')}</h1>
      <p className="text-text-secondary">{t('errorBody')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={retry} disabled={retrying} className="btn btn-primary min-h-11">
          {t('tryAgain')}
        </button>
        <Link href="/" className="btn btn-secondary min-h-11">
          {t('goHome')}
        </Link>
      </div>
      {error.digest && (
        <p className="font-mono text-xs text-text-muted">{t('errorReference', { digest: error.digest })}</p>
      )}
    </div>
  )
}
