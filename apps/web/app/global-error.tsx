'use client'

// app/global-error.tsx — last-resort boundary for errors thrown by the root
// layout itself (e.g. locale/message loading). It REPLACES the root layout, so
// it renders its own <html>/<body>, and no next-intl provider exists here:
// copy is English and styling is inline so it works even if CSS failed to load.
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0E0F11',
          color: '#F3F5F8',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <main role="alert" style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 12px' }}>Something went wrong</h1>
          <p style={{ color: '#AEB4BC', margin: '0 0 20px', lineHeight: 1.5 }}>
            Kichiko couldn’t load. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '0 20px',
              border: 0,
              borderRadius: 7.2,
              background: '#1452F0',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: 16, fontSize: 12, color: '#9AA1AB', fontFamily: 'ui-monospace, monospace' }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
