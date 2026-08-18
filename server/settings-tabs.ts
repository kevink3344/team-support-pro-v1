import { getDb, dbAll, dbGet, dbRun, type Row } from './db.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingsTab {
  id: string
  name: string
  slug: string
  sort_order: number
  visible_to: 'all' | 'super_admin'
  created_at: string
  updated_at: string
  sections: SettingsTabSection[]
}

export interface SettingsTabSection {
  id: string
  tab_id: string
  section_key: string
  sort_order: number
}

export interface SettingsTabInput {
  name: string
  slug: string
  visible_to: 'all' | 'super_admin'
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export const listSettingsTabs = async (): Promise<SettingsTab[]> => {
  const db = getDb()
  const tabs = await dbAll(db, 'SELECT * FROM settings_tabs ORDER BY sort_order ASC')
  const sections = await dbAll(db, 'SELECT * FROM settings_tab_sections ORDER BY sort_order ASC')

  return tabs.map((row: Row) => ({
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    sort_order: Number(row.sort_order),
    visible_to: String(row.visible_to) as 'all' | 'super_admin',
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    sections: sections
      .filter((s: Row) => String(s.tab_id) === String(row.id))
      .map((s: Row) => ({
        id: String(s.id),
        tab_id: String(s.tab_id),
        section_key: String(s.section_key),
        sort_order: Number(s.sort_order),
      })),
  }))
}

export const listVisibleSettingsTabs = async (role: string): Promise<SettingsTab[]> => {
  const allTabs = await listSettingsTabs()
  return allTabs.filter((tab) => {
    if (tab.visible_to === 'super_admin' && role !== 'Super Admin') return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const createSettingsTab = async (input: SettingsTabInput): Promise<SettingsTab | null> => {
  const db = getDb()
  const { randomUUID } = await import('node:crypto')
  const id = randomUUID()
  const now = new Date().toISOString()

  // Get next sort_order
  const maxRow = await dbGet(db, 'SELECT MAX(sort_order) AS max_order FROM settings_tabs')
  const sortOrder = (Number(maxRow?.max_order ?? -1)) + 1

  const result = await dbRun(
    db,
    `INSERT INTO settings_tabs (id, name, slug, sort_order, visible_to, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.slug, sortOrder, input.visible_to, now, now],
  )

  if (result.rowsAffected === 0) return null

  return {
    id,
    name: input.name,
    slug: input.slug,
    sort_order: sortOrder,
    visible_to: input.visible_to,
    created_at: now,
    updated_at: now,
    sections: [],
  }
}

export const updateSettingsTab = async (
  tabId: string,
  patch: { name?: string; visible_to?: 'all' | 'super_admin' },
): Promise<SettingsTab | null> => {
  const db = getDb()
  const now = new Date().toISOString()

  const existing = await dbGet(db, 'SELECT * FROM settings_tabs WHERE id = ?', [tabId])
  if (!existing) return null

  const name = patch.name ?? String(existing.name)
  const visibleTo = patch.visible_to ?? String(existing.visible_to)

  await dbRun(
    db,
    'UPDATE settings_tabs SET name = ?, visible_to = ?, updated_at = ? WHERE id = ?',
    [name, visibleTo, now, tabId],
  )

  // Return full tab from DB for verification
  const tabs = await listSettingsTabs()
  return tabs.find((t) => t.id === tabId) ?? null
}

export const deleteSettingsTab = async (tabId: string): Promise<boolean> => {
  const db = getDb()
  const result = await dbRun(db, 'DELETE FROM settings_tabs WHERE id = ?', [tabId])
  return result.rowsAffected > 0
}

export const reorderSettingsTabs = async (orderedIds: string[]): Promise<SettingsTab[]> => {
  const db = getDb()
  const now = new Date().toISOString()
  for (let i = 0; i < orderedIds.length; i++) {
    await dbRun(
      db,
      'UPDATE settings_tabs SET sort_order = ?, updated_at = ? WHERE id = ?',
      [i, now, orderedIds[i]],
    )
  }
  return listSettingsTabs()
}

export const updateTabSections = async (
  tabId: string,
  sectionKeys: string[],
): Promise<SettingsTabSection[]> => {
  const db = getDb()
  const { randomUUID } = await import('node:crypto')
  const now = new Date().toISOString()

  // Delete existing sections for this tab
  await dbRun(db, 'DELETE FROM settings_tab_sections WHERE tab_id = ?', [tabId])

  // Insert new sections in order
  const sections: SettingsTabSection[] = []
  for (let i = 0; i < sectionKeys.length; i++) {
    const id = randomUUID()
    await dbRun(
      db,
      `INSERT INTO settings_tab_sections (id, tab_id, section_key, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, tabId, sectionKeys[i], i, now],
    )
    sections.push({ id, tab_id: tabId, section_key: sectionKeys[i], sort_order: i })
  }

  return sections
}