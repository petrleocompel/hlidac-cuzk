# Release notes

## Unreleased — safe selfhosting upgrades

- Image publishing now requires successful lint, typecheck, tests and production build.
- `deploy/upgrade.sh` stops writers, creates a protected local PostgreSQL dump, runs one
  bootstrap and waits for web readiness before starting the worker. GitLab deploys are serialized.
- The administration monitoring page reports image version, full commit and schema state.
- Production requests and workers no longer run implicit migrations. Start with `pnpm bootstrap`.
- Readiness refuses a database with newer migration metadata than the running image.

### Migration from d63f2c9 (schema 0008)

The upgrade adds `0009_backup_status`. Existing accounts, watches, events and pending
notification deliveries are preserved. Back up the database and configuration/keys first;
use the pinned image and the [upgrade procedure](docs/self-hosting.md#upgrade). The regression
test upgrades the previous schema and checks both preserved data and rejected startup after
a migration failure. There is no promise of compatibility with arbitrary older images.

Earlier selfhosting changes require a persistent `NOTIFICATION_ENCRYPTION_KEY` and explicit
`pnpm notifications:encrypt` for old plaintext credentials. Registration defaults to private.
Scheduled off-site backups remain optional until their target and recovery credentials are
configured. An unreachable SSO provider on a redeploy produces a bootstrap warning; verify
SSO independently after deployment.
