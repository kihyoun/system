# Optional Wizard Beta from the System candidate

System and Wizard share one repository. The optional Wizard Beta uses a fixed
HTTPS address and the exact Wizard image of an accepted System candidate. It
starts no extra build or complete platform pipeline. Production promotion is a
separate, deliberate operation. Ordinary application projects retain Review,
Beta and Production; an isolated platform test is a disposable verification
installation, not a permanent Beta platform.

## Configure and bind

Import or fork the complete System repository into your private GitLab namespace
using GitLab's normal repository workflow. Keep the default branch protected,
required pipeline and discussion gates enabled, and the root CI configuration.
Configure a permitted Docker runner. In the Wizard choose Configure System Beta,
select that existing shared source project and an optional exact HTTPS Beta host
with certificate and key paths under /ssl. No Review host is required. Preflight
checks the source tree, DNS and certificate; confirmation reserves settings only.
It does not create projects, start pipelines or modify Production.

After the System candidate has passed all required checks, use the repository
operator tool with a private JSON input file. The input supplies operation,
projectId, projectPath, namespaceId, defaultBranch, pipelineId, candidateJobId,
sourceCommit, wizardSourceTree, helperImage, wizardImageId and wizardImageRef.
Use exact values from the accepted candidate release metadata and the configured
reservation. The source commit identifies the shared repository; the Wizard tree
identifies its committed subdirectory. Retain the helper image for Stop.

```sh
node project-bootstrap/system-beta/bind.js plan /state/beta-input.json
node project-bootstrap/system-beta/bind.js apply /state/beta-input.json PLAN_HASH
```

Inspect the plan before applying its exact hash. Set the native project variables
SYSTEM_BETA_OPERATION and WIZARD_BETA_HOST to the reservation's operation and
exact host. Deploy and Stop are explicit manual System pipeline jobs. They reuse
the existing release artifact and immutable images; verification checks project,
job, candidate pipeline, shared source tree, image identities, storage/upgrade
acceptance and browser cleanup before routing. No arbitrary image endpoint is
provided. Stop remains available when build artifacts expire.

## Existing installations and recovery

Old configuration JSON/ZIP files remain readable and inert. Opening or fetching
a backup never creates projects or deployments. Old desired preview settings
remain version 1 until the user explicitly selects Configure System Beta. Review
values are not repurposed as Beta hosts. Existing repository identities, managed
source receipts, user edits and import history remain retained.

New System Review deployment and binding are retired. Stop an old active Review
with its retained original job/binding using the historical launcher in stop
mode, then use the owned stopped-route cleanup. Inspect pending and retired
resources before migration. Cleanup validates exact operation, project,
generation and labels; it cannot remove Production or another project's resources.
Do not delete bindings, receipts, generation floors or tombstones to bypass a
conflict. Beta setup refuses active, pending, retired or uncleared stopped routes.

```sh
node project-bootstrap/system-review/run.js stop
node project-bootstrap/wizard-environments/cleanup-stopped.js OPERATION
```

The Stop launcher requires the original job identity and retained helper image.
Run it from the original authorized job; do not fabricate CI evidence. If its job
cannot run, recover with the retained historical release tools and owned receipt.
Bindings and histories belong to persistent controller state and must accompany
the matching Harvest/Seed recovery. Configuration backup remains separate from
service-data backup. Historical releases without a source layout field keep their
separate Wizard gitlink identity; never reinterpret that commit as a shared tree.

## Verification and capacity

Component and candidate gates remain required. Beta binding, launcher and verifier
fixtures cover foreign ownership, stale jobs, image/source mismatches, credential
cleanup and expiring-artifact Stop. Compare durations and resource use from
comparable accepted candidate runs. Removing optional Review jobs does not by
itself shorten the isolated full platform test; no measured saving is implied.
