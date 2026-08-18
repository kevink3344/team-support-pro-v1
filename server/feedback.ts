import crypto from 'node:crypto'

import { serverConfig } from './config.js'
import { getDb, dbGet, dbAll, dbRun } from './db.js'
import type { TicketRecord } from './tickets.js'

export type FeedbackFieldType = 'short_text' | 'long_text' | 'rating' | 'single_choice' | 'multi_choice'

export interface FeedbackFormField {
  id: string
  formId: string
  fieldType: FeedbackFieldType
  label: string
  isRequired: boolean
  sortOrder: number
  options: string[]
}

export interface FeedbackForm {
  id: string
  organizationId: string
  isEnabled: boolean
  fields: FeedbackFormField[]
}

export interface FeedbackResponseSummary {
  id: string
  token: string
  ticketId: string | null
  organizationId: string
  teamId: string | null
  categoryId: string | null
  requestorEmail: string | null
  isTest: boolean
  submittedAt: string
  answers: Array<{ fieldId: string; fieldLabel: string; fieldType: string; value: string }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_FIELD_TYPES = new Set<string>(['short_text', 'long_text', 'rating', 'single_choice', 'multi_choice'])

const TOKEN_EXPIRY_DAYS = 7
const TEST_TOKEN_EXPIRY_HOURS = 1

const safeParseJsonArray = (json: string): string[] => {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

const UPSERT_SETTING = `INSERT INTO AppSettings (Key, Value, UpdatedAt)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, UpdatedAt = datetime('now')`

// ---------------------------------------------------------------------------
// Form CRUD
// ---------------------------------------------------------------------------

export const getFeedbackForm = async (orgId: string): Promise<FeedbackForm> => {
  const db = getDb()

  let formRow = await dbGet(db, 'SELECT Id AS id, OrganizationId AS organizationId, IsEnabled AS isEnabled FROM FeedbackForms WHERE OrganizationId = ? LIMIT 1', [orgId]) as { id?: unknown; organizationId?: unknown; isEnabled?: unknown } | undefined

  if (!formRow) {
    const id = `ff-${crypto.randomUUID()}`
    await dbRun(db, 'INSERT INTO FeedbackForms (Id, OrganizationId, IsEnabled) VALUES (?, ?, 0)', [id, orgId])
    formRow = { id, organizationId: orgId, isEnabled: 0 }
  }

  const fieldRows = await dbAll(db, 'SELECT Id AS id, FormId AS formId, FieldType AS fieldType, Label AS label, IsRequired AS isRequired, SortOrder AS sortOrder, OptionsJson AS optionsJson FROM FeedbackFormFields WHERE FormId = ? ORDER BY SortOrder ASC', [String(formRow.id)]) as Array<{ id: unknown; formId: unknown; fieldType: unknown; label: unknown; isRequired: unknown; sortOrder: unknown; optionsJson: unknown }>

  return {
    id: String(formRow.id),
    organizationId: String(formRow.organizationId),
    isEnabled: Number(formRow.isEnabled) === 1,
    fields: fieldRows.map((f) => ({
      id: String(f.id),
      formId: String(f.formId),
      fieldType: String(f.fieldType) as FeedbackFieldType,
      label: String(f.label),
      isRequired: Number(f.isRequired) === 1,
      sortOrder: Number(f.sortOrder),
      options: safeParseJsonArray(String(f.optionsJson)),
    })),
  }
}

export const saveFeedbackFormFields = async (
  orgId: string,
  rawFields: Array<Partial<FeedbackFormField>>,
): Promise<FeedbackForm> => {
  const form = await getFeedbackForm(orgId)

  const validFields = rawFields.flatMap((f, idx) => {
    const label = typeof f.label === 'string' ? f.label.trim() : ''
    const fieldType = typeof f.fieldType === 'string' ? f.fieldType : ''
    if (!label || !VALID_FIELD_TYPES.has(fieldType)) return []
    return [{
      id: typeof f.id === 'string' && f.id.trim() ? f.id.trim() : `fff-${crypto.randomUUID()}`,
      formId: form.id,
      fieldType,
      label,
      isRequired: f.isRequired === true ? 1 : 0,
      sortOrder: idx,
      optionsJson: JSON.stringify(
        Array.isArray(f.options)
          ? f.options.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          : [],
      ),
    }]
  })

  const db = getDb()
  const statements = [
    { sql: 'DELETE FROM FeedbackFormFields WHERE FormId = ?', args: [form.id] },
    ...validFields.map((f) => ({
      sql: 'INSERT INTO FeedbackFormFields (Id, FormId, FieldType, Label, IsRequired, SortOrder, OptionsJson) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [f.id, f.formId, f.fieldType, f.label, f.isRequired, f.sortOrder, f.optionsJson],
    })),
    { sql: "UPDATE FeedbackForms SET UpdatedAt = datetime('now') WHERE Id = ?", args: [form.id] },
  ]
  await db.batch(statements, 'write')

  return getFeedbackForm(orgId)
}

export const setFeedbackFormEnabled = async (orgId: string, isEnabled: boolean): Promise<FeedbackForm> => {
  const form = await getFeedbackForm(orgId)
  const db = getDb()
  await dbRun(db, "UPDATE FeedbackForms SET IsEnabled = ?, UpdatedAt = datetime('now') WHERE Id = ?", [isEnabled ? 1 : 0, form.id])
  return getFeedbackForm(orgId)
}

// ---------------------------------------------------------------------------
// Global enable / disable
// ---------------------------------------------------------------------------

export const readFeedbackFormGlobalEnabled = async (): Promise<boolean> => {
  const db = getDb()
  const row = await dbGet(db, "SELECT Value AS value FROM AppSettings WHERE Key = 'feedbackFormEnabled' LIMIT 1")
  return String(row?.value ?? '') === 'true'
}

export const writeFeedbackFormGlobalEnabled = async (enabled: boolean): Promise<void> => {
  const db = getDb()
  await dbRun(db, UPSERT_SETTING, ['feedbackFormEnabled', enabled ? 'true' : 'false'])
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const createFeedbackToken = async (ticketId: string, orgId: string): Promise<string> => {
  const db = getDb()
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 86400 * 1000).toISOString()
  await dbRun(db, 'INSERT INTO FeedbackTokens (Token, TicketId, OrganizationId, IsTest, ExpiresAt) VALUES (?, ?, ?, 0, ?)', [token, ticketId, orgId, expiresAt])
  return token
}

export const createTestFeedbackToken = async (orgId: string): Promise<string> => {
  const db = getDb()
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + TEST_TOKEN_EXPIRY_HOURS * 3600 * 1000).toISOString()
  await dbRun(db, 'INSERT INTO FeedbackTokens (Token, TicketId, OrganizationId, IsTest, ExpiresAt) VALUES (?, NULL, ?, 1, ?)', [token, orgId, expiresAt])
  return token
}

type TokenStatus = 'valid' | 'invalid' | 'expired' | 'used'

interface ResolvedToken {
  token: string
  ticketId: string | null
  organizationId: string
  isTest: boolean
  expiresAt: string
  usedAt: string | null
}

export const resolveToken = async (
  token: string,
): Promise<{ status: TokenStatus; data?: ResolvedToken }> => {
  if (!/^[0-9a-f]{64}$/.test(token)) return { status: 'invalid' }

  const db = getDb()
  const row = await dbGet(db, 'SELECT Token AS token, TicketId AS ticketId, OrganizationId AS organizationId, IsTest AS isTest, ExpiresAt AS expiresAt, UsedAt AS usedAt FROM FeedbackTokens WHERE Token = ? LIMIT 1', [token])

  if (!row) return { status: 'invalid' }
  if (row.usedAt) return { status: 'used' }
  if (new Date(String(row.expiresAt)) < new Date()) return { status: 'expired' }

  return {
    status: 'valid',
    data: {
      token: String(row.token),
      ticketId: row.ticketId ? String(row.ticketId) : null,
      organizationId: String(row.organizationId),
      isTest: Number(row.isTest) === 1,
      expiresAt: String(row.expiresAt),
      usedAt: row.usedAt ? String(row.usedAt) : null,
    },
  }
}

// ---------------------------------------------------------------------------
// Submit response
// ---------------------------------------------------------------------------

export interface FeedbackAnswerInput {
  fieldId: string
  value: string
}

export const submitFeedbackResponse = async (
  tokenStr: string,
  answers: FeedbackAnswerInput[],
): Promise<{ ok: boolean; error?: string }> => {
  const resolution = await resolveToken(tokenStr)
  if (resolution.status !== 'valid' || !resolution.data) {
    return { ok: false, error: resolution.status }
  }

  const { ticketId, organizationId, isTest } = resolution.data
  const db = getDb()
  const form = await getFeedbackForm(organizationId)

  for (const field of form.fields) {
    if (field.isRequired) {
      const answer = answers.find((a) => a.fieldId === field.id)
      if (!answer || !answer.value.trim()) {
        return { ok: false, error: 'required_field_missing' }
      }
    }
  }

  const fieldMap = new Map(form.fields.map((f) => [f.id, f]))
  const responseId = `fr-${crypto.randomUUID()}`
  const submittedAt = new Date().toISOString()
  const formSnapshotJson = JSON.stringify(form.fields)

  let teamId: string | null = null
  let categoryId: string | null = null
  let requestorEmail: string | null = null

  if (ticketId) {
    const ticketRow = await dbGet(db, 'SELECT TeamId, CategoryId, RequestorEmail FROM Tickets WHERE Id = ? LIMIT 1', [ticketId])
    if (ticketRow) {
      teamId = ticketRow.TeamId ? String(ticketRow.TeamId) : null
      categoryId = ticketRow.CategoryId ? String(ticketRow.CategoryId) : null
      requestorEmail = ticketRow.RequestorEmail ? String(ticketRow.RequestorEmail) : null
    }
  }

  const answerStatements = answers
    .filter((answer) => {
      const field = fieldMap.get(answer.fieldId)
      return field && answer.value.trim()
    })
    .map((answer) => {
      const field = fieldMap.get(answer.fieldId)!
      return {
        sql: 'INSERT INTO FeedbackResponseAnswers (Id, ResponseId, FieldId, FieldLabel, FieldType, Value) VALUES (?, ?, ?, ?, ?, ?)',
        args: [`fra-${crypto.randomUUID()}`, responseId, answer.fieldId, field.label, field.fieldType, answer.value.trim()],
      }
    })

  await db.batch([
    {
      sql: 'INSERT INTO FeedbackResponses (Id, Token, TicketId, OrganizationId, TeamId, CategoryId, RequestorEmail, IsTest, FormSnapshotJson, SubmittedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [responseId, tokenStr, ticketId, organizationId, teamId, categoryId, requestorEmail, isTest ? 1 : 0, formSnapshotJson, submittedAt],
    },
    ...answerStatements,
    { sql: 'UPDATE FeedbackTokens SET UsedAt = ? WHERE Token = ?', args: [submittedAt, tokenStr] },
  ], 'write')

  return { ok: true }
}

// ---------------------------------------------------------------------------
// List responses
// ---------------------------------------------------------------------------

export const listFeedbackResponses = async (
  orgId: string,
  includeTest = false,
): Promise<FeedbackResponseSummary[]> => {
  const db = getDb()

  const rows = await dbAll(db, `
    SELECT Id AS id, Token AS token, TicketId AS ticketId, OrganizationId AS organizationId,
      TeamId AS teamId, CategoryId AS categoryId, RequestorEmail AS requestorEmail,
      IsTest AS isTest, SubmittedAt AS submittedAt
    FROM FeedbackResponses
    WHERE OrganizationId = ? ${includeTest ? '' : 'AND IsTest = 0'}
    ORDER BY SubmittedAt DESC
  `, [orgId]) as Array<{ id: unknown; token: unknown; ticketId: unknown; organizationId: unknown; teamId: unknown; categoryId: unknown; requestorEmail: unknown; isTest: unknown; submittedAt: unknown }>

  const answerRows = await dbAll(db, `
    SELECT a.ResponseId AS responseId, a.FieldId AS fieldId, a.FieldLabel AS fieldLabel,
      a.FieldType AS fieldType, a.Value AS value
    FROM FeedbackResponseAnswers a
    JOIN FeedbackResponses r ON r.Id = a.ResponseId
    WHERE r.OrganizationId = ? ${includeTest ? '' : 'AND r.IsTest = 0'}
  `, [orgId]) as Array<{ responseId: unknown; fieldId: unknown; fieldLabel: unknown; fieldType: unknown; value: unknown }>

  const answersByResponse = new Map<string, typeof answerRows>()
  for (const a of answerRows) {
    const rId = String(a.responseId)
    const bucket = answersByResponse.get(rId) ?? []
    bucket.push(a)
    answersByResponse.set(rId, bucket)
  }

  return rows.map((r) => ({
    id: String(r.id),
    token: String(r.token),
    ticketId: r.ticketId ? String(r.ticketId) : null,
    organizationId: String(r.organizationId),
    teamId: r.teamId ? String(r.teamId) : null,
    categoryId: r.categoryId ? String(r.categoryId) : null,
    requestorEmail: r.requestorEmail ? String(r.requestorEmail) : null,
    isTest: Number(r.isTest) === 1,
    submittedAt: String(r.submittedAt),
    answers: (answersByResponse.get(String(r.id)) ?? []).map((a) => ({
      fieldId: String(a.fieldId),
      fieldLabel: String(a.fieldLabel),
      fieldType: String(a.fieldType),
      value: String(a.value),
    })),
  }))
}

// ---------------------------------------------------------------------------
// Send feedback email after ticket resolution
// ---------------------------------------------------------------------------

export const maybeSendFeedbackEmail = async (ticket: TicketRecord, orgId: string): Promise<void> => {
  if (!await readFeedbackFormGlobalEnabled()) return
  const form = await getFeedbackForm(orgId)
  if (!form.isEnabled || form.fields.length === 0) return
  if (!ticket.requestorEmail) return
  const { resendApiKey, from } = serverConfig.email
  if (!resendApiKey || !from) return

  const token = await createFeedbackToken(ticket.id, orgId)
  const baseUrl = (serverConfig.allowedOrigins[0] ?? serverConfig.clientUrl).replace(/\/$/, '')
  const feedbackUrl = `${baseUrl}/feedback/${token}`

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(resendApiKey)
    await resend.emails.send({
      from,
      to: ticket.requestorEmail,
      subject: `How did we do? — ${ticket.title}`,
      text: `Hi ${ticket.requestorName},\n\nYour support ticket "${ticket.title}" has been resolved. We'd love to hear how we did!\n\nShare your feedback: ${feedbackUrl}\n\nThis link expires in 7 days.\n\n— TeamSupportPro`,
    })
  } catch (err) {
    console.error('Failed to send feedback email:', err)
  }
}
