// components/markets/create/structure-card.tsx
// Large selectable structure option (Binary / Multi-outcome). Multi-outcome is a
// first-class, fully-designed choice but gated "Coming soon" because the trading
// engine is binary-only today. Real button with aria-pressed; never color-only.
import type { ReactNode } from 'react'
import { IconCheck } from '@/components/ui/icons'

interface StructureCardProps {
  title: string
  desc: string
  icon: ReactNode
  selected: boolean
  disabled?: boolean
  badge?: string
  onClick: () => void
}

export function StructureCard({ title, desc, icon, selected, disabled, badge, onClick }: StructureCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`relative flex w-full flex-col items-start gap-3 rounded-md border p-5 text-left transition-[color,background-color,border-color,box-shadow] duration-150 ${
        disabled
          ? 'cursor-not-allowed border-hairline bg-surface-2 opacity-70'
          : selected
            ? 'border-pip-500 bg-pip-100 shadow-[0_0_0_1px_var(--pip-500)]'
            : 'border-hairline bg-surface hover:border-pip-300 hover:shadow-[var(--e2)]'
      }`}
    >
      <div className="flex w-full items-start justify-between">
        <span
          className={`flex h-10 w-10 flex-none items-center justify-center rounded-md ${
            selected ? 'bg-pip-500 text-white' : 'bg-pip-100 text-pip-500'
          }`}
        >
          {icon}
        </span>
        {badge ? (
          <span className="badge badge-muted">{badge}</span>
        ) : selected ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-pill bg-pip-500 text-white">
            <IconCheck size={12} strokeWidth={3} />
          </span>
        ) : null}
      </div>
      <div>
        <span className="block font-display text-base text-text-primary">{title}</span>
        <span className="mt-1 block text-sm leading-snug text-text-secondary">{desc}</span>
      </div>
    </button>
  )
}
