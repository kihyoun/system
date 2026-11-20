# Operation boundaries and recovery

The operations package is a shared TypeScript/Nest runtime, not another server.
The public npm CLI exposes `install`, `harvest`, `restore`, `start`, `stop` and
`persistence`; host commands require an explicit reviewed checkout. The other
entries below are repository/controller commands.
Sync authenticates its HTTP callers on port `8071` and delegates through services
or compatibility entries. A standalone Nest context alone grants no authority
and performs no deployment. Prepare the pinned Node runtime, compiled code and
dependencies [before host operations](../Prepare-Host.md#prepare-the-host-operations-runtime).

## Entry points and execution authority

Paths in the table are relative to the repository root. Native Docker socket
access is host-administrative authority, including when used inside a controller
or helper container. JWT authentication is the HTTP boundary; it does not turn
Docker operations into unprivileged work. CI publishers instead require their
explicit protected job identities and scoped publisher credentials.

| Capability and service | Public or compatibility entries; callers | Authority and persistent ownership | Native work and failure/recovery boundary |
| --- | --- | --- | --- |
| Host startup: `HostLifecycleModule`, `HostLifecycleService`, `HostPersistenceService` | `operations/dist/cli.js start/stop --checkout PATH`, `bootstrapper/persistence.js`; host operators and installation/recovery tools | Root on the selected host; private persistence/release selectors; live-data `configuration` directory and existing storage/upgrade startup barriers | Docker/Compose, `findmnt`, filesystem probes and literal-assignment configuration loading. Refuse missing/misdirected volumes and unfinished operations. Retained release selectors disable source builds. Stop requests controller shutdown before Compose teardown. |
| Accepted installation and host storage: `HostModule`, `HostInstallService`, `HostStorageService` | `system-bootstrapper install/harvest/restore`; `bootstrapper/install-release.py`, `bootstrapper/seed-operation.js`; native host operators | Root, explicit reviewed checkout, accepted image pair and private persistence selector; host initialization flock, installation receipt and `.release-images.env` | Git and Docker/image inspection; storage enters the accepted controller helper with an explicit host mount. Refuse existing data for fresh install and ambiguous source/image identities; check-only performs preflight, not a backup. |
| Controller storage: `StorageModule`, `StorageService` | `system/harvest.sh`, `system/seed.sh`, `system/seed-operation.js`, `system/seed-manifest.js`, `system/coordinated-backup.js`; Sync `/command/harvest`, `/command/seed`, `/command/backup` and backup status/download routes, plus host dispatch | Controller/helper Docker access and explicit live/Seed mounts; shared `.storage-operation-lock`, environment/certificate exclusion, helper/image identity, completed Seed manifest and configuration association | Docker, rsync and filesystem checks. Harvest requires a clean stop, checksummed durable publication and a selected completed snapshot; restore checks fresh destinations and matching image/Seed. Uncertain copy/startup retains barriers and incomplete-restore evidence. Configuration ZIP remains a separate recovery input. |
| Configuration Push: `ConfigurationModule`, `ConfigurationService` | `system/push.sh`; Sync `/config/zip`, with `/config/impact` review | Authenticated controller operation; routing flock, durable storage/startup and Wizard environment barriers; server-owned receipt and exact main/project bytes | Bounded unzip/rsync and direct routing service call. Validate archive, aliases and optional impact fingerprint before replacement. Failed apply restores saved inputs; uncertain completion or failed rollback keeps barriers. Parent restore reuse requires its exact existing owner. |
| Controller/runner lifecycle: `LifecycleModule`, `LifecycleService`, `RunnerLifecycleService` | `system/start*.sh`, `system/stop*.sh`, `gitlab/start.sh`, `gitlab-runner/{start,stop,register,unregister}.sh`; controller startup, Sync restart/runner commands and upgrade guardian | Controller Docker/state access; persistent startup lease, runner registration flock and saved runner identities. Inherited startup/upgrade tokens must match recorded ownership | Compose, GitLab Rails provisioning and prebuilt Sync. Runner failure leaves management available; image-recovery failure blocks later writers. Sync has no wall-clock deadline. Cancellation owns child groups; verified upgrade children stay in the journaled parent group. Partial shutdown is failure, not success. |
| Routing: `ProjectsRoutingModule`, `ProjectsRoutingService` | `nginx/start.sh`, `nginx/stop.sh`, `nginx-proxy/` and application-routing adapters; Push, lifecycle and deployment callers | Controller Docker access; saved aliases, owned environment fragments, routing flock and generation-specific proxy state | Compose, template files and container-side NGINX validation/reload. Targeted application changes preserve proxy generations. Failed reload restores prior templates/address records; recovery routing exposes only the declared recovery services. |
| Project deployment and environments: `ProjectLifecycleModule`, `EnvironmentModule`, `CanonicalModule` | `project-bootstrap/wizard-environments/{run.sh,helper.js,canonical.js,cleanup-stopped.js}` and source-transfer adapters; project CI, owned helpers and Sync project setup | Exact project/environment/generation/image authority; canonical controller environment mutex, reservations, binding history, generation floors and tombstones | Git, Docker, registry/API/TLS reads and routes. Deploy/health/switch is transactional; rollback preserves the previous route. Stale/foreign ownership cannot deploy or remove another generation. Ordinary application Review/Beta/Production remains separate from System Beta. |
| Project setup and source: `PreviewOperatorModule`, `AdoptionModule`, `UpgradeModule` | `project-bootstrap/preview-setup/run.js`, `wizard-source-primary/run.js`, `wizard-upgrade/run.js`; operator commands and shared Sync `/projects/wizard/*` setup/producers | Explicit setup/adoption confirmation, accepted installation/source evidence, private archives and locked compare-and-swap configuration writes | Git/GitLab source transfer, repository receipts and build recipe staging. Refuse changed authority or conflicting user edits. Source-primary changes preserve Production; source/build upgrades do not grant Production promotion. Historical source layouts keep their recorded identities. |
| Wizard Production: `ProductionModule`, `ProductionService` | `project-bootstrap/wizard-production/run.js`; deliberate operator promotion/recovery | Exact reviewed plan, immutable image and checkpoint authority; canonical configuration/ownership and retained previous generation | Docker/registry and routing adapters. Apply, rollback and crash recovery use the same checkpoint; source binding alone does not authorize Production replacement. |
| System candidate Beta: `SystemBetaModule`, `SystemBetaService` | `project-bootstrap/system-beta/{bind.js,run.js}`; explicit binding command and protected default-branch manual jobs | Existing monorepo binding, exact candidate/pipeline/source and fixed host; canonical receipt and owned helper/container labels | GitLab authority verification, Docker and TLS/routing. Reuse the accepted Wizard image without another build. Deploy/stop refuse foreign or stale authority. `system-review/run.js` is retained only for owned legacy Stop/cleanup; no new System Review binding. |
| Native GitLab upgrade: `GitLabUpgradeModule`, `GitLabUpgradeService` | `gitlab/upgrade.js plan/promote/status/abort/rollback`; explicit controller maintenance and disposable migration acceptance | Accepted native migration evidence and reviewed plan/checkpoint hash; upgrade/storage/environment/certificate barriers, PID/start-time owner and child journal | GitLab Rails/Ruby, Docker, rsync and native watchdog. Quiesce scheduling before final job check and cold stop. Abort only before completed checkpoint; rollback restores matching cold data/secrets before the old image. Live owners/children and uncertain work block adoption/unlock. |
| CI publication: `ReleaseModule`, `ReleaseService`, `GithubPublicationService`, `NpmPublicationService` | `gitlab/publish-successor.js`, `publish-dockerhub.js`, `publish-github-release.js`, `public-upgrade-release.js`, `package-cli.js`, `publish-npm.js`; protected GitLab jobs | Same-attempt native source/job/image evidence, frozen artifacts and explicit publisher credentials; immutable image tags, release assets and npm integrity | Git, Docker/registries, GitLab/GitHub HTTP and npm. Publish accepted bytes without rebuilding. Conflicting immutable versions/assets fail; retries require exact identity. Private temporary credentials are removed on failure as well as success. Publication never promotes the running installation. |

## Host upgrade and recovery coordinators

`HostModule` also provides source/release authority, recovery-manifest/image and
runtime-inspection services. `bootstrapper/promote-controller.py`,
`update-controller.py`, `upgrade-release.py`, `recovery.py`,
`record-recovery-images.py` and `verify-runtime.py` remain the documented host
entry filenames. Their typed capabilities include cold maintenance, staged
controller promotion, controller update/rollback, public paired-upgrade planning
and application, and lifecycle journal transitions. They share the existing host
flock, durable lease, retained source/image payloads and private operation receipts.

Critical interruption retains the lease and checkpoint for inspected recovery.
The host guardian records boot/PID/start-time/process-group identity and retains
its inherited advisory-lock descriptor. It drains owned descendants, including
those left by a successful leader. Unknown or still-active ownership is not a
license to retry. Public Controller/Wizard rollback restores that pair; it does
not reverse GitLab's database migration. The paired upgrade prerequisite requires
the separately completed native GitLab transition and retained cold checkpoint.

These are mixed-language boundaries, not a claim that every Python file is a
transport shim. Installed-release inspection, public host/mount preflight,
backup-status polling/native archive streaming, pre-mutation promotion/paired
setup and status/recover wrappers still have Python responsibilities. Fixed
`NativePortChannel` messages request only the supplied adapter operations; they
are not arbitrary shell or code execution. Consult the [host component guide](src/host/README.md)
and [controller guide](../bootstrapper/README.md) for command-specific inputs.

## Bootstrap, native dependencies and supervision boundaries

- **Before Node exists:** `tools/quickstart/quickstart.sh` prepares the pinned,
  checksum-verified Node runtime and verifies the tested bundled npm CLI tarball.
  It installs that artifact offline with lifecycle scripts disabled, then delegates
  host setup to Nest. Source developers prepare dependencies/builds before
  lifecycle calls. Package/image construction is not offline maintenance.
- **Host OS and recovery:** `HostBootstrapModule` owns initialization, package
  installation, volume recovery, certificate installation/renewal and runtime
  verification through typed services. `bootstrapper/initialize.js`,
  `recover-volume.js`, `install.js`, `install-runtime.js` and certificate entries
  invoke those services using the prepared runtime. Root, private receipts,
  initialization/certificate locks and explicitly selected mounted storage remain
  required. No fallback formats or moves a missing live volume.
- **GitLab authentication transition:** the initial temporary administrator token
  requires a minimal Rails invocation inside GitLab. Native services own token
  lifecycle and provisioning orchestration; any remaining Rails provisioning or
  inspection adapter is a migration boundary, not an exemption for own scripts.
  Literal configuration readers never execute shell expansions. Direct upstream
  image entrypoints remain dependency interfaces, including NGINX template
  rendering; owned routing reload and rollback are typed services.
- **Independent guardians:** `gitlab/upgrade-child.js` and the typed host guardian
  must survive their invoking coordinator long enough to settle or terminate the
  journaled child group. They are process-supervision boundaries, not duplicate
  deployment workflows.
- **Build context and historical recipes:** `wizard-source/package.js` and
  `prepare.sh` package committed source; GitLab source preparation/publishing and
  documentation tools act during builds/CI. Reserved `wizard-build` recipes,
  hashes and cleanup generations identify installed user projects. Replacing
  their exact bytes with runtime-dependent wrappers would break adoption and
  compatibility. New monorepo source is ordinary `wizard/`; old gitlink receipts
  remain separate commit identities.
- **Offline documentation:** `DocumentationModule` exports the shared
  `DocumentationExportService`. The thin `node docs/export-wizard-docs.js [--check]`
  authoring entry bundles complete Markdown and local images using
  `docs/wizard-docs-catalog.json`. Build the pinned operations package first.
  The independent source-packaging check needs no installed package dependencies;
  existing Docs component acceptance checks the native exporter as well.

## Verification map

Use the [component harness](../tests/README.md) and its manifest/resource leases.
The following are focused entry points, not permission to run several disposable
platforms at once or to replace existing acceptance gates.

| Boundary | Existing reproducible checks | What they establish |
| --- | --- | --- |
| Host lifecycle/install/storage | `operations/tests/host-lifecycle.test.cjs`, `host-install.test.cjs`, `host-module.test.cjs`; `tests/persistence/persistence-start.test.js`; `tests/bootstrapper/public-release.py` | Input/storage/image refusal, native filesystem/flock handling and injected service startup. |
| Harvest/restore/configuration | `operations/tests/storage-*.test.cjs`; `tests/persistence/storage-operation.test.js`, `persistence-push.test.js`; `tests/sync/routing-push-api.js` | Serialization, durable copy/manifest checks, matched inputs, authenticated Push and rollback. |
| Controller/runners/routing | `tests/bootstrapper/lifecycle.js`; `operations/tests/projects-routing.test.cjs`; `tests/nginx/typed-routing.js`, `routing-rollback.js` | Startup ordering, native child/group cancellation, owner reentrancy and route rollback with controlled service transports. |
| Project source/environment/Production/Beta | `tests/wizard/environment-{helper,canonical,launcher}.js`, `production-promotion.js`, `in-place-upgrade.js`, `source-primary-adoption.js`, `source-installation.js`, `system-beta.js`, `system-beta-launcher.js` and legacy System Review tests | Identity, stale generation/foreign resource refusal, source preservation, confirmation, cancellation and recovery. See the [project module guide](src/project-lifecycle/README.md) for related API/producer tests. |
| GitLab upgrade | `tests/gitlab/upgrade.js`, `upgrade-module.js`, `upgrade-recovery.js`, `upgrade-child.js`; `tests/shared/gitlab-upgrade-contract.js` | Module wiring, real local copy/restore, process-journal recovery and injected migration failures; no live database migration in these unit/contract checks. |
| Host promotion/public upgrade | `tests/bootstrapper/successor-host-tools.py`, `public-controller-update.py`, `public-upgrade.py`; `operations/tests/host-*.test.cjs` | Journal/lease adoption, native guardian interruption, retained authority and controlled rollback/refusal paths. |
| Publication | `operations/tests/release.test.cjs`; `tests/gitlab/publish-successor.js`, `publish-dockerhub.js`, `publish-github-release.js`, `public-upgrade-release.js`, `npm-publication.js` | Accepted-byte/source identity, immutable retries, credential cleanup and injected failure cases; no live publication. |

Actual Docker/GitLab/registry/TLS and database transitions belong to the existing
[disposable candidate acceptance](../tests/e2e/README.md). Its
[guided Beta boundary](../tests/e2e/GUIDED_PREVIEW_ACCEPTANCE.md) distinguishes real
owned lifecycle/TLS from contract authorization fixtures while the parent pipeline
is still running. Passing a local module test does not produce native candidate
or public-release authority, and passing a candidate does not itself approve
Production promotion.
