// app/sitemap.ts — /sitemap.xml: public static pages plus every publicly
// viewable market. Uses the anon key with no session, so RLS ("Active markets
// are publicly viewable": active/closed/resolved and not hidden) decides what is
// listed; the explicit filters below repeat it as defence in depth. Any failure
// degrades to the static list rather than failing the route.
import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import { siteUrl } from '@/lib/seo/site-url'

export const revalidate = 3600

const STATIC_PATHS: Array<{ path: string; changeFrequency: 'hourly' | 'daily' | 'monthly'; priority: number }> = [
  { path: '/', changeFrequency: 'hourly', priority: 1 },
  { path: '/markets', changeFrequency: 'hourly', priority: 0.9 },
  { path: '/help', changeFrequency: 'monthly', priority: 0.3 },
  { path: '/legal/terms', changeFrequency: 'monthly', priority: 0.2 },
  { path: '/legal/privacy', changeFrequency: 'monthly', priority: 0.2 },
  { path: '/legal/responsible-play', changeFrequency: 'monthly', priority: 0.3 },
]

// Sitemap protocol caps a single file at 50,000 URLs.
const MAX_MARKETS = 45_000

// The sitemap is prerendered at build time. A database that accepts the
// connection but never answers used to hang the request until Next's 60s
// static-generation limit failed the whole build (seen in CI). Give up after
// 8s and serve the static list; the hourly revalidation fills in markets.
const DB_TIMEOUT_MS = 8000
const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(DB_TIMEOUT_MS) })

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map(({ path, changeFrequency, priority }) => ({
    url: `${base}${path}`,
    changeFrequency,
    priority,
  }))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return entries

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout },
    })
    const { data, error } = await supabase
      .from('markets')
      .select('slug, status, updated_at')
      .in('status', ['active', 'closed', 'resolved'])
      .eq('is_hidden', false)
      .order('updated_at', { ascending: false })
      .limit(MAX_MARKETS)
    if (error || !data) return entries

    for (const m of data as Array<{ slug: string | null; status: string; updated_at: string | null }>) {
      if (!m.slug) continue
      entries.push({
        url: `${base}/markets/${encodeURIComponent(m.slug)}`,
        lastModified: m.updated_at ? new Date(m.updated_at) : undefined,
        changeFrequency: m.status === 'active' ? 'hourly' : 'monthly',
        priority: m.status === 'active' ? 0.8 : 0.4,
      })
    }
  } catch {
    // Network/DB unavailable or too slow (e.g. CI build): static list only.
  }
  return entries
}
