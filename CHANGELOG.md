# Release notes

## Unreleased — selfhosting and safe upgrades

- A řízení is now followed as its own object: state changes, new completed operations and
  payment state are reported for the same řízení id, and its history survives the plomba
  disappearing from the parcel. After a plomba is removed the detail is still queried for
  `CUZK_RIZENI_FOLLOW_DAYS` (default 14, at most ten follows per watch), so the actual
  result is reported instead of implying an approved vklad. A missing detail keeps the last
  known values; a 404 or empty payload ends the follow-up as confirmed unavailable.
- Users can add a known řízení (type, number, year, office code) or a linked
  `navazanaRizeni` and stop the extra queries at any time.
- AMD64 and ARM64 images must pass a real Compose installation smoke test before publishing.
- Web, worker and migrations run as UID 1000 with read-only storage; runtime dependencies
  are installed separately and pnpm is preloaded for startup without a registry connection.
- Loopback/LAN, Caddy TLS and standalone external PostgreSQL configurations are documented
  in Czech. Fonts are served locally; no DSN means no Sentry initialization.
- Image publishing now requires successful lint, typecheck, tests and production build.
- `deploy/upgrade.sh` stops writers, creates a protected local PostgreSQL dump, runs one
  bootstrap and waits for web readiness before starting the worker. GitLab deploys are serialized.
- The administration monitoring page reports image version, full commit and schema state.
- Production requests and workers no longer run implicit migrations. Start with `pnpm bootstrap`.
- Readiness refuses a database with newer migration metadata than the running image.

### Migration from d63f2c9 (schema 0008)

The upgrade adds `0009_backup_status` and `0010_watch_rizeni`. Existing accounts, watches, events and pending
notification deliveries are preserved. Back up the database and configuration/keys first;
use the pinned image and the [upgrade procedure](docs/self-hosting.md#upgrade). The regression
test upgrades the previous schema and checks both preserved data and rejected startup after
a migration failure. There is no promise of compatibility with arbitrary older images.

Earlier selfhosting changes require a persistent `NOTIFICATION_ENCRYPTION_KEY` and explicit
`pnpm notifications:encrypt` for old plaintext credentials. Registration defaults to private.
Scheduled off-site backups remain optional until their target and recovery credentials are
configured. An unreachable SSO provider on a redeploy produces a bootstrap warning; verify
SSO independently after deployment.
