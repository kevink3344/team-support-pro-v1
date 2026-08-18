import { getDb, dbGet, dbAll } from './db.js'

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

export const getDashboardSummary = async (
  teamId: string | null,
  organizationId: string,
): Promise<DashboardSummaryRecord> => {
  const db = getDb()

  const statsRow = teamId
    ? await dbGet(db, `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN t.Status = 'Open' THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN t.Status = 'In Progress' THEN 1 ELSE 0 END) AS inProgress,
          SUM(CASE WHEN t.Status = 'Pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN t.Priority = 'Critical' THEN 1 ELSE 0 END) AS critical
        FROM Tickets t
        INNER JOIN Teams tm ON tm.Id = t.TeamId
        WHERE t.TeamId = ? AND tm.OrganizationId = ?
      `, [teamId, organizationId])
    : await dbGet(db, `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN t.Status = 'Open' THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN t.Status = 'In Progress' THEN 1 ELSE 0 END) AS inProgress,
          SUM(CASE WHEN t.Status = 'Pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN t.Priority = 'Critical' THEN 1 ELSE 0 END) AS critical
        FROM Tickets t
        INNER JOIN Teams tm ON tm.Id = t.TeamId
        WHERE tm.OrganizationId = ?
      `, [organizationId])

  const statusRows = await dbAll(db, `
    SELECT t.Status AS status, COUNT(*) AS count
    FROM Tickets t
    INNER JOIN Teams tm ON tm.Id = t.TeamId
    WHERE tm.OrganizationId = ?
    GROUP BY t.Status
  `, [organizationId]) as Array<{ status: unknown; count: unknown }>
  const workloadRows = await dbAll(db, `
    SELECT t.TeamId AS teamId, COUNT(*) AS count
    FROM Tickets t
    INNER JOIN Teams tm ON tm.Id = t.TeamId
    WHERE tm.OrganizationId = ?
    GROUP BY t.TeamId
  `, [organizationId]) as Array<{ teamId: unknown; count: unknown }>

  const statusMap = new Map(statusRows.map((row) => [String(row.status), Number(row.count)]))

  return {
    stats: {
      total: Number(statsRow?.total ?? 0),
      open: Number(statsRow?.open ?? 0),
      inProgress: Number(statsRow?.inProgress ?? 0),
      pending: Number(statsRow?.pending ?? 0),
      critical: Number(statsRow?.critical ?? 0),
    },
    statusCounts: statusOrder.map((status) => ({
      status,
      count: statusMap.get(status) ?? 0,
    })),
    teamWorkload: workloadRows.map((row) => ({
      teamId: String(row.teamId),
      count: Number(row.count),
    })),
  }
}
