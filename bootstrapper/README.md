# Supported System runtime base

Build the base with the existing standalone build context:

```sh
docker build -t system-runtime:candidate ./bootstrapper
```

The complete System image also runs `bootstrapper/install-runtime.sh` from its
repository build context. It starts from the same official digest-pinned Node
24.22.0 / Alpine 3.24 image instead of requiring a separately published System
base. The shared installer checks Node 24.22.0 and npm 11.19.1 before installing
the pinned Docker CLI 29.9.2, Compose 5.6.1, Buildx 0.38.1 and the existing shell utilities.
Both `docker-compose` and `docker compose` remain available. Custom `IMAGE`
overrides must satisfy the same runtime checks.

The image digest pins the upstream filesystem; explicit APK package versions
pin direct tools. Alpine repositories still resolve transitive package updates,
so these inputs alone are not a full offline package snapshot. If an APK pin
becomes unavailable, the build fails rather than silently selecting another
version. Refresh unavailable direct package versions against the official index
for the pinned Alpine release in a reviewed change. Refresh the image digest and
Node/npm assertions together when changing the upstream runtime, then rebuild
and validate the complete candidate.

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
An omitted image tag has Docker's normal `:latest` meaning, so the NGINX fallback
`nginx` matches a declared `nginx:latest` alias. Other tags, repository paths,
registry ports, digest references and exact image-ID checks remain distinct.

An older two-list checksum manifest can be audited explicitly with
`python3 bootstrapper/recovery.py verify --directory /path/to/recovery --checksums-only`.
That compatibility audit cannot load images or start services; complete the source
and alias declarations through the normal reviewed operator workflow first.

## Promoting a tested successor controller

`promote-controller.py` consumes the frozen `release.json` and
`candidate-results.json` artifacts published by the same successful full candidate
job. It verifies their exact bytes through the configured GitLab API, the protected
default branch and source tree/gitlink, all required internal jobs and the exact
candidate job ID. The configured required merge gate must remain enabled. The only
permitted unrelated pipeline failure is the existing optional public GitHub mirror
job; an internal failed, missing, skipped or allowed-to-fail required job refuses
promotion. API and registry credentials are read from the private operator token
file, never from a public artifact.

Prepare an unchanged reviewed checkout at the artifact's exact source revision and
keep downloaded inputs mode 0600. The token needs project/artifact read permission
and read access to the published registry image. The command first pulls the
published immutable registry reference into a new private temporary Docker login
and verifies its exact image ID and source/job labels. It then records the local
selector `system-successor:<source-revision>-job<candidate-job-id>`. This local alias
is not immutable by itself: the accepted CI proof, image ID and recorded archive
checksum establish its identity. Using it allows a new host to start the controller
before the controller's own GitLab registry is running.

```sh
sudo python3 bootstrapper/promote-controller.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/successor/release.json \
  --evidence /root/successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/gitlab-operator-token \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/example \
  --cold-maintenance
```

Use `--check-only` with the same inputs for source/CI inspection without changing
services. Normal promotion requires a Sync API that reports project-operation
quiescence. An older API cannot establish this by omitting a field; it requires
`--cold-maintenance`, which performs an actual maintenance protocol:

1. Acquire the native controller, Seed, certificate and environment leases; retain
   the current controller/image/restart policy and exact saved configuration.
2. Stop the owned public proxy, disable automatic restart of the old controller and
   pause its processes. Drain outstanding remote GitLab execs with a finite budget.
3. Stop GitLab NGINX, Workhorse and Puma ingress. Only after those services are
   confirmed down, use the shared committed GitLab preflight to prove no executing
   jobs or unfinished background migrations remain. If a job raced the first check,
   resume the old ingress/controller/proxy without stopping the job or database and
   defer promotion.
4. Stop the owned retained runner managers, cleanly stop GitLab's services and
   verify the container exit is zero without OOM. Kill the frozen old controller
   without an explicit unpause; its disabled restart policy prevents old code from
   returning. A tiny explicit Docker fixture covers this primitive.
5. Copy and verify the cold GitLab and configuration state with the accepted image's
   own `rsync`, preserving ownership, permissions and symlinks. Fsync copied files,
   directories and checkpoint publication before proceeding.
6. Change only the saved controller selector, preserving the Cube and old GitLab
   image setting. Start the exact accepted controller through Compose. Its normal
   committed startup may reconcile the proxy, Wizard and runners. Verify saved Fetch,
   routing, required data mounts and retained manager identities, while GitLab still
   runs its old image/version. Perform the reviewed GitLab migration separately.

This is a maintenance operation with downtime, not a zero-downtime controller
replacement. A cold checkpoint requires free space for another copy of GitLab data.
An uncertain drain, stop, copy or startup leaves its exact owned leases and private
operation record for recovery; it never guesses that the database is safe.

Inspect or abort an interrupted controller operation with the committed entry point:

```sh
sudo python3 bootstrapper/promote-controller.py --operation status \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/example
sudo python3 bootstrapper/promote-controller.py --operation abort \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/example
```

Abort adopts only the recorded stale leases, waits out bounded remote commands,
checks backup/current configuration hashes and the old GitLab image, and verifies a
completed cold checkpoint when present. Before database shutdown it resumes the
unmodified old generation. After a failed controller start it can restore the
previous controller and configuration on the same old GitLab data; it never rewinds
that database. A changed GitLab image or a completed migration refuses this path:
use the GitLab upgrade helper's verified database checkpoint recovery instead.
Completed controller promotions are not treated as interrupted operations.
Host commands run through the committed `host-child.py` guardian: it inherits a
stable filesystem guard, records PID/start/process-group identity before releasing
a worker start barrier, and bounds and reaps the entire owned command group.
Adoption refuses a live coordinator, guardian or worker group, including after a
coordinator SIGKILL. The guard file remains on disk and is never unlinked/recreated
to bypass a held lock.

## Recording the successor for the next host

After successful GitLab migration, refresh retained recovery inputs before deleting
the VM or relying on a later host replacement:

```sh
sudo python3 bootstrapper/record-recovery-images.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/successor/release.json \
  --evidence /root/successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/gitlab-operator-token \
  --output /root/successor/recovery-export.json
```

The exporter rechecks accepted CI/source/image identities and the actual migrated
GitLab image/configuration. It streams the exact running controller to a uniquely
named gzip archive with a bounded Docker-save deadline, then validates the complete
new source/image/alias manifest against actual files **before** atomically publishing
it. It retains the preceding manifest's exact bytes, old archives/versioned aliases
and the existing Wizard image configuration/archive. The canonical published
controller registry reference remains provenance metadata; fresh-host recovery uses
the verified offline local alias. The new public GitLab declaration matches the
running migrated image, so recovery cannot silently select the preceding version.

An interrupted export leaves prior inputs selected and any completed extra archive
retained. A retry creates another operation archive instead of overwriting or deleting
it. Do not delete the host until the exporter and `recover-volume.sh --verify` pass.

Isolated contracts run with `python3 tests/bootstrapper/native-initialization.py` and
`python3 tests/bootstrapper/successor-host-tools.py`. The explicit tiny Docker
primitive test is separate from the socket-free component suite:
`node tests/bootstrapper/paused-controller-docker.js --allow-local-daemon`.
It uses one exactly labeled, limited, disposable local container and never a live
GitLab installation.
