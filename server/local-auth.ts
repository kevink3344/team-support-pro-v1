import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

interface LocalAuthAccount {
  name: string
  email: string
  passwordSalt: string
  passwordHash: string
  createdAt: string
}

type RegisterError =
  | 'invalid_name'
  | 'invalid_email'
  | 'invalid_password'
  | 'email_exists'

type LoginError = 'invalid_email' | 'invalid_credentials'

const localAccountsByEmail = new Map<string, LocalAuthAccount>()
const localAuthDataFilePath = path.resolve(process.cwd(), '.local-auth-accounts.json')

let localAccountsLoaded = false
let persistQueue = Promise.resolve()

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalizeName = (value: string) => value.trim()
const normalizeEmail = (value: string) => value.trim().toLowerCase()

const hashPassword = (password: string, salt: string) =>
  crypto.scryptSync(password, salt, 64).toString('hex')

const verifyPassword = (account: LocalAuthAccount, candidatePassword: string) => {
  const expected = Buffer.from(account.passwordHash, 'hex')
  const candidate = Buffer.from(hashPassword(candidatePassword, account.passwordSalt), 'hex')

  if (expected.length !== candidate.length) {
    return false
  }

  return crypto.timingSafeEqual(expected, candidate)
}

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const loadLocalAccounts = async () => {
  if (localAccountsLoaded) {
    return
  }

  try {
    const raw = await fs.readFile(localAuthDataFilePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      localAccountsLoaded = true
      return
    }

    parsed.forEach((entry) => {
      if (!isRecordLike(entry)) {
        return
      }

      const email = normalizeEmail(typeof entry.email === 'string' ? entry.email : '')
      const name = normalizeName(typeof entry.name === 'string' ? entry.name : '')
      const passwordSalt = typeof entry.passwordSalt === 'string' ? entry.passwordSalt : ''
      const passwordHash = typeof entry.passwordHash === 'string' ? entry.passwordHash : ''
      const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString()

      if (!emailPattern.test(email) || name.length < 2 || !passwordSalt || !passwordHash) {
        return
      }

      localAccountsByEmail.set(email, {
        email,
        name,
        passwordSalt,
        passwordHash,
        createdAt,
      })
    })
  } catch (error) {
    const isMissingFileError =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'

    if (!isMissingFileError) {
      console.error('Loading local auth accounts failed.', error)
    }
  } finally {
    localAccountsLoaded = true
  }
}

const persistLocalAccounts = async () => {
  const serialized = JSON.stringify(Array.from(localAccountsByEmail.values()), null, 2)
  await fs.writeFile(localAuthDataFilePath, serialized, 'utf8')
}

const queueLocalAccountsPersist = async () => {
  persistQueue = persistQueue.then(() => persistLocalAccounts())
  await persistQueue
}

const registerLocalAccount = (
  name: string,
  email: string,
  password: string,
): { account: LocalAuthAccount } | { error: RegisterError } => {
  const normalizedName = normalizeName(name)
  const normalizedEmail = normalizeEmail(email)

  if (normalizedName.length < 2) {
    return { error: 'invalid_name' }
  }

  if (!emailPattern.test(normalizedEmail)) {
    return { error: 'invalid_email' }
  }

  if (password.length < 8) {
    return { error: 'invalid_password' }
  }

  if (localAccountsByEmail.has(normalizedEmail)) {
    return { error: 'email_exists' }
  }

  const passwordSalt = crypto.randomBytes(16).toString('hex')
  const account: LocalAuthAccount = {
    name: normalizedName,
    email: normalizedEmail,
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt),
    createdAt: new Date().toISOString(),
  }

  localAccountsByEmail.set(normalizedEmail, account)

  return { account }
}

const authenticateLocalAccount = (
  email: string,
  password: string,
): { account: LocalAuthAccount } | { error: LoginError } => {
  const normalizedEmail = normalizeEmail(email)

  if (!emailPattern.test(normalizedEmail)) {
    return { error: 'invalid_email' }
  }

  const account = localAccountsByEmail.get(normalizedEmail)

  if (!account || !verifyPassword(account, password)) {
    return { error: 'invalid_credentials' }
  }

  return { account }
}

export const registerLocalAccountPersisted = async (
  name: string,
  email: string,
  password: string,
): Promise<{ account: LocalAuthAccount } | { error: RegisterError }> => {
  await loadLocalAccounts()

  const registration = registerLocalAccount(name, email, password)
  if ('error' in registration) {
    return registration
  }

  await queueLocalAccountsPersist()
  return registration
}

export const authenticateLocalAccountPersisted = async (
  email: string,
  password: string,
): Promise<{ account: LocalAuthAccount } | { error: LoginError }> => {
  await loadLocalAccounts()

  return authenticateLocalAccount(email, password)
}

export const upsertLocalAccountPersisted = async (
  name: string,
  email: string,
  password: string,
): Promise<
  | { account: LocalAuthAccount }
  | { error: 'invalid_name' | 'invalid_email' | 'invalid_password' }
> => {
  await loadLocalAccounts()

  const normalizedName = normalizeName(name)
  const normalizedEmail = normalizeEmail(email)

  if (normalizedName.length < 2) {
    return { error: 'invalid_name' }
  }

  if (!emailPattern.test(normalizedEmail)) {
    return { error: 'invalid_email' }
  }

  if (password.length < 8) {
    return { error: 'invalid_password' }
  }

  const existing = localAccountsByEmail.get(normalizedEmail)
  const passwordSalt = crypto.randomBytes(16).toString('hex')
  const account: LocalAuthAccount = {
    name: normalizedName,
    email: normalizedEmail,
    passwordSalt,
    passwordHash: hashPassword(password, passwordSalt),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }

  localAccountsByEmail.set(normalizedEmail, account)
  await queueLocalAccountsPersist()

  return { account }
}

export const changeLocalAccountPasswordPersisted = async (
  name: string,
  email: string,
  newPassword: string,
): Promise<{ ok: true } | { error: 'invalid_name' | 'invalid_email' | 'invalid_password' }> => {
  await loadLocalAccounts()

  const normalizedName = normalizeName(name)
  const normalizedEmail = normalizeEmail(email)

  if (normalizedName.length < 2) {
    return { error: 'invalid_name' }
  }

  if (!emailPattern.test(normalizedEmail)) {
    return { error: 'invalid_email' }
  }

  if (newPassword.length < 8) {
    return { error: 'invalid_password' }
  }

  const existing = localAccountsByEmail.get(normalizedEmail)
  const passwordSalt = crypto.randomBytes(16).toString('hex')
  localAccountsByEmail.set(normalizedEmail, {
    name: normalizedName,
    email: normalizedEmail,
    passwordSalt,
    passwordHash: hashPassword(newPassword, passwordSalt),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  })

  await queueLocalAccountsPersist()
  return { ok: true }
}
