import { getDb, dbGet, dbRun } from './db.js'

const POWER_BI_REPORT_URL_KEY = 'powerBiReportUrl'

const UPSERT_SQL = `INSERT INTO AppSettings (Key, Value, UpdatedAt)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, UpdatedAt = datetime('now')`

export const readRapidIdentityEnabled = async (): Promise<boolean> => {
  const db = getDb()
  const row = await dbGet(db, "SELECT Value AS value FROM AppSettings WHERE Key = 'rapidIdentityEnabled' LIMIT 1")
  if (!row?.value) return true
  return String(row.value) === 'true'
}

export const writeRapidIdentityEnabled = async (isEnabled: boolean): Promise<void> => {
  const db = getDb()
  await dbRun(db, UPSERT_SQL, ['rapidIdentityEnabled', isEnabled ? 'true' : 'false'])
}

export const readEmailNotificationsEnabled = async (): Promise<boolean> => {
  const db = getDb()
  const row = await dbGet(db, "SELECT Value AS value FROM AppSettings WHERE Key = 'emailNotificationsEnabled' LIMIT 1")
  return String(row?.value ?? '') === 'true'
}

export const writeEmailNotificationsEnabled = async (isEnabled: boolean): Promise<void> => {
  const db = getDb()
  await dbRun(db, UPSERT_SQL, ['emailNotificationsEnabled', isEnabled ? 'true' : 'false'])
}

export const readPowerBiReportUrl = async (): Promise<string | null> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT Value AS value FROM AppSettings WHERE Key = ? LIMIT 1', [POWER_BI_REPORT_URL_KEY])
  const value = String(row?.value ?? '').trim()
  return value ? value : null
}

export const writePowerBiReportUrl = async (reportUrl: string | null): Promise<void> => {
  const db = getDb()
  await dbRun(db, UPSERT_SQL, [POWER_BI_REPORT_URL_KEY, reportUrl?.trim() ?? ''])
}

const ABOUT_PAGE_HTML_KEY = 'aboutPageHtml'

export const readAboutPageHtml = async (): Promise<string> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT Value AS value FROM AppSettings WHERE Key = ? LIMIT 1', [ABOUT_PAGE_HTML_KEY])
  return String(row?.value ?? '')
}

export const writeAboutPageHtml = async (html: string): Promise<void> => {
  const db = getDb()
  await dbRun(db, UPSERT_SQL, [ABOUT_PAGE_HTML_KEY, html])
}

// ---------------------------------------------------------------------------
// Login mode
// ---------------------------------------------------------------------------

export type LoginMode = 'select' | 'password' | 'maintenance'

const LOGIN_MODE_KEY = 'login_mode'
const MAINTENANCE_MESSAGE_KEY = 'maintenance_message'
const DEFAULT_LOGIN_MODE: LoginMode = 'select'
const DEFAULT_MAINTENANCE_MESSAGE =
  'TeamSupportPro is currently undergoing system maintenance. Please try again later.'

export const normalizeLoginMode = (value: unknown): LoginMode => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'password' || normalized === 'maintenance' || normalized === 'select') {
    return normalized
  }
  return DEFAULT_LOGIN_MODE
}

/** Returns LOGIN_MODE env override when set to a valid mode; otherwise null. */
export const getLoginModeEnvOverride = (): LoginMode | null => {
  const envOverride = process.env.LOGIN_MODE?.trim().toLowerCase()
  if (envOverride === 'maintenance' || envOverride === 'select' || envOverride === 'password') {
    return envOverride
  }
  return null
}

/**
 * Effective login mode for clients.
 * LOGIN_MODE env var takes precedence over the stored DB value when valid.
 */
export const readLoginMode = async (): Promise<LoginMode> => {
  const envOverride = getLoginModeEnvOverride()
  if (envOverride) return envOverride

  const db = getDb()
  const row = await dbGet(db, 'SELECT Value AS value FROM AppSettings WHERE Key = ? LIMIT 1', [LOGIN_MODE_KEY])
  return normalizeLoginMode(row?.value)
}

/** Stored DB value only (ignores env override). Useful for admin settings UI. */
export const readStoredLoginMode = async (): Promise<LoginMode> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT Value AS value FROM AppSettings WHERE Key = ? LIMIT 1', [LOGIN_MODE_KEY])
  return normalizeLoginMode(row?.value)
}

export const writeLoginMode = async (mode: LoginMode): Promise<void> => {
  const db = getDb()
  await dbRun(db, UPSERT_SQL, [LOGIN_MODE_KEY, normalizeLoginMode(mode)])
}

export const readMaintenanceMessage = async (): Promise<string> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT Value AS value FROM AppSettings WHERE Key = ? LIMIT 1', [
    MAINTENANCE_MESSAGE_KEY,
  ])
  const value = String(row?.value ?? '').trim()
  return value || DEFAULT_MAINTENANCE_MESSAGE
}

export const writeMaintenanceMessage = async (message: string): Promise<void> => {
  const db = getDb()
  await dbRun(db, UPSERT_SQL, [MAINTENANCE_MESSAGE_KEY, message.trim()])
}


