#!/bin/sh
# Run from deploy/. Requires an existing local PostgreSQL stack and pinned image.
set -eu
# Compose resolves HLIDAC_CUZK_IMAGE from the exported environment or deploy/.env.
overlay=${1:?overlay filename required}
project=${2:?existing Compose project required}
case "$project" in *[!a-z0-9_-]*|'') echo 'Invalid project name' >&2; exit 2;; esac
compose() { docker compose -f docker-compose.yml -f "$overlay" -p "$project" "$@"; }
compose config --quiet
compose pull app cron migrate
# SIGTERM drains active work; durable leases/outbox recover after a forced stop.
compose stop -t 300 cron app
# Persistent, owner-only emergency copy on this Docker host. Not an off-site backup.
# The existing db service image supplies a matching pg_dump client.
compose run --rm --no-deps --volume "${project}_upgrade_backups:/upgrade-backups" --entrypoint sh db -ec '
  umask 077
  export PGHOST=db PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD" PGDATABASE="$POSTGRES_DB"
  path="/upgrade-backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).dump"
  pg_dump --format=custom --no-owner --no-acl --file="$path.partial"
  pg_restore --list "$path.partial" >/dev/null
  mv "$path.partial" "$path"
  echo "Pre-upgrade database copy verified."
'
# One bootstrap, with its exit status propagated. Failure leaves web/worker stopped.
compose up --no-deps --force-recreate --exit-code-from migrate migrate
compose up -d --no-deps --wait --wait-timeout 120 app
compose up -d --no-deps cron
