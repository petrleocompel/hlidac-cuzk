import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { expect, it } from 'vitest'
import {
  initializeBackupRepository,
  runBackup,
} from '../../src/lib/backup-operations/run'
import { restoreDatabase } from '../../src/lib/backup-operations/restore'
import { probeReadiness } from '../../src/lib/monitoring/readiness'

const exec = promisify(execFile)
it('runs clean bootstrap → login → verified watch → change → durable queue → process restart → bootstrap → encrypted backup/restore', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hlidac-installation-'))
  const admin = postgres(process.env.TEST_DATABASE_URL!, {
    max: 1,
    onnotice: () => {},
  })
  const sourceName = `hlidac_test_journey_source_${process.pid}`
  const targetName = `hlidac_test_journey_target_${process.pid}`
  let area = 100,
    apiCalls = 0,
    messages = 0
  const fixture = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    response.setHeader('Content-Type', 'application/json')
    if (path === '/api/v1/Parcely/1') {
      apiCalls++
      response.end(
        JSON.stringify({
          data: {
            id: 1,
            kmenoveCisloParcely: 1,
            druhCislovaniParcely: 2,
            katastralniUzemi: { kod: 777552, nazev: 'Fixture' },
            vymera: area,
            rizeniPlomby: [],
          },
        }),
      )
    } else if (path === '/message') {
      for await (const chunk of request) void chunk
      messages++
      response.end('{}')
    } else {
      response.statusCode = 404
      response.end('{}')
    }
  })
  let source: ReturnType<typeof postgres> | undefined
  let target: ReturnType<typeof postgres> | undefined
  const savedEnv = { ...process.env }
  try {
    await admin.unsafe(`CREATE DATABASE ${sourceName}`)
    await admin.unsafe(`CREATE DATABASE ${targetName}`)
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.pathname = '/' + sourceName
    const sourceUrl = url.toString()
    url.pathname = '/' + targetName
    const targetUrl = url.toString()
    source = postgres(sourceUrl, { max: 1, onnotice: () => {} })
    target = postgres(targetUrl, { max: 1, onnotice: () => {} })
    await new Promise<void>((resolve) =>
      fixture.listen(0, '127.0.0.1', resolve),
    )
    const address = fixture.address()
    if (!address || typeof address === 'string')
      throw new Error('No fixture port')
    Object.assign(process.env, {
      DATABASE_URL: sourceUrl,
      RESTORE_DATABASE_URL: targetUrl,
      NODE_ENV: 'production',
      SSO_BOOTSTRAP_ENABLED: 'false',
      SEED_DEMO_WATCH: '0',
      ADMIN_EMAIL: 'journey@example.test',
      ADMIN_PASSWORD: 'journey-fixture-long-password',
      REGISTRATION_MODE: 'private',
      AUTH_MODE: 'hybrid',
      SENTRY_DSN: '',
      CUZK_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      CUZK_API_KEY: 'journey-fixture-only',
      CUZK_MIN_REQUEST_INTERVAL_MS: '0',
      BETTER_AUTH_URL: 'http://127.0.0.1:3999',
      BETTER_AUTH_SECRET: 'journey-fixture-auth-secret-at-least-32-chars',
      BACKUP_INSTANCE: 'journey-fixture',
      BACKUP_REPOSITORY: join(directory, 'repository'),
      BACKUP_PASSWORD: 'journey-fixture-repository-password',
      BACKUP_CONFIG_REPOSITORY: join(directory, 'config-repository'),
      BACKUP_CONFIG_PASSWORD: 'journey-fixture-config-password',
      BACKUP_CONFIG_PATHS: join(directory, 'app.env'),
    })
    await writeFile(
      process.env.BACKUP_CONFIG_PATHS!,
      'NOTIFICATION_ENCRYPTION_KEY=' + process.env.NOTIFICATION_ENCRYPTION_KEY,
      { mode: 0o600 },
    )
    const bootstrap = () =>
      exec(process.execPath, ['--import', 'tsx', 'scripts/bootstrap.ts'], {
        env: process.env,
        timeout: 30000,
      })
    const step = (phase: string, databaseUrl = sourceUrl) =>
      exec(
        process.execPath,
        ['--import', 'tsx', 'tests/fixtures/installation-step.ts', phase],
        { env: { ...process.env, DATABASE_URL: databaseUrl }, timeout: 30000 },
      )
    expect(await probeReadiness(sourceUrl)).toBe(false)
    await bootstrap()
    expect(await probeReadiness(sourceUrl)).toBe(true)
    await step('auth')
    await step('watch')
    expect(apiCalls).toBe(1)
    area = 101
    await step('poll')
    expect(apiCalls).toBe(2)
    expect(messages).toBe(0)
    expect(
      (await source`select status from notification_deliveries`)[0].status,
    ).toBe('pending')
    // The producer process has exited. Repeat startup before taking the recovery point.
    await bootstrap()
    expect((await source`select count(*)::int n from watch_events`)[0].n).toBe(
      1,
    )
    await initializeBackupRepository('database')
    const snapshot = await runBackup('database')
    expect(snapshot).toMatch(/^[a-f0-9]{8,64}$/)
    await step('deliver')
    expect(messages).toBe(1)
    expect(
      (await source`select status from notification_deliveries`)[0].status,
    ).toBe('sent')
    await restoreDatabase(snapshot!)
    expect(await probeReadiness(targetUrl)).toBe(true)
    await step('restored', targetUrl)
    expect(messages).toBe(1) // Restore does not silently launch delivery.
    expect(
      (await target`select sum(attempts)::int n from cuzk_api_daily_usage`)[0]
        .n,
    ).toBe(2)
    // Explicitly resumed restored consumer can redeliver a pre-ack backup: documented behavior.
    await step('deliver', targetUrl)
    expect(messages).toBe(2)
    expect(apiCalls).toBe(2)
  } finally {
    process.env = savedEnv
    await source?.end()
    await target?.end()
    await new Promise<void>((resolve) => fixture.close(() => resolve()))
    await admin.unsafe(`DROP DATABASE IF EXISTS ${sourceName} WITH (FORCE)`)
    await admin.unsafe(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`)
    await admin.end()
    await rm(directory, { recursive: true, force: true })
  }
})
