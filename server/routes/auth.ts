import { Router } from 'express'
import {
  buildCookieOptions,
  createOAuthState,
  createSessionToken,
  OAUTH_STATE_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type SessionUser,
} from '../auth.js'
import { serverConfig } from '../config.js'
import { requireAuth, requireAdmin } from '../middleware.js'
import { resolveAuthenticatedUser } from '../user-directory.js'
import {
  authenticateLocalAccountPersisted,
  changeLocalAccountPasswordPersisted,
  registerLocalAccountPersisted,
} from '../local-auth.js'
import {
  listUsers,
  getUserById,
  getTeamById,
  getOrganizationById,
} from '../directory.js'

export const authRouter = Router()

// ---------------------------------------------------------------------------
// OIDC
// ---------------------------------------------------------------------------

authRouter.get('/oidc', (_req, res) => {
  if (!serverConfig.oidcEnabled) {
    res.status(503).json({ error: 'OIDC authentication is not configured' })
    return
  }

  const state = createOAuthState()
  const params = new URLSearchParams({
    client_id: serverConfig.oidcClientId,
    redirect_uri: serverConfig.oidcRedirectUri,
    response_type: 'code',
    scope: 'openid',
    state,
  })

  res.cookie(OAUTH_STATE_COOKIE_NAME, state, buildCookieOptions(10 * 60 * 1000))
  res.redirect(`${serverConfig.oidcAuthorizationUrl}?${params.toString()}`)
})

authRouter.get('/oidc/callback', async (req, res) => {
  if (!serverConfig.oidcEnabled) {
    res.status(503).json({ error: 'OIDC authentication is not configured' })
    return
  }

  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  const storedState = req.cookies[OAUTH_STATE_COOKIE_NAME]

  res.clearCookie(OAUTH_STATE_COOKIE_NAME, buildCookieOptions(0))

  if (!state || !code || !storedState || state !== storedState) {
    res.redirect(`${serverConfig.clientUrl}?authError=oauth_state_invalid`)
    return
  }

  try {
    const tokenResponse = await fetch(serverConfig.oidcTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: serverConfig.oidcRedirectUri,
        client_id: serverConfig.oidcClientId,
        client_secret: serverConfig.oidcClientSecret,
      }),
    })

    if (!tokenResponse.ok) {
      console.error('OIDC token exchange failed.', await tokenResponse.text())
      res.redirect(`${serverConfig.clientUrl}?authError=token_exchange_failed`)
      return
    }

    const tokens = (await tokenResponse.json()) as { access_token?: string }
    if (!tokens.access_token) {
      res.redirect(`${serverConfig.clientUrl}?authError=missing_access_token`)
      return
    }

    const userinfoResponse = await fetch(serverConfig.oidcUserinfoUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userinfoResponse.ok) {
      console.error('OIDC userinfo fetch failed.', await userinfoResponse.text())
      res.redirect(`${serverConfig.clientUrl}?authError=userinfo_failed`)
      return
    }

    const userinfo = (await userinfoResponse.json()) as {
      sub?: string
      email?: string
      name?: string
      given_name?: string
      family_name?: string
    }

    const sub = userinfo.sub || ''
    const email = userinfo.email || ''
    const name = userinfo.name || [userinfo.given_name, userinfo.family_name].filter(Boolean).join(' ') || email

    if (!sub || !email) {
      res.redirect(`${serverConfig.clientUrl}?authError=invalid_userinfo`)
      return
    }

    const appUser = await resolveAuthenticatedUser({ subject: sub, email, name })
    const sessionToken = createSessionToken(appUser)
    res.cookie(SESSION_COOKIE_NAME, sessionToken, buildCookieOptions(7 * 24 * 60 * 60 * 1000))
    res.redirect(serverConfig.clientUrl)
  } catch (error) {
    console.error('OIDC authentication failed.', error)
    res.redirect(`${serverConfig.clientUrl}?authError=oidc_auth_failed`)
  }
})

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

authRouter.get('/me', requireAuth, async (req, res) => {
  const sessionUser = req.user!
  const current = await getUserById(sessionUser.id)

  if (current) {
    const teamChanged = current.teamId !== sessionUser.teamId
    const orgChanged = current.organizationId !== sessionUser.organizationId
    const orgAccessChanged = current.canViewAllOrgTickets !== sessionUser.canViewAllOrgTickets

    if (
      current.role !== sessionUser.role ||
      current.name !== sessionUser.name ||
      current.email !== sessionUser.email ||
      teamChanged ||
      orgChanged ||
      orgAccessChanged
    ) {
      const [team, organization] = await Promise.all([
        teamChanged ? getTeamById(current.teamId) : null,
        orgChanged ? getOrganizationById(current.organizationId) : null,
      ])

      const refreshedSessionUser: SessionUser = {
        ...sessionUser,
        name: current.name,
        email: current.email,
        role: current.role,
        organizationId: current.organizationId,
        organizationName: organization?.name ?? sessionUser.organizationName,
        organizationCode: organization?.code ?? sessionUser.organizationCode,
        organizationAccent: organization?.accent ?? sessionUser.organizationAccent,
        teamId: current.teamId,
        teamName: team?.name ?? sessionUser.teamName,
        teamCode: team?.code ?? sessionUser.teamCode,
        teamAccent: team?.accent ?? sessionUser.teamAccent,
        canViewAllOrgTickets: current.canViewAllOrgTickets,
      }
      res.cookie(
        SESSION_COOKIE_NAME,
        createSessionToken(refreshedSessionUser),
        buildCookieOptions(7 * 24 * 60 * 60 * 1000),
      )
      res.json({ authenticated: true, user: refreshedSessionUser })
      return
    }
  }

  res.json({ authenticated: true, user: sessionUser })
})

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, buildCookieOptions(0))
  res.status(204).end()
})

// ---------------------------------------------------------------------------
// Local auth
// ---------------------------------------------------------------------------

authRouter.post('/register', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name : ''
  const email = typeof req.body?.email === 'string' ? req.body.email : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const rememberMe = req.body?.rememberMe === true
  const registration = await registerLocalAccountPersisted(name, email, password)

  if ('error' in registration) {
    res.status(registration.error === 'email_exists' ? 409 : 400).json({ error: registration.error })
    return
  }

  try {
    const appUser = await resolveAuthenticatedUser({
      subject: `local-${registration.account.email}`,
      email: registration.account.email,
      name: registration.account.name,
    })

    const sessionMaxAgeMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    const sessionToken = createSessionToken(appUser, rememberMe ? '30d' : '7d')
    res.cookie(SESSION_COOKIE_NAME, sessionToken, buildCookieOptions(sessionMaxAgeMs))
    res.status(201).json({
      authenticated: true,
      user: {
        id: appUser.id,
        subject: `local-${registration.account.email}`,
        name: appUser.name,
        email: appUser.email,
        role: appUser.role,
        organizationId: appUser.organizationId,
        teamId: appUser.teamId,
      },
    })
  } catch (error) {
    console.error('Local registration session creation failed.', error)
    res.status(500).json({ error: 'local_registration_failed' })
  }
})

authRouter.post('/local/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const rememberMe = req.body?.rememberMe === true
  const login = await authenticateLocalAccountPersisted(email, password)

  if ('error' in login) {
    res.status(login.error === 'invalid_email' ? 400 : 401).json({ error: login.error })
    return
  }

  try {
    const appUser = await resolveAuthenticatedUser({
      subject: `local-${login.account.email}`,
      email: login.account.email,
      name: login.account.name,
    })

    const sessionMaxAgeMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    const sessionToken = createSessionToken(appUser, rememberMe ? '30d' : '7d')
    res.cookie(SESSION_COOKIE_NAME, sessionToken, buildCookieOptions(sessionMaxAgeMs))
    res.json({
      authenticated: true,
      user: {
        id: appUser.id,
        subject: `local-${login.account.email}`,
        name: appUser.name,
        email: appUser.email,
        role: appUser.role,
        organizationId: appUser.organizationId,
        teamId: appUser.teamId,
      },
    })
  } catch (error) {
    console.error('Local login session creation failed.', error)
    res.status(500).json({ error: 'local_login_failed' })
  }
})

authRouter.post('/test-login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const rememberMe = req.body?.rememberMe === true

  if (!email) {
    res.status(400).json({ error: 'invalid_email' })
    return
  }

  try {
    const directoryUsers = await listUsers()
    const selectedUser = directoryUsers.find((u) => u.email.toLowerCase() === email)

    if (!selectedUser) {
      res.status(404).json({ error: 'user_not_found' })
      return
    }

    const appUser = await resolveAuthenticatedUser({
      subject: `test-login-${selectedUser.id}`,
      email: selectedUser.email,
      name: selectedUser.name,
    })

    const sessionMaxAgeMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    const sessionToken = createSessionToken(appUser, rememberMe ? '30d' : '7d')
    res.cookie(SESSION_COOKIE_NAME, sessionToken, buildCookieOptions(sessionMaxAgeMs))
    res.json({
      authenticated: true,
      user: {
        id: appUser.id,
        subject: `test-login-${selectedUser.id}`,
        name: appUser.name,
        email: appUser.email,
        role: appUser.role,
        organizationId: appUser.organizationId,
        organizationName: appUser.organizationName,
        organizationCode: appUser.organizationCode,
        organizationAccent: appUser.organizationAccent,
        teamId: appUser.teamId,
      },
    })
  } catch (error) {
    console.error('Test login session creation failed.', error)
    res.status(500).json({ error: 'test_login_failed' })
  }
})

// ---------------------------------------------------------------------------
// User password change (admin)
// ---------------------------------------------------------------------------

authRouter.post('/users/:userId/change-password', requireAdmin, async (req, res) => {

  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : ''
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'invalid_password', message: 'Password must be at least 8 characters.' })
    return
  }

  try {
    const targetUser = await getUserById(String(req.params.userId))
    if (!targetUser) {
      res.status(404).json({ error: 'user_not_found' })
      return
    }

    const result = await changeLocalAccountPasswordPersisted(targetUser.name, targetUser.email, newPassword)
    if ('error' in result) {
      res.status(400).json({ error: result.error })
      return
    }

    res.json({ ok: true })
  } catch (error) {
    console.error('Changing user password failed.', error)
    res.status(500).json({ error: 'password_change_failed' })
  }
})
