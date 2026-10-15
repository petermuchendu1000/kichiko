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
      {/* gray-400 on the gray-100 fill measured 2.3:1 (axe, serious): the one
          piece of text on this box was the least legible thing on the page.
          gray-600 on gray-100 is 7.6:1; the dark pair was no better at
          gray-500 on gray-800, so it moves with it. */}
      <span className="text-xs text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  )
}
