'use client'
// components/portfolio/allocation-donut.lazy.tsx
// Code-splits the Recharts-backed AllocationDonut off the /portfolio first load.
// Re-exports the AllocationSlice type so it stays a drop-in import swap.
import dynamic from 'next/dynamic'

export type { AllocationSlice } from './allocation-donut'

export const AllocationDonut = dynamic(
  () => import('./allocation-donut').then((m) => m.AllocationDonut),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-[176px] w-[176px] flex-none animate-pulse rounded-full bg-gray-100 dark:bg-gray-800/60"
        role="img"
        aria-label="Loading allocation chart…"
      />
    ),
  },
)
