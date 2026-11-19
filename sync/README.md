# Sync API development

Sync uses Node.js 24.22.0 LTS and its bundled npm 11.19.1.
Use the committed lockfile with `npm ci`, including development dependencies:
the current startup script compiles TypeScript before starting the API.

```sh
cd sync
npm ci
npm run lint
npm run check
npm run build
```

Lint and compilation do not rewrite sources. `npm test` runs the compiler check;
it is not a substitute for component or integration tests. The API uses
CommonJS output, port 8071, authentication and configuration/receipt formats.
TypeScript's non-strict defaults are explicit; `noImplicitAny`
remains enabled. Multipart uploads accept one file per expected field and reject
multiple files with HTTP 400.

The compiler is TypeScript 6.0.3 because typescript-eslint 8.71.2 currently
supports TypeScript versions below 6.1. Keep compiler upgrades compatible with the lint toolchain. Express 5.3.0, jsonwebtoken 9.0.3 and
Node-24 type definitions are pinned with the other direct dependencies.

Sources: [Node release schedule](https://github.com/nodejs/Release),
[TypeScript releases](https://github.com/microsoft/TypeScript/releases),
[typescript-eslint compatibility](https://typescript-eslint.io/users/dependency-versions/),
[Express migration guide](https://expressjs.com/en/guide/migrating-5/), and
[JWT migration notes](https://github.com/auth0/node-jsonwebtoken/wiki/Migration-Notes:-v8-to-v9).

Run `node tests/sync/migration-api.js` from the repository root inside a
disposable Linux candidate after building Sync. It binds the intentional port
8071 inside that candidate, checks login/token refresh and multipart Push/Fetch,
and uses temporary configuration only. Other component suites cover default
Wizard registration, project provisioning, suggestions and signature checks.
See [the test guide](../tests/README.md) for the isolated component runner.

CryptoJS 4.2.0 is retained for protocol compatibility. Authentication changes
must preserve existing clients or provide an explicit migration; updating the
runtime alone does not redesign that protocol. Run `npm audit` against the
lockfile when reviewing dependencies; advisory results depend on their date.

## Configuration Push and restart

The Wizard uploads `bootstrapper.zip` through authenticated `POST /config/zip`.
Sync imports it while keeping the management interface available until a
validated apply or restart. Authenticated `POST /config/impact` accepts the same
multipart archive and returns the expected mode, affected project keys and a
configuration fingerprint without changing saved state. The Wizard includes that
fingerprint in Push; changed inputs or saved state require another impact review.

Existing ordinary application routing changes use the native project apply path
and gracefully reload the entry proxy, returning `applyMode: routing` and
`needRestart: false`. GitLab and application images remain running. No effective
service change returns `applyMode: none`. Changes outside the narrow routing
allowlist return `applyMode: restart` and `needRestart: true`, then exit Sync after
the response finishes. The controller restarts with the saved configuration.
Failed imports do not trigger a restart; failed route applies restore the saved
configuration and proxy reloads restore the previous active configuration.

The multipart routing fixture covers preflight, stale-plan rejection, scoped
apply and rollback. `tests/sync/push-restart-api.js` retains coverage of
response-before-restart ordering in a disposable process. The full candidate
scenario verifies real GitLab container continuity and readiness during routing
Push, alongside its existing ACME and Seed recovery gates.

Build the complete controller with [the supported runtime](../bootstrapper/README.md).
Do not copy these dependencies or Debian Node binaries into the historical
Alpine runtime image. Isolated API checks do not replace full platform/recovery
acceptance or manual Production promotion. Retain the previous working image
and private configuration for rollback.
