import { createHash, timingSafeEqual } from 'node:crypto'
import type { CuzkMetrics } from './metrics'

export function metricsAuthorization(
  authorization: string | null,
  token = process.env.METRICS_BEARER_TOKEN,
): 200 | 401 | 404 {
  if (!token || token.length < 32) return 404
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(authorization ?? ''), digest(`Bearer ${token}`))
    ? 200
    : 401
}

export function renderCuzkMetrics(m: CuzkMetrics) {
  const gauge = (name: string, help: string, value: number) =>
    `# HELP hlidac_cuzk_${name} ${help}\n# TYPE hlidac_cuzk_${name} gauge\nhlidac_cuzk_${name} ${value}\n`
  return [
    gauge(
      'daily_limit',
      'Installation daily request limit; Europe/Prague day.',
      m.limit,
    ),
    gauge(
      'daily_reserved',
      'Reserved attempts today including retries and unfinished attempts.',
      m.today.reserved,
    ),
    gauge(
      'daily_remaining',
      'Remaining local request budget today.',
      m.remaining,
    ),
    gauge('daily_errors', 'Failed attempts today.', m.today.errors),
    gauge('daily_success', 'Successful attempts today.', m.today.success),
    gauge(
      'daily_pending',
      'Unfinished attempts today, including interrupted processes.',
      m.today.pending,
    ),
    gauge('daily_retries', 'Retry attempts today.', m.today.retries),
    gauge(
      'daily_average_duration_ms',
      'Mean completed attempt duration today.',
      m.today.averageMs,
    ),
    gauge(
      'minimum_daily_calls',
      'Scheduled parcel calls per day excluding details and retries.',
      m.demand.minimumDailyCalls,
    ),
    gauge(
      'account_last_checked_timestamp_seconds',
      'Last successful account diagnostic; zero if unknown.',
      m.accountCheckedAt ? Date.parse(m.accountCheckedAt) / 1000 : 0,
    ),
    ...(m.account
      ? [
          gauge(
            'account_reported_used',
            'Usage reported for the provider account period at last diagnostic.',
            m.account.provedenoVolani,
          ),
          gauge(
            'account_reported_limit',
            'Limit reported for the provider account period.',
            m.account.limitVolani,
          ),
          gauge(
            'account_key_expires_timestamp_seconds',
            'Provider API key expiry.',
            Date.parse(m.account.expiraceApiKey) / 1000,
          ),
        ]
      : []),
  ].join('')
}
