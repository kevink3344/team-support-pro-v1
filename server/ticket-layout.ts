import crypto from 'node:crypto'

import { getDb, dbAll, dbGet, dbRun } from './db.js'

export type CustomFieldType = 'text' | 'select' | 'checkbox' | 'number' | 'date'

export type BuiltInFieldKey =
  | 'title'
  | 'requestorName'
  | 'requestorEmail'
  | 'categoryId'
  | 'priority'
  | 'assignedToId'
  | 'location'
  | 'description'
  | 'status'

export type LayoutSlotWidth = 'full' | 'half'

export interface TicketLayoutSlot {
  fieldRef: BuiltInFieldKey | string
  width: LayoutSlotWidth
}

export interface TicketLayoutRow {
  id: string
  slots: TicketLayoutSlot[]
}

export interface TicketLayout {
  rows: TicketLayoutRow[]
}

export interface TicketLayoutVersion {
  id: string
  organizationId: string
  versionNumber: number
  layout: TicketLayout
  description: string
  createdAt: string
}

const LOCKED_BUILT_INS: BuiltInFieldKey[] = ['title', 'requestorName', 'requestorEmail']

const isBuiltInFieldKey = (value: unknown): value is BuiltInFieldKey =>
  typeof value === 'string' &&
  [
    'title',
    'requestorName',
    'requestorEmail',
    'categoryId',
    'priority',
    'assignedToId',
    'location',
    'description',
    'status',
  ].includes(value)

const normalizeLayout = (
  layout: unknown,
  customFieldIds: Set<string>,
): { layout: TicketLayout; errors: string[] } => {
  const errors: string[] = []
  const rows: TicketLayoutRow[] = []

  const candidate = typeof layout === 'object' && layout !== null ? (layout as { rows?: unknown }) : { rows: [] }
  const rowArray = Array.isArray(candidate.rows) ? candidate.rows : []

  const seenFieldRefs = new Set<string>()

  for (const row of rowArray) {
    if (typeof row !== 'object' || row === null || !Array.isArray((row as { slots?: unknown }).slots)) {
      continue
    }
    const rowId = typeof (row as { id?: unknown }).id === 'string' ? ((row as { id: string }).id) : `row-${crypto.randomUUID()}`
    const slots: TicketLayoutSlot[] = []

    for (const slot of (row as { slots: unknown[] }).slots) {
      if (typeof slot !== 'object' || slot === null) continue
      const fieldRefRaw = (slot as { fieldRef?: unknown }).fieldRef
      const fieldRef = isBuiltInFieldKey(fieldRefRaw) || (typeof fieldRefRaw === 'string' && customFieldIds.has(fieldRefRaw))
        ? String(fieldRefRaw)
        : null
      if (fieldRef === null) {
        if (typeof fieldRefRaw === 'string') errors.push(`Unknown field reference removed: ${fieldRefRaw}`)
        continue
      }
      if (seenFieldRefs.has(fieldRef)) {
        errors.push(`Duplicate field reference removed: ${fieldRef}`)
        continue
      }
      seenFieldRefs.add(fieldRef)

      const width = (slot as { width?: unknown }).width === 'half' ? 'half' : 'full'
      slots.push({ fieldRef, width })
    }

    // Cap each row at two half-width slots or one full-width slot.
    // Empty rows are preserved so the layout editor can use them as containers.
    if (slots.some((s) => s.width === 'full') && slots.length > 1) {
      errors.push('Row with a full-width slot can only contain one slot; trimmed.')
      rows.push({ id: rowId, slots: [slots[0]] })
    } else if (slots.filter((s) => s.width === 'half').length > 2) {
      errors.push('Row can contain at most two half-width slots; trimmed.')
      rows.push({ id: rowId, slots: slots.slice(0, 2) })
    } else {
      rows.push({ id: rowId, slots })
    }
  }

  // Ensure locked built-ins are present
  for (const key of LOCKED_BUILT_INS) {
    if (!seenFieldRefs.has(key)) {
      rows.unshift({ id: `row-locked-${key}`, slots: [{ fieldRef: key, width: 'full' }] })
      errors.push(`Required field ${key} was missing and has been added.`)
    }
  }

  return { layout: { rows }, errors }
}

export const getTicketLayout = async (organizationId: string): Promise<TicketLayout> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT LayoutJson FROM TicketLayouts WHERE OrganizationId = ?', [organizationId])
  if (!row?.LayoutJson) {
    return { rows: [
      { id: 'row-default-1', slots: [{ fieldRef: 'title', width: 'full' }] },
      { id: 'row-default-2', slots: [{ fieldRef: 'requestorName', width: 'half' }, { fieldRef: 'requestorEmail', width: 'half' }] },
      { id: 'row-default-3', slots: [{ fieldRef: 'categoryId', width: 'half' }, { fieldRef: 'priority', width: 'half' }] },
      { id: 'row-default-4', slots: [{ fieldRef: 'assignedToId', width: 'half' }, { fieldRef: 'location', width: 'half' }] },
      { id: 'row-default-5', slots: [{ fieldRef: 'description', width: 'full' }] },
    ] }
  }
  const customFieldRows = await dbAll(db, 'SELECT Id AS id FROM TicketFieldDefinitions WHERE OrganizationId = ?', [organizationId])
  const customFieldIds = new Set(customFieldRows.map((r) => String(r.id)))
  const parsed = (() => {
    try {
      return JSON.parse(String(row.LayoutJson))
    } catch {
      return { rows: [] }
    }
  })()
  const { layout } = normalizeLayout(parsed, customFieldIds)
  return layout
}

const createLayoutVersion = async (db: ReturnType<typeof getDb>, organizationId: string, description?: string): Promise<number> => {
  const row = await dbGet(db, 'SELECT LayoutJson FROM TicketLayouts WHERE OrganizationId = ?', [organizationId])
  if (!row) return 0

  const nextRow = await dbGet(
    db,
    'SELECT COALESCE(MAX(VersionNumber), 0) + 1 AS nextVersion FROM TicketLayoutVersions WHERE OrganizationId = ?',
    [organizationId],
  )
  const versionNumber = Number(nextRow?.nextVersion ?? 1)
  const versionId = `tlv-${crypto.randomUUID()}`

  await db.execute({
    sql: `INSERT INTO TicketLayoutVersions (Id, OrganizationId, VersionNumber, LayoutJson, Description)
          VALUES (?, ?, ?, ?, ?)`,
    args: [versionId, organizationId, versionNumber, String(row.LayoutJson), description ?? ''],
  })

  return versionNumber
}

export const saveTicketLayout = async (
  organizationId: string,
  layout: TicketLayout,
  description?: string,
): Promise<{ layout: TicketLayout; errors: string[] }> => {
  const db = getDb()
  const customFieldRows = await dbAll(db, 'SELECT Id AS id FROM TicketFieldDefinitions WHERE OrganizationId = ?', [organizationId])
  const customFieldIds = new Set(customFieldRows.map((r) => String(r.id)))
  const { layout: normalized, errors } = normalizeLayout(layout, customFieldIds)

  await createLayoutVersion(db, organizationId, description)

  await db.execute({
    sql: `INSERT INTO TicketLayouts (Id, OrganizationId, LayoutJson)
          VALUES (?, ?, ?)
          ON CONFLICT(OrganizationId) DO UPDATE SET
            LayoutJson = excluded.LayoutJson, UpdatedAt = datetime('now')`,
    args: [`layout-${organizationId}`, organizationId, JSON.stringify(normalized)],
  })

  return { layout: normalized, errors }
}

const parseCreatedAt = (value: unknown): string => {
  if (typeof value === 'string' && value) {
    const direct = new Date(value)
    if (!Number.isNaN(direct.getTime())) return direct.toISOString()
    // SQL Server nvarchar(getdate()) produces "Aug 21 2026  1:51PM" which
    // Node's Date cannot parse directly (missing space before AM/PM and
    // double-space). Normalize and retry.
    const normalized = value.replace(/(\d)(AM|PM)/i, '$1 $2').replace(/\s+/g, ' ').trim()
    const retry = new Date(normalized)
    if (!Number.isNaN(retry.getTime())) return retry.toISOString()
  }
  if (value instanceof Date && !Number.isNaN((value as Date).getTime())) return (value as Date).toISOString()
  return new Date().toISOString()
}

const mapLayoutVersion = (record: Record<string, unknown>): TicketLayoutVersion => {
  const parsed = (() => {
    try {
      return JSON.parse(String(record.layoutJson))
    } catch {
      return { rows: [] }
    }
  })()
  return {
    id: String(record.id),
    organizationId: String(record.organizationId),
    versionNumber: Number(record.versionNumber),
    layout: parsed as TicketLayout,
    description: typeof record.description === 'string' ? record.description : '',
    createdAt: parseCreatedAt(record.createdAt),
  }
}

export const listTicketLayoutVersions = async (organizationId: string): Promise<TicketLayoutVersion[]> => {
  const db = getDb()
  const rows = await dbAll(
    db,
    'SELECT Id AS id, OrganizationId AS organizationId, VersionNumber AS versionNumber, LayoutJson AS layoutJson, Description AS description, CreatedAt AS createdAt FROM TicketLayoutVersions WHERE OrganizationId = ? ORDER BY VersionNumber DESC',
    [organizationId],
  ) as Array<Record<string, unknown>>
  return rows.map(mapLayoutVersion)
}

export const revertTicketLayoutToVersion = async (
  organizationId: string,
  versionId: string,
): Promise<TicketLayoutVersion | null> => {
  const db = getDb()
  const versionRow = await dbGet(
    db,
    'SELECT Id AS id, OrganizationId AS organizationId, VersionNumber AS versionNumber, LayoutJson AS layoutJson, Description AS description, CreatedAt AS createdAt FROM TicketLayoutVersions WHERE Id = ? AND OrganizationId = ?',
    [versionId, organizationId],
  ) as Record<string, unknown> | undefined
  if (!versionRow) return null

  const targetVersion = mapLayoutVersion(versionRow)

  await createLayoutVersion(db, organizationId, `Reverted to version ${targetVersion.versionNumber}`)

  await db.execute({
    sql: `INSERT INTO TicketLayouts (Id, OrganizationId, LayoutJson)
          VALUES (?, ?, ?)
          ON CONFLICT(OrganizationId) DO UPDATE SET
            LayoutJson = excluded.LayoutJson, UpdatedAt = datetime('now')`,
    args: [`layout-${organizationId}`, organizationId, JSON.stringify(targetVersion.layout)],
  })

  return targetVersion
}

export const deleteTicketLayoutVersion = async (organizationId: string, versionId: string): Promise<boolean> => {
  const db = getDb()
  const result = await dbRun(
    db,
    'DELETE FROM TicketLayoutVersions WHERE Id = ? AND OrganizationId = ?',
    [versionId, organizationId],
  )
  return result.rowsAffected > 0
}