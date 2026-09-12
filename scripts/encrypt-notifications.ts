import { closeDb } from '../src/db/index.ts'
import { migrateNotificationSecrets } from '../src/lib/notifications/migrate-secrets.ts'
import { NotificationConfigurationError } from '../src/lib/notifications/secrets.ts'

try {
  const count = await migrateNotificationSecrets()
  console.log(`Šifrování dokončeno: ${count} hodnot.`)
} catch (error) {
  console.error(
    error instanceof NotificationConfigurationError
      ? error.message
      : 'Migrace selhala; žádné změny nebyly potvrzeny. Ověřte dostupnost a schéma DB.',
  )
  process.exitCode = 1
} finally {
  await closeDb()
}
