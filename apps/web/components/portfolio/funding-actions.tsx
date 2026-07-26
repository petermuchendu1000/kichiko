'use client'

// components/portfolio/funding-actions.tsx — friction #11.
// Portfolio-level Deposit / Withdraw buttons so funding isn't only reachable
// from the navbar. Both dispatch the same decoupled global events the navbar
// listens for (which also handle the logged-out → auth-first flow, #13).
import { IconDeposit, IconWithdraw } from '@/components/ui/icons'

export function PortfolioFundingActions() {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('kichiko:open-deposit'))}
        className="btn btn-primary inline-flex items-center gap-1.5"
      >
        <IconDeposit size={16} />
        Deposit
      </button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('kichiko:open-withdraw'))}
        className="btn btn-ghost inline-flex items-center gap-1.5"
      >
        <IconWithdraw size={16} />
        Withdraw
      </button>
    </div>
  )
}
