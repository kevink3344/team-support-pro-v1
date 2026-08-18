import type { TicketStatus, TicketPriority } from '../types'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export const formatDateTime = (value: string) => dateFormatter.format(new Date(value))

export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const getStatusBadgeClass = (status: TicketStatus) => {
  switch (status) {
    case 'Open':
      return 'badge badge-blue'
    case 'In Progress':
      return 'badge badge-amber'
    case 'Pending':
      return 'badge badge-orange'
    case 'Resolved':
      return 'badge badge-green'
    case 'Closed':
      return 'badge badge-slate'
    default:
      return 'badge'
  }
}

export const getPriorityBadgeClass = (priority: TicketPriority) => {
  switch (priority) {
    case 'Critical':
      return 'badge badge-red'
    case 'High':
      return 'badge badge-orange'
    case 'Medium':
      return 'badge badge-amber'
    case 'Low':
      return 'badge badge-slate'
    default:
      return 'badge'
  }
}
