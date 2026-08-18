import { Router } from 'express'
import { requireSuperAdmin } from '../middleware.js'
import {
  listAnonymousPageConfigs,
  normalizeAnonymousPagePath,
  resolveAnonymousPageConfig,
  writeAnonymousPageConfigs,
} from '../anonymous-pages.js'
import {
  listOrganizations,
  listTeams,
  listCategories,
} from '../directory.js'

export const anonymousPagesRouter = Router()

// ---------------------------------------------------------------------------
// Admin: manage anonymous page configs
// ---------------------------------------------------------------------------

anonymousPagesRouter.get('/', requireSuperAdmin, async (_req, res) => {

  try {
    const organizations = await listOrganizations()
    res.json({ pages: await listAnonymousPageConfigs(organizations.map((o) => o.id)) })
  } catch (error) {
    console.error('Loading anonymous page settings failed.', error)
    res.status(500).json({ error: 'anonymous_page_settings_load_failed' })
  }
})

anonymousPagesRouter.put('/', requireSuperAdmin, async (req, res) => {

  if (!Array.isArray(req.body?.pages)) {
    res.status(400).json({ error: 'invalid_anonymous_page_settings_payload' })
    return
  }

  try {
    const organizations = await listOrganizations()
    const organizationIds = organizations.map((o) => o.id)
    const validOrganizationIds = new Set(organizationIds)
    const seenPagePaths = new Set<string>()

    const nextPages = req.body.pages.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return []

      const candidate = entry as {
        id?: string
        name?: string
        organizationId?: string
        pagePath?: string
        enabled?: boolean
      }

      const organizationId = typeof candidate.organizationId === 'string' ? candidate.organizationId.trim() : ''
      const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
      const pagePath = normalizeAnonymousPagePath(typeof candidate.pagePath === 'string' ? candidate.pagePath : '')

      if (!organizationId || !validOrganizationIds.has(organizationId) || !name || seenPagePaths.has(pagePath)) {
        return []
      }

      seenPagePaths.add(pagePath)

      return [{
        id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : `anon-page-${pagePath.replace(/[^a-z0-9]+/g, '-')}`,
        name,
        organizationId,
        pagePath,
        enabled: candidate.enabled !== false,
      }]
    })

    if (nextPages.length === 0) {
      res.status(400).json({ error: 'anonymous_page_settings_empty' })
      return
    }

    await writeAnonymousPageConfigs(nextPages)
    res.json({ pages: nextPages })
  } catch (error) {
    console.error('Saving anonymous page settings failed.', error)
    res.status(500).json({ error: 'anonymous_page_settings_save_failed' })
  }
})

// ---------------------------------------------------------------------------
// Public: resolve anonymous page config
// ---------------------------------------------------------------------------

anonymousPagesRouter.get('/public-config', async (req, res) => {
  try {
    const requestedPagePath = typeof req.query?.pagePath === 'string' ? req.query.pagePath : 'index.html'
    const [organizations, teams, categories] = await Promise.all([
      listOrganizations(),
      listTeams(),
      listCategories(),
    ])
    const page = await resolveAnonymousPageConfig(requestedPagePath, organizations.map((o) => o.id))

    if (!page) {
      res.status(404).json({ error: 'anonymous_page_not_configured' })
      return
    }

    const organization = organizations.find((e) => e.id === page.organizationId)
    if (!organization) {
      res.status(404).json({ error: 'anonymous_page_organization_not_found' })
      return
    }

    const scopedTeams = teams.filter((t) => t.organizationId === organization.id)
    const scopedTeamIds = new Set(scopedTeams.map((t) => t.id))
    const scopedCategories = categories.filter((c) => scopedTeamIds.has(c.teamId))

    res.json({
      page,
      organization,
      teams: scopedTeams,
      categories: scopedCategories,
    })
  } catch (error) {
    console.error('Loading anonymous page config failed.', error)
    res.status(500).json({ error: 'anonymous_page_config_load_failed' })
  }
})
