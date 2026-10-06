# Regression coverage

Use Node **26+** (see `.nvmrc`). The geometry suite uses jsdom and
OpenLayers to verify GML parsing, CRS axes, polygon selection, identity and bounded responses.
This is a DOM test, not a visual browser or mobile test.

Run `pnpm test` for pure/unit tests and `pnpm test:integration` for real PostgreSQL tests.
The latter requires `TEST_DATABASE_URL` pointing to a disposable database named
`hlidac_test_*`; the runner rejects other names. Use PostgreSQL 16 and a role allowed to
create/drop disposable databases for migration and upgrade tests. Test files run serially
because their fixtures share that database; individual scenarios deliberately launch
concurrent workers. Never point these commands at an operator database.

The integration configuration supplies a fixture ČÚZK key and authentication/encryption
settings. Tests bind local HTTP/SMTP fixtures and set the ČÚZK base URL to those fixtures.
No production API key, webhook, SMTP account or delivered human message is required.
Do not replace fixture destinations with real credentials. GitHub Actions runs unit
and integration suites before publishing; backup and Compose smoke checks cover separate
installation concerns described in the selfhosting guide.

## QA-01: captured changes and durable delivery

| Behavior | Executable regression evidence |
| --- | --- |
| First snapshot and unchanged parcel produce no notifications | `notification-outbox.test.ts`: “does not create deliveries for the first snapshot or an unchanged parcel” |
| Same řízení ID changes state or gains an operation | `rizeni-follow.test.ts`: “reports a state change…” and “reports added operations” |
| Reordering BPEJ is not a change; absent lists stay unknown | `watch-history.test.ts`: “does not create an event when BPEJ is only reordered” and “does not report a missing list as a removal” |
| Incomplete/unavailable procedure detail retains known values | `rizeni-follow.test.ts`: “survives a failing detail request without emptying known values” |
| Whole-poll timeout cannot commit a partial snapshot | `parcel-poll-lease.test.ts`: “releases the lease on failure and does not commit an aborted detail as a partial snapshot” |
| HTTP timeout, retries, 429 and shared pauses respect the 500/day quota | `cuzk-budget.test.ts`: timeout, short/long Retry-After, concurrent request at 499 and remaining-budget scenarios |
| A channel outage does not stop another channel or erase the event | `notification-outbox.test.ts`: “keeps Slack independent of Gotify failure…” |
| Committed jobs survive process exit and drain in a fresh CLI | `notification-outbox.test.ts`: “commits snapshot, event and per-channel jobs without sending…” |
| Snapshot/event/outbox insertion is atomic | `notification-outbox.test.ts`: “rolls back the snapshot and event when queue insertion fails” |
| Cron and manual refresh racing produce one event set | `parcel-poll-lease.test.ts`: “two cron processes and a manual refresh produce one request and one event/outbox set” |
| SIGKILL, expired claims and stale workers preserve ownership | `parcel-poll-lease.test.ts` hard-killed/expired worker scenarios; `notification-outbox.test.ts` expired-claim recovery |
| Digests retain unsent events and recover as digests | `notification-outbox.test.ts`: bounded batches, expired digest claims, separate retry ceilings and concurrent digest workers |

All referenced files are under `tests/integration/`. On 13 September 2026 the complete
suite passed **115 integration tests on PostgreSQL 16** and **82 unit tests**. Lint,
typecheck and production build also passed. These results establish the fixture behaviors;
they do not claim live ČÚZK data coverage, delivery to real providers or a successful current
remote pipeline.

QA-02 remains separate: an end-to-end installation journey including a test OIDC provider
and real upgrade/backup/restore processes is broader than these component integrations.

### Account portability and administration audit

`tests/integration/account-audit.test.ts` uses a disposable PostgreSQL database and actual Better Auth handlers. It checks ownership/secret omission in export, local recovery and session revocation without privilege changes, role/ban/impersonation audit actor attribution, concurrent actor isolation, SSO redaction, transactional rollback on audit write failure, bounded retention, private password-file CLI behavior and lossless pagination across PostgreSQL microsecond timestamps. No authenticated ČÚZK requests or notification provider calls are needed.
