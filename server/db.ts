import { createClient, type Client, type InValue } from '@libsql/client'
import sql from 'mssql'

import { serverConfig } from './config.js'

export type { Client }
export type Row = Record<string, InValue>

// ---------------------------------------------------------------------------
// Singleton libsql client (turso mode)
// ---------------------------------------------------------------------------

let client: Client | null = null
let sqlPool: sql.ConnectionPool | null = null

export const getDb = (): Client => {
  const mode = serverConfig.db.mode
  if (mode === 'sqlserver') {
    // Return a stub — SQL Server callers go through getPool() via the helpers
    if (!client) {
      // Create a noop libsql client (unused) to satisfy TypeScript callers
      // Actual queries are routed through mssql pool in dbGet/dbAll/dbRun
      client = createClient({ url: 'file::memory:' })
    }
    return client
  }
  if (mode === 'turso') {
    if (!client) {
      const tursoUrl = serverConfig.db.tursoUrl.trim()
      if (!tursoUrl) throw new Error('DB_MODE is "turso" but TURSO_DB_URL is not set.')
      client = createClient({ url: tursoUrl, authToken: serverConfig.db.tursoToken.trim() || undefined })
      console.log('Database: connected to Turso remote')
    }
    return client
  }
  throw new Error(`DB_MODE "${mode}" is not configured. Set DB_MODE to "turso" or "sqlserver" in your .env file.`)
}

export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (!sqlPool) {
    const { server, port, database, user, password } = serverConfig.db
    if (!server || !database) throw new Error('DB_MODE is "sqlserver" but DB_SERVER/DB_DATABASE are not configured.')
    sqlPool = await sql.connect({
      server,
      port,
      database,
      user,
      password,
      options: { encrypt: true, trustServerCertificate: false },
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    })
    console.log('Database: connected to SQL Server')
  }
  return sqlPool
}

export const hasDatabaseConfig = () => true

// ---------------------------------------------------------------------------
// Query helpers — wrap libsql execute for convenience
// ---------------------------------------------------------------------------

// Convert SQLite-style ? positional args to SQL Server @p1, @p2, ... named params
const toMssqlSql = (query: string): string => {
  let i = 0
  return query.replace(/\?/g, () => `@p${++i}`)
}

const runMssql = async (query: string, args: InValue[] = []) => {
  const pool = await getPool()
  const req = pool.request()
  args.forEach((v, idx) => { req.input(`p${idx + 1}`, v as unknown as sql.ISqlTypeFactoryWithNoParams) })
  return req.query(toMssqlSql(query))
}

export const dbGet = async (
  db: Client,
  query: string,
  args: InValue[] = [],
): Promise<Row | undefined> => {
  if (serverConfig.db.mode === 'sqlserver') {
    const result = await runMssql(query, args)
    return result.recordset[0] as Row | undefined
  }
  const result = await db.execute({ sql: query, args })
  return result.rows[0] as Row | undefined
}

export const dbAll = async (
  db: Client,
  query: string,
  args: InValue[] = [],
): Promise<Row[]> => {
  if (serverConfig.db.mode === 'sqlserver') {
    const result = await runMssql(query, args)
    return result.recordset as unknown as Row[]
  }
  const result = await db.execute({ sql: query, args })
  return result.rows as unknown as Row[]
}

export const dbRun = async (
  db: Client,
  query: string,
  args: InValue[] = [],
): Promise<{ rowsAffected: number }> => {
  if (serverConfig.db.mode === 'sqlserver') {
    const result = await runMssql(query, args)
    return { rowsAffected: result.rowsAffected[0] ?? 0 }
  }
  const result = await db.execute({ sql: query, args })
  return { rowsAffected: result.rowsAffected }
}

// ---------------------------------------------------------------------------
// Schema & migrations
// ---------------------------------------------------------------------------

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS Organizations (
    Id TEXT PRIMARY KEY,
    Name TEXT NOT NULL,
    Code TEXT NOT NULL,
    AccentColor TEXT NOT NULL DEFAULT '#334155',
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS Teams (
    Id TEXT PRIMARY KEY,
    OrganizationId TEXT NOT NULL,
    Name TEXT NOT NULL,
    Code TEXT NOT NULL,
    AccentColor TEXT NOT NULL DEFAULT '#0078d4',
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (OrganizationId) REFERENCES Organizations(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS Categories (
    Id TEXT PRIMARY KEY,
    TeamId TEXT NOT NULL,
    Name TEXT NOT NULL,
    Description TEXT NOT NULL DEFAULT '',
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (TeamId) REFERENCES Teams(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS Users (
    Id TEXT PRIMARY KEY,
    Name TEXT NOT NULL,
    DisplayName TEXT,
    Email TEXT NOT NULL,
    OrganizationId TEXT NOT NULL,
    TeamId TEXT NOT NULL,
    Role TEXT NOT NULL DEFAULT 'Staff',
    CanViewAllOrgTickets INTEGER NOT NULL DEFAULT 0,
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (OrganizationId) REFERENCES Organizations(Id),
    FOREIGN KEY (TeamId) REFERENCES Teams(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS Tickets (
    Id TEXT PRIMARY KEY,
    Title TEXT NOT NULL,
    Description TEXT NOT NULL,
    Status TEXT NOT NULL DEFAULT 'Open',
    Priority TEXT NOT NULL DEFAULT 'Medium',
    TeamId TEXT NOT NULL,
    CategoryId TEXT NOT NULL,
    AssignedToId TEXT,
    RequestorName TEXT NOT NULL,
    RequestorEmail TEXT NOT NULL,
    Location TEXT NOT NULL DEFAULT 'Not specified',
    DueLabel TEXT NOT NULL DEFAULT 'New in queue',
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (TeamId) REFERENCES Teams(Id),
    FOREIGN KEY (CategoryId) REFERENCES Categories(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS TicketActivity (
    Id TEXT PRIMARY KEY,
    TicketId TEXT NOT NULL,
    Actor TEXT NOT NULL,
    Message TEXT NOT NULL,
    ActivityAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (TicketId) REFERENCES Tickets(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS TicketAttachments (
    Id TEXT PRIMARY KEY,
    TicketId TEXT NOT NULL,
    FileName TEXT NOT NULL,
    ContentType TEXT NOT NULL DEFAULT 'application/octet-stream',
    FileSizeBytes INTEGER NOT NULL DEFAULT 0,
    FileContent BLOB,
    UploadedByUserId TEXT NOT NULL,
    UploadedByName TEXT NOT NULL,
    UploadedAt TEXT DEFAULT (datetime('now')),
    IsDeleted INTEGER NOT NULL DEFAULT 0,
    DeletedAt TEXT,
    DeletedByUserId TEXT,
    FOREIGN KEY (TicketId) REFERENCES Tickets(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS TeamTicketTrends (
    TrendDate TEXT NOT NULL,
    TeamId TEXT NOT NULL,
    TicketCount INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (TrendDate, TeamId)
  )`,
  `CREATE TABLE IF NOT EXISTS AppSettings (
    Key TEXT PRIMARY KEY,
    Value TEXT NOT NULL,
    UpdatedAt TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS TicketWatchers (
    TicketId TEXT NOT NULL,
    UserId TEXT NOT NULL,
    AddedAt TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (TicketId, UserId),
    FOREIGN KEY (TicketId) REFERENCES Tickets(Id),
    FOREIGN KEY (UserId) REFERENCES Users(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS FeedbackForms (
    Id TEXT PRIMARY KEY,
    OrganizationId TEXT NOT NULL,
    IsEnabled INTEGER NOT NULL DEFAULT 0,
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (OrganizationId) REFERENCES Organizations(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS FeedbackFormFields (
    Id TEXT PRIMARY KEY,
    FormId TEXT NOT NULL,
    FieldType TEXT NOT NULL,
    Label TEXT NOT NULL,
    IsRequired INTEGER NOT NULL DEFAULT 0,
    SortOrder INTEGER NOT NULL DEFAULT 0,
    OptionsJson TEXT NOT NULL DEFAULT '[]',
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (FormId) REFERENCES FeedbackForms(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS FeedbackTokens (
    Token TEXT PRIMARY KEY,
    TicketId TEXT,
    OrganizationId TEXT NOT NULL,
    IsTest INTEGER NOT NULL DEFAULT 0,
    ExpiresAt TEXT NOT NULL,
    UsedAt TEXT,
    CreatedAt TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS FeedbackResponses (
    Id TEXT PRIMARY KEY,
    Token TEXT NOT NULL,
    TicketId TEXT,
    OrganizationId TEXT NOT NULL,
    TeamId TEXT,
    CategoryId TEXT,
    RequestorEmail TEXT,
    IsTest INTEGER NOT NULL DEFAULT 0,
    FormSnapshotJson TEXT NOT NULL DEFAULT '[]',
    SubmittedAt TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS FeedbackResponseAnswers (
    Id TEXT PRIMARY KEY,
    ResponseId TEXT NOT NULL,
    FieldId TEXT NOT NULL,
    FieldLabel TEXT NOT NULL,
    FieldType TEXT NOT NULL,
    Value TEXT NOT NULL,
    FOREIGN KEY (ResponseId) REFERENCES FeedbackResponses(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS TicketFieldDefinitions (
    Id TEXT PRIMARY KEY,
    OrganizationId TEXT NOT NULL,
    FieldType TEXT NOT NULL,
    Label TEXT NOT NULL,
    IsRequired INTEGER NOT NULL DEFAULT 0,
    SortOrder INTEGER NOT NULL DEFAULT 0,
    OptionsJson TEXT NOT NULL DEFAULT '[]',
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (OrganizationId) REFERENCES Organizations(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS TicketLayouts (
    Id TEXT PRIMARY KEY,
    OrganizationId TEXT NOT NULL UNIQUE,
    LayoutJson TEXT NOT NULL DEFAULT '{"rows":[]}',
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (OrganizationId) REFERENCES Organizations(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS TicketLayoutVersions (
    Id TEXT PRIMARY KEY,
    OrganizationId TEXT NOT NULL,
    VersionNumber INTEGER NOT NULL,
    LayoutJson TEXT NOT NULL,
    Description TEXT NOT NULL DEFAULT '',
    CreatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (OrganizationId) REFERENCES Organizations(Id) ON DELETE CASCADE,
    UNIQUE (OrganizationId, VersionNumber)
  )`,
  `CREATE TABLE IF NOT EXISTS TicketCustomFieldValues (
    Id TEXT PRIMARY KEY,
    TicketId TEXT NOT NULL,
    FieldId TEXT NOT NULL,
    FieldLabel TEXT NOT NULL,
    FieldType TEXT NOT NULL,
    Value TEXT NOT NULL,
    CreatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (TicketId) REFERENCES Tickets(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS TicketVersions (
    Id TEXT PRIMARY KEY,
    TicketId TEXT NOT NULL,
    VersionNumber INTEGER NOT NULL,
    Title TEXT NOT NULL,
    Description TEXT NOT NULL,
    Status TEXT NOT NULL,
    Priority TEXT NOT NULL,
    TeamId TEXT NOT NULL,
    CategoryId TEXT NOT NULL,
    AssignedToId TEXT,
    RequestorName TEXT NOT NULL,
    RequestorEmail TEXT NOT NULL,
    Location TEXT NOT NULL,
    DueLabel TEXT NOT NULL,
    CreatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (TicketId) REFERENCES Tickets(Id) ON DELETE CASCADE,
    UNIQUE (TicketId, VersionNumber)
  )`,
  `CREATE TABLE IF NOT EXISTS TicketVersionCustomFieldValues (
    Id TEXT PRIMARY KEY,
    TicketVersionId TEXT NOT NULL,
    FieldId TEXT NOT NULL,
    FieldLabel TEXT NOT NULL,
    FieldType TEXT NOT NULL,
    Value TEXT NOT NULL,
    FOREIGN KEY (TicketVersionId) REFERENCES TicketVersions(Id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS WebhookConfigs (
    Id TEXT PRIMARY KEY,
    OrganizationId TEXT NOT NULL,
    Url TEXT NOT NULL,
    Secret TEXT NOT NULL DEFAULT '',
    Events TEXT NOT NULL DEFAULT '[]',
    IsEnabled INTEGER NOT NULL DEFAULT 1,
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (OrganizationId) REFERENCES Organizations(Id)
  )`,
  `CREATE TABLE IF NOT EXISTS Locations (
    Id TEXT PRIMARY KEY,
    Name TEXT NOT NULL UNIQUE,
    IsActive INTEGER NOT NULL DEFAULT 1,
    SortOrder INTEGER NOT NULL DEFAULT 0,
    CreatedAt TEXT DEFAULT (datetime('now')),
    UpdatedAt TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS settings_tabs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    visible_to TEXT NOT NULL DEFAULT 'all' CHECK(visible_to IN ('all', 'super_admin')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS settings_tab_sections (
    id TEXT PRIMARY KEY,
    tab_id TEXT NOT NULL,
    section_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tab_id) REFERENCES settings_tabs(id) ON DELETE CASCADE,
    UNIQUE (tab_id, section_key)
  )`,
]

const MIGRATION_STATEMENTS = [
  `ALTER TABLE Teams ADD COLUMN OrganizationId TEXT`,
  `ALTER TABLE Users ADD COLUMN OrganizationId TEXT`,
  `ALTER TABLE Tickets ADD COLUMN ResolvedAt TEXT`,
  `ALTER TABLE Tickets ADD COLUMN RequestorName TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE Tickets ADD COLUMN RequestorEmail TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE Tickets ADD COLUMN Location TEXT NOT NULL DEFAULT 'Not specified'`,
  `ALTER TABLE TicketFieldDefinitions ADD COLUMN OrganizationId TEXT`,
  `ALTER TABLE Users ADD COLUMN CanViewAllOrgTickets INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE TicketLayoutVersions ADD COLUMN Description TEXT NOT NULL DEFAULT ''`,
]

const recreateTicketFieldDefinitionsWithoutTeamId = async (db: Client): Promise<void> => {
  // Legacy remote databases were created with a TeamId column that the current
  // schema no longer uses. SQLite/Turso cannot drop a column that is part of a
  // foreign key, so we recreate the table and copy the data.
  const info = await db.execute(
    "SELECT 1 AS hasTeamId FROM pragma_table_info('TicketFieldDefinitions') WHERE name = 'TeamId'",
  )
  if (!info.rows[0]) return

  await db.execute(`
    CREATE TABLE TicketFieldDefinitions_new (
      Id TEXT PRIMARY KEY,
      OrganizationId TEXT NOT NULL,
      FieldType TEXT NOT NULL,
      Label TEXT NOT NULL,
      IsRequired INTEGER NOT NULL DEFAULT 0,
      SortOrder INTEGER NOT NULL DEFAULT 0,
      OptionsJson TEXT NOT NULL DEFAULT '[]',
      CreatedAt TEXT DEFAULT (datetime('now')),
      UpdatedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (OrganizationId) REFERENCES Organizations(Id)
    )
  `)
  await db.execute(`
    INSERT INTO TicketFieldDefinitions_new
      (Id, OrganizationId, FieldType, Label, IsRequired, SortOrder, OptionsJson, CreatedAt, UpdatedAt)
    SELECT
      Id,
      COALESCE(OrganizationId, (SELECT Teams.OrganizationId FROM Teams WHERE Teams.Id = TicketFieldDefinitions.TeamId), ?),
      FieldType, Label, IsRequired, SortOrder, OptionsJson, CreatedAt, UpdatedAt
    FROM TicketFieldDefinitions
  `, [serverConfig.fallbackOrganization.id])
  await db.execute('DROP TABLE TicketFieldDefinitions')
  await db.execute('ALTER TABLE TicketFieldDefinitions_new RENAME TO TicketFieldDefinitions')
}

const runMigrations = async (db: Client) => {
  // Run each migration individually — ignore errors (column already exists)
  for (const sql of MIGRATION_STATEMENTS) {
    try {
      await db.execute(sql)
    } catch {
      // Column already exists — safe to ignore
    }
  }

  await recreateTicketFieldDefinitionsWithoutTeamId(db)

  const fallback = serverConfig.fallbackOrganization
  await db.execute({
    sql: `INSERT INTO Organizations (Id, Name, Code, AccentColor)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(Id) DO UPDATE SET
            Name = excluded.Name, Code = excluded.Code,
            AccentColor = excluded.AccentColor, UpdatedAt = datetime('now')`,
    args: [fallback.id, fallback.name, fallback.code, fallback.accent],
  })
  await db.execute({
    sql: `UPDATE Teams SET OrganizationId = ? WHERE OrganizationId IS NULL OR trim(OrganizationId) = ''`,
    args: [fallback.id],
  })
  await db.execute({
    sql: `UPDATE Users SET OrganizationId = COALESCE(
            (SELECT Teams.OrganizationId FROM Teams WHERE Teams.Id = Users.TeamId), ?
          ) WHERE OrganizationId IS NULL OR trim(OrganizationId) = ''`,
    args: [fallback.id],
  })
}

const backfillDefaultLayouts = async (db: Client): Promise<void> => {
  const fallback = serverConfig.fallbackOrganization
  const customFields = await dbAll(
    db,
    'SELECT Id AS id FROM TicketFieldDefinitions WHERE OrganizationId = ? ORDER BY SortOrder ASC',
    [fallback.id],
  )
  const builtInRows: Array<{ id: string; slots: Array<{ fieldRef: string; width: 'full' | 'half' }> }> = [
    { id: 'row-default-1', slots: [{ fieldRef: 'title', width: 'full' }] },
    { id: 'row-default-2', slots: [{ fieldRef: 'requestorName', width: 'half' }, { fieldRef: 'requestorEmail', width: 'half' }] },
    { id: 'row-default-3', slots: [{ fieldRef: 'categoryId', width: 'half' }, { fieldRef: 'priority', width: 'half' }] },
    { id: 'row-default-4', slots: [{ fieldRef: 'assignedToId', width: 'half' }, { fieldRef: 'location', width: 'half' }] },
    { id: 'row-default-5', slots: [{ fieldRef: 'description', width: 'full' }] },
  ]
  for (const field of customFields) {
    builtInRows.push({ id: `row-default-${String(field.id)}`, slots: [{ fieldRef: String(field.id), width: 'full' }] })
  }
  const defaultLayout = { rows: builtInRows }
  await db.execute({
    sql: `INSERT INTO TicketLayouts (Id, OrganizationId, LayoutJson)
          VALUES (?, ?, ?)
          ON CONFLICT(OrganizationId) DO UPDATE SET
            LayoutJson = excluded.LayoutJson, UpdatedAt = datetime('now')`,
    args: [`layout-${fallback.id}`, fallback.id, JSON.stringify(defaultLayout)],
  })
}

const isDatabaseEmpty = async (db: Client): Promise<boolean> => {
  const result = await db.execute('SELECT COUNT(*) AS count FROM Teams')
  const count = Number(result.rows[0]?.count ?? 0)
  return count === 0
}

const seedDatabase = async (db: Client) => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
  const fallback = serverConfig.fallbackOrganization

  const statements: Array<{ sql: string; args: InValue[] }> = []

  statements.push({
    sql: 'INSERT INTO Organizations (Id, Name, Code, AccentColor) VALUES (?, ?, ?, ?)',
    args: [fallback.id, fallback.name, fallback.code, fallback.accent],
  })

  const teams: [string, string, string, string][] = [
    ['it', 'IT Support', 'IT', '#0078d4'],
    ['facilities', 'Facilities', 'FAC', '#2f9e44'],
    ['hr', 'Human Resources', 'HR', '#e8590c'],
  ]
  for (const [id, name, code, accent] of teams) {
    statements.push({
      sql: 'INSERT INTO Teams (Id, OrganizationId, Name, Code, AccentColor) VALUES (?, ?, ?, ?, ?)',
      args: [id, fallback.id, name, code, accent],
    })
  }

  const categories: [string, string, string, string][] = [
    ['cat-it-hardware', 'it', 'Hardware', 'Hardware issues and requests'],
    ['cat-it-software', 'it', 'Software', 'Software installation and issues'],
    ['cat-it-network', 'it', 'Network', 'Network and connectivity issues'],
    ['cat-it-account', 'it', 'Account Access', 'Account and password issues'],
    ['cat-fac-maintenance', 'facilities', 'Maintenance', 'Building maintenance requests'],
    ['cat-fac-safety', 'facilities', 'Safety', 'Safety concerns and reports'],
    ['cat-hr-onboarding', 'hr', 'Onboarding', 'New employee onboarding'],
    ['cat-hr-benefits', 'hr', 'Benefits', 'Benefits questions and requests'],
  ]
  for (const [id, teamId, name, desc] of categories) {
    statements.push({
      sql: 'INSERT INTO Categories (Id, TeamId, Name, Description) VALUES (?, ?, ?, ?)',
      args: [id, teamId, name, desc],
    })
  }

  const users: [string, string, string, string, string, string][] = [
    ['u-kevin', 'Kevin Key', 'kevin.key@company.com', fallback.id, 'it', 'Admin'],
    ['u-diana', 'Diana Park', 'diana.park@company.com', fallback.id, 'it', 'Staff'],
    ['u-alex', 'Alex Rivera', 'alex.rivera@company.com', fallback.id, 'it', 'Staff'],
    ['u-michael', 'Michael Chen', 'michael.chen@company.com', fallback.id, 'facilities', 'Staff'],
    ['u-sarah', 'Sarah Johnson', 'sarah.johnson@company.com', fallback.id, 'facilities', 'Admin'],
    ['u-emily', 'Emily Davis', 'emily.davis@company.com', fallback.id, 'hr', 'Staff'],
  ]
  for (const [id, name, email, orgId, teamId, role] of users) {
    statements.push({
      sql: 'INSERT INTO Users (Id, Name, DisplayName, Email, OrganizationId, TeamId, Role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [id, name, name, email, orgId, teamId, role],
    })
  }

  const ticketSql = `INSERT INTO Tickets (Id, Title, Description, Status, Priority, TeamId, CategoryId, AssignedToId, RequestorName, RequestorEmail, Location, DueLabel, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  const tickets: InValue[][] = [
    ['TKT-10001', 'Laptop not booting', 'My laptop shows a black screen after the login prompt. Tried restarting multiple times.', 'Open', 'High', 'it', 'cat-it-hardware', 'u-diana', 'James Wilson', 'james.wilson@company.com', 'Building A, Room 204', 'Today', daysAgo(0), daysAgo(0)],
    ['TKT-10002', 'Install Adobe Creative Suite', 'Need Adobe Creative Suite installed for the marketing project starting next week.', 'In Progress', 'Medium', 'it', 'cat-it-software', 'u-alex', 'Maria Garcia', 'maria.garcia@company.com', 'Building B, Room 110', 'This week', daysAgo(2), daysAgo(1)],
    ['TKT-10003', 'VPN connection drops frequently', 'Remote VPN disconnects every 15-20 minutes. Using Cisco AnyConnect on Windows 11.', 'Open', 'High', 'it', 'cat-it-network', 'u-kevin', 'Tom Anderson', 'tom.anderson@company.com', 'Remote', 'Today', daysAgo(1), daysAgo(0)],
    ['TKT-10004', 'Password reset for ERP system', 'Locked out of the ERP system after too many failed attempts. Need urgent password reset.', 'Resolved', 'Critical', 'it', 'cat-it-account', 'u-diana', 'Lisa Brown', 'lisa.brown@company.com', 'Building A, Room 312', 'Completed', daysAgo(3), daysAgo(2)],
    ['TKT-10005', 'New monitor request', 'Need an additional 27-inch monitor for dual-screen setup. Approved by manager.', 'Pending', 'Low', 'it', 'cat-it-hardware', null, 'Robert Taylor', 'robert.taylor@company.com', 'Building C, Room 501', 'Next week', daysAgo(5), daysAgo(3)],
    ['TKT-10006', 'Broken window in conference room', 'Large crack in the window of conference room 3B. Potential safety hazard.', 'Open', 'High', 'facilities', 'cat-fac-safety', 'u-michael', 'Anna Lee', 'anna.lee@company.com', 'Building A, Conference Room 3B', 'Today', daysAgo(0), daysAgo(0)],
    ['TKT-10007', 'HVAC not working in east wing', 'Temperature is too high in the east wing offices. AC appears to be off.', 'In Progress', 'Medium', 'facilities', 'cat-fac-maintenance', 'u-sarah', 'David Kim', 'david.kim@company.com', 'Building B, East Wing', 'This week', daysAgo(1), daysAgo(0)],
    ['TKT-10008', 'New hire onboarding - Jane Smith', 'Jane Smith starts Monday. Need workstation setup, badge, and system access.', 'Open', 'High', 'hr', 'cat-hr-onboarding', 'u-emily', 'Mark Thompson', 'mark.thompson@company.com', 'Building A, HR Office', 'This week', daysAgo(2), daysAgo(1)],
    ['TKT-10009', 'Printer paper jam on 3rd floor', 'The HP LaserJet on the 3rd floor keeps jamming. Already tried clearing it.', 'Closed', 'Low', 'it', 'cat-it-hardware', 'u-alex', 'Chris Martin', 'chris.martin@company.com', 'Building A, 3rd Floor', 'Completed', daysAgo(7), daysAgo(5)],
    ['TKT-10010', 'Benefits enrollment question', 'Need help understanding the dental plan options for open enrollment.', 'Pending', 'Low', 'hr', 'cat-hr-benefits', 'u-emily', 'Rachel Green', 'rachel.green@company.com', 'Remote', 'Next week', daysAgo(3), daysAgo(2)],
  ]
  for (const args of tickets) statements.push({ sql: ticketSql, args })

  const activities: [string, string, string, string, string][] = [
    ['act-1', 'TKT-10001', 'System', 'Ticket created from TeamSupportPro.', daysAgo(0)],
    ['act-2', 'TKT-10002', 'System', 'Ticket created from TeamSupportPro.', daysAgo(2)],
    ['act-3', 'TKT-10002', 'Alex Rivera', 'Changed status from Open to In Progress.', daysAgo(1)],
    ['act-4', 'TKT-10002', 'Alex Rivera', 'Started downloading installer from Adobe admin console.', daysAgo(1)],
    ['act-5', 'TKT-10003', 'System', 'Ticket created from TeamSupportPro.', daysAgo(1)],
    ['act-6', 'TKT-10004', 'System', 'Ticket created from TeamSupportPro.', daysAgo(3)],
    ['act-7', 'TKT-10004', 'Diana Park', 'Changed status from Open to In Progress.', daysAgo(3)],
    ['act-8', 'TKT-10004', 'Diana Park', 'Password reset completed. User notified via email.', daysAgo(2)],
    ['act-9', 'TKT-10004', 'Diana Park', 'Changed status from In Progress to Resolved.', daysAgo(2)],
    ['act-10', 'TKT-10005', 'System', 'Ticket created from TeamSupportPro.', daysAgo(5)],
    ['act-11', 'TKT-10005', 'Kevin Key', 'Changed status from Open to Pending.', daysAgo(3)],
    ['act-12', 'TKT-10005', 'Kevin Key', 'Waiting for equipment procurement approval.', daysAgo(3)],
    ['act-13', 'TKT-10006', 'System', 'Ticket created from TeamSupportPro.', daysAgo(0)],
    ['act-14', 'TKT-10007', 'System', 'Ticket created from TeamSupportPro.', daysAgo(1)],
    ['act-15', 'TKT-10007', 'Sarah Johnson', 'Changed status from Open to In Progress.', daysAgo(0)],
    ['act-16', 'TKT-10007', 'Sarah Johnson', 'HVAC technician dispatched. ETA 2 hours.', daysAgo(0)],
    ['act-17', 'TKT-10008', 'System', 'Ticket created from TeamSupportPro.', daysAgo(2)],
    ['act-18', 'TKT-10009', 'System', 'Ticket created from TeamSupportPro.', daysAgo(7)],
    ['act-19', 'TKT-10009', 'Alex Rivera', 'Cleared paper jam and replaced rollers.', daysAgo(5)],
    ['act-20', 'TKT-10009', 'Alex Rivera', 'Changed status from Open to Closed.', daysAgo(5)],
    ['act-21', 'TKT-10010', 'System', 'Ticket created from TeamSupportPro.', daysAgo(3)],
  ]
  for (const [id, ticketId, actor, message, at] of activities) {
    statements.push({
      sql: 'INSERT INTO TicketActivity (Id, TicketId, Actor, Message, ActivityAt) VALUES (?, ?, ?, ?, ?)',
      args: [id, ticketId, actor, message, at],
    })
  }

  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0]
    statements.push({ sql: 'INSERT INTO TeamTicketTrends (TrendDate, TeamId, TicketCount) VALUES (?, ?, ?)', args: [d, 'it', Math.floor(Math.random() * 5) + 2] })
    statements.push({ sql: 'INSERT INTO TeamTicketTrends (TrendDate, TeamId, TicketCount) VALUES (?, ?, ?)', args: [d, 'facilities', Math.floor(Math.random() * 3) + 1] })
    statements.push({ sql: 'INSERT INTO TeamTicketTrends (TrendDate, TeamId, TicketCount) VALUES (?, ?, ?)', args: [d, 'hr', Math.floor(Math.random() * 2) + 1] })
  }

  await db.batch(statements, 'write')
  console.log('Database seeded with mock data.')
}

// ---------------------------------------------------------------------------
// Public init — called once at startup from index.ts
// ---------------------------------------------------------------------------

const seedLocations = async (db: Client): Promise<void> => {
  try {
    const countRow = await db.execute('SELECT COUNT(1) AS cnt FROM Locations')
    const count = Number(countRow.rows[0]?.cnt ?? 0)
    if (count > 0) return // already seeded

    const url = 'https://services2.arcgis.com/oqISN6Dt6ax5xklN/arcgis/rest/services/wcpss_location_details_opendata_public/FeatureServer/0/query?outFields=NAME&where=1%3D1&f=geojson'
    const response = await fetch(url)
    if (!response.ok) {
      console.warn('Locations seed: ArcGIS request failed with status', response.status)
      return
    }
    const geoJson = (await response.json()) as { features?: Array<{ properties?: { NAME?: string } }> }
    const names = Array.from(
      new Set(
        (geoJson.features ?? [])
          .map((f) => f.properties?.NAME?.trim() ?? '')
          .filter((n) => n.length > 0),
      ),
    ).sort((a, b) => a.localeCompare(b))

    if (names.length === 0) {
      console.warn('Locations seed: no NAME values found in GeoJSON response')
      return
    }

    const { randomUUID } = await import('node:crypto')
    const now = new Date().toISOString()
    const statements: Array<{ sql: string; args: InValue[] }> = names.map((name, index) => ({
      sql: 'INSERT OR IGNORE INTO Locations (Id, Name, IsActive, SortOrder, CreatedAt, UpdatedAt) VALUES (?, ?, 1, ?, ?, ?)',
      args: [`loc-${randomUUID()}`, name, index, now, now],
    }))

    // Batch in chunks of 50 to avoid query size limits
    const CHUNK = 50
    for (let i = 0; i < statements.length; i += CHUNK) {
      await db.batch(statements.slice(i, i + CHUNK), 'write')
    }

    console.log(`Locations seed: inserted ${names.length} locations from WCPSS ArcGIS data`)
  } catch (err) {
    console.warn('Locations seed failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}

const seedSettingsTabs = async (db: Client): Promise<void> => {
  const countRow = await db.execute('SELECT COUNT(1) AS cnt FROM settings_tabs')
  if (Number(countRow.rows[0]?.cnt ?? 0) > 0) return

  const { randomUUID } = await import('node:crypto')
  const now = new Date().toISOString()

  const tabs = [
    { name: 'General', slug: 'general', sort_order: 0, visible_to: 'all' },
    { name: 'Configuration', slug: 'configuration', sort_order: 1, visible_to: 'all' },
    { name: 'Storage', slug: 'storage', sort_order: 2, visible_to: 'all' },
    { name: 'Private', slug: 'private', sort_order: 3, visible_to: 'super_admin' },
  ]

  for (const tab of tabs) {
    const tabId = randomUUID()
    await db.execute({
      sql: `INSERT INTO settings_tabs (id, name, slug, sort_order, visible_to, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [tabId, tab.name, tab.slug, tab.sort_order, tab.visible_to, now, now],
    })
  }

  // Seed default section assignments
  const tabRows = await dbAll(db, 'SELECT id, slug FROM settings_tabs ORDER BY sort_order')
  const tabMap: Record<string, string> = {}
  for (const row of tabRows) {
    tabMap[String(row.slug)] = String(row.id)
  }

  const defaultAssignments: Record<string, string[]> = {
    general: [
      'appearance', 'loginMode', 'manageOrganizations', 'manageUsers',
      'manageTeams', 'aboutPage',
    ],
    configuration: [
      'authentication', 'categories', 'locations', 'powerBi',
      'trendSeeding', 'ticketSeeding',
    ],
    storage: [
      'email', 'feedbackForm', 'webhooks',
    ],
    private: [
      'anonymousPages',
    ],
  }

  for (const [slug, sections] of Object.entries(defaultAssignments)) {
    const tabId = tabMap[slug]
    if (!tabId) continue
    for (let i = 0; i < sections.length; i++) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO settings_tab_sections (id, tab_id, section_key, sort_order, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [randomUUID(), tabId, sections[i], i, now],
      })
    }
  }

  console.log('Settings tabs seeded with 4 default tabs and section assignments.')
}

export const initDb = async (): Promise<void> => {
  if (serverConfig.db.mode === 'sqlserver') {
    // SQL Server database is managed externally; skip SQLite schema/seed init
    await getPool() // validate connection at startup
    console.log('Database: SQL Server init complete (schema management is external)')
    return
  }

  const db = getDb()

  // Create tables one by one (batch doesn't support DDL on remote Turso)
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.execute(stmt)
  }

  await runMigrations(db)

  if (await isDatabaseEmpty(db)) {
    await seedDatabase(db)
  }

  await backfillDefaultLayouts(db)

  await seedLocations(db)

  await seedSettingsTabs(db)
}