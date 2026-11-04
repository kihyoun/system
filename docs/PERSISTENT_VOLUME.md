# Working data and independent Seed backups

The platform has two storage roles:

| Role | Purpose | Availability |
| --- | --- | --- |
| Live working data (`PERSISTENT_DIR`) | GitLab/database/registry data, configuration, certificates and runner state. | Required while the platform runs. |
| Seed backup (`SEED_DIR`) | Verified cold snapshots created by Harvest and read during explicit restore. | Required only for Harvest or restore. |

A fresh Ubuntu/WSL installation uses its own system disk for live data. An
external disk, USB stick or cloud volume is not a prerequisite. Keeping a Seed
on separate media permits recovery after losing that system disk. Configuration
backup remains a separate Wizard export, and source/images remain declared
recovery inputs. A Seed is not a continuously synchronized database copy.

## Paths and selectors

With no storage selector, a fresh installation uses:

```sh
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
```

The optional root-owned file `/etc/system-bootstrapper/persistence.env` selects a
custom layout. Use Linux storage under WSL, not a Windows-mounted directory such
as `/mnt/c`. The local preflight checks canonical paths, permissions, writable
space and required Unix filesystem behavior. Protect the file with mode 0600.

For live data on an attached filesystem, opt in explicitly:

```sh
PERSISTENCE_MODE=volume
PERSISTENT_MOUNT=/mnt/bootstrapper-data
PERSISTENT_DIR=/mnt/bootstrapper-data/platform
PERSISTENT_UUID=REPLACE_WITH_EXISTING_FILESYSTEM_UUID
```

An existing selector with `PERSISTENT_MOUNT` and no mode keeps the legacy volume
contract. A missing or mismatched selected live volume stops startup; there is
no fallback to a new directory on the root disk. Neither changing the mode nor
editing a path migrates existing data. Stop writers and make a deliberate,
verified copy before changing layouts. Existing Docker volume metadata also
needs deliberate reconciliation when a selected bind destination changes.

## Select backup media independently

Add the backup destination to the same private selector when needed:

```sh
SEED_MOUNT=/media/bootstrapper-backup
SEED_DIR=/media/bootstrapper-backup/seed
SEED_UUID=REPLACE_WITH_BACKUP_FILESYSTEM_UUID
```

Mount that existing filesystem deliberately and create its `seed` directory
before Harvest or restore. `SEED_MOUNT` requires the intended mounted target;
an absent mount is an error, not permission to create a lookalike root-disk
backup directory. `SEED_UUID` adds an identity check. A local-mode installation requires an explicitly mounted external Seed target
on a different filesystem. This prevents backing the only recovery copy onto
the VM disk that it must recover. Legacy volume-backed installations may retain
a disjoint Seed directory on that same explicitly selected live volume; losing
that volume still loses both copies.

Live and Seed roots must be canonical, disjoint paths. Neither may contain the
other. Escaping symlinks, overlapping roots and unexpected nested mounts are
rejected. Live data and Seed may be on different filesystems. Their storage
checks are independent: an unavailable backup target must not block ordinary
startup, Docker lifecycle, configuration Fetch/Push or certificate renewal.

The controller and GitLab do not retain `/seed` mounts. An explicit operation
starts a temporary helper from the exact controller image, validates the host
paths/mount identity and binds backup storage for that operation only. Harvest
checks the target and available space before stopping GitLab. A shared lease in
the live configuration directory serializes operations even if a different
backup destination is selected, and a second lease excludes certificate renewal.
Detach backup media only after the operation and its helper have completed.

## Live directory layout

The layout below is relative to `PERSISTENT_DIR` in either mode:

```text
platform/
├── configuration/        # Main settings, project receipts and Sync auth
├── wizard-public/        # Derived public operator/privacy details only
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
Source can be fetched freshly; it is not required live service state. Preserve
numeric ownership, modes and symlinks when copying service data, and protect
configuration, credentials and certificate keys with restrictive permissions.

Compose named data volumes use explicit local-driver bind destinations beneath
`PERSISTENT_DIR`; runner managers bind their own directories. Inspect the actual
sources and filesystem rather than trusting volume names. The controller mounts
configuration at `/state` and uses `SYSTEM_CONFIG_DIR=/state`; compatibility
links make shell scripts and Sync read the same saved settings and receipts.
Attached settings take precedence over files baked into an image.

Each runner manager retains a separate system ID while sharing its pool's
GitLab runner record. Scaling down retains its directories for reuse. Caches and
workspaces can be recreated and are not configuration-plus-Seed recovery inputs.

The controller derives only the six public Website settings into
`wizard-public/privacy-instance.json`; the Wizard mounts that directory
read-only. Private configuration, Sync credentials and GitLab tokens are never
copied there. Missing public settings use marked examples; saved empty values
remain empty. The file can be regenerated from configuration.

## Certificates and host integration

Persist the full Certbot tree beneath `host/letsencrypt`: account keys,
`archive`, `live`, renewal configuration and hooks. `live` symlinks alone are
insufficient. Install Certbot separately, then run
`sudo bash bootstrapper/install-volume-host.sh` from the selected checkout.
The compatibility-named installer handles both live storage modes. Volume mode
retains its fstab/Docker mount dependency; local mode adds no external-storage
prerequisite. Neither mode adds a dependency on removable Seed media.

Host integration connects `/etc/letsencrypt` to retained live state, installs the
certificate deploy hook and renewal lease, and rebinds webroot paths to
`PERSISTENT_DIR/ssl/acme-http01`. NGINX serves that directory at `/ssl/acme-http01`.
Conflicting active Certbot state on host and live storage must be reconciled.
The installer enables `certbot.timer` when available. After NGINX is reachable:

```sh
sudo system-certbot renew --dry-run
```

Use this wrapper for manual renewal too. Do not modify certificate state through
unmanaged Certbot processes while Harvest or restore is active.

## Replace a host from an external Seed

Keep a completed Seed, its matching separate Wizard configuration backup and
the recorded source/image inputs before deleting a machine with local live
data. Deleting that machine deletes the local working data. Attaching an older
backup does not make it a snapshot of later changes.

Follow [configuration-plus-Seed recovery](RECOVERY_CONTRACT.md) on the new host:
select a fresh local directory, attach the backup target, validate and restore
the completed Seed before starting writers, then start services. The original
live directories are not recovery inputs. After successful restore and
verification, remove the transient helper and detach the backup medium; normal
operation and TLS renewal continue from the new local live data.

Keeping an already populated live volume and reattaching it is a separate
convenience path, described below. It does not prove external-Seed recovery.

## Replacing a VM while retaining live data

1. Stop writers cleanly before detaching storage. Retain the volume explicitly
   when deleting the VM; do not format it or initialize another filesystem over it.
2. Provision a compatible Ubuntu host, attach the volume and mount its existing
   filesystem. Fetch the intended System revision with pinned submodules. Install
   Docker using `sudo bash bootstrapper/install.sh`; install Certbot separately.
3. Recreate `/etc/system-bootstrapper/persistence.env` with
   `PERSISTENCE_MODE=volume` and the retained mount/directory/UUID selectors.
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

Before deliberately moving live data between local and volume layouts, stop
writers, copy data consistently and retain a rollback copy. Changing a selector
does not copy or migrate data. Recreate Docker volume metadata only
after verifying its exact identity and destination. Do not delete unrelated
volumes or run a global Docker prune.
