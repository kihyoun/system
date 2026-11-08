# Review the bundled Wizard before System promotion

When a System change pins a new Wizard gitlink, the System pipeline can expose
that exact Wizard on the existing managed Review HTTPS host. This is a UI
acceptance step before Production promotion. It neither migrates Production nor
proves the entire platform safe by displaying a working page.

The optional `deploy:wizard-review` and `stop:wizard-review` jobs reuse the two
immutable images already built and published by `test:platform-candidate`.
No second Wizard pipeline or additional build is required. All required System
checks remain required. The Review job runs from the proposed System checkout;
the Production controller does not need to be upgraded first.

## Prerequisites

Use a trusted same-project MR against the protected default branch, with the
normal successful-pipeline and resolved-discussion merge gates enabled. The
full candidate, browser and component checks must succeed before managed Deploy.
Provision the existing [Wizard Review environment](../project-bootstrap/wizard-environments/README.md),
including its exact host, DNS, certificate, templates and SSL volumes. Stop and
reconcile any existing Review lease before assigning the shared host. Beta and
the canonical native Wizard delivery reservation remain unchanged.

Set these non-secret project variables, raw and unprotected with environment
scope `*`, so same-project MR jobs can read them:

| Variable | Value |
| --- | --- |
| `SYSTEM_REVIEW_ENABLED` | `true` |
| `SYSTEM_REVIEW_OPERATION` | The existing server-owned environment reservation's 48 hex characters |
| `WIZARD_REVIEW_HOST` | Its exact enabled Review HTTPS host |

Fork pipelines, ordinary branch pushes and documentation-only changes do not
create these jobs. The variables select jobs and display their URL; they do not
authorize arbitrary projects or images.

## Bind one candidate explicitly

After the candidate job succeeds, read its `test-results/successor/release.json`.
Prepare a private input file on the administration host. Replace every example
with values from the actual project, MR and release artifact:

```json
{
  "operation": "REPLACE_WITH_EXISTING_48_HEX_RESERVATION",
  "projectId": 42,
  "projectPath": "example/system",
  "namespaceId": 7,
  "defaultBranch": "master",
  "mrIid": 12,
  "pipelineId": 100,
  "sourceCommit": "REPLACE_WITH_40_HEX_SYSTEM_REVISION",
  "candidateJobId": 300,
  "helperImage": "sha256:REPLACE_WITH_64_HEX_RELEASE_IMAGE_ID",
  "wizardImageId": "sha256:REPLACE_WITH_64_HEX_WIZARD_IMAGE_ID",
  "wizardImageRef": "registry.example.test/example/system/successor-wizard@sha256:REPLACE_WITH_64_HEX_DIGEST",
  "wizardRevision": "REPLACE_WITH_40_HEX_WIZARD_GITLINK"
}
```

Use `helperImage = release.imageId` and the matching Wizard fields. Pull the
release's controller registry reference with separately managed operator access,
then verify its local image ID. Retain this image while the environment exists,
including for Stop after artifact expiry. Keep credentials outside the checkout
and do not pass them to the helper.

With the input saved mode `0600` at an absolute operator-supplied path:

```sh
docker run --rm --network none --read-only --memory 256m --cpus 1 --pids-limit 128 \
  --tmpfs /tmp:rw,nosuid,noexec,size=16m \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --mount type=bind,source=/PRIVATE/ABSOLUTE/candidate.json,target=/input.json,readonly \
  --entrypoint node sha256:EXACT_RELEASE_IMAGE_ID \
  /system/project-bootstrap/system-review/bind.js plan /input.json
```

Review the returned plan, including project/MR/pipeline/source, both images and
the existing reservation. Repeat the command with `apply /input.json PLAN_HASH`
to store the exact selection under the canonical controller's configuration
directory. The tool uses the existing environment mutex and rejects changed
plans, occupied leases or configuration races. It retains previous binding
records privately. It does not change routes, the source-primary CI manifest,
Production image selectors or service data.

## Deploy, inspect and stop

Run the manual `deploy:wizard-review` job in that same MR pipeline and open its
GitLab Environment URL. The helper verifies the actual running job, current MR
head and newest MR pipeline, required successful jobs, frozen candidate evidence,
System gitlink and exact local source/job/image labels independently through
canonical GitLab. Job-scoped registry credentials only preload the two images;
they never enter the helper, configuration receipt or candidate container.

The existing managed environment lifecycle handles health, DNS and certificate
checks, an internal network, the shared Review lease, route cutover, rollback,
generation floors, ownership and stopped-host tombstones. The candidate has no
configuration or service-data mount. Production remains running throughout.

Stop with `stop:wizard-review` from the same originating pipeline. Stop verifies
its running job and exact retained binding, but does not require current MR
head, downloadable candidate artifacts or registry access. A closed or merged
MR can therefore still be cleaned up. Retain the helper image until Stop and
owned cleanup finish. Another project, MR or pipeline cannot replace or stop
the selected lease. Remove any separately provisioned temporary preview route
and its exactly owned resources before managed deployment on the same host.

After personal UI acceptance, complete all required System checks and review,
merge normally, verify the merged pipeline, and use the existing deliberate
Production promotion procedure. Review deployment grants no Production approval.
