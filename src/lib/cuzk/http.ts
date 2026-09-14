import { setTimeout as delay } from 'node:timers/promises'
import { ZodError } from 'zod'
import type { CuzkAccount } from './policy'
import { and, eq } from 'drizzle-orm'
import { db } from '#/db'
import { cuzkApiControl } from '#/db/schema'
import {
  apiIdentity,
  blockApi,
  claimAccountRefresh,
  finishApiRequest,
  recordAccount,
  reserveApiRequest,
} from './budget'
import {
  accountSchema,
  cuzkPolicy,
  CuzkHttpError,
  CuzkUnavailableError,
  retryAfterMilliseconds,
} from './policy'

const ACCOUNT_PATH = '/api/v1/AplikacniSluzby/StavUctu'
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])

export async function requestCuzk<T>(
  path: string,
  query?: Record<string, string>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const identity = apiIdentity()
  const url = new URL(path, identity.base)
  for (const [key, value] of Object.entries(query ?? {}))
    url.searchParams.set(key, value)
  const endpoint = path.replace(/\/\d+(?=\/|$)/g, '/:id')
  const overall = AbortSignal.any([
    AbortSignal.timeout(60_000),
    ...(parentSignal ? [parentSignal] : []),
  ])
  for (let attempt = 1; attempt <= 3; attempt++) {
    overall.throwIfAborted()
    let slot = await reserveApiRequest(endpoint, attempt)
    while ('waitMs' in slot) {
      await delay(slot.waitMs, undefined, { signal: overall })
      slot = await reserveApiRequest(endpoint, attempt)
    }
    const { ticket } = slot
    const started = performance.now()
    const signal = AbortSignal.any([
      overall,
      AbortSignal.timeout(cuzkPolicy().CUZK_REQUEST_TIMEOUT_MS),
    ])
    let response: Response | undefined
    let data: unknown
    let account: CuzkAccount | undefined
    try {
      response = await fetch(url, {
        headers: { ApiKey: identity.key, Accept: 'application/json' },
        signal,
        redirect: 'error',
      })
      if (response.ok) {
        data = await response.json()
        if (path === ACCOUNT_PATH) account = accountSchema.parse(data)
      } else await response.body?.cancel()
    } catch (error) {
      const timeout = signal.aborted && !parentSignal?.aborted
      const invalid = error instanceof SyntaxError || error instanceof ZodError
      const outcome = invalid
        ? 'invalid_response'
        : parentSignal?.aborted
          ? 'cancelled'
          : timeout
            ? 'timeout'
            : 'network_error'
      await finishApiRequest(
        ticket,
        outcome,
        performance.now() - started,
        response?.status ?? null,
      )
      if (parentSignal?.aborted) parentSignal.throwIfAborted()
      if (overall.aborted)
        throw new CuzkUnavailableError(
          'Požadavek ČÚZK překročil časový limit 60 sekund.',
        )
      // Invalid JSON is a contract error, not a reason to spend the quota again.
      if (attempt === 3 || invalid)
        throw new CuzkUnavailableError(
          timeout
            ? 'ČÚZK neodpovědělo v časovém limitu.'
            : 'ČÚZK je nedostupné nebo vrátilo neplatnou odpověď.',
        )
      await delay(250 * 2 ** (attempt - 1) + Math.random() * 250, undefined, {
        signal: overall,
      })
      continue
    }
    await finishApiRequest(
      ticket,
      response.ok ? 'success' : 'http_error',
      performance.now() - started,
      response.status,
    )
    if (response.ok) {
      if (account) await recordAccount(account, ticket)
      return data as T
    }
    if (response.status === 401 || response.status === 403) {
      await blockApi(
        ticket,
        15 * 60_000,
        'ČÚZK odmítlo API klíč. Zkontrolujte konfiguraci; další pokus nejdříve za 15 minut.',
      )
      throw new CuzkHttpError(response.status, path)
    }
    const retryAfter = retryAfterMilliseconds(
      response.headers.get('Retry-After'),
    )
    if (
      response.status === 429 ||
      (RETRYABLE.has(response.status) && retryAfter !== null)
    ) {
      const pause = Math.max(1000, retryAfter ?? 60_000)
      await blockApi(
        ticket,
        pause,
        'ČÚZK požaduje přestávku před dalším voláním.',
      )
      // Persist long waits instead of sleeping through the parcel lease. Other
      // processes see the same pause; a later cycle can resume automatically.
      if (pause > 5000 || attempt === 3)
        throw new CuzkUnavailableError(
          'ČÚZK dočasně omezilo volání.',
          new Date(Date.now() + pause),
        )
      await delay(pause, undefined, { signal: overall })
    } else if (!RETRYABLE.has(response.status) || attempt === 3) {
      throw new CuzkHttpError(response.status, path)
    } else {
      await delay(250 * 2 ** (attempt - 1) + Math.random() * 250, undefined, {
        signal: overall,
      })
    }
  }
  throw new CuzkUnavailableError('ČÚZK je dočasně nedostupné.')
}

export async function refreshCuzkAccount(): Promise<{ refreshed: boolean }> {
  if (!(await claimAccountRefresh())) return { refreshed: false }
  const { fingerprint } = apiIdentity()
  try {
    await requestCuzk(ACCOUNT_PATH)
    return { refreshed: true }
  } catch (error) {
    const message =
      error instanceof CuzkHttpError || error instanceof CuzkUnavailableError
        ? error.message
        : 'Stav účtu se nepodařilo ověřit.'
    await db
      .update(cuzkApiControl)
      .set({ accountError: message })
      .where(
        and(
          eq(cuzkApiControl.id, 'instance'),
          eq(cuzkApiControl.keyFingerprint, fingerprint),
        ),
      )
    throw new Error(message)
  }
}
