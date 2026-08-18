import { useEffect, useState } from 'react'
import { Eye, RotateCcw, AlertTriangle, Loader2, History, Trash2 } from 'lucide-react'
import type { TicketLayoutVersion, TicketFieldDefinition } from '../types'
import {
  fetchTicketLayoutVersions,
  revertTicketLayoutToVersion,
  deleteTicketLayoutVersion,
} from '../lib/api'

interface TicketLayoutVersionHistoryProps {
  organizationId: string
  customFieldDefs: TicketFieldDefinition[]
  currentLayout: { rows: Array<{ id: string; slots: Array<{ fieldRef: string; width: 'full' | 'half' }> }> } | null
  onLayoutReverted?: (layout: { rows: Array<{ id: string; slots: Array<{ fieldRef: string; width: 'full' | 'half' }> }> }) => void
}

const formatDateTime = (value: string) => {
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

const fieldLabel = (fieldRef: string, customFieldDefs: TicketFieldDefinition[]) => {
  const labels: Record<string, string> = {
    title: 'Title',
    requestorName: 'Requestor',
    requestorEmail: 'Requestor Email',
    categoryId: 'Category',
    priority: 'Priority',
    assignedToId: 'Assigned To',
    location: 'Location',
    description: 'Description',
    status: 'Status',
  }
  if (labels[fieldRef]) return labels[fieldRef]
  const def = customFieldDefs.find((d) => d.id === fieldRef)
  return def?.label ?? fieldRef
}

const summarizeLayout = (version: TicketLayoutVersion, customFieldDefs: TicketFieldDefinition[]): string => {
  const rows = version.layout.rows
  const slotCount = rows.reduce((sum, row) => sum + row.slots.length, 0)
  const fieldNames = rows
    .flatMap((row) => row.slots.map((slot) => fieldLabel(slot.fieldRef, customFieldDefs)))
    .slice(0, 6)
  const suffix = slotCount > fieldNames.length ? `+${slotCount - fieldNames.length} more` : ''
  return `${rows.length} row${rows.length === 1 ? '' : 's'}, ${slotCount} field${slotCount === 1 ? '' : 's'}${fieldNames.length ? ` (${fieldNames.join(', ')}${suffix ? `, ${suffix}` : ''})` : ''}`
}

export function TicketLayoutVersionHistory({
  organizationId,
  customFieldDefs,
  currentLayout,
  onLayoutReverted,
}: TicketLayoutVersionHistoryProps) {
  const [versions, setVersions] = useState<TicketLayoutVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewVersion, setPreviewVersion] = useState<TicketLayoutVersion | null>(null)
  const [confirmVersion, setConfirmVersion] = useState<TicketLayoutVersion | null>(null)
  const [revertPending, setRevertPending] = useState(false)

  const loadVersions = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTicketLayoutVersions(organizationId)
      setVersions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load layout versions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadVersions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId])

  const handleRevert = async (version: TicketLayoutVersion) => {
    setRevertPending(true)
    try {
      const reverted = await revertTicketLayoutToVersion(organizationId, version.id)
      onLayoutReverted?.(reverted.layout)
      setConfirmVersion(null)
      await loadVersions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revert layout')
    } finally {
      setRevertPending(false)
    }
  }

  const handleDelete = async (version: TicketLayoutVersion) => {
    try {
      await deleteTicketLayoutVersion(organizationId, version.id)
      await loadVersions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete layout version')
    }
  }

  if (loading) {
    return (
      <div className="surface-muted flex items-center gap-2 p-4 text-sm text-[color:var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading layout version history…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-[2px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className="surface-muted p-4 text-sm text-[color:var(--text-muted)]">
        No versions recorded for this layout yet. Save the layout to create the first version.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="surface-muted space-y-3 p-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[color:var(--text-muted)]" />
          <div className="text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
            Layout Version History
          </div>
        </div>
        <p className="text-sm text-[color:var(--text-muted)]">
          Every save creates a new immutable snapshot of the organization's ticket layout. Reverting restores a previous layout and creates a new snapshot first, so no history is lost.
        </p>
      </div>

      <div className="space-y-3">
        {versions.map((version) => {
          const isCurrent =
            currentLayout &&
            JSON.stringify(currentLayout.rows) === JSON.stringify(version.layout.rows)
          return (
            <div key={version.id} className="surface-muted p-4">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-[2px] bg-[color:var(--panel-bg)] px-1.5 py-0.5 text-xs font-semibold text-[color:var(--accent)]">
                      Version {version.versionNumber}
                    </span>
                    <span className="text-xs text-[color:var(--text-muted)]">
                      {formatDateTime(version.createdAt)}
                    </span>
                    {isCurrent && (
                      <span className="text-[11px] uppercase tracking-wider text-emerald-600">Current</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-[color:var(--text)]">
                    {summarizeLayout(version, customFieldDefs)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="secondary-button inline-flex items-center gap-1 px-2 py-1 text-xs"
                    onClick={() => setPreviewVersion(version)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-[2px] border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:opacity-80"
                    onClick={() => setConfirmVersion(version)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Revert
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-[2px] border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:opacity-80"
                    onClick={() => void handleDelete(version)}
                    title="Delete this version from history"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {previewVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="fixed inset-0 bg-slate-950/40"
            aria-label="Close preview"
            onClick={() => setPreviewVersion(null)}
          />
          <div
            role="dialog"
            aria-modal
            className="surface relative z-10 flex max-h-[90vh] w-[min(40rem,calc(100vw-2rem))] flex-col p-0 shadow-[0_24px_64px_rgba(13,47,79,0.22)]"
          >
            <div className="flex items-start justify-between border-b border-[color:var(--border)] px-5 py-4">
              <div>
                <div className="mb-1 flex items-center gap-2 text-[color:var(--accent)]">
                  <History className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-[0.12em]">Historical Layout</span>
                </div>
                <h2 className="text-lg font-semibold">Version {previewVersion.versionNumber}</h2>
                <p className="text-sm text-[color:var(--text-muted)]">
                  Snapshot from {new Date(previewVersion.createdAt).toLocaleString()}
                </p>
              </div>
              <button type="button" className="icon-button" onClick={() => setPreviewVersion(null)} aria-label="Close">
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-4 rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This is a read-only preview of how the layout appeared when this version was recorded.
              </div>
              <div className="space-y-3">
                {previewVersion.layout.rows.map((row, idx) => (
                  <div key={row.id} className="rounded-[2px] border border-[color:var(--border)] bg-[color:var(--card-bg)] p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                      Row {idx + 1}
                    </div>
                    <div className="flex flex-col gap-3 md:flex-row">
                      {row.slots.map((slot) => (
                        <div
                          key={slot.fieldRef}
                          className={`rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-2 text-sm ${
                            slot.width === 'full' ? 'w-full' : 'w-full md:w-1/2'
                          }`}
                        >
                          {fieldLabel(slot.fieldRef, customFieldDefs)}
                          <span className="ml-2 text-xs text-[color:var(--text-muted)]">({slot.width})</span>
                        </div>
                      ))}
                      {row.slots.length === 0 && (
                        <div className="text-sm text-[color:var(--text-muted)]">Empty row</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end border-t border-[color:var(--border)] px-5 py-4">
              <button type="button" className="secondary-button" onClick={() => setPreviewVersion(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="fixed inset-0 bg-slate-950/40"
            aria-label="Cancel revert"
            onClick={() => setConfirmVersion(null)}
          />
          <div
            role="dialog"
            aria-modal
            className="surface relative z-10 w-[min(28rem,calc(100vw-2rem))] p-6 shadow-[0_24px_64px_rgba(13,47,79,0.22)]"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] bg-[color:var(--panel-bg)] text-amber-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="mb-1 text-base font-semibold text-[color:var(--text)]">
                  Revert to layout version {confirmVersion.versionNumber}?
                </h2>
                <p className="text-sm text-[color:var(--text-muted)]">
                  This will restore the ticket layout to this version. A snapshot of the current layout will be created first, so no history is lost.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmVersion(null)}
                disabled={revertPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button inline-flex items-center gap-1"
                onClick={() => void handleRevert(confirmVersion)}
                disabled={revertPending}
              >
                {revertPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reverting…
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4" />
                    Revert
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
