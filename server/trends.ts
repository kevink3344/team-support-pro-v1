import { getDb, dbGet, dbAll, dbRun } from './db.js'
import type { InValue } from '@libsql/client'

export interface TrendRecord {
  date: string
  values: Record<string, number>
}

interface TrendRow {
  date: string
  teamId: string
  count: number
}

interface SeedTargetTeam {
  id: string
  name: string
}

interface SeedTargetCategory {
  id: string
  name: string
  teamId: string
}

interface TrendSeedConfig {
  enabled?: boolean
  days?: number
  seededAt?: string
  targetTeamIds?: string[]
  categoryId?: string | null
  categoryName?: string | null
}

export interface TrendSeedResult {
  days: number
  fromDate: string
  toDate: string
  rowsAffected: number
  categoryId: string | null
  categoryName: string | null
}

const TREND_SEED_SETTINGS_KEY = 'dashboard-trend-seed-config'

const UPSERT_SETTING = `INSERT INTO AppSettings (Key, Value, UpdatedAt)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, UpdatedAt = datetime('now')`

const formatDate = (date: Date) => date.toISOString().slice(0, 10)

const parseTrendSeedConfig = (value: string | undefined): TrendSeedConfig | null => {
  if (!value) return null
  try {
    return JSON.parse(value) as TrendSeedConfig
  } catch {
    return null
  }
}

const clampTrendDays = (days: number) => Math.min(Math.max(Math.trunc(days) || 0, 1), 365)

const getTrendDates = (days: number) => {
  const safeDays = clampTrendDays(days)
  const startDate = new Date()
  startDate.setHours(0, 0, 0, 0)
  startDate.setDate(startDate.getDate() - Math.max(safeDays - 1, 0))
  return Array.from({ length: safeDays }, (_, index) => {
    const nextDate = new Date(startDate)
    nextDate.setDate(startDate.getDate() + index)
    return formatDate(nextDate)
  })
}

const buildTrendRecords = (rows: TrendRow[], days: number) => {
  const trendMap = new Map<string, Record<string, number>>()
  getTrendDates(days).forEach((date) => { trendMap.set(date, {}) })
  for (const row of rows) {
    const existing = trendMap.get(row.date)
    if (existing) existing[row.teamId] = row.count
  }
  return Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, values]) => ({ date, values }))
}

const listDerivedTrendRows = async (days: number, organizationId?: string): Promise<TrendRow[]> => {
  const db = getDb()
  const daysParam = `-${Math.max(clampTrendDays(days) - 1, 0)} days`
  const rows = organizationId
    ? await dbAll(db, `
        SELECT DATE(CreatedAt) AS date, TeamId AS teamId, COUNT(*) AS count
        FROM Tickets
        WHERE CreatedAt >= date('now', ?)
          AND TeamId IN (SELECT Id FROM Teams WHERE OrganizationId = ?)
        GROUP BY DATE(CreatedAt), TeamId
        ORDER BY DATE(CreatedAt) ASC, TeamId ASC
      `, [daysParam, organizationId])
    : await dbAll(db, `
        SELECT DATE(CreatedAt) AS date, TeamId AS teamId, COUNT(*) AS count
        FROM Tickets
        WHERE CreatedAt >= date('now', ?)
        GROUP BY DATE(CreatedAt), TeamId
        ORDER BY DATE(CreatedAt) ASC, TeamId ASC
      `, [daysParam])
  return rows.map((r) => ({ date: String(r.date), teamId: String(r.teamId), count: Number(r.count) }))
}

const listStoredTrendRows = async (days: number, targetTeamIds: string[]): Promise<TrendRow[]> => {
  if (targetTeamIds.length === 0) return []
  const db = getDb()
  const placeholders = targetTeamIds.map(() => '?').join(', ')
  const rows = await dbAll(db, `
    SELECT TrendDate AS date, TeamId AS teamId, TicketCount AS count
    FROM TeamTicketTrends
    WHERE TrendDate >= date('now', ?)
      AND TeamId IN (${placeholders})
    ORDER BY TrendDate ASC, TeamId ASC
  `, [`-${Math.max(clampTrendDays(days) - 1, 0)} days`, ...targetTeamIds])
  return rows.map((r) => ({ date: String(r.date), teamId: String(r.teamId), count: Number(r.count) }))
}

const readTrendSeedConfig = async (): Promise<TrendSeedConfig | null> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT Value AS value FROM AppSettings WHERE Key = ?', [TREND_SEED_SETTINGS_KEY])
  return parseTrendSeedConfig(row?.value ? String(row.value) : undefined)
}

const hasActiveTrendSeed = (config: TrendSeedConfig | null) => config?.enabled === true

const listAllTeams = async (): Promise<SeedTargetTeam[]> => {
  const db = getDb()
  const rows = await dbAll(db, 'SELECT Id AS id, Name AS name FROM Teams ORDER BY Name ASC') as Array<{ id: unknown; name: unknown }>
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }))
}

const listTeamsByOrg = async (organizationId: string): Promise<SeedTargetTeam[]> => {
  const db = getDb()
  const rows = await dbAll(db, 'SELECT Id AS id, Name AS name FROM Teams WHERE OrganizationId = ? ORDER BY Name ASC', [organizationId]) as Array<{ id: unknown; name: unknown }>
  return rows.map((r) => ({ id: String(r.id), name: String(r.name) }))
}

const resolveTrendSeedTargets = async (categoryId?: string): Promise<{ teams: SeedTargetTeam[]; category: SeedTargetCategory | null }> => {
  const allTeams = await listAllTeams()
  if (!categoryId) return { teams: allTeams, category: null }

  const db = getDb()
  const catRow = await dbGet(db, `SELECT c.Id AS id, c.Name AS name, c.TeamId AS teamId FROM Categories c WHERE c.Id = ?`, [categoryId]) as { id?: unknown; name?: unknown; teamId?: unknown } | undefined

  if (!catRow) throw new Error('category_not_found')

  const category: SeedTargetCategory = { id: String(catRow.id), name: String(catRow.name), teamId: String(catRow.teamId) }
  const team = allTeams.find((entry) => entry.id === category.teamId)
  if (!team) throw new Error('category_team_not_found')

  return { teams: [team], category }
}

const writeTrendSeedConfig = async (config: TrendSeedConfig): Promise<void> => {
  const db = getDb()
  await dbRun(db, UPSERT_SETTING, [TREND_SEED_SETTINGS_KEY, JSON.stringify(config)])
}

const clearTrendSeedConfig = async (): Promise<void> => {
  const db = getDb()
  await dbRun(db, 'DELETE FROM AppSettings WHERE Key = ?', [TREND_SEED_SETTINGS_KEY])
}

const getActiveTargetTeamIds = (config: TrendSeedConfig | null, fallbackTeams: SeedTargetTeam[]) => {
  if (Array.isArray(config?.targetTeamIds) && config.targetTeamIds.length > 0) return config.targetTeamIds
  return fallbackTeams.map((team) => team.id)
}

export const listTeamTicketTrends = async (days: number = 21, organizationId?: string): Promise<TrendRecord[]> => {
  const safeDays = clampTrendDays(days)
  const derivedRows = await listDerivedTrendRows(safeDays, organizationId)
  const seedConfig = await readTrendSeedConfig()

  if (!hasActiveTrendSeed(seedConfig)) return buildTrendRecords(derivedRows, safeDays)

  const scopedTeams = organizationId ? await listTeamsByOrg(organizationId) : await listAllTeams()
  const scopedTeamIdSet = new Set(scopedTeams.map((t) => t.id))
  const targetTeamIds = getActiveTargetTeamIds(seedConfig, scopedTeams).filter((id) => scopedTeamIdSet.has(id))
  const storedRows = await listStoredTrendRows(safeDays, targetTeamIds)
  const mergedRows = new Map<string, TrendRow>()
  for (const row of derivedRows) mergedRows.set(`${row.date}:${row.teamId}`, row)
  for (const row of storedRows) mergedRows.set(`${row.date}:${row.teamId}`, row)

  return buildTrendRecords(Array.from(mergedRows.values()), safeDays)
}

export const seedTeamTicketTrends = async (days: number = 60, categoryId?: string): Promise<TrendSeedResult> => {
  const safeDays = clampTrendDays(days)
  const dates = getTrendDates(safeDays)
  const currentConfig = await readTrendSeedConfig()
  const { teams, category } = await resolveTrendSeedTargets(categoryId)

  const upsertStatements: Array<{ sql: string; args: InValue[] }> = []
  let rowsAffected = 0

  dates.forEach((date, dayIndex) => {
    const dateValue = new Date(`${date}T00:00:00.000Z`)
    const weekendPenalty = dateValue.getUTCDay() === 0 || dateValue.getUTCDay() === 6 ? 1 : 0

    teams.forEach((team, teamIndex) => {
      const baseline = Math.max(1, teams.length - teamIndex + 1)
      const wave = (dayIndex * 3 + teamIndex * 5) % 4
      const ticketCount = Math.max(0, baseline + wave - weekendPenalty)
      upsertStatements.push({
        sql: `INSERT INTO TeamTicketTrends (TrendDate, TeamId, TicketCount) VALUES (?, ?, ?) ON CONFLICT(TrendDate, TeamId) DO UPDATE SET TicketCount = excluded.TicketCount`,
        args: [date, team.id, ticketCount],
      })
      rowsAffected += 1
    })
  })

  const db = getDb()
  await db.batch(upsertStatements, 'write')

  await writeTrendSeedConfig({
    enabled: true,
    days: safeDays,
    seededAt: new Date().toISOString(),
    targetTeamIds: Array.from(
      new Set([...(currentConfig?.targetTeamIds ?? []), ...teams.map((team) => team.id)]),
    ),
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
  })

  return {
    days: safeDays,
    fromDate: dates[0],
    toDate: dates[dates.length - 1],
    rowsAffected,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
  }
}

export const clearSeededTeamTicketTrends = async (days: number = 60, categoryId?: string): Promise<TrendSeedResult> => {
  const safeDays = clampTrendDays(days)
  const dates = getTrendDates(safeDays)
  const currentConfig = await readTrendSeedConfig()
  const { teams, category } = await resolveTrendSeedTargets(categoryId)
  const placeholders = teams.map(() => '?').join(', ')
  const db = getDb()

  const result = await dbRun(db, `
    DELETE FROM TeamTicketTrends
    WHERE TrendDate >= date('now', ?)
      AND TeamId IN (${placeholders})
  `, [`-${Math.max(safeDays - 1, 0)} days`, ...teams.map((team) => team.id)])

  const allTeams = await listAllTeams()
  const remainingTargetTeamIds = getActiveTargetTeamIds(currentConfig, allTeams).filter(
    (teamId) => !teams.some((team) => team.id === teamId),
  )

  if (remainingTargetTeamIds.length === 0) {
    await clearTrendSeedConfig()
  } else {
    await writeTrendSeedConfig({
      enabled: true,
      days: safeDays,
      seededAt: currentConfig?.seededAt ?? new Date().toISOString(),
      targetTeamIds: remainingTargetTeamIds,
      categoryId: currentConfig?.categoryId ?? null,
      categoryName: currentConfig?.categoryName ?? null,
    })
  }

  return {
    days: safeDays,
    fromDate: dates[0],
    toDate: dates[dates.length - 1],
    rowsAffected: result.rowsAffected,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? null,
  }
}
