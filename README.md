# Hlídač ČÚZK

[![CI](https://github.com/petrleocompel/hlidac-cuzk/actions/workflows/ci.yml/badge.svg)](https://github.com/petrleocompel/hlidac-cuzk/actions/workflows/ci.yml)
[![License: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](LICENSE)

Sledování parcel ČÚZK a notifikace změn (Gotify, Slack, Discord).

Full-stack TanStack Start app with Better Auth (email/password + optional OIDC SSO), Postgres, and Docker Compose.

## Stack

TanStack Start · pnpm · Tailwind 4 · shadcn/ui · Better Auth (+ SSO) · Postgres + Drizzle · Sentry (optional)

## Documentation

- **[Český návod pro vlastní server](docs/self-hosting.cs.md)** — loopback, LAN/TLS proxy, externí PostgreSQL, aktualizace a obnova

- **[Self-hosting guide](docs/self-hosting.md)** — Docker Compose, env vars, SSO/Authentik, upgrades, GHCR image
- Deploy overlays live under [`deploy/`](deploy/)

## Architecture

| Path | Purpose |
|------|---------|
| `src/routes/` | File routes |
| `src/server/` | `createServerFn` handlers |
| `src/db/` | Drizzle schema + migrations |
| `src/auth/` | Better Auth |
| `src/lib/cuzk/` | ČÚZK REST client |
| `src/cron/` | Parcel polling worker |
| `deploy/` | Docker Compose overlays |
| `docs/` | Operator documentation |

## Local development

```bash
corepack enable
pnpm install
pnpm env:init deploy/.env
# Fill PUBLIC_URL, APP_HOST, ADMIN_EMAIL and CUZK_API_KEY in deploy/.env.
# For local development use PUBLIC_URL=http://127.0.0.1:3000.
docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up -d db
cp deploy/.env .env
# In .env change DATABASE_URL host db to 127.0.0.1 (same generated password).
node --env-file=.env --import tsx scripts/bootstrap.ts
pnpm dev
```

Open http://127.0.0.1:3000

`pnpm db:seed-admin` creates/promotes the admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`. A demo watch (Vejprnice 1133/77) is created only when explicitly enabled with `SEED_DEMO_WATCH=1`; it spends ČÚZK API calls.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm typecheck` | TypeScript |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest |
| `pnpm test:integration` | PostgreSQL integration tests (disposable `TEST_DATABASE_URL`) |
| `pnpm cron --once poll-parcels` | One poll cycle |
| `pnpm cron --once deliver-notifications` | Deliver one batch of pending notifications |
| `pnpm db:generate` | Drizzle migration from schema |
| `pnpm bootstrap` | Validate config, migrate, create admin, bootstrap optional SSO |
| `pnpm run doctor` | Read-only configuration/DB/schema diagnostics |
| `pnpm env:init <file>` | Generate unique secrets into a new private env file |
| `pnpm db:migrate` | Apply migrations under the shared DB lock (no seed/SSO) |
| `pnpm db:seed-admin` | Bootstrap admin |

Notifications are stored durably in PostgreSQL with each detected event and delivered by the worker independently of parcel checks. Per-channel delivery status and manual retries are available in watch history. See [delivery behavior and deployment](docs/self-hosting.md#delivery-queue-and-retries).

### Integration tests

Use a disposable PostgreSQL database whose name starts with `hlidac_test_`; the test suite applies migrations and deletes its test data. It uses a local HTTP fixture for ČÚZK and notification providers, including a separate worker process to verify recovery. No real API key or notification destination is needed.

```bash
docker run --rm -d --name hlidac-integration-db \
  -e POSTGRES_PASSWORD=integration-test-only -e POSTGRES_DB=hlidac_test_local \
  -p 127.0.0.1:55432:5432 postgres:16-alpine
# Wait until this command reports that PostgreSQL accepts connections:
docker exec hlidac-integration-db pg_isready -U postgres
TEST_DATABASE_URL=postgres://postgres:integration-test-only@127.0.0.1:55432/hlidac_test_local pnpm test:integration
docker stop hlidac-integration-db
```

GitHub Actions runs this suite using a dedicated PostgreSQL service.

## CI & container image

| Workflow | Triggers | What it does |
|----------|----------|--------------|
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `main`, PRs | Lint · typecheck · unit, PostgreSQL integration and backup tests · `pnpm build` |
| [`.github/workflows/docker.yml`](.github/workflows/docker.yml) | `main`, PRs, called by `release.yml` | Runs CI, smoke-tests the `linux/amd64` + `linux/arm64` image and publishes it to GHCR (PRs build only) |
| [`.github/workflows/release.yml`](.github/workflows/release.yml) | `vX.Y.Z` tags | Checks the tag against `package.json`/`CHANGELOG.md`, publishes the release image and creates the [GitHub Release](https://github.com/petrleocompel/hlidac-cuzk/releases) |

The multiarch image is public at `ghcr.io/petrleocompel/hlidac-cuzk` and is built only by GitHub Actions:

- release tag `vX.Y.Z` publishes `X.Y.Z`, `X.Y`, `X` and `latest`;
- every push to `main` publishes `edge` and `sha-<7-character-commit>`.

```text
ghcr.io/petrleocompel/hlidac-cuzk:<version>
ghcr.io/petrleocompel/hlidac-cuzk@sha256:<digest>
```

Pin a release version, or better its digest, for deployment; never auto-deploy `latest` or `edge`. Published images carry SLSA build provenance and SBOM attestations:

```bash
gh attestation verify oci://ghcr.io/petrleocompel/hlidac-cuzk:X.Y.Z --owner petrleocompel
```

Pull and run with Compose as described in the [self-hosting guide](docs/self-hosting.md).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md); do not open public issues for them.

## License

[AGPL-3.0-only](LICENSE).
