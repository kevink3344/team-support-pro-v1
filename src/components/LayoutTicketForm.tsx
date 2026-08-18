import type {
  BuiltInFieldKey,
  Category,
  Location,
  Team,
  TicketFieldDefinition,
  TicketLayout,
  TicketPriority,
  TicketStatus,
  User,
} from '../types'

const builtInFieldLabels: Record<BuiltInFieldKey, string> = {
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

const isBuiltInField = (ref: string): ref is BuiltInFieldKey => ref in builtInFieldLabels

const defaultTicketLayout: TicketLayout = {
  rows: [
    { id: 'row-default-1', slots: [{ fieldRef: 'title', width: 'full' }] },
    { id: 'row-default-2', slots: [{ fieldRef: 'requestorName', width: 'half' }, { fieldRef: 'requestorEmail', width: 'half' }] },
    { id: 'row-default-3', slots: [{ fieldRef: 'categoryId', width: 'half' }, { fieldRef: 'priority', width: 'half' }] },
    { id: 'row-default-4', slots: [{ fieldRef: 'assignedToId', width: 'half' }, { fieldRef: 'location', width: 'half' }] },
    { id: 'row-default-5', slots: [{ fieldRef: 'description', width: 'full' }] },
    { id: 'row-default-6', slots: [{ fieldRef: 'status', width: 'full' }] },
  ],
}

interface LayoutTicketFormProps {
  layout: TicketLayout | null
  customFieldDefs: TicketFieldDefinition[]
  categories: Category[]
  users: User[]
  locations: Location[]
  values: {
    teamId: string
    title: string
    description: string
    status: TicketStatus
    priority: TicketPriority
    categoryId: string
    assignedToId: string
    requestorName: string
    requestorEmail: string
    location: string
  }
  onChange: (patch: Partial<LayoutTicketFormProps['values']>) => void
  customValues: Record<string, string>
  onCustomChange: (fieldId: string, value: string) => void
  /** Teams the current user is allowed to pick from when reassigning/creating for another team. */
  teamOptions?: Team[]
  /** Show the team selector (typically only for users with org-wide ticket access). */
  canChangeTeam?: boolean
}

export function LayoutTicketForm({
  layout,
  customFieldDefs,
  categories,
  users,
  locations,
  values,
  onChange,
  customValues,
  onCustomChange,
  teamOptions,
  canChangeTeam,
}: LayoutTicketFormProps) {
  const customFieldMap = new Map(customFieldDefs.map((d) => [d.id, d]))

  const renderBuiltInField = (key: BuiltInFieldKey) => {
    const currentTeamCategories = categories.filter((c) => c.teamId === values.teamId)
    const currentTeamMembers = users.filter((u) => u.teamId === values.teamId)

    switch (key) {
      case 'title':
        return (
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="input-control"
              value={values.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </label>
        )
      case 'requestorName':
        return (
          <label className="field">
            <span className="field-label">Requestor</span>
            <input
              className="input-control"
              value={values.requestorName}
              onChange={(e) => onChange({ requestorName: e.target.value })}
            />
          </label>
        )
      case 'requestorEmail':
        return (
          <label className="field">
            <span className="field-label">Requestor Email</span>
            <input
              type="email"
              className="input-control"
              value={values.requestorEmail}
              onChange={(e) => onChange({ requestorEmail: e.target.value })}
            />
          </label>
        )
      case 'categoryId':
        return (
          <label className="field">
            <span className="field-label">Category</span>
            <select
              className="input-control"
              value={values.categoryId}
              onChange={(e) => onChange({ categoryId: e.target.value })}
            >
              <option value="">— Select a category —</option>
              {currentTeamCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )
      case 'priority':
        return (
          <label className="field">
            <span className="field-label">Priority</span>
            <select
              className="input-control"
              value={values.priority}
              onChange={(e) => onChange({ priority: e.target.value as TicketPriority })}
            >
              {(['Low', 'Medium', 'High', 'Critical'] as TicketPriority[]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
        )
      case 'assignedToId':
        return (
          <label className="field">
            <span className="field-label">Assigned To</span>
            <select
              className="input-control"
              value={values.assignedToId}
              onChange={(e) => onChange({ assignedToId: e.target.value })}
            >
              <option value="">— Unassigned —</option>
              {currentTeamMembers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        )
      case 'location':
        return (
          <label className="field">
            <span className="field-label">Location</span>
            <select
              className="input-control"
              value={values.location}
              onChange={(e) => onChange({ location: e.target.value })}
            >
              <option value="">— Select a location —</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.name}>
                  {loc.name}
                </option>
              ))}
            </select>
          </label>
        )
      case 'description':
        return (
          <label className="field">
            <span className="field-label">Description</span>
            <textarea
              className="input-control min-h-36"
              value={values.description}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </label>
        )
      case 'status':
        return (
          <label className="field">
            <span className="field-label">Status</span>
            <select
              className="input-control"
              value={values.status}
              onChange={(e) => onChange({ status: e.target.value as TicketStatus })}
            >
              {(['Open', 'In Progress', 'Pending', 'Resolved', 'Closed'] as TicketStatus[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        )
      default:
        return null
    }
  }

  const renderCustomField = (def: TicketFieldDefinition) => {
    const value = customValues[def.id] ?? ''
    return (
      <label key={def.id} className="field">
        <span className="field-label">
          {def.label}
          {def.isRequired && <span className="ml-1 text-rose-500">*</span>}
        </span>
        {def.fieldType === 'select' ? (
          <select
            className="input-control"
            value={value}
            onChange={(e) => onCustomChange(def.id, e.target.value)}
          >
            <option value="">— Select —</option>
            {def.options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : def.fieldType === 'checkbox' ? (
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={value === 'true'}
            onChange={(e) => onCustomChange(def.id, e.target.checked ? 'true' : 'false')}
          />
        ) : (
          <input
            type={def.fieldType === 'number' ? 'number' : def.fieldType === 'date' ? 'date' : 'text'}
            className="input-control"
            value={value}
            onChange={(e) => onCustomChange(def.id, e.target.value)}
          />
        )}
      </label>
    )
  }

  const renderSlot = (fieldRef: string) => {
    if (isBuiltInField(fieldRef)) {
      return renderBuiltInField(fieldRef)
    }
    const def = customFieldMap.get(fieldRef)
    return def ? renderCustomField(def) : null
  }

  const rows =
    layout && layout.rows.length > 0
      ? layout.rows
      : defaultTicketLayout.rows

  return (
    <div className="space-y-4">
      {canChangeTeam && teamOptions && teamOptions.length > 0 && (
        <label className="field">
          <span className="field-label">Team</span>
          <select
            className="input-control"
            value={values.teamId}
            onChange={(e) => onChange({ teamId: e.target.value })}
          >
            {teamOptions.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {rows.map((row) =>
        row.slots.length === 0 ? null : (
          <div key={row.id} className="grid gap-4 md:grid-cols-2">
            {row.slots.map((slot, idx) => (
              <div
                key={`${row.id}-${slot.fieldRef}-${idx}`}
                className={slot.width === 'full' ? 'md:col-span-2' : 'md:col-span-1'}
              >
                {renderSlot(slot.fieldRef)}
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  )
}
