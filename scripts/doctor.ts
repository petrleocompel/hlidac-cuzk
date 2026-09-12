import postgres from 'postgres'
import { getEnv } from '../src/env.ts'
import { probeReadiness } from '../src/lib/monitoring/readiness.ts'

let failures = 0
const report = (ok: boolean, label: string, message: string) => {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}: ${message}`)
  if (!ok) failures++
}
try {
  const config = getEnv()
  report(
    true,
    'konfigurace',
    'povinné hodnoty a formáty jsou platné (tajné hodnoty se nevypisují)',
  )
  report(
    true,
    'veřejná URL',
    new URL(config.BETTER_AUTH_URL).protocol === 'https:'
      ? 'HTTPS origin'
      : 'HTTP origin; použijte jen na důvěryhodné síti',
  )
  report(
    true,
    'ČÚZK klíč',
    'nastaven; platnost se bez --check-api vzdáleně neověřuje',
  )
  console.log(
    config.NOTIFICATION_ENCRYPTION_KEY
      ? 'OK notifikace: šifrovací klíč nastaven'
      : 'WARN notifikace: šifrovací klíč chybí; ukládání a doručování tajných údajů nebude fungovat',
  )
  const client = postgres(config.DATABASE_URL, {
    max: 1,
    connect_timeout: 3,
    connection: { statement_timeout: 3000 },
    onnotice: () => {},
  })
  try {
    const [version] =
      await client`select current_setting('server_version') as version`
    report(
      true,
      'databáze',
      `spojení dostupné; PostgreSQL ${String(version.version)}`,
    )
    const ready = await probeReadiness(config.DATABASE_URL)
    report(
      ready,
      'schéma',
      ready
        ? 'odpovídá této verzi aplikace'
        : 'spusťte pnpm bootstrap nebo pnpm db:migrate',
    )
    if (ready) {
      const [admins] =
        await client`select count(*)::int as count from "user" where role = 'admin'`
      report(
        admins.count > 0,
        'správce',
        admins.count > 0
          ? 'existuje'
          : 'spusťte bootstrap s ADMIN_EMAIL/ADMIN_PASSWORD',
      )
      const providers = await client`select provider_id from sso_provider`
      const expected = ['true', '1', 'yes', 'on'].includes(
        config.SSO_BOOTSTRAP_ENABLED,
      )
      const configured = providers.some(
        (row) => row.provider_id === config.SSO_BOOTSTRAP_PROVIDER_ID,
      )
      report(
        (!expected || configured) &&
          (config.AUTH_MODE !== 'sso' || providers.length > 0),
        'SSO',
        `${providers.length} poskytovatelů; vzdálené přihlášení nebylo provedeno`,
      )
    }
    if (process.argv.includes('--check-api')) {
      if (!ready) report(false, 'ČÚZK API', 'nejprve připravte schéma')
      else {
        // Explicit probe uses the normal shared reservation; it can spend up to three attempts.
        try {
          const { refreshCuzkAccount } = await import('../src/lib/cuzk/http.ts')
          await refreshCuzkAccount()
          report(
            true,
            'ČÚZK API',
            'diagnostika účtu dokončena (může být použita platná cache)',
          )
        } catch {
          report(
            false,
            'ČÚZK API',
            'ověřte klíč, rozpočet a dostupnost služby v administraci',
          )
        }
      }
    }
  } catch {
    report(
      false,
      'databáze',
      'spojení nebo dotaz selhal; ověřte DATABASE_URL a práva',
    )
  } finally {
    await client.end({ timeout: 1 })
  }
} catch (error) {
  const { ConfigurationError } = await import('../src/env.ts')
  report(
    false,
    'konfigurace',
    error instanceof ConfigurationError ? error.message : 'diagnostika selhala',
  )
} finally {
  if (process.argv.includes('--check-api') && process.env.DATABASE_URL) {
    const { closeDb } = await import('../src/db/index.ts')
    await closeDb()
  }
  process.exitCode = failures ? 1 : 0
}
