# Deliberate Wizard Production promotion and recovery

Tracked in [System #18](https://github.com/kihyoun/system/issues/18) and
[System #22](https://github.com/kihyoun/system/issues/22). This is an operator
command in the canonical controller, not an automatically enabled GitLab job.
Review/Beta remain separate manually deployed candidate environments.

## Preconditions and exact plan

Use the reviewed matching controller source and retain the previous Wizard image
on the daemon. A private own-GitLab pipeline must have successful required
`build:wizard` and `test:wizard` jobs with matching source/pipeline/registry digest
artifacts. Modern evidence must include lint, Vitest, TypeScript/build, rendered
UI, Projects, SPA, real configuration ZIP and exact Cube validation. Inspect a
separate candidate before applying Production. Pre-pull that exact registry
digest through the authenticated operator/runner; the helper never accepts a
tag or pulls with a provisioning credential.

Write a mode-0600 proof JSON below the persistent configuration directory, e.g.
`/state/wizard-production-proof.json` inside the controller:

```json
{
  "version": 1,
  "projectId": 3,
  "projectPath": "root/wizard-modernization-review-20261018",
  "pipelineId": 22,
  "sourceCommit": "REPLACE_WITH_THE_EXACT_GITLAB_PIPELINE_SHA",
  "imageRef": "registry.example.test/root/wizard@sha256:REPLACE_WITH_THE_64_HEX_DIGEST",
  "productionHost": "system-bootstrapper.com"
}
```

The IDs are examples; use the actual reviewed pipeline and image. Obtain a
read-only plan, review its current/target image IDs, hashes and host, then copy
its exact `planHash` into the apply command:

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js plan /state/wizard-production-proof.json
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js apply /state/wizard-production-proof.json PLAN_HASH
```

Apply independently verifies the exact private GitLab project, successful
pipeline, required non-optional jobs and matching artifacts via a temporary
server-side API credential which is revoked. No credentials or configuration
contents are printed. The current config, route, canonical container identity,
image and plan hash must still agree. The original 1184-character Cube stays
unchanged; image overrides are appended as literal assignments after it.

## Cutover and retained state

The command acquires the existing persistent Wizard environment mutex. Sync
Push/control and other environment jobs respect this mutex. It atomically saves
a private checkpoint under `/state/wizard-production/`, then creates a uniquely
labeled candidate bounded to 128 MiB/0.5 CPU on the current Wizard network.
Only after that candidate is healthy does it update the single `upstream wizard`
address and validate/reload the existing NGINX process. Other routes are
preserved byte-for-byte. The old canonical Wizard is still running at this point.

While the checked candidate serves Production, the helper pins `WIZARD_IMAGE`
in persistent configuration, recreates only the canonical Wizard with
`--no-deps --pull never`, verifies its exact image and health, and redirects the
same upstream to its actual address. It does not restart the proxy, GitLab,
controller or runners. The checkpoint retains the previous immutable image ID,
private configuration/template bytes and the completed active hashes. Owned
candidate resources are then removed by full ID after checking their label.

A failed candidate does not recreate the canonical Wizard. A route/reload failure
restores the old route. A later failure recreates the previous immutable image,
uses its actual resulting address and restores the old configuration. Keep the
previous image and private checkpoint until deliberate rollback has been tested.

## Deliberate rollback

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js rollback-plan
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js rollback PLAN_HASH
```

Rollback requires the completed checkpoint to still match the live image,
configuration and route. It uses the same healthy-candidate cutover and preserves
current settings while selecting the retained previous image. It does not claim
that the previous image was built by the new pipeline.

## Interrupted or conflicting recovery

A concurrent file edit is never overwritten. If safe automatic rollback cannot
complete, the healthy owned candidate, private checkpoint and shared mutex remain
for reconciliation; ordinary Push/restart stays blocked. Do not delete this
mutex blindly or remove the candidate currently serving the interface.

After the original helper process has ended, inspect the private checkpoint and
resolve any external config/template edit explicitly. Then preview and confirm
recovery:

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js recover-plan
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js recover PLAN_HASH
```

Recovery refuses a still-running original process or a changed lock owner. It
requires the expected exact file contents, restores the previous image/route,
cleans only operation-owned candidates and releases only its matching mutex.
The checkpoint and image are local persistent recovery state, not a substitute
for the separate configuration ZIP and Harvest seed.

## Validation scope

Offline regressions cover stale confirmation, bad GitLab proof, candidate health,
lost create response, route reload failure, canonical health failure with a
changed rollback IP, concurrent writes, retained mutex/reconciliation and
explicit rollback. The Ruby proof fixture rejects private-project, source,
optional-job, digest and modern check mismatches and verifies token revocation.
These are component checks. Record the real successful pipeline, separate
candidate, Production promotion and rollback before closing #18/#22.
