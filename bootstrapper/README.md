# System controller releases and runtime base

A public **controller release** is the complete image built from
`system/Dockerfile`: the orchestration code, Sync service, packaged Wizard source
and runtime tools. It is accompanied by a separately built Wizard web image.
A fresh host can pull these accepted images without building controller or
Wizard images or resolving their Alpine build packages. The existing Sync
startup still runs its prestart TypeScript build inside the controller. See
[release installation](../Prepare-Host.md#install-a-tested-public-release).

The standalone **runtime base** built from `bootstrapper/Dockerfile` contains the
shared tools only. It cannot replace the complete controller, even when a base
image has been published to a registry. Both images have useful roles in CI;
only a tested complete controller and matching Wizard form the public startup
release.

## Fresh installation from public images

`install-release.py` is the host entry point for an empty installation. It takes
`--controller IMAGE@sha256:...` and `--wizard IMAGE@sha256:...`, plus an optional
`--persistence-env FILE`. `--install-host` installs Docker/Compose through the
committed host installer when needed. The [handbook](../docs/HANDBOOK.md) gives
complete local HTTP and public domain/Certbot procedures using these flags.

The installer verifies the clean System checkout, pinned Wizard revision and
pulled image identities. It writes only the image selectors to the private
`configuration/.release-images.env` and invokes native startup without a source
build. Normal startup loads this release profile before any saved main
configuration, so explicit later main-configuration image choices win. The
profile is not an imported user configuration and does not apply a Seed.

This fresh-only operation refuses existing GitLab data or saved main
configuration. It does not replace the existing-state recovery, controller
promotion or GitLab migration procedures. Prepare DNS, network access and any
HTTPS certificate through the chosen handbook path before exposing a public
instance.

## Building the shared runtime base

Developers can build the base with the existing standalone build context:

```sh
docker build -t system-runtime:candidate ./bootstrapper
```

The complete System image also runs `bootstrapper/install-runtime.sh` from its
repository build context. It starts from the same official digest-pinned Node
24.22.0 / Alpine 3.24 image instead of requiring a separately published System
base. The shared installer checks Node 24.22.0 and npm 11.19.1 before installing
the pinned Docker CLI 29.9.3-r1, Compose 5.6.1, Buildx 0.38.1, Git 2.54.1-r0
and the existing shell utilities.
Both `docker-compose` and `docker compose` remain available. Custom `IMAGE`
overrides must satisfy the same runtime checks.

The image digest pins the upstream filesystem; explicit APK package versions
pin direct tools. Alpine repositories still resolve transitive package updates,
so these inputs alone are not a full offline package snapshot. If an APK pin
becomes unavailable, the build fails rather than silently selecting another
version. Refresh unavailable direct package versions against the official index
for the pinned Alpine release in a reviewed change. Refresh the image digest and
Node/npm assertions together when changing the upstream runtime, then rebuild
and validate the complete candidate. Publishing an accepted image moves these
build dependencies into CI; it does not make stale APK pins valid in future
source builds. Keep the reviewed build inputs maintained even when end-user
installation uses an already published image.

Do not replace libraries inside the historical Alpine 3.16 image or copy glibc
Node binaries into it. The supported base supplies the complete runtime.
Building it does not restart the running platform or alter its Docker daemon.
The Docker client communicates with the existing daemon only when explicitly
given access to it; a version check does not prove deployment compatibility.

Before promotion, validate Compose configuration and startup contract tests,
build/lint/API/signature regressions and the integrated Wizard source packaging.
Live restart/recovery acceptance and manual Production promotion remain separate
coordinated actions. Preserve the previous working image and private settings.

## Local live data and on-demand Seed operations

Fresh startup defaults to local working data at
`/var/lib/system-bootstrapper/platform`. An explicitly selected
`PERSISTENCE_MODE=volume` layout still requires its actual mounted filesystem
and never falls back to local storage. Legacy selectors declaring a live mount
without a mode keep that volume contract. `PERSISTENCE_MODE`, `PERSISTENT_DIR`
and any volume mount/UUID are host-owned inputs; changing them does not migrate
existing data. See the [storage guide](../docs/PERSISTENT_VOLUME.md).

Seed backup storage is independent. `SEED_DIR` is optional during normal
startup; `SEED_MOUNT`/`SEED_UUID` identify external backup media when selected.
Controller/GitLab containers do not keep backup mounts. Only explicit Harvest
or restore starts the transient exact-image helper. It validates host paths,
mount identity and space before writes or service shutdown and uses the shared
live-data/TLS leases. An unavailable Seed target cannot become a root-disk
fallback or block ordinary services and renewal.

For a completed external Seed and matching private configuration ZIP, use the
committed host entry point before starting writers. First prepare the empty live
scaffolds with `bootstrapper/persistence.sh` and the private host selector as
shown in the [fresh-target procedure](../docs/RECOVERY_CONTRACT.md#restore-an-external-seed-into-a-fresh-local-installation).
The read-only preflight requires those directories to exist:

```sh
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/seed-operation.sh restore \
  --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
  --configuration-backup /root/recovery/bootstrapper.zip \
  --check-only
```

Review the preflight, then repeat without `--check-only` to restore into fresh
live service-data directories. Use `harvest --image ...` to create a backup from
an existing platform. The [recovery contract](../docs/RECOVERY_CONTRACT.md) lists
required source/image inputs, completion and failure guards, configuration
separation and post-restore checks. Detach backup media after the operation;
normal local operation no longer depends on it. Deleting a VM with local live
data deletes that data unless matching recovery inputs were preserved elsewhere.

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

Requirements are root access on supported Ubuntu, Git and Python 3, selected
local or explicitly volume-backed live storage, saved configuration and the
recovery manifest described below. A selected live volume must already be
mounted; local mode uses the system disk. The normal host installer supplies
Docker; Certbot is installed as well when
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

## Updating a public controller with already-current services

Use `update-controller.py` when an existing public-release installation already
runs the GitLab and Runner images accepted by the current security profile and
has **no `recovery/images.json` archive manifest**. This explicit path refuses an
existing manifest, including a dangling link; it never fabricates or replaces
one. An archive-backed installation uses the successor workflow below.

By default, the update changes only `BOOTSTRAPPER_IMAGE` in the saved main
configuration.
It preserves the exact GitLab, Runner, NGINX and Wizard image identities, manager
identities, storage selection, service data and Seed. In particular, an existing
private Wizard selector stays selected: publishing a public controller/Wizard
pair does not replace that configured Wizard. GitLab must already match the
candidate's accepted **target** image/version, and Runner images must match its
accepted target evidence. This is a controller update, without a database
migration, Seed operation or rebuild.

Prepare a clean checkout of the accepted protected default-branch revision,
private frozen successor `release.json` and `candidate-results.json`, and the
exact public controller digest from the accepted publication or another
independently verified release record. Keep a private API-token file with access
to the source project's pipeline/artifacts and administrative `read_api` access
to current Runner managers. The tool verifies the required successful jobs,
enabled merge gate, protected current default-branch head and byte-identical CI
artifacts using the same successor evidence checks as promotion. It pulls the
public digest and additionally requires the exact accepted controller image ID,
source label and candidate-job label. The public Wizard image is not pulled
unless the explicit paired option below is selected.

```sh
sudo python3 bootstrapper/update-controller.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/accepted-release/release.json \
  --evidence /root/accepted-release/candidate-results.json \
  --controller docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/private-gitlab-api-token \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/example \
  --check-only
```

Replace paths/domains with your inputs and select a new checkpoint directory
under your live `PERSISTENT_DIR/recovery/controller-updates`. `--check-only` may
pull the accepted image and wait for current manager contacts, but does not
write a checkpoint/configuration or stop services. Run the same command without
`--check-only` to update. `--timeout` bounds each readiness wait (60–3600 seconds,
default 1200). Use `--redirect-from https://example.com` when the currently saved
configuration already requires that canonical Wizard alias.

Before stopping the old controller, the tool retains its exact image selector/ID,
restart policy, private original configuration and runtime baseline. The shared
live-state, certificate and environment leases and host-command guardian protect
the transition. Sync must prove its operation queue idle. In the default mode,
only the controller is recreated through native Compose with builds and pulls disabled. Acceptance
checks exact service images and mounts, unchanged configuration apart from the
controller selector, authenticated Sync Fetch, trusted application routing,
renewal integration and recent GitLab contact by every current Runner manager.
The private `operation.json`, `baseline-after.json` and `verification.json` bind
the deployed controller to the accepted source, image and candidate job and
report preservation of the other service images separately.

For a later configuration change such as enabling Wizard aliases, use the normal
validated configuration/Sync Push workflow after this update. Keep its separate
configuration checkpoint. The update tool does not combine arbitrary
configuration edits with controller replacement. Its private `main-after.env`
retains the exact post-update configuration for that later reconciliation.

Inspect or roll back an interrupted or completed update with the same checkout:

```sh
sudo python3 bootstrapper/update-controller.py --operation status \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/example
sudo python3 bootstrapper/update-controller.py --operation rollback \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/example \
  --token-file /root/private-gitlab-api-token
```

Rollback needs the retained previous image and current-manager verification, but
does not require a reachable CI API. It adopts only the exact interrupted lease
after the coordinator and guarded commands have ended, restores the previous
controller/configuration and checks readiness without rewinding service data.
It also handles a failed Compose recreate that removed the old container before
creating its replacement. Changed service image IDs or later configuration edits
block rollback. Reconcile later configuration changes through the normal
validated configuration workflow and its separate checkpoint before retrying;
the tool never discards someone else's edits. An uncertain failure retains the
owned leases and private receipts for the same native rollback action. Preserve
the checkpoint and both images until the accepted version is no longer needed
for recovery.

### Deliberately updating the accepted controller and Wizard together

Add `--wizard docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST`
to the update command to select the complete accepted System release. Use this
option for both `--check-only` and the subsequent update with the same inputs.
The Wizard must be enabled. This is one maintenance operation with possible
management-interface downtime; it uses the shared leases and native startup.
GitLab and Runner images must already be current, as in the controller-only path.

The paired mode requires the exact protected System default-branch **push**
pipeline. All ordinary internal checks and the required `test:wizard-browser`
job must pass for that exact source and pipeline. The browser job runs the
Wizard's complete native Playwright suite against its prepared source.
Its required, successful
`deploy:dockerhub` job must provide `test-results/dockerhub/release.json`, binding
both public digests to the same accepted candidate job, source tree and Wizard
gitlink. The frozen successor evidence must identify the Wizard image published
in that System project's `successor-wizard` registry repository. Both public
images are pulled before maintenance and checked for their exact image IDs,
source revisions and candidate-job labels; the Wizard also carries the System
source revision. The public and private publication digests must agree.

Public source availability is required for this mode. The same pipeline's
`deploy:github` job must succeed and retain
`test-results/github/wizard-source.json`. That receipt must identify the exact
Wizard gitlink on `refs/heads/system-release/<wizard-revision>` in the public
Wizard repository named by the accepted System `.gitmodules`. The verifier
reads that mapping from authenticated GitLab source at the accepted revision.
An optional mirror failure still has its existing behavior for controller-only
updates; it cannot authorize a paired public release.

A paired System release can review and pin a retained Wizard dependency branch
without changing Wizard's default branch. Keep its source and public release
references available for fresh recursive checkouts. This is System release
provenance. It does not create native Wizard pipeline evidence, adopt a project
or change the canonical source-primary binding and approved CI manifest. The
ordinary source-primary Wizard Production command continues to require its own
successful current default-branch push and delivery evidence.

The combined checkpoint retains both previous image selectors and IDs and the
exact original configuration. Only `BOOTSTRAPPER_IMAGE` and `WIZARD_IMAGE` may
change; the Cube, managed project receipts, other settings, other service images,
manager identities, storage and Seed remain verified against the baseline.
The accepted controller's native startup reconciles the selected Wizard. Keep
both previous images available. The same `status` and `rollback` commands above
inspect or restore the pair without needing a CI API or rewinding service data.
An unrelated Wizard image, unavailable retained image, changed configuration or
uncertain container lookup blocks rollback. A proven interrupted removal of the
controller or Wizard is handled through native recreation under the owned lease.

For a versioned public release, also pass
`--release-metadata /root/accepted-release/system-release-vX.Y.Z.json` to both
preflight and update. Obtain the metadata and its checksum from the selected
[public release](../docs/RELEASES.md). This option requires `--wizard` and binds
the product version, source tree, Wizard gitlink, both images, candidate job and
evidence hash to the independently verified accepted attempt. It refreshes the
private `.release-images.json` and `.release-images.env` selection used by initial
development-preview setup. It does not run the fresh-host installer on existing
data. Without this option the existing release-selection files remain unchanged.

The same update checkpoint retains the exact previous selection bytes and file
metadata, the verified public metadata and the new selection. Each selection
file is replaced atomically under the maintenance lease. Rollback restores the
previous files, including their original absence, and accepts an interrupted
replacement containing only the exact known old/new files. Unrelated selection
edits or changed checkpoint payloads block rollback before services are stopped.
Keep these receipts with the checkpoint and both images.

For independent runtime checks of this installation type, select the explicit
public-image mode for both baseline and check:

```sh
sudo python3 bootstrapper/verify-runtime.py baseline --public-images \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --output /root/public-runtime-baseline.json
sudo python3 bootstrapper/verify-runtime.py check --public-images \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --baseline /root/public-runtime-baseline.json --output /root/public-runtime-check.json \
  --gitlab-token-file /root/private-gitlab-api-token --timeout 1200 \
  --redirect-from https://example.com
```

Only supply the redirect option for a configured alias. Baselines bind the saved
configuration, selected image identities and manager identities; capture a new
one after an intentional configuration change. Docker Hub's optional `docker.io/`
prefix is normalized for digest verification; private registry names and ports
remain exact. This mode does not make image archives, private registry payloads
or the matching configuration-plus-Seed recovery inputs unnecessary.

### Repairing an already stopped controller

Use `--repair-stopped-controller` only when a controller startup failure prevents
the ordinary healthy update. This explicit mode requires the same accepted
controller/Wizard pair, `--wizard` and `--release-metadata`. It does not relax
source, CI, publication, image or storage verification, migrate GitLab, apply a
Seed or discard pending project receipts.

The exact canonical controller must still exist with its selected image and
mounts. It must have exited normally with a nonzero status below 128, no live
PID or exec sessions, no OOM, and restart policy `no`. A never-started controller
retained by this mode's stopped rollback is also accepted. Running, paused,
restarting, missing or ambiguously owned containers are refused. GitLab, the
entry proxy, the enabled Wizard container and all selected runner managers must
still be running with the expected images and mounts. Public GitLab and registry
routes must work. Public Wizard/Sync readiness is required after the repair.

Do not use this option to kill a healthy controller or remove an unfinished
operation's locks. Inspect the failed controller first:

```sh
sudo docker inspect --format '{{json .State}} {{json .HostConfig.RestartPolicy}} {{json .Config.Labels}}' system_bootstrapper_1
```

For a confirmed failed restart loop with PID zero, disable only its restart
policy and stop the already exited container. Do not force-kill an active
process. Resolve any active or interrupted storage, certificate, image-recovery
or upgrade operation through its own recovery procedure before continuing.

```sh
sudo docker update --restart=no system_bootstrapper_1
sudo docker stop --timeout 30 system_bootstrapper_1
```

If the entry proxy is absent, inspect the generated templates and included
fragments before restoring routing. They can contain application routes and
aliases as well as GitLab and registry. Require complete expected routes,
correct existing service addresses and certificates. Use the existing live
directory and already selected NGINX image, replacing the examples below with
their verified values. Validate the configuration without starting a listener,
then start only `web` through the committed Compose definition:

```sh
sudo env PERSISTENT_DIR=/var/lib/system-bootstrapper/platform \
  NGINX_IMAGE=nginx@sha256:REPLACE_WITH_64_HEX_DIGEST \
  docker --host unix:///var/run/docker.sock compose --compatibility \
  --env-file /dev/null -p system -f system/docker-compose.yml \
  run --rm --no-deps --pull never web nginx -t
sudo env PERSISTENT_DIR=/var/lib/system-bootstrapper/platform \
  NGINX_IMAGE=nginx@sha256:REPLACE_WITH_64_HEX_DIGEST \
  docker --host unix:///var/run/docker.sock compose --compatibility \
  --env-file /dev/null -p system -f system/docker-compose.yml \
  up --no-deps --no-build --pull never -d web
```

Do not use full-project `up`, `down`, orphan removal or a new image selection
for this routing step. Verify GitLab HTTPS and the registry authentication
challenge with normal certificate validation. This restores only the routes
actually present in the inspected templates; it does not establish a completed
platform restore.

Then preflight the accepted repair from its clean reviewed checkout:

```sh
sudo python3 bootstrapper/update-controller.py \
  --repair-stopped-controller \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/accepted-release/release.json \
  --evidence /root/accepted-release/candidate-results.json \
  --controller docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST \
  --wizard docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST \
  --release-metadata /root/accepted-release/system-release-vX.Y.Z.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/private-gitlab-api-token \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/repair-example \
  --check-only
```

The preflight checks the surviving management services and proves that the old
controller cannot write instead of asking its unavailable Sync API for an idle
queue. The same identity, operation and configuration guards are checked again
under the shared maintenance lease. Passive pending-project receipts remain
unchanged for subsequent **Fetch → Edit → Save** recovery.

Repeat without `--check-only` using the same accepted inputs. Only the two
release-image selectors and their release metadata change. Completion still
requires the ordinary full runtime verification: authenticated Sync Fetch,
public Wizard and configured aliases, storage/image identities, certificate
integration and fresh contact by every current runner manager.

The usual `status` and `rollback` commands use the retained repair checkpoint.
Repair rollback restores the exact previous configuration and release selectors
and recreates the previous controller **without starting its failed code**.
It reports a stopped rollback, not a healthy platform; Wizard/Sync may remain
unavailable. GitLab data is never rewound. Keep the checkpoint, prior images and
matching Seed/configuration backup until the repaired release is accepted.

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

### Replacing an accepted controller before GitLab migration

If a controller was successfully staged while GitLab still runs the old reviewed
image, the recovery manifest deliberately still describes the original archived
generation. A newer accepted candidate can replace that staged controller through
the same entry point, without editing saved selectors or the recovery manifest:

```sh
sudo python3 bootstrapper/promote-controller.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/successor/release.json \
  --evidence /root/successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/gitlab-operator-token \
  --staged-promotion /mnt/bootstrapper-data/platform/recovery/controller-promotions/previous \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/replacement
```

Use `--check-only` with these inputs to verify both candidates and current staged
state before service changes. The prior directory must contain a completed native
promotion record, its original saved configuration and recovery manifest, and its
verified cold checkpoint when the prior operation used cold maintenance. The tool
downloads the prior release and evidence again from its authenticated candidate
job, checks all required jobs, the protected default branch and enabled merge gate,
then verifies the running container identity, image, source/job labels, immutable
registry digest, local alias and exact configuration hashes. The archived source
must be an ancestor of the staged source, which must be an ancestor of the new
candidate. The old GitLab image and original recovery manifest must remain exact.
Only this completed prior candidate may be historical: the new candidate must
still match the current protected default branch and all normal acceptance gates.

The proof supplies an in-memory image declaration for host validation; it does
not publish an archive or alter `recovery/images.json`. The new operation retains
the prior receipt identity and previous controller for interrupted-operation
recovery. When the staged controller reports the required Sync quiescence fields,
omit `--cold-maintenance`: normal native leases and idle checks replace it without
another full GitLab/configuration copy. The old GitLab continues running. An
unfinished upgrade, migration, mismatched receipt or changed configuration refuses
replacement. Publish final recovery inputs only after the separate reviewed GitLab
migration succeeds, through the existing strict recovery-export workflow.

Controller cold inventories have a separate 128 MiB JSON limit, checked before
atomic publication and on verification/recovery reads. Files, ownership, modes and
symlinks are reverified before a new cold checkpoint is accepted. Ordinary private
operator inputs and authenticated API responses retain their 8 MiB limits. The
GitLab migration helper uses its own checkpoint format and limits; the controller
checkpoint is not an input to that helper's rollback action.

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
