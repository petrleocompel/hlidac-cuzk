# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/petrleocompel/hlidac-cuzk/security/advisories/new).
Include the affected version or image digest, reproduction steps and the impact you expect.
Never attach real `.env` files, API keys, session cookies or database dumps.

You can expect an acknowledgement within 7 days. Fixes are released as a new version with
a GitHub Security Advisory; please keep the report private until then.

## Supported versions

Only the latest release receives security fixes. Pin image digests, but upgrade to the newest
release when an advisory is published (see [upgrade guide](docs/self-hosting.md#upgrade)).

## Scope

In scope: this application, its container image, the Compose files under `deploy/` and the
documented installation procedure. Vulnerabilities in ČÚZK services, identity providers or
notification providers should be reported to their operators.
