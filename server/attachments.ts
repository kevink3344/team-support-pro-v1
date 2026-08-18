import crypto from 'node:crypto'

import { getDb, dbGet, dbAll, dbRun } from './db.js'

export interface TicketAttachmentRecord {
  id: string
  ticketId: string
  fileName: string
  contentType: string
  fileSizeBytes: number
  uploadedByUserId: string
  uploadedByName: string
  uploadedAt: string
}

export interface TicketAttachmentBlobRecord extends TicketAttachmentRecord {
  fileContent: Buffer
}

interface CreateAttachmentInput {
  ticketId: string
  fileName: string
  contentType: string
  fileSizeBytes: number
  fileContent: Buffer
  uploadedByUserId: string
  uploadedByName: string
}

const BASE64_TEXT_PATTERN = /^[A-Za-z0-9+/=\r\n]+$/

const looksLikeLegacyBase64Blob = (fileContent: Buffer, contentType: string) => {
  if (!fileContent.length) return false
  const normalizedContentType = contentType.toLowerCase()
  if (normalizedContentType.startsWith('text/')) return false

  const sourceText = fileContent.toString('utf8').trim()
  if (!sourceText || sourceText.length % 4 !== 0 || !BASE64_TEXT_PATTERN.test(sourceText)) return false

  try {
    const decoded = Buffer.from(sourceText, 'base64')
    if (!decoded.length || decoded.length >= fileContent.length) return false
    if (normalizedContentType === 'application/pdf') return decoded.subarray(0, 4).toString('utf8') === '%PDF'
    return true
  } catch {
    return false
  }
}

const normalizeAttachmentFileContent = (fileContent: Buffer, contentType: string) => {
  if (!looksLikeLegacyBase64Blob(fileContent, contentType)) return fileContent
  return Buffer.from(fileContent.toString('utf8').trim(), 'base64')
}

const mapAttachmentRecord = (record: Record<string, unknown>): TicketAttachmentRecord => ({
  id: String(record.id),
  ticketId: String(record.ticketId),
  fileName: String(record.fileName),
  contentType: String(record.contentType),
  fileSizeBytes: Number(record.fileSizeBytes),
  uploadedByUserId: String(record.uploadedByUserId),
  uploadedByName: String(record.uploadedByName),
  uploadedAt: new Date(String(record.uploadedAt)).toISOString(),
})

const mapAttachmentBlobRecord = (record: Record<string, unknown>): TicketAttachmentBlobRecord => {
  const metadata = mapAttachmentRecord(record)
  // libSQL returns ArrayBuffer for BLOB fields; convert to Buffer
  const rawContent = record.fileContent
  let rawBuffer: Buffer
  if (rawContent instanceof ArrayBuffer) {
    rawBuffer = Buffer.from(rawContent)
  } else if (Buffer.isBuffer(rawContent)) {
    rawBuffer = rawContent
  } else {
    rawBuffer = Buffer.alloc(0)
  }
  return { ...metadata, fileContent: normalizeAttachmentFileContent(rawBuffer, metadata.contentType) }
}

export const listTicketAttachments = async (ticketId: string): Promise<TicketAttachmentRecord[]> => {
  const db = getDb()
  const rows = await dbAll(db, `
    SELECT Id AS id, TicketId AS ticketId, FileName AS fileName, ContentType AS contentType,
      FileSizeBytes AS fileSizeBytes, UploadedByUserId AS uploadedByUserId,
      UploadedByName AS uploadedByName, UploadedAt AS uploadedAt
    FROM TicketAttachments WHERE TicketId = ? AND IsDeleted = 0 ORDER BY UploadedAt DESC
  `, [ticketId])
  return rows.map(mapAttachmentRecord)
}

export const getTicketAttachmentById = async (
  ticketId: string,
  attachmentId: string,
): Promise<TicketAttachmentBlobRecord | null> => {
  const db = getDb()
  const row = await dbGet(db, `
    SELECT Id AS id, TicketId AS ticketId, FileName AS fileName, ContentType AS contentType,
      FileSizeBytes AS fileSizeBytes, FileContent AS fileContent,
      UploadedByUserId AS uploadedByUserId, UploadedByName AS uploadedByName, UploadedAt AS uploadedAt
    FROM TicketAttachments WHERE TicketId = ? AND Id = ? AND IsDeleted = 0
  `, [ticketId, attachmentId])
  return row ? mapAttachmentBlobRecord(row) : null
}

export const createTicketAttachment = async (input: CreateAttachmentInput): Promise<TicketAttachmentRecord | null> => {
  if (!input.fileContent.length || !input.fileName.trim()) return null
  const db = getDb()
  const attachmentId = `att-${crypto.randomUUID()}`
  const uploadedAt = new Date().toISOString()

  await db.batch([
    {
      sql: `INSERT INTO TicketAttachments (Id, TicketId, FileName, ContentType, FileSizeBytes, FileContent, UploadedByUserId, UploadedByName, UploadedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [attachmentId, input.ticketId, input.fileName.trim(), input.contentType || 'application/octet-stream', input.fileSizeBytes, input.fileContent, input.uploadedByUserId, input.uploadedByName, uploadedAt],
    },
    { sql: 'UPDATE Tickets SET UpdatedAt = ? WHERE Id = ?', args: [uploadedAt, input.ticketId] },
    {
      sql: 'INSERT INTO TicketActivity (Id, TicketId, Actor, Message, ActivityAt) VALUES (?, ?, ?, ?, ?)',
      args: [`attachment-${crypto.randomUUID()}`, input.ticketId, input.uploadedByName, `Uploaded attachment: ${input.fileName.trim()}.`, uploadedAt],
    },
  ], 'write')

  const created = await getTicketAttachmentById(input.ticketId, attachmentId)
  if (!created) return null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { fileContent: _fileContent, ...metadata } = created
  return metadata
}

export const deleteTicketAttachment = async (
  ticketId: string,
  attachmentId: string,
  deletedByUserId: string,
  deletedByName: string,
): Promise<boolean> => {
  const existing = await getTicketAttachmentById(ticketId, attachmentId)
  if (!existing) return false

  const db = getDb()
  const deletedAt = new Date().toISOString()

  // First soft-delete the attachment and check if it was actually updated
  const result = await dbRun(db, 'UPDATE TicketAttachments SET IsDeleted = 1, DeletedAt = ?, DeletedByUserId = ? WHERE TicketId = ? AND Id = ? AND IsDeleted = 0', [deletedAt, deletedByUserId, ticketId, attachmentId])
  if (result.rowsAffected === 0) return false

  await db.batch([
    { sql: 'UPDATE Tickets SET UpdatedAt = ? WHERE Id = ?', args: [deletedAt, ticketId] },
    { sql: 'INSERT INTO TicketActivity (Id, TicketId, Actor, Message, ActivityAt) VALUES (?, ?, ?, ?, ?)', args: [`attachment-${crypto.randomUUID()}`, ticketId, deletedByName, `Removed attachment: ${existing.fileName}.`, deletedAt] },
  ], 'write')

  return true
}
