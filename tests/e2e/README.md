# Disposable candidate lifecycle

This is the remaining integration work for [System issue 21](https://github.com/kihyoun/system/issues/21).
`candidate.js` is an explicit lifecycle/smoke driver, **not** an isolated-manifest
entry and not a completed full-platform acceptance suite. Its offline transport
contract is registered as `shared/disposable-candidate-contract.js`.

## Boundary and prerequisites

Use a trusted Linux driver with Node 24 and Docker CLI access to the intended
outer Docker daemon. No existing System installation, WSL account, local seed,
private configuration, globally named platform container or workstation path is
an input. The driver may run inside a CI container: HTTP requests execute through
Node in the private candidate bootstrapper, not through the CI container's
loopback. No port is published on the outer daemon. HTTP probes run through Node inside
the owned candidate, through its private bridge gateway and private NGINX.

The driver creates one randomly named, ownership-labeled **privileged DinD**
container, an internal network and a Docker-data volume. DinD has its own Unix
socket; the host socket is never mounted into it. Fixed `system_*` names, inner
Docker networks, ports 80/8071/5050 and service volumes are confined to that daemon.
The inner bootstrapper receives that **inner** socket because normal System
startup requires it. Never reuse this harness for untrusted candidate code:
privileged Docker execution shares the host kernel and is not a host isolation
guarantee. No additional GitLab runner is provisioned on the outer platform.

Before any real run, review the exact candidate and DinD image, obtain the
coordinator's resource lease and agree a test window. The DinD container is
limited to four CPUs and 12 GiB RAM. Budget additional headroom on the outer
host, image archives, image extraction and GitLab's data volume; Docker's volume
does not enforce a disk quota. Disk/RAM checks and a lease must happen outside
this driver before invocation. An internal outer network prevents external
dependency downloads; service images must be preloaded, and later real registry
or runner scenarios need their own explicit offline image/dependency contract.

## Explicit inputs

Create a public JSON specification with `daemonImage` as an exact Docker DinD
release **and verified sha256 digest**. There is deliberately no floating or
invented default. `images` must contain exactly these roles:

| Role | Input | Private-daemon tag |
| --- | --- | --- |
| `candidate` | Complete candidate System image, including its pinned Wizard files and installed Sync dependencies | `system-candidate:under-test` |
| `wizard` | Prepared Wizard web image | `systembootstrapper/wizard` |
| `gitlab` | Selected supported GitLab image | `candidate-gitlab:under-test` |
| `runner` | Compatible GitLab Runner image | `candidate-runner:under-test` |
| `nginx` | Selected NGINX image | `nginx:latest` (an inner compatibility alias only) |

Each role has `archive` (an absolute driver-local regular image archive file,
created with `docker image save`) and `id` (the exact `sha256:` image ID, obtained
with `docker image inspect --format '{{.Id}}' IMAGE`). These are **image IDs**,
not registry manifest digests. The daemon is pinned by registry digest; each
loaded role is verified by image ID before its expected local alias is assigned.
The archives must contain all required service image layers. The driver streams
only these explicit files, not the checkout, host Docker storage or existing data.
The current bootstrap creates configuration, service and runner bind directories
inside the owned private daemon at `/candidate-data/platform`, and mounts the
configuration at `/state`. These are disposable candidate paths, never the
Production attached volume. Every Docker operation is capped by the remaining
overall budget as well as its own timeout.
Use candidate images built without private configuration or credentials.

For example, the shape of one role is:

```json
{"archive":"/job/images/candidate.tar","id":"sha256:<64 verified hexadecimal characters>"}
```

`readinessMilliseconds` is optional (1,000–1,200,000; default 1,200,000 per smoke
readiness gate). The overall lifecycle has a twenty-minute budget, checked between
bounded Docker/HTTP operations. Each streamed archive load is capped at ten minutes;
other Docker operations at two minutes and individual HTTP requests at ten
seconds. An explicit event-loop yield before every Docker operation delivers
queued signal callbacks. Cancellation is observed between operations, so an
archive load can delay cooperative cancellation by up to ten minutes. CI must allow
cleanup after that boundary and retain the receipt for forced termination.

From a committed LF checkout (the signed example must validate unchanged):

```sh
SYSTEM_DISPOSABLE_CANDIDATE=I_ACCEPT_PRIVILEGED_DISPOSABLE_EXECUTION \
  node tests/e2e/candidate.js /job/candidate-spec.json
```

Temporary random GitLab root and Sync credentials are generated in memory and
written through stdin only into the disposable daemon/candidate. They are absent
from command arguments, the public specification and reports. Configuration is
generated from the public example, changing only named assignments after the
signature; an invalid Cube fails closed. No private host configuration is read.

## Evidence and cleanup

The first smoke gates require a routed HTML response from the Wizard, a real
Sync login, and authenticated Fetch of the signed main configuration with the
same temporary Sync credentials. This proves neither browser rendering nor
GitLab/runner/registry readiness. It does not enable Wizard source/build workflows,
create deployment pipelines or perform a Production rollout. Normal bootstrap's
default Wizard registration occurs only inside the disposable candidate.

`test-results/e2e/<run-id>/results.json` records bounded stage outcomes, exact
owned resource identities and image IDs; `junit.xml` provides CI test evidence.
No raw Docker logs, raw HTTP bodies, tokens, credentials or subprocess error
output are published. This intentionally limits diagnosis until sanitized
component-specific log adapters are implemented. The receipt is checkpointed
before each outer resource creation so an interrupted create can be reconciled.
Each receipt is written completely to a unique same-directory temporary file,
fsynced, closed and atomically renamed over the previous receipt. An interrupted
or disk-full write retains the previous complete receipt, including a pending
creation name if the subsequent full-ID checkpoint failed. Abrupt process exit
can leave a small incomplete `.tmp` file; cleanup reads only `results.json`.
On the Linux driver, a checkpoint also fsyncs the containing directory after
each rename. Report directories and their ancestors are synchronized from the
leaf through the filesystem root before resource creation, including existing
paths that a previous failed checkpoint might have created without persisting.
Any synchronization failure aborts the checkpoint. These guarantees depend on
the filesystem and storage honoring fsync; retain receipts on persistent storage.
Native Windows fixtures verify process-crash atomic replacement, but Node's
Windows filesystem API does not provide the same directory-fsync guarantee.
Windows fixture success must not be presented as power-loss durability evidence.

Cleanup runs on success, failure and cooperative SIGINT/SIGTERM. It lists stopped
containers too, distinguishes absent resources from an unreachable daemon and
checks exact names, ownership labels and full IDs before removal. A failed or
foreign container blocks dependent volume/network teardown. Cleanup failure
turns success into failure and never converts a primary failure into success.
It uses no global prune and does not touch another run's resources.

After SIGKILL, power loss or an unavailable daemon, retain the receipt and retry
only this cleanup entry point once the intended outer daemon is available:

```sh
SYSTEM_DISPOSABLE_CANDIDATE=I_ACCEPT_PRIVILEGED_DISPOSABLE_EXECUTION \
  node tests/e2e/candidate.js cleanup test-results/e2e/RUN_ID/results.json
```

A pending creation without an ID is inspected by its unique journaled name;
ownership and the resulting full ID must be proven before deletion. Unknown or
foreign instances are refused. Cleanup does not adopt, copy or destroy an
existing System installation. Forced process termination cannot guarantee
immediate cleanup; CI must retain receipts and run an independent cleanup hook.

## Current verification and remaining work

Native Node offline fixtures cover command construction, private-daemon socket
boundary, loopback binding, exact image identity, successful and refused Fetch,
signature preservation, temporary credential/report separation, timeout and
cancellation, stopped/absent resources, pending-create recovery, foreign-resource
refusal and daemon/removal failures. Regressions also exit a child process during
a partial receipt write, fail the post-create ID checkpoint, recover the prior
pending receipt, and deliver a macrotask SIGTERM handler between copy and load.
Ordered injected-IO fixtures additionally check Linux directory persistence and
refusal to create resources after either ancestry or post-rename sync failures.
They invoke neither Docker nor live HTTP:

```sh
node tests/shared/disposable-candidate-contract.js
```

The offline fixtures do not establish privileged candidate execution or a real
GitLab pipeline. The required root CI job now invokes the full driver separately. Real startup compatibility,
resource budget, Docker cancellation behavior, runner idempotency, registry
build/push/pull/run, detailed routing, persistent-data harvest/restore and repeated
full-candidate cleanup require the later resource-leased acceptance run and
scenario adapters. Existing `*/live/` scripts are not automatically imported;
their fixed-name assumptions must be adapted explicitly to this private daemon.
Issue 21 stays open until that evidence and real pipeline gating exist.

## Required full-platform CI

`test:platform-candidate` runs after every isolated/image test and blocks the
existing publishing stage. Its trusted Node 24 / Alpine parent installs the same
pinned CLI utilities as System, builds the full System context and the Wizard
from the validated pinned snapshot, and preloads the pinned service images.
The job is serialized with a GitLab resource group. Image preparation has a
separate bounded budget; private execution has an overall twenty-minute limit.
The runner host needs twelve GiB candidate RAM plus its existing platform/job
headroom and enough free disk for image archives, extraction and GitLab state.

The CI specification explicitly sets `fullAcceptance: true` and supplies a
matching pinned runner helper image through `supportImages.helper`. In addition
to routed HTML and authenticated signed Fetch, the full driver verifies a fresh
GitLab and runner, repeats registration without duplicate pools or active setup
credentials, creates an owned private project, runs a real Docker build/push/
pull/run pipeline with artifact delivery, and proves a deliberate failed job
blocks the downstream delivery job. It revokes its temporary API credential
and confirms HTTP 401 before stopping services for the seed cycle. The seed
scenario harvests stopped private GitLab files, removes a marker from live data,
restores, and checks that marker. This proves the current service-data copy
cycle; it is not the stronger configuration-plus-Seed fresh-server acceptance
tracked in issue 43. No Production rollout is performed.

The manifest records individual stage outcomes and sanitized numeric pipeline/
job/project identities. Failed pipelines retain sanitized job status/reasons,
without raw traces, credentials, configuration or Docker output. Both shell
traps and GitLab `after_script` replay ownership-checked cleanup receipts. Only
job-labeled built image tags are removed; shared pinned public image caches are
retained. No global prune is used. Forced host loss still requires replaying the
retained receipt once the daemon is reachable.


## Backup-only cold recovery adapter (#43)

When the committed source includes the completed Seed manifest implementation,
image preparation requires `recovery.js`, enables `recoveryAcceptance`, and extracts
the actual Wizard configuration-export model bundle from the freshly built Wizard
image. The exporter is an explicit private file input, checked by SHA-256 and the
pinned Wizard source revision. Its ZIP uses the same model and generator as Backup;
it contains configuration only.

The adapter records synthetic GitLab users, repository head, an issue, an encrypted
CI variable and an existing registry digest. It creates a synthetic TLS certificate
and account/renewal layout, fetches saved main/project configuration through the
authenticated API, exports it through the Wizard model, and runs the real controlled
cold Harvest. Only that ZIP and the completed marked Seed leave the original owned
DinD daemon. Binary transfers use file descriptors and checksums use bounded buffers.
Private archives have mode 0600 beneath a mode-0700 temporary directory; they never
enter public CI artifacts or reports.

The original daemon and its Docker-data volume are removed before a fresh owned
daemon starts. Recovery uses a different empty data root and reloads only the
explicit images built from the committed source and pinned public dependencies.
It imports the real ZIP before provisioning, rebinds the declared Seed path without
changing the Cube, applies the real Seed, executes the fresh-source renewal-path
rewriter, and then starts services. No previous live configuration directory, runner
workspace or undeclared image archive is mounted or read. Expected credentials and
identities remain verification oracles; they are never written as recovery inputs.

The restored instance must pass CA-verified HTTPS with the expected host/SNI,
authenticated configuration Fetch, account/certificate/renewal-path preservation,
and GitLab user/project/repository/issue/encrypted-setting/registry identity checks.
It repeats actual runner/registry CI and its failure gate, then runs a further real
CI job that pulls and executes the original registry blob captured before Harvest.
Both lifecycles share the original overall deadline and cancellation flag. Each has
an independent ownership/checkpoint receipt and cleanup; a cleanup failure fails
acceptance and retains private inputs for targeted recovery.

This deliberately reports `acmeRenewalVerified: false`: synthetic TLS plus restored
renewal configuration is not a Certbot/ACME renewal dry-run. Full #43 closure still
requires a bounded local ACME fixture or separately authorized real renewal proof.
The offline adapter tests include actual ephemeral HTTPS with a trusted CA,
wrong-host and foreign-CA rejection, lifecycle ordering, cancellation, stream
boundaries and failed-cleanup handling. They do not establish a passed cold run.


The baseline cold fixture uses its explicitly source-built local Wizard image.
Capture preserves any existing `WIZARD_IMAGE`, GitLab/Runner version and host
binding assignments rather than replacing those choices with fixture defaults.
Without the explicit `privateWizardRecovery` scenario, a restored private Wizard
registry pin fails with `wizard-pin-recovery-artifact-not-declared`; it is never
silently changed to the local fixture image.

The private-image scenario publishes a derivative of the declared source-built
Wizard image through a real CI job on a separate branch of the managed Wizard
project. A unique marker layer makes its image ID different from every prepared
archive. The actual exported configuration pins that CI-published registry digest.
The new daemon must have neither its digest reference nor its private image ID
before startup. After Seed restoration, the fresh-source startup helper retrieves
the exact image using a temporary project-scoped `read_registry` deploy token.
The adapter verifies the running Wizard's image ID and marker and verifies that
no live reserved recovery token remains. Only then may the report state
`privateWizardPinVerified: true`. The fixture does not supply an old Docker login,
private image archive or substitute image. This scenario still requires actual
passing candidate execution; its component contracts are not integration proof.
#43 remains open until the complete private-image scenario and actual renewal
proof pass. A fresh host must not depend on an old Docker login, and successful
local-image recovery alone does not verify the private-pin case.

## Local ACME follow-up (inactive until reviewed activation)

`local-acme.js` implements the separately enabled `acmeRenewalAcceptance` phase.
`prepare-acme-images.js` prepares only the three exact public image pins declared
in that module; its return value is the required `spec.acmeImages`. The pinned
Certbot archive has an explicit image ID and SHA-256. The committed public Pebble
TLS trust certificate has separate provenance/hash documentation in
`acme-fixture/README.md`; it is never installed in a general trust store.

The authority and DNS server use 192 MiB and 64 MiB on an independently owned
internal Docker bridge with no published port. They survive the original platform
daemon's deletion. Each uses the existing ownership journal and guarded cleanup,
with at most one container/network/volume per owner. A short initializer runs
without network and overrides image-declared volumes with tmpfs. Every owner
inherits the original candidate's absolute deadline and cancellation. The expanded
`acmeRenewalAcceptance: true` scenario has one shared 1,500-second lifecycle
budget, including both platform hosts and these fixture owners. Ordinary
candidates retain their 1,200-second budget; no individual stage resets it.
The existing 28-minute script and 30-minute CI-job limits retain preparation
and cleanup reserve. Forced-kill cleanup
must remove heavy platform owners before these fixture owners.

The DNS fixture points the test domains at each owned daemon's private bridge
address. Pebble validates real HTTP-01 requests against NGINX port 80; authorization
reuse is disabled and validation is never bypassed. A real certificate/account is
created before configuration Backup and cold Harvest. After the host switch, the
same account key and certificate are verified, an invalid DNS target must cause
renewal to fail, then the correct new target must allow actual renewal and produce
a different certificate serial. Verified HTTPS uses the independently generated
issuance root fetched over the authenticated fixture control channel.

The actual fresh-source renewal lease and certificate installation/reload scripts
run in a shell-only GitLab-image host harness with real bind mounts and mount
utilities. Its sole client adapter transports Certbot through Docker; the real
Certbot deploy event triggers the unchanged source installation hook. The Docker
CLI and its musl loader come from the declared fresh controller image. No old
host executable, package installation, Production path or Production socket is
used. This does not emulate systemd timer scheduling or public Let's Encrypt.

Offline contracts verify inputs/trust, tiny resource bounds, ownership, cleanup,
negative-validation gating and real HTTPS trust/SNI. They do not establish a passed
ACME recovery. `acmeRenewalVerified` can become true only after the actual restored
account, renewal, deployment and CA-verified HTTPS stages all pass. Image-preparation
activation and cleanup ordering are reviewed separately before this phase runs.

Configuration comparisons decode literal shell assignments without executing
them. Quoted and unquoted exports are compared by exact values; substrings,
duplicate assignments, shell expansion and shell commands cannot satisfy an
assertion. Only explicit source-owned failure codes survive cleanup retries.
