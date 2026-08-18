import crypto from 'node:crypto'

import jwt from 'jsonwebtoken'
import type { SignOptions } from 'jsonwebtoken'

import { serverConfig } from './config.js'

export const SESSION_COOKIE_NAME = 'team_support_session'
export const OAUTH_STATE_COOKIE_NAME = 'team_support_oauth_state'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: 'Admin' | 'Super Admin' | 'Staff'
  organizationId: string
  organizationName: string
  organizationCode: string
  organizationAccent: string
  teamId: string
  teamName: string
  teamCode: string
  teamAccent: string
  canViewAllOrgTickets: boolean
  picture?: string
}

export const buildCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: serverConfig.isProduction || serverConfig.cookieSameSite === 'none',
  sameSite: serverConfig.cookieSameSite,
  path: '/',
  maxAge,
})

export const createOAuthState = () => crypto.randomBytes(24).toString('hex')

export const createSessionToken = (
  user: SessionUser,
  expiresIn: SignOptions['expiresIn'] = '7d',
) => {
  // If `user` originated from a previously-decoded JWT (e.g. a session refresh
  // that spreads `req.user`), it will carry reserved claims such as `exp`/`iat`.
  // jsonwebtoken throws if those are present alongside the `expiresIn` option,
  // so strip them before re-signing.
  const { exp, iat, nbf, iss, aud, jti, ...payload } = user as SessionUser & {
    exp?: unknown
    iat?: unknown
    nbf?: unknown
    iss?: unknown
    aud?: unknown
    jti?: unknown
  }

  return jwt.sign(payload, serverConfig.jwtSecret, {
    expiresIn,
    issuer: 'teamsupportpro',
    audience: 'teamsupportpro-web',
  })
}

export const readSessionToken = (token: string) =>
  jwt.verify(token, serverConfig.jwtSecret, {
    issuer: 'teamsupportpro',
    audience: 'teamsupportpro-web',
  }) as SessionUser