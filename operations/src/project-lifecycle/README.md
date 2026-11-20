# Project lifecycle runtime

These standalone Nest modules own project orchestration without changing the
Sync HTTP API. Build `operations` before invoking the compatible entrypoints in
`project-bootstrap`. Those JavaScript files load compiled TypeScript; they do not
implement a second orchestration path.

| Module / service | Owned decisions and entrypoint |
| --- | --- |
| `ProjectLifecycleModule`, `ProjectLifecycleService.execute` | Deployment transaction, health check, route switch, rollback and stopped-state handling through `DeploymentPort`. |
| `ProjectLifecycleModule`, `SourceTransferService` | Source import/export validation, pinned DNS reads, exact producer hashes and Git transfer through `SOURCE_TRANSFER_PORT`. |
| `EnvironmentModule`, `EnvironmentService` | Review/Beta runtime, immutable image verification and native Docker/route operations; `wizard-environments/helper.js`. |
| `CanonicalModule`, `CanonicalService.run` | Controller-side lock ownership, configuration compare-and-swap, reservations, generation floors, tombstones and binding history; `wizard-environments/canonical.js`. |
| `ProductionModule`, `ProductionService.run` | Promotion plan/apply, rollback and crash recovery with exact image/checkpoint authority; `wizard-production/run.js`. |
| `UpgradeModule`, `UpgradeService.run` | Wizard upgrade plan/stage and adoption, including source-preserving build upgrades; `wizard-upgrade/run.js`. This is distinct from platform GitLab upgrades. |
| `PreviewOperatorModule`, `PreviewOperatorService.run` | Status/preflight/apply CLI over injected Sync setup functions; `preview-setup/run.js`. Typed settings and producers are shared with the API. |
| `SystemBetaModule`, `SystemBetaService` | Shared-source Beta binding plan/apply and owned deploy/stop; `system-beta/bind.js` and `run.js`. The legacy System Review adapter permits owned cleanup only. |
| `AdoptionModule`, `AdoptionService.run` | Source-primary adoption and binding refresh, fresh native evidence collection, confirmation, private archives and locked configuration writes; `wizard-source-primary/run.js`. |

Sessions hold invocation-local state. Injected ports supply external operations
for tests; production adapters execute bounded commands and preserve cancellation.
Canonical writes run in the original controller with its persistent state. A
helper receives only the operation's required state, registry and Docker access;
private credentials and complete configuration are never public plan output.
Production image changes remain separate from source-primary binding changes.

Native boundaries include Git, Docker, TLS/DNS and GitLab API reads. Shared native
evidence services replace the external Ruby GitLab verifiers. Historical recipe generators and
reserved `wizard-build` shell/smoke artifacts remain format adapters: their exact
bytes identify installed recipes, including the historical cleanup-v2 recipe.
They are not replaced in place by runtime-dependent scripts. The committed-source
snapshot packer in `wizard-source/package.js` is still a build-context utility.

## Verification

Run `npm run build --prefix operations` for strict compilation and packaged assets.
The existing Node suites exercise the compatible entrypoints against controlled
ports and temporary state, including refusal and recovery paths:

- `tests/wizard/environment-helper.js`, `environment-canonical.js`,
  `environment-launcher.js` and `environments-workflow.js`: ownership, stale
  generations, cancellation, transactions and routes.
- `tests/wizard/production-promotion.js` and `in-place-upgrade.js`: confirmation,
  immutable authority, archive/recovery and source-preserving upgrade behavior.
- `tests/wizard/preview-source-transfer.js`, `preview-producers.js` and
  `preview-setup.js`: transfer identity, settings and producer contracts.
- `tests/wizard/system-beta.js`, `system-beta-launcher.js`, `system-review.js`
  and `system-review-launcher.js`: shared candidate authority, owned lifecycle
  and refusal of new legacy Review bindings.
- `tests/wizard/source-primary-adoption.js` and `source-installation.js`: fresh
  evidence, bounded private receipts, exact project identity, recipe refresh,
  mutex/compare-and-swap, preserved Production and recovery aliases.
- `tests/wizard/native-locale-messages.js`: translated public diagnostics from
  the actual typed producers against the committed Wizard catalogue.

These tests do not constitute live GitLab or deployment acceptance evidence.

## Deployment evidence

`DeploymentEvidenceModule` provides the same `DeploymentEvidenceService` to
Production promotion and the controller-side evidence CLI. It uses the shared
private GitLab credential lifecycle and bounded, local, read-only API requests;
artifact hashes are checked against their original bytes. Verification checks
canonical project/source ownership, the exact pipeline and manual job, required
native jobs, immutable image evidence and owned cleanup results. Historical System
Review remains limited to Stop of its exact existing binding. Stop does not depend
on expired build artifacts or a still-open merge request.

Environment helpers do not receive GitLab credentials or mount its configuration.
They send bounded JSON to the original controller's compiled evidence entry using
their existing Docker transport. The entry invokes this shared service, closes
its Nest context and exposes only a validated result. It does not deploy a
container. No verifier loads a separate Rails program or creates a per-check token.

The existing `node tests/gitlab/system-beta.js` contract entry consolidates System
Beta, historical Stop, Wizard Production and ordinary environment evidence checks.
The disposable platform also calls that same contract fixture on its harness;
native source/setup/deploy/stop/TLS observations remain separate evidence. A
successful fixture is not represented as a real GitLab pipeline execution.
