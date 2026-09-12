import { db } from '#/db'

export async function getBackupStatus() {
  const rows = await db.query.backupStatus.findMany()
  return (['database', 'config'] as const).map((kind) => {
    const row = rows.find((value) => value.kind === kind)
    return {
      kind,
      startedAt: row?.startedAt?.toISOString() ?? null,
      finishedAt: row?.finishedAt?.toISOString() ?? null,
      lastSuccessfulAt: row?.lastSuccessfulAt?.toISOString() ?? null,
      snapshotId: row?.snapshotId ?? null,
      lastError: row?.lastError ?? null,
      stale:
        !row?.lastSuccessfulAt ||
        Date.now() - row.lastSuccessfulAt.getTime() > 26 * 60 * 60_000,
    }
  })
}
