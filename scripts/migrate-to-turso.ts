/**
 * migrate-to-turso.ts
 *
 * Copies all data from the local dev.sqlite3 into the remote Turso database.
 * Run once: npx tsx scripts/migrate-to-turso.ts
 *
 * IMPORTANT: Make sure TURSO_DB_URL and TURSO_TOKEN are set in .env
 *            and that the remote DB schema is already initialised (server
 *            auto-initialises it on first start, so just start the dev server
 *            once before running this script if you haven't yet).
 */

import { createClient, type InValue } from '@libsql/client'
import path from 'node:path'
import fs from 'node:fs'

// Manually parse .env so we don't depend on tsx's env injection order
const envPath = path.resolve(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const TURSO_URL = process.env.TURSO_DB_URL?.trim()
const TURSO_TOKEN = process.env.TURSO_TOKEN?.trim()

if (!TURSO_URL) {
  console.error('TURSO_DB_URL is not set in .env')
  process.exit(1)
}

const localPath = path.resolve(process.cwd(), 'dev.sqlite3')
const localClient = createClient({ url: `file:${localPath}` })
const remoteClient = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN || undefined })

// Tables to migrate (order matters for FK constraints)
const TABLES = [
  'Organizations',
  'Teams',
  'Categories',
  'Users',
  'Tickets',
  'TicketActivity',
  'TicketAttachments',
  'TicketWatchers',
  'TicketFieldDefinitions',
  'TicketCustomFieldValues',
  'TeamTicketTrends',
  'AppSettings',
  'FeedbackForms',
  'FeedbackFormFields',
  'FeedbackTokens',
  'FeedbackResponses',
  'FeedbackResponseAnswers',
  'WebhookConfigs',
]

async function tableExists(client: ReturnType<typeof createClient>, table: string): Promise<boolean> {
  const res = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [table],
  })
  return res.rows.length > 0
}

async function migrateTable(table: string) {
  const exists = await tableExists(localClient, table)
  if (!exists) {
    console.log(`  [skip] ${table} — not found in local DB`)
    return
  }

  const localRows = await localClient.execute(`SELECT * FROM ${table}`)
  if (localRows.rows.length === 0) {
    console.log(`  [skip] ${table} — empty`)
    return
  }

  const columns = localRows.columns
  const placeholders = columns.map(() => '?').join(', ')
  const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`

  // Batch in chunks of 50 to stay within limits
  const CHUNK = 50
  let inserted = 0
  for (let i = 0; i < localRows.rows.length; i += CHUNK) {
    const chunk = localRows.rows.slice(i, i + CHUNK)
    const statements = chunk.map(row => ({
      sql,
      args: columns.map(col => {
        const val = (row as Record<string, unknown>)[col]
        // ArrayBuffer → Uint8Array for libsql
        if (val instanceof ArrayBuffer) return new Uint8Array(val) as unknown as InValue
        return val as InValue
      }),
    }))
    await remoteClient.batch(statements, 'write')
    inserted += chunk.length
  }

  console.log(`  [done] ${table} — ${inserted} rows copied`)
}

async function main() {
  console.log(`\nMigrating local SQLite (${localPath}) → Turso (${TURSO_URL})\n`)

  for (const table of TABLES) {
    await migrateTable(table)
  }

  console.log('\nMigration complete.')
  localClient.close()
  remoteClient.close()
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
