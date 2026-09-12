import cron from 'node-cron'
import { backupConfig } from '../src/lib/backup-operations/config.ts'
import {
  initializeBackupRepository,
  runBackup,
} from '../src/lib/backup-operations/run.ts'
import { restoreDatabase } from '../src/lib/backup-operations/restore.ts'

async function main() {
  const config = backupConfig()
  const args = process.argv.slice(2)
  if (args[0] === 'init') {
    const kind = args[1]
    if (kind !== 'database' && kind !== 'config')
      throw new Error('Použití: pnpm backup init database|config')
    await initializeBackupRepository(kind)
    console.log('Repozitáře záloh inicializovány.')
    return
  }
  if (args[0] === 'restore') {
    await restoreDatabase(args[1] ?? '')
    return
  }
  const backup = async () => {
    for (const kind of ['database', 'config'] as const) {
      const snapshot = await runBackup(kind)
      console.log(
        snapshot
          ? `Záloha ${kind} dokončena: ${snapshot}`
          : `Záloha ${kind} přeskočena: jiný běh drží zámek.`,
      )
    }
  }
  if (args[0] === 'once') {
    await backup()
    return
  }
  if (args[0] !== 'schedule')
    throw new Error(
      'Použití: pnpm backup init|once|schedule|restore <snapshot-id>',
    )
  if (!cron.validate(config.BACKUP_SCHEDULE))
    throw new Error('Neplatný BACKUP_SCHEDULE.')
  let active: Promise<void> | undefined
  const task = cron.schedule(
    config.BACKUP_SCHEDULE,
    () => {
      active = backup()
        .catch(() =>
          console.error(
            'Plánovaná záloha selhala; ověřte stav v administraci.',
          ),
        )
        .finally(() => {
          active = undefined
        })
      return active
    },
    { noOverlap: true, timezone: config.BACKUP_TIMEZONE },
  )
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void Promise.resolve(task.stop()).then(async () => {
        await active
        await task.destroy()
      })
    })
  console.log('Plánovač záloh spuštěn.')
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Zálohování selhalo.')
  process.exitCode = 1
})
