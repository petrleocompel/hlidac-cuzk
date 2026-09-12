import { describe, expect, it } from 'vitest'
import { getEnv } from '../src/env'

const valid = () => ({
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgres://fixture:unique-fixture-password@127.0.0.1:5432/hlidac_test_config',
  BETTER_AUTH_SECRET: 'fixture-long-authentication-secret-only',
  PUBLIC_URL: 'https://hlidac.example.test',
  CUZK_API_KEY: 'api-secret-marker',
  ADMIN_EMAIL: '',
  ADMIN_PASSWORD: '',
})
describe('instance configuration', () => {
  it('defaults to private registration and no demo, accepting empty optional fields', () => {
    const env = getEnv(valid())
    expect(env.REGISTRATION_MODE).toBe('private')
    expect(env.SEED_DEMO_WATCH).toBe('0')
    expect(env.ADMIN_EMAIL).toBeUndefined()
    expect(env.BETTER_AUTH_URL).toBe('https://hlidac.example.test')
  })
  it('reports variable names without including secret input values', () => {
    for (const change of [
      { BETTER_AUTH_SECRET: 'sensitive-marker' },
      { DATABASE_URL: 'bad-sensitive-db-marker' },
      { NOTIFICATION_ENCRYPTION_KEY: 'sensitive-key-marker' },
    ]) {
      try {
        getEnv({ ...valid(), ...change })
        expect.fail('expected invalid configuration')
      } catch (error) {
        expect(String(error)).not.toMatch(
          /sensitive-(marker|db-marker|key-marker)/,
        )
        expect(String(error)).toContain(Object.keys(change)[0])
      }
    }
  })
  it('rejects usable example production secrets and non-origin public URLs', () => {
    expect(() =>
      getEnv({ ...valid(), DATABASE_URL: 'postgres://hlidac:hlidac@db/db' }),
    ).toThrow('DATABASE_URL')
    expect(() =>
      getEnv({
        ...valid(),
        BETTER_AUTH_SECRET:
          'replace-with-32-char-minimum-secret-value-xxxxxxxxxxxx',
      }),
    ).toThrow('BETTER_AUTH_SECRET')
    expect(() =>
      getEnv({ ...valid(), PUBLIC_URL: 'https://app.test/path' }),
    ).toThrow('BETTER_AUTH_URL')
    expect(() =>
      getEnv({ ...valid(), AUTH_TRUST_PROXY_HEADERS: 'true' }),
    ).toThrow('AUTH_TRUSTED_PROXIES')
  })
  it('requires a complete SSO bootstrap configuration when enabled', () => {
    expect(() => getEnv({ ...valid(), SSO_BOOTSTRAP_ENABLED: 'true' })).toThrow(
      'SSO_BOOTSTRAP_CLIENT_SECRET',
    )
    expect(() =>
      getEnv({ ...valid(), CUZK_REQUEST_TIMEOUT_MS: 'invalid' }),
    ).toThrow('CUZK_REQUEST_TIMEOUT_MS')
  })
})
