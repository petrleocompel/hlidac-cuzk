# Hlídač ČÚZK

Sledování parcel ČÚZK a notifikace změn (Gotify + Slack webhook).

Full-stack TanStack Start app (Peelco).

## Stack

TanStack Start · pnpm · Tailwind 4 · ShadCN · Better Auth · Postgres + Drizzle · GitLab CI · Sentry stub

## Architecture

| Path | Purpose |
|------|---------|
| `src/routes/` | File routes |
| `src/server/` | createServerFn handlers |
| `src/db/` | Drizzle schema + migrations |
| `src/auth/` | Better Auth |
| `src/lib/cuzk/` | ČÚZK REST client |
| `src/cron/` | Parcel polling worker |
| `deploy/` | Docker compose overlays |

## Local development

```bash
corepack enable
pnpm install
# .env already present with local secrets
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.dev.yml up -d db
pnpm db:migrate
pnpm db:seed-admin
pnpm dev
```

Open http://127.0.0.1:3000

## Commands

| Command | Purpose |
|---------|---------|
| `pnpm typecheck` | TypeScript |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest smoke |
| `pnpm cron --once poll-parcels` | One poll cycle |
| `pnpm db:generate` | Drizzle migration from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed-admin` | Bootstrap admin |

## Deploy

Image: `ghcr.io/petrleocompel/hlidac-cuzk`

