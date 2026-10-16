// lib/notifications/templates/layout.ts
// ---------------------------------------------------------------------------
// The shell every Elopis email is poured into, and the blocks that go in it.
//
// RESTRAINT IS THE DESIGN.
//
// The first version of this file filled a rounded panel behind every amount —
// green for a payout, red for a failed withdrawal — and put a second tinted
// panel under it for the note. Rendered, it read as a consumer app shouting,
// not as a financial institution telling you what happened to your money.
//
// Look at what the category actually does. A PayPal receipt, a bank's
// transaction alert, a Binance withdrawal confirmation: white field, the
// institution's mark, one strong headline, the figure set large in PLAIN dark
// type, facts in hairline-ruled rows, and exactly one coloured element on the
// page — the button. Colour is reserved for the single thing it wants you to
// do. Nothing is tinted to tell you how to feel about it; the words do that.
//
// So: no filled status panels, no coloured amounts. State is carried by the
// headline and a small uppercase label. The only saturated pixels in the whole
// email are the logo and the call to action.
//
// EMAIL IS NOT THE WEB. The constraints that shape everything here:
//   * No flexbox, no grid, no custom properties. Layout is <table>.
//   * No <style> you can rely on. Every rule is an inline style attribute. The
//     one <style> block carries ONLY dark-mode and mobile overrides, both of
//     which degrade to the light/desktop design when stripped.
//   * Outlook renders with Word: no border-radius, no box-shadow, no SVG. The
//     design must not depend on any of them. The logo is therefore a PNG.
import { C, D, FONT, appUrl } from './tokens'

/** Escape for HTML text nodes AND attribute values. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The brand mark.
 *
 * A hosted PNG, not the SVG and not a data: URI — Outlook cannot render SVG at
 * all and Gmail strips data: images, so either would leave a broken box where
 * the institution's identity should be. 40px square, served from the app's own
 * origin so it inherits the TLS and uptime the rest of the product has.
 */
const LOGO_PNG = appUrl('/icon-192.png')

export interface ShellOptions {
  title: string
  /**
   * The grey line the inbox shows after the subject. Without one, clients
   * scrape the first text in the body — which is the logo alt text. A written
   * preheader is the difference between a list row that explains itself and one
   * that reads "Elopis Elopis View".
   */
  preheader: string
  body: string
  footnote?: string
}

export function shell({ title, preheader, body, footnote }: ShellOptions): string {
  return `<!doctype html>
<html lang="en" style="margin:0;padding:0;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(title)}</title>
<style>
  /* Dark mode. Everything here is an OVERRIDE: strip this block and the light
     design below stands on its own, which is what Gmail and Outlook get. */
  @media (prefers-color-scheme: dark) {
    .e-canvas { background:${D.canvas} !important; }
    .e-card   { background:${D.paper} !important; border-color:${D.hairline} !important; }
    .e-text   { color:${D.text} !important; }
    .e-text2  { color:${D.text2} !important; }
    .e-text3  { color:${D.text3} !important; }
    .e-rule   { border-color:${D.hairline} !important; background:${D.hairline} !important; }
    .e-link   { color:${D.brand} !important; }
  }
  @media only screen and (max-width:480px) {
    .e-card { width:100% !important; border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
    .e-pad  { padding-left:24px !important; padding-right:24px !important; }
    .e-amt  { font-size:30px !important; }
    .e-btn  { display:block !important; }
  }
</style>
</head>
<body class="e-canvas" style="margin:0;padding:0;background:${C.canvas};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="e-canvas" style="background:${C.canvas};">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="e-card" style="width:600px;max-width:100%;background:${C.paper};border:1px solid ${C.hairline};border-radius:8px;">
        <!-- Header: the mark, the name, and a rule. Nothing else.

             A table, because this needs the two cells on one line in Outlook,
             which lays out with Word and supports neither flex nor
             inline-block reliably. A valign of middle on both cells is what
             actually centres them there.

             The image alt is EMPTY on purpose. The name is now real text
             beside it, and an alt of "Elopis" would make the pair read
             "Elopis Elopis" to a screen reader and in the inbox preview,
             where clients scrape the first text in the body. The mark is
             decorative once the word is present.

             The colour is stated on the anchor: without it the client's
             default link blue is inherited, which would paint the wordmark
             blue and outline the image in some clients. -->
        <tr><td class="e-pad" style="padding:28px 40px 0 40px;">
          <a href="${appUrl()}" style="text-decoration:none;display:inline-block;color:${C.text};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="middle" style="padding-right:10px;">
                <img src="${LOGO_PNG}" width="36" height="36" alt=""
                     style="display:block;width:36px;height:36px;border:0;outline:none;text-decoration:none;border-radius:8px;">
              </td>
              <td valign="middle" class="e-text" style="font-family:${FONT};font-size:18px;line-height:1;font-weight:600;letter-spacing:-.3px;color:${C.text};">Elopis</td>
            </tr></table>
          </a>
        </td></tr>
        <tr><td class="e-pad" style="padding:22px 40px 0 40px;">
          <div class="e-rule" style="height:1px;background:${C.hairline};font-size:0;line-height:0;">&nbsp;</div>
        </td></tr>
        ${body}
        <!-- Footer -->
        <tr><td class="e-pad" style="padding:6px 40px 32px 40px;">
          <div class="e-rule" style="height:1px;background:${C.hairline};font-size:0;line-height:0;margin:0 0 18px 0;">&nbsp;</div>
          ${
            footnote
              ? `<p class="e-text3" style="margin:0 0 12px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.text3};">${footnote}</p>`
              : ''
          }
          <p class="e-text3" style="margin:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.text3};">
            Elopis &middot; prediction markets for East Africa
          </p>
          <p class="e-text3" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.text3};">
            <a href="${appUrl('/notifications')}" class="e-text3" style="color:${C.text3};text-decoration:underline;">Notification settings</a>
            &nbsp;&middot;&nbsp;
            <a href="${appUrl('/legal/terms')}" class="e-text3" style="color:${C.text3};text-decoration:underline;">Terms</a>
            &nbsp;&middot;&nbsp;
            <a href="${appUrl('/legal/privacy')}" class="e-text3" style="color:${C.text3};text-decoration:underline;">Privacy</a>
          </p>
          <p class="e-text3" style="margin:12px 0 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${C.text3};">
            18+. Predict responsibly. Elopis will never ask for your password, PIN or M-Pesa code by email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Headline + supporting sentence. */
export function heading(title: string, sub?: string): string {
  return `<tr><td class="e-pad" style="padding:26px 40px 0 40px;">
    <h1 class="e-text" style="margin:0 0 ${sub ? '10' : '22'}px 0;font-family:${FONT};font-size:21px;line-height:1.35;font-weight:600;letter-spacing:-.2px;color:${C.text};">${esc(title)}</h1>
    ${sub ? `<p class="e-text2" style="margin:0 0 22px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text2};">${sub}</p>` : ''}
  </td></tr>`
}

export function paragraph(html: string): string {
  return `<tr><td class="e-pad" style="padding:0 40px 18px 40px;">
    <p class="e-text2" style="margin:0;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text2};">${html}</p>
  </td></tr>`
}

/**
 * The figure the email is about.
 *
 * Plain dark type on the card — NOT a tinted block. This replaced a filled
 * green/red panel, which is the single biggest reason the first draft read as
 * unserious: a bank states the amount, it does not colour-code your feelings
 * about it. The small uppercase label above carries the meaning ("Refunded to
 * your wallet"), which is also what a screen reader announces first.
 */
export function amount(value: string, label?: string): string {
  return `<tr><td class="e-pad" style="padding:0 40px 24px 40px;">
    ${label ? `<div class="e-text3" style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:${C.text3};margin:0 0 8px 0;">${esc(label)}</div>` : ''}
    <div class="e-amt e-text" style="font-family:${FONT};font-size:34px;line-height:1.1;font-weight:600;letter-spacing:-.6px;color:${C.text};">${esc(value)}</div>
  </td></tr>`
}

/**
 * The facts, in hairline-ruled rows.
 *
 * Rules, not a filled grey card: a ruled table is how a statement is set, and
 * it keeps the page to one background colour so the only filled shape left is
 * the button.
 */
export function details(rows: { label: string; value: string }[]): string {
  if (!rows.length) return ''
  const body = rows
    .map(
      (r, i) => `<tr>
        <td class="e-text3" ${i ? `class="e-rule"` : ''} style="padding:11px 0;${i ? `border-top:1px solid ${C.hairline};` : ''}font-family:${FONT};font-size:13px;line-height:1.5;color:${C.text3};vertical-align:top;">${esc(r.label)}</td>
        <td class="e-text" align="right" style="padding:11px 0;${i ? `border-top:1px solid ${C.hairline};` : ''}font-family:${FONT};font-size:13px;line-height:1.5;font-weight:500;color:${C.text};vertical-align:top;">${esc(r.value)}</td>
      </tr>`,
    )
    .join('')
  return `<tr><td class="e-pad" style="padding:0 40px 24px 40px;">
    <div class="e-rule" style="height:1px;background:${C.hairline};font-size:0;line-height:0;">&nbsp;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
    <div class="e-rule" style="height:1px;background:${C.hairline};font-size:0;line-height:0;">&nbsp;</div>
  </td></tr>`
}

/**
 * The one action.
 *
 * The only saturated colour in the email. Brand blue for everything — a
 * withdrawal confirmation and a payout get the same button, because the button
 * is the product's voice, not a reaction to the news.
 */
export function button(label: string, href: string): string {
  return `<tr><td class="e-pad" style="padding:0 40px 26px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" bgcolor="${C.brand}" style="background:${C.brand};border-radius:6px;">
        <a class="e-btn" href="${esc(href)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:6px;">${esc(label)}</a>
      </td></tr>
    </table>
  </td></tr>`
}

/**
 * A quiet aside — timing, reassurance, "if this wasn't you".
 *
 * Small muted text, no fill and no tint. Previously a coloured panel, which
 * gave a one-line caveat the same visual weight as the amount.
 */
export function note(html: string): string {
  return `<tr><td class="e-pad" style="padding:0 40px 22px 40px;">
    <p class="e-text3" style="margin:0;font-family:${FONT};font-size:13px;line-height:1.65;color:${C.text3};">${html}</p>
  </td></tr>`
}

/** Bottom spacer when an email ends without a button. */
export function spacer(px = 4): string {
  return `<tr><td style="font-size:0;line-height:0;height:${px}px;">&nbsp;</td></tr>`
}
