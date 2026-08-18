import { apiUrl } from '../config'
import type { Ticket, TicketVersion, TicketLayoutVersion } from '../types'

export const fetchTicketVersions = async (ticketId: string): Promise<TicketVersion[]> => {
  const response = await fetch(apiUrl(`/api/tickets/${encodeURIComponent(ticketId)}/versions`), {
    credentials: 'include',
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Failed to load ticket versions')
  }
  const data = (await response.json()) as { versions: TicketVersion[] }
  return data.versions
}

export const revertTicketToVersion = async (ticketId: string, versionId: string): Promise<Ticket> => {
  const response = await fetch(
    apiUrl(`/api/tickets/${encodeURIComponent(ticketId)}/versions/${encodeURIComponent(versionId)}/revert`),
    {
      method: 'POST',
      credentials: 'include',
    },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Failed to revert ticket')
  }
  const data = (await response.json()) as { ticket: Ticket }
  return data.ticket
}

export const fetchTicketLayoutVersions = async (organizationId: string): Promise<TicketLayoutVersion[]> => {
  const response = await fetch(
    apiUrl(`/api/organizations/${encodeURIComponent(organizationId)}/ticket-layout/versions`),
    { credentials: 'include' },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Failed to load layout versions')
  }
  const data = (await response.json()) as { versions: TicketLayoutVersion[] }
  return data.versions
}

export const revertTicketLayoutToVersion = async (
  organizationId: string,
  versionId: string,
): Promise<TicketLayoutVersion> => {
  const response = await fetch(
    apiUrl(
      `/api/organizations/${encodeURIComponent(organizationId)}/ticket-layout/versions/${encodeURIComponent(versionId)}/revert`,
    ),
    { method: 'POST', credentials: 'include' },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Failed to revert layout')
  }
  const data = (await response.json()) as { version: TicketLayoutVersion }
  return data.version
}

export const deleteTicketLayoutVersion = async (
  organizationId: string,
  versionId: string,
): Promise<void> => {
  const response = await fetch(
    apiUrl(
      `/api/organizations/${encodeURIComponent(organizationId)}/ticket-layout/versions/${encodeURIComponent(versionId)}`,
    ),
    { method: 'DELETE', credentials: 'include' },
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Failed to delete layout version')
  }
}
