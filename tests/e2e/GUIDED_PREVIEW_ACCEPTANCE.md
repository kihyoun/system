# Native guided preview acceptance after deployment

The shared `guided-preview.js` adapter checks initial guided setup through native
Wizard setup, source-primary adoption, GitLab pipelines and environment helpers.
The full disposable platform gate runs it on its owned candidate with Review and
Beta enabled. Successor publication requires its completed stages and native
pipeline, merge, environment and unchanged Production evidence.

The optional `guided-preview-live.js` entry point can also run that adapter on an
explicitly selected, locally running controller. Its private input identifies
one operator instance; it has no default host and does not install a controller
or promote Production. This optional operator check is not required for routine
releases and cannot replace the required disposable platform gate. Offline
transport contracts establish adapter behavior; they do not prove a live run.
A successful check-only report is a plan, not passing feature acceptance.

## Prerequisites

Use a fresh initial managed Wizard registration with its exact retained
controller/Wizard image pair. Retain the public release installation receipt or
the native source installation provenance record for the selected installation.
A source provenance record establishes image/source identity, not passing
acceptance or public release status. General configuration, managed Wizard registration, HTTPS GitLab, its configured registry, runner registration and
trusted exact-host DNS/certificates must already work. The accepted immutable
System environment helper must have been provisioned through the native
procedure. The selected runner must permit the normal native Wizard jobs,
including the `docker` and `wizard-source-primary` tags. Package, browser and
image dependencies must be available to those jobs.

Select a namespace and a new private source-project name that does not exist.
The public HTTPS Wizard source or fork must carry the same approved native CI
producer bytes as the accepted controller snapshot. Source transfer validates
public DNS and pins Git's resolution; a private source endpoint, fabricated
receipt or edited CI producer is not an acceptance shortcut. The Review host
must be free, have the declared certificate/key and resolve to this installation.
Beta can remain disabled. Complete any independent System source setup separately;
this lifecycle does not require another System migration pipeline.

The tool runs on the operator's Linux host with Node 24 and Docker access to the
local Unix socket. It checks the exact controller image ID supplied by the
operator before reading native authentication. Obtain that ID from independently
reviewed deployment/image evidence. Do not substitute an arbitrary current image
just to make the check pass.

## Private input and commands

Keep the input and report outside the checkout. Create a private operator
directory and a mode-0600 JSON input with this shape, replacing all example values:

```json
{
  "version": 1,
  "syncUrl": "https://sync.example.com",
  "gitlabUrl": "https://gitlab.example.com",
  "controllerImageId": "sha256:<64 verified hexadecimal characters>",
  "settings": {
    "version": 1,
    "namespace": "operator-team",
    "wizard": {
      "mode": "import",
      "project": "wizard-preview-source",
      "origin": "https://github.com/REPLACE_OWNER/REPLACE_REPOSITORY.git"
    },
    "review": {
      "enabled": true,
      "host": "review.example.com",
      "ssl": "/ssl/live/review.example.com/fullchain.pem",
      "sslKey": "/ssl/live/review.example.com/privkey.pem"
    },
    "beta": {"enabled": false, "host": "", "ssl": "", "sslKey": ""}
  },
  "reportPath": "/root/private-preview-acceptance/report.json",
  "timeBudgetMilliseconds": 3600000
}
```

Review the native prerequisite plan first:

```sh
node tests/e2e/guided-preview-live.js --check-only /root/private-preview-acceptance/input.json
```

Check-only validates the retained installation pair, Production identity and native
DNS/certificate/source/runner preflight. It does not import a repository, start
a source pipeline, adopt a binding or deploy Review. Native authentication can
create and revoke its usual short-lived API credential during preflight.

After reviewing the selected instance, source, namespace and Review host, start
the real acceptance deliberately:

```sh
node tests/e2e/guided-preview-live.js --apply /root/private-preview-acceptance/input.json
```

Credentials come from the selected controller's saved configuration into process
memory. The GitLab administrator API token has a unique acceptance name, is
passed only through request input and is revoked on completion or failure.
No token, password or private key is required in command arguments or the input
file. Raw subprocess errors, job traces and HTTP bodies are excluded from reports.
The report is private because it records operator-specific project and job IDs.

## Assertions and retained results

Apply requires initial managed registration and absent destination projects. The
real native import creates fresh own-instance project IDs and a normal
default-branch push pipeline. The tool waits for successful required
`build:source`, `test:browser`, `build:wizard` and `test:wizard` jobs on actual
runners. It reads their real artifacts and uses the native evidence contract to
verify source commit, pipeline/image identity, approved producer checksums and
project merge gates before accepting adoption.

The adapter resumes setup through the same authenticated API. It creates one
owned branch and MR, waits for that MR's normal required native checks, then
plays the actual manual Review Deploy and Stop jobs. It checks the routed HTTPS
page, running candidate container and exact ownership/generation labels. Stop
must remove that container and retain the matching stopped generation and floor.

The same MR then merges through the project's ordinary pipeline and discussion
gates, pinned to its checked source SHA. No gate override, skipped CI or extra
pipeline trigger is used. The resulting default-branch push must pass the four
required native jobs and matching immutable build/browser artifacts. When Beta
is enabled, the adapter plays that pipeline's manual Beta Deploy and Stop jobs
and checks its HTTPS page, container and matching stopped generation. The full
disposable gate enables Beta; the optional operator input may leave it disabled.
Exactly the imported default-branch, MR and merged default-branch build contexts
are required; no additional System migration or Production promotion is involved.

Exact main configuration bytes and the running immutable Production image ID
must remain unchanged throughout. Setup's source-primary binding and desired
preview settings intentionally remain configured. Source projects, the merged
MR and pipeline evidence remain available for review; the normal merge requests
source-branch deletion. Canonical source and accepted history remain retained.
Review/Beta Stop cleanup is attempted independently when a deployment or page
check fails or a Deploy response is lost. The final unchanged Production check
and temporary-token revocation still run if preview cleanup fails.

A passing apply report has `acceptancePassed: true`. Read its individual stage
results and real project/pipeline/job IDs before recording acceptance. An
interrupted or failed run remains incomplete even when some native jobs passed.
Inspect the saved guided setup status, source projects and exact Review generation
before repair. Sanitized full-gate evidence retains the native source, MR,
merge, manual-job and stopped-generation identities across recovery/report
cleanup; credentials, platform URLs and raw responses are excluded. Missing or
failed lifecycle stages cannot authorize successor publication. Cold recovery
creates a second owned candidate: guided stages belong to the original host,
and migration/storage stages belong to the restored host. Publication freezes
both proofs in one artifact, with the original guided receipt nested under
`guidedPreviewReceipt`. It checks their run lineage, source revision, CI
project/pipeline/job, prepared image pair and restored canonical binding proof;
it does not relabel original guided stages as restored-host work. If a Stop job
failed, use the existing native Stop/reconciliation procedure for that owned
generation. Never clear a live environment lease or
repeat setup with another source name to bypass an ownership conflict.

If temporary-token creation loses its completion response, the tool attempts
cleanup of the exact reserved name `guided-preview-acceptance-<operation>` and
reports cleanup as uncertain even if no active token is observed. The original
native request may still finish later. On an operator instance, inspect and
revoke that exact operation-owned token through native GitLab controls before
treating cleanup as complete. The disposable gate removes its owned database
during teardown.
