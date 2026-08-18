import { getDb, dbGet, dbAll, dbRun } from './db.js'

const slugify = (value: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export interface DirectoryOrganization {
  id: string
  name: string
  code: string
  accent: string
}

export interface DirectoryTeam {
  id: string
  organizationId: string
  name: string
  code: string
  accent: string
}

export interface DirectoryCategory {
  id: string
  teamId: string
  name: string
  description: string
}

export interface DirectoryUser {
  id: string
  name: string
  email: string
  organizationId: string
  teamId: string
  role: 'Admin' | 'Super Admin' | 'Staff'
  canViewAllOrgTickets: boolean
}

export interface DirectoryOrganizationInput {
  id?: string
  name: string
  code: string
  accent: string
}

export interface DirectoryTeamInput {
  id?: string
  organizationId: string
  name: string
  code: string
  accent: string
}

export interface DirectoryCategoryInput {
  id?: string
  teamId: string
  name: string
  description: string
}

export interface DirectoryUserInput {
  id?: string
  name: string
  email: string
  organizationId: string
  teamId: string
  role: 'Admin' | 'Super Admin' | 'Staff'
  canViewAllOrgTickets?: boolean
}

const normalizeRole = (value: unknown): 'Admin' | 'Super Admin' | 'Staff' => {
  const lower = String(value).toLowerCase()
  if (lower === 'admin') return 'Admin'
  if (lower === 'super admin') return 'Super Admin'
  return 'Staff'
}

const normalizeOrganization = (record: Record<string, unknown>): DirectoryOrganization => ({
  id: String(record.id),
  name: String(record.name),
  code: String(record.code),
  accent: String(record.accent),
})

const normalizeTeam = (record: Record<string, unknown>): DirectoryTeam => ({
  id: String(record.id),
  organizationId: String(record.organizationId),
  name: String(record.name),
  code: String(record.code),
  accent: String(record.accent),
})

const normalizeCategory = (record: Record<string, unknown>): DirectoryCategory => ({
  id: String(record.id),
  teamId: String(record.teamId),
  name: String(record.name),
  description: String(record.description),
})

const normalizeUser = (record: Record<string, unknown>): DirectoryUser => ({
  id: String(record.id),
  name: String(record.name),
  email: String(record.email),
  organizationId: String(record.organizationId),
  teamId: String(record.teamId),
  role: normalizeRole(record.role),
  canViewAllOrgTickets: Number(record.canViewAllOrgTickets) === 1,
})

const validString = (value: string) => value.trim().length > 0
const validRole = (value: string) => value === 'Admin' || value === 'Super Admin' || value === 'Staff'
const defaultOrganizationId = (input: DirectoryOrganizationInput) => input.id?.trim() || slugify(input.name)
const defaultTeamId = (input: DirectoryTeamInput) => input.id?.trim() || `team-${slugify(input.organizationId)}-${slugify(input.name)}`
const defaultCategoryId = (input: DirectoryCategoryInput) => input.id?.trim() || `cat-${slugify(input.teamId)}-${slugify(input.name)}`
const defaultUserId = (input: DirectoryUserInput) => input.id?.trim() || `u-${slugify(input.name)}`

const organizationExists = async (organizationId: string) => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT 1 AS existsFlag FROM Organizations WHERE Id = ?', [organizationId])
  return Boolean(row)
}

const teamBelongsToOrganization = async (teamId: string, organizationId: string) => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT 1 AS existsFlag FROM Teams WHERE Id = ? AND OrganizationId = ?', [teamId, organizationId])
  return Boolean(row)
}

export const listOrganizations = async (organizationId?: string): Promise<DirectoryOrganization[]> => {
  const db = getDb()
  const rows = organizationId
    ? await dbAll(db, 'SELECT Id AS id, Name AS name, Code AS code, AccentColor AS accent FROM Organizations WHERE Id = ? ORDER BY Name ASC', [organizationId])
    : await dbAll(db, 'SELECT Id AS id, Name AS name, Code AS code, AccentColor AS accent FROM Organizations ORDER BY Name ASC')
  return rows.map(normalizeOrganization)
}

export const getOrganizationById = async (organizationId: string): Promise<DirectoryOrganization | null> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT Id AS id, Name AS name, Code AS code, AccentColor AS accent FROM Organizations WHERE Id = ?', [organizationId])
  return row ? normalizeOrganization(row) : null
}

export const createOrganization = async (input: DirectoryOrganizationInput): Promise<DirectoryOrganization | null> => {
  if (!validString(input.name) || !validString(input.code) || !validString(input.accent)) return null
  const organizationId = defaultOrganizationId(input)
  const db = getDb()
  await dbRun(db, 'INSERT INTO Organizations (Id, Name, Code, AccentColor) VALUES (?, ?, ?, ?)', [organizationId, input.name.trim(), input.code.trim().toUpperCase(), input.accent.trim()])
  return getOrganizationById(organizationId)
}

export const updateOrganization = async (organizationId: string, input: DirectoryOrganizationInput): Promise<DirectoryOrganization | null> => {
  if (!validString(organizationId) || !validString(input.name) || !validString(input.code) || !validString(input.accent)) return null
  const db = getDb()
  await dbRun(db, "UPDATE Organizations SET Name = ?, Code = ?, AccentColor = ?, UpdatedAt = datetime('now') WHERE Id = ?", [input.name.trim(), input.code.trim().toUpperCase(), input.accent.trim(), organizationId])
  return getOrganizationById(organizationId)
}

export const deleteOrganization = async (organizationId: string): Promise<boolean> => {
  if (!validString(organizationId)) return false
  const db = getDb()
  const [linkedTeam, linkedUser] = await Promise.all([
    dbGet(db, 'SELECT 1 AS linked FROM Teams WHERE OrganizationId = ? LIMIT 1', [organizationId]),
    dbGet(db, 'SELECT 1 AS linked FROM Users WHERE OrganizationId = ? LIMIT 1', [organizationId]),
  ])
  if (linkedTeam || linkedUser) return false
  const result = await dbRun(db, 'DELETE FROM Organizations WHERE Id = ?', [organizationId])
  return result.rowsAffected > 0
}

export const listTeams = async (organizationId?: string): Promise<DirectoryTeam[]> => {
  const db = getDb()
  const rows = organizationId
    ? await dbAll(db, 'SELECT Id AS id, OrganizationId AS organizationId, Name AS name, Code AS code, AccentColor AS accent FROM Teams WHERE OrganizationId = ? ORDER BY Name ASC', [organizationId])
    : await dbAll(db, 'SELECT Id AS id, OrganizationId AS organizationId, Name AS name, Code AS code, AccentColor AS accent FROM Teams ORDER BY OrganizationId ASC, Name ASC')
  return rows.map(normalizeTeam)
}

export const getTeamById = async (teamId: string): Promise<DirectoryTeam | null> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT Id AS id, OrganizationId AS organizationId, Name AS name, Code AS code, AccentColor AS accent FROM Teams WHERE Id = ?', [teamId])
  return row ? normalizeTeam(row) : null
}

export const createTeam = async (input: DirectoryTeamInput): Promise<DirectoryTeam | null> => {
  if (!validString(input.organizationId) || !validString(input.name) || !validString(input.code) || !validString(input.accent)) return null
  if (!await organizationExists(input.organizationId.trim())) return null
  const teamId = defaultTeamId(input)
  const db = getDb()
  await dbRun(db, 'INSERT INTO Teams (Id, OrganizationId, Name, Code, AccentColor) VALUES (?, ?, ?, ?, ?)', [teamId, input.organizationId.trim(), input.name.trim(), input.code.trim().toUpperCase(), input.accent.trim()])
  return getTeamById(teamId)
}

export const updateTeam = async (teamId: string, input: DirectoryTeamInput): Promise<DirectoryTeam | null> => {
  if (!validString(teamId) || !validString(input.organizationId) || !validString(input.name) || !validString(input.code) || !validString(input.accent)) return null
  if (!await organizationExists(input.organizationId.trim())) return null
  const organizationId = input.organizationId.trim()
  const db = getDb()
  await db.batch([
    { sql: "UPDATE Teams SET OrganizationId = ?, Name = ?, Code = ?, AccentColor = ?, UpdatedAt = datetime('now') WHERE Id = ?", args: [organizationId, input.name.trim(), input.code.trim().toUpperCase(), input.accent.trim(), teamId] },
    { sql: "UPDATE Users SET OrganizationId = ?, UpdatedAt = datetime('now') WHERE TeamId = ?", args: [organizationId, teamId] },
  ], 'write')
  return getTeamById(teamId)
}

export const deleteTeam = async (teamId: string): Promise<boolean> => {
  if (!validString(teamId)) return false
  const db = getDb()
  const result = await dbRun(db, 'DELETE FROM Teams WHERE Id = ?', [teamId])
  return result.rowsAffected > 0
}

export const listCategories = async (organizationId?: string): Promise<DirectoryCategory[]> => {
  const db = getDb()
  const rows = organizationId
    ? await dbAll(db, 'SELECT c.Id AS id, c.TeamId AS teamId, c.Name AS name, c.Description AS description FROM Categories c JOIN Teams t ON t.Id = c.TeamId WHERE t.OrganizationId = ? ORDER BY c.TeamId ASC, c.Name ASC', [organizationId])
    : await dbAll(db, 'SELECT Id AS id, TeamId AS teamId, Name AS name, Description AS description FROM Categories ORDER BY TeamId ASC, Name ASC')
  return rows.map(normalizeCategory)
}

export const getCategoryById = async (categoryId: string): Promise<DirectoryCategory | null> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT Id AS id, TeamId AS teamId, Name AS name, Description AS description FROM Categories WHERE Id = ?', [categoryId])
  return row ? normalizeCategory(row) : null
}

export const createCategory = async (input: DirectoryCategoryInput): Promise<DirectoryCategory | null> => {
  if (!validString(input.teamId) || !validString(input.name)) return null
  const categoryId = defaultCategoryId(input)
  const db = getDb()
  await dbRun(db, 'INSERT INTO Categories (Id, TeamId, Name, Description) VALUES (?, ?, ?, ?)', [categoryId, input.teamId.trim(), input.name.trim(), input.description.trim() || 'Custom category.'])
  return getCategoryById(categoryId)
}

export const updateCategory = async (categoryId: string, input: DirectoryCategoryInput): Promise<DirectoryCategory | null> => {
  if (!validString(categoryId) || !validString(input.teamId) || !validString(input.name)) return null
  const db = getDb()
  await dbRun(db, "UPDATE Categories SET TeamId = ?, Name = ?, Description = ?, UpdatedAt = datetime('now') WHERE Id = ?", [input.teamId.trim(), input.name.trim(), input.description.trim() || 'Custom category.', categoryId])
  return getCategoryById(categoryId)
}

export const deleteCategory = async (categoryId: string): Promise<boolean> => {
  if (!validString(categoryId)) return false
  const db = getDb()
  const result = await dbRun(db, 'DELETE FROM Categories WHERE Id = ?', [categoryId])
  return result.rowsAffected > 0
}

export const listUsers = async (organizationId?: string): Promise<DirectoryUser[]> => {
  const db = getDb()
  const rows = organizationId
    ? await dbAll(db, 'SELECT Id AS id, Name AS name, Email AS email, OrganizationId AS organizationId, TeamId AS teamId, Role AS role, CanViewAllOrgTickets AS canViewAllOrgTickets FROM Users WHERE OrganizationId = ? ORDER BY Name ASC', [organizationId])
    : await dbAll(db, 'SELECT Id AS id, Name AS name, Email AS email, OrganizationId AS organizationId, TeamId AS teamId, Role AS role, CanViewAllOrgTickets AS canViewAllOrgTickets FROM Users ORDER BY Name ASC')
  return rows.map(normalizeUser)
}

export const getUserById = async (userId: string): Promise<DirectoryUser | null> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT Id AS id, Name AS name, Email AS email, OrganizationId AS organizationId, TeamId AS teamId, Role AS role, CanViewAllOrgTickets AS canViewAllOrgTickets FROM Users WHERE Id = ?', [userId])
  return row ? normalizeUser(row) : null
}

export const createUser = async (input: DirectoryUserInput): Promise<DirectoryUser | null> => {
  if (!validString(input.name) || !validString(input.email) || !validString(input.organizationId) || !validString(input.teamId) || !validRole(input.role)) return null
  const organizationId = input.organizationId.trim()
  const teamId = input.teamId.trim()
  if (!await organizationExists(organizationId) || !await teamBelongsToOrganization(teamId, organizationId)) return null
  const userId = defaultUserId(input)
  const db = getDb()
  await dbRun(db, 'INSERT INTO Users (Id, Name, DisplayName, Email, OrganizationId, TeamId, Role, CanViewAllOrgTickets) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [userId, input.name.trim(), input.name.trim(), input.email.trim().toLowerCase(), organizationId, teamId, input.role, input.canViewAllOrgTickets ? 1 : 0])
  return getUserById(userId)
}

export const updateUser = async (userId: string, input: DirectoryUserInput): Promise<DirectoryUser | null> => {
  if (!validString(userId) || !validString(input.name) || !validString(input.email) || !validString(input.organizationId) || !validString(input.teamId) || !validRole(input.role)) return null
  const organizationId = input.organizationId.trim()
  const teamId = input.teamId.trim()
  if (!await organizationExists(organizationId) || !await teamBelongsToOrganization(teamId, organizationId)) return null
  const db = getDb()
  await dbRun(db, "UPDATE Users SET Name = ?, DisplayName = ?, Email = ?, OrganizationId = ?, TeamId = ?, Role = ?, CanViewAllOrgTickets = ?, UpdatedAt = datetime('now') WHERE Id = ?", [input.name.trim(), input.name.trim(), input.email.trim().toLowerCase(), organizationId, teamId, input.role, input.canViewAllOrgTickets ? 1 : 0, userId])
  return getUserById(userId)
}

export const deleteUser = async (userId: string): Promise<boolean> => {
  if (!validString(userId)) return false
  const db = getDb()
  const result = await dbRun(db, 'DELETE FROM Users WHERE Id = ?', [userId])
  return result.rowsAffected > 0
}

export const loadDirectoryData = async (organizationId?: string): Promise<{
  organizations: DirectoryOrganization[]
  teams: DirectoryTeam[]
  categories: DirectoryCategory[]
  users: DirectoryUser[]
}> => {
  return {
    organizations: await listOrganizations(organizationId),
    teams: await listTeams(organizationId),
    categories: await listCategories(organizationId),
    users: await listUsers(organizationId),
  }
}
