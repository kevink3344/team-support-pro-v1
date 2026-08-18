import 'dotenv/config'
import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const from = process.env.EMAIL_FROM
const replyTo = process.env.EMAIL_REPLY_TO
const testTo = process.env.EMAIL_TEST_TO

if (!apiKey || !from || !replyTo || !testTo) {
  console.error('Missing required env vars: RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, EMAIL_TEST_TO')
  console.error('Set EMAIL_TEST_TO to the email address registered with your Resend account.')
  process.exit(1)
}

const resend = new Resend(apiKey)

console.log('Sending test email via Resend...')
console.log(`  From:     ${from}`)
console.log(`  Reply-To: ${replyTo}`)
console.log(`  To:       ${testTo}`)

const { data, error } = await resend.emails.send({
  from,
  replyTo,
  to: testTo,
  subject: '[TKT-TEST] TeamSupportPro — Resend connectivity test',
  text: [
    'This is an automated connectivity test from TeamSupportPro.',
    '',
    'If you received this email, Resend is configured correctly.',
    'You can reply to this email to verify the Gmail inbox is receiving replies.',
    '',
    'Ticket: TKT-TEST',
  ].join('\n'),
})

if (error) {
  console.error('Resend error:', error)
  process.exit(1)
}

console.log('Success! Email sent.')
console.log('  Message ID:', data?.id)
