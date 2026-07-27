// lib/security/sanitize.ts — input sanitization & safe-value helpers (pure).
//
// Defence-in-depth on top of Zod validation and Postgres parameterisation.
// Everything here is pure and unit-tested. Use for free-text fields, search
// queries, and redirect targets. NO Node-only APIs (edge-safe).

/** Remove ASCII control chars (except tab/newline) that can break logs/output. */
export function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

/** Collapse runs of whitespace to single spaces and trim. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Clamp a string to a maximum length (grapheme-agnostic; code units). */
export function clampLength(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

/** HTML-escape the five significant characters to prevent injection in markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface SanitizeTextOptions {
  maxLength?: number
  collapse?: boolean
}

/** Normalise a free-text field: strip control chars, optionally collapse, clamp. */
export function sanitizeText(input: unknown, opts: SanitizeTextOptions = {}): string {
  if (input == null) return ''
  let s = stripControlChars(String(input))
  if (opts.collapse) s = collapseWhitespace(s)
  else s = s.trim()
  if (opts.maxLength != null) s = clampLength(s, opts.maxLength)
  return s
}

/**
 * Sanitise a user search query for use with Postgres/PostgREST filters:
 * strips control chars and PostgREST meta-characters that could alter the
 * intended filter (commas, parens, wildcards, quotes), then clamps length.
 */
export function sanitizeSearchQuery(input: unknown, maxLength = 100): string {
  const s = sanitizeText(input, { collapse: true, maxLength })
  return s.replace(/[,()*"'\\%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

/**
 * Is `target` a safe same-origin relative path to redirect to? Prevents open
 * redirects: must start with a single '/', not '//' or '/\', and contain no
 * scheme. Returns the safe path or the provided fallback.
 */
export function safeRedirectPath(target: unknown, fallback = '/'): string {
  if (typeof target !== 'string' || target.length === 0) return fallback
  // Reject protocol-relative, backslash tricks, and absolute URLs with a scheme.
  if (!target.startsWith('/')) return fallback
  if (target.startsWith('//') || target.startsWith('/\\')) return fallback
  if (/^\/[\t ]*\\/.test(target)) return fallback
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return fallback
  return target
}

/**
 * Return `url` iff it is a well-formed absolute URL whose scheme is on the
 * http/https allowlist; otherwise return null. Blocks dangerous schemes such
 * as `javascript:`, `data:`, `vbscript:`, and `file:` from being rendered as
 * clickable `href` targets (XSS / phishing defence). Callers should fall back
 * to rendering plain text when this returns null.
 */
export function safeHttpUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : null
}

/** Normalise an ISO alpha-2 country code (uppercase, exactly two letters) or null. */
export function normalizeCountryCode(input: unknown): string | null {
  const s = String(input ?? '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(s) ? s : null
}

/** Basic email shape check (not RFC-complete; pair with real verification). */
export function isPlausibleEmail(input: unknown): boolean {
  const s = String(input ?? '').trim()
  return s.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}
