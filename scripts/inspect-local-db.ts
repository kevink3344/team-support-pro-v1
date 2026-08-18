import { createClient } from '@libsql/client'
import path from 'node:path'
const db = createClient({ url: 'file:' + path.resolve(process.cwd(), 'dev.sqlite3') })

const tables = ['Users','Tickets','AppSettings','Categories','Organizations','Teams','TicketAttachments',
  'TicketWatchers','TicketCustomFieldValues','TicketFieldDefinitions','FeedbackForms','FeedbackFormFields',
  'FeedbackTokens','FeedbackResponses','FeedbackResponseAnswers','WebhookConfigs','TeamTicketTrends']

for (const t of tables) {
  const info = await db.execute(`PRAGMA table_info(${t})`)
  const cols = info.rows.map((r: Record<string, unknown>) => r.name).join(', ')
  const count = await db.execute(`SELECT COUNT(*) as n FROM ${t}`)
  console.log(`${t} (${(count.rows[0] as Record<string, unknown>).n} rows): ${cols}`)
}
db.close()
