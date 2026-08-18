import { getDb, dbAll, dbGet } from './db.js'
import { createTicket } from './tickets.js'
import { listLocations } from './locations.js'
import type { TicketRecord } from './tickets.js'

export interface SeedRandomTicketsInput {
  organizationId: string
  actor: string
  assignToStaff?: boolean
  teamId?: string
}

export interface SeedRandomTicketsResult {
  tickets: TicketRecord[]
}

interface SeedTeam {
  id: string
  name: string
}

interface SeedCategory {
  id: string
  teamId: string
  name: string
}

interface SeedUser {
  id: string
  teamId: string
}

const TICKET_COUNT = 10
const ASSIGNMENT_PROBABILITY = 0.25

const firstNames = [
  'James', 'Maria', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Patricia',
  'David', 'Elizabeth', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah',
  'Charles', 'Karen', 'Daniel', 'Nancy', 'Matthew', 'Lisa', 'Anthony', 'Betty',
  'Mark', 'Helen', 'Donald', 'Sandra', 'Steven', 'Donna', 'Paul', 'Carol',
  'Andrew', 'Ruth', 'Joshua', 'Sharon', 'Kenneth', 'Michelle', 'Kevin', 'Emily',
]

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
]

const emailDomains = [
  'company.com', 'example.org', 'acme.local', 'contoso.com', 'widgetco.test',
]

const titleTemplates: Record<string, string[]> = {
  default: [
    'Unable to access shared drive',
    'Request for new hardware',
    'Application keeps crashing',
    'Printer not responding',
    'VPN connection issue',
    'Password reset request',
    'Email not syncing on mobile',
    'Slow performance on workstation',
    'Meeting room AV equipment broken',
    'New user account setup',
    'Software license renewal',
    'Internet connectivity problem',
    'File recovery request',
    'Security badge not working',
    'Desk relocation support',
    'Backup verification needed',
  ],
}

const descriptionTemplates: Record<string, string[]> = {
  default: [
    'User reports the issue started this morning and is blocking their work.',
    'This is a recurring problem that was previously resolved but has returned.',
    'Request submitted through the portal with medium urgency.',
    'Multiple users in the same area have reported similar symptoms.',
    'Please prioritize this during the next maintenance window.',
    'Standard onboarding request for a new team member starting next week.',
    'Device was working yesterday but stopped functioning after an update.',
    'Need assistance before the end of the business day if possible.',
    'This request was escalated by the department manager.',
    'Looking for guidance on the correct procedure or workaround.',
  ],
}

const priorityValues = ['Low', 'Medium', 'High', 'Critical']

const pickRandom = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]

const generateRequestor = () => {
  const firstName = pickRandom(firstNames)
  const lastName = pickRandom(lastNames)
  const domain = pickRandom(emailDomains)
  const name = `${firstName} ${lastName}`
  const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`
  return { name, email }
}

const generateTitle = () => pickRandom(titleTemplates.default)

const generateDescription = () => pickRandom(descriptionTemplates.default)

const listOrganizationTeams = async (organizationId: string): Promise<SeedTeam[]> => {
  const db = getDb()
  const rows = (await dbAll(db, 'SELECT Id AS id, Name AS name FROM Teams WHERE OrganizationId = ? ORDER BY Name ASC', [
    organizationId,
  ])) as Array<{ id: unknown; name: unknown }>
  return rows.map((row) => ({ id: String(row.id), name: String(row.name) }))
}

const listTeamCategories = async (teamIds: string[]): Promise<SeedCategory[]> => {
  if (teamIds.length === 0) return []
  const db = getDb()
  const placeholders = teamIds.map(() => '?').join(', ')
  const rows = (await dbAll(
    db,
    `SELECT Id AS id, TeamId AS teamId, Name AS name FROM Categories WHERE TeamId IN (${placeholders}) ORDER BY Name ASC`,
    teamIds,
  )) as Array<{ id: unknown; teamId: unknown; name: unknown }>
  return rows.map((row) => ({ id: String(row.id), teamId: String(row.teamId), name: String(row.name) }))
}

const listOrganizationStaff = async (organizationId: string): Promise<SeedUser[]> => {
  const db = getDb()
  const rows = (await dbAll(
    db,
    `SELECT Id AS id, TeamId AS teamId FROM Users
     WHERE OrganizationId = ? AND Role IN ('Staff', 'Admin')
     ORDER BY Name ASC`,
    [organizationId],
  )) as Array<{ id: unknown; teamId: unknown }>
  return rows.map((row) => ({ id: String(row.id), teamId: String(row.teamId) }))
}

const resolveOrganizationExists = async (organizationId: string): Promise<boolean> => {
  const db = getDb()
  const row = await dbGet(db, 'SELECT 1 AS existsFlag FROM Organizations WHERE Id = ?', [organizationId])
  return Boolean(row)
}

export const seedRandomTickets = async (input: SeedRandomTicketsInput): Promise<TicketRecord[]> => {
  const organizationId = input.organizationId.trim()
  if (!organizationId) throw new Error('organization_id_required')

  const organizationExists = await resolveOrganizationExists(organizationId)
  if (!organizationExists) throw new Error('organization_not_found')

  const [teams, staff, locations] = await Promise.all([
    listOrganizationTeams(organizationId),
    listOrganizationStaff(organizationId),
    listLocations(true),
  ])

  if (teams.length === 0) throw new Error('organization_has_no_teams')

  const requestedTeamId = input.teamId?.trim()
  const targetTeams = requestedTeamId
    ? teams.filter((team) => team.id === requestedTeamId)
    : teams

  if (targetTeams.length === 0) throw new Error('team_not_found')

  const categories = await listTeamCategories(targetTeams.map((team) => team.id))
  if (categories.length === 0) throw new Error('organization_has_no_categories')

  const categoriesByTeam = new Map<string, SeedCategory[]>()
  for (const category of categories) {
    const current = categoriesByTeam.get(category.teamId) ?? []
    current.push(category)
    categoriesByTeam.set(category.teamId, current)
  }

  const teamsWithCategories = targetTeams.filter((team) => (categoriesByTeam.get(team.id)?.length ?? 0) > 0)
  if (teamsWithCategories.length === 0) throw new Error('organization_has_no_categories')

  const staffByTeam = new Map<string, SeedUser[]>()
  for (const user of staff) {
    const current = staffByTeam.get(user.teamId) ?? []
    current.push(user)
    staffByTeam.set(user.teamId, current)
  }

  const locationNames = locations.length > 0 ? locations.map((location) => location.name) : ['Not specified']
  const assignToStaff = input.assignToStaff !== false
  const createdTickets: TicketRecord[] = []

  for (let index = 0; index < TICKET_COUNT; index++) {
    const team = pickRandom(teamsWithCategories)
    const teamCategories = categoriesByTeam.get(team.id) ?? []
    const category = pickRandom(teamCategories)
    const requestor = generateRequestor()
    const location = pickRandom(locationNames)
    const priority = pickRandom(priorityValues)

    let assignedToId: string | null = null
    if (assignToStaff) {
      const eligibleStaff = staffByTeam.get(team.id) ?? []
      if (eligibleStaff.length > 0 && Math.random() < ASSIGNMENT_PROBABILITY) {
        assignedToId = pickRandom(eligibleStaff).id
      }
    }

    const ticket = await createTicket(
      {
        title: generateTitle(),
        description: generateDescription(),
        status: 'Open',
        priority,
        teamId: team.id,
        categoryId: category.id,
        assignedToId,
        requestorName: requestor.name,
        requestorEmail: requestor.email,
        location,
        customFields: [],
      },
      input.actor,
    )

    if (!ticket) {
      throw new Error('ticket_create_failed')
    }

    createdTickets.push(ticket)
  }

  return createdTickets
}
