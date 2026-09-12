import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { requireAdmin } from '#/auth/session'
import { auth } from '#/auth/server'
import { authPolicy, MIN_PASSWORD_LENGTH } from '#/auth/policy'
import { issueInvitation } from '#/auth/registration'
import { db } from '#/db'
import { registrationInvitations } from '#/db/schema'

export const getAccessAdmin = createServerFn({ method: 'GET' }).handler(
  async () => {
    await requireAdmin()
    const rows = await db
      .select({
        id: registrationInvitations.id,
        email: registrationInvitations.email,
        expiresAt: registrationInvitations.expiresAt,
        usedAt: registrationInvitations.usedAt,
        revokedAt: registrationInvitations.revokedAt,
      })
      .from(registrationInvitations)
      .orderBy(desc(registrationInvitations.createdAt))
      .limit(100)
    const policy = authPolicy()
    return {
      registrationMode: policy.REGISTRATION_MODE,
      ssoRegistrationMode: policy.SSO_REGISTRATION_MODE,
      authMode: policy.AUTH_MODE,
      invitations: rows.map((row) => ({
        ...row,
        expiresAt: row.expiresAt.toISOString(),
        usedAt: row.usedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
      })),
    }
  },
)
export const createInvitationAdmin = createServerFn({ method: 'POST' })
  .inputValidator((value) => z.object({ email: z.email() }).parse(value))
  .handler(async ({ data }) => {
    const session = await requireAdmin()
    const result = await issueInvitation(data.email, session.user.id)
    return { ...result, expiresAt: result.expiresAt.toISOString() }
  })
export const revokeInvitationAdmin = createServerFn({ method: 'POST' })
  .inputValidator((value) => z.object({ id: z.uuid() }).parse(value))
  .handler(async ({ data }) => {
    await requireAdmin()
    await db
      .update(registrationInvitations)
      .set({ revokedAt: new Date() })
      .where(eq(registrationInvitations.id, data.id))
    return { ok: true }
  })
export const createAccountAdmin = createServerFn({ method: 'POST' })
  .inputValidator((value) =>
    z
      .object({
        email: z.email(),
        name: z.string().trim().min(1).max(200),
        password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
      })
      .parse(value),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    await auth.api.createUser({
      body: { ...data, role: 'user' },
      headers: getRequest().headers,
    })
    return { ok: true }
  })
