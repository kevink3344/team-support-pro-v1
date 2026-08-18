import { X, History } from 'lucide-react'
import type { TicketVersion, TicketFieldDefinition, Category, User, Location } from '../types'
import { LayoutTicketForm } from './LayoutTicketForm'

interface TicketVersionPreviewProps {
  version: TicketVersion
  layout: { rows: Array<{ id: string; slots: Array<{ fieldRef: string; width: 'full' | 'half' }> }> } | null
  customFieldDefs: TicketFieldDefinition[]
  categories: Category[]
  users: User[]
  locations: Location[]
  onClose: () => void
}

export function TicketVersionPreview({
  version,
  layout,
  customFieldDefs,
  categories,
  users,
  locations,
  onClose,
}: TicketVersionPreviewProps) {
  const customValues: Record<string, string> = {}
  for (const cf of version.customFields) {
    customValues[cf.fieldId] = cf.value
  }

  const values = {
    teamId: version.teamId,
    title: version.title,
    description: version.description,
    status: version.status,
    priority: version.priority,
    categoryId: version.categoryId,
    assignedToId: version.assignedToId ?? '',
    requestorName: version.requestorName,
    requestorEmail: version.requestorEmail,
    location: version.location,
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="fixed inset-0 bg-slate-950/40"
        aria-label="Close version preview"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal
        className="surface relative z-10 flex max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] flex-col p-0 shadow-[0_24px_64px_rgba(13,47,79,0.22)]"
      >
        <div className="flex items-start justify-between border-b border-[color:var(--border)] px-5 py-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[color:var(--accent)]">
              <History className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.12em]">Historical Version</span>
            </div>
            <h2 className="text-lg font-semibold">Version {version.versionNumber}</h2>
            <p className="text-sm text-[color:var(--text-muted)]">
              Snapshot from {new Date(version.createdAt).toLocaleString()}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            This is a read-only snapshot. Fields shown reflect the ticket at the time this version was recorded.
          </div>
          <LayoutTicketForm
            layout={layout}
            customFieldDefs={customFieldDefs}
            categories={categories}
            users={users}
            locations={locations}
            values={values}
            onChange={() => {}}
            customValues={customValues}
            onCustomChange={() => {}}
          />
        </div>

        <div className="flex justify-end border-t border-[color:var(--border)] px-5 py-4">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
