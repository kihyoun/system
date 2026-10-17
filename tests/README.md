# Component tests

Tests are grouped by the infrastructure component they exercise. JavaScript,
Bash, Python and Ruby are retained where useful; language uniformity is not a
goal. The component runner executes only the isolated manifest. Nothing under a
`live/` directory is discovered or executed automatically.

## Reproduce the isolated CI checks

From a clean checkout, with Docker available:

```sh
docker build -f tests/Dockerfile -t system-component-tests .
docker run --rm --network none system-component-tests all
docker run --rm --network none system-component-tests sync
```

Do not mount a Docker socket, private configuration, host network or platform
volumes. The image contains an explicitly selected source snapshot, Node
24.22.0 with its bundled npm, Bash/core utilities and the committed Sync lockfile.
It installs with `npm ci --ignore-scripts` and calls TypeScript directly: the
legacy `npm run build` prebuild hook fixes source files and is intentionally
not used. This test runtime does not migrate the production Sync runtime; that
is tracked separately in [System issue 23](https://github.com/kihyoun/system/issues/23).

The Node image is pinned to an exact release tag rather than `latest`. Debian
base rebuilds can still change that tag; it is not a claim of byte-identical
images. The dependency tree comes from the lockfile, and compilation fails if
the lockfile and package manifest become inconsistent.

Inside this disposable Linux environment the stable entry point is:

```sh
SYSTEM_TEST_ISOLATED=1 node tests/run.js all
SYSTEM_TEST_ISOLATED=1 node tests/run.js gitlab
```

Other selectors are `sync`, `gitlab-runner`, `bootstrapper`, `nginx`, `wizard`
and `shared`. Checks are explicit in `manifest.json`, run sequentially, and have
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

The root GitLab pipeline runs the same entry point as seven component-named
matrix jobs in a required `test` stage before the existing `build` and `deploy`
stages. The platform's existing runner mounts a Docker socket into its jobs and
sets privileged mode. Merely disabling Docker-in-Docker services does not remove
that authority. Therefore each CI job is a **trusted parent** using pinned
`docker:29.9.1-cli`, `services: []` and the existing `docker` runner tag. It calls
`sh tests/ci-isolated.sh <component>` to build the Node test image, then starts a
child with `--network none`, no socket/host mounts, no privilege flag and no
inherited CI credentials. Source enters through the image build context; reports
leave through `docker cp`, avoiding the incorrect assumption that a CI checkout
path also exists on the daemon host. No new runner is provisioned.

Resource names include numeric CI project/job IDs. The script copies reports
before returning the child's exit code, removes its exact container/image on
normal exit, failure and trapped cancellation, and repeats cleanup from GitLab
`after_script`. The eight-minute script timeout leaves time within the ten-minute
job for the one-minute cleanup budget. Abrupt runner/host loss or SIGKILL can
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
| `seed-cycle.py` | `seed/seed-cycle.py` | Harvest/restore in temporary mounts, empty and incomplete seed cases; Python 3, Docker, explicitly prepared `system_bootstrapper` image | <2min |

`shared/runner-contract.js` adds harness acceptance for passing/failing child
processes, enforced timeouts and persistent escaped reports. It uses only
synthetic fixtures and does not require a service. `shared/ci-parent-contract.js`
uses a fake Docker transport to verify failed-candidate exit propagation,
artifact copying before exact-resource cleanup, socket-free child arguments and
rejection of unsafe CI resource IDs.

## Live/disposable integration boundary

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
