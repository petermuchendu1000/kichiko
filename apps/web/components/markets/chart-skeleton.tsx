// components/markets/chart-skeleton.tsx
// CLS-safe placeholder shown while a Recharts chart chunk loads. Fills its
// parent (charts use ResponsiveContainer height="100%"), so it reserves the
// exact same box the chart will occupy -- no layout shift on hydration.
export function ChartSkeleton({ label = 'Loading chart…' }: { label?: string }) {
  return (
    <div
      className="flex h-full min-h-[220px] w-full animate-pulse items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800/60"
      role="img"
      aria-label={label}
    >
      <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
    </div>
  )
}
