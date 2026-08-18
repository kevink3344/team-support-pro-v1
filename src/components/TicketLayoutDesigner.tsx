import { useMemo, useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  pointerWithin,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2, Type, AlignLeft, ListChecks, Calendar, Hash, CheckSquare, X, ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react'
import type {
  BuiltInFieldKey,
  TicketFieldDefinition,
  TicketLayout,
  TicketLayoutRow,
  TicketLayoutSlot,
} from '../types'

const builtInFields: { key: BuiltInFieldKey; label: string; icon: typeof Type }[] = [
  { key: 'title', label: 'Title', icon: Type },
  { key: 'requestorName', label: 'Requestor', icon: Type },
  { key: 'requestorEmail', label: 'Requestor Email', icon: Type },
  { key: 'categoryId', label: 'Category', icon: ListChecks },
  { key: 'priority', label: 'Priority', icon: ListChecks },
  { key: 'assignedToId', label: 'Assigned To', icon: ListChecks },
  { key: 'location', label: 'Location', icon: ListChecks },
  { key: 'description', label: 'Description', icon: AlignLeft },
  { key: 'status', label: 'Status', icon: ListChecks },
]

const lockedBuiltIns: BuiltInFieldKey[] = ['title', 'requestorName', 'requestorEmail']

let rowIdCounter = 0
const nextRowId = () => {
  rowIdCounter += 1
  return `row-${Date.now()}-${rowIdCounter}`
}

const fieldTypeIcon: Record<TicketFieldDefinition['fieldType'], typeof Type> = {
  text: Type,
  select: ListChecks,
  checkbox: CheckSquare,
  number: Hash,
  date: Calendar,
}

interface SortableSlotProps {
  slot: TicketLayoutSlot
  rowId: string
  index: number
  slotCount: number
  onToggleWidth: () => void
  onRemove: () => void
  onMoveLeft: () => void
  onMoveRight: () => void
  isLocked: boolean
  label: string
  icon: typeof Type
}

function SortableSlot({ slot, onToggleWidth, onRemove, onMoveLeft, onMoveRight, slotCount, isLocked, label, icon }: SortableSlotProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `slot-${slot.fieldRef}`,
    data: { type: 'slot', fieldRef: slot.fieldRef, rowId: slot.fieldRef },
    disabled: isLocked,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const Icon = icon
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-2 ${
        slot.width === 'full' ? 'flex-1' : 'flex-1'
      }`}
    >
      {!isLocked && (
        <button type="button" className="cursor-grab text-[color:var(--text-muted)]" {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <Icon className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
      <span className="flex-1 truncate text-sm">{label}</span>
      {!isLocked && slotCount > 1 && (
        <div className="flex items-center">
          <button
            type="button"
            className="rounded p-1 text-[color:var(--text-muted)] hover:bg-black/[0.06] disabled:opacity-30"
            onClick={onMoveLeft}
            title="Move left"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-[color:var(--text-muted)] hover:bg-black/[0.06] disabled:opacity-30"
            onClick={onMoveRight}
            title="Move right"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {!isLocked && (
        <>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-xs uppercase tracking-wider text-[color:var(--text-muted)] hover:bg-black/[0.04]"
            onClick={onToggleWidth}
            title={slot.width === 'full' ? 'Make half width' : 'Make full width'}
          >
            {slot.width === 'full' ? 'Full' : '1/2'}
          </button>
          <button
            type="button"
            className="text-rose-500 hover:text-rose-600"
            onClick={onRemove}
            title="Remove from layout"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  )
}

interface SortableRowProps {
  row: TicketLayoutRow
  index: number
  rowCount: number
  customFieldDefs: TicketFieldDefinition[]
  isDropTarget: boolean
  paletteFields: { key: string; label: string; icon: typeof Type }[]
  onToggleSlotWidth: (slotIndex: number) => void
  onRemoveSlot: (slotIndex: number) => void
  onMoveRowUp: () => void
  onMoveRowDown: () => void
  onMoveSlotLeft: (slotIndex: number) => void
  onMoveSlotRight: (slotIndex: number) => void
  onRemoveRow: () => void
  onAddField: (fieldRef: string) => void
}

function SortableRow({
  row,
  index,
  rowCount,
  customFieldDefs,
  isDropTarget,
  paletteFields,
  onToggleSlotWidth,
  onRemoveSlot,
  onMoveRowUp,
  onMoveRowDown,
  onMoveSlotLeft,
  onMoveSlotRight,
  onRemoveRow,
  onAddField,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `row-${row.id}`, data: { type: 'row', rowId: row.id } })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const getLabelAndIcon = (fieldRef: string): { label: string; icon: typeof Type } => {
    const builtIn = builtInFields.find((f) => f.key === fieldRef)
    if (builtIn) return { label: builtIn.label, icon: builtIn.icon }
    const custom = customFieldDefs.find((f) => f.id === fieldRef)
    if (custom) return { label: custom.label, icon: fieldTypeIcon[custom.fieldType] }
    return { label: fieldRef, icon: Type }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-[2px] border bg-[color:var(--card-bg)] p-3 ${
        isDropTarget ? 'border-[color:var(--accent)] ring-1 ring-[color:var(--accent)]' : 'border-[color:var(--border)]'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" className="cursor-grab text-[color:var(--text-muted)]" {...attributes} {...listeners}>
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Row {index + 1}</span>
          {rowCount > 1 && (
            <div className="ml-1 flex items-center">
              <button
                type="button"
                className="rounded p-1 text-[color:var(--text-muted)] hover:bg-black/[0.06] disabled:opacity-30"
                onClick={onMoveRowUp}
                title="Move row up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-1 text-[color:var(--text-muted)] hover:bg-black/[0.06] disabled:opacity-30"
                onClick={onMoveRowDown}
                title="Move row down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        <button type="button" className="text-rose-500 hover:text-rose-600" onClick={onRemoveRow} title="Delete row">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <SortableContext
        items={row.slots.map((s) => `slot-${s.fieldRef}`)}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex flex-col gap-3 md:flex-row">
          {row.slots.map((slot, slotIdx) => {
            const { label, icon } = getLabelAndIcon(slot.fieldRef)
            return (
              <div key={`${row.id}-${slot.fieldRef}`} className={slot.width === 'full' ? 'w-full' : 'w-full md:w-1/2'}>
                <SortableSlot
                  slot={slot}
                  rowId={row.id}
                  index={slotIdx}
                  slotCount={row.slots.length}
                  label={label}
                  icon={icon}
                  isLocked={lockedBuiltIns.includes(slot.fieldRef as BuiltInFieldKey)}
                  onToggleWidth={() => onToggleSlotWidth(slotIdx)}
                  onRemove={() => onRemoveSlot(slotIdx)}
                  onMoveLeft={() => onMoveSlotLeft(slotIdx)}
                  onMoveRight={() => onMoveSlotRight(slotIdx)}
                />
              </div>
            )
          })}
          {row.slots.length === 0 && paletteFields.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[color:var(--text-muted)]">Add field:</span>
              {paletteFields.slice(0, 8).map((field) => (
                <button
                  key={field.key}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-2 py-1 text-xs hover:bg-black/[0.03]"
                  onClick={() => onAddField(field.key)}
                >
                  <Plus className="h-3 w-3" />
                  {field.label}
                </button>
              ))}
              {paletteFields.length > 8 && (
                <span className="text-xs text-[color:var(--text-muted)]">+{paletteFields.length - 8} more</span>
              )}
            </div>
          )}
          {row.slots.length === 1 && row.slots[0].width === 'half' && paletteFields.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[color:var(--text-muted)]">Pair with:</span>
              {paletteFields.slice(0, 6).map((field) => (
                <button
                  key={field.key}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-2 py-1 text-xs hover:bg-black/[0.03]"
                  onClick={() => onAddField(field.key)}
                >
                  <Plus className="h-3 w-3" />
                  {field.label}
                </button>
              ))}
              {paletteFields.length > 6 && (
                <span className="text-xs text-[color:var(--text-muted)]">+{paletteFields.length - 6} more</span>
              )}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

interface PaletteFieldProps {
  field: { key: string; label: string; icon: typeof Type }
  onClick: () => void
}

function PaletteField({ field, onClick }: PaletteFieldProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${field.key}`,
    data: { type: 'palette', fieldRef: field.key },
  })
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  }
  const Icon = field.icon
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex cursor-grab items-center gap-2 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-2 text-sm hover:bg-black/[0.03]"
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
    >
      <Icon className="h-4 w-4 text-[color:var(--text-muted)]" />
      <span className="flex-1 truncate">{field.label}</span>
      <button
        type="button"
        className="rounded p-1 text-[color:var(--text-muted)] hover:bg-black/[0.06]"
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        title="Add to layout"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

interface TicketLayoutDesignerProps {
  layout: TicketLayout | null
  customFieldDefs: TicketFieldDefinition[]
  onChange: (layout: TicketLayout) => void
}

export function TicketLayoutDesigner({ layout, customFieldDefs, onChange }: TicketLayoutDesignerProps) {
  const [, setActiveId] = useState<string | null>(null)
  const [activeDropRowId, setActiveDropRowId] = useState<string | null>(null)
  const rows = useMemo(() => layout?.rows ?? [], [layout])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const usedRefs = useMemo(() => new Set(rows.flatMap((r) => r.slots.map((s) => s.fieldRef))), [rows])
  const paletteFields = useMemo(
    () => [
      ...builtInFields.filter((f) => !usedRefs.has(f.key)),
      ...customFieldDefs.filter((f) => !usedRefs.has(f.id)).map((f) => ({ key: f.id, label: f.label, icon: fieldTypeIcon[f.fieldType] })),
    ],
    [customFieldDefs, usedRefs],
  )

  const paletteFieldSet = useMemo(() => new Set(paletteFields.map((f) => f.key)), [paletteFields])

  const ensureLockedFields = (currentRows: TicketLayoutRow[]): TicketLayoutRow[] => {
    const seen = new Set(currentRows.flatMap((r) => r.slots.map((s) => s.fieldRef)))
    const missing = lockedBuiltIns.filter((k) => !seen.has(k))
    if (!missing.length) return currentRows
    return [
      ...missing.map((k) => ({ id: `row-locked-${k}-${nextRowId()}`, slots: [{ fieldRef: k, width: 'full' as const }] })),
      ...currentRows,
    ]
  }

  const handleAddRow = () => {
    onChange({ rows: [...rows, { id: nextRowId(), slots: [] }] })
  }

  const handleRemoveRow = (rowIndex: number) => {
    const next = rows.filter((_, idx) => idx !== rowIndex)
    onChange({ rows: ensureLockedFields(next) })
  }

  const handleAddSlotToRow = (rowIndex: number, fieldRef: string) => {
    const next = rows.map((row, idx) =>
      idx === rowIndex
        ? { ...row, slots: [...row.slots, { fieldRef, width: 'half' as const }] }
        : row,
    )
    onChange({ rows: next })
  }

  const handleAddFieldToRow = (rowIndex: number, fieldRef: string) => {
    if (!paletteFieldSet.has(fieldRef)) return
    if (rowIndex < 0 || rowIndex >= rows.length) return
    const row = rows[rowIndex]
    if (row.slots.length >= 2) return
    if (row.slots.length === 1 && row.slots[0].width === 'full') return
    handleAddSlotToRow(rowIndex, fieldRef)
  }

  const handleAddFieldFromPalette = (fieldRef: string) => {
    // Prefer empty rows, then rows that already have a half-width slot (so the new slot fits).
    const emptyRowIndex = rows.findIndex((r) => r.slots.length === 0)
    const halfRowIndex = rows.findIndex((r) => r.slots.length === 1 && r.slots[0].width === 'half')
    const rowWithSpaceIndex = emptyRowIndex >= 0 ? emptyRowIndex : halfRowIndex
    if (rowWithSpaceIndex >= 0) {
      handleAddFieldToRow(rowWithSpaceIndex, fieldRef)
    } else {
      onChange({ rows: [...rows, { id: nextRowId(), slots: [{ fieldRef, width: 'half' as const }] }] })
    }
  }

  const handleToggleSlotWidth = (rowIndex: number, slotIndex: number) => {
    const next = rows.map((row, rIdx) => {
      if (rIdx !== rowIndex) return row
      const slots = row.slots.map((slot, sIdx) =>
        sIdx === slotIndex ? { ...slot, width: slot.width === 'full' ? ('half' as const) : ('full' as const) } : slot,
      )
      return { ...row, slots }
    })
    onChange({ rows: next })
  }

  const handleRemoveSlot = (rowIndex: number, slotIndex: number) => {
    const next = rows.map((row, idx) =>
      idx === rowIndex ? { ...row, slots: row.slots.filter((_, sIdx) => sIdx !== slotIndex) } : row,
    )
    onChange({ rows: ensureLockedFields(next) })
  }

  const handleMoveRow = (rowIndex: number, direction: -1 | 1) => {
    const newIndex = rowIndex + direction
    if (newIndex < 0 || newIndex >= rows.length) return
    onChange({ rows: arrayMove(rows, rowIndex, newIndex) })
  }

  const handleMoveSlot = (rowIndex: number, slotIndex: number, direction: -1 | 1) => {
    const row = rows[rowIndex]
    if (!row) return
    const newIndex = slotIndex + direction
    if (newIndex < 0 || newIndex >= row.slots.length) return
    const next = rows.map((r, idx) =>
      idx === rowIndex ? { ...r, slots: arrayMove(r.slots, slotIndex, newIndex) } : r,
    )
    onChange({ rows: next })
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
    setActiveDropRowId(null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)

    if (activeIdStr.startsWith('palette-') && overIdStr.startsWith('row-')) {
      // Palette drops are handled on drag end to avoid re-rendering mid-drag.
      const fieldRef = activeIdStr.replace('palette-', '')
      if (!paletteFieldSet.has(fieldRef)) return
      const rowIndex = rows.findIndex((r) => `row-${r.id}` === overIdStr)
      if (rowIndex >= 0 && rows[rowIndex].slots.length < 2) {
        setActiveDropRowId(rows[rowIndex].id)
      } else {
        setActiveDropRowId(null)
      }
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    setActiveDropRowId(null)
    if (!over) return
    const activeIdStr = String(active.id)
    const overIdStr = String(over.id)

    if (activeIdStr.startsWith('palette-') && overIdStr.startsWith('row-')) {
      const fieldRef = activeIdStr.replace('palette-', '')
      if (!paletteFieldSet.has(fieldRef)) return
      const rowIndex = rows.findIndex((r) => `row-${r.id}` === overIdStr)
      if (rowIndex >= 0 && rows[rowIndex].slots.length < 2) {
        handleAddSlotToRow(rowIndex, fieldRef)
      }
      return
    }

    if (activeIdStr.startsWith('row-') && overIdStr.startsWith('row-')) {
      const oldIndex = rows.findIndex((r) => `row-${r.id}` === activeIdStr)
      const newIndex = rows.findIndex((r) => `row-${r.id}` === overIdStr)
      if (oldIndex !== newIndex) {
        onChange({ rows: arrayMove(rows, oldIndex, newIndex) })
      }
    }

    if (activeIdStr.startsWith('slot-') && overIdStr.startsWith('row-')) {
      const fieldRef = activeIdStr.replace('slot-', '')
      const sourceRowIndex = rows.findIndex((r) => r.slots.some((s) => s.fieldRef === fieldRef))
      const targetRowIndex = rows.findIndex((r) => `row-${r.id}` === overIdStr)
      if (sourceRowIndex === targetRowIndex || targetRowIndex < 0) return
      if (rows[targetRowIndex].slots.length >= 2) return

      const next = rows.map((row, idx) => {
        if (idx === sourceRowIndex) {
          return { ...row, slots: row.slots.filter((s) => s.fieldRef !== fieldRef) }
        }
        if (idx === targetRowIndex) {
          return { ...row, slots: [...row.slots, { fieldRef, width: 'half' as const }] }
        }
        return row
      })
      onChange({ rows: ensureLockedFields(next) })
    }

    if (activeIdStr.startsWith('slot-') && overIdStr.startsWith('slot-')) {
      // Reorder within same row only for now
      const fieldRef = activeIdStr.replace('slot-', '')
      const rowIndex = rows.findIndex((r) => r.slots.some((s) => s.fieldRef === fieldRef))
      if (rowIndex < 0) return
      const slots = rows[rowIndex].slots
      const oldIndex = slots.findIndex((s) => s.fieldRef === fieldRef)
      const newIndex = slots.findIndex((s) => `slot-${s.fieldRef}` === overIdStr)
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        const next = rows.map((row, idx) =>
          idx === rowIndex ? { ...row, slots: arrayMove(slots, oldIndex, newIndex) } : row,
        )
        onChange({ rows: next })
      }
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="surface p-4">
          <div className="mb-3 text-sm font-semibold">Field Palette</div>
          <div className="space-y-2">
            {paletteFields.length === 0 && (
              <div className="text-sm text-[color:var(--text-muted)]">All fields are already in the layout.</div>
            )}
            {paletteFields.map((field) => (
              <PaletteField key={field.key} field={field} onClick={() => handleAddFieldFromPalette(field.key)} />
            ))}
          </div>
        </div>

        <div className="surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold">Form Layout</div>
            <button type="button" className="primary-button" onClick={handleAddRow}>
              <Plus className="h-4 w-4" />
              Add Row
            </button>
          </div>

          <SortableContext items={rows.map((r) => `row-${r.id}`)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {rows.map((row, idx) => (
                <SortableRow
                  key={row.id}
                  row={row}
                  index={idx}
                  rowCount={rows.length}
                  customFieldDefs={customFieldDefs}
                  isDropTarget={activeDropRowId === row.id}
                  paletteFields={paletteFields}
                  onToggleSlotWidth={(slotIdx) => handleToggleSlotWidth(idx, slotIdx)}
                  onRemoveSlot={(slotIdx) => handleRemoveSlot(idx, slotIdx)}
                  onMoveRowUp={() => handleMoveRow(idx, -1)}
                  onMoveRowDown={() => handleMoveRow(idx, 1)}
                  onMoveSlotLeft={(slotIdx) => handleMoveSlot(idx, slotIdx, -1)}
                  onMoveSlotRight={(slotIdx) => handleMoveSlot(idx, slotIdx, 1)}
                  onRemoveRow={() => handleRemoveRow(idx)}
                  onAddField={(fieldRef) => handleAddFieldToRow(idx, fieldRef)}
                />
              ))}
            </div>
          </SortableContext>

          {rows.length === 0 && (
            <div className="rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-8 text-center text-sm text-[color:var(--text-muted)]">
              No rows yet. Click "Add Row" and drag fields from the palette.
            </div>
          )}
        </div>
      </div>
    </DndContext>
  )
}
