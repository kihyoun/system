# Prepare an Ubuntu host

## Install

Run the host installer from a local checkout on Ubuntu (including Ubuntu in
WSL2 with systemd enabled). It installs Docker Engine from Docker's APT
repository, Buildx and the Compose plugin, starts Docker and runs `hello-world`.
It does not upgrade unrelated operating-system packages.

```bash
git clone --recurse-submodules https://github.com/kihyoun/system.git
cd system
sudo bash bootstrapper/install.sh
```

The installer provides a `docker-compose` wrapper for the orchestration scripts.
It uses `docker compose --compatibility` to preserve their expected
underscore-separated container names. Service configuration, persistence and
platform acceptance are separate steps.

### Local integration test

Select compatible GitLab and Runner releases explicitly. The example below uses
GitLab CE 19.4.3 and Runner 19.4.0, also pinned by the disposable integration
suite. Do not point a new major version at existing GitLab data without following
GitLab's supported upgrade path.

For the local integration setup, include these optional exports in the complete
private main configuration at `PERSISTENT_DIR/configuration/.docker.env` before
starting GitLab. Do not create a partial main configuration containing only
these options. Inside the controller, `system/.docker.env` is a compatibility
link to the saved configuration; the persistent copy takes precedence over
configuration embedded in an image:

```bash
export GITLAB_IMAGE=gitlab/gitlab-ce:19.4.3-ce.0
export GITLAB_RUNNER_IMAGE=gitlab/gitlab-runner:v19.4.0
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

Mount the attached filesystem before startup. Install Certbot on hosts using
automatic HTTPS renewal (`sudo apt-get install -y certbot`). Create the root-owned selector
file `/etc/system-bootstrapper/persistence.env` using your actual mount path:

```bash
sudo install -d -m 0700 /etc/system-bootstrapper
sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<'EOF'
PERSISTENT_MOUNT=/mnt/bootstrapper-data
PERSISTENT_DIR=/mnt/bootstrapper-data/platform
SEED_DIR=/mnt/bootstrapper-data/seed
# Optional: PERSISTENT_UUID=<existing-filesystem-uuid>
EOF
sudo chmod 0600 /etc/system-bootstrapper/persistence.env
sudo bash bootstrapper/install-volume-host.sh
sudo bash start.sh
```

Replace the example paths with the existing volume mount; do not format it.
The host integration installs the persistent Docker mount dependency and
certificate integration. Startup rejects an absent or mismatched filesystem
before creating platform data directories. The seed must remain separate from
the live `platform` directory. Fresh and reset startup preserve this host-selected
seed path while loading legacy defaults. See [Persistent platform
volume](docs/PERSISTENT_VOLUME.md) for the directory layout, retained credentials
and VM replacement procedure.

On a fresh installation, open `http://localhost/` on the host. The bootstrapper
builds its image and starts the configuration wizard and sync proxy. Allow time
for the first build and service startup. Read the generated first-setup Sync login privately from
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

`SEED_DIR` is the host directory mounted at `/seed` in the bootstrapper. Harvest
creates a completed recovery snapshot containing service data from `/srv`, TLS
files from `/ssl`, and complete Certbot account/renewal state. It stops GitLab,
requires a clean exit, verifies a checksum/ownership manifest, and atomically
selects the new snapshot through `seed/current`. Earlier snapshots are retained.

Seed restore is explicit; startup does not automatically overwrite live data.
Restore requires GitLab to be absent or stopped, a completed manifest and the
same GitLab image identity. An incomplete or legacy unmarked Seed is rejected
before copying. A missing Seed leaves existing destination data alone.
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
