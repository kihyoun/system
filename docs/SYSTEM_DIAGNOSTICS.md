# System diagnostics

Open **System diagnostics** in the connected Wizard. Opening the dialog reads
configured targets and available managed runner names; it performs no network
probe or image pull. The actions require an authenticated Sync connection and
work without starting CI. Existing maintenance locks can temporarily block an
action. Checks do not create pipelines, change configuration, restart services,
prune caches or delete images.

## Check a registry connection

Choose the configured GitLab registry or the configured helper-image registry,
then press **Check connection**. Targets come from saved server configuration,
never from an arbitrary browser URL. The scheme and explicit port are retained.
For an HTTP GitLab registry without an explicit port, the generated GitLab
listener uses port 5050. The helper registry uses the configured GitLab scheme
when it is the same registry; otherwise its controller probe uses HTTPS. The
daemon may have its own insecure-registry settings, which this probe does not infer.

The result identifies the **Sync controller process network**. DNS uses the
server's resolver and hosts file. Subsequent stages test the first resolved
address, retaining the original hostname for HTTP and TLS. Other addresses are
not checked. These observations do not establish connectivity from the browser,
a runner container, a CI job, or the Docker daemon. Private configured registry
addresses are supported; a blanket private-address prohibition would prevent
normal local installations.

| Check | What a successful result establishes | Limit |
| --- | --- | --- |
| DNS | The controller's resolver returned an address. | Other networks can resolve differently. |
| TCP | A connection reached that address and configured port. | A timeout does not establish a ban or missing image. |
| TLS | The certificate chain and hostname pass the controller trust checks. | Docker may have different trust configuration. HTTP targets skip TLS. |
| Registry HTTP | The endpoint returned the expected registry response at `/v2/`. | Credentials, authorization and image existence remain unverified. |

A failed stage marks dependent stages **not checked**, with zero duration.
Durations describe the observed stages. An expected HTTP 401 authentication
challenge is a successful reachability result; it does not authenticate the
runner. A 200 response must also identify the registry API. Other HTTP statuses,
including redirects and a 401 without a recognized challenge, are shown as
separate response facts. Redirects are never followed. Bodies, authentication
challenges, tokens, certificate keys and raw server errors are not returned.

## Try the exact helper-image pull

**Try helper-image pull** is a separate action. Select a running managed runner
manager first. The dialog shows the exact immutable helper-image reference before
the action. Its default comes from `gitlab/security-release.json`; operators can
set `GITLAB_RUNNER_HELPER_IMAGE` in server configuration. The image must retain an
explicit SHA-256 digest. A client cannot submit another image or Docker endpoint.

Sync inspects the selected manager and its registration. The supported managed
runner pools bind the host socket `/var/run/docker.sock`; Sync verifies that bind
and the runner Docker host setting before asking that actual host daemon to pull.
It also requires exactly one Docker registration and a helper-image reference
matching the configured image. A stopped manager, changed helper reference, remote
Docker endpoint, ambiguous configuration or unsupported Docker credential/host
environment fails closed. An operator must review that configuration; the feature
does not silently substitute the controller daemon for a different runner daemon.

The helper pull is anonymous and does not test runner-specific credentials.
Credential overrides require separate operator verification. Success confirms
that this daemon completed this exact helper pull; it does not prove CI startup,
job networking, authentication to another registry, or availability of another
image. A successful controller HTTP check and a failed daemon pull can both be
accurate. Pull errors are fixed safe labels rather than raw daemon output; they
do not establish an IP ban, credential error or unavailable digest by themselves.

**The pull may download layers and use disk/cache space on the selected daemon.**
Existing layers may be reused. Nothing is pruned or deleted. If the request times
out or its output exceeds the limit, the daemon may continue its work and retain
partially downloaded layers. Inspect daemon state before another attempt.

## Limits and reproducible verification

Sync allows at most two concurrent diagnostic requests, including target
inspection, and one pull request at a time. Each DNS, TCP, TLS and HTTP stage has
a three-second deadline. Docker metadata reads have a three-second deadline and
a 256 KiB output limit. Pull observation stops after 45 seconds or 1 MiB of output;
an individual stream record is limited to 64 KiB. HTTP response headers are
limited to 16 KiB and bodies are discarded. At most 100 available manager names
are returned. No diagnostic result is saved on disk or retained by Sync; responses
use `Cache-Control: no-store`, and the Wizard retains only its current results
until the dialog closes. The request limit bounds observations, not a daemon
operation that continues after a disconnected client.

From a checkout with the documented Node runtime and Sync dependencies installed,
run the controlled fixture suite:

```sh
npm --prefix sync run build
node --test tests/sync/system-diagnostics.js
```

The suite covers authentication, permitted targets, ordered failures, skipped
stages, registry challenges, HTTP redirects, the runner's socket and image
identity, configuration drift, redaction, concurrency, output limits and timeouts.
It includes successful HTTP connectivity followed by a failed daemon pull. Its
fixtures use local listeners and an isolated fake Docker socket; no real image
pull or running platform is required.
