# Use GitLab as primary with an optional GitHub code mirror

The guarded backup helper forwards a protected GitLab default-branch commit
to an explicitly mapped GitHub branch. It is opt-in: adding the helper to a
checkout does not change remotes, activate synchronization or migrate project
metadata. Select a primary repository and integrate the helper into its chosen
CI configuration before enabling it.

## Development and tracking roles

Select the GitLab projects for System and Wizard and a central issue tracker.
An operator may keep their issues together in the System project while reviewing
Wizard changes in the Wizard project. Record the selected identities in agent
instructions and external project tracking; the product does not require one
maintainer's GitLab host or issue history.

After activation, create work in that GitLab tracker, branch from the intended
GitLab default branch, and open the merge request in the affected source project.
Reference cross-project issues with their project-qualified GitLab reference.
Run the project's required checks, review the final diff and merge there. The
protected default-branch pipeline then forwards that exact merged commit to the
mapped GitHub branch. GitHub is a public code mirror, not a second merge target.
Contributors and agents use the same issue, branch, review and merge workflow.

GitHub availability is not a prerequisite for source checks, merge-request work
or private delivery. If the enabled mirror job fails, its pipeline remains
visibly failed and the job is retryable. Required source-check evidence and
delivery evidence remain independently usable; do not hide the mirror failure
with `allow_failure` or require that job to succeed before continuing internal
work. Configure merge permissions and required source checks accordingly.

A successful mirror job does not promote Production. In particular, Wizard
Production remains a separate deliberate action using verified pipeline, source
and immutable image evidence. Moving development does not extend the Wizard's
existing rollout mechanism into automatic deployment of the whole platform.

## Resolve history before enabling anything

Record an explicit mapping for both System and Wizard:

| Setting | Meaning |
| --- | --- |
| Source project | Exact GitLab `owner/project` identity |
| Source branch | The project's protected GitLab default branch |
| Backup repository | Existing `git@github.com:owner/repository.git` |
| Backup branch | Explicit destination; it need not share the source branch name |

A Wizard initialized through the managed source-import workflow starts with
scaffold/import commits, rather than the upstream GitHub ancestry. Such a
repository cannot simply fast-forward the existing upstream branch. Review
either a history-preserving migration into GitLab or a separate backup branch
with an agreed starting point. The same ancestry check applies to any source
and destination pair. Do not force-push, synthesize an automatic merge or
quietly switch the backup target. The helper requires an existing destination
branch with compatible ancestry.

### Source projects and managed delivery projects

If the managed Wizard repository has independent private history, a clean
source-primary project can preserve the public source ancestry while the
existing managed repository continues to build and deliver the application.
These are distinct roles, even when both projects live in the same GitLab.
Keep managed delivery history private: merging its ancestors into a public
source branch would publish those commits too, even if the resulting files
look identical. Retain the existing project, refs, receipts, managed recipes
and deployment generation floors when establishing the clean source project.

The source-to-delivery handoff is explicit and reviewed. For the accepted merged
`sourceCommit`, verify that the required `build:source` and `test:browser` jobs
succeeded for that exact SHA. Record those job identities, the source SHA,
current delivery base and resulting `deliveryCommit` in external tracking or
private operator records. Overall pipeline success is not the source gate:
an optional GitHub mirror outage can leave the pipeline failed while those
required jobs succeeded. No GitHub read or mirror-job success is required for
the private delivery build, its tests or the reviewed handoff.

Transfer only the reviewed application
changes from that source commit, inspect any differing destination files, and
use the destination's normal branch/MR process or guarded managed operation.
Never replace its managed CI, ownership markers or history by reimporting the
whole source tree to bypass a conflict. Verify the transferred files against
the selected source revision and run the delivery build and browser tests.
Production proof identifies the actual delivery commit and image digest;
the handoff mapping links it to the reviewed source commit. This procedure
does not imply an automatic source-to-delivery synchronizer or automatic
System deployment.

Keep the upstream public submodule URL portable. Inside a GitLab-primary System
checkout, explicitly select the matching private Wizard source before updating:

```sh
git config submodule.wizard.url '<operator-selected GitLab Wizard clone URL>'
git submodule update --init wizard
```

Use an authenticated clone URL without embedded credentials. `git submodule
sync` replaces a local override with `.gitmodules`, so reapply the private
mapping if syncing is needed. In System CI, `prepare:wizard-source` disables
automatic runner submodule checkout with `GIT_SUBMODULE_STRATEGY: none`.
`gitlab/prepare-wizard-source.js` then initializes and verifies the exact gitlink
using the configured private selector before source packaging. An override
applied only after this preparation step would be too late.
Verify that the selected Wizard repository contains the exact System gitlink.
The development and test path must not need a successful GitHub read to proceed.

## Helper contract

`gitlab/github-backup.sh` runs in a checkout with an `origin` pointing to the
intended primary GitLab project. The CI integration provides its pinned Node 24
runtime, Git, OpenSSH client/agent and a POSIX shell with `mkdir` and `rmdir`.
Keep the companion
`github-backup-transport.js` beside the shell helper. Configuration comes from
the protected CI job:

| Variable | Required value |
| --- | --- |
| `GITHUB_BACKUP_ENABLED` | `true` to explicitly enable the configured backup job |
| `GITHUB_BACKUP_SOURCE_PROJECT` | Approved exact `CI_PROJECT_PATH` |
| `GITHUB_BACKUP_REMOTE` | Approved GitHub SSH repository, without credentials |
| `GITHUB_BACKUP_BRANCH` | Approved existing backup branch |
| `GITHUB_BACKUP_TIMEOUT_SECONDS` | Optional per-transport deadline, integer 1–300; default 30 |
| `GITHUB_SSH_KNOWN_HOSTS` | Protected file variable containing independently verified GitHub SSH host keys |

GitLab supplies `GITLAB_CI`, `CI_PIPELINE_SOURCE`, `CI_PROJECT_PATH`,
`CI_DEFAULT_BRANCH`, `CI_COMMIT_BRANCH`, `CI_COMMIT_REF_PROTECTED` and
`CI_COMMIT_SHA`. Only a protected default-branch **push** pipeline is eligible.
MR, API, manual/web and tag pipelines do not replicate. The checkout must match
the full pinned SHA, and that commit must still belong to the freshly fetched
source default branch. Configure protected-branch permissions so only reviewed
merges reach it; a shell script cannot prove that review took place.

The helper fetches complete source ancestry, including unshallowing CI clones.
The runner therefore needs read access to the primary and write access to the
mapped backup. It changes neither `origin`, the checkout, nor local branches.
Temporary refs under `refs/system-backup/` are removed on normal exit/signals.
Those scratch refs are replaceable; the destination branch is never force-pushed.

Each invocation forwards the **same merged commit**, using a normal Git push:

- A target behind the pinned commit advances by fast-forward only.
- An equal target is an idempotent success.
- A target already containing an older queued commit succeeds without rewinding.
- A divergent target, missing branch or removed source commit fails visibly.
- Rejected pushes and uncertain responses are re-fetched and re-evaluated, with
  at most three push attempts. Retry the CI job after resolving an access error.

Push explicitly disables inherited `push.followTags`; only the configured
branch is forwarded. Each fetch/push runs under the Node transport boundary
with a wall-clock deadline. On Unix it owns a process group, sends TERM and
then KILL after two seconds even if the leader exited first. On Windows the
offline fixture targets only its own recorded child PID/tree using `taskkill`.
Cancellation uses the same tree cleanup. The CI job must retain a finite job
timeout with runner process cleanup as an outer safety boundary. A deadline
failure releases the checkout lock; an uncatchable host/process termination
still requires the interrupted-owner inspection described below.

A checkout-local lock rejects overlapping invocations using the same Git object
database. An uncatchable termination can leave that lock behind; inspect the
owner before removing `.git/system-github-backup.lock` (use the common Git
directory for linked worktrees). **This is not a distributed lock.** The CI job
must also use the same per-repository `resource_group` across eligible pipelines.
Normal Git ref updates remain atomic even if two independent checkouts race.
An older job can run after a newer one safely. See
[GitLab resource groups](https://docs.gitlab.com/ci/resource_groups/).

The helper suppresses transport output, disables shell tracing and local Git
hooks, and logs only fixed outcome messages. Transport output is discarded,
terminal/credential-manager prompts are disabled and SSH uses BatchMode with
strict host-key checking. The job must pre-provision verified `known_hosts`;
unknown keys fail rather than prompt or bypass verification. The core helper
does not read a private-key variable, print a remote URL or install credentials.
The CI wrapper reads the selected private key and starts an owned temporary
SSH agent. That setup must use protected/masked credentials and verified host
keys; do not enable
CI debug tracing or echo secrets in surrounding commands. Retain the existing
protected `GITHUB_SSH_PRIVATE_KEY` identity unless separately authorized.

## Integrate with the selected CI configuration

System's `deploy:github` job uses this helper after its required checks. It is
explicitly opt-in and uses the selected default branch, supported pinned Node
runtime, verified `GITHUB_SSH_KNOWN_HOSTS` file and existing protected SSH identity.
Configure all mapped values before enabling it. The job is serialized by
`github-backup-$CI_PROJECT_ID`; its failure remains a failed pipeline result.

System's separate `deploy:dockerhub` publishing role is also opt-in. Set the
protected `DOCKERHUB_PUBLISH_ENABLED=true`, `DOCKERHUB_USER` and `DOCKERHUB_PASS`
variables only when that publication is intended. It runs after the existing
required System gates on protected default-branch push pipelines, never MR,
API or tag pipelines. Enabling it without credentials fails visibly. This
flag is independent of `GITHUB_BACKUP_ENABLED`; neither publication enables
Production promotion or bypasses the resource-heavy System candidate checks.

The managed Wizard selects `.system-bootstrapper/ci.yml` for build/test and any
installed optional environment jobs. Its preserved upstream `.gitlab-ci.yml`
is not active. When using separate source and delivery projects, select the
Wizard's committed `.gitlab/primary.yml` as the clean source project's CI
configuration path. Keep the private delivery project's managed CI path and
recipe unchanged. The source pipeline runs `build:source` (locked install,
lint, unit tests, TypeScript, production build and configuration-export bundle),
then `test:browser` against that exact build artifact using Playwright Chromium
and a loopback preview. It needs no host Docker access or deployment. Only the
eligible protected default-branch pipeline reaches `deploy:github` afterward.
Do not enable the preserved upstream pipeline merely to obtain its legacy
publishing jobs. A source mirror job belongs after the source project's
required checks, with the same protected enablement gate, serialized resource
group and visible failure behavior. Delivery build/test remains a separate
gate before controlled Production promotion.

Use the existing protected `GITHUB_SSH_PRIVATE_KEY` identity; a file variable is
preferred, while existing masked multiline values remain supported. Supply SSH
host keys in `GITHUB_SSH_KNOWN_HOSTS` after independent verification, never a
runtime key scan. System CI can use `WIZARD_PRIMARY_REPOSITORY_URL` to fetch its
exact gitlink from the operator-selected Wizard project on the same HTTPS
origin as `CI_SERVER_URL`, using the job token. Authorize the System project to
read that Wizard project through GitLab's job-token permissions. The URL is a
nonsecret selector and must also be available to ordinary MR pipelines; making
only this variable protected would leave those pipelines on the public fallback.
The job token remains process-local and redirects are refused. The public
`.gitmodules` mapping remains available for fresh public recursive checkouts.
Before fetching, the source selector reconciles an existing or reinitialized
Wizard submodule's cached `remote.origin.url` to the chosen credential-free
internal URL, then verifies the exact gitlink. A previously cached public remote
therefore cannot silently override the selected internal source. The System
superproject's `origin` remains unchanged.

The upstream Wizard also has `deploy:system`, which updates the System gitlink
and uses a legacy hardcoded GitLab host. Do not reactivate it blindly. The
internal order is Wizard merge/checks and exact commit availability in the
GitLab source project, then a deliberate System gitlink update and System checks
through the normal review process. Public mirroring has a separate restoration
ordering: ensure the referenced Wizard commit is present on its GitHub mirror
before claiming the System mirror supports a fresh public recursive checkout.
A lagging public mirror does not block internal gitlink work or private delivery.
No automatic System merge
or Production deployment is introduced. Production remains a deliberate
operator-confirmed [promotion action](../project-bootstrap/wizard-production/README.md).

## Activate the selected primary/backup relationship

1. Verify the real GitLab review, required-check and deployment workflow on your
   own infrastructure before changing its role.
2. Agree mappings and resolve the history prerequisite above. Preserve previous
   refs and record a rollback contact/procedure. Pause competing writes during
   the switch; GitHub becomes backup-only, not another merge destination.
3. Audit GitHub Actions, deployments, webhooks and reverse mirrors. Disable or
   explicitly isolate reactions to backup pushes **before** activation. A
   byte-identical commit cannot be given a new skip marker without changing its
   identity. Audit the Wizard-to-System job separately to prevent a return loop.
4. Deliberately update remotes, agent guidance and issue/MR handling to the new
   primary. Transfer active work using the procedure below; Git pushes do not
   move issue metadata. Issue migration is separate from this helper.
5. Review and enable only the intended protected backup jobs, using authorized
   credentials and verified known-host material. Run the offline regressions
   before an explicitly controlled integration check.
6. Merge a harmless GitLab change through the reviewed workflow. Compare the exact
   resulting SHA on GitHub, test a visible failure/retry, and verify that no return push or
   unintended deployment occurred. Keep the former workflow recoverable until
   a disposable restore rehearsal passes.

## Transfer active work without losing its origin

Inventory active issues and pull requests before changing the tracker. Include
the original repository identity, item type/number, URL, title, description,
state, labels, ownership, timestamps, relevant discussion and acceptance
criteria. Keep that inventory, old-to-new identifiers and cutover verification
in external tracking or private operator records, not source documentation.
Never include tokens, private logs or deployment credentials in an issue export.

For each active issue, search the destination for its exact original URL before
creating a replacement. Put that URL and original identity in the new item's
description, preserve its requirements, and attribute copied comments to their
original author and timestamp rather than presenting them as new statements by
the importer. Validate the resulting text and links. Record the destination URL
back on the old item before closing it as moved. Retry by the recorded mapping
and source identity, so an interrupted transfer does not create duplicates.

Closed historical discussions may remain readable in the old tracker. Record
that choice explicitly; a Git source mirror does not migrate that history.
Retain an operator export if those records must remain accessible without the
old service. Already merged commits and historical commit messages need no
rewriting to replace old issue references. New discussions use the selected
GitLab tracker. Disable new issue creation and competing merge paths on the
mirror when supported, and publish the new contribution destination externally.

An open pull request requires its branch, target and review state to be checked
separately before recreating a GitLab merge request. Original reviews are
historical context, not fresh approval of a changed diff. Do not import a branch
by overwriting managed files or rewriting the destination's existing history.

## Verify the cutover on operator-owned infrastructure

Use a harmless change and private verification records for each source project:

1. Create a GitLab issue with a unique marker. Make a branch and merge request
   referring to it; for Wizard, verify the cross-project central issue link.
   Check that agents can read the issue and submit/review the merge request.
2. Prove an MR pipeline cannot publish the code mirror and a required-check
   failure cannot pass the merge/delivery gate. Review and merge the corrected
   diff through the protected branch's intended permissions.
3. Record the resulting full GitLab commit SHA. Confirm the eligible default-
   branch pipeline succeeds and GitHub contains that exact commit, without
   synthetic merge commits, reverse pushes or Production changes. Compare the
   final branch tip when no newer merges are queued; older queued jobs must
   not rewind a destination that already contains their commit.
4. Re-run the mirror job to prove idempotence. Exercise denied write access in
   an isolated mapping with a dedicated test credential, confirm visible
   failure, restore access and retry. Never break a shared production key or
   manufacture divergent history on the public branch for this test.
5. For System, verify GitLab-primary checkout with its internal submodule mapping.
   Confirm its required work and private Wizard delivery can run while GitHub is
   unavailable, using exact successful required-job evidence rather than overall
   pipeline success; the enabled mirror job remains visibly failed until retry.
   After the referenced Wizard commit is mirrored, verify fresh public recursive
   checkout separately before reporting the public System mirror restore-ready.
6. Capture a completed Harvest and matching configuration export using the
   existing recovery contract. In a disposable restoration, verify the fixture
   user, repository head, issue description marker, draft MR/discussion metadata and an
   encrypted CI setting, then execute a runner job. Keep restored mirror writes
   disabled until the recovered state and mappings have been reviewed.

The committed cold recovery scenario creates a source branch and draft MR with
a discussion and reply, in addition to its user, repository/issue identity,
encrypted CI variable and registry data. It checks the exact source commit,
MR identity, title, description, state, author and creation time, plus both
notes' identities, text, authors, timestamps and resolution state after restore.
The issue check compares its description marker, not its title or state. The MR
stays open with null merge-commit/time fields, so this is not proof of restoring
an already merged MR. The fixture leaves the default branch unchanged. Offline
contract success alone does not establish a passed real cold restore, live
cutover or a successful Production rollout; run the
[disposable recovery scenario](../tests/e2e/README.md) on sufficient capacity.

## Coverage and restore limits

The helper backs up one configured branch and reachable Git objects. It does
not mirror tags, other branches, deletions, Git LFS payloads or submodule
repositories; define those policies explicitly before claiming wider coverage.
It does not back up issues, MRs, discussions, users, CI secrets, registry images,
artifacts or service configuration.

The platform's existing [persistent volume](PERSISTENT_VOLUME.md) and
[cold Harvest/Seed recovery](RECOVERY_CONTRACT.md) handle service state separately
from this code mirror. GitLab's retained `config` and `data` trees include its
configuration/secrets, database, repositories and local registry/artifact data.
Issues, MR discussions, users and CI settings depend on that GitLab state, not
just Git commits. Harvest captures these trees while GitLab is cleanly stopped;
the separate Wizard configuration export supplies Bootstrapper settings. A
retained live volume can also be reused without applying an older Seed.

No second backup service is required by selecting GitLab as primary. Review any
operator-configured external object storage against the Seed's actual local
coverage. Protect secret material and preserve the matching version/edition
and image identity required by the recovery contract. Review the installation's
[backup coverage](https://docs.gitlab.com/administration/backup_restore/backup_gitlab/)
and [restore prerequisites](https://docs.gitlab.com/administration/backup_restore/restore_gitlab/),
then rehearse on an isolated disposable system. The branch-forwarding helper
does not run Harvest/Seed or GitLab-native backup/restore operations.

## Offline regression checks

Run `node tests/gitlab/github-backup.js` where Git and a POSIX `sh` are available.
On Windows, set `GITHUB_BACKUP_TEST_SHELL` to Git for Windows' `usr/bin/sh.exe`.
The fixture creates and removes only its own temporary local repositories.
`GITHUB_BACKUP_OFFLINE_FIXTURE=1` permits an existing absolute local bare target
instead of GitHub SSH; it is only for those offline fixtures, never production CI.
The fixture exercises exact-SHA forwarding, retries, out-of-order commits,
eligibility guards, divergence, missing history, lock contention, competing
checkouts, inherited tag configuration, hanging transport descendants,
cancellation and secret-output suppression. It never contacts a remote service.
