import { getPool, hasDatabaseConfig } from './db.js'

export interface TrendPointRecord {
  date: string
  values: Record<string, number>
}

const formatTrendDate = (value: Date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(value)

export const listTeamTicketTrends = async (): Promise<TrendPointRecord[]> => {
  if (!hasDatabaseConfig()) {
    return []
  }

  const pool = await getPool()
  const result = await pool.request().query<Record<string, unknown>>(`
    SELECT TrendDate AS trendDate, TeamId AS teamId, TicketCount AS ticketCount
    FROM dbo.TeamTicketTrends
    ORDER BY TrendDate ASC, TeamId ASC
  `)

  const points = new Map<string, TrendPointRecord>()

  for (const record of result.recordset) {
    const rawTrendDate = record.trendDate
    const rawTeamId = record.teamId
    const rawTicketCount = record.ticketCount

    if (!(rawTrendDate instanceof Date) || typeof rawTeamId !== 'string') {
      continue
    }

    const dateKey = formatTrendDate(rawTrendDate)
    const existing = points.get(dateKey) ?? { date: dateKey, values: {} }
    existing.values[rawTeamId] = Number(rawTicketCount ?? 0)
    points.set(dateKey, existing)
  }

  return Array.from(points.values())
}