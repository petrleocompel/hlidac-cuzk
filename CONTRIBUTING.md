# Contributing

Thanks for your interest in Hlídač ČÚZK. Issues and pull requests are welcome in Czech or English.

## Before you start

- For bugs, open an issue with steps to reproduce, the image version/digest and relevant logs
  (redact secrets, e-mails and parcel owners).
- For larger changes, open an issue first so the approach can be agreed on.
- Security problems: see [SECURITY.md](SECURITY.md), not the public tracker.

## Development

Requirements: Node.js 26+ (`.nvmrc`, e.g. `nvm install && nvm use`), pnpm via Corepack (`npm install --global corepack`;
Node 25+ no longer bundles it), Docker (for PostgreSQL).
Follow [Local development](README.md#local-development); you need your own ČÚZK API key only for
real requests — the test suites use local fixtures.

```bash
pnpm lint
pnpm typecheck
pnpm test
TEST_DATABASE_URL=postgres://postgres:integration-test-only@127.0.0.1:55432/hlidac_test_local pnpm test:integration
```

Integration and backup tests need a disposable database named `hlidac_test_*`;
see [docs/testing.md](docs/testing.md).

## Pull requests

- Keep each PR focused; add or update tests for behavior changes.
- Schema changes: edit `src/db/schema.ts` and generate a migration with `pnpm db:generate`.
  Never edit an already released migration.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `ci:` …).
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- CI (lint, typecheck, unit, integration and backup tests, build, image smoke test) must pass.

## Releasing (maintainers)

1. Rename `## Unreleased …` in `CHANGELOG.md` to `## X.Y.Z — <title> (YYYY-MM-DD)` and set
   `"version": "X.Y.Z"` in `package.json`.
2. Commit, then tag and push: `git tag -s vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z`.
3. The [Release workflow](.github/workflows/release.yml) verifies the version, runs CI, publishes
   the multiarch image to GHCR (`X.Y.Z`, `X.Y`, `X`, `latest`) with provenance and SBOM, and
   creates the GitHub Release from the CHANGELOG section. Tags like `vX.Y.Z-rc.1` create
   pre-releases and do not move `latest`.

By contributing you agree that your contributions are licensed under the
[GNU AGPL-3.0-only](LICENSE).
