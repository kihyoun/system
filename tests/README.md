# Component and platform tests

Tests are grouped by the infrastructure component they exercise. JavaScript,
Bash, Python and Ruby are retained where useful. The isolated runner executes
only the explicit [manifest](manifest.json); it never discovers `live/` scripts
or starts a platform automatically.

## Reproduce isolated checks

From a clean committed checkout, with Node, Git, tar and Docker available:

```sh
git submodule update --init --recursive
node project-bootstrap/wizard-source/package.js
node tests/prepare-context.js
docker build -f tests/Dockerfile -t system-component-tests - < .test-context/context.tar
docker run --rm --network none system-component-tests all
docker run --rm --network none system-component-tests sync
```

Do not mount the Docker socket, private configuration, host network or platform
volumes into this child. When Node is absent from the trusted host,
`bash project-bootstrap/wizard-source/prepare.sh` provides the source-packaging
fallback. The context contains only allowlisted blobs from the current committed
Git tree plus the validated Wizard snapshot matching its gitlink. It excludes
Git metadata, private/ignored/untracked files and working-copy edits. Commit the
intended code before packaging; no fallback sends the entire checkout.

The image combines digest-pinned Node 24.22.0/npm 11.19.1 and Ruby 3.4.11 on
Debian Bookworm/glibc, with Python and shell tools. It installs the committed Sync
lockfile and runs `npm run build`, whose prebuild checks ESLint without autofix.
Runtime and shared-library versions are printed during construction. This Ruby
fixture runtime is separate from GitLab's embedded Rails runtime.

The image sets `SYSTEM_TEST_ISOLATED=1` and invokes `node tests/run.js`. Select
`all` or one of `gitlab`, `sync`, `gitlab-runner`, `bootstrapper`, `nginx`, `wizard`,
`shared` and `performance`. Checks execute sequentially with enforced per-entry
timeouts. Failure, cancellation or timeout produces a nonzero result. Child
process groups are terminated on timeout; reports are updated after each check.
A SIGKILL cannot write new reports, so the container boundary must clean up its
remaining processes.

API checks intentionally bind port **8071** in the private network namespace.
The runner requires the isolation flag, refuses private runtime configuration
and a mounted Docker socket, and checks that the port is free. Those guards do
not replace the disposable container. NGINX fixtures render `/templates` only
inside that container.

JSON and JUnit reports appear in `test-results/<selector>/`. To retain them,
mount only a new output directory:

```sh
mkdir -p test-results
docker run --rm --network none \
  -v "$PWD/test-results:/candidate/test-results" system-component-tests all
```

## Test organization

| Directory | Scope |
| --- | --- |
| `gitlab/` | Root-password initialization, startup, project/templates, source/build/environment/Production Rails adapters, private recovery credentials and GitHub backup transports |
| `sync/` | Suggestions, authentication/token refresh, multipart configuration round trips and Push response before automatic restart |
| `gitlab-runner/` | Shared pool provisioning, endpoint migration, manager-specific persistent config/home and identity reuse |
| `bootstrapper/`, `persistence/`, `seed/` | Service availability, mount guards, persistent configuration, image recovery, completed cold Harvest/restore and interrupted-operation durability |
| `nginx/` | Default Wizard routing and owned Review/Beta route fragments |
| `wizard/` | Source packaging/import, build recipes/cleanup, API workflows, upgrades, Review/Beta and deliberate Production promotion/rollback |
| `shared/` | Runner/context contracts, cleanup/failure propagation, private-daemon lifecycle, payload-only recovery and local ACME fixtures |
| `performance/resources/` | Offline resource-collector contracts and explicit measurement tools |

The manifest is authoritative for exact check names, prerequisites and budgets.
Tests use temporary files, synthetic Git repositories, fake Rails/Docker/API
transports and isolated HTTP processes. A fixture passing does not establish
that a real registry image, browser, runner or GitLab pipeline passed.

`sync/push-restart-api.js` exercises an authenticated multipart configuration ZIP:
a successful response finishes before Sync exits to trigger the controller
restart, while a failed import leaves services available.

The source-context contracts verify binary contents/executable modes, committed
inputs, snapshot hashes/gitlinks and dirty/private-file exclusion. Parent
contracts cover checksum/revision checks before Docker, exact owned cleanup,
primary failure preservation and unreachable-daemon diagnostics. Recovery
contracts cover full-payload validation before destructive copies, GitLab image
identity, clean shutdown, certificate leases and durable restore markers.

## GitLab CI boundaries

The root pipeline uses two categories on merge requests and the default branch:

- **Documentation:** changes limited to root `AGENTS.md`, `README.md`,
  `Prepare-Host.md`, or Markdown/PNG/JPG/JPEG/SVG files beneath `docs/` run
  `check:documentation`. It checks the committed diff with `git diff --check`
  and validates changed Markdown as regular UTF-8 text. It does not initialize
  submodules, install packages, publish runtime images or start a test platform.
- **Runtime:** every other path, mixed documentation/code changes and unknown
  paths retain the complete component, image and cold-recovery checks below.
  CI configuration and helpers, infrastructure, tests and the Wizard gitlink
  belong to this category. Renames include the old and new paths; deleting
  runtime files also retains full coverage.

Native `rules:changes:regexp` requires GitLab 19.2 or later. The shared rule matches
any path outside the documentation allowlist; a matching README never overrides
a runtime change. MR comparisons use the target diff base, and default-branch
pushes use the previous branch head. First pushes and events without a change
comparison conservatively select full checks. Scheduled/manual default-branch
runs also keep the full lane. Protected merges still require a successful current
pipeline and resolved review discussions. A protected default-branch push can
mirror either category to GitHub when enabled; runtime image publishing remains
conditional and Production promotion remains manual.

`check:documentation` uses the platform's existing trusted `docker` runner pool;
no separate documentation runner or coordinator registration is required. Its
committed `tests/ci-documentation.sh` parent uses that runner's Docker authority
to launch a short-lived, digest-pinned Node child as user 1000 with no network,
host socket, bind mounts, extra capabilities or inherited CI credentials. This
isolates the actual checker, not the trusted parent: arbitrary unreviewed code
must not be scheduled on a shared socket runner.

The child receives only the two required committed snapshots' Git objects, a
fresh repository config and the committed checker. Private remote URLs, Git
credentials/config/hooks, unrelated local refs, dirty files and parent environment
are not copied. Only explicit non-secret CI diff selectors and a fixed Git
safe-directory setting enter the child; an empty Docker client configuration
prevents implicit proxy-variable injection. The checker retains its strict socket
refusal. The parent pulls the pinned public image using its normal credentials,
copies the existing `test-results/documentation/` report back and removes only its
identity-checked job container. A separate `after_script` repeats bounded cleanup.
The documentation lane keeps its three-minute job budget and has no runtime
artifacts, builds, platform tests or long-lived resources. Existing `docker` runner
tags and resource bounds remain unchanged for full checks.

Reproduce the selection and documentation regressions with existing Ruby/Psych,
Node and Git, without Docker or additional lint packages:

```sh
ruby tests/gitlab/ci-selection.rb
node tests/gitlab/check-documentation.js
```

These fixtures cover changed paths, event/publishing roles and real Git diffs;
they do not substitute for GitLab CI Lint or the required runtime pipeline when
CI itself changes. MR and merged default-branch commits receive their own checks;
the pipeline does not reuse an earlier cold-recovery result based on tree identity.

The runtime lane prepares the exact recursive Wizard gitlink and both minimal
build contexts in `prepare:wizard-source`. Downstream jobs require the archive
checksum and recorded revision to match `CI_COMMIT_SHA`; missing, damaged or
stale artifacts fail before Docker execution.

Eight component matrix jobs run before publishing. Each is a trusted parent
using the pinned Docker CLI, `services: []` and the existing `docker` runner tag.
It calls `sh tests/ci-isolated.sh <component>`, builds from the verified stdin
archive, then runs a socket-free/network-disabled child with no inherited CI
credentials. Reports leave through `docker cp`, since a job's checkout path
need not exist on the Docker host.

The existing socket runner gives the parent host Docker authority; disabling
DinD services does not remove that authority. This setup is for trusted code,
not hostile merge requests on a shared privileged runner. No additional runner
is provisioned by the tests.

Names include numeric project/job IDs. Traps and `after_script` remove only the
exact job-owned containers/images. The eight-minute script budget leaves cleanup
reserve within the ten-minute job, and each cleanup command is bounded. Separate
on-exit/after-script JSON receipts distinguish successful absence from daemon or
removal errors. Cleanup failure fails an otherwise successful script while
preserving an existing failure. GitLab does not turn a primary success into
failure solely because `after_script` fails, so retain its separate diagnostics.
SIGKILL or host loss can prevent both hooks; replay the retained owned receipts
once the daemon is reachable. Never replace this with global Docker pruning.

## Full-System and platform gates

`test:candidate-image` builds `system/Dockerfile` from committed runtime blobs
and the validated Wizard snapshot, using `.candidate-context/`. Both context
packagers support GNU and BusyBox tar. The complete image installs pinned Sync
dependencies and compiles Sync. A socket-free, network-disabled child checks
runtime/lint/compiler/Compose and snapshot contracts; artifacts record source,
exact image identity and JUnit results.

Reproduce packaging and construction after preparing the Wizard snapshot:

```sh
node tests/prepare-candidate.js
docker build -f system/Dockerfile -t system-candidate:local - < .candidate-context/context.tar
```

`test:platform-candidate` then runs a separately authorized privileged disposable
Docker daemon and blocks the publishing stage. It builds controller/Wizard from
committed inputs and preloads pinned GitLab/Runner/helper/NGINX images. Its full
scenario covers real GitLab/runner/registry CI, a deliberate failure gate,
configuration export, cold Harvest, original-host removal and recovery from the
configuration ZIP plus completed Seed onto different empty paths. It verifies
uncached private Wizard image recovery and actual local-ACME renewal/deployment.
See the [integration guide](e2e/README.md) for explicit inputs, resource bounds,
cleanup and limits; no existing host data or private configuration is an input.

The registry probe, private Wizard derivative and root GitLab publishing build
use `--provenance=false --sbom=false`: affected Docker/GitLab combinations reject
an attestation uploaded before its subject as `blob unknown to registry`. See
[Docker attestation documentation](https://docs.docker.com/build/metadata/attestations/).
Registry digest, pull/run and artifact checks remain required; those paths do
not claim attestation verification. Other candidate-image metadata behavior is
unchanged.

## Explicit live adapters

Scripts under `*/live/` require an operator-prepared disposable platform. Several
use fixed `system_*` names, localhost routes, prepared payloads and private
credentials. They must not target Production or a workstation installation.
Ruby audits run inside GitLab's embedded Rails; Python drivers require Python 3.
The isolated runner never executes these by glob discovery.

`wizard/live/build.js` requires `SYSTEM_WIZARD_LIVE_ACCEPTANCE=true` and an explicit
numeric `SYSTEM_WIZARD_EXPECTED_PROJECT`. Supply Sync credentials privately in
the candidate environment, not command arguments or logs. It imports source and
enables real CI in that managed repository, verifies repeated source/pipeline
identity and required build/browser/digest evidence, and preserves the Production
address. It never invokes deployment, Reset, Seed, Push or restart endpoints.
Its private evidence file is `/tmp/wizard-build-live-evidence.json` and its overall
budget is 65 minutes. It refreshes access tokens proactively and retries an
authentication-failed GET once; mutation POSTs are never blindly replayed.

`wizard/acceptance-driver.js` verifies those polling/refresh/deadline contracts
with offline transports. Build acceptance alone does not prove MR failure,
Review/Beta, Production promotion or rollback. Use the corresponding
[environment](../project-bootstrap/wizard-environments/README.md) and
[Production](../project-bootstrap/wizard-production/README.md) procedures for
those explicit operations.
