import { Router, type RequestHandler } from 'express'
import {
  buildCookieOptions,
  createSessionToken,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from '../auth.js'
import { requireAuth, requireAdmin, requireSuperAdmin } from '../middleware.js'
import {
  createOrganization,
  createCategory,
  createTeam,
  createUser,
  deleteOrganization,
  deleteCategory,
  deleteTeam,
  deleteUser,
  getOrganizationById,
  getCategoryById,
  getTeamById,
  getUserById,
  listOrganizations,
  listCategories,
  listTeams,
  listUsers,
  loadDirectoryData,
  updateOrganization,
  updateCategory,
  updateTeam,
  updateUser,
} from '../directory.js'
import {
  getTicketFieldDefinitions,
  saveTicketFieldDefinitions,
  type TicketFieldDefinition,
} from '../ticket-designer.js'
import {
  getTicketLayout,
  saveTicketLayout,
  listTicketLayoutVersions,
  revertTicketLayoutToVersion,
  deleteTicketLayoutVersion,
  type TicketLayout,
} from '../ticket-layout.js'
import { registerLocalAccountPersisted } from '../local-auth.js'
import { serverConfig } from '../config.js'

export const directoryRouter = Router()

// ---------------------------------------------------------------------------
// Directory (full dataset for the app shell)
// ---------------------------------------------------------------------------

const directoryLoadHandler: RequestHandler = async (req, res) => {
  try {
    const user = req.user!
    const orgFilter = user.role === 'Super Admin' ? undefined : user.organizationId
    const directory = await loadDirectoryData(orgFilter)
    res.json(directory)
  } catch (error) {
    console.error('Loading directory data failed.', error)
    res.status(500).json({ error: 'directory_load_failed' })
  }
}

directoryRouter.get('/', requireAuth, directoryLoadHandler)
directoryRouter.get('/directory', requireAuth, directoryLoadHandler)

directoryRouter.get('/public', async (_req, res) => {
  try {
    const [organizations, teams, categories] = await Promise.all([listOrganizations(), listTeams(), listCategories()])
    res.json({ organizations, teams, categories })
  } catch (error) {
    console.error('Loading public directory data failed.', error)
    res.status(500).json({ error: 'public_directory_load_failed' })
  }
})

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

directoryRouter.get('/organizations', requireAuth, async (req, res) => {
  try {
    const user = req.user!
    const organizationId = user.role === 'Super Admin' ? undefined : user.organizationId
    res.json({ organizations: await listOrganizations(organizationId) })
  } catch (error) {
    console.error('Loading organizations failed.', error)
    res.status(500).json({ error: 'organization_load_failed' })
  }
})

directoryRouter.get('/organizations/:organizationId', requireAuth, async (req, res) => {

  const organization = await getOrganizationById(String(req.params.organizationId))
  if (!organization) {
    res.status(404).json({ error: 'organization_not_found' })
    return
  }

  res.json({ organization })
})

directoryRouter.post('/organizations', requireSuperAdmin, async (req, res) => {

  try {
    const organization = await createOrganization({
      id: typeof req.body?.id === 'string' ? req.body.id : undefined,
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      code: typeof req.body?.code === 'string' ? req.body.code : '',
      accent: typeof req.body?.accent === 'string' ? req.body.accent : '',
    })

    if (!organization) {
      res.status(400).json({ error: 'organization_create_failed' })
      return
    }

    res.status(201).json({ organization })
  } catch (error) {
    console.error('Creating organization failed.', error)
    res.status(500).json({ error: 'organization_create_failed' })
  }
})

directoryRouter.patch('/organizations/:organizationId', requireSuperAdmin, async (req, res) => {

  try {
    const organization = await updateOrganization(String(req.params.organizationId), {
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      code: typeof req.body?.code === 'string' ? req.body.code : '',
      accent: typeof req.body?.accent === 'string' ? req.body.accent : '',
    })

    if (!organization) {
      res.status(400).json({ error: 'organization_update_failed' })
      return
    }

    res.json({ organization })
  } catch (error) {
    console.error('Updating organization failed.', error)
    res.status(500).json({ error: 'organization_update_failed' })
  }
})

directoryRouter.delete('/organizations/:organizationId', requireSuperAdmin, async (req, res) => {

  try {
    const deleted = await deleteOrganization(String(req.params.organizationId))
    if (!deleted) {
      res.status(400).json({ error: 'organization_delete_failed' })
      return
    }
    res.status(204).end()
  } catch (error) {
    console.error('Deleting organization failed.', error)
    res.status(500).json({ error: 'organization_delete_failed' })
  }
})

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

directoryRouter.get('/teams', requireAuth, async (req, res) => {
  try {
    const orgFilter = req.user!.role === 'Super Admin' ? undefined : req.user!.organizationId
    res.json({ teams: await listTeams(orgFilter) })
  } catch (error) {
    console.error('Loading teams failed.', error)
    res.status(500).json({ error: 'team_load_failed' })
  }
})

directoryRouter.get('/teams/:teamId', requireAuth, async (req, res) => {

  const team = await getTeamById(String(req.params.teamId))
  if (!team) {
    res.status(404).json({ error: 'team_not_found' })
    return
  }
  res.json({ team })
})

directoryRouter.post('/teams', requireAdmin, async (req, res) => {

  try {
    const team = await createTeam({
      id: typeof req.body?.id === 'string' ? req.body.id : undefined,
      organizationId: typeof req.body?.organizationId === 'string' ? req.body.organizationId : '',
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      code: typeof req.body?.code === 'string' ? req.body.code : '',
      accent: typeof req.body?.accent === 'string' ? req.body.accent : '',
    })

    if (!team) {
      res.status(400).json({ error: 'team_create_failed' })
      return
    }

    res.status(201).json({ team })
  } catch (error) {
    console.error('Creating team failed.', error)
    res.status(500).json({ error: 'team_create_failed' })
  }
})

directoryRouter.patch('/teams/:teamId', requireAdmin, async (req, res) => {

  try {
    const team = await updateTeam(String(req.params.teamId), {
      organizationId: typeof req.body?.organizationId === 'string' ? req.body.organizationId : '',
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      code: typeof req.body?.code === 'string' ? req.body.code : '',
      accent: typeof req.body?.accent === 'string' ? req.body.accent : '',
    })

    if (!team) {
      res.status(400).json({ error: 'team_update_failed' })
      return
    }

    res.json({ team })
  } catch (error) {
    console.error('Updating team failed.', error)
    res.status(500).json({ error: 'team_update_failed' })
  }
})

directoryRouter.delete('/teams/:teamId', requireAdmin, async (req, res) => {

  try {
    const deleted = await deleteTeam(String(req.params.teamId))
    if (!deleted) {
      res.status(404).json({ error: 'team_not_found' })
      return
    }
    res.status(204).end()
  } catch (error) {
    console.error('Deleting team failed.', error)
    res.status(500).json({ error: 'team_delete_failed' })
  }
})

// ---------------------------------------------------------------------------
// Ticket field definitions (per-organization)
// ---------------------------------------------------------------------------

directoryRouter.get('/organizations/:organizationId/ticket-fields', requireAuth, async (req, res) => {
  const fields = await getTicketFieldDefinitions(String(req.params.organizationId))
  res.json({ fields })
})

directoryRouter.put('/organizations/:organizationId/ticket-fields', requireAdmin, async (req, res) => {
  if (!Array.isArray(req.body?.fields)) {
    res.status(400).json({ error: 'invalid_ticket_fields_payload' })
    return
  }
  const fields = await saveTicketFieldDefinitions(String(req.params.organizationId), req.body.fields as Array<Partial<TicketFieldDefinition>>)
  res.json({ fields })
})

// ---------------------------------------------------------------------------
// Ticket layout (per-organization)
// ---------------------------------------------------------------------------

directoryRouter.get('/organizations/:organizationId/ticket-layout', requireAuth, async (req, res) => {
  const layout = await getTicketLayout(String(req.params.organizationId))
  res.json({ layout })
})

directoryRouter.put('/organizations/:organizationId/ticket-layout', requireAdmin, async (req, res) => {
  if (!req.body?.layout || typeof req.body.layout !== 'object') {
    res.status(400).json({ error: 'invalid_ticket_layout_payload' })
    return
  }
  try {
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : ''
    const result = await saveTicketLayout(String(req.params.organizationId), req.body.layout as TicketLayout, description)
    res.json(result)
  } catch (error) {
    console.error('Saving ticket layout failed.', error)
    res.status(500).json({ error: 'ticket_layout_save_failed' })
  }
})

directoryRouter.get('/organizations/:organizationId/ticket-layout/versions', requireAdmin, async (req, res) => {
  try {
    const versions = await listTicketLayoutVersions(String(req.params.organizationId))
    res.json({ versions })
  } catch (error) {
    console.error('Loading ticket layout versions failed.', error)
    res.status(500).json({ error: 'ticket_layout_versions_load_failed' })
  }
})

directoryRouter.post('/organizations/:organizationId/ticket-layout/versions/:versionId/revert', requireAdmin, async (req, res) => {
  try {
    const version = await revertTicketLayoutToVersion(String(req.params.organizationId), String(req.params.versionId))
    if (!version) {
      res.status(404).json({ error: 'ticket_layout_version_not_found' })
      return
    }
    res.json({ version })
  } catch (error) {
    console.error('Reverting ticket layout failed.', error)
    res.status(500).json({ error: 'ticket_layout_revert_failed' })
  }
})

directoryRouter.delete('/organizations/:organizationId/ticket-layout/versions/:versionId', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteTicketLayoutVersion(String(req.params.organizationId), String(req.params.versionId))
    if (!deleted) {
      res.status(404).json({ error: 'ticket_layout_version_not_found' })
      return
    }
    res.status(204).end()
  } catch (error) {
    console.error('Deleting ticket layout version failed.', error)
    res.status(500).json({ error: 'ticket_layout_version_delete_failed' })
  }
})

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

directoryRouter.get('/categories', requireAuth, async (req, res) => {
  try {
    const orgFilter = req.user!.role === 'Super Admin' ? undefined : req.user!.organizationId
    res.json({ categories: await listCategories(orgFilter) })
  } catch (error) {
    console.error('Loading categories failed.', error)
    res.status(500).json({ error: 'category_load_failed' })
  }
})

directoryRouter.get('/categories/:categoryId', requireAuth, async (req, res) => {

  const category = await getCategoryById(String(req.params.categoryId))
  if (!category) {
    res.status(404).json({ error: 'category_not_found' })
    return
  }
  res.json({ category })
})

directoryRouter.post('/categories', requireAdmin, async (req, res) => {

  try {
    const category = await createCategory({
      id: typeof req.body?.id === 'string' ? req.body.id : undefined,
      teamId: typeof req.body?.teamId === 'string' ? req.body.teamId : '',
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      description: typeof req.body?.description === 'string' ? req.body.description : '',
    })

    if (!category) {
      res.status(400).json({ error: 'category_create_failed' })
      return
    }

    res.status(201).json({ category })
  } catch (error) {
    console.error('Creating category failed.', error)
    res.status(500).json({ error: 'category_create_failed' })
  }
})

directoryRouter.patch('/categories/:categoryId', requireAdmin, async (req, res) => {

  try {
    const category = await updateCategory(String(req.params.categoryId), {
      teamId: typeof req.body?.teamId === 'string' ? req.body.teamId : '',
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      description: typeof req.body?.description === 'string' ? req.body.description : '',
    })

    if (!category) {
      res.status(400).json({ error: 'category_update_failed' })
      return
    }

    res.json({ category })
  } catch (error) {
    console.error('Updating category failed.', error)
    res.status(500).json({ error: 'category_update_failed' })
  }
})

directoryRouter.delete('/categories/:categoryId', requireAdmin, async (req, res) => {

  try {
    const deleted = await deleteCategory(String(req.params.categoryId))
    if (!deleted) {
      res.status(404).json({ error: 'category_not_found' })
      return
    }
    res.status(204).end()
  } catch (error) {
    console.error('Deleting category failed.', error)
    res.status(500).json({ error: 'category_delete_failed' })
  }
})

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

directoryRouter.get('/users', requireAuth, async (req, res) => {
  try {
    const orgFilter = req.user!.role === 'Super Admin' ? undefined : req.user!.organizationId
    res.json({ users: await listUsers(orgFilter) })
  } catch (error) {
    console.error('Loading users failed.', error)
    res.status(500).json({ error: 'user_load_failed' })
  }
})

directoryRouter.get('/users/:userId', requireAuth, async (req, res) => {

  const foundUser = await getUserById(String(req.params.userId))
  if (!foundUser) {
    res.status(404).json({ error: 'user_not_found' })
    return
  }
  res.json({ user: foundUser })
})

directoryRouter.post('/users', requireAdmin, async (req, res) => {

  try {
    const createdUser = await createUser({
      id: typeof req.body?.id === 'string' ? req.body.id : undefined,
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      email: typeof req.body?.email === 'string' ? req.body.email : '',
      organizationId: typeof req.body?.organizationId === 'string' ? req.body.organizationId : '',
      teamId: typeof req.body?.teamId === 'string' ? req.body.teamId : '',
      role: req.body?.role === 'Admin' ? 'Admin' : req.body?.role === 'Super Admin' ? 'Super Admin' : 'Staff',
      canViewAllOrgTickets: req.body?.canViewAllOrgTickets === true,
    })

    if (!createdUser) {
      res.status(400).json({ error: 'user_create_failed' })
      return
    }

    let warning: string | undefined
    const defaultPassword = serverConfig.defaultPassword
    if (!defaultPassword) {
      console.warn('DEFAULT_PASSWORD not set — user created without local auth account:', createdUser.email)
      warning = 'default_password_not_configured'
    } else {
      const result = await registerLocalAccountPersisted(createdUser.name, createdUser.email, defaultPassword)
      if ('error' in result) {
        if (result.error === 'email_exists') {
          console.warn('Local account already exists for', createdUser.email, '— leaving existing password')
          warning = 'local_account_exists'
        } else {
          console.error('Failed to create local account for', createdUser.email, result.error)
          warning = 'local_account_failed'
        }
      }
    }

    res.status(201).json({ user: createdUser, ...(warning ? { warning } : {}) })
  } catch (error) {
    console.error('Creating user failed.', error)
    res.status(500).json({ error: 'user_create_failed' })
  }
})

directoryRouter.patch('/users/:userId', requireAdmin, async (req, res) => {
  const user = req.user!

  try {
    const updatedUser = await updateUser(String(req.params.userId), {
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      email: typeof req.body?.email === 'string' ? req.body.email : '',
      organizationId: typeof req.body?.organizationId === 'string' ? req.body.organizationId : '',
      teamId: typeof req.body?.teamId === 'string' ? req.body.teamId : '',
      role: req.body?.role === 'Admin' ? 'Admin' : req.body?.role === 'Super Admin' ? 'Super Admin' : 'Staff',
      canViewAllOrgTickets: req.body?.canViewAllOrgTickets === true,
    })

    if (!updatedUser) {
      res.status(400).json({ error: 'user_update_failed' })
      return
    }

    // If the user updated their own account, refresh the session cookie
    if (user.id === updatedUser.id) {
      const [updatedTeam, updatedOrganization] = await Promise.all([
        getTeamById(updatedUser.teamId),
        getOrganizationById(updatedUser.organizationId),
      ])
      const refreshedSessionUser: SessionUser = {
        ...user,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        organizationId: updatedUser.organizationId,
        organizationName: updatedOrganization?.name ?? user.organizationName,
        organizationCode: updatedOrganization?.code ?? user.organizationCode,
        organizationAccent: updatedOrganization?.accent ?? user.organizationAccent,
        teamId: updatedUser.teamId,
        teamName: updatedTeam?.name ?? user.teamName,
        teamCode: updatedTeam?.code ?? user.teamCode,
        teamAccent: updatedTeam?.accent ?? user.teamAccent,
        canViewAllOrgTickets: updatedUser.canViewAllOrgTickets,
      }

      res.cookie(
        SESSION_COOKIE_NAME,
        createSessionToken(refreshedSessionUser),
        buildCookieOptions(7 * 24 * 60 * 60 * 1000),
      )
    }

    res.json({ user: updatedUser })
  } catch (error) {
    console.error('Updating user failed.', error)
    res.status(500).json({ error: 'user_update_failed' })
  }
})

directoryRouter.delete('/users/:userId', requireAdmin, async (req, res) => {

  try {
    const deleted = await deleteUser(String(req.params.userId))
    if (!deleted) {
      res.status(404).json({ error: 'user_not_found' })
      return
    }
    res.status(204).end()
  } catch (error) {
    console.error('Deleting user failed.', error)
    res.status(500).json({ error: 'user_delete_failed' })
  }
})