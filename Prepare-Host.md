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
underscore-separated container name. The complete platform is not yet tested.

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

## Shutdown
```bash
bash stop.sh
```
