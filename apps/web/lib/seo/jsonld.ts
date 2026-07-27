// lib/seo/jsonld.ts — safe JSON-LD serialization for inline <script> injection.
//
// JSON.stringify does NOT escape '<', '>' or '&', so creator-controlled fields
// (e.g. market.title / market.description) embedded in a
// <script type="application/ld+json"> block can break out of that block via a
// literal '</script>' sequence and inject arbitrary markup/JS (stored XSS,
// finding H5). This serializer JSON-stringifies the value and then escapes the
// characters that are dangerous inside an HTML <script> context, plus the two
// Unicode line separators (U+2028 / U+2029) that are invalid in JS string
// literals and can break JSON parsers embedded in scripts.
//
// The escaped forms are valid JSON string escapes, so the output still parses
// back to the original value — search engines read identical structured data,
// while a browser can never see a raw '<', '>' or '&' inside the block.
//
// Pure + framework-free so it is edge-runtime safe and unit-testable.

const JSONLD_ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

/**
 * JSON.stringify `obj` and escape the characters that are unsafe inside an
 * inline HTML <script> block. Use this instead of a raw JSON.stringify for the
 * `__html` of any JSON-LD <script>.
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/[<>&\u2028\u2029]/g, (ch) => JSONLD_ESCAPES[ch])
}
