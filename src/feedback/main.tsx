import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/work-sans/400.css'
import '@fontsource/work-sans/500.css'
import '@fontsource/work-sans/600.css'
import '../index.css'
import { FeedbackPage } from './FeedbackPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedbackPage />
  </StrictMode>,
)
