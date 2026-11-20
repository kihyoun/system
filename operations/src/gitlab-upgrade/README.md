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
public errors. The Ruby preflight remains the GitLab-native database adapter;
shell configuration loading and in-container service commands retain their
external format boundaries.

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
