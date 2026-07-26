'use client'
// components/markets/outcomes-chart.lazy.tsx
// Code-splits the Recharts-backed OutcomesChart. Drop-in for ./outcomes-chart.
import dynamic from 'next/dynamic'
import { ChartSkeleton } from './chart-skeleton'

export const OutcomesChart = dynamic(
  () => import('./outcomes-chart').then((m) => m.OutcomesChart),
  { ssr: false, loading: () => <ChartSkeleton label="Loading outcomes chart…" /> },
)
