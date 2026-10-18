# Repository instructions

## Start each task

1. Read [HOST_HANDOFF.md](HOST_HANDOFF.md) for the dated operational snapshot,
   active source of truth, verified checkpoints and the next issue.
2. Inspect the current branch, worktree, remotes and Wizard submodule before
   changing anything. Recheck live state before deployment or destructive work;
   a handoff records observations, not a guarantee that nothing changed.
3. Read the linked issue and relevant component documentation. Keep this file
   for durable rules, the handoff for current state, and issues for requirements.
   Update stale guidance instead of accumulating overlapping plan documents.

## Working conventions

- Write repository documentation in English. Conversation may be German.
- Use the active development platform identified in the handoff. Until an
  explicit cutover is completed, GitHub remains primary and requirements are
  centralized in `kihyoun/system`, including Wizard work. Preserve references
  when moving to GitLab; do not maintain competing issue collections.
- Reuse existing issues and implement their acceptance criteria. Do not create
  new issues or planning files for routine cleanup when the user says not to.
- When authorized to coordinate delivery, delegate independent work, review the
  results, merge passing changes and close completed issues. Do not repeatedly
  ask for merge approval already granted in the conversation.
- Report concrete results or answer status questions; the maintainer cancelled
  timed progress reports. Keep authorization and scope changes in the handoff.
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
- The main public UI uses the bare domain; the Cube's fixed www URL stays exact.
  Preserve deliberate upstream publishing roles when changing CI.
- Coordinate resource-heavy disposable tests: the measured platform host has
  8 CPUs/32 GB RAM; one 12 GiB/4 CPU candidate lifecycle at a time was qualified.
  Those limits are ceilings, not reservations or disk quotas. The small Codex VM
  is a separate machine, not the platform integration-test host.

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
