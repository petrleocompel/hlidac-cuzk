import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'

const exec = promisify(execFile)
let client: ReturnType<typeof postgres>
let databaseUrl: string
let issuer: string
let discoveryCalls = 0
const server = createServer((_req, res) => {
  discoveryCalls++
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      issuer,
      authorization_endpoint: issuer + '/authorize',
      token_endpoint: issuer + '/token',
      jwks_uri: issuer + '/jwks',
      userinfo_endpoint: issuer + '/userinfo',
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    }),
  )
})
const config = () => ({
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'production',
  ADMIN_EMAIL: 'bootstrap@example.test',
  ADMIN_PASSWORD: 'bootstrap-fixture-long-password',
  SSO_BOOTSTRAP_ENABLED: 'true',
  SSO_BOOTSTRAP_PROVIDER_ID: 'fixture',
  SSO_BOOTSTRAP_ISSUER: issuer,
  SSO_BOOTSTRAP_CLIENT_ID: 'fixture-client',
  SSO_BOOTSTRAP_CLIENT_SECRET: 'fixture-sso-secret',
  SEED_DEMO_WATCH: '0',
  CUZK_API_BASE_URL: 'http://127.0.0.1:1',
})
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL!
  const admin = postgres(source, { max: 1, onnotice: () => {} })
  const name = `hlidac_test_bootstrap_${process.pid}`
  await admin.unsafe(`CREATE DATABASE ${name}`)
  const url = new URL(source)
  url.pathname = '/' + name
  databaseUrl = url.toString()
  await admin.end()
  client = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('port')
  issuer = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  await client.end()
  const admin = postgres(process.env.TEST_DATABASE_URL!, { max: 1 })
  await admin.unsafe(
    `DROP DATABASE ${new URL(databaseUrl).pathname.slice(1)} WITH (FORCE)`,
  )
  await admin.end()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('repeatable selfhosting bootstrap', () => {
  it('initializes a clean database, creates admin before SSO, and repeats without changing password or calling CUZK', async () => {
    await exec('pnpm', ['bootstrap'], { env: config(), timeout: 20_000 })
    const [admin] = await client`select id from "user" where role = 'admin'`
    const [provider] =
      await client`select user_id, oidc_config from sso_provider where provider_id = 'fixture'`
    expect(provider.user_id).toBe(admin.id)
    expect(JSON.parse(provider.oidc_config).clientSecret).toBe(
      'fixture-sso-secret',
    )
    const [credential] =
      await client`select password from account where user_id = ${admin.id}`
    await Promise.all([
      exec('pnpm', ['bootstrap'], { env: config(), timeout: 20_000 }),
      exec('pnpm', ['bootstrap'], { env: config(), timeout: 20_000 }),
    ])
    const [after] =
      await client`select password from account where user_id = ${admin.id}`
    expect(after.password).toBe(credential.password)
    expect(await client`select id from sso_provider`).toHaveLength(1)
    expect(await client`select id from parcel_watches`).toHaveLength(0)
    expect(await client`select id from cuzk_api_requests`).toHaveLength(0)
    expect(discoveryCalls).toBe(1)
  })
  it('runs doctor without secrets or network probes and detects schema mismatch', async () => {
    const output = await exec('pnpm', ['run', 'doctor'], {
      env: config(),
      timeout: 15_000,
    })
    expect(output.stdout).toContain('OK schéma')
    expect(output.stdout).toContain('OK SSO')
    expect(output.stdout).not.toContain('fixture-sso-secret')
    expect(output.stdout).not.toContain('bootstrap-fixture-long-password')
    const calls = discoveryCalls
    await client`alter table notification_policy rename to notification_policy_hidden`
    try {
      await expect(
        exec('pnpm', ['run', 'doctor'], { env: config(), timeout: 15_000 }),
      ).rejects.toMatchObject({
        stdout: expect.stringContaining('FAIL schéma'),
      })
    } finally {
      await client`alter table notification_policy_hidden rename to notification_policy`
    }
    expect(discoveryCalls).toBe(calls)
  })
  it('rejects incomplete configuration before bootstrap', async () => {
    await expect(
      exec('pnpm', ['bootstrap'], {
        env: { ...config(), CUZK_API_KEY: '', ADMIN_PASSWORD: '' },
        timeout: 10_000,
      }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('CUZK_API_KEY') })
  })
  it('keeps an existing instance bootstrappable when SSO discovery is unreachable', async () => {
    await exec('pnpm', ['bootstrap'], { env: config(), timeout: 20_000 })
    const before = discoveryCalls
    const unreachable = {
      ...config(),
      SSO_BOOTSTRAP_PROVIDER_ID: 'unreachable',
      SSO_BOOTSTRAP_ISSUER: 'https://127.0.0.1:1/',
    }
    const output = await exec('pnpm', ['bootstrap'], {
      env: unreachable,
      timeout: 25_000,
    })
    expect(output.stdout + output.stderr).toMatch(
      /přeskočeno při opakovaném bootstrapu|Bootstrap dokončen/,
    )
    expect(await client`select id from "user" where role = 'admin'`).toHaveLength(
      1,
    )
    expect(
      await client`select id from sso_provider where provider_id = 'fixture'`,
    ).toHaveLength(1)
    expect(
      await client`select id from sso_provider where provider_id = 'unreachable'`,
    ).toHaveLength(0)
    expect(discoveryCalls).toBe(before)
  })
  it('creates unique private env files, prints no secrets, and refuses overwriting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hlidac-env-test-'))
    try {
      const a = join(dir, 'a.env')
      const b = join(dir, 'b.env')
      const output = await exec('pnpm', ['env:init', a])
      await exec('pnpm', ['env:init', b])
      const first = await readFile(a, 'utf8')
      const second = await readFile(b, 'utf8')
      const key = (value: string) =>
        value
          .split('\n')
          .find((line) => line.startsWith('NOTIFICATION_ENCRYPTION_KEY='))!
      expect(key(first)).not.toBe(key(second))
      expect(output.stdout).not.toContain(key(first).split('=')[1])
      expect((await stat(a)).mode & 0o777).toBe(0o600)
      await expect(exec('pnpm', ['env:init', a])).rejects.toBeDefined()
      expect(await readFile(a, 'utf8')).toBe(first)
    } finally {
      await rm(dir, { recursive: true })
    }
  })
})
