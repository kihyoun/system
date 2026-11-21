# Component and platform tests

Tests are grouped by the infrastructure component they exercise. Native
TypeScript services are exercised through Node fixtures. The isolated runner executes
only the explicit [manifest](manifest.json); it never discovers `live/` scripts
or starts a platform automatically.

## Reproduce isolated checks

From a clean committed checkout, with Node, Git, tar and Docker available:

```sh
system-bootstrapper source-prepare
system-bootstrapper ci prepare-context "$PWD"
docker build -f tests/Dockerfile -t system-component-tests - < .test-context/context.tar
docker run --rm --network none system-component-tests all
docker run --rm --network none system-component-tests sync
```

Do not mount the Docker socket, private configuration, host network or platform
volumes into this child. Prepare the pinned Node runtime and root backend package before source packaging;
the initial Quickstart is the only pre-Node shell entry. The context contains only allowlisted blobs from the current committed
Git tree, including the ordinary `wizard/` tree for `system-monorepo-v1`.
Historical gitlink sources additionally require the validated separate Wizard
snapshot and exact recursive submodules (`git submodule update --init --recursive`).
It excludes
Git metadata, private/ignored/untracked files and working-copy edits. Commit the
intended code before packaging; no fallback sends the entire checkout.

The image uses digest-pinned Node 24.22.0/npm 11.19.1 on Debian Bookworm/glibc,
with Python for independent ZIP/TOML fixture oracles and shell/native utilities
for process and historical-format checks. No Ruby test runtime is installed.
It installs the committed root lockfile and builds the shared NestJS application.
The fast checks run ESLint and Prettier without autofix. Runtime and shared-library versions are printed
during construction. These fixture dependencies do not implement platform operations.

Candidate image preparation also runs
`tests/wizard/configuration-routing-export.js` with the built Wizard's actual
configuration exporter before starting the full platform. It verifies the first
Save/Fetch/Backup round trip, exact server receipt preservation and selective
routing when Fetch fills the derived repository annotation. To run it separately,
build the Wizard exporter with `npm run build:config-export` in the committed
`wizard/` directory, then run:

```sh
node tests/wizard/configuration-routing-export.js --exporter wizard/build-tools/export-configuration.cjs
```

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

The host compatibility/logging fixtures run in the `bootstrapper` component.
Candidate image preparation also runs a small real Docker rotation probe with two
owned disposable container generations. It verifies actual file sizes/count and
log readback; the native recovery probe checks custom logging settings through
the real configuration exporter and Seed restore. See
[host operations](../docs/HOST_OPERATIONS.md) for scope and commands.
The opt-in `node tests/bootstrapper/paused-controller-docker.js --allow-local-daemon`
probe also verifies that native Compose discovers and recreates the public-upgrade
fixture's manually replaced controller and final reset using one bounded container.

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
| `performance/resources/` | Offline contracts for shared Nest resource collection, Windows/WSL sampling and explicitly leased native benchmarks |

Cold-copy/restore fault cases are consolidated in `tests/operations/storage-copy.test.cjs`,
run by the existing operations-runtime check. They use real rsync, native find/runit
command fixtures and subprocess timeouts; Docker/GitLab remain controlled transports.

The manifest is authoritative for exact check names, prerequisites and budgets.
Tests use temporary files, synthetic Git repositories, fake Rails/Docker/API
transports and isolated HTTP processes. A fixture passing does not establish
that a real registry image, browser, runner or GitLab pipeline passed.

`sync/push-restart-api.js` exercises an authenticated multipart configuration ZIP:
a successful response finishes before Sync exits to trigger the controller
restart, while a failed import leaves services available.

The source-context contracts verify binary contents/executable modes, committed
inputs, snapshot hashes, monorepo tree identities, historical gitlinks and
dirty/private-file exclusion. Parent
contracts cover checksum/revision checks before Docker, exact owned cleanup,
primary failure preservation and unreachable-daemon diagnostics. Recovery
contracts cover full-payload validation before destructive copies, GitLab image
identity, clean shutdown, certificate leases and durable restore markers.

Image construction retains bounded stdout/stderr in the job's `build.log`
artifact, redacting known private environment credentials. Failed builds also
print the diagnostic tail in the job trace; cleanup preserves the original
build failure. No private configuration enters the committed build contexts.

## GitLab CI boundaries

The root pipeline uses two categories on merge requests and the default branch:

- **Documentation:** changes limited to root `AGENTS.md`, `README.md`,
  `Prepare-Host.md`, or Markdown/PNG/JPG/JPEG/SVG files beneath `docs/` run
  `check:documentation`. It checks the committed diff with `git diff --check`
  and validates changed Markdown as regular UTF-8 text. It does not initialize
  submodules, install packages, publish runtime images or start a test platform.
- **Runtime:** every other path, mixed documentation/code changes and unknown
  paths retain the complete component, image and cold-recovery checks below.
  CI configuration and helpers, infrastructure, tests and Wizard source
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
committed `node dist/modules/ci/entry.js documentation "$CI_PROJECT_DIR"` parent uses that runner's Docker authority
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

Reproduce the selection and documentation regressions with the pinned operations YAML parser,
Node and Git, without Docker or additional lint packages:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node tests/gitlab/ci-selection.js
node tests/gitlab/check-documentation.js
```

These fixtures cover changed paths, event/publishing roles and real Git diffs;
they do not substitute for GitLab CI Lint or the required runtime pipeline when
CI itself changes. MR and merged default-branch commits receive their own checks;
the pipeline does not reuse an earlier cold-recovery result based on tree identity.

The runtime lane prepares the exact shared Wizard tree (or recursive Wizard
gitlink for historical source) and the minimal build contexts in
`prepare:wizard-source`. Downstream jobs require the archive
checksum and recorded revision to match `CI_COMMIT_SHA`; missing, damaged or
stale artifacts fail before Docker execution.

Eight component matrix jobs run before publishing. Each is a trusted parent
using the pinned Docker CLI, `services: []` and the existing `docker` runner tag.
It calls `node dist/modules/ci/entry.js isolated "$CI_PROJECT_DIR" "$COMPONENT"`, builds from the verified stdin
archive, then runs a socket-free/network-disabled child with no inherited CI
credentials. Reports leave through `docker cp`, since a job's checkout path
need not exist on the Docker host.

The existing socket runner gives the parent host Docker authority; disabling
DinD services does not remove that authority. This setup is for trusted code,
not hostile merge requests on a shared privileged runner. No additional runner
is provisioned by the tests.

`prepare:wizard-source` also checks the bundled Docs against the complete public
guide sources before packaging. To update the reader, edit the original guides,
build the pinned root backend package, run `system-bootstrapper docs export`, and commit the generated Wizard catalog
in the same System commit. `system-bootstrapper docs check` checks source drift and
full-text preservation; the existing `node tests/wizard/docs-source.js` check also
exercises the shared native exporter, chapter/link coverage and offline images.
`system-bootstrapper docs export --check` compares the complete generated catalog.

The required `test:wizard-browser` job consumes a separately checksummed context
from that same committed Wizard source tree; historical gitlink inputs retain
their separate identity. Its trusted parent builds the browser
tools and runs the full native Playwright suite in a network-disabled child
with no host socket, private configuration or job credentials. The child has
2 GiB memory, two CPUs and a 512-process limit. Reports and JUnit leave through
`docker cp`; identity-checked cleanup removes only that job's child and image.
This keeps browser coverage in the shared System candidate pipeline; no separate
Wizard source pipeline is required for the monorepo.

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

`test:candidate-image` builds `containers/controller/Dockerfile` from committed runtime blobs
and the validated Wizard snapshot, using `.candidate-context/`. Both context
packagers support GNU and BusyBox tar. The complete image installs pinned Sync
dependencies and compiles Sync. A socket-free, network-disabled child checks
runtime/lint/compiler/Compose and snapshot contracts; artifacts record source,
exact image identity and JUnit results.

Reproduce packaging and construction after preparing the Wizard snapshot:

```sh
node tests/prepare-candidate.js
docker build -f containers/controller/Dockerfile -t system-candidate:local - < .candidate-context/context.tar
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

## Static security scanning

Runtime merge requests and default-branch builds run the required `test:codeql`
job alongside the component checks. It scans the committed System source and
exact embedded Wizard tree (or the historical gitlink snapshot) using CodeQL
2.27.4 and its official default JavaScript/
TypeScript code-scanning suite. Every emitted finding, including suppressed or
baseline results, fails the job; no query or severity exemptions are applied.
The pinned public CLI bundle is checksum-verified before use. The scan child has
no network, Docker socket or credentials and cannot run application builds.

The scan analyzes canonical authored sources rather than these three generated
copies of the same portable runtime:

```text
templates/project-bootstrap/wizard-build/typed-v6/runtime/project-ci.cjs
wizard/.system-bootstrapper/build-v2/runtime/project-ci.cjs
wizard/.gitlab/runtime/project-ci.cjs
```

Preparation requires all three committed regular files, identical bytes and
matching license companions, and the recorded producer hash before omitting
them. A partial, changed or linked artifact fails closed. Their paths and hashes
are retained separately from the analyzed files in `scan-source.json`.
All authored sources and historical recipe sources remain analyzed; an additional
bundle path does not acquire this exception. The required `test:wizard-browser`
job independently runs the generator with `--check` against compiled shared
sources, all three copies, producer metadata and notices.

This deliberately removes duplicate generated/vendor-code SAST coverage. Inlined
third-party dependency code is not analyzed again through those bundles. Exact
regeneration proves correspondence, not absence of vulnerabilities; retain
[dependency audits](../docs/DEPENDENCY_SECURITY.md) for the pinned dependencies.

The CodeQL CLI has its own [license terms](https://github.com/github/codeql-cli-binaries/blob/main/LICENSE.md).
Free automated use requires an open-source codebase hosted and maintained on
GitHub; an external GitLab runner is supported. A private or GitLab-only fork
must establish its own licensing eligibility before running this job. The
project's MIT license does not grant a CodeQL license, and this job purchases no
subscription. Runner compute and storage remain the operator's responsibility.

`node tests/prepare-codeql.js` packages committed inputs after the ordinary Wizard
source preparation. `node dist/modules/ci/entry.js codeql-parent "$CI_PROJECT_DIR"` runs that verified context on the
selected trusted Docker runner with its ordinary CI identity variables. The
child is bounded to 6 GiB RAM and two CPUs; image preparation and scanning each
have a 15-minute ceiling. This static job does not start a disposable platform.
SARIF results, extraction coverage, source identities and cleanup evidence are
retained under `test-results/codeql/`. Missing coverage or any finding fails the
job. Broader quality suites can be run separately for triage; their additional
heuristics are not equivalent to this default security gate.

## Explicit live adapters

Scripts under `*/live/` require an operator-prepared disposable platform. Several
use fixed `system_*` names, localhost routes, prepared payloads and private
credentials. They must not target Production or a workstation installation.
Native audits run inside the reviewed controller and reuse the existing ready
automation credential without bootstrapping or renewing it. Runner mutation
requires an explicit disposable-project opt-in and an immutable job image.
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
[environment](../templates/project-bootstrap/wizard-environments/README.md) and
[Production](../templates/project-bootstrap/wizard-production/README.md) procedures for
those explicit operations.

Host release regression coverage invokes compiled shared Nest services through
`tests/bootstrapper/paired-native-fixture.cjs` and the existing
`tests/operations/host-*.test.cjs` suites. Docker/Git and readiness ports are
controlled fixtures; real filesystem, Git, process ownership and advisory locks
remain exercised locally. Fault matrices cover source/image authority,
pre-mutation refusals, interrupted ownership, configuration drift, cold-checkpoint
and recovery failures without building another platform for each refusal.

`tests/bootstrapper/public-controller-update.cjs` and `public-upgrade.cjs` cover
paired update, plan/apply/recovery and API-independent rollback through the shared
services. The complete quiescent-controller matrix lives in
`tests/operations/host-runtime-inspection.test.cjs`. Public upgrade fixtures select
the matching release checkout version, including historical publications; they
never infer database-migration proof from a newer checkout.

The paired pin-preservation scenario also rolls back its exact retained pair,
so it does not build an identical successful update in a separate rollback
smoke test. Stopped-repair success asserts that routes, authenticated Sync and
runner contacts all execute after startup. One post-start readiness failure
checks the retained lease/journal boundary; the direct native runtime tests
exercise wrong Wizard routes and stale runner contacts without repeating a
whole repair for each remote readiness port.
