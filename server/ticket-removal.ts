import { getDb, dbAll, dbGet, type Client } from './db.js'

export interface RemoveTicketsInput {
  teamId: string
  organizationId: string
  dryRun?: boolean
}

export interface RemoveTicketsBreakdown {
  ticketActivity: number
  ticketAttachments: number
  ticketCustomFieldValues: number
  ticketVersions: number
  ticketVersionCustomFieldValues: number
  ticketWatchers: number
}

export interface RemoveTicketsResult {
  teamId: string
  teamName: string
  deleted: number
  breakdown: RemoveTicketsBreakdown
  dryRun: boolean
}

interface TargetTeam {
  id: string
  name: string
}

const resolveOrganizationTeam = async (
  teamId: string,
  organizationId: string,
): Promise<TargetTeam | undefined> => {
  const db = getDb()
  const row = await dbGet(
    db,
    'SELECT Id AS id, Name AS name FROM Teams WHERE Id = ? AND OrganizationId = ?',
    [teamId, organizationId],
  )
  if (!row) return undefined
  return { id: String(row.id), name: String(row.name) }
}

const listTeamTicketIds = async (teamId: string): Promise<string[]> => {
  const db = getDb()
  const rows = (await dbAll(db, 'SELECT Id AS id FROM Tickets WHERE TeamId = ?', [teamId])) as Array<{
    id: unknown
  }>
  return rows.map((row) => String(row.id))
}

/** Count rows in a single table by a direct ticket column. */
const countByTicketIds = async (
  db: Client,
  table: string,
  column: string,
  placeholders: string,
  ticketIds: string[],
): Promise<number> => {
  const row = await dbGet(
    db,
    `SELECT COUNT(1) AS cnt FROM ${table} WHERE ${column} IN (${placeholders})`,
    ticketIds,
  )
  return Number(row?.cnt ?? 0)
}

const countVersionCustomFieldValues = async (
  db: Client,
  placeholders: string,
  ticketIds: string[],
): Promise<number> => {
  const row = await dbGet(
    db,
    `SELECT COUNT(1) AS cnt FROM TicketVersionCustomFieldValues
     WHERE TicketVersionId IN (SELECT Id FROM TicketVersions WHERE TicketId IN (${placeholders}))`,
    ticketIds,
  )
  return Number(row?.cnt ?? 0)
}

export const removeTicketsForTeam = async (
  input: RemoveTicketsInput,
): Promise<RemoveTicketsResult> => {
  const organizationId = input.organizationId.trim()
  const teamId = input.teamId.trim()
  if (!organizationId) throw new Error('organization_id_required')
  if (!teamId) throw new Error('team_id_required')

  const team = await resolveOrganizationTeam(teamId, organizationId)
  if (!team) throw new Error('team_not_found')

  const db = getDb()
  const ticketIds = await listTeamTicketIds(teamId)
  const deleted = ticketIds.length

  const zeroBreakdown: RemoveTicketsBreakdown = {
    ticketActivity: 0,
    ticketAttachments: 0,
    ticketCustomFieldValues: 0,
    ticketVersions: 0,
    ticketVersionCustomFieldValues: 0,
    ticketWatchers: 0,
  }

  const buildResult = (breakdown: RemoveTicketsBreakdown): RemoveTicketsResult => ({
    teamId: team.id,
    teamName: team.name,
    deleted,
    breakdown,
    dryRun: input.dryRun === true,
  })

  if (deleted === 0) {
    return buildResult(zeroBreakdown)
  }

  const placeholders = ticketIds.map(() => '?').join(', ')

  // Always report accurate counts; on dryRun we stop here without deleting.
  const breakdown: RemoveTicketsBreakdown = {
    ticketActivity: await countByTicketIds(db, 'TicketActivity', 'TicketId', placeholders, ticketIds),
    ticketAttachments: await countByTicketIds(db, 'TicketAttachments', 'TicketId', placeholders, ticketIds),
    ticketCustomFieldValues: await countByTicketIds(db, 'TicketCustomFieldValues', 'TicketId', placeholders, ticketIds),
    ticketVersions: await countByTicketIds(db, 'TicketVersions', 'TicketId', placeholders, ticketIds),
    ticketVersionCustomFieldValues: await countVersionCustomFieldValues(db, placeholders, ticketIds),
    ticketWatchers: await countByTicketIds(db, 'TicketWatchers', 'TicketId', placeholders, ticketIds),
  }

  if (input.dryRun === true) {
    return buildResult(breakdown)
  }

  const statements = [
    // Version custom-field values must go before versions (FK: versionId -> TicketVersions)
    {
      sql: `DELETE FROM TicketVersionCustomFieldValues
            WHERE TicketVersionId IN (SELECT Id FROM TicketVersions WHERE TicketId IN (${placeholders}))`,
      args: ticketIds,
    },
    { sql: `DELETE FROM TicketVersions WHERE TicketId IN (${placeholders})`, args: ticketIds },
    { sql: `DELETE FROM TicketAttachments WHERE TicketId IN (${placeholders})`, args: ticketIds },
    { sql: `DELETE FROM TicketActivity WHERE TicketId IN (${placeholders})`, args: ticketIds },
    { sql: `DELETE FROM TicketCustomFieldValues WHERE TicketId IN (${placeholders})`, args: ticketIds },
    { sql: `DELETE FROM TicketWatchers WHERE TicketId IN (${placeholders})`, args: ticketIds },
    { sql: `DELETE FROM Tickets WHERE Id IN (${placeholders})`, args: ticketIds },
  ]

  await db.batch(statements, 'write')

  return buildResult(breakdown)
}
