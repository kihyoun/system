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
also run on this host. GitLab, runners and production migration are not yet
validated.

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
