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
loopback. The outer published HTTP port is assigned by Docker and bound only to
the outer daemon host's `127.0.0.1`.

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
The archives must contain all required service image layers. The driver copies
only these explicit files, not the checkout, host Docker storage or existing data.
Use candidate images built without private configuration or credentials.

For example, the shape of one role is:

```json
{"archive":"/job/images/candidate.tar","id":"sha256:<64 verified hexadecimal characters>"}
```

`readinessMilliseconds` is optional (1,000–1,200,000; default 1,200,000 per smoke
readiness gate). The overall lifecycle has a one-hour budget, checked between
bounded Docker/HTTP operations. Each archive copy/load is capped at ten minutes;
other Docker operations at two minutes and individual HTTP requests at ten
seconds. An explicit event-loop yield before every Docker operation delivers
queued signal callbacks. Cancellation is observed between operations, so a
copy/load can delay cooperative cancellation by up to ten minutes. CI must allow
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

No privileged candidate execution or real GitLab pipeline is claimed by these
fixtures. Root CI YAML integration is owned separately. Real startup compatibility,
resource budget, Docker cancellation behavior, runner idempotency, registry
build/push/pull/run, detailed routing, persistent-data harvest/restore and repeated
full-candidate cleanup require the later resource-leased acceptance run and
scenario adapters. Existing `*/live/` scripts are not automatically imported;
their fixed-name assumptions must be adapted explicitly to this private daemon.
Issue 21 stays open until that evidence and real pipeline gating exist.
