import { serverConfig } from '../config.js'

export type Dialect = 'turso' | 'sqlserver' | 'sqlite'

export const getDialect = (): Dialect => {
  const mode = serverConfig.db.mode
  if (mode === 'sqlserver') return 'sqlserver'
  if (mode === 'sqlite') return 'sqlite'
  return 'turso'
}

export const isSqlServer = (): boolean => getDialect() === 'sqlserver'

/**
 * Returns a dialect-appropriate expression for "now" (UTC).
 * Use inside template literals: `UPDATE t SET updated_at = ${nowExpr()}`
 */
export const nowExpr = (): string => {
  return isSqlServer() ? 'GETUTCDATE()' : "datetime('now')"
}

/**
 * Returns a dialect-appropriate expression for "N days ago".
 */
export const daysAgoExpr = (days: number): string => {
  if (isSqlServer()) return `DATEADD(day, -${days}, GETUTCDATE())`
  return `datetime('now', '-${days} days')`
}

/**
 * Builds an INSERT OR IGNORE statement that works on both dialects.
 * For SQL Server it generates INSERT ... WHERE NOT EXISTS.
 */
export const insertOrIgnore = (
  table: string,
  columns: string[],
  conflictColumns: string[],
  valuesPlaceholder: string = `(${columns.map(() => '?').join(', ')})`,
): string => {
  if (isSqlServer()) {
    const colList = columns.join(', ')
    // Use a SELECT-based insert with NOT EXISTS for SQL Server
    // Caller should use: INSERT INTO t (cols) SELECT vals WHERE NOT EXISTS (...)
    // Simplified: generate a statement that the adapter will handle
    return `INSERT INTO ${table} (${colList}) SELECT ${columns.map(() => `?`).join(', ')} WHERE NOT EXISTS (SELECT 1 FROM ${table} t WHERE ${conflictColumns.map((c) => `t.${c} = ?`).join(' AND ')})`
  }
  return `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES ${valuesPlaceholder}`
}

/**
 * Translate SQLite-specific SQL to SQL Server dialect.
 * Called automatically by MssqlAdapter before every query.
 */
export const translateSql = (sql: string): string => {
  let result = sql

  // Remove COLLATE NOCASE (SQL Server is CI by default)
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

  // date(col) -> CAST(col AS DATE)
  result = result.replace(/\bdate\s*\(\s*([^)]+)\s*\)/gi, 'CAST($1 AS DATE)')

  // julianday(col) differences -> DATEDIFF
  // julianday(a) - julianday(b) -> DATEDIFF(day, b, a)  (approximate, returns fractional via second diff)
  // For day differences: use DATEDIFF with second then divide
  result = result.replace(/julianday\s*\(\s*([^)]+)\s*\)\s*-\s*julianday\s*\(\s*([^)]+)\s*\)/gi,
    'CAST(DATEDIFF(second, $2, $1) AS FLOAT) / 86400.0')

  // julianday('now') - julianday(col) -> DATEDIFF
  result = result.replace(/julianday\s*\(\s*'now'\s*\)\s*-\s*julianday\s*\(\s*([^)]+)\s*\)/gi,
    'CAST(DATEDIFF(second, $1, GETUTCDATE()) AS FLOAT) / 86400.0')

  // LIMIT n -> TOP n (handle SELECT ... LIMIT ? and SELECT ... LIMIT n)
  // This is a simple transform; for parameterized LIMIT we handle separately
  result = result.replace(/\bLIMIT\s+\?/gi, '')

  // Wrap reserved words
  result = result.replace(/\bKey\b(?=\s*[=,\)])/g, '[Key]')
  result = result.replace(/\bkey\b(?=\s*[=,\)])/g, '[key]')

  return result
}

/**
 * Handle LIMIT ? parameter for SQL Server by converting to TOP.
 * Returns { sql, args } with TOP applied and LIMIT param removed.
 */
export const handleLimitParam = (sql: string, args: unknown[]): { sql: string; args: unknown[] } => {
  if (!isSqlServer()) return { sql, args }

  const limitMatch = sql.match(/\bLIMIT\s+\?/i)
  if (!limitMatch) return { sql, args }

  // Extract the limit value (last arg corresponds to LIMIT ?)
  const limitValue = args[args.length - 1]
  const remainingArgs = args.slice(0, -1)
  const newSql = sql.replace(/\bLIMIT\s+\?/i, '').trim()

  // Insert TOP after SELECT or SELECT DISTINCT
  const topSql = newSql.replace(/\bSELECT\s+(DISTINCT\s+)?/i, (_match, distinct) => {
    return `SELECT ${distinct || ''}TOP ${Number(limitValue)} `
  })

  return { sql: topSql, args: remainingArgs }
}
