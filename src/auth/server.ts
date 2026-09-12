import { authorizeRegistration } from './registration'
import { authPolicy, MIN_PASSWORD_LENGTH } from './policy'
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

export function createAuth() {
  return betterAuth({
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
        rateLimit: schema.rateLimit,
      },
    }),
    emailAndPassword: {
      enabled: authPolicy().AUTH_MODE !== 'sso',
      disableSignUp: authPolicy().REGISTRATION_MODE === 'private',
      minPasswordLength: MIN_PASSWORD_LENGTH,
      requireEmailVerification: false,
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders:
          authPolicy().AUTH_TRUST_PROXY_HEADERS === 'true'
            ? ['x-forwarded-for']
            : [],
        trustedProxies: authPolicy()
          .AUTH_TRUSTED_PROXIES.split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/sign-in/sso': { window: 60, max: 20 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            await authorizeRegistration({
              email: user.email,
              emailVerified: user.emailVerified,
              path: context?.path ?? '',
              invitationToken: context?.headers?.get('x-hlidac-invitation'),
              admin: context?.context.session?.user.role === 'admin',
            })
          },
        },
      },
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
        trustEmailVerified: true,
        disableImplicitSignUp:
          authPolicy().SSO_REGISTRATION_MODE === 'existing',
        // Admin UI uses direct DB writes; keep BA register endpoint admin-only.
        providersLimit: (user) =>
          (user as { role?: string | null }).role === 'admin' ? 50 : 0,
      }),
    ],
  })
}

export const auth = createAuth()

export type Auth = typeof auth
