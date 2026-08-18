import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/work-sans/400.css'
import '@fontsource/work-sans/500.css'
import '@fontsource/work-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import './index.css'

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Frontend render error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          fontFamily: 'Work Sans, sans-serif',
          background: '#0d1d2a',
          color: '#f3f8fb',
        }}>
          <div style={{ maxWidth: '720px', textAlign: 'center' }}>
            <h1 style={{ marginBottom: '12px', fontSize: '28px' }}>TeamSupportPro failed to load</h1>
            <p style={{ opacity: 0.9, lineHeight: 1.5 }}>
              A frontend runtime error occurred. Refresh the page. If it continues, clear site data for this domain and retry.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Missing root element for TeamSupportPro bootstrap.')
}

const root = createRoot(rootElement)
let hasRenderedFatalError = false

const renderBootError = (error: unknown) => {
  if (hasRenderedFatalError) {
    return
  }

  hasRenderedFatalError = true
  const errorMessage = error instanceof Error ? error.message : String(error)

  root.render(
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: '24px',
      fontFamily: 'Work Sans, sans-serif',
      background: '#0d1d2a',
      color: '#f3f8fb',
    }}>
      <div style={{ maxWidth: '760px', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '12px', fontSize: '28px' }}>TeamSupportPro failed to start</h1>
        <p style={{ opacity: 0.9, lineHeight: 1.5 }}>
          A module or bundle failed to load. This usually means stale or missing deploy assets.
        </p>
        <pre style={{
          marginTop: '16px',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(0,0,0,0.25)',
          padding: '12px',
          textAlign: 'left',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '12px',
          color: '#ffb8b8',
        }}>
          {errorMessage}
        </pre>
      </div>
    </div>,
  )
}

window.addEventListener('error', (event) => {
  console.error('Unhandled window error:', event.error ?? event.message)
  renderBootError(event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
  renderBootError(event.reason)
})

const bootstrap = async () => {
  try {
    const { default: App } = await import('./App.tsx')
    root.render(
      <StrictMode>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </StrictMode>,
    )
  } catch (error) {
    console.error('Frontend boot error:', error)
    renderBootError(error)
  }
}

void bootstrap()
