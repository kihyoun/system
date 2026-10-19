# Build and verify the imported Wizard

Managed CI activation builds and verifies a candidate after
[source initialization](WIZARD_SOURCE.md). Build activation preserves the running
Wizard. Review/Beta use separate
[manual environment jobs](../project-bootstrap/wizard-environments/README.md);
Production uses the guarded [operator promotion command](../project-bootstrap/wizard-production/README.md).

## Preview and activate

For the complete browser procedure, see
[Build and check the Wizard manually](HANDBOOK.md#build-and-check-the-wizard-manually).
The prerequisites include a prepared source package in the matching System
image, the registered managed project, an available project registry, and a
reviewed runner accepting the `docker` tag with Docker/Buildx and registry
access. Check physical disk/RAM headroom before starting; this workflow builds
application and browser images and should not compete with other infrastructure
builds on a constrained host. No additional project runner is required when the
shared runner already meets these conditions.

Use matching System/Wizard versions, complete source initialization and configure
the platform's GitLab registry. Connect to Sync, Fetch the managed project and
expand its row. Choose **Build and verify Wizard** to inspect the owned
repository, imported commit and managed recipe version.

Opening this preview changes no repository files or pipelines. **Enable build
pipeline** explicitly confirms the previewed recipe hash. The asynchronous
operation installs the separate managed recipe, preserves upstream publishing
files and starts or recovers the recorded initial pipeline. Production remains
unchanged. Closing a pending preview is safe; dismissal is disabled during the
activation request. **Refresh status** retrieves the recorded pipeline/checks
through the same job polling contract.

## Status and safe continuation

| State | Action |
| --- | --- |
| Activation reserved / recipe installed | Refresh status, or review a fresh preview and explicitly resume activation. |
| Pipeline running | Inspect the pipeline or refresh status later. |
| Required checks failed | Inspect or retry the failed jobs in GitLab, then refresh the same operation. |
| Candidate verified | The controller has verified required checks and matching immutable artifact evidence; Production is unchanged. |
| Pipeline outcome requires reconciliation | Refresh only. An administrator must inspect the durable operation/checkpoint and GitLab before repair. Never clear the checkpoint blindly. |
| Verification failed | Prior artifact claims are hidden. Inspect the error and refresh; review a fresh preview before explicitly resuming when safe. |

**Resume activation** is offered only for pending, recipe-installed or
verification-failed state after a fresh preview. A status request or failure
invalidates the previous preview confirmation; **Refresh preview** obtains a new
one. The server's ownership, expected-content and durable pipeline checks remain
authoritative. A button does not bypass them. Uncertain creation never offers a
second blind activation.

The image reference is displayed only for `candidate-verified`, not merely a
successful pipeline status or a previously cached artifact. Failed verification
hides it immediately. Ordinary source import must not be used to upgrade an
already enabled build recipe.

## Inspect the pipeline and candidate evidence

Use **Open pipeline** in the dialog to inspect the recorded operation rather
than starting a new pipeline from GitLab. The managed CI configuration is
`.system-bootstrapper/ci.yml`; the preserved upstream `.gitlab-ci.yml` is not
activated by this action.

| Job | Work and evidence |
| --- | --- |
| `build:wizard` | Installs the committed lockfile, runs the selected toolchain checks, publishes the candidate, and records the source commit, pipeline ID and immutable registry digest in `build-evidence.json`. |
| `test:wizard` | Pulls that immutable image, checks HTTP and browser rendering/Projects/SPA navigation, then records matching identity in `wizard-evidence.json`; `browser-evidence/` contains browser results and a screenshot. |

Each job has a 30-minute timeout. The configured artifact retention is seven
days. A browser screenshot alone does not verify the source/image identity, and
a successful image push alone does not prove the browser checks passed. Both
required jobs and their matching artifact claims must verify before the
controller displays **Verified candidate image**. The reference uses
`registry/repository@sha256:…`; a mutable tag is not equivalent evidence.

Refresh status after a job retry in the same pipeline. Do not manufacture a
replacement artifact or clear the operation checkpoint after evidence expires
or verification fails. Inspect the reported error and use only the guarded
continuation offered by a fresh preview, or request administrator reconciliation.
Record the pipeline/commit/image identity when retaining acceptance evidence;
keep configuration, credentials and tokens out of reports.

The build recipe has build and test stages only. Installing the separate
environment recipe adds manual Review/Beta jobs. Neither recipe enables a
Production deployment job; Production promotion requires an explicit operator
plan and confirmation.

## Controller API

All routes require the existing Sync bearer authentication:

| Route | Contract |
| --- | --- |
| `GET /projects/wizard/build` | Read-only repository/source/recipe preview and saved build state. |
| `POST /projects/wizard/build` | Explicit `{recipeHash}` activation; returns an asynchronous job. |
| `GET /projects/wizard/build/status` | Safe asynchronous refresh, or `not-activated` without creating a pipeline. |
| `GET /projects/jobs/:id` | Existing polling endpoint; completion returns `{build,message}`. |

Runner/startup operations and other project mutations are guarded. Repeated
requests for this build's own active operation return its existing job. Status
refresh does not install files or create pipelines.

## Toolchain profiles

New source imports with Vite select the `node24-vite8-overview-v3` profile: the
pinned Node 24/npm toolchain, locked install, lint, Vitest, TypeScript/Vite build,
configuration-export checks and Playwright browser checks. Browser evidence
includes rendered UI, Projects, SPA navigation, a configuration ZIP and exact
Cube validation. Use `wizard/package.json` and the managed recipe for the exact
pinned versions.

The overview profile preserves the modern cleanup-v2 toolchain and changes only
browser navigation. It verifies **Getting Started**, Overview/Wizard switching,
preserved workspace selection and the **Open Wizard** action when those controls
are present; earlier modern source keeps its direct-workspace checks. To deliver
the new navigation from an existing managed project, first perform its guarded
build/environment-only upgrade with the explicit private option
`"buildProfile": "node24-vite8-overview-v3"`. Both cleanup-v2 profiles and their
predecessors retain their exact historical hashes.

Reserved historical recipes remain verifiable by their exact hash, including
legacy Node 13/CRA/Jest recipes. Historical compatibility does not make that
obsolete toolchain appropriate for a new project. Upgrading an imported
project requires the guarded [source/toolchain migration](../project-bootstrap/wizard-upgrade/README.md);
changing a controller image does not rewrite an existing reservation. A
build/environment-only upgrade is available when source is already modern and
must retain local development.

## Verification

The isolated API, recipe and adapter fixtures check explicit confirmation,
continuation, failure/status presentation, ownership and mutation guards:

```sh
node tests/wizard/build-recipe.js
node tests/wizard/build-workflow.js
ruby tests/gitlab/wizard-build.rb
```

These fixtures do not contact the running GitLab. Complete integration checks
also need a real owned project, successful required jobs, matching immutable
registry artifacts, browser evidence and job-owned resource cleanup. Inspect
actual pipeline results before promotion; a candidate artifact alone is not a
Production rollout. Keep tokens and private configuration out of reports.
