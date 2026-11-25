# Reviewed GitLab CE security transition

`security-release.json` declares one reviewed GitLab CE transition and its matching
Runner upgrade, including immutable public image references and upstream
advisory links. It does not choose an arbitrary latest image or skip GitLab's
supported upgrade path.

The full System candidate starts the previous release with synthetic existing
state. It proves a real runner/registry pipeline, a cold recovery, then a database
upgrade and preservation of repositories, users, issues, merge requests,
discussions, encrypted variables and registry blobs. A new job consumes a
pre-upgrade registry blob on the new version. Finally, the candidate restores its
verified cold checkpoint and the previous image; reverting an image alone is
not a database rollback. These are disposable tests, not a live-data migration.

## Operation runtime

The existing `system-bootstrapper gitlab-maintenance` commands use the controller-side
[GitLabUpgradeModule](operations/gitlab-upgrade.md). Prepare the
committed operations runtime before entering maintenance. The module shares its
validated session service with programmatic callers and retains the existing
private owner, checkpoint and guardian journal formats. The native watchdog remains a separate process; shared native PostgreSQL probes
inspect database state. Neither a package download nor a runtime build is part
of recovery.

## Supported transition

The profile selects **GitLab CE 19.5.3 → 19.6.1** and **Runner/Helper
19.5.1 → 19.6.0**. GitLab published the stable CE patch on November 20, 2026;
its official container includes the Ruby fix for CVE-2026-132825. The Runner
release cycle is separate: the matching stable 19.6 Runner and x86_64 Helper
are both 19.6.0. All six references include registry-verified immutable digests.

The [required 19.5 stop](https://docs.gitlab.com/update/upgrade_paths/)
is already satisfied by the supported baseline. No intermediate minor version
is required. Earlier installations must first complete their own accepted
upgrade path to 19.5.3; this profile does not skip older required stops.
The native preflight refuses unfinished background migrations in **every
configured database**, including failed or paused work, before stopping writers.
After startup it also requires ordinary and post-deployment migrations to be up.
Resolve pending work on the current version; do not bypass these checks. See
[background migrations](https://docs.gitlab.com/update/background_migrations/).
Although the 19.6.1 patch adds no migrations to 19.6.0, this transition crosses
from 19.5 and retains all migration checks.

Review [19.6 upgrade notes](https://docs.gitlab.com/update/versions/gitlab_19_changes/#upgrade-to-196)
for operator customizations: bundled NGINX rejects zero-size buffers and applies
stricter IP certificate checks; new API and pipeline limits can affect workloads.
The repository's GitLab configuration uses generated NGINX configuration without
custom server snippets. Test any operator additions separately before promotion.
Do not disable security limits to make migration checks pass.

[Runner compatibility](https://docs.gitlab.com/runner/#gitlab-runner-versions)
requires matching major/minor versions; the
[Helper must match its Runner](https://docs.gitlab.com/runner/configuration/advanced-configuration/#helper-image).
The existing candidate migration checks all four managers, their identities,
Helper images and a job reading a pre-upgrade registry blob. It then restores
the old checkpoint and Runner/Helper pair within the same platform run.
A passing unit test is not evidence that this real migration ran.

Before maintenance, retain a current matching configuration backup and completed
Seed, plus the cold checkpoint made by this procedure. Installing the new
controller or opening the Wizard must preserve saved image selections; only an
explicitly confirmed upgrade changes them. Keep the old accepted controller and
its tools for older checkpoint formats and release-specific recovery.
Downtime includes clean shutdown, checkpoint copying, migrations and service
verification; its duration depends on data size and pending work. No fixed
completion time is promised. Rollback loses writes after the checkpoint and
requires restoring data, secrets, configuration and matching images together.

## Official public release upgrade

For an unchanged official 1.2.0 installation, follow the
[native public 2.0.0 procedure](RELEASES.md#native-upgrade-from-120-to-200).
The public CLI validates published provenance and the installed release, retains
preparation inputs and pulls the accepted target helper before maintenance. It
runs the same GitLab upgrade services in a one-shot container while retaining
the old controller. Its full helper image/container identity, original controller,
mounts and operation ownership are checked before mutation. It does not require
access to the publisher's private GitLab pipeline artifacts. The default internal
upgrade path still requires the running tested candidate; this explicit helper
is not a general bypass for an arbitrary controller or image.

After GitLab promotion, pass the returned host checkpoint directory to the paired
release plan. Pair recovery does not rewind the database. If a later database
rollback is required, complete paired recovery first and supply its completed
checkpoint explicitly to the retained GitLab preparation. Keep the accepted helper,
offline CLI, both checkpoints and matching configuration/Seed backups. Status can
inspect the retained operation even if the original controller has been replaced.

## Manual accepted-source production operation

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

Options and pipeline evidence JSON are limited to 4 MiB each. The checkpoint
manifest has a separate 64 MiB limit because its checksum inventory grows with
the number and path lengths of retained files. The same bound is enforced before
publishing and when reading the manifest; file contents remain separate copied
data, not embedded JSON. An oversized inventory stops promotion before the new
image starts and before a completed checkpoint is recorded. Keep the partial
copy for inspection and use the interrupted-operation procedure below to resume
the old generation; do not remove its leases manually or retry with an
unreviewed larger limit.

Before planning or entering downtime, pull all six exact image references from
the committed release metadata: `fromImage`, `toImage`, `runner.fromImage`,
`runner.toImage`, `runner.fromHelperImage` and `runner.helperImage`. These cover
the previous and target GitLab, Runner and Helper images. The helper verifies
their local immutable identities; it does not download images during downtime.

```sh
docker exec -w /system system_bootstrapper_1 \
  system-bootstrapper gitlab-maintenance plan /state/upgrade-options.json

docker exec -w /system system_bootstrapper_1 \
  system-bootstrapper gitlab-maintenance promote /state/upgrade-options.json PLAN_SHA256
```

The plan binds the source and evidence hashes, existing container identity,
configuration hash and exact image IDs. Promotion acquires owned upgrade,
Harvest/Seed, certificate and Wizard environment leases before checking that
Sync and GitLab have no active work. It then drains and stops GitLab’s internal
NGINX, Workhorse and Puma HTTP services. With API ingress confirmed down, native
and external managers cannot claim new jobs or register another runner. A final
native database job check detects an assignment already in flight: in that case the old
HTTP service is resumed without stopping the database, cancelling jobs or taking
a checkpoint. Existing runner paused states remain unchanged. Sync blocks
mutations while retaining login,
Fetch and status. A clean GitLab shutdown precedes the checksum-inventoried cold
checkpoint. The copied directories and checkpoint ancestors are made durable
before the completion receipt and before the new image can write any data.

The helper updates the saved `GITLAB_IMAGE` and `GITLAB_RUNNER_IMAGE` assignments
and the managed runners' helper image; the Cube remains exact.
The helper starts GitLab, waits for the expected version, readiness, completed
migrations and idle jobs, then regenerates routing with repository entry points.
The command returns `checkpointSha256`. The checkpoint and private
`operation.json` remain available below the selected directory.

## Interrupted operation and recovery

```sh
docker exec -w /system system_bootstrapper_1 \
  system-bootstrapper gitlab-maintenance status /state/upgrade-options.json
```

If shutdown or checkpoint creation failed before a complete checkpoint exists,
resume the previous generation with the recorded plan hash:

```sh
docker exec -w /system system_bootstrapper_1 \
  system-bootstrapper gitlab-maintenance abort /state/upgrade-options.json PLAN_SHA256
```

Once a complete checkpoint exists, use its recorded hash for restoration:

```sh
docker exec -w /system system_bootstrapper_1 \
  system-bootstrapper gitlab-maintenance rollback /state/upgrade-options.json CHECKPOINT_SHA256
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
