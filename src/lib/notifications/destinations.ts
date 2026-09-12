import type { NotificationPolicy } from './policy'
import { isIP } from 'node:net'
import { NotificationConfigurationError } from './secrets'

export type NotificationChannel = 'gotify' | 'slack' | 'discord'

function reject(): never {
  throw new NotificationConfigurationError(
    'Nepovolený cíl notifikace. Ověřte adresu a seznam povolených Gotify serverů.',
  )
}

function parse(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return reject()
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    reject()
  // Reject normalization tricks and encoded path separators before comparing paths.
  if (value.includes('\\') || /%|\/\.\.?($|\/)/.test(url.pathname)) reject()
  return url
}

export function normalizeGotifyUrl(value: string): string {
  const url = parse(value)
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString().replace(/\/$/, '')
}

export function validateNotificationDestination(
  value: string,
  channel: NotificationChannel,
  policy: NotificationPolicy,
): URL {
  if (!policy[`${channel}Enabled`])
    throw new NotificationConfigurationError(
      'Tento notifikační kanál správce vypnul.',
    )
  const url = parse(value)
  if (channel === 'gotify') {
    const normalized = normalizeGotifyUrl(value)
    const allowed = policy.gotifyAllowedUrls
    if (
      allowed.length &&
      !allowed.some((entry) => normalizeGotifyUrl(entry) === normalized)
    )
      reject()
    return new URL(normalized)
  }
  if (url.protocol !== 'https:' || url.port) reject()
  if (channel === 'slack') {
    if (
      !['hooks.slack.com', 'hooks.slack-gov.com'].includes(url.hostname) ||
      !/^\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9_-]+$/.test(
        url.pathname,
      )
    )
      reject()
  } else if (
    !['discord.com', 'discordapp.com'].includes(url.hostname) ||
    !/^\/api\/(?:v[0-9]+\/)?webhooks\/[0-9]+\/[A-Za-z0-9._-]+$/.test(
      url.pathname,
    )
  )
    reject()
  return url
}

/** Conservative public-unicast policy; mapped/private/reserved addresses are rejected. */
export function isPublicNotificationAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (family === 6) {
    // Only global unicast; exclude transition mechanisms and special-use allocations.
    const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1)
    const first = Number.parseInt(normalized.split(':')[0], 16)
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      !/^2001:(?:[01]?[0-9a-f]{0,2}|db8):/i.test(normalized) &&
      !/^2002:/i.test(normalized) &&
      !/^3fff:/i.test(normalized)
    )
  }
  return false
}

/** Legacy base URLs may contain credentials; never return those to a browser. */
export function displayGotifyUrl(
  value: string | null | undefined,
): string | null {
  if (!value) return null
  try {
    return normalizeGotifyUrl(value)
  } catch {
    return null
  }
}
