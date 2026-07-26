'use client'
// components/markets/price-chart.lazy.tsx
// Code-splits Recharts out of the initial bundle: the PriceChart (and the whole
// recharts vendor chunk) is fetched on demand, client-side only. Keeps the
// heavy chart lib off the /markets/[slug] and order-book-drawer first load.
// Same name + props as ./price-chart, so it is a drop-in import swap.
import dynamic from 'next/dynamic'
import { ChartSkeleton } from './chart-skeleton'

export const PriceChart = dynamic(
  () => import('./price-chart').then((m) => m.PriceChart),
  { ssr: false, loading: () => <ChartSkeleton label="Loading price chart…" /> },
)
