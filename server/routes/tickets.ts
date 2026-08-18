import multer from 'multer'
import { Router } from 'express'
import { requireAuth, requireAdmin, isAdminUser } from '../middleware.js'
import {
  createTicket,
  createTicketComment,
  deleteTicket,
  getTicketById,
  listTicketActivity,
  listTicketVersions,
  listTickets,
  revertTicketToVersion,
  updateTicket,
  listTicketWatchers,
  addTicketWatcher,
  removeTicketWatcher,
  listWatchedTicketIds,
  upsertCustomFieldValues,
  userCanAccessTicket,
  userCanUseTeam,
} from '../tickets.js'
import { seedRandomTickets } from '../ticket-seeding.js'
import {
  createTicketAttachment,
  deleteTicketAttachment,
  getTicketAttachmentById,
  listTicketAttachments,
} from '../attachments.js'
import {
  listOrganizations,
  listTeams,
  listCategories,
} from '../directory.js'
import {
  resolveAnonymousPageConfig,
} from '../anonymous-pages.js'
import {
  dispatchWebhookEvent,
  type WebhookEvent,
} from '../webhooks.js'
import { maybeSendFeedbackEmail } from '../feedback.js'
import { getDb } from '../db.js'

export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

export const ticketsRouter = Router()

// ---------------------------------------------------------------------------
// Ticket list + activity
// ---------------------------------------------------------------------------

ticketsRouter.get('/', requireAuth, async (req, res) => {
  const user = req.user!

  try {
    const tickets = await listTickets(
      user.canViewAllOrgTickets ? { organizationId: user.organizationId } : { teamId: user.teamId },
    )
    res.json({ tickets })
  } catch (error) {
    console.error('Loading tickets failed.', error)
    res.status(500).json({ error: 'ticket_load_failed' })
  }
})

ticketsRouter.get('/activity', requireAuth, async (req, res) => {
  const user = req.user!

  try {
    const tickets = await listTickets(
      user.canViewAllOrgTickets ? { organizationId: user.organizationId } : { teamId: user.teamId },
    )
    const ticketIds = new Set(tickets.map((t) => t.id))
    const activity = (await listTicketActivity()).filter((e) => ticketIds.has(e.ticketId))
    res.json({ activity })
  } catch (error) {
    console.error('Loading ticket activity failed.', error)
    res.status(500).json({ error: 'ticket_activity_load_failed' })
  }
})

// ---------------------------------------------------------------------------
// Create ticket (authenticated)
// ---------------------------------------------------------------------------

ticketsRouter.post('/', requireAuth, async (req, res) => {
  const user = req.user!

  const teamId = typeof req.body?.teamId === 'string' ? req.body.teamId : ''
  if (!teamId || !(await userCanUseTeam(teamId, user))) {
    res.status(403).json({ error: 'cross_team_ticket_create_forbidden' })
    return
  }

  try {
    const ticket = await createTicket(
      {
        title: typeof req.body?.title === 'string' ? req.body.title : '',
        description: typeof req.body?.description === 'string' ? req.body.description : '',
        status: typeof req.body?.status === 'string' ? req.body.status : 'Open',
        priority: typeof req.body?.priority === 'string' ? req.body.priority : '',
        teamId,
        categoryId: typeof req.body?.categoryId === 'string' ? req.body.categoryId : '',
        assignedToId:
          typeof req.body?.assignedToId === 'string' && req.body.assignedToId.trim()
            ? req.body.assignedToId
            : null,
        requestorName: typeof req.body?.requestorName === 'string' ? req.body.requestorName : '',
        requestorEmail: typeof req.body?.requestorEmail === 'string' ? req.body.requestorEmail : '',
        location: typeof req.body?.location === 'string' ? req.body.location : '',
        customFields: Array.isArray(req.body?.customFields)
          ? (req.body.customFields as unknown[]).flatMap((cf) => {
              if (!cf || typeof cf !== 'object') return []
              const entry = cf as Record<string, unknown>
              const fieldId = typeof entry.fieldId === 'string' ? entry.fieldId.trim() : ''
              if (!fieldId) return []
              return [{ fieldId, value: typeof entry.value === 'string' ? entry.value : String(entry.value ?? '') }]
            })
          : [],
      },
      user.name,
    )

    if (!ticket) {
      res.status(400).json({ error: 'ticket_create_failed' })
      return
    }

    void dispatchWebhookEvent(user.organizationId, 'ticket.created', { ticket })
    if (ticket.assignedToId) {
      void dispatchWebhookEvent(user.organizationId, 'ticket.assigned', { ticket })
    }

    res.status(201).json({ ticket })
  } catch (error) {
    console.error('Creating ticket failed.', error)
    res.status(500).json({ error: 'ticket_create_failed' })
  }
})

// ---------------------------------------------------------------------------
// Public ticket submission (anonymous)
// ---------------------------------------------------------------------------

ticketsRouter.post('/public', async (req, res) => {
  const pagePath = typeof req.body?.pagePath === 'string' ? req.body.pagePath : 'index.html'
  const teamId = typeof req.body?.teamId === 'string' ? req.body.teamId.trim() : ''
  const categoryId = typeof req.body?.categoryId === 'string' ? req.body.categoryId.trim() : ''
  const title = typeof req.body?.title === 'string' ? req.body.title : ''
  const description = typeof req.body?.description === 'string' ? req.body.description : ''
  const requestorName = typeof req.body?.requestorName === 'string' ? req.body.requestorName : ''
  const requestorEmail = typeof req.body?.requestorEmail === 'string' ? req.body.requestorEmail : ''
  const location = typeof req.body?.location === 'string' ? req.body.location : ''

  if (!teamId || !categoryId) {
    res.status(400).json({ error: 'invalid_public_ticket_scope' })
    return
  }

  try {
    const [organizations, teams, categories] = await Promise.all([
      listOrganizations(),
      listTeams(),
      listCategories(),
    ])
    const page = await resolveAnonymousPageConfig(pagePath, organizations.map((o) => o.id))
    const team = teams.find((t) => t.id === teamId)
    const category = categories.find((c) => c.id === categoryId)

    if (!page || !team || !category || category.teamId !== team.id || team.organizationId !== page.organizationId) {
      res.status(400).json({ error: 'invalid_public_ticket_scope' })
      return
    }

    const ticket = await createTicket(
      { title, description, status: 'Open', priority: 'Medium', teamId, categoryId, assignedToId: null, requestorName, requestorEmail, location },
      'Anonymous Request',
    )

    if (!ticket) {
      res.status(400).json({ error: 'public_ticket_create_failed' })
      return
    }

    res.status(201).json({ ticket })
  } catch (error) {
    console.error('Creating anonymous ticket failed.', error)
    res.status(500).json({ error: 'public_ticket_create_failed' })
  }
})

// ---------------------------------------------------------------------------
// Single ticket CRUD
// ---------------------------------------------------------------------------

ticketsRouter.get('/:ticketId', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''

  if (!ticketId || !(await userCanAccessTicket(ticketId, user))) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }

  const ticket = await getTicketById(ticketId)
  if (!ticket) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }

  res.json({ ticket })
})

ticketsRouter.patch('/:ticketId', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''

  if (!ticketId) {
    res.status(400).json({ error: 'invalid_ticket_id' })
    return
  }

  if (!(await userCanAccessTicket(ticketId, user))) {
    res.status(403).json({ error: 'cross_team_ticket_update_forbidden' })
    return
  }

  const newTeamId = typeof req.body?.teamId === 'string' && req.body.teamId.trim() ? req.body.teamId.trim() : user.teamId
  if (!(await userCanUseTeam(newTeamId, user))) {
    res.status(403).json({ error: 'cross_org_team_reassign_forbidden' })
    return
  }

  try {
    const existingTicket = await getTicketById(ticketId)
    const wasAlreadyResolved = existingTicket?.resolvedAt != null

    const ticket = await updateTicket(
      ticketId,
      {
        teamId: newTeamId,
        title: typeof req.body?.title === 'string' ? req.body.title : '',
        description: typeof req.body?.description === 'string' ? req.body.description : '',
        status: typeof req.body?.status === 'string' ? req.body.status : '',
        priority: typeof req.body?.priority === 'string' ? req.body.priority : '',
        categoryId: typeof req.body?.categoryId === 'string' ? req.body.categoryId : '',
        assignedToId:
          typeof req.body?.assignedToId === 'string' && req.body.assignedToId.trim()
            ? req.body.assignedToId
            : null,
        requestorName: typeof req.body?.requestorName === 'string' ? req.body.requestorName : '',
        requestorEmail: typeof req.body?.requestorEmail === 'string' ? req.body.requestorEmail : '',
        location: typeof req.body?.location === 'string' ? req.body.location : '',
      },
      user.name,
    )

    if (!ticket) {
      res.status(400).json({ error: 'ticket_update_failed' })
      return
    }

    if (Array.isArray(req.body?.customFields)) {
      const cfInputs = (req.body.customFields as unknown[]).flatMap((cf) => {
        if (!cf || typeof cf !== 'object') return []
        const entry = cf as Record<string, unknown>
        const fieldId = typeof entry.fieldId === 'string' ? entry.fieldId.trim() : ''
        if (!fieldId) return []
        return [{ fieldId, value: typeof entry.value === 'string' ? entry.value : String(entry.value ?? '') }]
      })
      if (cfInputs.length) {
        await upsertCustomFieldValues(ticketId, user.organizationId, cfInputs)
      }
    }

    if (!wasAlreadyResolved && ticket.resolvedAt != null) {
      void maybeSendFeedbackEmail(ticket, user.organizationId)
    }

    const refreshed = await getTicketById(ticketId)
    const finalTicket = refreshed ?? ticket

    void dispatchWebhookEvent(user.organizationId, 'ticket.updated', { ticket: finalTicket })
    if (existingTicket && existingTicket.assignedToId !== finalTicket.assignedToId && finalTicket.assignedToId) {
      void dispatchWebhookEvent(user.organizationId, 'ticket.assigned', { ticket: finalTicket })
    }
    if (!wasAlreadyResolved && finalTicket.resolvedAt != null) {
      const resolvedEvent: WebhookEvent = finalTicket.status === 'Closed' ? 'ticket.closed' : 'ticket.resolved'
      void dispatchWebhookEvent(user.organizationId, resolvedEvent, { ticket: finalTicket })
    }

    res.json({ ticket: finalTicket })
  } catch (error) {
    console.error('Updating ticket failed.', error)
    res.status(500).json({ error: 'ticket_update_failed' })
  }
})

ticketsRouter.delete('/:ticketId', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''

  if (!ticketId) {
    res.status(400).json({ error: 'invalid_ticket_id' })
    return
  }

  if (!(await userCanAccessTicket(ticketId, user))) {
    res.status(403).json({ error: 'cross_team_ticket_delete_forbidden' })
    return
  }

  try {
    const deleted = await deleteTicket(ticketId)
    if (!deleted) {
      res.status(404).json({ error: 'ticket_not_found' })
      return
    }
    res.status(204).end()
  } catch (error) {
    console.error('Deleting ticket failed.', error)
    res.status(500).json({ error: 'ticket_delete_failed' })
  }
})

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

ticketsRouter.post('/:ticketId/comments', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''

  if (!ticketId || !message) {
    res.status(400).json({ error: 'invalid_comment_payload' })
    return
  }

  if (!(await userCanAccessTicket(ticketId, user))) {
    res.status(403).json({ error: 'cross_team_ticket_comment_forbidden' })
    return
  }

  try {
    const comment = await createTicketComment({ ticketId, actor: user.name, message })
    res.status(201).json({ comment })
  } catch (error) {
    console.error('Creating ticket comment failed.', error)
    res.status(500).json({ error: 'ticket_comment_create_failed' })
  }
})

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

ticketsRouter.get('/:ticketId/attachments', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''

  if (!ticketId || !(await userCanAccessTicket(ticketId, user))) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }

  try {
    const attachments = await listTicketAttachments(ticketId)
    res.json({ attachments })
  } catch (error) {
    console.error('Loading attachments failed.', error)
    res.status(500).json({ error: 'attachment_load_failed' })
  }
})

ticketsRouter.post('/:ticketId/attachments', attachmentUpload.single('file'), requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''

  if (!ticketId || !(await userCanAccessTicket(ticketId, user))) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }

  if (!req.file) {
    res.status(400).json({ error: 'missing_attachment_file' })
    return
  }

  try {
    const attachment = await createTicketAttachment({
      ticketId,
      fileName: req.file.originalname,
      contentType: req.file.mimetype,
      fileSizeBytes: req.file.size,
      fileContent: req.file.buffer,
      uploadedByUserId: user.id,
      uploadedByName: user.name,
    })

    if (!attachment) {
      res.status(400).json({ error: 'attachment_create_failed' })
      return
    }

    res.status(201).json({ attachment })
  } catch (error) {
    console.error('Uploading attachment failed.', error)
    res.status(500).json({ error: 'attachment_create_failed' })
  }
})

ticketsRouter.get('/:ticketId/attachments/:attachmentId', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''
  const attachmentId = typeof req.params.attachmentId === 'string' ? req.params.attachmentId : ''
  const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment'

  if (!ticketId || !attachmentId || !(await userCanAccessTicket(ticketId, user))) {
    res.status(404).json({ error: 'attachment_not_found' })
    return
  }

  try {
    const attachment = await getTicketAttachmentById(ticketId, attachmentId)
    if (!attachment) {
      res.status(404).json({ error: 'attachment_not_found' })
      return
    }

    res.setHeader('Content-Type', attachment.contentType)
    res.setHeader('Content-Length', String(attachment.fileSizeBytes))
    res.setHeader('Content-Disposition', `${disposition}; filename="${attachment.fileName.replace(/"/g, '')}"`)
    res.send(attachment.fileContent)
  } catch (error) {
    console.error('Downloading attachment failed.', error)
    res.status(500).json({ error: 'attachment_download_failed' })
  }
})

ticketsRouter.delete('/:ticketId/attachments/:attachmentId', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''
  const attachmentId = typeof req.params.attachmentId === 'string' ? req.params.attachmentId : ''

  if (!ticketId || !attachmentId || !(await userCanAccessTicket(ticketId, user))) {
    res.status(404).json({ error: 'attachment_not_found' })
    return
  }

  try {
    const deleted = await deleteTicketAttachment(ticketId, attachmentId, user.id, user.name)
    if (!deleted) {
      res.status(404).json({ error: 'attachment_not_found' })
      return
    }
    res.status(204).end()
  } catch (error) {
    console.error('Deleting attachment failed.', error)
    res.status(500).json({ error: 'attachment_delete_failed' })
  }
})

// ---------------------------------------------------------------------------
// Watchers
// ---------------------------------------------------------------------------

ticketsRouter.get('/watchers/my-tickets', requireAuth, async (req, res) => {
  const user = req.user!
  res.json({ ticketIds: await listWatchedTicketIds(user.id) })
})

ticketsRouter.get('/:ticketId/watchers', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''

  if (!ticketId || !(await userCanAccessTicket(ticketId, user))) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }
  res.json({ watchers: await listTicketWatchers(ticketId) })
})

ticketsRouter.post('/:ticketId/watchers', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''
  const targetUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : ''

  if (!ticketId || !targetUserId) {
    res.status(400).json({ error: 'invalid_params' })
    return
  }

  if (!(await userCanAccessTicket(ticketId, user))) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }

  const db = getDb()
  const targetUserResult = await db.execute({ sql: 'SELECT OrganizationId FROM Users WHERE Id = ?', args: [targetUserId] })
  const targetUser = targetUserResult.rows[0] as { OrganizationId?: unknown } | undefined

  if (!targetUser || String(targetUser.OrganizationId) !== user.organizationId) {
    res.status(403).json({ error: 'cross_org_watcher_forbidden' })
    return
  }

  await addTicketWatcher(ticketId, targetUserId)
  res.json({ watchers: await listTicketWatchers(ticketId) })
})

ticketsRouter.delete('/:ticketId/watchers/:userId', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''
  const targetUserId = typeof req.params.userId === 'string' ? req.params.userId : ''

  if (!ticketId || !targetUserId) {
    res.status(400).json({ error: 'invalid_params' })
    return
  }

  if (!(await userCanAccessTicket(ticketId, user))) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }

  if (targetUserId !== user.id && !isAdminUser(user)) {
    res.status(403).json({ error: 'remove_watcher_forbidden' })
    return
  }

  await removeTicketWatcher(ticketId, targetUserId)
  res.json({ watchers: await listTicketWatchers(ticketId) })
})

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

ticketsRouter.get('/:ticketId/versions', requireAuth, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''

  if (!ticketId || !(await userCanAccessTicket(ticketId, user))) {
    res.status(404).json({ error: 'ticket_not_found' })
    return
  }

  try {
    const versions = await listTicketVersions(ticketId)
    res.json({ versions })
  } catch (error) {
    console.error('Loading ticket versions failed.', error)
    res.status(500).json({ error: 'ticket_versions_load_failed' })
  }
})

ticketsRouter.post('/:ticketId/versions/:versionId/revert', requireAdmin, async (req, res) => {
  const user = req.user!
  const ticketId = typeof req.params.ticketId === 'string' ? req.params.ticketId : ''
  const versionId = typeof req.params.versionId === 'string' ? req.params.versionId : ''

  if (!ticketId || !versionId) {
    res.status(400).json({ error: 'invalid_params' })
    return
  }

  if (!(await userCanAccessTicket(ticketId, user))) {
    res.status(403).json({ error: 'cross_team_ticket_revert_forbidden' })
    return
  }

  try {
    const ticket = await revertTicketToVersion(ticketId, versionId, user.name)
    if (!ticket) {
      res.status(404).json({ error: 'ticket_version_not_found' })
      return
    }
    res.json({ ticket })
  } catch (error) {
    console.error('Reverting ticket failed.', error)
    res.status(500).json({ error: 'ticket_revert_failed' })
  }
})

// ---------------------------------------------------------------------------
// Admin ticket seeding
// ---------------------------------------------------------------------------

export const adminTicketsRouter = Router()

adminTicketsRouter.post('/seed', requireAdmin, async (req, res) => {
  const user = req.user!
  const assignToStaff = req.body?.assignToStaff === true
  const teamId =
    typeof req.body?.teamId === 'string' && req.body.teamId.trim().length > 0
      ? req.body.teamId.trim()
      : undefined

  try {
    const tickets = await seedRandomTickets({
      organizationId: user.organizationId,
      actor: user.name,
      assignToStaff,
      teamId,
    })
    res.status(201).json({ tickets })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'organization_not_found') {
      res.status(400).json({ error: 'organization_not_found' })
      return
    }
    if (message === 'organization_has_no_teams') {
      res.status(400).json({ error: 'organization_has_no_teams' })
      return
    }
    if (message === 'team_not_found') {
      res.status(400).json({ error: 'team_not_found' })
      return
    }
    if (message === 'organization_has_no_categories') {
      res.status(400).json({ error: 'organization_has_no_categories' })
      return
    }
    console.error('Seeding random tickets failed.', error)
    res.status(500).json({ error: 'ticket_seed_failed' })
  }
})
