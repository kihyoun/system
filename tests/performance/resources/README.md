# Passive resource observation

The collector observes an already running system. It does not start workloads,
containers, WSL distributions, pipelines, bootstrap operations or deployments.
Python 3.9+ and, for the Windows wrapper, PowerShell 7+ are required. No packages
are installed.

`benchmark-native.py` is a separate explicit workload driver. It requires an
operator-selected resource window, a shared deadline and `--execute`; passive
collection and the automatic offline suite never invoke it.

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

## Capacity assessment

The collector always reports `productionSizingReady: false`. A passive window
does not establish idle usage, build peaks, adequate memory or safe concurrency.
Assess workload qualification separately with controlled runs:

| Observation | Evidence to retain |
| --- | --- |
| Quiet baseline and startup | Known background activity, readiness, repeated startup peak and OOM deltas |
| Cold and warm build | Exact source/image revisions, cache state, timestamps and memory/CPU/IO samples |
| Full pipeline | Queue time versus execution, required jobs/artifacts and storage changes |
| Overlapping pipelines | Declared runner limits, actual execution overlap, contention and OOM/failure checks |
| Retention | Image/cache/artifact growth, backup reserve and explicit retention assumptions |
| Host transfer | Representative work on the intended architecture and platform; WSL alone does not qualify native Linux |

Record source/cache/workload labels beside sanitized reports, without private
GitLab configuration. One submitted pipeline is not necessarily one running
workload; runner managers and `request_concurrency` do not directly define
execution concurrency. Measure queue time independently from execution and
verify overlap before describing a concurrency experiment as parallel.

Choose RAM/disk reserves from repeated peaks, retained-data growth and the
largest backup/export staging requirement. Account for GitLab background work,
OS reserve and shared-vCPU contention. The full disposable platform driver caps
one private daemon at 12 GiB/four CPUs; that is a ceiling, not a reservation or a
disk quota. Its host also needs capacity for existing services, job drivers,
archives, extraction and cleanup. Additional managers cannot provide capacity
the host does not have. No automatic procurement is part of these tools.

## Reproduce bounded native template builds

Use Linux amd64 with the local Docker socket, Buildx and Python available. Drain
competing heavy jobs and agree a resource window before execution. The driver
rejects remote Docker overrides. It supports the committed React and Angular
recipes only, verifies their pinned images and lockfile, rejects symlinks/private
input filenames, and records a public input manifest. Without `--execute`, it
prints the validated plan and starts no Docker workload.

Extract exact committed templates instead of assigning a commit ID to dirty
working-copy files:

```sh
export TASK_BENCHMARK_REVISION=$(git rev-parse HEAD)
export TASK_BENCHMARK_INPUTS=$(mktemp -d /tmp/system-resource-inputs.XXXXXXXX)
export TASK_BENCHMARK_OUTPUT=$(mktemp -d /tmp/system-resource-results.XXXXXXXX)
git archive --format=tar "$TASK_BENCHMARK_REVISION" project-bootstrap/templates |   tar -xf - -C "$TASK_BENCHMARK_INPUTS"
python3 tests/performance/resources/benchmark-native.py   --case react --templates "$TASK_BENCHMARK_INPUTS/project-bootstrap/templates"   --source-revision "$TASK_BENCHMARK_REVISION"   --output "$TASK_BENCHMARK_OUTPUT/react"
```

After reviewing that plan and checking host reserve, the following pair uses one
absolute ten-minute window. Each invocation creates its own new output directory;
do not reuse a directory from an interrupted attempt:

```sh
export TASK_BENCHMARK_DEADLINE=$(python3 -c 'import time; print(time.time() + 600)')
export SYSTEM_RESOURCE_BENCHMARK_APPROVED=1
timeout --signal=TERM --kill-after=45s 555s bash -e -c '
  python3 tests/performance/resources/benchmark-native.py     --case react --templates "$TASK_BENCHMARK_INPUTS/project-bootstrap/templates"     --source-revision "$TASK_BENCHMARK_REVISION"     --output "$TASK_BENCHMARK_OUTPUT/react" --execute     --lease-deadline-epoch "$TASK_BENCHMARK_DEADLINE"
  python3 tests/performance/resources/benchmark-native.py     --case angular --templates "$TASK_BENCHMARK_INPUTS/project-bootstrap/templates"     --source-revision "$TASK_BENCHMARK_REVISION"     --output "$TASK_BENCHMARK_OUTPUT/angular" --execute     --lease-deadline-epoch "$TASK_BENCHMARK_DEADLINE"
'
```

Each builder is capped at 4 GiB/two CPUs, followed by a 128-MiB/half-CPU static
HTTP candidate. Builds run sequentially; each phase has a four-minute command
bound and two-million-byte log limit. Both cases share the deadline and reserve
its final 60 seconds for cleanup. SIGTERM enters owned cleanup; SIGKILL or host
loss still requires inspecting the retained `operation.json` and exact owned
identities. Never use a global prune to recover an interrupted benchmark.

Cold means an empty fresh job-owned BuildKit cache, not an unconditioned network.
Warm retains dependency layers and changes a harmless source comment so the
application compiles again. Evidence distinguishes command wall time, sample
completion, cache labels and bounded build logs. The HTTP smoke proves static
serving, not full application/browser or unit-test acceptance. Samples can miss
brief peaks; one run per phase is not a timing distribution or a qualified
minimum-memory claim.
