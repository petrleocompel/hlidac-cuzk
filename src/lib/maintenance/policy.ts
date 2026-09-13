import { z } from 'zod'

const retentionDays = z.coerce.number().int().min(0).max(3650).default(0)
/** Zero disables deletion. Only the operator's explicit configuration enables it. */
export const retentionSchema = z.object({
  RETENTION_EVENT_DAYS: retentionDays,
  RETENTION_SNAPSHOT_DAYS: retentionDays,
  RETENTION_ERROR_DAYS: retentionDays,
  RETENTION_API_REQUEST_DAYS: retentionDays.refine(
    (value) => value === 0 || value >= 30,
    'Detailní API metriky uchovávejte alespoň 30 dnů.',
  ),
})
export type RetentionPolicy = z.infer<typeof retentionSchema>
export const RETENTION_BATCH_SIZE = 1000

export function apiRetentionBoundary(now: Date, days: number): string {
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Prague' })
  const date = new Date(day + 'T00:00:00Z')
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
