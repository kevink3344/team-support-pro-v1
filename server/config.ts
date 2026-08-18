import 'dotenv/config'

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SERVER_PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  ALLOWED_ORIGINS: z.string().optional(),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  TEST_API_KEY: z.string().optional(),
  TEST_API_USER_NAME: z.string().default('Postman IT Staff'),
  TEST_API_USER_EMAIL: z.string().email().default('postman.it.staff@local.test'),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_AUTHORIZATION_URL: z.string().url().default('https://stargate.wcpss.net/idp/profile/oidc/auth'),
  OIDC_TOKEN_URL: z.string().url().default('https://stargate.wcpss.net/idp/profile/oidc/token'),
  OIDC_USERINFO_URL: z.string().url().default('https://stargate.wcpss.net/idp/profile/oidc/userinfo'),
  OIDC_REDIRECT_URI: z.string().url().default('http://localhost:3001/auth/oidc/callback'),
  JWT_SECRET: z.string().min(16).optional(),
  DB_SERVER: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  DB_DATABASE: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_MODE: z.enum(['turso', 'sqlserver']).optional(),
  DB_SQLITE_PATH: z.string().optional(),
  TURSO_DB_URL: z.string().optional(),
  TURSO_TOKEN: z.string().optional(),
  LOCAL_ADMIN_NAME: z.string().optional(),
  LOCAL_ADMIN_EMAIL: z.string().email().optional(),
  LOCAL_ADMIN_PASSWORD: z.string().min(8).optional(),
  AUTH_USER_LOOKUP_QUERY: z.string().optional(),
  AUTH_FALLBACK_ORGANIZATION_ID: z.string().default('legacy-default'),
  AUTH_FALLBACK_ORGANIZATION_NAME: z.string().default('Legacy Default'),
  AUTH_FALLBACK_ORGANIZATION_CODE: z.string().default('LEG'),
  AUTH_FALLBACK_ORGANIZATION_ACCENT: z.string().default('#334155'),
  AUTH_FALLBACK_TEAM_ID: z.string().default('it'),
  AUTH_FALLBACK_TEAM_NAME: z.string().default('IT Support'),
  AUTH_FALLBACK_TEAM_CODE: z.string().default('IT'),
  AUTH_FALLBACK_TEAM_ACCENT: z.string().default('#0078d4'),
  AUTH_FALLBACK_ROLE: z.enum(['Admin', 'Super Admin', 'Staff']).default('Staff'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  EMAIL_TEST_TO: z.string().optional(),
  GMAIL_USER: z.string().optional(),
  GMAIL_APP_PASSWORD: z.string().optional(),
  GMAIL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(120000),
  SUPERADMIN_ENABLED: z.enum(['true', 'false']).default('false'),
})

const parsed = envSchema.parse(process.env)

const allowedOrigins = (parsed.ALLOWED_ORIGINS || parsed.CLIENT_URL)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// Generate a default JWT secret for development if not provided
const defaultJwtSecret = () => {
  if (parsed.NODE_ENV === 'production') {
    console.warn('WARNING: JWT_SECRET not set in production. Using insecure fallback for development only.')
  }
  return 'dev-insecure-jwt-key-change-in-production'
}

export const serverConfig = {
  nodeEnv: parsed.NODE_ENV,
  isProduction: parsed.NODE_ENV === 'production',
  serverPort: parsed.PORT || parsed.SERVER_PORT,
  clientUrl: parsed.CLIENT_URL,
  allowedOrigins,
  cookieSameSite: parsed.COOKIE_SAME_SITE,
  testApiKey: parsed.TEST_API_KEY?.trim() || '',
  testApiUserName: parsed.TEST_API_USER_NAME,
  testApiUserEmail: parsed.TEST_API_USER_EMAIL.toLowerCase(),
  oidcEnabled: !!(parsed.OIDC_CLIENT_ID && parsed.OIDC_CLIENT_SECRET),
  oidcClientId: parsed.OIDC_CLIENT_ID || '',
  oidcClientSecret: parsed.OIDC_CLIENT_SECRET || '',
  oidcAuthorizationUrl: parsed.OIDC_AUTHORIZATION_URL,
  oidcTokenUrl: parsed.OIDC_TOKEN_URL,
  oidcUserinfoUrl: parsed.OIDC_USERINFO_URL,
  oidcRedirectUri: parsed.OIDC_REDIRECT_URI,
  jwtSecret: parsed.JWT_SECRET || defaultJwtSecret(),
  db: {
    mode: (parsed.DB_MODE ?? '') as 'turso' | 'sqlserver' | '',
    server: parsed.DB_SERVER || '',
    port: parsed.DB_PORT || 1433,
    database: parsed.DB_DATABASE || '',
    user: parsed.DB_USER || '',
    password: parsed.DB_PASSWORD || '',
    sqlitePath: parsed.DB_SQLITE_PATH || '',
    tursoUrl: parsed.TURSO_DB_URL || '',
    tursoToken: parsed.TURSO_TOKEN || '',
  },
  localAdmin: {
    name: parsed.LOCAL_ADMIN_NAME?.trim() || 'Administrator',
    email: parsed.LOCAL_ADMIN_EMAIL?.trim().toLowerCase() || '',
    password: parsed.LOCAL_ADMIN_PASSWORD || '',
  },
  authUserLookupQuery: parsed.AUTH_USER_LOOKUP_QUERY || '',
  fallbackOrganization: {
    id: parsed.AUTH_FALLBACK_ORGANIZATION_ID,
    name: parsed.AUTH_FALLBACK_ORGANIZATION_NAME,
    code: parsed.AUTH_FALLBACK_ORGANIZATION_CODE,
    accent: parsed.AUTH_FALLBACK_ORGANIZATION_ACCENT,
  },
  fallbackTeam: {
    id: parsed.AUTH_FALLBACK_TEAM_ID,
    name: parsed.AUTH_FALLBACK_TEAM_NAME,
    code: parsed.AUTH_FALLBACK_TEAM_CODE,
    accent: parsed.AUTH_FALLBACK_TEAM_ACCENT,
  },
  fallbackRole: parsed.AUTH_FALLBACK_ROLE,
  email: {
    resendApiKey: parsed.RESEND_API_KEY?.trim() || '',
    from: parsed.EMAIL_FROM?.trim() || '',
    replyTo: parsed.EMAIL_REPLY_TO?.trim() || '',
    testTo: parsed.EMAIL_TEST_TO?.trim() || '',
    gmailUser: parsed.GMAIL_USER?.trim() || '',
    gmailAppPassword: parsed.GMAIL_APP_PASSWORD?.trim() || '',
    pollIntervalMs: parsed.GMAIL_POLL_INTERVAL_MS,
  },
  superAdminEnabled: parsed.SUPERADMIN_ENABLED === 'true',
}

