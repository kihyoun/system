# Native guided preview acceptance after deployment

The reviewed `guided-preview-live.js` entry point checks initial guided setup on
an explicitly selected, locally running System controller. Run it only after the
new controller has been accepted and deliberately deployed. It reuses the native
Wizard setup, source-primary adoption, GitLab pipelines and environment helpers.
It does not install a controller or make a Production promotion.

This is separate from the disposable platform gate. Its private inputs identify
an operator instance; there is no default host or implicit activation in CI.
The offline transport contracts do not establish that this real acceptance has
run. A successful check-only report is a plan, not passing feature acceptance.

## Prerequisites

Use a fresh public Production installation with its accepted controller/Wizard
image pair and retained release installation receipt. General configuration,
managed Wizard registration, HTTPS GitLab and registry, runner registration and
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
the Wizard acceptance does not require another System migration pipeline.

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

Check-only validates the installed public pair, Production identity and native
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

The tool resumes setup through the same authenticated API. It then creates one
owned branch and draft MR, waits for that MR's normal native checks, and plays the
actual manual Review Deploy and Stop jobs. The default push and MR contexts are
both required by the existing product contract; no alternate CI producer or
System pipeline is introduced. It checks the routed HTTPS page, running candidate
container, canonical deployment identity and removal after Stop.

Exact main configuration bytes and the running immutable Production image ID
must remain unchanged throughout. Setup's source-primary binding and desired
preview settings intentionally remain configured. Source projects, branch, draft
MR and pipeline evidence remain available for review; the tool does not delete
canonical source or accepted history. Only temporary credentials and the owned
Review deployment are cleaned up.

A passing apply report has `acceptancePassed: true`. Read its individual stage
results and real project/pipeline/job IDs before recording acceptance. An
interrupted or failed run remains incomplete even when some native jobs passed.
Inspect the saved guided setup status, source projects and exact Review generation
before repair. If the Stop job failed, use the existing native Stop/reconciliation
procedure for that owned generation. Never clear a live environment lease or
repeat setup with another source name to bypass an ownership conflict.
