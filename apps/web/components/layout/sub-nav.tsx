'use client'

// components/layout/sub-nav.tsx
// ------------------------------------------------------------
// Global mount for the under-nav category rail. Previously the category bar was
// rendered only on the homepage; it is now pinned beneath the main navbar on
// EVERY page so the browse context never disappears as the user navigates —
// with the exception of full-screen / chrome-less routes (auth, admin, the
// offline fallback) where a market-browse rail would be out of place.
import { usePathname } from 'next/navigation'
import { HomeCategoryBar } from '@/components/layout/home-category-bar'

// Route prefixes that should NOT show the category rail.
const HIDDEN_PREFIXES = ['/auth', '/admin', '/offline']

/** Shared with the navbar, which renders the strip inline on lg+. */
export function showCategoryRail(pathname: string | null): boolean {
  if (!pathname) return false
  return !HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export function SubNav() {
  const pathname = usePathname()
  if (!showCategoryRail(pathname)) return null
  // lg and up the navbar carries this strip inside its own row, so rendering
  // it here too would put the bar back twice.
  return (
    <div className="lg:hidden">
      <HomeCategoryBar />
    </div>
  )
}
