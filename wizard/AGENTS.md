# Repository instructions

## Documentation language

Write and maintain all project documentation in English, including READMEs,
handbooks, operating guides and generated starter documentation. The maintainer
confirmed this preference on 2026-10-17. Conversation may remain in German.

## Public repository content

Only commit documentation another user can reproduce from a fresh checkout and
infrastructure they configure themselves. Document durable architecture, setup,
operation and verification with explicit inputs and generic examples.

Keep development status, work plans, chat handoffs, private deployment inventories
and pipeline/acceptance diaries outside the repository. Do not include project
issue or pull/merge-request references in source comments, user guides or generated
documentation. Agent instructions may identify the external tracker. Instructions
must not depend on the maintainer's existing GitLab state or retained private files.

The maintainer-selected GitLab-primary workflow uses the central requirements
tracker at https://gitlab.system-bootstrapper.com/system-bootstrapper/system/-/issues,
including Wizard work, and GitLab merge requests in the affected source project.
Confirm activation from the operator's external cutover record; these instructions
do not establish that the cutover has passed acceptance. After activation, create
new tasks there. GitHub is the public code mirror and historical tracker, not a
parallel issue/merge destination. Reuse relevant tasks when requested; do not
create issues for routine documentation cleanup. Deployment operators may select
their own workflow; this tracker is not part of the product architecture.
Read the root README, package scripts and the relevant System component guides
before changing behavior; inspect current refs and worktree state before edits.

## Merged branch cleanup

After a reviewed merge succeeds, delete its remote working branch, preferably
using the merge request's **Delete source branch** option, then prune local
remote-tracking refs. Delete a local working branch only when its worktree is
clean and its changes are safely merged; never force-delete it. Keep default
and protected branches, explicitly required release/build/recovery refs and
unmerged or draft work.

## Immutable System Cube signature

The ASCII System Cube is the maintainer's personal signature and a fixed part
of this project. **Do not change it.** Preserve every character, space, line
break, URL and the `$` marker in sources, generated configuration, imports,
exports, local test fixtures and temporary scripts. It also expresses the
system containing its own means of bootstrapping and development.

The signature in `src/api/Helper.tsx` is validated in `src/api/Main.tsx`:
`$` must remain at zero-based offset 807, and the MD5 of the first 1184 characters
must remain `bd4a8426355824593a5e21ad759830c1`. Port 8071 refers to the same
`substr(807, 1)` marker check and must not be casually replaced. This is a format
check, not cryptographic authentication.

The signature's fixed `https://www.system-bootstrapper.com` link must stay
unchanged even for local HTTP deployments. Never replace schemes across an
entire configuration file, trim the signature or weaken the validator. Change
only the intended service settings after the signature. Verify the signature
on generated configurations and actual Fetch responses as part of relevant tests.

The symbolic `$` opening also records a future vision of communication between
bootstrapper instances; do not describe that broader protocol as implemented.
