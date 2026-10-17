# Creating an application project

Connect the Wizard to Sync, Fetch the saved configuration, then open
**Projects → Add Project**. Enter a nonempty Project Key containing only lowercase
ASCII letters and digits. Choose the GitLab namespace and configure Production,
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
stopping GitLab. A repository containing only README and generated CI is **not a
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

The Wizard is an optional infrastructure project. Importing its source, adapting
its Node 13 build, validating a separate review deployment and promoting it are
the next delivery. They are not performed for every user by Add Project.
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

Verified on 2026-10-17 against local WSL Ubuntu, GitLab CE 19.4.2 and the existing
19.4 runner: `root/bootstrapdemo` was created privately on `main`, GitLab CI lint
accepted its installed configuration, repeated/concurrent Save returned the same
ID, a different operation was refused, and the setup PAT count returned to zero.
The Fetch and CI signatures passed the existing offset/MD5 checks. Applying
routing again preserved the GitLab and entry NGINX container IDs/start times;
the Wizard stayed HTTP 200 and the empty review destination returned HTTP 503.
No application source was imported or deployed. Sync build and isolated API,
suggestion and runner-token regression tests passed; the Wizard's eleven Jest
tests and Node 13 production build passed with existing lint/Browserslist warnings.
