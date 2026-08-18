import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface VersionConfirmDialogProps {
  open: boolean
  nextVersion: number
  onCancel: () => void
  onConfirm: (description: string) => void
}

export function VersionConfirmDialog({ open, nextVersion, onCancel, onConfirm }: VersionConfirmDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, onCancel])

  if (!open) return null

  const handleSubmit = () => {
    const value = inputRef.current?.value.trim() ?? ''
    onConfirm(value)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel()
      }}
    >
      <div className="w-full max-w-md rounded-[4px] border border-[color:var(--border)] bg-[color:var(--card-bg)] p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Save Version v{nextVersion}</h2>
          <button
            type="button"
            className="rounded p-1 text-[color:var(--text-muted)] hover:bg-black/[0.06]"
            onClick={onCancel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="mb-1 block text-sm text-[color:var(--text-muted)]">
          Description <span className="text-xs opacity-60">(optional)</span>
        </label>
        <input
          ref={inputRef}
          type="text"
          className="mb-5 w-full rounded-[2px] border border-[color:var(--border)] bg-[color:var(--input-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]"
          placeholder="e.g., updated form"
          onKeyDown={handleKeyDown}
        />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-4 py-2 text-sm hover:bg-black/[0.03]"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSubmit}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}