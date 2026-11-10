# Optional development previews after Quickstart

Quickstart starts the accepted public System controller and Wizard. Development
previews are an optional subsequent operation. Complete General configuration,
GitLab initialization, its registry and runner registration first. Ordinary
installations can continue without enabling previews.

## Prerequisites and explicit inputs

Provide a GitLab namespace and a canonical Wizard source project. Select an
existing private project, or import a public HTTPS upstream/fork into a new
private project. Imports preserve branch/tag history; an occupied target or
changed imported refs stop setup. Import private origins separately with your
normal GitLab credentials, then select the existing source. No origin credential
belongs in saved settings.

The clone starts from the selected origin's default branch and retains its
branches and tags. The Production image pin does not select a source branch or
promise that the public origin's default branch matches the accepted release's
Wizard revision. Choose the desired default branch in your own fork before
importing, and inspect the new GitLab project's actual default branch: setup
verifies that branch's real commit and native push pipeline. For an exact source
stand, import it into GitLab first, choose its default branch there, then select
**Use an existing private source project**. Setup preserves that existing choice.

The Wizard source must include the reviewed native delivery CI, current generic
build recipe and environment launcher. Guided setup verifies native CI producer
files against the accepted controller's pinned Wizard source snapshot, including
the browser and environment launchers. A fork with reviewed changes to those
producers uses the explicit source-primary manifest workflow instead; guided setup
does not approve its own reported hashes. Existing projects must select
`.gitlab/primary.yml`, keep successful-pipeline and resolved-discussion merge
gates enabled, and grant an online Docker runner the required
`docker` and `wizard-source-primary` tags. Setup enables private delivery.
Existing publishing roles remain unchanged. New imports explicitly disable
public publication opt-ins so a fork cannot inherit upstream destinations.

Provision an immutable reviewed System helper on the runner daemon and configure
`SYSTEM_WIZARD_ENVIRONMENT_IMAGE` and `SYSTEM_WIZARD_CANONICAL_CONTROLLER` using
[the environment guide](../project-bootstrap/wizard-environments/README.md).
Use separate exact Review/Beta HTTPS hosts, public DNS resolving to the existing
Wizard addresses, and valid matching certificates/private keys under `/ssl`.
Preflight checks DNS, exact certificate identity and dates, matching keys, source
availability and runner access before source provisioning. Setup does not issue
certificates or change DNS.

## Guided setup and waiting

Connect the Wizard and select **Set up development previews**. Choose the
namespace, source projects, import origins and explicit HTTPS inputs. Review is
one shared host with the existing single merge-request lease. Beta is optional.
**Save desired settings** changes configuration-backup intent only.

Select **Check prerequisites**, inspect the selected inputs, then explicitly
confirm setup. Source transfers use native Git pushes into newly owned empty
projects with expiring project credentials. Credentials are revoked after the
transfer; they never enter configuration exports. Importing source starts its
real default-branch push pipeline. Existing projects need a normal source push
when no current native push pipeline exists.

Build, source checks and independent browser checks can take several additional
minutes or longer depending on runner queues, downloads and host capacity. A
waiting setup reports the pipeline link. After it finishes, check prerequisites
again and resume. Failed required checks, missing artifacts, changed CI or a
mismatched immutable image cannot produce an accepted binding. The native
[source-primary verifier](../project-bootstrap/wizard-source-primary/README.md)
checks the exact commit, pipeline, approved producer files and digest again.

Initial setup requires an untouched managed registration and a retained
installation identity. A public installation retains the accepted
controller/Wizard release receipt. It archives the old
configuration and binds private previews without changing the main configuration
or Production image selection. Existing managed source history must use its
native adoption/upgrade path. Production promotion remains separate.

Evidence reads are grouped into bounded batches within each verification phase.
They retain the same project, pipeline, artifact and producer checks; applying a
plan obtains fresh mutable evidence rather than trusting a cached preview.
This reduces separate Rails startups. Downloads, native builds and browser
checks still require their real execution time; no fixed setup duration is promised.

### Retain a source-built installation identity

A source-built installation can retain its actual running image pair without
claiming that it is an accepted public release. Both configured image selectors
must be immutable `sha256:` image IDs. The controller and Wizard must carry
matching `org.system-bootstrapper.test-job` and
`org.system-bootstrapper.source-tree` labels, their respective
`org.opencontainers.image.revision` labels, and the Wizard's matching
`org.system-bootstrapper.source-revision`. The packaged Wizard snapshot must
match the supplied Wizard revision. The native System candidate preparation
produces this paired provenance from the committed checkout.

Obtain the expected image IDs, System commit/tree and Wizard gitlink independently
from the reviewed source/build records. Record the already running pair through
the committed controller entry point:

```sh
docker exec system_bootstrapper_1 node /system/bootstrapper/record-source-installation.js \
  --controller sha256:REPLACE_WITH_CONTROLLER_IMAGE_ID \
  --wizard sha256:REPLACE_WITH_WIZARD_IMAGE_ID \
  --source-revision REPLACE_WITH_SYSTEM_COMMIT \
  --source-tree REPLACE_WITH_SYSTEM_TREE \
  --wizard-revision REPLACE_WITH_WIZARD_GITLINK
```

The command inspects the actual running containers and exact image provenance,
then creates the root-owned mode-0600 `/state/.source-installation.json`. It does
not install, start, promote or accept images, alter main configuration, create a
release receipt or assert that tests passed. Subsequent setup rechecks the
running identity. An existing invalid or incomplete public release selection
cannot fall back to this source record. After recovery, retain or explicitly
re-record source provenance against independently preserved build inputs before
starting a new initial setup; configuration metadata alone does not authorize it.

## Deploy, stop and System candidates

A ready setup reports the reserved Review URL. It becomes usable after a
successful explicit native **Deploy** job; **Stop** retains the existing owned
tombstone. The canonical helper still enforces Review ownership, generation
floors, successful candidate evidence and the separate Beta controls. Setup does
not deploy a candidate automatically.

Optionally select a distinct System source project in the same namespace. This
enables its existing Wizard-only merge-request preview jobs against the canonical
Review host. Each tested System candidate still requires the existing explicit
[System candidate binding](../project-bootstrap/system-review/bind.js) before
its manual deployment. The disposable full-platform migration network remains a
separate verification gate.

## Backup, recreation and safe resumption

Regular JSON/ZIP exports contain versioned desired settings in `previewSetup`.
They contain namespace/project names, origin choices and HTTPS paths. They do not
contain new-instance project IDs, source-transfer credentials, pipeline evidence
or live deployment receipts. Older backups without that field remain usable.
Opening, importing or fetching settings never starts setup or changes Production.

After recreation without a matching Seed, explicitly run setup against the new
instance to create fresh IDs, credentials and evidence. A configuration backup
alone does not restore GitLab repositories, registry images or CI artifacts.
Harvest/Seed remains the service-data recovery path.

Setup holds the native project and live-state leases throughout source, binding
and environment changes, so configuration Push, Harvest and host maintenance
cannot overlap it. A read-only setup status or job poll remains available.

Within one instance, repeat the same action to resume waiting work. The private
operation retains owned project IDs and configuration hashes. Changed origins,
operator edits, ownership conflicts or a different Production configuration stop
resumption. An unconfirmed Rails completion, including a timeout, Docker transport
loss or an incomplete terminal response, records `needs-inspection` and retains
both exact owned leases. Status remains read-only; preflight and apply cannot
resume that operation. An administrator must confirm that the recorded mutation
has ended and inspect project, ref and variable outcomes before targeted recovery.
A failed local job alone is not proof that Rails stopped. A settled native refusal
releases its own leases and permits the ordinary explicit resumption.

A surviving operation lock after abrupt process loss requires
inspection of its exact owner before targeted recovery. Do not delete projects,
reset receipts, remove leases or force-push to bypass a conflict.

The same repository-owned controller entrypoint is available for operators who
prefer a private settings file:

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/preview-setup/run.js status
docker exec system_bootstrapper_1 node /system/project-bootstrap/preview-setup/run.js preflight /state/preview-settings.json
docker exec system_bootstrapper_1 node /system/project-bootstrap/preview-setup/run.js apply /state/preview-settings.json PREFLIGHT_HASH
```

Use file mode `0600`. Supply the exact confirmed hash and the same versioned
settings as the Wizard. Status is read-only; preflight creates no projects,
pipelines or deployments. Apply performs only the explicitly confirmed native
setup. The returned Review URL reserves a host; it does not claim a running
preview before a manual successful deployment.
