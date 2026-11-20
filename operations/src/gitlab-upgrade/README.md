# GitLab upgrade operations

`GitLabUpgradeModule` exports `GitLabUpgradeService`. Import this controller-side
feature after preparing the operations runtime in the reviewed System checkout.
`create(options)` validates the existing upgrade input and returns an isolated
session with `plan`, `promote`, `abort`, `rollback` and `status`. A service singleton
never shares mutable owner state between sessions. HTTP adapters and CLI handlers
can use the same service; this module does not expose a new HTTP endpoint.

The workflow coordinates separate runtime/readiness, runner, checkpoint and
lease/guardian services. Pure policy preserves approved pins, the exact Cube and
legacy assignment formats. Checkpoint reads remain bounded at 64 MiB; options,
evidence and ordinary private inputs retain their smaller limits. The checkpoint
service owns both snapshot publication and restoration, including checksums,
metadata, fsync, the incomplete-restore marker and saved secrets.

`gitlab/upgrade.js` is a compatibility adapter. Its synchronous `Upgrade`
constructor delegates to the same capabilities so existing controlled test and
candidate adapters keep their process/image injections. CLI execution creates
and closes a Nest application context. All operation dependencies must already
be present before maintenance; recovery does not install packages or rebuild.

The guardian retains the shared upgrade, storage, environment and certificate
barriers and the existing owner/child journal formats. It does not unlock an
uncertain migration, adopt a live owner, or remove another operation's barriers.
The native `gitlab/upgrade-child.js` watchdog remains a separate process so it
can finish or terminate an owned process group even if the invoking controller
helper dies. Process arguments, environment and output are never included in
public errors. The shared `GitlabPreflightService` reads package identity and generated database topology, then uses native embedded `psql` read-only transactions for every configured primary database and CI jobs;
configuration uses the shared literal parser, and in-container service control
uses native argument arrays rather than generated shell programs.

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
boundary described in `gitlab/UPGRADE.md`.

The shared preflight is also available as
`node operations/dist/gitlab-preflight/entry.js FULL_CONTAINER_ID` for read-only
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
