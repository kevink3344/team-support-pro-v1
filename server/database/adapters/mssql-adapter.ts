import sql from 'mssql'
import type { InValue } from '@libsql/client'
import type { DbAdapter, Row } from '../adapter.js'

/**
 * Translate SQLite SQL to SQL Server dialect.
 */
const translateSql = (query: string): string => {
  let result = query

  // Remove COLLATE NOCASE
  result = result.replace(/\s+COLLATE\s+NOCASE/gi, '')

  // Parameterized date('now', ?) / datetime('now', ?) where ? is like '-N days'
  result = result.replace(/date\s*\(\s*'now'\s*,\s*\?\s*\)/gi, "CAST(DATEADD(day, CAST(REPLACE(REPLACE(?, ' days', ''), ' day', '') AS INT), GETUTCDATE()) AS DATE)")
  result = result.replace(/datetime\s*\(\s*'now'\s*,\s*\?\s*\)/gi, "DATEADD(day, CAST(REPLACE(REPLACE(?, ' days', ''), ' day', '') AS INT), GETUTCDATE())")

  // SQLite rowid -> CreatedAt for SQL Server
  result = result.replace(/\bORDER\s+BY\s+rowid\b/gi, 'ORDER BY CreatedAt')
  result = result.replace(/\browid\b/gi, 'CreatedAt')

  // datetime('now', '-N days') -> DATEADD(day, -N, GETUTCDATE())
  result = result.replace(/datetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+days'\s*\)/gi, 'DATEADD(day, -$1, GETUTCDATE())')
  result = result.replace(/datetime\s*\(\s*'now'\s*,\s*'-(\d+)\s+day'\s*\)/gi, 'DATEADD(day, -$1, GETUTCDATE())')

  // datetime('now') -> GETUTCDATE()
  result = result.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'GETUTCDATE()')

  // date('now', '-N days') -> CAST(DATEADD(day, -N, GETUTCDATE()) AS DATE)
  result = result.replace(/date\s*\(\s*'now'\s*,\s*'-(\d+)\s+days'\s*\)/gi, 'CAST(DATEADD(day, -$1, GETUTCDATE()) AS DATE)')
  result = result.replace(/date\s*\(\s*'now'\s*\)/gi, 'CAST(GETUTCDATE() AS DATE)')

  // date(col) -> CAST(col AS DATE)  (but not date('now'...))
  result = result.replace(/\bdate\s*\(\s*([^)'"]+)\s*\)/gi, (match, col) => {
    if (col.trim().startsWith("'")) return match
    return `CAST(${col.trim()} AS DATE)`
  })

  // julianday(a) - julianday(b) -> CAST(DATEDIFF(second, b, a) AS FLOAT) / 86400.0
  result = result.replace(/julianday\s*\(\s*([^)]+)\s*\)\s*-\s*julianday\s*\(\s*([^)]+)\s*\)/gi,
    'CAST(DATEDIFF(second, $2, $1) AS FLOAT) / 86400.0')

  // julianday('now') - julianday(col)
  result = result.replace(/julianday\s*\(\s*'now'\s*\)\s*-\s*julianday\s*\(\s*([^)]+)\s*\)/gi,
    'CAST(DATEDIFF(second, $1, GETUTCDATE()) AS FLOAT) / 86400.0')

  // INSERT OR IGNORE -> INSERT (with WHERE NOT EXISTS handled separately if needed)
  // For simple cases, just remove OR IGNORE and let the caller handle duplicates
  result = result.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO')

  // ON CONFLICT(...) DO UPDATE SET -> handled as MERGE or IF EXISTS
  // For now, convert to a form that won't error; actual upsert logic is in specific callers
  // We replace ON CONFLICT with a comment marker that runMssql handles
  // Simple case: ON CONFLICT(col) DO UPDATE SET ... -> ; IF @@ROWCOUNT = 0 INSERT ...
  // For complex cases, callers should use dialect helpers

  // Wrap reserved word Key (avoid double-wrapping)
  result = result.replace(/(?<!\[)\bKey\b(?!\])/g, '[Key]')
  result = result.replace(/(?<!\[)\"Key\"(?!\])/g, '[Key]')

  return result
}

/**
 * Convert ? placeholders to @p1, @p2, ... for mssql
 */
const toMssqlSql = (query: string): string => {
  let i = 0
  return query.replace(/\?/g, () => `@p${++i}`)
}

/**
 * Handle LIMIT ? at end of query for SQL Server (convert to TOP)
 */
const handleLimit = (query: string, args: InValue[]): { query: string; args: InValue[] } => {
  const limitMatch = query.match(/\bLIMIT\s+\?/i)
  if (!limitMatch) return { query, args }

  const limitValue = args[args.length - 1]
  const remainingArgs = args.slice(0, -1)
  const newQuery = query.replace(/\bLIMIT\s+\?/i, '').trim()
  const topQuery = newQuery.replace(/\bSELECT\s+(DISTINCT\s+)?/i, (_match, distinct) => {
    return `SELECT ${distinct || ''}TOP ${Number(limitValue)} `
  })
  return { query: topQuery, args: remainingArgs }
}

/**
 * Handle LIMIT N (literal) for SQL Server
 */
const handleLiteralLimit = (query: string): string => {
  const match = query.match(/\bLIMIT\s+(\d+)\s*;?\s*$/i)
  if (!match) return query
  const n = match[1]
  const withoutLimit = query.replace(/\bLIMIT\s+\d+\s*;?\s*$/i, '').trim()
  return withoutLimit.replace(/\bSELECT\s+(DISTINCT\s+)?/i, (_m, distinct) => {
    return `SELECT ${distinct || ''}TOP ${n} `
  })
}

/**
 * Normalize SQL Server return values to match SQLite expectations
 */
const normalizeRow = (row: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      normalized[key] = value
    } else if (typeof value === 'boolean') {
      normalized[key] = value ? 1 : 0
    } else if (value instanceof Date) {
      normalized[key] = value.toISOString()
    } else if (typeof value === 'string' && /^\d+$/.test(value) && value.length > 10) {
      // BIGINT as string -> number (for large IDs)
      const num = Number(value)
      normalized[key] = Number.isSafeInteger(num) ? num : value
    } else {
      normalized[key] = value
    }
  }
  return normalized
}

export class MssqlAdapter implements DbAdapter {
  constructor(private pool: sql.ConnectionPool) {}

  private async runQuery(query: string, args: InValue[] = []): Promise<sql.IResult<unknown>> {
    // Handle ON CONFLICT upserts by converting to MERGE/IF EXISTS pattern
    const onConflictMatch = query.match(/ON\s+CONFLICT\s*\(([^)]+)\)\s+DO\s+UPDATE\s+SET\s+(.+?)(?:\s*ON\s+CONFLICT|\s*$)/is)
    if (onConflictMatch) {
      return this.runUpsert(query, args, onConflictMatch)
    }

    const onConflictDoNothing = query.match(/ON\s+CONFLICT\s*\([^)]+\)\s+DO\s+NOTHING/i)
    if (onConflictDoNothing) {
      return this.runInsertOrIgnore(query, args)
    }

    let translated = translateSql(query)
    translated = handleLiteralLimit(translated)

    // Handle LIMIT ? parameter
    const limitHandled = handleLimit(translated, args)
    translated = limitHandled.query
    const finalArgs = limitHandled.args

    const mssqlSql = toMssqlSql(translated)
    const req = this.pool.request()
    finalArgs.forEach((v, idx) => {
      const paramName = `p${idx + 1}`
      if (v === null || v === undefined) {
        req.input(paramName, sql.NVarChar, null)
      } else if (typeof v === 'number') {
        if (Number.isInteger(v)) req.input(paramName, sql.Int, v)
        else req.input(paramName, sql.Float, v)
      } else if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
        req.input(paramName, sql.VarBinary, v)
      } else {
        req.input(paramName, sql.NVarChar, String(v))
      }
    })
    return req.query(mssqlSql)
  }

  private async runUpsert(query: string, args: InValue[], match: RegExpMatchArray): Promise<sql.IResult<unknown>> {
    // Parse: INSERT INTO Table (cols) VALUES (vals) ON CONFLICT(key) DO UPDATE SET col = excluded.col, ...
    const insertMatch = query.match(/INSERT\s+INTO\s+(\S+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i)
    if (!insertMatch) {
      // Fallback: try without ON CONFLICT
      const fallback = query.replace(/ON\s+CONFLICT[^;]*/gi, '')
      return this.runQuery(fallback, args)
    }

    const table = insertMatch[1].replace(/["`\[\]]/g, '')
    const columns = insertMatch[2].split(',').map((c) => c.trim().replace(/["`\[\]]/g, ''))
    const conflictCol = match[1].trim().replace(/["`\[\]]/g, '')
    const setClause = match[2].trim()

    // Build SET clause: "col = excluded.col" -> "col = @pX"
    // The excluded values are the same as the INSERT values
    const setPairs = setClause.split(',').map((s) => s.trim())
    const translatedSets: string[] = []
    for (const pair of setPairs) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) continue
      const col = pair.substring(0, eqIdx).trim().replace(/["`\[\]]/g, '')
      const val = pair.substring(eqIdx + 1).trim()
      // Check if value is excluded.col
      const excludedMatch = val.match(/excluded\.(\S+)/i)
      if (excludedMatch) {
        const excludedCol = excludedMatch[1].replace(/["`\[\]]/g, '')
        const colIdx = columns.findIndex((c) => c.toLowerCase() === excludedCol.toLowerCase())
        if (colIdx !== -1) {
          translatedSets.push(`${col} = @p${colIdx + 1}`)
        } else {
          translatedSets.push(`${col} = ${val}`)
        }
      } else if (val.toLowerCase().includes("datetime('now')") || val.toLowerCase().includes('getutcdate')) {
        translatedSets.push(`${col} = GETUTCDATE()`)
      } else {
        translatedSets.push(`${col} = ${val}`)
      }
    }

    // Find conflict column index
    const conflictIdx = columns.findIndex((c) => c.toLowerCase() === conflictCol.toLowerCase())

    // Build IF EXISTS ... UPDATE ELSE INSERT
    const conflictParam = conflictIdx !== -1 ? `@p${conflictIdx + 1}` : `'unknown'`
    const bracket = (col: string) => col.toLowerCase() === 'key' ? `[${col}]` : col
    const bracketedConflictCol = bracket(conflictCol)
    const bracketedColumns = columns.map(bracket)
    const bracketedSets = translatedSets.map((s) => {
      const eqIdx = s.indexOf('=')
      if (eqIdx === -1) return s
      const col = s.substring(0, eqIdx).trim()
      const val = s.substring(eqIdx + 1).trim()
      return `${bracket(col)} = ${val}`
    })
    const updateSql = `IF EXISTS (SELECT 1 FROM ${table} WHERE ${bracketedConflictCol} = ${conflictParam}) UPDATE ${table} SET ${bracketedSets.join(', ')} WHERE ${bracketedConflictCol} = ${conflictParam} ELSE INSERT INTO ${table} (${bracketedColumns.join(', ')}) VALUES (${columns.map((_, i) => `@p${i + 1}`).join(', ')})`

    const translated = translateSql(updateSql)
    const mssqlSql = toMssqlSql(translated) // already has @p params, but ensure no ? remain
    // Since we already use @p params, don't re-convert ?
    const req = this.pool.request()
    args.forEach((v, idx) => {
      const paramName = `p${idx + 1}`
      if (v === null || v === undefined) req.input(paramName, sql.NVarChar, null)
      else if (typeof v === 'number') {
        if (Number.isInteger(v)) req.input(paramName, sql.Int, v)
        else req.input(paramName, sql.Float, v)
      } else if (v instanceof Uint8Array || Buffer.isBuffer(v)) req.input(paramName, sql.VarBinary, v)
      else req.input(paramName, sql.NVarChar, String(v))
    })
    // Need to add duplicate param for the WHERE clause check
    // The conflict param is already @pN, but we need it twice (EXISTS check + UPDATE WHERE)
    // mssql handles this since we use the same @pN in both places
    return req.query(mssqlSql)
  }

  private async runInsertOrIgnore(query: string, args: InValue[]): Promise<sql.IResult<unknown>> {
    // INSERT INTO T (cols) VALUES (vals) ON CONFLICT(col) DO NOTHING
    // -> IF NOT EXISTS (SELECT 1 FROM T WHERE col = @pN) INSERT INTO T ...
    const insertMatch = query.match(/INSERT\s+INTO\s+(\S+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i)
    const conflictMatch = query.match(/ON\s+CONFLICT\s*\(([^)]+)\)/i)
    if (!insertMatch || !conflictMatch) {
      const fallback = query.replace(/ON\s+CONFLICT[^;]*/gi, '')
      return this.runQuery(fallback, args)
    }
    const table = insertMatch[1].replace(/["`\[\]]/g, '')
    const columns = insertMatch[2].split(',').map((c) => c.trim().replace(/["`\[\]]/g, ''))
    const conflictCol = conflictMatch[1].trim().replace(/["`\[\]]/g, '')
    const conflictIdx = columns.findIndex((c) => c.toLowerCase() === conflictCol.toLowerCase())
    const bracket = (col: string) => col.toLowerCase() === 'key' ? `[${col}]` : col
    const bracketedConflictCol = bracket(conflictCol)

    const baseInsert = query.replace(/ON\s+CONFLICT[^;]*/gi, '').trim()
    const translated = translateSql(baseInsert)
    const mssqlSql = toMssqlSql(translated)
    let guardedSql: string
    if (conflictIdx !== -1 && args.length > conflictIdx) {
      const conflictParam = `@p${conflictIdx + 1}`
      guardedSql = `IF NOT EXISTS (SELECT 1 FROM ${table} WHERE ${bracketedConflictCol} = ${conflictParam}) ${mssqlSql}`
    } else if (conflictIdx !== -1) {
      const rawValues = insertMatch[3].split(',').map((v: string) => v.trim())
      let conflictLiteral = rawValues[conflictIdx] ?? `'unknown'`
      conflictLiteral = conflictLiteral.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'GETUTCDATE()')
      guardedSql = `IF NOT EXISTS (SELECT 1 FROM ${table} WHERE ${bracketedConflictCol} = ${conflictLiteral}) ${mssqlSql}`
    } else {
      guardedSql = mssqlSql
    }

    const req = this.pool.request()
    args.forEach((v, idx) => {
      const paramName = `p${idx + 1}`
      if (v === null || v === undefined) req.input(paramName, sql.NVarChar, null)
      else if (typeof v === 'number') {
        if (Number.isInteger(v)) req.input(paramName, sql.Int, v)
        else req.input(paramName, sql.Float, v)
      } else if (v instanceof Uint8Array || Buffer.isBuffer(v)) req.input(paramName, sql.VarBinary, v)
      else req.input(paramName, sql.NVarChar, String(v))
    })
    return req.query(guardedSql)
  }

  async queryOne(query: string, args: InValue[] = []): Promise<Row | undefined> {
    const result = await this.runQuery(query, args)
    const row = (result.recordset as Row[])[0]
    return row ? normalizeRow(row as Record<string, unknown>) as Row : undefined
  }

  async queryAll(query: string, args: InValue[] = []): Promise<Row[]> {
    const result = await this.runQuery(query, args)
    return (result.recordset as Row[]).map((r) => normalizeRow(r as Record<string, unknown>) as Row)
  }

  async execute(query: string, args: InValue[] = []): Promise<{ rowsAffected: number }> {
    const result = await this.runQuery(query, args)
    return { rowsAffected: result.rowsAffected[0] ?? 0 }
  }

  async batch(statements: Array<{ sql: string; args: InValue[] }>): Promise<void> {
    for (const stmt of statements) {
      await this.runQuery(stmt.sql, stmt.args)
    }
  }

  async close(): Promise<void> {
    await this.pool.close()
  }
}
