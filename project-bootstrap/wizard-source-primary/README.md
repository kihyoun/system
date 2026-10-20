# One source-primary Wizard repository

An existing Wizard source repository can also own its native build, browser tests,
Review/Beta jobs and production images. Development and delivery then use one
project; a separate application repository is not required. An optional GitHub
mirror continues to publish reviewed source through the repository's normal CI.

This is an explicit operator adoption, not an automatic source import. The default
managed registration and its legacy initialization/upgrade workflows remain
available for installations that use them. Once adopted, the Wizard identifies
the canonical project by its exact GitLab ID, namespace and path. Source import
and legacy recipe upgrades refuse this mode instead of overwriting development.

## Prepare the repository and retained state

1. Retain a private export of the old project, all required Git references, its
   source/build/environment receipts and deployment checkpoints. Export required
   job evidence and registry images separately: a project export is not a complete
   registry or CI-artifact backup. Do not merge private deployment history into
   the public source branch to retain it.
2. Stop active Review/Beta environments and reconcile pending or retired leases.
   Use the existing stopped-environment cleanup helper before reassignment so
   old route fragments are removed by their verified owner. The adoption archive
   retains old tombstones unchanged; new slots retain their generation floors.
3. Review the source project's `.gitlab/primary.yml`. It must retain its source
   checks and intended publishing role, and provide required `build:wizard` and
   `test:wizard` jobs using the reviewed generic build recipe. Configure delivery
   explicitly with `WIZARD_DELIVERY_ENABLED=true` and the required runner access.
   Merge through normal reviews with successful-pipeline and discussion gates
   enabled. Do not skip or disable those gates.
4. Verify a native default-branch **push** pipeline for the exact resulting commit.
   Both delivery jobs must be required and successful. Their `build-evidence.json`
   and `wizard-evidence.json` must agree on the commit, pipeline ID and immutable
   image reference. The checks include Vitest, lint, TypeScript, production build,
   rendered UI, navigation, configuration ZIP and exact Cube signature.
   Required `build:source` and `test:browser` jobs must also succeed. A pending,
   running, failed or canceled `deploy:github` publisher alone does not block
   private delivery; its actual publishing status remains visible. Every other
   non-optional job must succeed. No required native check can be skipped or
   ignored, and normal merge gates remain enabled.
5. Build and review a matching controller/helper supporting source-primary mode.
   Retain the previous Wizard image on the daemon. Prepare the private environment
   variables described in the [environment guide](../wizard-environments/README.md).

## Preview and adopt

Create a private input JSON with these fields, using values from your own project
and verified pipeline:

```json
{
  "version": 1,
  "projectId": 42,
  "projectPath": "example/system-wizard",
  "namespaceId": 7,
  "defaultBranch": "master",
  "pipelineId": 100,
  "sourceCommit": "REPLACE_WITH_THE_EXACT_40_HEX_COMMIT",
  "imageRef": "registry.example.test/example/system-wizard@sha256:REPLACE_WITH_THE_64_HEX_DIGEST",
  "helperImage": "sha256:REPLACE_WITH_THE_REVIEWED_64_HEX_SYSTEM_IMAGE_ID",
  "ciFiles": [
    {"path": ".gitlab/primary.yml", "sha256": "REPLACE_WITH_64_HEX_SHA256_OF_EXACT_COMMITTED_BYTES"}
  ]
}
```

`ciFiles` is a complete approved CI manifest, not just the one illustrative row.
Include the native CI definition, its delivery/environment launcher, the generic
`.system-bootstrapper/build-v1/` recipe files and referenced `.gitlab/` scripts.
Compute each SHA-256 from the exact bytes at `sourceCommit`. The helper checks
those files through GitLab and independently validates the reserved generic
build recipe. Future changes to this manifest require another reviewed binding
operation; ordinary application changes can use the existing binding unchanged.

Store the input and an expiring GitLab API credential file mode `0600` beneath
the persistent configuration directory. The credential JSON contains `baseUrl`
and `token`; its TLS origin must match the configured own GitLab host. Credentials
and configuration contents are never printed. Revoke the operator credential
after use.

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-source-primary/run.js plan /state/adoption-input.json /state/adoption-credential.json
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-source-primary/run.js apply /state/adoption-input.json /state/adoption-credential.json PLAN_HASH
```

Review the exact plan hash, old/new project IDs, previous production image, new
pipeline/image and configuration hashes. Apply rechecks GitLab, acquires the
existing environment mutex, saves the complete old configuration/receipt privately
under `/state/wizard-source-primary/` and atomically changes only the project
binding. A stale confirmation or concurrent edit fails without overwriting it.
Repeating the same completed adoption is a verified no-op.

Adoption does not change the running production container or image pin. The one
exact previous image is recorded as an explicit recovery alias while the old
project still exists. A different digest or unrelated project is not accepted.
The Build status action reads native pipeline evidence without creating pipelines
or importing source. A pending or failed current default-branch pipeline is shown
as unverified rather than presenting an older build as current.

## Promote and remove the duplicate

Pre-pull the exact new image through scoped registry authentication and use the
existing [production plan/apply workflow](../wizard-production/README.md). Its
source-primary verifier requires the canonical binding, approved CI manifest,
exact current default-branch push pipeline, required jobs and matching artifacts.
Production remains an operator promotion; a source merge alone does not switch it.

Verify the actual public UI, Review/Beta deploy/stop behavior, configuration Fetch,
native build status and cold image recovery from the adopted project. Preserve
the previous image and rollback checkpoint. Refresh recovery instructions and the
configuration backup so a new host uses the new project and registry pin.

Only then delete the duplicate project after confirming no live dependency remains.
Deleting it removes its registry endpoint; a historical rollback image from that
project must remain in a deliberate local/offline archive. The exact recovery alias
does not recreate a deleted registry or make old backups independent of it.
