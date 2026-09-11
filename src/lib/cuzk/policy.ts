import { z } from 'zod'

// User's quota for this installation, including retries and account diagnostics.
export const DAILY_API_LIMIT = 500
export const DEFAULT_POLL_MINUTES = 1440
export const MANUAL_REFRESH_SECONDS = 300
export const ACCOUNT_CACHE_MS = 15 * 60_000

const config = z.object({
  CUZK_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10)
    .max(30_000)
    .default(15_000),
  CUZK_MIN_REQUEST_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(1000),
  MAX_WATCHES_PER_USER: z.coerce.number().int().min(1).max(1000).default(100),
})

export function cuzkPolicy() {
  return config.parse(process.env)
}

export class CuzkUnavailableError extends Error {
  constructor(
    message: string,
    public readonly retryAt: Date | null = null,
  ) {
    super(message)
  }
}

export class CuzkHttpError extends Error {
  constructor(public readonly status: number) {
    super(`ČÚZK vrátilo HTTP ${status}.`)
  }
}

export function retryAfterMilliseconds(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (value.trim() === '' || /^-\d/.test(value)) return null
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, 253402300799000 - now)
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : Math.max(0, parsed - now)
}

export const accountSchema = z.object({
  idSluzby: z.string().optional(),
  aktualniObdobi: z.string(),
  provedenoVolani: z.number().int().nonnegative(),
  limitVolani: z.number().int().nonnegative(),
  expiraceApiKey: z.iso.datetime({ offset: true }),
})
export type CuzkAccount = z.infer<typeof accountSchema>
