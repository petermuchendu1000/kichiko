// app/offline/page.tsx — offline fallback served by the service worker.
// Static, dependency-free, works without network.

import Link from 'next/link'

export const metadata = {
  title: 'Offline',
}

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">You’re offline</h1>
      <p className="text-gray-600 dark:text-gray-400">
        Kichiko can’t reach the network right now. Check your connection and try again — your data is safe.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
      >
        Retry
      </Link>
    </main>
  )
}
