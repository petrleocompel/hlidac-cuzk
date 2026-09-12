import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

const exec = promisify(execFile)
it.each(['none', 'backup', 'migration', 'readiness'])(
  'upgrade stops safely at %s failure',
  async (failure) => {
    const dir = await mkdtemp(join(tmpdir(), 'hlidac-compose-'))
    try {
      await writeFile(
        join(dir, 'docker'),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "$CALL_LOG"\ncase "$*" in\n *'--entrypoint sh db'*) [ "$FAILURE" != backup ];;\n *'--exit-code-from migrate'*) [ "$FAILURE" != migration ];;\n *'--wait-timeout 120 app'*) [ "$FAILURE" != readiness ];;\n *) exit 0;;\nesac\n`,
        { mode: 0o700 },
      )
      const run = exec(
        'sh',
        [resolve('deploy/upgrade.sh'), 'fixture.yml', 'fixture'],
        {
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            CALL_LOG: join(dir, 'calls'),
            FAILURE: failure,
            HLIDAC_CUZK_IMAGE: 'fixture:tested',
          },
        },
      )
      if (failure === 'none') await run
      else await expect(run).rejects.toBeDefined()
      const calls = (await readFile(join(dir, 'calls'), 'utf8'))
        .split('\n')
        .filter(Boolean)
      const migration = calls.findIndex((line) =>
        line.includes('--exit-code-from'),
      )
      const backup = calls.findIndex((line) =>
        line.includes('--entrypoint sh db'),
      )
      const web = calls.findIndex((line) => line.includes('--wait-timeout'))
      const worker = calls.findIndex((line) =>
        line.endsWith('up -d --no-deps cron'),
      )
      expect(
        calls.findIndex((line) => line.endsWith('stop -t 300 cron app')),
      ).toBeLessThan(backup)
      if (failure === 'backup') expect(migration).toBe(-1)
      else expect(migration).toBeGreaterThan(backup)
      if (failure === 'backup' || failure === 'migration') expect(web).toBe(-1)
      else expect(web).toBeGreaterThan(migration)
      if (failure !== 'none') expect(worker).toBe(-1)
      else expect(worker).toBeGreaterThan(web)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
