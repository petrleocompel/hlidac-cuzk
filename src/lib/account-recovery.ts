import { and, eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { z } from 'zod'
import { account, session, user } from '#/db/schema'
import { withAuditActor } from './audit/context'

/** Local operator only. Never exposed as an unauthenticated server function. */
export async function recoverLocalPassword(input: unknown) {
  const data = z
    .object({
      email: z.email().transform((email) => email.toLowerCase()),
      password: z.string().min(12).max(200),
    })
    .parse(input)
  const password = await hashPassword(data.password)
  return withAuditActor('local-cli', async (tx) => {
    const owners = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, data.email))
      .for('update')
    const owner = owners.at(0)
    if (!owner)
      throw new Error('Účet nebyl nalezen; žádný nový účet se nevytvořil.')
    const credentials = await tx
      .select({ id: account.id })
      .from(account)
      .where(
        and(eq(account.userId, owner.id), eq(account.providerId, 'credential')),
      )
    const credential = credentials.at(0)
    if (credential)
      await tx
        .update(account)
        .set({ password })
        .where(eq(account.id, credential.id))
    else
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: owner.id,
        userId: owner.id,
        providerId: 'credential',
        password,
      })
    await tx.delete(session).where(eq(session.userId, owner.id))
    return { ok: true }
  })
}
