# Reviewed GitLab CE security transition

`security-release.json` declares one reviewed same-minor transition, including
immutable public image references and upstream advisory links. It does not choose
an arbitrary latest image or skip GitLab's supported upgrade path.

The full System candidate starts the previous release with synthetic existing
state. It proves a real runner/registry pipeline, a cold recovery, then a database
upgrade and preservation of repositories, users, issues, merge requests,
discussions, encrypted variables and registry blobs. A new job consumes a
pre-upgrade registry blob on the new version. Finally, the candidate restores its
verified cold checkpoint and the previous image; reverting an image alone is
not a database rollback. These are disposable tests, not a live-data migration.

## Manual production operation

Run the host-side controller-promotion workflow first to stage the exact tested
full System image. The GitLab upgrade command executes inside that controller,
invoked from a host terminal independently of GitLab CI. Stopping GitLab must not
terminate its own deployment job. This single-node procedure requires downtime.

The accepted candidate `results.json` and options are private operator inputs,
mode `0600`. The evidence must identify the exact source revision, controller and
GitLab image IDs, passing migration/registry/rollback stages and successful owned
resource cleanup. Obtain it from the authenticated successful pipeline for the
reviewed source. A locally invented JSON file is not independent pipeline proof.

Create `/state/upgrade-options.json` through the persistent configuration mount:

```json
{
  "sourceRevision": "<full tested System source revision>",
  "evidence": "/state/accepted-candidate-results.json",
  "stateDir": "/state",
  "persistentDir": "/operator/mounted-data/platform",
  "checkpointDir": "/state/gitlab-upgrades/unique-operation-name",
  "readyTimeoutSeconds": 900
}
```

`persistentDir` is the operator's actual host path, not an example to copy
unchanged. `checkpointDir` must be a new directory below `/state/gitlab-upgrades/`.
The checkpoint contains private database, repositories, registry and GitLab
secrets plus the original saved configuration and Sync authentication file.
Ensure enough data-volume space for it and retain an independent off-volume backup.

Pull both exact `fromImage` and `toImage` references from the committed release
metadata before promotion. The helper verifies their local immutable identities;
it does not download a new version during downtime.

```sh
docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js plan /state/upgrade-options.json

docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js promote /state/upgrade-options.json PLAN_SHA256
```

The plan binds the source and evidence hashes, existing container identity,
configuration hash and exact image IDs. Promotion acquires owned upgrade,
Harvest/Seed, certificate and Wizard environment leases before checking that
Sync and GitLab have no active work. It then drains and stops GitLab’s internal
NGINX, Workhorse and Puma HTTP services. With API ingress confirmed down, native
and external managers cannot claim new jobs or register another runner. A final
Rails job check detects an assignment already in flight: in that case the old
HTTP service is resumed without stopping the database, cancelling jobs or taking
a checkpoint. Existing runner paused states remain unchanged. Sync blocks
mutations while retaining login,
Fetch and status. A clean GitLab shutdown precedes the checksum-inventoried cold
checkpoint. The copied directories and checkpoint ancestors are made durable
before the completion receipt and before the new image can write any data.

Only the intended `GITLAB_IMAGE` assignment changes; the Cube remains exact.
The helper starts GitLab, waits for the expected version, readiness, completed
migrations and idle jobs, then regenerates routing with repository entry points.
The command returns `checkpointSha256`. The checkpoint and private
`operation.json` remain available below the selected directory.

## Interrupted operation and recovery

```sh
docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js status /state/upgrade-options.json
```

If shutdown or checkpoint creation failed before a complete checkpoint exists,
resume the previous generation with the recorded plan hash:

```sh
docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js abort /state/upgrade-options.json PLAN_SHA256
```

Once a complete checkpoint exists, use its recorded hash for restoration:

```sh
docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js rollback /state/upgrade-options.json CHECKPOINT_SHA256
```

The helper rejects an active owner or foreign operation. An owned interrupted
operation is adopted only after its process and any journaled local child process
group have exited. A separate bounded watchdog finishes or terminates local copy
work even if the invoking helper is killed. Remote GitLab service quiescence has
a recorded monotonic deadline; recovery waits for that deadline before resuming
services. Do not remove locks or
startup barriers manually. Investigate unavailable/corrupt ownership records
before making another change.

Rollback discards post-checkpoint writes. It requires all replacement-container
writers to stop, verifies the checkpoint before copying, and restores GitLab
configuration, secrets, repository/registry/database data and the saved settings
with the corresponding old image. A failed successor that exited with an error
or OOM is recoverable; a still-running writer is not. During an interrupted copy,
the durable restore marker prevents ordinary startup. The marker is removed only
after checksum-based copies, an exact SHA-256/metadata inventory comparison and
destination-directory durability barriers finish. Equal file sizes and timestamps
do not establish that migrated database bytes match the checkpoint.

A successful GitLab promotion does not by itself update the independent host
recovery manifest. Publish the new tested controller/source and GitLab image
selectors through the repository recovery-export workflow before replacing the
host. Keep the pre-upgrade checkpoint until the successor and its recovery
artifacts have been accepted.
