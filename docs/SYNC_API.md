# Sync API development

Sync uses Node.js 24.22.0 LTS and its bundled npm 11.19.1.
Use the committed lockfile with `npm ci`, including development dependencies:
the current startup script compiles TypeScript before starting the API.

```sh
npm ci
npm run lint
npm run check
npm run build
```

Lint and compilation do not rewrite sources. `npm test` runs the compiler check;
it is not a substitute for component or integration tests. The API uses
NestJS 12.5.1 with its Express 5.3.0 adapter, CommonJS output, port 8071,
authentication and configuration/receipt formats.
TypeScript's non-strict defaults are explicit; `noImplicitAny`
remains enabled. Multipart uploads accept one file per expected field and reject
multiple files with HTTP 400.

The compiler is TypeScript 6.0.3 because typescript-eslint 8.72.2 currently
supports TypeScript versions below 6.1. Keep compiler upgrades compatible with the lint toolchain. Express 5.3.0, jsonwebtoken 9.0.3 and
Node-24 type definitions are pinned with the other direct dependencies.
Nest common/core/platform-express, reflect-metadata 0.2.2 and RxJS 7.8.2 are
exact pins. TypeScript's stable `node20` module mode models Node's support for
loading Nest's ESM packages through `require()` while retaining CommonJS output
for the repository-owned native helpers. Legacy decorators and emitted type
metadata enable Nest dependency injection; the supported Node 24 runtime is
required for both development and the controller.

Sources: [Node release schedule](https://github.com/nodejs/Release),
[TypeScript releases](https://github.com/microsoft/TypeScript/releases),
[typescript-eslint compatibility](https://typescript-eslint.io/users/dependency-versions/),
[Express migration guide](https://expressjs.com/en/guide/migrating-5/),
[JWT migration notes](https://github.com/auth0/node-jsonwebtoken/wiki/Migration-Notes:-v8-to-v9),
[Nest prerequisites](https://docs.nestjs.com/first-steps), and
[TypeScript module modes](https://www.typescriptlang.org/tsconfig/module).

## Application structure

`src/index.ts` is the direct process entry point. `src/bootstrap.ts` creates the
native Nest application from `AppModule`, installs the HTTP middleware before
route initialization and listens on port 8071. Default Wizard registration starts
only after the listener is available. Importing the entry point creates no socket
or background work; `createSyncApplication()` returns an uninitialized application
that a disposable test can initialize and close, while `bootstrap()` starts the
normal listener and registration.

Auth, Configuration, Projects, Operations and Diagnostics each own a Nest module,
controller and injectable service. Controllers declare the existing routes and
response rules; services own authentication state, configuration imports, native
project/Wizard workflows, backups, commands and bounded diagnostics. The shared
Runtime service owns operation flags and checks the existing filesystem leases.
The root helper modules retain their native repository integration and on-disk
formats. This architecture applies to Sync; application templates remain their
existing web application starters.

Middleware keeps the aggregate and authentication limits, exact browser-origin
validation and CORS ahead of body parsing, the single-file upload check, request
logging and maintenance/configuration guards. Nest's automatic body parsers are
disabled so the existing 5 MiB JSON/urlencoded and 50 MiB upload limits remain
authoritative. JWT guards and an exception filter preserve the API's status,
plain-text authentication responses and sanitized JSON errors.

## API verification

Run `node tests/sync/migration-api.js` from the repository root inside a
disposable Linux candidate after building Sync. It binds the intentional port
8071 inside that candidate, checks login/token refresh and multipart Push/Fetch,
and uses temporary configuration only. Other component suites cover default
Wizard registration, project provisioning, suggestions and signature checks.
See [the test guide](../tests/README.md) for the isolated component runner.

Node’s built-in cryptographic random generator creates ephemeral signing secrets
and fallback credentials; CryptoJS is no longer required. The existing JWT login
and refresh API remains compatible. Authentication changes must preserve existing
clients or provide an explicit migration. Run `npm audit` against the
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

Build the complete controller with [the supported runtime](BOOTSTRAPPER.md).
Do not copy these dependencies or Debian Node binaries into the historical
Alpine runtime image. Isolated API checks do not replace full platform/recovery
acceptance or manual Production promotion. Retain the previous working image
and private configuration for rollback.
