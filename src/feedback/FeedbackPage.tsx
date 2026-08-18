import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

import { apiUrl } from '../config'
import { defaultThemeConfig } from '../theme'

// ---------------------------------------------------------------------------
// Types (local to this module)
// ---------------------------------------------------------------------------

type FeedbackFieldType = 'short_text' | 'long_text' | 'rating' | 'single_choice' | 'multi_choice'

interface FeedbackFormField {
  id: string
  fieldType: FeedbackFieldType
  label: string
  isRequired: boolean
  sortOrder: number
  options: string[]
}

interface FeedbackForm {
  id: string
  organizationId: string
  isEnabled: boolean
  fields: FeedbackFormField[]
}

interface TicketContext {
  id: string
  title: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const getFeedbackToken = (): string => {
  const match = window.location.pathname.match(/\/feedback\/([0-9a-f]{64})/i)
  return match?.[1] ?? ''
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StarRating = ({
  value,
  onChange,
}: {
  value: number
  onChange: (v: number) => void
}) => (
  <div className="flex gap-1">
    {[1, 2, 3, 4, 5].map((star) => (
      <button
        key={star}
        type="button"
        onClick={() => onChange(star)}
        className="text-2xl leading-none transition-colors focus:outline-none"
        style={{ color: star <= value ? '#f59e0b' : '#cbd5e1' }}
        aria-label={`${star} star${star !== 1 ? 's' : ''}`}
      >
        ★
      </button>
    ))}
  </div>
)

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FeedbackPage() {
  const [form, setForm] = useState<FeedbackForm | null>(null)
  const [ticketContext, setTicketContext] = useState<TicketContext | null>(null)
  const [isTest, setIsTest] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tokenStatus, setTokenStatus] = useState<'valid' | 'invalid' | 'expired' | 'used' | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitPending, setSubmitPending] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const token = getFeedbackToken()

  useEffect(() => {
    const palette = defaultThemeConfig.light
    const root = document.documentElement
    root.style.setProperty('--accent', palette.accent)
    root.style.setProperty('--color-primary', palette.buttonBg)
    root.style.setProperty('--button-bg', palette.buttonBg)
    root.style.setProperty('--button-text', palette.buttonText)
  }, [])

  useEffect(() => {
    if (!token) {
      setTokenStatus('invalid')
      setLoading(false)
      return
    }

    const load = async () => {
      try {
        const res = await fetch(apiUrl(`/api/public/feedback/${token}`))
        if (res.status === 404 || res.status === 410) {
          const data = (await res.json()) as { error?: string }
          setTokenStatus((data.error as typeof tokenStatus) ?? 'invalid')
          setLoading(false)
          return
        }
        if (!res.ok) throw new Error('load_failed')
        const data = (await res.json()) as {
          form: FeedbackForm
          ticketContext: TicketContext | null
          isTest: boolean
        }
        setForm(data.form)
        setTicketContext(data.ticketContext)
        setIsTest(data.isTest)
        setTokenStatus('valid')
      } catch {
        setTokenStatus('invalid')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [token])

  const setAnswer = (fieldId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }))
  }

  const toggleMultiChoice = (fieldId: string, option: string) => {
    const current = answers[fieldId] ? answers[fieldId].split('\n') : []
    const next = current.includes(option)
      ? current.filter((v) => v !== option)
      : [...current, option]
    setAnswer(fieldId, next.join('\n'))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return

    // Client-side required validation
    for (const field of form.fields) {
      if (field.isRequired && !answers[field.id]?.trim()) {
        setSubmitError(`"${field.label}" is required.`)
        return
      }
    }

    setSubmitError('')
    setSubmitPending(true)

    try {
      const res = await fetch(apiUrl(`/api/public/feedback/${token}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: Object.entries(answers)
            .filter(([, value]) => value.trim())
            .map(([fieldId, value]) => ({ fieldId, value })),
        }),
      })

      if (res.status === 410) {
        const data = (await res.json()) as { error?: string }
        setTokenStatus((data.error as typeof tokenStatus) ?? 'used')
        return
      }

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setSubmitError(data.error === 'required_field_missing' ? 'Please answer all required questions.' : 'Submission failed. Please try again.')
        return
      }

      setSubmitted(true)
    } catch {
      setSubmitError('An error occurred. Please try again.')
    } finally {
      setSubmitPending(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderField = (field: FeedbackFormField) => {
    const value = answers[field.id] ?? ''

    switch (field.fieldType) {
      case 'short_text':
        return (
          <input
            type="text"
            className="form-input w-full"
            value={value}
            onChange={(e) => setAnswer(field.id, e.target.value)}
            required={field.isRequired}
          />
        )

      case 'long_text':
        return (
          <textarea
            className="form-input w-full resize-none"
            rows={4}
            value={value}
            onChange={(e) => setAnswer(field.id, e.target.value)}
            required={field.isRequired}
          />
        )

      case 'rating':
        return (
          <StarRating
            value={value ? parseInt(value, 10) : 0}
            onChange={(v) => setAnswer(field.id, String(v))}
          />
        )

      case 'single_choice':
        return (
          <div className="space-y-2">
            {field.options.map((option) => (
              <label key={option} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={field.id}
                  value={option}
                  checked={value === option}
                  onChange={() => setAnswer(field.id, option)}
                />
                <span className="text-sm text-[color:var(--text)]">{option}</span>
              </label>
            ))}
          </div>
        )

      case 'multi_choice': {
        const selected = value ? value.split('\n') : []
        return (
          <div className="space-y-2">
            {field.options.map((option) => (
              <label key={option} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggleMultiChoice(field.id, option)}
                />
                <span className="text-sm text-[color:var(--text)]">{option}</span>
              </label>
            ))}
          </div>
        )
      }

      default:
        return null
    }
  }

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[color:var(--bg)]">
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      </div>
    )
  }

  if (tokenStatus === 'expired') {
    return <StatusPage icon="⏰" title="Link Expired" message="This feedback link has expired. Links are valid for 7 days after your ticket is resolved." />
  }

  if (tokenStatus === 'used') {
    return <StatusPage icon="✓" title="Already Submitted" message="Your feedback has already been submitted. Thank you!" />
  }

  if (tokenStatus !== 'valid' || !form) {
    return <StatusPage icon="✗" title="Invalid Link" message="This feedback link is not valid. It may have been copied incorrectly." />
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[color:var(--bg)] px-4">
        <div className="surface w-full max-w-md p-8 text-center space-y-4">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="text-xl font-semibold text-[color:var(--text)]">Thank you for your feedback!</h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            Your response has been recorded and will help us improve our service.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[color:var(--bg)] px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold text-[color:var(--text)]">How did we do?</h1>
          {ticketContext && (
            <p className="text-sm text-[color:var(--text-muted)]">
              Re: <span className="font-medium">{ticketContext.title}</span>
            </p>
          )}
        </div>

        {/* Test mode banner */}
        {isTest && (
          <div className="rounded-[2px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 text-center">
            Test Submission — this response will not appear in reports.
          </div>
        )}

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="surface p-6 space-y-6">
          {form.fields.map((field) => (
            <div key={field.id} className="space-y-2">
              <label className="block text-sm font-medium text-[color:var(--text)]">
                {field.label}
                {field.isRequired && <span className="ml-1 text-rose-500">*</span>}
              </label>
              {renderField(field)}
            </div>
          ))}

          {submitError && (
            <div className="rounded-[2px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            className="primary-button w-full"
            disabled={submitPending}
          >
            {submitPending ? 'Submitting…' : 'Submit Feedback'}
          </button>
        </form>

        <p className="text-center text-xs text-[color:var(--text-muted)]">TeamSupportPro</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status page helper
// ---------------------------------------------------------------------------

function StatusPage({ icon, title, message }: { icon: string; title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[color:var(--bg)] px-4">
      <div className="surface w-full max-w-sm p-8 text-center space-y-3">
        <div className="text-4xl">{icon}</div>
        <h1 className="text-lg font-semibold text-[color:var(--text)]">{title}</h1>
        <p className="text-sm text-[color:var(--text-muted)]">{message}</p>
      </div>
    </div>
  )
}
