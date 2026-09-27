'use client'

// components/markets/create/create-wizard.tsx
// Create-a-market authoring wizard: Structure -> Question & outcomes -> Resolution
// -> Review & publish. Progressive disclosure, per-step validation, a live preview,
// enforced required fields and a credible-source prompt. Binary is fully supported;
// multi-outcome is gated "Coming soon" (binary-only trading engine). Pip system,
// custom icons, no emoji.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import type { MarketCategory } from '@/types'
import { CATEGORY_LABELS } from '@/types'
import { WizardProgress } from '@/components/markets/create/wizard-progress'
import { StructureCard } from '@/components/markets/create/structure-card'
import { MarketPreview } from '@/components/markets/create/market-preview'
import {
  CategoryIcon,
  IconArrowRight,
  IconChevronLeft,
  IconCheck,
  IconX,
  IconInfo,
  IconWarning,
  IconExternalLink,
} from '@/components/ui/icons'

const STEPS = ['Structure', 'Question', 'Resolution', 'Review']

const CATEGORIES = Object.keys(CATEGORY_LABELS) as MarketCategory[]

const VOID_OPTS = [
  { value: 'refund', label: 'Void & refund all stakes', clause: 'if the event is cancelled or does not occur by the cutoff, the market is voided and all stakes are refunded' },
  { value: 'resolve_no', label: 'Resolve NO', clause: 'if the event is cancelled or does not occur by the cutoff, the market resolves NO' },
  { value: 'extend', label: 'Extend the close date', clause: 'if the event is postponed, the close date is extended until it is decided' },
] as const

const TIE_OPTS = [
  { value: 'source', label: "Follow the source's ruling", clause: 'if the outcome is ambiguous, resolution follows the official determination of the named source' },
  { value: 'refund', label: 'Void & refund', clause: 'if the outcome is tied or ambiguous, the market is voided and all stakes are refunded' },
  { value: 'resolve_no', label: 'Resolve NO', clause: 'if the outcome is tied or ambiguous, the market resolves NO' },
] as const

const WEAK_SOURCE = /(twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|reddit\.com|t\.me)/i

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function isValidUrl(s: string) {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function CreateWizard({ user }: { user: User }) {
  const router = useRouter()

  const [step, setStep] = useState(0)
  const [maxReached, setMaxReached] = useState(0)

  // Structure
  const [structure, setStructure] = useState<'binary' | 'multiple_choice' | null>(null)
  const [category, setCategory] = useState<MarketCategory | null>(null)

  // Question & outcomes
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [initialProb, setInitialProb] = useState(50)
  // Multiple-choice option labels (start with two empty rows).
  const [options, setOptions] = useState<string[]>(['', ''])
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')

  // Resolution
  const [sourceUrl, setSourceUrl] = useState('')
  const [criteria, setCriteria] = useState('')
  const [voidHandling, setVoidHandling] = useState<(typeof VOID_OPTS)[number]['value']>('refund')
  const [tieHandling, setTieHandling] = useState<(typeof TIE_OPTS)[number]['value']>('source')
  const minClose = useMemo(() => toLocalInput(new Date(Date.now() + 61 * 60 * 1000)), [])
  const [closesAt, setClosesAt] = useState('')
  const [resolvesAt, setResolvesAt] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // ---- Validation ----------------------------------------------------------
  const isMulti = structure === 'multiple_choice'
  const titleOk = title.trim().length >= 10 && title.trim().length <= 200
  const descOk = description.trim().length >= 20 && description.trim().length <= 2000
  const criteriaOk = criteria.trim().length >= 20 && criteria.trim().length <= 700
  const sourceOk = isValidUrl(sourceUrl.trim())
  const sourceWeak = sourceOk && WEAK_SOURCE.test(sourceUrl.trim())
  const closeDate = closesAt ? new Date(closesAt) : null
  const closeOk = !!closeDate && !Number.isNaN(closeDate.getTime()) && closeDate.getTime() > Date.now() + 60 * 60 * 1000
  const resolveDate = resolvesAt ? new Date(resolvesAt) : null
  const resolveOk = !resolvesAt || (!!resolveDate && !!closeDate && resolveDate.getTime() >= closeDate.getTime())

  // Multiple-choice options: 2..12 non-empty, <=80 chars, case-insensitively unique.
  const cleanOptions = options.map((o) => o.trim()).filter((o) => o.length > 0)
  const optionsUnique =
    new Set(cleanOptions.map((o) => o.toLowerCase())).size === cleanOptions.length
  const optionsOk =
    !isMulti ||
    (cleanOptions.length >= 2 &&
      cleanOptions.length <= 12 &&
      optionsUnique &&
      cleanOptions.every((o) => o.length <= 80))

  const stepValid = [
    (structure === 'binary' || structure === 'multiple_choice') && !!category,
    titleOk && descOk && optionsOk,
    sourceOk && criteriaOk && closeOk && resolveOk,
    true,
  ]
  const allValid = stepValid[0] && stepValid[1] && stepValid[2]

  const goto = (i: number) => {
    setStep(i)
    setMaxReached((m) => Math.max(m, i))
  }
  const next = () => goto(Math.min(step + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  // ---- Tags ----------------------------------------------------------------
  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, '').slice(0, 30)
    if (t && !tags.includes(t) && tags.length < 10) setTags([...tags, t])
    setTagDraft('')
  }

  // ---- Submit --------------------------------------------------------------
  const composeCriteria = () => {
    const voidClause = VOID_OPTS.find((o) => o.value === voidHandling)!.clause
    const tieClause = TIE_OPTS.find((o) => o.value === tieHandling)!.clause
    return `${criteria.trim()}\n\nCancellation / void: ${voidClause}.\nAmbiguous / tie: ${tieClause}.`.slice(0, 1000)
  }

  const publish = async () => {
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/markets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          resolution_type: isMulti ? 'multiple_choice' : 'binary',
          resolution_criteria: composeCriteria(),
          resolution_source: sourceUrl.trim(),
          closes_at: new Date(closesAt).toISOString(),
          resolves_at: resolvesAt ? new Date(resolvesAt).toISOString() : undefined,
          tags,
          // Binary seeds an opening YES probability; multi seeds equal option prices server-side.
          ...(isMulti
            ? { options: cleanOptions }
            : { initial_probability: initialProb / 100 }),
          metadata: {
            structure: isMulti ? 'multiple_choice' : 'binary',
            resolution: { void_handling: voidHandling, tie_handling: tieHandling },
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create market. Please review your inputs and try again.')
        setSubmitting(false)
        return
      }
      router.push(`/markets/${data.data.slug}`)
    } catch {
      setError('Network error — please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="mb-6">
        <h1 className="font-display text-3xl text-text-primary">Create a market</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Turn a real-world question into a tradeable market. It takes four short steps.
        </p>
      </header>

      <WizardProgress steps={STEPS} current={step} maxReached={maxReached} onJump={goto} />

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_320px]">
        {/* Main column */}
        <div>
          <div className="card p-5 sm:p-7">
            {/* STEP 0 — Structure */}
            {step === 0 && (
              <div>
                <StepHead title="Choose a structure" copy="How should this market resolve? You can add more structures later." />
                <div className="grid gap-3 sm:grid-cols-2">
                  <StructureCard
                    title="Binary"
                    desc="A single question with two outcomes — YES or NO."
                    icon={<IconCheck size={20} strokeWidth={2.5} />}
                    selected={structure === 'binary'}
                    onClick={() => setStructure('binary')}
                  />
                  <StructureCard
                    title="Multi-outcome"
                    desc="Several possible outcomes, each with its own probability."
                    icon={<IconInfo size={20} />}
                    selected={structure === 'multiple_choice'}
                    onClick={() => setStructure('multiple_choice')}
                  />
                </div>

                <div className="mt-6">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-text-muted">Category</span>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategory(c)}
                        aria-pressed={category === c}
                        className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors ${
                          category === c
                            ? 'border-pip-500 bg-pip-100 text-pip-500'
                            : 'border-hairline bg-surface-2 text-text-secondary hover:border-pip-300'
                        }`}
                      >
                        <CategoryIcon category={c} size={13} />
                        {CATEGORY_LABELS[c].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 1 — Question & outcomes */}
            {step === 1 && (
              <div>
                <StepHead title="Question & outcomes" copy="Write a clear, verifiable question and set your opening estimate." />
                <div className="space-y-5">
                  <Field
                    id="mk-title"
                    label="Question"
                    hint={`${title.trim().length}/200 · min 10`}
                  >
                    <input
                      id="mk-title"
                      className="input w-full"
                      value={title}
                      maxLength={200}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Will Kenya's inflation rate be below 5% in December 2026?"
                    />
                    {title.length > 0 && !titleOk && (
                      <FieldHint>Phrase as a yes/no question, 10–200 characters.</FieldHint>
                    )}
                  </Field>

                  <Field id="mk-desc" label="Context & background" hint={`${description.trim().length}/2000 · min 20`}>
                    <textarea
                      id="mk-desc"
                      className="input w-full resize-y"
                      rows={4}
                      value={description}
                      maxLength={2000}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Explain what this market is about and any context traders need to understand it."
                    />
                  </Field>

                  {!isMulti && (
                    <div>
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Opening probability</span>
                        <span className="font-mono text-xs text-text-muted">Seeds the starting price</span>
                      </div>
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="price-yes text-lg">YES {initialProb}%</span>
                        <span className="price-no text-lg">NO {100 - initialProb}%</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={99}
                        value={initialProb}
                        onChange={(e) => setInitialProb(Number(e.target.value))}
                        aria-label="Opening YES probability"
                        className="w-full accent-[color:var(--pip-500)]"
                      />
                      <div className="prob-bar mt-2">
                        <div className="prob-bar-fill" style={{ width: `${initialProb}%` }} />
                      </div>
                    </div>
                  )}

                  {isMulti && (
                    <div>
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Outcomes</span>
                        <span className="font-mono text-[11px] text-text-muted">{cleanOptions.length}/12 &middot; min 2</span>
                      </div>
                      <p className="mb-3 text-xs leading-relaxed text-text-muted">
                        List every mutually-exclusive outcome. Each opens at an equal probability; prices move as people trade.
                      </p>
                      <div className="space-y-2">
                        {options.map((opt, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-sm bg-surface-2 font-mono text-xs text-text-muted">
                              {i + 1}
                            </span>
                            <input
                              className="input w-full"
                              value={opt}
                              maxLength={80}
                              aria-label={`Outcome ${i + 1}`}
                              onChange={(e) =>
                                setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))
                              }
                              placeholder={`Outcome ${i + 1}`}
                            />
                            <button
                              type="button"
                              onClick={() => setOptions((prev) => prev.filter((_, j) => j !== i))}
                              disabled={options.length <= 2}
                              aria-label={`Remove outcome ${i + 1}`}
                              className="flex-none rounded-sm p-2 text-text-muted transition-colors hover:text-no disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              <IconX size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                      {options.length < 12 && (
                        <button
                          type="button"
                          onClick={() => setOptions((prev) => [...prev, ''])}
                          className="btn btn-ghost btn-sm mt-3 gap-1"
                        >
                          <IconArrowRight size={14} /> Add outcome
                        </button>
                      )}
                      {isMulti && !optionsOk && cleanOptions.length > 0 && (
                        <FieldHint>
                          {!optionsUnique
                            ? 'Outcomes must be unique.'
                            : cleanOptions.length < 2
                              ? 'Add at least two outcomes.'
                              : 'Add between 2 and 12 outcomes, each up to 80 characters.'}
                        </FieldHint>
                      )}
                    </div>
                  )}

                  <Field id="mk-tags" label="Tags" hint={`${tags.length}/10`}>
                    {tags.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {tags.map((t) => (
                          <span key={t} className="badge badge-muted gap-1">
                            #{t}
                            <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                              <IconX size={11} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <input
                      id="mk-tags"
                      className="input w-full"
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault()
                          addTag()
                        }
                      }}
                      onBlur={addTag}
                      placeholder="Add a tag and press Enter (e.g. kenya, inflation)"
                    />
                  </Field>
                </div>
              </div>
            )}

            {/* STEP 2 — Resolution */}
            {step === 2 && (
              <div>
                <StepHead title="Resolution" copy="Define exactly how and when this market resolves. Precision here prevents disputes." />
                <div className="space-y-5">
                  <Field id="mk-source" label="Credible source URL" hint="Primary / official source">
                    <input
                      id="mk-source"
                      className="input w-full"
                      type="url"
                      inputMode="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://www.centralbank.go.ke/..."
                    />
                    {sourceUrl.length > 0 && !sourceOk && (
                      <FieldHint>Enter a full URL starting with https://</FieldHint>
                    )}
                    {sourceWeak && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-[color:var(--warn)]">
                        <IconWarning size={13} className="mt-px flex-none" />
                        Social posts are rarely accepted as primary sources. Prefer an official body or major data provider.
                      </p>
                    )}
                    {!sourceUrl && (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-text-muted">
                        <IconInfo size={13} className="mt-px flex-none text-pip-500" />
                        Use one authoritative source — a government body, exchange, official scoreboard or recognised data provider.
                      </p>
                    )}
                  </Field>

                  <Field id="mk-criteria" label="Resolution rules" hint={`${criteria.trim().length}/700 · min 20`}>
                    <textarea
                      id="mk-criteria"
                      className="input w-full resize-y"
                      rows={4}
                      value={criteria}
                      maxLength={700}
                      onChange={(e) => setCriteria(e.target.value)}
                      placeholder="This market resolves YES if [precise condition] according to [source], measured at [UTC time]. Otherwise it resolves NO."
                    />
                  </Field>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="mk-close" label="Close (trading stops)" hint="Your local time → shown in UTC">
                      <input
                        id="mk-close"
                        className="input w-full"
                        type="datetime-local"
                        min={minClose}
                        value={closesAt}
                        onChange={(e) => setClosesAt(e.target.value)}
                      />
                      {closesAt && !closeOk && <FieldHint>Close must be at least 1 hour from now.</FieldHint>}
                      {closeOk && (
                        <p className="mt-1.5 font-mono text-[11px] text-text-muted">
                          {new Date(closesAt).toUTCString()}
                        </p>
                      )}
                    </Field>
                    <Field id="mk-resolve" label="Resolution date (optional)" hint="On or after close">
                      <input
                        id="mk-resolve"
                        className="input w-full"
                        type="datetime-local"
                        min={closesAt || minClose}
                        value={resolvesAt}
                        onChange={(e) => setResolvesAt(e.target.value)}
                      />
                      {resolvesAt && !resolveOk && <FieldHint>Must be on or after the close date.</FieldHint>}
                    </Field>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="mk-void" label="If cancelled / void">
                      <select id="mk-void" className="input w-full" value={voidHandling} onChange={(e) => setVoidHandling(e.target.value as typeof voidHandling)}>
                        {VOID_OPTS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field id="mk-tie" label="If tied / ambiguous">
                      <select id="mk-tie" className="input w-full" value={tieHandling} onChange={(e) => setTieHandling(e.target.value as typeof tieHandling)}>
                        {TIE_OPTS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 — Review */}
            {step === 3 && (
              <div>
                <StepHead title="Review & publish" copy="Check every detail. You can jump back to any step to edit." />
                <dl className="divide-y divide-hairline">
                  <ReviewRow label="Structure" onEdit={() => goto(0)} value={isMulti ? 'Multi-outcome' : 'Binary (YES / NO)'} />
                  <ReviewRow label="Category" onEdit={() => goto(0)} value={category ? CATEGORY_LABELS[category].label : '—'} ok={!!category} />
                  <ReviewRow label="Question" onEdit={() => goto(1)} value={title || '—'} ok={titleOk} />
                  <ReviewRow label="Context" onEdit={() => goto(1)} value={description || '—'} ok={descOk} clamp />
                  {isMulti ? (
                    <ReviewRow
                      label="Outcomes"
                      onEdit={() => goto(1)}
                      value={cleanOptions.length ? cleanOptions.join('  ·  ') : '—'}
                      ok={optionsOk}
                    />
                  ) : (
                    <ReviewRow label="Opening" onEdit={() => goto(1)} value={`YES ${initialProb}% · NO ${100 - initialProb}%`} />
                  )}
                  <ReviewRow label="Tags" onEdit={() => goto(1)} value={tags.length ? tags.map((t) => `#${t}`).join('  ') : 'None'} />
                  <ReviewRow label="Source" onEdit={() => goto(2)} value={sourceUrl || '—'} ok={sourceOk} link={sourceOk ? sourceUrl : undefined} />
                  <ReviewRow label="Rules" onEdit={() => goto(2)} value={criteria || '—'} ok={criteriaOk} clamp />
                  <ReviewRow label="Close" onEdit={() => goto(2)} value={closeOk ? new Date(closesAt).toUTCString() : '—'} ok={closeOk} />
                  <ReviewRow label="Void / tie" onEdit={() => goto(2)} value={`${VOID_OPTS.find((o) => o.value === voidHandling)!.label} · ${TIE_OPTS.find((o) => o.value === tieHandling)!.label}`} />
                </dl>

                {!allValid && (
                  <p className="mt-4 flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--warn)_30%,transparent)] bg-brass-100 p-3 text-xs text-brass-600">
                    <IconWarning size={13} /> Some required fields need attention — fix the rows marked above.
                  </p>
                )}

                <div className="mt-4 rounded-md border border-hairline bg-surface-2 p-3.5 text-xs leading-relaxed text-text-muted">
                  User-created markets are reviewed by our team before going live. As the creator you earn a share of trading volume.
                </div>
              </div>
            )}

            {error && (
              <div role="alert" aria-live="assertive" className="mt-4 rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no">
                {error}
              </div>
            )}

            {/* Nav */}
            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={back}
                disabled={step === 0 || submitting}
                className="btn btn-ghost btn-sm gap-1"
              >
                <IconChevronLeft size={15} /> Back
              </button>
              {step < STEPS.length - 1 ? (
                <button type="button" onClick={next} disabled={!stepValid[step]} className="btn btn-primary">
                  Continue <IconArrowRight size={15} />
                </button>
              ) : (
                <button type="button" onClick={publish} disabled={!allValid || submitting} className="btn btn-primary">
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 12a9 9 0 11-6.219-8.56" />
                      </svg>
                      Publishing…
                    </span>
                  ) : (
                    <>Publish market <IconArrowRight size={15} /></>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Preview / guidance */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <MarketPreview
            title={title}
            category={category}
            yesPct={initialProb}
            tags={tags}
            closesAt={closesAt}
            step={step}
          />
        </aside>
      </div>
    </div>
  )
}

function StepHead({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-display text-xl text-text-primary">{title}</h2>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">{copy}</p>
    </div>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {label}
        </label>
        {hint && <span className="font-mono text-[11px] text-text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1.5 text-xs text-text-muted">{children}</p>
}

function ReviewRow({
  label,
  value,
  onEdit,
  ok = true,
  clamp,
  link,
}: {
  label: string
  value: string
  onEdit: () => void
  ok?: boolean
  clamp?: boolean
  link?: string
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <dt className="w-24 flex-none text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className={`min-w-0 flex-1 text-sm ${ok ? 'text-text-primary' : 'text-no'} ${clamp ? 'line-clamp-2' : 'break-words'}`}>
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-pip-500 hover:underline">
            <span className="truncate">{value}</span>
            <IconExternalLink size={12} className="flex-none" />
          </a>
        ) : (
          value
        )}
      </dd>
      <button type="button" onClick={onEdit} className="flex-none text-xs font-medium text-pip-500 hover:underline">
        Edit
      </button>
    </div>
  )
}
