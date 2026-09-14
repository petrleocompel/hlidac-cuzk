import { sql } from 'drizzle-orm'
import { db } from '#/db'

export type AuditTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0]
/** Actor is always resolved by the caller from a verified session, never from input. */
export async function withAuditActor<T>(
  actorId: string | null,
  run: (tx: AuditTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('hlidac.audit_actor', ${actorId ?? ''}, true)`,
    )
    return run(tx)
  })
}
