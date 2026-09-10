# Hlídač ČÚZK

Sledování parcel ČÚZK a notifikace změn (Gotify, Slack, Discord).

Full-stack TanStack Start app with Better Auth (email/password + optional OIDC SSO), Postgres, and Docker Compose.

## Stack

TanStack Start · pnpm · Tailwind 4 · shadcn/ui · Better Auth (+ SSO) · Postgres + Drizzle · Sentry (optional)

## Documentation

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
cp .env.example .env   # fill BETTER_AUTH_SECRET, CUZK_API_KEY, ADMIN_*
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up -d db
pnpm db:migrate
pnpm db:seed-admin
pnpm dev
```

Open http://127.0.0.1:3000

`pnpm db:seed-admin` creates/promotes the admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME`. With `CUZK_API_KEY` set it can also seed a demo watch (Vejprnice 1133/77) unless `SEED_DEMO_WATCH=0`.

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm typecheck` | TypeScript |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest |
| `pnpm cron --once poll-parcels` | One poll cycle |
| `pnpm db:generate` | Drizzle migration from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed-admin` | Bootstrap admin |

## CI & container image

| Workflow | Triggers | What it does |
|----------|----------|--------------|
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | `main`, PRs | Lint · typecheck · test · `pnpm build` |
| [`.github/workflows/docker.yml`](.github/workflows/docker.yml) | `main`, `v*` tags, PRs | Docker image (push to GHCR except on PRs) |

Published tags:

```text
ghcr.io/<owner>/<repo>:latest
ghcr.io/<owner>/<repo>:<sha>
```

Pull and run with Compose as described in the [self-hosting guide](docs/self-hosting.md).
