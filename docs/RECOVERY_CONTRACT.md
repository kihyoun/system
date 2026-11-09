# Configuration and Seed recovery

The recovery inputs remain separate: a Wizard configuration backup, a completed
Harvest Seed, and freshly fetched System source including its pinned Wizard
submodule. Configuration is not copied into Harvest, and no service-data download
is provided by the Wizard.

The Wizard imports literal shell assignments, including single/double
quotes, escaped metacharacters and equals signs. Backup preserves unmodelled
runtime settings in `main.runtimeOptions` / project `runtimeOptions`, including
image references and host port bindings. JSON and ZIP exports contain secrets;
protect them as you protect the running configuration. Shell expressions requiring
expansion or execution are rejected; provide their literal resolved values instead.
The original Cube header and its strict format validation remain unchanged.

## Recovery metadata travels with the configuration

Normal JSON backup includes `recovery`; ZIP includes the same object in
`bootstrapper.json` and `recovery.json`, plus a short `RECOVERY.md` guide. The
versioned format is `system-configuration-recovery-v1`. The repository-owned
`wizard/scripts/export-configuration.ts` executes the same Wizard model used by
Fetch/Backup, including an authenticated Fetch response's `recoveryObservation`
when available. Existing JSON/ZIP backups without these entries remain usable.

Metadata records a fresh backup timestamp and the exact saved controller, Wizard,
GitLab and Runner image settings, including explicitly unspecified settings. It
separates these from a timestamped authenticated runtime observation of running
containers and their immutable image IDs/repository digests/source labels.
A disconnected/offline export without an accompanying observation reports unknown
runtime identity; it never substitutes `latest`, invents a revision or claims that
saved settings were observed running. Source/release identities absent from image
labels/accepted selection remain unknown. A previously fetched observation keeps
its own observation time and may be older than the edited configuration.

Metadata is data only. Open does not apply its image, source, Seed or storage fields
to operational configuration. Push imports the existing ENV settings and project
files; descriptive metadata cannot start a migration or select another runtime.
The exact Cube and all runtime options continue to round-trip. Re-export after Open
retains one `importedBackup` record marked `imported-unverified`, with the original
backup timestamp and descriptive version evidence; this is historical data, not a
fresh observation. It cannot select a runtime or retain an asserted Seed match.

`recoveryTools.minimumSystemProductVersion` is `1.0.0`: use an accepted recovery-tool
controller with explicit support for this extended ZIP format and the selected
Seed. Older controllers can reject `recovery.json` / `RECOVERY.md` during native
restore. This requirement is separate from the backup's saved runtime pins:
importing old configuration and exporting a new bundle does not upgrade its runtime.
Obtain the compatible tool checkout/controller independently; do not blindly use an
old saved controller as the restore helper or substitute images in configuration.

No Seed generation or manifest is inferred from the configured backup directory.
Each configuration-only export explicitly requires a matching completed Seed:
check its generation, manifest, timestamp and exact harvested GitLab image before
recovery. An older Seed and newer configuration can be incompatible. Preserve the
bundle and Seed independently; neither implies the other is present or verified.

For a recorded accepted product release, retrieve its
[public release metadata](RELEASES.md) and fetch that exact source commit with the
pinned Wizard submodule. For a source-built/private runtime, retain its source
and verified image payloads independently. Pull exact immutable references or load
verified archives before recovery; a reference is not a saved image. The native
private-Wizard recovery path below can pull a matching image from the restored
registry, whose payload must exist in the matching Seed. Do not rebuild a missing
immutable private image and describe it as the same tested image.

## Choose the working directory and backup target

Live working data and Seed backup storage are independent. Fresh installations
use local working data on the system disk; an external target is required only
while making or reading a backup. Put the host-owned selectors in a mode-0600
file, for example `/etc/system-bootstrapper/persistence.env`:

```sh
PERSISTENCE_MODE=local
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
SEED_MOUNT=/media/bootstrapper-backup
SEED_DIR=/media/bootstrapper-backup/seed
SEED_UUID=REPLACE_WITH_BACKUP_FILESYSTEM_UUID
```

Mount the actual existing backup filesystem and create its `seed` directory
before an operation. The mount/UUID checks prevent a missing external disk from
being replaced by an accidental local directory. For local live storage, select an external backup filesystem distinct from the
system disk. Legacy volume-backed layouts may retain a disjoint Seed on their
selected retained volume. The target must be disjoint from live data; see the [storage guide](PERSISTENT_VOLUME.md). Normal startup,
configuration changes and TLS renewal do not require this medium. Deleting a VM
with local working data deletes that data, so preserve a completed external Seed
and its matching configuration before depending on a replacement host.

## Creating a completed recovery Seed

Install host integration with `bootstrapper/install-volume-host.sh` so scheduled
Certbot renewals use `system-certbot`. For manual renewal and renewal dry-runs,
use the same wrapper, for example `system-certbot renew --dry-run`. It shares a
filesystem lease with Harvest. Do not run an unmanaged Certbot command or modify
certificate state manually during Harvest.

An explicit Harvest launches a transient helper from the exact controller image;
ordinary controller/GitLab containers keep no `/seed` binding. The helper checks
backup availability, host mount identity, permissions and free space before
quiescing any service. It obtains the global live-data lease at
`configuration/.storage-operation-lock` and the renewal lease, explicitly stops
GitLab's services with a bounded longer runit wait, independently verifies that
every enabled service is down, then stops the container. Inspection, service
quiescence and container shutdown share a 120-second budget. The final container
exit must be zero and Docker must not report an OOM kill.
A forced shutdown is rejected rather than described as a consistent database copy.
While GitLab is stopped, the authenticated Sync status/Fetch API remains available;
configuration and other control mutations are rejected. GitLab/registry writes are
unavailable for the duration of this cold backup.

Harvest copies `/srv`, `/ssl` and the mounted Certbot account/renewal state into a
new private staging directory. Disposable Unix sockets, FIFOs and device nodes
are excluded; services recreate their process endpoints. A manifest records all file checksums, ownership,
permissions, symlink targets and the GitLab version/edition reference and image content ID. The staged
payload is verified before publishing `seed/current`, an atomic link to a completed
`seed/snapshots/<generation>`. Previous snapshots and historical `seed/srv` /
`seed/ssl` trees are retained. They are not automatically pruned; provide room for
the new snapshot. Copy failure leaves the previous completed snapshot selected.
GitLab is resumed on normal completion, failure or handled termination. If a
service stop fails while the container is still running, Harvest requests every
enabled service to run again; starting an already running container would not
resume those services. An uncertain remote stop is allowed to reach its bounded
deadline before resumption, so an old stop cannot race the restart. On failure,
Harvest prints only the container's running state, exit code and OOM flag.

SIGKILL, a lost host or power failure cannot execute cleanup. A remaining
`configuration/.storage-operation-lock`, backup `.operation-lock` or
`.system-bootstrapper-certificate-lock` is deliberate evidence
of an interrupted operation. Verify no Harvest/restore/renewal process remains,
start GitLab if necessary, and remove only the stale lease before retrying. Do not
promote a `.harvest-*` staging directory to `current`.

### Run from the Wizard or the host

With the target available, **Harvest** in the authenticated Wizard uses the
same repository-owned dispatcher as `system/harvest.sh`. You can instead run
from a reviewed host checkout using an available, accepted complete controller
image. Resolve and record its actual image identity, then use:

```sh
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/seed-operation.sh harvest \
  --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
  --check-only
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/seed-operation.sh harvest \
  --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID
```

`--check-only` validates inputs without stopping services or copying payload.
A completed operation removes its owned helper. Only then detach the backup
medium. Save the corresponding **Wizard configuration backup** independently;
Harvest does not add that configuration to the Seed.

## Restore an external Seed into a fresh local installation

The inputs are the completed Seed, matching Wizard `bootstrapper.zip`, recorded
System source with its pinned submodule, and declared image references or
verified image archives. The former live data directory is not an input.

1. Install Docker on the replacement Ubuntu host and check out the intended
   source revision with pinned submodules. Select `PERSISTENCE_MODE=local` and
   a fresh local `PERSISTENT_DIR`, or explicitly select a mounted live volume.
   Mount the retained backup filesystem and set its `SEED_MOUNT`, `SEED_DIR`
   and expected UUID in the private host selector. Do not start GitLab yet.
   Prepare only the live directories and persistence marker from this selector:

   ```sh
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash -euc 'set -a; source "$PERSISTENCE_ENV_FILE"; source bootstrapper/storage-env.sh; set +a; exec bash bootstrapper/persistence.sh'
   ```

   This step neither starts containers nor requires the backup medium. It must
   precede `--check-only` on a fresh target: that preflight does not create paths.
2. Make the accepted complete controller image and exact harvested GitLab image
   available. Pull exact recorded immutable references or load separately retained,
   verified image archives. Rebuilding source is a new image attempt and is not
   a substitute for the recorded tested payload. A custom mutable tag is not a
   recoverable artifact. Preserve immutable private Wizard registry pins: their
   payload must be in the Seed rather than replaced by another build.
3. Select a compatible accepted recovery-tool controller as described above; it
   can differ from the preserved saved runtime controller. Keep the configuration ZIP in a private absolute path on the new host. Run
   the repository-owned host restore entry point with the accepted image:

   ```sh
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash bootstrapper/seed-operation.sh restore \
     --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
     --configuration-backup /root/recovery/bootstrapper.zip \
     --check-only
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash bootstrapper/seed-operation.sh restore \
     --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
     --configuration-backup /root/recovery/bootstrapper.zip
   ```

   Storage selection belongs to this host; old exported working paths must not
   override it. The helper validates the completed Seed and exact GitLab
   image/version/edition before service-data writes. Fresh empty scaffold
   directories and an explicitly imported configuration are allowed; existing
   live GitLab/TLS data is refused instead of overwritten. A corrupt or
   incomplete Seed does not become a valid restore source.
4. Restore copies only after validation. It durably creates
   `gitlab/data/.system-bootstrapper-restore-incomplete` before copying and
   durably removes it after verifying the restored payload. A failed copy keeps
   this guard; controller/GitLab startup refuses partly restored state. Inspect
   the failed operation and preserve its partial target and marker for diagnosis.
   After confirming its helper has ended, select another fresh live directory
   and restore the same verified Seed there. The native entry point refuses to
   resume over partial data; do not delete its marker or start writers manually.
5. Restore preserves the Seed's ownership and modes exactly. Older snapshots may
   contain an SSL root with mode `0700`, which prevents NGINX workers from serving
   HTTP-01 challenges. Before starting writers or certificate renewal, repeat the
   native preparation command from step 1. It prepares the public challenge
   directory and adds traversal permission to the SSL root while keeping private
   certificate directories and key files unchanged. The retained Seed is unchanged.
   Install Certbot as needed and run
   `sudo bash bootstrapper/install-volume-host.sh`. This rebinds webroot renewal
   paths to the new live directory and installs the renewal/deploy integration.
   Set the required image selectors, then start with `sudo bash start.sh`.
   Reprovision optional Review/Beta helpers explicitly if their old immutable
   image is absent; see the [environment procedure](../project-bootstrap/wizard-environments/README.md).
   Runner managers/workspaces are recreated from configuration and restored
   GitLab state; old runner directories are not required inputs.
6. Verify authenticated Fetch, Wizard/GitLab/registry access, restored data and
   runner CI. After helper completion, unmount/detach the backup medium and
   verify configuration Push/restart and TLS renewal still work. They use only
   the new local live directory. Use `sudo system-certbot renew --dry-run`
   when configured DNS and certificate lineages are reachable.

Startup never applies a Seed automatically. Merely reattaching an old live-data
volume is a separate reuse path, not this backup-to-fresh-local restore.

If a controller restarts with a storage or upgrade lease and no incomplete-restore
marker, it pauses before starting writers and remains available to native recovery through
`docker exec`. It does not resume automatically when the lease disappears.
After completing the applicable recovery and confirming the live target is safe,
restart it deliberately with `sudo docker restart system_bootstrapper_1`.
An incomplete Seed restore still requires a different fresh target as above.

### Pulling a restored private Wizard image

After GitLab starts, `system/ensure-wizard-image.sh` recovers an absent immutable
Wizard image from the platform's own registry. It validates the saved managed
Wizard receipt and registry/project identity, renders a GitLab/registry-only proxy,
and waits for GitLab's internal readiness endpoint. GitLab creates a project deploy
token with only `read_registry`; Docker receives the password on standard input
and writes its login to a new private temporary directory. The helper pulls and
verifies the exact saved digest, revokes the token on success or failure, and
removes the temporary login. Old host Docker credentials are not recovery inputs.
Normal public-image startup and already cached exact pins need no token.

The deploy token has GitLab's next-day UTC expiry as a safety bound and is normally
revoked immediately. See the [GitLab deploy-token documentation](https://docs.gitlab.com/api/deploy_tokens/).
Only tokens with the reserved recovery purpose in the receipt's exact project are
eligible for cleanup. A failed revocation retains
`configuration/.wizard-image-recovery.pending`; startup must finish that cleanup
even if the image has since been cached. An interrupted process leaves
`configuration/.wizard-image-recovery.lock`. After verifying the old process has
ended, remove only that stale lock and retry startup; retain the pending file so
the helper can revoke the reserved credential. Credential failures stop startup
before Wizard and project services rather than substituting a different image.

## Verification boundaries

`tests/seed/recovery-contract.py` exercises the real shell scripts and rsync with a
fixture Docker command, including failed copies, forced shutdown, version mismatch,
corruption, missing completion markers, active writers, renewal locking and
interrupted-copy durability. Wizard model regressions cover literal assignments,
JSON/ENV/ZIP equivalence and the immutable signature.

The required [disposable platform scenario](../tests/e2e/README.md) additionally
runs real GitLab/runner/registry CI, exports configuration through the actual
Wizard model, removes the original private host and restores only declared
fresh-source images, configuration ZIP and completed external Seed into a
different empty local directory. It exercises missing backup storage and global
live-lease exclusion, refuses nonempty restore targets and corrupted payloads,
then detaches backup mounts before the real configuration Push/restart, runner
CI and TLS-renewal checks. It checks restored service/data identities, uncached private Wizard image
recovery and actual ACME account/renewal/deployment through a local authority.
These checks do not emulate a new VM's OS installation or systemd timer scheduling.

The retained-volume `recover-volume.sh` path is separate: its image archives are
explicit inputs, whereas the configuration-plus-Seed scenario rebuilds declared
custom images from source. Neither path makes an older Seed a matching backup for
a newer configuration. Capture compatible inputs and verify the intended GitLab
image identity before recovery.
