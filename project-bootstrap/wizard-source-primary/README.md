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

## Refresh an existing source-primary build recipe

A controller update preserves the existing build reservation. For an already
adopted modern Wizard, select `"buildProfile": "node24-vite8-quickstart-v5"`
explicitly in a new adoption input to deliver the current Overview, Quick Install
and integrated Docs interface. The earlier CA refresh target
`node24-vite8-ca-v4` remains accepted. Starting profiles are `node24-vite8`, its
cleanup-v2, overview-v3 and CA-v4 profiles, and quickstart-v5 itself. Downgrading
quickstart-v5 to CA-v4 is rejected. Legacy recipes and initial adoption cannot
select this upgrade. Omitting
`buildProfile` retains the exact existing recipe and historical input hashes.

First open a normal merge request in the canonical Wizard source project. Use
the reviewed controller's `wizard-build/recipe.js` `generate(cube,
'node24-vite8-quickstart-v5')` result to install every returned `files` entry
alongside the matching UI source. From CA-v4, only
`.system-bootstrapper/build-v1/smoke/check.js` changes; the existing native
`.gitlab/primary.yml` and its gates remain identical. Never replace the native
CI with the managed recipe's separate CI document.

When moving from an earlier profile that lacks CA-v4 trust preparation, also
refresh the existing native source and delivery job parents,
install the committed public bundle before network operations, and set
`NODE_OPTIONS=--use-openssl-ca` for Node jobs. Retain required source, browser and
delivery checks, the public mirror and environment jobs. Rebuild and test both
the delivery image and browser/job images; an old successful pipeline is not
evidence for the new trust inputs.

After review, merge and verify the exact default-branch push pipeline. Prepare
the new complete `ciFiles` manifest from that commit, its immutable image digest,
pipeline identity and matching reviewed helper. Stop and reconcile Review/Beta
and use the same `plan`/`apply` commands above. The plan includes the old and new
build recipe hashes. Apply independently verifies every approved CI hash and all
generic recipe bytes, retains the previous configuration and receipt in a new
private archive, and preserves canonical identity and environment generation
floors. A changed or missing CA file, unrelated recipe or required CI failure
refuses the binding. Production image promotion remains the separate step below.

A changed smoke file changes the approved `ciFiles` manifest even when the native
CI entrypoint is unchanged. Retain canonical project/namespace/path/default-branch
identity in the new private input, select the explicit target profile, and replace
the source commit, push pipeline ID, image digest and complete committed-file
manifest with the newly verified values. Keep the reviewed immutable helper.
Run `plan` and `apply` from a reviewed controller/helper that recognizes the new
profile. Do not edit the saved receipt or its hashes manually. Until this guarded
binding refresh completes, verification through the old binding rejects the
changed managed smoke bytes.

For an already adopted source-primary project, add
`"action": "refresh-binding"` to that private input for a metadata-only recipe
refresh. An explicit supported `buildProfile` is required. This action retains
the exact canonical project identity, every approved native CI file outside the
generic recipe, repository metadata and recovery-image aliases. It independently
verifies the new recipe bytes, complete CI manifest, required merge gates and
the exact default-branch push pipeline and immutable candidate artifacts.
Review/Beta must be stopped and reconciled. The existing private archive,
confirmation hash, configuration compare-and-swap and environment lock still
apply; a stale main or project configuration refuses the refresh.

The action leaves the complete main configuration and its Production image pin
unchanged, including when Production runs a separately accepted public release
pair. That pin is retained as archived configuration, never treated as candidate
evidence or added as a private-registry recovery alias. Public-pair verification
and Production promotion keep their separate release/update gates. Initial
adoption and reassignment still require the exact previous private-registry
image; `refresh-binding` cannot adopt or redirect a repository.

Normally run the existing `plan`/`apply` commands in the reviewed controller.
When the running controller predates this action, an operator may use the
matching accepted immutable helper image with the same persistent configuration
mounted at `/state`, without starting a controller or mounting a Docker socket:

```sh
docker run --rm --network host --mount type=bind,src=/operator/configuration,dst=/state --entrypoint node sha256:REPLACE_WITH_ACCEPTED_HELPER_IMAGE_ID /system/project-bootstrap/wizard-source-primary/run.js plan /state/adoption-input.json /state/adoption-credential.json
docker run --rm --network host --mount type=bind,src=/operator/configuration,dst=/state --entrypoint node sha256:REPLACE_WITH_ACCEPTED_HELPER_IMAGE_ID /system/project-bootstrap/wizard-source-primary/run.js apply /state/adoption-input.json /state/adoption-credential.json PLAN_HASH
```

Replace the configuration mount and image ID with independently verified
operator inputs. Retain the same input and helper for apply/retries. This runs
the committed entrypoint directly and does not start services or promote images.

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
