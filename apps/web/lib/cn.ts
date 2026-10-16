// lib/cn.ts
// ---------------------------------------------------------------------------
// The Tailwind class merger, on its own.
//
// WHY IT IS NOT IN lib/utils.ts
// It was, and `tailwind-merge` is ~72 kB of original source. Twenty-one files
// import something from lib/utils; exactly ONE of them calls `cn`. The other
// twenty reach for `formatUSD` or `formatVolume` and get a class-name resolver
// they never call — measured inside /markets/[slug]'s first load from the
// build's own source maps, 2026-10-16.
//
// It is the same defect as the zod schema sitting beside the CLOB helpers, as
// `openAuthDialog` sitting inside the 766-line dialog, and as the Supabase
// client constructed during render: a heavy dependency parked in a module
// people import for a neighbour. Ruling A11.
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Join class names, with later Tailwind utilities beating conflicting earlier
 *  ones (`cn('px-2', 'px-4')` → `'px-4'`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
