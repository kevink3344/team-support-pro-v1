import { Router } from 'express'
import { requireAdmin } from '../middleware.js'
import {
  getTicketStatusReport,
  getTicketPriorityReport,
  getAssigneeReport,
  getTrendReport,
  getAllTicketsForExport,
  getResolutionTimeBuckets,
  getAvgResolutionByPriority,
  getAvgResolutionByTeam,
  getOpenTicketAgeBuckets,
  getFirstResponseTimeBuckets,
} from '../reports.js'

export const reportsRouter = Router()
reportsRouter.use(requireAdmin)

reportsRouter.get('/status', async (_req, res) => {
  res.json(await getTicketStatusReport())
})

reportsRouter.get('/priority', async (_req, res) => {
  res.json(await getTicketPriorityReport())
})

reportsRouter.get('/assignee', async (_req, res) => {
  res.json(await getAssigneeReport())
})

reportsRouter.get('/trends', async (req, res) => {
  const days = parseInt(req.query.days as string) || 30
  res.json(await getTrendReport(days))
})

reportsRouter.get('/resolution-time', async (_req, res) => {
  res.json(await getResolutionTimeBuckets())
})

reportsRouter.get('/avg-resolution-by-priority', async (_req, res) => {
  res.json(await getAvgResolutionByPriority())
})

reportsRouter.get('/avg-resolution-by-team', async (_req, res) => {
  res.json(await getAvgResolutionByTeam())
})

reportsRouter.get('/open-ticket-age', async (_req, res) => {
  res.json(await getOpenTicketAgeBuckets())
})

reportsRouter.get('/first-response-time', async (_req, res) => {
  res.json(await getFirstResponseTimeBuckets())
})

reportsRouter.get('/export/csv', async (_req, res) => {
  const data = await getAllTicketsForExport()
  const csv = [
    ['ID', 'Title', 'Description', 'Status', 'Priority', 'Requestor Name', 'Requestor Email', 'Location', 'Created At', 'Updated At', 'Assignee', 'Category', 'Team'],
    ...data.map((row) => [
      row.Id,
      row.Title,
      row.Description,
      row.Status,
      row.Priority,
      row.RequestorName,
      row.RequestorEmail,
      row.Location,
      row.CreatedAt,
      row.UpdatedAt,
      row.AssigneeName || '',
      row.CategoryName,
      row.TeamName,
    ]),
  ].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', 'attachment; filename="tickets.csv"')
  res.send(csv)
})

reportsRouter.get('/export/excel', async (_req, res) => {
  const XLSX = await import('xlsx')
  const data = await getAllTicketsForExport()
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Tickets')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="tickets.xlsx"')
  res.send(buffer)
})
