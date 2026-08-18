import crypto from 'node:crypto'

import { getDb, dbGet, dbAll, dbRun } from './db.js'

export interface LocationRecord {
  id: string
  name: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

const mapRow = (row: Record<string, unknown>): LocationRecord => ({
  id: String(row.id),
  name: String(row.name),
  isActive: row.isActive === 1 || row.isActive === true,
  sortOrder: Number(row.sortOrder) || 0,
  createdAt: String(row.createdAt),
  updatedAt: String(row.updatedAt),
})

export const listLocations = async (activeOnly = false): Promise<LocationRecord[]> => {
  const db = getDb()
  const sql = activeOnly
    ? `SELECT Id AS id, Name AS name, IsActive AS isActive, SortOrder AS sortOrder,
        CreatedAt AS createdAt, UpdatedAt AS updatedAt
        FROM Locations WHERE IsActive = 1 ORDER BY SortOrder ASC, Name ASC`
    : `SELECT Id AS id, Name AS name, IsActive AS isActive, SortOrder AS sortOrder,
        CreatedAt AS createdAt, UpdatedAt AS updatedAt
        FROM Locations ORDER BY SortOrder ASC, Name ASC`
  const rows = await dbAll(db, sql)
  return rows.map(mapRow)
}

export const getLocationById = async (id: string): Promise<LocationRecord | null> => {
  const db = getDb()
  const row = await dbGet(
    db,
    `SELECT Id AS id, Name AS name, IsActive AS isActive, SortOrder AS sortOrder,
      CreatedAt AS createdAt, UpdatedAt AS updatedAt FROM Locations WHERE Id = ?`,
    [id],
  )
  return row ? mapRow(row) : null
}

export const createLocation = async (name: string, sortOrder = 0): Promise<LocationRecord | null> => {
  const trimmedName = name.trim()
  if (!trimmedName) return null
  const db = getDb()
  const existing = await dbGet(db, 'SELECT Id FROM Locations WHERE LOWER(Name) = LOWER(?)', [trimmedName])
  if (existing) return null // name conflict
  const id = `loc-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  await dbRun(
    db,
    'INSERT INTO Locations (Id, Name, IsActive, SortOrder, CreatedAt, UpdatedAt) VALUES (?, ?, 1, ?, ?, ?)',
    [id, trimmedName, sortOrder, now, now],
  )
  return getLocationById(id)
}

export const updateLocation = async (
  id: string,
  patch: { name?: string; isActive?: boolean; sortOrder?: number },
): Promise<LocationRecord | null> => {
  const existing = await getLocationById(id)
  if (!existing) return null
  const db = getDb()
  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name
  const nextActive = patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : (existing.isActive ? 1 : 0)
  const nextSort = patch.sortOrder !== undefined ? patch.sortOrder : existing.sortOrder
  if (!nextName) return null
  if (patch.name !== undefined) {
    const conflict = await dbGet(db, 'SELECT Id FROM Locations WHERE LOWER(Name) = LOWER(?) AND Id != ?', [nextName, id])
    if (conflict) return null // name conflict with another record
  }
  const now = new Date().toISOString()
  await dbRun(
    db,
    'UPDATE Locations SET Name = ?, IsActive = ?, SortOrder = ?, UpdatedAt = ? WHERE Id = ?',
    [nextName, nextActive, nextSort, now, id],
  )
  return getLocationById(id)
}

export const deleteLocation = async (id: string): Promise<{ deleted: boolean; inUse: boolean }> => {
  const existing = await getLocationById(id)
  if (!existing) return { deleted: false, inUse: false }
  const db = getDb()
  const inUseRow = await dbGet(db, 'SELECT COUNT(1) AS cnt FROM Tickets WHERE LOWER(Location) = LOWER(?)', [existing.name])
  const count = Number(inUseRow?.cnt ?? 0)
  if (count > 0) return { deleted: false, inUse: true }
  await dbRun(db, 'DELETE FROM Locations WHERE Id = ?', [id])
  return { deleted: true, inUse: false }
}
