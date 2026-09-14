import { readFile, stat } from 'node:fs/promises'
import { closeDb } from '../src/db/index.ts'
import { recoverLocalPassword } from '../src/lib/account-recovery.ts'
import { probeReadiness } from '../src/lib/monitoring/readiness.ts'

try {
  const args = process.argv.slice(2)
  if (
    args.length !== 4 ||
    args[0] !== '--email' ||
    args[2] !== '--password-file'
  )
    throw new Error(
      'Použití: pnpm account:recover --email účet@example.cz --password-file /cesta/k/souboru-0600',
    )
  const file = await stat(args[3])
  if (!file.isFile() || file.size > 1024 || (file.mode & 0o077) !== 0)
    throw new Error(
      'Soubor hesla musí mít nejvýše 1 kB a oprávnění pouze pro vlastníka (0600).',
    )
  if (!(await probeReadiness()))
    throw new Error('Schéma není připravené. Spusťte bootstrap.')
  const password = (await readFile(args[3], 'utf8')).replace(/\r?\n$/, '')
  try {
    await recoverLocalPassword({ email: args[1], password })
  } catch {
    // Database errors may include bound credential hashes. Never print them.
    throw new Error(
      'Obnova selhala. Ověřte existující účet, délku hesla a dostupnost databáze.',
    )
  }
  console.log(
    'Heslo změněno, relace zrušeny. Role a blokace účtu zůstaly zachované.',
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Obnova selhala.')
  process.exitCode = 1
} finally {
  await closeDb()
}
