// app/robots.ts — /robots.txt. Disallows the authenticated and operator
// surfaces (which also carry robots: noindex in their own metadata) and the
// API, and points crawlers at the sitemap.
import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/seo/site-url'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin',
        '/auth',
        '/creator',
        '/marketer',
        '/kyc',
        '/portfolio',
        '/profile',
        '/settings',
        '/notifications',
        '/search',
        '/offline',
        '/markets/create',
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
