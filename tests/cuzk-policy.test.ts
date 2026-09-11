import { describe, expect, it } from 'vitest'
import { retryAfterMilliseconds } from '../src/lib/cuzk/policy'
import { metricsAuthorization } from '../src/lib/cuzk/prometheus'

describe('CUZK retry policy and metrics authentication', () => {
  it('parses seconds and HTTP-date, rejecting unusable headers', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(retryAfterMilliseconds('2', now)).toBe(2000)
    expect(retryAfterMilliseconds('Thu, 01 Jan 2026 00:01:00 GMT', now)).toBe(
      60000,
    )
    expect(retryAfterMilliseconds('Wed, 31 Dec 2025 23:00:00 GMT', now)).toBe(0)
    expect(retryAfterMilliseconds('invalid', now)).toBeNull()
    expect(retryAfterMilliseconds(null, now)).toBeNull()
    expect(retryAfterMilliseconds('-1', now)).toBeNull()
    expect(retryAfterMilliseconds(' ', now)).toBeNull()
    expect(Number.isFinite(retryAfterMilliseconds('1e300', now))).toBe(true)
  })
  it('disables metrics without a strong token and requires exact bearer authentication', () => {
    const token = 'fixture-only-'.repeat(4)
    expect(metricsAuthorization(null, '')).toBe(404)
    expect(metricsAuthorization('Bearer short', 'short')).toBe(404)
    expect(metricsAuthorization(null, token)).toBe(401)
    expect(metricsAuthorization(`Bearer ${token}wrong`, token)).toBe(401)
    expect(metricsAuthorization(`Bearer ${token}`, token)).toBe(200)
  })
})
