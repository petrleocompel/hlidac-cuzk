# Self-hosting Hlídač ČÚZK

[Český instalační návod: proxy, LAN a externí DB](self-hosting.cs.md).

Hlídač ČÚZK watches Czech land-registry (ČÚZK) parcels and notifies you of changes via Gotify, Slack, and/or Discord.

This guide covers production-style Docker Compose deployment, configuration, SSO, upgrades, and using the published container image from GitHub Container Registry (GHCR).

## Requirements

| Requirement | Notes |
|-------------|--------|
| Docker Engine + Compose v2 | Recommended |
| PostgreSQL 16 | Bundled in Compose, or use your own |
| HTTPS URL (public or trusted LAN certificate) | Required for reliable production auth cookies / SSO callbacks |
| ČÚZK API key | [api-kn.cuzk.gov.cz](https://api-kn.cuzk.gov.cz) access |

Hardware: a small VPS (1 vCPU, 1–2 GB RAM) is enough for personal / small-team use.

## Architecture

Compose runs four logical pieces (same image for app / migrate / cron):

| Service | Role |
|---------|------|
| `db` | PostgreSQL 16 |
| `migrate` | One-shot `pnpm bootstrap`: validate → migrate → admin → optional SSO |
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
git clone https://github.com/petrleocompel/hlidac-cuzk.git hlidac-cuzk
cd hlidac-cuzk/deploy
cp .env.example .env  # fill unique secrets; alternatively use env:init from the repo root
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

# First admin (required on a clean installation)
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

**From the project registry (authenticated access may be required):**

```bash
docker login ghcr.io
# Select a successful pipeline commit tag, then pin its digest for deployment.
export HLIDAC_CUZK_IMAGE=ghcr.io/petrleocompel/hlidac-cuzk:5d541204
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
# Loopback only: proxy on this host forwards to 127.0.0.1:3000.
# For containerized TLS, use docker-compose.proxy.yml instead of selfhost.
docker compose \
  -f docker-compose.yml \
  -f docker-compose.selfhost.yml \
  -p hlidac_cuzk \
  up -d
```

The `migrate` service runs the full bootstrap before app/cron start. A failed validation, migration or administrator seed prevents startup. Configured SSO discovery failure blocks only the first install; on an existing instance bootstrap logs a warning and continues so upgrades are not stuck behind IdP reachability.

### 5. Verify installation

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  run --rm --no-deps app pnpm run doctor
```

Bootstrap uses `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `ADMIN_NAME` on the first installation. Repeating it preserves existing passwords and providers. An existing admin permits subsequent bootstrap without seed credentials.

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
| `CUZK_RIZENI_FOLLOW_DAYS` | no | How long a řízení keeps being queried after it disappears from the parcel plomby; default `14`, range 0–365 days. `0` stops follow-up immediately |
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

Runs only as part of `pnpm bootstrap`, after migrations and administrator creation. `pnpm db:migrate` and runtime migration guards do not provision SSO. **Never overwrites** an existing `providerId`.

| Variable | Description |
|----------|-------------|
| `SSO_BOOTSTRAP_ENABLED` | `true` / `1` / `yes` / `on` to enable |
| `SSO_BOOTSTRAP_PROVIDER_ID` | Stable id, e.g. `authentik` (letters, digits, `_`, `-`) |
| `SSO_BOOTSTRAP_ISSUER` | OIDC issuer URL (discovery at `{issuer}/.well-known/openid-configuration`) |
| `SSO_BOOTSTRAP_CLIENT_ID` | OAuth client id |
| `SSO_BOOTSTRAP_CLIENT_SECRET` | OAuth client secret |
| `SSO_BOOTSTRAP_DOMAIN` | Empty = **any** email domain; or comma-separated domains for **specific** |
| `SSO_BOOTSTRAP_LABEL` | Button label (default = provider id) |

Bootstrap creates the administrator first. On a clean database, missing required SSO settings or failed discovery fails bootstrap; fix configuration and repeat the same command. When an administrator already exists, SSO discovery failures are skipped with a warning so redeploys can finish; register or repair the IdP from **Admin → SSO** if needed.

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

### Following a known řízení

A řízení is tracked as its own object in `watch_rizeni`, so its history survives the
plomba disappearing from the parcel. While a řízení is a plomba, its detail arrives with
the parcel request. Once it is no longer listed on the parcel, the worker keeps requesting
`/api/v1/Rizeni/{id}` for `CUZK_RIZENI_FOLLOW_DAYS` days (default 14) and reports state,
payment and new operations. Removing a plomba is never reported as an approved vklad.

* Each followed řízení costs **one extra API call per check** of that parcel. At most ten
  follows per watch are queried; the rest are marked as stopped by capacity.
* Users can add a known řízení (`/api/v1/Rizeni/Vyhledani` needs type, number, year and
  office code) or a linked `navazanaRizeni`, and stop the follow-up at any time.
* A 404 or an empty payload ends the follow-up as confirmed unavailable; a timeout or a
  network error keeps the last known values and retries on the next check.
* ČÚZK does not document how long a řízení detail stays available after the plomba is
  removed. Verify the default against your own řízení and adjust the variable; shortening
  it only reduces the extra calls, it never deletes history.

### Adding watches and bulk import

The form searches katastrální území by name without diacritics or by code, accepts the
parcel as one field (`1133/77`, `1133`, `st. 25`) and requires a ČÚZK confirmation before
saving. The stored KÚ code, name and parcel numbers always come from that verified answer,
so editing the form cannot decouple them. Demo values are prefilled only when
`SEED_DEMO_WATCH=1`.

Bulk import accepts CSV with the header `nazev,ku_kod,parcela,interval` (comma or semicolon,
optional quoting) or the same keys in JSON (`[...]` or `{"watches": [...]}`). The preview
validates every row locally and spends no ČÚZK call; the import then verifies one parcel per
row with a single search and leaves the first snapshot to the next scheduled check. Invalid
rows are reported with their line number and never discard the valid ones; rows already
watched or repeated inside the file are skipped. At most 200 rows per file.

One user can watch one object only once: `0012_watch_uniqueness` adds a unique index on
`(user_id, iskn_id)`. Pre-existing duplicates are reduced first — the row with the most
recorded events (then the oldest) supplies the surviving name and settings. All events and
their notification jobs are moved to it before removing the other subscriptions. Distinct
tracked procedures survive; overlapping procedure trackers keep the most recently fetched
state. Back up first and stop writers during this migration.

### Change history

Every change event stores the values before and after it and the snapshot it was derived
from, so the history stays readable after the watch snapshot is overwritten. BPEJ and
protections are compared in a normalized order, so reordering alone produces no event. A
list the API did not return is recorded as unknown instead of a removal.

The watch detail pages the history (25 events per page), filters by event kind and exports
CSV or JSON including the acquisition time and the reported ČÚZK actuality. Export covers
the newest 5000 matching events and states the watch creation time: there is no history
from before the watch existed. Snapshots grow with the number of changes; retention is
still open (NEXT-03).

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

Use an image from a successful pipeline, pin its immutable registry digest, and keep
its matching deployment files. Do not deploy `latest` automatically. GitLab publishes
only after lint, typecheck, tests and build; GitHub image publishing calls the same CI
workflow for the exact checkout before publishing. A green image build alone does not
prove that your deployment or SSO provider is healthy. See [release notes](../CHANGELOG.md).

Before the maintenance window, record the current image digest, copy the configuration
and encryption keys to your separate encrypted recovery storage, and verify a recent
restorable backup. Never print keys in a terminal transcript or attach them to a job.
When off-site backup is configured, run the database and configuration backup commands
from the backup section. The local safety copy below cannot survive loss of this server.

For an **existing stack with the bundled PostgreSQL database**, from `deploy/`:

```bash
# Set the full registry reference with @sha256:<verified digest> from the successful build.
export HLIDAC_CUZK_IMAGE='your-registry/hlidac-cuzk@sha256:your-verified-digest'
sh upgrade.sh docker-compose.selfhost.yml hlidac_cuzk
```

Use the **existing** Compose project name. Persist the selected image reference for
subsequent Compose commands. `upgrade.sh` validates Compose and pulls the application
before stopping services. It sends SIGTERM and allows five minutes for active worker
jobs to finish, then stops web writes. Expired leases and pending outbox rows recover
after a forced stop; a provider that accepted a message immediately before termination
may still receive a duplicate on retry.

The script creates a custom-format `pg_dump` in Docker volume
`<project>_upgrade_backups`, with owner-only file permissions, and verifies its archive
index before migration. This is an **unencrypted local emergency copy** on the Docker
host, containing accounts and application data. Limit Docker/admin access, use disk
encryption as appropriate, and remove old copies only after validating an independent
backup and the upgrade. It is not exported as a CI artifact and has no automatic deletion.
The archive-index check detects a failed dump; it does not replace a restore rehearsal.
Configuration/keys must be backed up separately. Monitor this volume's disk usage.

Bootstrap runs exactly once in a recreated migration service. Any dump or bootstrap
failure stops the script and leaves web/worker stopped. After migration, the web starts
and must pass `/readyz` within 120 seconds before the worker starts. Runtime HTTP/auth
and cron paths validate the schema without applying migrations in production. Readiness
also rejects a database newer than the image. GitLab uses the same script and serializes
deployments with `resource_group`.

After deployment, check login, **Admin → Stav kontrol a workeru → Verze instance**,
worker progress, SSO if configured, and notification delivery. That page shows image
version/commit and schema readiness. SSO bootstrap on an existing instance may warn and
continue when the IdP is unreachable; `pnpm run doctor` and an actual SSO login remain
necessary to verify it. No external API probe is required for the upgrade.

This script does not upgrade the PostgreSQL major version, support first installation,
or back up an external database. For those scenarios arrange the database-specific backup
and migration procedure first. Never change the PostgreSQL image major version against
an existing data volume as an application upgrade.

**Rollback:** switching to an older image is safe only if that version explicitly
supports the current schema. Migrations are not guaranteed to be additive or reversible.
If the schema changed incompatibly, keep web and worker stopped, restore the pre-upgrade
database into a new empty database using the backup/restore procedure, restore the matching
configuration/keys, and start the old pinned image against that restored database. Do not
run old code against the upgraded database or delete the only copy of either database.
Restoring a snapshot loses later writes and may replay notifications already delivered.
Rehearse on a disposable database before the production maintenance window.

### Backup Postgres

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -p hlidac_cuzk \
  exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup-$(date +%F).sql
```

### Restore

```bash
cat backup-YYYY-MM-DD.sql | docker compose ... exec -T db sh -c 'psql -v ON_ERROR_STOP=1 --single-transaction -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

### External Postgres

Point `DATABASE_URL` at your server and remove / don’t start the `db` service (or override Compose). Ensure the migrate / app / cron containers can reach it. SSL params go in the URL if required by your provider.

---

## Local development (non-Docker app)

```bash
corepack enable
pnpm install
cp .env.example .env  # fill unique secrets; alternatively use env:init from the repo root   # fill secrets + CUZK_API_KEY
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up -d db
pnpm bootstrap
pnpm dev
```

App: http://127.0.0.1:3000

---

## Docker build context

The repository `.dockerignore` excludes local `.env` variants (including nested deploy files), private key files, dependency trees, generated output, logs and backup exports before they are sent to Docker. Public `.env.example` templates and Drizzle SQL migrations remain available to the build. Keep private material under the excluded paths; do not place secrets in arbitrary source files or Docker build arguments. Builds use package manifests and produce fresh application output inside the builder stage.

## Container registry

The active GitLab registry is `ghcr.io/petrleocompel/hlidac-cuzk`.
[Select a successful pipeline](https://github.com/petrleocompel/hlidac-cuzk/actions)
and its eight-character commit tag, then pin the resolved digest. Authenticate with
`docker login ghcr.io`; access depends on project permissions.
The [registry page](https://github.com/petrleocompel/hlidac-cuzk/pkgs/container/hlidac-cuzk)
lists published tags. The mutable `latest` tag is not an upgrade policy.

GitHub mirrors can publish into their own `ghcr.io/owner/repository` namespace on `main`
and `v*` tags, after the reusable CI checks pass. This does not imply a public GHCR
package exists for this private GitLab repository.

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

### Notification destinations and encrypted credentials

**Upgrade requirement (HOST-03):** configure `NOTIFICATION_ENCRYPTION_KEY` for both app and cron, then run the credential migration before resuming delivery. Without the key or with legacy plaintext credentials, delivery fails closed; existing accounts, watches and their history remain available. Failed deliveries can be retried from their event after configuration is repaired. GitLab deployments accept the same named CI/CD variable (masked, environment scope `test`); the application does not generate or derive this key from the authentication secret.

Generate a separate 32-byte key with `openssl rand -base64 32` and put the result in the instance's private env file or secret manager. Do not commit it. New Gotify tokens and complete Slack/Discord webhook URLs use AES-256-GCM with a random nonce and authenticated owner/field identity. User settings and admin user details return configured flags, never the saved token/webhook URL. In the form, choose **Ponechat / Nahradit / Odebrat**; replacement fields start empty and are cleared after saving. Tests send using the saved settings. Changing the Gotify server requires replacing or removing its token.

**Admin → Pravidla notifikací** controls Gotify, Slack and Discord independently for the whole instance. Disabled channels are excluded from queue claims without spending retries, and resume after enabling. A request already started cannot be recalled; the transport checks the current policy again before starting each request. Removing a user's channel is different: its outstanding jobs report a missing configuration.

The Gotify whitelist follows the explicitly selected instance policy:

- Empty list: **all HTTP/HTTPS Gotify destinations are allowed, including LAN and loopback**. Authenticated users can therefore send Gotify requests into networks reachable by the server; use a whitelist when this is not desired.
- Nonempty list: only exact normalized base URLs, including port and optional path prefix. For example, `http://gotify:80` and `https://notify.example.test/gotify` permit their `/message` endpoints. No wildcard or implicit subdomain matching.
- `GOTIFY_ALLOWED_URLS` provides comma-separated initial values. Once an administrator saves the DB policy, the saved list takes precedence, including an explicitly empty list. App and worker read the same DB policy; no restart is required for admin changes.

Slack accepts HTTPS incoming webhooks on `hooks.slack.com` and `hooks.slack-gov.com`, with `/services/T…/B…/…` paths. Discord accepts HTTPS webhooks on `discord.com` and legacy `discordapp.com`, with `/api[/vN]/webhooks/{id}/{token}` paths. Userinfo, query strings, fragments, encoded path separators and nonstandard ports are rejected for these public providers. Slack URLs are not implicitly converted to Discord. See the official [Slack webhook documentation](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/) and [Discord webhook resource](https://docs.discord.com/developers/resources/webhook).

All channels reject redirects and limit DNS plus HTTP work to 15 seconds. DNS is resolved once and the socket uses that exact address with the original hostname for HTTPS certificate verification; public providers additionally reject private/reserved DNS answers. Gotify intentionally permits private addresses according to the policy above. Transport errors expose a status or generic explanation, never response bodies or secret URLs. No notification proxy environment variables are used.

For initial conversion of existing credentials, first back up the database and current configuration, stop **all** app/cron replicas, deploy/migrate the new schema, and run using the new image and its configured key (example from the `deploy` directory):

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml stop app cron
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml run --rm migrate
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml run --rm --no-deps app pnpm notifications:encrypt
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml up -d app cron
```

The CLI reports only a count. Already encrypted values are authenticated and encrypted again, so repeating the command is safe. Any invalid key/ciphertext rolls back the entire transaction. Legacy URLs outside the destination policy may be encrypted but remain blocked at delivery; correct them in settings or update the administrator's whitelist.

For rotation, stop app/cron replicas, preserve the old key as `NOTIFICATION_PREVIOUS_ENCRYPTION_KEY`, set a fresh `NOTIFICATION_ENCRYPTION_KEY`, and run `pnpm notifications:encrypt` with both keys. After success, remove the previous key from runtime configuration and restart all replicas. A wrong old key must be corrected before retrying. Keep old keys securely for as long as backups encrypted with them exist. Back up keys **separately from the database**, with restricted access; losing the appropriate key requires entering replacement notification credentials. Historical plaintext backups still contain plaintext credentials and need their own retention/access policy. Restoring the DB alone does not restore the ability to decrypt notifications.

### Repeatable bootstrap and configuration diagnostics

For a new instance, use `pnpm env:init deploy/.env` from the repository root. It refuses to overwrite an existing file, generates independent DB/auth/notification/metrics/admin secrets, sets mode `0600`, and never prints their values. Fill `PUBLIC_URL` (HTTP/HTTPS origin without a path), `APP_HOST`, `ADMIN_EMAIL` and `CUZK_API_KEY`; `DATABASE_URL` initially targets the bundled Compose `db` host. For local Node development change that host to your published PostgreSQL address and load the env into the process. Example files are templates, not usable production secrets. Compose requires `POSTGRES_PASSWORD`; it has no production default.

The single installation command is `pnpm bootstrap`. It validates central config (`src/env.ts`), serializes bootstrap in PostgreSQL, applies migrations through the same advisory lock as runtime guards, creates/promotes the configured administrator, and finally provisions optional SSO. Repeating the command preserves passwords and existing SSO provider configuration. `pnpm db:migrate` intentionally only migrates; `pnpm db:seed-admin --reset-password` remains the separate local recovery procedure. Demo creation is **opt-in** with `SEED_DEMO_WATCH=1` for both seed and bootstrap.

`pnpm run doctor` exits nonzero for invalid configuration, inaccessible DB, missing/mismatched schema, missing administrator or an expected SSO provider. Output includes only configuration names/status, never secret values or database URLs. A configured API key is reported as configured, not as remotely verified. Normal doctor does not contact ČÚZK or the IdP. Explicit `pnpm run doctor --check-api` refreshes the account through the normal shared API budget/cache and can spend up to three attempts; it never bypasses the 500/day accounting.

`pnpm start` and the Docker entrypoint validate configuration and current DB schema before starting HTTP. The worker also validates config before scheduling. `PUBLIC_URL` is accepted as the public-origin fallback and copied to `BETTER_AUTH_URL` for auth consumers. Auth policies and ČÚZK limits share their schema definitions with central validation. Optional empty env values are treated as absent; enabling SSO bootstrap requires all provider credentials, and trusted forwarding headers require an explicit proxy list. Missing notification encryption is allowed for instances without notifications and is reported by doctor; a supplied invalid key fails validation.

Deployment scripts must keep runtime configuration consistent between app, cron and bootstrap. The GitLab generated env now includes registration/proxy policy, API limits, monitor token and notification encryption configuration. After changing env, recreate the affected containers so they receive it. Build does not require runtime credentials; startup does. Running `.output/server/index.mjs` directly bypasses this startup validation and is not the supported selfhosting entrypoint.

### Scheduled encrypted backups and verified restore

The optional backup image adds PostgreSQL 16 client tools and restic. Default planning targets are **RPO 24 hours** (daily at 02:00 UTC, avoiding daylight-saving skips) and **RTO 2 hours** for a small instance. These are operator goals, not a guarantee: measure a restore with your actual database size, network and off-host storage. Admin → Stav workeru shows separate database/configuration backup timestamps and flags successful backups older than 26 hours. A failure keeps the previous success time. Successful backup age uses the start of the captured backup, not the end of its upload. Missing backup records mean no recorded success, not proof that another backup system is absent.

Restic supports S3-compatible, SFTP and REST repositories. Configure an **off-host** destination; a directory on the same host is useful for a test but does not protect against loss of the host. Database snapshots and configuration/encryption keys use **two separate repositories and different passwords**. Keep both restic passwords and storage access credentials in a separate secret manager or offline recovery record. They must remain accessible after losing the server and must not be archived only inside the repository they unlock.

From `deploy`, copy `.backup.env.example` to `.backup.env` (`chmod 600 .backup.env`), fill both repository locations and independent passwords (`openssl rand -base64 32` twice), and set provider credentials as needed. The Compose overlay mounts the application `.env` and base Compose file read-only under `/instance-config`; mount additional proxy/SSO/custom overlay files there if required for your instance. **Do not mount `.backup.env` inside the configuration backup source.** SSH/SFTP additionally needs your read-only private key and verified `known_hosts` mounted into the backup container; S3 uses the example AWS variables. Native restic connection options remain available through this private env file.

Build the application image first, then the optional backup image and explicitly initialize each new repository:

```bash
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -f docker-compose.backup.yml --profile backup build backup
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -f docker-compose.backup.yml --profile backup run --rm --no-deps backup pnpm backup init database
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -f docker-compose.backup.yml --profile backup run --rm --no-deps backup pnpm backup init config
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -f docker-compose.backup.yml --profile backup run --rm --no-deps backup pnpm backup once
docker compose -f docker-compose.yml -f docker-compose.selfhost.yml -f docker-compose.backup.yml --profile backup up -d backup
```

For a local default image, build with `docker build -t hlidac-cuzk:local .` from the repository root first. When using a published application image, set `HLIDAC_CUZK_IMAGE` to that same image/version before building the backup image. Normal app deployment does not enable backup scheduling. Repository init is never inferred from a failed password/network check. If the database repository was already initialized, run only `init config` for the second repository.

The scheduled command uses `pg_dump --format=custom --no-owner --no-acl` through restic's `--stdin-from-command`. No plaintext database dump is staged on disk during backup. Restic cancels snapshot creation if the dump exits unsuccessfully. A complete upload is followed by retention, scoped to `BACKUP_INSTANCE` and the database/config tag: seven daily, four weekly and six monthly snapshots by default. Configure the three `BACKUP_KEEP_*` values to change this policy. Concurrent runs share a PostgreSQL lock; skipped runs do not claim success. A failed upload or retention is reported as failed even if an upload snapshot was created. See the official [command-input backup behavior](https://restic.readthedocs.io/en/stable/040_backup.html#reading-data-from-a-command) and [retention rules](https://restic.readthedocs.io/en/stable/060_forget.html).

Restore procedure:

1. Provision an empty PostgreSQL 16 database and stop **all app, cron and backup replicas** that might access the target. Restore to a new instance/database first. Keep outgoing notification and ČÚZK traffic disabled until verification.
2. Recover the restic repository credentials separately. Restore the configuration repository to a protected directory using native `restic restore <snapshot-id> --target <directory>` with that repository/password; inspect it and recover `BETTER_AUTH_SECRET`, notification key (and any previous rotation key), SSO configuration and deployment settings. Do not overwrite the live env automatically.
3. In the private backup environment set `RESTORE_DATABASE_URL` to the new empty database, using its own credentials. Keep `DATABASE_URL` syntactically valid for the source configuration; the restore operation connects only to the explicit restore target. List database snapshots with native restic using the **database** repository/password and select an exact ID. Do not use an ambiguous `latest` selector across instances.
4. Run `pnpm backup restore <snapshot-id>` inside the backup image with the recovery env. The command refuses any target containing user relations/routines. It downloads and authenticates the dump into a temporary directory (`0700`, dump `0600`), restores with `pg_restore --single-transaction --exit-on-error --no-owner --no-acl`, then removes the temporary dump. No `--clean`, database dropping or worker startup is performed. A failed restore rolls back its database changes. See [PostgreSQL restore options](https://www.postgresql.org/docs/16/app-pgrestore.html) and [restic restore](https://restic.readthedocs.io/en/stable/050_restore.html).
5. Point a stopped application at the restored DB with the recovered keys and run `pnpm run doctor` using the matching application version. Inspect account login, SSO configuration, watches, history and pending deliveries. Restored backup status describes the source snapshot time and may show an unfinished backup; it is not a new backup success.
6. Only after inspection, enable the web and worker and then the backup scheduler. Pending messages remain pending; already acknowledged messages stay acknowledged. As with any restore to an earlier point, messages sent after the backup may be delivered again. Record the actual recovery duration and the timestamp of recovered data, then create a fresh backup.

Tested with a disposable PostgreSQL 16 database and real restic repositories by `pnpm test:backup` (requires `pg_dump`, `pg_restore` and `restic` in PATH plus `TEST_DATABASE_URL` pointing to a disposable `hlidac_test_*` database). The test restores accounts/password verification, SSO, watches, history, encrypted notification settings and pending delivery, verifies configuration recovery separately, rejects a second restore to the occupied target, checks repository integrity, and verifies that a failed dump creates no snapshot. These tests do not configure or contact a production backup destination. Run periodic real recovery drills; upload success alone does not establish recoverability.

## Local assets and optional telemetry

The UI serves IBM Plex Sans Variable from the application's own built assets, including
Latin Extended for Czech text. No Google Fonts stylesheet or external font/CDN request is
needed. Fontsource package version is pinned by the lockfile; the redistributed SIL OFL
license is available at `/licenses/ibm-plex-sans-OFL.txt`. Fallback system fonts remain
available while `font-display: swap` loads the local font.

With `SENTRY_DSN` absent or blank, the instrumentation entry does not import or initialize
Sentry and sends no Sentry telemetry. There is no browser analytics SDK initialization.
Setting a DSN explicitly enables server error reporting and production tracing (10%);
`sendDefaultPii` is false and the existing filter removes request bodies/cookies/auth headers.
Review what you send before enabling a third-party destination. Disabling Sentry does not
disable local application or proxy logs.

Normal browser UI assets require only this application's origin. Following a cadastral
link navigates to the external ČÚZK site; SSO redirects to the configured identity provider.
The server still needs PostgreSQL and the selected ČÚZK, notification, identity and backup
services. Future map layers must document their own external requests. Dependency/package
downloads during builds and TLS certificate renewal are separate from runtime UI assets.
See the [network dependency table](self-hosting.cs.md#síťové-závislosti).

## ARM64, runtime permissions and container storage

Release workflows build and smoke-test the application for `linux/amd64` and
`linux/arm64` before publishing the multiarch manifest. Docker selects the platform for
your host; inspect a published reference with `docker buildx imagetools inspect IMAGE`.
Building uses the native builder for architecture-independent JS/assets and installs
runtime dependencies for the target platform. QEMU is used for cross-architecture CI
smoke tests; native hardware testing remains useful for performance. See
[Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/).

App, migration and worker containers run as `node` (UID/GID 1000), with an init process,
read-only root filesystem, all Linux capabilities dropped and `no-new-privileges`.
Only `/tmp` is writable (64 MiB tmpfs, noexec/nosuid/nodev). The pinned pnpm is preloaded
in the image and starts without contacting a package registry. Do not mount a writable
source tree or Docker socket into these services. Development/test dependencies are
excluded from the runtime install; `tsx` remains a production dependency for CLI entrypoints.
Some framework dependencies retain transitive build-related packages; this is not a
distroless image.

The optional backup image is an administrative exception: it runs as root to read private
configuration bind mounts (which may be mode 0600 and owned by different host users). It
uses read-only mounts/rootfs, no-new-privileges and a separate 512 MiB `/tmp` tmpfs for
restic cache and restore staging. Increase this tmpfs limit in your override when restoring
a larger dump, or provide a private scratch volume and securely remove residual plaintext
after an interrupted restore. Keep backup credentials separate from the web service.
PostgreSQL and Caddy retain their upstream image identities and required writable volumes.

Compose rotates each service's Docker JSON logs at 10 MiB with three retained files.
Application worker shutdown stops scheduling and waits for active jobs; Compose allows
five minutes before SIGKILL. A forced stop recovers through the existing database leases
and notification outbox. Delivery can still be duplicated if the provider accepted it
before the worker recorded success.

To run the opt-in disposable Compose checks locally:

```bash
python3 tests/compose/smoke.py YOUR_LOCAL_IMAGE
# Or just the app/worker/migration runtime check:
python3 tests/compose/smoke.py YOUR_LOCAL_IMAGE loopback
```

Tests create and remove only their randomly named `hlidac_test_compose_*` stacks, verify
UID/read-only storage, bootstrap, readiness, login page, no ČÚZK calls and a graceful
worker stop/restart. In Docker-in-Docker CI, `COMPOSE_SMOKE_IN_CONTAINER=1` probes HTTP
inside the app because published ports belong to the daemon service, not the job container.


### Notification rules, digests, SMTP and ntfy

Migration `0013_notification_rules` adds optional delivery rules without backfilling old
messages. Stop the old web and workers, run bootstrap, then start the matching version.
Existing subscriptions continue to send immediately to their personal configured channels.

In a watch detail, choose event kinds and channels. “All” takes precedence over individual
checkboxes; no selection with “All” off disables delivery for that watch. Filtering never
removes events from history and affects newly captured changes, not messages already queued.
In **Notifikace**, set an IANA timezone (default `Europe/Prague`), optional quiet hours,
and daily/weekly digest hour and weekday. Quiet hours may wrap over midnight. Calendar
scheduling respects daylight-saving transitions; nonexistent spring times move forward,
repeated autumn times use the later occurrence. Selected urgent event kinds bypass both
quiet hours and digests; by default these are plomba changes and LV changes.

A separate `deliver-digests` job runs every five minutes. It sends batches of up to five
changes per owner/channel, shortened further to fit transport limits, with an exact-event
link for each included change. Further batches remain queued for later runs. A batch is
acknowledged only after the provider accepts it. Failed batches retain their events and
retry with the existing eight-attempt ceiling per event; crashed claims recover as digests.
Quiet hours are checked again before ordinary retries and digests. Manual retry of a failed
digest retains digest delivery. Changing a digest schedule does not move already queued
slots; current quiet hours still apply. If a provider accepts a message just before a worker
crash, duplicate delivery remains possible. The linked event opens even beyond the first
history page and is accessible only to the watch owner.

SMTP is configured by the administrator using both `SMTP_URL` and `SMTP_FROM`; users supply
one recipient address. For example, use `smtps://user:URL_ENCODED_PASSWORD@smtp.example.cz:465`
and `hlidac@example.cz`. For mandatory STARTTLS use `smtp://...:587?requireTLS=true`.
Keep credentials in the private deployment `.env`; SMTP failure messages omit connection
and authentication details. Each send has a 15-second absolute deadline as well as socket
timeouts. Without both settings e-mail delivery is unavailable. No SMTP service is installed
or enabled automatically.

For ntfy, users enter a topic URL and optionally an access token. Tokens use the same
owner-bound encryption and rotation procedure as other notification credentials. With an
empty ntfy allow-list, HTTPS topics are allowed. To permit internal HTTP, configure a base
URL under **Admin → Notifikace**; it allows that base and descendant topic paths, not similarly
named hosts or sibling paths. `NTFY_ALLOWED_URLS` seeds policy only until a policy is stored
by an administrator. Titles with Czech characters use RFC 2047 encoding supported by
[ntfy publishing](https://docs.ntfy.sh/publish/#message-title). Topics can expose messages to
other subscribers; use a private authenticated topic when the watch data is private.

Administrators can independently disable all five channels; queued work then waits without
using attempts. Existing Gotify behavior is unchanged: an empty allow-list permits any
HTTP/HTTPS base including LAN, and a nonempty list requires an exact base URL.
`GOTIFY_URL` plus `GOTIFY_TOKEN` now provide an instance destination only when the user
explicitly checks “Použít společné Gotify správce, pokud nemám vlastní nastavení” and has no personal URL or token.
A complete personal configuration wins; incomplete personal credentials never combine
with instance credentials. Shared-instance messages may be visible to the administrator
and other subscribers. Use the saved-settings test button only when you want to send a
real test message; automated tests use isolated local HTTP/SMTP servers.


### Watching neighboring parcels

Open a parcel detail and select **Vybrat sousední parcely**. Discovery uses one accounted
ČÚZK request; confirmation uses another to validate the current neighbors. Automatic retries
also consume the shared 500-attempt daily quota. The API returns basic definitions, not
geometry or full snapshots. A missing result can reflect missing digital-map coverage;
the UI does not interpret it as proof that no neighbors exist.

The preview shows at most 100 usable neighbors. Select at most 20 per batch; existing
subscriptions are marked and skipped. The UI shows remaining account capacity and at least
one additional parcel request per new daily watch, excluding procedure details and retries.
Confirmation copies identification from the fresh API answer and applies the whole batch
in one transaction; stale selections or capacity failures leave no partial batch. First
snapshots are loaded by the worker. No recursive neighbor discovery runs in the background.
PZE and incomplete definitions cannot be added through this flow. No migration is required.

Contract checked against the [official OpenAPI](https://api-kn.cuzk.gov.cz/swagger/v1.0/swagger.json)
on 13 September 2026; integration tests use a local fixture and never query live parcels.
