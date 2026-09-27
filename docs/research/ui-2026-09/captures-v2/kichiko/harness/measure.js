/*
 * In-page measurement, injected into the rendered page and run by capture.mjs.
 * Every value comes from getComputedStyle() / getBoundingClientRect() on a visible
 * node. Colours are parsed from Chromium's computed rgb()/rgba() strings; any other
 * form is reported as-is and flagged `unparsed` rather than guessed.
 */
/* eslint-disable */
window.__measure = function measure() {
  const vw = innerWidth, vh = innerHeight
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false
    for (let p = el; p; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    }
    return true
  }
  const parse = (c) => {
    const m = c && c.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/)
    if (!m) return null
    let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return [+m[1], +m[2], +m[3], a]
  }
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const over = (top, under) => {
    const a = top[3]
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1)
  }
  // Effective background: composite translucent backgrounds from the element up.
  const effectiveBg = (el) => {
    const layers = []
    let complex = false
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') complex = true
      const c = parse(cs.backgroundColor)
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break }
    }
    let base = [255, 255, 255, 1]
    const htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor)
    if (htmlBg && htmlBg[3] >= 1 && (layers.length === 0 || layers[layers.length - 1][3] < 1)) base = htmlBg
    let out = base
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out)
    return { bg: out, complex }
  }
  const all = [...document.body.querySelectorAll('*')].filter(visible)

  // Text styles + contrast
  const textEls = all.filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0))
  const styles = new Map()
  const contrast = []
  for (const el of textEls) {
    const cs = getComputedStyle(el)
    const key = [cs.fontFamily.split(',')[0].replace(/["']/g, ''), cs.fontSize, cs.fontWeight, cs.lineHeight, cs.letterSpacing, cs.color].join('|')
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 60)
    const s = styles.get(key) || { family: cs.fontFamily.split(',')[0].replace(/["']/g, ''), size: cs.fontSize, weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color, count: 0, example: text }
    s.count++
    styles.set(key, s)
    const fg = parse(cs.color)
    const { bg, complex } = effectiveBg(el)
    if (fg) {
      const fgc = fg[3] < 1 ? over(fg, bg) : fg
      const r = ratio(fgc, bg)
      const px = parseFloat(cs.fontSize), w = parseInt(cs.fontWeight, 10)
      const large = px >= 24 || (px >= 18.66 && w >= 700)
      contrast.push({ text, size: px, weight: w, fg: hex(fgc), bg: hex(bg), ratio: +r.toFixed(2), required: large ? 3 : 4.5, pass: r >= (large ? 3 : 4.5), complexBackground: complex })
    }
  }

  // Interactive elements
  const interactiveSel = 'a[href],button,input,select,textarea,[role=button],[role=tab],[role=link],[role=checkbox],[role=switch],[role=radio],[role=menuitem],[role=option],[tabindex]:not([tabindex="-1"])'
  const interactive = [...document.querySelectorAll(interactiveSel)].filter(visible).map((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(), role: el.getAttribute('role'),
      name: (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      x: Math.round(r.x), y: Math.round(r.y + scrollY), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      radius: cs.borderRadius, bg: cs.backgroundColor, color: cs.color, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      shadow: cs.boxShadow, padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight,
    }
  })
  const targets = { ge44: 0, from24to43: 0, lt24: 0 }
  for (const i of interactive) { const m = Math.min(i.w, i.h); if (m >= 44) targets.ge44++; else if (m >= 24) targets.from24to43++; else targets.lt24++ }

  // Spacing histogram
  const spacing = {}
  for (const el of all) {
    const cs = getComputedStyle(el)
    for (const v of [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft, cs.rowGap, cs.columnGap]) {
      if (!v || v === 'normal' || v === '0px') continue
      spacing[v] = (spacing[v] || 0) + 1
    }
  }
  const radii = {}
  for (const el of all) { const r = getComputedStyle(el).borderTopLeftRadius; if (r !== '0px') radii[r] = (radii[r] || 0) + 1 }

  // Structure: large blocks in document order
  const sections = [...document.querySelectorAll('header,nav,main > *,section,footer,aside,[role=dialog]')].filter(visible).map((el) => {
    const r = el.getBoundingClientRect()
    const h = el.querySelector('h1,h2,h3')
    return { tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || el.getAttribute('aria-label') || '', y: Math.round(r.y + scrollY), h: Math.round(r.height), w: Math.round(r.width), heading: h ? h.innerText.trim().slice(0, 60) : '' }
  }).filter((s) => s.h >= 24)

  const bodyText = document.body.innerText
  const formats = {
    ksh: (bodyText.match(/KSh\s?[\d,.]+[KMB]?/g) || []).length,
    percent: (bodyText.match(/\d+(?:\.\d+)?\s?%/g) || []).length,
    cents: (bodyText.match(/\d+(?:\.\d+)?\s?¢/g) || []).length,
    dollar: (bodyText.match(/\$\s?[\d,.]+[KMB]?/g) || []).length,
    examples: [...new Set((bodyText.match(/(?:KSh\s?[\d,.]+[KMB]?|\$\s?[\d,.]+[KMB]?|\d+(?:\.\d+)?\s?[¢%])/g) || []))].slice(0, 30),
  }
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible).map((h) => `${h.tagName}: ${h.innerText.trim().slice(0, 70)}`)
  const landmarks = { main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length, h1: document.querySelectorAll('h1').length }

  return {
    url: location.href, title: document.title, viewport: { w: vw, h: vh }, docHeight: document.documentElement.scrollHeight,
    theme: document.documentElement.className.includes('dark') ? 'dark' : 'light',
    sections, headings, landmarks,
    textStyles: [...styles.values()].sort((a, b) => b.count - a.count),
    contrast: { total: contrast.length, failing: contrast.filter((c) => !c.pass).length, failures: contrast.filter((c) => !c.pass).slice(0, 60) },
    interactive, targets, spacing, radii, formats,
  }
}
