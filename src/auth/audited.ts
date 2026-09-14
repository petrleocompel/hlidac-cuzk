import { auth, createAuth } from './server'
import { withAuditActor } from '#/lib/audit/context'
import type { Auth } from './server'

/** Admin mutations and their trigger audit share the same transaction/connection. */
export async function withAuditedAuth<T>(
  headers: Headers,
  run: (scoped: Auth) => Promise<T>,
): Promise<T> {
  const session = await auth.api.getSession({ headers })
  const actor = session?.session.impersonatedBy ?? session?.user.id ?? null
  return withAuditActor(actor, (tx) => run(createAuth(tx)))
}
export async function handleAuthRequest(request: Request) {
  const path = new URL(request.url).pathname
  if (request.method === 'POST' && path.startsWith('/api/auth/admin/')) {
    return withAuditedAuth(request.headers, (scoped) => scoped.handler(request))
  }
  return auth.handler(request)
}
