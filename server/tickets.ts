import crypto from 'node:crypto'

import { getDb, dbGet, dbAll, dbRun, type Client } from './db.js'

const ticketStatusValues = new Set(['Open', 'In Progress', 'Pending', 'Resolved', 'Closed'])
const ticketPriorityValues = new Set(['Low', 'Medium', 'High', 'Critical'])

export interface TicketCustomFieldValue {
  id: string
  ticketId: string
  fieldId: string
  fieldLabel: string
  fieldType: string
  value: string
}

export interface TicketRecord {
  id: string
  title: string
  description: string
  status: string
  priority: string
  teamId: string
  categoryId: string
  attachmentCount: number
  assignedToId: string | null
  requestorName: string
  requestorEmail: string
  location: string
  dueLabel: string
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  activity: TicketActivityRecord[]
  customFields: TicketCustomFieldValue[]
}

export interface CreateTicketCustomFieldInput {
  fieldId: string
  value: string
}

export interface CreateTicketInput {
  id?: string
  title: string
  description: string
  status: string
  priority: string
  teamId: string
  categoryId: string
  assignedToId: string | null
  requestorName: string
  requestorEmail: string
  location: string
  customFields?: CreateTicketCustomFieldInput[]
}

export interface TicketActivityRecord {
  id: string
  ticketId: string
  actor: string
  message: string
  at: string
}

export interface UpdateTicketInput {
  teamId: string
  title: string
  description: string
  status: string
  priority: string
  categoryId: string
  assignedToId: string | null
  requestorName: string
  requestorEmail: string
  location: string
}

export interface TicketVersion {
  id: string
  ticketId: string
  versionNumber: number
  title: string
  description: string
  status: string
  priority: string
  teamId: string
  categoryId: string
  assignedToId: string | null
  requestorName: string
  requestorEmail: string
  location: string
  dueLabel: string
  createdAt: string
  customFields: TicketCustomFieldValue[]
}

const mapActivityRecord = (record: Record<string, unknown>): TicketActivityRecord => ({
  id: String(record.id),
  ticketId: String(record.ticketId),
  actor: String(record.actor),
  message: String(record.message),
  at: new Date(String(record.activityAt)).toISOString(),
})

const mapTicketRecord = (record: Record<string, unknown>): Omit<TicketRecord, 'activity' | 'customFields'> => ({
  id: String(record.id),
  title: String(record.title),
  description: String(record.description),
  status: String(record.status),
  priority: String(record.priority),
  teamId: String(record.teamId),
  categoryId: String(record.categoryId),
  attachmentCount: Number(record.attachmentCount) || 0,
  assignedToId: typeof record.assignedToId === 'string' ? record.assignedToId : null,
  requestorName: String(record.requestorName),
  requestorEmail: String(record.requestorEmail),
  location: String(record.location),
  dueLabel: String(record.dueLabel),
  createdAt: new Date(String(record.createdAt)).toISOString(),
  updatedAt: new Date(String(record.updatedAt)).toISOString(),
  resolvedAt: typeof record.resolvedAt === 'string' ? new Date(record.resolvedAt).toISOString() : null,
})

const groupTicketsWithActivity = (
  tickets: Array<Omit<TicketRecord, 'activity' | 'customFields'>>,
  activity: TicketActivityRecord[],
  customFieldsByTicket: Map<string, TicketCustomFieldValue[]>,
): TicketRecord[] => {
  const activityByTicket = new Map<string, TicketActivityRecord[]>()
  activity.forEach((entry) => {
    const current = activityByTicket.get(entry.ticketId) ?? []
    current.push(entry)
    activityByTicket.set(entry.ticketId, current)
  })
  return tickets.map((ticket) => ({
    ...ticket,
    activity: (activityByTicket.get(ticket.id) ?? []).sort(
      (left, right) => new Date(left.at).getTime() - new Date(right.at).getTime(),
    ),
    customFields: customFieldsByTicket.get(ticket.id) ?? [],
  }))
}

const generateTicketId = () => `TKT-${Math.floor(10000 + Math.random() * 89999)}`
const isNonEmpty = (value: string) => value.trim().length > 0

const validateCreateTicketInput = (input: CreateTicketInput) => {
  if (!isNonEmpty(input.title) || !isNonEmpty(input.description) || !isNonEmpty(input.teamId) || !isNonEmpty(input.categoryId) || !isNonEmpty(input.requestorName) || !isNonEmpty(input.requestorEmail)) return false
  return ticketStatusValues.has(input.status) && ticketPriorityValues.has(input.priority)
}

const validateUpdateTicketInput = (input: UpdateTicketInput) => {
  if (!input.title.trim() || !input.description.trim() || !input.categoryId.trim() || !input.requestorName.trim() || !input.requestorEmail.trim()) return false
  return ticketStatusValues.has(input.status) && ticketPriorityValues.has(input.priority)
}

export const ticketBelongsToTeam = async (ticketId: string, teamId: string) => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT 1 AS allowed FROM Tickets WHERE Id = ? AND TeamId = ?', [ticketId, teamId])
  return !!row
}

/** Ticket is on a team that belongs to the given organization. */
export const ticketBelongsToOrganization = async (ticketId: string, organizationId: string) => {
  const db = getDb()
  const row = await dbGet(
    db,
    'SELECT 1 AS allowed FROM Tickets t JOIN Teams tm ON tm.Id = t.TeamId WHERE t.Id = ? AND tm.OrganizationId = ?',
    [ticketId, organizationId],
  )
  return !!row
}

export interface TicketScopeUser {
  teamId: string
  organizationId: string
  canViewAllOrgTickets: boolean
}

/**
 * User may access the ticket if it belongs to their own team, or — when the
 * user has org-wide access — any team within their organization.
 */
export const userCanAccessTicket = async (ticketId: string, user: TicketScopeUser): Promise<boolean> => {
  if (user.canViewAllOrgTickets) return ticketBelongsToOrganization(ticketId, user.organizationId)
  return ticketBelongsToTeam(ticketId, user.teamId)
}

/**
 * User may create/update tickets for teamId if it is their own team, or —
 * when the user has org-wide access — any team within their organization.
 */
export const userCanUseTeam = async (teamId: string, user: TicketScopeUser): Promise<boolean> => {
  if (teamId === user.teamId) return true
  if (!user.canViewAllOrgTickets) return false
  const db = getDb()
  const row = await dbGet(db, 'SELECT 1 AS allowed FROM Teams WHERE Id = ? AND OrganizationId = ?', [teamId, user.organizationId])
  return !!row
}

export const listTicketActivity = async (): Promise<TicketActivityRecord[]> => {
  const db = getDb()
  const rows = await dbAll(db, 'SELECT Id AS id, TicketId AS ticketId, Actor AS actor, Message AS message, ActivityAt AS activityAt FROM TicketActivity')
  return rows.map(mapActivityRecord)
}

export interface TicketListScope {
  teamId?: string
  organizationId?: string
}

export const listTickets = async (scope: string | TicketListScope | undefined): Promise<TicketRecord[]> => {
  const normalizedScope: TicketListScope = typeof scope === 'string' ? { teamId: scope } : scope ?? {}
  const { teamId, organizationId } = normalizedScope

  const db = getDb()
  const whereSql = organizationId
    ? ' WHERE TeamId IN (SELECT Id FROM Teams WHERE OrganizationId = ?)'
    : teamId
      ? ' WHERE TeamId = ?'
      : ''
  const whereArgs = organizationId ? [organizationId] : teamId ? [teamId] : []

  const ticketSql = `SELECT Id AS id, Title AS title, Description AS description, Status AS status, Priority AS priority, TeamId AS teamId, CategoryId AS categoryId, AssignedToId AS assignedToId, RequestorName AS requestorName, RequestorEmail AS requestorEmail, Location AS location, DueLabel AS dueLabel, CreatedAt AS createdAt, UpdatedAt AS updatedAt, ResolvedAt AS resolvedAt, (SELECT COUNT(1) FROM TicketAttachments ta WHERE ta.TicketId = Tickets.Id AND ta.IsDeleted = 0) AS attachmentCount FROM Tickets${whereSql} ORDER BY UpdatedAt DESC, CreatedAt DESC`
  const ticketRows = await dbAll(db, ticketSql, whereArgs)
  const tickets = ticketRows.map(mapTicketRecord)
  const allActivity = await listTicketActivity()
  const ticketIds = new Set(tickets.map((t) => t.id))

  const cfSql = `SELECT Id AS id, TicketId AS ticketId, FieldId AS fieldId, FieldLabel AS fieldLabel, FieldType AS fieldType, Value AS value FROM TicketCustomFieldValues WHERE TicketId IN (SELECT Id FROM Tickets${whereSql}) ORDER BY rowid ASC`
  const cfRows = await dbAll(db, cfSql, whereArgs) as Array<{ id: unknown; ticketId: unknown; fieldId: unknown; fieldLabel: unknown; fieldType: unknown; value: unknown }>

  const customFieldsByTicket = new Map<string, TicketCustomFieldValue[]>()
  for (const row of cfRows) {
    const ticketId = String(row.ticketId)
    const current = customFieldsByTicket.get(ticketId) ?? []
    current.push({ id: String(row.id), ticketId, fieldId: String(row.fieldId), fieldLabel: String(row.fieldLabel), fieldType: String(row.fieldType), value: String(row.value) })
    customFieldsByTicket.set(ticketId, current)
  }

  return groupTicketsWithActivity(tickets, allActivity.filter((a) => ticketIds.has(a.ticketId)), customFieldsByTicket)
}

const getCustomFieldValues = async (db: Client, ticketId: string): Promise<TicketCustomFieldValue[]> => {
  const rows = await dbAll(db, 'SELECT Id AS id, TicketId AS ticketId, FieldId AS fieldId, FieldLabel AS fieldLabel, FieldType AS fieldType, Value AS value FROM TicketCustomFieldValues WHERE TicketId = ? ORDER BY rowid ASC', [ticketId]) as Array<{ id: unknown; ticketId: unknown; fieldId: unknown; fieldLabel: unknown; fieldType: unknown; value: unknown }>
  return rows.map((row) => ({ id: String(row.id), ticketId: String(row.ticketId), fieldId: String(row.fieldId), fieldLabel: String(row.fieldLabel), fieldType: String(row.fieldType), value: String(row.value) }))
}

export const getTicketById = async (ticketId: string): Promise<TicketRecord | null> => {
  const db = getDb()
  const row = await dbGet(db, `SELECT Id AS id, Title AS title, Description AS description, Status AS status, Priority AS priority, TeamId AS teamId, CategoryId AS categoryId, AssignedToId AS assignedToId, RequestorName AS requestorName, RequestorEmail AS requestorEmail, Location AS location, DueLabel AS dueLabel, CreatedAt AS createdAt, UpdatedAt AS updatedAt, ResolvedAt AS resolvedAt, (SELECT COUNT(1) FROM TicketAttachments ta WHERE ta.TicketId = Tickets.Id AND ta.IsDeleted = 0) AS attachmentCount FROM Tickets WHERE Id = ?`, [ticketId])
  if (!row) return null
  const ticket = mapTicketRecord(row)
  const activityRows = await dbAll(db, 'SELECT Id AS id, TicketId AS ticketId, Actor AS actor, Message AS message, ActivityAt AS activityAt FROM TicketActivity WHERE TicketId = ? ORDER BY ActivityAt ASC', [ticketId])
  const customFields = await getCustomFieldValues(db, ticketId)
  return { ...ticket, activity: activityRows.map(mapActivityRecord), customFields }
}

export const createTicketComment = async (input: { ticketId: string; actor: string; message: string }): Promise<TicketActivityRecord> => {
  const db = getDb()
  const activityAt = new Date().toISOString()
  const id = `comment-${crypto.randomUUID()}`
  await db.batch([
    { sql: 'INSERT INTO TicketActivity (Id, TicketId, Actor, Message, ActivityAt) VALUES (?, ?, ?, ?, ?)', args: [id, input.ticketId, input.actor, input.message, activityAt] },
    { sql: 'UPDATE Tickets SET UpdatedAt = ? WHERE Id = ?', args: [activityAt, input.ticketId] },
  ], 'write')
  return { id, ticketId: input.ticketId, actor: input.actor, message: input.message, at: activityAt }
}

export const updateTicket = async (ticketId: string, input: UpdateTicketInput, actor: string): Promise<TicketRecord | null> => {
  if (!validateUpdateTicketInput(input)) return null
  const existing = await getTicketById(ticketId)
  if (!existing) return null
  const db = getDb()
  await createTicketVersion(db, ticketId)
  const activityAt = new Date().toISOString()
  const changeMessages: string[] = []

  if (existing.status !== input.status) changeMessages.push(`Changed status from ${existing.status} to ${input.status}.`)
  if (existing.priority !== input.priority) changeMessages.push(`Changed priority from ${existing.priority} to ${input.priority}.`)
  if (existing.teamId !== input.teamId) {
    const [fromTeam, toTeam] = await Promise.all([
      dbGet(db, 'SELECT Name FROM Teams WHERE Id = ?', [existing.teamId]),
      dbGet(db, 'SELECT Name FROM Teams WHERE Id = ?', [input.teamId]),
    ])
    const fromName = typeof fromTeam?.Name === 'string' ? fromTeam.Name.trim() : 'Unknown'
    const toName = typeof toTeam?.Name === 'string' ? toTeam.Name.trim() : 'Unknown'
    changeMessages.push(`Transferred ticket from ${fromName} to ${toName}.`)
  }
  if (existing.assignedToId !== input.assignedToId) {
    const getName = async (id: string | null) => {
      if (!id) return 'Unassigned'
      const r = await dbGet(db, 'SELECT Name FROM Users WHERE Id = ?', [id])
      return typeof r?.Name === 'string' && r.Name.trim() ? r.Name.trim() : 'Unknown'
    }
    const [fromName, toName] = await Promise.all([getName(existing.assignedToId), getName(input.assignedToId)])
    changeMessages.push(`Reassigned ticket from ${fromName} to ${toName}.`)
  }
  if (existing.categoryId !== input.categoryId) {
    const [fromCat, toCat] = await Promise.all([
      dbGet(db, 'SELECT Name FROM Categories WHERE Id = ?', [existing.categoryId]),
      dbGet(db, 'SELECT Name FROM Categories WHERE Id = ?', [input.categoryId]),
    ])
    const fromName = typeof fromCat?.Name === 'string' ? fromCat.Name.trim() : 'Unknown'
    const toName = typeof toCat?.Name === 'string' ? toCat.Name.trim() : 'Unknown'
    changeMessages.push(`Updated category from ${fromName} to ${toName}.`)
  }
  if (existing.title !== input.title) changeMessages.push('Updated ticket title.')
  if (existing.description !== input.description) changeMessages.push('Updated ticket description.')
  if (existing.location !== input.location) changeMessages.push('Updated ticket location.')
  if (existing.requestorName !== input.requestorName) changeMessages.push('Updated requester name.')
  if (existing.requestorEmail !== input.requestorEmail.trim().toLowerCase()) changeMessages.push('Updated requester email.')

  const resolvedStatuses = new Set(['Resolved', 'Closed'])
  const newResolvedAt = resolvedStatuses.has(input.status) ? (existing.resolvedAt ?? activityAt) : null

  const statements = [
    {
      sql: 'UPDATE Tickets SET Title = ?, Description = ?, Status = ?, Priority = ?, TeamId = ?, CategoryId = ?, AssignedToId = ?, RequestorName = ?, RequestorEmail = ?, Location = ?, UpdatedAt = ?, ResolvedAt = ? WHERE Id = ?',
      args: [input.title.trim(), input.description.trim(), input.status, input.priority, input.teamId, input.categoryId, input.assignedToId, input.requestorName.trim(), input.requestorEmail.trim().toLowerCase(), input.location.trim() || 'Not specified', activityAt, newResolvedAt, ticketId],
    },
    ...changeMessages.map((msg) => ({
      sql: 'INSERT INTO TicketActivity (Id, TicketId, Actor, Message, ActivityAt) VALUES (?, ?, ?, ?, ?)',
      args: [`activity-${crypto.randomUUID()}`, ticketId, actor, msg, activityAt],
    })),
  ]
  await db.batch(statements, 'write')
  return getTicketById(ticketId)
}

export const createTicket = async (input: CreateTicketInput, actor: string): Promise<TicketRecord | null> => {
  if (!validateCreateTicketInput(input)) return null
  const db = getDb()
  const catRow = await dbGet(db, 'SELECT TeamId FROM Categories WHERE Id = ?', [input.categoryId])
  if (!catRow?.TeamId || catRow.TeamId !== input.teamId) return null
  if (input.assignedToId) {
    const userRow = await dbGet(db, 'SELECT TeamId FROM Users WHERE Id = ?', [input.assignedToId])
    if (!userRow?.TeamId || userRow.TeamId !== input.teamId) return null
  }
  let ticketId = input.id?.trim() || generateTicketId()
  while (await getTicketById(ticketId)) ticketId = generateTicketId()
  const createdAt = new Date().toISOString()

  type FieldDefRow = { id: unknown; fieldType: unknown; label: unknown; isRequired: unknown }
  const catTeamRow = await dbGet(db, 'SELECT TeamId, (SELECT OrganizationId FROM Teams WHERE Teams.Id = Categories.TeamId) AS organizationId FROM Categories WHERE Id = ?', [input.categoryId])
  const organizationId = catTeamRow?.organizationId ? String(catTeamRow.organizationId) : ''
  const fieldDefs = await dbAll(db, 'SELECT Id AS id, FieldType AS fieldType, Label AS label, IsRequired AS isRequired FROM TicketFieldDefinitions WHERE OrganizationId = ?', [organizationId]) as FieldDefRow[]
  const fieldDefMap = new Map(fieldDefs.map((f) => [String(f.id), f]))

  const customFieldInserts: Array<{ id: string; fieldId: string; fieldLabel: string; fieldType: string; value: string }> = []
  if (Array.isArray(input.customFields)) {
    for (const cf of input.customFields) {
      const def = fieldDefMap.get(cf.fieldId)
      if (!def) continue
      customFieldInserts.push({
        id: `tcfv-${crypto.randomUUID()}`,
        fieldId: String(def.id),
        fieldLabel: String(def.label),
        fieldType: String(def.fieldType),
        value: String(cf.value ?? ''),
      })
    }
  }

  const statements = [
    {
      sql: `INSERT INTO Tickets (Id, Title, Description, Status, Priority, TeamId, CategoryId, AssignedToId, RequestorName, RequestorEmail, Location, DueLabel, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New in queue', ?, ?)`,
      args: [ticketId, input.title.trim(), input.description.trim(), input.status, input.priority, input.teamId, input.categoryId, input.assignedToId, input.requestorName.trim(), input.requestorEmail.trim().toLowerCase(), input.location.trim() || 'Not specified', createdAt, createdAt],
    },
    {
      sql: 'INSERT INTO TicketActivity (Id, TicketId, Actor, Message, ActivityAt) VALUES (?, ?, ?, ?, ?)',
      args: [`activity-${crypto.randomUUID()}`, ticketId, actor, 'Ticket created from TeamSupportPro.', createdAt],
    },
    ...customFieldInserts.map((cf) => ({
      sql: 'INSERT INTO TicketCustomFieldValues (Id, TicketId, FieldId, FieldLabel, FieldType, Value) VALUES (?, ?, ?, ?, ?, ?)',
      args: [cf.id, ticketId, cf.fieldId, cf.fieldLabel, cf.fieldType, cf.value],
    })),
  ]
  await db.batch(statements, 'write')
  await createTicketVersion(db, ticketId)
  return getTicketById(ticketId)
}

export const deleteTicket = async (ticketId: string): Promise<boolean> => {
  if (!isNonEmpty(ticketId)) return false
  const db = getDb()
  await db.batch([
    { sql: 'DELETE FROM TicketWatchers WHERE TicketId = ?', args: [ticketId] },
    { sql: 'DELETE FROM TicketAttachments WHERE TicketId = ?', args: [ticketId] },
    { sql: 'DELETE FROM TicketActivity WHERE TicketId = ?', args: [ticketId] },
    { sql: 'DELETE FROM TicketCustomFieldValues WHERE TicketId = ?', args: [ticketId] },
    { sql: 'DELETE FROM Tickets WHERE Id = ?', args: [ticketId] },
  ], 'write')
  return true
}

export interface TicketWatcher {
  userId: string
  name: string
  email: string
  addedAt: string
}

export const listTicketWatchers = async (ticketId: string): Promise<TicketWatcher[]> => {
  const db = getDb()
  const rows = await dbAll(db, `
    SELECT u.Id AS userId, u.Name AS name, u.Email AS email, tw.AddedAt AS addedAt
    FROM TicketWatchers tw
    JOIN Users u ON tw.UserId = u.Id
    WHERE tw.TicketId = ?
    ORDER BY tw.AddedAt ASC
  `, [ticketId]) as Array<{ userId: unknown; name: unknown; email: unknown; addedAt: unknown }>
  return rows.map((r) => ({ userId: String(r.userId), name: String(r.name), email: String(r.email), addedAt: String(r.addedAt) }))
}

export const addTicketWatcher = async (ticketId: string, userId: string): Promise<boolean> => {
  const db = getDb()
  try {
    await dbRun(db, "INSERT OR IGNORE INTO TicketWatchers (TicketId, UserId, AddedAt) VALUES (?, ?, datetime('now'))", [ticketId, userId])
    return true
  } catch {
    return false
  }
}

export const removeTicketWatcher = async (ticketId: string, userId: string): Promise<boolean> => {
  const db = getDb()
  const result = await dbRun(db, 'DELETE FROM TicketWatchers WHERE TicketId = ? AND UserId = ?', [ticketId, userId])
  return result.rowsAffected > 0
}

export const listWatchedTicketIds = async (userId: string): Promise<string[]> => {
  const db = getDb()
  const rows = await dbAll(db, 'SELECT TicketId AS ticketId FROM TicketWatchers WHERE UserId = ?', [userId]) as Array<{ ticketId: unknown }>
  return rows.map((r) => String(r.ticketId))
}

export const upsertCustomFieldValues = async (
  ticketId: string,
  organizationId: string,
  fields: { fieldId: string; value: string }[],
): Promise<void> => {
  if (!fields.length) return
  const db = getDb()
  const defs = await dbAll(db, 'SELECT Id, Label, FieldType FROM TicketFieldDefinitions WHERE OrganizationId = ?', [organizationId]) as Array<{ Id: unknown; Label: unknown; FieldType: unknown }>
  const defMap = new Map(defs.map((d) => [String(d.Id), d]))
  const validFields = fields.filter((f) => defMap.has(f.fieldId))
  if (!validFields.length) return

  const statements: Array<{ sql: string; args: unknown[] }> = []
  for (const f of validFields) {
    const def = defMap.get(f.fieldId)!
    statements.push({ sql: 'DELETE FROM TicketCustomFieldValues WHERE TicketId = ? AND FieldId = ?', args: [ticketId, f.fieldId] })
    statements.push({
      sql: `INSERT INTO TicketCustomFieldValues (Id, TicketId, FieldId, FieldLabel, FieldType, Value, CreatedAt) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [`tcfv-${crypto.randomUUID()}`, ticketId, f.fieldId, String(def.Label), String(def.FieldType), f.value],
    })
  }
  await db.batch(statements as Array<{ sql: string; args: import('@libsql/client').InValue[] }>, 'write')
}

const getTicketVersionCustomFieldValues = async (db: Client, ticketVersionId: string): Promise<TicketCustomFieldValue[]> => {
  const rows = await dbAll(db, 'SELECT Id AS id, TicketVersionId AS ticketId, FieldId AS fieldId, FieldLabel AS fieldLabel, FieldType AS fieldType, Value AS value FROM TicketVersionCustomFieldValues WHERE TicketVersionId = ? ORDER BY rowid ASC', [ticketVersionId]) as Array<{ id: unknown; ticketId: unknown; fieldId: unknown; fieldLabel: unknown; fieldType: unknown; value: unknown }>
  return rows.map((row) => ({ id: String(row.id), ticketId: String(row.ticketId), fieldId: String(row.fieldId), fieldLabel: String(row.fieldLabel), fieldType: String(row.fieldType), value: String(row.value) }))
}

const mapTicketVersion = (record: Record<string, unknown>): Omit<TicketVersion, 'customFields'> => ({
  id: String(record.id),
  ticketId: String(record.ticketId),
  versionNumber: Number(record.versionNumber),
  title: String(record.title),
  description: String(record.description),
  status: String(record.status),
  priority: String(record.priority),
  teamId: String(record.teamId),
  categoryId: String(record.categoryId),
  assignedToId: typeof record.assignedToId === 'string' ? record.assignedToId : null,
  requestorName: String(record.requestorName),
  requestorEmail: String(record.requestorEmail),
  location: String(record.location),
  dueLabel: String(record.dueLabel),
  createdAt: new Date(String(record.createdAt)).toISOString(),
})

export const createTicketVersion = async (db: Client, ticketId: string): Promise<number> => {
  const ticketRow = await dbGet(db, `SELECT Id AS id, Title AS title, Description AS description, Status AS status, Priority AS priority, TeamId AS teamId, CategoryId AS categoryId, AssignedToId AS assignedToId, RequestorName AS requestorName, RequestorEmail AS requestorEmail, Location AS location, DueLabel AS dueLabel FROM Tickets WHERE Id = ?`, [ticketId])
  if (!ticketRow) throw new Error('ticket_not_found')

  const versionNumberRow = await dbGet(db, 'SELECT COALESCE(MAX(VersionNumber), 0) + 1 AS nextVersion FROM TicketVersions WHERE TicketId = ?', [ticketId])
  const versionNumber = Number(versionNumberRow?.nextVersion ?? 1)
  const versionId = `tv-${crypto.randomUUID()}`

  const customFields = await getCustomFieldValues(db, ticketId)

  const statements: Array<{ sql: string; args: import('@libsql/client').InValue[] }> = [
    {
      sql: `INSERT INTO TicketVersions (Id, TicketId, VersionNumber, Title, Description, Status, Priority, TeamId, CategoryId, AssignedToId, RequestorName, RequestorEmail, Location, DueLabel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        versionId,
        ticketId,
        versionNumber,
        String(ticketRow.title),
        String(ticketRow.description),
        String(ticketRow.status),
        String(ticketRow.priority),
        String(ticketRow.teamId),
        String(ticketRow.categoryId),
        typeof ticketRow.assignedToId === 'string' ? ticketRow.assignedToId : null,
        String(ticketRow.requestorName),
        String(ticketRow.requestorEmail),
        String(ticketRow.location),
        String(ticketRow.dueLabel),
      ],
    },
    ...customFields.map((cf) => ({
      sql: 'INSERT INTO TicketVersionCustomFieldValues (Id, TicketVersionId, FieldId, FieldLabel, FieldType, Value) VALUES (?, ?, ?, ?, ?, ?)',
      args: [`tvcfv-${crypto.randomUUID()}`, versionId, cf.fieldId, cf.fieldLabel, cf.fieldType, cf.value],
    })),
  ]

  await db.batch(statements, 'write')
  return versionNumber
}

export const listTicketVersions = async (ticketId: string): Promise<TicketVersion[]> => {
  const db = getDb()
  const rows = await dbAll(db, 'SELECT Id AS id, TicketId AS ticketId, VersionNumber AS versionNumber, Title AS title, Description AS description, Status AS status, Priority AS priority, TeamId AS teamId, CategoryId AS categoryId, AssignedToId AS assignedToId, RequestorName AS requestorName, RequestorEmail AS requestorEmail, Location AS location, DueLabel AS dueLabel, CreatedAt AS createdAt FROM TicketVersions WHERE TicketId = ? ORDER BY VersionNumber DESC', [ticketId]) as Array<Record<string, unknown>>
  const versions = rows.map(mapTicketVersion)

  const customFieldsByVersion = new Map<string, TicketCustomFieldValue[]>()
  if (versions.length) {
    const versionIds = versions.map((v) => v.id)
    const placeholders = versionIds.map(() => '?').join(',')
    const cfRows = await dbAll(db, `SELECT Id AS id, TicketVersionId AS ticketVersionId, FieldId AS fieldId, FieldLabel AS fieldLabel, FieldType AS fieldType, Value AS value FROM TicketVersionCustomFieldValues WHERE TicketVersionId IN (${placeholders}) ORDER BY rowid ASC`, versionIds) as Array<{ id: unknown; ticketVersionId: unknown; fieldId: unknown; fieldLabel: unknown; fieldType: unknown; value: unknown }>
    for (const row of cfRows) {
      const versionId = String(row.ticketVersionId)
      const current = customFieldsByVersion.get(versionId) ?? []
      current.push({ id: String(row.id), ticketId: String(row.ticketVersionId), fieldId: String(row.fieldId), fieldLabel: String(row.fieldLabel), fieldType: String(row.fieldType), value: String(row.value) })
      customFieldsByVersion.set(versionId, current)
    }
  }

  return versions.map((v) => ({ ...v, customFields: customFieldsByVersion.get(v.id) ?? [] }))
}

export const revertTicketToVersion = async (ticketId: string, versionId: string, actor: string): Promise<TicketRecord | null> => {
  const db = getDb()

  const versionRow = await dbGet(db, 'SELECT Id AS id, TicketId AS ticketId, VersionNumber AS versionNumber, Title AS title, Description AS description, Status AS status, Priority AS priority, TeamId AS teamId, CategoryId AS categoryId, AssignedToId AS assignedToId, RequestorName AS requestorName, RequestorEmail AS requestorEmail, Location AS location, DueLabel AS dueLabel FROM TicketVersions WHERE Id = ? AND TicketId = ?', [versionId, ticketId])
  if (!versionRow) return null

  const liveTicket = await getTicketById(ticketId)
  if (!liveTicket) return null

  const versionCustomFields = await getTicketVersionCustomFieldValues(db, String(versionRow.id))
  const activityAt = new Date().toISOString()

  const statements: Array<{ sql: string; args: import('@libsql/client').InValue[] }> = [
    // Snapshot current live state before reverting
    {
      sql: `INSERT INTO TicketVersions (Id, TicketId, VersionNumber, Title, Description, Status, Priority, TeamId, CategoryId, AssignedToId, RequestorName, RequestorEmail, Location, DueLabel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `tv-${crypto.randomUUID()}`,
        ticketId,
        Number(versionRow.versionNumber) + 1,
        liveTicket.title,
        liveTicket.description,
        liveTicket.status,
        liveTicket.priority,
        liveTicket.teamId,
        liveTicket.categoryId,
        liveTicket.assignedToId,
        liveTicket.requestorName,
        liveTicket.requestorEmail,
        liveTicket.location,
        liveTicket.dueLabel,
      ],
    },
    // Restore ticket fields from target version
    {
      sql: 'UPDATE Tickets SET Title = ?, Description = ?, Status = ?, Priority = ?, TeamId = ?, CategoryId = ?, AssignedToId = ?, RequestorName = ?, RequestorEmail = ?, Location = ?, UpdatedAt = ?, ResolvedAt = ? WHERE Id = ?',
      args: [String(versionRow.title), String(versionRow.description), String(versionRow.status), String(versionRow.priority), String(versionRow.teamId), String(versionRow.categoryId), typeof versionRow.assignedToId === 'string' ? versionRow.assignedToId : null, String(versionRow.requestorName), String(versionRow.requestorEmail), String(versionRow.location), activityAt, null, ticketId],
    },
    // Remove existing custom field values and restore from version
    {
      sql: 'DELETE FROM TicketCustomFieldValues WHERE TicketId = ?',
      args: [ticketId],
    },
    ...versionCustomFields.map((cf) => ({
      sql: 'INSERT INTO TicketCustomFieldValues (Id, TicketId, FieldId, FieldLabel, FieldType, Value) VALUES (?, ?, ?, ?, ?, ?)',
      args: [`tcfv-${crypto.randomUUID()}`, ticketId, cf.fieldId, cf.fieldLabel, cf.fieldType, cf.value],
    })),
    {
      sql: 'INSERT INTO TicketActivity (Id, TicketId, Actor, Message, ActivityAt) VALUES (?, ?, ?, ?, ?)',
      args: [`activity-${crypto.randomUUID()}`, ticketId, actor, `Reverted ticket to version ${String(versionRow.versionNumber)}.`, activityAt],
    },
  ]

  // Adjust the new version number for the pre-revert snapshot to be the actual next version
  const nextVersionRow = await dbGet(db, 'SELECT COALESCE(MAX(VersionNumber), 0) + 1 AS nextVersion FROM TicketVersions WHERE TicketId = ?', [ticketId])
  const snapshotVersionNumber = Number(nextVersionRow?.nextVersion ?? 1)
  statements[0].args[2] = snapshotVersionNumber

  await db.batch(statements, 'write')
  return getTicketById(ticketId)
}
