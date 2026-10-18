# Codex host handoff — 2026-10-18

## Start here

Continue from **System branch `codex/host-handoff-20261018`**. It combines the supported System runtime, Sync migration, organized isolated tests, Wizard source/build workflow, passive resource collector, disposable acceptance harness and the inactive GitHub backup helper. The Wizard submodule is pinned to `7aededb705fe9c25fc86bf683a7547d9c1565adb`, also preserved as `codex/host-handoff-20261018` in `kihyoun/system-wizard`.

The source tree before adding this handoff file is `43e6c5d8783520b3c26b519347f7e340b0c000e8`, published at System commit `3c2ed12ab004a95308c30726425e12d2c11f9cd5`. It matches the final local integration tree byte-for-byte. Some GitHub commits were created through the connected GitHub API and therefore have different commit IDs from local integration commits; compare trees and file contents rather than assuming those local commit IDs exist remotely.

```bash
git clone --branch codex/host-handoff-20261018 --recurse-submodules https://github.com/kihyoun/system.git
cd system
git status --short
git submodule status
```

Read `AGENTS.md`, [the handbook](docs/HANDBOOK.md), [source initialization](docs/WIZARD_SOURCE.md), [managed build/manual recovery](docs/WIZARD_BUILD.md), and [isolated tests](tests/README.md). Follow the handbook to bootstrap a fresh host. Runtime credentials, private configuration and the previous test instance are intentionally not needed for this source handoff. Generate the ignored Wizard source snapshot from the checked-out gitlink before building the System image:

```bash
bash project-bootstrap/wizard-source/prepare.sh
```

Do not change any System Cube bytes, its fixed HTTPS URL, the dollar position or port 8071. Verify authenticated Fetch, not only source text. Keep configuration management separate from Harvest/Seed.

## Completed verification

- Real own-GitLab acceptance passed on the original test host: private project 7, pipeline 13 at `61d42180687c1c7c3cd04fab5b5ebb52e9ea90a3`; required build job 38 and browser job 37 succeeded. Locked dependency installation, Jest, production build, registry publication, HTTP, rendered UI, Projects and SPA navigation passed.
- Both artifacts and the controller verified `registry.localhost:5050/root/wizard@sha256:1740164a44a7aed7caa9cd830ff1e2546dd0b9e557ccff2400af3ee0f96ae9e4`. Repeated activation retained the same initial pipeline. The local workflow receipt was preserved; the temporary candidate controller/image were removed.
- The first build failed because a WSL restart regenerated hosts mappings. Existing `bootstrapper/prepare-local.sh` restored registry resolution without restarting containers; retrying the same pipeline succeeded.
- All **26 combined isolated checks** passed, with Sync lint/TypeScript and owned cleanup. Companion Wizard UI validation passed 23 tests across 9 suites and its production build. The resource collector passed 10 offline tests on Windows and Linux. Backup helper offline suites passed on both platforms. Disposable lifecycle contracts passed on Windows and in a network-disabled Linux container.
- Existing production Wizard/GitLab/Bootstrapper service IDs and start times stayed unchanged. Live HTTP 200 and authenticated main/project Fetch signatures passed.
- These pipeline/project IDs and registry references describe the original test host. A fresh bootstrap creates its own identities; no prior GitLab state is required or restored.

## Open work and PRs

All requirements remain centralized in `kihyoun/system`. Use an existing issue before implementation and link PRs to it. Wizard PRs also reference central System issues. Do not create a separate Wizard issue collection.

| Delivery | PR | Current state |
| --- | --- | --- |
| Supported System/container runtime | [System #29](https://github.com/kihyoun/system/pull/29) | Unmerged; first runtime prerequisite |
| Sync runtime/dependency migration | [System #30](https://github.com/kihyoun/system/pull/30) | Unmerged; stacked on runtime |
| Component test organization/CI | [System #28](https://github.com/kihyoun/system/pull/28) | Unmerged; stacked on Sync |
| Wizard source initialization | [System #31](https://github.com/kihyoun/system/pull/31), [Wizard #12](https://github.com/kihyoun/system-wizard/pull/12) | Unmerged Phase A |
| Central issue policy | [System #32](https://github.com/kihyoun/system/pull/32) | Unmerged; original staged copy separately preserved |
| Wizard managed build/API/UI/manual | [System #35](https://github.com/kihyoun/system/pull/35), [Wizard #13](https://github.com/kihyoun/system-wizard/pull/13) | Unmerged Phase B; real build/check acceptance passed |
| Inactive GitHub backup transport | [System #36](https://github.com/kihyoun/system/pull/36) | Unmerged; no live push/activation |
| Passive resource measurement | [System #37](https://github.com/kihyoun/system/pull/37) | Unmerged; measurement tools, no VM sizing conclusion |
| Disposable platform-test lifecycle | [System #38](https://github.com/kihyoun/system/pull/38) | Unmerged; offline lifecycle contracts only |

The handoff branch is a combined source checkpoint, not evidence that these PRs were merged or that the running management UI was upgraded. Review their stacking and merge deliberately; do not overwrite the current main branches.

Remaining requirements:
- [#18](https://github.com/kihyoun/system/issues/18): Review/Beta and explicit manual GitLab Production promotion/rollback, followed by full rollout acceptance. Source import/build/check is proven; the full feedback workflow is not finished.
- [#22](https://github.com/kihyoun/system/issues/22): Wizard React/CRA/dependency modernization after the own-platform workflow is ready. The current Wizard builder deliberately remains legacy Node 13/CRA; this is not a supported modern application stack.
- [#21](https://github.com/kihyoun/system/issues/21): full disposable infrastructure/CI acceptance still needs a coordinated resource window. Do not launch privileged DinD beside the live platform without resource review. The 12 GiB/4 CPU values are ceilings, not reservations or a disk quota.
- [#26](https://github.com/kihyoun/system/issues/26): controlled resource/build-peak measurements and Hetzner sizing. Three passive baseline samples are not sizing proof. A later passive observation during the real build hit its bounded WSL timeout and retained no complete metrics.
- [#34](https://github.com/kihyoun/system/issues/34): transition to own GitLab as primary and GitHub as backup. The helper is tested but disabled. Resolve original-history preservation versus a new backup branch before changing history; prevent backup/deployment loops and coordinate System/Wizard repository and issue/MR mappings.

No Production deployment, Review/Beta rollout, live backup activation, GitLab-primary cutover or PR merge was authorized/performed in this completion step. The maintainer delegated the first real build/check run, superseding the earlier plan to trigger that run personally. There are no outstanding agent builds from this handoff.

The existing detailed workflow plan and coordination instructions are Markdown comments in [issue #18](https://github.com/kihyoun/system/issues/18), not a newly committed `plan.md`.

## Additional source snapshots

These branches preserve older dirty checkouts and parked source without mixing them into the tested start branch:

| Repository / branch | Snapshot |
| --- | --- |
| System `codex/host-handoff-wsl-local-20261018` | `70f8b898ca0fc6801f372798d0b4ee1dcd295572`; 14 changed/new files from the older `/opt/system-bootstrapper` checkout |
| System `codex/host-handoff-wsl-review-20261018` | `038108ea48425a57f0e3d98938d0ac29429e8092`; 83 changed/new source entries from `/opt/system-bootstrapper-review`, including the saved dirty Wizard submodule |
| Wizard `codex/host-handoff-wsl-review-20261018` | `57ff8527a4543b3f0a596de200df8b6c04c383e6`; nine changed/new files from the older review Wizard |
| System `codex/host-handoff-policy-20261018` | `554b08cef1b4c1c5ef1889fba87df228fe097b5f`; original staged AGENTS policy and central-issue Wizard pin |
| System `codex/host-handoff-drafts-20261018` | `851a250a79c6c2434cbff97ac9bdf889d352f722`; loose parked drafts and validation helpers under `handoff/archive/` |

Snapshot trees were checked against the selected working-copy bytes/modes. The review System snapshot intentionally points to the newly saved Wizard snapshot. Existing source files, indexes and dirty WSL checkouts were left untouched. Older WIP snapshots are preservation copies, not tested upgrades; do not blindly merge them into the combined start branch.

Generated dependencies, Docker/test images, machine-specific disk-migration helpers and private runtime files were omitted. Regenerable test artifacts remain documented by the acceptance identities and issue comments. Only the two project repositories are required for continuing the source work.
