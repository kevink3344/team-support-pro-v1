import { getDb, dbGet } from './db.js'
import { serverConfig } from './config.js'
import type { SessionUser } from './auth.js'

interface AuthInput {
  subject: string
  email: string
  name: string
}

export const resolveAuthenticatedUser = async (input: AuthInput): Promise<SessionUser> => {
  const db = getDb()

  const row = await dbGet(db, `
    SELECT u.Id AS userId, COALESCE(u.DisplayName, u.Name) AS displayName, u.Email AS email,
      COALESCE(o.Id, t.OrganizationId, u.OrganizationId, ?) AS organizationId,
      COALESCE(o.Name, ?, ?) AS organizationName,
      COALESCE(o.Code, ?, ?) AS organizationCode,
      COALESCE(o.AccentColor, ?, ?) AS organizationAccent,
      COALESCE(t.Id, u.TeamId) AS teamId, COALESCE(t.Name, 'IT Support') AS teamName,
      COALESCE(t.Code, 'IT') AS teamCode, COALESCE(t.AccentColor, '#0078d4') AS teamAccent,
      COALESCE(u.Role, 'Staff') AS role,
      COALESCE(u.CanViewAllOrgTickets, 0) AS canViewAllOrgTickets
    FROM Users u
    LEFT JOIN Teams t ON t.Id = u.TeamId
    LEFT JOIN Organizations o ON o.Id = COALESCE(t.OrganizationId, u.OrganizationId)
    WHERE LOWER(u.Email) = LOWER(?)
  `, [
    serverConfig.fallbackOrganization.id,
    serverConfig.fallbackOrganization.name,
    serverConfig.fallbackOrganization.name,
    serverConfig.fallbackOrganization.code,
    serverConfig.fallbackOrganization.code,
    serverConfig.fallbackOrganization.accent,
    serverConfig.fallbackOrganization.accent,
    input.email.toLowerCase(),
  ])

  if (row) {
    return {
      id: String(row.userId),
      name: String(row.displayName),
      email: String(row.email),
      role: String(row.role) === 'Admin' ? 'Admin' : String(row.role) === 'Super Admin' ? 'Super Admin' : 'Staff',
      organizationId: String(row.organizationId),
      organizationName: String(row.organizationName),
      organizationCode: String(row.organizationCode),
      organizationAccent: String(row.organizationAccent),
      teamId: String(row.teamId),
      teamName: String(row.teamName),
      teamCode: String(row.teamCode),
      teamAccent: String(row.teamAccent),
      canViewAllOrgTickets: Number(row.canViewAllOrgTickets) === 1,
    }
  }

  return {
    id: input.subject,
    name: input.name,
    email: input.email,
    role: serverConfig.fallbackRole as 'Admin' | 'Super Admin' | 'Staff',
    organizationId: serverConfig.fallbackOrganization.id,
    organizationName: serverConfig.fallbackOrganization.name,
    organizationCode: serverConfig.fallbackOrganization.code,
    organizationAccent: serverConfig.fallbackOrganization.accent,
    teamId: serverConfig.fallbackTeam.id,
    teamName: serverConfig.fallbackTeam.name,
    teamCode: serverConfig.fallbackTeam.code,
    teamAccent: serverConfig.fallbackTeam.accent,
    canViewAllOrgTickets: false,
  }
}
