// /search — instant, keyboard-first market discovery. Field + category facets,
// recent (local) + trending scaffold, and a results grid of the canonical
// MarketCard. Pip system, no emoji, no DaisyUI. Search pages are thin/
// duplicative → noindex.
import type { Metadata } from 'next'
import { SearchView } from '@/components/search/search-view'
import { IconSearch } from '@/components/ui/icons'

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search events on Kichiko by word, topic and status.',
  robots: { index: false, follow: true },
}

export default function SearchPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-start gap-3">
        <span
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
          style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}
          aria-hidden="true"
        >
          <IconSearch size={20} />
        </span>
        <div>
          <h1 className="font-display text-2xl" style={{ color: 'var(--text-primary)' }}>
            Search
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            Find any market in an instant.
          </p>
        </div>
      </header>

      <SearchView />
    </div>
  )
}
