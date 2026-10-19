# Repository instructions

## Public documentation boundary

Only commit material that another user can reproduce from a fresh checkout and
infrastructure they configure themselves. Document architecture, configuration,
installation, operation and reproducible verification with all required inputs.
Use generic examples and explain operator-supplied domains, storage and credentials.

Do not put development-status reports, completed work plans, chat handoffs,
private deployment inventories, machine addresses, instance-specific volume IDs,
private pipeline/job links or acceptance diaries in the repository. Keep those in
external project tracking or private operator records. Instructions must not depend
on a maintainer's existing GitLab state, deleted VM, local files or retained artifacts.

Do not embed this project's issue or pull/merge-request links or task numbers in
source comments, READMEs, guides or generated documentation. Agent instructions
may identify the external task tracker; users must not need its contents to use
the code. Links to source repositories, reproducible tools and relevant upstream
technical documentation remain appropriate.

## Start each task

1. Read the README and relevant component documentation for the code's contracts
   and reproducible workflows. Obtain task status and requirements from the
   conversation or external tracker, not a repository handoff snapshot.
2. Inspect the current branch, worktree, remotes and Wizard submodule before
   changing anything. Confirm operator-provided infrastructure before deployment
   or destructive work; repository examples are not live-instance coordinates.
3. Update stale technical guidance rather than accumulating plans or status files.

## Working conventions

- Write repository documentation in English. Conversation may be German.
- Use the task tracker and source of truth selected by the maintainer. The
  maintainer-selected GitLab-primary workflow uses the central tracker at
  https://gitlab.system-bootstrapper.com/system-bootstrapper/system/-/issues,
  including Wizard requirements, and GitLab merge requests in each source
  project. Confirm activation from the operator's external cutover record;
  these instructions do not establish that the cutover has passed acceptance.
  After activation, create new tasks there; GitHub is the public code mirror
  and historical tracker, not a parallel issue/merge destination. A deployment
  may choose its own workflow; the maintainer's tracker is not product architecture.
- Reuse existing issues and implement their acceptance criteria. Do not create
  new issues or planning files for routine cleanup when the user says not to.
- When authorized to coordinate delivery, delegate independent work, review the
  results, merge passing changes and close completed issues. Do not repeatedly
  ask for merge approval already granted in the conversation.
- After a reviewed merge succeeds, delete its remote working branch, preferably
  using the merge request's **Delete source branch** option, then prune local
  remote-tracking refs. Delete a local working branch only when its worktree is
  clean and its changes are safely merged; never force-delete it. Keep default
  and protected branches, explicitly required release/build/recovery refs and
  unmerged or draft work.
- Report concrete results or answer status questions; the maintainer cancelled
  timed progress reports. Keep task status and scope changes outside the repository.
- Run checks appropriate to code changes. Documentation-only housekeeping does
  not require repeating the full platform suite. Preserve actual test evidence
  and distinguish successful runs from skipped checks or partial failures.
- Never commit tokens, passwords, private SSH keys, configuration ZIPs or raw
  private logs. Document secret locations/selectors, not their contents.

## System Cube signature and port 8071

The ASCII System Cube is the maintainer's signature and must remain exact in
sources, generated configuration, fixtures and live instances. Preserve every
space, newline, URL and the dollar sign. The dollar sign is at zero-based offset
807; the MD5 of the first 1184 ASCII bytes is
`bd4a8426355824593a5e21ad759830c1`. Its fixed link is
`https://www.system-bootstrapper.com`. Port `8071` is intentional and refers to
that opening in the Cube; do not replace it.

Never trim, reformat or apply blanket URL/scheme replacements to configuration.
Change only intended assignments after the signature. Verify the signature and
an authenticated Fetch response when modifying configuration. Keep the strict
validator; the MD5 format check is not cryptographic authentication.

Relevant copies are in `sync/src/Helper.ts` and `wizard/src/api/Helper.tsx`;
validators and routing also refer to `sync/src/index.ts`, `wizard/src/api/Main.tsx`,
`nginx/start.sh` and `system/start.sh`.

## Persistence and recovery

- Every persistent service-data path must resolve beneath the configured mounted
  `PERSISTENT_DIR`. Validate mount/UUID and fail closed if the volume is absent;
  never silently fall back to the root disk.
- Configuration management is separate from Harvest/Seed: the Wizard provides
  Open/Backup and Push/Fetch; Harvest/Seed handles persistent service data.
  Configuration lives in the separate persistent controller `/state` directory.
- Pull source code freshly. Runner managers, caches and workspaces are
  disposable; reconstruct them from configuration and GitLab state instead of
  treating all caches as indispensable backups.
- Preserve retained Seed backups, live data, deployment receipts and recovery
  checkpoints. Verify snapshot freshness before a restore; an old Seed and a
  newer configuration export are not automatically a matching backup pair.
- Saved configuration wins. First-setup suggestions may be derived when no
  saved configuration exists, but must not be pushed automatically.

## Deployment and resource boundaries

- Preserve the running management interface. Production promotion is deliberate
  and manual, pinned to independently verified pipeline/source/image evidence,
  with a retained previous image and rollback checkpoint.
- Use the existing managed source/build/environment/upgrade helpers. Preserve
  reserved historical recipe hashes, source/import history, ownership markers,
  Review/Beta generation floors and tombstones. Do not reimport over user edits
  to bypass a conflicting migration plan.
- Remove only exactly owned resources after checking their identity. Do not use
  global Docker pruning, reset Production or overwrite unrelated Git history.
- Use the operator's configured public Wizard hostname. Keep the Cube's fixed
  www URL exact. Preserve deliberate upstream publishing roles when changing CI.
- Coordinate resource-heavy disposable tests using the committed harness limits
  and explicit leases. Check the selected host's capacity; limits are ceilings,
  not reservations or disk quotas. Do not assume a maintainer-owned test host exists.

## Long-term design intent

The Cube's opening symbolizes communication with the outside world. Future
inter-bootstrapper communication and nested modular composition remain design
intent; the current Sync API does not establish a general inter-instance
protocol merely by listening on port 8071.

The longer-term vision is an infrastructure that can build, evaluate and deploy
improved versions of itself and ultimately improve that process recursively.
The implemented Wizard delivery/recovery workflow is a foundation. Autonomous
recursive improvement and platform generation switching are not implied by it.
Keep future expansion tied to explicit requirements and acceptance evidence.
