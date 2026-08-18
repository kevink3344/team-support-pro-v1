import crypto from 'crypto'
import { getDb, dbGet, dbAll, dbRun } from './db.js'

export type WebhookEvent =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.assigned'
  | 'ticket.resolved'
  | 'ticket.closed'
  | 'feedback.submitted'

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'ticket.created',
  'ticket.updated',
  'ticket.assigned',
  'ticket.resolved',
  'ticket.closed',
  'feedback.submitted',
]

export interface WebhookConfig {
  id: string
  organizationId: string
  url: string
  secret: string
  events: WebhookEvent[]
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

interface WebhookConfigRow {
  Id: unknown
  OrganizationId: unknown
  Url: unknown
  Secret: unknown
  Events: unknown
  IsEnabled: unknown
  CreatedAt: unknown
  UpdatedAt: unknown
}

const mapRow = (row: WebhookConfigRow): WebhookConfig => ({
  id: String(row.Id),
  organizationId: String(row.OrganizationId),
  url: String(row.Url),
  secret: String(row.Secret),
  events: (() => {
    try {
      const parsed = JSON.parse(String(row.Events))
      return Array.isArray(parsed) ? (parsed as WebhookEvent[]) : []
    } catch {
      return []
    }
  })(),
  isEnabled: Number(row.IsEnabled) === 1,
  createdAt: String(row.CreatedAt),
  updatedAt: String(row.UpdatedAt),
})

export const listWebhookConfigs = async (organizationId: string): Promise<WebhookConfig[]> => {
  const db = getDb()
  const rows = await dbAll(db, 'SELECT * FROM WebhookConfigs WHERE OrganizationId = ? ORDER BY CreatedAt ASC', [organizationId])
  return rows.map((r) => mapRow(r as unknown as WebhookConfigRow))
}

export const getWebhookConfig = async (id: string): Promise<WebhookConfig | null> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT * FROM WebhookConfigs WHERE Id = ?', [id])
  return row ? mapRow(row as unknown as WebhookConfigRow) : null
}

export interface CreateWebhookInput {
  url: string
  secret?: string
  events: WebhookEvent[]
  isEnabled?: boolean
}

const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export const createWebhookConfig = async (
  organizationId: string,
  input: CreateWebhookInput,
): Promise<WebhookConfig | null> => {
  const url = input.url.trim()
  if (!url || !isValidUrl(url)) return null
  const validEvents = input.events.filter((e) => (WEBHOOK_EVENTS as string[]).includes(e))
  if (!validEvents.length) return null

  const db = getDb()
  const id = `wh-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  await dbRun(db, `INSERT INTO WebhookConfigs (Id, OrganizationId, Url, Secret, Events, IsEnabled, CreatedAt, UpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, organizationId, url, input.secret?.trim() ?? '', JSON.stringify(validEvents), input.isEnabled !== false ? 1 : 0, now, now])
  return getWebhookConfig(id)
}

export interface UpdateWebhookInput {
  url?: string
  secret?: string
  events?: WebhookEvent[]
  isEnabled?: boolean
}

export const updateWebhookConfig = async (
  id: string,
  input: UpdateWebhookInput,
): Promise<WebhookConfig | null> => {
  const existing = await getWebhookConfig(id)
  if (!existing) return null

  const url = input.url !== undefined ? input.url.trim() : existing.url
  if (!isValidUrl(url)) return null

  const events =
    input.events !== undefined
      ? input.events.filter((e) => (WEBHOOK_EVENTS as string[]).includes(e))
      : existing.events
  if (!events.length) return null

  const secret = input.secret !== undefined ? input.secret.trim() : existing.secret
  const isEnabled = input.isEnabled !== undefined ? input.isEnabled : existing.isEnabled
  const now = new Date().toISOString()

  const db = getDb()
  await dbRun(db, `UPDATE WebhookConfigs SET Url = ?, Secret = ?, Events = ?, IsEnabled = ?, UpdatedAt = ? WHERE Id = ?`,
    [url, secret, JSON.stringify(events), isEnabled ? 1 : 0, now, id])
  return getWebhookConfig(id)
}

export const deleteWebhookConfig = async (id: string): Promise<boolean> => {
  const db = getDb()
  const result = await dbRun(db, 'DELETE FROM WebhookConfigs WHERE Id = ?', [id])
  return result.rowsAffected > 0
}

const signPayload = (secret: string, body: string): string => {
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(body)
  return `sha256=${hmac.digest('hex')}`
}

export const dispatchWebhookEvent = async (
  organizationId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> => {
  const db = getDb()
  const rows = await dbAll(db, `SELECT * FROM WebhookConfigs WHERE OrganizationId = ? AND IsEnabled = 1`, [organizationId])
  const configs = rows.map((r) => mapRow(r as unknown as WebhookConfigRow)).filter((c) => c.events.includes(event))
  if (!configs.length) return

  const payload = JSON.stringify({
    event,
    occurredAt: new Date().toISOString(),
    organizationId,
    data,
  })

  for (const config of configs) {
    const deliveryId = crypto.randomUUID()
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': event,
      'X-Webhook-Delivery': deliveryId,
    }
    if (config.secret) {
      headers['X-Hub-Signature-256'] = signPayload(config.secret, payload)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    fetch(config.url, { method: 'POST', headers, body: payload, signal: controller.signal })
      .catch(() => { /* fire and forget */ })
      .finally(() => clearTimeout(timeout))
  }
}
