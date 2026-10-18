# Passive resource observation

This is the first measurement tool for [System issue 26](https://github.com/kihyoun/system/issues/26).
It observes an already running system. It does not start workloads, containers,
WSL distributions, pipelines, bootstrap operations or deployments. Python 3.9+
and, for the Windows wrapper, PowerShell 7+ are required. No packages are installed.

The [native Linux capacity report](native-2026-10-18.md) connects timestamped
observations to actual CI job queue/execution data, storage reserves and current
VM comparisons. The separate `benchmark-native.py` workload driver requires an
explicit coordinator lease and `--execute`; it is not part of passive collection
or the automatic offline test suite. Its cold/warm procedure and cleanup limits
are documented in that report.

## Run

On Windows with Ubuntu already running and Docker accessible there:

```powershell
./tests/performance/resources/collect-windows.ps1 -Samples 3 -Interval 2 `
  -WslBackingVolume E: -Output "$env:TEMP/system-resource-observation.json"
```

Choose a new output filename; reports are never overwritten. The backing-volume
argument is an operator assertion, not automatic discovery. The wrapper refuses
to start a stopped distribution, uses WSL root for read-only metrics, and samples
physical Windows C: and E: separately from the virtual Linux root filesystem.
Windows CIM observations precede each Linux sample and have separate timestamps.

On native Linux, or inside WSL when Windows metrics are not needed:

```sh
python3 tests/performance/resources/collect.py --samples 3 --interval 2 --output /tmp/system-resources.json
```

The caller needs permission to read Docker metrics; do not change socket permissions
to run this tool. Missing metrics are reported rather than replaced with zeros.
Python subprocesses have a three-second timeout within a per-sample budget
(default twelve seconds). Inventory is capped at 32 containers, configurable to
128. Sample count is bounded to 30. The interval is a delay **after** a sample,
not a fixed sampling frequency. Windows CIM calls each have a three-second
operation timeout; the wrapper's WSL subprocess also has an outer timeout.
At most two million stdout bytes are retained; exceeding two million combined
stdout/stderr bytes triggers cleanup while reading. A timed-out or cancelled
Linux transport is terminated as its own
process group, with bounded TERM/KILL cleanup; native Windows offline fixtures
use only the recorded child PID/tree. Cleanup can add up to about two seconds
outside the sampling budget. No process-name matching or service shutdown is
used.

## Report interpretation and privacy

The JSON separates Windows physical RAM/page file/CPU/disks, Linux RAM/swap/CPU/
block-device counters/root filesystem, Docker engine capacity and containers.
Container IDs are pseudonyms; roles are heuristic and unknown names become
`other`. Immutable image configuration digests identify the images without
publishing registry paths. Stopped containers remain visible for exit/OOM history.
No environment variables, credentials, hostnames, raw container names, process
arguments, logs, mounts or private paths are emitted. Errors are enumerated codes.
Review any report before sharing: image digests and resource topology remain
potentially sensitive operational metadata. This is an allowlisted report, not a
general-purpose secret detector for other files.

Linux host memory uses total minus available. Docker CLI Linux memory subtracts
cache and is rounded; cgroup v2 `memory.current` includes cache. Neither should be
added to host memory: that would double-count. Direct cgroup metrics are collected
only when the daemon PID's cgroup contains the exact container ID; remote/Desktop
PID namespaces otherwise yield `null`. Peak memory and OOM counters describe
cgroup lifetime, not just the sample window. Compare counters across matching
identities and timestamps to detect changes; do not infer an OOM from a historic
`OOMKilled` flag alone. CPU CLI percent uses one core as 100%, whereas Linux host
CPU percent covers all logical cores. Disk counters are cumulative, overlap across
layers and must not be summed. A Linux virtual disk with hundreds of GiB free
does not establish free space on its physical Windows backing volume.

The runner probe uses a fixed read-only `docker exec`/`awk` command and parses
only numeric `concurrent`, `limit` and `request_concurrency` assignments. The last
setting controls request polling, not execution concurrency. Missing assignments
are empty arrays, not inferred defaults. GitLab's embedded services/registry share
one container; Sync normally shares the controller. Their individual memory
cannot be derived from container totals.
Role maxima are `null` when any observed container in that role lacks a memory
value in any sample. `roleMemoryCoverage` records observed/measured container
samples and incomplete samples; missing memory is never silently treated as zero.

Official metric references: [Docker stats](https://docs.docker.com/reference/cli/docker/container/stats/),
[Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html),
[GitLab Runner configuration](https://docs.gitlab.com/runner/configuration/advanced-configuration/).

## Offline verification

```sh
python3 -m unittest discover -s tests/performance/resources -p test_collect.py -v
```

Fixtures cover memory units, invalid numeric values, sanitized output, bounded
inventory, timestamps, timeout/error redaction, remote-PID refusal, runner
settings, incomplete role coverage, bounded output, timeout descendants and
cancellation. They invoke no Docker or WSL commands and spawn only short-lived
synthetic Python processes, never infrastructure workloads. The Windows wrapper
requires a real Windows/WSL smoke check to validate its platform integration.

## Gates still required before VM sizing

The collector always reports `productionSizingReady: false`. A passive window
does not establish idle usage, build peaks, adequate memory or safe concurrency.
The following runs require separate coordinator approval and isolated ownership:

| Observation | Required evidence |
| --- | --- |
| Quiet baseline and startup | Known background activity, service readiness, repeated startup peak and OOM deltas |
| Cold and warm build | Exact source/image revisions, named cache state, timestamps and measured memory/CPU/IO peaks |
| One full pipeline | Queue time versus execution, required jobs/artifacts and persistent storage growth |
| Parallel pipelines | Declared runner limits, controlled concurrency, resource contention and failure/OOM checks |
| Retention window | Image/cache/artifact growth, backup reserve and explicit retention assumptions |
| Native Linux transfer | Repeat representative work on comparable x86 Linux; WSL results alone are insufficient |

Record source revision and cache/workload labels alongside sanitized reports.
Do not dump GitLab configuration or credentials to enrich a report. Choose RAM
and disk reserves after repeated workload peaks and retention measurements;
include OS/GitLab variability and shared-vCPU contention. No automatic procurement
or infrastructure changes are part of this tool.

## Hetzner comparison snapshot (checked 2026-10-17)

These are comparison candidates, **not sizing recommendations**. The official
[cost-optimized overview](https://www.hetzner.com/cloud/cost-optimized/) lists:

| Shared x86 plan | vCPU | RAM | NVMe storage | EUR monthly cap, Germany/Finland |
| --- | ---: | ---: | ---: | ---: |
| CX33 | 4 | 8 GB | 80 GB | 8.49 |
| CX43 | 8 | 16 GB | 160 GB | 15.99 |
| CX53 | 16 | 32 GB | 320 GB | 29.49 |

Prices come from Hetzner's official
[15 June 2026 adjustment table](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/),
excluding VAT and IPv4. Backups, additional storage and other extras are excluded.
Availability and current checkout pricing must be checked again before purchase.
Shared vCPU counts are not dedicated CPU throughput guarantees. Compare dedicated
CPU plans as well if controlled pipeline measurements reveal sustained CPU
contention. The present passive WSL observation cannot select any of these plans.
