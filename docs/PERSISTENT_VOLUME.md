# Persistent platform volume

Tracked in [System issue #41](https://github.com/kihyoun/system/issues/41).

The platform keeps retained service state, configuration and recovery material on
one attached volume. The VM root disk is replaceable after the volume layout and
recovery checks below have passed. An additional off-host backup is not a
prerequisite for this contract. The retained volume is still the single copy of
its contents; deleting or formatting that volume deletes the state.

The current GitLab and service test data may be discarded during this change.
Future retained data must use the persistent paths. GitHub remains the primary
code review workflow; this change does not perform the GitLab-primary cutover.

## Paths and selectors

The host selector file is `/etc/system-bootstrapper/persistence.env`:

```sh
PERSISTENT_MOUNT=/mnt/HC_Volume_24222125
PERSISTENT_DIR=/mnt/HC_Volume_24222125/platform
# Optional: require this filesystem UUID as well as the mount point.
# PERSISTENT_UUID=<filesystem-uuid>
```

`PERSISTENT_DIR` must be beneath the mounted filesystem. Keep the same absolute
mount path when replacing the VM: Docker bind devices, configuration and recovery
material use that path. Mount the filesystem before starting Docker or any
platform service. A mount guard must reject a missing volume instead of creating
replacement data directories on the VM root disk. Where configured,
`PERSISTENT_UUID` also prevents an unrelated filesystem from satisfying the guard.
The host Docker service uses `RequiresMountsFor` for the persistent mount.

The layout is:

```text
/mnt/HC_Volume_24222125/
├── backup/seed-20261018/       # Older seed, preserved unchanged
├── seed/                     # Harvest/Seed service-data exchange
└── platform/
    ├── configuration/        # Main settings and project receipts
    ├── gitlab/
    │   ├── config/           # Includes GitLab secrets and service configuration
    │   ├── logs/
    │   └── data/             # Repositories, database, registry and artifacts
    ├── ssl/                  # Certificates and HTTP-01 webroot used by nginx
    ├── templates/            # Shared proxy and managed environment fragments
    ├── synctemplates/
    ├── runners/
    │   └── <pool>/<index>/
    │       ├── config/       # Stable runner identity and authentication
    │       └── home/
    ├── host/
    │   └── letsencrypt/      # Complete Certbot state, not only live symlinks
    ├── recovery/
    │   └── images/           # Required locally built images
    └── source/               # Source and definitions used for recovery
```

Protect configuration, credentials, runner authentication, certificate private
keys and recovery material with restrictive permissions. Preserve file ownership
and numeric user/group IDs when moving service data.

## Container contract

The Docker definitions give persistent data explicit destinations beneath
`PERSISTENT_DIR`. The platform's named volumes use the local driver's bind
options, with each `device` pointing to its corresponding platform directory.
Keeping the existing Docker volume names is compatible with this layout: the
volume's inspected device and actual backing filesystem determine persistence.
A volume with the right name but the old root-disk mountpoint is not migrated.

Runner containers use explicit bind directories beneath
`runners/<pool>/<index>`, so each instance retains its own configuration and home.
An anonymous runner volume does not meet this contract.

The bootstrapper mounts `configuration` at `/state` and uses
`SYSTEM_CONFIG_DIR=/state`. Legacy runtime configuration paths link into that
state directory so existing Push/Fetch and startup code use the same saved
configuration and project receipts. The main configuration retains the exact
System Cube signature, including its fixed URL and port 8071.

Configuration remains independent of Harvest/Seed. Neither configuration nor
host recovery is reconstructed by automatically applying the old seed. The seed
paths remain separate from `platform`; the old seed backup is left untouched.

`BOOTSTRAPPER_IMAGE` selects the bootstrapper image for recovery. The recovery
startup path skips rebuilding it after loading the retained image. Public service
images are pulled using recorded exact versions/digests. Locally built images,
including a helper referenced by an immutable CI receipt, must be recoverable
from `recovery/images` or an available registry. Saving a tag is insufficient if
that tag no longer identifies the running image; source patches and required
runtime configuration must be included in the recovery material.

Image caches and Docker's entire data root are not retained platform state. A new
host can recreate containers and networks from the recorded definitions. Startup
regenerates container IP assignments and proxy configuration rather than treating
old container IDs or IP addresses as persistent identities.

## Certificates and host recovery

Persist the complete Certbot tree beneath `host/letsencrypt`: account keys,
`archive`, `live`, renewal configuration and renewal hooks. `live` contains
symlinks into `archive`; copying only that directory is insufficient. The new host
must connect `/etc/letsencrypt` to the retained state before invoking Certbot.

The certificate installation hook and renewal webroot must use the platform SSL
path. In particular, they must not retain the previous
`/var/lib/docker/volumes/system_ssl/_data` dependency. Nginx serves HTTP-01
challenges from `/ssl/acme-http01`, backed by `platform/ssl/acme-http01`.
Install the retained deployment hook on the new host, enable the Certbot renewal
timer and verify a renewal dry run after the proxy is reachable.

Keep private bootstrapper credentials, the selector values, host hook/install
instructions, source revision, image references and recovery entrypoint on the
volume. A useful copy on the VM root disk alone does not satisfy recovery. Do not
publish private configuration or image archives containing credentials in Git.

## Replacing the VM

1. Retain the attached volume explicitly when deleting the VM. Do not delete,
   format or initialize that volume. Do not restore the old seed automatically.
2. Provision a compatible host and install Docker Engine, Docker Compose and
   Certbot. Attach the retained volume and mount its existing filesystem at
   `/mnt/HC_Volume_24222125`. Restore the persistent mount entry and Docker's mount
   dependency before platform startup.
3. Recreate `/etc/system-bootstrapper/persistence.env` from the retained selector
   values. Confirm the mounted filesystem and optional UUID match the expected
   volume, and that `platform` and the old seed backup are present.
4. Run the recovery entrypoint retained under `platform/recovery`. It loads the
   retained local images, pulls the recorded public image versions, restores the
   host certificate integration and starts the saved source definitions with
   `BOOTSTRAPPER_IMAGE` and rebuilding disabled. Read that entrypoint's usage for
   the supported invocation and required host prerequisites.
5. Let startup regenerate container IP settings, nginx configuration and runner
   connections. Update public DNS if the new VM has a different address, retaining
   the configured domain names.
6. Verify the main Wizard, GitLab, registry, runner authentication and TLS renewal.
   Inspect the containers' mount sources and named volumes' bind devices: retained
   state must resolve beneath `platform` on the attached filesystem.

Before any initial migration, stop writers while moving retained service data.
Existing named volumes do not adopt changed driver options automatically; recreate
their metadata deliberately after establishing the new bind directories. Keep the
old root-disk data until the new containers have passed validation. The current
permission to discard test data does not authorize deleting the old seed backup.

## Verification status

The volume layout and replacement-host procedure require live validation before
reporting that the current VM can be removed safely. Record the deployed source
revision, mount/device inventory, restart result, certificate renewal result and
recovery artifact verification here after those checks pass. Merely having a
mounted volume or a historical seed does not establish that current service state
is retained there.
