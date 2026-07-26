// components/auth/auth-shell.tsx
// Split-screen auth surface implementing the Preview → Gate → Bridge model:
//   • BRIDGE (left, desktop): shows the product's value + trust cues BEFORE the
//     gate, so the form never feels like a cold wall.
//   • GATE (right): the minimal form itself (passed as children).
// Institutional, calm, brand-led (Pip blue). No emoji, custom icons only.
import type { ReactNode } from 'react'
import { LogoMark, IconCheck, IconShield } from '@/components/ui/icons'

interface AuthShellProps {
  /** Bridge headline shown on the desktop value panel. */
  bridgeHeading: string
  bridgeSub: string
  children: ReactNode
}

const VALUE_PROPS = [
  'Trade elections, sports, crypto and more',
  'Deposit with M-Pesa, MTN MoMo & Airtel Money',
  'Multi-currency wallets across East Africa',
  'Transparent LMSR pricing — see fills before you commit',
]

const RAILS = ['M-Pesa', 'MTN MoMo', 'Airtel Money', 'Bank']

export function AuthShell({ bridgeHeading, bridgeSub, children }: AuthShellProps) {
  return (
    <div className="grid min-h-[calc(100dvh-56px)] lg:grid-cols-2">
      {/* BRIDGE — value + social proof (desktop only) */}
      <aside className="relative hidden flex-col justify-between border-r border-hairline bg-surface-2 p-10 lg:flex xl:p-14">
        <div className="flex items-center gap-2">
          <LogoMark size={28} />
          <span className="font-display text-[15px] font-bold tracking-tight text-text-primary">
            Kichiko
          </span>
        </div>

        <div className="max-w-md">
          <h2 className="font-display text-3xl leading-tight text-text-primary">{bridgeHeading}</h2>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary">{bridgeSub}</p>

          <ul className="mt-8 space-y-3">
            {VALUE_PROPS.map((p) => (
              <li key={p} className="flex items-start gap-2.5 text-sm text-text-secondary">
                <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-pill bg-pip-100 text-pip-500">
                  <IconCheck size={11} strokeWidth={2.5} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {RAILS.map((r) => (
              <span
                key={r}
                className="rounded-sm border border-hairline bg-surface px-2 py-1 text-[11px] font-medium text-text-muted"
              >
                {r}
              </span>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-text-muted">
            <IconShield size={12} /> Bank-grade encryption · Your data is never sold
          </p>
        </div>
      </aside>

      {/* GATE — the form */}
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
