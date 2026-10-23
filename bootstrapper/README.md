# Supported System runtime base

Build the base with the existing standalone build context:

```sh
docker build -t system-runtime:candidate ./bootstrapper
```

The complete System image also runs `bootstrapper/install-runtime.sh` from its
repository build context. It starts from the same official digest-pinned Node
24.22.0 / Alpine 3.24 image instead of requiring a separately published System
base. The shared installer checks Node 24.22.0 and npm 11.19.1 before installing
the pinned Docker CLI 29.8.2, Compose 5.1.4, Buildx 0.34.1 and the existing shell utilities.
Both `docker-compose` and `docker compose` remain available. Custom `IMAGE`
overrides must satisfy the same runtime checks.

The image digest pins the upstream filesystem; explicit APK package versions
pin direct tools. Alpine repositories still resolve transitive package updates,
so these inputs alone are not a full offline package snapshot. If an APK pin
becomes unavailable, the build fails rather than silently selecting another
version. Refresh the digest, Node/npm assertions and direct package versions
together in a reviewed change, then rebuild and validate the complete candidate.

Do not replace libraries inside the historical Alpine 3.16 image or copy glibc
Node binaries into it. The supported base supplies the complete runtime.
Building it does not restart the running platform or alter its Docker daemon.
The Docker client communicates with the existing daemon only when explicitly
given access to it; a version check does not prove deployment compatibility.

Before promotion, validate Compose configuration and startup contract tests,
build/lint/API/signature regressions and the integrated Wizard source packaging.
Live restart/recovery acceptance and manual Production promotion remain separate
coordinated actions. Preserve the previous working image and private settings.

## Reviewed replacement-host initialization

The host tools in this directory are part of the System source. Change them through
an MR and the applicable checks before running the new revision against an
installation. Fetch a reviewed checkout with its pinned submodules first. When the
installation's GitLab is unavailable, an independently available mirror or retained
source bundle can provide the same reviewed Git objects. The tool never patches,
updates or clones itself during initialization.

`initialize.sh` handles replacement of a host while retaining **live** service data.
It does not format a filesystem, issue first certificates, migrate GitLab versions,
apply a Seed or convert an empty filesystem into an existing installation. Follow
the [handbook](../docs/HANDBOOK.md) first-install path for a new installation.

Requirements are root access on supported Ubuntu, Git and Python 3, an already
mounted data filesystem, saved configuration and the recovery manifest described
below. The normal host installer supplies Docker; Certbot is installed as well when
`--install-host` is selected. Instance selectors and credentials remain private.

```sh
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/initialize.sh \
  --install-host \
  --receipt-dir /var/log/system-bootstrapper/initialize-example \
  --timeout 1200 \
  --renewal-dry-run
```

Choose a new receipt directory for every attempt. The script refuses an existing
one rather than replacing its pre-start baseline. Baselines, status and logs are
created with private permissions outside the checkout; none are executable helper
scripts. They record hashes and results, never exported configuration or credentials.
Raw installer/recovery logs remain private because upstream commands may emit
sensitive information. A failed run retains its logs and leaves existing data and
Seed snapshots in place. Inspect the reported phase and fix the reviewed source or
operator input before choosing a new operation directory and retrying.

All host storage checks run before package or service changes. The script captures
configuration/auth hashes and retained manager identities, optionally prepares
explicitly requested swap, installs host tools, loads only declared images and local
aliases, connects the volume-backed Certbot state and starts the controller without
a rebuild. It pins Docker operations to this host's Unix socket. The controller's
existing private-registry recovery then obtains the exact saved Wizard digest.

Optional flags are:

| Flag/input | Purpose |
| --- | --- |
| `--swap-gib 8` | Explicitly allocate 8 GiB at `/swapfile` on the root disk if no swap is active. An existing file or insufficient room fails; the data volume is never used for swap. Default: no swap change. |
| `--timeout 1200` | Retry application acceptance for up to the selected readiness window, maximum 3600 seconds. Individual network/command timeouts also bound each probe. |
| `--gitlab-token-file /root/gitlab-read-api-token` | An optional operator-supplied administrative API token in a regular mode-0600 file. Its permissions must allow reading `/runners/all` and runner managers. Verifies each expected manager is online and contacted GitLab after this operation began. The value is read from the file and never put in a command argument or receipt. |
| `--redirect-from https://example.com` | Additionally verify a permanent redirect, preserving path/query, from this origin to the configured public Wizard origin. No canonical domain is assumed. |
| `--renewal-dry-run` | Run Certbot's staging renewal through the installed lease wrapper, without randomized delay; reject a failed deploy hook and repeat acceptance afterward. Requires real configured certificate lineages, working DNS and reachable ACME endpoints. |
| `RECOVERY_MANIFEST_SHA256` | Optional independently retained SHA-256 for `recovery/images.json`, checked before trusting its archive/source declarations. |

The runtime verifier checks actual GitLab sign-in/readiness and registry
authentication, not only container health. It also verifies the public Wizard body
against the actual Wizard container, exact authenticated Sync Fetch bytes and Cube,
configured service images, every core service's retained data mount and named-volume
bind device, Certbot state/timer for HTTPS, and private image recovery cleanup.
Without an API token, runner containers and retained identity files are checked;
the result explicitly marks GitLab-side fresh-contact verification as **not checked**.
The verifier covers core services and the configured main runner pool; custom
application-specific acceptance remains that application's responsibility.

The commands can also be run separately:

```sh
sudo python3 bootstrapper/verify-runtime.py baseline \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --output /root/pre-start-baseline.json
# Start the retained platform through the committed recovery entry point.
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/recover-volume.sh
sudo python3 bootstrapper/verify-runtime.py check \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --baseline /root/pre-start-baseline.json \
  --output /root/runtime-verification.json --timeout 1200
```

## Explicit recovery image/source manifest

The retained-volume archive path uses private operator-prepared inputs at
`PERSISTENT_DIR/recovery/images.json` and `recovery/images/*.tar.gz`. Checksums
protect consistency against an independently retained manifest; they are not an
upstream provenance signature. Populate the actual image identities, source commit,
tree, pinned Wizard gitlink and aliases before relying on this recovery path.
The normal fresh-source/Seed recovery contract is separate.

The manifest keeps these fields (replace every symbolic value with its actual
identity; this is a schema illustration, not a ready-to-run manifest):

```json
{
  "sourceCommit": "<40 lowercase hexadecimal characters>",
  "sourceTree": "<recorded source tree Git object>",
  "wizardSourceRevision": "<Wizard gitlink from that source commit>",
  "archives": [{
    "file": "images/controller.tar.gz",
    "sha256": "<compressed archive SHA-256>",
    "imageId": "sha256:<exact Docker image identity>",
    "sourceCommit": "<same source commit>",
    "sourceTree": "<same source tree>",
    "wizardSourceRevision": "<same pinned Wizard gitlink>"
  }],
  "localImages": [
    {"tag": "system_bootstrapper", "imageId": "sha256:<exact Docker image identity>"},
    {"tag": "controller:retained", "imageId": "sha256:<same exact Docker image identity>"}
  ],
  "publicImages": [{
    "reference": "nginx@sha256:<recorded repository digest>",
    "tag": "nginx:retained",
    "imageId": "sha256:<exact Docker image identity>"
  }],
  "currentController": {
    "reference": "controller:retained",
    "imageId": "sha256:<same controller image identity>",
    "sourceCommit": "<same source commit>",
    "sourceTree": "<same source tree>",
    "productionWizardReference": "registry.example.com/platform/wizard@sha256:<recorded digest>"
  }
}
```

Include digest-pinned public GitLab and Runner entries as well, with the aliases
used by saved configuration. Optional archived Wizard entries can declare
`imageRef` for the immutable production reference. `imageId` is the identity Docker
actually reports on the compatible target engine; do not assume an OCI config digest
is interchangeable with its manifest/index digest. The source Git objects must be
available locally. A newer reviewed host-tools checkout may validate an older
recorded controller commit; the controller source/tree/gitlink declarations must
still agree with its exact archived identity.

Before startup, `recover-volume.sh --verify` rejects missing source identity, a
mismatching Git tree/gitlink, undeclared image selections, corrupt/escaping archives,
mutable public image references and duplicate or unbacked aliases. Normal recovery
loads each declared archive, verifies its exact image ID and reconstructs **all**
`localImages` aliases before starting services. It never guesses an instance's old
local tag. Saved configuration is not rewritten to accommodate a missing image.

An older two-list checksum manifest can be audited explicitly with
`python3 bootstrapper/recovery.py verify --directory /path/to/recovery --checksums-only`.
That compatibility audit cannot load images or start services; complete the source
and alias declarations through the normal reviewed operator workflow first.
