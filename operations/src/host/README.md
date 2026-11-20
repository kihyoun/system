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

`bootstrapper/install-release.py` is a transport compatibility entry for the same
compiled implementation. Remaining Python update consumers use its fixed helper
RPC; image inspection commands remain native adapters and all validation decisions
are TypeScript. The documented CLI flags remain accepted. No arbitrary code or
shell command is accepted by the compatibility RPC.

Prepare the supported Node runtime and compiled operations package before offline
maintenance. Neither compatibility entry installs packages or compiles sources.
Run `npm run build` from `operations/` during preparation, then run
`node --test operations/tests/host-install.test.cjs` from the repository root.
The historical `python3 tests/bootstrapper/public-release.py` test entry runs that
same suite. Tests use temporary files, real Git objects and real local flock
exclusion, with Docker and service startup supplied by synthetic process ports.

`guardian.ts` owns a host command group independently of its coordinator. It
retains the inherited advisory-lock descriptor, publishes PID/start-time/boot-ID
and process-group identity before permitting execution, checks ownership before
signaling, drains descendants even after a successful leader exit, and publishes
the existing `system-host-child-v1` completion journal. The worker start permit is
bounded at 15 seconds, command timeout at the existing maximum of 1800 seconds,
and group cleanup at 10 seconds. Captured output is bounded to 4 MiB. A canceled
or failed guardian leaves its journal for the existing adoption checks.
`bootstrapper/host-child.py` only execs this precompiled guardian, preserving the
inherited lock descriptor. Existing real process-interruption tests run with
`python3 tests/bootstrapper/successor-host-tools.py HostChildInterruption`.

`RecoveryManifestService` verifies retained archive checksums, unique aliases,
recorded Git objects and saved selectors. A newer host-tools checkout does not
reinterpret the recorded deployment: historical gitlinks remain commit identities
and monorepo manifests require the exact Wizard tree in both source and controller
archive records. Checksums-only legacy manifests cannot start services.

`RecoveryImageService.restore` reconstructs declared image aliases and verifies
public digests from the accepted manifest. Docker's native compressed-archive
reader streams `load --input` directly, avoiding an intermediate uncompressed
file or a separate gzip child. Its 900-second load bound never exceeds a supplied
remaining operation deadline. A failed load cannot proceed to tagging. Existing
Python recovery callers forward to these services; retained paired-checkpoint
rollback orchestration remains with its existing coordinator.
