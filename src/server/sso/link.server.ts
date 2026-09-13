import { and, eq } from 'drizzle-orm'
import {
  createAuthorizationURL,
  validateAuthorizationCode,
} from 'better-auth'
import { generateRandomString } from 'better-auth/crypto'
import { auth } from '#/auth/server'
import { requireSession } from '#/auth/session'
import { db } from '#/db'
import { ensureDbReady } from '#/db/migrate'
import { account, ssoProvider, verification } from '#/db/schema'
import { ssoLinkCallbackUrl } from '#/lib/sso'

const LINK_STATE_PREFIX = 'sso-link:'

type OidcConfigJson = {
  issuer?: string
  clientId?: string
  clientSecret?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  tokenEndpointAuthentication?: 'client_secret_post' | 'client_secret_basic'
  jwksEndpoint?: string
  pkce?: boolean
  userInfoEndpoint?: string
  scopes?: string[]
}

function parseOidc(raw: string | null): OidcConfigJson {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as OidcConfigJson
  } catch {
    return {}
  }
}

function baseURL() {
  return process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000'
}

type LinkState = {
  userId: string
  email: string
  providerId: string
  codeVerifier: string
  callbackURL: string
  expiresAt: number
}

export async function startSsoLinkForUser(data: {
  providerId: string
  callbackURL: string
}): Promise<{ url: string }> {
  await ensureDbReady()
  const session = await requireSession()

  const provider = (
    await db
      .select()
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, data.providerId))
      .limit(1)
  ).at(0)
  if (!provider?.oidcConfig) {
    throw new Error('SSO provider nenalezen')
  }

  const config = parseOidc(provider.oidcConfig)
  if (!config.authorizationEndpoint || !config.clientId || !config.clientSecret) {
    throw new Error('Neúplná OIDC konfigurace')
  }

  const state = generateRandomString(32)
  const codeVerifier = generateRandomString(128)
  const redirectURI = ssoLinkCallbackUrl(baseURL())

  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier: `${LINK_STATE_PREFIX}${state}`,
    value: JSON.stringify({
      userId: session.user.id,
      email: session.user.email,
      providerId: provider.providerId,
      codeVerifier,
      callbackURL: data.callbackURL,
      expiresAt: Date.now() + 10 * 60 * 1000,
    }),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  })

  const url = await createAuthorizationURL({
    id: provider.issuer,
    options: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
    authorizationEndpoint: config.authorizationEndpoint,
    state,
    codeVerifier: config.pkce === false ? undefined : codeVerifier,
    redirectURI,
    scopes: config.scopes ?? ['openid', 'email', 'profile', 'offline_access'],
  })

  return { url: url.toString() }
}

export async function completeSsoLink(request: Request): Promise<Response> {
  await ensureDbReady()
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const accountUrl = `${baseURL()}/dashboard/account`

  const fail = (reason: string) =>
    Response.redirect(
      `${accountUrl}?ssoLinkError=${encodeURIComponent(reason)}`,
      302,
    )

  if (error || !code || !state) return fail(error || 'missing_code')

  const row = (
    await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, `${LINK_STATE_PREFIX}${state}`))
      .limit(1)
  ).at(0)
  if (!row) return fail('invalid_state')
  await db.delete(verification).where(eq(verification.id, row.id))

  let linkState: LinkState
  try {
    linkState = JSON.parse(row.value) as LinkState
  } catch {
    return fail('invalid_state')
  }
  if (Date.now() > linkState.expiresAt) return fail('state_expired')

  const session = await auth.api.getSession({ headers: request.headers })
  if (!session || session.user.id !== linkState.userId) {
    return fail('session_mismatch')
  }

  const provider = (
    await db
      .select()
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, linkState.providerId))
      .limit(1)
  ).at(0)
  if (!provider?.oidcConfig) return fail('provider_missing')

  const config = parseOidc(provider.oidcConfig)
  if (!config.tokenEndpoint || !config.clientId || !config.clientSecret) {
    return fail('invalid_provider')
  }

  const tokens = await validateAuthorizationCode({
    code,
    codeVerifier: config.pkce === false ? undefined : linkState.codeVerifier,
    redirectURI: ssoLinkCallbackUrl(baseURL()),
    options: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
    tokenEndpoint: config.tokenEndpoint,
    authentication:
      config.tokenEndpointAuthentication === 'client_secret_post'
        ? 'post'
        : 'basic',
  }).catch(() => null)

  if (!tokens?.accessToken) return fail('token_exchange_failed')

  let email: string | undefined
  let accountId: string | undefined

  if (config.userInfoEndpoint) {
    const res = await fetch(config.userInfoEndpoint, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    })
    if (!res.ok) return fail('userinfo_failed')
    const profile = (await res.json()) as Record<string, unknown>
    email = typeof profile.email === 'string' ? profile.email : undefined
    accountId =
      typeof profile.sub === 'string'
        ? profile.sub
        : typeof profile.id === 'string'
          ? profile.id
          : undefined
  } else if (tokens.idToken) {
    const [, payload] = tokens.idToken.split('.')
    if (!payload) return fail('invalid_id_token')
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>
    email = typeof claims.email === 'string' ? claims.email : undefined
    accountId = typeof claims.sub === 'string' ? claims.sub : undefined
  }

  if (!email || !accountId) return fail('missing_user_info')
  if (email.toLowerCase() !== linkState.email.toLowerCase()) {
    return fail('email_mismatch')
  }

  const existing = (
    await db
      .select()
      .from(account)
      .where(
        and(
          eq(account.providerId, linkState.providerId),
          eq(account.accountId, accountId),
        ),
      )
      .limit(1)
  ).at(0)

  if (existing && existing.userId !== linkState.userId) {
    return fail('already_linked_other_user')
  }

  if (!existing) {
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId,
      providerId: linkState.providerId,
      userId: linkState.userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      idToken: tokens.idToken ?? null,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
      scope: tokens.scopes?.join(',') ?? null,
      password: null,
    })
  }

  const dest = linkState.callbackURL.startsWith('http')
    ? linkState.callbackURL
    : `${baseURL()}${linkState.callbackURL.startsWith('/') ? '' : '/'}${linkState.callbackURL}`
  return Response.redirect(
    `${dest}${dest.includes('?') ? '&' : '?'}ssoLink=ok`,
    302,
  )
}
