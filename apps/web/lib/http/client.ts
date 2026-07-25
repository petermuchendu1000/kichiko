// lib/http/client.ts — resilient client-side response parsing.
//
// Guards against the "Unexpected end of JSON input" class of bugs. A fetch()
// caller must never assume the response carries a JSON body: an empty body is a
// real, expected outcome for a 204 No Content, an upstream 3xx the browser
// silently followed to an HTML page (e.g. an auth redirect), a proxy/gateway
// error page, or a handler that crashed before it could serialize a body.
// Calling `res.json()` on any of those throws a SyntaxError that reaches the
// user as a cryptic "Unexpected end of JSON input" instead of the real reason.
//
// readJson() reads the body as text first and only parses when there is
// something to parse, returning {} otherwise — so callers can safely do
// `const data = await readJson(res); if (res.ok && data.success) …` without a
// try/catch around the parse.

/**
 * Read a fetch Response body as JSON without ever throwing on an empty or
 * non-JSON body. Returns the parsed object, or {} when the body is empty or
 * cannot be parsed. Always inspect `res.ok` / `res.status` for success.
 */
export async function readJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  const text = await res.text().catch(() => '')
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return {} as T
  }
}
