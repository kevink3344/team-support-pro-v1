import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import swaggerUi from 'swagger-ui-express'
import * as yaml from 'js-yaml'

import { serverConfig } from './config.js'
import { resolveAnonymousPageConfig, normalizeAnonymousPagePath } from './anonymous-pages.js'
import { listOrganizations } from './directory.js'
import { upsertLocalAccountPersisted } from './local-auth.js'
import { getDb, initDb, dbAll } from './db.js'
import {
  readRapidIdentityEnabled,
  readAboutPageHtml,
  readLoginMode,
  readMaintenanceMessage,
  getLoginModeEnvOverride,
} from './app-settings.js'
import { requireAuth } from './middleware.js'
import { listUsers } from './directory.js'
import { listLocations } from './locations.js'

// Route modules
import { settingsRouter } from './routes/settings.js'
import { settingsTabsRouter } from './routes/settings-tabs.js'
import { webhooksRouter } from './routes/webhooks.js'
import { feedbackRouter } from './routes/feedback.js'
import { anonymousPagesRouter } from './routes/anonymous-pages.js'
import { reportsRouter } from './routes/reports.js'
import { authRouter } from './routes/auth.js'
import { directoryRouter } from './routes/directory.js'
import { dashboardRouter } from './routes/dashboard.js'
import { ticketsRouter, adminTicketsRouter } from './routes/tickets.js'

const app = express()
const currentFilePath = fileURLToPath(import.meta.url)
const currentDirPath = path.dirname(currentFilePath)

const resolveClientDistPath = () => {
  const candidates = [
    path.resolve(currentDirPath, '..'),
    path.resolve(currentDirPath, '../dist'),
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd()),
  ]

  for (const candidate of candidates) {
    const indexPath = path.join(candidate, 'index.html')
    const assetsPath = path.join(candidate, 'assets')
    if (fs.existsSync(indexPath) && fs.existsSync(assetsPath)) {
      return candidate
    }
  }

  return path.resolve(currentDirPath, '..')
}

const clientDistPath = resolveClientDistPath()
const clientIndexPath = path.join(clientDistPath, 'index.html')
const anonIndexPath = path.join(clientDistPath, 'anon', 'index.html')
const feedbackIndexPath = path.join(clientDistPath, 'feedback', 'index.html')
const hasClientBuild = fs.existsSync(clientIndexPath)
const hasAnonBuild = fs.existsSync(anonIndexPath)
const hasFeedbackBuild = fs.existsSync(feedbackIndexPath)

const getAnonymousPagePathFromRequest = (requestPath: string) => {
  if (requestPath === '/anon' || requestPath === '/anon/') {
    return 'index.html'
  }

  const match = requestPath.match(/^\/anon\/([^/]+\.html)$/i)
  return match ? normalizeAnonymousPagePath(match[1]) : null
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || serverConfig.allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }
      callback(new Error('cors_not_allowed'))
    },
    credentials: true,
  }),
)
app.use(express.json())
app.use(cookieParser())

// ---------------------------------------------------------------------------
// Swagger UI
// ---------------------------------------------------------------------------

const swaggerYamlPath = path.resolve(currentDirPath, '../docs/swagger.yaml')
if (fs.existsSync(swaggerYamlPath)) {
  const swaggerDocument = yaml.load(fs.readFileSync(swaggerYamlPath, 'utf8')) as object
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument))
}

// ---------------------------------------------------------------------------
// Public health + auth-settings
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/public/auth-settings', async (_req, res) => {
  const [rapidIdentityEnabled, loginMode, maintenanceMessage] = await Promise.all([
    readRapidIdentityEnabled(),
    readLoginMode(),
    readMaintenanceMessage(),
  ])
  res.json({
    rapidIdentityEnabled,
    superAdminEnabled: serverConfig.superAdminEnabled,
    loginMode,
    maintenanceMessage,
    loginModeOverride: getLoginModeEnvOverride(),
  })
})

app.get('/api/info', async (_req, res) => {
  res.json({
    version: '2.0.1',
    loginModeOverride: getLoginModeEnvOverride(),
    loginMode: await readLoginMode(),
  })
})

app.get('/api/public/test-login-users', async (_req, res) => {

  try {
    const directory = await import('./directory.js')
    const [organizations, teams, users, categories] = await Promise.all([
      listOrganizations(),
      directory.listTeams(),
      listUsers(),
      directory.listCategories(),
    ])

    const db = getDb()
    const activeTicketRows = await dbAll(
      db,
      `SELECT t.OrganizationId AS organizationId, COUNT(*) AS count
       FROM Tickets tk
       JOIN Teams t ON t.Id = tk.TeamId
       WHERE tk.Status IN ('Open', 'In Progress', 'Pending')
       GROUP BY t.OrganizationId`,
    )
    const activeTicketCounts = Object.fromEntries(
      activeTicketRows.map((row) => [String(row.organizationId), Number(row.count)]),
    )

    res.json({ organizations, teams, users, categories, activeTicketCounts })
  } catch (error) {
    console.error('Loading test login users failed.', error)
    res.status(500).json({ error: 'test_login_users_failed' })
  }
})

// ---------------------------------------------------------------------------
// Mount routers
// ---------------------------------------------------------------------------

app.use('/api/settings', settingsRouter)
app.use('/api/settings', settingsTabsRouter)
app.use('/api/settings', webhooksRouter)
app.get('/api/about', requireAuth, async (_req, res) => {
  res.json({ html: await readAboutPageHtml() })
})
app.use('/api/feedback', feedbackRouter)
// Public feedback (re-map /api/public/feedback/:token → feedbackRouter /public/:token)
app.get('/api/public/feedback/:token', (req, res, next) => {
  req.url = `/public/${String(req.params.token)}`
  feedbackRouter(req, res, next)
})
app.post('/api/public/feedback/:token', (req, res, next) => {
  req.url = `/public/${String(req.params.token)}`
  feedbackRouter(req, res, next)
})
app.use('/api/settings/anonymous-pages', anonymousPagesRouter)
app.get('/api/public/anonymous-page-config', (req, res, next) => {
  req.url = '/public-config'
  anonymousPagesRouter(req, res, next)
})
app.use('/api/reports', reportsRouter)
app.use('/auth', authRouter)
app.use('/api/auth', authRouter)
app.use('/api', directoryRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/admin/dashboard', dashboardRouter)
app.use('/api/tickets', ticketsRouter)
app.use('/api/admin/tickets', adminTicketsRouter)
app.post('/api/public/tickets', (req, res, next) => {
  req.url = '/public'
  ticketsRouter(req, res, next)
})
app.get('/api/watchers/my-tickets', (req, res, next) => {
  req.url = '/watchers/my-tickets'
  ticketsRouter(req, res, next)
})

app.get('/api/locations', async (_req, res) => {
  try {
    const locations = await listLocations(true)
    res.json({ locations })
  } catch (error) {
    console.error('Loading locations failed.', error)
    res.status(500).json({ error: 'locations_load_failed' })
  }
})

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

if (hasClientBuild) {
  app.use(express.static(clientDistPath, {
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
      }
    },
  }))

  if (hasAnonBuild) {
    app.get(/^\/anon(?:\/[^/]+\.html)?\/?$/i, async (req, res, next) => {
      const pagePath = getAnonymousPagePathFromRequest(req.path)

      if (!pagePath) {
        next()
        return
      }

      if (pagePath !== 'index.html') {
        const organizations = await listOrganizations()
        const page = resolveAnonymousPageConfig(pagePath, organizations.map((o) => o.id))

        if (!page) {
          res.status(404).send('Anonymous page not found.')
          return
        }
      }

      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
      res.sendFile(anonIndexPath)
    })
  }

  if (hasFeedbackBuild) {
    app.get(/^\/feedback\/[0-9a-f]{64}\/?$/i, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
      res.sendFile(feedbackIndexPath)
    })
  }

  app.get(/^(?!\/api(?:\/|$))(?!\/auth(?:\/|$))(?!\/assets(?:\/|$))(?!.*\.[a-z0-9]+$).*/i, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate')
    res.sendFile(clientIndexPath)
  })
}

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({
      error: error.code === 'LIMIT_FILE_SIZE' ? 'attachment_too_large' : 'attachment_upload_failed',
    })
    return
  }

  if (error instanceof Error && error.message === 'cors_not_allowed') {
    res.status(403).json({ error: 'cors_not_allowed' })
    return
  }

  next(error)
})

// ---------------------------------------------------------------------------
// Bootstrap + start
// ---------------------------------------------------------------------------

const ensureBootstrapAdmin = async () => {
  const db = getDb()
  await db.execute({
    sql: "INSERT INTO AppSettings (Key, Value, UpdatedAt) VALUES ('rapidIdentityEnabled', 'true', datetime('now')) ON CONFLICT(Key) DO NOTHING",
    args: [],
  })

  const adminEmail = serverConfig.localAdmin.email
  const adminPassword = serverConfig.localAdmin.password
  const adminName = serverConfig.localAdmin.name

  if (!adminEmail || !adminPassword) {
    return
  }

  const accountResult = await upsertLocalAccountPersisted(adminName, adminEmail, adminPassword)
  if ('error' in accountResult) {
    console.error('LOCAL_ADMIN_* bootstrap failed for local auth account.', accountResult.error)
    return
  }

  const teamId = serverConfig.fallbackTeam.id || 'it'
  const existingUser = await db.execute({
    sql: 'SELECT Id AS id FROM Users WHERE LOWER(Email) = LOWER(?) LIMIT 1',
    args: [adminEmail],
  }).then((r) => r.rows[0] as { id?: unknown } | undefined)

  if (existingUser?.id) {
    await db.execute({
      sql: "UPDATE Users SET Name = ?, DisplayName = ?, TeamId = ?, Role = 'Admin', UpdatedAt = datetime('now') WHERE Id = ?",
      args: [adminName, adminName, teamId, String(existingUser.id)],
    })
    return
  }

  await db.execute({
    sql: "INSERT INTO Users (Id, Name, DisplayName, Email, TeamId, Role, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?, 'Admin', datetime('now'), datetime('now'))",
    args: ['u-local-admin', adminName, adminName, adminEmail, teamId],
  })
}

const startServer = async () => {
  try {
    await initDb()
  } catch (error) {
    console.error('Database initialization failed.', error)
    process.exit(1)
  }

  try {
    await ensureBootstrapAdmin()
  } catch (error) {
    console.error('Bootstrap admin setup failed.', error)
  }

  console.log(`Client build root resolved to: ${clientDistPath}`)
  console.log(`Client index found: ${hasClientBuild}`)
  console.log(`Anonymous index found: ${hasAnonBuild}`)
  console.log(`Feedback index found: ${hasFeedbackBuild}`)

  app.listen(serverConfig.serverPort, () => {
    console.log(`TeamSupportPro server listening on port ${serverConfig.serverPort}`)
  })
}

void startServer()
