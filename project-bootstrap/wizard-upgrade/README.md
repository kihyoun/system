# Managed Wizard upgrade v1

This operator workflow upgrades the source and toolchain of an existing
private, managed Wizard project. It never registers another project or changes
the Production UI, proxy, image pin, runner credentials, or environment routes.

## Migration contract

1. Read the signed canonical project configuration and validate its ownership,
   source marker, original source manifest, managed build/environment files and
   exact current default-branch head. Require stopped Review and Beta leases.
2. Preview a deterministic migration branch in that project, the validated
   public source snapshot, modern recipe, immutable clean helper, and affected
   paths. Preserve unknown project files; reject edited managed source instead
   of silently discarding local development.
3. After explicit confirmation, checkpoint the old configuration privately on
   the volume. A skipped preparation commit removes only verified managed paths
   on the isolated branch; source, build and environment commits recreate them
   with their required per-file activation identity. Preserve their original
   verifiable ancestry. Create one migration MR before the final commit, whose
   normal MR pipeline runs the required modern build and browser checks.
4. Reconcile lost GitLab responses by inspecting the same branch and markers;
   never blindly repeat an uncertain commit or MR request. Keep main and the
   canonical receipt unchanged during review.
5. After a reviewed fast-forward retaining all four commits, verify the current main
   files and exact successful pipeline artifacts, then atomically adopt the new
   receipt. Preserve previous workflow metadata, stopped generations and
   tombstones. A second adoption is a verified no-op.
6. Exercise the normal canonical Review, stop, main/Beta, stop and guarded
   Production promotion/rollback workflows separately. Verify their actual
   pipeline and runtime results; component tests do not substitute for them.

The matching modern controller/helper must be built and reviewed first. Do not
reuse an old helper image: it cannot validate the modern build recipe.

## Operator procedure

Run the reviewed code in the canonical controller with Node 24. Prepare its
validated `project-bootstrap/wizard-source/snapshot.json` matching the reviewed
System gitlink. Store an expiring GitLab API credential privately on the volume,
mode 0600, as `{ "baseUrl": "https://gitlab.example/api/v4", "token": "..." }`.
The API token is read from this file only, never a command argument, log, CI
variable, receipt, or checkpoint. Revoke it after the operation. It must belong
to the platform's own GitLab; TLS verification remains enabled.

Create a mode-0600 options file containing `credentialFile` and the exact
immutable `helperImage` (`sha256:...`) for the reviewed clean controller image.
Optional `config`, `mainConfig` and `directory` paths default to
`/state/.projects.env/.wizard.env`, `/state/.docker.env` and `/state/wizard-upgrades`.
The main configuration's own GitLab host and registry
are enforced. It is read and hash-checked, never rewritten by this workflow.
Before staging any write, a bounded networkless container verifies that the
selected helper image contains the exact reviewed environment/build dependency
files. It receives no Docker socket, state, certificates or credentials. The
operator must also set the canonical controller's
`SYSTEM_WIZARD_ENVIRONMENT_IMAGE` to that same image when rolling out the reviewed
controller. Keep the pre-pulled helper on the shared runner daemon.

```sh
node project-bootstrap/wizard-upgrade/run.js plan /state/upgrade-options.json
# Review source revision, project identity, branch, current head and path diff.
# Reserve a bounded CI slot before stage: its last commit starts CI.
node project-bootstrap/wizard-upgrade/run.js stage /state/upgrade-options.json PLAN_HASH
```

Inspect the returned existing-project MR and required `build:wizard` and
`test:wizard` jobs. The operator must review and temporarily select the existing
project's `merge_method=ff` if needed; this helper never changes project policy.
Merge only after review and success, **by fast-forward without squash or
rebase**, retaining all four checkpointed commits. Main must still equal the
previewed head immediately before that merge and exactly the final environment
commit at adoption. Do not edit the managed files in between. Identical file
contents require this history to preserve their new `last_commit_id` proof.
Restore the previous merge policy after adoption if desired. The old receipt
remains active until adoption.

```sh
node project-bootstrap/wizard-upgrade/run.js adoption-plan /state/upgrade-options.json
node project-bootstrap/wizard-upgrade/run.js adopt /state/upgrade-options.json ADOPTION_HASH
```

Adoption requires the exact staged MR pipeline to be green, both checks to be
required, matching modern evidence and registry digest, the MR to be merged,
and every staged source/managed file at current main to match its verified
commit. It records the original source revision, import/build/environment
receipts and stopped leases in `wizardWorkflow.upgradeHistory` and preserves
unrelated registration fields and configuration bytes. Its private checkpoint
also retains the original signed project configuration on the volume.

Create a normal small follow-up MR in the **same** project to verify manual
Review deploy/stop with the new helper. Merge it, verify manual Beta deploy/stop,
then use the separate `wizard-production/run.js` plan/apply/rollback procedure
with that canonical project's verified digest. No Production promotion occurs
as part of migration or adoption.

If a request loses its response, rerun `stage` with the original plan hash. It
adopts only an exact already-created commit/MR. An intent with no observable
result requires administrator inspection; it deliberately refuses another
blind POST. Never delete checkpoints or force-push to bypass this guard. A
concurrent config/main edit or active lease requires a fresh review, not an
automatic overwrite. Before adoption, abandon an unmerged migration by closing
its MR; main and the old receipt remain valid. After adoption, reverting source
alone is insufficient: use a separately reviewed inverse migration. Production
rollback uses its independent retained image/checkpoint.

## Build and environment recipes without reimporting source

Use the explicit `build-` actions when an already-modern managed project needs
the versioned cleanup correction.
The ordinary source-upgrade actions still reject edited imported source. This
separate path accepts existing development, including added or removed source
files, and changes only the reserved build files, environment helper, managed
CI entrypoint and their two receipts. It selects `node24-vite8-cleanup-v2`;
legacy projects still need the separately reviewed source/toolchain upgrade.
Historical recipe hashes and existing checkpoints remain verifiable.

```sh
node project-bootstrap/wizard-upgrade/run.js build-plan /state/upgrade-options.json
# Review scope=build-environment, exact head, managed paths and preservedTreeHash.
# Reserve a bounded CI slot before this final MR commit starts CI.
node project-bootstrap/wizard-upgrade/run.js build-stage /state/upgrade-options.json PLAN_HASH
# Review required build/browser jobs; fast-forward the MR without squash/rebase.
node project-bootstrap/wizard-upgrade/run.js build-adoption-plan /state/upgrade-options.json
node project-bootstrap/wizard-upgrade/run.js build-adopt /state/upgrade-options.json ADOPTION_HASH
```

The private checkpoint and migration operation are distinct from a source
upgrade. The three retained commits are preparation, build and environment.
Preparation deletes only verified managed recipe files and replaces the build
marker temporarily; it never writes the source/import marker. Build and
environment recreate unchanged files so their exact activation-commit proofs
remain valid. The source import revision, manifest, import commit and source
marker retain their original identities. Every other repository file is guarded
by a deterministic fingerprint of bytes, Git mode and last-change commit, checked
on each staged commit and again before adoption. Unexpected additions, removals,
content, mode or history changes fail the same operation rather than being
reimported or overwritten.

The existing ownership, immutable-helper verification, environment mutex,
configuration/main compare-and-swap, uncertain-write checkpoints, fast-forward
ancestry and exact required pipeline/artifact checks apply. Review and Beta must
be fully stopped before planning; their generation floors, tombstones and other
settings are preserved exactly. Stage keeps the old canonical receipt active.
Adoption changes only its managed workflow receipts and appends upgrade history;
configuration bytes outside the receipt remain unchanged. It never promotes the
candidate or changes the Production image pin. If the config was adopted but the
checkpoint write was interrupted, a verified repeated adoption repairs that
checkpoint without rewriting the config. Do not replace `build-stage` with a
source reimport to bypass a conflicting plan.
