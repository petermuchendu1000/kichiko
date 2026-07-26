'use client'

// Auto-generated FAQ accordion — improves comprehension for first-time traders
// and adds crawlable long-tail SEO surface. Questions/answers are derived from
// this market's own data (title, category, close date, fee) with Kichiko
// original copy. A matching FAQPage JSON-LD block is emitted server-side on the
// market page so search engines can index the same Q&A.

import { useState } from 'react'
import { IconChevronDown } from '@/components/ui/icons'
import { buildMarketFaq, type FaqItem } from '@/lib/markets/faq'

// Re-export so existing imports from this module keep working.
export { buildMarketFaq }
export type { FaqItem }

function FaqRow({ item, defaultOpen }: { item: FaqItem; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  return (
    <div className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-3.5 text-left"
      >
        <span className="text-sm font-semibold text-text-primary">{item.q}</span>
        <IconChevronDown
          size={16}
          className={`shrink-0 text-text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <p className="pb-4 pr-6 text-sm leading-relaxed text-text-secondary">{item.a}</p>}
    </div>
  )
}

export function MarketFaq({ items }: { items: FaqItem[] }) {
  if (!items.length) return null
  return (
    <div className="p-4 max-lg:px-0">
      {/* PM: `text-[16px] font-semibold text-text-primary mb-2`, Title Case. */}
      <h2 className="mb-2 text-[16px] font-semibold text-text-primary">Frequently Asked Questions</h2>
      <div>
        {items.map((item, i) => (
          <FaqRow key={i} item={item} defaultOpen={i === 0} />
        ))}
      </div>
    </div>
  )
}
