import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const target = args[0]
if (!target || args.length !== 1) {
  console.error(
    'Použití: pnpm env:init <nový-env-soubor>. Existující soubor se nepřepisuje.',
  )
  process.exitCode = 1
} else {
  const password = randomBytes(32).toString('hex')
  const content = `# Generated instance secrets. Never commit this file; back it up securely.
POSTGRES_USER=hlidac
POSTGRES_PASSWORD=${password}
POSTGRES_DB=hlidac_cuzk
DATABASE_URL=postgres://hlidac:${password}@db:5432/hlidac_cuzk
BETTER_AUTH_SECRET=${randomBytes(48).toString('base64url')}
NOTIFICATION_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}
METRICS_BEARER_TOKEN=${randomBytes(32).toString('base64url')}
# Fill these before bootstrap:
APP_HOST=
PUBLIC_URL=
ADMIN_EMAIL=
ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}
ADMIN_NAME=Admin
CUZK_API_KEY=
REGISTRATION_MODE=private
SSO_REGISTRATION_MODE=existing
AUTH_MODE=hybrid
AUTH_TRUST_PROXY_HEADERS=false
SEED_DEMO_WATCH=0
SSO_BOOTSTRAP_ENABLED=false
GOTIFY_ALLOWED_URLS=
SENTRY_DSN=
`
  try {
    await writeFile(target, content, { flag: 'wx', mode: 0o600 })
    console.log(
      'Nový env soubor vytvořen s právy 0600. Doplňte veřejnou URL, e-mail správce a ČÚZK API klíč. Tajné hodnoty nebyly vypsány.',
    )
  } catch {
    console.error(
      'Soubor nebyl vytvořen: cílový soubor již existuje nebo adresář není zapisovatelný.',
    )
    process.exitCode = 1
  }
}
