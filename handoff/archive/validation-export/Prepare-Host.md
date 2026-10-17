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

The installer provides a `docker-compose` wrapper for the legacy orchestration
scripts. It uses `docker compose --compatibility` to preserve their expected
container names. This prepares the host; it does not by itself verify the
complete platform or modernize GitLab and the application images.

Validated on Ubuntu 26.04.1 under WSL2 with Docker Engine 29.9.1 and Compose
5.6.0: installer, `hello-world`, and a Compose service using the legacy
underscore-separated container name. The first-boot wizard and its sync API
also run on this host. A fresh GitLab CE 19.4.2 instance with Runner 19.4.0
passed a pipeline that clones a repository, builds an image, pushes and pulls
it through the HTTP registry, runs the image and uploads a job artifact.
Production HTTPS, existing-data migration and the UI project's own pipeline
have not been validated.

### Local integration test

The modern GitLab version was tested with empty volumes only. The legacy
GitLab default remains unchanged; do not point a new major version at existing
GitLab data without following GitLab's supported upgrade path.

The test used these optional exports in `system/.docker.env`:

```bash
export GITLAB_IMAGE=gitlab/gitlab-ce:19.4.2-ce.0
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

Create a runner in GitLab, set its `glrt-` authentication token as
`GITLAB_RUNNER_TOKEN` and set `GITLAB_RUNNER_SCALE=1` in the private configuration.
The registration script also accepts legacy registration tokens and verifies
existing registrations instead of duplicating them.

Copy `tests/registry-smoke.gitlab-ci.yml` into a disposable GitLab project's
`.gitlab-ci.yml` to reproduce the integration test. It uses this platform's
Docker socket runner. Default BuildKit attestations are disabled for this test
because the registry rejected their manifest with `blob unknown to registry`.
The successful test covers a single-architecture image without attestations.
See the [GitLab compatibility workaround](https://support.gitlab.com/hc/en-us/articles/29426166749596-Push-to-Container-Registry-Fails-Error-error-from-registry-blob-unknown-to-registry).

Keep tokens and generated `.docker.env` files out of Git. The existing UI
pipeline and its public domain targets have not been changed. The next step
is to provision the actual Ubuntu server and integrate the UI project there.

### Historical remote installer

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/master/bootstrapper/install.sh)"
```

(Optional) Install zsh and pull .zshrc:

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
sh -c "$(curl https://raw.githubusercontent.com/kihyoun/system/master/.zshrc -o /root/.zshrc)"
```

## Clone
```bash
git clone --recursive https://github.com/kihyoun/system.git
```

## Boot
```bash
cd system
bash start.sh
```

On a fresh installation, open `http://localhost/` on the host. The bootstrapper
builds its image and starts the configuration wizard and sync proxy. Allow time
for the first build and service startup. Obtain the generated sync login from
`sudo docker logs system_bootstrapper_1` (the `SYNC_USER` and `SYNC_PASS` lines).
These credentials change when the sync process restarts.

Under WSL, keep an Ubuntu shell open while using the platform: systemd services
alone do not keep the WSL instance alive. See
[Microsoft's WSL systemd documentation](https://learn.microsoft.com/en-us/windows/wsl/systemd).

## Seed lifecycle

### First-setup suggestions in the Wizard

With the matching Wizard update, `Synchronize → Fetch` first requests the saved
configuration as before. Only a missing main configuration (HTTP 404) triggers
the new authenticated `GET /config/suggestions` endpoint. Authentication and
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
independent from the persistent-data workflow (`Harvest` / `Seed`). No new
configuration volume or automatic persistence mechanism is introduced here.

After compiling sync, run `node tests/config-suggestions.js`. The API test
`node tests/config-suggestions-api.js` must run in a disposable container: it
starts its own sync process on port 8071 with a temporary configuration tree.

### GitLab first administrator login

The username is `root`. For a fresh database, the bootstrapper generates a unique
initial password, or accepts `GITLAB_INITIAL_ROOT_PASSWORD` (at least 12 characters)
from the private `system/.docker.env`. The tracked example deliberately has no
shared default password. The wizard does not yet expose this optional field.

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

The ASCII startup signature and Sync login output are unchanged. Sync credentials
and the GitLab administrator credentials remain separate.

Run `node tests/gitlab-root-password.js` to check the initialization behavior
using temporary directories without touching a running GitLab installation.

### Persistent state

`SEED_DIR` is the host directory mounted at `/seed` in the bootstrapper. It
holds the persistent state used to bootstrap a subsequent production generation.
`harvest.sh` copies `/srv` and `/ssl` into that directory; `seed.sh` restores them.

- If neither `srv` nor `ssl` exists in the seed, restoration is skipped. A fresh
  installation can start empty, and existing destination data is left alone.
- If both directories exist, their contents are restored with `rsync --delete`.
- If only one exists, restoration fails before either destination is changed.

The current startup path does not automatically restore a seed. Restoration is
an explicit operation exposed by the control panel. A production generation
workflow still needs consistent GitLab backups and a validated migration path;
the file-copy test below does not establish database backup consistency.

After building the bootstrapper image, test this behavior inside Ubuntu with:

```bash
sudo python3 tests/seed-cycle.py
```

The test uses temporary directories and disposable containers. It checks the
harvest/restore round trip, a missing seed and an incomplete seed without
mounting the platform's real volumes or seed directory.

## Shutdown
```bash
bash stop.sh
```
