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
| `cron` | Polls watched parcels every 5 minutes; delivers queued notifications every minute; checks the ČÚZK account every 6 hours |

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

Liveness: `GET /healthz`. Readiness (database and schema): `GET /readyz`. Compose uses readiness for its app health check.

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
| `CUZK_REQUEST_TIMEOUT_MS` | no | Per-attempt deadline, default `15000`, range 10–30000 ms |
| `CUZK_MIN_REQUEST_INTERVAL_MS` | no | Shared minimum spacing between request reservations, default `1000`, range 0–10000 ms |
| `MAX_WATCHES_PER_USER` | no | Maximum watches per user, including paused watches; default `100`, range 1–1000 |
| `METRICS_BEARER_TOKEN` | no | Random token of at least 32 characters for `/api/metrics`; empty/short token disables the endpoint |
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

The default is a **private instance** (`REGISTRATION_MODE=private`): public password signup is disabled at the auth endpoint and the user-creation hook. Existing users can still sign in at `/login`. **Admin → Přístup a pozvánky** lets an administrator create ordinary users or issue/revoke seven-day invitations.

| Variable | Default | Meaning |
|----------|---------|---------|
| `REGISTRATION_MODE` | `private` | `private`: admin-created accounts; `invite`: email plus invitation code; `open`: public password registration |
| `SSO_REGISTRATION_MODE` | `existing` | `existing`: existing linked identities only; `invite`: matching active invitation and verified provider email; `open`: allow new SSO users |
| `AUTH_MODE` | `hybrid` | Password plus SSO; `sso` disables password sign-in/signup endpoints |
| `AUTH_TRUST_PROXY_HEADERS` | `false` | Opt into `x-forwarded-for` only behind a controlled proxy |
| `AUTH_TRUSTED_PROXIES` | empty | Comma-separated exact proxy IPs/CIDRs for walking forwarded chains |

Apply migration `0007_registration_policy.sql` before the new app. All modes are checked on the server, including explicit SSO `requestSignUp` callbacks. Changing local registration does not implicitly change SSO provisioning; set both variables to express your policy. Existing sessions are preserved by a policy change. Passwords must contain at least 12 characters on the server as well as in the UI and seed command.

Invitation codes are random, email-bound and shown only once to the administrator. Only their SHA-256 hashes are saved. The recipient enters the code on `/signup`; it is sent in a header, not a URL. Revoked, expired or used invitations are rejected. SSO invite mode uses the identity provider's verified email as proof; it does not accept an unverified email claim. Providers are administrator-managed and their verified-email claims are trusted; implicit account linking remains disabled. A consumed invitation is not restored if account creation subsequently fails: the administrator can issue a replacement. No invitation email is sent automatically.

### SSO-only and local recovery

Before setting `AUTH_MODE=sso`, link and test an administrator's SSO identity. A private installation can always be bootstrapped from the local CLI; it creates a hashed credential directly and does not expose a public signup exception. To recover a password locally, supply `ADMIN_EMAIL` and a new `ADMIN_PASSWORD` through protected environment configuration, then run:

```bash
SEED_DEMO_WATCH=0 pnpm db:seed-admin --reset-password
```

For Compose use `docker compose ... run --rm -e SEED_DEMO_WATCH=0 app pnpm db:seed-admin --reset-password`. This explicit reset replaces/creates the credential and revokes that user's sessions. Set `AUTH_MODE=hybrid` and recreate the app to enable password login, repair SSO, then restore `AUTH_MODE=sso`. The normal seed command preserves an existing password. Neither command emails credentials.

### Auth rate limits behind a proxy

Auth rate limits use PostgreSQL (`auth_rate_limit`) across app processes: 100 requests/minute by default, 10 password sign-ins, 5 signups and 20 SSO starts per minute and client bucket. Existing Better Auth endpoint-specific limits also apply. Missing trusted IP information falls back to one shared bucket per path; it does not disable protection. Forwarded headers are ignored by default to prevent direct clients choosing their own bucket.

Enable `AUTH_TRUST_PROXY_HEADERS=true` only when the app origin is reachable exclusively through your trusted proxy, and make that proxy **replace** incoming `X-Forwarded-For` (for a single Nginx hop use `proxy_set_header X-Forwarded-For $remote_addr;`). For multiple hops set `AUTH_TRUSTED_PROXIES` to their actual addresses, not a whole client network. Header parsing alone cannot authenticate the network peer. The rate limiter follows the installed Better Auth implementation and the official [rate-limit guidance](https://better-auth.com/docs/concepts/rate-limit); the user-creation gate uses [database hooks](https://better-auth.com/docs/concepts/database#database-hooks).

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

## ČÚZK API budget and metrics

**Admin → ČÚZK API** (`/admin/cuzk`) shows today's reserved attempts, remaining budget, success/error/retry counts, average response time, pending attempts, a 30-day history and today's endpoint breakdown. It also estimates the minimum daily scheduled parcel calls; procedure details, searches, retries and diagnostics add to this estimate. Opening or refreshing this dashboard reads PostgreSQL only.

This installation enforces the owner's supplied limit of **500 attempts per calendar day in `Europe/Prague`**, resetting at local midnight (including daylight-saving changes). This is a local operational budget, not a claim that all ČÚZK customers have the same quota or reset period. Every HTTP attempt reserves one slot atomically in PostgreSQL before sending. Web requests, cron, CLI scripts, searches, procedure details, retries and account diagnostics share the same counter. All processes must use the same database, API key and configuration. A database failure prevents new requests.

Failed and interrupted attempts remain counted. A worker crash between reservation and sending/completion can leave a `pending` record; its cost is deliberately not refunded. Restarting a process or rotating the API key does not reset today's budget. Counters start when this version is installed and cannot reconstruct prior calls or calls made by other installations. Restoring an older database backup also restores older counters; keep API callers stopped until the next local day if that could undercount today's usage. Records contain normalized endpoint names (numeric IDs replaced with `:id`), timestamps, durations, status and attempt number, not API keys, query strings or response bodies. Request history is currently retained without automatic deletion (at most 500 rows/day, about 183,000/year); the dashboard reads the last 30 days.

Each request has at most three attempts, a configurable per-attempt timeout and an overall 60-second deadline. The existing 90-second parcel deadline includes all details. Transient network errors and HTTP 408/429/500/502/503/504 use bounded retries and exponential delay with jitter. `Retry-After` is respected; waits longer than five seconds are persisted as a shared pause for subsequent callers instead of keeping a worker asleep. HTTP 401/403 pauses calls for 15 minutes without immediate retries; other client errors are not retried. Global pauses/exhaustion stop the current polling batch; remaining watches can be considered on a later cycle. A quota error while loading details preserves the previous snapshot.

New watches (including the demo seed) default to **once a day** to leave room in the budget. Existing intervals are preserved. This is a budget choice, not a promised ČÚZK data-refresh frequency. A manual parcel refresh is limited to once every five minutes per watch, including unsuccessful checks. Watch creation enforces the per-user cap under a database lock. A proceeding shared by several watches is fetched once per polling batch. If the dashboard's minimum scheduled demand is close to 500, lengthen intervals or pause watches to leave room for details and other operations.

### Provider account diagnostics

The worker calls `/api/v1/AplikacniSluzby/StavUctu` every six hours. Admins can explicitly request a refresh; a shared 15-minute cooldown applies to both successful and unsuccessful diagnostics. Diagnostics and any retries consume the same daily budget and obey pauses. If using custom one-shot scheduling, also run `pnpm cron --once refresh-cuzk-account` every six hours.

The direct response contains `provedenoVolani`, `limitVolani`, `aktualniObdobi` and `expiraceApiKey` ([official OpenAPI](https://api-kn.cuzk.gov.cz/swagger/v1.0/swagger.json)). The UI shows this saved provider report separately from the local daily counter, with its check time and expiry warning seven days before expiry. The period string is displayed as provided; its reset semantics are not assumed. When a report was obtained today, the gate also checks the reported remaining quota minus subsequent local reservations. An expired known key blocks calls until rotation. Remote usage outside this installation is only visible as of the last diagnostic, so use a dedicated account/key if you need reliable accounting across all consumers.

### Prometheus export

Set `METRICS_BEARER_TOKEN` to a random value of at least 32 characters and restart the app. `GET /api/metrics` requires `Authorization: Bearer <token>`; an absent/invalid token returns 401, and an unconfigured/short configured token returns 404. Responses use `Cache-Control: no-store`. The endpoint reads saved data without calling ČÚZK.

Example scrape configuration (put the same token in a protected file accessible to Prometheus):

```yaml
scrape_configs:
  - job_name: hlidac-cuzk
    scheme: https
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/secrets/hlidac-token
    static_configs:
      - targets: ['hlidac.example.com']
```

Metrics include `hlidac_cuzk_daily_reserved`, `daily_remaining`, `daily_errors`, `daily_success`, `daily_pending`, `daily_retries`, `daily_average_duration_ms`, `minimum_daily_calls` and saved account usage/limit/expiry (all share the `hlidac_cuzk_` prefix). Daily metrics are **gauges**, not monotonic counters: they reset at Prague midnight. For an initial budget alert use `hlidac_cuzk_daily_remaining <= 100`; account freshness is available as `hlidac_cuzk_account_last_checked_timestamp_seconds` (zero means unknown). Provider metrics are omitted before the first successful diagnostic.

Migration `0005_cuzk_api_budget.sql` adds the accounting tables and manual cooldown. Apply it and replace **all** old app, cron and CLI processes before resuming requests; older versions bypass the new gate. This feature adds no required infrastructure beyond PostgreSQL.

---

## Worker health and data freshness

Migration `0006_worker_health.sql` separates `lastAttemptAt`, `lastSuccessfulCheckAt` and `nextCheckAt`. The legacy `lastCheckedAt` column remains for compatibility and means the last completed attempt, not successful data freshness. A failed check preserves the snapshot and its success time, records the error, and schedules another attempt in five minutes (or after a later API pause/quota reset). A successful check schedules the next configured interval. The API budget still limits every attempt. Changing an interval recalculates the schedule; resuming a paused watch makes it due immediately.

Backfill uses a saved snapshot's `fetchedAt` rather than a newer failed attempt. If that time cannot be recovered, it uses the legacy time only for a snapshot without a recorded error; otherwise success remains unknown. The UI displays attempt, success, age and next schedule separately. ČÚZK's `aktualnostDatK` remains the independent source-data timestamp. An enabled watch becomes stale after its polling interval plus ten minutes without successful data; paused watches are excluded from monitoring alerts.

**Admin → Stav workeru** (`/admin/monitoring`) shows the scheduler heartbeat, per-job start/completion/last successful run, aggregate result counts and errors, overdue checks and stale data. The long-running `pnpm cron` scheduler writes a heartbeat every 30 seconds; it is considered missing after two minutes. Poll and notification-delivery jobs must also have completed within ten minutes, so a live scheduler cannot hide stuck jobs. A completed job with item errors is not presented as a successful run. Recent quota errors can therefore degrade monitoring without affecting web readiness. If you previously used only external `--once` invocations, switch to the long-running scheduler for heartbeat monitoring; one-shot runs record job progress but do not claim a live scheduler.

The next heartbeat after a gap records the last observed outage and recovery, including across restarts. This is a compact latest-state record, not a full incident history. Its recovery means the scheduler resumed; watch freshness and job results are evaluated separately. No notifications are sent by the application for worker outages: use the independent monitor below, which can observe a completely stopped worker or web server.

| Endpoint | Purpose | Authentication / failure |
|----------|---------|--------------------------|
| `/healthz` | HTTP process liveness only | Public; does not claim checks are healthy |
| `/readyz` | Database connection, expected migration hash, required tables/columns | Public; 503 if unavailable/incompatible, bounded probe; does not apply migrations or call ČÚZK |
| `/api/monitoring` | Scheduler, completed jobs and watch freshness | Same `METRICS_BEARER_TOKEN` as metrics; 503 for degraded checks or unavailable DB |
| `/api/metrics` | Saved API and worker metrics | Same bearer token; 503 for unavailable DB/schema; worker failure remains a metric value |

The readiness probe has a 2.5-second deadline plus up to one second for connection cleanup. A ČÚZK outage or stopped worker does not make web readiness fail. Endpoints return `Cache-Control: no-store`; health responses do not include database connection details. The DB outage case must be monitored from outside this application.

### External outage and recovery alerts

Load [deploy/monitoring/alerts.yml](../deploy/monitoring/alerts.yml) with Prometheus `rule_files` and use the `hlidac-cuzk` scrape job from the metrics example. The supplied rules alert after five minutes of failed/missing scrapes or ten minutes of unhealthy checks. Run Prometheus and Alertmanager independently of this application, ideally on another host. Configure the notification receiver in your Alertmanager and explicitly enable recovery messages with `send_resolved: true`, for example on a `webhook_configs` receiver pointed at your own alert relay. No receiver credentials are stored in this repository and no live alert service is configured automatically.

When checks recover, the alert expression clears and Alertmanager can send the resolved notification. See the official [alert-rule semantics](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/) and [receiver configuration](https://prometheus.io/docs/alerting/latest/configuration/). To verify your deployment, stop cron, wait for the alert, start it again and confirm the resolved message; repeat with the app unreachable to verify the external scrape alert. Do this with your own test receiver.

New metrics: `hlidac_monitoring_healthy`, `hlidac_worker_heartbeat_healthy`, `hlidac_worker_progress_healthy`, `hlidac_worker_heartbeat_timestamp_seconds`, `hlidac_worker_recovered_timestamp_seconds`, `hlidac_watches_overdue` and `hlidac_watches_stale`. The admin page and probes do not consume any ČÚZK calls.

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

## Docker build context

The repository `.dockerignore` excludes local `.env` variants (including nested deploy files), private key files, dependency trees, generated output, logs and backup exports before they are sent to Docker. Public `.env.example` templates and Drizzle SQL migrations remain available to the build. Keep private material under the excluded paths; do not place secrets in arbitrary source files or Docker build arguments. Builds use package manifests and produce fresh application output inside the builder stage.

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
| App unhealthy | `docker compose ... logs app`; `/readyz`; `DATABASE_URL`; expected migrations applied |
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
- [ ] Choose local and SSO registration policies; defaults are private / existing identities only
- [ ] Prefer SSO + explicit linking; keep password for break-glass admin  
- [ ] Rotate IdP client secrets if leaked  

---

## License / support

See the repository root for license and issue tracker. For ČÚZK API access and rate limits, follow ČÚZK’s own documentation for your API key.
