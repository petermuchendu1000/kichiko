'use client'

// components/payments/stk-push-loader.tsx
//
// STK-push processing/waiting screen. Adapted from the community Next.js M-Pesa
// Daraja pattern (Rizwan's `STKPushQueryLoading`, mpesa-nextjs-docs.vercel.app):
// a processing indicator shown while the STK push is sent and the user enters
// their M-Pesa PIN, paired with short-poll status querying. Restyled here to
// MarketPips design tokens with a circular ring animation (the reference used a
// plain pulsing text block).
//
// Two phases:
//   sending → the STK push request is in flight (POST /api/payments/deposit)
//   waiting → the push has been delivered; we're polling for PIN confirmation

interface StkPushLoaderProps {
  /** E.164 / local phone the push was sent to (shown in the waiting copy). */
  phone?: string
  phase: 'sending' | 'waiting'
  /** After the poll window elapses without a terminal status. */
  timedOut?: boolean
}

export function StkPushLoader({ phone, phase, timedOut = false }: StkPushLoaderProps) {
  return (
    <div className="py-6 text-center">
      {/* Circular loading animation: static track + rotating accent arc, with a
          gently pulsing phone glyph at the centre. */}
      <div className="relative mx-auto mb-5 h-20 w-20" role="status" aria-live="polite">
        <div className="absolute inset-0 rounded-full border-4 border-[var(--pip-100)]" />
        <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-[var(--pip-500)] border-r-[var(--pip-500)]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="animate-pulse" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--pip-500)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
            <line x1="10" y1="18.5" x2="14" y2="18.5" />
          </svg>
        </div>
        <span className="sr-only">
          {phase === 'sending' ? 'Sending M-Pesa request' : 'Waiting for your M-Pesa PIN'}
        </span>
      </div>

      {phase === 'sending' ? (
        <>
          <h3 className="font-display text-xl mb-2" style={{ color: 'var(--text-primary)' }}>
            Sending M-Pesa request…
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Preparing the payment prompt on your phone.
          </p>
        </>
      ) : (
        <>
          <h3 className="font-display text-xl mb-2" style={{ color: 'var(--text-primary)' }}>
            STK pushed
          </h3>
          <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
            Enter your PIN to deposit
            {phone ? (
              <>
                {' '}— sent to <strong>{phone}</strong>
              </>
            ) : (
              '.'
            )}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }} aria-live="polite">
            {timedOut
              ? "Still processing — it can take a moment. We'll credit your wallet as soon as it clears."
              : 'Waiting for confirmation… this updates automatically.'}
          </p>
        </>
      )}
    </div>
  )
}
