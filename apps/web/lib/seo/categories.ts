// lib/seo/categories.ts — the categories worth offering as their own landing
// target, shared by the footer's topic links and the sitemap so the two can
// never drift apart.
//
// `/markets?category=<slug>` renders a distinct title, description and result
// set, and (since this change) carries its own canonical, so each one is a
// real page rather than a filtered view of /markets.
//
// `other` is excluded deliberately. It is a catch-all bucket, and "Other
// predictions" is not a thing anyone searches for; every remaining category is
// a phrase with genuine search demand in the region.
import { CATEGORY_LABELS } from '@/types'
import { MARKET_CATEGORIES } from '@/lib/search'
import type { MarketCategory } from '@/types'

export const SEO_CATEGORIES: MarketCategory[] = MARKET_CATEGORIES.filter(
  (c) => c !== 'other',
)

/** Footer/link label, e.g. "Politics predictions". */
export function categoryLinkLabel(c: MarketCategory): string {
  return `${CATEGORY_LABELS[c].label} predictions`
}

export function categoryHref(c: MarketCategory): string {
  return `/markets?category=${c}`
}
