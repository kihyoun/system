# The System — System Bootstrapper

**You build it. You own it.**

Bring your development platform to your own server. Build, test and publish web
projects with your tools and data under your control.

System Bootstrapper brings together GitLab, runners, a container registry,
deployment routing and a browser-based configuration Wizard. Create projects
from React, Angular or general web starters, or begin with an empty repository.
Your source and CI stay editable.

## Install

On a fresh **Ubuntu 24.04 / 26.04 LTS x86_64** host with **sudo access, curl, Python 3,
internet, at least 8 GiB RAM, 40 GiB free for data plus 1 GiB for source, and free
ports 80/443**, run:

```bash
curl -fsSL https://github.com/kihyoun/system/releases/latest/download/quickstart.sh | sudo bash
```

The installer selects the tested public release, prepares the host and starts
the initial Wizard. Follow its local first-access instructions, then configure
the platform in your browser. Downloads and service initialization take time.

See [Quick Install](docs/QUICKSTART.md) for the supported scope and first access.
For public DNS/HTTPS, WSL2, existing installations and recovery, choose the
appropriate [handbook path](docs/HANDBOOK.md). The installer preserves existing
state and does not perform an unattended migration or recovery.

## Use and maintain

- [Handbook / Docs](docs/HANDBOOK.md): installation, configuration, runners and troubleshooting. The Wizard’s **Docs** reader includes English, German and Korean chapters without requiring a Sync connection.
- [Create an application](docs/PROJECT_BOOTSTRAP_GUIDE.md): private repositories, editable starters, pipelines and environments.
- [Storage](docs/PERSISTENT_VOLUME.md) and [recovery](docs/RECOVERY_CONTRACT.md): keep configuration and completed service-data Seeds separately; ordinary operation needs no backup disk.
- [Evolve a running system](docs/HANDBOOK.md#5-evolving-a-running-system): validate existing-state migrations, promote a reviewed successor and retain a tested recovery path.
- [Releases and changelog](docs/RELEASES.md): public versioned metadata, source/image identities and release notes.

Recorded operator-assisted installation and Seed recovery took **10 min 58 s**
and **16 min 22 s** respectively, with different verification scopes. These are
observations, not a guarantee or benchmark; see the
[measurement context](docs/HANDBOOK.md#measured-installation-and-recovery-times).

## Built to evolve

I started System Bootstrapper in **2019**, before AI coding agents, to spend
more time building projects and less time assembling infrastructure. Its
principle remains: **the source code is the DNA; running infrastructure is a
reconstructible instance of it**, with configuration and persistent data
preserved separately.

A running generation supplies the tools to develop, build and test its
successor. Repository-owned tools support reviewed promotion and recovery;
operators authorize Production changes. Fully autonomous recursive improvement
and communication between nested bootstrapper instances remain future vision.
See [architecture, history and vision](docs/ARCHITECTURE.md) for the design,
repository map and verification boundaries.

## Participate

See [dependency update operations](docs/DEPENDENCY_UPDATES.md), [dependency security](docs/DEPENDENCY_SECURITY.md), [contribution guidance](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md),
[security reporting](SECURITY.md) and [license](LICENSE). Reproducible
[component and integration checks](tests/README.md) are included.
