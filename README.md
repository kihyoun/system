# The System — System Bootstrapper

**Bootstrap a development platform. Use it to build, test, and evolve its own next generation.**

System Bootstrapper is a project for a self-hosted software development platform on a single Ubuntu server or virtual machine. Its starting point is simple: clone a repository, run the bootstrap process, and let it assemble the services, container networks, and reverse-proxy configuration needed for a working development environment.

Its larger goal is continuous renewal: the platform should provide the GitLab workflow and CI/CD infrastructure used to develop and validate the platform itself.

## Current status

**This is a legacy implementation awaiting restoration, not a currently verified installation.**

The idea dates back to 2019. Development did not reach a sustainable renewal cycle, maintenance fell behind, and the existing code no longer provides a working bootstrap according to the maintainer. Compatibility with a current Ubuntu and Docker installation has not yet been re-established.

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

## Vision: the platform develops its successor

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
