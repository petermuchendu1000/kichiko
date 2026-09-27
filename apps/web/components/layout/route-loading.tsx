// components/layout/route-loading.tsx — shared skeleton for segment loading.tsx
// files. Deliberately generic (heading + card grid) so it does not promise a
// layout any particular page lacks. `.skeleton` animation is disabled under
// prefers-reduced-motion by the global rule in globals.css.
//
// Never mount this as app/loading.tsx or above a segment that calls notFound():
// once a Suspense boundary streams, the status is committed, so notFound() is
// served as a 200 soft-404 instead of a 404 (verified on /markets/[slug] and
// /traders/[id] with next build + next start).
import { getTranslations } from 'next-intl/server'

export async function RouteLoading() {
  const t = await getTranslations('common')

  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-6">
      <span className="sr-only">{t('loading')}</span>
      <div aria-hidden="true">
        <div className="skeleton mb-6 h-7 w-48 rounded" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-[180px] rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
