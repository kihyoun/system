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

The configuration adapter evaluates the existing shell configuration format in a
bounded child and returns only requested keys. Project settings are reset between
projects. Docker and Compose receive argument arrays and bounded timeouts. NGINX
reload retains a short container-side adapter because its configuration files and
`nginx` executable live inside the proxy. Template and address-record rollback is
owned by the TypeScript service; the application entry retains the shared
process-lifetime `flock` used by configuration Push.

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
