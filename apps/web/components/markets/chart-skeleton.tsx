// components/markets/chart-skeleton.tsx
// CLS-safe placeholder shown while a Recharts chart chunk loads. Fills its
// parent (charts use ResponsiveContainer height="100%"), so it reserves the
// exact same box the chart will occupy -- no layout shift on hydration.
export function ChartSkeleton({ label = 'Loading chart…' }: { label?: string }) {
  return (
    <div
      className="relative flex h-full min-h-[220px] w-full items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800/60"
      role="img"
      aria-label={label}
    >
      {/* The pulse is a BACKGROUND wash, not the whole box.
          `animate-pulse` animates opacity on whatever carries it, and the
          label used to carry it with everything else — so its contrast
          halved on every cycle. Measured by axe mid-pulse: gray-600 composited
          to #9aa0a8 on #f8f9fa, **2.5:1**, serious. At rest the same pair is
          7.6:1, which is what the earlier fix measured and recorded; the
          animation was quietly undoing it half the time.

          That also made the a11y gate non-deterministic: whether it caught
          this depended on where the pulse happened to be when axe ran, which
          is why it passed for weeks and then failed. The wash animates, the
          text does not, and the result is both legible and stable. */}
      <span
        className="absolute inset-0 animate-pulse bg-gray-200/60 dark:bg-gray-700/40"
        aria-hidden="true"
      />
      <span className="relative text-xs text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  )
}
