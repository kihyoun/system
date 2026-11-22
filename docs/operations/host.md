# Host release operations

`HostInstallService` implements fresh accepted-release installation without an
HTTP server. The caller supplies a process port and invokes `install(options,
checkout)`. The service checks source and image identity, selects fresh live
storage, holds the existing host initialization flock, writes private durable
image selectors and records startup success or failure. Startup uses the existing
native entry point with source builds disabled. An accepted image pair must come
from one candidate job; both classic Docker and containerd image identities are
checked against the accepted manifest/config evidence.

New source receipts use `sourceLayout: system-monorepo-v1`, `sourceCommit` for the
System commit and `wizardSourceTree` for the Wizard tree. Historical receipts keep
`wizardSourceRevision` as a separate commit. Mixed source layouts are rejected.
The existing installation receipt schema and statuses are retained.

`system-bootstrapper install --checkout /absolute/reviewed/source` invokes the
same compiled implementation through a standalone Nest context. Native CLI
handlers validate flags and delegate to shared services; source/image acceptance,
preflight, backup polling, update and recovery all remain TypeScript operations.

Prepare the supported Node runtime and compiled root backend package before offline
maintenance. Maintenance commands never install packages or compile sources.
Fresh Quickstart prepares pinned Node through its isolated nvm installation and
installs the verified bundled CLI tarball from that accepted release offline. Manual release
hosts use `tools/quickstart/quickstart.sh --runtime-only vMAJOR.MINOR.PATCH`; the retained absolute Node path
and installed package support recovery without npm or network access. Developers
can build from the repository root and run
`node --test tests/operations/host-install.test.cjs` from the repository root.
The existing operations component entry runs this suite once. Tests use temporary
files, real Git objects and real local flock
exclusion, with Docker and service startup supplied by synthetic process ports.

`guardian.ts` owns a host command group independently of its coordinator. It
retains the inherited advisory-lock descriptor, publishes PID/start-time/boot-ID
and process-group identity before permitting execution, checks ownership before
signaling, drains descendants even after a successful leader exit, and publishes
the existing `system-host-child-v1` completion journal. The worker start permit is
bounded at 15 seconds, command timeout at the existing maximum of 1800 seconds,
and group cleanup at 10 seconds. Captured output is bounded to 4 MiB. A canceled
or failed guardian leaves its journal for the existing adoption checks.
`ControllerLeaseModule` provides the same durable lease service to native host
operations and their standalone CLI adapters. Its dedicated private worker
retains the native coordinator identity; a critical failure detaches and closes
that coordinator while an active guardian retains the inherited lock. Existing real process-interruption checks exercise the shared guardian and
lease services through the operations component test entry.

`RecoveryManifestService` verifies retained archive checksums, unique aliases,
recorded Git objects and saved selectors. A newer host-tools checkout does not
reinterpret the recorded deployment: historical gitlinks remain commit identities
and monorepo manifests require the exact Wizard tree in both source and controller
archive records. Checksums-only legacy manifests cannot start services.

`RecoveryImageService.restore` reconstructs declared image aliases and verifies
public digests from the accepted manifest. Docker's native compressed-archive
reader streams `load --input` directly, avoiding an intermediate uncompressed
file or a separate gzip child. Its 900-second load bound never exceeds a supplied
remaining operation deadline. A failed load cannot proceed to tagging. The native recovery CLI invokes these same services.
`RecoveryArchiveService.save` streams the selected immutable controller image ID
through gzip into an exclusive private file. It publishes the archive only after
the export process succeeds and the file has been synced, then returns its size,
checksum and source identity. Cancellation or export failure terminates and reaps
the Docker client before removing its temporary file. Existing archives are never
overwritten. The caller holds the same maintenance lease through archive export
and manifest publication; the export itself does not stop services or publish a
recovery manifest. Its focused failure and cancellation coverage shares
`tests/operations/host-recovery-images.test.cjs` with image restoration.
`ControllerRollbackSequenceService` owns the lease-held paired rollback sequence,
including selector restoration, stopped-controller recovery and final receipt.

`HostSourceService` validates recorded source objects separately from a clean
current checkout, and checks allowed commit ancestry with Git replacement objects
disabled. `validateUpgradeGraph` and `upgradePath` share the reviewed ordered
version graph and explicit prerequisite/backup/preflight/apply/verify/recovery
steps. Unknown versions, reverse paths, duplicate edges, unsupported database
migration claims and incomplete preservation promises are refused. Host operation adapters use these implementations directly.

`RuntimeInspectionService` checks canonical container identities and health, with
an explicit failed-controller exception restricted to a quiescent owned container
without execs or a restart policy. Persistent mount verification checks every
essential destination, resolves named bind volumes, and rejects duplicate,
misdirected, cross-filesystem or escaping mounts. The native process adapter owns
Docker and `findmnt` access; imported validation functions have no side effects.

`HostModule.register()` exposes the shared services in a standalone Nest context.
Its process runner, environment, initialization guard and deadline are injectable;
constructing the context performs no host operations. `RuntimeInspectionService.images`
validates selected service IDs and declared manifest aliases through the same
native adapter. Compatibility callers supply inspection results to the pure
validator; their command budgets remain in force, while pure decisions do not
consume a native-command deadline.

For a native host CLI, resolve `HostStorageService` from `HostModule` and call
`execute` with the operation, accepted controller image, explicit checkout and
private persistence selector. It pins the inspected image ID and invokes the
accepted image with a read-only `/host` mount. Calling the in-container host
configuration reader directly on the native host does not provide this mount or
its trusted image selector and is unsupported.

The storage launch path follows the declared version inside that immutable image,
not the checkout supplied for host configuration. A read-only, network-disabled
probe reads `/system/VERSION` without mounting host data. Unknown or unreadable
image versions fail before persistence preparation or storage launch. This allows
an upgrade checkout to validate a backup through the still-installed previous
controller without calling a newer entry point that its image does not contain.

`HostReleaseAuthorityService` validates retained successor receipts and public
upgrade provenance. Explicit monorepo receipts require the full shared System
Beta policy, bound to source trees, image IDs and the actual candidate attempt.
Historical public receipts retain their original validation contract. Inject the
lifecycle policy through `HostModule.register({lifecycleEvidence})`; omitting it
fails closed for monorepo acceptance. Public provenance still requires native
successful publication, browser, candidate and component jobs. Fixture lifecycle
identifiers never replace those outer publication identities.

The 1.2.0 → 2.0.0 graph explicitly includes the GitLab 19.5.3 → 19.6.1 database
migration and Runner transition. Complete the native GitLab upgrade with its
retained cold checkpoint before planning the paired Controller/Wizard phase, then
pass `--gitlab-checkpoint` to `system-bootstrapper upgrade --operation plan`.
The plan and apply revalidate the checkpoint inventory, successful native receipt,
source identity, running GitLab/Runner image IDs and GitLab version. The paired
recovery command restores the application pair; it does not rewind GitLab. Keep
both checkpoints and use the separate native database rollback only in the
reviewed recovery sequence. The acceptance harness runs the native database
migration first, tests paired apply/offline recovery, then tests the cold database
rollback. Its future-publication envelope remains explicitly a fixture.

`ColdMaintenanceService` owns freeze, drain, ingress isolation, race checks,
clean stop and cold checkpoint sequencing. `PromotionSequenceService` and
`ControllerUpdateSequenceService` own the lease-held destructive transitions,
last-moment receipt checks, configuration replacement, Compose startup and
verification. `PublicUpgradePlanService` and `PublicUpgradeApplyService` own the
reviewed plan, exact byte confirmation, preflight order, retained images before
backup, paired apply and final data verification. `UpgradeLifecycleService`
persists phase transitions and interruption state. These services resolve through
`HostModule`, with explicit typed ports for native tools and installation context.

The native `promote`, `controller-update`, `upgrade`, `recovery-export` and
`recovery` CLI commands share these services. Installed-release inspection,
public host/mount preflight, backup-status polling, pre-mutation authority checks
and status/recover handling are part of the same TypeScript runtime. No shell or
arbitrary source is accepted over private operation channels.
`RecoveryExportService.execute` validates candidate authority, acquires the
shared lease, checks running image and saved selection identities, exports the
immutable controller image and publishes the validated manifest with its exact
previous bytes retained. Its standalone entry and the CLI map flags to that same
service. Critical interruptions retain checkpoints and owned leases for
inspection or adoption; recovery never silently rewinds GitLab data. Native
adapters retain their existing budgets.

Regression coverage uses `tests/bootstrapper/public-controller-update.cjs`,
`tests/bootstrapper/public-upgrade.cjs` and the host suites under
`tests/operations/`. These checks exercise compiled Nest services with controlled
external-tool fixtures, including failed health checks, immutable image
mismatches, interrupted updates and offline rollback. Real database migration,
registry/runner execution and cold restore remain acceptance stages in the
existing disposable platform candidate, not claims made by these fixtures.
