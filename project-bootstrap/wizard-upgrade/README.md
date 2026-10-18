# Managed Wizard upgrade v1

This operator workflow completes the in-place migration required by
[System #18](https://github.com/kihyoun/system/issues/18) and
[System #22](https://github.com/kihyoun/system/issues/22). It updates the existing
private, managed Wizard project. It never registers another project or changes
the Production UI, proxy, image pin, runner credentials, or environment routes.

## Implementation plan

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
   Production promotion/rollback workflows separately. Keep #18/#22 open until
   their live proof is recorded. Component tests do not substitute for that proof.

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
# Acquire the coordinator's bounded CI slot before stage: its last commit starts CI.
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
