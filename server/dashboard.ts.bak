import { getPool, hasDatabaseConfig } from './db.js'

export interface DashboardSummaryRecord {
  stats: {
    total: number
    open: number
    inProgress: number
    pending: number
    critical: number
  }
  statusCounts: Array<{
    status: string
    count: number
  }>
  teamWorkload: Array<{
    teamId: string
    count: number
  }>
}

const statusOrder = ['Open', 'In Progress', 'Pending', 'Resolved', 'Closed']

export const getDashboardSummary = async (): Promise<DashboardSummaryRecord> => {
  if (!hasDatabaseConfig()) {
    return {
      stats: {
        total: 0,
        open: 0,
        inProgress: 0,
        pending: 0,
        critical: 0,
      },
      statusCounts: statusOrder.map((status) => ({ status, count: 0 })),
      teamWorkload: [],
    }
  }

  const pool = await getPool()
  const [statsResult, statusResult, workloadResult] = await Promise.all([
    pool.request().query<Record<string, unknown>>(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN Status = 'Open' THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN Status = 'In Progress' THEN 1 ELSE 0 END) AS inProgress,
        SUM(CASE WHEN Status = 'Pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN Priority = 'Critical' THEN 1 ELSE 0 END) AS critical
      FROM dbo.Tickets
    `),
    pool.request().query<Record<string, unknown>>(`
      SELECT Status AS status, COUNT(*) AS count
      FROM dbo.Tickets
      GROUP BY Status
    `),
    pool.request().query<Record<string, unknown>>(`
      SELECT TeamId AS teamId, COUNT(*) AS count
      FROM dbo.Tickets
      GROUP BY TeamId
    `),
  ])

  const statsRow = statsResult.recordset[0] ?? {}
  const statusMap = new Map(
    statusResult.recordset.map((row) => [String(row.status), Number(row.count ?? 0)]),
  )

  return {
    stats: {
      total: Number(statsRow.total ?? 0),
      open: Number(statsRow.open ?? 0),
      inProgress: Number(statsRow.inProgress ?? 0),
      pending: Number(statsRow.pending ?? 0),
      critical: Number(statsRow.critical ?? 0),
    },
    statusCounts: statusOrder.map((status) => ({
      status,
      count: statusMap.get(status) ?? 0,
    })),
    teamWorkload: workloadResult.recordset.map((row) => ({
      teamId: String(row.teamId),
      count: Number(row.count ?? 0),
    })),
  }
}