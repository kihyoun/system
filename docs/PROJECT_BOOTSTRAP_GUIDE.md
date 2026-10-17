# Creating an application project

Connect the Wizard to Sync, Fetch the saved configuration, then open
**Projects → Add Project**. Enter a nonempty Project Key containing only lowercase
ASCII letters and digits. Choose the GitLab namespace, choose an application template, and configure Production,
Beta and Review App hosts using the existing HTTP/HTTPS and certificate fields.
The destination shown below the key is the exact repository path; domains do not
change it. Existing legacy keys remain importable and are not renamed.

The field distinguishes checking, available, occupied and unverified. A local
duplicate or an occupied GitLab destination blocks creation. An API failure does
not mean that a name is free. Save rechecks in GitLab; another user's competing
creation is reported without linking to it, overwriting it or adding a suffix.

Save creates a private repository, initializes its configured default branch,
installs the generated CI at `.system-bootstrapper/ci.yml`, and selects that path
as the project's CI configuration. The public upstream publishing pipeline is
unchanged. A temporary `api` PAT stays inside the local GitLab Rails process and
is revoked in `ensure`; the browser never receives it. The Sync authentication
used for Push/Fetch also protects these operations.

GitLab initialization runs in the background. The browser polls an authenticated
job endpoint with short requests, so the NGINX request timeout does not need to
cover Rails startup. Keep the form open until completion; errors can be retried
with Save. After a browser/service restart, Fetch the pending configuration and
use its Edit → Save to resume. The operation receipt is stored as a comment in
the existing `.projects.env/.<key>.env` file. No configuration volume is added.
While a project operation runs, Push and other mutating service commands wait.
Do not manually replace pending configuration while recovering it.

The entry NGINX and the existing project proxies/networks are configured without
stopping GitLab. For **React**, **Angular** and **General web project**, Save also
installs editable source, Dockerfile, NGINX SPA fallback and a matching managed
pipeline. React uses TypeScript/Vite, Angular uses its own CLI build; both use
Node 24 with pinned dependencies and lockfiles. General web starts with static
HTML/CSS/JavaScript and requires no framework or Node build.

After routing is ready, Save starts the first pipeline. It builds and pushes the
image, tests its HTTP response, then deploys automatic environments. For manual
environments, start the deployment job in GitLab. Open the pipeline link to check
its actual status; Save does not claim that a queued build is a running app.
Retries recover the same initial API pipeline instead of starting duplicates.
The generated README companion, GETTING_STARTED.md, gives local development
commands. All generated source, Dockerfile and CI remain editable in GitLab.
The original Wizard and public publishing pipeline are not replaced.

The **Empty repository** option preserves the earlier workflow. A repository containing only README and generated CI is **not a
running application**. The CI workflow waits for a root Dockerfile. Add application
source compatible with the existing Docker/Cypress generator before building or
deploying it. Repository and pipeline links appear in the expanded project row;
the environment URLs are configured destinations, not deployment health checks.
The generator uses `$CI_DEFAULT_BRANCH`, rather than assuming `master`.

Repository ID, path, URLs, default branch, managed CI path and the initial
`awaiting-source` state survive authenticated Fetch and JSON Backup/Open. Once a
project is created, ordinary environment edits still use the established local
configuration/Push workflow; they do not rename repositories or automatically
rewrite committed CI. Managed CI can be reviewed in GitLab before later changes.

The Wizard is automatically registered as the first system project after a
configured startup with the Wizard enabled. Its real Production URL comes from
the main configuration. The private `root/wizard` repository is currently only a
README/CI registration scaffold; no source import, pipeline or UI rollout occurs.
Beta and Review are disabled. The original interface and its existing route stay
in place, without a second project proxy for that host. General manages its
settings, so edit/delete and environment switches are disabled for this entry.
Repeated startup reuses the repository, and ordinary Push preserves the
server-owned registration receipt while updating its displayed Production
settings at the next startup. An occupied local key or foreign repository is
reported without overwriting it; resolve the conflict and restart to retry.
See the [registration issue](https://github.com/kihyoun/system/issues/19) and
[next expansion](https://github.com/kihyoun/system/issues/18) for source import,
local GitLab builds, Review/Beta and deliberate rollout.
Harvest/Seed continue to concern persistent service volumes and certificates;
configuration stays independent through Push/Fetch and Open/Backup.

## Validation

Build Sync with `cd sync && npm run build`. Run `node tests/project-bootstrap.js`
in an isolated container/network namespace (the disposable API uses port 8071).
The test covers key/signature validation, shell assignment rejection,
authentication, namespace conflicts, competing Save, restart recovery, polling,
configuration-write exclusion and Fetch metadata/signature round trips.

For the Wizard, use the established Node 13.12 dependency image, run
`CI=true npm test -- --watch=false --runInBand` and `npm run build`.
Tests include ENV/JSON metadata, certificate/deployment settings, legacy keys,
debounce and ignored stale responses.

`tests/project-bootstrap-live.js` is an explicit integration test for a disposable
local platform. It requires Sync credentials in the environment and a
`PROJECT_PAYLOAD` JSON file containing `{projectKey, namespaceId, data, ci}` from
the Wizard generator. It creates or resumes the private `bootstrapdemo` project,
checks concurrent/repeated Save and authenticated Fetch, and verifies that a
different operation cannot claim its repository. It deliberately leaves that
project available for inspection. Do not point it at an unrelated existing key.

Local HTTP checks do not verify Let's Encrypt issuance or renewal. Those require
real DNS/domain control and remain a separate validation.

The original empty-repository delivery was verified on 2026-10-17 against local
WSL Ubuntu, GitLab CE 19.4.2 and the existing
19.4 runner: `root/bootstrapdemo` was created privately on `main`, GitLab CI lint
accepted its installed configuration, repeated/concurrent Save returned the same
ID, a different operation was refused, and the setup PAT count returned to zero.
The Fetch and CI signatures passed the existing offset/MD5 checks. Applying
routing again preserved the GitLab and entry NGINX container IDs/start times;
the Wizard stayed HTTP 200 and the empty review destination returned HTTP 503.
That empty-repository test did not import or deploy application source. Sync build and isolated API,
suggestion and runner-token regression tests passed; the Wizard's eleven Jest
tests and Node 13 production build passed with existing lint/Browserslist warnings.

The template delivery was also verified locally on 2026-10-17: `reactstarter`,
`angularstarter` and `webstarter` each have one initial API pipeline, successful
build/registry push/HTTP smoke test and both Production and Review deployments.
All six domains returned HTTP 200. React and Angular rendered their application
components in a browser; the plain web starter executed its JavaScript. A React
review URL also rendered after direct navigation to a nested client route.
Repeated Save and Fetch remained valid after updating/restarting Sync.
The entry platform's GitLab identity and start time were preserved during that
update. Setup PATs are revoked after each operation.

These tests first repaired stale local infrastructure: the managed runner had
retained an old GitLab IP, and WSL had regenerated away the local registry hosts
entries. The runner now uses stable Docker service discovery; the existing
`prepare-local.sh` restored the local hostnames. Failed jobs were retried inside
their existing initial pipelines. This is not a production HTTPS/DNS test.

Template files are versioned under `project-bootstrap/templates/`. Their direct
dependencies, lockfiles and image digests are pinned. Source is installed through
one all-create GitLab commit, never by overwriting user files. The first pipeline
starts after routing is ready and its ID is retained for repeat/recovery.
`tests/application-templates.js`, `tests/application-templates-live.js` and
`tests/application-templates-live-audit.rb` cover generation and the live result.
The Wizard now has twelve passing Jest tests, including a stable pending-project
ENV round trip; its existing Node 13 production build also passes.

Automatic Wizard registration was verified locally on 2026-10-17. Startup
created the private `root/wizard` scaffold, authenticated Fetch returned it first
with the actual `localhost` Production address, and recovery/repeated startup
retained its repository identity. The normal Bootstrapper restart preserved the
existing Wizard and GitLab container identities/start times; the interface
remained reachable. No additional Wizard proxy or runner resources were created.
GitLab CI lint accepted the scaffold. GitLab recorded one skipped pipeline for
the CI-installation commit, with no jobs; no application pipeline or deployment
was started. Provisioning tokens were revoked.

`tests/default-wizard.js` covers HTTP/HTTPS settings, disabled environments,
signature validation, repeat registration, configuration-Push preservation and
local-key conflicts. `tests/default-wizard-routing.sh` covers the single existing
route and proxy/runner lifecycle exclusion. The authenticated live check is
`tests/default-wizard-live.js`. The UI now passes thirteen Jest tests across seven
suites, including first-row ordering, managed controls and metadata import, and
its Node 13 production build passes. Wizard source import and rollout are still
the separate expansion linked above.
