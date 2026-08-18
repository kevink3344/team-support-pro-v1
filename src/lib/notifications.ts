import type { Ticket as TicketRecord, User } from '../types'

export interface NotificationItem {
  id: string
  ticketId: string
  ticketTitle: string
  actor: string
  message: string
  at: string
  type: 'activity' | 'mention' | 'seeded'
  seeded?: boolean
}

export const toMentionHandle = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')

export const buildMentionLookup = (users: User[]) => {
  const lookup = new Map<string, string>()

  users.forEach((user) => {
    const normalizedId = user.id.trim().toLowerCase()
    const handle = toMentionHandle(user.name)

    if (normalizedId && !lookup.has(normalizedId)) {
      lookup.set(normalizedId, user.id)
    }

    if (handle && !lookup.has(handle)) {
      lookup.set(handle, user.id)
    }
  })

  return lookup
}

export const extractMentionedUserIds = (message: string, mentionLookup: Map<string, string>) => {
  const matchedIds = new Set<string>()
  const mentionTokenRegex = /(^|\s)@([a-z0-9._-]+)/g
  const normalizedMessage = message.toLowerCase()
  let match = mentionTokenRegex.exec(normalizedMessage)

  while (match) {
    const token = match[2]
    const matchedUserId = mentionLookup.get(token)
    if (matchedUserId) {
      matchedIds.add(matchedUserId)
    }

    match = mentionTokenRegex.exec(normalizedMessage)
  }

  return matchedIds
}

export const buildSeedNotificationItems = (
  sourceTickets: TicketRecord[],
  currentUserName: string,
): NotificationItem[] => {
  if (sourceTickets.length === 0) {
    return []
  }

  const baseTime = new Date('2026-04-05T09:00:00.000Z').getTime()
  const sampleDefinitions = [
    { actor: 'Avery Chen', message: 'escalated this ticket for same-day follow-up.', hoursAgo: 1 },
    { actor: 'Morgan Patel', message: 'requested an update before the leadership review.', hoursAgo: 2 },
    { actor: 'Jordan Brooks', message: 'added a dependency note for vendor coordination.', hoursAgo: 4 },
    { actor: 'Taylor Nguyen', message: 'confirmed the workaround with the requestor.', hoursAgo: 6 },
    { actor: 'Reese Kim', message: 'marked the ticket ready for your verification.', hoursAgo: 9 },
    { actor: 'Parker Diaz', message: 'attached the deployment checklist.', hoursAgo: 13 },
    { actor: 'Cameron Lee', message: 'captured the root-cause summary.', hoursAgo: 19 },
    { actor: 'Quinn Rivera', message: 'closed the investigation sub-task.', hoursAgo: 27 },
  ]

  return sampleDefinitions.map((definition, index) => {
    const ticket = sourceTickets[index % sourceTickets.length]

    return {
      id: `sample-notification-${ticket.id}-${index + 1}`,
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      actor: definition.actor === currentUserName ? 'System Queue' : definition.actor,
      message: definition.message,
      at: new Date(baseTime - definition.hoursAgo * 60 * 60 * 1000).toISOString(),
      type: 'seeded',
      seeded: true,
    }
  })
}
