# Project routing operations

`ProjectsRoutingModule` provides `ProjectsRoutingService`. The service owns alias
validation, template generation, application proxy selection, and rollback of
routing templates and proxy address records. `run` accepts a typed action and an
absolute checkout root. Template destinations can be supplied by an isolated
caller; the controller compatibility entries use `/templates`.

The public HTTP configuration API is unchanged. Existing paths in `nginx/`,
`nginx-proxy/` and `project-bootstrap/` dispatch to compiled operations. Build
`operations` before invoking those entries. Alias/configuration helpers retain
synchronous exports for Sync consumers. Native routing commands resolve their
process and configuration adapters through Nest dependency injection.

The shared literal-assignment parser reads declarative configuration without
executing shell expansion and returns only requested keys. Project settings are reset between
projects. Docker and Compose receive argument arrays and bounded timeouts. NGINX
reload uses the injected `ProxyReloadService` with native Docker argument arrays.
It binds the operation to the inspected container ID and acquires an exclusive
container-side lease before snapshotting the active configuration. The pinned
upstream NGINX template renderer and `nginx` executable remain native dependencies.
A known render, validation or reload failure restores and reloads the snapshot;
an uncertain command or failed rollback retains the snapshot and lease for
inspection instead of racing a possibly active process. Successful operations
release their own lease. Template and address-record rollback belongs to the
TypeScript service; configuration Push retains its existing process-lifetime lock.

Targeted application updates preserve running proxy generations. Ordinary
startup applies saved image and logging selectors. Managed Wizard routing is
rendered once from General settings, while environment fragments remain owned by
the managed deployment helper. Recovery renders only GitLab and registry routes.
Certificate aliases retain exact-host, ownership, private-key and validity checks.
Configuration imports retain the exact System Cube and server-owned receipts.

Run `npm run build` in `operations`, then `node --test
operations/tests/projects-routing.test.cjs` from the checkout. Existing nginx,
configuration-impact and Sync import contracts exercise the compatibility entries
with disposable files and mocked service transports. These offline checks do not
claim deployment or live TLS acceptance.
