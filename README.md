# The System — System Bootstrapper

**Bootstrap a development platform. Use it to build, test, and evolve its own next generation.**

> **Build your web projects. Not your infrastructure.**

## How it started: a developer's problem, a bigger idea

Imagine you're a solo front-end developer. You want to build and maintain your own web projects. You want the freedom of self-hosting on an affordable server—but you don't want to spend your evenings configuring services, chasing broken dependencies, or planning infrastructure upgrades.

That's the problem that led me to start **System Bootstrapper** in 2019. I wanted a development platform I could bootstrap for my own projects instead of repeatedly assembling and maintaining all the pieces by hand.

But getting the platform running was only half the problem. The platform itself would age and need upgrades. That led to a bigger question: **What if the platform could use its own development tools to build, test, and deliver its next generation?**

The idea grew from a convenient self-hosted setup into an open-source framework for **generation-by-generation renewal**. The running system should be able to develop a candidate successor, validate it as a complete platform, safely carry forward its persistent state, and let the validated successor repeat the process. A human developer—or, in the future, an optional AI agent—could propose changes through the same merge-request workflow.

The original use case is still simple: spend more time building web projects and less time maintaining the infrastructure behind them. But the underlying architecture could eventually support other kinds of infrastructure. **The self-renewal cycle is the project's vision, not a capability already delivered today.**

## Current status

New here? Start with the illustrated [System Bootstrapper Handbook](docs/HANDBOOK.md),
including checkout, the first Sync login, configuration suggestions and the
local setup workflow. The handbook is currently written in German and documents
the local test version.

**The local platform now runs on Ubuntu/WSL2, including GitLab, a runner and an HTTP registry; production setup remains to be validated.**

The host installer, wizard, sync API authentication and file-based seed cycle
have been exercised on Ubuntu 26.04.1 with Docker Engine 29.9.1 and Compose 5.6.0.
See [Prepare-Host.md](Prepare-Host.md) for the tested first-boot procedure and
seed behavior. A fresh GitLab CE 19.4.2 / Runner 19.4.0 test also passed repository
checkout, Docker build, registry push/pull, container execution and artifact
upload. Production HTTPS, existing-data migration and the UI project's own
pipeline remain unverified. The immediate next step is deployment on an Ubuntu
server and integration of the UI project; generation changes are outside the
current repair scope.

The idea dates back to 2019. Development did not reach a sustainable renewal cycle and maintenance fell behind. Restoration has recovered the initial configuration environment, but compatibility of the complete platform with current Ubuntu and Docker is not yet established.

The repository contains the foundations of the platform:

- Shell scripts and Docker Compose definitions for bootstrapping and coordinating services.
- GitLab Community Edition, container registry configuration, and GitLab Runner setup.
- NGINX routing and proxy configuration for production, beta, and review environments.
- A React configuration wizard referenced as a Git submodule.
- A GitLab CI configuration for building the bootstrapper image and deployment/publishing jobs.
- Scripts and configuration for synchronizing persistent data.

These are existing implementation pieces, not a claim that the complete workflow currently works. In particular, the repository's CI configuration does not yet implement the full platform review-and-test cycle described below; its test stage remains a TODO.

## Why this project exists

Setting up a development platform involves more than installing GitLab or starting a few containers. GitLab, its runners, the registry, application environments, networks, domains, and reverse proxies must work together.

System Bootstrapper encodes that setup in a repository. Docker containers provide the services, while scripts and configuration connect them into a development platform. The intended entry point is an Ubuntu host with the required access and resources; the bootstrap process should turn that host into a usable environment with minimal manual setup.

But installation is only the beginning. Dependencies change, services evolve, and a once-working environment can become difficult to update. The central purpose of this project is to make that renewal a normal, testable development workflow.

## Vision: automated recursive self-improvement

The System Cube also records a theoretical possibility for modular
communication. The `$` opening in its ASCII signature, reflected in port `8071`,
symbolizes a future opening to the outside world for introducing a seed and
communicating with other bootstrapper instances. This broader opening has not
yet been developed into a working interface. In the intended model, systems
contained within a Cube would communicate according to the same principle:
each system could expose an interface to its surroundings and contain other
communicating systems, allowing recursive composition.

This is an architectural possibility. The existing sync API does not implement
this broader communication model;
inter-bootstrapper and internal-system communication under a common model still
need to be specified and demonstrated. The port itself does not establish that
protocol or guarantee continuous connectivity.

The architecture should eventually support a feedback loop: identify a possible improvement, produce a candidate change, build and evaluate it, promote a validated improvement, and repeat from the improved system. The recursive aspect is that the system being improved also supplies the machinery for the next improvement cycle; that machinery can itself evolve.

Rebuilding or replacing a generation alone does not demonstrate improvement. A convincing demonstration needs explicit objectives and evaluation criteria that show what improved and whether required behavior was preserved. The mechanisms for proposing changes, evaluating them and deciding promotion remain to be designed and validated. This is the long-term vision, not a claim of current autonomous capability or an expansion of the present platform-restoration task.

The running platform should host its own source code and execute the pipelines that build its next version.

A merge request should be able to start a separate candidate platform from its branch. That candidate should represent the platform itself—including the relevant GitLab, runner, registry, network, and proxy configuration—rather than only a sample application deployed on top of it.

The intended cycle is:

1. **Bootstrap generation A.** Create an initial working platform on an Ubuntu host.
2. **Develop generation B using A.** Store and change the platform's own code through the GitLab workflow provided by the running platform.
3. **Create a review platform.** A GitLab Runner executes a pipeline that starts the candidate container landscape for the merge request.
4. **Validate the complete environment.** Automated checks and human review establish whether the services work together and whether the upgrade path is viable.
5. **Promote the tested version.** After approval and successful validation, deploy the new platform version while preserving the required persistent state.
6. **Repeat using B.** The new production platform becomes the environment used to develop generation C.

Review environments and tests are therefore central to the project's purpose. They are the mechanism for improving the system before its dependencies become an unmanageable maintenance backlog.

This does not make maintenance automatic by itself. Dependency changes still need to trigger work, tests need to cover meaningful behavior, and deployment needs an explicit approval and recovery process. Automated update merge requests and AI-assisted maintenance could help sustain that cycle; they are future possibilities, not existing features.

## One host, multiple platform generations

The intended design does not require a separate VM for every review environment. GitLab Runners execute pipelines capable of starting Docker containers, allowing the current platform and a candidate generation to coexist on a single sufficiently provisioned host.

Each candidate needs its own container identities, networks, state, and routing so that multiple generations can run without interfering with one another. NGINX and the review network provide the basis for making those environments reachable.

The existing architecture uses an entry-point NGINX service and separate production, beta, and review proxies. Dynamic application routing uses `VIRTUAL_HOST`. Extending and validating this model for complete platform instances is part of the work ahead.

A single host keeps the infrastructure footprint small, but it remains a shared resource and failure domain. Containers share the host kernel; they are not independent virtual machines. Host-level Ubuntu, kernel, and Docker Engine updates require their own maintenance path.

![Historical platform architecture](overview.png)

*This diagram documents the earlier architecture. It is not evidence that the complete self-renewal workflow is implemented.*

## What a successful renewal must prove

A candidate is not ready merely because its containers start. The target validation should demonstrate that:

- GitLab is reachable and can host the platform repository.
- A runner can execute a pipeline and build an image.
- The registry can accept and serve that image.
- Domain routing reaches the correct environment.
- A candidate environment can coexist with production and be removed without affecting it.
- Upgrades work with representative existing data, not only an empty installation.
- A failed deployment has a tested recovery path.

The container definitions can be reproduced; GitLab repositories, database contents, registry data, configuration, and secrets still require deliberate persistence and protection. Updating an image is not sufficient to guarantee a safe migration, and reverting an image may not reverse a database migration.

## Repository map

| Path | Purpose in the existing implementation |
| --- | --- |
| `start.sh`, `stop.sh` | Top-level lifecycle entry points. |
| `bootstrapper/` | Bootstrapper base image and host installation script. |
| `system/` | Main Compose definition and orchestration scripts. |
| `gitlab/` | GitLab lifecycle and configuration scripts. |
| `gitlab-runner/` | Runner configuration, registration, and lifecycle scripts. |
| `nginx/` | Entry-point reverse-proxy configuration and lifecycle scripts. |
| `nginx-proxy/` | Production, beta, and review proxy configuration. |
| `sync/` | Synchronization-related configuration and scripts. |
| `wizard/` | Configuration wizard submodule. |
| `.gitlab-ci.yml` | Existing image build and deployment/publishing pipeline. |
| [Prepare-Host.md](Prepare-Host.md) | Historical host preparation notes; not a validated current installation guide. |

## Restoration and next milestones

The immediate goal is to restore a working baseline and establish the renewal cycle early.

1. **Restore the bootstrap on a clean Ubuntu test VM.** Inspect and repair the scripts, dependency versions, configuration, and service integration. Record the host and software versions that actually pass validation.
2. **Make that baseline reproducible.** Define configuration inputs, pin tested dependencies, and verify a fresh installation.
3. **Build a second platform from a merge request.** Run a candidate alongside the current platform on the same host, with isolated state and routing.
4. **Test the candidate and the transition.** Cover service integration, representative data migrations, cleanup, and recovery.
5. **Complete one generation change.** Promote the validated candidate and use it to build the next candidate.
6. **Keep the cycle active.** Establish regular update checks and reviewable changes so maintenance happens continuously.

The first decisive milestone is a running platform that can build and validate another working platform from a branch. The complete vision is reached when the validated successor can take over and repeat that process.

## Working with the current code

There is currently no verified quick-start procedure. Earlier installation instructions and remote one-line installers should not be treated as working instructions for a modern host.

Use a dedicated, disposable Ubuntu test VM for restoration. Inspect the scripts before running them: the bootstrapper mounts the Docker socket, and the configuration can change services, networking, ports, and persistent volumes on its host.

After the bootstrap has been repaired and tested, this section should document the supported Ubuntu version, resource requirements, configuration inputs, installation commands, verification steps, and recovery procedure.

## Guiding principle

**Every stable generation should provide the tools to build, test, and deliver the next one.**

The goal is a maintainable development platform whose own evolution follows the same reviewable software engineering workflow it provides to its users.

## Application project bootstrap

Projects → Add Project → Save now provisions a private GitLab repository and managed CI through authenticated Sync, with namespace-aware availability and asynchronous status. See the [project bootstrap guide](docs/PROJECT_BOOTSTRAP_GUIDE.md) for the workflow, retry behavior and validation. Importing the Wizard itself remains an optional next step.
