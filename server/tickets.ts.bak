import crypto from 'node:crypto'

import sql from 'mssql'

import { getPool, hasDatabaseConfig } from './db.js'

const ticketStatusValues = new Set(['Open', 'In Progress', 'Pending', 'Resolved', 'Closed'])
const ticketPriorityValues = new Set(['Low', 'Medium', 'High', 'Critical'])

export interface TicketRecord {
  id: string
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
  updatedAt: string
  activity: TicketActivityRecord[]
}

export interface CreateTicketInput {
  id?: string
  title: string
  description: string
  priority: string
  teamId: string
  categoryId: string
  assignedToId: string | null
  requestorName: string
  requestorEmail: string
  location: string
}

export interface TicketActivityRecord {
  id: string
  ticketId: string
  actor: string
  message: string
  at: string
}

const mapActivityRecord = (record: Record<string, unknown>): TicketActivityRecord => ({
  id: String(record.id),
  ticketId: String(record.ticketId),
  actor: String(record.actor),
  message: String(record.message),
  at: new Date(String(record.activityAt)).toISOString(),
})

const mapTicketRecord = (record: Record<string, unknown>): Omit<TicketRecord, 'activity'> => ({
  id: String(record.id),
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
  updatedAt: new Date(String(record.updatedAt)).toISOString(),
})

const groupTicketsWithActivity = (
  tickets: Array<Omit<TicketRecord, 'activity'>>,
  activity: TicketActivityRecord[],
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
  }))
}

const insertActivityEntries = async (
  transaction: sql.Transaction,
  entries: Array<{ ticketId: string; actor: string; message: string; at: Date }>,
) => {
  for (const entry of entries) {
    await transaction
      .request()
      .input('id', sql.NVarChar(300), `activity-${crypto.randomUUID()}`)
      .input('ticketId', sql.NVarChar(50), entry.ticketId)
      .input('actor', sql.NVarChar(120), entry.actor)
      .input('message', sql.NVarChar(500), entry.message)
      .input('activityAt', sql.DateTime2, entry.at)
      .query(`
        INSERT INTO dbo.TicketActivity (Id, TicketId, Actor, Message, ActivityAt)
        VALUES (@id, @ticketId, @actor, @message, @activityAt);
      `)
  }
}

const getEntityName = async (
  request: sql.Request,
  table: 'dbo.Users' | 'dbo.Categories',
  id: string | null,
): Promise<string> => {
  if (!id) {
    return 'Unassigned'
  }

  const column = table === 'dbo.Users' ? 'Name' : 'Name'
  const result = await request
    .input('entityId', sql.NVarChar(80), id)
    .query<Record<string, unknown>>(`SELECT ${column} AS entityName FROM ${table} WHERE Id = @entityId`)

  const value = result.recordset[0]?.entityName
  return typeof value === 'string' && value.trim() ? value.trim() : 'Unknown'
}

const getTicketBaseById = async (request: sql.Request, ticketId: string) => {
  const result = await request
    .input('ticketId', sql.NVarChar(50), ticketId)
    .query<Record<string, unknown>>(`
      SELECT
        Id AS id,
        Title AS title,
        Description AS description,
        Status AS status,
        Priority AS priority,
        TeamId AS teamId,
        CategoryId AS categoryId,
        AssignedToId AS assignedToId,
        RequestorName AS requestorName,
        RequestorEmail AS requestorEmail,
        Location AS location,
        DueLabel AS dueLabel,
        CreatedAt AS createdAt,
        UpdatedAt AS updatedAt
      FROM dbo.Tickets
      WHERE Id = @ticketId
    `)

  const record = result.recordset[0]
  return record ? mapTicketRecord(record) : null
}

const generateTicketId = () => `TKT-${Math.floor(10000 + Math.random() * 89999)}`

const isNonEmpty = (value: string) => value.trim().length > 0

const validateCreateTicketInput = (input: CreateTicketInput) => {
  if (
    !isNonEmpty(input.title) ||
    !isNonEmpty(input.description) ||
    !isNonEmpty(input.teamId) ||
    !isNonEmpty(input.categoryId) ||
    !isNonEmpty(input.requestorName) ||
    !isNonEmpty(input.requestorEmail)
  ) {
    return false
  }

  return ticketPriorityValues.has(input.priority)
}

const getUserTeamId = async (request: sql.Request, userId: string | null) => {
  if (!userId) {
    return null
  }

  const result = await request
    .input('userId', sql.NVarChar(50), userId)
    .query<Record<string, unknown>>('SELECT TeamId AS teamId FROM dbo.Users WHERE Id = @userId')

  const teamId = result.recordset[0]?.teamId
  return typeof teamId === 'string' ? teamId : null
}

const getCategoryTeamId = async (request: sql.Request, categoryId: string) => {
  const result = await request
    .input('categoryId', sql.NVarChar(80), categoryId)
    .query<Record<string, unknown>>('SELECT TeamId AS teamId FROM dbo.Categories WHERE Id = @categoryId')

  const teamId = result.recordset[0]?.teamId
  return typeof teamId === 'string' ? teamId : null
}

export const ticketBelongsToTeam = async (ticketId: string, teamId: string) => {
  if (!hasDatabaseConfig()) {
    return false
  }

  const pool = await getPool()
  const result = await pool
    .request()
    .input('ticketId', sql.NVarChar(50), ticketId)
    .input('teamId', sql.NVarChar(50), teamId)
    .query<Record<string, unknown>>(`
      SELECT 1 AS allowed
      FROM dbo.Tickets
      WHERE Id = @ticketId AND TeamId = @teamId
    `)

  return result.recordset.length > 0
}

const getTicketActivityById = async (request: sql.Request, ticketId: string) => {
  const result = await request
    .input('ticketId', sql.NVarChar(50), ticketId)
    .query<Record<string, unknown>>(`
      SELECT Id AS id, TicketId AS ticketId, Actor AS actor, Message AS message, ActivityAt AS activityAt
      FROM dbo.TicketActivity
      WHERE TicketId = @ticketId
      ORDER BY ActivityAt ASC
    `)

  return result.recordset.map(mapActivityRecord)
}

export const listTickets = async (teamId?: string): Promise<TicketRecord[]> => {
  if (!hasDatabaseConfig()) {
    return []
  }

  const pool = await getPool()
  const request = pool.request()
  let whereClause = ''

  if (teamId) {
    request.input('teamId', sql.NVarChar(50), teamId)
    whereClause = 'WHERE TeamId = @teamId'
  }

  const ticketResult = await request.query<Record<string, unknown>>(`
    SELECT
      Id AS id,
      Title AS title,
      Description AS description,
      Status AS status,
      Priority AS priority,
      TeamId AS teamId,
      CategoryId AS categoryId,
      AssignedToId AS assignedToId,
      RequestorName AS requestorName,
      RequestorEmail AS requestorEmail,
      Location AS location,
      DueLabel AS dueLabel,
      CreatedAt AS createdAt,
      UpdatedAt AS updatedAt
    FROM dbo.Tickets
    ${whereClause}
    ORDER BY UpdatedAt DESC, CreatedAt DESC
  `)
  const activity = teamId
    ? (await listTicketActivity()).filter((entry) => ticketResult.recordset.some((ticket) => ticket.id === entry.ticketId))
    : await listTicketActivity()

  return groupTicketsWithActivity(ticketResult.recordset.map(mapTicketRecord), activity)
}

export const getTicketById = async (ticketId: string): Promise<TicketRecord | null> => {
  if (!hasDatabaseConfig()) {
    return null
  }

  const pool = await getPool()
  const request = pool.request()
  const ticket = await getTicketBaseById(request, ticketId)
  if (!ticket) {
    return null
  }

  const activity = await getTicketActivityById(pool.request(), ticketId)
  return {
    ...ticket,
    activity,
  }
}

export interface UpdateTicketInput {
  title: string
  description: string
  status: string
  priority: string
  categoryId: string
  assignedToId: string | null
}

const validateUpdateTicketInput = (input: UpdateTicketInput) => {
  if (!input.title.trim() || !input.description.trim() || !input.categoryId.trim()) {
    return false
  }

  if (!ticketStatusValues.has(input.status) || !ticketPriorityValues.has(input.priority)) {
    return false
  }

  return true
}

export const listTicketActivity = async (): Promise<TicketActivityRecord[]> => {
  if (!hasDatabaseConfig()) {
    return []
  }

  const pool = await getPool()
  const result = await pool.request().query<Record<string, unknown>>(`
    SELECT Id AS id, TicketId AS ticketId, Actor AS actor, Message AS message, ActivityAt AS activityAt
    FROM dbo.TicketActivity
  `)

  return result.recordset.map(mapActivityRecord)
}

export const createTicketComment = async (input: {
  ticketId: string
  actor: string
  message: string
}): Promise<TicketActivityRecord> => {
  const pool = await getPool()
  const activityAt = new Date().toISOString()
  const id = `comment-${crypto.randomUUID()}`

  await pool
    .request()
    .input('id', sql.NVarChar(300), id)
    .input('ticketId', sql.NVarChar(50), input.ticketId)
    .input('actor', sql.NVarChar(120), input.actor)
    .input('message', sql.NVarChar(500), input.message)
    .input('activityAt', sql.DateTime2, new Date(activityAt))
    .query(`
      INSERT INTO dbo.TicketActivity (Id, TicketId, Actor, Message, ActivityAt)
      VALUES (@id, @ticketId, @actor, @message, @activityAt);

      UPDATE dbo.Tickets
      SET UpdatedAt = @activityAt
      WHERE Id = @ticketId;
    `)

  return {
    id,
    ticketId: input.ticketId,
    actor: input.actor,
    message: input.message,
    at: activityAt,
  }
}

export const updateTicket = async (
  ticketId: string,
  input: UpdateTicketInput,
  actor: string,
): Promise<TicketRecord | null> => {
  if (!hasDatabaseConfig() || !validateUpdateTicketInput(input)) {
    return null
  }

  const pool = await getPool()
  const existing = await getTicketById(ticketId)
  if (!existing) {
    return null
  }

  const changeMessages: Array<{ ticketId: string; actor: string; message: string; at: Date }> = []
  const activityAt = new Date()

  if (existing.status !== input.status) {
    changeMessages.push({
      ticketId,
      actor,
      at: activityAt,
      message: `Changed status from ${existing.status} to ${input.status}.`,
    })
  }

  if (existing.priority !== input.priority) {
    changeMessages.push({
      ticketId,
      actor,
      at: activityAt,
      message: `Changed priority from ${existing.priority} to ${input.priority}.`,
    })
  }

  if (existing.assignedToId !== input.assignedToId) {
    const previousAssignee = await getEntityName(pool.request(), 'dbo.Users', existing.assignedToId)
    const nextAssignee = await getEntityName(pool.request(), 'dbo.Users', input.assignedToId)
    changeMessages.push({
      ticketId,
      actor,
      at: activityAt,
      message: `Reassigned ticket from ${previousAssignee} to ${nextAssignee}.`,
    })
  }

  if (existing.categoryId !== input.categoryId) {
    const previousCategory = await getEntityName(pool.request(), 'dbo.Categories', existing.categoryId)
    const nextCategory = await getEntityName(pool.request(), 'dbo.Categories', input.categoryId)
    changeMessages.push({
      ticketId,
      actor,
      at: activityAt,
      message: `Updated category from ${previousCategory} to ${nextCategory}.`,
    })
  }

  if (existing.title !== input.title) {
    changeMessages.push({
      ticketId,
      actor,
      at: activityAt,
      message: 'Updated ticket title.',
    })
  }

  if (existing.description !== input.description) {
    changeMessages.push({
      ticketId,
      actor,
      at: activityAt,
      message: 'Updated ticket description.',
    })
  }

  const transaction = new sql.Transaction(pool)
  await transaction.begin()

  try {
    await transaction
      .request()
      .input('ticketId', sql.NVarChar(50), ticketId)
      .input('title', sql.NVarChar(200), input.title.trim())
      .input('description', sql.NVarChar(sql.MAX), input.description.trim())
      .input('status', sql.NVarChar(20), input.status)
      .input('priority', sql.NVarChar(20), input.priority)
      .input('categoryId', sql.NVarChar(80), input.categoryId)
      .input('assignedToId', sql.NVarChar(50), input.assignedToId)
      .input('updatedAt', sql.DateTime2, activityAt)
      .query(`
        UPDATE dbo.Tickets
        SET
          Title = @title,
          Description = @description,
          Status = @status,
          Priority = @priority,
          CategoryId = @categoryId,
          AssignedToId = @assignedToId,
          UpdatedAt = @updatedAt
        WHERE Id = @ticketId
      `)

    if (changeMessages.length > 0) {
      await insertActivityEntries(transaction, changeMessages)
    }

    await transaction.commit()
  } catch (error) {
    await transaction.rollback()
    throw error
  }

  return getTicketById(ticketId)
}

export const createTicket = async (
  input: CreateTicketInput,
  actor: string,
): Promise<TicketRecord | null> => {
  if (!hasDatabaseConfig() || !validateCreateTicketInput(input)) {
    return null
  }

  const pool = await getPool()
  const categoryTeamId = await getCategoryTeamId(pool.request(), input.categoryId)
  if (!categoryTeamId || categoryTeamId !== input.teamId) {
    return null
  }

  if (input.assignedToId) {
    const assigneeTeamId = await getUserTeamId(pool.request(), input.assignedToId)
    if (!assigneeTeamId || assigneeTeamId !== input.teamId) {
      return null
    }
  }

  let ticketId = input.id?.trim() || generateTicketId()
  while (await getTicketById(ticketId)) {
    ticketId = generateTicketId()
  }

  const createdAt = new Date()
  const transaction = new sql.Transaction(pool)
  await transaction.begin()

  try {
    await transaction
      .request()
      .input('ticketId', sql.NVarChar(50), ticketId)
      .input('title', sql.NVarChar(200), input.title.trim())
      .input('description', sql.NVarChar(sql.MAX), input.description.trim())
      .input('status', sql.NVarChar(20), 'Open')
      .input('priority', sql.NVarChar(20), input.priority)
      .input('teamId', sql.NVarChar(50), input.teamId)
      .input('categoryId', sql.NVarChar(80), input.categoryId)
      .input('assignedToId', sql.NVarChar(50), input.assignedToId)
      .input('requestorName', sql.NVarChar(120), input.requestorName.trim())
      .input('requestorEmail', sql.NVarChar(255), input.requestorEmail.trim().toLowerCase())
      .input('location', sql.NVarChar(200), input.location.trim() || 'Not specified')
      .input('dueLabel', sql.NVarChar(120), 'New in queue')
      .input('createdAt', sql.DateTime2, createdAt)
      .query(`
        INSERT INTO dbo.Tickets (
          Id,
          Title,
          Description,
          Status,
          Priority,
          TeamId,
          CategoryId,
          AssignedToId,
          RequestorName,
          RequestorEmail,
          Location,
          DueLabel,
          CreatedAt,
          UpdatedAt
        )
        VALUES (
          @ticketId,
          @title,
          @description,
          @status,
          @priority,
          @teamId,
          @categoryId,
          @assignedToId,
          @requestorName,
          @requestorEmail,
          @location,
          @dueLabel,
          @createdAt,
          @createdAt
        )
      `)

    await insertActivityEntries(transaction, [
      {
        ticketId,
        actor,
        at: createdAt,
        message: 'Ticket created from TeamSupportPro.',
      },
    ])

    await transaction.commit()
  } catch (error) {
    await transaction.rollback()
    throw error
  }

  return getTicketById(ticketId)
}

export const deleteTicket = async (ticketId: string): Promise<boolean> => {
  if (!hasDatabaseConfig() || !isNonEmpty(ticketId)) {
    return false
  }

  const pool = await getPool()
  const transaction = new sql.Transaction(pool)
  await transaction.begin()

  try {
    await transaction.request().input('ticketId', sql.NVarChar(50), ticketId).query(`
      DELETE FROM dbo.TicketAttachments WHERE TicketId = @ticketId;
      DELETE FROM dbo.TicketActivity WHERE TicketId = @ticketId;
      DELETE FROM dbo.Tickets WHERE Id = @ticketId;
    `)

    await transaction.commit()
    return true
  } catch (error) {
    await transaction.rollback()
    throw error
  }
}