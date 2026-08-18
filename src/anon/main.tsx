import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/work-sans/400.css'
import '@fontsource/work-sans/500.css'
import '@fontsource/work-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import '../index.css'
import { AnonymousTicketPage } from './AnonymousTicketPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnonymousTicketPage />
  </StrictMode>,
)