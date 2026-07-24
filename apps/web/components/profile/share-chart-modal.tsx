'use client'

// components/profile/share-chart-modal.tsx
// ------------------------------------------------------------
// "Share Profit/Loss Chart" sheet — parity with the reference share flow:
//   • Dimmed overlay; bottom-sheet on mobile, centered dialog on desktop.
//   • A dark, rounded share CARD rendered as inline SVG (brand mark + range
//     label, avatar + username, big signed P&L headline coloured green/red,
//     and the gradient P&L line) — so what you see is exactly what saves/shares.
//   • Actions: Copy Link (outline) · Save (outline, exports PNG) · Share
//     (pip-blue, Web Share API with the PNG, falls back to copying the link).
// Zero external deps: PNG export serialises the card SVG onto a <canvas>.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatUSD } from '@/lib/utils'

interface Point { bucket: string; value_usd: number }

interface Props {
  open: boolean
  onClose: () => void
  userName: string
  userId: string
  profitLoss: number
  rangeLabel: string
  points: Point[]
  profileUrl: string
}

// Deterministic avatar hue (mirrors TraderAvatar) so the card matches the page.
function hueFrom(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
}

const CARD_W = 960
const CARD_H = 600

function buildChartPath(points: Point[]) {
  const plotY0 = 300
  const plotH = 260
  if (points.length < 2) return null
  const ys = points.map((p) => Number(p.value_usd))
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const span = max - min || 1
  const stepX = CARD_W / (points.length - 1)
  const coords = ys.map((y, i) => {
    const x = i * stepX
    const yy = plotY0 + plotH - ((y - min) / span) * plotH
    return [x, yy] as const
  })
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${CARD_W},${CARD_H} L0,${CARD_H} Z`
  return { line, area }
}

export function ShareChartModal({ open, onClose, userName, userId, profitLoss, rangeLabel, points, profileUrl }: Props) {
  const [mounted, setMounted] = useState(false)
  const [copied, setCopied] = useState(false)
  const cardRef = useRef<SVGSVGElement | null>(null)
  useEffect(() => setMounted(true), [])

  // Escape closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  const positive = profitLoss >= 0
  const absUrl = useMemo(
    () => (profileUrl.startsWith('http') || typeof window === 'undefined' ? profileUrl : window.location.origin + profileUrl),
    [profileUrl],
  )
  const hue = useMemo(() => hueFrom(userId || userName), [userId, userName])
  const path = useMemo(() => buildChartPath(points), [points])
  const signed = `${positive ? '+' : '−'}${formatUSD(Math.abs(profitLoss))}`

  const toPngBlob = useCallback(async (): Promise<Blob | null> => {
    const svg = cardRef.current
    if (!svg) return null
    const xml = new XMLSerializer().serializeToString(svg)
    const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img')); img.src = svg64 })
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = CARD_W * scale
    canvas.height = CARD_H * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, CARD_W, CARD_H)
    return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
  }, [])

  const onCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(absUrl); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* noop */ }
  }, [absUrl])

  const onSave = useCallback(async () => {
    const blob = await toPngBlob()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(userName || 'trader').replace(/\s+/g, '-').toLowerCase()}-pnl.png`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, [toPngBlob, userName])

  const onShare = useCallback(async () => {
    try {
      const blob = await toPngBlob()
      const file = blob ? new File([blob], 'pnl.png', { type: 'image/png' }) : null
      const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean }
      if (file && nav.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: 'Profit/Loss', text: `${userName} · ${signed}`, url: absUrl })
        return
      }
      if (navigator.share) { await navigator.share({ title: 'Profit/Loss', text: `${userName} · ${signed}`, url: absUrl }); return }
      await onCopy()
    } catch { /* user cancelled */ }
  }, [toPngBlob, userName, signed, absUrl, onCopy])

  if (!mounted || !open) return null

  const green = '#42C772'
  const red = '#E23939'
  const pnlColor = positive ? green : red

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md animate-slide-up rounded-t-2xl bg-surface p-5 shadow-e3 sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Share Profit/Loss Chart"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-text-primary">Share Profit/Loss Chart</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-text-muted transition-colors hover:text-text-primary">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Shareable dark card (rendered as SVG so save == what you see) */}
        <div className="overflow-hidden rounded-xl">
          <svg ref={cardRef} viewBox={`0 0 ${CARD_W} ${CARD_H}`} width="100%" xmlns="http://www.w3.org/2000/svg" className="block h-auto w-full" role="img" aria-label="Profit and loss share card">
            <defs>
              <linearGradient id="share-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#17181C" />
                <stop offset="100%" stopColor="#0B0C0E" />
              </linearGradient>
              <linearGradient id="share-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#1452F0" />
                <stop offset="100%" stopColor="#9B51E0" />
              </linearGradient>
              <linearGradient id="share-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1452F0" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#9B51E0" stopOpacity={0.01} />
              </linearGradient>
              <linearGradient id="share-avatar" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={`hsl(${hue} 70% 58%)`} />
                <stop offset="100%" stopColor={`hsl(${(hue + 60) % 360} 70% 46%)`} />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width={CARD_W} height={CARD_H} rx="0" fill="url(#share-bg)" />
            {/* Brand mark + wordmark */}
            <g transform="translate(48,44)">
              <path d="M0 6 L20 0 L20 26 L0 32 Z M24 0 L44 6 L44 32 L24 26 Z" fill="#8FB0FA" opacity="0.95" />
              <text x="58" y="24" fill="#E7EAEE" fontFamily="Inter, sans-serif" fontSize="26" fontWeight="700">MarketPips</text>
            </g>
            {/* Range label top-right */}
            <text x={CARD_W - 48} y="66" textAnchor="end" fill="#8A93A0" fontFamily="Inter, sans-serif" fontSize="24" fontWeight="500">{rangeLabel}</text>
            {/* Avatar + username */}
            <circle cx="70" cy="150" r="26" fill="url(#share-avatar)" />
            <text x="112" y="158" fill="#E7EAEE" fontFamily="Inter, sans-serif" fontSize="30" fontWeight="600">{userName}</text>
            {/* Signed headline */}
            <text x="48" y="232" fill={pnlColor} fontFamily="Inter, sans-serif" fontSize="64" fontWeight="700" style={{ letterSpacing: '-1px' }}>{signed}</text>
            {/* Chart */}
            {path ? (
              <>
                <path d={path.area} fill="url(#share-area)" />
                <path d={path.line} fill="none" stroke="url(#share-line)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
              </>
            ) : (
              <text x={CARD_W / 2} y="430" textAnchor="middle" fill="#5F6772" fontFamily="Inter, sans-serif" fontSize="22">Not enough history to chart this range</text>
            )}
          </svg>
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={onCopy} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[9.2px] border border-hairline-strong bg-surface text-sm font-semibold text-text-primary transition-colors hover:bg-surface-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 15a3 3 0 0 1 0-4l3-3a3 3 0 0 1 4 4l-1 1M15 9a3 3 0 0 1 0 4l-3 3a3 3 0 0 1-4-4l1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <button type="button" onClick={onSave} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[9.2px] border border-hairline-strong bg-surface text-sm font-semibold text-text-primary transition-colors hover:bg-surface-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Save
          </button>
          <button type="button" onClick={onShare} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[9.2px] bg-pip-500 text-sm font-semibold text-white transition-colors hover:bg-pip-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Share
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
