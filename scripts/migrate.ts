import { runMigrations } from '../src/db/migrate.ts'

try {
  await runMigrations()
  console.log('Migrace dokončeny.')
} catch {
  console.error(
    'Migrace selhaly. Ověřte DATABASE_URL, dostupnost databáze a migrační soubory.',
  )
  process.exitCode = 1
}
