import { getPool, hasDatabaseConfig } from './db.js'

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export interface DirectoryTeam {
  id: string
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
  teamId: string
  role: 'Admin' | 'Staff'
}

export interface DirectoryTeamInput {
  id?: string
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
  teamId: string
  role: 'Admin' | 'Staff'
}

const normalizeRole = (value: unknown): 'Admin' | 'Staff' =>
  String(value).toLowerCase() === 'admin' ? 'Admin' : 'Staff'

const normalizeTeam = (record: Record<string, unknown>): DirectoryTeam => ({
  id: String(record.id),
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
  teamId: String(record.teamId),
  role: normalizeRole(record.role),
})

const validString = (value: string) => value.trim().length > 0

const validRole = (value: string) => value === 'Admin' || value === 'Staff'

const defaultTeamId = (input: DirectoryTeamInput) => input.id?.trim() || slugify(input.name)

const defaultCategoryId = (input: DirectoryCategoryInput) =>
  input.id?.trim() || `cat-${slugify(input.teamId)}-${slugify(input.name)}`

const defaultUserId = (input: DirectoryUserInput) =>
  input.id?.trim() || `u-${slugify(input.name)}`

export const listTeams = async (): Promise<DirectoryTeam[]> => {
  if (!hasDatabaseConfig()) {
    return []
  }

  const pool = await getPool()
  const result = await pool.request().query<Record<string, unknown>>(`
    SELECT Id AS id, Name AS name, Code AS code, AccentColor AS accent
    FROM dbo.Teams
    ORDER BY Name ASC
  `)

  return result.recordset.map(normalizeTeam)
}

export const getTeamById = async (teamId: string): Promise<DirectoryTeam | null> => {
  if (!hasDatabaseConfig()) {
    return null
  }

  const pool = await getPool()
  const result = await pool.request().input('teamId', teamId).query<Record<string, unknown>>(`
    SELECT Id AS id, Name AS name, Code AS code, AccentColor AS accent
    FROM dbo.Teams
    WHERE Id = @teamId
  `)

  return result.recordset[0] ? normalizeTeam(result.recordset[0]) : null
}

export const createTeam = async (input: DirectoryTeamInput): Promise<DirectoryTeam | null> => {
  if (!hasDatabaseConfig() || !validString(input.name) || !validString(input.code) || !validString(input.accent)) {
    return null
  }

  const teamId = defaultTeamId(input)
  const pool = await getPool()
  await pool.request()
    .input('id', teamId)
    .input('name', input.name.trim())
    .input('code', input.code.trim().toUpperCase())
    .input('accent', input.accent.trim())
    .query(`
      INSERT INTO dbo.Teams (Id, Name, Code, AccentColor)
      VALUES (@id, @name, @code, @accent)
    `)

  return getTeamById(teamId)
}

export const updateTeam = async (teamId: string, input: DirectoryTeamInput): Promise<DirectoryTeam | null> => {
  if (!hasDatabaseConfig() || !validString(teamId) || !validString(input.name) || !validString(input.code) || !validString(input.accent)) {
    return null
  }

  const pool = await getPool()
  await pool.request()
    .input('teamId', teamId)
    .input('name', input.name.trim())
    .input('code', input.code.trim().toUpperCase())
    .input('accent', input.accent.trim())
    .query(`
      UPDATE dbo.Teams
      SET Name = @name, Code = @code, AccentColor = @accent, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @teamId
    `)

  return getTeamById(teamId)
}

export const deleteTeam = async (teamId: string): Promise<boolean> => {
  if (!hasDatabaseConfig() || !validString(teamId)) {
    return false
  }

  const pool = await getPool()
  const result = await pool.request().input('teamId', teamId).query(`DELETE FROM dbo.Teams WHERE Id = @teamId`)
  return result.rowsAffected[0] > 0
}

export const listCategories = async (): Promise<DirectoryCategory[]> => {
  if (!hasDatabaseConfig()) {
    return []
  }

  const pool = await getPool()
  const result = await pool.request().query<Record<string, unknown>>(`
    SELECT Id AS id, TeamId AS teamId, Name AS name, Description AS description
    FROM dbo.Categories
    ORDER BY TeamId ASC, Name ASC
  `)

  return result.recordset.map(normalizeCategory)
}

export const getCategoryById = async (categoryId: string): Promise<DirectoryCategory | null> => {
  if (!hasDatabaseConfig()) {
    return null
  }

  const pool = await getPool()
  const result = await pool.request().input('categoryId', categoryId).query<Record<string, unknown>>(`
    SELECT Id AS id, TeamId AS teamId, Name AS name, Description AS description
    FROM dbo.Categories
    WHERE Id = @categoryId
  `)

  return result.recordset[0] ? normalizeCategory(result.recordset[0]) : null
}

export const createCategory = async (input: DirectoryCategoryInput): Promise<DirectoryCategory | null> => {
  if (!hasDatabaseConfig() || !validString(input.teamId) || !validString(input.name)) {
    return null
  }

  const categoryId = defaultCategoryId(input)
  const pool = await getPool()
  await pool.request()
    .input('id', categoryId)
    .input('teamId', input.teamId.trim())
    .input('name', input.name.trim())
    .input('description', input.description.trim() || 'Custom category.')
    .query(`
      INSERT INTO dbo.Categories (Id, TeamId, Name, Description)
      VALUES (@id, @teamId, @name, @description)
    `)

  return getCategoryById(categoryId)
}

export const updateCategory = async (
  categoryId: string,
  input: DirectoryCategoryInput,
): Promise<DirectoryCategory | null> => {
  if (!hasDatabaseConfig() || !validString(categoryId) || !validString(input.teamId) || !validString(input.name)) {
    return null
  }

  const pool = await getPool()
  await pool.request()
    .input('categoryId', categoryId)
    .input('teamId', input.teamId.trim())
    .input('name', input.name.trim())
    .input('description', input.description.trim() || 'Custom category.')
    .query(`
      UPDATE dbo.Categories
      SET TeamId = @teamId, Name = @name, Description = @description, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @categoryId
    `)

  return getCategoryById(categoryId)
}

export const deleteCategory = async (categoryId: string): Promise<boolean> => {
  if (!hasDatabaseConfig() || !validString(categoryId)) {
    return false
  }

  const pool = await getPool()
  const result = await pool.request().input('categoryId', categoryId).query(`DELETE FROM dbo.Categories WHERE Id = @categoryId`)
  return result.rowsAffected[0] > 0
}

export const listUsers = async (): Promise<DirectoryUser[]> => {
  if (!hasDatabaseConfig()) {
    return []
  }

  const pool = await getPool()
  const result = await pool.request().query<Record<string, unknown>>(`
    SELECT Id AS id, Name AS name, Email AS email, TeamId AS teamId, Role AS role
    FROM dbo.Users
    ORDER BY Name ASC
  `)

  return result.recordset.map(normalizeUser)
}

export const getUserById = async (userId: string): Promise<DirectoryUser | null> => {
  if (!hasDatabaseConfig()) {
    return null
  }

  const pool = await getPool()
  const result = await pool.request().input('userId', userId).query<Record<string, unknown>>(`
    SELECT Id AS id, Name AS name, Email AS email, TeamId AS teamId, Role AS role
    FROM dbo.Users
    WHERE Id = @userId
  `)

  return result.recordset[0] ? normalizeUser(result.recordset[0]) : null
}

export const createUser = async (input: DirectoryUserInput): Promise<DirectoryUser | null> => {
  if (!hasDatabaseConfig() || !validString(input.name) || !validString(input.email) || !validString(input.teamId) || !validRole(input.role)) {
    return null
  }

  const userId = defaultUserId(input)
  const pool = await getPool()
  await pool.request()
    .input('id', userId)
    .input('name', input.name.trim())
    .input('displayName', input.name.trim())
    .input('email', input.email.trim().toLowerCase())
    .input('teamId', input.teamId.trim())
    .input('role', input.role)
    .query(`
      INSERT INTO dbo.Users (Id, Name, DisplayName, Email, TeamId, Role)
      VALUES (@id, @name, @displayName, @email, @teamId, @role)
    `)

  return getUserById(userId)
}

export const updateUser = async (userId: string, input: DirectoryUserInput): Promise<DirectoryUser | null> => {
  if (!hasDatabaseConfig() || !validString(userId) || !validString(input.name) || !validString(input.email) || !validString(input.teamId) || !validRole(input.role)) {
    return null
  }

  const pool = await getPool()
  await pool.request()
    .input('userId', userId)
    .input('name', input.name.trim())
    .input('displayName', input.name.trim())
    .input('email', input.email.trim().toLowerCase())
    .input('teamId', input.teamId.trim())
    .input('role', input.role)
    .query(`
      UPDATE dbo.Users
      SET Name = @name, DisplayName = @displayName, Email = @email, TeamId = @teamId, Role = @role, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @userId
    `)

  return getUserById(userId)
}

export const deleteUser = async (userId: string): Promise<boolean> => {
  if (!hasDatabaseConfig() || !validString(userId)) {
    return false
  }

  const pool = await getPool()
  const result = await pool.request().input('userId', userId).query(`DELETE FROM dbo.Users WHERE Id = @userId`)
  return result.rowsAffected[0] > 0
}

export const loadDirectoryData = async (): Promise<{
  teams: DirectoryTeam[]
  categories: DirectoryCategory[]
  users: DirectoryUser[]
}> => {
  if (!hasDatabaseConfig()) {
    return {
      teams: [],
      categories: [],
      users: [],
    }
  }

  return {
    teams: await listTeams(),
    categories: await listCategories(),
    users: await listUsers(),
  }
}