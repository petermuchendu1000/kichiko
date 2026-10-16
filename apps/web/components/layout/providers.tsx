'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Toaster } from 'react-hot-toast'
import dynamic from 'next/dynamic'

// The dialog renders nothing until the elopis:open-auth event fires, so there
// is no reason for it to be in the first load of every page in the product.
// `openAuthDialog` lives in lib/auth-dialog-bus.ts and stays eager — it is
// three lines, and the callers need it synchronously.
const AuthDialog = dynamic(
  () => import('@/components/auth/auth-dialog').then((m) => m.AuthDialog),
  { ssr: false },
)

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Global in-context auth dialog — opened via the elopis:open-auth
          event so any surface (e.g. the order ticket's gate) can summon it
          without prop-drilling or a page navigation. */}
      <AuthDialog />
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--hairline)',
            borderRadius: '12px',
            fontSize: '14px',
            fontFamily: 'var(--font-inter), system-ui, sans-serif',
            boxShadow: 'var(--e3)',
          },
          success: {
            iconTheme: { primary: '#1F9D6B', secondary: '#fff' },
          },
          error: {
            iconTheme: { primary: '#D1495B', secondary: '#fff' },
          },
        }}
      />
    </QueryClientProvider>
  )
}
