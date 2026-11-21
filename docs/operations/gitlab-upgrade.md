# GitLab upgrade operations

`GitLabUpgradeModule` exports `GitLabUpgradeService`. Import this controller-side
feature after preparing the operations runtime in the reviewed System checkout.
`create(options)` validates the existing upgrade input and returns an isolated
session with `plan`, `promote`, `abort`, `rollback` and `status`. A service singleton
never shares mutable owner state between sessions. HTTP adapters and CLI handlers
can use the same service; this module does not expose a new HTTP endpoint.

Official public-release upgrades use the host entry
`dist/modules/host/public-gitlab-prerequisite-entry.js` (CLI:
`system-bootstrapper gitlab-upgrade`). Its `--operation prepare` downloads and
validates the target's public release metadata and provenance, verifies the
installed official release, owned mounts and source checkout, and retains all
GitLab, Runner, Helper and target controller images before maintenance. It creates
private inputs under an explicit `--directory` below
`PERSISTENT_DIR/configuration/gitlab-prerequisites/`; operators do not invent
candidate evidence or edit the preparation JSON.

`plan`, `promote`, `abort` and `rollback` invoke this same session in a one-shot
accepted target-image helper. The running previous controller stays in place.
The helper shares its network and verified state mounts, and uses the host PID
namespace so subsequent helpers can reconcile durable process/guardian identities.
Its writable layer is fresh: platform and application proxy addresses are
reconstructed from the existing owned containers before planning or maintenance.
Application proxy records follow the saved environment selections; reconstruction
does not create, stop or replace application containers. A missing, stopped or
foreign enabled proxy fails before routing changes. Generated address files are
ephemeral runtime state, not another backup input.
The shared evidence guard requires the exact candidate image on the helper, its
full container ID, preparation label, network, PID mode and mounts, while retaining
the original controller's full identity, mounts, labels and restart policy.
Controller source or Node overlays and inherited Node/preload options cannot
replace the helper runtime. Internal candidate commands retain their original
requirement that the running controller itself is the accepted candidate.

Promotion requires `--confirm-plan` from `plan`; abort uses that same hash.
Rollback requires `--confirm-checkpoint` from promotion. The existing cold
checkpoint and operation formats remain unchanged. Every command reports the
host `checkpointDir`; supply that exact path to the public paired upgrade's
`--gitlab-checkpoint`. Read-only `status` uses retained receipts even after the
original controller is gone, without a running helper or backup medium.

After a paired controller/Wizard rollback has recreated the controller, cold
GitLab rollback additionally requires its explicit `--paired-checkpoint` path.
The adapter verifies the completed paired rollback, target source, previous image,
configuration hash, passing verification, original mounts and restart policy
before binding a new helper to the restored controller's full ID. A changed
container name alone grants no recovery authority. Retain the reviewed checkout,
public preparation, image payloads and both checkpoints for offline recovery.

The workflow coordinates separate runtime/readiness, runner, checkpoint and
lease/guardian services. Pure policy preserves approved pins, the exact Cube and
legacy assignment formats. Checkpoint reads remain bounded at 64 MiB; options,
evidence and ordinary private inputs retain their smaller limits. The checkpoint
service owns both snapshot publication and restoration, including checksums,
metadata, fsync, the incomplete-restore marker and saved secrets.

`system-bootstrapper gitlab-maintenance` creates a standalone Nest context and
uses the same upgrade capabilities as controller and candidate callers. Controlled
transports are injected through the module's typed ports. All operation dependencies must already
be present before maintenance; recovery does not install packages or rebuild.

The guardian retains the shared upgrade, storage, environment and certificate
barriers and the existing owner/child journal formats. It does not unlock an
uncertain migration, adopt a live owner, or remove another operation's barriers.
The native compiled GitLab upgrade watchdog remains a separate process so it
can finish or terminate an owned process group even if the invoking controller
helper dies. Process arguments, environment and output are never included in
public errors. The shared `GitlabPreflightService` reads package identity and generated database topology, then uses native embedded `psql` read-only transactions for every configured primary database and CI jobs;
configuration uses the shared literal parser, and in-container service control
uses native argument arrays rather than generated shell programs.

If the bounded readiness wait expires, its error retains the last unmet gate:
`upgrade-readiness-timeout-restarting`, `-http`, `-jobs`,
`-background-migrations` or `-database-migrations`. A healthy Docker container
alone does not satisfy these checks. The public helper preserves only approved
fixed error codes after verifying the failed helper's identity and exit status;
it does not expose subprocess output or configuration. Inspect the retained
operation and use its documented recovery path. A readiness failure does not
release maintenance leases or prove that promotion completed.

Readiness distinguishes Docker's explicit `removing` transition from a terminal
`dead` state: removal may set `Dead=true` before the old container disappears.
Removal never satisfies readiness and uses the existing bounded wait. OOM,
terminal exits and genuine dead states still fail immediately; native GitLab
readiness continues to require the exact selected image before waiting.

Native command failures use a finite `upgrade-command-<stage>-<kind>` diagnostic.
The stage distinguishes SQL, private connection-file preparation, package/configuration
reads, schema status and lifecycle commands. The kind distinguishes a nonzero exit,
timeout, signal or supported launch/output failure. These labels identify the failed
boundary; they do not disclose command arguments, SQL, environment or output, and do
not retry a failed command or increase its deadline. The existing private
supervision records retain the worker/watchdog phase and numeric exit code;
that code can be normalized to 1 for a launch failure or signal.
On a failed candidate promotion, the existing platform harness also retains the
owned child journal's phase and numeric exit code before normal cleanup. This is
a bounded, read-only diagnostic snapshot, not another SQL or readiness check;
it never turns a failed stage into acceptance evidence.

GitLab and runner startup use the shared lifecycle service through thin adapters
under the watchdog. The child verifies the inherited operation against all
shared owner records and its live parent identity, preserves the watchdog's
process group and leaves the parent barriers intact. Routing uses the existing
typed routing entry point. These child boundaries deliberately preserve durable
supervision across a controller failure.

From the repository root, after preparing dependencies and building operations:

```sh
node tests/gitlab/upgrade.js
node --test tests/gitlab/upgrade-module.js tests/gitlab/upgrade-recovery.js tests/gitlab/upgrade-child.js
node --test tests/bootstrapper/lifecycle.js
```

These checks cover injected migration failures, real filesystem copying and
restore, bounded input handling, Nest wiring, ownership and native child-group
recovery. They do not run a GitLab database migration. The existing disposable
candidate migration/registry/cold-restore gate remains the end-to-end acceptance
boundary described in `docs/GITLAB_UPGRADE.md`.

The shared preflight is also available as
`system-bootstrapper gitlab-preflight FULL_CONTAINER_ID` for read-only
maintenance checks. Use the full inspected ID of the owned, running GitLab
container. The result contains only version, edition and counts. It is evidence
at that instant, not a lease or permission to mutate the platform.

The probe parses GitLab's generated `database.yml` with bounded YAML aliases;
it requires explicit PostgreSQL `main` and `ci` entries and queries each distinct
primary database. `database_tasks: false` does not exclude a live CI connection.
Dynamic configuration commands, ERB, unsupported topology, missing tables,
authentication failures and malformed counts fail closed. The probe copies configured
connection user, password and TLS parameters into an exclusive container-local
0700 temporary directory using stdin, with 0600 libpq service/password files.
The embedded `psql` runs as GitLab's configured Rails OS user (read from the
installed `gitlab-rails-rc`, resolved to numeric UID/GID), preserving Omnibus's
Unix-socket peer mapping. The private files are owned by that identity before
query execution. A clean environment prevents ambient `PG*` credentials/options
from overriding the selected configuration. It uses those settings without an
interactive password prompt;
credentials never enter command arguments or public results. The exact temporary
directory is removed after the probe, including failures. Password files preserve
spaces and escape colons/backslashes; CR/LF/NUL in credentials and service values
that cannot be represented exactly in libpq's line-based format are rejected.
Each SQL transaction is read-only with a 45-second server statement timeout.
The probe does not mint API credentials. It counts
`Ci::Build` rows in `p_ci_builds` with preparing, running or canceling status;
unclaimed and completed jobs are excluded. Migration status follows GitLab's
[documented unfinished migration query](https://docs.gitlab.com/update/background_migrations/).
Upgrade and promotion callers supply their existing guarded command port, so
preflight does not create a competing lease or process-ownership protocol.

The shared `GitlabDatabaseService` prepares private libpq service/password files
for the configured primary databases and runs embedded `psql` as GitLab's configured
service account. It preserves database TLS settings and clears inherited libpq
configuration. Callers close the session after all its database processes settle;
a long-lived ownership session must retain its private files until that point.
`GitlabDataSampleService` reuses this connection policy for bounded identity
samples and obtains repository heads through authenticated read-only GitLab API
requests. Its result contains only a digest, scope and project count, not sampled
record contents. The caller supplies its existing authenticated transport; sampling
never creates or rotates credentials.
