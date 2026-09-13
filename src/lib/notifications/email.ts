import { createTransport } from 'nodemailer'
import { createConnection, isIP } from 'node:net'
import type { Socket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import { NotificationConfigurationError } from './secrets'

export type EmailMessage = {
  title: string
  message: string
}

/** SMTP is instance configuration; users only choose the recipient address. */
export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL && process.env.SMTP_FROM)
}

export function assertEmailRecipient(value: string): string {
  const address = value.trim()
  if (!/^[^\s@<>,;"]+@[^\s@<>,;".]+\.[^\s@<>,;".]+$/.test(address))
    throw new NotificationConfigurationError(
      'Zadejte jednu platnou e-mailovou adresu.',
    )
  return address
}

export async function sendEmail(to: string, msg: EmailMessage): Promise<void> {
  if (!emailConfigured())
    throw new NotificationConfigurationError(
      'Správce instance nenastavil SMTP server (SMTP_URL a SMTP_FROM).',
    )
  let socket: Socket | undefined
  const transport = createTransport({
    url: process.env.SMTP_URL,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 15_000,
    // Keep the underlying socket so the absolute deadline also stops a peer
    // sending a slow stream of replies that never trips an inactivity timeout.
    getSocket(options, callback) {
      const host = options.host ?? 'localhost'
      const port = Number(options.port) || (options.secure ? 465 : 587)
      let done = false
      const connected = () => {
        if (done) return
        done = true
        callback(null, {
          connection: socket!,
          secured: Boolean(options.secure),
        })
      }
      socket = options.secure
        ? connectTls(
            { host, port, servername: isIP(host) ? undefined : host },
            connected,
          )
        : createConnection({ host, port }, connected)
      socket.once('error', (error) => {
        if (done) return
        done = true
        callback(error)
      })
    },
  })
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      transport.sendMail({
        from: process.env.SMTP_FROM,
        to: assertEmailRecipient(to),
        // Header injection is impossible with a single-line subject.
        subject: msg.title.replace(/[\r\n]+/g, ' ').slice(0, 200),
        text: msg.message,
      }),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          socket?.destroy()
          transport.close()
          reject(new Error('smtp_deadline'))
        }, 15_000)
      }),
    ])
  } catch (error) {
    // Never leak the SMTP server, credentials or raw transport error.
    throw new NotificationConfigurationError(
      error instanceof NotificationConfigurationError
        ? error.message
        : 'E-mail se nepodařilo odeslat. Zkontrolujte SMTP konfiguraci instance.',
    )
  } finally {
    clearTimeout(deadline)
    socket?.destroy()
    transport.close()
  }
}
