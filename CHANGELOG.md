# Release notes

## Unreleased — selfhosting and safe upgrades

- New **Přehled podle LV** groups the objects a user already watches by katastrální území and
  LV number with the latest ten events per group. It queries no ČÚZK data, says plainly that
  it is not the complete contents of an LV, discovers no property on its own and does not
  call an LV change a confirmed change of owner.
- A polling cycle fetches each parcel once and shares the answer between all subscriptions of
  the same object; histories, labels, intervals and channel rules stay per user.
- Neighbor discovery previews up to 100 basic parcel definitions and atomically adds up to
  20 selected daily watches with quota estimates, ownership checks and duplicate protection.
- Per-watch notification filters, quiet hours with timezone, daily/weekly digests and
  urgent-event bypass. Durable digest batches retain failed events and recover after crashes.
- SMTP e-mail and self-hosted ntfy, independently controlled by administrators. Explicit
  opt-in enables shared instance Gotify; complete personal settings take precedence.
- Notification links open the exact owner-only event, including older history pages.

- A řízení is now followed as its own object: state changes, new completed operations and
  payment state are reported for the same řízení id, and its history survives the plomba
  disappearing from the parcel. After a plomba is removed the detail is still queried for
  `CUZK_RIZENI_FOLLOW_DAYS` (default 14, at most ten follows per watch), so the actual
  result is reported instead of implying an approved vklad. A missing detail keeps the last
  known values; a 404 or empty payload ends the follow-up as confirmed unavailable.
- Users can add a known řízení (type, number, year, office code) or a linked
  `navazanaRizeni` and stop the extra queries at any time.
- History now records the value before and after each change (`Výměra: 976 → 980 m²`) plus
  the snapshot behind it, compares BPEJ and protections in a normalized order, and treats a
  list the API did not return as unknown rather than removed. The watch detail pages and
  filters the history and exports CSV/JSON with acquisition times; it also states that no
  history exists from before the watch was created.
- Adding a watch no longer needs the KÚ code: search by name without diacritics or by code,
  write the parcel as one field (`1133/77`, `st. 25`) and confirm the verified ČÚZK answer
  before saving. Identification is taken from that answer, and the demo parcel is prefilled
  only with `SEED_DEMO_WATCH=1`.
- New CSV/JSON bulk import with a preview that spends no ČÚZK call, per-row errors with line
  numbers, duplicate detection and one verification call per imported row.
- One user can watch one object only once; the upgrade reduces existing duplicates to the row
  with the most recorded events before adding the unique index. All histories, pending
  deliveries and distinct tracked procedures are transferred before removing duplicates.
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

The upgrade adds `0009_backup_status`, `0010_watch_rizeni`, `0011_event_history` and
`0012_watch_uniqueness` (which consolidates duplicate watches while preserving their histories and deliveries)
and `0013_notification_rules`. Existing accounts, watches, events and pending
notification deliveries are preserved. Back up the database and configuration/keys first;
use the pinned image and the [upgrade procedure](docs/self-hosting.md#upgrade). The regression
test upgrades the previous schema and checks both preserved data and rejected startup after
a migration failure. There is no promise of compatibility with arbitrary older images.

Earlier selfhosting changes require a persistent `NOTIFICATION_ENCRYPTION_KEY` and explicit
`pnpm notifications:encrypt` for old plaintext credentials. Registration defaults to private.
Scheduled off-site backups remain optional until their target and recovery credentials are
configured. An unreachable SSO provider on a redeploy produces a bootstrap warning; verify
SSO independently after deployment.
