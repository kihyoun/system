# Creating an application project

Connect the Wizard to Sync, Fetch the saved configuration, then open
**Projects → Add Project**. Enter a nonempty Project Key containing only lowercase
ASCII letters and digits. Choose a GitLab namespace and application template,
then configure Production, Beta and Review App hosts with their HTTP/HTTPS,
certificate and deployment settings. The destination below the key is the exact
repository path; domains do not change it. Existing stored keys are not renamed.

The key field distinguishes checking, available, occupied and unverified.
A local duplicate or occupied GitLab destination blocks creation. An API failure
does not mean a name is free. Save rechecks GitLab; a competing creation is
reported without linking to it, overwriting it or adding a suffix.

## Save and inspect the first pipeline

Save creates a private repository, uses its configured default branch, installs
managed CI at `.system-bootstrapper/ci.yml` and selects that CI path. Provisioning
runs server-side through an authenticated background job; the browser polls
short requests. Keep the form open until completion. A failed request can be
retried with Save. After a browser/service restart, Fetch the pending
configuration and use **Edit → Save** to resume the same operation.

The private operation receipt is stored in `.projects.env/.<key>.env`. Conflicting
configuration/service mutations are excluded while provisioning runs. Do not
replace a pending configuration or delete its receipt to bypass recovery.

React, Angular and General web projects receive editable application source,
Dockerfile, NGINX configuration and matching CI. React uses TypeScript/Vite;
Angular uses its CLI build. Both use Node 24 with pinned dependencies and
lockfiles. General web starts with static HTML/CSS/JavaScript and needs no Node
build. `GETTING_STARTED.md` in the created repository gives local commands.

Once routing is ready, Save starts the initial pipeline. It builds and pushes an
image, performs an HTTP smoke check and deploys automatic environments. Start
manual deployment jobs in GitLab. Inspect the pipeline link for the actual
result: a queued build does not mean an application is running. Retrying Save
recovers the initial pipeline instead of starting duplicates.

An **Empty repository** contains README and generated CI, not a running
application. Add source and a root Dockerfile compatible with the generated
Docker/Cypress workflow before building or deploying. Environment URLs are
configured destinations, not health checks.

Repository ID, path, URLs, default branch, managed CI path and operation state
survive Fetch and configuration Backup/Open. Ordinary environment edits use the
configuration/Push workflow; they do not rename the repository or automatically
rewrite committed CI. Review pipeline changes in the repository explicitly.

## Manage the system Wizard project

Startup with the configured Wizard enabled registers it as the first system
project. General supplies its existing Production host and certificates, so
registration creates no second proxy for that host. Edit/delete and ordinary
environment switches are disabled for this managed entry. Repeated startup
retains the repository and its server-owned workflow metadata. Resolve a local
key or repository ownership conflict before retrying startup.

Registration alone installs a disabled scaffold. Use the managed project actions
to [initialize pinned source](WIZARD_SOURCE.md), [build and verify a candidate](WIZARD_BUILD.md)
and configure [Review/Beta environments](../project-bootstrap/wizard-environments/README.md).
The optional environments begin disabled and require explicit host/certificate
configuration. Their deploy/stop jobs are manual. A candidate replaces the
Production interface only through the separate guarded
[operator promotion procedure](../project-bootstrap/wizard-production/README.md).

Push/Fetch and Open/Backup manage configuration independently of Harvest/Seed,
which handles persistent service data and certificates. Save actual
configuration backups privately; generated source repositories are not a place
for credentials or exported configuration.

## Verification

Build Sync with `cd sync && npm run build`. The isolated API regression
`node tests/gitlab/project-bootstrap.js` uses port 8071 and must run in a
disposable container/network namespace. It covers validation, authentication,
namespace conflicts, competing Save, recovery, polling, configuration-write
exclusion and Fetch round trips. Template generation is covered by
`node tests/gitlab/application-templates.js`.

For Wizard checks, use the Node/npm versions declared in `wizard/package.json`,
install with `npm ci`, then run `npm run lint`, `npm test`, `npm run build` and
`npm run test:config-export` from the Wizard directory. Tests cover metadata,
certificate/deployment settings, key validation and ignored stale responses.

`tests/gitlab/live/project-bootstrap.js` is an opt-in test for a disposable
platform. It takes Sync credentials through the environment and a
`PROJECT_PAYLOAD` JSON file containing `{projectKey, namespaceId, data, ci}` from
the Wizard generator. It creates or resumes its `bootstrapdemo` project, checks
concurrent/repeated Save and Fetch, and leaves that project for inspection. Do
not point it at an unrelated existing key. Template live checks are in
`tests/gitlab/live/application-templates.js` and
`tests/gitlab/live/application-templates-audit.rb`.

`tests/wizard/default-wizard.js` and
`tests/nginx/default-wizard-routing.sh` cover managed registration and single-route
behavior; `tests/wizard/live/default-wizard.js` is its authenticated live check.
Local HTTP fixtures do not demonstrate real DNS, certificate issuance/renewal,
GitLab job execution or a successful Production rollout. Exercise those gates
separately on an explicitly owned test platform.
