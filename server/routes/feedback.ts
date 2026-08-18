import { Router } from 'express'
import { requireAdmin } from '../middleware.js'
import {
  createTestFeedbackToken,
  getFeedbackForm,
  listFeedbackResponses,
  resolveToken,
  saveFeedbackFormFields,
  setFeedbackFormEnabled,
  submitFeedbackResponse,
  type FeedbackAnswerInput,
  type FeedbackFormField,
} from '../feedback.js'
import { serverConfig } from '../config.js'
import { getDb, dbGet } from '../db.js'

export const feedbackRouter = Router()

// ---------------------------------------------------------------------------
// Feedback Form per-org design (admin)
// ---------------------------------------------------------------------------

feedbackRouter.get('/form/:orgId', requireAdmin, async (req, res) => {
  const form = await getFeedbackForm(String(req.params.orgId))
  res.json({ form })
})

feedbackRouter.put('/form/:orgId', requireAdmin, async (req, res) => {
  if (!Array.isArray(req.body?.fields)) {
    res.status(400).json({ error: 'invalid_feedback_form_payload' })
    return
  }
  const form = await saveFeedbackFormFields(String(req.params.orgId), req.body.fields as Array<Partial<FeedbackFormField>>)
  res.json({ form })
})

feedbackRouter.patch('/form/:orgId/enabled', requireAdmin, async (req, res) => {
  if (typeof req.body?.isEnabled !== 'boolean') {
    res.status(400).json({ error: 'invalid_feedback_form_enabled_payload' })
    return
  }
  const form = await setFeedbackFormEnabled(String(req.params.orgId), req.body.isEnabled)
  res.json({ form })
})

feedbackRouter.post('/form/:orgId/test-token', requireAdmin, async (req, res) => {
  const form = await getFeedbackForm(String(req.params.orgId))
  if (form.fields.length === 0) {
    res.status(400).json({ error: 'feedback_form_has_no_fields' })
    return
  }
  const token = await createTestFeedbackToken(String(req.params.orgId))
  const baseUrl = (serverConfig.allowedOrigins[0] ?? serverConfig.clientUrl).replace(/\/$/, '')
  res.json({ token, url: `${baseUrl}/feedback/${token}` })
})

feedbackRouter.get('/responses/:orgId', requireAdmin, async (req, res) => {
  const includeTest = req.query.includeTest === 'true'
  const responses = await listFeedbackResponses(String(req.params.orgId), includeTest)
  res.json({ responses })
})

// ---------------------------------------------------------------------------
// Public feedback endpoints (no auth)
// ---------------------------------------------------------------------------

feedbackRouter.get('/public/:token', async (req, res) => {
  const token = String(req.params.token)
  const resolution = await resolveToken(token)

  if (resolution.status !== 'valid' || !resolution.data) {
    res.status(resolution.status === 'invalid' ? 404 : 410).json({ error: resolution.status })
    return
  }

  const { organizationId, ticketId, isTest } = resolution.data
  const form = await getFeedbackForm(organizationId)

  let ticketContext: { id: string; title: string } | null = null
  if (ticketId) {
    const db = getDb()
    const row = await dbGet(db, 'SELECT Id AS id, Title AS title FROM Tickets WHERE Id = ? LIMIT 1', [ticketId]) as { id?: unknown; title?: unknown } | undefined
    ticketContext = row ? { id: String(row.id), title: String(row.title) } : null
  }

  res.json({ form, ticketContext, isTest })
})

feedbackRouter.post('/public/:token', async (req, res) => {
  const token = String(req.params.token)

  if (!Array.isArray(req.body?.answers)) {
    res.status(400).json({ error: 'invalid_feedback_submission' })
    return
  }

  const answers: FeedbackAnswerInput[] = (req.body.answers as unknown[]).flatMap((a) => {
    if (!a || typeof a !== 'object') return []
    const entry = a as Record<string, unknown>
    const fieldId = typeof entry.fieldId === 'string' ? entry.fieldId.trim() : ''
    const value = typeof entry.value === 'string' ? entry.value.trim() : ''
    if (!fieldId) return []
    return [{ fieldId, value }]
  })

  const result = await submitFeedbackResponse(token, answers)
  if (!result.ok) {
    res.status(result.error === 'invalid' || result.error === 'expired' || result.error === 'used' ? 410 : 400).json({ error: result.error })
    return
  }

  res.json({ ok: true })
})
