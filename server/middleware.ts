import express from 'express'
import {
  readSessionToken,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from './auth.js'
import { serverConfig } from './config.js'

export const readTestApiKeyUserFromRequest = (req: express.Request): SessionUser | null => {
  if (!serverConfig.testApiKey) {
    return null
  }

  const authorizationHeader = req.header('authorization')?.trim() || ''
  const bearerToken = authorizationHeader.toLowerCase().startsWith('bearer ')
    ? authorizationHeader.slice(7).trim()
    : ''
  const apiKeyHeader = req.header('x-api-key')?.trim() || ''
  const providedKey = apiKeyHeader || bearerToken

  if (!providedKey || providedKey !== serverConfig.testApiKey) {
    return null
  }

  return {
    id: 'postman-it-staff',
    name: serverConfig.testApiUserName,
    email: serverConfig.testApiUserEmail,
    role: 'Staff',
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

export const readSessionUserFromRequest = (req: express.Request): SessionUser | null => {
  const token = req.cookies[SESSION_COOKIE_NAME]
  const testApiUser = readTestApiKeyUserFromRequest(req)

  if (!token) {
    return testApiUser || null
  }

  try {
    return readSessionToken(token)
  } catch {
    return testApiUser || null
  }
}

export const isAdminUser = (user: SessionUser | null): user is SessionUser =>
  user?.role === 'Admin' || user?.role === 'Super Admin'

export const isSuperAdminUser = (user: SessionUser | null): user is SessionUser =>
  user?.role === 'Super Admin'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

export const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  const user = readSessionUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' })
    return
  }
  req.user = user
  next()
}

export const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  const user = readSessionUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' })
    return
  }
  if (!isAdminUser(user)) {
    res.status(403).json({ error: 'admin_required' })
    return
  }
  req.user = user
  next()
}

export const requireSuperAdmin = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  const user = readSessionUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' })
    return
  }
  if (!isSuperAdminUser(user)) {
    res.status(403).json({ error: 'super_admin_required' })
    return
  }
  req.user = user
  next()
}
