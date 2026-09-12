import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, closeDb } from '../../src/db'
import {
  account,
  rateLimit,
  registrationInvitations,
  session,
  ssoProvider,
  user,
} from '../../src/db/schema'
import { createAuth } from '../../src/auth/server'
import { issueInvitation } from '../../src/auth/registration'
import { seedAdmin } from '../../src/db/seed-admin'

const base = 'http://127.0.0.1:3000'
const credentials = {
  email: 'member@example.test',
  name: 'Member',
  password: 'fixture-password-long-enough',
}
let auth: ReturnType<typeof createAuth>
let idpBase: string
let verified = true
const idp = createServer((incoming, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (incoming.url === '/token')
    response.end(
      JSON.stringify({
        access_token: 'fixture-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    )
  else
    response.end(
      JSON.stringify({
        sub: 'fixture-subject',
        email: credentials.email,
        email_verified: verified,
        name: 'SSO Member',
      }),
    )
})
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
}
function request(
  path: string,
  data?: unknown,
  headers: Record<string, string> = {},
) {
  return auth.handler(
    new Request(base + '/api/auth' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json', ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
  )
}
async function mode(
  registration: 'private' | 'invite' | 'open',
  sso = 'existing',
  authMode = 'hybrid',
) {
  process.env.REGISTRATION_MODE = registration
  process.env.SSO_REGISTRATION_MODE = sso
  process.env.AUTH_MODE = authMode
  auth = createAuth()
  await db.delete(rateLimit)
}
async function admin() {
  return seedAdmin({
    email: 'admin@example.test',
    password: credentials.password,
  })
}
async function ssoLogin(requestSignUp = true) {
  const started = await request('/sign-in/sso', {
    providerId: 'fixture',
    callbackURL: '/dashboard',
    errorCallbackURL: '/login',
    requestSignUp,
  })
  expect(started.status).toBe(200)
  const payload = (await started.json()) as { url: string }
  const state = new URL(payload.url).searchParams.get('state')!
  return request(
    `/sso/callback/fixture?code=fixture-code&state=${encodeURIComponent(state)}`,
    undefined,
    { Cookie: cookies(started) },
  )
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: './drizzle' })
  await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve))
  const address = idp.address()
  if (!address || typeof address === 'string') throw new Error('fixture port')
  idpBase = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => {
  await db.delete(ssoProvider)
  await db.delete(user)
  await db.delete(rateLimit)
  verified = true
  process.env.AUTH_TRUST_PROXY_HEADERS = 'false'
  process.env.AUTH_TRUSTED_PROXIES = ''
  await mode('private')
})
afterAll(async () => {
  await closeDb()
  idp.closeAllConnections()
  await new Promise<void>((resolve) => idp.close(() => resolve()))
})
async function provider() {
  const owner = await admin()
  await db.insert(ssoProvider).values({
    id: 'fixture-provider',
    providerId: 'fixture',
    issuer: idpBase,
    domain: '*',
    userId: owner.userId,
    oidcConfig: JSON.stringify({
      issuer: idpBase,
      clientId: 'fixture',
      clientSecret: 'fixture-only',
      authorizationEndpoint: `${idpBase}/authorize`,
      tokenEndpoint: `${idpBase}/token`,
      jwksEndpoint: `${idpBase}/jwks`,
      userInfoEndpoint: `${idpBase}/userinfo`,
      pkce: true,
      scopes: ['openid', 'email', 'profile'],
    }),
  })
  return owner
}

describe('registration policy on real Better Auth endpoints', () => {
  it('rejects direct signup in private mode and allows a locally seeded admin to sign in', async () => {
    expect((await request('/sign-up/email', credentials)).status).toBe(400)
    expect(await db.select().from(user)).toHaveLength(0)
    await admin()
    expect(
      (
        await request('/sign-in/email', {
          email: 'admin@example.test',
          password: credentials.password,
        })
      ).status,
    ).toBe(200)
  })
  it('preserves an existing user login after registrations are closed', async () => {
    await mode('open')
    expect((await request('/sign-up/email', credentials)).status).toBe(200)
    await mode('private')
    expect((await request('/sign-in/email', credentials)).status).toBe(200)
  })
  it('enforces twelve characters on the server and consumes a valid invitation once', async () => {
    const owner = await admin()
    const invitation = await issueInvitation(credentials.email, owner.userId)
    await mode('invite')
    const headers = { 'x-hlidac-invitation': invitation.token }
    expect(
      (
        await request(
          '/sign-up/email',
          { ...credentials, password: 'short' },
          headers,
        )
      ).status,
    ).toBe(400)
    const [unused] = await db.select().from(registrationInvitations)
    expect(unused.usedAt).toBeNull()
    expect(unused.tokenHash).not.toBe(invitation.token)
    const responses = await Promise.all([
      request('/sign-up/email', credentials, headers),
      request('/sign-up/email', credentials, headers),
    ])
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1)
    expect(
      await db.select().from(user).where(eq(user.email, credentials.email)),
    ).toHaveLength(1)
    const [used] = await db.select().from(registrationInvitations)
    expect(used.usedAt).not.toBeNull()
  })
  it('rejects missing, mismatched, expired and revoked invitations', async () => {
    const owner = await admin()
    const invitation = await issueInvitation(credentials.email, owner.userId)
    await mode('invite')
    expect((await request('/sign-up/email', credentials)).status).toBe(403)
    expect(
      (
        await request(
          '/sign-up/email',
          { ...credentials, email: 'other@example.test' },
          { 'x-hlidac-invitation': invitation.token },
        )
      ).status,
    ).toBe(403)
    await db.update(registrationInvitations).set({ expiresAt: new Date(0) })
    expect(
      (
        await request('/sign-up/email', credentials, {
          'x-hlidac-invitation': invitation.token,
        })
      ).status,
    ).toBe(403)
    await db.update(registrationInvitations).set({
      expiresAt: new Date(Date.now() + 3600_000),
      revokedAt: new Date(),
    })
    expect(
      (
        await request('/sign-up/email', credentials, {
          'x-hlidac-invitation': invitation.token,
        })
      ).status,
    ).toBe(403)
  })
  it('allows only an authenticated admin to create an account in private mode', async () => {
    await admin()
    expect((await request('/admin/create-user', credentials)).status).toBe(401)
    const signed = await request('/sign-in/email', {
      email: 'admin@example.test',
      password: credentials.password,
    })
    const response = await request(
      '/admin/create-user',
      { ...credentials, role: 'user' },
      { Cookie: cookies(signed) },
    )
    expect(response.status).toBe(200)
  })
  it('shares rate limits and ignores untrusted spoofed forwarding headers', async () => {
    for (let i = 0; i < 10; i++) {
      expect(
        (
          await request('/sign-in/email', credentials, {
            'x-forwarded-for': `192.0.2.${i + 1}`,
          })
        ).status,
      ).toBe(401)
    }
    auth = createAuth() // New auth instance shares persisted buckets.
    expect(
      (
        await request('/sign-in/email', credentials, {
          'x-forwarded-for': '198.51.100.2',
        })
      ).status,
    ).toBe(429)
  })
  it('keys trusted forwarded chains by the nearest untrusted client and shares concurrent limits', async () => {
    process.env.AUTH_TRUST_PROXY_HEADERS = 'true'
    process.env.AUTH_TRUSTED_PROXIES = '192.0.2.10'
    await mode('private')
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request('/sign-in/email', credentials, {
          'x-forwarded-for': `203.0.113.${i + 1}, 198.51.100.9, 192.0.2.10`,
        }),
      ),
    )
    expect(responses.every((response) => response.status === 401)).toBe(true)
    expect(
      (
        await request('/sign-in/email', credentials, {
          'x-forwarded-for': '203.0.113.99, 198.51.100.9, 192.0.2.10',
        })
      ).status,
    ).toBe(429)
    expect(
      (
        await request('/sign-in/email', credentials, {
          'x-forwarded-for': '198.51.100.8, 192.0.2.10',
        })
      ).status,
    ).toBe(401)
  })
  it('supports SSO-only and explicit local password recovery without a public bypass', async () => {
    const owner = await admin()
    const signed = await request('/sign-in/email', {
      email: 'admin@example.test',
      password: credentials.password,
    })
    expect(signed.status).toBe(200)
    await mode('private', 'existing', 'sso')
    expect(
      (
        await request('/sign-in/email', {
          email: 'admin@example.test',
          password: credentials.password,
        })
      ).status,
    ).not.toBe(200)
    const replacement = 'replacement-fixture-password'
    await seedAdmin({
      email: 'admin@example.test',
      password: replacement,
      resetPassword: true,
    })
    expect(
      await db.select().from(session).where(eq(session.userId, owner.userId)),
    ).toHaveLength(0)
    await mode('private')
    expect(
      (
        await request('/sign-in/email', {
          email: 'admin@example.test',
          password: replacement,
        })
      ).status,
    ).toBe(200)
    const [credential] = await db
      .select()
      .from(account)
      .where(eq(account.userId, owner.userId))
    expect(credential.password).not.toBe(replacement)
  })
  it('blocks explicit requestSignUp at a real OIDC callback when only existing SSO accounts are allowed', async () => {
    await provider()
    const response = await ssoLogin(true)
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toContain('error=')
    expect(
      await db.select().from(user).where(eq(user.email, credentials.email)),
    ).toHaveLength(0)
  })
  it('permits an invited verified SSO identity while local registrations remain private', async () => {
    const owner = await provider()
    await issueInvitation(credentials.email, owner.userId)
    await mode('private', 'invite')
    const response = await ssoLogin()
    expect(response.headers.get('Location')).not.toContain('error=')
    expect(
      await db.select().from(user).where(eq(user.email, credentials.email)),
    ).toHaveLength(1)
    await mode('private', 'existing')
    expect((await ssoLogin(false)).headers.get('Location')).not.toContain(
      'error=',
    )
  })
  it('refuses an unverified SSO email even with an invitation', async () => {
    const owner = await provider()
    await issueInvitation(credentials.email, owner.userId)
    await mode('private', 'invite')
    verified = false
    expect((await ssoLogin()).headers.get('Location')).toContain('error=')
    expect(
      await db.select().from(user).where(eq(user.email, credentials.email)),
    ).toHaveLength(0)
  })
})
