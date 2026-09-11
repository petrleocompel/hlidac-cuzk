import { and, eq, sql } from 'drizzle-orm'
import { db } from '#/db'
import { workerHealth, workerJobs } from '#/db/schema'

export const HEARTBEAT_GRACE_SECONDS = 120

export async function recordHeartbeat(starting = false) {
  const gap = sql`${workerHealth.heartbeatAt} < clock_timestamp() - ${HEARTBEAT_GRACE_SECONDS} * interval '1 second'`
  await db
    .insert(workerHealth)
    .values({
      id: 'scheduler',
      heartbeatAt: sql`clock_timestamp()`,
      startedAt: sql`clock_timestamp()`,
    })
    .onConflictDoUpdate({
      target: workerHealth.id,
      set: {
        heartbeatAt: sql`clock_timestamp()`,
        ...(starting ? { startedAt: sql`clock_timestamp()` } : {}),
        lastOutageAt: sql`case when ${gap} then ${workerHealth.heartbeatAt} + ${HEARTBEAT_GRACE_SECONDS} * interval '1 second' else ${workerHealth.lastOutageAt} end`,
        recoveredAt: sql`case when ${gap} then clock_timestamp() else ${workerHealth.recoveredAt} end`,
      },
    })
}

export async function trackWorkerJob(
  name: string,
  run: () => Promise<Record<string, number | boolean>>,
) {
  const token = crypto.randomUUID()
  await db
    .insert(workerJobs)
    .values({ name, runToken: token, startedAt: sql`clock_timestamp()` })
    .onConflictDoUpdate({
      target: workerJobs.name,
      set: { runToken: token, startedAt: sql`clock_timestamp()` },
    })
  const ownsRun = and(eq(workerJobs.name, name), eq(workerJobs.runToken, token))
  try {
    const summary = await run()
    const failed =
      Number(summary.errors) > 0 ||
      Number(summary.failed) > 0 ||
      Number(summary.pending) > 0
    await db
      .update(workerJobs)
      .set({
        finishedAt: sql`clock_timestamp()`,
        summary,
        ...(failed ? {} : { lastSuccessfulAt: sql`clock_timestamp()` }),
        lastError: failed
          ? 'Část položek selhala; viz souhrn běhu a historie sledování.'
          : null,
      })
      .where(ownsRun)
    return summary
  } catch (error) {
    await db
      .update(workerJobs)
      .set({
        finishedAt: sql`clock_timestamp()`,
        summary: null,
        lastError: 'Běh úlohy selhal. Podrobnosti jsou v serverovém logu.',
      })
      .where(ownsRun)
    throw error
  }
}
