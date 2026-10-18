# Managed Wizard Review and Beta

The environment workflow extends the managed source/build receipts. Production promotion and rollback remain
outside this recipe. The existing public source CI and publishing destinations
are retained.

Review uses one exact HTTPS host and a single active merge-request lease.
The resource identity includes the project and MR IID. A different MR must wait
until the current Review is stopped; a newer verified pipeline of the same MR
may replace it. Beta uses a separate exact host and the current default-branch
head. Deploy and Stop are manual native GitLab jobs for both environments.
There are no Production jobs or arbitrary image deployment endpoints.

## Configuration and installation

The authenticated Wizard environment dialog previews optional settings. Each
enabled row requires an explicit exact host, domain mode 2 and certificate/key
paths under /ssl. Wildcard domain modes are unsupported in this recipe. Disabled
rows may be blank. Settings are not inferred and enabled automatically.

The server validates DNS against the current Production host addresses, exact
certificate coverage, validity and matching private key. Reserve the hosts
separately from platform and other project routes. Provision their certificates
before confirming installation. Existing Production settings and the immutable
System Cube, including its fixed HTTPS www URL and port 8071, remain unchanged.

A confirmed preview installs versioned managed files and the selected CI through
one guarded skip-CI commit. It does not start a pipeline or deploy a container.
Unexpected edits, occupied paths, changed previews and ownership mismatches
fail closed. Refresh inspects the same operation without creating another
commit or pipeline. An uncertain commit outcome requires reconciliation before
retrying. A verified installed operation is ready for the manual CI jobs.

To change settings, stop active environments and reconcile pending work first.
Preview again and explicitly confirm the change. The update checks the prior
recipe and exact file identities before replacing managed content. Preserve the
server-owned receipt across Fetch/Push and controller startup. Earlier build
evidence remains historical; use environment status for the installed recipe.

## Immutable helper provisioning

The operator must build a clean System image from the tested committed source
and its matching validated Wizard snapshot. Do not include private configuration,
credentials, Git metadata or host runtime output. Provision that image on the
existing runner Docker daemon, retain it while the recipe is installed, and
configure SYSTEM_WIZARD_ENVIRONMENT_IMAGE with its exact sha256 image ID.
SYSTEM_WIZARD_CANONICAL_CONTROLLER must identify system_bootstrapper_1.
The UI cannot choose a helper image or canonical controller.

From the matching System checkout with initialized submodules, prepare the pinned
source package before building the complete helper image:

```sh
bash project-bootstrap/wizard-source/prepare.sh
docker build -f system/Dockerfile -t system-wizard-helper:local .
docker image inspect --format '{{.Id}}' system-wizard-helper:local
```

Record that returned image ID in the private controller configuration and make
that exact image available on the runner's Docker daemon. The standalone runtime
base is not the complete helper. See [source packaging](../../docs/WIZARD_SOURCE.md)
for the pinned snapshot contract.

CI uses ordinary job-scoped registry credentials to preload its candidate
digest. No Sync/admin credential enters the helper. The helper uses the existing
trusted Docker runner model and the original controller/GitLab containers for
canonical receipt and job checks. This is not isolation for hostile repository
code. The helper is bounded and uses network none, a read-only root filesystem,
the existing Docker socket, templates volume and read-only SSL volume; it does
not receive a new configuration volume.

The exact running job, pipeline, source head, MR identity, selected CI and
successful required build/browser artifacts are checked server-side before
deployment. Temporary verification access remains inside GitLab and is revoked.
The helper image must be reprovisioned explicitly when upgrading this recipe;
do not delete it with unrelated image cleanup.

## Ownership and recovery

Deploy/Stop serialize through a shared canonical-controller lock and guarded
receipt updates. Candidate containers, networks and route fragments have exact
operation/project/MR/generation ownership. A candidate becomes healthy before
its HTTPS route changes. Failed nginx validation, reload or receipt writes
restore the previous route. Stop retains an owned HTTP 410 / HTTPS handshake-rejection tombstone so the
stopped host cannot fall through to a platform service, even without a usable
candidate certificate. Cleanup removes only the owned generation; stale
jobs cannot replace or stop a newer deployment.

A held lock after abrupt host/process loss requires operator inspection of its
owner and exact helper container before targeted recovery. Do not delete a lock,
receipt or route merely because a retry failed. Pending cutovers and retired
resources remain recorded for reconciliation. Never use global Docker prune or
restart the primary platform as cleanup.

Configuration stays separate from Harvest/Seed. Environment installation does
not select the primary development platform or promote the running Production
Wizard. Production uses the separate [operator promotion workflow](../wizard-production/README.md).

## Certificates without proxy downtime

Use an operator-provisioned ACME webroot shared at /ssl/acme-http01. The supplied
HTTP templates allow only /.well-known/acme-challenge/ before normal HTTPS
redirects. A default HTTP challenge server handles new candidate hosts before
their optional HTTPS route is installed. Do not stop the shared proxy for renewal.

For each certificate lineage, configure Certbot webroot authentication and a
deploy hook that atomically copies the full chain and private key into the
configured /ssl/live/<lineage>/ paths, validates nginx and gracefully reloads it.
Keep private keys private. Remove obsolete standalone stop/start renewal hooks
only after backing them up and validating the webroot renewal with a dry run.
Issuance and renewal remain operator tasks, not CI deployment privileges.

The isolated manifest covers environment API/workflow, deterministic recipes,
guarded GitLab upgrades, helper ownership/recovery and proxy preservation.
Also verify real GitLab manual-job execution, HTTPS/browser behavior and
preservation of Production on a disposable platform. Fixture success alone
does not prove those integration gates.
