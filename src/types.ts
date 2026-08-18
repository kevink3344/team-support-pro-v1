export type OrganizationId = string
export type TeamId = string
export type UserId = string
export type CategoryId = string
export type TicketId = string

export type TicketStatus =
  | 'Open'
  | 'In Progress'
  | 'Pending'
  | 'Resolved'
  | 'Closed'

export type TicketPriority = 'Low' | 'Medium' | 'High' | 'Critical'

export type AppView =
  | 'dashboard'
  | 'notifications'
  | 'unassigned'
  | 'my-tickets'
  | 'team-tickets'
  | 'new-ticket'
  | 'manage-organizations'
  | 'manage-users'
  | 'manage-teams'
  | 'manage-categories'
  | 'ticket-designer'
  | 'reports'
  | 'settings'
  | 'about'

export type ListViewMode = 'table' | 'cards'
export type ThemeMode = 'light' | 'dark'

export interface Location {
  id: string
  name: string
  isActive: boolean
  sortOrder: number
}

export type CustomFieldType = 'text' | 'select' | 'checkbox' | 'number' | 'date'

export interface TicketFieldDefinition {
  id: string
  organizationId: OrganizationId
  fieldType: CustomFieldType
  label: string
  isRequired: boolean
  sortOrder: number
  options: string[]
}

export type BuiltInFieldKey =
  | 'title'
  | 'requestorName'
  | 'requestorEmail'
  | 'categoryId'
  | 'priority'
  | 'assignedToId'
  | 'location'
  | 'description'
  | 'status'

export type LayoutSlotWidth = 'full' | 'half'

export interface TicketLayoutSlot {
  fieldRef: BuiltInFieldKey | string
  width: LayoutSlotWidth
}

export interface TicketLayoutRow {
  id: string
  slots: TicketLayoutSlot[]
}

export interface TicketLayout {
  rows: TicketLayoutRow[]
}

export interface TicketLayoutVersion {
  id: string
  organizationId: OrganizationId
  versionNumber: number
  layout: TicketLayout
  description: string
  createdAt: string
}

export interface TicketCustomFieldValue {
  id: string
  ticketId: TicketId
  fieldId: string
  fieldLabel: string
  fieldType: CustomFieldType
  value: string
}

export type WebhookEvent =
  | 'ticket.created'
  | 'ticket.updated'
  | 'ticket.assigned'
  | 'ticket.resolved'
  | 'ticket.closed'
  | 'feedback.submitted'

export interface WebhookConfig {
  id: string
  organizationId: string
  url: string
  secret: string
  events: WebhookEvent[]
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface Organization {
  id: OrganizationId
  name: string
  code: string
  accent: string
}

export interface Team {
  id: TeamId
  organizationId: OrganizationId
  name: string
  code: string
  accent: string
}

export interface Category {
  id: CategoryId
  teamId: TeamId
  name: string
  description: string
}

export interface AnonymousPageConfig {
  id: string
  name: string
  organizationId: OrganizationId
  pagePath: string
  enabled: boolean
}

export interface User {
  id: UserId
  name: string
  email: string
  organizationId: OrganizationId
  teamId: TeamId
  role: 'Admin' | 'Super Admin' | 'Staff'
  canViewAllOrgTickets?: boolean
}

export interface AuthSession {
  id?: string
  subject: string
  name: string
  email: string
  role?: 'Admin' | 'Super Admin' | 'Staff'
  organizationId?: string
  organizationName?: string
  organizationCode?: string
  organizationAccent?: string
  teamId?: string
  canViewAllOrgTickets?: boolean
  picture?: string
}

export interface AuthenticatedUser extends User {
  organizationName?: string
  organizationCode?: string
  organizationAccent?: string
  teamName?: string
  teamCode?: string
  teamAccent?: string
  picture?: string
}

export interface ActivityEntry {
  id: string
  actor: string
  message: string
  at: string
}

export interface TicketAttachment {
  id: string
  ticketId: string
  fileName: string
  contentType: string
  fileSizeBytes: number
  uploadedByUserId: string
  uploadedByName: string
  uploadedAt: string
}

export interface Ticket {
  id: TicketId
  title: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  teamId: TeamId
  categoryId: CategoryId
  attachmentCount?: number
  assignedToId: UserId | null
  requestorName: string
  requestorEmail: string
  location: string
  dueLabel: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string | null
  activity: ActivityEntry[]
  customFields?: TicketCustomFieldValue[]
}

export interface TicketVersion {
  id: string
  ticketId: TicketId
  versionNumber: number
  title: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  teamId: TeamId
  categoryId: CategoryId
  assignedToId: UserId | null
  requestorName: string
  requestorEmail: string
  location: string
  dueLabel: string
  createdAt: string
  customFields: TicketCustomFieldValue[]
}

export interface TrendPoint {
  date: string
  values: Record<string, number>
}

export interface TicketReport {
  status: string
  count: number
}

export interface PriorityReport {
  priority: string
  count: number
}

export interface AssigneeReport {
  assigneeId: string | null
  assigneeName: string | null
  count: number
}

export interface TrendReport {
  date: string
  created: number
  resolved: number
}

export interface ResolutionTimeBucket {
  bucket: string
  count: number
}

export interface AvgResolutionByPriority {
  priority: string
  avgDays: number
  count: number
}

export interface AvgResolutionByTeam {
  teamId: string
  teamName: string
  avgDays: number
  count: number
}

export interface OpenAgeBucket {
  bucket: string
  count: number
}

export interface FirstResponseBucket {
  bucket: string
  count: number
}

export interface TicketWatcher {
  userId: string
  name: string
  email: string
  addedAt: string
}

export interface ThemePalette {
  appBg: string
  headerBg: string
  menuBg: string
  cardBg: string
  panelBg: string
  inputBg: string
  buttonBg: string
  accent: string
  text: string
  textMuted: string
  border: string
  buttonText: string
}

export interface ThemeConfig {
  light: ThemePalette
  dark: ThemePalette
}

// ---------------------------------------------------------------------------
// Feedback Form
// ---------------------------------------------------------------------------

export type FeedbackFieldType =
  | 'short_text'
  | 'long_text'
  | 'rating'
  | 'single_choice'
  | 'multi_choice'

export interface FeedbackFormField {
  id: string
  formId: string
  fieldType: FeedbackFieldType
  label: string
  isRequired: boolean
  sortOrder: number
  options: string[]
}

export interface FeedbackForm {
  id: string
  organizationId: string
  isEnabled: boolean
  fields: FeedbackFormField[]
}

export interface FeedbackResponseSummary {
  id: string
  token: string
  ticketId: string | null
  organizationId: string
  teamId: string | null
  categoryId: string | null
  requestorEmail: string | null
  isTest: boolean
  submittedAt: string
  answers: Array<{ fieldId: string; fieldLabel: string; fieldType: string; value: string }>
}

// ---------------------------------------------------------------------------
// Settings Tabs
// ---------------------------------------------------------------------------

export interface SettingsTab {
  id: string
  name: string
  slug: string
  sort_order: number
  visible_to: 'all' | 'super_admin'
  sections: SettingsTabSection[]
}

export interface SettingsTabSection {
  id: string
  tab_id: string
  section_key: string
  sort_order: number
}