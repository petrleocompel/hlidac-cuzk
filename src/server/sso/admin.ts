import { withAuditActor } from '#/lib/audit/context'
import { and, eq, ne } from 'drizzle-orm'
import { discoverOIDCConfig } from '@better-auth/sso'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAdmin } from '#/auth/session'
import { db } from '#/db'
import { ensureDbReady } from '#/db/migrate'
import { account, ssoProvider } from '#/db/schema'
import {
  SSO_ANY_DOMAIN,
  domainModeFromStored,
  domainToStore,
  issuerOrigin,
  ssoCallbackUrl,
  trustOriginPredicate,
} from '#/lib/sso'
import type { SsoDomainMode } from '#/lib/sso'

export type AdminSsoProvider = {
  id: string
  providerId: string
  name: string | null
  issuer: string
  domain: string
  domainMode: SsoDomainMode
  clientId: string
  callbackUrl: string
}

type OidcConfigJson = {
  issuer?: string
  clientId?: string
  clientSecret?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  tokenEndpointAuthentication?: string
  jwksEndpoint?: string
  pkce?: boolean
  discoveryEndpoint?: string
  userInfoEndpoint?: string
  scopes?: string[]
  overrideUserInfo?: boolean
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

async function hydrateOidc(input: {
  issuer: string
  clientId: string
  clientSecret: string
}) {
  const appOrigin = issuerOrigin(baseURL())
  const hydrated = await discoverOIDCConfig({
    issuer: input.issuer,
    isTrustedOrigin: trustOriginPredicate(input.issuer, appOrigin),
  })
  return JSON.stringify({
    issuer: hydrated.issuer,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
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
}

function toAdminRow(row: typeof ssoProvider.$inferSelect): AdminSsoProvider {
  const oidc = parseOidc(row.oidcConfig)
  return {
    id: row.id,
    providerId: row.providerId,
    name: row.name,
    issuer: row.issuer,
    domain: row.domain === SSO_ANY_DOMAIN ? '' : row.domain,
    domainMode: domainModeFromStored(row.domain),
    clientId: oidc.clientId ?? '',
    callbackUrl: ssoCallbackUrl(baseURL(), row.providerId),
  }
}

export const listSsoProvidersAdmin = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminSsoProvider[]> => {
    await ensureDbReady()
    await requireAdmin()
    const rows = await db.select().from(ssoProvider)
    return rows.map(toAdminRow)
  },
)

const UpsertInput = z.object({
  providerId: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'providerId: letters, digits, _-'),
  name: z.string().trim().max(120).optional(),
  issuer: z.string().trim().url(),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1).optional(),
  domainMode: z.enum(['any', 'specific']).default('any'),
  domain: z.string().trim().max(500).optional(),
})

export const createSsoProviderAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d) => UpsertInput.parse(d))
  .handler(async ({ data }): Promise<AdminSsoProvider> => {
    await ensureDbReady()
    const session = await requireAdmin()

    if (data.domainMode === 'specific' && !data.domain?.trim()) {
      throw new Error('Zadejte alespoň jednu e-mailovou doménu')
    }
    if (!data.clientSecret?.trim()) {
      throw new Error('clientSecret je povinný')
    }

    const clash = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(eq(ssoProvider.providerId, data.providerId))
      .limit(1)
    if (clash.length > 0) throw new Error('providerId už existuje')

    const oidcConfig = await hydrateOidc({
      issuer: data.issuer,
      clientId: data.clientId,
      clientSecret: data.clientSecret,
    })
    const domain = domainToStore(data.domainMode, data.domain ?? '')
    const id = crypto.randomUUID()

    await withAuditActor(session.user.id, (tx) =>
      tx.insert(ssoProvider).values({
        id,
        issuer: data.issuer.replace(/\/$/, ''),
        domain,
        providerId: data.providerId,
        userId: session.user.id,
        oidcConfig,
        samlConfig: null,
        organizationId: null,
        name: data.name?.trim() || data.providerId,
      }),
    )

    const created = (
      await db.select().from(ssoProvider).where(eq(ssoProvider.id, id)).limit(1)
    ).at(0)
    if (!created) throw new Error('Provider se nepodařilo vytvořit')
    return toAdminRow(created)
  })

const UpdateInput = UpsertInput.extend({
  id: z.string().min(1),
})

export const updateSsoProviderAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ data }): Promise<AdminSsoProvider> => {
    await ensureDbReady()
    const session = await requireAdmin()

    if (data.domainMode === 'specific' && !data.domain?.trim()) {
      throw new Error('Zadejte alespoň jednu e-mailovou doménu')
    }

    const existing = (
      await db
        .select()
        .from(ssoProvider)
        .where(eq(ssoProvider.id, data.id))
        .limit(1)
    ).at(0)
    if (!existing) throw new Error('Provider nenalezen')

    const clash = await db
      .select({ id: ssoProvider.id })
      .from(ssoProvider)
      .where(
        and(
          eq(ssoProvider.providerId, data.providerId),
          ne(ssoProvider.id, data.id),
        ),
      )
      .limit(1)
    if (clash.length > 0) throw new Error('providerId už existuje')

    const prev = parseOidc(existing.oidcConfig)
    const secret = data.clientSecret?.trim() || prev.clientSecret
    if (!secret) throw new Error('clientSecret chybí')

    const oidcConfig = await hydrateOidc({
      issuer: data.issuer,
      clientId: data.clientId,
      clientSecret: secret,
    })

    await withAuditActor(session.user.id, (tx) =>
      tx
        .update(ssoProvider)
        .set({
          providerId: data.providerId,
          issuer: data.issuer.replace(/\/$/, ''),
          domain: domainToStore(data.domainMode, data.domain ?? ''),
          oidcConfig,
          name: data.name?.trim() || data.providerId,
        })
        .where(eq(ssoProvider.id, data.id)),
    )

    const updated = (
      await db
        .select()
        .from(ssoProvider)
        .where(eq(ssoProvider.id, data.id))
        .limit(1)
    ).at(0)
    if (!updated) throw new Error('Provider nenalezen')
    return toAdminRow(updated)
  })

export const deleteSsoProviderAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d) => z.object({ id: z.string().min(1) }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    await ensureDbReady()
    const session = await requireAdmin()

    const existing = (
      await db
        .select()
        .from(ssoProvider)
        .where(eq(ssoProvider.id, data.id))
        .limit(1)
    ).at(0)
    if (!existing) throw new Error('Provider nenalezen')

    await withAuditActor(session.user.id, async (tx) => {
      await tx
        .delete(account)
        .where(eq(account.providerId, existing.providerId))
      await tx.delete(ssoProvider).where(eq(ssoProvider.id, data.id))
    })
    return { ok: true }
  })
