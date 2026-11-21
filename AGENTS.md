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
2. Inspect the current branch, worktree, remotes and integrated Wizard sources before
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
- Mark an issue **In Progress** as soon as work on it starts. Move it to
  **Review** when implementation is ready for acceptance, and close it only
  after its acceptance criteria have been met. Return it to **In Progress**
  when a review or acceptance failure requires further work.
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
- A green pipeline proves only the checks it actually ran. Map feature acceptance
  criteria to executable pipeline evidence before closing an issue, and disclose
  missing coverage. Do not substitute additional checks on an operator's live
  platform for missing candidate-pipeline coverage.
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

Relevant copies are in `src/common/configuration-signature.ts` and `wizard/src/api/Helper.tsx`.
Configuration validation and routing also live in
`src/modules/projects-routing/wizard-aliases.ts` and
`src/modules/projects-routing/projects-routing.service.ts`; lifecycle
readiness uses `src/modules/lifecycle/lifecycle.service.ts`.

## Persistence and recovery

- Every persistent service-data path must resolve beneath the selected
  `PERSISTENT_DIR`. Local mode may use the system filesystem; explicit volume
  mode must validate its mount/UUID and fail closed when it is absent. Never
  silently switch a saved installation's storage mode or move its live data.
- Keep live storage independent from the Seed backup destination. Normal
  operation must not require a backup medium. Validate the explicitly selected
  backup filesystem before Harvest or restore, and never create a fallback
  backup directory on the system disk when that medium is missing. Restore a
  completed, matching Seed into fresh live storage before starting writers.
- Serialize destructive storage, backup, restore and deployment operations
  against the same live-state lease, including when backup targets change.
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

## Repository-owned initialization and operations

- Put explicitly approved executable scripts outside the NestJS implementation
  under the top-level `tools/` directory, grouped by purpose (for example,
  `tools/quickstart/` and `tools/gitlab/`). Document each exception and its caller.
  The allowed bootstrap exceptions are the initial Quickstart before Node is
  available and the minimal official GitLab Rails invocation needed to create
  the first temporary administrator token. Keep token lifecycle, provisioning
  and all subsequent orchestration in shared NestJS services; revoke the
  temporary bootstrap token when its work is complete.
- Moving legacy scripts into `tools/` does not satisfy their migration. Replace
  our operational Bash, Python and Ruby logic, including embedded shell programs,
  with shared TypeScript services. Keep native upstream utilities as typed
  subprocess dependencies. Reserved historical recipe artifacts retain their
  existing locations and exact bytes; they are not active bootstrap exceptions.
- Keep every script and tool required to initialize, recover, verify and deploy
  the system in this repository. Another operator must be able to reproduce the
  procedure from a reviewed checkout and their own documented inputs.
- Use the committed entry points. Do not add private wrappers, copied scripts,
  ad hoc remote scripts or manual implementation patches to supply missing
  initialization or verification behavior on a live host.
- If an entry point is incomplete, implement the change on a branch, submit a
  GitLab merge request, pass the applicable CI checks and review, then merge and
  deliberately deploy the tested revision. Never deploy a new or modified script
  first and add its source or tests afterward. Keep required merge gates enabled.
- Keep credentials, deployment-specific input values and private execution logs
  outside version control. Runtime files generated by committed tools may live
  outside the checkout; their generating logic must remain in the repository.

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

## NestJS and TypeScript conventions

Follow the official NestJS [modules](https://docs.nestjs.com/modules),
[providers](https://docs.nestjs.com/providers) and
[standalone applications](https://docs.nestjs.com/standalone-applications)
patterns. The rules below are this repository's conventions; they do not imply
that Nest requires a particular domain architecture.

- Organize by capability (configuration, storage, backup/restore, lifecycle,
  projects, release), with an explicit feature module and narrowly exported
  providers. Avoid global service collections, circular dependencies and
  routine `forwardRef` workarounds. Do not introduce microservices or CQRS merely
  to organize code in this single platform.
- Keep the NestJS application sources under root `src/`: HTTP adapters in `src/api`, CLI adapters in `src/cli`, capability modules and their services in `src/modules`, and shared runtime infrastructure in `src/common`. Do not retain operational JavaScript compatibility launchers in legacy source directories. React Wizard remains a separate frontend. Keep templates/static configuration outside the application source and explicitly allowed bootstrap exceptions under `tools/`.
- Put one blank line between adjacent methods. Preserve that spacing when editing and formatting classes.
- Use kebab-case filenames and conventional suffixes such as `.module.ts`,
  `.service.ts`, `.controller.ts`, `.dto.ts` and `.spec.ts` for new Nest code.
  Use PascalCase for classes/types and camelCase for functions/properties.
  Preserve compatibility entry points and historical artifacts when migrating.
- Keep controllers and CLI handlers thin: validate and map input, invoke a use
  case, and map its result. Put orchestration in injectable services, pure
  decisions in framework-independent functions, and external I/O behind typed
  injectable adapters. Do not move large scripts unchanged into a service class.
- Share the same operation services between HTTP, CLI and workers. CLI commands
  use a standalone Nest application context, without starting an HTTP listener,
  and close it reliably. Importing a module must not start jobs or mutate state.
- Prefer constructor injection and explicit provider tokens for external ports.
  Compose providers in modules; avoid service locators and manual construction
  of service dependency graphs inside controllers. Pure functions need no
  artificial injectable wrapper.
- Enable strict TypeScript. Treat untrusted input as `unknown` until runtime
  validation; TypeScript types alone do not validate HTTP, CLI, environment or
  persisted data. Keep DTOs separate from domain/persistence types where their
  contracts differ. Preserve existing public API validation and error behavior.
- Read and validate configuration at the appropriate application boundary;
  inject typed configuration rather than scattering `process.env` reads across
  services. Never log credentials or complete secret-bearing configuration.
- Use typed operation errors and explicit exit/status handling. Only HTTP
  adapters translate errors to HTTP responses; core services must remain usable
  offline. Manage cancellation, subprocess termination and resource cleanup
  explicitly. Nest singleton scope does not replace durable cross-process leases.
- Centralize external command execution in a typed process adapter with argument
  arrays, bounded output and explicit failure handling. Replace our own legacy
  orchestration rather than wrapping old script chains. Keep necessary native
  tools and external format adapters, and prepare recovery dependencies before
  maintenance so recovery does not depend on a running API or npm access.
- Test domain behavior and failure paths with injected adapters, module wiring
  with Nest's testing facilities where useful, and compatibility at public
  boundaries. Retain existing meaningful integration tests and include new
  acceptance checks in repository-owned CI; do not duplicate full platform runs
  merely for each module. Keep established test locations during migration when
  moving them would only create churn.
- Use the repository's stable, pinned dependency versions and existing formatter,
  lint and build checks. Keep feature documentation aligned with the implemented
  module boundaries and public commands, including supported Wizard translations.
- Use a shared, committed Prettier configuration for maintained TypeScript and
  JavaScript packages, explicitly including the Wizard React/TSX frontend, Sync
  and the operations CLI, with an exact local development-dependency version.
  Provide `format` (write) and `format:check` (read-only) package scripts and run
  the latter in the existing fast CI checks. ESLint owns code-quality rules;
  disable conflicting formatting rules with `eslint-config-prettier` where
  necessary rather than running Prettier as an ESLint rule. Keep formatting scope
  explicit: exclude generated output, dependencies, reserved historical recipes
  and byte-sensitive fixtures/signatures. Do not blanket-format unrelated legacy
  files or mutate the Cube. These rules also apply to editor format-on-save.

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
