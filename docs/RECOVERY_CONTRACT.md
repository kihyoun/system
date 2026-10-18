# Configuration and completed Seed recovery

The recovery inputs remain separate: a Wizard configuration backup, a completed
Harvest Seed, and freshly fetched System source including its pinned Wizard
submodule. Configuration is not copied into Harvest, and no service-data download
has been added to the Wizard. Track full acceptance in
[System #43](https://github.com/kihyoun/system/issues/43).

The corrected Wizard imports literal shell assignments, including single/double
quotes, escaped metacharacters and equals signs. Backup preserves unmodelled
runtime settings in `main.runtimeOptions` / project `runtimeOptions`, including
image references and host port bindings. JSON and ZIP exports contain secrets;
protect them as you protect the running configuration. Shell expressions requiring
expansion or execution are rejected; provide their literal resolved values instead.
The original Cube header and its strict format validation remain unchanged.

## Creating a completed recovery Seed

Install host integration with `bootstrapper/install-volume-host.sh` so scheduled
Certbot renewals use `system-certbot`. For manual renewal and renewal dry-runs,
use the same wrapper, for example `system-certbot renew --dry-run`. It shares a
filesystem lease with Harvest. Do not run an unmanaged Certbot command or modify
certificate state manually during Harvest.

Harvest obtains an operation lease, obtains the renewal lease, stops GitLab with
a 120-second grace period, and requires its container exit status to be zero.
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
GitLab is resumed on normal completion, failure or handled termination.

SIGKILL, a lost host or power failure cannot execute cleanup. A remaining
`.operation-lock` / `.system-bootstrapper-certificate-lock` is deliberate evidence
of an interrupted operation. Verify no Harvest/restore/renewal process remains,
start GitLab if necessary, and remove only the stale lease before retrying. Do not
promote a `.harvest-*` staging directory to `current`.

## Restoring without the old live platform

1. Mount a compatible empty data filesystem, copy only the completed Seed to it,
   and fetch the recorded System source commit with its pinned submodules. Retain
   the independent Wizard configuration backup. Preserve Unix ownership and modes
   when transferring the Seed; copy symlinks as symlinks.
2. Select the new host's `PERSISTENT_MOUNT`, `PERSISTENT_DIR`, UUID and separate
   `SEED_DIR` deliberately. Host storage selection must override old host paths.
   Update the restored configuration's `SEED_DIR` deliberately if the volume path
   changed (use the Wizard field and regenerate the export; never replace text
   across the Cube header). Run storage preflight before any service. Install the backup configuration in
   the new persistent configuration directory before provisioning GitLab/runners.
3. Rebuild custom controller and source-built Wizard images from the freshly fetched source
   using their committed Dockerfiles/build recipes. Pull public GitLab and Runner
   images at the exact retained references. Set `BOOTSTRAPPER_IMAGE`,
   `WIZARD_IMAGE`, `NGINX_IMAGE`, `GITLAB_IMAGE` and `GITLAB_RUNNER_IMAGE` explicitly
   where used. A custom image tag is not itself a recoverable artifact. Do not
   silently load an undeclared archive from the previous platform tree. For managed
   Wizard Review/Beta, rebuild its clean helper image and reprovision
   `SYSTEM_WIZARD_ENVIRONMENT_IMAGE` with the new exact image ID through the
   [managed environment procedure](../project-bootstrap/wizard-environments/README.md).
   Update the installed recipe explicitly; its old immutable helper identity must
   not be silently redirected to a new image.
   If `WIZARD_IMAGE` instead pins a published image in this platform's own GitLab
   registry, keep that exact digest. Its registry data must be in the completed
   Seed; rebuilding an unrelated default-branch image is not a replacement.
4. Before starting GitLab, run `system/seed.sh` in a recovery container with the
   same `/srv`, `/ssl`, `/seed` and `/host-letsencrypt` bindings as the controller.
   The Docker daemon must be available, and GitLab must be absent or stopped.
   The entire selected Seed is verified before any destructive rsync. The
   incomplete-restore marker and its directory entry are fsynced before copying;
   restored directories are fsynced before the marker is durably removed. The retained
   GitLab image version/edition and image content ID must match. Legacy unmarked Seeds are deliberately
   rejected: create a new cold Harvest before relying on this contract.
5. A failed restore retains
   `gitlab/data/.system-bootstrapper-restore-incomplete` on the new volume.
   Controller/GitLab startup refuses this state. Correct the failure and rerun
   Seed; do not remove the marker and provision a partly restored database.
6. Install host TLS integration again. It rebinds webroot renewal paths to the new
   volume location and installs the deploy hook and shared renewal lease. Run a
   renewal dry-run through `system-certbot`, then start the platform normally.
   Runner managers/workspaces are recreated from configuration and restored GitLab
   state; no old runner directories or checkout are required recovery inputs.

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

## Verification and remaining limits

`tests/seed/recovery-contract.py` exercises the real shell scripts and rsync with a
fixture Docker command, including failed copies, forced shutdown, version mismatch,
corruption, missing completion markers, active writers, renewal locking and retry
of an interrupted restore. Wizard model regressions cover the observed backup
corruption, JSON/ENV/ZIP equivalence and immutable signature.

These are component regressions. Before closing #43, run the complete clean-host
exercise using only declared inputs, verify GitLab service/data identities, a real
runner CI job, registry push/pull and TLS renewal, and demonstrate rebuilding every
required custom image without an old Docker cache or private image archive.
The existing `recover-volume.sh` remains a separate retained-volume recovery path;
its image archive is not evidence that source-only recovery has passed.
