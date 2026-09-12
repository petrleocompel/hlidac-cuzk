import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { db } from '#/db'
import { registrationInvitations } from '#/db/schema'
import { authPolicy } from './policy'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
export async function issueInvitation(email: string, adminId: string) {
  const token = randomBytes(32).toString('base64url')
  const [invitation] = await db
    .insert(registrationInvitations)
    .values({
      email: email.trim().toLowerCase(),
      tokenHash: hash(token),
      createdBy: adminId,
      expiresAt: sql`clock_timestamp() + interval '7 days'`,
    })
    .returning({
      id: registrationInvitations.id,
      expiresAt: registrationInvitations.expiresAt,
    })
  return { ...invitation, token }
}

/** Gate every user creation, including explicit requestSignUp from SSO callbacks. */
export async function authorizeRegistration(input: {
  email: string
  emailVerified: boolean
  path: string
  invitationToken?: string | null
  admin?: boolean
}) {
  if (input.admin && input.path === '/admin/create-user') return
  const policy = authPolicy()
  const local = input.path === '/sign-up/email'
  const sso =
    input.path.startsWith('/sso/callback') ||
    input.path.startsWith('/sso/saml2/callback/') ||
    input.path.startsWith('/sso/saml2/sp/acs/')
  const mode = local
    ? policy.REGISTRATION_MODE
    : sso
      ? policy.SSO_REGISTRATION_MODE
      : 'private'
  if (mode === 'open') return
  const reject = () =>
    new APIError('FORBIDDEN', {
      code: 'REGISTRATION_NOT_ALLOWED',
      message: 'Registrace není povolena nebo pozvánka není platná.',
    })
  if (mode !== 'invite') throw reject()
  if (sso && !input.emailVerified) throw reject()
  if (local && !input.invitationToken) throw reject()
  const rows = await db
    .update(registrationInvitations)
    .set({ usedAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(registrationInvitations.email, input.email.trim().toLowerCase()),
        local
          ? eq(registrationInvitations.tokenHash, hash(input.invitationToken!))
          : undefined,
        isNull(registrationInvitations.usedAt),
        isNull(registrationInvitations.revokedAt),
        sql`${registrationInvitations.expiresAt} > clock_timestamp()`,
      ),
    )
    .returning({ id: registrationInvitations.id })
  if (!rows.length) throw reject()
}
