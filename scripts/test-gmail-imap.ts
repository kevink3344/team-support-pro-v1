import 'dotenv/config'
import { ImapFlow } from 'imapflow'

const user = process.env.GMAIL_USER
const password = process.env.GMAIL_APP_PASSWORD

if (!user || !password) {
  console.error('Missing required env vars: GMAIL_USER, GMAIL_APP_PASSWORD')
  process.exit(1)
}

console.log('Connecting to Gmail IMAP...')
console.log(`  User: ${user}`)

const client = new ImapFlow({
  host: 'imap.gmail.com',
  port: 993,
  secure: true,
  auth: { user, pass: password },
  logger: false,
})

try {
  await client.connect()
  console.log('Connected successfully.')

  const status = await client.status('INBOX', { messages: true, unseen: true })
  console.log(`  INBOX messages: ${status.messages}`)
  console.log(`  INBOX unread:   ${status.unseen}`)

  await client.logout()
  console.log('Disconnected cleanly.')
  console.log('\nGmail IMAP credentials are working correctly.')
} catch (err) {
  console.error('Gmail IMAP error:', err)
  process.exit(1)
}
