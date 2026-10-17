'use client'

// components/kyc/file-drop.tsx
// Image upload with drag-and-drop, click-to-browse, live preview and a mobile
// camera hook (`capture`). Used for ID front/back and the selfie. Validates
// type + size and surfaces a friendly error inline.
import { useCallback, useId, useRef, useState } from 'react'
import { IconCheck, IconX } from '@/components/ui/icons'

interface FileDropProps {
  label: string
  hint?: string
  file: File | null
  onChange: (file: File | null) => void
  /**
   * Set when a previous session already uploaded this document. There is no
   * File to show after a reload, only the stored path, so the control says so
   * instead of rendering an empty drop zone and inviting a second upload.
   */
  uploaded?: boolean
  /** 'user' opens the front camera on mobile (selfie); 'environment' the rear. */
  capture?: 'user' | 'environment'
  accept?: string
  maxMb?: number
}

export function FileDrop({
  label,
  hint,
  file,
  onChange,
  capture,
  uploaded = false,
  accept = 'image/png,image/jpeg,application/pdf',
  maxMb = 5,
}: FileDropProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState('')

  const accept_ = accept

  const handleFile = useCallback(
    (f: File | null) => {
      setError('')
      if (!f) {
        onChange(null)
        setPreview(null)
        return
      }
      if (!f.type.startsWith('image/')) {
        setError('Please choose a PNG, JPG or PDF.')
        return
      }
      if (f.size > maxMb * 1024 * 1024) {
        setError(`Image must be under ${maxMb} MB.`)
        return
      }
      onChange(f)
      setPreview(URL.createObjectURL(f))
    },
    [onChange, maxMb],
  )

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</span>
        {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
      </div>

      {file && preview ? (
        <div className="flex items-center gap-3 rounded-md border border-hairline bg-surface-2 p-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="h-14 w-20 flex-none rounded-sm object-cover" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-xs font-medium text-yes">
              <IconCheck size={12} strokeWidth={2.5} /> Ready
            </p>
            <p className="truncate text-xs text-text-muted">{file.name}</p>
          </div>
          <button
            type="button"
            onClick={() => handleFile(null)}
            className="flex-none rounded-sm p-1.5 text-text-muted transition-colors hover:text-no"
            aria-label={`Remove ${label}`}
          >
            <IconX size={15} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            handleFile(e.dataTransfer.files?.[0] ?? null)
          }}
          className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 py-6 text-center transition-colors ${
            dragging ? 'border-pip-400 bg-pip-100' : 'border-hairline bg-surface-2 hover:border-pip-300'
          }`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-surface text-pip-500">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
              <path d="M12 16V4M12 4l-4 4M12 4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
          </span>
          <span className="text-sm font-medium text-text-secondary">
            {uploaded
              ? 'Uploaded earlier — tap to replace'
              : capture
                ? 'Take a photo or upload'
                : 'Drop image or browse'}
          </span>
          <span className="text-[11px] text-text-muted">PNG, JPG or PDF · up to {maxMb} MB</span>
        </button>
      )}

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept_}
        capture={capture}
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {error && (
        <p role="alert" className="mt-1.5 text-xs text-no">
          {error}
        </p>
      )}
    </div>
  )
}
