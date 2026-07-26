// components/kyc/kyc-console.tsx
// Two-pane verification console (BRIDGE -> GATE), mirroring AuthShell so the KYC
// flow feels like one continuous, institutional surface.
//   - BRIDGE (left, desktop, sticky): brand lockup + a `bridge` slot (level meter
//     and step rail) + the persistent TrustRail. Establishes trust *before* the ask.
//   - GATE (right): the focused step content (children). On mobile the bridge is
//     hidden and the gate carries its own compact progress + level badge.
import type { ReactNode } from 'react'
import { LogoMark } from '@/components/ui/icons'
import { TrustRail } from '@/components/kyc/trust-rail'

interface KycConsoleProps {
  /** Level meter + vertical step rail shown in the desktop bridge. */
  bridge: ReactNode
  /** The gate content — overview, a step, or a terminal state. */
  children: ReactNode
}

export function KycConsole({ bridge, children }: KycConsoleProps) {
  return (
    <div className="grid lg:grid-cols-[minmax(300px,360px)_1fr]">
      {/* BRIDGE — trust context (desktop only) */}
      <aside className="relative hidden border-r border-hairline bg-surface-2 lg:block">
        <div className="sticky top-14 flex h-[calc(100dvh-56px)] flex-col overflow-y-auto p-8 xl:p-10">
          <div className="flex items-center gap-2">
            <LogoMark size={26} />
            <span className="font-display text-[15px] font-bold tracking-tight text-text-primary">
              Kichiko
            </span>
          </div>

          <div className="flex-1 py-9">{bridge}</div>

          <TrustRail />
        </div>
      </aside>

      {/* GATE — the focused step */}
      <div className="flex justify-center px-4 py-8 sm:px-6 lg:py-12">
        <div className="w-full max-w-xl">{children}</div>
      </div>
    </div>
  )
}
