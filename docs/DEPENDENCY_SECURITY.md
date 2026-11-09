# Dependency security

Audit the committed lockfiles as well as the applications built from them. A
development dependency can affect a local development server or a build even
when it is absent from the Production image.

Use the repository's declared Node/npm versions. Run `npm audit --json` from each
of these directories:

- `sync`
- `wizard`
- `project-bootstrap/templates/angular`
- `project-bootstrap/templates/react`
- `project-bootstrap/wizard-build/modern/smoke`
- `project-bootstrap/wizard-build/recipe/smoke`

The last directory is a retained historical recipe. Preserve its source and
recipe identity; changes to a current managed build belong in a new supported
recipe and its migration workflow.

Match a finding to its actual dependency path, affected version and upstream
advisory. Distinguish a browser application, a Node HTTP client, a development
server and a build tool. A registry audit does not prove that a private hosting
provider's alert inventory has been read or that its alerts have closed.

## Stable fixes and compatibility

Prefer a corrected compatible release and regenerate the lockfile with npm.
Keep exact direct version declarations and use stable releases. Do not use
`npm audit fix --force` as a substitute for checking compatibility. Run the
affected lint, typecheck, build and application checks, then the prescribed
combined System candidate and post-merge checks.

The current fixes cover these distinct paths:

| Dependency | Relevant use | Corrected selection |
| --- | --- | --- |
| `body-parser` | Sync parses request bodies before route authentication. | `2.4.0`, correcting [compressed-body denial of service](https://github.com/advisories/GHSA-27r3-jxmh-p828). |
| `follow-redirects` | Axios's Node HTTP adapter; the browser uses a different adapter. | The compatible `1.16.3` lockfile selection includes the [sensitive-header fix](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p). |
| `minimatch` | ESLint and TypeScript ESLint development tooling. | Scoped `11.0.5` overrides include the [pattern-amplification fix](https://github.com/advisories/GHSA-g3hv-75wg-m249). |
| Angular build/Vite | The Angular starter's build and development-server tools. | Stable Angular build/CLI `22.2.6` selects the patched Vite line. |
| `fast-uri` | Transitive URI/schema processing in the Angular toolchain. | A compatible `3.1.9` lockfile selection corrects URI normalization and scheme handling. |

The `minimatch` overrides are limited to `eslint`, `@eslint/config-array` and
`@typescript-eslint/typescript-estree` in Sync and Wizard. Their parent releases
still request the affected 10.x line. Version 11 removes regular-expression
construction APIs; these callers use the retained `Minimatch`/`match` APIs.
Validate the actual project lint/configuration traversal on the declared Node
24 runtime when changing these overrides. Remove an override when the parent
package natively selects a corrected compatible dependency, after repeating
those checks. Preserve third-party license notices when refreshing packages.

Use [Renovate's approval-controlled batches](DEPENDENCY_UPDATES.md) for continued
discovery. A bot proposal, successful audit or published release does not itself
promote Production; release acceptance and deliberate deployment remain required.
