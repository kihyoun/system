# Component tests

Tests are grouped by the infrastructure component they exercise. JavaScript,
Bash, Python and Ruby are retained where useful; language uniformity is not a
goal. The component runner executes only the isolated manifest. Nothing under a
`live/` directory is discovered or executed automatically.

## Reproduce the isolated CI checks

From a clean checkout, with Docker available:

```sh
git submodule update --init --recursive
node project-bootstrap/wizard-source/package.js
node tests/prepare-context.js
docker build -f tests/Dockerfile -t system-component-tests - < .test-context/context.tar
docker run --rm --network none system-component-tests all
docker run --rm --network none system-component-tests sync
```

Do not mount a Docker socket, private configuration, host network or platform
volumes. Snapshot/context preparation requires Node, Git and tar in the trusted checkout;
`bash project-bootstrap/wizard-source/prepare.sh` is the documented host fallback
when Node is absent. The candidate image contains the validated snapshot, never
the real checkout's Git metadata. It combines digest-pinned Node 24.22.0/npm
11.19.1 and Ruby 3.4.11 on the same Debian Bookworm/glibc family. Its full Ruby
base supplies Git, Bash/core utilities and the shared libraries required by Node;
the build prints runtime versions and `ldd` output. No Alpine binary is copied
into a Debian runtime.

The test context contains only an explicit allowlist of files from the current
**committed** Git tree plus the validated Wizard snapshot matching its gitlink.
It omits ignored/untracked files, dirty working-copy changes, runtime/private
paths and real Git metadata. Binary contents and executable modes are retained.
The generated `.test-context/` directory records the source revision, selected
paths and archive checksum. Commit intended source changes before preparing it;
there is no fallback to sending the whole checkout. This test-specific contract
does not change the application's main Docker context or private-config behavior.

The image installs the committed Sync lockfile with `npm ci --ignore-scripts`
and runs the migrated `npm run build`: supported ESLint now checks without
autofix before TypeScript compilation. Its ESLint configuration is explicitly
copied into the image. The Sync migration is tracked in
[System issue 23](https://github.com/kihyoun/system/issues/23).

Runtime images are pinned by exact release **and digest**. The dependency tree
comes from the lockfile; inconsistent manifests fail installation. Ruby 3.4 is
in [normal maintenance](https://www.ruby-lang.org/en/downloads/branches/); this
fixture runtime does not replace the Ruby bundled inside GitLab.

Inside this disposable Linux environment the stable entry point is:

```sh
SYSTEM_TEST_ISOLATED=1 node tests/run.js all
SYSTEM_TEST_ISOLATED=1 node tests/run.js gitlab
```

Other selectors are `sync`, `gitlab-runner`, `bootstrapper`, `nginx`, `wizard`
`shared` and `performance`. Checks are explicit in `manifest.json`, run sequentially, and have
per-check time limits. A failed, canceled or timed-out check returns a nonzero
runner exit status. The runner terminates the check's process group, including
an isolated Sync child, and writes reports after each completed check. A runner
SIGKILL cannot write new reports; the container boundary cleans up its processes.

The API checks intentionally bind port **8071** in their private network
namespace. Never execute them directly on a running platform host. The runner
requires the explicit isolation flag, rejects private runtime configuration and
a mounted Docker socket, and checks that the port is free before API tests.
These checks are guardrails; the disposable container is the isolation boundary.
The NGINX test renders `/templates` only inside that container.

JSON results and GitLab JUnit reports are written to `test-results/<selector>/`.
To retain local reports, mount only a new, empty output directory:

```sh
mkdir -p test-results
docker run --rm --network none \
  -v "$PWD/test-results:/candidate/test-results" system-component-tests all
```

The root GitLab pipeline first runs a required `prepare:wizard-source` job in a
digest-pinned Node/Git image with a recursive submodule checkout. It packages the
exact Wizard gitlink and validates the resulting source snapshot. It then creates
the minimal committed test archive. These artifacts are passed to downstream
test-image builds; the test jobs
themselves do not need real submodule Git metadata. A missing submodule/object or
invalid snapshot fails preparation rather than testing an arbitrary fallback.
The Docker parent verifies the archive checksum and requires its recorded
revision to equal `CI_COMMIT_SHA` before contacting Docker. Missing, damaged or
stale context artifacts fail the job. A local wrapper invocation must likewise
provide the expected full commit ID; the direct archive build above is simpler
for ordinary local use.

Seven component-named matrix jobs then run the same entry point in a required
`test` stage before the existing `build` and `deploy` stages. The platform's
existing runner mounts a Docker socket into its jobs and
sets privileged mode. Merely disabling Docker-in-Docker services does not remove
that authority. Therefore each CI job is a **trusted parent** using
digest-pinned `docker:29.9.1-cli`, `services: []` and the existing `docker` runner tag. It calls
`sh tests/ci-isolated.sh <component>` to build the Node test image, then starts a
child with `--network none`, no socket/host mounts, no privilege flag and no
inherited CI credentials. Only the verified archive enters the build through
stdin; reports
leave through `docker cp`, avoiding the incorrect assumption that a CI checkout
path also exists on the daemon host. No new runner is provisioned.

Resource names include numeric CI project/job IDs. The script copies reports
before returning the child's exit code, attempts exact container/image removal
on normal exit, failure and trapped cancellation, and repeats cleanup from GitLab
`after_script`. The eight-minute script timeout leaves time within the ten-minute
job for the one-minute cleanup budget. Each cleanup command is bounded to eight
seconds. Successful absence is distinguished from daemon/removal errors, which
produce visible diagnostics and separate `test-results/cleanup/on-exit.json`
and `after-script.json` records. Cleanup failure changes an otherwise successful
script to failure while preserving an existing test/build exit code. GitLab does
not use an `after_script` failure to change the primary job result, so its separate
log/status record remains important. Abrupt runner/host loss or SIGKILL can
prevent both traps and `after_script`; labeled residual resources then require
operator cleanup. Shared BuildKit cache is ordinary daemon build cache, not a
separate clean platform-generation environment.

No live platform credentials are passed to the child. The parent retains the
existing runner's host Docker authority and is intended for trusted repository
code. This is not a security boundary for hostile merge requests on a shared
privileged runner. Upstream image publishing destinations and job roles remain
unchanged. This configuration must still be exercised on the intended GitLab
runner; local container evidence alone is not a claim that a remote pipeline
has passed.

## Inventory and old-to-new path map

Durations below are approximate budgets for a warm local container, not measured
service-level promises. The manifest supplies the enforced isolated timeout.
Every old path below was directly under `tests/`.

| Old file | Current path under tests/ | What it checks / prerequisite | Expected duration |
| --- | --- | --- | --- |
| `gitlab-root-password.js` | `gitlab/root-password.js` | Isolated password file generation, mode, persistence, existing-database protection; Node/POSIX filesystem | <1s |
| `gitlab-startup.sh` | `gitlab/startup.sh` | Isolated changed/unchanged GitLab startup with fake Docker/Compose; Bash/core utilities | <2s |
| `application-templates.js` | `gitlab/application-templates.js` | Angular/React/web source, locked dependencies, generated CI and Cube signature; compiled Sync | <2s |
| `project-bootstrap.js` | `gitlab/project-bootstrap.js` | Validation, conflicts, idempotency, async jobs/auth/Fetch with private files, fake transport and private Sync process; compiled Sync/Bash | <10s |
| `config-suggestions.js` | `sync/config-suggestions.js` | NGINX/host suggestion precedence, unknown hosts and secret exclusion; compiled Sync | <1s |
| `config-suggestions-api.js` | `sync/config-suggestions-api.js` | Auth, saved-config precedence, runner mutation guards and error redaction; private Sync process on 8071/Bash | <5s |
| `runner-provision.js` | `gitlab-runner/provision.js` | Literal token update and unchanged signature; Node | <1s |
| `runner-endpoint.js` | `gitlab-runner/endpoint.js` | Managed stable endpoint migration without token/external-host changes; Node | <1s |
| `runner-startup.sh` | `bootstrapper/runner-startup.sh` | Wizard startup remains available after fake runner failure; Bash | <1s |
| `default-wizard-routing.sh` | `nginx/default-wizard-routing.sh` | One actual Wizard route and no duplicate runner/proxy resources; private `/templates`, fake Docker/Compose, compiled Sync/Bash | <2s |
| `default-wizard.js` | `wizard/default-wizard.js` | Default registration/receipt/restart, Production URL, Push preservation, conflicts and signature; compiled Sync/fake Docker/Bash | <3s |
| `project-bootstrap-live.js` | `gitlab/live/project-bootstrap.js` | Explicit project provisioning, repeated Save, ownership conflict, Fetch; disposable platform, Sync credentials/payload, Docker/GitLab Rails | 1–10min |
| `project-bootstrap-audit.rb` | `gitlab/live/project-bootstrap-audit.rb` | Private identity, CI lint/signature, revoked setup PAT; disposable GitLab Rails, fixed `root/bootstrapdemo` fixture | 1–3min |
| `application-templates-live.js` | `gitlab/live/application-templates.js` | Creates three starter projects and initial pipelines; disposable Sync, credentials and project payload; writes `/tmp/template-live-results.json` | 1–20min |
| `application-templates-live-audit.rb` | `gitlab/live/application-templates-audit.rb` | Repository/source/pipeline/environments audit, optional failed-job retry; disposable GitLab Rails/API and encoded result payload | 1–20min |
| `runner-live.py` | `gitlab-runner/live/runner.py` | Real runner pipeline/artifact, Fetch signature and PAT revocation; Python 3, disposable `system_*` containers and localhost routes | 1–20min |
| `default-wizard-live.js` | `wizard/live/default-wizard.js` | Real default registration, URL/signature, same repo on repeat; compiled Sync/disposable platform credentials | 1–10min |
| `registry-smoke.gitlab-ci.yml` | `registry/registry-smoke.gitlab-ci.yml` | Explicit disposable-project CI example for build/push/pull/run; Docker socket runner/registry credentials | 1–10min |
| `seed-cycle.py` | `seed/seed-cycle.py` | Completed cold Harvest/restore, checksums, version/edition, failure/resume, renewal lease and path rebinding; Python 3, Node and rsync, fixture Docker command | <2min |

`shared/runner-contract.js` adds harness acceptance for passing/failing child
processes, enforced timeouts and persistent escaped reports. It uses only
synthetic fixtures and does not require a service. `shared/ci-parent-contract.js`
uses a fake Docker transport to verify failed-candidate exit propagation,
artifact copying before exact-resource cleanup, socket-free child arguments and
rejection of unsafe CI resource IDs.

`shared/source-context.js` verifies committed-only inputs, private/untracked and
dirty-file exclusion, binary/mode preservation, validated snapshot inclusion,
and stale-snapshot/link refusal. The parent contract additionally checks context
checksums/revisions before Docker, failed cleanup visibility, preserved primary
failure, absent resources and unreachable-daemon reporting.

The integrated manifest also includes these checks, with the same process/time
limits, component output and JUnit reporting:

| Path under tests/ | Scope and prerequisites | Timeout |
| --- | --- | --- |
| `sync/migration-api.js` | Private Sync process on 8071; JWT authentication/refresh and multipart configuration round trips after Express migration | 30s |
| `wizard/source-package.js` | Git-created disposable repositories; pinned/binary/mode preservation, dirty/private-file exclusions and path/hash/link rejection using Helper bytes from the validated source snapshot | 30s |
| `wizard/source-workflow.js` | Compiled Sync, prepared snapshot and fake Rails transport; preview, locks, durable receipt/retry/conflict behavior | 30s |
| `wizard/source-api.js` | Compiled Sync/snapshot; private ephemeral HTTP listener, explicit forbidden shell/container transports; auth, preview, initialization, polling and mutation guards | 30s |
| `gitlab/source-import.rb` | Ruby standard library and in-memory GitLab API adapter; source/CI conflicts, binary/mode import and interrupted-commit recovery; no Rails/server/network | 20s |
| `gitlab/wizard-build.rb` | Ruby standard library and in-memory GitLab adapter; owned recipe activation, commit/pipeline identity, durable creation intent, interrupted recovery, duplicate prevention and artifact verification | 20s |
| `wizard/build-recipe.js` | Compiled Sync Helper and committed recipe files; deterministic hashes, immutable signature, legacy lockfile/Jest/build commands, browser recipe and absence of deployment jobs | 20s |
| `wizard/build-workflow.js` | Compiled Sync and fake Rails transport; confirmed preview, asynchronous operation deduplication, source/build receipt identity, status-only refresh, stale artifact removal and concurrent-edit refusal | 30s |
| `wizard/build-api.js` | Compiled Sync, private HTTP listener and forbidden shell/container transports; authentication, explicit recipe confirmation, job polling/deduplication, mutation guards and honest recovery/failure states | 30s |
| `wizard/build-cleanup.js` | Linux shell/core utilities and fake Docker transport; exact owned resources, absent versus unreachable daemon, removal failure and preserved primary exit status | 30s |

These five Phase-B fixtures are registered under the GitLab/Wizard component
selectors and use the same isolated runner/JUnit reports. Their transport doubles
do not create a real GitLab pipeline, push a registry image or run a browser.
Fresh legacy installation/build, rendered browser evidence and real GitLab
pipeline/registry acceptance remain separate gates under
[System issue 33](https://github.com/kihyoun/system/issues/33). Run the expanded
manifest against the exact prepared Wizard pin before recording a passing
combined CI result; an earlier nineteen-check run does not cover these additions.

The Ruby import fixture moved from `tests/wizard/source-import.rb` to the GitLab
component because it exercises that adapter. The shared runner selects `ruby`
for manifest entries ending in `.rb`; live Rails audits remain excluded. All
fixture Git repositories are created and cleaned inside the disposable child.

## Live/disposable integration boundary

The reusable [disposable candidate lifecycle](e2e/README.md) now provides an
explicit private-daemon driver, temporary configuration, bounded smoke readiness,
ownership-checked cleanup and sanitized JSON/JUnit receipts. Its additional
`shared/disposable-candidate-contract.js` manifest fixture runs entirely offline;
it does not start DinD. A privileged full-platform run and root CI integration
remain pending resource review and separate acceptance evidence.

`wizard/live/build.js` is a separate, explicit managed-Wizard acceptance driver,
never an isolated-manifest entry. Run it only in an operator-prepared candidate
controller with a private copy of the intended configuration and an explicitly
authorized managed GitLab repository. Set `SYSTEM_WIZARD_LIVE_ACCEPTANCE=true`
and `SYSTEM_WIZARD_EXPECTED_PROJECT` to that repository's numeric ID. Supply Sync
credentials privately through the candidate environment, never in the command
line or test logs. The driver imports source and enables real CI in that exact
repository; it is not a read-only probe. It never calls deployment, Reset, Seed,
Push or restart endpoints. It verifies authenticated Fetch signatures, source
and initial-pipeline identity on repetition, required checks/digest, and the
unchanged Production address. Evidence stays in the candidate's private
`/tmp/wizard-build-live-evidence.json`; the driver has a 65-minute overall budget.
The driver refreshes the twenty-minute access token proactively at eighteen
minutes and retries an authentication-failed GET at most once. Source/build
POSTs are never blindly replayed. Pipeline polling uses the same 65-minute
overall deadline rather than a shorter fixed poll count. The offline regression
`node tests/wizard/acceptance-driver.js` checks long-running polling, refresh and
refresh refusal, GET recovery, mutation non-replay, resumed source import,
pipeline/Production identity changes and the overall deadline using transports
that perform no network calls or evidence-file writes.
The operator must independently check the existing Production service and
preserve any receipt needed to recover the same operation. This proves neither
MR failure behavior nor Review, promotion or rollback by itself.

The live checks are preserved for a future disposable-platform adapter. Several
still use fixed `system_*` container names, localhost routing, temporary paths,
prepared payloads and an externally prepared image. They are **not** safe to
point at a production or workstation platform and are not yet portable CI jobs.
The Ruby scripts run inside GitLab's bundled Rails runtime, not a separate Ruby
installation on the runner. Python checks require Python 3 on the disposable
test driver. Their exact runtime pins and environment orchestration belong to
the remaining integration work, not the isolated image above.

No command in the isolated manifest creates repositories, issues PATs, registers
runners or runs real Docker. Production UI, registry and persistent-data
acceptance remain unverified by this suite. A CI YAML example is not evidence of
an executed registry scenario.

Continue [System issue 21](https://github.com/kihyoun/system/issues/21) with an
explicit candidate-platform harness: candidate image construction, unique
networks/ports/volumes, readiness and temporary credentials, scenario adapters,
failure/cancellation cleanup and real pipeline evidence. That issue stays open
until the complete acceptance criteria pass. Coordinate new Wizard checks with
the [workflow implementation](https://github.com/kihyoun/system/issues/18);
add their isolated paths to the manifest only after agreeing prerequisites and
timeouts. Do not add live checks by glob discovery.

## Managed Review and Beta

The Phase C delivery is tracked in [issue 39](https://github.com/kihyoun/system/issues/39).
Its eight manifest entries are `gitlab/environment-upgrade.rb`,
`wizard/environment-recipe.js`, `wizard/environment-helper.js`, `wizard/environment-canonical.js`,
`wizard/environment-launcher.js`,
`wizard/environments-workflow.js`, `wizard/environments-api.js` and
`nginx/environment-routing.sh`. They use fake GitLab/Docker transports and a
private API listener, never a real Docker socket or platform configuration.
They exercise explicit optional settings, authentication, readiness/recovery,
expected-content CI upgrades, MR lease and stale-job protection, owned cleanup
and preservation of the primary Wizard route. See the
[operating guide](../project-bootstrap/wizard-environments/README.md).
Live manual-job/HTTPS acceptance remains a separate explicit operator gate.

## Full-System image gate

The required `test:candidate-image` job builds `system/Dockerfile`, not only the
standalone base. Preparation writes `.candidate-context/` from committed runtime
blobs and the validated Wizard snapshot matching the committed gitlink. Wizard
files are materialized from that snapshot; checkout dirt, ignored files, private
configuration and Git metadata are excluded. Both context packagers support GNU
and BusyBox tar. The image installs the pinned Sync lockfile and compiles Sync
during the build. A socket-free, network-disabled child verifies the resulting
compiler/lint/runtime/Compose and source-snapshot contracts. The job records the
source commit, exact built image ID and JUnit result and removes its job-scoped
container and image on exit and `after_script`.

Reproduce packaging with `node tests/prepare-candidate.js` after preparing the
Wizard snapshot. Build with `docker build -f system/Dockerfile -t
system-candidate:local - < .candidate-context/context.tar`. This is image/runtime
acceptance; the separate private-daemon scenarios remain explicit.

The additional required `test:platform-candidate` stage runs the explicit full
private-daemon driver after the isolated matrix and full-image gate. It builds
Wizard/System from their committed inputs, preloads pinned service/helper images,
and exercises real private GitLab CI/registry/runner and stopped seed behavior.
See [the lifecycle guide](e2e/README.md) for the twelve-GiB resource contract,
readiness, credential revocation and exact owned cleanup. Results report each
stage; neither a YAML lint nor an offline fixture alone counts as live success.

## Maintained delivery checks

`gitlab/github-backup.js` runs with the GitLab component (60-second budget). It
checks the generated backup/synchronization definitions with disposable Git
repositories and fake transports; it does not push to GitHub or change GitLab.
`performance/resources/test_collect.py` runs with the performance component
(30-second budget), using Python 3 standard-library fixtures for passive resource
collection, parsing, reports and endpoint behavior. It performs no live load
test. The required GitLab matrix includes both checks.
