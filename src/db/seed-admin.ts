import { eq, sql } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { z } from 'zod'
import { MIN_PASSWORD_LENGTH } from '#/auth/policy'
import { db } from './index'
import { account, session, user } from './schema'

export interface SeedAdminInput {
  email: string
  password: string
  name?: string
  resetPassword?: boolean
}
export type SeedAdminResult = {
  status: 'created' | 'promoted' | 'already-admin' | 'password-reset'
  userId: string
}

/** Local CLI bootstrap: never exposes a registration-policy bypass over HTTP. */
export async function seedAdmin(
  input: SeedAdminInput,
): Promise<SeedAdminResult> {
  const email = z.email().parse(input.email.trim().toLowerCase())
  const password = z
    .string()
    .min(MIN_PASSWORD_LENGTH)
    .max(200)
    .parse(input.password)
  const passwordHash = await hashPassword(password)
  return db.transaction(async (tx) => {
    // Serialize bootstrap/recovery for the same email across local CLI processes.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`)
    const existing = (
      await tx.select().from(user).where(eq(user.email, email)).for('update')
    ).at(0)
    const userId = existing?.id ?? crypto.randomUUID()
    if (!existing)
      await tx.insert(user).values({
        id: userId,
        email,
        name: input.name?.trim() || email.split('@')[0],
        role: 'admin',
      })
    else await tx.update(user).set({ role: 'admin' }).where(eq(user.id, userId))
    if (!existing || input.resetPassword) {
      const credentials = await tx
        .select()
        .from(account)
        .where(eq(account.userId, userId))
      const credential = credentials.find(
        (row) => row.providerId === 'credential',
      )
      if (credential)
        await tx
          .update(account)
          .set({ password: passwordHash })
          .where(eq(account.id, credential.id))
      else
        await tx.insert(account).values({
          id: crypto.randomUUID(),
          userId,
          accountId: userId,
          providerId: 'credential',
          password: passwordHash,
        })
      if (existing) await tx.delete(session).where(eq(session.userId, userId))
    }
    return {
      userId,
      status: !existing
        ? 'created'
        : input.resetPassword
          ? 'password-reset'
          : existing.role === 'admin'
            ? 'already-admin'
            : 'promoted',
    }
  })
}
