import { createClient } from '@libsql/client'
import path from 'node:path'
const db = createClient({ url: 'file:' + path.resolve(process.cwd(), 'dev.sqlite3') })
const res = await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
console.log('Tables:', res.rows.map((r: Record<string, unknown>) => r.name).join(', '))
db.close()
