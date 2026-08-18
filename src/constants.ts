import {
  Building2,
  FileUp,
  Folder,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  Pencil,
  Plus,
  Settings,
  Shield,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { AppView, TicketPriority, TicketStatus } from './types'

export const STORAGE_KEYS = {
  auth: 'team-support-pro-auth',
  dashboardLayout: 'team-support-pro-dashboard-layout',
  notificationsArchivedIds: 'team-support-pro-notifications-archived-ids',
  mode: 'team-support-pro-mode',
  notificationsReadIds: 'team-support-pro-notifications-read-ids',
  notificationsSampleSeeded: 'team-support-pro-notifications-sample-seeded',
  notificationsSeenAt: 'team-support-pro-notifications-seen-at',
  settingsAccordionOrder: 'team-support-pro-settings-accordion-order',
  theme: 'team-support-pro-theme',
  sidebar: 'team-support-pro-sidebar',
} as const

export const statusOptions: TicketStatus[] = [
  'Open',
  'In Progress',
  'Pending',
  'Resolved',
  'Closed',
]

export const priorityOptions: TicketPriority[] = ['Low', 'Medium', 'High', 'Critical']

export const navItems: Array<{
  id: AppView
  label: string
  icon: LucideIcon
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'unassigned', label: 'Unassigned', icon: Inbox },
  { id: 'my-tickets', label: 'My Tickets', icon: Folder },
  { id: 'team-tickets', label: 'Team Tickets', icon: Users },
  { id: 'new-ticket', label: 'New Ticket', icon: Plus },
]

export const adminNavItems = [
  { id: 'ticket-designer' as AppView, label: 'Ticket Designer', icon: Pencil },
  { id: 'reports' as AppView, label: 'Reports', icon: FileUp },
  { id: 'settings' as AppView, label: 'Settings', icon: Settings },
]

export const teamIcons: Record<string, LucideIcon> = {
  it: Wrench,
  facilities: Building2,
  learning: GraduationCap,
  security: Shield,
}
