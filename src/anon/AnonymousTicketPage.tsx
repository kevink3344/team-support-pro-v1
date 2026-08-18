import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Building2, CheckCircle2, Send, Ticket } from 'lucide-react'

import { apiUrl, appConfig } from '../config'
import { defaultThemeConfig } from '../theme'
import type { AnonymousPageConfig, Category, Location, Organization, Team, Ticket as TicketRecord } from '../types'

type AnonymousTicketForm = {
  title: string
  requestorName: string
  requestorEmail: string
  location: string
  teamId: string
  categoryId: string
  description: string
}

const initialForm: AnonymousTicketForm = {
  title: '',
  requestorName: '',
  requestorEmail: '',
  location: '',
  teamId: '',
  categoryId: '',
  description: '',
}

const getAnonymousPagePath = () => {
  if (typeof window === 'undefined') {
    return 'index.html'
  }

  const match = window.location.pathname.match(/\/anon\/([^/]+\.html)$/i)
  return match?.[1]?.toLowerCase() ?? 'index.html'
}

export function AnonymousTicketPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [form, setForm] = useState<AnonymousTicketForm>(initialForm)
  const [loading, setLoading] = useState(true)
  const [submitPending, setSubmitPending] = useState(false)
  const [error, setError] = useState('')
  const [createdTicket, setCreatedTicket] = useState<TicketRecord | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadDirectory = async () => {
      setLoading(true)
      setError('')

      try {
        const response = await fetch(
          apiUrl(`/api/public/anonymous-page-config?pagePath=${encodeURIComponent(getAnonymousPagePath())}`),
        )
        if (!response.ok) {
          throw new Error('anonymous_page_config_load_failed')
        }

        const payload = (await response.json()) as {
          page?: AnonymousPageConfig
          organization?: Organization
          teams?: Team[]
          categories?: Category[]
        }
        if (cancelled) {
          return
        }

        const nextTeams = payload.teams ?? []
        const nextCategories = payload.categories ?? []
        setTeams(nextTeams)
        setCategories(nextCategories)
        setForm((current) => {
          const teamId = current.teamId && nextTeams.some((team) => team.id === current.teamId)
            ? current.teamId
            : nextTeams[0]?.id || ''
          const categoryId =
            current.categoryId && nextCategories.some((category) => category.id === current.categoryId && category.teamId === teamId)
              ? current.categoryId
              : nextCategories.find((category) => category.teamId === teamId)?.id || ''

          return {
            ...current,
            teamId,
            categoryId,
          }
        })
      } catch {
        if (!cancelled) {
          setError('Anonymous ticket form could not load. Confirm this anonymous page is configured in Settings.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
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

    void loadDirectory()
    void loadLocations()
    return () => {
      cancelled = true
    }
  }, [])

  const availableTeams = useMemo(() => teams, [teams])

  const availableCategories = useMemo(
    () => categories.filter((category) => category.teamId === form.teamId),
    [categories, form.teamId],
  )

  const paletteStyle = {
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
  } as CSSProperties

  useEffect(() => {
    if (!availableCategories.some((category) => category.id === form.categoryId)) {
      setForm((current) => ({
        ...current,
        categoryId: availableCategories[0]?.id || '',
      }))
    }
  }, [availableCategories, form.categoryId])

  const handleSubmit = async () => {
    if (
      !form.title.trim() ||
      !form.requestorName.trim() ||
      !form.requestorEmail.trim() ||
      !form.description.trim() ||
      !form.teamId ||
      !form.categoryId
    ) {
      setError('Complete the required fields before submitting your request.')
      return
    }

    setSubmitPending(true)
    setError('')
    setCreatedTicket(null)

    try {
      const response = await fetch(apiUrl('/api/public/tickets'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pagePath: getAnonymousPagePath(),
          title: form.title.trim(),
          description: form.description.trim(),
          teamId: form.teamId,
          categoryId: form.categoryId,
          requestorName: form.requestorName.trim(),
          requestorEmail: form.requestorEmail.trim(),
          location: form.location.trim(),
        }),
      })

      if (!response.ok) {
        setError('Your request could not be submitted right now.')
        return
      }

      const payload = (await response.json()) as { ticket?: TicketRecord }
      if (!payload.ticket) {
        setError('Your request could not be submitted right now.')
        return
      }

      setCreatedTicket(payload.ticket)
      setForm((current) => ({
        ...initialForm,
        teamId: current.teamId,
        categoryId: categories.find((category) => category.teamId === current.teamId)?.id || '',
      }))
    } catch {
      setError('Your request could not be submitted. Confirm the backend server is running.')
    } finally {
      setSubmitPending(false)
    }
  }

  return (
    <div className="app-shell min-h-screen bg-[color:var(--app-bg)] text-[color:var(--text)]" style={paletteStyle}>
      <div className="anon-ticket-layout mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 lg:flex-row lg:items-start lg:py-10">
        <section className="surface anon-ticket-shell flex-1 p-5 md:p-6">
          <div className="anon-ticket-header mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-[2px] border border-[color:var(--border)] px-3 py-1 text-xs uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                <Ticket className="h-3.5 w-3.5" />
                SUPPORT TICKET
              </div>
              <h1 className="text-2xl font-semibold md:text-3xl">Submit a support request</h1>
              <p className="mt-2 max-w-2xl text-sm text-[color:var(--text-muted)] md:text-base">
                Choose the team that should receive the request, then select the category that best matches your issue. Priority and assignment will be handled by staff after intake.
              </p>
            </div>
          </div>

          {createdTicket && (
            <div className="anon-success-banner mb-5 flex items-start gap-3 rounded-[2px] border px-4 py-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5" />
              <div>
                <div className="font-semibold">Request submitted</div>
                <div className="text-sm">
                  Your ticket number is <span className="font-mono text-[1.09375rem] font-semibold">{createdTicket.id}</span>. The support team will review it and assign priority internally.
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="surface-muted p-4 text-sm text-[color:var(--text-muted)]">Loading ticket form...</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="field md:col-span-2">
                <span className="field-label">Issue Summary</span>
                <input
                  className="input-control"
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Briefly describe the issue"
                />
              </label>
              <label className="field">
                <span className="field-label">Your Name</span>
                <input
                  className="input-control"
                  value={form.requestorName}
                  onChange={(event) => setForm((current) => ({ ...current, requestorName: event.target.value }))}
                  placeholder="Full name"
                />
              </label>
              <label className="field">
                <span className="field-label">Your Email</span>
                <input
                  className="input-control"
                  type="email"
                  value={form.requestorEmail}
                  onChange={(event) => setForm((current) => ({ ...current, requestorEmail: event.target.value }))}
                  placeholder="name@company.com"
                />
              </label>
              <label className="field">
                <span className="field-label">Team</span>
                <select
                  className="input-control"
                  value={form.teamId}
                  onChange={(event) => {
                    const nextTeamId = event.target.value
                    setForm((current) => ({
                      ...current,
                      teamId: nextTeamId,
                      categoryId: categories.find((category) => category.teamId === nextTeamId)?.id || '',
                    }))
                  }}
                >
                  {availableTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Category</span>
                <select
                  className="input-control"
                  value={form.categoryId}
                  onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
                >
                  {availableCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field md:col-span-2">
                <span className="field-label">Location</span>
                <select
                  className="input-control"
                  value={form.location}
                  onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                >
                  <option value="">— Select a location —</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.name}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field md:col-span-2">
                <span className="field-label">Description</span>
                <textarea
                  className="input-control min-h-40"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Describe what happened, what you expected, and any steps already tried."
                />
              </label>
            </div>
          )}

          <div className="anon-ticket-actions mt-5 flex flex-wrap items-center justify-end gap-3">
            {error && (
              <div className="rounded-[2px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={handleSubmit}
              disabled={loading || submitPending}
            >
              <Send className="h-4 w-4" />
              {submitPending ? 'Submitting...' : 'Submit Ticket'}
            </button>
          </div>
        </section>

        <aside className="anon-ticket-sidebar space-y-4 lg:w-[22rem]">
          <section className="surface p-4">
            <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
              <Building2 className="h-5 w-5" />
              Intake Notes
            </div>
            <div className="space-y-3 text-sm text-[color:var(--text-muted)]">
              <div className="surface-muted p-3">
                Tickets submitted here start as <span className="font-semibold text-[color:var(--text)]">Open</span> and <span className="font-semibold text-[color:var(--text)]">Medium</span> priority.
              </div>
              <div className="surface-muted p-3">
                Assignment happens after staff review, so this public form does not expose assignee or priority controls.
              </div>
              <div className="surface-muted p-3">
                Powered by <span className="font-semibold text-[color:var(--text)]">{appConfig.appName}</span>.
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}