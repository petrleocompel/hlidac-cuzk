import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest'
import { assertEmailRecipient, sendEmail } from '../src/lib/notifications/email'

const sockets = new Set<Socket>()
const messages: string[] = []
const recipients: string[] = []
let rejectRecipient = false
const server = createServer((socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
  socket.on('error', () => {})
  socket.write('220 local SMTP fixture\r\n')
  let buffer = ''
  let inData = false
  let message = ''
  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    let boundary: number
    while ((boundary = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      if (inData) {
        if (line === '.') {
          messages.push(message)
          message = ''
          inData = false
          socket.write('250 accepted\r\n')
        } else message += line + '\n'
      } else if (/^EHLO/.test(line))
        socket.write('250-localhost\r\n250 8BITMIME\r\n')
      else if (/^MAIL FROM:/.test(line)) socket.write('250 sender accepted\r\n')
      else if (/^RCPT TO:/.test(line)) {
        recipients.push(line)
        socket.write(
          rejectRecipient
            ? '550 rejected fixture-secret\r\n'
            : '250 recipient accepted\r\n',
        )
      } else if (line === 'DATA') {
        inData = true
        socket.write('354 end with dot\r\n')
      } else if (line === 'QUIT') socket.end('221 bye\r\n')
      else socket.write('250 OK\r\n')
    }
  })
})
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
})
beforeEach(() => {
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('missing SMTP fixture')
  vi.stubEnv('SMTP_URL', `smtp://127.0.0.1:${address.port}`)
  vi.stubEnv('SMTP_FROM', 'sender@example.test')
  messages.length = 0
  recipients.length = 0
  rejectRecipient = false
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})
it('delivers a Czech plain-text message to exactly one configured recipient', async () => {
  await sendEmail('owner@example.test', {
    title: 'Hlídač ČÚZK',
    message: 'Nová změna parcely',
  })
  expect(recipients).toEqual(['RCPT TO:<owner@example.test>'])
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain('To: owner@example.test')
  expect(messages[0]).toContain('Subject: =?UTF-8?')
  expect(messages[0]).toContain('Content-Type: text/plain; charset=utf-8')
})
it('redacts SMTP failures and succeeds after the server recovers', async () => {
  rejectRecipient = true
  await expect(
    sendEmail('owner@example.test', { title: 'Fixture', message: 'Fixture' }),
  ).rejects.toThrow(
    'E-mail se nepodařilo odeslat. Zkontrolujte SMTP konfiguraci instance.',
  )
  expect(messages).toHaveLength(0)
  rejectRecipient = false
  await sendEmail('owner@example.test', {
    title: 'Fixture',
    message: 'Fixture',
  })
  expect(messages).toHaveLength(1)
})
it('rejects recipient lists and header injection before sending', async () => {
  for (const value of [
    'a@example.test,b@example.test',
    'a@example.test\r\nBcc:b@example.test',
    'Name <a@example.test>',
  ])
    expect(() => assertEmailRecipient(value)).toThrow()
  await expect(
    sendEmail('invalid', { title: 'Fixture', message: 'Fixture' }),
  ).rejects.toThrow('jednu platnou')
  expect(messages).toHaveLength(0)
})
it('requires both instance SMTP settings', async () => {
  vi.stubEnv('SMTP_URL', '')
  await expect(
    sendEmail('owner@example.test', { title: 'Fixture', message: 'Fixture' }),
  ).rejects.toThrow('nenastavil SMTP')
})
