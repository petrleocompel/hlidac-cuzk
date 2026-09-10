import { eq } from 'drizzle-orm'
import { auth } from '#/auth/server'
import { db } from './index'
import { user } from './schema'

export interface SeedAdminInput {
  email: string
  password: string
  name?: string
}

export type SeedAdminResult =
  | { status: 'created'; userId: string }
  | { status: 'promoted'; userId: string }
  | { status: 'already-admin'; userId: string }

export async function seedAdmin(
  input: SeedAdminInput,
): Promise<SeedAdminResult> {
  const email = input.email.trim().toLowerCase()
  const name = (input.name ?? email.split('@')[0]).trim()

  try {
    const result = await auth.api.signUpEmail({
      body: { email, password: input.password, name },
      asResponse: false,
    })
    const userId = result.user.id
    await db.update(user).set({ role: 'admin' }).where(eq(user.id, userId))
    return { status: 'created', userId }
  } catch (err: unknown) {
    if (!isUserAlreadyExists(err)) throw err
  }

  const existing = await db.query.user.findFirst({
    where: eq(user.email, email),
    columns: { id: true, role: true },
  })
  if (!existing) {
    throw new Error(
      `seedAdmin: signUp reported "user exists" but no row found for ${email}`,
    )
  }
  if (existing.role === 'admin') {
    return { status: 'already-admin', userId: existing.id }
  }
  await db
    .update(user)
    .set({ role: 'admin' })
    .where(eq(user.id, existing.id))
  return { status: 'promoted', userId: existing.id }
}

function isUserAlreadyExists(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as {
    status?: number | string
    body?: { code?: string; message?: string }
    message?: string
  }
  if (e.status === 'UNPROCESSABLE_ENTITY' || e.status === 422) return true
  const code = e.body?.code
  if (
    code === 'USER_ALREADY_EXISTS' ||
    code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
  ) {
    return true
  }
  const msg = e.body?.message ?? e.message ?? ''
  return msg.toLowerCase().includes('already exists')
}
