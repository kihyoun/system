# Persistent platform volume

The platform keeps service state, configuration and recovery material beneath a
configured mounted filesystem. The VM root disk, Docker cache, containers and
networks can be replaced separately. Retaining the volume preserves its contents;
deleting or formatting it destroys them. A Seed on the same volume does not
protect against loss of that volume.

## Paths and selectors

Create the root-owned selector file `/etc/system-bootstrapper/persistence.env`
using the mount point and UUID of your existing ext4 filesystem:

```sh
PERSISTENT_MOUNT=/mnt/bootstrapper-data
PERSISTENT_DIR=/mnt/bootstrapper-data/platform
SEED_DIR=/mnt/bootstrapper-data/seed
# Optional additional identity check:
# PERSISTENT_UUID=<filesystem-uuid>
```

`PERSISTENT_DIR` must be beneath the mounted filesystem. `SEED_DIR` must be on the
same filesystem, separate from the live directory, with neither path containing
the other. Keep the same absolute paths when reusing an existing installation;
recorded configuration and bind mounts can contain those paths. Moving to other
paths requires explicit rebinding as described in the [recovery contract](RECOVERY_CONTRACT.md).

Startup checks the mount point, backing device, optional UUID and persistent
subdirectories before creating data. It rejects the root filesystem, escaping
symlinks and nested mounts. `bootstrapper/install-volume-host.sh` adds an fstab
entry for ext4 when needed and a Docker `RequiresMountsFor` dependency. The filesystem
must already be mounted; the installer never formats it.

The layout, relative to the configured mount, is:

```text
PERSISTENT_MOUNT/
├── backup/                   # Optional operator-retained backups
├── seed/                     # Harvest snapshots and Seed restore input
└── platform/                 # PERSISTENT_DIR
    ├── configuration/        # Main settings, project receipts and Sync auth
    ├── gitlab/
    │   ├── config/           # GitLab secrets and service configuration
    │   ├── logs/
    │   └── data/             # Repositories, database, registry and artifacts
    ├── ssl/                  # Served certificates and HTTP-01 webroot
    ├── templates/            # Proxy and managed environment fragments
    ├── synctemplates/
    ├── runners/
    │   └── <pool>/<index>/
    │       ├── config/       # Runner auth and stable manager system ID
    │       └── home/
    └── host/
        └── letsencrypt/      # Full Certbot account/archive/live/renewal tree
```

Optional `recovery/` material may hold image archives and a recovery manifest.
Source can be fetched into any suitable checkout; it is not required persistent
service state. Protect configuration, authentication, certificate private keys
and recovery archives with restrictive permissions. Preserve numeric ownership,
permissions and symlinks when copying service data.

## Container contract

The Compose definitions give retained data explicit destinations beneath
`PERSISTENT_DIR`. Named volumes use the local driver's bind options, with each
`device` pointing to the corresponding directory. Inspect the device and backing
filesystem: a familiar volume name alone does not prove persistence. Existing
named volumes do not adopt changed driver options automatically.

Runner containers bind `runners/<pool>/<index>/config` and `home` individually.
Each manager keeps its own system ID while sharing its pool's GitLab runner
record. Scaling down retains directories for reuse. Caches and workspaces can
be recreated; they are not inputs to configuration-plus-Seed recovery.

The controller mounts `configuration` at `/state` and uses
`SYSTEM_CONFIG_DIR=/state`. Compatibility links let shell scripts and Sync use
the same saved configuration and receipts. The attached configuration takes
precedence over files baked into an image. Main configuration retains the exact
System Cube signature and intentional port 8071.

Configuration backup and Harvest are separate operations. The Wizard exports
configuration; Harvest captures a verified cold service-data snapshot, including
Certbot state. Startup never applies an old Seed automatically. Existing live
data can be reused without restoring a Seed over it. See the
[Seed recovery contract](RECOVERY_CONTRACT.md) for empty-storage recovery.

## Certificates and host integration

Persist the complete Certbot tree beneath `host/letsencrypt`: account keys,
`archive`, `live`, renewal configuration and hooks. `live` symlinks alone are
insufficient. Host integration connects `/etc/letsencrypt` to this retained tree,
installs the certificate deploy hook and shared Harvest/renewal lease, and rebinds
webroot renewal paths to `PERSISTENT_DIR/ssl/acme-http01`. NGINX serves that path
through `/ssl/acme-http01`.

Install Docker and Certbot on the replacement host, then run
`sudo bash bootstrapper/install-volume-host.sh` from the chosen source checkout.
The installer refuses conflicting active Certbot state on host and volume;
reconcile that conflict deliberately. It enables `certbot.timer` when available.
After NGINX is reachable, verify renewal through the installed lease wrapper:

```sh
sudo system-certbot renew --dry-run
```

Never run unmanaged Certbot writes concurrently with Harvest or Seed restore.

## Replacing a VM while retaining live data

1. Stop writers cleanly before detaching storage. Retain the volume explicitly
   when deleting the VM; do not format it or initialize another filesystem over it.
2. Provision a compatible Ubuntu host, attach the volume and mount its existing
   filesystem. Fetch the intended System revision with pinned submodules. Install
   Docker using `sudo bash bootstrapper/install.sh`; install Certbot separately.
3. Recreate `/etc/system-bootstrapper/persistence.env` with the retained selectors.
   Check mount/UUID and saved configuration. Run the host integration described
   above. Do not apply an older Seed over the retained live data.
4. Make exact required image references available. Rebuild custom controller
   images from the intended source, pull public images at recorded versions or
   digests, and retain immutable private Wizard pins. Optional managed Review/Beta
   helpers require their own clean rebuild and explicit reprovisioning if their
   prior local image is absent; see the [managed environment guide](../project-bootstrap/wizard-environments/README.md).
5. Run `sudo bash start.sh` from that checkout. It checks storage, builds the
   controller and starts services using retained configuration. Container IPs,
   networks and proxy configuration are regenerated. Change DNS if the host's
   address changed while preserving the configured domain names.
6. Verify Wizard/Sync, GitLab, registry authentication, runner managers and TLS
   renewal. Inspect every retained mount and named-volume device against the
   attached filesystem.

An alternative archive-based path is `bootstrapper/recover-volume.sh`. It requires
operator-prepared `PERSISTENT_DIR/recovery/images.json`, the referenced gzip image
archives with SHA-256 values, public image references and a retained selector file;
these private recovery artifacts are not supplied by a source checkout. Set
`PERSISTENCE_ENV_FILE` to that selector and invoke the script from the intended
checkout. `--verify` checks storage and archive checksums without starting services.
Without that flag it loads archives, pulls missing public references, installs
host integration and starts without rebuilding. Never treat an unavailable local
tag or an undeclared archive as a recovery guarantee.

### Preparing the optional image archives

Prepare these inputs deliberately on a host where the intended images are
available, before relying on archive-based replacement. Create a private
`PERSISTENT_DIR/recovery/images/` directory. For each custom image, stream
`docker image save <recorded-image-reference> | gzip` into a file in that
directory, check that both commands succeed, then record the compressed file's
`sha256sum`. Keep the original image tag in the archive, or explicitly tag the
image with the selector that the saved main configuration uses before saving.
For immutable helper image IDs, preserve the exact original image content.

Write `PERSISTENT_DIR/recovery/images.json` with these two lists. Replace the
placeholders with the archive's actual checksum and public image references:

```json
{
  "archives": [
    {
      "file": "images/controller.tar.gz",
      "sha256": "<64 hexadecimal characters from sha256sum>"
    }
  ],
  "publicImages": [
    {
      "reference": "nginx@sha256:<recorded digest>",
      "tag": "nginx:retained"
    }
  ]
}
```

Include every required custom archive and public GitLab, Runner and proxy image,
using references compatible with the retained installation. Each public entry is
pulled if absent and given its declared local alias; this does not change the
saved configuration. Ensure its selected reference or alias matches that
configuration. The private Wizard image can remain an exact registry digest and
be recovered from the retained registry during startup. Protect the manifest and
archives, retain an independent record of their expected checksums and verify
them with `recover-volume.sh --verify` before startup. Image archives do not
replace the live filesystem, complete saved configuration or Certbot state.

Before migrating root-disk volumes to these directories, stop writers, copy data
consistently and retain a rollback copy. Recreate Docker volume metadata only
after verifying its exact identity and destination. Do not delete unrelated
volumes or run a global Docker prune.
