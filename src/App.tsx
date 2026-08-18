import { useDeferredValue, useEffect, useMemo, useRef, useState, startTransition, type CSSProperties, type FormEvent } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import {
  AnimatePresence,
  motion,
} from 'motion/react'
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Download,
  Eye,
  FileUp,
  Grip,
  Paperclip,
  LogOut,
  Info,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SunMedium,
  Pencil,
  Ticket,
  Trash2,
  TriangleAlert,
  User as UserIcon,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react'
import { type Layout } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiUrl, appConfig } from './config'
import {
  currentUserId,
  initialOrganizations,
  initialCategories,
  initialTeams,
  initialTickets,
  initialUsers,
  trendData as initialTrendData,
} from './data/mockData'
import { defaultThemeConfig } from './theme'
import type {
  ActivityEntry,
  AnonymousPageConfig,
  AppView,
  AuthSession,
  Category,
  FeedbackForm,
  FeedbackFormField,
  FeedbackFieldType,
  FeedbackResponseSummary,
  ListViewMode,
  Location,
  Organization,
  Team,
  ThemeConfig,
  ThemeMode,
  TicketAttachment,
  Ticket as TicketRecord,
  TicketFieldDefinition,
  TicketLayout,
  TicketPriority,
  SettingsTab,
  TicketStatus,
  TicketWatcher,
  TrendPoint,
  User,
  WebhookConfig,
  WebhookEvent,
} from './types'
import { LayoutTicketForm } from './components/LayoutTicketForm'
import { TicketLayoutDesigner } from './components/TicketLayoutDesigner'
import { TicketLayoutVersionHistory } from './components/TicketLayoutVersionHistory'
import { VersionConfirmDialog } from './components/VersionConfirmDialog'
import { TicketVersionHistory } from './components/TicketVersionHistory'
import { PdfPreview } from './PdfPreview'
import { ReportsPage } from './ReportsPage'
import { RichTextEditor } from './RichTextEditor'
import { REMEMBER_LOGIN_EMAIL_COOKIE, readCookieValue, setCookieValue, clearCookieValue } from './lib/cookies'
import { formatDateTime, formatFileSize, getStatusBadgeClass, getPriorityBadgeClass } from './lib/format'
import { type NotificationItem, buildMentionLookup, extractMentionedUserIds, buildSeedNotificationItems } from './lib/notifications'
import {
  ResponsiveDashboardGrid,
  type DashboardLayouts,
  type DashboardWidgetId,
  dashboardWidgetOrder,
  mergeDashboardLayouts,
  filterDashboardLayouts,
} from './dashboard/layouts'
import { STORAGE_KEYS, statusOptions, navItems, adminNavItems, teamIcons } from './constants'

type SettingsAccordionSection =
  | 'appearance'
  | 'authentication'
  | 'loginMode'
  | 'anonymousPages'
  | 'manageOrganizations'
  | 'manageUsers'
  | 'manageTeams'
  | 'trendSeeding'
  | 'ticketSeeding'
  | 'categories'
  | 'locations'
  | 'email'
  | 'powerBi'
  | 'feedbackForm'
  | 'webhooks'
  | 'aboutPage'

type ManagementDrawerSection =
  | 'manageOrganizations'
  | 'manageUsers'
  | 'manageTeams'
  | 'categories'

type SettingsDrawerTab = 'add' | 'edit'

type SettingsAccordionState = Record<SettingsAccordionSection, boolean>

type QuickTicketAction = 'assign-to-me' | 'mark-in-progress' | 'mark-resolved'

type LoginMode = 'select' | 'password' | 'maintenance'

const LOGIN_MODE_OPTIONS: Array<{ value: LoginMode; label: string; description: string }> = [
  {
    value: 'select',
    label: 'Select User (Test)',
    description: 'Organization and user dropdowns — sign in without a password.',
  },
  {
    value: 'password',
    label: 'Password (Production)',
    description: 'Email and password form for production environments.',
  },
  {
    value: 'maintenance',
    label: 'System Maintenance',
    description: 'Hide login forms and show a maintenance message. Admins can bypass with ?admin=1.',
  },
]

const normalizeClientLoginMode = (value: unknown): LoginMode => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'password' || normalized === 'maintenance' || normalized === 'select') {
    return normalized
  }
  return 'select'
}

type QuickActionConfirmationState = {
  ticketId: string
  ticketTitle: string
  action: QuickTicketAction
}

type QuickActionToastState = {
  message: string
  tone: 'success' | 'error'
}

const defaultSettingsAccordionOrder: SettingsAccordionSection[] = [
  'appearance',
  'authentication',
  'loginMode',
  'anonymousPages',
  'manageOrganizations',
  'manageUsers',
  'manageTeams',
  'trendSeeding',
  'ticketSeeding',
  'categories',
  'locations',
  'email',
  'powerBi',
  'feedbackForm',
  'webhooks',
  'aboutPage',
]

const normalizeSettingsAccordionOrder = (storedOrder: string[] | null | undefined) => {
  const validSections = new Set(defaultSettingsAccordionOrder)
  const sanitized = (storedOrder ?? []).filter(
    (section): section is SettingsAccordionSection => validSections.has(section as SettingsAccordionSection),
  )

  const missing = defaultSettingsAccordionOrder.filter((section) => !sanitized.includes(section))
  const next = [...sanitized]

  // Prefer placing newly added sections near their default neighbors instead of dumping them at the end.
  for (const section of missing) {
    const defaultIndex = defaultSettingsAccordionOrder.indexOf(section)
    const preferredBefore = defaultSettingsAccordionOrder
      .slice(0, defaultIndex)
      .reverse()
      .find((candidate) => next.includes(candidate))
    if (preferredBefore) {
      next.splice(next.indexOf(preferredBefore) + 1, 0, section)
    } else {
      next.push(section)
    }
  }

  return next
}

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const normalizeAnonymousPagePath = (value: string) => {
  const trimmed = value.trim().replace(/\\/g, '/')
  const fileName = trimmed.split('/').filter(Boolean).at(-1) ?? ''
  const sanitized = fileName.toLowerCase().replace(/[^a-z0-9._-]/g, '')

  if (!sanitized) {
    return 'index.html'
  }

  return sanitized.endsWith('.html') ? sanitized : `${sanitized}.html`
}

const createAnonymousPageDraft = (organizationId: string, existingPages: AnonymousPageConfig[]): AnonymousPageConfig => {
  const existingPaths = new Set(existingPages.map((page) => normalizeAnonymousPagePath(page.pagePath)))
  let index = 1
  let nextPagePath = 'index.html'

  while (existingPaths.has(nextPagePath)) {
    index += 1
    nextPagePath = `index${index}.html`
  }

  return {
    id: `anon-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    organizationId,
    pagePath: nextPagePath,
    enabled: true,
  }
}

const getAnonymousPageUrl = (pagePath: string) => {
  const normalizedPath = normalizeAnonymousPagePath(pagePath)
  return normalizedPath === 'index.html' ? '/anon/' : `/anon/${normalizedPath}`
}

// DashboardWidgetId, dashboardWidgetOrder, DashboardLayouts, ResponsiveDashboardGrid imported from ./dashboard/layouts

// statusOptions, priorityOptions, navItems, adminNavItems, teamIcons imported from ./constants

const readStoredValue = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback
  }

  const stored = window.localStorage.getItem(key)
  if (!stored) {
    return fallback
  }

  try {
    return JSON.parse(stored) as T
  } catch {
    return fallback
  }
}

const isThemeConfig = (value: unknown): value is ThemeConfig => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<Record<ThemeMode, Partial<ThemeConfig[ThemeMode]>>>
  return Boolean(candidate.light?.accent && candidate.dark?.accent)
}

// formatDateTime, formatFileSize imported from ./lib/format

const getTeamsForOrganization = (teams: Team[], organizationId: string) =>
  teams.filter((team) => team.organizationId === organizationId)

const getFirstTeamIdForOrganization = (teams: Team[], organizationId: string) =>
  getTeamsForOrganization(teams, organizationId)[0]?.id || ''

const createMockSessionUser = (session: AuthSession): User => ({
  id: session.id ?? session.subject,
  name: session.name,
  email: session.email,
  organizationId: session.organizationId ?? initialOrganizations[0]?.id ?? '',
  teamId: session.teamId ?? initialTeams[0]?.id ?? '',
  role: session.role ?? 'Staff',
  canViewAllOrgTickets: session.canViewAllOrgTickets ?? false,
})

interface SessionApiUser {
  id?: string
  subject?: string
  email: string
  name: string
  role?: 'Admin' | 'Super Admin' | 'Staff'
  organizationId?: string
  organizationName?: string
  organizationCode?: string
  organizationAccent?: string
  teamId?: string
  canViewAllOrgTickets?: boolean
  picture?: string
}

interface TicketActivityApiRecord extends ActivityEntry {
  ticketId: string
}

interface DashboardSummary {
  stats: {
    total: number
    open: number
    inProgress: number
    pending: number
    critical: number
  }
  statusCounts: Array<{
    status: TicketStatus
    count: number
  }>
  teamWorkload: Array<{
    teamId: string
    count: number
  }>
}

const mapSessionApiUser = (user: SessionApiUser): AuthSession => ({
  id: user.id,
  subject: user.subject ?? user.id ?? user.email,
  email: user.email,
  name: user.name,
  role: user.role,
  organizationId: user.organizationId,
  organizationName: user.organizationName,
  organizationCode: user.organizationCode,
  organizationAccent: user.organizationAccent,
  teamId: user.teamId,
  canViewAllOrgTickets: user.canViewAllOrgTickets,
  picture: user.picture,
})

const areTicketFieldDefsDirty = (
  current: TicketFieldDefinition[],
  lastSaved: TicketFieldDefinition[],
): boolean => {
  if (current.length !== lastSaved.length) return true
  for (let i = 0; i < current.length; i += 1) {
    const a = current[i]
    const b = lastSaved[i]
    if (
      a.id !== b.id ||
      a.label !== b.label ||
      a.fieldType !== b.fieldType ||
      a.isRequired !== b.isRequired ||
      a.sortOrder !== b.sortOrder ||
      a.options.length !== b.options.length ||
      a.options.some((o, idx) => o !== b.options[idx])
    ) {
      return true
    }
  }
  return false
}

const areTicketLayoutsDirty = (
  current: TicketLayout | null,
  lastSaved: TicketLayout | null,
): boolean => {
  if (!current && !lastSaved) return false
  if (!current || !lastSaved) return true
  const a = current.rows
  const b = lastSaved.rows
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].slots.length !== b[i].slots.length) return true
    for (let j = 0; j < a[i].slots.length; j += 1) {
      if (a[i].slots[j].fieldRef !== b[i].slots[j].fieldRef || a[i].slots[j].width !== b[i].slots[j].width) {
        return true
      }
    }
  }
  return false
}

const mergePersistedActivity = (
  currentTickets: TicketRecord[],
  persistedActivity: TicketActivityApiRecord[],
) => {
  const activityByTicket = new Map<string, TicketActivityApiRecord[]>()

  persistedActivity.forEach((entry) => {
    const currentEntries = activityByTicket.get(entry.ticketId) ?? []
    currentEntries.push(entry)
    activityByTicket.set(entry.ticketId, currentEntries)
  })

  return currentTickets.map((ticket) => {
    const remoteEntries = activityByTicket.get(ticket.id)
    if (!remoteEntries?.length) {
      return ticket
    }

    const mergedActivity = [...ticket.activity]
    const existingIds = new Set(mergedActivity.map((entry) => entry.id))

    remoteEntries.forEach((entry) => {
      if (!existingIds.has(entry.id)) {
        mergedActivity.push({
          id: entry.id,
          actor: entry.actor,
          message: entry.message,
          at: entry.at,
        })
      }
    })

    const updatedAt = mergedActivity.reduce((latest, entry) => {
      return new Date(entry.at).getTime() > new Date(latest).getTime() ? entry.at : latest
    }, ticket.updatedAt)

    return {
      ...ticket,
      updatedAt,
      activity: mergedActivity,
    }
  })
}

// getStatusBadgeClass, getPriorityBadgeClass imported from ./lib/format
// NotificationItem, toMentionHandle, buildMentionLookup, extractMentionedUserIds, buildSeedNotificationItems imported from ./lib/notifications

function App() {
  const [directoryLoaded, setDirectoryLoaded] = useState(false)
  const [testLoginDataPending, setTestLoginDataPending] = useState(true)
  const [organizations, setOrganizations] = useState(initialOrganizations)
  const [teams, setTeams] = useState(initialTeams)
  const [categories, setCategories] = useState(initialCategories)
  const [users, setUsers] = useState(initialUsers)
  const [tickets, setTickets] = useState(initialTickets)
  const [loginActiveTicketCounts, setLoginActiveTicketCounts] = useState<Record<string, number>>({})
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>(initialTrendData)
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null)
  const [ticketWatchers, setTicketWatchers] = useState<TicketWatcher[]>([])
  const [watchedTicketIds, setWatchedTicketIds] = useState<Set<string>>(new Set())
  const [authSession, setAuthSession] = useState<AuthSession | null>(null)
  const dashboardLayoutStorageKey = authSession
    ? `${STORAGE_KEYS.dashboardLayout}:${authSession.email.toLowerCase()}`
    : STORAGE_KEYS.dashboardLayout
  const [dashboardLayouts, setDashboardLayouts] = useState<DashboardLayouts>(() =>
    mergeDashboardLayouts(readStoredValue<DashboardLayouts | null>(dashboardLayoutStorageKey, null)),
  )
  const [activeView, setActiveView] = useState<AppView>('dashboard')
  const settingsAccordionOrderStorageKey = authSession
    ? `${STORAGE_KEYS.settingsAccordionOrder}:${authSession.email.toLowerCase()}`
    : STORAGE_KEYS.settingsAccordionOrder
  const [settingsTabs, setSettingsTabs] = useState<SettingsTab[]>([])
  const [settingsTabsLoading, setSettingsTabsLoading] = useState(false)
  const [activeSettingsTabId, setActiveSettingsTabId] = useState<string>('')
  const notificationArchivedIdsStorageKey = authSession
    ? `${STORAGE_KEYS.notificationsArchivedIds}:${authSession.email.toLowerCase()}`
    : STORAGE_KEYS.notificationsArchivedIds
  const notificationReadIdsStorageKey = authSession
    ? `${STORAGE_KEYS.notificationsReadIds}:${authSession.email.toLowerCase()}`
    : STORAGE_KEYS.notificationsReadIds
  const notificationSampleSeedStorageKey = authSession
    ? `${STORAGE_KEYS.notificationsSampleSeeded}:${authSession.email.toLowerCase()}`
    : STORAGE_KEYS.notificationsSampleSeeded
  const notificationSeenStorageKey = authSession
    ? `${STORAGE_KEYS.notificationsSeenAt}:${authSession.email.toLowerCase()}`
    : STORAGE_KEYS.notificationsSeenAt
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(() =>
    readStoredValue<string[]>(notificationReadIdsStorageKey, []),
  )
  const [archivedNotificationIds, setArchivedNotificationIds] = useState<string[]>(() =>
    readStoredValue<string[]>(notificationArchivedIdsStorageKey, []),
  )
  const [listMode, setListMode] = useState<ListViewMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'cards' : 'table',
  )
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    readStoredValue(STORAGE_KEYS.sidebar, false),
  )
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  )
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    readStoredValue(STORAGE_KEYS.mode, 'light'),
  )
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(() => {
    const stored = readStoredValue<unknown>(STORAGE_KEYS.theme, defaultThemeConfig)
    return isThemeConfig(stored) ? stored : defaultThemeConfig
  })
  const [searchText, setSearchText] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [teamTicketsStatusFilter, setTeamTicketsStatusFilter] = useState<TicketStatus | 'All'>('Open')
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null)
  const [detailWidth, setDetailWidth] = useState(50)
  const [detailResizeActive, setDetailResizeActive] = useState(false)
  const [detailPinned, setDetailPinned] = useState(false)
  const [detailTab, setDetailTab] = useState<'details' | 'activity' | 'attachments' | 'versions'>('details')
  const [commentDraft, setCommentDraft] = useState('')
  const [commentError, setCommentError] = useState('')
  const [detailSaveError, setDetailSaveError] = useState('')
  const [attachments, setAttachments] = useState<TicketAttachment[]>([])
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [attachmentsError, setAttachmentsError] = useState('')
  const [attachmentUploadPending, setAttachmentUploadPending] = useState(false)
  const [attachmentDeletePendingId, setAttachmentDeletePendingId] = useState<string | null>(null)
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null)
  const [rapidIdentityEnabled, setRapidIdentityEnabled] = useState(true)
  const [superAdminEnabled, setSuperAdminEnabled] = useState(false)
  const [authSettingsPending, setAuthSettingsPending] = useState(false)
  const [authSettingsError, setAuthSettingsError] = useState('')
  const [loginMode, setLoginMode] = useState<LoginMode | null>(null)
  const [loginModeOverride, setLoginModeOverride] = useState<LoginMode | null>(null)
  const [loginModeSaving, setLoginModeSaving] = useState(false)
  const [loginModeError, setLoginModeError] = useState('')
  const [loginModeSaved, setLoginModeSaved] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    'TeamSupportPro is currently undergoing system maintenance. Please try again later.',
  )
  const [maintenanceMessageDraft, setMaintenanceMessageDraft] = useState(
    'TeamSupportPro is currently undergoing system maintenance. Please try again later.',
  )
  const [maintenanceMessageSaving, setMaintenanceMessageSaving] = useState(false)
  const [maintenanceMessageError, setMaintenanceMessageError] = useState('')
  const [maintenanceMessageSaved, setMaintenanceMessageSaved] = useState(false)
  const [passwordLoginEmail, setPasswordLoginEmail] = useState('')
  const [passwordLoginPassword, setPasswordLoginPassword] = useState('')
  const [passwordLoginPending, setPasswordLoginPending] = useState(false)
  const [passwordLoginError, setPasswordLoginError] = useState('')
  const [passwordRememberMe, setPasswordRememberMe] = useState(false)
  const loginAdminOverride =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('admin') === '1'
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(false)
  const [emailSettingsPending, setEmailSettingsPending] = useState(false)
  const [emailSettingsError, setEmailSettingsError] = useState('')
  const [emailConfig, setEmailConfig] = useState<{ from: string | null; replyTo: string | null; pollIntervalSeconds: number; configured: boolean; imapConfigured: boolean } | null>(null)
  const [emailTestResendPending, setEmailTestResendPending] = useState(false)
  const [emailTestResendResult, setEmailTestResendResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [emailTestImapPending, setEmailTestImapPending] = useState(false)
  const [emailTestImapResult, setEmailTestImapResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [powerBiReportUrl, setPowerBiReportUrl] = useState<string | null>(null)
  const [powerBiReportDraft, setPowerBiReportDraft] = useState('')
  const [powerBiSettingsPending, setPowerBiSettingsPending] = useState(false)
  const [powerBiSettingsError, setPowerBiSettingsError] = useState('')
  const [powerBiSettingsNotice, setPowerBiSettingsNotice] = useState('')
  const [aboutPageHtml, setAboutPageHtml] = useState('')
  const [aboutPageDraft, setAboutPageDraft] = useState('')
  const [aboutPagePending, setAboutPagePending] = useState(false)
  const [aboutPageError, setAboutPageError] = useState('')
  const [aboutPageNotice, setAboutPageNotice] = useState('')
  const [anonymousPageConfigs, setAnonymousPageConfigs] = useState<AnonymousPageConfig[]>([])
  const [anonymousPageSettingsPending, setAnonymousPageSettingsPending] = useState(false)
  const [anonymousPageSettingsError, setAnonymousPageSettingsError] = useState('')
  const [anonymousPageSettingsNotice, setAnonymousPageSettingsNotice] = useState('')
  // Feedback form state
  const [feedbackFormGlobalEnabled, setFeedbackFormGlobalEnabled] = useState(false)
  const [feedbackFormGlobalPending, setFeedbackFormGlobalPending] = useState(false)
  const [feedbackForm, setFeedbackForm] = useState<FeedbackForm | null>(null)
  const [feedbackFormPending, setFeedbackFormPending] = useState(false)
  const [feedbackFormError, setFeedbackFormError] = useState('')
  const [feedbackFormNotice, setFeedbackFormNotice] = useState('')
  const [feedbackResponses, setFeedbackResponses] = useState<FeedbackResponseSummary[]>([])
  const [feedbackResponsesLoading, setFeedbackResponsesLoading] = useState(false)
  const [feedbackTestLink, setFeedbackTestLink] = useState('')
  const [feedbackTestLinkPending, setFeedbackTestLinkPending] = useState(false)
  const [feedbackExpandedResponseId, setFeedbackExpandedResponseId] = useState<string | null>(null)
  const [feedbackEditField, setFeedbackEditField] = useState<Partial<FeedbackFormField> | null>(null)
  const [feedbackEditFieldOptionsText, setFeedbackEditFieldOptionsText] = useState('')
  const [feedbackAddFieldType, setFeedbackAddFieldType] = useState<FeedbackFieldType>('short_text')
  const [feedbackAddFieldLabel, setFeedbackAddFieldLabel] = useState('')
  const [feedbackAddFieldRequired, setFeedbackAddFieldRequired] = useState(false)
  const [feedbackAddFieldOptions, setFeedbackAddFieldOptions] = useState('')
  const [feedbackAddFieldOpen, setFeedbackAddFieldOpen] = useState(false)
  // Ticket Designer state
  const [ticketFieldDefs, setTicketFieldDefs] = useState<TicketFieldDefinition[]>([])
  const [ticketFieldDefsPending] = useState(false)
  const [ticketFieldDefsError, setTicketFieldDefsError] = useState('')
  const [ticketFieldDefsNotice, setTicketFieldDefsNotice] = useState('')
  const [ticketDesignerTab, setTicketDesignerTab] = useState<'fields' | 'layout' | 'versions'>('fields')
  const [ticketDesignerAddField, setTicketDesignerAddField] = useState(false)
  const [ticketDesignerNewField, setTicketDesignerNewField] = useState<Partial<TicketFieldDefinition>>({})
  const [ticketDesignerNewFieldOptions, setTicketDesignerNewFieldOptions] = useState('')
  const [organizationTicketLayout, setOrganizationTicketLayout] = useState<TicketLayout | null>(null)
  const [ticketLayoutDraft, setTicketLayoutDraft] = useState<TicketLayout | null>(null)
  const [lastSavedTicketLayout, setLastSavedTicketLayout] = useState<TicketLayout | null>(null)
  const [ticketLayoutError, setTicketLayoutError] = useState('')
  const [ticketLayoutNotice, setTicketLayoutNotice] = useState('')
  const [versionConfirmOpen, setVersionConfirmOpen] = useState(false)
  const [nextLayoutVersion, setNextLayoutVersion] = useState(0)
  const [lastSavedFieldDefs, setLastSavedFieldDefs] = useState<TicketFieldDefinition[]>([])
  const [createTicketFieldDefs, setCreateTicketFieldDefs] = useState<TicketFieldDefinition[]>([])
  const [newTicketCustomFields, setNewTicketCustomFields] = useState<Record<string, string>>({})
  const [detailCustomFieldDefs, setDetailCustomFieldDefs] = useState<TicketFieldDefinition[]>([])
  const [detailCustomFieldValues, setDetailCustomFieldValues] = useState<Record<string, string>>({})
  // Webhook state
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([])
  const [webhooksPending, setWebhooksPending] = useState(false)
  const [webhooksError, setWebhooksError] = useState('')
  const [webhooksNotice, setWebhooksNotice] = useState('')
  const [webhookAddOpen, setWebhookAddOpen] = useState(false)
  const [webhookAddUrl, setWebhookAddUrl] = useState('')
  const [webhookAddSecret, setWebhookAddSecret] = useState('')
  const [webhookAddEvents, setWebhookAddEvents] = useState<WebhookEvent[]>(['ticket.created', 'ticket.updated', 'ticket.assigned', 'ticket.resolved', 'ticket.closed'])
  const [webhookEditId, setWebhookEditId] = useState<string | null>(null)
  const [webhookEditUrl, setWebhookEditUrl] = useState('')
  const [webhookEditSecret, setWebhookEditSecret] = useState('')
  const [webhookEditEvents, setWebhookEditEvents] = useState<WebhookEvent[]>([])
  const [webhookTestingId, setWebhookTestingId] = useState<string | null>(null)
  // Location state
  const [locations, setLocations] = useState<Location[]>([])
  const [allLocations, setAllLocations] = useState<Location[]>([])
  const [locationAddName, setLocationAddName] = useState('')
  const [locationsPending, setLocationsPending] = useState(false)
  const [locationsError, setLocationsError] = useState('')
  const [locationsNotice, setLocationsNotice] = useState('')
  const [locationEditId, setLocationEditId] = useState<string | null>(null)
  const [locationEditName, setLocationEditName] = useState('')
  const [settingsMode, setSettingsMode] = useState<ThemeMode>('light')
  const [settingsAccordions, setSettingsAccordions] = useState<SettingsAccordionState>({
    appearance: false,
    authentication: false,
    loginMode: false,
    anonymousPages: false,
    manageOrganizations: false,
    manageUsers: false,
    manageTeams: false,
    trendSeeding: false,
    ticketSeeding: false,
    categories: false,
    locations: false,
    email: false,
    powerBi: false,
    feedbackForm: false,
    webhooks: false,
    aboutPage: false,
  })
  const [settingsAccordionOrder, setSettingsAccordionOrder] = useState<SettingsAccordionSection[]>(() =>
    normalizeSettingsAccordionOrder(
      readStoredValue<SettingsAccordionSection[]>(
        settingsAccordionOrderStorageKey,
        defaultSettingsAccordionOrder,
      ),
    ),
  )
  const [draggedSettingsSection, setDraggedSettingsSection] = useState<SettingsAccordionSection | null>(null)
  const [settingsDragOverSection, setSettingsDragOverSection] = useState<SettingsAccordionSection | null>(null)
  const [settingsDrawerSection, setSettingsDrawerSection] = useState<ManagementDrawerSection | null>(null)
  const [settingsDrawerTab, setSettingsDrawerTab] = useState<SettingsDrawerTab>('add')
  const [manageOrganizationEditDraft, setManageOrganizationEditDraft] = useState<Organization | null>(null)
  const [manageUsersEditDraft, setManageUsersEditDraft] = useState<User | null>(null)
  const [manageTeamEditDraft, setManageTeamEditDraft] = useState<Team | null>(null)
  const [manageCategoryEditDraft, setManageCategoryEditDraft] = useState<Category | null>(null)
  const [organizationForm, setOrganizationForm] = useState({
    name: '',
    code: '',
    accent: '#334155',
  })
  const [teamForm, setTeamForm] = useState({
    organizationId: initialOrganizations[0]?.id ?? '',
    name: '',
    code: '',
    accent: '#0078d4',
  })
  const [categoryForm, setCategoryForm] = useState({
    teamId: initialTeams[0]?.id ?? '',
    name: '',
    description: '',
  })
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    organizationId: initialOrganizations[0]?.id ?? '',
    teamId: initialTeams[0]?.id ?? '',
    role: 'Staff' as User['role'],
    canViewAllOrgTickets: false,
  })
  const [userFormPending, setUserFormPending] = useState(false)
  const [userSavePendingIds, setUserSavePendingIds] = useState<string[]>([])
  const [userDirectoryError, setUserDirectoryError] = useState('')
  const [userDirectoryNotice, setUserDirectoryNotice] = useState('')
  const [trendSeedDays, setTrendSeedDays] = useState(60)
  const [trendSeedCategoryId, setTrendSeedCategoryId] = useState('')
  const [trendSeedPendingAction, setTrendSeedPendingAction] = useState<'seed' | 'clear' | null>(null)
  const [trendSeedError, setTrendSeedError] = useState('')
  const [trendSeedNotice, setTrendSeedNotice] = useState('')
  const [ticketSeedAssignEnabled, setTicketSeedAssignEnabled] = useState(true)
  const [ticketSeedTeamId, setTicketSeedTeamId] = useState('')
  const [ticketSeedPending, setTicketSeedPending] = useState(false)
  const [ticketSeedError, setTicketSeedError] = useState('')
  const [ticketSeedNotice, setTicketSeedNotice] = useState('')
  const [changePasswordModal, setChangePasswordModal] = useState<{ userId: string; userName: string } | null>(null)
  const [changePasswordValue, setChangePasswordValue] = useState('')
  const [changePasswordPending, setChangePasswordPending] = useState(false)
  const [changePasswordError, setChangePasswordError] = useState('')
  const [newTicketForm, setNewTicketForm] = useState({
    teamId: '',
    title: '',
    requestorName: '',
    requestorEmail: '',
    location: '',
    categoryId: '',
    assignedToId: '',
    priority: 'Medium' as TicketPriority,
    status: 'Open' as TicketStatus,
    description: '',
  })
  const [detailDraft, setDetailDraft] = useState<{
    teamId: string
    title: string
    description: string
    status: TicketStatus
    priority: TicketPriority
    categoryId: string
    assignedToId: string
    requestorName: string
    requestorEmail: string
    location: string
  } | null>(null)
  const [authError, setAuthError] = useState('')
  const [localAuthError, setLocalAuthError] = useState('')
  const [localAuthNotice, setLocalAuthNotice] = useState('')
  const [localLoginEmail, setLocalLoginEmail] = useState(() => readCookieValue(REMEMBER_LOGIN_EMAIL_COOKIE))
  const [loginOrgId, setLoginOrgId] = useState('')
  const rememberMeNextLogin = Boolean(readCookieValue(REMEMBER_LOGIN_EMAIL_COOKIE))
  const [localLoginPending, setLocalLoginPending] = useState(false)
  const [authReady, setAuthReady] = useState(true)
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null)
  const [commentPending, setCommentPending] = useState(false)
  const [detailSavePending, setDetailSavePending] = useState(false)
  const [createTicketError, setCreateTicketError] = useState('')
  const [createTicketPending, setCreateTicketPending] = useState(false)
  const [quickActionPendingTicketId, setQuickActionPendingTicketId] = useState<string | null>(null)
  const [quickActionError, setQuickActionError] = useState('')
  const [quickActionConfirmation, setQuickActionConfirmation] = useState<QuickActionConfirmationState | null>(null)
  const [quickActionToast, setQuickActionToast] = useState<QuickActionToastState | null>(null)
  const [notificationsPreviewOpen, setNotificationsPreviewOpen] = useState(false)
  const notificationsPreviewRef = useRef<HTMLDivElement | null>(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const detailResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const quickActionToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const deferredSearch = useDeferredValue(searchText)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const availableOrganizations = !directoryLoaded && organizations.length === 0 ? initialOrganizations : organizations
  const availableTeams = !directoryLoaded && teams.length === 0 ? initialTeams : teams
  const availableCategories = !directoryLoaded && categories.length === 0 ? initialCategories : categories
  const availableUsers = !directoryLoaded && users.length === 0 ? initialUsers : users
  const selectedLoginUser = availableUsers.find(
    (user) => user.email.toLowerCase() === localLoginEmail.trim().toLowerCase(),
  ) ?? availableUsers[0]
  const resolvedLoginOrgId = (loginOrgId && availableOrganizations.some((o) => o.id === loginOrgId))
    ? loginOrgId
    : selectedLoginUser?.organizationId ?? availableOrganizations[0]?.id ?? ''
  const filteredLoginUsers = availableUsers.filter((u) => u.organizationId === resolvedLoginOrgId)
  const loginOrgTeams = availableTeams.filter((t) => t.organizationId === resolvedLoginOrgId)
  const loginOrgTeamIds = new Set(loginOrgTeams.map((t) => t.id))
  const loginOrgCategories = availableCategories.filter((c) => loginOrgTeamIds.has(c.teamId))
  const loginOrgTicketCount = testLoginDataPending
    ? null
    : (loginActiveTicketCounts[resolvedLoginOrgId] ?? 0)
  const currentUser = authSession
    ? {
        ...(availableUsers.find((user) => user.email.toLowerCase() === authSession.email.toLowerCase()) ??
          createMockSessionUser(authSession)),
        role: authSession.role ?? 'Staff',
      }
    : availableUsers.find((user) => user.id === currentUserId) ?? availableUsers[0]
  const visibleNavItems =
    currentUser.role === 'Admin' || currentUser.role === 'Super Admin' ? [...navItems, ...adminNavItems] : navItems
  const currentTeam = availableTeams.find((team) => team.id === currentUser.teamId) ?? availableTeams[0]
  const currentTeamCategories = availableCategories.filter(
    (category) => category.teamId === currentUser.teamId,
  )
  const canViewAllOrgTickets = Boolean(currentUser.canViewAllOrgTickets)
  const organizationTeams = useMemo(
    () => availableTeams.filter((team) => team.organizationId === currentUser.organizationId),
    [availableTeams, currentUser.organizationId],
  )
  const isTicketInScope = (ticket: { teamId: string }) => {
    if (canViewAllOrgTickets) {
      const team = availableTeams.find((t) => t.id === ticket.teamId)
      return team?.organizationId === currentUser.organizationId
    }
    return ticket.teamId === currentUser.teamId
  }
  const currentTeamMembers = useMemo(
    () =>
      availableUsers.some((user) => user.id === currentUser.id)
        ? availableUsers.filter((user) => user.teamId === currentUser.teamId)
        : [...availableUsers.filter((user) => user.teamId === currentUser.teamId), currentUser],
    [availableUsers, currentUser.id, currentUser.teamId],
  )
  const mentionLookup = useMemo(
    () => buildMentionLookup(currentTeamMembers),
    [currentTeamMembers],
  )

  const getOrganizationById = (organizationId: string) =>
    organizations.find((organization) => organization.id === organizationId)
  const getTeamById = (teamId: string) => teams.find((team) => team.id === teamId)
  const getCategoryById = (categoryId: string) =>
    categories.find((category) => category.id === categoryId)
  const getUserById = (userId: string | null) =>
    users.find((user) => user.id === userId)

  const notificationSourceTickets = useMemo(
    () =>
      tickets.filter(
        (ticket) => ticket.teamId === currentUser.teamId && ticket.assignedToId === currentUser.id,
      ),
    [tickets, currentUser.teamId, currentUser.id],
  )
  const teamScopeTickets = useMemo(
    () => tickets.filter((ticket) => ticket.teamId === currentUser.teamId),
    [tickets, currentUser.teamId],
  )
  const unassignedCount = useMemo(
    () =>
      tickets.filter(
        (ticket) => isTicketInScope(ticket) && (!ticket.assignedToId || !getUserById(ticket.assignedToId)),
      ).length,
    [tickets, currentUser.teamId, canViewAllOrgTickets, currentUser.organizationId, availableTeams, availableUsers],
  )
  const myTicketsCount = useMemo(
    () =>
      tickets.filter(
        (ticket) => ticket.assignedToId === currentUser.id,
      ).length,
    [tickets, currentUser.id],
  )
  const activePalette = isThemeConfig(themeConfig)
    ? themeConfig[themeMode]
    : defaultThemeConfig[themeMode]
  const seededNotificationItems = useMemo(
    () =>
      buildSeedNotificationItems(
        notificationSourceTickets,
        currentUser.name,
      ),
    [notificationSourceTickets, currentUser.name],
  )
  const seededReadNotificationIds = useMemo(
    () => seededNotificationItems.slice(3).map((item) => item.id),
    [seededNotificationItems],
  )
  const activityNotificationItems = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = []

    teamScopeTickets.forEach((ticket) => {
      ticket.activity.forEach((entry) => {
        const isAssignedTicket = ticket.assignedToId === currentUser.id
        const isMentioned = extractMentionedUserIds(entry.message, mentionLookup).has(currentUser.id)
        const isWatched = watchedTicketIds.has(ticket.id)

        if (entry.actor === currentUser.name || (!isAssignedTicket && !isMentioned && !isWatched)) {
          return
        }

        items.push({
          id: entry.id,
          ticketId: ticket.id,
          ticketTitle: ticket.title,
          actor: entry.actor,
          message: entry.message,
          at: entry.at,
          type: isMentioned ? 'mention' : 'activity',
        })
      })
    })

    return items
  }, [teamScopeTickets, currentUser.id, currentUser.name, mentionLookup, watchedTicketIds])
  const notificationItems = useMemo(
    () =>
      [...seededNotificationItems, ...activityNotificationItems].sort(
        (left, right) => new Date(right.at).getTime() - new Date(left.at).getTime(),
      ),
    [seededNotificationItems, activityNotificationItems],
  )
  const archivedNotificationIdSet = new Set(archivedNotificationIds)
  const visibleNotificationItems = notificationItems.filter((item) => !archivedNotificationIdSet.has(item.id))

  useEffect(() => {
    if (authSession) {
      window.localStorage.setItem(STORAGE_KEYS.auth, JSON.stringify(authSession))
      return
    }

    window.localStorage.removeItem(STORAGE_KEYS.auth)
  }, [authSession])

  useEffect(() => {
    setDashboardLayouts(
      mergeDashboardLayouts(readStoredValue<DashboardLayouts | null>(dashboardLayoutStorageKey, null)),
    )
  }, [dashboardLayoutStorageKey])

  useEffect(() => {
    setSettingsAccordionOrder(
      normalizeSettingsAccordionOrder(
        readStoredValue<SettingsAccordionSection[]>(
          settingsAccordionOrderStorageKey,
          defaultSettingsAccordionOrder,
        ),
      ),
    )
  }, [settingsAccordionOrderStorageKey])

  useEffect(() => {
    setArchivedNotificationIds(readStoredValue<string[]>(notificationArchivedIdsStorageKey, []))
  }, [notificationArchivedIdsStorageKey])

  useEffect(() => {
    const storedReadIds = readStoredValue<string[]>(notificationReadIdsStorageKey, [])
    if (storedReadIds.length > 0) {
      setReadNotificationIds(storedReadIds)
      return
    }

    const seenAt = readStoredValue<number>(notificationSeenStorageKey, 0)
    if (!seenAt) {
      setReadNotificationIds([])
      return
    }

    const migratedReadIds = tickets
      .filter(
        (ticket) => ticket.teamId === currentUser.teamId && ticket.assignedToId === currentUser.id,
      )
      .flatMap((ticket) => ticket.activity)
      .filter((entry) => new Date(entry.at).getTime() <= seenAt)
      .map((entry) => entry.id)

    setReadNotificationIds(migratedReadIds)
  }, [notificationReadIdsStorageKey, notificationSeenStorageKey, tickets, currentUser.teamId, currentUser.id])

  useEffect(() => {
    const hasSeededSamples = readStoredValue<boolean>(notificationSampleSeedStorageKey, false)
    if (hasSeededSamples || seededReadNotificationIds.length === 0) {
      return
    }

    setReadNotificationIds((current) => Array.from(new Set([...current, ...seededReadNotificationIds])))
    window.localStorage.setItem(notificationSampleSeedStorageKey, JSON.stringify(true))
  }, [notificationSampleSeedStorageKey, seededReadNotificationIds])

  useEffect(() => {
    window.localStorage.setItem(dashboardLayoutStorageKey, JSON.stringify(dashboardLayouts))
  }, [dashboardLayoutStorageKey, dashboardLayouts])

  useEffect(() => {
    window.localStorage.setItem(
      settingsAccordionOrderStorageKey,
      JSON.stringify(settingsAccordionOrder),
    )
  }, [settingsAccordionOrderStorageKey, settingsAccordionOrder])

  useEffect(() => {
    window.localStorage.setItem(
      notificationArchivedIdsStorageKey,
      JSON.stringify(archivedNotificationIds),
    )
  }, [notificationArchivedIdsStorageKey, archivedNotificationIds])

  useEffect(() => {
    window.localStorage.setItem(notificationReadIdsStorageKey, JSON.stringify(readNotificationIds))
  }, [notificationReadIdsStorageKey, readNotificationIds])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.sidebar, JSON.stringify(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.mode, JSON.stringify(themeMode))
  }, [themeMode])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(themeConfig))
  }, [themeConfig])

  useEffect(() => {
    return () => {
      if (quickActionToastTimeoutRef.current) {
        clearTimeout(quickActionToastTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (activeView === 'settings') {
      setSettingsTabsLoading(true)
      fetch(apiUrl('/api/settings/tabs'), { credentials: 'include' })
        .then((res) => res.ok ? res.json() : { tabs: [] })
        .then((data: { tabs?: SettingsTab[] }) => {
          const tabs = data.tabs ?? []
          setSettingsTabs(tabs)
          if (tabs.length > 0 && !activeSettingsTabId) {
            setActiveSettingsTabId(tabs[0].id)
          }
        })
        .catch(() => setSettingsTabs([]))
        .finally(() => setSettingsTabsLoading(false))
    }
  }, [activeView])

  useEffect(() => {
    if (activeView === 'new-ticket' && currentUser.organizationId) {
      fetch(apiUrl(`/api/organizations/${encodeURIComponent(currentUser.organizationId)}/ticket-fields`), { credentials: 'include' })
        .then((res) => res.ok ? res.json() : { fields: [] })
        .then((data) => setCreateTicketFieldDefs(data.fields ?? []))
        .catch(() => setCreateTicketFieldDefs([]))
    }
  }, [activeView, currentUser.organizationId])

  useEffect(() => {
    if (!currentUser.organizationId) {
      setOrganizationTicketLayout(null)
      return
    }
    const shouldLoadLayout =
      activeView === 'new-ticket' ||
      activeView === 'ticket-designer' ||
      detailTicketId !== null
    if (shouldLoadLayout) {
      void refreshTicketLayout()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, currentUser.organizationId, detailTicketId])

  useEffect(() => {
    const ticket = tickets.find((t) => t.id === detailTicketId) ?? null
    if (!ticket || !currentUser.organizationId) {
      setDetailCustomFieldDefs([])
      setDetailCustomFieldValues({})
      return
    }
    fetch(apiUrl(`/api/organizations/${encodeURIComponent(currentUser.organizationId)}/ticket-fields`), { credentials: 'include' })
      .then((res) => res.ok ? res.json() : { fields: [] })
      .then((data: { fields?: TicketFieldDefinition[] }) => {
        const defs: TicketFieldDefinition[] = data.fields ?? []
        setDetailCustomFieldDefs(defs)
        const existing: Record<string, string> = {}
        for (const cf of ticket.customFields ?? []) existing[cf.fieldId] = cf.value
        const merged: Record<string, string> = {}
        for (const def of defs) merged[def.id] = existing[def.id] ?? ''
        setDetailCustomFieldValues(merged)
      })
      .catch(() => {
        setDetailCustomFieldDefs([])
        setDetailCustomFieldValues({})
      })
  }, [detailTicketId, currentUser.organizationId, tickets])

  const fetchDashboardTrends = async () => {
    const response = await fetch(apiUrl('/api/dashboard/trends'), {
      credentials: 'include',
    })

    if (response.status === 401) {
      setAuthSession(null)
      return null
    }

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      trends?: TrendPoint[]
    }

    return Array.isArray(payload.trends) ? payload.trends : null
  }

  const fetchTickets = async () => {
    const response = await fetch(apiUrl('/api/tickets'), {
      credentials: 'include',
    })

    if (response.status === 401) {
      setAuthSession(null)
      return null
    }

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      tickets?: TicketRecord[]
    }

    return Array.isArray(payload.tickets) ? payload.tickets : null
  }

  const fetchDashboardSummary = async () => {
    const response = await fetch(apiUrl('/api/dashboard/summary'), {
      credentials: 'include',
    })

    if (response.status === 401) {
      setAuthSession(null)
      return null
    }

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      summary?: DashboardSummary
    }

    return payload.summary ?? null
  }

  useEffect(() => {
    let cancelled = false

    const loadPublicAuthSettings = async () => {
      try {
        const response = await fetch(apiUrl('/api/public/auth-settings'))
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as {
          rapidIdentityEnabled?: boolean
          superAdminEnabled?: boolean
          loginMode?: string
          maintenanceMessage?: string
          loginModeOverride?: string | null
        }

        if (!cancelled && typeof payload.rapidIdentityEnabled === 'boolean') {
          setRapidIdentityEnabled(payload.rapidIdentityEnabled)
        }
        if (!cancelled && typeof payload.superAdminEnabled === 'boolean') {
          setSuperAdminEnabled(payload.superAdminEnabled)
        }
        if (!cancelled) {
          const mode = normalizeClientLoginMode(payload.loginMode)
          setLoginMode(mode)
          if (typeof payload.maintenanceMessage === 'string' && payload.maintenanceMessage.trim()) {
            setMaintenanceMessage(payload.maintenanceMessage)
            setMaintenanceMessageDraft(payload.maintenanceMessage)
          }
          const overrideRaw = payload.loginModeOverride
          if (overrideRaw === 'select' || overrideRaw === 'password' || overrideRaw === 'maintenance') {
            setLoginModeOverride(overrideRaw)
          } else {
            setLoginModeOverride(null)
          }
        }
      } catch {
        // Keep default visibility if auth settings cannot be loaded.
      }
    }

    const loadTestLoginUsers = async () => {
      try {
        const response = await fetch(apiUrl('/api/public/test-login-users'))
        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as {
          organizations?: typeof initialOrganizations
          teams?: typeof initialTeams
          users?: typeof initialUsers
          categories?: typeof initialCategories
          activeTicketCounts?: Record<string, number>
        }

        if (cancelled) {
          return
        }

        if (Array.isArray(payload.organizations)) {
          setOrganizations(payload.organizations)
        }

        if (Array.isArray(payload.teams)) {
          setTeams(payload.teams)
        }

        if (Array.isArray(payload.users)) {
          setUsers(payload.users)
        }

        if (Array.isArray(payload.categories)) {
          setCategories(payload.categories)
        }

        if (payload.activeTicketCounts && typeof payload.activeTicketCounts === 'object') {
          setLoginActiveTicketCounts(payload.activeTicketCounts)
        }
      } catch {
        // The login screen can fall back to bundled mock users when the server list is unavailable.
      } finally {
        if (!cancelled) {
          setTestLoginDataPending(false)
        }
      }
    }

    void loadPublicAuthSettings()
    void loadTestLoginUsers()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (authSession?.role !== 'Admin' && authSession?.role !== 'Super Admin') {
      setAnonymousPageConfigs([])
      setAnonymousPageSettingsError('')
      setAnonymousPageSettingsNotice('')
      setEmailConfig(null)
      setEmailNotificationsEnabled(false)
      setPowerBiReportUrl(null)
      setPowerBiReportDraft('')
      setPowerBiSettingsError('')
      setPowerBiSettingsNotice('')
      setAboutPageError('')
      setAboutPageNotice('')
      setLoginModeError('')
      setLoginModeSaved(false)
      setMaintenanceMessageError('')
      setMaintenanceMessageSaved(false)
      return
    }

    let cancelled = false

    const loadEmailSettings = async () => {
      try {
        const response = await fetch(apiUrl('/api/settings/email'), { credentials: 'include' })
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as {
          enabled?: boolean
          from?: string | null
          replyTo?: string | null
          pollIntervalSeconds?: number
          configured?: boolean
        }
        if (!cancelled) {
          if (typeof payload.enabled === 'boolean') setEmailNotificationsEnabled(payload.enabled)
          setEmailConfig({
            from: payload.from ?? null,
            replyTo: payload.replyTo ?? null,
            pollIntervalSeconds: payload.pollIntervalSeconds ?? 120,
            configured: payload.configured ?? false,
            imapConfigured: (payload as { imapConfigured?: boolean }).imapConfigured ?? false,
          })
        }
      } catch {
        // Keep defaults if email settings cannot be loaded.
      }
    }

    const loadAnonymousPageSettings = async () => {
      setAnonymousPageSettingsPending(true)
      setAnonymousPageSettingsError('')

      try {
        const response = await fetch(apiUrl('/api/settings/anonymous-pages'), {
          credentials: 'include',
        })

        if (!response.ok) {
          if (!cancelled) {
            setAnonymousPageSettingsError('Anonymous page settings could not be loaded.')
          }
          return
        }

        const payload = (await response.json()) as { pages?: AnonymousPageConfig[] }

        if (!cancelled) {
          setAnonymousPageConfigs(Array.isArray(payload.pages) ? payload.pages : [])
        }
      } catch {
        if (!cancelled) {
          setAnonymousPageSettingsError('Anonymous page settings could not be loaded. Confirm the backend server is running.')
        }
      } finally {
        if (!cancelled) {
          setAnonymousPageSettingsPending(false)
        }
      }
    }

    const loadPowerBiSettings = async () => {
      setPowerBiSettingsError('')

      try {
        const response = await fetch(apiUrl('/api/settings/power-bi'), {
          credentials: 'include',
        })

        if (!response.ok || cancelled) {
          if (!cancelled) {
            setPowerBiSettingsError('Power BI settings could not be loaded.')
          }
          return
        }

        const payload = (await response.json()) as { reportUrl?: string | null }
        const nextUrl = typeof payload.reportUrl === 'string' && payload.reportUrl.trim()
          ? payload.reportUrl.trim()
          : null

        if (!cancelled) {
          setPowerBiReportUrl(nextUrl)
          setPowerBiReportDraft(nextUrl ?? '')
        }
      } catch {
        if (!cancelled) {
          setPowerBiSettingsError('Power BI settings could not be loaded. Confirm the backend server is running.')
        }
      }
    }

    void loadAnonymousPageSettings()

    void loadEmailSettings()

    void loadPowerBiSettings()

    const loadAboutPageSettings = async () => {
      try {
        const response = await fetch(apiUrl('/api/settings/about'), { credentials: 'include' })
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as { html?: string }
        if (!cancelled) {
          const html = payload.html ?? ''
          setAboutPageHtml(html)
          setAboutPageDraft(html)
        }
      } catch {
        // non-fatal
      }
    }

    void loadAboutPageSettings()

    const loadLoginModeSettings = async () => {
      try {
        const response = await fetch(apiUrl('/api/settings/login-mode'), { credentials: 'include' })
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as {
          loginMode?: string
          loginModeOverride?: string | null
          maintenanceMessage?: string
        }
        if (cancelled) return
        const mode = normalizeClientLoginMode(payload.loginMode)
        setLoginMode(mode)
        if (typeof payload.maintenanceMessage === 'string' && payload.maintenanceMessage.trim()) {
          setMaintenanceMessage(payload.maintenanceMessage)
          setMaintenanceMessageDraft(payload.maintenanceMessage)
        }
        const overrideRaw = payload.loginModeOverride
        if (overrideRaw === 'select' || overrideRaw === 'password' || overrideRaw === 'maintenance') {
          setLoginModeOverride(overrideRaw)
        } else {
          setLoginModeOverride(null)
        }
      } catch {
        // non-fatal
      }
    }

    void loadLoginModeSettings()

    if (authSession?.organizationId) {
      void loadFeedbackSettings(authSession.organizationId)
    }

    if (authSession?.role === 'Admin' || authSession?.role === 'Super Admin') {
      void refreshWebhooks()
    }

    const loadAllLocations = async () => {
      if (authSession?.role !== 'Admin' && authSession?.role !== 'Super Admin') return
      try {
        const response = await fetch(apiUrl('/api/settings/locations'), { credentials: 'include' })
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as { locations?: Location[] }
        if (!cancelled && Array.isArray(payload.locations)) {
          setAllLocations(payload.locations)
        }
      } catch {
        // non-fatal
      }
    }

    void loadAllLocations()

    return () => {
      cancelled = true
    }
  }, [authSession?.role])

  useEffect(() => {
    if (availableUsers.length === 0) {
      return
    }

    const normalizedSelectedEmail = localLoginEmail.trim().toLowerCase()
    const matchedUser = availableUsers.find((user) => user.email.toLowerCase() === normalizedSelectedEmail)

    if (!matchedUser) {
      setLocalLoginEmail(availableUsers[0].email)
      if (!loginOrgId) {
        setLoginOrgId(availableUsers[0].organizationId)
      }
    } else if (!loginOrgId) {
      setLoginOrgId(matchedUser.organizationId)
    }
  }, [availableUsers, localLoginEmail, loginOrgId])

  useEffect(() => {
    // Initialize password login email from remembered cookie once
    const remembered = readCookieValue(REMEMBER_LOGIN_EMAIL_COOKIE)
    if (remembered && !passwordLoginEmail) {
      setPasswordLoginEmail(remembered)
      setPasswordRememberMe(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncMobileDefaults = () => {
      const isMobile = window.innerWidth < 768
      setIsMobileViewport(isMobile)

      if (isMobile) {
        setListMode('cards')
        setSidebarCollapsed(false)
      }
    }

    syncMobileDefaults()
    window.addEventListener('resize', syncMobileDefaults)
    return () => window.removeEventListener('resize', syncMobileDefaults)
  }, [])

  useEffect(() => {
    setNewTicketForm((current) => {
      const formTeamId = current.teamId || currentTeam?.id || ''
      if (!formTeamId) {
        return current
      }
      const formTeamCategories = categories.filter((category) => category.teamId === formTeamId)
      if (formTeamCategories.length === 0) {
        return current.teamId === formTeamId ? current : { ...current, teamId: formTeamId }
      }
      const validIds = new Set(formTeamCategories.map((c) => c.id))
      if (current.teamId === formTeamId && validIds.has(current.categoryId)) {
        return current
      }
      return { ...current, teamId: formTeamId, categoryId: formTeamCategories[0].id }
    })
  }, [categories, currentTeam?.id])

  useEffect(() => {
    let cancelled = false

    const checkBackend = async () => {
      try {
        const response = await fetch(apiUrl('/api/health'))
        if (!cancelled) {
          setBackendAvailable(response.ok)
        }
      } catch {
        if (!cancelled) {
          setBackendAvailable(false)
        }
      }
    }

    const restoreSession = async () => {
      try {
        const response = await fetch(apiUrl('/api/auth/me'), {
          credentials: 'include',
        })

        if (response.status === 401) {
          if (!cancelled) {
            setAuthSession(null)
          }
          return
        }

        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as {
          authenticated?: boolean
          user?: SessionApiUser
        }

        const restoredUser = payload.user

        if (!cancelled && payload.authenticated && restoredUser) {
          setAuthSession((current) => current ?? mapSessionApiUser(restoredUser))
        }
      } catch {
        // Local storage remains the fallback when the backend is unavailable.
      } finally {
        if (!cancelled) {
          setAuthReady(true)
        }
      }
    }

    void checkBackend()
    void restoreSession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!authReady || !authSession) {
      if (authReady && !authSession) {
        setDirectoryLoaded(false)
      }
      return
    }

    let cancelled = false

    const loadDirectory = async () => {
      try {
        const response = await fetch(apiUrl('/api/directory'), {
          credentials: 'include',
        })

        if (response.status === 401) {
          if (!cancelled) {
            setAuthSession(null)
          }
          return
        }

        if (!response.ok) {
          return
        }

        const payload = (await response.json()) as {
          organizations?: typeof initialOrganizations
          teams?: typeof initialTeams
          categories?: typeof initialCategories
          users?: typeof initialUsers
        }

        if (!cancelled) {
          if (Array.isArray(payload.organizations)) {
            setOrganizations(payload.organizations)
          }

          if (Array.isArray(payload.teams)) {
            setTeams(payload.teams)
          }

          if (Array.isArray(payload.categories)) {
            setCategories(payload.categories)
          }

          if (Array.isArray(payload.users)) {
            setUsers(payload.users)
          }

          setDirectoryLoaded(true)
        }
      } catch {
        // The app can continue from mock directory data if the API is unavailable.
      }
    }

    const loadLocations = async () => {
      try {
        const response = await fetch(apiUrl('/api/locations'))
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as { locations?: Location[] }
        if (!cancelled && Array.isArray(payload.locations)) {
          setLocations(payload.locations)
        }
      } catch {
        // non-fatal
      }
    }

    const loadTickets = async () => {
      try {
        const nextTickets = await fetchTickets()
        if (!cancelled && Array.isArray(nextTickets)) {
          setTickets(nextTickets)
        }
      } catch {
        // The app can continue from mock tickets if the API is unavailable.
      }
    }

    const loadTrends = async () => {
      try {
        const trends = await fetchDashboardTrends()

        if (!cancelled && Array.isArray(trends) && trends.length > 0) {
          setTrendPoints(trends)
        }
      } catch {
        // The app can continue from mock trend data if the API is unavailable.
      }
    }

    const loadDashboardSummary = async () => {
      try {
        const nextSummary = await fetchDashboardSummary()
        if (!cancelled && nextSummary) {
          setDashboardSummary(nextSummary)
        }
      } catch {
        // The app can continue with client-side fallback summary values.
      }
    }

    void loadDirectory()
    void loadLocations()
    void loadTickets()
    void loadTrends()
    void loadDashboardSummary()

    return () => {
      cancelled = true
    }
  }, [authReady, authSession])

  useEffect(() => {
    if (!authSession) {
      setWatchedTicketIds(new Set())
      return
    }

    let cancelled = false

    const loadWatchedTickets = async () => {
      try {
        const response = await fetch(apiUrl('/api/watchers/my-tickets'), { credentials: 'include' })
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as { ticketIds?: string[] }
        if (!cancelled && Array.isArray(payload.ticketIds)) {
          setWatchedTicketIds(new Set(payload.ticketIds))
        }
      } catch {
        // Non-critical — fall back to empty set
      }
    }

    void loadWatchedTickets()

    return () => {
      cancelled = true
    }
  }, [authSession])

  useEffect(() => {
    if (!authSession) {
      setAboutPageHtml('')
      setAboutPageDraft('')
      return
    }

    let cancelled = false

    const loadAbout = async () => {
      try {
        const response = await fetch(apiUrl('/api/about'), { credentials: 'include' })
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as { html?: string }
        if (!cancelled) {
          const html = payload.html ?? ''
          setAboutPageHtml(html)
          if (authSession.role === 'Admin' || authSession.role === 'Super Admin') {
            setAboutPageDraft(html)
          }
        }
      } catch {
        // non-fatal
      }
    }

    void loadAbout()

    return () => { cancelled = true }
  }, [authSession?.email])

  useEffect(() => {
    if (!authSession) {
      return
    }

    setUsers((current) => {
      if (current.some((user) => user.email.toLowerCase() === authSession.email.toLowerCase())) {
        return current
      }

      return [createMockSessionUser(authSession), ...current]
    })
  }, [authSession])

  useEffect(() => {
    if (
      currentUser.role !== 'Admin' &&
      currentUser.role !== 'Super Admin' &&
      (
        activeView === 'settings' ||
        activeView === 'reports' ||
        activeView === 'manage-organizations' ||
        activeView === 'manage-users' ||
        activeView === 'manage-teams' ||
        activeView === 'manage-categories'
      )
    ) {
      setActiveView('dashboard')
    }
  }, [activeView, currentUser.role])

  useEffect(() => {
    if (activeView === 'notifications') {
      setReadNotificationIds((current) => {
        const next = new Set(current)
        activityNotificationItems.forEach((item) => next.add(item.id))
        return Array.from(next)
      })
      setNotificationsPreviewOpen(false)
    }
  }, [activeView, activityNotificationItems])

  useEffect(() => {
    const validNotificationIds = new Set(
      [
        ...activityNotificationItems.map((item) => item.id),
        ...seededNotificationItems.map((item) => item.id),
      ],
    )
    setReadNotificationIds((current) => {
      const filtered = current.filter((id) => validNotificationIds.has(id))
      if (filtered.length === current.length && filtered.every((id, index) => id === current[index])) {
        return current
      }

      return filtered
    })
  }, [activityNotificationItems, seededNotificationItems])

  useEffect(() => {
    if (!notificationsPreviewOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!notificationsPreviewRef.current?.contains(event.target as Node)) {
        setNotificationsPreviewOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [notificationsPreviewOpen])

  useEffect(() => {
    if (!profileMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [profileMenuOpen])

  useEffect(() => {
    if (!detailResizeActive) {
      return
    }

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = detailResizeStateRef.current
      if (!resizeState) {
        return
      }

      const deltaPercent = ((resizeState.startX - event.clientX) / window.innerWidth) * 100
      const nextWidth = Math.min(80, Math.max(30, resizeState.startWidth + deltaPercent))
      setDetailWidth(nextWidth)
    }

    const handlePointerUp = () => {
      detailResizeStateRef.current = null
      setDetailResizeActive(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [detailResizeActive])

  const selectedTicket = tickets.find((ticket) => ticket.id === detailTicketId) ?? null

  useEffect(() => {
    if (!selectedTicket) {
      setDetailDraft(null)
      setCommentDraft('')
      setCommentError('')
      setDetailSaveError('')
      setAttachments([])
      setAttachmentFile(null)
      setAttachmentsError('')
      setPreviewAttachmentId(null)
      return
    }

    setDetailDraft({
      teamId: selectedTicket.teamId,
      title: selectedTicket.title,
      description: selectedTicket.description,
      status: selectedTicket.status,
      priority: selectedTicket.priority,
      categoryId: selectedTicket.categoryId,
      assignedToId: selectedTicket.assignedToId ?? '',
      requestorName: selectedTicket.requestorName,
      requestorEmail: selectedTicket.requestorEmail,
      location: selectedTicket.location,
    })
    setCommentDraft('')
    setCommentError('')
    setDetailSaveError('')
    setAttachmentFile(null)
    setAttachmentsError('')
    setPreviewAttachmentId(null)
  }, [selectedTicket])

  useEffect(() => {
    if (!selectedTicket || !authSession) {
      return
    }

    let cancelled = false

    const loadAttachments = async () => {
      setAttachmentsLoading(true)
      setAttachmentsError('')

      try {
        const response = await fetch(apiUrl(`/api/tickets/${selectedTicket.id}/attachments`), {
          credentials: 'include',
        })

        if (response.status === 401) {
          if (!cancelled) {
            setAuthSession(null)
            setAttachmentsError('Your session expired. Please sign in again.')
          }
          return
        }

        if (!response.ok) {
          if (!cancelled) {
            setAttachmentsError('Attachments could not be loaded.')
          }
          return
        }

        const payload = (await response.json()) as {
          attachments?: TicketAttachment[]
        }

        if (!cancelled) {
          setAttachments(Array.isArray(payload.attachments) ? payload.attachments : [])
        }
      } catch {
        if (!cancelled) {
          setAttachmentsError('Attachments could not be loaded. Confirm the backend server is running.')
        }
      } finally {
        if (!cancelled) {
          setAttachmentsLoading(false)
        }
      }
    }

    void loadAttachments()

    return () => {
      cancelled = true
    }
  }, [selectedTicket?.id, authSession])

  useEffect(() => {
    if (!selectedTicket) {
      setTicketWatchers([])
      return
    }

    let cancelled = false

    const loadWatchers = async () => {
      try {
        const response = await fetch(apiUrl(`/api/tickets/${selectedTicket.id}/watchers`), {
          credentials: 'include',
        })
        if (!response.ok || cancelled) return
        const payload = (await response.json()) as { watchers?: TicketWatcher[] }
        if (!cancelled && Array.isArray(payload.watchers)) {
          setTicketWatchers(payload.watchers)
        }
      } catch {
        // Non-critical
      }
    }

    void loadWatchers()

    return () => {
      cancelled = true
    }
  }, [selectedTicket?.id])

  useEffect(() => {
    if (!previewAttachmentId) {
      return
    }

    const previewAttachment = attachments.find((attachment) => attachment.id === previewAttachmentId)
    if (previewAttachment?.contentType.toLowerCase().includes('pdf')) {
      return
    }

    setPreviewAttachmentId(null)
  }, [attachments, previewAttachmentId])

  useEffect(() => {
    setCreateTicketError('')
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'settings') {
      setSettingsDrawerSection(null)
    }
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'manage-organizations') {
      setManageOrganizationEditDraft(null)
    }
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'manage-users') {
      setManageUsersEditDraft(null)
    }
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'manage-teams') {
      setManageTeamEditDraft(null)
    }
  }, [activeView])

  useEffect(() => {
    if (activeView !== 'manage-categories') {
      setManageCategoryEditDraft(null)
    }
  }, [activeView])

  const refreshTicket = async (ticketId: string) => {
    const response = await fetch(apiUrl(`/api/tickets/${ticketId}`), {
      credentials: 'include',
    })

    if (response.status === 401) {
      setAuthSession(null)
      return
    }

    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as {
      ticket?: TicketRecord
    }

    if (payload.ticket) {
      setTickets((current) =>
        current.map((ticket) => (ticket.id === payload.ticket?.id ? payload.ticket : ticket)),
      )
    }
  }

  const getBaseVisibleTickets = () => {
    switch (activeView) {
      case 'unassigned':
        return tickets.filter(
          (ticket) => isTicketInScope(ticket) && (!ticket.assignedToId || !getUserById(ticket.assignedToId)),
        )
      case 'my-tickets':
        return tickets.filter(
          (ticket) =>
            isTicketInScope(ticket) &&
            ticket.assignedToId === currentUser.id,
        )
      case 'team-tickets':
        return tickets.filter((ticket) => isTicketInScope(ticket))
      case 'dashboard':
        return tickets.filter((ticket) => isTicketInScope(ticket))
      default:
        return tickets.filter((ticket) => isTicketInScope(ticket))
    }
  }

  const visibleTickets = getBaseVisibleTickets().filter((ticket) => {
    if (
      activeView === 'team-tickets' &&
      teamTicketsStatusFilter !== 'All' &&
      ticket.status !== teamTicketsStatusFilter
    ) {
      return false
    }

    const query = deferredSearch.trim().toLowerCase()
    if (!query) {
      return true
    }

    const categoryName = getCategoryById(ticket.categoryId)?.name ?? ''
    const assigneeName = getUserById(ticket.assignedToId)?.name ?? ''

    return [
      ticket.id,
      ticket.title,
      ticket.requestorName,
      ticket.requestorEmail,
      categoryName,
      assigneeName,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  const readNotificationIdSet = new Set(readNotificationIds)
  const unreadNotifications = visibleNotificationItems.filter((item) => !readNotificationIdSet.has(item.id))
  const unreadNotificationCount = unreadNotifications.length
  const notificationPreviewItems = visibleNotificationItems.slice(0, 3)
  const currentTeamTickets = tickets.filter((ticket) => isTicketInScope(ticket))

  const fallbackDashboardStats = {
    total: currentTeamTickets.length,
    open: currentTeamTickets.filter((ticket) => ticket.status === 'Open').length,
    inProgress: currentTeamTickets.filter((ticket) => ticket.status === 'In Progress').length,
    pending: currentTeamTickets.filter((ticket) => ticket.status === 'Pending').length,
    critical: currentTeamTickets.filter((ticket) => ticket.priority === 'Critical').length,
  }

  const fallbackStatusCounts = statusOptions.map((status) => ({
    status,
    count: tickets.filter((ticket) => ticket.status === status).length,
  }))

  const dashboardStats = dashboardSummary?.stats ?? fallbackDashboardStats
  const statusCounts = dashboardSummary?.statusCounts ?? fallbackStatusCounts
  const teamWorkload = dashboardSummary?.teamWorkload ?? teams.map((team) => ({
    teamId: team.id,
    count: tickets.filter((ticket) => ticket.teamId === team.id).length,
  }))

  const chartData = trendPoints.map((point) => ({
    date: point.date,
    ...Object.fromEntries(
      teams.map((team) => [team.id, point.values[team.id] ?? 0]),
    ),
  }))

  const updateThemeColor = (mode: ThemeMode, field: keyof ThemeConfig[ThemeMode], value: string) => {
    setThemeConfig((current) => ({
      ...current,
      [mode]: {
        ...current[mode],
        [field]: value,
      },
    }))
  }

  const refreshAuthSession = async () => {
    try {
      const response = await fetch(apiUrl('/api/auth/me'), {
        credentials: 'include',
      })

      if (response.status === 401) {
        setAuthSession(null)
        return
      }

      if (!response.ok) {
        return
      }

      const payload = (await response.json()) as {
        authenticated?: boolean
        user?: SessionApiUser
      }

      if (payload.authenticated && payload.user) {
        setAuthSession(mapSessionApiUser(payload.user))
      }
    } catch {
      // Leave the current session in place if the refresh check fails.
    }
  }

  const openTicket = (ticketId: string) => {
    setDetailTab('details')
    setDetailTicketId(ticketId)
  }

  const openNotificationsPage = () => {
    setActiveView('notifications')
    setNotificationsPreviewOpen(false)
  }

  const openSettingsDrawer = (section: ManagementDrawerSection) => {
    setSettingsDrawerSection(section)
  }

  const openManageOrganizationsPage = () => {
    setActiveView('manage-organizations')
    setSettingsDrawerTab('add')
    setManageOrganizationEditDraft(null)
  }

  const openManageUsersPage = () => {
    setActiveView('manage-users')
    setSettingsDrawerTab('add')
    setManageUsersEditDraft(null)
    setUserDirectoryError('')
    setUserDirectoryNotice('')
    setUserForm((current) => ({
      ...current,
      organizationId: currentUser.organizationId,
      teamId: getFirstTeamIdForOrganization(teams, currentUser.organizationId),
    }))
  }

  const openManageTeamsPage = () => {
    setActiveView('manage-teams')
    setSettingsDrawerTab('add')
    setManageTeamEditDraft(null)
  }

  const openManageCategoriesPage = () => {
    setActiveView('manage-categories')
    setSettingsDrawerTab('add')
    setManageCategoryEditDraft(null)
  }

  const closeSettingsDrawer = () => {
    setSettingsDrawerSection(null)
    setManageOrganizationEditDraft(null)
    setManageUsersEditDraft(null)
    setManageTeamEditDraft(null)
    setManageCategoryEditDraft(null)
  }

  const toggleNotificationReadState = (notificationId: string, shouldBeUnread: boolean) => {
    setReadNotificationIds((current) => {
      const next = new Set(current)

      if (shouldBeUnread) {
        next.delete(notificationId)
      } else {
        next.add(notificationId)
      }

      return Array.from(next)
    })
  }

  const submitTrendSeedAction = async (action: 'seed' | 'clear') => {
    const normalizedDays = Math.min(Math.max(Math.trunc(trendSeedDays) || 0, 1), 365)
    const selectedTrendSeedCategory = categories.find((category) => category.id === trendSeedCategoryId) ?? null

    if (normalizedDays !== trendSeedDays) {
      setTrendSeedDays(normalizedDays)
    }

    if (!normalizedDays) {
      setTrendSeedError('Enter a valid number of days between 1 and 365.')
      setTrendSeedNotice('')
      return
    }

    setTrendSeedPendingAction(action)
    setTrendSeedError('')
    setTrendSeedNotice('')

    try {
      const response = await fetch(apiUrl(`/api/admin/dashboard/trends/${action}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          days: normalizedDays,
          categoryId: selectedTrendSeedCategory?.id ?? null,
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        return
      }

      if (response.status === 403) {
        setTrendSeedError('Administrator access is required to manage seeded trend data.')
        return
      }

      if (response.status === 400) {
        setTrendSeedError('Select a valid category before running trend seeding.')
        return
      }

      if (!response.ok) {
        setTrendSeedError(
          action === 'seed'
            ? 'Trend history could not be seeded. Please try again.'
            : 'Seeded trend history could not be cleared. Please try again.',
        )
        return
      }

      const payload = (await response.json()) as {
        result?: {
          days?: number
          rowsAffected?: number
          fromDate?: string
          toDate?: string
          categoryId?: string | null
          categoryName?: string | null
        }
      }

      const resultDays = payload.result?.days ?? normalizedDays
      const resultRows = payload.result?.rowsAffected ?? 0
      const resultFromDate = payload.result?.fromDate
      const resultToDate = payload.result?.toDate
      const resultCategoryName = payload.result?.categoryName ?? selectedTrendSeedCategory?.name ?? null
      const nextTrends = await fetchDashboardTrends()

      if (Array.isArray(nextTrends) && nextTrends.length > 0) {
        setTrendPoints(nextTrends)
      }

      setTrendSeedNotice(
        action === 'seed'
          ? `Seeded ${resultRows} trend rows for ${resultDays} days${resultCategoryName ? ` using ${resultCategoryName}` : ''}${resultFromDate && resultToDate ? ` (${resultFromDate} to ${resultToDate})` : ''}.`
          : `Cleared seeded trend data for ${resultDays} days${resultCategoryName ? ` for ${resultCategoryName}` : ''}${resultFromDate && resultToDate ? ` (${resultFromDate} to ${resultToDate})` : ''}.`,
      )
    } catch {
      setTrendSeedError(
        action === 'seed'
          ? 'Trend history could not be seeded. Confirm the backend server is running.'
          : 'Seeded trend history could not be cleared. Confirm the backend server is running.',
      )
    } finally {
      setTrendSeedPendingAction(null)
    }
  }

  const submitTicketSeedAction = async () => {
    setTicketSeedPending(true)
    setTicketSeedError('')
    setTicketSeedNotice('')

    try {
      const response = await fetch(apiUrl('/api/admin/tickets/seed'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          assignToStaff: ticketSeedAssignEnabled,
          teamId: ticketSeedTeamId || undefined,
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        return
      }

      if (response.status === 403) {
        setTicketSeedError('Administrator access is required to seed tickets.')
        return
      }

      if (response.status === 400) {
        const payload = (await response.json()) as { error?: string }
        if (payload.error === 'organization_has_no_teams') {
          setTicketSeedError('This organization has no teams. Add a team before seeding tickets.')
        } else if (payload.error === 'team_not_found') {
          setTicketSeedError('The selected team does not exist in this organization.')
        } else if (payload.error === 'organization_has_no_categories') {
          setTicketSeedError('The selected team has no categories. Add a category before seeding tickets.')
        } else {
          setTicketSeedError('Ticket seeding could not be started. Check the organization configuration.')
        }
        return
      }

      if (!response.ok) {
        setTicketSeedError('Tickets could not be seeded. Please try again.')
        return
      }

      const payload = (await response.json()) as { tickets?: unknown[] }
      const createdCount = Array.isArray(payload.tickets) ? payload.tickets.length : 0
      setTicketSeedNotice(`Created ${createdCount} sample tickets.`)

      const nextTickets = await fetchTickets()
      if (Array.isArray(nextTickets)) {
        setTickets(nextTickets)
      }
      const nextSummary = await fetchDashboardSummary()
      if (nextSummary) {
        setDashboardSummary(nextSummary)
      }
      const nextTrends = await fetchDashboardTrends()
      if (Array.isArray(nextTrends) && nextTrends.length > 0) {
        setTrendPoints(nextTrends)
      }
    } catch {
      setTicketSeedError('Tickets could not be seeded. Confirm the backend server is running.')
    } finally {
      setTicketSeedPending(false)
    }
  }

  const archiveNotification = (notificationId: string) => {
    setArchivedNotificationIds((current) => {
      if (current.includes(notificationId)) {
        return current
      }

      return [...current, notificationId]
    })

    setReadNotificationIds((current) => {
      if (current.includes(notificationId)) {
        return current
      }

      return [...current, notificationId]
    })
  }

  const getQuickActionCopy = (action: QuickTicketAction) => {
    switch (action) {
      case 'assign-to-me':
        return {
          buttonLabel: 'Assign to me',
          confirmTitle: 'Assign Ticket',
          confirmMessage: 'Are you sure you want to assign this ticket to yourself?',
          successMessage: 'Ticket assigned to you.',
        }
      case 'mark-in-progress':
        return {
          buttonLabel: 'In Progress',
          confirmTitle: 'Mark In Progress',
          confirmMessage: 'Are you sure you want to mark this ticket as In Progress?',
          successMessage: 'Ticket marked In Progress.',
        }
      case 'mark-resolved':
        return {
          buttonLabel: 'Resolve',
          confirmTitle: 'Mark Resolved',
          confirmMessage: 'Are you sure you want to mark this ticket as Resolved?',
          successMessage: 'Ticket marked Resolved.',
        }
    }
  }

  const showQuickActionToast = (message: string, tone: QuickActionToastState['tone']) => {
    if (quickActionToastTimeoutRef.current) {
      clearTimeout(quickActionToastTimeoutRef.current)
    }

    setQuickActionToast({ message, tone })
    quickActionToastTimeoutRef.current = setTimeout(() => {
      setQuickActionToast(null)
      quickActionToastTimeoutRef.current = null
    }, 3200)
  }

  const requestQuickTicketAction = (ticket: TicketRecord, action: QuickTicketAction) => {
    setQuickActionConfirmation({
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      action,
    })
  }

  const confirmQuickTicketAction = async () => {
    if (!quickActionConfirmation) {
      return
    }

    const ticket = tickets.find((entry) => entry.id === quickActionConfirmation.ticketId)

    if (!ticket) {
      setQuickActionConfirmation(null)
      showQuickActionToast('Ticket could not be found. Refresh and try again.', 'error')
      return
    }

    const { action } = quickActionConfirmation
    setQuickActionConfirmation(null)
    const didSucceed = await applyQuickTicketAction(ticket, action)

    if (didSucceed) {
      showQuickActionToast(getQuickActionCopy(action).successMessage, 'success')
    }
  }

  const closePanel = () => {
    if (detailPinned) {
      setDetailPinned(false)
    }
    setDetailTicketId(null)
  }

  const startDetailResize = (clientX: number) => {
    if (isMobileViewport) {
      return
    }

    detailResizeStateRef.current = {
      startX: clientX,
      startWidth: detailWidth,
    }
    setDetailResizeActive(true)
  }

  const toggleSettingsAccordion = (section: SettingsAccordionSection) => {
    setSettingsAccordions((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }

  const reorderSettingsAccordions = (
    draggedSection: SettingsAccordionSection,
    targetSection: SettingsAccordionSection,
  ) => {
    if (draggedSection === targetSection) {
      return
    }

    setSettingsAccordionOrder((current) => {
      const next = [...current]
      const draggedIndex = next.indexOf(draggedSection)
      const targetIndex = next.indexOf(targetSection)

      if (draggedIndex === -1 || targetIndex === -1) {
        return current
      }

      next.splice(draggedIndex, 1)
      next.splice(targetIndex, 0, draggedSection)
      return next
    })
  }

  const startSettingsAccordionDrag = (section: SettingsAccordionSection) => {
    setDraggedSettingsSection(section)
    setSettingsDragOverSection(section)
  }

  const endSettingsAccordionDrag = () => {
    setDraggedSettingsSection(null)
    setSettingsDragOverSection(null)
  }

  // Move a settings section into (or within) a server-managed settings tab, persisting the
  // new ordering via PUT /api/settings/tabs/:tabId/sections. When `beforeSection` is omitted,
  // the section is appended to the end of the target tab.
  const moveSettingsSection = async (
    section: SettingsAccordionSection,
    targetTabId: string,
    beforeSection?: SettingsAccordionSection,
  ) => {
    const sourceTab = settingsTabs.find((tab) => tab.sections.some((s) => s.section_key === section))
    const targetTab = settingsTabs.find((tab) => tab.id === targetTabId)
    if (!sourceTab || !targetTab) {
      return
    }

    try {
      if (sourceTab.id === targetTab.id) {
        const currentKeys = sourceTab.sections.map((s) => s.section_key)
        const withoutDragged = currentKeys.filter((k) => k !== section)
        const insertIndex = beforeSection ? withoutDragged.indexOf(beforeSection) : withoutDragged.length
        const nextKeys = [...withoutDragged]
        nextKeys.splice(insertIndex === -1 ? nextKeys.length : insertIndex, 0, section)

        if (nextKeys.join('|') === currentKeys.join('|')) {
          return
        }

        const res = await fetch(apiUrl(`/api/settings/tabs/${targetTab.id}/sections`), {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionKeys: nextKeys }),
        })
        if (res.ok) {
          const data = await res.json()
          setSettingsTabs(data.tabs ?? [])
        }
        return
      }

      const sourceKeys = sourceTab.sections.map((s) => s.section_key).filter((k) => k !== section)
      const targetKeys = targetTab.sections.map((s) => s.section_key)
      const insertIndex = beforeSection ? targetKeys.indexOf(beforeSection) : targetKeys.length
      targetKeys.splice(insertIndex === -1 ? targetKeys.length : insertIndex, 0, section)

      await fetch(apiUrl(`/api/settings/tabs/${sourceTab.id}/sections`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKeys: sourceKeys }),
      })
      const res = await fetch(apiUrl(`/api/settings/tabs/${targetTab.id}/sections`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKeys: targetKeys }),
      })
      if (res.ok) {
        const data = await res.json()
        setSettingsTabs(data.tabs ?? [])
      }
    } catch {
      // non-fatal; UI simply keeps the previous ordering
    }
  }

  const signOut = async () => {
    try {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Clear local session even if the backend is unavailable.
    }
    setAuthSession(null)
    setAuthError('')
    setLocalAuthError('')
    setLocalAuthNotice('')
    setDetailTicketId(null)
    setActiveView('dashboard')
  }

  const handleLocalLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const email = localLoginEmail.trim().toLowerCase()

    if (!email || !email.includes('@')) {
      setLocalAuthError('Select a user to sign in.')
      return
    }

    setLocalLoginPending(true)
    setLocalAuthError('')
    setLocalAuthNotice('')

    try {
      const response = await fetch(apiUrl('/api/auth/test-login'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, rememberMe: rememberMeNextLogin }),
      })

      if (response.status === 404) {
        setLocalAuthError('The selected user is no longer available. Choose another user and try again.')
        return
      }

      if (!response.ok) {
        setLocalAuthError('Test sign-in failed. Please try again.')
        return
      }

      const payload = (await response.json()) as {
        authenticated?: boolean
        user?: SessionApiUser
      }

      if (!payload.authenticated || !payload.user) {
        setLocalAuthError('Email sign-in could not create a persistent session.')
        return
      }

      setAuthSession(mapSessionApiUser(payload.user))
      setAuthError('')
      setLocalAuthError('')
      setLocalAuthNotice('')
      setBackendAvailable(true)

      if (rememberMeNextLogin) {
        setCookieValue(REMEMBER_LOGIN_EMAIL_COOKIE, email, 30)
      } else {
        clearCookieValue(REMEMBER_LOGIN_EMAIL_COOKIE)
      }
    } catch {
      setBackendAvailable(false)
      setLocalAuthError('Test sign-in failed because the backend server is unavailable. Start it with npm run dev or npm run start:server, then try again.')
    } finally {
      setLocalLoginPending(false)
    }
  }

  const addWatcher = async (userId: string) => {
    if (!selectedTicket) return
    try {
      const response = await fetch(apiUrl(`/api/tickets/${selectedTicket.id}/watchers`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (!response.ok) return
      const payload = (await response.json()) as { watchers?: TicketWatcher[] }
      if (Array.isArray(payload.watchers)) {
        setTicketWatchers(payload.watchers)
        if (userId === currentUser.id) {
          setWatchedTicketIds((current) => new Set([...current, selectedTicket.id]))
        }
      }
    } catch {
      // Non-critical
    }
  }

  const removeWatcher = async (userId: string) => {
    if (!selectedTicket) return
    try {
      const response = await fetch(apiUrl(`/api/tickets/${selectedTicket.id}/watchers/${userId}`), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) return
      const payload = (await response.json()) as { watchers?: TicketWatcher[] }
      if (Array.isArray(payload.watchers)) {
        setTicketWatchers(payload.watchers)
        if (userId === currentUser.id) {
          setWatchedTicketIds((current) => {
            const next = new Set(current)
            next.delete(selectedTicket.id)
            return next
          })
        }
      }
    } catch {
      // Non-critical
    }
  }

  const saveTicketChanges = async () => {
    if (!selectedTicket || !detailDraft) {
      return
    }

    const isReassigningTeam = detailDraft.teamId !== selectedTicket.teamId

    setDetailSavePending(true)
    setDetailSaveError('')

    try {
      const response = await fetch(apiUrl(`/api/tickets/${selectedTicket.id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          teamId: detailDraft.teamId,
          title: detailDraft.title,
          description: detailDraft.description,
          status: detailDraft.status,
          priority: detailDraft.priority,
          categoryId: detailDraft.categoryId,
          assignedToId: detailDraft.assignedToId || null,
          requestorName: detailDraft.requestorName,
          requestorEmail: detailDraft.requestorEmail,
          location: detailDraft.location,
          customFields: Object.entries(detailCustomFieldValues).map(([fieldId, value]) => ({ fieldId, value })),
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setDetailSaveError('Your session expired. Please sign in again.')
        return
      }

      if (!response.ok) {
        if (response.status === 403) {
          const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null
          if (errorPayload?.error === 'cross_org_team_reassign_forbidden') {
            setDetailSaveError('You are not allowed to reassign this ticket to that team.')
            return
          }
        }
        setDetailSaveError('Ticket changes could not be saved to SQL Server.')
        return
      }

      const payload = (await response.json()) as {
        ticket?: TicketRecord
      }

      if (!payload.ticket) {
        setDetailSaveError('Ticket changes could not be saved to SQL Server.')
        return
      }

      setTickets((current) =>
        current.map((ticket) =>
          ticket.id === payload.ticket?.id ? payload.ticket : ticket,
        ),
      )
      if (isReassigningTeam) {
        const newTeamName = getTeamById(payload.ticket.teamId)?.name ?? 'the selected team'
        showQuickActionToast(`Ticket successfully reassigned to ${newTeamName}.`, 'success')
      }
      // Sync editable custom field values from freshly-saved ticket
      const refreshed = payload.ticket
      if (refreshed) {
        const updatedVals: Record<string, string> = {}
        for (const cf of refreshed.customFields ?? []) updatedVals[cf.fieldId] = cf.value
        setDetailCustomFieldValues((prev) => ({ ...prev, ...updatedVals }))
      }
    } catch {
      setDetailSaveError('Ticket changes could not be saved. Confirm the backend server is running.')
    } finally {
      setDetailSavePending(false)
    }
  }

  const applyQuickTicketAction = async (
    ticket: TicketRecord,
    action: QuickTicketAction,
  ) => {
    if (quickActionPendingTicketId) {
      return false
    }

    let nextAssignedToId = ticket.assignedToId
    let nextStatus = ticket.status

    if (action === 'assign-to-me') {
      nextAssignedToId = currentUser.id
    }

    if (action === 'mark-in-progress') {
      nextStatus = 'In Progress'
      nextAssignedToId = nextAssignedToId ?? currentUser.id
    }

    if (action === 'mark-resolved') {
      nextStatus = 'Resolved'
      nextAssignedToId = nextAssignedToId ?? currentUser.id
    }

    if (nextAssignedToId === ticket.assignedToId && nextStatus === ticket.status) {
      return false
    }

    setQuickActionPendingTicketId(ticket.id)
    setQuickActionError('')

    try {
      // Optimistic update: immediately reflect the change in local state so the
      // ticket moves out of (or into) the correct queue without waiting for the
      // full server round-trip.
      setTickets((current) =>
        current.map((item) =>
          item.id === ticket.id
            ? { ...item, assignedToId: nextAssignedToId, status: nextStatus }
            : item,
        ),
      )

      const response = await fetch(apiUrl(`/api/tickets/${ticket.id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: ticket.title,
          description: ticket.description,
          status: nextStatus,
          priority: ticket.priority,
          categoryId: ticket.categoryId,
          assignedToId: nextAssignedToId,
          requestorName: ticket.requestorName,
          requestorEmail: ticket.requestorEmail,
          location: ticket.location,
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setQuickActionError('Your session expired. Please sign in again.')
        // Revert the optimistic update on auth failure
        setTickets((current) =>
          current.map((item) => (item.id === ticket.id ? ticket : item)),
        )
        return false
      }

      if (!response.ok) {
        setQuickActionError('Quick action failed. Please try again.')
        // Revert the optimistic update on server error
        setTickets((current) =>
          current.map((item) => (item.id === ticket.id ? ticket : item)),
        )
        return false
      }

      const payload = (await response.json()) as {
        ticket?: TicketRecord
      }

      if (!payload.ticket) {
        setQuickActionError('Quick action failed. Please try again.')
        // Revert the optimistic update if the server response is unexpected
        setTickets((current) =>
          current.map((item) => (item.id === ticket.id ? ticket : item)),
        )
        return false
      }

      // Reconcile with the authoritative server response
      setTickets((current) =>
        current.map((item) => (item.id === payload.ticket!.id ? payload.ticket! : item)),
      )
      return true
    } catch {
      setQuickActionError('Quick action failed because the backend server is unavailable.')
      // Revert the optimistic update on network error
      setTickets((current) =>
        current.map((item) => (item.id === ticket.id ? ticket : item)),
      )
      return false
    } finally {
      setQuickActionPendingTicketId(null)
    }
  }

  const addTicketComment = async () => {
    if (!selectedTicket) {
      return
    }

    const message = commentDraft.trim()
    if (!message) {
      return
    }

    setCommentPending(true)
    setCommentError('')

    try {
      const response = await fetch(apiUrl(`/api/tickets/${selectedTicket.id}/comments`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setCommentError('Your session expired. Please sign in again.')
        return
      }

      if (!response.ok) {
        setCommentError('Comment could not be saved to SQL Server.')
        return
      }

      const payload = (await response.json()) as {
        comment?: TicketActivityApiRecord
      }

      if (!payload.comment) {
        setCommentError('Comment could not be saved to SQL Server.')
        return
      }

      setTickets((current) => mergePersistedActivity(current, [payload.comment as TicketActivityApiRecord]))
      setCommentDraft('')
      setDetailTab('activity')
    } catch {
      setCommentError('Comment could not be saved. Confirm the backend server is running.')
    } finally {
      setCommentPending(false)
    }
  }

  const uploadAttachment = async () => {
    if (!selectedTicket) {
      return
    }

    if (!attachmentFile) {
      setAttachmentsError('Select a file before uploading.')
      return
    }

    setAttachmentUploadPending(true)
    setAttachmentsError('')

    try {
      const formData = new FormData()
      formData.append('file', attachmentFile)

      const response = await fetch(apiUrl(`/api/tickets/${selectedTicket.id}/attachments`), {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })

      if (response.status === 401) {
        setAuthSession(null)
        setAttachmentsError('Your session expired. Please sign in again.')
        return
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setAttachmentsError(
          payload?.error === 'attachment_too_large'
            ? 'Attachments must be 10 MB or smaller.'
            : 'Attachment upload failed.',
        )
        return
      }

      const payload = (await response.json()) as {
        attachment?: TicketAttachment
      }

      if (payload.attachment) {
        setAttachments((current) => [payload.attachment as TicketAttachment, ...current])
      }
      setAttachmentFile(null)
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = ''
      }
      await refreshTicket(selectedTicket.id)
    } catch {
      setAttachmentsError('Attachment upload failed. Confirm the backend server is running.')
    } finally {
      setAttachmentUploadPending(false)
    }
  }

  const downloadAttachment = async (attachment: TicketAttachment) => {
    if (!selectedTicket) {
      return
    }

    try {
      const response = await fetch(
        apiUrl(`/api/tickets/${selectedTicket.id}/attachments/${attachment.id}`),
        {
          credentials: 'include',
        },
      )

      if (response.status === 401) {
        setAuthSession(null)
        setAttachmentsError('Your session expired. Please sign in again.')
        return
      }

      if (!response.ok) {
        setAttachmentsError('Attachment download failed.')
        return
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = attachment.fileName
      link.click()
      window.URL.revokeObjectURL(url)
    } catch {
      setAttachmentsError('Attachment download failed. Confirm the backend server is running.')
    }
  }

  const previewAttachment = attachments.find((attachment) => attachment.id === previewAttachmentId) ?? null
  const previewAttachmentUrl =
    selectedTicket && previewAttachment
      ? apiUrl(`/api/tickets/${selectedTicket.id}/attachments/${previewAttachment.id}?disposition=inline`)
      : ''

  const openAttachmentPreview = (attachment: TicketAttachment) => {
    if (!attachment.contentType.toLowerCase().includes('pdf')) {
      return
    }

    setPreviewAttachmentId(attachment.id)
  }

  const closeAttachmentPreview = () => {
    setPreviewAttachmentId(null)
  }

  const removeAttachment = async (attachmentId: string) => {
    if (!selectedTicket) {
      return
    }

    setAttachmentDeletePendingId(attachmentId)
    setAttachmentsError('')

    try {
      const response = await fetch(
        apiUrl(`/api/tickets/${selectedTicket.id}/attachments/${attachmentId}`),
        {
          method: 'DELETE',
          credentials: 'include',
        },
      )

      if (response.status === 401) {
        setAuthSession(null)
        setAttachmentsError('Your session expired. Please sign in again.')
        return
      }

      if (!response.ok) {
        setAttachmentsError('Attachment delete failed.')
        return
      }

      if (previewAttachmentId === attachmentId) {
        closeAttachmentPreview()
      }
      setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId))
      await refreshTicket(selectedTicket.id)
    } catch {
      setAttachmentsError('Attachment delete failed. Confirm the backend server is running.')
    } finally {
      setAttachmentDeletePendingId(null)
    }
  }

  const updateRapidIdentityVisibility = async (isEnabled: boolean) => {
    setAuthSettingsPending(true)
    setAuthSettingsError('')

    try {
      const response = await fetch(apiUrl('/api/settings/auth'), {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rapidIdentityEnabled: isEnabled }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setAuthSettingsError('Your session expired. Please sign in again.')
        return
      }

      if (response.status === 403) {
        setAuthSettingsError('Only admins can update authentication settings.')
        return
      }

      if (!response.ok) {
        setAuthSettingsError('Authentication setting could not be updated.')
        return
      }

      const payload = (await response.json()) as {
        rapidIdentityEnabled?: boolean
      }

      if (typeof payload.rapidIdentityEnabled === 'boolean') {
        setRapidIdentityEnabled(payload.rapidIdentityEnabled)
      }
    } catch {
      setAuthSettingsError('Authentication setting could not be updated. Confirm the backend server is running.')
    } finally {
      setAuthSettingsPending(false)
    }
  }

  const handleLoginModeToggle = async (nextMode: LoginMode) => {
    if (loginModeOverride) return
    const prev = loginMode ?? 'select'
    setLoginMode(nextMode)
    setLoginModeSaving(true)
    setLoginModeError('')
    setLoginModeSaved(false)
    try {
      const response = await fetch(apiUrl('/api/settings/login-mode'), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginMode: nextMode }),
      })
      if (response.status === 401) {
        setAuthSession(null)
        setLoginMode(prev)
        setLoginModeError('Your session expired. Please sign in again.')
        return
      }
      if (response.status === 403) {
        setLoginMode(prev)
        setLoginModeError('Only admins can update login mode.')
        return
      }
      if (!response.ok) {
        setLoginMode(prev)
        setLoginModeError('Login mode could not be updated.')
        return
      }
      const payload = (await response.json()) as {
        loginMode?: string
        loginModeOverride?: string | null
        maintenanceMessage?: string
      }
      setLoginMode(normalizeClientLoginMode(payload.loginMode))
      const overrideRaw = payload.loginModeOverride
      if (overrideRaw === 'select' || overrideRaw === 'password' || overrideRaw === 'maintenance') {
        setLoginModeOverride(overrideRaw)
      } else {
        setLoginModeOverride(null)
      }
      if (typeof payload.maintenanceMessage === 'string' && payload.maintenanceMessage.trim()) {
        setMaintenanceMessage(payload.maintenanceMessage)
        setMaintenanceMessageDraft(payload.maintenanceMessage)
      }
      setLoginModeSaved(true)
    } catch {
      setLoginMode(prev)
      setLoginModeError('Login mode could not be updated. Confirm the backend server is running.')
    } finally {
      setLoginModeSaving(false)
    }
  }

  const saveMaintenanceMessage = async () => {
    const nextMessage = maintenanceMessageDraft
    const prev = maintenanceMessage
    setMaintenanceMessage(nextMessage)
    setMaintenanceMessageSaving(true)
    setMaintenanceMessageError('')
    setMaintenanceMessageSaved(false)
    try {
      const response = await fetch(apiUrl('/api/settings/login-mode'), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maintenanceMessage: nextMessage }),
      })
      if (response.status === 401) {
        setAuthSession(null)
        setMaintenanceMessage(prev)
        setMaintenanceMessageDraft(prev)
        setMaintenanceMessageError('Your session expired. Please sign in again.')
        return
      }
      if (response.status === 403) {
        setMaintenanceMessage(prev)
        setMaintenanceMessageDraft(prev)
        setMaintenanceMessageError('Only admins can update the maintenance message.')
        return
      }
      if (!response.ok) {
        setMaintenanceMessage(prev)
        setMaintenanceMessageDraft(prev)
        setMaintenanceMessageError('Maintenance message could not be saved.')
        return
      }
      const payload = (await response.json()) as { maintenanceMessage?: string }
      const saved =
        typeof payload.maintenanceMessage === 'string' && payload.maintenanceMessage.trim()
          ? payload.maintenanceMessage
          : nextMessage
      setMaintenanceMessage(saved)
      setMaintenanceMessageDraft(saved)
      setMaintenanceMessageSaved(true)
    } catch {
      setMaintenanceMessage(prev)
      setMaintenanceMessageDraft(prev)
      setMaintenanceMessageError('Maintenance message could not be saved. Confirm the backend server is running.')
    } finally {
      setMaintenanceMessageSaving(false)
    }
  }

  const handlePasswordLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = passwordLoginEmail.trim().toLowerCase()
    const password = passwordLoginPassword
    if (!email || !email.includes('@') || !password) {
      setPasswordLoginError('Enter both email and password.')
      return
    }
    setPasswordLoginPending(true)
    setPasswordLoginError('')
    setLocalAuthError('')
    setAuthError('')
    try {
      const response = await fetch(apiUrl('/api/auth/local/login'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, rememberMe: passwordRememberMe }),
      })
      if (response.status === 401 || response.status === 400) {
        setPasswordLoginError('Invalid email or password.')
        return
      }
      if (!response.ok) {
        setPasswordLoginError('Sign-in failed. Please try again.')
        return
      }
      const payload = (await response.json()) as {
        authenticated?: boolean
        user?: SessionApiUser
      }
      if (!payload.authenticated || !payload.user) {
        setPasswordLoginError('Sign-in could not create a persistent session.')
        return
      }
      setAuthSession(mapSessionApiUser(payload.user))
      setPasswordLoginPassword('')
      setPasswordLoginError('')
      setBackendAvailable(true)
      if (passwordRememberMe) {
        setCookieValue(REMEMBER_LOGIN_EMAIL_COOKIE, email, 30)
      } else {
        clearCookieValue(REMEMBER_LOGIN_EMAIL_COOKIE)
      }
    } catch {
      setBackendAvailable(false)
      setPasswordLoginError(
        'Sign-in failed because the backend server is unavailable. Start it with npm run dev or npm run start:server, then try again.',
      )
    } finally {
      setPasswordLoginPending(false)
    }
  }

  const updateEmailNotificationsEnabled = async (isEnabled: boolean) => {
    setEmailSettingsPending(true)
    setEmailSettingsError('')
    try {
      const response = await fetch(apiUrl('/api/settings/email'), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: isEnabled }),
      })
      if (response.status === 401) {
        setAuthSession(null)
        setEmailSettingsError('Your session expired. Please sign in again.')
        return
      }
      if (response.status === 403) {
        setEmailSettingsError('Only admins can update email settings.')
        return
      }
      if (!response.ok) {
        setEmailSettingsError('Email setting could not be updated.')
        return
      }
      const payload = (await response.json()) as { enabled?: boolean }
      if (typeof payload.enabled === 'boolean') setEmailNotificationsEnabled(payload.enabled)
    } catch {
      setEmailSettingsError('Email setting could not be updated. Confirm the backend server is running.')
    } finally {
      setEmailSettingsPending(false)
    }
  }

  const savePowerBiSettings = async (nextUrl: string | null) => {
    if (currentUser.role !== 'Admin' && currentUser.role !== 'Super Admin') {
      setPowerBiSettingsError('Only admins can update Power BI settings.')
      return
    }

    const trimmedUrl = nextUrl?.trim() ?? ''

    if (trimmedUrl && !isValidHttpUrl(trimmedUrl)) {
      setPowerBiSettingsError('Enter a valid http or https URL for the Power BI report.')
      setPowerBiSettingsNotice('')
      return
    }

    setPowerBiSettingsPending(true)
    setPowerBiSettingsError('')
    setPowerBiSettingsNotice('')

    try {
      const response = await fetch(apiUrl('/api/settings/power-bi'), {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reportUrl: trimmedUrl || null }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setPowerBiSettingsError('Your session expired. Please sign in again.')
        return
      }

      if (response.status === 403) {
        setPowerBiSettingsError('Only admins can update Power BI settings.')
        return
      }

      if (!response.ok) {
        setPowerBiSettingsError('Power BI settings could not be saved.')
        return
      }

      const payload = (await response.json()) as { reportUrl?: string | null }
      const savedUrl = typeof payload.reportUrl === 'string' && payload.reportUrl.trim()
        ? payload.reportUrl.trim()
        : null

      setPowerBiReportUrl(savedUrl)
      setPowerBiReportDraft(savedUrl ?? '')
      setPowerBiSettingsNotice(savedUrl ? 'Power BI report link saved.' : 'Power BI report link cleared.')
    } catch {
      setPowerBiSettingsError('Power BI settings could not be saved. Confirm the backend server is running.')
    } finally {
      setPowerBiSettingsPending(false)
    }
  }

  const saveAboutSettings = async (html: string) => {
    if (currentUser.role !== 'Admin' && currentUser.role !== 'Super Admin') {
      setAboutPageError('Administrator access is required to update the About page.')
      return
    }

    setAboutPagePending(true)
    setAboutPageError('')
    setAboutPageNotice('')

    try {
      const response = await fetch(apiUrl('/api/settings/about'), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setAboutPageError('Your session expired. Please sign in again.')
        return
      }

      if (response.status === 403) {
        setAboutPageError('Administrator access is required to update the About page.')
        return
      }

      if (!response.ok) {
        setAboutPageError('About page could not be saved.')
        return
      }

      const payload = (await response.json()) as { html?: string }
      const saved = payload.html ?? ''
      setAboutPageHtml(saved)
      setAboutPageDraft(saved)
      setAboutPageNotice('About page saved.')
    } catch {
      setAboutPageError('About page could not be saved. Confirm the backend server is running.')
    } finally {
      setAboutPagePending(false)
    }
  }

  const runEmailTestResend = async () => {
    setEmailTestResendPending(true)
    setEmailTestResendResult(null)
    try {
      const response = await fetch(apiUrl('/api/settings/email/test-resend'), {
        method: 'POST',
        credentials: 'include',
      })
      const payload = (await response.json()) as { ok?: boolean; messageId?: string; sentTo?: string; error?: string }
      if (payload.ok) {
        setEmailTestResendResult({ ok: true, message: `Sent! Message ID: ${payload.messageId ?? '?'} ? ${payload.sentTo ?? ''}` })
      } else {
        setEmailTestResendResult({ ok: false, message: payload.error ?? 'Test email failed.' })
      }
    } catch (err) {
      setEmailTestResendResult({ ok: false, message: err instanceof Error ? err.message : 'Request failed.' })
    } finally {
      setEmailTestResendPending(false)
    }
  }

  const runEmailTestImap = async () => {
    setEmailTestImapPending(true)
    setEmailTestImapResult(null)
    try {
      const response = await fetch(apiUrl('/api/settings/email/test-imap'), {
        method: 'POST',
        credentials: 'include',
      })
      const payload = (await response.json()) as { ok?: boolean; messages?: number; unseen?: number; account?: string; error?: string }
      if (payload.ok) {
        setEmailTestImapResult({ ok: true, message: `Connected to ${payload.account ?? 'Gmail'}: ${payload.messages ?? 0} messages, ${payload.unseen ?? 0} unread.` })
      } else {
        setEmailTestImapResult({ ok: false, message: payload.error ?? 'IMAP connection failed.' })
      }
    } catch (err) {
      setEmailTestImapResult({ ok: false, message: err instanceof Error ? err.message : 'Request failed.' })
    } finally {
      setEmailTestImapPending(false)
    }
  }

  const updateAnonymousPageConfig = (pageId: string, updater: (current: AnonymousPageConfig) => AnonymousPageConfig) => {
    setAnonymousPageConfigs((current) => current.map((page) => (page.id === pageId ? updater(page) : page)))
    setAnonymousPageSettingsError('')
    setAnonymousPageSettingsNotice('')
  }

  const saveAnonymousPageSettings = async () => {
    if (currentUser.role !== 'Admin' && currentUser.role !== 'Super Admin') {
      setAnonymousPageSettingsError('Only admins can update anonymous page settings.')
      return
    }

    setAnonymousPageSettingsPending(true)
    setAnonymousPageSettingsError('')
    setAnonymousPageSettingsNotice('')

    try {
      const response = await fetch(apiUrl('/api/settings/anonymous-pages'), {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pages: anonymousPageConfigs.map((page) => ({
            ...page,
            name: page.name.trim(),
            pagePath: normalizeAnonymousPagePath(page.pagePath),
          })),
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setAnonymousPageSettingsError('Your session expired. Please sign in again.')
        return
      }

      if (response.status === 403) {
        setAnonymousPageSettingsError('Only admins can update anonymous page settings.')
        return
      }

      if (!response.ok) {
        setAnonymousPageSettingsError('Anonymous page settings could not be saved.')
        return
      }

      const payload = (await response.json()) as { pages?: AnonymousPageConfig[] }
      setAnonymousPageConfigs(Array.isArray(payload.pages) ? payload.pages : [])
      setAnonymousPageSettingsNotice('Anonymous page settings saved.')
    } catch {
      setAnonymousPageSettingsError('Anonymous page settings could not be saved. Confirm the backend server is running.')
    } finally {
      setAnonymousPageSettingsPending(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Feedback form helpers
  // ---------------------------------------------------------------------------

  const loadFeedbackSettings = async (orgId: string) => {
    try {
      const [globalRes, formRes, responsesRes] = await Promise.all([
        fetch(apiUrl('/api/settings/feedback'), { credentials: 'include' }),
        fetch(apiUrl(`/api/feedback/form/${orgId}`), { credentials: 'include' }),
        fetch(apiUrl(`/api/feedback/responses/${orgId}?includeTest=true`), { credentials: 'include' }),
      ])
      if (globalRes.ok) {
        const d = (await globalRes.json()) as { enabled?: boolean }
        if (typeof d.enabled === 'boolean') setFeedbackFormGlobalEnabled(d.enabled)
      }
      if (formRes.ok) {
        const d = (await formRes.json()) as { form?: FeedbackForm }
        if (d.form) setFeedbackForm(d.form)
      }
      if (responsesRes.ok) {
        const d = (await responsesRes.json()) as { responses?: FeedbackResponseSummary[] }
        if (Array.isArray(d.responses)) setFeedbackResponses(d.responses)
      }
    } catch {
      // non-fatal
    }
  }

  const updateFeedbackGlobalEnabled = async (isEnabled: boolean) => {
    setFeedbackFormGlobalPending(true)
    try {
      const res = await fetch(apiUrl('/api/settings/feedback'), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: isEnabled }),
      })
      if (res.ok) {
        const d = (await res.json()) as { enabled?: boolean }
        if (typeof d.enabled === 'boolean') setFeedbackFormGlobalEnabled(d.enabled)
      }
    } catch {
      // non-fatal
    } finally {
      setFeedbackFormGlobalPending(false)
    }
  }

  const updateFeedbackFormEnabled = async (orgId: string, isEnabled: boolean) => {
    try {
      const res = await fetch(apiUrl(`/api/feedback/form/${orgId}/enabled`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled }),
      })
      if (res.ok) {
        const d = (await res.json()) as { form?: FeedbackForm }
        if (d.form) setFeedbackForm(d.form)
      }
    } catch {
      // non-fatal
    }
  }

  const saveFeedbackFormFields = async (orgId: string, fields: FeedbackFormField[]) => {
    setFeedbackFormPending(true)
    setFeedbackFormError('')
    setFeedbackFormNotice('')
    try {
      const res = await fetch(apiUrl(`/api/feedback/form/${orgId}`), {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      })
      if (!res.ok) {
        setFeedbackFormError('Could not save form fields.')
        return
      }
      const d = (await res.json()) as { form?: FeedbackForm }
      if (d.form) setFeedbackForm(d.form)
      setFeedbackFormNotice('Form saved.')
      setTimeout(() => setFeedbackFormNotice(''), 3000)
    } catch {
      setFeedbackFormError('Could not save form fields.')
    } finally {
      setFeedbackFormPending(false)
    }
  }

  const openEditFeedbackField = (field: FeedbackFormField) => {
    setFeedbackEditField({ ...field })
    setFeedbackEditFieldOptionsText((field.options ?? []).join('\n'))
  }

  const saveEditedFeedbackField = async () => {
    if (!feedbackForm || !feedbackEditField?.id || !feedbackEditField.label?.trim()) return
    const choiceTypes: FeedbackFieldType[] = ['single_choice', 'multi_choice']
    const updated = feedbackForm.fields.map((f) =>
      f.id === feedbackEditField.id
        ? {
            ...f,
            label: feedbackEditField.label!.trim(),
            isRequired: feedbackEditField.isRequired ?? f.isRequired,
            options: choiceTypes.includes(f.fieldType)
              ? feedbackEditFieldOptionsText.split('\n').map((o) => o.trim()).filter(Boolean)
              : f.options,
          }
        : f,
    )
    await saveFeedbackFormFields(feedbackForm.organizationId, updated)
    setFeedbackEditField(null)
    setFeedbackEditFieldOptionsText('')
  }

  const addFeedbackField = async () => {    if (!feedbackForm || !feedbackAddFieldLabel.trim()) return
    const newField: FeedbackFormField = {
      id: '',
      formId: feedbackForm.id,
      fieldType: feedbackAddFieldType,
      label: feedbackAddFieldLabel.trim(),
      isRequired: feedbackAddFieldRequired,
      sortOrder: feedbackForm.fields.length,
      options:
        feedbackAddFieldType === 'single_choice' || feedbackAddFieldType === 'multi_choice'
          ? feedbackAddFieldOptions.split('\n').map((o) => o.trim()).filter(Boolean)
          : [],
    }
    const updated = [...feedbackForm.fields, newField]
    await saveFeedbackFormFields(feedbackForm.organizationId, updated)
    setFeedbackAddFieldLabel('')
    setFeedbackAddFieldOptions('')
    setFeedbackAddFieldRequired(false)
    setFeedbackAddFieldOpen(false)
  }

  const removeFeedbackField = async (fieldId: string) => {
    if (!feedbackForm) return
    const updated = feedbackForm.fields.filter((f) => f.id !== fieldId)
    await saveFeedbackFormFields(feedbackForm.organizationId, updated)
  }

  const moveFeedbackField = async (fromIdx: number, toIdx: number) => {
    if (!feedbackForm) return
    const next = [...feedbackForm.fields]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    await saveFeedbackFormFields(
      feedbackForm.organizationId,
      next.map((f, i) => ({ ...f, sortOrder: i })),
    )
  }

  const generateFeedbackTestLink = async (orgId: string) => {
    setFeedbackTestLinkPending(true)
    setFeedbackTestLink('')
    try {
      const res = await fetch(apiUrl(`/api/feedback/form/${orgId}/test-token`), {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        const d = (await res.json()) as { url?: string }
        if (d.url) setFeedbackTestLink(d.url)
      }
    } catch {
      // non-fatal
    } finally {
      setFeedbackTestLinkPending(false)
    }
  }

  const refreshFeedbackResponses = async (orgId: string) => {
    setFeedbackResponsesLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/feedback/responses/${orgId}?includeTest=true`), { credentials: 'include' })
      if (res.ok) {
        const d = (await res.json()) as { responses?: FeedbackResponseSummary[] }
        if (Array.isArray(d.responses)) setFeedbackResponses(d.responses)
      }
    } catch {
      // non-fatal
    } finally {
      setFeedbackResponsesLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Webhook helpers
  // ---------------------------------------------------------------------------

  const ALL_WEBHOOK_EVENTS: WebhookEvent[] = [
    'ticket.created',
    'ticket.updated',
    'ticket.assigned',
    'ticket.resolved',
    'ticket.closed',
    'feedback.submitted',
  ]

  const refreshWebhooks = async () => {
    try {
      const res = await fetch(apiUrl('/api/settings/webhooks'), { credentials: 'include' })
      if (res.ok) {
        const d = (await res.json()) as { webhooks?: WebhookConfig[] }
        if (Array.isArray(d.webhooks)) setWebhooks(d.webhooks)
      }
    } catch {
      // non-fatal
    }
  }

  const saveWebhook = async () => {
    const url = webhookAddUrl.trim()
    if (!url) return
    setWebhooksPending(true)
    setWebhooksError('')
    setWebhooksNotice('')
    try {
      const res = await fetch(apiUrl('/api/settings/webhooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url, secret: webhookAddSecret.trim(), events: webhookAddEvents }),
      })
      if (!res.ok) {
        setWebhooksError('Could not save webhook. Check the URL and events.')
        return
      }
      const d = (await res.json()) as { webhook?: WebhookConfig }
      if (d.webhook) setWebhooks((prev) => [...prev, d.webhook!])
      setWebhookAddOpen(false)
      setWebhookAddUrl('')
      setWebhookAddSecret('')
      setWebhookAddEvents(['ticket.created', 'ticket.updated', 'ticket.assigned', 'ticket.resolved', 'ticket.closed'])
      setWebhooksNotice('Webhook saved.')
    } catch {
      setWebhooksError('Request failed. Confirm the server is running.')
    } finally {
      setWebhooksPending(false)
    }
  }

  const saveWebhookEdit = async (id: string) => {
    if (!webhookEditUrl.trim()) return
    setWebhooksPending(true)
    setWebhooksError('')
    setWebhooksNotice('')
    try {
      const res = await fetch(apiUrl(`/api/settings/webhooks/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url: webhookEditUrl.trim(), secret: webhookEditSecret, events: webhookEditEvents }),
      })
      if (!res.ok) {
        setWebhooksError('Could not update webhook.')
        return
      }
      const d = (await res.json()) as { webhook?: WebhookConfig }
      if (d.webhook) {
        setWebhooks((prev) => prev.map((w) => (w.id === id ? d.webhook! : w)))
      }
      setWebhookEditId(null)
      setWebhooksNotice('Webhook updated.')
    } catch {
      setWebhooksError('Request failed.')
    } finally {
      setWebhooksPending(false)
    }
  }

  const toggleWebhookEnabled = async (wh: WebhookConfig) => {
    try {
      const res = await fetch(apiUrl(`/api/settings/webhooks/${wh.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isEnabled: !wh.isEnabled }),
      })
      if (res.ok) {
        const d = (await res.json()) as { webhook?: WebhookConfig }
        if (d.webhook) setWebhooks((prev) => prev.map((w) => (w.id === wh.id ? d.webhook! : w)))
      }
    } catch {
      // non-fatal
    }
  }

  const deleteWebhook = async (id: string) => {
    setWebhooksError('')
    setWebhooksNotice('')
    try {
      const res = await fetch(apiUrl(`/api/settings/webhooks/${id}`), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setWebhooks((prev) => prev.filter((w) => w.id !== id))
        setWebhooksNotice('Webhook deleted.')
      } else {
        setWebhooksError('Could not delete webhook.')
      }
    } catch {
      setWebhooksError('Request failed.')
    }
  }

  const testWebhook = async (id: string) => {
    setWebhookTestingId(id)
    setWebhooksNotice('')
    setWebhooksError('')
    try {
      const res = await fetch(apiUrl(`/api/settings/webhooks/${id}/test`), {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        setWebhooksNotice('Test ping sent.')
      } else {
        setWebhooksError('Test ping failed.')
      }
    } catch {
      setWebhooksError('Request failed.')
    } finally {
      setWebhookTestingId(null)
    }
  }

  const refreshLocations = async () => {
    try {
      const [publicRes, adminRes] = await Promise.all([
        fetch(apiUrl('/api/locations')),
        fetch(apiUrl('/api/settings/locations'), { credentials: 'include' }),
      ])
      if (publicRes.ok) {
        const payload = (await publicRes.json()) as { locations?: Location[] }
        if (Array.isArray(payload.locations)) setLocations(payload.locations)
      }
      if (adminRes.ok) {
        const payload = (await adminRes.json()) as { locations?: Location[] }
        if (Array.isArray(payload.locations)) setAllLocations(payload.locations)
      }
    } catch {
      // non-fatal
    }
  }

  const addLocation = async () => {
    const name = locationAddName.trim()
    if (!name) return
    setLocationsPending(true)
    setLocationsError('')
    setLocationsNotice('')
    try {
      const res = await fetch(apiUrl('/api/settings/locations'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.status === 409) {
        setLocationsError('A location with that name already exists.')
      } else if (!res.ok) {
        setLocationsError('Failed to add location.')
      } else {
        setLocationAddName('')
        setLocationsNotice('Location added.')
        await refreshLocations()
      }
    } catch {
      setLocationsError('Request failed.')
    } finally {
      setLocationsPending(false)
    }
  }

  const saveLocationEdit = async (id: string) => {
    const name = locationEditName.trim()
    if (!name) return
    setLocationsPending(true)
    setLocationsError('')
    setLocationsNotice('')
    try {
      const res = await fetch(apiUrl(`/api/settings/locations/${id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (res.status === 400 || res.status === 409) {
        setLocationsError('Could not update location. Name may already be in use.')
      } else if (!res.ok) {
        setLocationsError('Failed to update location.')
      } else {
        setLocationEditId(null)
        setLocationEditName('')
        setLocationsNotice('Location updated.')
        await refreshLocations()
      }
    } catch {
      setLocationsError('Request failed.')
    } finally {
      setLocationsPending(false)
    }
  }

  const toggleLocationActive = async (loc: Location) => {
    setLocationsError('')
    setLocationsNotice('')
    try {
      const res = await fetch(apiUrl(`/api/settings/locations/${loc.id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !loc.isActive }),
      })
      if (!res.ok) {
        setLocationsError('Failed to update location.')
      } else {
        await refreshLocations()
      }
    } catch {
      setLocationsError('Request failed.')
    }
  }

  const removeLocation = async (id: string) => {
    setLocationsError('')
    setLocationsNotice('')
    try {
      const res = await fetch(apiUrl(`/api/settings/locations/${id}`), {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.status === 409) {
        setLocationsError('Cannot delete — this location is referenced by one or more tickets.')
      } else if (res.status === 404) {
        setLocationsError('Location not found.')
      } else if (!res.ok) {
        setLocationsError('Failed to delete location.')
      } else {
        setLocationsNotice('Location deleted.')
        await refreshLocations()
      }
    } catch {
      setLocationsError('Request failed.')
    }
  }

  const createTicket = async () => {
    setCreateTicketError('')
    if (
      !newTicketForm.title.trim() ||
      !newTicketForm.requestorName.trim() ||
      !newTicketForm.requestorEmail.trim() ||
      !newTicketForm.description.trim() ||
      !newTicketForm.categoryId
    ) {
      return
    }

    setCreateTicketPending(true)

    try {
      const response = await fetch(apiUrl('/api/tickets'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: newTicketForm.title.trim(),
          description: newTicketForm.description.trim(),
          priority: newTicketForm.priority,
          teamId: newTicketForm.teamId || currentUser.teamId,
          categoryId: newTicketForm.categoryId,
          assignedToId: newTicketForm.assignedToId || null,
          requestorName: newTicketForm.requestorName.trim(),
          requestorEmail: newTicketForm.requestorEmail.trim(),
          location: newTicketForm.location.trim(),
          customFields: createTicketFieldDefs.map((def) => ({
            fieldId: def.id,
            value: newTicketCustomFields[def.id] ?? '',
          })),
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setCreateTicketError('Your session expired. Please sign in again.')
        return
      }

      if (response.status === 403) {
        setCreateTicketError('You can only create tickets for your own team.')
        return
      }

      if (!response.ok) {
        setCreateTicketError('Ticket could not be created in SQL Server.')
        return
      }

      const payload = (await response.json()) as {
        ticket?: TicketRecord
      }

      if (!payload.ticket) {
        setCreateTicketError('Ticket could not be created in SQL Server.')
        return
      }

      setTickets((current) => [payload.ticket as TicketRecord, ...current])
      setNewTicketCustomFields({})
      setNewTicketForm({
        teamId: currentTeam?.id ?? '',
        title: '',
        requestorName: '',
        requestorEmail: '',
        location: '',
        categoryId: currentTeamCategories[0]?.id ?? '',
        assignedToId: '',
        priority: 'Medium',
        status: 'Open',
        description: '',
      })
      startTransition(() => {
        setActiveView('team-tickets')
        setDetailTicketId(payload.ticket?.id ?? null)
      })
    } catch {
      setCreateTicketError('Ticket could not be created. Confirm the backend server is running.')
    } finally {
      setCreateTicketPending(false)
    }
  }

  const exportVisibleTickets = () => {
    const rows = visibleTickets.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      team: getTeamById(ticket.teamId)?.name ?? 'Unknown',
      category: getCategoryById(ticket.categoryId)?.name ?? 'Unknown',
      assignedTo: getUserById(ticket.assignedToId)?.name ?? 'Unassigned',
      requestor: ticket.requestorName,
      email: ticket.requestorEmail,
      updatedAt: formatDateTime(ticket.updatedAt),
      resolvedAt: ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : '',
    }))

    const csv = [
      'Ticket ID,Title,Status,Priority,Team,Category,Assigned To,Requestor,Email,Updated,Resolved At',
      ...rows.map((row) =>
        Object.values(row)
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(','),
      ),
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `team-support-pro-${activeView}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const addOrganization = async () => {
    if (!organizationForm.name.trim()) {
      return
    }

    try {
      const response = await fetch(apiUrl('/api/organizations'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name: organizationForm.name.trim(),
          code: organizationForm.code.trim().toUpperCase() || organizationForm.name.trim().slice(0, 3).toUpperCase(),
          accent: organizationForm.accent,
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        return
      }

      if (response.status === 403 || !response.ok) {
        return
      }

      const payload = (await response.json()) as {
        organization?: Organization
      }

      if (payload.organization) {
        setOrganizations((current) => [...current, payload.organization as Organization])
        setOrganizationForm({ name: '', code: '', accent: '#334155' })
        setTeamForm((current) => ({
          ...current,
          organizationId: payload.organization?.id ?? current.organizationId,
        }))
      }
    } catch {
      // Error handling
    }
  }

  const updateOrganization = (organizationId: string, field: 'name' | 'code' | 'accent', value: string) => {
    setOrganizations((current) =>
      current.map((organization) =>
        organization.id === organizationId
          ? {
              ...organization,
              [field]: field === 'code' ? value.toUpperCase() : value,
            }
          : organization,
      ),
    )
  }

  const persistOrganization = async (organization: Organization) => {
    const normalizedOrganization = {
      ...organization,
      name: organization.name.trim(),
      code: organization.code.trim().toUpperCase(),
      accent: organization.accent.trim(),
    }

    if (!normalizedOrganization.name || !normalizedOrganization.code || !normalizedOrganization.accent) {
      return
    }

    try {
      const response = await fetch(apiUrl(`/api/organizations/${normalizedOrganization.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(normalizedOrganization),
      })

      if (response.status === 401) {
        setAuthSession(null)
        return
      }

      if (response.status === 403 || !response.ok) {
        return
      }

      const payload = (await response.json()) as {
        organization?: Organization
      }

      if (payload.organization) {
        setOrganizations((current) =>
          current.map((entry) =>
            entry.id === payload.organization?.id ? (payload.organization as Organization) : entry,
          ),
        )
      }
    } catch {
      // Error handling
    }
  }

  const addTeam = async () => {
    if (!teamForm.organizationId || !teamForm.name.trim()) {
      return
    }

    try {
      const response = await fetch(apiUrl('/api/teams'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          organizationId: teamForm.organizationId,
          name: teamForm.name.trim(),
          code: teamForm.code.trim().toUpperCase() || teamForm.name.trim().slice(0, 3).toUpperCase(),
          accent: teamForm.accent,
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        return
      }

      if (response.status === 403 || !response.ok) {
        return
      }

      const payload = (await response.json()) as {
        team?: Team
      }

      if (payload.team) {
        setTeams((current) => [...current, payload.team as Team])
        setTeamForm((current) => ({ ...current, name: '', code: '', accent: '#0078d4' }))
        setCategoryForm((current) => ({ ...current, teamId: payload.team?.id ?? current.teamId }))
      }
    } catch {
      // Error
    }
  }

  const updateTeam = (teamId: string, field: 'organizationId' | 'name' | 'code' | 'accent', value: string) => {
    setTeams((current) =>
      current.map((team) =>
        team.id === teamId
          ? {
              ...team,
              [field]: field === 'code' ? value.toUpperCase() : value,
            }
          : team,
      ),
    )
  }

  const persistTeam = async (team: Team) => {
    const normalizedTeam = {
      ...team,
      name: team.name.trim(),
      code: team.code.trim().toUpperCase(),
      accent: team.accent.trim(),
    }

    if (!normalizedTeam.name || !normalizedTeam.code || !normalizedTeam.accent) {
      // Maybe set an error, but for now just return
      return
    }

    try {
      const response = await fetch(apiUrl(`/api/teams/${normalizedTeam.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          organizationId: normalizedTeam.organizationId,
          name: normalizedTeam.name,
          code: normalizedTeam.code,
          accent: normalizedTeam.accent,
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        return
      }

      if (response.status === 403) {
        // Admin required
        return
      }

      if (!response.ok) {
        // Could set an error state
        return
      }

      const payload = (await response.json()) as {
        team?: Team
      }

      if (payload.team) {
        setTeams((current) =>
          current.map((entry) => (entry.id === payload.team?.id ? (payload.team as Team) : entry)),
        )
      }
    } catch {
      // Error handling
    }
  }

  const addCategory = async () => {
    if (!categoryForm.name.trim() || !categoryForm.teamId) {
      return
    }

    try {
      const response = await fetch(apiUrl('/api/categories'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          teamId: categoryForm.teamId,
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim() || 'Custom admin category.',
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        return
      }

      if (response.status === 403) {
        // Admin required
        return
      }

      if (!response.ok) {
        // Error
        return
      }

      const payload = (await response.json()) as {
        category?: Category
      }

      if (payload.category) {
        setCategories((current) => [...current, payload.category as Category])
        setCategoryForm((current) => ({
          ...current,
          name: '',
          description: '',
        }))
      }
    } catch {
      // Error
    }
  }

  const updateCategory = (
    categoryId: string,
    field: 'teamId' | 'name' | 'description',
    value: string,
  ) => {
    setCategories((current) =>
      current.map((category) =>
        category.id === categoryId
          ? {
              ...category,
              [field]: value,
            }
          : category,
      ),
    )
  }

  const persistCategory = async (category: Category) => {
    const normalizedCategory = {
      ...category,
      name: category.name.trim(),
      description: category.description.trim(),
      teamId: category.teamId.trim(),
    }

    if (!normalizedCategory.name || !normalizedCategory.teamId) {
      // Maybe set an error
      return
    }

    try {
      const response = await fetch(apiUrl(`/api/categories/${normalizedCategory.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name: normalizedCategory.name,
          description: normalizedCategory.description,
          teamId: normalizedCategory.teamId,
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        return
      }

      if (response.status === 403) {
        // Admin required
        return
      }

      if (!response.ok) {
        // Error
        return
      }

      const payload = (await response.json()) as {
        category?: Category
      }

      if (payload.category) {
        setCategories((current) =>
          current.map((entry) => (entry.id === payload.category?.id ? (payload.category as Category) : entry)),
        )
      }
    } catch {
      // Error
    }
  }

  const addUser = async () => {
    if (!userForm.name.trim() || !userForm.email.trim() || !userForm.organizationId || !userForm.teamId) {
      setUserDirectoryError('Name, email, organization, and team are required before adding a user.')
      setUserDirectoryNotice('')
      return
    }

    const normalizedEmail = userForm.email.trim().toLowerCase()
    if (users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
      setUserDirectoryError('A user with that email already exists.')
      setUserDirectoryNotice('')
      return
    }

    setUserDirectoryError('')
    setUserDirectoryNotice('')
    setUserFormPending(true)

    try {
      const response = await fetch(apiUrl('/api/users'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          name: userForm.name.trim(),
          email: normalizedEmail,
          organizationId: userForm.organizationId,
          teamId: userForm.teamId,
          role: userForm.role,
          canViewAllOrgTickets: userForm.canViewAllOrgTickets,
        }),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setUserDirectoryError('Your session expired. Please sign in again.')
        return
      }

      if (response.status === 403) {
        setUserDirectoryError('Only admins can manage users.')
        return
      }

      if (!response.ok) {
        setUserDirectoryError('User could not be created in SQL Server.')
        return
      }

      const payload = (await response.json()) as {
        user?: User
      }

      if (!payload.user) {
        setUserDirectoryError('User could not be created in SQL Server.')
        return
      }

      setUsers((current) => [...current, payload.user as User])
      setUserForm({
        name: '',
        email: '',
        organizationId: currentUser.organizationId,
        teamId: currentUser.teamId,
        role: 'Staff',
        canViewAllOrgTickets: false,
      })
      setUserDirectoryNotice('User added successfully.')
      await refreshAuthSession()
    } catch {
      setUserDirectoryError('User could not be created. Confirm the backend server is running.')
    } finally {
      setUserFormPending(false)
    }
  }

  const updateUser = (
    userId: string,
    field: 'name' | 'email' | 'organizationId' | 'teamId' | 'role' | 'canViewAllOrgTickets',
    value: string | boolean,
  ) => {
    setUsers((current) =>
      current.map((user) =>
        user.id === userId
          ? {
              ...user,
              [field]: field === 'email' ? String(value).toLowerCase() : value,
            }
          : user,
      ),
    )
  }

  const persistUser = async (user: User) => {
    const normalizedUser = {
      ...user,
      name: user.name.trim(),
      email: user.email.trim().toLowerCase(),
      organizationId: user.organizationId.trim(),
      teamId: user.teamId.trim(),
    }

    if (!normalizedUser.name || !normalizedUser.email || !normalizedUser.organizationId || !normalizedUser.teamId) {
      setUserDirectoryError('Each user needs a name, email, organization, and team before changes can be saved.')
      setUserDirectoryNotice('')
      return
    }

    setUserDirectoryError('')
    setUserDirectoryNotice('')
    setUserSavePendingIds((current) =>
      current.includes(normalizedUser.id) ? current : [...current, normalizedUser.id],
    )

    try {
      const response = await fetch(apiUrl(`/api/users/${normalizedUser.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(normalizedUser),
      })

      if (response.status === 401) {
        setAuthSession(null)
        setUserDirectoryError('Your session expired. Please sign in again.')
        return
      }

      if (response.status === 403) {
        setUserDirectoryError('Only admins can manage users.')
        return
      }

      if (!response.ok) {
        setUserDirectoryError('User changes could not be saved to SQL Server.')
        return
      }

      const payload = (await response.json()) as {
        user?: User
      }

      if (!payload.user) {
        setUserDirectoryError('User changes could not be saved to SQL Server.')
        return
      }

      setUsers((current) =>
        current.map((entry) => (entry.id === payload.user?.id ? (payload.user as User) : entry)),
      )
      setUserDirectoryNotice('User changes saved.')
      await refreshAuthSession()
    } catch {
      setUserDirectoryError('User changes could not be saved. Confirm the backend server is running.')
    } finally {
      setUserSavePendingIds((current) => current.filter((entry) => entry !== normalizedUser.id))
    }
  }

  const handleChangePassword = async () => {
    if (!changePasswordModal) return
    if (changePasswordValue.length < 8) {
      setChangePasswordError('Password must be at least 8 characters.')
      return
    }
    setChangePasswordError('')
    setChangePasswordPending(true)
    try {
      const response = await fetch(apiUrl(`/api/users/${changePasswordModal.userId}/change-password`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newPassword: changePasswordValue }),
      })
      if (response.status === 401) { setAuthSession(null); return }
      if (!response.ok) {
        const payload = (await response.json()) as { message?: string }
        setChangePasswordError(payload.message ?? 'Password change failed.')
        return
      }
      setChangePasswordModal(null)
      setChangePasswordValue('')
      setUserDirectoryNotice(`Password updated for ${changePasswordModal.userName}.`)
    } catch {
      setChangePasswordError('Could not reach the server. Check your connection.')
    } finally {
      setChangePasswordPending(false)
    }
  }

  const metricCards: Array<{
    id: DashboardWidgetId
    label: string
    value: number
    accent: string
    icon: LucideIcon
  }> = [
    {
      id: 'metric-total',
      label: canViewAllOrgTickets ? 'Org Tickets' : 'Team Tickets',
      value: dashboardStats.total,
      accent: 'bg-blue-50 text-sky-700',
      icon: Ticket,
    },
    {
      id: 'metric-open',
      label: 'Open',
      value: dashboardStats.open,
      accent: 'bg-blue-50 text-sky-700',
      icon: RefreshCw,
    },
    {
      id: 'metric-progress',
      label: 'In Progress',
      value: dashboardStats.inProgress,
      accent: 'bg-amber-50 text-amber-700',
      icon: Clock3,
    },
    {
      id: 'metric-pending',
      label: 'Pending',
      value: dashboardStats.pending,
      accent: 'bg-orange-50 text-orange-700',
      icon: TriangleAlert,
    },
    {
      id: 'metric-critical',
      label: 'Critical',
      value: dashboardStats.critical,
      accent: 'bg-red-50 text-red-700',
      icon: TriangleAlert,
    },
  ]

  const paletteStyle = {
    '--app-bg': activePalette.appBg,
    '--header-bg': activePalette.headerBg,
    '--menu-bg': activePalette.menuBg,
    '--card-bg': activePalette.cardBg,
    '--panel-bg': activePalette.panelBg,
    '--input-bg': activePalette.inputBg,
    '--button-bg': activePalette.buttonBg,
    '--accent': activePalette.accent,
    '--text': activePalette.text,
    '--text-muted': activePalette.textMuted,
    '--border': activePalette.border,
    '--button-text': activePalette.buttonText,
    '--detail-panel-width': `${detailWidth}vw`,
  } as CSSProperties

  const currentViewLabel =
    activeView === 'notifications'
      ? 'Notifications'
      : activeView === 'team-tickets'
        ? canViewAllOrgTickets
          ? 'All Organization Tickets'
          : `Team Tickets - ${currentTeam.name}`
      : activeView === 'manage-organizations'
        ? 'Organizations'
      : activeView === 'manage-users'
        ? 'Manage Users'
      : activeView === 'manage-teams'
        ? 'Manage Teams'
      : activeView === 'manage-categories'
        ? 'Categories'
      : activeView === 'about'
        ? 'About'
      : visibleNavItems.find((item) => item.id === activeView)?.label ?? 'Settings'

  const resetDashboardLayout = () => {
    window.localStorage.removeItem(dashboardLayoutStorageKey)
    setDashboardLayouts(mergeDashboardLayouts(null))
  }

  const visibleDashboardWidgetIds: DashboardWidgetId[] =
    currentUser.role === 'Admin' || currentUser.role === 'Super Admin'
      ? [...dashboardWidgetOrder]
      : dashboardWidgetOrder.filter((widgetId) => widgetId !== 'trends' && widgetId !== 'status')

  const visibleDashboardLayouts = filterDashboardLayouts(dashboardLayouts, visibleDashboardWidgetIds)

  const renderDashboardWidget = (widgetId: DashboardWidgetId) => {
    const metricCard = metricCards.find((card) => card.id === widgetId)

    if (metricCard) {
      const Icon = metricCard.icon

      return (
        <section className="surface dashboard-widget-panel p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-[color:var(--text-muted)]">
            <div className="text-xs font-semibold uppercase tracking-[0.12em]">{metricCard.label}</div>
              <div className="dashboard-widget-handle flex items-center text-xs uppercase tracking-[0.12em]">
              <Grip className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-start justify-between gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-[2px] ${metricCard.accent}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="text-right">
              <div className="font-mono text-2xl font-semibold text-[color:var(--text)]">
                {metricCard.value}
              </div>
            </div>
          </div>
        </section>
      )
    }

    if (widgetId === 'trends') {
      return (
        <section className="surface dashboard-widget-panel p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Ticket Trend by Team</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Daily ticket volume over the last 21 days.
              </div>
            </div>
            <div className="dashboard-widget-handle flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              <Grip className="h-4 w-4" />
              Move / Resize
            </div>
          </div>
          {isMobileViewport && (
            <div className="mb-3 flex flex-wrap gap-2 text-xs text-[color:var(--text-muted)]">
              {getTeamsForOrganization(teams, currentUser.organizationId).map((team) => (
                <div
                  key={`${team.id}-trend-legend`}
                  className="inline-flex items-center gap-2 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-2 py-1"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: team.accent }}
                    aria-hidden="true"
                  />
                  <span>{team.name}</span>
                </div>
              ))}
            </div>
          )}
          <div className="dashboard-chart-body min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 2,
                    border: '1px solid var(--border)',
                    background: 'var(--panel-bg)',
                    color: 'var(--text)',
                  }}
                />
                {!isMobileViewport && <Legend />}
                {getTeamsForOrganization(teams, currentUser.organizationId).map((team) => (
                  <Line
                    key={team.id}
                    type="monotone"
                    dataKey={team.id}
                    stroke={team.accent}
                    strokeWidth={2.5}
                    dot={false}
                    name={team.name}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )
    }

    if (widgetId === 'status') {
      return (
        <section className="surface dashboard-widget-panel p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Status Overview</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Live mix across all support teams.
              </div>
            </div>
            <div className="dashboard-widget-handle flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              <Grip className="h-4 w-4" />
              Move / Resize
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
            {statusCounts.map(({ status, count }) => {
              const max = Math.max(...statusCounts.map((item) => item.count), 1)
              return (
                <div key={status}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={getStatusBadgeClass(status)}>{status}</span>
                    <span className="font-mono text-sm text-[color:var(--text)]">{count}</span>
                  </div>
                  <div className="h-2 rounded-[2px] bg-black/[0.06]">
                    <div
                      className="h-2 rounded-[2px] bg-[color:var(--accent)]"
                      style={{ width: `${(count / max) * 100}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )
    }

    if (widgetId === 'queue') {
      return (
        <section className="surface dashboard-widget-panel p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Current Team Queue</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                {currentTeam.name} categories only. Reassignment is limited to {currentTeam.name} staff.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="dashboard-widget-handle flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                <Grip className="h-4 w-4" />
                Move / Resize
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setActiveView('team-tickets')}
              >
                Open Queue
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {renderTicketCollection()}
          </div>
        </section>
      )
    }

    return (
      <section className="surface dashboard-widget-panel p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">Operational Notes</div>
            <div className="text-sm text-[color:var(--text-muted)]">
              Short operational context for the signed-in support team.
            </div>
          </div>
          <div className="dashboard-widget-handle flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
            <Grip className="h-4 w-4" />
            Move / Resize
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1 text-sm text-[color:var(--text-muted)]">
          <div className="surface-muted p-3">
            <div className="mb-1 font-semibold text-[color:var(--text)]">
              Team isolation
            </div>
            Categories, queues, and assignee lists are filtered to the logged-in user&apos;s team.
          </div>
          <div className="surface-muted p-3">
            <div className="mb-1 font-semibold text-[color:var(--text)]">
              Future integrations
            </div>
            Mock data is active today. The state model is ready to swap to hosted services and Azure SQL later.
          </div>
          <div className="surface-muted p-3">
            <div className="mb-1 font-semibold text-[color:var(--text)]">
              Team workload
            </div>
            <div className="space-y-2">
              {(currentUser.role === 'Admin' || currentUser.role === 'Super Admin' ? teams.filter((t) => t.organizationId === currentUser.organizationId) : [currentTeam]).map((team) => {
                const total = teamWorkload.find((entry) => entry.teamId === team.id)?.count ?? 0
                const Icon = teamIcons[team.id] ?? Building2
                return (
                  <div key={team.id} className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-[color:var(--text)]">
                      <Icon className="h-4 w-4" style={{ color: team.accent }} />
                      {team.name}
                    </div>
                    <div className="font-mono">{total}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    )
  }

  const renderNotificationsPage = () => {
    if (visibleNotificationItems.length === 0) {
      return (
        <div className="surface flex min-h-56 items-center justify-center p-8 text-sm text-[color:var(--text-muted)]">
          No notifications in view. Archived items stay hidden for your account.
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <section className="surface p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Recent Activity Notifications</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Activity on tickets assigned to you and @mentions from your team. Opening this page marks visible items as read.
              </div>
            </div>
            <div className="rounded-[2px] border border-[color:var(--border)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              {unreadNotificationCount} unread
            </div>
          </div>

          <div className="space-y-3">
            {visibleNotificationItems.map((item) => {
              const isUnread = !readNotificationIdSet.has(item.id)

              return (
                <div
                  key={item.id}
                  className="surface-muted relative flex flex-col gap-3 p-4 pr-14 md:flex-row md:items-start md:justify-between md:pr-4"
                  data-unread={isUnread}
                >
                  <button
                    type="button"
                    className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-[2px] text-[color:var(--text-muted)] transition hover:bg-[color:var(--panel-bg)] hover:text-[color:var(--text)]"
                    onClick={() => archiveNotification(item.id)}
                    aria-label="Remove notification"
                    title="Remove notification"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-[color:var(--accent)]">
                        {item.ticketId}
                      </span>
                      {item.type === 'mention' && (
                        <span className="badge badge-blue">Mention</span>
                      )}
                      {isUnread && (
                        <span className="badge badge-red">Unread</span>
                      )}
                    </div>
                    <div className="text-base font-semibold text-[color:var(--text)]">{item.ticketTitle}</div>
                    <div className="text-sm text-[color:var(--text-muted)]">
                      <span className="font-semibold text-[color:var(--text)]">{item.actor}</span> {item.message}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-3 pr-10 md:items-end md:pr-10">
                    <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                      {formatDateTime(item.at)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      <button
                        type="button"
                        className={isUnread ? 'dashboard-reset-button' : 'notification-unread-button'}
                        onClick={() => toggleNotificationReadState(item.id, !isUnread)}
                      >
                        {isUnread ? 'Mark as read' : 'Mark as unread'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => openTicket(item.ticketId)}
                      >
                        Open Ticket
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    )
  }

  const renderSettingsPageLauncher = (label: string, summary: string, action: () => void) => (
    <div className="settings-accordion-content space-y-3">
      <div className="text-sm text-[color:var(--text-muted)]">{summary}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--text)]">Open {label}</div>
          <div className="text-xs text-[color:var(--text-muted)]">
            Manage this area on a full-width page with Add and Edit tabs.
          </div>
        </div>
        <button type="button" className="primary-button" onClick={action}>
          Open Page
        </button>
      </div>
    </div>
  )

  const getSettingsTabClassName = (isActive: boolean) =>
    [
      'border-b-2 px-1 py-2 text-sm font-semibold transition-colors',
      isActive
        ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
        : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text)]',
    ].join(' ')

  const renderSettingsDrawerTabs = () => (
    <div className="flex gap-6 border-b border-[color:var(--border)] px-5 py-3">
      {(
        [
          ['add', 'Add'],
          ['edit', 'Edit'],
        ] as const
      ).map(([value, label]) => {
        const isActive = settingsDrawerTab === value

        return (
          <button
            key={value}
            type="button"
            className={getSettingsTabClassName(isActive)}
            onClick={() => setSettingsDrawerTab(value)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )

  const renderManagementPageTabs = () => renderSettingsDrawerTabs()

  const openManageOrganizationEdit = (organization: Organization) => {
    setSettingsDrawerTab('edit')
    setManageOrganizationEditDraft({ ...organization })
    openSettingsDrawer('manageOrganizations')
  }

  const saveManageOrganizationEdit = async () => {
    if (!manageOrganizationEditDraft) {
      return
    }

    updateOrganization(manageOrganizationEditDraft.id, 'name', manageOrganizationEditDraft.name)
    updateOrganization(manageOrganizationEditDraft.id, 'code', manageOrganizationEditDraft.code)
    updateOrganization(manageOrganizationEditDraft.id, 'accent', manageOrganizationEditDraft.accent)
    await persistOrganization(manageOrganizationEditDraft)
  }

  const renderManageOrganizationsEditPanelContent = () => {
    if (!manageOrganizationEditDraft) {
      return null
    }

    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-[color:var(--border)] px-5 py-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                Organizations
              </div>
              <h2 className="text-2xl font-semibold">Edit Organization</h2>
              <div className="mt-1 text-sm text-[color:var(--text-muted)]">
                Update the selected organization and save the record from this panel.
              </div>
            </div>

            <button type="button" className="icon-button" onClick={closeSettingsDrawer}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4">
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Organization name</div>
              <input
                className="input-control"
                value={manageOrganizationEditDraft.name}
                onChange={(event) =>
                  setManageOrganizationEditDraft((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Code</div>
              <input
                className="input-control font-mono"
                value={manageOrganizationEditDraft.code}
                onChange={(event) =>
                  setManageOrganizationEditDraft((current) =>
                    current ? { ...current, code: event.target.value.toUpperCase() } : current,
                  )
                }
              />
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Accent</div>
              <input
                type="color"
                className="h-10 w-full rounded-[2px] border border-[color:var(--border)] bg-transparent p-1"
                value={manageOrganizationEditDraft.accent}
                onChange={(event) =>
                  setManageOrganizationEditDraft((current) =>
                    current ? { ...current, accent: event.target.value } : current,
                  )
                }
              />
            </label>
          </div>
        </div>

        <div className="border-t border-[color:var(--border)] px-5 py-4">
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="secondary-button" onClick={closeSettingsDrawer}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={() => void saveManageOrganizationEdit()}>
              Save Organization
            </button>
          </div>
        </div>
      </div>
    )
  }

  const openManageUsersEdit = (user: User) => {
    setSettingsDrawerTab('edit')
    setManageUsersEditDraft({ ...user })
    openSettingsDrawer('manageUsers')
    setUserDirectoryError('')
    setUserDirectoryNotice('')
  }

  const saveManageUsersEdit = async () => {
    if (!manageUsersEditDraft) {
      return
    }

    updateUser(manageUsersEditDraft.id, 'name', manageUsersEditDraft.name)
    updateUser(manageUsersEditDraft.id, 'email', manageUsersEditDraft.email)
    updateUser(manageUsersEditDraft.id, 'organizationId', manageUsersEditDraft.organizationId)
    updateUser(manageUsersEditDraft.id, 'teamId', manageUsersEditDraft.teamId)
    updateUser(manageUsersEditDraft.id, 'role', manageUsersEditDraft.role)
    updateUser(manageUsersEditDraft.id, 'canViewAllOrgTickets', Boolean(manageUsersEditDraft.canViewAllOrgTickets))
    await persistUser(manageUsersEditDraft)
  }

  const renderManageUsersEditPanelContent = () => {
    if (!manageUsersEditDraft) {
      return null
    }

    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-[color:var(--border)] px-5 py-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                Manage Users
              </div>
              <h2 className="text-2xl font-semibold">Edit User</h2>
              <div className="mt-1 text-sm text-[color:var(--text-muted)]">
                Update the selected user and save the record from this panel.
              </div>
            </div>

            <button type="button" className="icon-button" onClick={() => setManageUsersEditDraft(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4">
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Full name</div>
              <input
                className="input-control"
                value={manageUsersEditDraft.name}
                onChange={(event) =>
                  setManageUsersEditDraft((current) => (current ? { ...current, name: event.target.value } : current))
                }
              />
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Email</div>
              <input
                className="input-control"
                value={manageUsersEditDraft.email}
                onChange={(event) =>
                  setManageUsersEditDraft((current) => (current ? { ...current, email: event.target.value } : current))
                }
              />
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Organization</div>
              <select
                className="input-control"
                value={manageUsersEditDraft.organizationId}
                onChange={(event) => {
                  const nextOrganizationId = event.target.value
                  setManageUsersEditDraft((current) =>
                    current
                      ? {
                          ...current,
                          organizationId: nextOrganizationId,
                          teamId: getFirstTeamIdForOrganization(availableTeams, nextOrganizationId),
                        }
                      : current,
                  )
                }}
              >
                {availableOrganizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Team</div>
              <select
                className="input-control"
                value={manageUsersEditDraft.teamId}
                onChange={(event) =>
                  setManageUsersEditDraft((current) => (current ? { ...current, teamId: event.target.value } : current))
                }
              >
                {getTeamsForOrganization(availableTeams, manageUsersEditDraft.organizationId).map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Role</div>
              <select
                className="input-control"
                value={manageUsersEditDraft.role}
                onChange={(event) =>
                  setManageUsersEditDraft((current) =>
                    current ? { ...current, role: event.target.value as User['role'] } : current,
                  )
                }
              >
                <option value="Admin">Admin</option>
                {superAdminEnabled && <option value="Super Admin">Super Admin</option>}
                <option value="Staff">Staff</option>
              </select>
            </label>
            <label className="col-span-full flex items-start gap-2 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={Boolean(manageUsersEditDraft.canViewAllOrgTickets)}
                onChange={(event) =>
                  setManageUsersEditDraft((current) =>
                    current ? { ...current, canViewAllOrgTickets: event.target.checked } : current,
                  )
                }
              />
              <span>
                <span className="block text-sm font-medium text-[color:var(--text)]">See all organization tickets</span>
                <span className="block text-xs text-[color:var(--text-muted)]">
                  When enabled, this user can view and edit tickets for every team in their organization, create tickets for any team, and reassign tickets between teams.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="border-t border-[color:var(--border)] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {manageUsersEditDraft.name !== 'Administrator' ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setChangePasswordValue('')
                  setChangePasswordError('')
                  setChangePasswordModal({
                    userId: manageUsersEditDraft.id,
                    userName: manageUsersEditDraft.name,
                  })
                }}
              >
                Change Password
              </button>
            ) : (
              <div className="text-xs text-[color:var(--text-muted)]">Password changes are disabled for Administrator.</div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs text-[color:var(--text-muted)]">
                {userSavePendingIds.includes(manageUsersEditDraft.id) ? 'Saving...' : 'Ready to save'}
              </div>
              <button type="button" className="primary-button" onClick={() => void saveManageUsersEdit()}>
                Save User
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const openManageTeamEdit = (team: Team) => {
    setSettingsDrawerTab('edit')
    setManageTeamEditDraft({ ...team })
    openSettingsDrawer('manageTeams')
  }

  const saveManageTeamEdit = async () => {
    if (!manageTeamEditDraft) {
      return
    }

    updateTeam(manageTeamEditDraft.id, 'organizationId', manageTeamEditDraft.organizationId)
    updateTeam(manageTeamEditDraft.id, 'name', manageTeamEditDraft.name)
    updateTeam(manageTeamEditDraft.id, 'code', manageTeamEditDraft.code)
    updateTeam(manageTeamEditDraft.id, 'accent', manageTeamEditDraft.accent)
    await persistTeam(manageTeamEditDraft)
  }

  const renderManageTeamsEditPanelContent = () => {
    if (!manageTeamEditDraft) {
      return null
    }

    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-[color:var(--border)] px-5 py-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                Manage Teams
              </div>
              <h2 className="text-2xl font-semibold">Edit Team</h2>
              <div className="mt-1 text-sm text-[color:var(--text-muted)]">
                Update the selected team and save the record from this panel.
              </div>
            </div>

            <button type="button" className="icon-button" onClick={closeSettingsDrawer}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4">
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Organization</div>
              <select
                className="input-control"
                value={manageTeamEditDraft.organizationId}
                onChange={(event) =>
                  setManageTeamEditDraft((current) =>
                    current ? { ...current, organizationId: event.target.value } : current,
                  )
                }
              >
                {availableOrganizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Team name</div>
              <input
                className="input-control"
                value={manageTeamEditDraft.name}
                onChange={(event) =>
                  setManageTeamEditDraft((current) => (current ? { ...current, name: event.target.value } : current))
                }
              />
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Code</div>
              <input
                className="input-control font-mono"
                value={manageTeamEditDraft.code}
                onChange={(event) =>
                  setManageTeamEditDraft((current) =>
                    current ? { ...current, code: event.target.value.toUpperCase() } : current,
                  )
                }
              />
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Accent</div>
              <input
                type="color"
                className="h-10 w-full rounded-[2px] border border-[color:var(--border)] bg-transparent p-1"
                value={manageTeamEditDraft.accent}
                onChange={(event) =>
                  setManageTeamEditDraft((current) => (current ? { ...current, accent: event.target.value } : current))
                }
              />
            </label>
          </div>
        </div>

        <div className="border-t border-[color:var(--border)] px-5 py-4">
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="secondary-button" onClick={closeSettingsDrawer}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={() => void saveManageTeamEdit()}>
              Save Team
            </button>
          </div>
        </div>
      </div>
    )
  }

  const openManageCategoryEdit = (category: Category) => {
    setSettingsDrawerTab('edit')
    setManageCategoryEditDraft({ ...category })
    openSettingsDrawer('categories')
  }

  const saveManageCategoryEdit = async () => {
    if (!manageCategoryEditDraft) {
      return
    }

    updateCategory(manageCategoryEditDraft.id, 'teamId', manageCategoryEditDraft.teamId)
    updateCategory(manageCategoryEditDraft.id, 'name', manageCategoryEditDraft.name)
    updateCategory(manageCategoryEditDraft.id, 'description', manageCategoryEditDraft.description)
    await persistCategory(manageCategoryEditDraft)
  }

  const renderManageCategoriesEditPanelContent = () => {
    if (!manageCategoryEditDraft) {
      return null
    }

    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-[color:var(--border)] px-5 py-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                Categories
              </div>
              <h2 className="text-2xl font-semibold">Edit Category</h2>
              <div className="mt-1 text-sm text-[color:var(--text-muted)]">
                Update the selected category and save the record from this panel.
              </div>
            </div>

            <button type="button" className="icon-button" onClick={closeSettingsDrawer}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-4">
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Team</div>
              <select
                className="input-control"
                value={manageCategoryEditDraft.teamId}
                onChange={(event) =>
                  setManageCategoryEditDraft((current) => (current ? { ...current, teamId: event.target.value } : current))
                }
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {(getOrganizationById(team.organizationId)?.name ?? 'Organization')} / {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Category name</div>
              <input
                className="input-control"
                value={manageCategoryEditDraft.name}
                onChange={(event) =>
                  setManageCategoryEditDraft((current) => (current ? { ...current, name: event.target.value } : current))
                }
              />
            </label>
            <label className="space-y-2">
              <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Description</div>
              <input
                className="input-control"
                value={manageCategoryEditDraft.description}
                onChange={(event) =>
                  setManageCategoryEditDraft((current) =>
                    current ? { ...current, description: event.target.value } : current,
                  )
                }
              />
            </label>
          </div>
        </div>

        <div className="border-t border-[color:var(--border)] px-5 py-4">
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="secondary-button" onClick={closeSettingsDrawer}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={() => void saveManageCategoryEdit()}>
              Save Category
            </button>
          </div>
        </div>
      </div>
    )
  }

  const renderManageUsersPage = () => {
    const isEditing = settingsDrawerTab === 'edit'

    return (
      <div className="space-y-4">
        <section className="surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Manage Users</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Create users in the Add tab or edit existing records from the full-width table.
              </div>
            </div>
            <button type="button" className="secondary-button" onClick={() => setActiveView('settings')}>
              Back to Settings
            </button>
          </div>
        </section>

        {(userDirectoryError || userDirectoryNotice) && (
          <section className="space-y-3">
            {userDirectoryError && (
              <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {userDirectoryError}
              </div>
            )}
            {userDirectoryNotice && (
              <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {userDirectoryNotice}
              </div>
            )}
          </section>
        )}

        <section className="surface overflow-hidden p-0">
          {renderManagementPageTabs()}

          <div className="p-5">
            {!isEditing ? (
              <div className="mx-auto max-w-3xl space-y-4 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-4">
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Full name</div>
                  <input
                    className="input-control"
                    placeholder="Full name"
                    value={userForm.name}
                    onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Email</div>
                  <input
                    className="input-control"
                    placeholder="Email"
                    value={userForm.email}
                    onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                  />
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Organization</div>
                  <select
                    className="input-control"
                    value={userForm.organizationId}
                    onChange={(event) => {
                      const nextOrganizationId = event.target.value
                      setUserForm((current) => ({
                        ...current,
                        organizationId: nextOrganizationId,
                        teamId: getFirstTeamIdForOrganization(availableTeams, nextOrganizationId),
                      }))
                    }}
                  >
                    {availableOrganizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Team</div>
                  <select
                    className="input-control"
                    value={userForm.teamId}
                    onChange={(event) => setUserForm((current) => ({ ...current, teamId: event.target.value }))}
                  >
                    {getTeamsForOrganization(availableTeams, userForm.organizationId).map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Role</div>
                  <select
                    className="input-control"
                    value={userForm.role}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, role: event.target.value as User['role'] }))
                    }
                  >
                    <option value="Admin">Admin</option>
                    {superAdminEnabled && <option value="Super Admin">Super Admin</option>}
                    <option value="Staff">Staff</option>
                  </select>
                </label>
                <label className="flex items-start gap-2 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={userForm.canViewAllOrgTickets}
                    onChange={(event) =>
                      setUserForm((current) => ({ ...current, canViewAllOrgTickets: event.target.checked }))
                    }
                  />
                  <span>
                    <span className="block text-sm font-medium text-[color:var(--text)]">See all organization tickets</span>
                    <span className="block text-xs text-[color:var(--text-muted)]">
                      Grants view/edit access to every team's tickets, cross-team ticket creation, and reassignment.
                    </span>
                  </span>
                </label>
                <button type="button" className="primary-button mt-2 w-full justify-center" onClick={addUser}>
                  {userFormPending ? 'Adding...' : 'Add User'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)]">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-[color:var(--card-bg)] text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Name</th>
                        <th className="px-4 py-3 font-semibold">Email</th>
                        <th className="px-4 py-3 font-semibold">Organization</th>
                        <th className="px-4 py-3 font-semibold">Team</th>
                        <th className="px-4 py-3 font-semibold">Role</th>
                        <th className="px-4 py-3 font-semibold">Org tickets</th>
                        <th className="px-4 py-3 text-right font-semibold">Edit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => {
                        const organizationName = getOrganizationById(user.organizationId)?.name ?? 'Organization'
                        const teamName = getTeamById(user.teamId)?.name ?? 'Team'
                        const isSelected = manageUsersEditDraft?.id === user.id

                        return (
                          <tr
                            key={user.id}
                            className={isSelected ? 'bg-[color:var(--card-bg)]' : 'border-t border-[color:var(--border)]'}
                          >
                            <td className="px-4 py-3 font-medium text-[color:var(--text)]">{user.name}</td>
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">{user.email}</td>
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">{organizationName}</td>
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">{teamName}</td>
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">{user.role}</td>
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">{user.canViewAllOrgTickets ? 'Yes' : 'No'}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                className="secondary-button px-3"
                                aria-label={`Edit ${user.name}`}
                                title={`Edit ${user.name}`}
                                onClick={() => openManageUsersEdit(user)}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {!manageUsersEditDraft && (
                  <div className="rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[color:var(--text-muted)]">
                    Select a user with the pencil icon to edit that record.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    )
  }

  const renderManageOrganizationsPage = () => {
    const isEditing = settingsDrawerTab === 'edit'

    return (
      <div className="space-y-4">
        <section className="surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Organizations</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Add organizations in the Add tab or edit existing records from the full-width table.
              </div>
            </div>
            <button type="button" className="secondary-button" onClick={() => setActiveView('settings')}>
              Back to Settings
            </button>
          </div>
        </section>

        <section className="surface overflow-hidden p-0">
          {renderManagementPageTabs()}

          <div className="p-5">
            {!isEditing ? (
              <div className="mx-auto max-w-3xl space-y-4 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-4">
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Organization name</div>
                  <input
                    className="input-control"
                    placeholder="Organization name"
                    value={organizationForm.name}
                    onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Code</div>
                  <input
                    className="input-control"
                    placeholder="Code"
                    value={organizationForm.code}
                    onChange={(event) => setOrganizationForm((current) => ({ ...current, code: event.target.value }))}
                  />
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Accent</div>
                  <input
                    type="color"
                    className="h-10 w-full rounded-[2px] border border-[color:var(--border)] bg-transparent p-1"
                    value={organizationForm.accent}
                    onChange={(event) => setOrganizationForm((current) => ({ ...current, accent: event.target.value }))}
                  />
                </label>
                  <button type="button" className="primary-button mt-2 w-full justify-center" onClick={addOrganization}>
                  Add Organization
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)]">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-[color:var(--card-bg)] text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Name</th>
                        <th className="px-4 py-3 font-semibold">Code</th>
                        <th className="px-4 py-3 font-semibold">Accent</th>
                        <th className="px-4 py-3 text-right font-semibold">Edit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {organizations.map((organization) => {
                        const isSelected = manageOrganizationEditDraft?.id === organization.id

                        return (
                          <tr
                            key={organization.id}
                            className={isSelected ? 'bg-[color:var(--card-bg)]' : 'border-t border-[color:var(--border)]'}
                          >
                            <td className="px-4 py-3 font-medium text-[color:var(--text)]">{organization.name}</td>
                            <td className="px-4 py-3 font-mono text-[color:var(--text-muted)]">{organization.code}</td>
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">
                              <span className="inline-flex items-center gap-2">
                                <span className="h-4 w-4 rounded-full border border-[color:var(--border)]" style={{ backgroundColor: organization.accent }} />
                                {organization.accent}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                className="secondary-button px-3"
                                aria-label={`Edit ${organization.name}`}
                                title={`Edit ${organization.name}`}
                                onClick={() => openManageOrganizationEdit(organization)}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {!manageOrganizationEditDraft && (
                  <div className="rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[color:var(--text-muted)]">
                    Select an organization with the pencil icon to edit that record.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    )
  }

  const renderManageTeamsPage = () => {
    const isEditing = settingsDrawerTab === 'edit'

    return (
      <div className="space-y-4">
        <section className="surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Manage Teams</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Add teams in the Add tab or edit existing records from the full-width table.
              </div>
            </div>
            <button type="button" className="secondary-button" onClick={() => setActiveView('settings')}>
              Back to Settings
            </button>
          </div>
        </section>

        <section className="surface overflow-hidden p-0">
          {renderManagementPageTabs()}

          <div className="p-5">
            {!isEditing ? (
              <div className="mx-auto max-w-3xl space-y-4 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-4">
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Organization</div>
                  <select
                    className="input-control"
                    value={teamForm.organizationId}
                    onChange={(event) => setTeamForm((current) => ({ ...current, organizationId: event.target.value }))}
                  >
                    {availableOrganizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Team name</div>
                  <input
                    className="input-control"
                    placeholder="Team name"
                    value={teamForm.name}
                    onChange={(event) => setTeamForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Code</div>
                  <input
                    className="input-control"
                    placeholder="Code"
                    value={teamForm.code}
                    onChange={(event) => setTeamForm((current) => ({ ...current, code: event.target.value }))}
                  />
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Accent</div>
                  <input
                    type="color"
                    className="h-10 w-full rounded-[2px] border border-[color:var(--border)] bg-transparent p-1"
                    value={teamForm.accent}
                    onChange={(event) => setTeamForm((current) => ({ ...current, accent: event.target.value }))}
                  />
                </label>
                  <button type="button" className="primary-button mt-2 w-full justify-center" onClick={addTeam}>
                  Add Team
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)]">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-[color:var(--card-bg)] text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Organization</th>
                        <th className="px-4 py-3 font-semibold">Team</th>
                        <th className="px-4 py-3 font-semibold">Code</th>
                        <th className="px-4 py-3 font-semibold">Accent</th>
                        <th className="px-4 py-3 text-right font-semibold">Edit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teams.map((team) => {
                        const isSelected = manageTeamEditDraft?.id === team.id

                        return (
                          <tr
                            key={team.id}
                            className={isSelected ? 'bg-[color:var(--card-bg)]' : 'border-t border-[color:var(--border)]'}
                          >
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">{getOrganizationById(team.organizationId)?.name ?? 'Organization'}</td>
                            <td className="px-4 py-3 font-medium text-[color:var(--text)]">{team.name}</td>
                            <td className="px-4 py-3 font-mono text-[color:var(--text-muted)]">{team.code}</td>
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">
                              <span className="inline-flex items-center gap-2">
                                <span className="h-4 w-4 rounded-full border border-[color:var(--border)]" style={{ backgroundColor: team.accent }} />
                                {team.accent}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                className="secondary-button px-3"
                                aria-label={`Edit ${team.name}`}
                                title={`Edit ${team.name}`}
                                onClick={() => openManageTeamEdit(team)}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {!manageTeamEditDraft && (
                  <div className="rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[color:var(--text-muted)]">
                    Select a team with the pencil icon to edit that record.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    )
  }

  const renderManageCategoriesPage = () => {
    const isEditing = settingsDrawerTab === 'edit'

    return (
      <div className="space-y-4">
        <section className="surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold">Categories</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Add categories in the Add tab or edit existing records from the full-width table.
              </div>
            </div>
            <button type="button" className="secondary-button" onClick={() => setActiveView('settings')}>
              Back to Settings
            </button>
          </div>
        </section>

        <section className="surface overflow-hidden p-0">
          {renderManagementPageTabs()}

          <div className="p-5">
            {!isEditing ? (
              <div className="mx-auto max-w-3xl space-y-4 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-4">
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Team</div>
                  <select
                    className="input-control"
                    value={categoryForm.teamId}
                    onChange={(event) => setCategoryForm((current) => ({ ...current, teamId: event.target.value }))}
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {(getOrganizationById(team.organizationId)?.name ?? 'Organization')} / {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Category name</div>
                  <input
                    className="input-control"
                    placeholder="Category name"
                    value={categoryForm.name}
                    onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>
                <label className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Description</div>
                  <input
                    className="input-control"
                    placeholder="Category description"
                    value={categoryForm.description}
                    onChange={(event) => setCategoryForm((current) => ({ ...current, description: event.target.value }))}
                  />
                </label>
                  <button type="button" className="primary-button mt-2 w-full justify-center" onClick={addCategory}>
                  Add Category
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="overflow-x-auto rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)]">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-[color:var(--card-bg)] text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Organization</th>
                        <th className="px-4 py-3 font-semibold">Team</th>
                        <th className="px-4 py-3 font-semibold">Category</th>
                        <th className="px-4 py-3 font-semibold">Description</th>
                        <th className="px-4 py-3 text-right font-semibold">Edit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.map((category) => {
                        const team = getTeamById(category.teamId)
                        const isSelected = manageCategoryEditDraft?.id === category.id

                        return (
                          <tr
                            key={category.id}
                            className={isSelected ? 'bg-[color:var(--card-bg)]' : 'border-t border-[color:var(--border)]'}
                          >
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">{getOrganizationById(team?.organizationId ?? '')?.name ?? 'Organization'}</td>
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">{team?.name ?? 'Team'}</td>
                            <td className="px-4 py-3 font-medium text-[color:var(--text)]">{category.name}</td>
                            <td className="px-4 py-3 text-[color:var(--text-muted)]">{category.description}</td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                className="secondary-button px-3"
                                aria-label={`Edit ${category.name}`}
                                title={`Edit ${category.name}`}
                                onClick={() => openManageCategoryEdit(category)}
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {!manageCategoryEditDraft && (
                  <div className="rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[color:var(--text-muted)]">
                    Select a category with the pencil icon to edit that record.
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    )
  }

  const refreshTicketFieldDefs = async () => {
    if (!currentUser.organizationId) return
    setTicketFieldDefsError('')
    try {
      const res = await fetch(apiUrl(`/api/organizations/${encodeURIComponent(currentUser.organizationId)}/ticket-fields`), { credentials: 'include' })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      const fields: TicketFieldDefinition[] = data.fields ?? []
      setTicketFieldDefs(fields)
      setLastSavedFieldDefs(fields)
    } catch {
      setTicketFieldDefsError('Failed to load ticket fields.')
    }
  }

  useEffect(() => {
    if (activeView === 'ticket-designer' && currentUser.organizationId) {
      void refreshTicketFieldDefs()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, currentUser.organizationId])

  const refreshTicketLayout = async () => {
    if (!currentUser.organizationId) return
    setTicketLayoutError('')
    try {
      const res = await fetch(apiUrl(`/api/organizations/${encodeURIComponent(currentUser.organizationId)}/ticket-layout`), { credentials: 'include' })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      let layout: TicketLayout | null = data.layout ?? null
      if (layout) {
        const seen = new Set<string>()
        let hasDuplicates = false
        const dedupedRows = layout.rows.map((row) => {
          if (seen.has(row.id)) {
            hasDuplicates = true
            return { ...row, id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
          }
          seen.add(row.id)
          return row
        })
        if (hasDuplicates) {
          layout = { rows: dedupedRows }
        }
      }
      setOrganizationTicketLayout(layout)
      setTicketLayoutDraft(layout)
      setLastSavedTicketLayout(layout)
    } catch {
      setTicketLayoutError('Failed to load ticket layout.')
    }
  }

  const ticketDesignerIsDirty =
    areTicketFieldDefsDirty(ticketFieldDefs, lastSavedFieldDefs) ||
    areTicketLayoutsDirty(ticketLayoutDraft, lastSavedTicketLayout)

  useEffect(() => {
    if (!ticketDesignerIsDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [ticketDesignerIsDirty])

  const renderTicketDesignerPage = () => {
    const FIELD_TYPES: { value: TicketFieldDefinition['fieldType']; label: string }[] = [
      { value: 'text', label: 'Text' },
      { value: 'select', label: 'Dropdown' },
      { value: 'checkbox', label: 'Checkbox' },
      { value: 'number', label: 'Number' },
      { value: 'date', label: 'Date' },
    ]

    const fieldsAreDirty = areTicketFieldDefsDirty(ticketFieldDefs, lastSavedFieldDefs)
    const layoutIsDirty = areTicketLayoutsDirty(ticketLayoutDraft, lastSavedTicketLayout)
    const isDirty = fieldsAreDirty || layoutIsDirty

    const handleAddField = () => {
      if (!ticketDesignerNewField.label?.trim()) return
      const fieldType = (ticketDesignerNewField.fieldType ?? 'text') as TicketFieldDefinition['fieldType']
      const optionsList = fieldType === 'select'
        ? ticketDesignerNewFieldOptions.split('\n').map((o) => o.trim()).filter(Boolean)
        : []
      const newField: TicketFieldDefinition = {
        id: `tfd-new-${Date.now()}`,
        organizationId: currentUser.organizationId,
        fieldType,
        label: ticketDesignerNewField.label.trim(),
        isRequired: ticketDesignerNewField.isRequired ?? false,
        sortOrder: ticketFieldDefs.length,
        options: optionsList,
      }
      const updated = [...ticketFieldDefs, newField]
      setTicketFieldDefs(updated)
      setTicketDesignerAddField(false)
      setTicketDesignerNewField({})
      setTicketDesignerNewFieldOptions('')
    }

    const handleDeleteField = (id: string) => {
      const updated = ticketFieldDefs.filter((f) => f.id !== id)
      setTicketFieldDefs(updated)
    }

    const handleMoveField = (id: string, direction: -1 | 1) => {
      const idx = ticketFieldDefs.findIndex((f) => f.id === id)
      if (idx < 0) return
      const newIdx = idx + direction
      if (newIdx < 0 || newIdx >= ticketFieldDefs.length) return
      const reordered = arrayMove(ticketFieldDefs, idx, newIdx)
      const updated = reordered.map((field, index) => ({ ...field, sortOrder: index }))
      setTicketFieldDefs(updated)
    }

    const handleToggleRequired = (id: string) => {
      const updated = ticketFieldDefs.map((f) => f.id === id ? { ...f, isRequired: !f.isRequired } : f)
      setTicketFieldDefs(updated)
    }

    const handleLayoutChange = (layout: TicketLayout) => {
      setTicketLayoutDraft(layout)
    }

    const handleLayoutReverted = (layout: TicketLayout) => {
      setOrganizationTicketLayout(layout)
      setTicketLayoutDraft(layout)
      setLastSavedTicketLayout(layout)
      setTicketLayoutNotice('Layout reverted.')
      setTimeout(() => setTicketLayoutNotice(''), 2500)
    }

    const handleSaveTicketDesignerOpen = async () => {
        const versionsRes = await fetch(apiUrl(`/api/organizations/${encodeURIComponent(currentUser.organizationId)}/ticket-layout/versions`), { credentials: 'include' })
        if (versionsRes.ok) {
          const vData = await versionsRes.json() as { versions?: Array<{ versionNumber: number }> }
          const maxVersion = (vData.versions ?? []).reduce((max, v) => Math.max(max, v.versionNumber), 0)
          setNextLayoutVersion(maxVersion + 1)
          setVersionConfirmOpen(true)
        } else {
          void handleSaveTicketDesigner('')
        }
      }

      const handleSaveTicketDesigner = async (description?: string) => {
      if (!currentUser.organizationId) return
      setTicketFieldDefsError('')
      setTicketLayoutError('')
      setTicketFieldDefsNotice('')
      setTicketLayoutNotice('')

      try {
        const fieldsRes = await fetch(apiUrl(`/api/organizations/${encodeURIComponent(currentUser.organizationId)}/ticket-fields`), {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: ticketFieldDefs }),
        })
        if (!fieldsRes.ok) throw new Error(await fieldsRes.text())
        const fieldsData = await fieldsRes.json()
        const savedFields: TicketFieldDefinition[] = fieldsData.fields ?? ticketFieldDefs
        setTicketFieldDefs(savedFields)
        setLastSavedFieldDefs(savedFields)

        const layoutToSave = ticketLayoutDraft ?? lastSavedTicketLayout
        if (layoutToSave) {
          const layoutRes = await fetch(apiUrl(`/api/organizations/${encodeURIComponent(currentUser.organizationId)}/ticket-layout`), {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ layout: layoutToSave, description: description ?? '' }),
          })
          if (!layoutRes.ok) throw new Error(await layoutRes.text())
          const layoutData = await layoutRes.json()
          const savedLayout: TicketLayout | null = layoutData.layout ?? layoutToSave
          setOrganizationTicketLayout(savedLayout)
          setTicketLayoutDraft(savedLayout)
          setLastSavedTicketLayout(savedLayout)
        }

        setTicketLayoutNotice('Saved.')
        setTimeout(() => setTicketLayoutNotice(''), 2500)
      } catch {
        setTicketLayoutError('Failed to save ticket designer changes.')
      }
    }

    return (
      <div className="space-y-4">
        <section className="surface p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-xl font-semibold">Ticket Designer</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Define custom fields and arrange the ticket form layout for your organization.
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isDirty && (
                <span className="text-xs font-semibold text-amber-600">Unsaved changes</span>
              )}
              <button
                type="button"
                className="primary-button"
                disabled={!isDirty}
                onClick={handleSaveTicketDesignerOpen}
              >
                Save
              </button>
            </div>
          </div>

          {(ticketFieldDefsError || ticketLayoutError) && (
            <div className="mb-3 rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {ticketFieldDefsError || ticketLayoutError}
            </div>
          )}
          {(ticketFieldDefsNotice || ticketLayoutNotice) && (
            <div className="mb-3 rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {ticketFieldDefsNotice || ticketLayoutNotice}
            </div>
          )}

          <div className="mb-5 flex gap-2 border-b border-[color:var(--border)]">
            <button
              type="button"
              className="tab-link px-3 py-2 text-sm font-semibold"
              data-active={ticketDesignerTab === 'fields'}
              onClick={() => setTicketDesignerTab('fields')}
            >
              Custom Fields
            </button>
            <button
              type="button"
              className="tab-link px-3 py-2 text-sm font-semibold"
              data-active={ticketDesignerTab === 'layout'}
              onClick={() => setTicketDesignerTab('layout')}
            >
              Layout
            </button>
            <button
              type="button"
              className="tab-link px-3 py-2 text-sm font-semibold"
              data-active={ticketDesignerTab === 'versions'}
              onClick={() => setTicketDesignerTab('versions')}
            >
              Versions
            </button>
          </div>

          {ticketDesignerTab === 'fields' && (
            <>
              {ticketFieldDefs.length === 0 && !ticketDesignerAddField && (
                <div className="mb-4 rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[color:var(--text-muted)]">
                  No custom fields defined for this organization. Add one below.
                </div>
              )}

              {ticketFieldDefs.length > 0 && (
                <div className="mb-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[color:var(--border)] text-left">
                        <th className="pb-2 pr-4 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Label</th>
                        <th className="pb-2 pr-4 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Type</th>
                        <th className="pb-2 pr-4 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Options</th>
                        <th className="pb-2 pr-4 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Required</th>
                        <th className="pb-2 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ticketFieldDefs.map((field, idx) => (
                        <tr key={field.id} className="border-b border-[color:var(--border)] last:border-0">
                          <td className="py-2 pr-4 font-medium">{field.label}</td>
                          <td className="py-2 pr-4 capitalize text-[color:var(--text-muted)]">{field.fieldType}</td>
                          <td className="py-2 pr-4 text-[color:var(--text-muted)]">
                            {field.options.length > 0 ? field.options.join(', ') : '—'}
                          </td>
                          <td className="py-2 pr-4">
                            <button
                              type="button"
                              onClick={() => handleToggleRequired(field.id)}
                              className={`inline-flex h-5 w-5 items-center justify-center rounded-[2px] border text-xs ${
                                field.isRequired
                                  ? 'border-[color:var(--accent)] bg-[color:var(--accent)] text-white'
                                  : 'border-[color:var(--border)]'
                              }`}
                              title={field.isRequired ? 'Required — click to make optional' : 'Optional — click to make required'}
                            >
                              {field.isRequired && <Check className="h-3 w-3" />}
                            </button>
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMoveField(field.id, -1)}
                                className="rounded p-1 hover:bg-[color:var(--surface-hover)] disabled:opacity-30"
                                title="Move up"
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === ticketFieldDefs.length - 1}
                                onClick={() => handleMoveField(field.id, 1)}
                                className="rounded p-1 hover:bg-[color:var(--surface-hover)] disabled:opacity-30"
                                title="Move down"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteField(field.id)}
                                className="rounded p-1 text-rose-500 hover:bg-rose-50"
                                title="Delete field"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {ticketDesignerAddField ? (
                <div className="rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-4 space-y-3">
                  <div className="text-sm font-semibold">New Field</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Label</div>
                      <input
                        className="input-control"
                        placeholder="Field label"
                        value={ticketDesignerNewField.label ?? ''}
                        onChange={(e) => setTicketDesignerNewField((p) => ({ ...p, label: e.target.value }))}
                      />
                    </label>
                    <label className="space-y-1">
                      <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Type</div>
                      <select
                        className="input-control"
                        value={ticketDesignerNewField.fieldType ?? 'text'}
                        onChange={(e) =>
                          setTicketDesignerNewField((p) => ({
                            ...p,
                            fieldType: e.target.value as TicketFieldDefinition['fieldType'],
                          }))
                        }
                      >
                        {FIELD_TYPES.map((ft) => (
                          <option key={ft.value} value={ft.value}>{ft.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {(ticketDesignerNewField.fieldType ?? 'text') === 'select' && (
                    <label className="space-y-1">
                      <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                        Options (one per line)
                      </div>
                      <textarea
                        className="input-control min-h-[80px]"
                        placeholder={"Virtual\nIn-Person"}
                        value={ticketDesignerNewFieldOptions}
                        onChange={(e) => setTicketDesignerNewFieldOptions(e.target.value)}
                      />
                    </label>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ticketDesignerNewField.isRequired ?? false}
                      onChange={(e) => setTicketDesignerNewField((p) => ({ ...p, isRequired: e.target.checked }))}
                    />
                    Required field
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!ticketDesignerNewField.label?.trim() || ticketFieldDefsPending}
                      onClick={handleAddField}
                    >
                      Add Field
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setTicketDesignerAddField(false)
                        setTicketDesignerNewField({})
                        setTicketDesignerNewFieldOptions('')
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setTicketDesignerAddField(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add Field
                </button>
              )}
            </>
          )}

          {ticketDesignerTab === 'layout' && ticketLayoutDraft && (
            <TicketLayoutDesigner
              layout={ticketLayoutDraft}
              customFieldDefs={ticketFieldDefs}
              onChange={handleLayoutChange}
            />
          )}

          {ticketDesignerTab === 'layout' && !ticketLayoutDraft && (
            <div className="rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-8 text-center text-sm text-[color:var(--text-muted)]">
              Loading layout…
            </div>
          )}

          {ticketDesignerTab === 'versions' && currentUser.organizationId && (
            <TicketLayoutVersionHistory
              organizationId={currentUser.organizationId}
              customFieldDefs={ticketFieldDefs}
              currentLayout={ticketLayoutDraft}
              onLayoutReverted={handleLayoutReverted}
            />
          )}

          <VersionConfirmDialog
            open={versionConfirmOpen}
            nextVersion={nextLayoutVersion}
            onCancel={() => setVersionConfirmOpen(false)}
            onConfirm={(description) => {
              setVersionConfirmOpen(false)
              void handleSaveTicketDesigner(description)
            }}
          />
        </section>
      </div>
    )
  }

  const renderSettingsDrawerContent = (section: ManagementDrawerSection) => {
    switch (section) {
      case 'manageOrganizations':
        return renderManageOrganizationsEditPanelContent()
      case 'manageUsers':
        if (settingsDrawerTab === 'edit') {
          return renderManageUsersEditPanelContent()
        }
        return (
          <div>
            {renderSettingsDrawerTabs()}
            <div className="space-y-4 p-5">
              {userDirectoryError && (
                <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {userDirectoryError}
                </div>
              )}
              {userDirectoryNotice && (
                <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {userDirectoryNotice}
                </div>
              )}
              {settingsDrawerTab === 'add' ? (
                <div className="space-y-4 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] p-4">
                  <label className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Full name</div>
                    <input
                      className="input-control"
                      placeholder="Full name"
                      value={userForm.name}
                      onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Email</div>
                    <input
                      className="input-control"
                      placeholder="Email"
                      value={userForm.email}
                      onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                    />
                  </label>
                  <label className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Organization</div>
                    <select
                      className="input-control"
                      value={userForm.organizationId}
                      onChange={(event) => {
                        const nextOrganizationId = event.target.value
                        setUserForm((current) => ({
                          ...current,
                          organizationId: nextOrganizationId,
                          teamId: getFirstTeamIdForOrganization(availableTeams, nextOrganizationId),
                        }))
                      }}
                    >
                      {availableOrganizations.map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {organization.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Team</div>
                    <select
                      className="input-control"
                      value={userForm.teamId}
                      onChange={(event) => setUserForm((current) => ({ ...current, teamId: event.target.value }))}
                    >
                      {getTeamsForOrganization(availableTeams, userForm.organizationId).map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Role</div>
                    <select
                      className="input-control"
                      value={userForm.role}
                      onChange={(event) =>
                        setUserForm((current) => ({ ...current, role: event.target.value as User['role'] }))
                      }
                    >
                      <option value="Admin">Admin</option>
                      {superAdminEnabled && <option value="Super Admin">Super Admin</option>}
                      <option value="Staff">Staff</option>
                    </select>
                  </label>
                  <label className="flex items-start gap-2 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={userForm.canViewAllOrgTickets}
                      onChange={(event) =>
                        setUserForm((current) => ({ ...current, canViewAllOrgTickets: event.target.checked }))
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium text-[color:var(--text)]">See all organization tickets</span>
                      <span className="block text-xs text-[color:var(--text-muted)]">
                        Grants view/edit access to every team's tickets, cross-team ticket creation, and reassignment.
                      </span>
                    </span>
                  </label>
                  <button type="button" className="primary-button w-full justify-center" onClick={addUser}>
                    {userFormPending ? 'Adding...' : 'Add User'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {users.map((user) => (
                    <div
                      key={user.id}
                      className="surface-muted grid gap-3 p-3 md:grid-cols-[1.1fr_1.2fr_0.9fr_0.9fr_0.8fr_auto_auto] md:items-center"
                    >
                      <input
                        className="input-control"
                        value={user.name}
                        onChange={(event) => updateUser(user.id, 'name', event.target.value)}
                        onBlur={() => void persistUser(user)}
                      />
                      <input
                        className="input-control"
                        value={user.email}
                        onChange={(event) => updateUser(user.id, 'email', event.target.value)}
                        onBlur={() => void persistUser(user)}
                      />
                      <select
                        className="input-control"
                        value={user.organizationId}
                        onChange={(event) => {
                          const nextOrganizationId = event.target.value
                          const nextTeamId = getFirstTeamIdForOrganization(availableTeams, nextOrganizationId)
                          const nextUser = {
                            ...user,
                            organizationId: nextOrganizationId,
                            teamId: nextTeamId,
                          }
                          updateUser(user.id, 'organizationId', nextOrganizationId)
                          updateUser(user.id, 'teamId', nextTeamId)
                          void persistUser(nextUser)
                        }}
                      >
                        {availableOrganizations.map((organization) => (
                          <option key={organization.id} value={organization.id}>
                            {organization.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className="input-control"
                        value={user.teamId}
                        onChange={(event) => {
                          const nextUser = {
                            ...user,
                            teamId: event.target.value,
                          }
                          updateUser(user.id, 'teamId', event.target.value)
                          void persistUser(nextUser)
                        }}
                      >
                        {getTeamsForOrganization(availableTeams, user.organizationId).map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                      <select
                        className="input-control"
                        value={user.role}
                        onChange={(event) => {
                          const nextUser = {
                            ...user,
                            role: event.target.value as User['role'],
                          }
                          updateUser(user.id, 'role', event.target.value)
                          void persistUser(nextUser)
                        }}
                      >
                        <option value="Admin">Admin</option>
                        {superAdminEnabled && <option value="Super Admin">Super Admin</option>}
                        <option value="Staff">Staff</option>
                      </select>
                      {user.name !== 'Administrator' && (
                        <button
                          type="button"
                          className="secondary-button whitespace-nowrap"
                          onClick={() => {
                            setChangePasswordValue('')
                            setChangePasswordError('')
                            setChangePasswordModal({ userId: user.id, userName: user.name })
                          }}
                        >
                          Change Password
                        </button>
                      )}
                      <div className="text-right text-xs text-[color:var(--text-muted)]">
                        {userSavePendingIds.includes(user.id) ? 'Saving...' : 'Saved'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      case 'manageTeams':
        return renderManageTeamsEditPanelContent()
      case 'categories':
        return renderManageCategoriesEditPanelContent()
    }
  }

  const renderSettingsAccordionSection = (section: SettingsAccordionSection) => {
    const isOpen = settingsAccordions[section]

    const renderAccordionBody = () => {
      switch (section) {
        case 'appearance':
          return (
            <div className="settings-accordion-content">
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ['appBg', 'App'],
                    ['headerBg', 'Header'],
                    ['menuBg', 'Menu'],
                    ['cardBg', 'Cards'],
                    ['buttonBg', 'Buttons'],
                    ['accent', 'Accent'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="field">
                    <span className="field-label">{label}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        className="h-10 w-14 rounded-[2px] border border-[color:var(--border)] bg-transparent p-1"
                        value={themeConfig[settingsMode][key]}
                        onChange={(event) => updateThemeColor(settingsMode, key, event.target.value)}
                      />
                      <input
                        className="input-control font-mono"
                        value={themeConfig[settingsMode][key]}
                        onChange={(event) => updateThemeColor(settingsMode, key, event.target.value)}
                      />
                    </div>
                  </label>
                ))}
              </div>

              <div className="mt-4 flex w-fit items-center overflow-hidden rounded-[2px] border border-[color:var(--border)]">
                <button
                  type="button"
                  className="view-toggle"
                  data-active={settingsMode === 'light'}
                  onClick={() => setSettingsMode('light')}
                >
                  Light
                </button>
                <button
                  type="button"
                  className="view-toggle"
                  data-active={settingsMode === 'dark'}
                  onClick={() => setSettingsMode('dark')}
                >
                  Dark
                </button>
              </div>
            </div>
          )
        case 'authentication':
          return (
            <div className="settings-accordion-content space-y-3">
              {currentUser.role === 'Super Admin' && (
              <>
              <div className="text-sm text-[color:var(--text-muted)]">
                Control whether users can see and use Rapid Identity Sign-In on the login page.
              </div>
              <label className="flex items-center gap-3 rounded-[2px] border border-[color:var(--border)] p-3">
                <input
                  type="checkbox"
                  checked={rapidIdentityEnabled}
                  disabled={authSettingsPending}
                  onChange={(event) => {
                    const nextEnabled = event.target.checked
                    setRapidIdentityEnabled(nextEnabled)
                    void updateRapidIdentityVisibility(nextEnabled)
                  }}
                />
                <div>
                  <div className="text-sm font-semibold text-[color:var(--text)]">
                    Show Rapid Identity Sign-In
                  </div>
                  <div className="text-xs text-[color:var(--text-muted)]">
                    When disabled, the login page will only show local email sign-in.
                  </div>
                </div>
              </label>
              {authSettingsPending && (
                <div className="text-xs text-[color:var(--text-muted)]">Saving authentication setting...</div>
              )}
              {authSettingsError && (
                <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {authSettingsError}
                </div>
              )}
              </>
              )}
              {currentUser.role !== 'Super Admin' && (
                <div className="text-sm text-[color:var(--text-muted)]">
                  Rapid Identity visibility is managed by Super Admins. Use the Login Mode section below to control the public sign-in page.
                </div>
              )}
            </div>
          )
        case 'loginMode':
          return (
            <div className="settings-accordion-content space-y-3">
              <div className="text-sm text-[color:var(--text-muted)]">
                Controls what the public login page shows. Applies app-wide for every organization.
              </div>

              {loginModeOverride && (
                <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Login mode is locked by the <span className="font-mono">LOGIN_MODE</span> environment variable
                  ({loginModeOverride}). Remove or change that env var to unlock this toggle.
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-3">
                {LOGIN_MODE_OPTIONS.map((option) => {
                  const isActive = (loginMode ?? 'select') === option.value
                  const locked = Boolean(loginModeOverride) || loginModeSaving
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={locked}
                      onClick={() => void handleLoginModeToggle(option.value)}
                      className={`rounded-[2px] border px-3 py-3 text-left transition ${
                        isActive
                          ? 'border-[color:var(--accent)] bg-[color:var(--panel-bg)] ring-1 ring-[color:var(--accent)]'
                          : 'border-[color:var(--border)] hover:bg-[color:var(--panel-bg)]'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <div className="text-sm font-semibold text-[color:var(--text)]">{option.label}</div>
                      <div className="mt-1 text-xs text-[color:var(--text-muted)]">{option.description}</div>
                    </button>
                  )
                })}
              </div>

              {loginModeSaving && (
                <div className="text-xs text-[color:var(--text-muted)]">Saving login mode...</div>
              )}
              {loginModeSaved && !loginModeError && (
                <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  Login mode saved.
                </div>
              )}
              {loginModeError && (
                <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {loginModeError}
                </div>
              )}

              {(loginMode ?? 'select') === 'maintenance' && (
                <div className="space-y-2 rounded-[2px] border border-[color:var(--border)] p-3">
                  <label className="field">
                    <span className="field-label">Maintenance message</span>
                    <textarea
                      className="input-control min-h-24"
                      value={maintenanceMessageDraft}
                      disabled={Boolean(loginModeOverride) || maintenanceMessageSaving}
                      onChange={(event) => {
                        setMaintenanceMessageDraft(event.target.value)
                        setMaintenanceMessageSaved(false)
                        setMaintenanceMessageError('')
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={Boolean(loginModeOverride) || maintenanceMessageSaving}
                    onClick={() => void saveMaintenanceMessage()}
                  >
                    {maintenanceMessageSaving ? 'Saving...' : 'Save Message'}
                  </button>
                  {maintenanceMessageSaved && !maintenanceMessageError && (
                    <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      Maintenance message saved.
                    </div>
                  )}
                  {maintenanceMessageError && (
                    <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {maintenanceMessageError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        case 'anonymousPages':
          return (
            <div className="settings-accordion-content space-y-3">
              {currentUser.role !== 'Admin' && currentUser.role !== 'Super Admin' ? (
                <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Administrator access is required to manage anonymous page mappings.
                </div>
              ) : (
                <>
                  <div className="text-sm text-[color:var(--text-muted)]">
                    Map each anonymous page file to an organization. The public form uses the page mapping automatically and does not ask the requestor to pick an organization.
                  </div>
                  {anonymousPageConfigs.map((page) => (
                    <div key={page.id} className="surface-muted grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                      <label className="space-y-2">
                        <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Entry Name</div>
                        <input
                          className="input-control"
                          value={page.name}
                          onChange={(event) =>
                            updateAnonymousPageConfig(page.id, (current) => ({ ...current, name: event.target.value }))
                          }
                          placeholder="Legacy Default"
                        />
                      </label>
                      <label className="space-y-2">
                        <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Page File</div>
                        <input
                          className="input-control"
                          value={page.pagePath}
                          onChange={(event) =>
                            updateAnonymousPageConfig(page.id, (current) => ({ ...current, pagePath: event.target.value }))
                          }
                          placeholder="index2.html"
                        />
                      </label>
                      <label className="space-y-2">
                        <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Organization</div>
                        <select
                          className="input-control"
                          value={page.organizationId}
                          onChange={(event) =>
                            updateAnonymousPageConfig(page.id, (current) => ({ ...current, organizationId: event.target.value }))
                          }
                        >
                          {organizations.map((organization) => (
                            <option key={organization.id} value={organization.id}>
                              {organization.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="flex items-center gap-3 justify-self-end">
                        <a
                          className="secondary-button"
                          href={getAnonymousPageUrl(page.pagePath)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Page
                        </a>
                        <label className="flex items-center gap-2 text-sm text-[color:var(--text-muted)]">
                          <input
                            type="checkbox"
                            checked={page.enabled}
                            onChange={(event) =>
                              updateAnonymousPageConfig(page.id, (current) => ({ ...current, enabled: event.target.checked }))
                            }
                          />
                          Enabled
                        </label>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            setAnonymousPageConfigs((current) => current.filter((entry) => entry.id !== page.id))
                            setAnonymousPageSettingsError('')
                            setAnonymousPageSettingsNotice('')
                          }}
                          disabled={anonymousPageConfigs.length === 1 || anonymousPageSettingsPending}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="md:col-span-4 text-xs text-[color:var(--text-muted)]">
                        Public URL:{' '}
                        <a
                          className="underline"
                          href={getAnonymousPageUrl(page.pagePath)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {getAnonymousPageUrl(page.pagePath)}
                        </a>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setAnonymousPageConfigs((current) => [
                          ...current,
                          createAnonymousPageDraft(organizations[0]?.id ?? '', current),
                        ])
                        setAnonymousPageSettingsError('')
                        setAnonymousPageSettingsNotice('')
                      }}
                      disabled={organizations.length === 0 || anonymousPageSettingsPending}
                    >
                      Add Anonymous Page
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void saveAnonymousPageSettings()}
                      disabled={anonymousPageSettingsPending || anonymousPageConfigs.length === 0}
                    >
                      {anonymousPageSettingsPending ? 'Saving...' : 'Save Anonymous Pages'}
                    </button>
                  </div>
                  {anonymousPageSettingsError && (
                    <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {anonymousPageSettingsError}
                    </div>
                  )}
                  {anonymousPageSettingsNotice && (
                    <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {anonymousPageSettingsNotice}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        case 'manageOrganizations':
          return renderSettingsPageLauncher(
            'Organizations',
            `${organizations.length} organization${organizations.length === 1 ? '' : 's'} available.`,
            openManageOrganizationsPage,
          )
        case 'manageUsers':
          return (
            <div className="settings-accordion-content space-y-3">
              {!directoryLoaded ? (
                <div className="text-sm text-[color:var(--text-muted)]">Loading users...</div>
              ) : (
                <>
              <div className="overflow-x-auto rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)]">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-[color:var(--card-bg)] text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Email</th>
                      <th className="px-4 py-3 font-semibold">Team</th>
                      <th className="px-4 py-3 font-semibold">Role</th>
                      <th className="px-4 py-3 text-right font-semibold">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id} className="border-t border-[color:var(--border)]">
                        <td className="px-4 py-3 font-medium text-[color:var(--text)]">{user.name}</td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)]">{user.email}</td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)]">{getTeamById(user.teamId)?.name ?? 'Team'}</td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)]">{user.role}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className="secondary-button px-3"
                            aria-label={`Edit ${user.name}`}
                            title={`Edit ${user.name}`}
                            onClick={() => openManageUsersEdit(user)}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {users.length === 0 && (
                <div className="rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[color:var(--text-muted)]">
                  No users yet. Add your first user below.
                </div>
              )}
              <button type="button" className="primary-button" onClick={openManageUsersPage}>
                Add User
              </button>
                </>
              )}
            </div>
          )
        case 'manageTeams':
          return (
            <div className="settings-accordion-content space-y-3">
              {!directoryLoaded ? (
                <div className="text-sm text-[color:var(--text-muted)]">Loading teams...</div>
              ) : (
                <>
              <div className="overflow-x-auto rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)]">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-[color:var(--card-bg)] text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Team</th>
                      <th className="px-4 py-3 font-semibold">Code</th>
                      <th className="px-4 py-3 font-semibold">Accent</th>
                      <th className="px-4 py-3 text-right font-semibold">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teams.map((team) => (
                      <tr key={team.id} className="border-t border-[color:var(--border)]">
                        <td className="px-4 py-3 font-medium text-[color:var(--text)]">{team.name}</td>
                        <td className="px-4 py-3 font-mono text-[color:var(--text-muted)]">{team.code}</td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)]">
                          <span className="inline-flex items-center gap-2">
                            <span className="h-4 w-4 rounded-full border border-[color:var(--border)]" style={{ backgroundColor: team.accent }} />
                            {team.accent}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className="secondary-button px-3"
                            aria-label={`Edit ${team.name}`}
                            title={`Edit ${team.name}`}
                            onClick={() => openManageTeamEdit(team)}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {teams.length === 0 && (
                <div className="rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[color:var(--text-muted)]">
                  No teams yet. Add your first team below.
                </div>
              )}
              <button type="button" className="primary-button" onClick={openManageTeamsPage}>
                Add Team
              </button>
                </>
              )}
            </div>
          )
        case 'trendSeeding':
          return (
            <div className="settings-accordion-content space-y-3">
              {currentUser.role !== 'Admin' && currentUser.role !== 'Super Admin' ? (
                <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Administrator access is required to seed dashboard trend history.
                </div>
              ) : (
                <>
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Generate or clear chart-only history for Ticket Trend by Team. This does not create or modify ticket records.
                  </p>
                  {trendSeedError && (
                    <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {trendSeedError}
                    </div>
                  )}
                  {trendSeedNotice && (
                    <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {trendSeedNotice}
                    </div>
                  )}
                  <div className="surface-muted grid gap-3 p-4 md:grid-cols-[0.9fr_1.1fr_auto_auto] md:items-end">
                    <label className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                        Days of trend history
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        className="input-control"
                        value={trendSeedDays}
                        onChange={(event) => setTrendSeedDays(Number(event.target.value))}
                      />
                    </label>
                    <label className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                        Category target
                      </div>
                      <select
                        className="input-control"
                        value={trendSeedCategoryId}
                        onChange={(event) => setTrendSeedCategoryId(event.target.value)}
                      >
                        <option value="">All categories / all teams</option>
                        {categories.map((category) => {
                          const teamName = teams.find((team) => team.id === category.teamId)?.name ?? category.teamId

                          return (
                            <option key={category.id} value={category.id}>
                              {category.name} ({teamName})
                            </option>
                          )
                        })}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={trendSeedPendingAction !== null}
                      onClick={() => void submitTrendSeedAction('seed')}
                    >
                      {trendSeedPendingAction === 'seed' ? 'Seeding...' : 'Seed Trend History'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={trendSeedPendingAction !== null}
                      onClick={() => void submitTrendSeedAction('clear')}
                    >
                      {trendSeedPendingAction === 'clear' ? 'Clearing...' : 'Clear Seeded History'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        case 'ticketSeeding':
          return (
            <div className="settings-accordion-content space-y-3">
              {currentUser.role !== 'Admin' && currentUser.role !== 'Super Admin' ? (
                <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Administrator access is required to seed sample tickets.
                </div>
              ) : (
                <>
                  <p className="text-sm text-[color:var(--text-muted)]">
                    Generate 10 random tickets in the current organization for testing or demos. Tickets are created as Open and can be randomly assigned to staff.
                  </p>
                  {ticketSeedError && (
                    <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {ticketSeedError}
                    </div>
                  )}
                  {ticketSeedNotice && (
                    <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {ticketSeedNotice}
                    </div>
                  )}
                  <div className="surface-muted grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] md:items-end">
                    <label className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                        Target team
                      </div>
                      <select
                        className="input-control"
                        value={ticketSeedTeamId}
                        onChange={(event) => setTicketSeedTeamId(event.target.value)}
                      >
                        <option value="">All teams in organization</option>
                        {teams
                          .filter((team) => team.organizationId === currentUser.organizationId)
                          .map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-3 md:pb-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={ticketSeedAssignEnabled}
                        onChange={(event) => setTicketSeedAssignEnabled(event.target.checked)}
                      />
                      <span className="text-sm text-[color:var(--text)]">Randomly assign ~25% to staff</span>
                    </label>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={ticketSeedPending}
                      onClick={() => void submitTicketSeedAction()}
                    >
                      {ticketSeedPending ? 'Seeding...' : 'Seed 10 Tickets'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )
        case 'categories':
          return (
            <div className="settings-accordion-content space-y-3">
              {!directoryLoaded ? (
                <div className="text-sm text-[color:var(--text-muted)]">Loading categories...</div>
              ) : (
                <>
              <div className="overflow-x-auto rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)]">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead className="bg-[color:var(--card-bg)] text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Team</th>
                      <th className="px-4 py-3 font-semibold">Category</th>
                      <th className="px-4 py-3 font-semibold">Description</th>
                      <th className="px-4 py-3 text-right font-semibold">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((category) => {
                      const team = getTeamById(category.teamId)
                      return (
                        <tr key={category.id} className="border-t border-[color:var(--border)]">
                          <td className="px-4 py-3 text-[color:var(--text-muted)]">{team?.name ?? 'Team'}</td>
                          <td className="px-4 py-3 font-medium text-[color:var(--text)]">{category.name}</td>
                          <td className="px-4 py-3 text-[color:var(--text-muted)]">{category.description}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              className="secondary-button px-3"
                              aria-label={`Edit ${category.name}`}
                              title={`Edit ${category.name}`}
                              onClick={() => openManageCategoryEdit(category)}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {categories.length === 0 && (
                <div className="rounded-[2px] border border-dashed border-[color:var(--border)] px-4 py-5 text-sm text-[color:var(--text-muted)]">
                  No categories yet. Add your first category below.
                </div>
              )}
              <button type="button" className="primary-button" onClick={openManageCategoriesPage}>
                Add Category
              </button>
                </>
              )}
            </div>
          )
          return (
            <div className="settings-accordion-content space-y-3">
              {currentUser.role !== 'Admin' && currentUser.role !== 'Super Admin' ? (
                <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Administrator access is required to manage locations.
                </div>
              ) : (
                <>
                  <div className="text-sm text-[color:var(--text-muted)]">
                    Add, edit, or deactivate locations. Deactivated locations are hidden from ticket forms but preserved on existing tickets. Locations referenced by tickets cannot be deleted.
                  </div>
                  {locationsError && (
                    <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {locationsError}
                    </div>
                  )}
                  {locationsNotice && (
                    <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {locationsNotice}
                    </div>
                  )}
                  {/* Add form */}
                  <div className="surface-muted flex items-end gap-2 p-3">
                    <label className="flex-1 space-y-1">
                      <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">New location name</div>
                      <input
                        className="input-control"
                        placeholder="e.g. Adams Elementary School"
                        value={locationAddName}
                        onChange={(event) => setLocationAddName(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter') void addLocation() }}
                        disabled={locationsPending}
                      />
                    </label>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={locationsPending || !locationAddName.trim()}
                      onClick={() => void addLocation()}
                    >
                      {locationsPending ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                  {/* Location list */}
                  <div className="space-y-1">
                    {allLocations.length === 0 && (
                      <div className="text-sm text-[color:var(--text-muted)]">No locations yet.</div>
                    )}
                    {allLocations.map((loc) => (
                      <div
                        key={loc.id}
                        className="surface-muted flex flex-wrap items-center gap-2 px-3 py-2"
                        data-inactive={!loc.isActive || undefined}
                        style={!loc.isActive ? { opacity: 0.55 } : undefined}
                      >
                        {locationEditId === loc.id ? (
                          <>
                            <input
                              className="input-control flex-1"
                              value={locationEditName}
                              onChange={(event) => setLocationEditName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void saveLocationEdit(loc.id)
                                if (event.key === 'Escape') { setLocationEditId(null); setLocationEditName('') }
                              }}
                              disabled={locationsPending}
                              autoFocus
                            />
                            <button
                              type="button"
                              className="primary-button"
                              disabled={locationsPending || !locationEditName.trim()}
                              onClick={() => void saveLocationEdit(loc.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => { setLocationEditId(null); setLocationEditName('') }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm">{loc.name}</span>
                            {!loc.isActive && (
                              <span className="rounded-[2px] border border-[color:var(--border)] px-2 py-0.5 text-xs text-[color:var(--text-muted)]">
                                Inactive
                              </span>
                            )}
                            <button
                              type="button"
                              className="secondary-button text-xs"
                              onClick={() => { setLocationEditId(loc.id); setLocationEditName(loc.name); setLocationsError(''); setLocationsNotice('') }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="secondary-button text-xs"
                              onClick={() => void toggleLocationActive(loc)}
                            >
                              {loc.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              className="secondary-button text-xs text-rose-600 hover:text-rose-700"
                              onClick={() => void removeLocation(loc.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        case 'email':
          return (
            <div className="settings-accordion-content space-y-3">
              {authSession?.role !== 'Admin' && authSession?.role !== 'Super Admin' ? (
                <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Administrator access is required to manage email settings.
                </div>
              ) : (
                <>
                  <div className="text-sm text-[color:var(--text-muted)]">
                    Configure outbound email via Resend. Gmail IMAP is optional for inbound reply parsing. Credentials are read from environment variables.
                  </div>
                  <label className="flex items-center gap-3 rounded-[2px] border border-[color:var(--border)] p-3">
                    <input
                      type="checkbox"
                      checked={emailNotificationsEnabled}
                      disabled={emailSettingsPending}
                      onChange={(e) => void updateEmailNotificationsEnabled(e.target.checked)}
                    />
                    <div>
                      <div className="text-sm font-semibold text-[color:var(--text)]">Enable email notifications</div>
                      <div className="text-xs text-[color:var(--text-muted)]">
                        When enabled, ticket updates will trigger outbound emails via Resend.
                      </div>
                    </div>
                  </label>
                  {emailSettingsPending && (
                    <div className="text-xs text-[color:var(--text-muted)]">Saving email setting...</div>
                  )}
                  {emailSettingsError && (
                    <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {emailSettingsError}
                    </div>
                  )}
                  {emailConfig && (
                    <div className="surface-muted grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 rounded-[2px] p-3 text-sm">
                      <span className="text-[color:var(--text-muted)]">From address</span>
                      <span className="font-mono text-[color:var(--text)]">{emailConfig.from ?? <em>not set</em>}</span>
                      <span className="text-[color:var(--text-muted)]">Reply-to</span>
                      <span className="font-mono text-[color:var(--text)]">{emailConfig.replyTo ?? <em>not set</em>}</span>
                      {emailConfig.imapConfigured && (
                        <>
                          <span className="text-[color:var(--text-muted)]">IMAP poll interval</span>
                          <span className="text-[color:var(--text)]">{emailConfig.pollIntervalSeconds}s</span>
                        </>
                      )}
                      <span className="text-[color:var(--text-muted)]">Resend status</span>
                      <span>
                        {emailConfig.configured ? (
                          <span className="rounded-[2px] bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                            Configured
                          </span>
                        ) : (
                          <span className="rounded-[2px] bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            Missing env vars
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-4">
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={emailTestResendPending}
                        onClick={() => void runEmailTestResend()}
                      >
                        {emailTestResendPending ? 'Sending…' : 'Test Resend'}
                      </button>
                      {emailTestResendResult && (
                        <div
                          className={`rounded-[2px] px-3 py-2 text-xs ${
                            emailTestResendResult.ok
                              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border border-rose-200 bg-rose-50 text-rose-700'
                          }`}
                        >
                          {emailTestResendResult.message}
                        </div>
                      )}
                    </div>
                    {emailConfig?.imapConfigured && (
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={emailTestImapPending}
                          onClick={() => void runEmailTestImap()}
                        >
                          {emailTestImapPending ? 'Connecting…' : 'Test Gmail IMAP'}
                        </button>
                        {emailTestImapResult && (
                          <div
                            className={`rounded-[2px] px-3 py-2 text-xs ${
                              emailTestImapResult.ok
                                ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                                : 'border border-rose-200 bg-rose-50 text-rose-700'
                            }`}
                          >
                            {emailTestImapResult.message}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )

        case 'powerBi':
          return (
            <div className="settings-accordion-content space-y-3">
              {authSession?.role !== 'Admin' && authSession?.role !== 'Super Admin' ? (
                <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Administrator access is required to manage Power BI settings.
                </div>
              ) : (
                <>
                  <div className="text-sm text-[color:var(--text-muted)]">
                    Add the public report URL used by the Reports page embed. The link must be reachable in an iframe and must be a Publish to web link.
                  </div>
                  <div className="surface-muted space-y-3 rounded-[2px] p-4">
                    <label className="field">
                      <span className="field-label">Power BI report URL</span>
                      <input
                        type="url"
                        className="input-control"
                        value={powerBiReportDraft}
                        onChange={(event) => {
                          setPowerBiReportDraft(event.target.value)
                          setPowerBiSettingsError('')
                          setPowerBiSettingsNotice('')
                        }}
                        placeholder="https://app.powerbi.com/..."
                        disabled={powerBiSettingsPending}
                      />
                    </label>
                    <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      Administrator note: the Power BI URL must be a Publish to web link.
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void savePowerBiSettings(powerBiReportDraft)}
                        disabled={powerBiSettingsPending}
                      >
                        {powerBiSettingsPending ? 'Saving...' : 'Save Power BI Link'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void savePowerBiSettings(null)}
                        disabled={powerBiSettingsPending || !powerBiReportUrl}
                      >
                        Clear Link
                      </button>
                    </div>
                    {powerBiReportUrl && (
                      <div className="text-xs text-[color:var(--text-muted)] break-all">
                        Current linked report: {powerBiReportUrl}
                      </div>
                    )}
                  </div>
                  {powerBiSettingsError && (
                    <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {powerBiSettingsError}
                    </div>
                  )}
                  {powerBiSettingsNotice && (
                    <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {powerBiSettingsNotice}
                    </div>
                  )}
                </>
              )}
            </div>
          )

        case 'aboutPage':
          return (
            <div className="settings-accordion-content space-y-3">
              {authSession?.role !== 'Admin' && authSession?.role !== 'Super Admin' ? (
                <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Administrator access is required to manage the About page.
                </div>
              ) : (
                <>
                  <div className="text-sm text-[color:var(--text-muted)]">
                    Enter the HTML content shown on the About page. Users can access it from the profile menu in the header.
                  </div>
                  <div className="surface-muted space-y-3 rounded-[2px] p-4">
                    <div className="field">
                      <span className="field-label">About page content</span>
                      <RichTextEditor
                        value={aboutPageDraft}
                        onChange={(html) => {
                          setAboutPageDraft(html)
                          setAboutPageError('')
                          setAboutPageNotice('')
                        }}
                        disabled={aboutPagePending}
                        placeholder="Enter your about page content here..."
                      />
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void saveAboutSettings(aboutPageDraft)}
                        disabled={aboutPagePending}
                      >
                        {aboutPagePending ? 'Saving...' : 'Save About Page'}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void saveAboutSettings('')}
                        disabled={aboutPagePending || !aboutPageHtml}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  {aboutPageError && (
                    <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {aboutPageError}
                    </div>
                  )}
                  {aboutPageNotice && (
                    <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {aboutPageNotice}
                    </div>
                  )}
                </>
              )}
            </div>
          )

        case 'feedbackForm': {
          if (currentUser.role !== 'Admin' && currentUser.role !== 'Super Admin') {
            return (
              <div className="px-4 py-6 text-sm text-gray-500">Only admins can manage the feedback form.</div>
            )
          }
          const orgId = currentUser.organizationId
          const choiceTypes: FeedbackFieldType[] = ['single_choice', 'multi_choice']
          const fieldTypeLabel: Record<FeedbackFieldType, string> = {
            short_text: 'Short text',
            long_text: 'Long text',
            rating: 'Star rating',
            single_choice: 'Single choice',
            multi_choice: 'Multi choice',
          }
          return (
            <div className="space-y-6 px-4 py-4">
              {/* Global toggle */}
              <div className="flex items-center gap-3">
                <input
                  id="feedbackGlobalEnabled"
                  type="checkbox"
                  checked={feedbackFormGlobalEnabled}
                  disabled={feedbackFormGlobalPending}
                  onChange={(e) => void updateFeedbackGlobalEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 accent-[var(--color-primary)]"
                />
                <label htmlFor="feedbackGlobalEnabled" className="text-sm font-medium text-gray-800">
                  Enable feedback emails globally
                </label>
              </div>

              {/* Per-org toggle */}
              {feedbackForm && (
                <div className="flex items-center gap-3">
                  <input
                    id="feedbackOrgEnabled"
                    type="checkbox"
                    checked={feedbackForm.isEnabled}
                    onChange={(e) => void updateFeedbackFormEnabled(orgId, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 accent-[var(--color-primary)]"
                  />
                  <label htmlFor="feedbackOrgEnabled" className="text-sm font-medium text-gray-800">
                    Enable for this organization
                  </label>
                </div>
              )}

              {/* Field list */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Form Fields</p>
                {feedbackForm && feedbackForm.fields.length > 0 ? (
                  <div className="space-y-1">
                    {feedbackForm.fields.map((field, idx) => (
                      <div key={field.id || idx} className="rounded border border-gray-200 bg-white">
                        {/* Row */}
                        <div className="flex items-center gap-2 px-3 py-2">
                          <span className="flex-1 truncate text-sm text-gray-800">{field.label}</span>
                          <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                            {fieldTypeLabel[field.fieldType]}
                          </span>
                          {field.isRequired && (
                            <span className="shrink-0 rounded bg-rose-50 px-2 py-0.5 text-xs text-rose-600">
                              Required
                            </span>
                          )}
                          <button
                            className="shrink-0 text-gray-400 hover:text-blue-500"
                            title="Edit"
                            onClick={() =>
                              feedbackEditField?.id === field.id
                                ? (setFeedbackEditField(null), setFeedbackEditFieldOptionsText(''))
                                : openEditFeedbackField(field)
                            }
                          >
                            <Pencil size={14} />
                          </button>
                          {idx > 0 && (
                            <button
                              className="shrink-0 text-gray-400 hover:text-gray-600"
                              title="Move up"
                              onClick={() => void moveFeedbackField(idx, idx - 1)}
                            >
                              <ChevronUp size={14} />
                            </button>
                          )}
                          {idx < feedbackForm.fields.length - 1 && (
                            <button
                              className="shrink-0 text-gray-400 hover:text-gray-600"
                              title="Move down"
                              onClick={() => void moveFeedbackField(idx, idx + 1)}
                            >
                              <ChevronDown size={14} />
                            </button>
                          )}
                          <button
                            className="shrink-0 text-rose-400 hover:text-rose-600"
                            title="Remove"
                            onClick={() => void removeFeedbackField(field.id)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                        {/* Inline edit form */}
                        {feedbackEditField?.id === field.id && (
                          <div className="border-t border-gray-100 space-y-3 px-3 py-3">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-gray-600">
                                Question text <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={feedbackEditField.label ?? ''}
                                onChange={(e) =>
                                  setFeedbackEditField((f) => f ? { ...f, label: e.target.value } : f)
                                }
                                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                              />
                            </div>
                            {choiceTypes.includes(field.fieldType) && (
                              <div>
                                <label className="mb-1 block text-xs font-medium text-gray-600">
                                  Options (one per line)
                                </label>
                                <textarea
                                  value={feedbackEditFieldOptionsText}
                                  onChange={(e) => setFeedbackEditFieldOptionsText(e.target.value)}
                                  rows={3}
                                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                                />
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <input
                                id={`edit-required-${field.id}`}
                                type="checkbox"
                                checked={feedbackEditField.isRequired ?? false}
                                onChange={(e) =>
                                  setFeedbackEditField((f) => f ? { ...f, isRequired: e.target.checked } : f)
                                }
                                className="h-4 w-4 rounded border-gray-300"
                              />
                              <label htmlFor={`edit-required-${field.id}`} className="text-sm text-gray-700">
                                Required
                              </label>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={!feedbackEditField.label?.trim() || feedbackFormPending}
                                onClick={() => void saveEditedFeedbackField()}
                                className="primary-button"
                              >
                                {feedbackFormPending ? 'Saving…' : 'Save Changes'}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setFeedbackEditField(null); setFeedbackEditFieldOptionsText('') }}
                                className="secondary-button"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No fields yet. Add a field below.</p>
                )}
              </div>

              {/* Add field */}
              <div className="rounded border border-dashed border-gray-300 p-3">
                {!feedbackAddFieldOpen ? (
                  <button
                    className="primary-button"
                    onClick={() => setFeedbackAddFieldOpen(true)}
                  >
                    <Plus size={14} /> Add Field
                  </button>
                ) : (
                  <button
                    className="secondary-button mb-3"
                    onClick={() => setFeedbackAddFieldOpen(false)}
                  >
                    <X size={14} /> Cancel
                  </button>
                )}
                {feedbackAddFieldOpen && (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">Field type</label>
                      <select
                        value={feedbackAddFieldType}
                        onChange={(e) => setFeedbackAddFieldType(e.target.value as FeedbackFieldType)}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                      >
                        {(Object.keys(fieldTypeLabel) as FeedbackFieldType[]).map((t) => (
                          <option key={t} value={t}>
                            {fieldTypeLabel[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        Question text <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={feedbackAddFieldLabel}
                        onChange={(e) => setFeedbackAddFieldLabel(e.target.value)}
                        placeholder="e.g. How would you rate your experience?"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    {choiceTypes.includes(feedbackAddFieldType) && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                          Options (one per line)
                        </label>
                        <textarea
                          value={feedbackAddFieldOptions}
                          onChange={(e) => setFeedbackAddFieldOptions(e.target.value)}
                          rows={3}
                          placeholder="Option A&#10;Option B&#10;Option C"
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        id="feedbackAddRequired"
                        type="checkbox"
                        checked={feedbackAddFieldRequired}
                        onChange={(e) => setFeedbackAddFieldRequired(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <label htmlFor="feedbackAddRequired" className="text-sm text-gray-700">
                        Required
                      </label>
                    </div>
                    {!feedbackAddFieldLabel.trim() && (
                      <p className="text-xs text-gray-400">Enter a question text to enable saving.</p>
                    )}
                    <button
                      type="button"
                      disabled={!feedbackAddFieldLabel.trim() || feedbackFormPending}
                      onClick={() => void addFeedbackField()}
                      className="primary-button"
                    >
                      {feedbackFormPending ? 'Saving…' : 'Save Field'}
                    </button>
                  </div>
                )}
              </div>

              {feedbackFormError && (
                <p className="text-sm text-rose-600">{feedbackFormError}</p>
              )}
              {feedbackFormNotice && (
                <p className="text-sm text-emerald-600">{feedbackFormNotice}</p>
              )}

              {/* Test link */}
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Test Link</p>
                <button
                  disabled={feedbackTestLinkPending}
                  onClick={() => void generateFeedbackTestLink(orgId)}
                  className="self-start rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {feedbackTestLinkPending ? 'Generating…' : 'Generate Test Link'}
                </button>
                {feedbackTestLink && (
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={feedbackTestLink}
                      className="flex-1 rounded border border-gray-300 bg-gray-50 px-2 py-1.5 text-sm font-mono"
                    />
                    <button
                      onClick={() => void navigator.clipboard.writeText(feedbackTestLink)}
                      className="shrink-0 rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                    >
                      Copy
                    </button>
                    <a
                      href={feedbackTestLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-sm text-[var(--color-primary)] hover:underline"
                    >
                      Open ?
                    </a>
                  </div>
                )}
              </div>

              {/* Responses */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Responses ({feedbackResponses.length}{feedbackResponses.some((r) => r.isTest) ? `, ${feedbackResponses.filter((r) => r.isTest).length} test` : ''})
                  </p>
                  <button
                    disabled={feedbackResponsesLoading}
                    onClick={() => void refreshFeedbackResponses(orgId)}
                    className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-50"
                  >
                    {feedbackResponsesLoading ? 'Loading…' : 'Refresh'}
                  </button>
                </div>
                {feedbackResponses.length === 0 ? (
                  <p className="text-sm italic text-gray-400">No responses yet.</p>
                ) : (
                  <div className="space-y-1">
                    {feedbackResponses
                      .map((resp) => (
                        <div
                          key={resp.id}
                          className="rounded border border-gray-200 bg-white"
                        >
                          <button
                            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-gray-50"
                            onClick={() =>
                              setFeedbackExpandedResponseId((id) =>
                                id === resp.id ? null : resp.id,
                              )
                            }
                          >
                            <span className="flex-1 truncate text-gray-700">
                              {resp.requestorEmail ?? '(unknown)'}
                            </span>
                            {resp.isTest && (
                              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Test</span>
                            )}
                            {resp.ticketId && (
                              <span className="shrink-0 text-xs text-gray-400">
                                Ticket {resp.ticketId.slice(0, 8)}
                              </span>
                            )}
                            <span className="shrink-0 text-xs text-gray-400">
                              {new Date(resp.submittedAt).toLocaleDateString()}
                            </span>
                            <span className="shrink-0 text-gray-400">
                              {feedbackExpandedResponseId === resp.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </span>
                          </button>
                          {feedbackExpandedResponseId === resp.id && resp.answers.length > 0 && (
                            <div className="border-t border-gray-100 px-3 py-2 space-y-2">
                              {resp.answers.map((ans) => (
                                <div key={ans.fieldId}>
                                  <p className="text-xs font-medium text-gray-500">{ans.fieldLabel}</p>
                                  <p className="text-sm text-gray-800 whitespace-pre-wrap">
                                    {ans.value ?? '—'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )
        }
        case 'webhooks': {
          const eventLabels: Record<WebhookEvent, string> = {
            'ticket.created': 'Ticket Created',
            'ticket.updated': 'Ticket Updated',
            'ticket.assigned': 'Ticket Assigned',
            'ticket.resolved': 'Ticket Resolved',
            'ticket.closed': 'Ticket Closed',
            'feedback.submitted': 'Feedback Submitted',
          }
          return (
            <div className="space-y-4">
              {webhooksError && (
                <p className="text-sm text-red-600">{webhooksError}</p>
              )}
              {webhooksNotice && (
                <p className="text-sm text-green-700">{webhooksNotice}</p>
              )}

              {/* Existing webhooks */}
              {webhooks.length > 0 && (
                <div className="space-y-3">
                  {webhooks.map((wh) => (
                    <div key={wh.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                      {webhookEditId === wh.id ? (
                        <div className="space-y-2">
                          <input
                            type="url"
                            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                            placeholder="https://example.com/webhook"
                            value={webhookEditUrl}
                            onChange={(e) => setWebhookEditUrl(e.target.value)}
                          />
                          <input
                            type="text"
                            className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                            placeholder="Secret (optional)"
                            value={webhookEditSecret}
                            onChange={(e) => setWebhookEditSecret(e.target.value)}
                          />
                          <p className="text-xs text-gray-500 font-medium">Events to subscribe:</p>
                          <div className="flex flex-wrap gap-2">
                            {ALL_WEBHOOK_EVENTS.map((ev) => (
                              <label key={ev} className="flex items-center gap-1 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={webhookEditEvents.includes(ev)}
                                  onChange={(e) =>
                                    setWebhookEditEvents((prev) =>
                                      e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev),
                                    )
                                  }
                                />
                                {eventLabels[ev]}
                              </label>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={webhooksPending}
                              onClick={() => void saveWebhookEdit(wh.id)}
                              className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setWebhookEditId(null)}
                              className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-mono truncate flex-1">{wh.url}</span>

                            <div className="flex items-center gap-1 shrink-0">
                              {/* Enabled toggle */}
                              <button
                                type="button"
                                title={wh.isEnabled ? 'Disable' : 'Enable'}
                                onClick={() => void toggleWebhookEnabled(wh)}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${wh.isEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${wh.isEnabled ? 'translate-x-4' : 'translate-x-1'}`}
                                />
                              </button>
                              <button
                                type="button"
                                disabled={webhookTestingId === wh.id}
                                onClick={() => void testWebhook(wh.id)}
                                className="px-2 py-0.5 text-xs rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                              >
                                {webhookTestingId === wh.id ? 'Sending…' : 'Test'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setWebhookEditId(wh.id)
                                  setWebhookEditUrl(wh.url)
                                  setWebhookEditSecret(wh.secret)
                                  setWebhookEditEvents([...wh.events])
                                }}
                                className="px-2 py-0.5 text-xs rounded border border-gray-300 hover:bg-gray-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteWebhook(wh.id)}
                                className="px-2 py-0.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {wh.events.map((ev) => (
                              <span key={ev} className="inline-block px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
                                {eventLabels[ev]}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add webhook form */}
              {webhookAddOpen ? (
                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium text-gray-700">Add Webhook</p>
                  <input
                    type="url"
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                    placeholder="https://example.com/webhook"
                    value={webhookAddUrl}
                    onChange={(e) => setWebhookAddUrl(e.target.value)}
                  />
                  <input
                    type="text"
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
                    placeholder="Secret for HMAC signing (optional)"
                    value={webhookAddSecret}
                    onChange={(e) => setWebhookAddSecret(e.target.value)}
                  />
                  <p className="text-xs text-gray-500 font-medium">Events to subscribe:</p>
                  <div className="flex flex-wrap gap-2">
                    {ALL_WEBHOOK_EVENTS.map((ev) => (
                      <label key={ev} className="flex items-center gap-1 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={webhookAddEvents.includes(ev)}
                          onChange={(e) =>
                            setWebhookAddEvents((prev) =>
                              e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev),
                            )
                          }
                        />
                        {eventLabels[ev]}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={webhooksPending || !webhookAddUrl.trim() || webhookAddEvents.length === 0}
                      onClick={() => void saveWebhook()}
                      className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save Webhook
                    </button>
                    <button
                      type="button"
                      onClick={() => { setWebhookAddOpen(false); setWebhookAddUrl(''); setWebhookAddSecret('') }}
                      className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setWebhookAddOpen(true)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-dashed border-gray-400 text-gray-600 hover:bg-gray-50"
                >
                  + Add Webhook
                </button>
              )}
            </div>
          )
        }
      }
    }

    const accordionMetadata: Record<
      SettingsAccordionSection,
      { title: string; description: string }
    > = {
      appearance: {
        title: 'Appearance',
        description: 'Theme colors and light or dark mode defaults.',
      },
      authentication: {
        title: 'Authentication',
        description: 'Configure available login methods.',
      },
      loginMode: {
        title: 'Login Mode',
        description: 'Choose select-user, password, or system maintenance for the public sign-in page.',
      },
      anonymousPages: {
        title: 'Anonymous Pages',
        description: 'Map anonymous page files to organizations and control public intake routing.',
      },
      manageOrganizations: {
        title: 'Organizations',
        description: 'Add or update organization names, codes, and accent colors.',
      },
      manageUsers: {
        title: 'Manage Users',
        description: 'Update names, emails, organizations, teams, and roles.',
      },
      manageTeams: {
        title: 'Manage Teams',
        description: 'Add or update team names, organization assignments, codes, and accent colors.',
      },
      trendSeeding: {
        title: 'Trend Seeding',
        description: 'Generate or clear chart-only trend history for the dashboard.',
      },
      ticketSeeding: {
        title: 'Ticket Seeding',
        description: 'Create random sample tickets for testing and demos.',
      },
      categories: {
        title: 'Categories',
        description: 'Add new categories and maintain team mappings.',
      },
      locations: {
        title: 'Locations',
        description: 'Manage the list of locations available when creating or editing a ticket.',
      },
      email: {
        title: 'Email Notifications',
        description: 'Configure outbound Resend email and inbound Gmail IMAP integration.',
      },
      powerBi: {
        title: 'Power BI',
        description: 'Set the embedded report URL shown on the Reports page Power BI tab.',
      },
      feedbackForm: {
        title: 'Feedback Form',
        description: 'Design a post-resolution survey and collect submitter feedback.',
      },
      webhooks: {
        title: 'Webhooks',
        description: 'Send real-time event notifications to external URLs when tickets are created, updated, or resolved.',
      },
      aboutPage: {
        title: 'About Page',
        description: 'Configure the HTML content displayed on the About page accessible from the user profile menu.',
      },
    }

    const { title, description } = accordionMetadata[section]

    return (
      <section
        key={section}
        className="surface p-4 settings-accordion-shell"
        data-drag-over={settingsDragOverSection === section && draggedSettingsSection !== section}
        onDragOver={(event) => {
          if (!draggedSettingsSection) {
            return
          }

          event.preventDefault()
          if (settingsDragOverSection !== section) {
            setSettingsDragOverSection(section)
          }
        }}
        onDrop={(event) => {
          event.preventDefault()
          if (draggedSettingsSection) {
            if (settingsTabs.length > 0 && activeSettingsTabId) {
              void moveSettingsSection(draggedSettingsSection, activeSettingsTabId, section)
            } else {
              reorderSettingsAccordions(draggedSettingsSection, section)
            }
          }
          endSettingsAccordionDrag()
        }}
      >
        <div className="settings-accordion-header">
          <button
            type="button"
            className="settings-drag-handle"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              startSettingsAccordionDrag(section)
            }}
            onDragEnd={endSettingsAccordionDrag}
            aria-label={`Drag ${title}`}
            title="Drag to reorder"
          >
            <Grip className="h-4 w-4" />
          </button>

          <button
            type="button"
            className="settings-accordion-toggle"
            onClick={() => toggleSettingsAccordion(section)}
            aria-expanded={isOpen}
          >
            <div>
              <div className="text-xl font-semibold">{title}</div>
              <div className="text-sm text-[color:var(--text-muted)]">{description}</div>
            </div>
            <ChevronDown className="settings-accordion-icon h-5 w-5" data-open={isOpen} />
          </button>
        </div>

        {isOpen && renderAccordionBody()}
      </section>
    )
  }

  const SUPER_ADMIN_ONLY_SECTIONS: SettingsAccordionSection[] = [
    'webhooks',
    'manageOrganizations',
    'authentication',
    'anonymousPages',
    'aboutPage',
    'email',
  ]

  const [manageTabsDialog, setManageTabsDialog] = useState<false | 'create' | 'edit'>(false)
  const [manageTabDraft, setManageTabDraft] = useState<{ id?: string; name: string; slug: string; visible_to: 'all' | 'super_admin' }>({ name: '', slug: '', visible_to: 'all' })
  const [manageTabsSaving, setManageTabsSaving] = useState(false)
  const [manageTabsError, setManageTabsError] = useState('')
  const [editTabDropdownOpen, setEditTabDropdownOpen] = useState(false)
  const editTabDropdownRef = useRef<HTMLDivElement | null>(null)

  const renderAdminSettingsPage = () => {
    // Use server-side tabs if loaded; otherwise fall back to the old flat accordion
    if (settingsTabs.length > 0) {
      const activeTab = settingsTabs.find((t) => t.id === activeSettingsTabId)
      const activeSectionKeys = activeTab?.sections?.map((s) => s.section_key as SettingsAccordionSection) ?? []

      const openCreateTab = () => {
        setManageTabDraft({ name: '', slug: '', visible_to: 'all' })
        setManageTabsDialog('create')
        setManageTabsError('')
      }

      const openEditTab = (tab: typeof settingsTabs[0]) => {
        setManageTabDraft({ id: tab.id, name: tab.name, slug: tab.slug, visible_to: tab.visible_to })
        setManageTabsDialog('edit')
        setManageTabsError('')
      }

      const saveTab = async () => {
        if (!manageTabDraft.name.trim() || !manageTabDraft.slug.trim()) return
        setManageTabsSaving(true)
        setManageTabsError('')
        try {
          if (manageTabsDialog === 'create') {
            const res = await fetch(apiUrl('/api/settings/tabs'), {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: manageTabDraft.name.trim(), slug: manageTabDraft.slug.trim(), visible_to: manageTabDraft.visible_to }),
            })
            if (!res.ok) {
              const err = await res.json()
              setManageTabsError(err.error ?? 'Failed to create tab')
              return
            }
            const data = await res.json()
            setSettingsTabs(data.tabs ?? [])
            if (data.tab) setActiveSettingsTabId(data.tab.id)
          } else if (manageTabsDialog === 'edit' && manageTabDraft.id) {
            const res = await fetch(apiUrl(`/api/settings/tabs/${manageTabDraft.id}`), {
              method: 'PATCH',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: manageTabDraft.name.trim(), visible_to: manageTabDraft.visible_to }),
            })
            if (!res.ok) {
              const err = await res.json()
              setManageTabsError(err.error ?? 'Failed to update tab')
              return
            }
            const data = await res.json()
            setSettingsTabs(data.tabs ?? [])
          }
          setManageTabsDialog(false)
        } catch {
          setManageTabsError('Request failed')
        } finally {
          setManageTabsSaving(false)
        }
      }

      const deleteTab = async (tabId: string) => {
        if (!confirm('Delete this tab? Its sections will be reassigned to the first available tab.')) return
        setManageTabsSaving(true)
        try {
          const res = await fetch(apiUrl(`/api/settings/tabs/${tabId}`), {
            method: 'DELETE',
            credentials: 'include',
          })
          if (!res.ok) return
          const data = await res.json()
          setSettingsTabs(data.tabs ?? [])
          if (activeSettingsTabId === tabId && data.tabs?.length > 0) {
            setActiveSettingsTabId(data.tabs[0].id)
          }
        } catch {
          // non-fatal
        } finally {
          setManageTabsSaving(false)
        }
      }

      return (
        <div className="space-y-4">
          <section className="surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xl font-semibold">Administrator Settings</div>
                <div className="text-sm text-[color:var(--text-muted)]">
                  Click a tab below to switch between setting categories.
                </div>
              </div>
              <div className="rounded-[2px] border border-[color:var(--border)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                {currentUser.role}
              </div>
            </div>
          </section>

          {/* Tab bar */}
          <div className="flex flex-wrap items-center gap-1 border-b border-[color:var(--border)] pb-2">
            {settingsTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="settings-tab-button rounded-[2px] px-3 py-1.5 text-sm font-semibold transition-colors"
                data-active={activeSettingsTabId === tab.id}
                data-drag-over={Boolean(draggedSettingsSection) && activeSettingsTabId !== tab.id}
                onClick={() => setActiveSettingsTabId(tab.id)}
                onDragOver={(event) => {
                  if (!draggedSettingsSection) {
                    return
                  }
                  event.preventDefault()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (draggedSettingsSection) {
                    void moveSettingsSection(draggedSettingsSection, tab.id)
                  }
                  endSettingsAccordionDrag()
                }}
                style={{
                  backgroundColor: activeSettingsTabId === tab.id ? 'var(--accent)' : 'var(--panel-bg)',
                  color: activeSettingsTabId === tab.id ? '#fff' : 'var(--text)',
                  border: '1px solid var(--border)',
                }}
              >
                {tab.name}
                {tab.visible_to === 'super_admin' && (
                  <span className="ml-1.5 rounded-[2px] bg-white/20 px-1 text-[10px] uppercase leading-4">SA</span>
                )}
              </button>
            ))}
            {currentUser.role === 'Super Admin' && (
              <>
                <button
                  type="button"
                  className="secondary-button flex items-center gap-1 px-2 py-1.5 text-xs"
                  onClick={openCreateTab}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New Tab
                </button>
                <div className="relative" ref={editTabDropdownRef}>
                  <button
                    type="button"
                    className="secondary-button flex items-center gap-1 px-2 py-1.5 text-xs"
                    onClick={() => setEditTabDropdownOpen(!editTabDropdownOpen)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit Tab
                  </button>
                  {editTabDropdownOpen && (
                    <>
                      <button
                        type="button"
                        className="fixed inset-0 z-30"
                        onClick={() => setEditTabDropdownOpen(false)}
                      />
                      <div className="absolute left-0 top-full z-40 mt-1 min-w-48 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] py-1 shadow-lg">
                        {settingsTabs.map((tab) => (
                          <div key={tab.id} className="flex items-center justify-between px-3 py-1.5 hover:bg-[color:var(--card-bg)]">
                            <button
                              type="button"
                              className="flex-1 text-left text-sm text-[color:var(--text)]"
                              onClick={() => { openEditTab(tab); setEditTabDropdownOpen(false) }}
                            >
                              {tab.name}
                              {tab.visible_to === 'super_admin' && (
                                <span className="ml-1.5 rounded-[2px] bg-amber-100 px-1 text-[10px] uppercase leading-4 text-amber-700">SA</span>
                              )}
                            </button>
                            <button
                              type="button"
                              className="ml-2 text-rose-400 hover:text-rose-600"
                              title={`Delete ${tab.name}`}
                              onClick={() => { setEditTabDropdownOpen(false); deleteTab(tab.id) }}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Active tab's sections */}
          {settingsTabsLoading ? (
            <div className="surface flex min-h-32 items-center justify-center p-8 text-sm text-[color:var(--text-muted)]">
              Loading settings tabs…
            </div>
          ) : activeSectionKeys.length > 0 ? (
            activeSectionKeys.map((section) => renderSettingsAccordionSection(section))
          ) : (
            <div className="surface flex min-h-32 items-center justify-center p-8 text-sm text-[color:var(--text-muted)]">
              This tab has no settings sections. Drag sections here or add new sections through the API.
            </div>
          )}

          {/* Create/Edit Tab Dialog */}
          {manageTabsDialog && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 bg-slate-950/40"
                onClick={() => setManageTabsDialog(false)}
              />
              <div
                role="dialog"
                aria-modal={true}
                aria-labelledby="manage-tab-title"
                className="surface fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-6 shadow-[0_24px_64px_rgba(13,47,79,0.22)]"
              >
                <h2 id="manage-tab-title" className="mb-1 text-base font-semibold text-[color:var(--text)]">
                  {manageTabsDialog === 'create' ? 'Create New Tab' : 'Edit Tab'}
                </h2>
                <p className="mb-4 text-sm text-[color:var(--text-muted)]">
                  {manageTabsDialog === 'create'
                    ? 'Create a new settings tab to organize sections.'
                    : 'Update the tab name or visibility.'}
                </p>
                {manageTabsError && (
                  <div className="mb-3 rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {manageTabsError}
                  </div>
                )}
                <div className="space-y-3">
                  <label className="block space-y-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Tab Name</span>
                    <input
                      className="input-control w-full"
                      value={manageTabDraft.name}
                      onChange={(e) => setManageTabDraft((p) => ({ ...p, name: e.target.value, slug: manageTabsDialog === 'create' ? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : p.slug }))}
                      placeholder="e.g. Integrations"
                      disabled={manageTabsSaving}
                    />
                  </label>
                  {manageTabsDialog === 'create' && (
                    <label className="block space-y-1">
                      <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Slug</span>
                      <input
                        className="input-control w-full font-mono"
                        value={manageTabDraft.slug}
                        onChange={(e) => setManageTabDraft((p) => ({ ...p, slug: e.target.value }))}
                        placeholder="integrations"
                        disabled={manageTabsSaving}
                      />
                    </label>
                  )}
                  <label className="block space-y-1">
                    <span className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Visible to</span>
                    <select
                      className="input-control w-full"
                      value={manageTabDraft.visible_to}
                      onChange={(e) => setManageTabDraft((p) => ({ ...p, visible_to: e.target.value as 'all' | 'super_admin' }))}
                      disabled={manageTabsSaving}
                    >
                      <option value="all">All (Admin & Super Admin)</option>
                      <option value="super_admin">Super Admin only</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setManageTabsDialog(false)}
                    disabled={manageTabsSaving}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void saveTab()}
                    disabled={manageTabsSaving || !manageTabDraft.name.trim() || !manageTabDraft.slug.trim()}
                  >
                    {manageTabsSaving ? 'Saving...' : manageTabsDialog === 'create' ? 'Create Tab' : 'Save'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )
    }

    // Fallback: classic accordion view when no tabs are loaded
    const visibleSections = currentUser.role === 'Super Admin'
      ? settingsAccordionOrder
      : settingsAccordionOrder.filter((section) => !SUPER_ADMIN_ONLY_SECTIONS.includes(section))

    return (
    <div className="space-y-4">
      <section className="surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">Administrator Settings</div>
            <div className="text-sm text-[color:var(--text-muted)]">
              Drag the handle on the left to move the sections you use most to the top. Your layout is saved per signed-in user.
            </div>
          </div>
          <div className="rounded-[2px] border border-[color:var(--border)] px-3 py-2 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
            {currentUser.role}
          </div>
        </div>
      </section>

      {visibleSections.map((section) => renderSettingsAccordionSection(section))}
    </div>
    )
  }

  const renderTicketCollection = () => {
    if (visibleTickets.length === 0) {
      return (
        <div className="surface flex min-h-56 items-center justify-center p-8 text-sm text-[color:var(--text-muted)]">
          No tickets match the current team scope and filters.
        </div>
      )
    }

    const renderQuickActions = (ticket: TicketRecord) => {
      const isPending = quickActionPendingTicketId === ticket.id
      const disableAssign = isPending || ticket.assignedToId === currentUser.id
      const disableInProgress = isPending || ticket.status === 'In Progress'
      const disableResolve = isPending
      const isResolved = ticket.status === 'Resolved'
      const showAssignAction =
        !isResolved && activeView !== 'my-tickets' && ticket.assignedToId !== currentUser.id
      const showInProgressAction = !isResolved && ticket.status !== 'In Progress'
      const showResolveAction = !isResolved

      return (
        <div className="flex flex-wrap items-start justify-end gap-2 max-sm:justify-start">
          {showAssignAction && (
            <button
              type="button"
              className="badge-button"
              disabled={disableAssign}
              onClick={() => requestQuickTicketAction(ticket, 'assign-to-me')}
            >
              {isPending ? 'Updating...' : 'Assign to me'}
            </button>
          )}
          {showInProgressAction && (
            <button
              type="button"
              className="badge-button"
              disabled={disableInProgress}
              onClick={() => requestQuickTicketAction(ticket, 'mark-in-progress')}
            >
              In Progress
            </button>
          )}
          {showResolveAction && (
            <button
              type="button"
              className="badge-button"
              disabled={disableResolve}
              onClick={() => requestQuickTicketAction(ticket, 'mark-resolved')}
            >
              Resolve
            </button>
          )}
        </div>
      )
    }

    if (listMode === 'cards') {
      return (
        <div className="space-y-3">
          {quickActionError && (
            <div className="rounded-[2px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {quickActionError}
            </div>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {visibleTickets.map((ticket) => {
              const category = getCategoryById(ticket.categoryId)
              const assignee = getUserById(ticket.assignedToId)
              const team = getTeamById(ticket.teamId)
              const attachmentCount = ticket.attachmentCount ?? 0

              return (
                <div
                  key={ticket.id}
                  className="surface text-left transition hover:-translate-y-0.5"
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => openTicket(ticket.id)}
                  >
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-4 p-4">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-mono text-[1.09375rem] font-semibold text-[color:var(--accent)]">
                            {ticket.id}
                          </span>
                          {attachmentCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-2 py-0.5 text-xs text-[color:var(--text-muted)]">
                              <Paperclip className="h-3.5 w-3.5" />
                              {attachmentCount}
                            </span>
                          )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={getStatusBadgeClass(ticket.status)}>{ticket.status}</span>
                          <span className={getPriorityBadgeClass(ticket.priority)}>{ticket.priority}</span>
                        </div>
                        <h3 className="text-base font-semibold text-[color:var(--text)]">
                          {ticket.title}
                        </h3>
                        <p className="text-sm text-[color:var(--text-muted)]">
                          {ticket.requestorName} • {category?.name ?? 'Unmapped category'} •{' '}
                          {team?.name ?? 'Unknown team'}
                        </p>
                      </div>
                      <div className="sm:text-right">
                        <div className="text-xs text-[color:var(--text-muted)]">
                          <div>{ticket.dueLabel}</div>
                          <div>{formatDateTime(ticket.updatedAt)}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap justify-end gap-2">
                          {renderQuickActions(ticket)}
                        </div>
                      </div>
                    </div>
                  </button>
                  <div className="border-t border-[color:var(--border)] px-4 py-3 text-sm text-[color:var(--text-muted)]">
                    Assigned to {assignee?.name ?? 'Unassigned'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    return (
      <div className="surface overflow-hidden">
        {quickActionError && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {quickActionError}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-black/[0.02] text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Ticket #</th>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Assigned To</th>
                <th className="px-4 py-3 font-semibold">Updated</th>
                <th className="px-4 py-3 font-semibold">Resolved At</th>
                <th className="px-4 py-3 font-semibold">Quick Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleTickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="border-t border-[color:var(--border)] transition hover:bg-black/[0.03]"
                >
                  <td className="px-4 py-3 align-top">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 font-mono text-[1.09375rem] font-semibold text-[color:var(--accent)]"
                      onClick={() => openTicket(ticket.id)}
                    >
                      {ticket.id}
                      {(ticket.attachmentCount ?? 0) > 0 && <Paperclip className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="font-semibold text-[color:var(--text)]">{ticket.title}</div>
                    <div className="text-[color:var(--text-muted)]">{ticket.requestorName}</div>
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--text-muted)]">
                    {getCategoryById(ticket.categoryId)?.name ?? 'Unknown'}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={getStatusBadgeClass(ticket.status)}>{ticket.status}</span>
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--text-muted)]">
                    {getUserById(ticket.assignedToId)?.name ?? 'Unassigned'}
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--text-muted)]">
                    {formatDateTime(ticket.updatedAt)}
                  </td>
                  <td className="px-4 py-3 align-top text-[color:var(--text-muted)]">
                    {ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : <span className="opacity-30">—</span>}
                  </td>
                  <td className="px-4 py-3 align-top">{renderQuickActions(ticket)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const renderSidebarNav = (collapsed: boolean, mobile = false) => (
    <>
      <div className="flex h-13 items-center gap-3 border-b border-white/10 px-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-[2px] bg-[color:var(--accent)] text-sm font-bold text-white">
          <Ticket className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div>
            <div className="text-lg font-semibold">TeamSupportPro</div>
            <div className="text-xs text-white/70">
              {authSession?.organizationName || getOrganizationById(currentUser.organizationId)?.name || 'Enterprise staff support'}
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4">
        {visibleNavItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="sidebar-link"
            data-active={activeView === id}
            onClick={() => {
              setActiveView(id)
              if (mobile) {
                setMobileNavOpen(false)
              }
            }}
            title={collapsed ? label : undefined}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && (
              <span className="flex-1 text-left">{label}</span>
            )}
            {!collapsed && id === 'unassigned' && unassignedCount > 0 && (
              <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">
                {unassignedCount}
              </span>
            )}
            {!collapsed && id === 'my-tickets' && myTicketsCount > 0 && (
              <span className="ml-auto rounded-full bg-[color:var(--accent)] px-2 py-0.5 text-xs font-semibold text-white">
                {myTicketsCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        {!collapsed && (
          <div className="mb-3 rounded-[2px] border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-white/55">
            Version {appConfig.appVersion}
          </div>
        )}
        <div className="flex items-center gap-3 rounded-[2px] border border-white/10 bg-white/5 px-3 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[2px] bg-[color:var(--accent)] text-sm font-semibold">
            {currentUser.name
              .split(' ')
              .map((part) => part[0])
              .join('')
              .slice(0, 2)}
          </div>
          {!collapsed && (
            <div>
              <div className="text-sm font-semibold">{currentUser.name}</div>
              <div className="text-xs text-white/70">{currentTeam?.name}</div>
            </div>
          )}
        </div>
      </div>
    </>
  )

  if (!authReady) {
    return (
      <div className="app-shell min-h-screen" style={{
        '--app-bg': defaultThemeConfig.light.appBg,
        '--header-bg': defaultThemeConfig.light.headerBg,
        '--menu-bg': defaultThemeConfig.light.menuBg,
        '--card-bg': defaultThemeConfig.light.cardBg,
        '--panel-bg': defaultThemeConfig.light.panelBg,
        '--input-bg': defaultThemeConfig.light.inputBg,
        '--button-bg': defaultThemeConfig.light.buttonBg,
        '--accent': defaultThemeConfig.light.accent,
        '--text': defaultThemeConfig.light.text,
        '--text-muted': defaultThemeConfig.light.textMuted,
        '--border': defaultThemeConfig.light.border,
        '--button-text': defaultThemeConfig.light.buttonText,
      } as CSSProperties}>
        <div className="login-shell flex min-h-screen items-center justify-center p-6">
          <div className="login-card w-full max-w-xl border border-[color:var(--border)] bg-[color:var(--card-bg)] p-8 text-center">
            <div className="mb-3 text-xs uppercase tracking-[0.2em] text-[color:var(--text-muted)]">
              Restoring Session
            </div>
            <h1 className="text-3xl font-semibold text-[color:var(--text)]">Loading TeamSupportPro</h1>
            <p className="mt-3 text-sm text-[color:var(--text-muted)]">
              Checking your saved session and loading persisted ticket activity.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!authSession) {
    return (
      <div className="app-shell min-h-screen" style={{
        '--app-bg': defaultThemeConfig.light.appBg,
        '--header-bg': defaultThemeConfig.light.headerBg,
        '--menu-bg': defaultThemeConfig.light.menuBg,
        '--card-bg': defaultThemeConfig.light.cardBg,
        '--panel-bg': defaultThemeConfig.light.panelBg,
        '--input-bg': defaultThemeConfig.light.inputBg,
        '--button-bg': defaultThemeConfig.light.buttonBg,
        '--accent': defaultThemeConfig.light.accent,
        '--text': defaultThemeConfig.light.text,
        '--text-muted': defaultThemeConfig.light.textMuted,
        '--border': defaultThemeConfig.light.border,
        '--button-text': defaultThemeConfig.light.buttonText,
      } as CSSProperties}>
        <div className="login-shell flex min-h-screen items-center justify-center p-6">
          <div className="login-card grid max-w-5xl gap-0 overflow-hidden border border-[color:var(--border)] bg-[color:var(--card-bg)] md:grid-cols-[1.1fr_0.9fr]">
            <div className="border-r border-[color:var(--border)] bg-[linear-gradient(135deg,#0d2f4f_0%,#123555_50%,#0f3d63_100%)] p-8 text-white md:p-10">
              <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-[2px] bg-[#0078d4] text-sm font-bold">
                <Ticket className="h-5 w-5" />
              </div>
              <div className="space-y-5">
                <div>
                  <div className="mb-3 text-xs uppercase tracking-[0.2em] text-white/65">
                    Enterprise Staff Support
                  </div>
                  <h1 className="text-4xl font-semibold leading-tight text-white md:text-5xl">
                    Sign in to TeamSupportPro
                  </h1>
                </div>
                <p className="max-w-xl text-sm leading-7 text-white/75">
                  Choose a test user and sign in instantly. The correct organization and team context will be applied automatically.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="surface-dark p-4">
                    <div className="mb-2 font-mono text-2xl font-semibold">
                      {testLoginDataPending ? '…' : loginOrgTeams.length}
                    </div>
                    <div className="text-xs uppercase tracking-[0.12em] text-white/65">Teams</div>
                  </div>
                  <div className="surface-dark p-4">
                    <div className="mb-2 font-mono text-2xl font-semibold">
                      {testLoginDataPending ? '…' : loginOrgCategories.length}
                    </div>
                    <div className="text-xs uppercase tracking-[0.12em] text-white/65">Categories</div>
                  </div>
                  <div className="surface-dark p-4">
                    <div className="mb-2 font-mono text-2xl font-semibold">
                      {testLoginDataPending ? '…' : loginOrgTicketCount}
                    </div>
                    <div className="text-xs uppercase tracking-[0.12em] text-white/65">Active Tickets</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center p-8 md:p-10">
              <div className="w-full max-w-md space-y-5">
                <div>
                  <div className="mb-2 text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                    Authentication
                  </div>
                  <h2 className="text-2xl font-semibold">SIGN IN</h2>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--text-muted)]">
                    {(loginMode === 'maintenance' && !loginAdminOverride)
                      ? 'The system is temporarily unavailable for sign-in.'
                      : (loginMode === 'password' || (loginMode === 'maintenance' && loginAdminOverride))
                        ? 'Sign in with your email and password.'
                        : 'Select a test user from the directory and create a session without entering email or password.'}
                  </p>
                </div>

                <div className="grid gap-4">
                  {backendAvailable === false && (
                    <div className="rounded-[2px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      The backend auth server is offline. Start it with <span className="font-mono">npm run dev</span> or <span className="font-mono">npm run start:server</span> before signing in.
                    </div>
                  )}

                  {loginMode === 'maintenance' && !loginAdminOverride && (
                    <div className="rounded-[2px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      <div className="mb-1 font-semibold">System Maintenance</div>
                      <div className="whitespace-pre-wrap">{maintenanceMessage}</div>
                    </div>
                  )}

                  {(loginMode === 'select' || loginMode === null) && (
                  <form className="rounded-[2px] border border-[color:var(--border)] p-4" onSubmit={handleLocalLogin}>
                    <div className="space-y-3">
                      <label className="field">
                        <span className="field-label">Organization</span>
                        <select
                          className="input-control"
                          value={testLoginDataPending ? '' : resolvedLoginOrgId}
                          onChange={(event) => {
                            const orgId = event.target.value
                            setLoginOrgId(orgId)
                            const firstUser = availableUsers.find((u) => u.organizationId === orgId)
                            if (firstUser) {
                              setLocalLoginEmail(firstUser.email)
                            }
                          }}
                          disabled={localLoginPending || testLoginDataPending || availableOrganizations.length === 0}
                        >
                          {testLoginDataPending ? (
                            <option value="">Loading organizations…</option>
                          ) : availableOrganizations.length === 0 ? (
                            <option value="">No organizations available</option>
                          ) : (
                            availableOrganizations.map((org) => (
                              <option key={org.id} value={org.id}>
                                {org.name}
                              </option>
                            ))
                          )}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">Test User</span>
                        <select
                          className="input-control"
                          value={selectedLoginUser?.email ?? ''}
                          onChange={(event) => setLocalLoginEmail(event.target.value)}
                          disabled={localLoginPending || filteredLoginUsers.length === 0}
                        >
                          {filteredLoginUsers.map((user) => {
                            const team = availableTeams.find((item) => item.id === user.teamId)
                            const label = team
                              ? `${user.name}, ${team.name} (${user.role})`
                              : `${user.name} (${user.role})`

                            return (
                              <option key={user.id} value={user.email}>
                                {label}
                              </option>
                            )
                          })}
                        </select>
                      </label>
                      <button
                        type="submit"
                        className="primary-button w-full"
                        disabled={localLoginPending || availableUsers.length === 0}
                      >
                        {localLoginPending ? 'Signing in...' : 'SIGN IN'}
                      </button>
                    </div>
                  </form>
                  )}

                  {(loginMode === 'password' || loginMode === null || (loginMode === 'maintenance' && loginAdminOverride)) && (
                    <form className="rounded-[2px] border border-[color:var(--border)] p-4" onSubmit={handlePasswordLogin}>
                      <div className="space-y-3">
                        {loginMode === 'maintenance' && loginAdminOverride && (
                          <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            Admin bypass active via <span className="font-mono">?admin=1</span>.
                          </div>
                        )}
                        <label className="field">
                          <span className="field-label">Email</span>
                          <input
                            type="email"
                            className="input-control"
                            autoComplete="username"
                            value={passwordLoginEmail}
                            onChange={(event) => setPasswordLoginEmail(event.target.value)}
                            disabled={passwordLoginPending}
                            placeholder="you@example.com"
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">Password</span>
                          <input
                            type="password"
                            className="input-control"
                            autoComplete="current-password"
                            value={passwordLoginPassword}
                            onChange={(event) => setPasswordLoginPassword(event.target.value)}
                            disabled={passwordLoginPending}
                            placeholder="Password"
                          />
                        </label>
                        <label className="flex items-center gap-2 text-sm text-[color:var(--text-muted)]">
                          <input
                            type="checkbox"
                            checked={passwordRememberMe}
                            onChange={(event) => setPasswordRememberMe(event.target.checked)}
                            disabled={passwordLoginPending}
                          />
                          Remember me
                        </label>
                        <button
                          type="submit"
                          className="primary-button w-full"
                          disabled={passwordLoginPending}
                        >
                          {passwordLoginPending ? 'Signing in...' : 'SIGN IN'}
                        </button>
                      </div>
                    </form>
                  )}

                  {(loginMode === 'select' || loginMode === null) && availableUsers.length === 0 && (
                    <div className="rounded-[2px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      No test users are available from the directory yet.
                    </div>
                  )}
                </div>

                {authError && (
                  <div className="rounded-[2px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {authError}
                  </div>
                )}

                {localAuthError && (
                  <div className="rounded-[2px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {localAuthError}
                  </div>
                )}

                {passwordLoginError && (
                  <div className="rounded-[2px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {passwordLoginError}
                  </div>
                )}

                {localAuthNotice && (
                  <div className="rounded-[2px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                    {localAuthNotice}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell min-h-screen" style={paletteStyle}>
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.button
              type="button"
              aria-label="Close navigation"
              className="fixed inset-0 z-30 bg-slate-950/45 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-40 flex w-[18rem] max-w-[88vw] flex-col border-r border-[color:var(--border)] bg-[color:var(--menu-bg)] text-white md:hidden"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: 'easeInOut' }}
            >
              {renderSidebarNav(false, true)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-h-screen">
        <motion.aside
          animate={{ width: sidebarCollapsed ? 76 : 248 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="hidden shrink-0 flex-col border-r border-[color:var(--border)] bg-[color:var(--menu-bg)] text-white md:flex"
        >
          {renderSidebarNav(sidebarCollapsed)}
        </motion.aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-[color:var(--border)] bg-[color:var(--header-bg)] text-white">
            <div className="flex min-h-13 flex-wrap items-center justify-between gap-3 px-4 py-2 lg:px-6">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <button
                  type="button"
                  className="icon-button text-white"
                  onClick={() => {
                    if (isMobileViewport) {
                      setMobileNavOpen(true)
                      return
                    }

                    setSidebarCollapsed((current) => !current)
                  }}
                >
                  {isMobileViewport ? (
                    <PanelLeftOpen className="h-5 w-5" />
                  ) : sidebarCollapsed ? (
                    <PanelLeftOpen className="h-5 w-5" />
                  ) : (
                    <PanelLeftClose className="h-5 w-5" />
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="icon-button text-white"
                    aria-label="Search"
                    aria-expanded={searchOpen}
                    onClick={() => {
                      setSearchOpen((current) => {
                        const next = !current
                        if (next) {
                          setTimeout(() => searchInputRef.current?.focus(), 0)
                        } else {
                          setSearchText('')
                        }
                        return next
                      })
                    }}
                  >
                    <Search className="h-5 w-5" />
                  </button>
                  <label
                    className={`relative overflow-hidden transition-all duration-200 ease-in-out ${
                      searchOpen ? 'w-[250px] opacity-100' : 'w-0 opacity-0'
                    }`}
                  >
                    <input
                      ref={searchInputRef}
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setSearchOpen(false)
                          setSearchText('')
                        }
                      }}
                      onBlur={(event) => {
                        if (!event.target.value) {
                          setSearchOpen(false)
                        }
                      }}
                      className="h-10 w-full rounded-[2px] border border-white/10 bg-white/6 pl-3 pr-4 text-sm text-white outline-none placeholder:text-white/45 focus:border-white/25"
                      placeholder="Search tickets..."
                    />
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden min-w-0 text-right sm:block">
                  <div className="truncate text-sm font-semibold text-white">{currentUser.name}</div>
                  <div className="truncate text-[11px] leading-4 text-white/70">{currentTeam.name}</div>
                </div>
                <div className="relative" ref={profileMenuRef}>
                  <button
                    type="button"
                    className="icon-button"
                    style={{ color: currentUser.name === 'Administrator' ? '#facc15' : '#ffffff' }}
                    aria-label="User profile"
                    aria-expanded={profileMenuOpen}
                    aria-haspopup="menu"
                    onClick={() => setProfileMenuOpen((current) => !current)}
                  >
                    <UserIcon className="h-5 w-5" />
                  </button>
                  {profileMenuOpen && (
                    <div className="absolute right-0 top-full z-40 mt-2 min-w-56 rounded-[2px] border border-white/10 bg-[color:var(--header-bg)] p-3 shadow-[0_20px_60px_rgba(13,47,79,0.28)]">
                      <div className="text-sm font-semibold text-white">{currentUser.name}</div>
                      <div className="text-xs text-white/70">{currentUser.email}</div>
                      <div className="mt-2 text-xs uppercase tracking-[0.12em] text-white/60">{currentTeam.name}</div>
                      <div className="mt-3 border-t border-white/10 pt-3 flex flex-col gap-1">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-sm text-white/90 hover:bg-white/10 text-left"
                          onClick={() => { setActiveView('about'); setProfileMenuOpen(false) }}
                        >
                          <Info className="h-4 w-4 shrink-0" />
                          About
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-[2px] px-2 py-1.5 text-sm text-white/90 hover:bg-white/10 text-left"
                          onClick={signOut}
                        >
                          <LogOut className="h-4 w-4 shrink-0" />
                          Logout
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="icon-button text-white"
                  onClick={() =>
                    setThemeMode((current) =>
                      current === 'light' ? 'dark' : 'light',
                    )
                  }
                >
                  {themeMode === 'light' ? (
                    <Moon className="h-5 w-5" />
                  ) : (
                    <SunMedium className="h-5 w-5" />
                  )}
                </button>

                <div
                  className="notification-bell relative"
                  ref={notificationsPreviewRef}
                >
                  <button
                    type="button"
                    className="icon-button relative text-white"
                    onClick={() => setNotificationsPreviewOpen((current) => !current)}
                    aria-label={`Notifications${unreadNotificationCount ? ` (${unreadNotificationCount} unread)` : ''}`}
                    aria-expanded={notificationsPreviewOpen}
                    aria-haspopup="dialog"
                  >
                    <Bell className="h-5 w-5" />
                    {unreadNotificationCount > 0 && (
                      <span className="notification-badge absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-white">
                        {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                      </span>
                    )}
                  </button>

                  {notificationsPreviewOpen && (
                    <>
                      {isMobileViewport && (
                        <button
                          type="button"
                          className="fixed inset-0 z-30 bg-slate-950/35"
                          aria-label="Close notifications preview"
                          onClick={() => setNotificationsPreviewOpen(false)}
                        />
                      )}
                      <div
                        className={`notification-preview surface z-40 p-3 text-[color:var(--text)] shadow-[0_20px_60px_rgba(13,47,79,0.18)] ${
                          isMobileViewport
                            ? 'fixed left-1/2 top-1/2 w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto'
                            : 'absolute right-0 top-full mt-2 w-[22rem] max-w-[calc(100vw-2rem)]'
                        }`}
                        role="dialog"
                        aria-modal={isMobileViewport}
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">Recent notifications</div>
                          <div className="text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                            {unreadNotificationCount} unread
                          </div>
                        </div>

                        <div className="space-y-2">
                          {notificationPreviewItems.length > 0 ? (
                            notificationPreviewItems.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className="notification-preview-item surface-muted block w-full p-3 text-left"
                                onClick={() => {
                                  openTicket(item.ticketId)
                                  setNotificationsPreviewOpen(false)
                                }}
                              >
                                <div className="mb-1 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    {!readNotificationIdSet.has(item.id) && (
                                      <span className="notification-unread-dot" aria-hidden="true" />
                                    )}
                                    <span className="font-mono text-sm font-semibold text-[color:var(--accent)]">
                                      {item.ticketId}
                                    </span>
                                    {item.type === 'mention' && (
                                      <span className="badge badge-blue">Mention</span>
                                    )}
                                  </div>
                                  <span className="text-xs text-[color:var(--text-muted)]">{formatDateTime(item.at)}</span>
                                </div>
                                <div className="text-sm font-semibold text-[color:var(--text)]">{item.ticketTitle}</div>
                                <div className="mt-1 text-sm text-[color:var(--text-muted)] line-clamp-2">
                                  <span className="font-semibold text-[color:var(--text)]">{item.actor}</span> {item.message}
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className="surface-muted p-3 text-sm text-[color:var(--text-muted)]">
                              No recent messages.
                            </div>
                          )}
                        </div>

                        <div className="mt-3 flex justify-end border-t border-[color:var(--border)] pt-3">
                          <button
                            type="button"
                            className="dashboard-reset-button"
                            onClick={openNotificationsPage}
                          >
                            View all
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {(currentUser.role === 'Admin' || currentUser.role === 'Super Admin') && (
                  <button
                    type="button"
                    className="icon-button text-white"
                    onClick={() => setActiveView('settings')}
                  >
                    <Settings className="h-5 w-5" />
                  </button>
                )}

              </div>
            </div>

          </header>

          <div className="sticky top-13 z-10 border-b border-[color:var(--border)] bg-[color:var(--card-bg)]">
            <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
              <div>
                <div className="text-lg font-semibold">
                  {currentViewLabel}
                </div>
                <div className="text-sm text-[color:var(--text-muted)]">
                  {activeView === 'dashboard'
                    ? `${tickets.length} total tickets`
                    : activeView === 'notifications'
                      ? `${unreadNotificationCount} unread assigned or mention items`
                    : activeView === 'manage-organizations'
                      ? `${organizations.length} organization${organizations.length === 1 ? '' : 's'} available`
                    : activeView === 'manage-users'
                      ? `${users.length} user${users.length === 1 ? '' : 's'} across ${teams.length} teams`
                    : activeView === 'manage-teams'
                      ? `${teams.length} team${teams.length === 1 ? '' : 's'} available for assignment`
                    : activeView === 'manage-categories'
                      ? `${categories.length} categor${categories.length === 1 ? 'y' : 'ies'} mapped to teams`
                    : activeView === 'settings' || activeView === 'reports'
                      ? `${users.length} users across ${teams.length} teams`
                    : activeView === 'ticket-designer'
                      ? 'Configure custom fields per team'
                    : canViewAllOrgTickets
                      ? `${visibleTickets.length} tickets across your organization`
                    : `${visibleTickets.length} tickets in ${currentTeam.name}`}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {activeView !== 'settings' &&
                  activeView !== 'notifications' &&
                  activeView !== 'reports' &&
                  activeView !== 'manage-organizations' &&
                  activeView !== 'manage-users' &&
                  activeView !== 'manage-teams' &&
                  activeView !== 'manage-categories' &&
                  activeView !== 'ticket-designer' &&
                  activeView !== 'new-ticket' && (
                  <>
                    {activeView === 'dashboard' && (
                      <button
                        type="button"
                        className="dashboard-reset-button"
                        onClick={resetDashboardLayout}
                        title="Reset dashboard layout"
                      >
                        Reset layout
                      </button>
                    )}

                    {activeView === 'team-tickets' && (
                      <div className="flex items-center overflow-hidden rounded-[2px] border border-[color:var(--border)]">
                        {(['All', ...statusOptions] as Array<TicketStatus | 'All'>).map((status) => (
                          <button
                            key={status}
                            type="button"
                            className="view-toggle"
                            data-active={teamTicketsStatusFilter === status}
                            onClick={() => setTeamTicketsStatusFilter(status)}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center overflow-hidden rounded-[2px] border border-[color:var(--border)]">
                      <button
                        type="button"
                        className="view-toggle"
                        data-active={listMode === 'table'}
                        onClick={() => setListMode('table')}
                      >
                        Table
                      </button>
                      <button
                        type="button"
                        className="view-toggle"
                        data-active={listMode === 'cards'}
                        onClick={() => setListMode('cards')}
                      >
                        Cards
                      </button>
                    </div>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => setActiveView('new-ticket')}
                    >
                      <Plus className="h-4 w-4" />
                      New
                    </button>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={exportVisibleTickets}
                    >
                      <Download className="h-4 w-4" />
                      Export
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <main className="flex-1 px-4 py-4 lg:px-6 lg:py-5">
            {activeView === 'dashboard' && (
              <div className="space-y-4">
                <ResponsiveDashboardGrid
                  className="dashboard-grid"
                  layouts={visibleDashboardLayouts}
                  breakpoints={{ lg: 1280, md: 1024, sm: 640, xs: 0 }}
                  cols={{ lg: 10, md: 10, sm: 5, xs: 1 }}
                  rowHeight={52}
                  margin={[16, 16]}
                  containerPadding={[0, 0]}
                  draggableHandle=".dashboard-widget-handle"
                  isDraggable={!isMobileViewport}
                  isResizable={!isMobileViewport}
                  onLayoutChange={(_currentLayout: Layout, allLayouts: DashboardLayouts) => {
                    startTransition(() => {
                      setDashboardLayouts(mergeDashboardLayouts(allLayouts))
                    })
                  }}
                >
                  {visibleDashboardWidgetIds.map((widgetId) => (
                    <div key={widgetId} className="dashboard-widget-shell">
                      {renderDashboardWidget(widgetId)}
                    </div>
                  ))}
                </ResponsiveDashboardGrid>
              </div>
            )}

            {(activeView === 'unassigned' ||
              activeView === 'my-tickets' ||
              activeView === 'team-tickets') && renderTicketCollection()}

            {activeView === 'notifications' && renderNotificationsPage()}

            {activeView === 'reports' && (currentUser.role === 'Admin' || currentUser.role === 'Super Admin') && (
              <ReportsPage sessionToken={null} powerBiReportUrl={powerBiReportUrl} />
            )}

            {activeView === 'settings' && (currentUser.role === 'Admin' || currentUser.role === 'Super Admin') && renderAdminSettingsPage()}

            {activeView === 'manage-organizations' && (currentUser.role === 'Admin' || currentUser.role === 'Super Admin') && renderManageOrganizationsPage()}

            {activeView === 'manage-users' && (currentUser.role === 'Admin' || currentUser.role === 'Super Admin') && renderManageUsersPage()}

            {activeView === 'manage-teams' && (currentUser.role === 'Admin' || currentUser.role === 'Super Admin') && renderManageTeamsPage()}

            {activeView === 'manage-categories' && (currentUser.role === 'Admin' || currentUser.role === 'Super Admin') && renderManageCategoriesPage()}

            {activeView === 'ticket-designer' && (currentUser.role === 'Admin' || currentUser.role === 'Super Admin') && renderTicketDesignerPage()}

            {activeView === 'about' && (
              <div className="surface p-6">
                {aboutPageHtml ? (
                  <div
                    className="about-page-content"
                    dangerouslySetInnerHTML={{ __html: aboutPageHtml }}
                  />
                ) : (
                  <div className="text-sm text-[color:var(--text-muted)]">No about page content has been configured yet.</div>
                )}
              </div>
            )}

            {activeView === 'new-ticket' && (
              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="surface p-4">
                  <div className="mb-4">
                    <div className="text-xl font-semibold">New Support Ticket</div>
                    <div className="text-sm text-[color:var(--text-muted)]">
                      {canViewAllOrgTickets
                        ? 'Choose any team in your organization. Categories and assignees are restricted to the selected team.'
                        : `Categories and assignees are restricted to ${currentTeam.name}.`}
                    </div>
                  </div>

                  {currentTeamCategories.length === 0 && !canViewAllOrgTickets && (
                    <div className="mb-4 rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      No categories are configured for {currentTeam.name}. An administrator must add at least one category in Settings before tickets can be created.
                    </div>
                  )}

                  <LayoutTicketForm
                    layout={organizationTicketLayout}
                    customFieldDefs={createTicketFieldDefs}
                    categories={categories}
                    users={users}
                    locations={locations}
                    values={newTicketForm}
                    onChange={(patch) =>
                      setNewTicketForm((current) => {
                        const next = { ...current, ...patch }
                        if (patch.teamId && patch.teamId !== current.teamId) {
                          const firstCategory = categories.find((c) => c.teamId === patch.teamId)
                          next.categoryId = firstCategory?.id ?? ''
                          next.assignedToId = ''
                        }
                        return next
                      })
                    }
                    customValues={newTicketCustomFields}
                    onCustomChange={(fieldId, value) =>
                      setNewTicketCustomFields((prev) => ({ ...prev, [fieldId]: value }))
                    }
                    teamOptions={organizationTeams}
                    canChangeTeam={canViewAllOrgTickets}
                  />

                  <div className="mt-4 flex items-center justify-end gap-3">
                    {createTicketError && (
                      <div className="rounded-[2px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {createTicketError}
                      </div>
                    )}
                    <button
                      type="button"
                      className="primary-button"
                      onClick={createTicket}
                      disabled={createTicketPending}
                    >
                      <Plus className="h-4 w-4" />
                      {createTicketPending ? 'Creating...' : 'Create Ticket'}
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="surface p-4">
                    <div className="mb-3 text-xl font-semibold">Team Controls</div>
                    <div className="space-y-3 text-sm text-[color:var(--text-muted)]">
                      <div className="surface-muted p-3">
                        Staff can only choose categories tied to {currentTeam.name}.
                      </div>
                      <div className="surface-muted p-3">
                        Staff reassignment is limited to {currentTeamMembers.length} people in the current team roster.
                      </div>
                      <div className="surface-muted p-3">
                        Logged in as <span className="font-semibold text-[color:var(--text)]">{currentUser.name}</span> with <span className="font-semibold text-[color:var(--text)]">{currentUser.role}</span> permissions.
                      </div>
                    </div>
                  </div>

                  <div className="surface p-4">
                    <div className="mb-3 text-xl font-semibold">Available Categories</div>
                    <div className="space-y-2">
                      {currentTeamCategories.map((category) => (
                        <div key={category.id} className="surface-muted p-3 text-sm">
                          <div className="font-semibold text-[color:var(--text)]">{category.name}</div>
                          <div className="text-[color:var(--text-muted)]">{category.description}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      <AnimatePresence>
        {activeView === 'manage-users' && manageUsersEditDraft && (
          <>
            <motion.button
              type="button"
              aria-label="Close user editor"
              className="fixed inset-0 z-30 bg-slate-950/35"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              onClick={() => setManageUsersEditDraft(null)}
            />

            <motion.aside
              className="detail-panel fixed right-0 top-0 z-40 h-screen border-l border-[color:var(--border)] bg-[color:var(--panel-bg)]"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.28, ease: 'easeInOut' }}
            >
              <div className="detail-panel-shell">{renderManageUsersEditPanelContent()}</div>
            </motion.aside>
          </>
        )}

        {selectedTicket && detailDraft && (
          <>
            {!detailPinned && (
              <motion.button
                type="button"
                aria-label="Close details panel"
                className="fixed inset-0 z-30 bg-slate-950/35"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                onClick={closePanel}
              />
            )}

            <motion.aside
              className="detail-panel fixed right-0 top-0 z-40 h-screen border-l border-[color:var(--border)] bg-[color:var(--panel-bg)]"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.28, ease: 'easeInOut' }}
            >
              <div className="detail-panel-shell flex h-full flex-col">
                {!isMobileViewport && (
                  <div
                    className="detail-resize-handle"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      startDetailResize(event.clientX)
                    }}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize ticket panel"
                  />
                )}
                <div className="border-b border-[color:var(--border)] px-5 py-4">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[1.09375rem] font-semibold text-[color:var(--accent)]">
                          {selectedTicket.id}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-2 py-0.5 text-xs text-[color:var(--text-muted)]">
                          <Paperclip className="h-3.5 w-3.5" />
                          {selectedTicket.attachmentCount ?? 0}
                        </span>
                        <span className={getStatusBadgeClass(selectedTicket.status)}>
                          {selectedTicket.status}
                        </span>
                        <span className={getPriorityBadgeClass(selectedTicket.priority)}>
                          {selectedTicket.priority}
                        </span>
                      </div>
                      <h2 className="text-2xl font-semibold">{selectedTicket.title}</h2>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setDetailPinned((current) => !current)}
                        title={detailPinned ? 'Unpin panel' : 'Pin panel'}
                      >
                        {detailPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </button>
                      <button type="button" className="icon-button" onClick={closePanel}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-6 border-b border-[color:var(--border)]">
                    {(['details', 'activity', 'attachments', 'versions'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        className="tab-link"
                        data-active={detailTab === tab}
                        onClick={() => setDetailTab(tab)}
                      >
                        {tab === 'details'
                          ? 'Details'
                          : tab === 'activity'
                            ? 'Activity'
                            : tab === 'attachments'
                              ? 'Attachments'
                              : 'Versions'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5">
                  {detailTab === 'details' ? (
                    <div className="grid gap-4">
                      <LayoutTicketForm
                        layout={organizationTicketLayout}
                        customFieldDefs={detailCustomFieldDefs}
                        categories={categories}
                        users={users}
                        locations={locations}
                        values={detailDraft}
                        onChange={(patch) =>
                          setDetailDraft((current) => {
                            if (!current) return current
                            const next = { ...current, ...patch }
                            if (patch.teamId && patch.teamId !== current.teamId) {
                              const firstCategory = categories.find((c) => c.teamId === patch.teamId)
                              next.categoryId = firstCategory?.id ?? ''
                              next.assignedToId = ''
                            }
                            return next
                          })
                        }
                        customValues={detailCustomFieldValues}
                        onCustomChange={(fieldId, value) =>
                          setDetailCustomFieldValues((prev) => ({ ...prev, [fieldId]: value }))
                        }
                        teamOptions={organizationTeams}
                        canChangeTeam={canViewAllOrgTickets}
                      />

                      {/* Watchers — hidden for first release; flip to true to restore */}
                      {false && (() => {
                        const orgUsers = users.filter(
                          (u) => u.organizationId === currentUser.organizationId,
                        )
                        const watcherIds = new Set(ticketWatchers.map((w) => w.userId))
                        const availableToAdd = orgUsers.filter((u) => !watcherIds.has(u.id))
                        const isWatching = watcherIds.has(currentUser.id)

                        return (
                          <div className="border-t border-[color:var(--border)] pt-4">
                            <div className="mb-2 flex items-center gap-2">
                              <Eye className="h-4 w-4 text-[color:var(--text-muted)]" />
                              <span className="text-sm font-semibold text-[color:var(--text-muted)] uppercase tracking-[0.1em]">
                                Watchers
                              </span>
                              {!isWatching && (
                                <button
                                  type="button"
                                  className="ml-auto inline-flex items-center gap-1 rounded-[2px] border border-[#a9c9ff] bg-[#eaf3ff] px-2 py-0.5 text-xs text-[#315dc6] hover:opacity-80"
                                  onClick={() => addWatcher(currentUser.id)}
                                >
                                  <UserPlus className="h-3.5 w-3.5" />
                                  Watch
                                </button>
                              )}
                            </div>

                            {ticketWatchers.length === 0 ? (
                              <p className="text-sm text-[color:var(--text-muted)]">No watchers yet.</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {ticketWatchers.map((watcher) => (
                                  <span
                                    key={watcher.userId}
                                    className="inline-flex items-center gap-1.5 rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-2.5 py-1 text-xs"
                                  >
                                    <UserIcon className="h-3.5 w-3.5 text-[color:var(--text-muted)]" />
                                    {watcher.name}
                                    {(watcher.userId === currentUser.id || currentUser.role === 'Admin' || currentUser.role === 'Super Admin') && (
                                      <button
                                        type="button"
                                        aria-label={`Remove ${watcher.name} from watchers`}
                                        className="ml-0.5 text-[color:var(--text-muted)] hover:text-red-500"
                                        onClick={() => removeWatcher(watcher.userId)}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    )}
                                  </span>
                                ))}
                              </div>
                            )}

                            {availableToAdd.length > 0 && (
                              <div className="mt-2 flex items-center gap-2">
                                <select
                                  className="input-control flex-1 text-sm"
                                  defaultValue=""
                                  onChange={(event) => {
                                    const val = event.target.value
                                    if (val) {
                                      void addWatcher(val)
                                      event.target.value = ''
                                    }
                                  }}
                                >
                                  <option value="" disabled>
                                    Add watcher…
                                  </option>
                                  {availableToAdd.map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        )
                      })()}

                      <div className="flex items-center justify-between border-t border-[color:var(--border)] pt-4">
                        <div className="text-sm text-[color:var(--text-muted)]">
                          <div>Last updated {formatDateTime(selectedTicket.updatedAt)}</div>
                          {selectedTicket.resolvedAt && (
                            <div>Resolved {formatDateTime(selectedTicket.resolvedAt)}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {detailSaveError && (
                            <div className="rounded-[2px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                              {detailSaveError}
                            </div>
                          )}
                          <button
                            type="button"
                            className="primary-button"
                            onClick={saveTicketChanges}
                            disabled={detailSavePending}
                          >
                            {detailSavePending ? 'Saving...' : 'Save changes'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : detailTab === 'versions' ? (
                    <TicketVersionHistory
                      ticketId={selectedTicket.id}
                      currentTicket={selectedTicket}
                      currentUser={currentUser}
                      layout={organizationTicketLayout}
                      customFieldDefs={detailCustomFieldDefs}
                      categories={categories}
                      users={users}
                      locations={locations}
                      onTicketReverted={(ticket) => {
                        setTickets((current) =>
                          current.map((t) => (t.id === ticket.id ? ticket : t)),
                        )
                        setDetailDraft({
                          teamId: ticket.teamId,
                          title: ticket.title,
                          description: ticket.description,
                          status: ticket.status,
                          priority: ticket.priority,
                          categoryId: ticket.categoryId,
                          assignedToId: ticket.assignedToId ?? '',
                          requestorName: ticket.requestorName,
                          requestorEmail: ticket.requestorEmail,
                          location: ticket.location,
                        })
                        const updatedCustomValues: Record<string, string> = {}
                        for (const cf of ticket.customFields ?? []) {
                          updatedCustomValues[cf.fieldId] = cf.value
                        }
                        setDetailCustomFieldValues((prev) => ({ ...prev, ...updatedCustomValues }))
                      }}
                    />
                  ) : detailTab === 'activity' ? (
                    <div className="space-y-4">
                      <div className="surface-muted space-y-3 p-4">
                        <div>
                          <div className="text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                            Add Comment
                          </div>
                          <div className="text-sm text-[color:var(--text-muted)]">
                            Comments are added to the ticket activity feed. Use @handle to notify teammates.
                          </div>
                        </div>
                        <textarea
                          className="input-control min-h-28 resize-y"
                          value={commentDraft}
                          onChange={(event) => setCommentDraft(event.target.value)}
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className="primary-button"
                            onClick={addTicketComment}
                            disabled={!commentDraft.trim() || commentPending}
                          >
                            {commentPending ? 'Saving...' : 'Post Comment'}
                          </button>
                        </div>
                        {commentError && (
                          <div className="rounded-[2px] border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                            {commentError}
                          </div>
                        )}
                      </div>

                      <div className="space-y-3">
                        {[...selectedTicket.activity]
                          .sort(
                            (left, right) =>
                              new Date(right.at).getTime() - new Date(left.at).getTime(),
                          )
                          .map((entry) => (
                            <div key={entry.id} className="surface-muted p-4">
                              <div className="mb-1 flex items-center justify-between gap-3">
                                <div className="font-semibold text-[color:var(--text)]">
                                  {entry.actor}
                                </div>
                                <div className="text-xs uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                                  {formatDateTime(entry.at)}
                                </div>
                              </div>
                              <div className="text-sm text-[color:var(--text-muted)]">
                                {entry.message}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="surface-muted space-y-3 p-4">
                        <div>
                          <div className="text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                            Upload Attachment
                          </div>
                          <div className="text-sm text-[color:var(--text-muted)]">
                            Files are stored directly in SQL Server for this implementation.
                          </div>
                        </div>
                        <input
                          ref={attachmentInputRef}
                          type="file"
                          className="hidden"
                          onChange={(event) => setAttachmentFile(event.target.files?.[0] ?? null)}
                        />
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm text-[color:var(--text-muted)]">
                            {attachmentFile
                              ? `${attachmentFile.name} • ${formatFileSize(attachmentFile.size)}`
                              : 'Select a file up to 10 MB.'}
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => attachmentInputRef.current?.click()}
                              disabled={attachmentUploadPending}
                            >
                              File upload
                            </button>
                            <button
                              type="button"
                              className="primary-button"
                              onClick={uploadAttachment}
                              disabled={attachmentUploadPending}
                            >
                              <FileUp className="h-4 w-4" />
                              {attachmentUploadPending ? 'Uploading...' : 'Upload'}
                            </button>
                          </div>
                        </div>
                        {attachmentsError && (
                          <div className="rounded-[2px] border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                            {attachmentsError}
                          </div>
                        )}
                      </div>

                      <div className="space-y-3">
                        {attachmentsLoading ? (
                          <div className="surface-muted p-4 text-sm text-[color:var(--text-muted)]">
                            Loading attachments...
                          </div>
                        ) : attachments.length === 0 ? (
                          <div className="surface-muted p-4 text-sm text-[color:var(--text-muted)]">
                            No attachments have been uploaded for this ticket.
                          </div>
                        ) : (
                          attachments.map((attachment) => (
                            <div key={attachment.id} className="surface-muted flex flex-col gap-3 p-4">
                              <div>
                                <div className="font-semibold text-[color:var(--text)]">{attachment.fileName}</div>
                                <div className="text-sm text-[color:var(--text-muted)]">
                                  {formatFileSize(attachment.fileSizeBytes)} • {attachment.contentType || 'application/octet-stream'}
                                </div>
                                <div className="text-xs uppercase tracking-[0.08em] text-[color:var(--text-muted)]">
                                  Uploaded by {attachment.uploadedByName} on {formatDateTime(attachment.uploadedAt)}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--border)] pt-3 md:justify-end">
                                {attachment.contentType.toLowerCase().includes('pdf') && (
                                  <button
                                    type="button"
                                    className="secondary-button"
                                    onClick={() => openAttachmentPreview(attachment)}
                                  >
                                    Preview
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => downloadAttachment(attachment)}
                                >
                                  <Download className="h-4 w-4" />
                                  Download
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => removeAttachment(attachment.id)}
                                  disabled={attachmentDeletePendingId === attachment.id}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {attachmentDeletePendingId === attachment.id ? 'Removing...' : 'Remove'}
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {previewAttachment && (
                        <div className="surface-muted space-y-3 p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                                PDF Preview
                              </div>
                              <div className="text-sm text-[color:var(--text)]">{previewAttachment.fileName}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="icon-button"
                                onClick={closeAttachmentPreview}
                                aria-label="Close PDF preview"
                                title="Close preview"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <PdfPreview fileUrl={previewAttachmentUrl} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsDrawerSection && (
          <>
            <motion.button
              type="button"
              aria-label="Close settings panel"
              className="fixed inset-0 z-30 bg-slate-950/35"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              onClick={closeSettingsDrawer}
            />

            <motion.aside
              className="detail-panel fixed right-0 top-0 z-40 h-screen border-l border-[color:var(--border)] bg-[color:var(--panel-bg)]"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.28, ease: 'easeInOut' }}
            >
              <div className="detail-panel-shell flex h-full flex-col">
                <div className="border-b border-[color:var(--border)] px-5 py-4">
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                        Settings Management
                      </div>
                      <h2 className="text-2xl font-semibold">
                        {
                          {
                            manageOrganizations: 'Organizations',
                            manageUsers: 'Users',
                            manageTeams: 'Teams',
                            categories: 'Categories',
                          }[settingsDrawerSection]
                        }
                      </h2>
                      <div className="mt-1 text-sm text-[color:var(--text-muted)]">
                        Add new entries or update existing records from this panel.
                      </div>
                    </div>

                    <button type="button" className="icon-button" onClick={closeSettingsDrawer}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {renderSettingsDrawerContent(settingsDrawerSection)}
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {changePasswordModal && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-950/40"
            aria-label="Close dialog"
            onClick={() => setChangePasswordModal(null)}
          />
          <div
            role="dialog"
            aria-modal={true}
            aria-labelledby="change-pw-title"
            className="surface fixed left-1/2 top-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-6 shadow-[0_24px_64px_rgba(13,47,79,0.22)]"
          >
            <h2 id="change-pw-title" className="mb-1 text-base font-semibold text-[color:var(--text)]">
              Change Password
            </h2>
            <p className="mb-4 text-sm text-[color:var(--text-muted)]">
              Set a new password for <strong>{changePasswordModal.userName}</strong>.
            </p>
            {changePasswordError && (
              <div className="mb-3 rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {changePasswordError}
              </div>
            )}
            <input
              type="password"
              className="input-control mb-4 w-full"
              placeholder="New password (min. 8 characters)"
              value={changePasswordValue}
              onChange={(e) => setChangePasswordValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleChangePassword() }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setChangePasswordModal(null)}
                disabled={changePasswordPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleChangePassword()}
                disabled={changePasswordPending}
              >
                {changePasswordPending ? 'Saving...' : 'Update Password'}
              </button>
            </div>
          </div>
        </>
      )}

      {quickActionConfirmation && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-slate-950/40"
            aria-label="Close dialog"
            onClick={() => setQuickActionConfirmation(null)}
          />
          <div
            role="dialog"
            aria-modal={true}
            aria-labelledby="quick-action-confirm-title"
            className="surface fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-6 shadow-[0_24px_64px_rgba(13,47,79,0.22)]"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] bg-[color:var(--panel-bg)] text-[color:var(--accent)]">
                <TriangleAlert className="h-5 w-5" />
              </div>
              <div>
                <h2 id="quick-action-confirm-title" className="mb-1 text-base font-semibold text-[color:var(--text)]">
                  {getQuickActionCopy(quickActionConfirmation.action).confirmTitle}
                </h2>
                <p className="text-sm text-[color:var(--text-muted)]">
                  {getQuickActionCopy(quickActionConfirmation.action).confirmMessage}
                </p>
              </div>
            </div>

            <div className="surface-muted mb-4 space-y-1 p-3">
              <div className="font-mono text-sm font-semibold text-[color:var(--accent)]">
                {quickActionConfirmation.ticketId}
              </div>
              <div className="text-sm font-semibold text-[color:var(--text)]">
                {quickActionConfirmation.ticketTitle}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setQuickActionConfirmation(null)}
                disabled={quickActionPendingTicketId !== null}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void confirmQuickTicketAction()}
                disabled={quickActionPendingTicketId !== null}
              >
                {quickActionPendingTicketId === quickActionConfirmation.ticketId
                  ? 'Updating...'
                  : getQuickActionCopy(quickActionConfirmation.action).buttonLabel}
              </button>
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {quickActionToast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="pointer-events-none fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))]"
          >
            <div
              className={`surface border px-4 py-3 shadow-[0_18px_48px_rgba(13,47,79,0.18)] ${
                quickActionToast.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50/95 text-emerald-900'
                  : 'border-rose-200 bg-rose-50/95 text-rose-900'
              }`}
              role="status"
              aria-live="polite"
            >
              <div className="text-sm font-semibold">
                {quickActionToast.message}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  )
}

export default App
