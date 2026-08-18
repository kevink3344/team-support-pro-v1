import { createClient, type Client, type InValue } from '@libsql/client'
import type { DbAdapter, Row } from '../adapter.js'

export class LibsqlAdapter implements DbAdapter {
  constructor(private client: Client) {}

  static create(url: string, authToken?: string): LibsqlAdapter {
    const client = createClient({ url, authToken: authToken || undefined })
    return new LibsqlAdapter(client)
  }

  async queryOne(sql: string, params: InValue[] = []): Promise<Row | undefined> {
    const result = await this.client.execute({ sql, args: params })
    return result.rows[0] as Row | undefined
  }

  async queryAll(sql: string, params: InValue[] = []): Promise<Row[]> {
    const result = await this.client.execute({ sql, args: params })
    return result.rows as unknown as Row[]
  }

  async execute(sql: string, params: InValue[] = []): Promise<{ rowsAffected: number }> {
    const result = await this.client.execute({ sql, args: params })
    return { rowsAffected: result.rowsAffected }
  }

  async batch(statements: Array<{ sql: string; args: InValue[] }>): Promise<void> {
    await this.client.batch(statements, 'write')
  }

  async close(): Promise<void> {
    this.client.close()
  }

  getClient(): Client {
    return this.client
  }
}
