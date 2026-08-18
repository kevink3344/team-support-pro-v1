import sql from 'mssql'

import { serverConfig } from './config.js'
import { getPool, hasDatabaseConfig } from './db.js'
import type { SessionUser } from './auth.js'

interface GoogleProfile {
  subject: string
  email: string
  name: string
  picture?: string
}

const fallbackUsers: SessionUser[] = [
  {
    id: 'u-kevin',
    name: 'Kevin Key',
    email: 'kevin.key@company.com',
    role: 'Admin',
    teamId: 'it',
    teamName: 'IT Support',
    teamCode: 'IT',
    teamAccent: '#0078d4',
  },
  {
    id: 'u-diana',
    name: 'Diana Park',
    email: 'diana.park@company.com',
    role: 'Staff',
    teamId: 'it',
    teamName: 'IT Support',
    teamCode: 'IT',
    teamAccent: '#0078d4',
  },
  {
    id: 'u-michael',
    name: 'Michael Chen',
    email: 'michael.chen@company.com',
    role: 'Staff',
    teamId: 'facilities',
    teamName: 'Facilities',
    teamCode: 'FAC',
    teamAccent: '#2f9e44',
  },
]

const normalizeRole = (value: unknown): 'Admin' | 'Staff' =>
  String(value).toLowerCase() === 'admin' ? 'Admin' : 'Staff'

const normalizeString = (value: unknown, fallback: string) => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return fallback
}

const mapRecordToSessionUser = (
  record: Record<string, unknown>,
  profile: GoogleProfile,
): SessionUser => ({
  id: normalizeString(record.userId, `google-${profile.subject}`),
  name: normalizeString(record.displayName, profile.name),
  email: normalizeString(record.email, profile.email),
  role: normalizeRole(record.role),
  teamId: normalizeString(record.teamId, serverConfig.fallbackTeam.id),
  teamName: normalizeString(record.teamName, serverConfig.fallbackTeam.name),
  teamCode: normalizeString(record.teamCode, serverConfig.fallbackTeam.code),
  teamAccent: normalizeString(record.teamAccent, serverConfig.fallbackTeam.accent),
  picture: profile.picture,
})

export const resolveAuthenticatedUser = async (
  profile: GoogleProfile,
): Promise<SessionUser> => {
  const email = profile.email.toLowerCase()

  if (hasDatabaseConfig() && serverConfig.authUserLookupQuery) {
    try {
      const pool = await getPool()
      const result = await pool
        .request()
        .input('email', sql.NVarChar, email)
        .input('name', sql.NVarChar, profile.name)
        .query<Record<string, unknown>>(serverConfig.authUserLookupQuery)

      const record = result.recordset[0]
      if (record) {
        return mapRecordToSessionUser(record, profile)
      }
    } catch (error) {
      console.error('SQL user lookup failed, using fallback auth mapping.', error)
    }
  }

  const fallbackMatch = fallbackUsers.find(
    (user) => user.email.toLowerCase() === email,
  )

  if (fallbackMatch) {
    return {
      ...fallbackMatch,
      picture: profile.picture,
    }
  }

  return {
    id: `google-${profile.subject}`,
    name: profile.name,
    email: profile.email,
    role: serverConfig.fallbackRole,
    teamId: serverConfig.fallbackTeam.id,
    teamName: serverConfig.fallbackTeam.name,
    teamCode: serverConfig.fallbackTeam.code,
    teamAccent: serverConfig.fallbackTeam.accent,
    picture: profile.picture,
  }
}