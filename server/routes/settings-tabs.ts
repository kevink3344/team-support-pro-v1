import { Router } from 'express'
import { requireAdmin, requireSuperAdmin } from '../middleware.js'
import {
  listSettingsTabs,
  listVisibleSettingsTabs,
  createSettingsTab,
  updateSettingsTab,
  deleteSettingsTab,
  reorderSettingsTabs,
  updateTabSections,
} from '../settings-tabs.js'

export const settingsTabsRouter = Router()

// ---------------------------------------------------------------------------
// GET /api/settings/tabs — returns tabs filtered by role
// ---------------------------------------------------------------------------
settingsTabsRouter.get('/tabs', requireAdmin, async (req, res) => {
  try {
    const user = req.user!
    // Super Admin sees all tabs; Admin sees only visible_to = 'all'
    const tabs = await listVisibleSettingsTabs(user.role)
    res.json({ tabs })
  } catch (error) {
    console.error('Failed to list settings tabs.', error)
    res.status(500).json({ error: 'settings_tabs_list_failed' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/settings/tabs — create a new tab (Super Admin only)
// ---------------------------------------------------------------------------
settingsTabsRouter.post('/tabs', requireSuperAdmin, async (req, res) => {
  const { name, slug, visible_to } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'tab_name_required' })
    return
  }
  if (typeof slug !== 'string' || !slug.trim()) {
    res.status(400).json({ error: 'tab_slug_required' })
    return
  }
  if (visible_to !== 'all' && visible_to !== 'super_admin') {
    res.status(400).json({ error: 'invalid_visible_to', allowed: ['all', 'super_admin'] })
    return
  }

  try {
    const tab = await createSettingsTab({ name: name.trim(), slug: slug.trim(), visible_to })
    if (!tab) {
      res.status(409).json({ error: 'tab_slug_conflict' })
      return
    }
    // Return full tab list for verification
    const tabs = await listSettingsTabs()
    res.status(201).json({ tab, tabs })
  } catch (error) {
    console.error('Failed to create settings tab.', error)
    res.status(500).json({ error: 'settings_tab_create_failed' })
  }
})

// ---------------------------------------------------------------------------
// PATCH /api/settings/tabs/:tabId — update a tab (Super Admin only)
// ---------------------------------------------------------------------------
settingsTabsRouter.patch('/tabs/:tabId', requireSuperAdmin, async (req, res) => {
  const tabId = String(req.params.tabId ?? '')
  if (!tabId) {
    res.status(400).json({ error: 'invalid_tab_id' })
    return
  }

  const patch: { name?: string; visible_to?: 'all' | 'super_admin' } = {}
  if (typeof req.body?.name === 'string' && req.body.name.trim()) {
    patch.name = req.body.name.trim()
  }
  if (req.body?.visible_to === 'all' || req.body?.visible_to === 'super_admin') {
    patch.visible_to = req.body.visible_to
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'no_valid_fields_to_update' })
    return
  }

  try {
    const tab = await updateSettingsTab(tabId, patch)
    if (!tab) {
      res.status(404).json({ error: 'tab_not_found' })
      return
    }
    // Return full tab list for verification
    const tabs = await listSettingsTabs()
    res.json({ tab, tabs })
  } catch (error) {
    console.error('Failed to update settings tab.', error)
    res.status(500).json({ error: 'settings_tab_update_failed' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/settings/tabs/:tabId — delete a tab (Super Admin only)
// ---------------------------------------------------------------------------
settingsTabsRouter.delete('/tabs/:tabId', requireSuperAdmin, async (req, res) => {
  const tabId = String(req.params.tabId ?? '')
  if (!tabId) {
    res.status(400).json({ error: 'invalid_tab_id' })
    return
  }

  try {
    const deleted = await deleteSettingsTab(tabId)
    if (!deleted) {
      res.status(404).json({ error: 'tab_not_found' })
      return
    }
    // Return remaining tabs for verification
    const tabs = await listSettingsTabs()
    res.json({ deleted: true, tabs })
  } catch (error) {
    console.error('Failed to delete settings tab.', error)
    res.status(500).json({ error: 'settings_tab_delete_failed' })
  }
})

// ---------------------------------------------------------------------------
// PUT /api/settings/tabs/reorder — reorder tabs (Super Admin only)
// ---------------------------------------------------------------------------
settingsTabsRouter.put('/tabs/reorder', requireSuperAdmin, async (req, res) => {
  const orderedIds = req.body?.orderedIds
  if (!Array.isArray(orderedIds) || orderedIds.some((id: unknown) => typeof id !== 'string')) {
    res.status(400).json({ error: 'ordered_ids_array_required' })
    return
  }

  try {
    const tabs = await reorderSettingsTabs(orderedIds)
    res.json({ tabs })
  } catch (error) {
    console.error('Failed to reorder settings tabs.', error)
    res.status(500).json({ error: 'settings_tabs_reorder_failed' })
  }
})

// ---------------------------------------------------------------------------
// PUT /api/settings/tabs/:tabId/sections — replace sections in a tab
// ---------------------------------------------------------------------------
settingsTabsRouter.put('/tabs/:tabId/sections', requireSuperAdmin, async (req, res) => {
  const tabId = String(req.params.tabId ?? '')
  const sectionKeys = req.body?.sectionKeys

  if (!tabId) {
    res.status(400).json({ error: 'invalid_tab_id' })
    return
  }
  if (!Array.isArray(sectionKeys) || sectionKeys.some((k: unknown) => typeof k !== 'string')) {
    res.status(400).json({ error: 'section_keys_array_required' })
    return
  }

  try {
    const sections = await updateTabSections(tabId, sectionKeys)
    // Return full tabs for verification
    const tabs = await listSettingsTabs()
    res.json({ sections, tabs })
  } catch (error) {
    console.error('Failed to update tab sections.', error)
    res.status(500).json({ error: 'tab_sections_update_failed' })
  }
})