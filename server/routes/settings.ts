import { Router } from 'express'
import { serverConfig } from '../config.js'
import { requireAdmin, requireSuperAdmin } from '../middleware.js'
import {
  readRapidIdentityEnabled,
  writeRapidIdentityEnabled,
  readEmailNotificationsEnabled,
  writeEmailNotificationsEnabled,
  readPowerBiReportUrl,
  writePowerBiReportUrl,
  readAboutPageHtml,
  writeAboutPageHtml,
  normalizeLoginMode,
  getLoginModeEnvOverride,
  readLoginMode,
  readStoredLoginMode,
  writeLoginMode,
  readMaintenanceMessage,
  writeMaintenanceMessage,
  type LoginMode,
} from '../app-settings.js'
import {
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
} from '../locations.js'

export const settingsRouter = Router()

// ---------------------------------------------------------------------------
// Auth settings
// ---------------------------------------------------------------------------

settingsRouter.get('/auth', requireSuperAdmin, async (_req, res) => {
  res.json({ rapidIdentityEnabled: await readRapidIdentityEnabled() })
})

settingsRouter.patch('/auth', requireSuperAdmin, async (req, res) => {
  if (typeof req.body?.rapidIdentityEnabled !== 'boolean') {
    res.status(400).json({ error: 'invalid_auth_settings_payload' })
    return
  }
  await writeRapidIdentityEnabled(req.body.rapidIdentityEnabled)
  res.json({ rapidIdentityEnabled: await readRapidIdentityEnabled() })
})

// ---------------------------------------------------------------------------
// Login mode settings
// ---------------------------------------------------------------------------

settingsRouter.get('/login-mode', requireAdmin, async (_req, res) => {
  const [loginMode, storedLoginMode, maintenanceMessage] = await Promise.all([
    readLoginMode(),
    readStoredLoginMode(),
    readMaintenanceMessage(),
  ])
  res.json({
    loginMode,
    storedLoginMode,
    loginModeOverride: getLoginModeEnvOverride(),
    maintenanceMessage,
  })
})

settingsRouter.patch('/login-mode', requireAdmin, async (req, res) => {
  const hasLoginMode = req.body?.loginMode !== undefined
  const hasMaintenanceMessage = req.body?.maintenanceMessage !== undefined

  if (!hasLoginMode && !hasMaintenanceMessage) {
    res.status(400).json({ error: 'invalid_login_mode_payload' })
    return
  }

  if (hasLoginMode) {
    const nextMode = normalizeLoginMode(req.body.loginMode)
    const raw = String(req.body.loginMode ?? '')
      .trim()
      .toLowerCase()
    if (raw !== 'select' && raw !== 'password' && raw !== 'maintenance') {
      res.status(400).json({ error: 'invalid_login_mode', allowed: ['select', 'password', 'maintenance'] as LoginMode[] })
      return
    }
    await writeLoginMode(nextMode)
  }

  if (hasMaintenanceMessage) {
    if (typeof req.body.maintenanceMessage !== 'string') {
      res.status(400).json({ error: 'invalid_maintenance_message' })
      return
    }
    await writeMaintenanceMessage(req.body.maintenanceMessage)
  }

  const [loginMode, storedLoginMode, maintenanceMessage] = await Promise.all([
    readLoginMode(),
    readStoredLoginMode(),
    readMaintenanceMessage(),
  ])
  res.json({
    loginMode,
    storedLoginMode,
    loginModeOverride: getLoginModeEnvOverride(),
    maintenanceMessage,
  })
})

// ---------------------------------------------------------------------------
// Email settings
// ---------------------------------------------------------------------------


settingsRouter.get('/email', requireSuperAdmin, async (_req, res) => {
  const { resendApiKey, from, replyTo, gmailUser, gmailAppPassword, pollIntervalMs } = serverConfig.email
  res.json({
    enabled: await readEmailNotificationsEnabled(),
    from: from || null,
    replyTo: replyTo || null,
    pollIntervalSeconds: Math.round(pollIntervalMs / 1000),
    configured: !!(resendApiKey && from),
    imapConfigured: !!(gmailUser && gmailAppPassword),
  })
})

settingsRouter.patch('/email', requireSuperAdmin, async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') {
    res.status(400).json({ error: 'invalid_email_settings_payload' })
    return
  }
  await writeEmailNotificationsEnabled(req.body.enabled)
  res.json({ enabled: await readEmailNotificationsEnabled() })
})

settingsRouter.post('/email/test-resend', requireSuperAdmin, async (_req, res) => {
  const { resendApiKey, from, replyTo, testTo } = serverConfig.email
  if (!resendApiKey || !from) {
    res.status(400).json({ ok: false, error: 'RESEND_API_KEY and EMAIL_FROM must be set in environment variables.' })
    return
  }
  const sendTo = testTo || replyTo
  if (!sendTo) {
    res.status(400).json({ ok: false, error: 'EMAIL_TEST_TO or EMAIL_REPLY_TO must be set to a recipient address.' })
    return
  }
  try {
    const { Resend } = await import('resend')
    const resend = new Resend(resendApiKey)
    const { data, error } = await resend.emails.send({
      from,
      replyTo: replyTo || undefined,
      to: sendTo,
      subject: '[TKT-TEST] TeamSupportPro — Resend connectivity test',
      text: 'This is an automated connectivity test from TeamSupportPro. If you received this, Resend is configured correctly.',
    })
    if (error) {
      res.json({ ok: false, error: (error as { message?: string }).message ?? 'Resend returned an error.' })
      return
    }
    res.json({ ok: true, messageId: data?.id, sentTo: sendTo })
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error sending test email.' })
  }
})

settingsRouter.post('/email/test-imap', requireSuperAdmin, async (_req, res) => {
  const { gmailUser, gmailAppPassword } = serverConfig.email
  if (!gmailUser || !gmailAppPassword) {
    res.status(400).json({ ok: false, error: 'GMAIL_USER and GMAIL_APP_PASSWORD must be set in environment variables.' })
    return
  }
  try {
    const { ImapFlow } = await import('imapflow')
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: gmailUser, pass: gmailAppPassword },
      logger: false,
    })
    try {
      await client.connect()
      const status = await client.status('INBOX', { messages: true, unseen: true })
      await client.logout()
      res.json({ ok: true, messages: status.messages, unseen: status.unseen, account: gmailUser })
    } catch (err) {
      client.close()
      const imapErr = err as { message?: string; responseText?: string; responseStatus?: string }
      const detail = imapErr.responseText ?? imapErr.message ?? 'Unknown error connecting to Gmail IMAP.'
      const status = imapErr.responseStatus ? `[${imapErr.responseStatus}] ` : ''
      res.json({ ok: false, error: `${status}${detail}` })
    }
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load IMAP module.' })
  }
})

// ---------------------------------------------------------------------------
// Power BI settings
// ---------------------------------------------------------------------------

settingsRouter.get('/power-bi', requireAdmin, async (_req, res) => {
  res.json({ reportUrl: await readPowerBiReportUrl() })
})

settingsRouter.patch('/power-bi', requireAdmin, async (req, res) => {
  const reportUrl = req.body?.reportUrl
  if (reportUrl !== null && reportUrl !== undefined && typeof reportUrl !== 'string') {
    res.status(400).json({ error: 'invalid_power_bi_settings_payload' })
    return
  }
  await writePowerBiReportUrl(typeof reportUrl === 'string' ? reportUrl : null)
  res.json({ reportUrl: await readPowerBiReportUrl() })
})

// ---------------------------------------------------------------------------
// About page settings
// ---------------------------------------------------------------------------

settingsRouter.get('/about', requireSuperAdmin, async (_req, res) => {
  res.json({ html: await readAboutPageHtml() })
})

settingsRouter.patch('/about', requireSuperAdmin, async (req, res) => {
  const html = req.body?.html
  if (typeof html !== 'string') {
    res.status(400).json({ error: 'invalid_about_page_payload' })
    return
  }
  await writeAboutPageHtml(html)
  res.json({ html: await readAboutPageHtml() })
})

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

settingsRouter.get('/locations', requireAdmin, async (_req, res) => {
  try {
    const locations = await listLocations(false)
    res.json({ locations })
  } catch (error) {
    console.error('Loading locations failed.', error)
    res.status(500).json({ error: 'locations_load_failed' })
  }
})

settingsRouter.post('/locations', requireAdmin, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  const sortOrder = typeof req.body?.sortOrder === 'number' ? req.body.sortOrder : 0
  if (!name.trim()) {
    res.status(400).json({ error: 'location_name_required' })
    return
  }
  try {
    const location = await createLocation(name, sortOrder)
    if (!location) {
      res.status(409).json({ error: 'location_name_conflict' })
      return
    }
    res.status(201).json({ location })
  } catch (error) {
    console.error('Creating location failed.', error)
    res.status(500).json({ error: 'location_create_failed' })
  }
})

settingsRouter.patch('/locations/:locationId', requireAdmin, async (req, res) => {
  const id = typeof req.params.locationId === 'string' ? req.params.locationId : ''
  if (!id) {
    res.status(400).json({ error: 'invalid_location_id' })
    return
  }
  const patch: { name?: string; isActive?: boolean; sortOrder?: number } = {}
  if (typeof req.body?.name === 'string') patch.name = req.body.name
  if (typeof req.body?.isActive === 'boolean') patch.isActive = req.body.isActive
  if (typeof req.body?.sortOrder === 'number') patch.sortOrder = req.body.sortOrder
  try {
    const location = await updateLocation(id, patch)
    if (!location) {
      res.status(400).json({ error: 'location_update_failed' })
      return
    }
    res.json({ location })
  } catch (error) {
    console.error('Updating location failed.', error)
    res.status(500).json({ error: 'location_update_failed' })
  }
})

settingsRouter.delete('/locations/:locationId', requireAdmin, async (req, res) => {
  const id = typeof req.params.locationId === 'string' ? req.params.locationId : ''
  if (!id) {
    res.status(400).json({ error: 'invalid_location_id' })
    return
  }
  try {
    const result = await deleteLocation(id)
    if (result.inUse) {
      res.status(409).json({ error: 'location_in_use' })
      return
    }
    if (!result.deleted) {
      res.status(404).json({ error: 'location_not_found' })
      return
    }
    res.status(204).end()
  } catch (error) {
    console.error('Deleting location failed.', error)
    res.status(500).json({ error: 'location_delete_failed' })
  }
})
