import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware.js'
import { getDashboardSummary } from '../dashboard.js'
import {
  clearSeededTeamTicketTrends,
  listTeamTicketTrends,
  seedTeamTicketTrends,
} from '../trends.js'

export const dashboardRouter = Router()

dashboardRouter.get('/trends', requireAuth, async (req, res) => {
  const user = req.user!

  try {
    const trends = await listTeamTicketTrends(21, user.organizationId)
    res.json({ trends })
  } catch (error) {
    console.error('Loading dashboard trends failed.', error)
    res.status(500).json({ error: 'dashboard_trends_load_failed' })
  }
})

dashboardRouter.get('/summary', requireAuth, async (req, res) => {
  const user = req.user!

  try {
    const summary = await getDashboardSummary(user.canViewAllOrgTickets ? null : user.teamId, user.organizationId)
    res.json({ summary })
  } catch (error) {
    console.error('Loading dashboard summary failed.', error)
    res.status(500).json({ error: 'dashboard_summary_load_failed' })
  }
})

dashboardRouter.post('/trends/seed', requireAdmin, async (req, res) => {

  try {
    const result = await seedTeamTicketTrends(
      typeof req.body?.days === 'number' ? req.body.days : Number(req.body?.days),
      typeof req.body?.categoryId === 'string' && req.body.categoryId.trim().length > 0
        ? req.body.categoryId.trim()
        : undefined,
    )
    res.json({ result })
  } catch (error) {
    if (error instanceof Error && error.message === 'category_not_found') {
      res.status(400).json({ error: 'category_not_found' })
      return
    }
    console.error('Seeding dashboard trends failed.', error)
    res.status(500).json({ error: 'dashboard_trends_seed_failed' })
  }
})

dashboardRouter.post('/trends/clear', requireAdmin, async (req, res) => {

  try {
    const result = await clearSeededTeamTicketTrends(
      typeof req.body?.days === 'number' ? req.body.days : Number(req.body?.days),
      typeof req.body?.categoryId === 'string' && req.body.categoryId.trim().length > 0
        ? req.body.categoryId.trim()
        : undefined,
    )
    res.json({ result })
  } catch (error) {
    if (error instanceof Error && error.message === 'category_not_found') {
      res.status(400).json({ error: 'category_not_found' })
      return
    }
    console.error('Clearing dashboard trend seed failed.', error)
    res.status(500).json({ error: 'dashboard_trends_clear_failed' })
  }
})
