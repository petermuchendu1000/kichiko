// lib/seo/site-url.ts — canonical absolute origin for sitemap/robots, without a
// trailing slash. Mirrors metadataBase in app/layout.tsx.
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
}
