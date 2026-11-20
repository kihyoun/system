# Host lifecycle and persistence

`HostLifecycleModule` supplies the standalone host start/stop services and the
persistence preflight. Use the prepared Node runtime with
`operations/dist/cli.js start --checkout /absolute/reviewed/source` or `stop`.
The CLI requires an explicit absolute checkout; `bootstrapper/persistence.js`
also invokes this module. Prepare the supported runtime and compiled operations
before use, including during offline recovery; these entries do not install
dependencies.

`HostPersistenceService` validates the explicitly selected local or volume-backed
filesystem, mount identity, optional UUID, canonical paths, free space and POSIX
filesystem before creating directories. Existing ownership markers and symlinks
are checked before mutation. Check-only leaves storage unchanged. Seed storage is
independent and is neither mounted nor initialized by normal startup. Existing
private SSL data keeps its permissions; only traversal and the public HTTP-01
challenge directory receive their required public modes.

`HostLifecycleService` reads the private host selector before saved configuration,
rejects unfinished operation leases, verifies live storage and reads immutable
public release image defaults as data. Saved main configuration may deliberately
override those image defaults. Host-selected live and backup storage remain
authoritative after configuration import. Only an explicit source-build selection
prepares Wizard source and requests a Compose build. Stopping drains the running
controller before bringing its Compose service down; a failed drain prevents that
second step and reports failure.

The shared literal-assignment parser reads existing exported configuration values;
variable expansion and command execution are rejected.
External commands use argument arrays and bounded process adapters. Long Compose
commands and source preparation use owned process groups with cancellation; the
compatibility entry forwards SIGINT/SIGTERM and closes its Nest context. A failed
or interrupted start does not erase persistent data or an operation lease.

The existing `tests/persistence/persistence-guard.test.js` checks mount refusal,
local/volume selection, free space, symlink boundaries, marker handling and file
permissions. `tests/persistence/persistence-start.test.js` checks the public native
entry in an isolated container, including saved selectors and immutable images.
`operations/tests/host-lifecycle.test.cjs` covers stop ordering, failed-drain
preservation and side-effect-free Nest composition. These tests use synthetic
mount/Compose adapters; real platform behavior is covered by the existing
candidate acceptance suite.
