import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { sso } from '@better-auth/sso'
import { db } from '#/db'
import * as schema from '#/db/schema'
import { issuerOrigin } from '#/lib/sso'

async function ssoTrustedOrigins(): Promise<string[]> {
  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000'
  const origins = new Set<string>([baseURL])
  try {
    origins.add(new URL(baseURL).origin)
  } catch {
    /* ignore */
  }

  const bootstrapIssuer = process.env.SSO_BOOTSTRAP_ISSUER?.trim()
  if (bootstrapIssuer) {
    const origin = issuerOrigin(bootstrapIssuer)
    if (origin) origins.add(origin)
  }

  try {
    const rows = await db
      .select({ issuer: schema.ssoProvider.issuer })
      .from(schema.ssoProvider)
    for (const row of rows) {
      const origin = issuerOrigin(row.issuer)
      if (origin) origins.add(origin)
    }
  } catch {
    /* table may not exist yet during first migrate */
  }

  return [...origins]
}

export const auth = betterAuth({
  appName: 'Hlídač ČÚZK',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000',
  secret: process.env.BETTER_AUTH_SECRET!,
  trustedOrigins: ssoTrustedOrigins,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      ssoProvider: schema.ssoProvider,
    },
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  account: {
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
      allowUnlinkingAll: false,
      requireLocalEmailVerified: false,
    },
  },
  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
    sso({
      // Admin UI uses direct DB writes; keep BA register endpoint admin-only.
      providersLimit: (user) =>
        (user as { role?: string | null }).role === 'admin' ? 50 : 0,
    }),
  ],
})

export type Auth = typeof auth
