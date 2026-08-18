import type { InValue } from '@libsql/client'

export type Row = Record<string, unknown>

export interface DbAdapter {
  queryOne(sql: string, params?: InValue[]): Promise<Row | undefined>
  queryAll(sql: string, params?: InValue[]): Promise<Row[]>
  execute(sql: string, params?: InValue[]): Promise<{ rowsAffected: number }>
  batch(statements: Array<{ sql: string; args: InValue[] }>, mode?: string): Promise<void>
  close(): Promise<void>
}
