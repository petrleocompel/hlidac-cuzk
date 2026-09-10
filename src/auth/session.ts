import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from './server'
import { ensureDbReady } from '#/db/migrate'

export const getServerSession = createServerFn({ method: 'GET' }).handler(
  async () => {
    await ensureDbReady()
    const request = getRequest()
    return auth.api.getSession({ headers: request.headers })
  },
)

export async function requireSession() {
  const session = await getServerSession()
  if (!session) throw new Error('unauthenticated')
  return session
}

export async function requireAdmin() {
  const session = await requireSession()
  if (session.user.role !== 'admin') throw new Error('forbidden')
  return session
}
