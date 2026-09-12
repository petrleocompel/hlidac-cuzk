import { readNotificationPolicy } from './policy'
import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import {
  isPublicNotificationAddress,
  validateNotificationDestination,
} from './destinations'
import { NotificationConfigurationError } from './secrets'
import type { NotificationChannel } from './destinations'

export class NotificationHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Notifikační služba vrátila HTTP ${status}.`)
  }
}

/** Resolve once and pin the connection. No redirects, proxy env or pooled connections. */
export async function postNotification(
  destination: string | URL,
  init: { headers: Record<string, string>; body: string },
  channel: NotificationChannel,
): Promise<void> {
  const url = validateNotificationDestination(
    String(destination),
    channel,
    await readNotificationPolicy(),
  )
  if (channel === 'gotify')
    url.pathname = url.pathname.replace(/\/$/, '') + '/message'
  const signal = AbortSignal.timeout(15_000)
  try {
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await Promise.race([
          lookup(hostname, { all: true, verbatim: true }),
          new Promise<never>((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            }),
          ),
        ])
    signal.throwIfAborted()
    if (
      !addresses.length ||
      (channel !== 'gotify' &&
        addresses.some(({ address }) => !isPublicNotificationAddress(address)))
    ) {
      throw new NotificationConfigurationError(
        'DNS notifikační služby neukazuje na povolenou veřejnou adresu.',
      )
    }
    const target = addresses.find(({ family }) => family === 4) ?? addresses[0]
    await new Promise<void>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method: 'POST',
          headers: init.headers,
          signal,
          agent: false,
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, [target])
            else callback(null, target.address, target.family)
          },
        },
        (response) => {
          const status = response.statusCode ?? 0
          response.destroy()
          if (status < 200 || status >= 300)
            reject(new NotificationHttpError(status))
          else resolve()
        },
      )
      request.on('error', reject)
      request.end(init.body)
    })
  } catch (error) {
    // Never expose a URL, token, response body or raw network exception to callers/loggers.
    if (
      error instanceof NotificationHttpError ||
      error instanceof NotificationConfigurationError
    )
      throw error
    throw new NotificationConfigurationError(notificationErrorMessage(error))
  }
}

export function notificationErrorMessage(error: unknown): string {
  if (
    error instanceof NotificationHttpError ||
    error instanceof NotificationConfigurationError
  )
    return error.message
  if (
    error instanceof Error &&
    ['TimeoutError', 'AbortError'].includes(error.name)
  ) {
    return 'Notifikační služba neodpověděla do 15 sekund.'
  }
  return 'Doručení selhalo. Ověřte nastavení kanálu a dostupnost služby.'
}
