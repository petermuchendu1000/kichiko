// lib/notifications/templates/layout.ts
// ---------------------------------------------------------------------------
// The shell every Elopis email is poured into, and the blocks that go in it.
//
// EMAIL IS NOT THE WEB. The constraints that shape everything here:
//   * No flexbox, no grid, no custom properties. Layout is <table>.
//   * No <style> you can rely on. Every rule is an inline style attribute.
//     The one <style> block carries ONLY the dark-mode overrides and the
//     mobile tweak, both of which degrade to the light/desktop design when
//     stripped — never anything the email needs to be readable.
//   * No external CSS, no webfonts worth having, no JavaScript.
//   * Outlook renders with Word: no border-radius, no box-shadow. The design
//     must not depend on either, so radii are a bonus and borders do the work.
//
// WHAT "INTERACTIVE" MEANS IN AN INBOX. Not scripts — those are stripped. It
// means the reader can act without hunting: one unmistakable primary button per
// email, pointed at the exact page that resolves the thing the email is about,
// plus the key figures laid out so the message can be understood from the
// preview pane without opening anything.
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

export interface ShellOptions {
  /** <title>, and the fallback when a client shows no preheader. */
  title: string
  /**
   * The grey line the inbox shows after the subject. Without one, clients
   * scrape the first text in the body — which is the logo alt text and the
   * word "Elopis" repeated. A written preheader is the difference between a
   * list row that explains itself and one that reads "Elopis Elopis View".
   */
  preheader: string
  /** The body blocks, already rendered. */
  body: string
  /** Optional footer note above the legal line (e.g. why they got this). */
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
    .e-panel  { background:${D.surface} !important; border-color:${D.hairline} !important; }
    .e-brand  { color:${D.brand} !important; }
    .e-yes-tint { background:${D.yesTint} !important; }
    .e-no-tint  { background:${D.noTint} !important; }
    .e-warn-tint{ background:${D.warnTint} !important; }
    .e-yes-text { color:${D.yesText} !important; }
    .e-no-text  { color:${D.noText} !important; }
  }
  /* One breakpoint. Phones are most of this audience, so the card goes
     edge-to-edge and the padding tightens rather than the type shrinking. */
  @media only screen and (max-width:480px) {
    .e-card { width:100% !important; border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
    .e-pad  { padding-left:20px !important; padding-right:20px !important; }
    .e-hero { font-size:30px !important; }
    .e-btn  { display:block !important; width:auto !important; }
  }
</style>
</head>
<body class="e-canvas" style="margin:0;padding:0;background:${C.canvas};-webkit-font-smoothing:antialiased;">
  <!-- Preheader: shown in the inbox list, never on the page. The nbsp run
       stops clients from pulling body copy in after it. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(60)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="e-canvas" style="background:${C.canvas};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="e-card" style="width:600px;max-width:100%;background:${C.paper};border:1px solid ${C.hairline};border-radius:14px;">
        <!-- Header -->
        <tr><td class="e-pad" style="padding:24px 32px 0 32px;">
          <a href="${appUrl()}" style="text-decoration:none;">
            <span class="e-brand" style="font-family:${FONT};font-size:19px;font-weight:800;letter-spacing:-.3px;color:${C.brand};">Elopis</span>
          </a>
        </td></tr>
        ${body}
        <!-- Footer -->
        <tr><td class="e-pad" style="padding:8px 32px 28px 32px;">
          <div class="e-rule" style="height:1px;background:${C.hairline};font-size:0;line-height:0;margin:0 0 16px 0;">&nbsp;</div>
          ${
            footnote
              ? `<p class="e-text3" style="margin:0 0 10px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.text3};">${footnote}</p>`
              : ''
          }
          <p class="e-text3" style="margin:0 0 6px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.text3};">
            Elopis — prediction markets for East Africa.
          </p>
          <p class="e-text3" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${C.text3};">
            <a href="${appUrl('/notifications')}" class="e-text3" style="color:${C.text3};text-decoration:underline;">Notification settings</a>
            &nbsp;·&nbsp;
            <a href="${appUrl('/legal/terms')}" class="e-text3" style="color:${C.text3};text-decoration:underline;">Terms</a>
            &nbsp;·&nbsp;
            <a href="${appUrl('/legal/privacy')}" class="e-text3" style="color:${C.text3};text-decoration:underline;">Privacy</a>
          </p>
          <p class="e-text3" style="margin:10px 0 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${C.text3};">
            18+. Predict responsibly. Elopis never asks for your password or PIN by email.
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

/** Headline + supporting sentence. The top of nearly every email. */
export function heading(title: string, sub?: string): string {
  return `<tr><td class="e-pad" style="padding:18px 32px 0 32px;">
    <h1 class="e-text" style="margin:0 0 ${sub ? '8' : '18'}px 0;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${C.text};">${esc(title)}</h1>
    ${sub ? `<p class="e-text2" style="margin:0 0 18px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text2};">${sub}</p>` : ''}
  </td></tr>`
}

/** A paragraph of body copy. `html` is trusted — callers escape their inputs. */
export function paragraph(html: string): string {
  return `<tr><td class="e-pad" style="padding:0 32px 16px 32px;">
    <p class="e-text2" style="margin:0;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text2};">${html}</p>
  </td></tr>`
}

export type Tone = 'brand' | 'yes' | 'no' | 'warn' | 'neutral'

const TONE = {
  brand: { tint: C.brandTint, text: C.brandDark, cls: '' },
  yes: { tint: C.yesTint, text: C.yesText, cls: 'e-yes-tint' },
  no: { tint: C.noTint, text: C.noText, cls: 'e-no-tint' },
  warn: { tint: C.warnTint, text: '#8A5D0E', cls: 'e-warn-tint' },
  neutral: { tint: C.surface, text: C.text, cls: 'e-panel' },
} as const

/**
 * The number the email is about — an amount, a payout, a price.
 *
 * Big, tinted by meaning, and readable in the preview pane without scrolling,
 * because for money mail the figure IS the message.
 */
export function hero(value: string, label?: string, tone: Tone = 'neutral'): string {
  const t = TONE[tone]
  const textCls = tone === 'yes' ? 'e-yes-text' : tone === 'no' ? 'e-no-text' : 'e-text'
  return `<tr><td class="e-pad" style="padding:0 32px 18px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${t.cls}" style="background:${t.tint};border-radius:12px;">
      <tr><td align="center" style="padding:22px 20px;">
        ${label ? `<div class="e-text3" style="font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:${C.text3};margin:0 0 6px 0;">${esc(label)}</div>` : ''}
        <div class="e-hero ${textCls}" style="font-family:${FONT};font-size:34px;line-height:1.15;font-weight:800;color:${t.text};">${esc(value)}</div>
      </td></tr>
    </table>
  </td></tr>`
}

/**
 * Key/value rows — the receipt.
 *
 * A table, not a list, because a reader checking "did the right amount leave my
 * account" scans a column of labels. Right-aligned values keep the figures on a
 * common edge so they can be compared at a glance.
 */
export function details(rows: { label: string; value: string; strong?: boolean }[]): string {
  if (!rows.length) return ''
  const body = rows
    .map(
      (r, i) => `<tr>
        <td class="e-text3" style="padding:${i ? '10' : '2'}px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.text3};">${esc(r.label)}</td>
        <td class="${r.strong ? 'e-text' : 'e-text2'}" align="right" style="padding:${i ? '10' : '2'}px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.5;font-weight:${r.strong ? '700' : '500'};color:${r.strong ? C.text : C.text2};">${esc(r.value)}</td>
      </tr>`,
    )
    .join('')
  return `<tr><td class="e-pad" style="padding:0 32px 18px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="e-panel" style="background:${C.surface};border:1px solid ${C.hairline};border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
      </td></tr>
    </table>
  </td></tr>`
}

/**
 * The primary action. One per email.
 *
 * Bulletproof-ish: a padded <a> inside a table cell that carries the same
 * background, so Outlook still paints a solid block when it drops the radius.
 */
export function button(label: string, href: string, tone: Tone = 'brand'): string {
  const bg = tone === 'yes' ? C.yesSolid : tone === 'no' ? C.noSolid : C.brand
  return `<tr><td class="e-pad" style="padding:2px 32px 22px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" bgcolor="${bg}" style="background:${bg};border-radius:10px;">
        <a class="e-btn" href="${esc(href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">${esc(label)}</a>
      </td></tr>
    </table>
  </td></tr>`
}

/** A quiet aside — caveats, timing, "if this wasn't you". */
export function note(html: string, tone: Tone = 'neutral'): string {
  const t = TONE[tone]
  return `<tr><td class="e-pad" style="padding:0 32px 18px 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${t.cls}" style="background:${t.tint};border-radius:10px;">
      <tr><td style="padding:12px 16px;">
        <p class="e-text2" style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.text2};">${html}</p>
      </td></tr>
    </table>
  </td></tr>`
}

/** Bottom spacer when an email ends without a button. */
export function spacer(px = 8): string {
  return `<tr><td style="font-size:0;line-height:0;height:${px}px;">&nbsp;</td></tr>`
}
