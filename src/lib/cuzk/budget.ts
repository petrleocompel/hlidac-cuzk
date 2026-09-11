import { createHash } from 'node:crypto'
import { and, eq, ne, sql } from 'drizzle-orm'
import { db } from '#/db'
import { cuzkApiControl, cuzkApiDailyUsage, cuzkApiRequests } from '#/db/schema'
import type { CuzkAccount } from './policy'
import {
  ACCOUNT_CACHE_MS,
  DAILY_API_LIMIT,
  accountSchema,
  cuzkPolicy,
  CuzkUnavailableError,
} from './policy'

export function apiIdentity() {
  const key = process.env.CUZK_API_KEY
  if (!key) throw new CuzkUnavailableError('Není nastavený klíč ČÚZK API.')
  const base = (
    process.env.CUZK_API_BASE_URL ?? 'https://api-kn.cuzk.gov.cz'
  ).replace(/\/$/, '')
  const fingerprint = createHash('sha256')
    .update(`${base}\0${key}`)
    .digest('hex')
  return { key, base, fingerprint }
}

export async function ensureApiControl() {
  const { fingerprint } = apiIdentity()
  await db
    .insert(cuzkApiControl)
    .values({ id: 'instance', keyFingerprint: fingerprint })
    .onConflictDoNothing()
  // Rotation clears obsolete remote account/auth information, never today's spend.
  await db
    .update(cuzkApiControl)
    .set({
      keyFingerprint: fingerprint,
      blockedUntil: null,
      blockedReason: null,
      accountJson: null,
      accountDay: null,
      accountBaseline: null,
      accountCheckedAt: null,
      accountAttemptAt: null,
      accountError: null,
    })
    .where(
      and(
        eq(cuzkApiControl.id, 'instance'),
        ne(cuzkApiControl.keyFingerprint, fingerprint),
      ),
    )
  return fingerprint
}

export type ApiTicket = {
  id: string
  day: string
  ordinal: number
  fingerprint: string
}

/** Every HTTP attempt must reserve and persist its cost BEFORE any network I/O. */
export async function reserveApiRequest(
  endpoint: string,
  attempt: number,
): Promise<{ ticket: ApiTicket } | { waitMs: number }> {
  const fingerprint = await ensureApiControl()
  return db.transaction(async (tx) => {
    const [control] = await tx
      .select()
      .from(cuzkApiControl)
      .where(eq(cuzkApiControl.id, 'instance'))
      .for('update')
    const [clock] = await tx
      .select({
        day: sql<string>`to_char(clock_timestamp() AT TIME ZONE 'Europe/Prague', 'YYYY-MM-DD')`,
        now: sql<string>`clock_timestamp()::text`,
        reset: sql<string>`((date_trunc('day', clock_timestamp() AT TIME ZONE 'Europe/Prague') + interval '1 day') AT TIME ZONE 'Europe/Prague')::text`,
      })
      .from(cuzkApiControl)
      .where(eq(cuzkApiControl.id, 'instance'))
    const now = new Date(clock.now)
    if (control.blockedUntil && control.blockedUntil > now) {
      throw new CuzkUnavailableError(
        control.blockedReason ?? 'ČÚZK API je dočasně pozastavené.',
        control.blockedUntil,
      )
    }
    await tx
      .insert(cuzkApiDailyUsage)
      .values({ day: clock.day })
      .onConflictDoNothing()
    const [usage] = await tx
      .select()
      .from(cuzkApiDailyUsage)
      .where(eq(cuzkApiDailyUsage.day, clock.day))
    if (usage.reserved >= DAILY_API_LIMIT) {
      throw new CuzkUnavailableError(
        'Denní rozpočet 500 volání ČÚZK je vyčerpaný.',
        new Date(clock.reset),
      )
    }
    const account = accountSchema.safeParse(control.accountJson)
    if (account.success && new Date(account.data.expiraceApiKey) <= now)
      throw new CuzkUnavailableError('Klíč ČÚZK API expiroval.')
    if (account.success && control.accountDay === clock.day) {
      const usedSinceAccount = Math.max(
        0,
        usage.reserved - (control.accountBaseline ?? usage.reserved),
      )
      if (
        account.data.provedenoVolani + usedSinceAccount >=
        account.data.limitVolani
      ) {
        throw new CuzkUnavailableError(
          'Podle posledního stavu účtu je kvóta ČÚZK vyčerpaná.',
          new Date(clock.reset),
        )
      }
    }
    if (control.nextRequestAt && control.nextRequestAt > now)
      return { waitMs: control.nextRequestAt.getTime() - now.getTime() }
    await tx
      .update(cuzkApiControl)
      .set({
        nextRequestAt: new Date(
          now.getTime() + cuzkPolicy().CUZK_MIN_REQUEST_INTERVAL_MS,
        ),
      })
      .where(eq(cuzkApiControl.id, 'instance'))
    await tx
      .update(cuzkApiDailyUsage)
      .set({ reserved: usage.reserved + 1 })
      .where(eq(cuzkApiDailyUsage.day, clock.day))
    const [row] = await tx
      .insert(cuzkApiRequests)
      .values({ day: clock.day, endpoint, attempt, startedAt: now })
      .returning({ id: cuzkApiRequests.id })
    return {
      ticket: {
        id: row.id,
        day: clock.day,
        ordinal: usage.reserved + 1,
        fingerprint,
      },
    }
  })
}

export async function finishApiRequest(
  ticket: ApiTicket,
  outcome: (typeof cuzkApiRequests.$inferSelect)['outcome'],
  durationMs: number,
  status: number | null,
) {
  await db
    .update(cuzkApiRequests)
    .set({
      outcome,
      durationMs: Math.max(0, Math.round(durationMs)),
      httpStatus: status,
      finishedAt: new Date(),
    })
    .where(eq(cuzkApiRequests.id, ticket.id))
}

export async function blockApi(
  ticket: ApiTicket,
  delayMs: number,
  reason: string,
) {
  // Concurrent responses can only extend a shared pause, never shorten it.
  const until = new Date(Date.now() + delayMs)
  await db
    .update(cuzkApiControl)
    .set({
      blockedUntil: sql`greatest(${cuzkApiControl.blockedUntil}, ${until.toISOString()}::timestamptz)`,
      blockedReason: reason,
    })
    .where(
      and(
        eq(cuzkApiControl.id, 'instance'),
        eq(cuzkApiControl.keyFingerprint, ticket.fingerprint),
      ),
    )
}

export async function claimAccountRefresh(): Promise<boolean> {
  await ensureApiControl()
  const result = await db
    .update(cuzkApiControl)
    .set({ accountAttemptAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(cuzkApiControl.id, 'instance'),
        sql`(${cuzkApiControl.accountAttemptAt} is null or ${cuzkApiControl.accountAttemptAt} <= clock_timestamp() - ${ACCOUNT_CACHE_MS} * interval '1 millisecond')`,
      ),
    )
    .returning({ id: cuzkApiControl.id })
  return result.length > 0
}

export async function recordAccount(account: CuzkAccount, ticket: ApiTicket) {
  // Ignore a response from an older diagnostic request/key. Its baseline is the
  // reservation at START, so concurrent requests are conservatively counted.
  await db
    .update(cuzkApiControl)
    .set({
      accountJson: account,
      accountDay: ticket.day,
      accountBaseline: ticket.ordinal,
      accountCheckedAt: new Date(),
      accountError: null,
    })
    .where(
      and(
        eq(cuzkApiControl.id, 'instance'),
        eq(cuzkApiControl.keyFingerprint, ticket.fingerprint),
        sql`(${cuzkApiControl.accountDay} is null or ${cuzkApiControl.accountDay} < ${ticket.day}::date or (${cuzkApiControl.accountDay} = ${ticket.day}::date and coalesce(${cuzkApiControl.accountBaseline}, 0) <= ${ticket.ordinal}))`,
      ),
    )
}
