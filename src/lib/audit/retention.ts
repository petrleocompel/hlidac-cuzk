import { sql } from 'drizzle-orm'
import { db } from '#/db'
import { auditPolicySchema } from './policy'

export async function retainAudit(
  options: { apply?: boolean; policy?: unknown; now?: Date } = {},
) {
  const { AUDIT_RETENTION_DAYS: days } = auditPolicySchema.parse(
    options.policy ?? process.env,
  )
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() - days * 86400000,
  ).toISOString()
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '10s'`)
    const eligible = sql`select id from admin_audit where created_at < ${cutoff}::timestamptz order by created_at,id limit 1000 for update skip locked`
    const rows = options.apply
      ? await tx.execute(
          sql`with eligible as (${eligible}) delete from admin_audit using eligible where admin_audit.id = eligible.id returning admin_audit.id`,
        )
      : await tx.execute(eligible)
    return rows.length
  })
}
