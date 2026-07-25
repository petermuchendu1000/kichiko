// components/markets/related-markets.tsx
// ---------------------------------------------------------------------------
// Polymarket parity (M7). Ground truth captured from PM's live market-detail
// DOM (event/democratic-presidential-nominee-2028). PM's "Related" block is a
// BORDERLESS vertical list of ghost rows — NOT a bordered card grid. Each row:
//
//   <a href="/event/…">
//     <div ...py-1 lg:px-2.5 lg:py-2 flex flex-row items-center gap-2.5 w-full
//          cursor-pointer rounded-lg bg-button-ghost-bg lg:hover:…-hover>
//       <div relative overflow-hidden rounded-md  style="h40 w40 minw40">
//         <img object-cover>                       ← 40×40 rounded-md cover
//       <div flex flex-col flex-1 gap-0.5>
//         <p text-text font-medium line-clamp-2 text-sm>{title}</p>
//       <div flex flex-col my-auto items-end ml-1>
//         <span text-text font-medium text-base lg:text-lg leading-normal>{pct}%</span>
//         <div text-xs text-text-secondary>{leading outcome}</div>
//
// Token map (PM → MarketPips): text-text→text-text-primary,
// text-text-secondary→text-text-secondary, button-ghost hover→hover:bg-surface-2,
// icon rounded-md (6px) via EntityAvatar radius={6}. Heading is
// `text-text font-medium mb-4` (PM), NOT the old text-base font-semibold box.
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { EntityAvatar } from '@/components/ui/entity-avatar'
import { getLeadingOptions } from '@/lib/markets/leading-options'
import { hideSettling } from '@/lib/markets/settling'
import type { Market, MarketCategory } from '@/types'

interface RelatedMarketsProps {
  marketId: string
  category: MarketCategory
}

export async function RelatedMarkets({ marketId, category }: RelatedMarketsProps) {
  const supabase = await createClient()

  const { data: markets } = await supabase
    .from('markets')
    .select(`
      *,
      creator:profiles!markets_creator_id_fkey(id, display_name, username)
    `)
    .eq('status', 'active')
    .eq('category', category)
    .neq('id', marketId)
    .order('total_volume_usd', { ascending: false })
    .limit(6)

  if (!markets?.length) return null

  // Partial `creator` select (id/display_name/username only) → bridge via
  // unknown, matching the convention in app/markets/[slug]/page.tsx.
  // Hide any active-but-past-close windows so they don't render as "Settling…".
  const typed = hideSettling(markets as unknown as Market[])
  if (!typed.length) return null

  const { leadByMarket } = await getLeadingOptions(
    supabase,
    typed.filter((m) => m.resolution_type === 'multiple_choice').map((m) => m.id),
  )

  return (
    <section aria-labelledby="related-heading">
      {/* PM: `text-text font-medium mb-4`. */}
      <h2 id="related-heading" className="mb-4 text-base font-medium text-text-primary">
        Related
      </h2>

      {/* PM: borderless vertical stack of ghost rows (no card frame, no dividers). */}
      <div className="flex w-full flex-col">
        {typed.map((market) => {
          const isMulti = market.resolution_type === 'multiple_choice'
          const lead = leadByMarket.get(market.id)
          const pct = isMulti
            ? lead
              ? Math.round(lead.price * 100)
              : null
            : Math.round((market.yes_price ?? 0) * 100)
          // PM shows the leading OUTCOME name under the % (e.g. "JD Vance").
          // Multi → leading candidate label; binary carries no sublabel in PM.
          const subLabel = isMulti ? lead?.label ?? null : null

          return (
            <Link
              key={market.id}
              href={`/markets/${market.slug}`}
              className="group relative flex w-full cursor-pointer flex-row items-center gap-2.5 rounded-lg py-1 transition-colors lg:px-2.5 lg:py-2 lg:hover:bg-surface-2"
            >
              {/* 40×40 rounded-md cover icon (PM exact). */}
              <EntityAvatar
                name={market.title}
                imageUrl={market.cover_image_url}
                size={40}
                shape="squircle"
                radius={9}
              />

              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                {/* PM measured: text-[13px] font-semibold, lh 19.5px, ls -0.09px
                    (#18181b ~= text-primary). Was 14px/500 — visibly heavier and
                    tighter on PM. See docs/design/PM-PARITY-SPEC.md §2.5. */}
                <span className="line-clamp-2 text-[13px] font-semibold leading-[19.5px] tracking-[-0.09px] text-text-primary">
                  {market.title}
                </span>
              </span>

              {pct != null && (
                <span className="my-auto ml-1 flex flex-none flex-col items-end">
                  <span className="text-base font-medium leading-normal tabular-nums text-text-primary lg:text-lg">
                    {pct}%
                  </span>
                  {subLabel && (
                    <span className="max-w-[7.5rem] truncate text-xs text-text-muted">
                      {subLabel}
                    </span>
                  )}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
