# Configure GitLab as primary and GitHub as an optional backup

The guarded backup helper forwards a protected GitLab default-branch commit
to an explicitly mapped GitHub branch. It is opt-in: adding the helper to a
checkout does not change remotes, activate synchronization or migrate project
metadata. Select a primary repository and integrate the helper into its chosen
CI configuration before enabling it.

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

## Helper contract

`gitlab/github-backup.sh` runs in a checkout with an `origin` pointing to the
intended primary GitLab project. The production runtime requires supported Node
24, Git and a POSIX shell with `mkdir` and `rmdir`. Keep the companion
`github-backup-transport.js` beside the shell helper. Configuration comes from
the protected CI job:

| Variable | Required value |
| --- | --- |
| `GITHUB_BACKUP_ENABLED` | `true` to explicitly enable the configured backup job |
| `GITHUB_BACKUP_SOURCE_PROJECT` | Approved exact `CI_PROJECT_PATH` |
| `GITHUB_BACKUP_REMOTE` | Approved GitHub SSH repository, without credentials |
| `GITHUB_BACKUP_BRANCH` | Approved existing backup branch |
| `GITHUB_BACKUP_TIMEOUT_SECONDS` | Optional per-transport deadline, integer 1–300; default 30 |

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
unknown keys fail rather than prompt or bypass verification. It does not read a private-key
variable, print a remote URL or install credentials. The existing job's SSH
setup must use protected/masked credentials and verified host keys; do not enable
CI debug tracing or echo secrets in surrounding commands. Retain the existing
protected `GITHUB_SSH_PRIVATE_KEY` identity unless separately authorized.

## Integrate with the selected CI configuration

System and Wizard already contain `deploy:github` jobs. Adapt those jobs to call
this common helper rather than adding another mirror. Their old assumptions
(`master`, mutable `node:alpine`, remote rewriting and runtime key scanning)
need review against the chosen branch mapping and supported runtime. The
helper is not wired into these upstream jobs automatically.

The managed Wizard selects `.system-bootstrapper/ci.yml` for build/test and any
installed optional environment jobs. Its preserved upstream `.gitlab-ci.yml`
is not active. Make the helper available at an explicitly pinned version in
that managed context before wiring a backup job; do not enable the entire upstream pipeline
to obtain just one job. A backup job belongs after the required successful
default-branch checks, with an explicit protected enablement gate and serialized
resource group. Its failure must remain visible rather than `allow_failure`.

The upstream Wizard also has `deploy:system`, which updates the System gitlink
and uses a legacy hardcoded GitLab host. Do not reactivate it blindly. The
reviewed order is Wizard merge/checks, Wizard backup, deliberate System gitlink
update through its normal review process, System merge/checks, then System
backup. Ensure the referenced Wizard commit is present in its backup before
claiming the System backup can restore the submodule. No automatic System merge
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
   primary. Preserve old issue references and redirects; Git pushes do not move
   issue metadata. No issue migration is part of this helper.
5. Review and enable only the intended protected backup jobs, using authorized
   credentials and verified known-host material. Run the offline regressions
   before an explicitly controlled integration check.
6. Merge a harmless GitLab change through the reviewed workflow. Compare the exact
   resulting SHA on GitHub, test a visible failure/retry, and verify that no return push or
   unintended deployment occurred. Keep the former workflow recoverable until
   a disposable restore rehearsal passes.

## Coverage and restore limits

The helper backs up one configured branch and reachable Git objects. It does
not mirror tags, other branches, deletions, Git LFS payloads or submodule
repositories; define those policies explicitly before claiming wider coverage.
It does not back up issues, MRs, discussions, users, CI secrets, registry images,
artifacts or service configuration.

A platform recovery plan must separately protect GitLab's database/repositories,
configuration and secrets, plus applicable object storage and registry data.
Keep secret material appropriately protected and separate from ordinary source
backups. GitLab restore requires the matching version and edition and the
necessary configuration/secrets. Review the actual installation's
[backup coverage](https://docs.gitlab.com/administration/backup_restore/backup_gitlab/)
and [restore prerequisites](https://docs.gitlab.com/administration/backup_restore/restore_gitlab/),
then rehearse on an isolated disposable system. The branch-forwarding helper
does not run these service backup/restore operations.

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
