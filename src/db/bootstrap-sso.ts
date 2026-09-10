import { eq } from 'drizzle-orm'
import { discoverOIDCConfig } from '@better-auth/sso'
import { db } from '#/db'
import { ssoProvider, user } from '#/db/schema'
import {
  SSO_ANY_DOMAIN,
  domainToStore,
  issuerOrigin,
  trustOriginPredicate,
} from '#/lib/sso'

function truthy(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/**
 * Optional one-shot IdP seed from env. Never overwrites an existing providerId.
 */
export async function bootstrapSsoFromEnv(): Promise<void> {
  if (!truthy(process.env.SSO_BOOTSTRAP_ENABLED)) return

  const providerId = process.env.SSO_BOOTSTRAP_PROVIDER_ID?.trim()
  const issuer = process.env.SSO_BOOTSTRAP_ISSUER?.trim()
  const clientId = process.env.SSO_BOOTSTRAP_CLIENT_ID?.trim()
  const clientSecret = process.env.SSO_BOOTSTRAP_CLIENT_SECRET?.trim()
  const label = process.env.SSO_BOOTSTRAP_LABEL?.trim() || providerId
  const domainRaw = process.env.SSO_BOOTSTRAP_DOMAIN?.trim() ?? ''

  if (!providerId || !issuer || !clientId || !clientSecret) {
    console.warn(
      '[sso-bootstrap] SSO_BOOTSTRAP_ENABLED but missing providerId/issuer/clientId/clientSecret — skipped',
    )
    return
  }

  const existing = await db
    .select({ id: ssoProvider.id })
    .from(ssoProvider)
    .where(eq(ssoProvider.providerId, providerId))
    .limit(1)

  if (existing.length > 0) {
    console.log(
      `[sso-bootstrap] provider "${providerId}" already exists — leaving unchanged`,
    )
    return
  }

  const adminUser = (
    await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.role, 'admin'))
      .limit(1)
  ).at(0)

  if (!adminUser) {
    console.warn(
      '[sso-bootstrap] no admin user yet — skipped (run seed-admin first, then restart)',
    )
    return
  }

  const appOrigin = issuerOrigin(
    process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000',
  )
  const hydrated = await discoverOIDCConfig({
    issuer,
    isTrustedOrigin: trustOriginPredicate(issuer, appOrigin),
  })

  const domain = domainRaw
    ? domainToStore('specific', domainRaw)
    : SSO_ANY_DOMAIN

  const oidcConfig = JSON.stringify({
    issuer: hydrated.issuer,
    clientId,
    clientSecret,
    authorizationEndpoint: hydrated.authorizationEndpoint,
    tokenEndpoint: hydrated.tokenEndpoint,
    tokenEndpointAuthentication:
      hydrated.tokenEndpointAuthentication || 'client_secret_basic',
    jwksEndpoint: hydrated.jwksEndpoint,
    pkce: true,
    discoveryEndpoint: hydrated.discoveryEndpoint,
    userInfoEndpoint: hydrated.userInfoEndpoint,
    scopes: ['openid', 'email', 'profile', 'offline_access'],
    overrideUserInfo: false,
  })

  await db.insert(ssoProvider).values({
    id: crypto.randomUUID(),
    issuer: hydrated.issuer,
    domain,
    providerId,
    userId: adminUser.id,
    oidcConfig,
    samlConfig: null,
    organizationId: null,
    name: label || null,
  })

  console.log(`[sso-bootstrap] registered provider "${providerId}" (${label})`)
}
