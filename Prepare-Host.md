# Prepare an Ubuntu host

For a fresh Ubuntu 24.04 or 26.04 LTS amd64 host, the [one-command Quickstart](docs/QUICKSTART.md)
selects an accepted public release and delegates to these native tools. It requires
8 GiB RAM, 40 GiB free disk, curl, standard Python 3 and administrator access.
Existing installations, DNS/HTTPS and recovery use the explicit paths below.

## Install a tested public release

For an end-user installation, use a reviewed **complete controller** image and
its matching Wizard web image from public Docker Hub repositories. The controller
is built from `system/Dockerfile`, including Sync and the lifecycle tools. The
smaller runtime base built from `bootstrapper/Dockerfile` is not a bootable
controller and must not be substituted for it.

Choose a release's exact System source revision and both immutable image
references, each ending in `@sha256:...`. The publisher's release evidence binds
the source revision/tree, pinned Wizard revision and both image IDs to those
references. Obtain them from the versioned public metadata in [GitHub Releases](https://github.com/kihyoun/system/releases),
following [the release verification procedure](docs/RELEASES.md), or your own successful publication output. A CI job artifact is not automatically a publicly
accessible download; do not make first startup depend on access to a private
GitLab instance.

Attempt tags such as `sha-<full-System-commit>-job-<candidate-job-id>` and optional
protected version tags such as `v1.2.3` make images discoverable. The candidate job
is included because its ownership label changes the image digest: a later build
of the same commit is a separate tested attempt. A published version alias is
never reassigned to another attempt. Install by the recorded digest rather
than assuming a tag, including `latest`, is immutable. Public pulls need no Docker
Hub account; anonymous rate limits and availability of Docker Hub still apply.
The declared public release targets `linux/amd64`; it does not establish ARM64
support for the complete platform.
No image contains your private main configuration, service databases or Seed.
The public release receipt binds the two project images; it does not pin every
third-party service. Review the native GitLab, Runner and NGINX image selections
for your deployment separately.

Host preparation still installs Docker Engine/Compose from Ubuntu/Docker APT
repositories. Using release images removes controller/Wizard source builds and
Alpine package resolution from the new host; it does not remove host dependencies,
GitLab's first initialization or the requirement to maintain build inputs in CI.
See the complete [local](docs/HANDBOOK.md#0-getting-started) or
[domain/HTTPS](docs/HANDBOOK.md#public-server-own-domain-and-https) walkthrough.

## Prepare host dependencies

Run the host installer from a local checkout on Ubuntu (including Ubuntu in
WSL2 with systemd enabled). It installs Docker Engine from Docker's APT
repository, Buildx and the Compose plugin, starts Docker and runs `hello-world`.
It does not upgrade unrelated operating-system packages.

```bash
SYSTEM_REVISION='REPLACE_WITH_40_CHARACTER_RELEASE_COMMIT'
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach "$SYSTEM_REVISION"
git submodule update --init --recursive
CONTROLLER_RELEASE='docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST'
WIZARD_RELEASE='docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST'
sudo bash bootstrapper/install.sh
```

The installer provides a `docker-compose` wrapper for the orchestration scripts.
It uses `docker compose --compatibility` to preserve their expected
underscore-separated container names. Service configuration, persistence and
platform acceptance are separate steps.

## Publish your own public releases

Keep source development, merge review and required candidate checks in GitLab.
Public Docker Hub publication is a distribution step after the applicable
checks; it does not make Docker Hub the development or Production control plane.
The publisher copies the exact accepted complete controller and Wizard image
identities instead of rebuilding a different image after testing.

Configure the System GitLab project's CI variables for your Docker Hub namespace:

| Variable | Value / handling |
| --- | --- |
| `DOCKERHUB_PUBLISH_ENABLED` | Protected variable; `true` opts into public release publication |
| `DOCKERHUB_REPOSITORY` | Protected variable; your public controller repository, for example `your-namespace/system` |
| `DOCKERHUB_WIZARD_REPOSITORY` | Protected variable; your public Wizard repository, for example `your-namespace/wizard` |
| `DOCKERHUB_USER` | Protected and masked publisher identity with write access to those repositories |
| `DOCKERHUB_TOKEN` | Scoped write token; protected and masked, never stored in source |

Create the public repositories and configure protected default-branch/release-tag
rules before enabling publication. Keep publisher credentials unavailable to
untrusted merge-request code. The public release receipt records source and image
identities, not credentials or installation data. Share that receipt or its
source/digest selections through a public release channel if other operators
should install it; publishing container images alone does not publish private
GitLab job artifacts.

Restrict repository writes to the publication identity. Where available, enable
Docker Hub's repository-side immutable tag policy for `sha-*` and `v*` aliases.
CI serializes its publishers and refuses an already conflicting alias, but that
check cannot atomically exclude another external publisher's simultaneous push.
The recorded digest, rather than an alias, remains the installation authority.

## Local integration test

Select compatible GitLab and Runner releases explicitly. The example below uses
GitLab CE 19.5.3 and Runner 19.5.1, pinned by the security release profile and
disposable integration suite. Do not point a new major version at existing GitLab data without following
GitLab's supported upgrade path.

For the local integration setup, include these optional exports in the complete
private main configuration at `PERSISTENT_DIR/configuration/.docker.env` before
starting GitLab. Do not create a partial main configuration containing only
these options. Inside the controller, `system/.docker.env` is a compatibility
link to the saved configuration; the persistent copy takes precedence over
configuration embedded in an image:

```bash
export GITLAB_IMAGE=gitlab/gitlab-ce:19.5.3-ce.0@sha256:6863d156a1a477bd6f69fc674b671d0163cd8b06bf63bb17cc4a4a803b78b27c
export GITLAB_RUNNER_IMAGE=gitlab/gitlab-runner:v19.5.1@sha256:8e049fb719162488893a9eccc48f3a05259d02f2386dfbb20f3e379a50575afd
export GITLAB_SSH_BIND=127.0.0.1:2222
export GITLAB_REGISTRY_BIND=127.0.0.1:5050
```

Use `gitlab.localhost`, `registry.localhost`, `sync.localhost` and `localhost`
as the respective GitLab, registry, sync and wizard hosts, with domain mode 0
(HTTP) and matching external URLs. Run `sudo bash bootstrapper/prepare-local.sh`
to add the local hostnames and the Docker HTTP exception for
`registry.localhost:5050`. This helper is opt-in for local tests; production
should use its configured domains and certificates. It preserves other Docker
daemon settings. The port overrides above apply to GitLab SSH and registry,
not to the platform's web listener.

For the managed local GitLab, set the runner count to 1 and leave its token blank:
the bootstrapper creates/reuses the shared pool automatically. Fetch afterwards
loads its runner token. See [the handbook](docs/HANDBOOK.md#2-setting-up-gitlab-runners).
Alternatively, create a runner in GitLab and supply its `glrt-` authentication
token as `GITLAB_RUNNER_TOKEN` with `GITLAB_RUNNER_SCALE=1`.
The registration script also accepts legacy registration tokens and verifies
existing registrations instead of duplicating them.

Copy `tests/registry/registry-smoke.gitlab-ci.yml` into a disposable GitLab project's
`.gitlab-ci.yml` to reproduce the integration test. It uses this platform's
Docker socket runner and covers a single-architecture image without
attestations. The fixture disables BuildKit attestations because affected
Docker/GitLab versions can reject their manifests with `blob unknown to registry`.
See the [GitLab compatibility workaround](https://support.gitlab.com/hc/en-us/articles/29426166749596-Push-to-Container-Registry-Fails-Error-error-from-registry-blob-unknown-to-registry).

Keep tokens and generated `.docker.env` files out of Git. Use the
[disposable integration suite](tests/e2e/README.md) for isolated platform
acceptance rather than running fixture projects against retained user data.

## Boot

A fresh installation uses local working data at
`/var/lib/system-bootstrapper/platform` on the Ubuntu/WSL system disk. No attached
volume or Seed is required. To choose the layout explicitly, create a private
host selector:

```bash
sudo install -d -m 0700 /etc/system-bootstrapper
sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<'EOF'
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
EOF
sudo chmod 0600 /etc/system-bootstrapper/persistence.env
sudo env GITLAB_SSH_BIND=127.0.0.1:2222 GITLAB_REGISTRY_BIND=127.0.0.1:5050 \
  python3 bootstrapper/install-release.py \
  --controller "$CONTROLLER_RELEASE" --wizard "$WIZARD_RELEASE" \
  --persistence-env /etc/system-bootstrapper/persistence.env
```

Use the Linux filesystem under WSL, not a Windows-mounted data directory.
Startup validates free space, permissions and filesystem behavior. Existing
`PERSISTENT_MOUNT` selectors without a mode retain their volume semantics.
For an explicit live volume, select `PERSISTENCE_MODE=volume` and its actual
mount/UUID; a missing selected volume fails closed rather than creating local
replacement data. Changing the mode never migrates an existing installation.
See [working storage and backup media](docs/PERSISTENT_VOLUME.md).

Install Certbot separately on hosts using HTTPS, then run
`sudo bash bootstrapper/install-volume-host.sh` for persistent TLS state and
renewal integration. Local mode needs no extra mount dependency. Neither Docker,
normal service startup nor certificate renewal depends on an external Seed target.

`install-release.py` verifies the clean checkout and pinned Wizard revision
against the pulled public-image identities. It refuses an existing main
configuration or GitLab data rather than treating a reinstall as an upgrade.
It records only the two release image selectors in the private
`configuration/.release-images.env` and invokes native startup with builds
disabled. Ordinary subsequent `sudo bash start.sh` calls reuse that profile;
explicit saved main-configuration selectors still take precedence. `--install-host`
can perform the Docker installation when it has not already been run. This
installer does not restore a Seed, import a configuration ZIP or issue certificates.

On a fresh local installation, open `http://localhost/` on the host. The pulled
Bootstrapper starts the configuration Wizard and Sync proxy. Allow time for
image downloads and service startup. Read the generated first-setup Sync login privately from
`PERSISTENT_DIR/configuration/sync-auth.env` (mounted at `/state/sync-auth.env` in
the controller). Saved main configuration in `configuration/.docker.env` is
loaded afterwards and may override `SYNC_USER` and `SYNC_PASS`; use those saved
values when present. Startup logs do not print the password.

Under WSL, keep an Ubuntu shell open while using the platform: systemd services
alone do not keep the WSL instance alive. See
[Microsoft's WSL systemd documentation](https://learn.microsoft.com/en-us/windows/wsl/systemd).

## Seed lifecycle

### First-setup suggestions in the Wizard

`Synchronize → Fetch` first requests the saved configuration. Only a missing main
configuration (HTTP 404) triggers the authenticated `GET /config/suggestions` endpoint. Authentication and
other server errors do not trigger guesses.

Suggestions use the generated NGINX routing templates when available. Missing
service hostnames can be proposed from the connection/server hostname. These
are suggestions only: they do not verify DNS, provision domains or establish
that HTTPS is available. IP addresses, Docker-style container IDs and the
example.com/org/net placeholder domains are not used to invent hostnames.
Unknown values remain blank in the Wizard. Passwords and runner tokens are
not inferred. The user must complete and verify the form before pushing it.

The Wizard marks derived values with `*` and a tooltip asking the user to verify
them. A saved configuration always takes precedence, including values that the
user might want to change. Reading suggestions never creates or changes a
configuration, starts services, or applies a seed.

This keeps the configuration workflow (`Open` / `Backup`, `Push` / `Fetch`)
independent from the persistent-data workflow (`Harvest` / `Seed`). Configuration
is persisted separately beneath `platform/configuration` and mounted at `/state`;
suggestions themselves never save or apply configuration automatically.

After compiling sync, run `node tests/sync/config-suggestions.js`. The API test
`node tests/sync/config-suggestions-api.js` must run in a disposable container: it
starts its own sync process on port 8071 with a temporary configuration tree.

### GitLab first administrator login

The username is `root`. For a fresh database, the bootstrapper generates a unique
initial password, or accepts `GITLAB_INITIAL_ROOT_PASSWORD` (at least 12 characters)
from the complete private main configuration at
`PERSISTENT_DIR/configuration/.docker.env`. The controller reads this through
its `system/.docker.env` compatibility link; the persistent saved configuration
takes precedence over configuration embedded in an image. The tracked example
deliberately has no shared default password.

Read the password locally after startup:

```bash
sudo docker exec system_gitlab_1 cat /etc/gitlab/bootstrapper_initial_root_password
```

This root-readable file lives in the persistent GitLab configuration volume and
is retained across restarts, unlike GitLab's temporary initial-password file.
It is also included when harvesting the GitLab configuration into a seed: treat
that seed as containing credentials. Store the password privately and change it
after login. The retained file records the initial password, not later changes.
An existing file is never overwritten, and an existing PostgreSQL directory
without that file causes generation to be skipped. Setting this option does not
reset an existing GitLab account; use GitLab's password-reset procedure instead.

Sync and GitLab administrator credentials are separate. The retained password
file must not be published in a repository or diagnostic log.

Run `node tests/gitlab/root-password.js` to check the initialization behavior
using temporary directories without touching a running GitLab installation.

### Persistent state

`SEED_DIR` is an independently selected backup destination. Its optional
`SEED_MOUNT`/`SEED_UUID` identify removable storage and are checked only when
creating or reading a Seed. Local live mode requires an external backup
filesystem; legacy volume mode may keep a disjoint Seed on its retained volume. A transient operation helper binds that destination;
normal controller/GitLab containers do not retain a `/seed` mount. Harvest
creates a completed recovery snapshot containing service data from `/srv`, TLS
files from `/ssl`, and complete Certbot account/renewal state. It stops GitLab,
requires a clean exit, verifies a checksum/ownership manifest, and atomically
selects the new snapshot through `seed/current`. Earlier snapshots are retained.

Seed restore is explicit; startup does not automatically overwrite live data.
Restore requires fresh live service-data directories, GitLab absent or stopped,
a completed manifest and the same GitLab image identity. An incomplete or
legacy unmarked Seed is rejected before copying. A missing Seed leaves existing destination data alone.
Configuration remains a separate Wizard backup, and the Wizard does not download
service-data Seeds. See the [recovery contract](docs/RECOVERY_CONTRACT.md) for
locks, failure handling and restoration on empty storage.

The shell/rsync regression uses temporary data and a fixture Docker command:

```bash
python3 tests/seed/recovery-contract.py
```

Run the [full disposable acceptance suite](tests/e2e/README.md) to exercise real
GitLab, registry, runner CI, configuration export and TLS renewal together.

## Shutdown
```bash
bash stop.sh
```
