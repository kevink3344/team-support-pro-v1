import crypto from 'node:crypto'

import sql from 'mssql'

import { getPool, hasDatabaseConfig } from './db.js'

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

const mapAttachmentBlobRecord = (record: Record<string, unknown>): TicketAttachmentBlobRecord => ({
  ...mapAttachmentRecord(record),
  fileContent: Buffer.from(record.fileContent as Buffer),
})

const createTicketActivity = async (
  request: sql.Request,
  ticketId: string,
  actor: string,
  message: string,
  activityAt: Date,
) => {
  await request
    .input('activityId', sql.NVarChar(120), `attachment-${crypto.randomUUID()}`)
    .input('activityTicketId', sql.NVarChar(50), ticketId)
    .input('activityActor', sql.NVarChar(120), actor)
    .input('activityMessage', sql.NVarChar(500), message)
    .input('activityAt', sql.DateTime2, activityAt)
    .query(`
      INSERT INTO dbo.TicketActivity (Id, TicketId, Actor, Message, ActivityAt)
      VALUES (@activityId, @activityTicketId, @activityActor, @activityMessage, @activityAt)
    `)
}

export const listTicketAttachments = async (ticketId: string): Promise<TicketAttachmentRecord[]> => {
  if (!hasDatabaseConfig()) {
    return []
  }

  const pool = await getPool()
  const result = await pool.request().input('ticketId', sql.NVarChar(50), ticketId).query<Record<string, unknown>>(`
    SELECT
      Id AS id,
      TicketId AS ticketId,
      FileName AS fileName,
      ContentType AS contentType,
      FileSizeBytes AS fileSizeBytes,
      UploadedByUserId AS uploadedByUserId,
      UploadedByName AS uploadedByName,
      UploadedAt AS uploadedAt
    FROM dbo.TicketAttachments
    WHERE TicketId = @ticketId AND IsDeleted = 0
    ORDER BY UploadedAt DESC
  `)

  return result.recordset.map(mapAttachmentRecord)
}

export const getTicketAttachmentById = async (
  ticketId: string,
  attachmentId: string,
): Promise<TicketAttachmentBlobRecord | null> => {
  if (!hasDatabaseConfig()) {
    return null
  }

  const pool = await getPool()
  const result = await pool
    .request()
    .input('ticketId', sql.NVarChar(50), ticketId)
    .input('attachmentId', sql.NVarChar(100), attachmentId)
    .query<Record<string, unknown>>(`
      SELECT
        Id AS id,
        TicketId AS ticketId,
        FileName AS fileName,
        ContentType AS contentType,
        FileSizeBytes AS fileSizeBytes,
        FileContent AS fileContent,
        UploadedByUserId AS uploadedByUserId,
        UploadedByName AS uploadedByName,
        UploadedAt AS uploadedAt
      FROM dbo.TicketAttachments
      WHERE TicketId = @ticketId AND Id = @attachmentId AND IsDeleted = 0
    `)

  return result.recordset[0] ? mapAttachmentBlobRecord(result.recordset[0]) : null
}

export const createTicketAttachment = async (
  input: CreateAttachmentInput,
): Promise<TicketAttachmentRecord | null> => {
  if (!hasDatabaseConfig() || !input.fileContent.length || !input.fileName.trim()) {
    return null
  }

  const pool = await getPool()
  const transaction = new sql.Transaction(pool)
  const attachmentId = `att-${crypto.randomUUID()}`
  const uploadedAt = new Date()

  await transaction.begin()

  try {
    await transaction
      .request()
      .input('id', sql.NVarChar(100), attachmentId)
      .input('ticketId', sql.NVarChar(50), input.ticketId)
      .input('fileName', sql.NVarChar(255), input.fileName.trim())
      .input('contentType', sql.NVarChar(150), input.contentType || 'application/octet-stream')
      .input('fileSizeBytes', sql.BigInt, input.fileSizeBytes)
      .input('fileContent', sql.VarBinary(sql.MAX), input.fileContent)
      .input('uploadedByUserId', sql.NVarChar(100), input.uploadedByUserId)
      .input('uploadedByName', sql.NVarChar(120), input.uploadedByName)
      .input('uploadedAt', sql.DateTime2, uploadedAt)
      .query(`
        INSERT INTO dbo.TicketAttachments (
          Id,
          TicketId,
          FileName,
          ContentType,
          FileSizeBytes,
          FileContent,
          UploadedByUserId,
          UploadedByName,
          UploadedAt
        )
        VALUES (
          @id,
          @ticketId,
          @fileName,
          @contentType,
          @fileSizeBytes,
          @fileContent,
          @uploadedByUserId,
          @uploadedByName,
          @uploadedAt
        )
      `)

    await transaction
      .request()
      .input('ticketId', sql.NVarChar(50), input.ticketId)
      .input('updatedAt', sql.DateTime2, uploadedAt)
      .query('UPDATE dbo.Tickets SET UpdatedAt = @updatedAt WHERE Id = @ticketId')

    await createTicketActivity(
      transaction.request(),
      input.ticketId,
      input.uploadedByName,
      `Uploaded attachment: ${input.fileName.trim()}.`,
      uploadedAt,
    )

    await transaction.commit()
  } catch (error) {
    await transaction.rollback()
    throw error
  }

  const created = await getTicketAttachmentById(input.ticketId, attachmentId)
  if (!created) {
    return null
  }

  const { fileContent: _fileContent, ...metadata } = created
  return metadata
}

export const deleteTicketAttachment = async (
  ticketId: string,
  attachmentId: string,
  deletedByUserId: string,
  deletedByName: string,
): Promise<boolean> => {
  if (!hasDatabaseConfig()) {
    return false
  }

  const existing = await getTicketAttachmentById(ticketId, attachmentId)
  if (!existing) {
    return false
  }

  const pool = await getPool()
  const transaction = new sql.Transaction(pool)
  const deletedAt = new Date()

  await transaction.begin()

  try {
    const result = await transaction
      .request()
      .input('ticketId', sql.NVarChar(50), ticketId)
      .input('attachmentId', sql.NVarChar(100), attachmentId)
      .input('deletedAt', sql.DateTime2, deletedAt)
      .input('deletedByUserId', sql.NVarChar(100), deletedByUserId)
      .query(`
        UPDATE dbo.TicketAttachments
        SET IsDeleted = 1, DeletedAt = @deletedAt, DeletedByUserId = @deletedByUserId
        WHERE TicketId = @ticketId AND Id = @attachmentId AND IsDeleted = 0
      `)

    if (result.rowsAffected[0] === 0) {
      await transaction.rollback()
      return false
    }

    await transaction
      .request()
      .input('ticketId', sql.NVarChar(50), ticketId)
      .input('updatedAt', sql.DateTime2, deletedAt)
      .query('UPDATE dbo.Tickets SET UpdatedAt = @updatedAt WHERE Id = @ticketId')

    await createTicketActivity(
      transaction.request(),
      ticketId,
      deletedByName,
      `Removed attachment: ${existing.fileName}.`,
      deletedAt,
    )

    await transaction.commit()
    return true
  } catch (error) {
    await transaction.rollback()
    throw error
  }
}