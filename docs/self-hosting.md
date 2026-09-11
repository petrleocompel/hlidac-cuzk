# Self-hosting Hlídač ČÚZK

Hlídač ČÚZK watches Czech land-registry (ČÚZK) parcels and notifies you of changes via Gotify, Slack, and/or Discord.

This guide covers production-style Docker Compose deployment, configuration, SSO, upgrades, and using the published container image from GitHub Container Registry (GHCR).

## Requirements

| Requirement | Notes |
|-------------|--------|
| Docker Engine + Compose v2 | Recommended |
| PostgreSQL 16 | Bundled in Compose, or use your own |
| Public HTTPS URL | Required for auth cookies / SSO callbacks in production |
| ČÚZK API key | [api-kn.cuzk.gov.cz](https://api-kn.cuzk.gov.cz) access |

Hardware: a small VPS (1 vCPU, 1–2 GB RAM) is enough for personal / small-team use.

## Architecture

Compose runs four logical pieces (same image for app / migrate / cron):

| Service | Role |
|---------|------|
| `db` | PostgreSQL 16 |
| `migrate` | One-shot Drizzle migrations (+ optional SSO env bootstrap) |
| `app` | TanStack Start HTTP server on port 3000 |
| `cron` | Polls watched parcels every 5 minutes; delivers queued notifications every minute |

```text
Browser ──HTTPS──▶ reverse proxy (optional) ──▶ app:3000
                                              ├─ Better Auth (/api/auth/*)
                                              ├─ SSO link callback (/api/sso-link/callback)
                                              └─ /healthz
cron ──▶ ČÚZK API ──▶ Postgres ──▶ Gotify / Slack / Discord (per user)
```

## Quick start (Docker Compose)

### 1. Get the Compose files

Clone the repository (or copy the `deploy/` folder + `Dockerfile` if you build locally):

```bash
git clone https://github.com/<OWNER>/<REPO>.git hlidac-cuzk
cd hlidac-cuzk/deploy
cp .env.example .env
```

### 2. Configure `.env`

Edit `deploy/.env`. Minimum production values:

```bash
POSTGRES_USER=hlidac
POSTGRES_PASSWORD=generate-a-strong-password
POSTGRES_DB=hlidac_cuzk
DATABASE_URL=postgres://hlidac:generate-a-strong-password@db:5432/hlidac_cuzk

# ≥ 32 characters; used to sign sessions
BETTER_AUTH_SECRET=replace-with-32-char-minimum-secret-value-xxxxxxxxxxxx

# Public URL of this installation (no trailing slash)
APP_HOST=hlidac.example.com
PUBLIC_URL=https://hlidac.example.com

# First admin (optional but recommended on first boot)
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=at-least-12-characters
ADMIN_NAME=Admin

# Required — ČÚZK cadastral API
CUZK_API_KEY=your-cuzk-api-key
CUZK_API_BASE_URL=https://api-kn.cuzk.gov.cz
```

Generate secrets, for example:

```bash
openssl rand -base64 48   # BETTER_AUTH_SECRET / POSTGRES_PASSWORD
```

### 3. Pull or build the image

**From GHCR (recommended):**

```bash
export HLIDAC_CUZK_IMAGE=ghcr.io/<OWNER>/<REPO>:latest
docker pull "$HLIDAC_CUZK_IMAGE"
```

**Build locally:**

```bash
cd ..   # repo root
docker build -t hlidac-cuzk:local .
export HLIDAC_CUZK_IMAGE=hlidac-cuzk:local
```

### 4. Start the stack

From `deploy/`:

```bash
# Simple publish of app on host port 3000 (see docker-compose.selfhost.yml)
docker compose \
  -f docker-compose.yml \
  -f docker-compose.selfhost.yml \
  -p hlidac_cuzk \
  up -d
```

Migrations run automatically via the `migrate` service before `app` / `cron` start.

### 5. Create the admin user

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  run --rm app pnpm db:seed-admin
```

Uses `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` from the environment. Safe to re-run (promotes existing user to admin if needed).

### 6. Open the app

- Direct: `http://127.0.0.1:3000` (only if you used the selfhost overlay without TLS)
- Behind your reverse proxy: `https://hlidac.example.com`

Health check: `GET /healthz`

---

## Environment reference

### Core

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | Postgres connection string |
| `BETTER_AUTH_SECRET` | yes | Session signing secret (≥ 32 chars) |
| `BETTER_AUTH_URL` / `PUBLIC_URL` | yes | Public origin; Compose sets `BETTER_AUTH_URL` from `PUBLIC_URL` or `https://${APP_HOST}` |
| `APP_HOST` | yes* | Hostname used when `PUBLIC_URL` is omitted |
| `CUZK_API_KEY` | yes | ČÚZK API key |
| `CUZK_API_BASE_URL` | no | Default `https://api-kn.cuzk.gov.cz` |
| `POSTGRES_USER` / `PASSWORD` / `DB` | yes (bundled DB) | Postgres bootstrap |
| `ADMIN_EMAIL` | no | Used by `pnpm db:seed-admin` |
| `ADMIN_PASSWORD` | no | Min 12 chars for seed |
| `ADMIN_NAME` | no | Display name for seed |
| `SENTRY_DSN` | no | Error reporting |
| `SENTRY_ENVIRONMENT` | no | e.g. `production` |
| `GOTIFY_URL` / `GOTIFY_TOKEN` | no | Optional server defaults (users also configure notifications in-app) |
| `APP_HOST_PORT` | no | Host port for selfhost overlay (default `3000`) |
| `HLIDAC_CUZK_IMAGE` | no | Image tag (default `hlidac-cuzk:local`) |

### SSO bootstrap (optional, one-shot)

Runs after migrations when the app / migrate process calls `ensureDbReady`. **Never overwrites** an existing `providerId`.

| Variable | Description |
|----------|-------------|
| `SSO_BOOTSTRAP_ENABLED` | `true` / `1` / `yes` / `on` to enable |
| `SSO_BOOTSTRAP_PROVIDER_ID` | Stable id, e.g. `authentik` (letters, digits, `_`, `-`) |
| `SSO_BOOTSTRAP_ISSUER` | OIDC issuer URL (discovery at `{issuer}/.well-known/openid-configuration`) |
| `SSO_BOOTSTRAP_CLIENT_ID` | OAuth client id |
| `SSO_BOOTSTRAP_CLIENT_SECRET` | OAuth client secret |
| `SSO_BOOTSTRAP_DOMAIN` | Empty = **any** email domain; or comma-separated domains for **specific** |
| `SSO_BOOTSTRAP_LABEL` | Button label (default = provider id) |

Requires an admin user to already exist (run seed-admin first, then restart / re-run migrate so bootstrap can attach `userId`).

You can also manage IdPs later in **Admin → SSO** without bootstrap env vars.

---

## Reverse proxy / TLS

Production should terminate TLS in front of the app and forward to `app:3000` (or the published host port).

Set:

```bash
PUBLIC_URL=https://hlidac.example.com
APP_HOST=hlidac.example.com
```

`BETTER_AUTH_URL` must match the URL users open in the browser (scheme + host, no path).

Example Nginx snippet:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

The Peelco test overlay (`docker-compose.test.yml`) shows Traefik labels; adapt for your proxy.

---

## Authentication

### Email + password

Always available. Sign up at `/signup`, sign in at `/login`. Seeded admin uses email/password unless you only use SSO later.

### SSO / OIDC (Authentik, Keycloak, …)

Uses Better Auth’s `@better-auth/sso` plugin.

**Domain modes**

| Mode | Meaning |
|------|---------|
| `any` (default) | Any IdP user may sign in via the provider button (`providerId`). Stored domain sentinel `*`. |
| `specific` | Comma-separated email domains (e.g. `firma.cz,dcerka.cz`) |

Sign-in always uses `providerId` (not email-domain discovery), so `any` works without guessing domains.

**Account linking**

- Implicit linking on login is **disabled** (avoids account takeover).
- Users link/unlink SSO explicitly under **Účet** (`/dashboard/account`).
- Link flow requires the IdP email to match the logged-in account email.

**Redirect URIs to register in the IdP**

Replace `https://hlidac.example.com` and `authentik` with your values:

| Purpose | URL |
|---------|-----|
| Sign-in / sign-up | `https://hlidac.example.com/api/auth/sso/callback/authentik` |
| Explicit account link | `https://hlidac.example.com/api/sso-link/callback` |

**Admin UI**

Signed-in admins: **Admin → SSO** (`/admin/sso`) to create/update/delete providers, see callback URLs, and set domain mode.

**Trusted origins**

The app trusts the issuer origin of each registered (and bootstrap) IdP for OIDC discovery. The IdP must be reachable from the app container.

**Roles**

Application roles (`user` / `admin`) live in the app database. IdP group → role sync is not enabled by default.

---

## Notifications

Per-user settings in **Notifikace** (`/dashboard/settings`):

- Gotify URL + token (+ priority)
- Slack incoming webhook
- Discord webhook

Server-level `GOTIFY_*` in `.env` is optional; in-app settings are the primary path.

### Delivery queue and retries

Detected changes, their events and per-channel notification jobs are committed together in PostgreSQL. The worker delivers up to 50 jobs per run, once a minute, independently of parcel polling. Each event produces one message for each channel configured when the change is detected. History shows pending, sending, sent and failed deliveries; **Obnovit stav doručení** reloads these states without requesting new ČÚZK data.

Failed requests time out after 15 seconds and are retried after 1, 2, 4, 8, 16, 32 and 60 minutes (at the next available worker run). After eight unsuccessful attempts, delivery requires **Opakovat doručení** in the event history. This resets the attempt budget and queues the message; it does not send from the browser. Other channels continue even when one fails.

Retries use the owner's **current** channel settings, so fixing a token or webhook also fixes pending messages. Credentials are not copied into the queue. Removing a channel causes its existing jobs to report a configuration error; they are not marked as sent. Pausing a watch stops new parcel checks but does not cancel pending deliveries. Deleting the watch deletes its events and queued jobs.

A claimed job can be recovered two minutes after a worker crash. If a provider accepted a message but the worker crashed before recording success, a retry can deliver a duplicate. “Sent” means the HTTP provider accepted the request, not that a person read it.

The queue is introduced by migration `0003_notification_outbox.sql`. Apply migrations before starting the new app/worker, and recreate the Compose cron container so it uses the long-running scheduler. Existing event history is preserved; old events are not sent retroactively. A custom deployment previously invoking only `poll-parcels` must also schedule `deliver-notifications` every minute or use `pnpm cron`.

Run a single delivery batch:

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  run --rm app pnpm cron --once deliver-notifications
```

The database backup includes pending deliveries. Restoring an older backup can therefore redeliver messages accepted after that backup was taken; inspect the queue before starting the restored worker.

### Concurrent parcel checks

Migration `0004_parcel_poll_lease.sql` adds a two-minute PostgreSQL lease for each watch. Both scheduled checks and manual refresh must acquire it before calling ČÚZK. A busy manual refresh reports that a check is already running; cron skips the watch and rechecks its enabled state and polling interval when acquiring the lease. Separate watches keep their own state and notification history, even when they refer to the same parcel.

The lease uses database time. The full parcel request, including its procedure details, has a 90-second deadline. Errors release the lease and preserve the previous snapshot; a forcibly stopped process is recoverable once the lease expires, at the next poll or manual refresh. An expired or replaced worker cannot save a snapshot, event, notification job or error over the replacement worker's result. A request that times out while reading a procedure detail is not saved as a successful partial snapshot.

Apply migrations and replace **all** old app and cron processes before resuming checks: older versions do not honor the lease. No new environment variables or additional services are needed. A restored database can contain an unexpired lease; wait for expiry rather than manually clearing a running worker's lock.


---

## Day-to-day operations

### Logs

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk logs -f app cron
```

### One-off parcel poll

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  run --rm app pnpm cron --once poll-parcels
```

### Upgrade

```bash
export HLIDAC_CUZK_IMAGE=ghcr.io/<OWNER>/<REPO>:latest   # or a digest / semver tag
docker pull "$HLIDAC_CUZK_IMAGE"
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  up -d --remove-orphans
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  run --rm migrate
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  restart app cron
```

Migrations are additive (Drizzle). Always keep a Postgres backup before major upgrades.

### Backup Postgres

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql
```

### Restore

```bash
cat backup-YYYY-MM-DD.sql | docker compose ... exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```

### External Postgres

Point `DATABASE_URL` at your server and remove / don’t start the `db` service (or override Compose). Ensure the migrate / app / cron containers can reach it. SSL params go in the URL if required by your provider.

---

## Local development (non-Docker app)

```bash
corepack enable
pnpm install
cp .env.example .env   # fill secrets + CUZK_API_KEY
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up -d db
pnpm db:migrate
pnpm db:seed-admin
pnpm dev
```

App: http://127.0.0.1:3000

---

## Container image (GHCR)

GitHub Actions builds and publishes on pushes to `main` and on version tags:

| Tag | When |
|-----|------|
| `ghcr.io/<owner>/<repo>:latest` | Push to `main` |
| `ghcr.io/<owner>/<repo>:<sha>` | Every publish build |
| `ghcr.io/<owner>/<repo>:<semver>` | Git tag `v*` |

Pull (public package) or authenticate for private packages:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
docker pull ghcr.io/<OWNER>/<REPO>:latest
```

Workflow files:

| Workflow | Purpose |
|----------|---------|
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Lint, typecheck, Vitest, production `pnpm build` (on `main` + PRs) |
| [`.github/workflows/docker.yml`](../.github/workflows/docker.yml) | Docker image build; push to GHCR on `main` / `v*` (PRs build only) |

---

## Compose file map

| File | Purpose |
|------|---------|
| `deploy/docker-compose.yml` | Base: `db`, `migrate`, `app`, `cron` |
| `deploy/docker-compose.selfhost.yml` | Publish `app` on `${APP_HOST_PORT:-3000}` |
| `deploy/docker-compose.dev.yml` | Publish Postgres on loopback for local `pnpm dev` |
| `deploy/docker-compose.test.yml` | Peelco Traefik / fixed host port overlay |

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| App unhealthy | `docker compose ... logs app`; `/healthz`; `DATABASE_URL`; migrations finished |
| Auth / cookie issues | `PUBLIC_URL` / `BETTER_AUTH_URL` must match the browser origin exactly |
| SSO discovery fails | Issuer URL reachable from container; correct `SSO_BOOTSTRAP_ISSUER` / Admin issuer |
| SSO redirect error | IdP redirect URIs must include both callback paths above |
| `account not linked` | Expected for existing password users until they link under **Účet** |
| Bootstrap skipped | Need `SSO_BOOTSTRAP_ENABLED=true`, all client fields, **and** an existing admin user |
| Cron not notifying | User notification settings; `CUZK_API_KEY`; `logs cron` |
| Migrate fails | Postgres healthy; unique lock; read migrate container exit logs |

---

## Security checklist

- [ ] Strong unique `BETTER_AUTH_SECRET` and DB password  
- [ ] HTTPS in production  
- [ ] Do not commit real `deploy/.env` to public remotes  
- [ ] Restrict who can register if the instance is public (or disable open signup operationally)  
- [ ] Prefer SSO + explicit linking; keep password for break-glass admin  
- [ ] Rotate IdP client secrets if leaked  

---

## License / support

See the repository root for license and issue tracker. For ČÚZK API access and rate limits, follow ČÚZK’s own documentation for your API key.
