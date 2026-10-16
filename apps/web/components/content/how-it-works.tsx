// components/content/how-it-works.tsx
// ---------------------------------------------------------------------------
// The "how it works" explainer: three steps, buy/sell, how prices form, and the
// trust block. Lifted verbatim off the landing page, where it ran 2,823px and
// 417 words — more than half the signed-out page — in front of the markets.
//
// Measured on polymarket.com 2026-10: their landing carries NO explainer prose
// at all (nav -> hero -> one market grid -> footer, 3,363px). Their teaching
// lives on a separate docs domain reached from a footer "Learn" link
// (learn.polymarket.com -> docs.polymarket.com/polymarket-101).
//
// Prediction markets are a new category for most Kenyan visitors, so this
// content earns its place — just not ahead of the markets. It renders on /help,
// which already carried the same four topics in one short paragraph each.
// Figures are passed in, never hardcoded. Since migration 113 a share settles
// at KSh 100 — the peg — so these derive to the numbers that read most simply:
// a Yes at 65% costs KSh 65 and pays KSh 100. They stayed derived rather than
// being written back down, because a figure computed from the unit cannot
// drift away from it the way the "~KSh 84" copy below once did.
// ---------------------------------------------------------------------------
import Link from 'next/link'
import {
  IconArrowRight, IconShield, IconCheck, IconTrendUp, IconWallet,
  IconPercent, IconEye, IconMpesa,
} from '@/components/ui/icons'

export interface HowItWorksFigures {
  /** Whole-shilling cost of a Yes bought at 65%. KSh 65 under the peg. */
  exampleBuyKes: number
  /** Whole-shilling settlement of one winning share. KSh 100 under the peg. */
  sharePayoutKes: number
  /** sharePayoutKes - exampleBuyKes. */
  exampleProfitKes: number
  /** Live platform fee, as a percentage number. */
  platformFeePct: number
  /** Live platform figures: {n: value, l: label}. */
  stats: { n: string; l: string }[]
}

function SectionHead({ eyebrow, title, align = 'center' }: { eyebrow: string; title: string; align?: 'center' | 'left' }) {
  return (
    <div className={`mb-6 sm:mb-8 ${align === 'center' ? 'text-center mx-auto max-w-2xl' : 'max-w-xl'}`}>
      <div className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--pip-text)' }}>{eyebrow}</div>
      <h2 className="mt-2 font-display font-bold tracking-[-0.02em]" style={{ fontSize: 'clamp(1.45rem, 3vw, 1.85rem)', color: 'var(--text)' }}>{title}</h2>
    </div>
  )
}

function PriceCurveVisual() {
  // A calm, static illustration of a smooth probability curve — brand blue, no fake labels.
  const pts = [8, 18, 14, 28, 34, 30, 46, 52, 48, 62, 70, 66]
  const w = 320, h = 200
  const step = w / (pts.length - 1)
  const y = (p: number) => h - (p / 100) * h
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  const area = `${line} L${w},${h} L0,${h} Z`
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>The chance over time</span>
        <span className="font-mono text-sm font-semibold" style={{ color: 'var(--pip-text)' }}>66%</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" aria-hidden>
        <defs>
          <linearGradient id="hiw-curve" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--pip-500)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--pip-500)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#hiw-curve)" />
        <path d={line} fill="none" stroke="var(--pip-500)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function HowItWorks({ exampleBuyKes, sharePayoutKes, exampleProfitKes, platformFeePct, stats }: HowItWorksFigures) {
  return (
    <div className="mx-auto max-w-6xl">

{/* How it works */}
<section id="how-it-works" className="py-12 sm:py-16 scroll-mt-20">
  <SectionHead eyebrow="How it works" title="Three easy steps" />
  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
    {[
      { n: '01', h: 'See the chance', p: `Every event shows a chance from 0% to 100%. It is how likely people think “Yes” is. The price tracks the chance, so a Yes at 65% costs about KSh ${exampleBuyKes}.` },
      { n: '02', h: 'Choose Yes or No', p: 'Buy Yes if you think it will happen. Buy No if you think it will not. Deposit in seconds with M-Pesa.' },
      { n: '03', h: 'Get paid if you are right', p: `When the event ends, every correct Yes or No pays KSh ${sharePayoutKes}. A Yes you bought at 65% (about KSh ${exampleBuyKes}) pays KSh ${sharePayoutKes}, so you make about KSh ${exampleProfitKes}. If you are wrong, it pays nothing and you lose the KSh ${exampleBuyKes} you paid. Withdraw to M-Pesa.` },
    ].map(s => (
      <div key={s.n} className="card p-6">
        <div className="w-10 h-10 rounded-lg grid place-items-center font-mono font-semibold"
          style={{ background: 'var(--pip-100)', color: 'var(--pip-text)', border: '1px solid color-mix(in srgb, var(--pip-500) 22%, transparent)' }}>
          {s.n}
        </div>
        <h3 className="mt-4 text-[1.15rem] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>{s.h}</h3>
        <p className="mt-2 text-[0.95rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>{s.p}</p>
      </div>
    ))}
  </div>
</section>

{/* Buy or sell any time */}
<section className="py-12 sm:py-16">
  <SectionHead eyebrow="Your choice" title="Buy or sell any time" />
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    <div className="card p-6">
      <span className="w-11 h-11 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}><IconTrendUp size={20} /></span>
      <h3 className="text-[1.05rem] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>Sell before the end</h3>
      <p className="mt-2 text-[0.92rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>You do not have to wait for the event to end. You can sell your Yes or No at the current price, which may be more or less than you paid.</p>
    </div>
    <div className="card p-6">
      <span className="w-11 h-11 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}><IconCheck size={20} /></span>
      <h3 className="text-[1.05rem] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>Or wait for the result</h3>
      <p className="mt-2 text-[0.92rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>Prefer to wait? Hold your Yes or No until the event is decided. If you are right, it pays KSh {sharePayoutKes}.</p>
    </div>
  </div>
</section>

{/* Plain-language order-book pricing */}
<section className="py-12 sm:py-16">
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
    <div>
      <SectionHead eyebrow="Fair prices" title="People set the price, not us" align="left" />
      <p className="text-[1.02rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>
        The price comes from people <strong style={{ color: 'var(--text)' }}>buying and selling</strong>,
        like a real market. You buy and sell with other people, not us. The price simply shows what
        people think will happen right now.
      </p>
      <div className="mt-8 card p-2">
        {[
          // Interpolated, NOT hardcoded — and now interpolating to the number
          // the original copy had written down. This line once read "KSh 65
          // means a 65% chance", which was true only at a KSh 100 payout; it
          // was "corrected" to ~KSh 84 when the product moved to live FX, and
          // the peg (migration 113) has made the first version right again.
          // It stays interpolated regardless: the sentence should follow the
          // unit, not encode a belief about it.
          { icon: <IconPercent size={18} />, t: 'The price is the chance', s: `A “Yes” costing about KSh ${exampleBuyKes} means about a 65% chance.` },
          { icon: <IconTrendUp size={18} />, t: 'Set your own price', s: 'Buy from someone now, or place your own price and wait.' },
          { icon: <IconShield size={18} />, t: 'The other side is a person', s: `You buy from and sell to other people, not us. We only take one small fee of ${platformFeePct}%.` },
        ].map((r, i, a) => (
          <div key={r.t} className="flex items-center gap-4 p-4"
            style={i < a.length - 1 ? { borderBottom: '1px solid var(--hairline)' } : undefined}>
            <span className="w-11 h-11 flex-none rounded-lg grid place-items-center" style={{ background: 'var(--surface-2)', color: 'var(--pip-text)' }}>{r.icon}</span>
            <div>
              <strong className="block font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>{r.t}</strong>
              <span className="text-sm" style={{ color: 'var(--text-2)' }}>{r.s}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
    <PriceCurveVisual />
  </div>
</section>

{/* Trust & transparency */}
<section className="py-12 sm:py-16">
  <SectionHead eyebrow="Trust" title="Safe, clear, and fair" />
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    {[
      { icon: <IconShield size={20} />, h: 'Safe and 18+', p: 'We check who you are, and you must be 18 or older. Ask us any time to set a limit, take a break, or close your account.' },
      { icon: <IconEye size={20} />, h: 'Clear rules', p: 'Every event tells you how the answer will be decided, before you buy. No surprises.' },
      { icon: <IconMpesa size={20} />, h: 'Your money is yours', p: 'Deposit and withdraw fast with M-Pesa, in Kenyan Shillings.' },
      { icon: <IconWallet size={20} />, h: 'One small fee', p: `Just one fee of ${platformFeePct}%. You see it before you buy. Nothing is hidden.` },
    ].map(t => (
      <div key={t.h} className="card p-6">
        <span className="w-11 h-11 rounded-lg grid place-items-center mb-4" style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}>{t.icon}</span>
        <h3 className="text-[1.05rem] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text)' }}>{t.h}</h3>
        <p className="mt-2 text-[0.92rem] leading-relaxed" style={{ color: 'var(--text-2)' }}>{t.p}</p>
      </div>
    ))}
  </div>
</section>

{/* Stats */}
<section className="py-10 sm:py-14">
  <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
    {stats.map((s) => (
      <div key={s.l}>
        <div className="font-mono font-semibold tracking-[-0.03em]" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', color: 'var(--text)' }}>{s.n}</div>
        <div className="mt-1.5 text-sm" style={{ color: 'var(--text-2)' }}>{s.l}</div>
      </div>
    ))}
  </div>
</section>

{/* CTA band */}
<section className="pb-24">
  <div className="rounded-2xl px-8 py-14 sm:py-20 text-center relative overflow-hidden"
    style={{ background: 'var(--ink-950)', color: '#F3F5F8' }}>
    <div aria-hidden className="pointer-events-none absolute inset-0"
      style={{ background: 'radial-gradient(700px 300px at 50% 0, rgba(43,80,228,.35), transparent 65%)' }} />
    <h2 className="relative font-display font-bold tracking-[-0.02em]" style={{ fontSize: 'clamp(1.8rem, 4.5vw, 2.6rem)' }}>
      Ready to try?
    </h2>
    <p className="relative mt-4 mx-auto max-w-[46ch]" style={{ color: 'var(--ink-300)' }}>
      Look at all the events for free. No account needed. Sign up in a minute to make your first prediction.
    </p>
    <div className="relative mt-8 flex flex-wrap gap-3 justify-center">
      <Link href="/markets" className="btn btn-primary btn-lg">See the events <IconArrowRight size={16} /></Link>
      <Link href="/auth/register" className="btn btn-lg" style={{ background: 'transparent', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.25)' }}>
        Create a free account
      </Link>
    </div>
  </div>
</section>

    </div>
  )
}
