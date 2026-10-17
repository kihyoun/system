# Initialize the Wizard repository from pinned source

The registered Wizard project represents the existing interface. Source
initialization is a separate, explicit operation; automatic registration,
startup, Fetch and configuration Push never import application source.

## Use the action

1. Run matching System and Wizard versions, complete default Wizard registration,
   connect to Sync and Fetch the project list.
2. Expand the managed Wizard project and choose **Initialize Wizard source**.
3. Check the repository, source revision and file count in the preview.
4. Select **Import source**. The authenticated asynchronous operation reports
   completion or an actionable conflict. Closing and reopening the dialog allows
   a retry after an interrupted request.

Only the private repository created by this instance's registration is accepted.
Its ownership marker, identity, default branch and disabled managed CI must
match. New source paths and a provenance marker are committed atomically with
`[skip ci]`. Existing paths are never overwritten. Retrying verifies matching
content, executable modes and import commit evidence before reporting success.
A maintainer edit requires inspection rather than a destructive reset.

The scaffold README remains unchanged. The original source README is placed at
`.system-bootstrapper/SOURCE_README.md`. The original upstream `.gitlab-ci.yml`
is preserved byte-for-byte, but GitLab's CI path continues to point at the
disabled `.system-bootstrapper/ci.yml`. No pipeline is started. The known safe
`SKIP_PREFLIGHT_CHECK=true` value is supplied separately under
`.system-bootstrapper/preflight.env`; local dotenv files are excluded.

The running interface, routing and Production URL are untouched. Beta and Review
remain disabled. This phase does not provide builds or deployment; the later
workflow includes a deliberate manual Production job in GitLab, not automatic
self-improvement. The remaining phases are tracked in
[the central workflow issue](https://github.com/kihyoun/system/issues/18).

## Build the immutable source package

Initialize the pinned Wizard submodule before building the System image:

```sh
git submodule update --init wizard
bash project-bootstrap/wizard-source/prepare.sh
```

The normal root `start.sh` invokes preparation before Compose builds the System
image. Manual System image builds must run the same command first. The image
build validates the generated manifest and file hashes; it fails if preparation
was omitted. Do not commit the generated `snapshot.json`.

Preparation reads Git objects at the Wizard gitlink committed in the System's
HEAD. Dirty checkout files, untracked files and a different checked-out Wizard
branch cannot change the snapshot. It preserves binary bytes and executable
modes, rejects symlinks and nested submodules, and excludes dotenv files,
credential file conventions, seeds, dependency directories and build outputs.
Review committed application source as usual; filename filtering is not a
secret scanner for arbitrary source code.

Node on the host is optional. If unavailable, preparation builds the reviewed
`bootstrapper` runtime recipe as `system-bootstrapper-source-tools:local`, then
runs its Node/Git tools with network disabled and source/Git-object mounts
read-only. Linked Git worktrees require their referenced metadata directories
to remain accessible. No Docker socket is mounted in the packaging container.

## State and recovery

The existing private Wizard project configuration contains the versioned
`wizardWorkflow` receipt: operation, source revision, manifest hash, phase,
import commit and safe failure message. Registration and repository identity
are preserved. Existing server-owned project preservation carries the complete
receipt across Push and restart. Retry inspects the repository after a lost
response rather than issuing another import commit. Source revision upgrades
after a reserved import require a separate reviewed operation.

If the source snapshot is missing, prepare it and rebuild the matching System
image. For ownership, path or CI conflicts, inspect the repository and local
registration first. Do not delete/recreate a repository or reset credentials to
make initialization pass.

## Isolated verification

After compiling Sync and generating the snapshot, run:

```sh
node tests/wizard/source-package.js
node tests/wizard/source-workflow.js
ruby tests/wizard/source-import.rb
```

The package test creates disposable Git repositories. The workflow test uses a
temporary private configuration and stubbed Rails transport. The Ruby adapter
test uses an in-memory GitLab API fixture. These tests never contact the running
GitLab or mutate the platform. Run the Wizard Jest suite and production build
with its existing Node 13.12.0 toolchain. The larger runtime migrations remain
separate central issues.
