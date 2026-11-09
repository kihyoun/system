# Quickstart on a fresh Ubuntu host

Run on your own **fresh Ubuntu 24.04 or 26.04 LTS amd64** host with root/sudo,
curl, standard Python 3, internet access, **at least 8 GiB RAM**, 40 GiB free on
the system/live-data filesystem and 1 GiB for source. Reserve more space for
repositories, registry images, builds and backups. Ports 80 and 443 must be free.
An SSH session or local console must remain available. The memory preflight allows
up to 512 MiB reserved by the kernel/firmware on an 8 GiB host (7.5 GiB reported).

```bash
curl -fsSL https://github.com/kihyoun/system/releases/latest/download/quickstart.sh | sudo bash
```

The command downloads and runs the repository-owned installer as root. You can
inspect the release's `quickstart.sh` before running it. The published script is
bound to its own release tag even if `latest` changes during installation. It
retrieves that release's public versioned metadata and checksum, the exact System
source/tree and pinned Wizard source, then the matching public images by digest.
No private GitLab account, job artifact, Docker Hub login or local version list is
required. Public registries and GitHub may enforce anonymous request limits.

The installer checks OS, architecture, privileges, resources, ports and existing
installation paths before changing host packages. It delegates dependencies to
`bootstrapper/install.sh` and startup to `bootstrapper/install-release.py`; it
neither builds replacement images nor starts GitLab before browser configuration.
The native release installer rechecks clean source, image labels, immutable digests,
accepted image IDs, same candidate attempt and fresh persistent state.

Package installation, source downloads, image pulls and initial startup can each
take several minutes. Network and host resources determine the duration. A
startup readiness timeout preserves the checkout and state for inspection. Do not
remove that state or rerun as a fresh installation; follow the full installation
guide to inspect and resume the native operation.

## First access

The installer prints the ready Wizard address and the local instruction for
reading the unique generated Sync username/password. Credentials remain in the
root-only file:

```bash
sudo cat /var/lib/system-bootstrapper/platform/configuration/sync-auth.env
```

On the host, open `http://127.0.0.1/configuration`; the initial Sync address is
`http://127.0.0.1/sync`. On a remote workstation, use a protected SSH tunnel:

```bash
ssh -N -L 8080:127.0.0.1:80 <your-user>@<your-host>
```

Then open `http://127.0.0.1:8080/configuration` and set the Sync connection address
to `http://127.0.0.1:8080/sync`. Read credentials locally on the host and enter them
through the tunnel. Initial HTTP listens on the host's port 80 and does not provide
public TLS. Keep administrative access and use the full public-server guide before
exposing configured services or sending credentials over an untrusted network.

Continue in the existing Wizard: configure your GitLab/registry/Wizard/Sync
addresses and service ports, review storage and image choices, then Push. The
configuration Push starts the configured platform. Choose a GitLab SSH bind port
that leaves your administrative SSH service available; the installer does not
rewrite SSH or firewall configuration.

## Existing installations and advanced setup

Quickstart refuses saved configuration, retained live state, existing System
containers/volumes and an existing `/opt/system-bootstrapper` checkout. It never
moves or deletes them. An unsuccessful partial installation is retained too.
Use [host preparation](../Prepare-Host.md), the [handbook](HANDBOOK.md),
[recovery](RECOVERY_CONTRACT.md) or [persistent storage](PERSISTENT_VOLUME.md)
for an existing installation, WSL, custom paths, DNS/public HTTPS, Seed restore,
retained volumes, migrations and advanced host configuration.

Quickstart installs into `/opt/system-bootstrapper`, with ordinary local live
data beneath `/var/lib/system-bootstrapper/platform`. The host selector is
`/etc/system-bootstrapper/persistence.env`. It performs no automatic DNS setup,
certificate issuance, Seed operation, data migration or Production promotion.
A public release publication also does not change an existing platform.

See [release policy and exact source checkout](RELEASES.md) for the public metadata
contract, installation from an explicit version and update/rollback requirements.
