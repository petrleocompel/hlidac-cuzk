/** Sentinel domain meaning "any email domain" (sign-in always uses providerId). */
export const SSO_ANY_DOMAIN = '*'

export type SsoDomainMode = 'any' | 'specific'

export function domainModeFromStored(domain: string): SsoDomainMode {
  const trimmed = domain.trim()
  return !trimmed || trimmed === SSO_ANY_DOMAIN ? 'any' : 'specific'
}

export function domainToStore(mode: SsoDomainMode, domains: string): string {
  if (mode === 'any') return SSO_ANY_DOMAIN
  return domains
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join(',')
}

export function ssoCallbackUrl(baseURL: string, providerId: string): string {
  const base = baseURL.replace(/\/$/, '')
  return `${base}/api/auth/sso/callback/${encodeURIComponent(providerId)}`
}

export function ssoLinkCallbackUrl(baseURL: string): string {
  const base = baseURL.replace(/\/$/, '')
  return `${base}/api/sso-link/callback`
}

export function issuerOrigin(issuer: string): string | null {
  try {
    return new URL(issuer).origin
  } catch {
    return null
  }
}

export function trustOriginPredicate(...origins: Array<string | null | undefined>) {
  const allowed = new Set(
    origins.filter((o): o is string => Boolean(o)).map((o) => {
      try {
        return new URL(o).origin
      } catch {
        return o
      }
    }),
  )
  return (url: string) => {
    try {
      return allowed.has(new URL(url).origin)
    } catch {
      return false
    }
  }
}
