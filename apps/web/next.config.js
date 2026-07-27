/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone) so the Docker
  // runtime stage (and Fly.io deploy in Module 16) can ship a minimal image
  // that runs `node server.js` without the full node_modules tree.
  output: 'standalone',
  // The app lives in apps/web inside an npm-workspaces monorepo; tell Next to
  // trace/copy files from the repo root so standalone output is complete.
  outputFileTracingRoot: require('path').join(__dirname, '../../'),
  serverExternalPackages: ['sharp'],
  images: {
    // The legacy `images.domains` key is deprecated and does NOT support
    // wildcards (the previous '*.supabase.co' entry never matched). All hosts
    // are declared via `remotePatterns`, which supports wildcard subdomains
    // (F-06/F-07).
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      // OAuth avatar providers (Supabase Auth — GitHub / Google). Previously
      // declared via the deprecated `domains` list; kept here so avatars keep
      // loading through next/image (matches the CSP img-src allowlist).
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      // Entity-image upgrade path (ingestion sources — normalised & stored):
      { protocol: 'https', hostname: 'www.google.com' },
      { protocol: 'https', hostname: 'cdn.brandfetch.io' },
      { protocol: 'https', hostname: 'logo.clearbit.com' },
      { protocol: 'https', hostname: 'img.logo.dev' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: '**.wikipedia.org' },
    ],
  },
  env: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    NEXT_PUBLIC_APP_NAME: 'Kichiko',
  },
  async headers() {
    // Same-origin API: reflect only the app origin (never '*' with credentials,
    // which is invalid and unsafe). Cross-origin browsers are denied by default.
    const appOrigin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: appOrigin },
          { key: 'Vary', value: 'Origin' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization' },
        ],
      },
      {
        // The service worker must revalidate on every load so new versions ship
        // promptly (the SW itself is tiny; its cached assets are hashed).
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        // Content-hashed build assets are immutable — cache hard at the edge/browser.
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/health',
        destination: '/api/health',
      },
    ]
  },
}

// Wire next-intl (Module 17.3). Cookie/profile-based locale (no URL segment);
// message catalogs live in ./messages, resolved by ./i18n/request.ts.
const createNextIntlPlugin = require('next-intl/plugin')
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

module.exports = withNextIntl(nextConfig)
