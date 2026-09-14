import { desc, sql } from 'drizzle-orm'
import { db } from '#/db'
import { adminAudit } from '#/db/schema'
import { auditPolicySchema } from './policy'

export async function readAudit(before?: { at: string; id: string }) {
  const rows = await db
    .select({
      id: adminAudit.id,
      actorId: adminAudit.actorId,
      targetId: adminAudit.targetId,
      action: adminAudit.action,
      details: adminAudit.details,
      // Preserve PostgreSQL microseconds; JS Date truncation can skip cursor peers.
      createdAt: sql<string>`to_char(${adminAudit.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(adminAudit)
    .where(
      before
        ? sql`(${adminAudit.createdAt}, ${adminAudit.id}) < (${before.at}::timestamptz, ${before.id}::uuid)`
        : undefined,
    )
    .orderBy(desc(adminAudit.createdAt), desc(adminAudit.id))
    .limit(51)
  const items = rows.slice(0, 50).map((r) => ({
    ...r,
    createdAt: r.createdAt,
    details: JSON.stringify(r.details),
  }))
  const last = items.at(-1)
  return {
    items,
    next: rows.length > 50 && last ? { at: last.createdAt, id: last.id } : null,
    days: auditPolicySchema.parse(process.env).AUDIT_RETENTION_DAYS,
  }
}
