import { useEffect, useState } from 'react'
import { Eye, RotateCcw, AlertTriangle, Loader2, History } from 'lucide-react'
import type { Ticket, TicketVersion, TicketFieldDefinition, Category, User, Location, AuthenticatedUser } from '../types'
import { fetchTicketVersions, revertTicketToVersion } from '../lib/api'
import { TicketVersionPreview } from './TicketVersionPreview'

interface TicketVersionHistoryProps {
  ticketId: string
  currentTicket: Ticket
  currentUser: AuthenticatedUser
  layout: { rows: Array<{ id: string; slots: Array<{ fieldRef: string; width: 'full' | 'half' }> }> } | null
  customFieldDefs: TicketFieldDefinition[]
  categories: Category[]
  users: User[]
  locations: Location[]
  onTicketReverted?: (ticket: Ticket) => void
}

const formatDateTime = (value: string) => {
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

const fieldLabel = (key: string, customFieldDefs: TicketFieldDefinition[]) => {
  const labels: Record<string, string> = {
    title: 'Title',
    description: 'Description',
    status: 'Status',
    priority: 'Priority',
    teamId: 'Team',
    categoryId: 'Category',
    assignedToId: 'Assigned To',
    requestorName: 'Requestor',
    requestorEmail: 'Requestor Email',
    location: 'Location',
  }
  if (labels[key]) return labels[key]
  const def = customFieldDefs.find((d) => d.id === key)
  return def?.label ?? key
}

const summarizeChanges = (
  current: TicketVersion,
  previous: TicketVersion | undefined,
  customFieldDefs: TicketFieldDefinition[],
): string => {
  if (!previous) return 'Initial version'
  const changes: string[] = []
  const fields: Array<keyof TicketVersion> = [
    'title',
    'description',
    'status',
    'priority',
    'teamId',
    'categoryId',
    'assignedToId',
    'requestorName',
    'requestorEmail',
    'location',
  ]
  for (const field of fields) {
    if (current[field] !== previous[field]) {
      changes.push(fieldLabel(field, customFieldDefs))
    }
  }
  const currentCustomIds = new Set(current.customFields.map((cf) => cf.fieldId))
  for (const cf of current.customFields) {
    const prev = previous.customFields.find((p) => p.fieldId === cf.fieldId)
    if (!prev || prev.value !== cf.value) {
      changes.push(fieldLabel(cf.fieldId, customFieldDefs))
    }
  }
  for (const prev of previous.customFields) {
    if (!currentCustomIds.has(prev.fieldId)) {
      changes.push(fieldLabel(prev.fieldId, customFieldDefs))
    }
  }
  if (changes.length === 0) return 'No field changes'
  return `Changed: ${changes.join(', ')}`
}

export function TicketVersionHistory({
  ticketId,
  currentUser,
  customFieldDefs,
  layout,
  categories,
  users,
  locations,
  onTicketReverted,
}: TicketVersionHistoryProps) {
  const [versions, setVersions] = useState<TicketVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewVersion, setPreviewVersion] = useState<TicketVersion | null>(null)
  const [confirmVersion, setConfirmVersion] = useState<TicketVersion | null>(null)
  const [revertPending, setRevertPending] = useState(false)

  const isAdmin = currentUser.role === 'Admin' || currentUser.role === 'Super Admin'

  const loadVersions = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchTicketVersions(ticketId)
      setVersions(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load versions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadVersions()
    // ticketId is the only external value that should refetch the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId])

  const handleRevert = async (version: TicketVersion) => {
    setRevertPending(true)
    try {
      const ticket = await revertTicketToVersion(ticketId, version.id)
      onTicketReverted?.(ticket)
      setConfirmVersion(null)
      await loadVersions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revert ticket')
    } finally {
      setRevertPending(false)
    }
  }

  if (loading) {
    return (
      <div className="surface-muted flex items-center gap-2 p-4 text-sm text-[color:var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading version history…
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
        No versions recorded for this ticket yet.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="surface-muted space-y-3 p-4">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-[color:var(--text-muted)]" />
          <div className="text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
            Version History
          </div>
        </div>
        <p className="text-sm text-[color:var(--text-muted)]">
          Every save creates a new immutable snapshot. Reverting creates a new version rather than deleting history.
        </p>
      </div>

      <div className="space-y-3">
        {versions.map((version, index) => {
          const previous = versions[index + 1]
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
                  </div>
                  <div className="mt-1 text-sm text-[color:var(--text)]">
                    {summarizeChanges(version, previous, customFieldDefs)}
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
                  {isAdmin && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-[2px] border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800 hover:opacity-80"
                      onClick={() => setConfirmVersion(version)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Revert
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {previewVersion && (
        <TicketVersionPreview
          version={previewVersion}
          layout={layout}
          customFieldDefs={customFieldDefs}
          categories={categories}
          users={users}
          locations={locations}
          onClose={() => setPreviewVersion(null)}
        />
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
                  Revert to version {confirmVersion.versionNumber}?
                </h2>
                <p className="text-sm text-[color:var(--text-muted)]">
                  This will restore the ticket fields and custom fields to this version. A new snapshot of the current
                  state will be created first, so no history is lost.
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
