'use client'
// components/markets/btc-live-chart.lazy.tsx
// Code-splits the Recharts-backed BtcLiveChart. Drop-in for ./btc-live-chart.
import dynamic from 'next/dynamic'
import { ChartSkeleton } from './chart-skeleton'

export const BtcLiveChart = dynamic(
  () => import('./btc-live-chart').then((m) => m.BtcLiveChart),
  { ssr: false, loading: () => <ChartSkeleton label="Loading BTC chart…" /> },
)
