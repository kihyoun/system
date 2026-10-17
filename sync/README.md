# Sync development and migration candidate

The migration candidate uses Node.js 24.22.0 LTS and its bundled npm 11.19.1.
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
it is not a substitute for component or integration tests. The API retains
CommonJS output, port 8071, authentication and configuration/receipt formats.
TypeScript's previous non-strict defaults remain explicit; `noImplicitAny`
remains enabled. Multipart uploads accept one file per expected field and reject
multiple files with HTTP 400.

The compiler is TypeScript 6.0.3 because typescript-eslint 8.71.2 currently
supports TypeScript versions below 6.1. TypeScript 7 is intentionally deferred
until the lint toolchain supports it. Express 5.3.0, jsonwebtoken 9.0.3 and
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
Their organization and CI entry point are coordinated under System issue 21.

`npm audit` on the candidate lockfile reported no known findings across runtime
and development dependencies on 2026-10-17. This is a registry advisory check,
not a guarantee about exploitability or full container security. CryptoJS 4.2.0
is the current available version but is deprecated by its maintainer; this
migration preserves the existing protocol and does not redesign authentication.

The historical `systembootstrapper/system:12` container base predates this
runtime. Do not promote these dependencies into that image or copy Debian Node
binaries into its Alpine environment. A coordinated supported runtime/base
update and combined candidate verification are prerequisites for deployment.
Retain the existing working image and configuration until explicit promotion;
Production deployment remains a manual GitLab Play job. No live restart or
rollback acceptance is established by the isolated checks above.

Tracking: https://github.com/kihyoun/system/issues/23.
