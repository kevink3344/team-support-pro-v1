import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts'
import { FileText, FileSpreadsheet } from 'lucide-react'
import { apiUrl } from './config'
import type {
  TicketReport,
  PriorityReport,
  AssigneeReport,
  TrendReport,
  ResolutionTimeBucket,
  AvgResolutionByPriority,
  AvgResolutionByTeam,
  OpenAgeBucket,
  FirstResponseBucket,
} from './types'

interface ReportsPageProps {
  sessionToken: string | null
  powerBiReportUrl: string | null
}

type ReportsTab = 'general' | 'power-bi'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

const PRIORITY_COLORS: Record<string, string> = {
  Critical: '#ef4444',
  High: '#f97316',
  Medium: '#eab308',
  Low: '#22c55e',
}

const ChartCard = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
  <div className="surface p-5 rounded-[2px] border border-[color:var(--border)]">
    <div className="mb-4">
      <div className="text-base font-semibold text-[color:var(--text)]">{title}</div>
      {subtitle && <div className="text-xs text-[color:var(--text-muted)] mt-0.5">{subtitle}</div>}
    </div>
    {children}
  </div>
)

const EmptyState = () => (
  <div className="flex items-center justify-center h-[220px] text-sm text-[color:var(--text-muted)]">
    No data available
  </div>
)

export const ReportsPage = ({ sessionToken, powerBiReportUrl }: ReportsPageProps) => {
  const [statusData, setStatusData] = useState<TicketReport[]>([])
  const [priorityData, setPriorityData] = useState<PriorityReport[]>([])
  const [assigneeData, setAssigneeData] = useState<AssigneeReport[]>([])
  const [trendData, setTrendData] = useState<TrendReport[]>([])
  const [trendDays, setTrendDays] = useState(30)
  const [resolutionTimeBuckets, setResolutionTimeBuckets] = useState<ResolutionTimeBucket[]>([])
  const [avgByPriority, setAvgByPriority] = useState<AvgResolutionByPriority[]>([])
  const [avgByTeam, setAvgByTeam] = useState<AvgResolutionByTeam[]>([])
  const [openAgeBuckets, setOpenAgeBuckets] = useState<OpenAgeBucket[]>([])
  const [firstResponseBuckets, setFirstResponseBuckets] = useState<FirstResponseBucket[]>([])
  const [activeTab, setActiveTab] = useState<ReportsTab>('general')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchReports()
  }, [trendDays])

  const fetchReports = async () => {
    setLoading(true)
    try {
      const opts: RequestInit = sessionToken
        ? { headers: { Authorization: `Bearer ${sessionToken}` } }
        : {}

      const [
        statusRes, priorityRes, assigneeRes, trendRes,
        resTimeRes, avgPriRes, avgTeamRes, openAgeRes, firstRespRes,
      ] = await Promise.all([
        fetch(apiUrl('/api/reports/status'), opts),
        fetch(apiUrl('/api/reports/priority'), opts),
        fetch(apiUrl('/api/reports/assignee'), opts),
        fetch(apiUrl(`/api/reports/trends?days=${trendDays}`), opts),
        fetch(apiUrl('/api/reports/resolution-time'), opts),
        fetch(apiUrl('/api/reports/avg-resolution-by-priority'), opts),
        fetch(apiUrl('/api/reports/avg-resolution-by-team'), opts),
        fetch(apiUrl('/api/reports/open-ticket-age'), opts),
        fetch(apiUrl('/api/reports/first-response-time'), opts),
      ])

      if (statusRes.ok) setStatusData(await statusRes.json())
      if (priorityRes.ok) setPriorityData(await priorityRes.json())
      if (assigneeRes.ok) {
        const data = await assigneeRes.json()
        setAssigneeData(data.map((item: AssigneeReport) => ({
          ...item,
          assigneeName: item.assigneeName || 'Unassigned',
        })))
      }
      if (trendRes.ok) setTrendData(await trendRes.json())
      if (resTimeRes.ok) setResolutionTimeBuckets(await resTimeRes.json())
      if (avgPriRes.ok) setAvgByPriority(await avgPriRes.json())
      if (avgTeamRes.ok) setAvgByTeam(await avgTeamRes.json())
      if (openAgeRes.ok) setOpenAgeBuckets(await openAgeRes.json())
      if (firstRespRes.ok) setFirstResponseBuckets(await firstRespRes.json())
    } catch (error) {
      console.error('Failed to fetch reports:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async (format: 'csv' | 'excel') => {
    const opts: RequestInit = sessionToken
      ? { headers: { Authorization: `Bearer ${sessionToken}` } }
      : {}
    const response = await fetch(apiUrl(`/api/reports/export/${format}`), opts)

    if (response.ok) {
      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `tickets.${format === 'csv' ? 'csv' : 'xlsx'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(downloadUrl)
    }
  }

  const hasResolutionData = resolutionTimeBuckets.some((b) => b.count > 0)
  const hasOpenAgeData = openAgeBuckets.some((b) => b.count > 0)
  const hasFirstResponseData = firstResponseBuckets.some((b) => b.count > 0)

  const tooltipStyle = {
    borderRadius: 2,
    border: '1px solid var(--border)',
    background: 'var(--panel-bg)',
    color: 'var(--text)',
    fontSize: 12,
  }

  if (loading) {
    return <div className="p-6 text-sm text-[color:var(--text-muted)]">Loading reports…</div>
  }

  const renderGeneralTab = () => (
    <>
      {/* ── Volume ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Volume</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ChartCard title="Tickets by Status">
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={statusData} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={90} label>
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : <EmptyState />}
          </ChartCard>

          <ChartCard title="Tickets by Priority">
            {priorityData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={priorityData} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="priority" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Tickets" radius={[2, 2, 0, 0]}>
                    {priorityData.map((entry) => (
                      <Cell key={entry.priority} fill={PRIORITY_COLORS[entry.priority] ?? '#8884d8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState />}
          </ChartCard>

          <ChartCard title="Tickets by Assignee">
            {assigneeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={assigneeData} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis dataKey="assigneeName" type="category" width={110} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Tickets" fill="#6366f1" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState />}
          </ChartCard>

          <ChartCard
            title="Ticket Trends"
            subtitle={`Created vs resolved — last ${trendDays} days`}
          >
            <div className="mb-3 flex justify-end">
              <select
                value={trendDays}
                onChange={(e) => setTrendDays(Number(e.target.value))}
                className="rounded-[2px] border border-[color:var(--border)] bg-[color:var(--panel-bg)] px-2 py-1 text-xs text-[color:var(--text)]"
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend />
                  <Line type="monotone" dataKey="created" stroke="#6366f1" strokeWidth={2} dot={false} name="Created" />
                  <Line type="monotone" dataKey="resolved" stroke="#22c55e" strokeWidth={2} dot={false} name="Resolved" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState />
            )}
          </ChartCard>
        </div>
      </section>

      {/* ── Lifecycle / Time metrics ─────────────────────────────── */}
      <section className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">Lifecycle &amp; Time</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ChartCard
            title="Time to Resolution"
            subtitle="How long resolved/closed tickets were open"
          >
            {hasResolutionData ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={resolutionTimeBuckets} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Tickets" fill="#6366f1" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState />}
          </ChartCard>

          <ChartCard
            title="Open Ticket Age"
            subtitle="How long current open / in-progress / pending tickets have been waiting"
          >
            {hasOpenAgeData ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={openAgeBuckets} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Tickets" fill="#f97316" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState />}
          </ChartCard>

          <ChartCard
            title="Avg. Resolution Time by Priority"
            subtitle="Mean days from creation to first resolution, per priority"
          >
            {avgByPriority.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={avgByPriority.map((r) => ({ ...r, avgDays: parseFloat(r.avgDays.toFixed(1)) }))} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="priority" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} unit=" d" />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)} days`, 'Avg. time']} />
                  <Bar dataKey="avgDays" name="Avg. days" radius={[2, 2, 0, 0]}>
                    {avgByPriority.map((entry) => (
                      <Cell key={entry.priority} fill={PRIORITY_COLORS[entry.priority] ?? '#8884d8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState />}
          </ChartCard>

          <ChartCard
            title="Avg. Resolution Time by Team"
            subtitle="Mean days from creation to first resolution, per team"
          >
            {avgByTeam.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={avgByTeam.map((r) => ({ ...r, avgDays: parseFloat(r.avgDays.toFixed(1)) }))} layout="vertical" margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} unit=" d" />
                  <YAxis dataKey="teamName" type="category" width={110} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${Number(v).toFixed(1)} days`, 'Avg. time']} />
                  <Bar dataKey="avgDays" name="Avg. days" fill="#22c55e" radius={[0, 2, 2, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState />}
          </ChartCard>
        </div>
      </section>

      {/* ── First Response ───────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">First Response</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ChartCard
            title="First Response Time"
            subtitle="Time from ticket creation to first agent activity"
          >
            {hasFirstResponseData ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={firstResponseBuckets} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="bucket" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} allowDecimals={false} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Tickets" fill="#0ea5e9" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState />}
          </ChartCard>
        </div>
      </section>
    </>
  )

  const renderPowerBiTab = () => {
    if (!powerBiReportUrl) {
      return (
        <div className="surface flex min-h-[320px] items-center justify-center rounded-[2px] border border-[color:var(--border)] p-6 text-sm text-[color:var(--text-muted)]">
          There is no Power Bi report currently linked
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <div className="text-sm text-[color:var(--text-muted)]">
          If the report does not appear, confirm the linked URL is a Publish to web link.
        </div>
        <div className="surface overflow-hidden rounded-[2px] border border-[color:var(--border)]">
          <iframe
            title="Power BI report"
            src={powerBiReportUrl}
            className="h-[720px] w-full"
            loading="lazy"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-xl font-semibold text-[color:var(--text)]">Reports</div>
          <div className="text-sm text-[color:var(--text-muted)]">Ticket analytics for your organisation.</div>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center overflow-hidden rounded-[2px] border border-[color:var(--border)]">
            <button
              type="button"
              className="view-toggle"
              data-active={activeTab === 'general'}
              onClick={() => setActiveTab('general')}
            >
              General
            </button>
            <button
              type="button"
              className="view-toggle"
              data-active={activeTab === 'power-bi'}
              onClick={() => setActiveTab('power-bi')}
            >
              Power BI
            </button>
          </div>
          <button
            onClick={() => handleExport('csv')}
            className="secondary-button flex items-center gap-2"
            disabled={activeTab !== 'general'}
          >
            <FileText size={14} />
            Export CSV
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="secondary-button flex items-center gap-2"
            disabled={activeTab !== 'general'}
          >
            <FileSpreadsheet size={14} />
            Export Excel
          </button>
        </div>
      </div>

      {activeTab === 'general' ? renderGeneralTab() : renderPowerBiTab()}
    </div>
  )
}