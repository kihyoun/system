# Controller and runner lifecycle

`LifecycleModule` exports the controller and runner services. The native
`system-bootstrapper lifecycle ACTION CHECKOUT` entry maps controller and
runner start/stop/register commands to a standalone Nest context. Runner actions retain
the native registration flock. The services share the persistent storage/startup
barrier and verify inherited startup ownership before reusing it.

Controller startup initializes mounted state and public Wizard settings before
starting writers. It starts GitLab, completes private Wizard image recovery,
configures project proxies, attempts runner setup and starts the Wizard. A failed
runner registration leaves the management interface available; failed image
recovery prevents subsequent writers. Main routing uses `ProjectsRoutingService`
directly. Existing image-recovery, initial-password and public-settings helpers
retain their dedicated contracts; the lifecycle service invokes their individual
bounded entry points rather than chaining old service shell scripts.

Sync and default-Wizard registration use the prebuilt shared backend runtime. Build
the root backend package before starting a controller; startup never downloads npm
packages or rebuilds the runtime. The foreground Sync child has no wall-clock deadline. Each
asynchronous native command owns a separate process group. SIGINT/SIGTERM cancel
that group, wait for it to settle and escalate only that owned group when needed.
Uncertain startup completion retains the existing durable barrier. A busy
controller waits without starting writers until an operator deliberately restarts
it after recovery. Clean Sync completion stops services in order. Shutdown attempts
remaining services after an error and reports incomplete shutdown as a failure.

Runner pools retain isolated configuration/home mounts and registrations on stop.
Compose generation remains the external JSON format adapter. Readiness, instance
provisioning, saved token comparison, endpoint refresh, verification and registration
are service decisions. Registration sends credentials through standard input, never
argv or captured diagnostic output. The original token replacement preserves every
Cube byte; project Review/Beta/Production behavior is unchanged.

`node --test tests/bootstrapper/lifecycle.js` runs injected orchestration tests and a
native child/process-group cancellation check. Existing storage-operation tests
also exercise the native controller entry point while a lease is held and after
settled startup failure. These checks do not start Docker or register live runners.

An inherited GitLab upgrade is a special owner: runner children remain inside the
already journaled upgrade process group. The caller supplies
`SYSTEM_GITLAB_UPGRADE_OPERATION`; the entry point requires matching operation,
PID and start time in the three existing upgrade/storage/environment owner records
and verifies that the owner is a live ancestor. An unverified environment token
never bypasses the shared lease. This preserves the upgrade watchdog's descendant
termination boundary.
