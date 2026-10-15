// lib/markets/source-name.ts — the readable host of a resolution source.
//
// The market page used to render a bare "Resolution source" link. When the
// link works that is merely terse; when it does not, the reader learns nothing
// at all about who settles their money. www.iebc.or.ke, the authority for
// every election market, serves an incomplete certificate chain: desktop
// browsers fetch the missing issuer and recover, older Android does not, and
// that is a large share of this audience.
//
// Naming the source makes the resolution mechanism *stated* rather than merely
// linked, which is what L.N. 112 Reg. 45(6) asks for, and it survives a broken
// link. The host is used rather than a curated display name so there is no
// second mapping to drift out of step with the URLs themselves.
export function resolutionSourceName(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '')
    return host || null
  } catch {
    return null
  }
}
