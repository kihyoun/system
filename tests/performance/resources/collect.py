#!/usr/bin/env python3
"""Bounded passive resource samples; standard library, no load generation."""
import argparse
import datetime
import hashlib
import json
import os
import platform
import re
import signal
import subprocess
import threading
import time
from pathlib import Path


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def number(value):
    try:
        result = float(value)
        return result if result >= 0 and result < float('inf') else None
    except (TypeError, ValueError):
        return None


def quantity(value):
    match = re.fullmatch(r'\s*([0-9]+(?:\.[0-9]+)?)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\s*', str(value))
    if not match:
        return None
    scale = {'B': 1, 'kB': 1000, 'KB': 1000, 'MB': 10**6, 'GB': 10**9, 'TB': 10**12,
             'KiB': 1024, 'MiB': 1024**2, 'GiB': 1024**3, 'TiB': 1024**4}
    return round(float(match[1]) * scale[match[2]])


def pair(value):
    parts = str(value).split('/')
    return [quantity(part) for part in parts] if len(parts) == 2 else [None, None]


def numeric_file(filename):
    try:
        return int(Path(filename).read_text().strip())
    except (OSError, ValueError):
        return None


def counters(filename):
    try:
        return {parts[0].rstrip(':'): int(parts[1]) for line in Path(filename).read_text().splitlines()
                if len(parts := line.split()) >= 2 and parts[1].isdigit()}
    except OSError:
        return {}


def role(name):
    name = str(name).lower().lstrip('/')
    if name.startswith('runner-') and '-project-' in name:
        return 'ci-job'
    if 'buildkit' in name:
        return 'build-cache-worker'
    if 'runner' in name:
        return 'runner-manager'
    for fragment, result in [('gitlab', 'gitlab'), ('registry', 'registry'), ('bootstrapper', 'controller'),
                             ('wizard', 'wizard'), ('nginx', 'nginx'), ('_sync_', 'sync-proxy'), ('_web_', 'nginx')]:
        if fragment in name:
            return result
    return 'other'


def runner_settings(text):
    result = {key: [] for key in ['concurrent', 'limit', 'request_concurrency']}
    for line in text.splitlines():
        match = re.fullmatch(r'\s*(concurrent|limit|request_concurrency)\s*=\s*([0-9]+)\s*(?:#.*)?', line)
        if match:
            result[match[1]].append(int(match[2]))
    return result


class Collector:
    def __init__(self, budget=12, maximum_containers=32):
        self.budget, self.maximum_containers = budget, maximum_containers
        self.deadline = 0
        self.unavailable = []
        self.previous_cpu = None

    def run(self, args, metric):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            self.unavailable.append(metric + ':sample-budget')
            return None
        try:
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       bufsize=0, start_new_session=os.name != 'nt',
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        except OSError:
            # Never include command output, exception strings or private paths.
            self.unavailable.append(metric + ':command-unavailable')
            return None
        output = []
        total = 0
        exceeded = threading.Event()
        lock = threading.Lock()

        def read(stream, retain):
            nonlocal total
            try:
                while chunk := stream.read(65536):
                    with lock:
                        room = max(0, 2_000_000 - total)
                        total += len(chunk)
                        if retain and room:
                            output.append(chunk[:room])
                        if total > 2_000_000:
                            exceeded.set()
                            break
            except OSError:
                pass
            finally:
                stream.close()

        readers = [threading.Thread(target=read, args=(process.stdout, True), daemon=True),
                   threading.Thread(target=read, args=(process.stderr, False), daemon=True)]
        for reader in readers:
            reader.start()
        end = min(self.deadline, time.monotonic() + 3)
        reason = None
        try:
            while process.poll() is None or any(reader.is_alive() for reader in readers):
                if exceeded.is_set():
                    reason = 'output-limit'
                    break
                if time.monotonic() >= end:
                    reason = 'command-timeout'
                    break
                time.sleep(0.01)
        except BaseException:
            self.stop(process)
            for reader in readers:
                reader.join(timeout=0.1)
            raise
        if exceeded.is_set():
            reason = 'output-limit'
        if reason:
            self.stop(process)
        for reader in readers:
            reader.join(timeout=0.1)
        if reason or process.poll() != 0:
            self.unavailable.append(metric + ':' + (reason or 'command-unavailable'))
            return None
        return b''.join(output).decode('utf8', errors='replace').replace('\r\n', '\n').replace('\r', '\n')

    @staticmethod
    def stop(process):
        """Only the process/session created above is eligible for cleanup."""
        if os.name == 'nt':
            # Windows is an offline fixture host; production collection is Linux.
            # Do not match names or stop WSL/distributions/other workloads.
            try:
                subprocess.run([str(Path(os.environ['SystemRoot']) / 'System32' / 'taskkill.exe'),
                                '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=1, check=False,
                               creationflags=subprocess.CREATE_NO_WINDOW)
            except (OSError, KeyError, subprocess.TimeoutExpired):
                pass
        else:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(process.pid, sig)
                except ProcessLookupError:
                    break
                if sig == signal.SIGTERM:
                    time.sleep(0.1)
        try:
            process.wait(timeout=0.2)
        except subprocess.TimeoutExpired:
            pass

    def json_command(self, args, metric):
        text = self.run(args, metric)
        if text is None:
            return None
        try:
            return json.loads(text)
        except (ValueError, TypeError):
            self.unavailable.append(metric + ':invalid-response')
            return None

    def linux(self):
        mem = counters('/proc/meminfo')
        vm = counters('/proc/vmstat')
        cpu = None
        try:
            fields = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
            ticks = sum(fields)
            idle = fields[3] + fields[4]
            if self.previous_cpu:
                total_delta = ticks - self.previous_cpu[0]
                if total_delta > 0:
                    cpu = round(100 * (1 - (idle - self.previous_cpu[1]) / total_delta), 2)
            self.previous_cpu = (ticks, idle)
        except (OSError, ValueError, IndexError):
            self.unavailable.append('linux-cpu:proc-unavailable')
        root = os.statvfs('/')
        disk_io = []
        try:
            for line in Path('/proc/diskstats').read_text().splitlines():
                fields = line.split()
                if len(fields) >= 14 and re.fullmatch(r'(?:sd[a-z]+|vd[a-z]+|nvme[0-9]+n[0-9]+)', fields[2]):
                    disk_io.append({'device': fields[2], 'readBytesCounter': int(fields[5]) * 512,
                                    'writtenBytesCounter': int(fields[9]) * 512, 'ioMillisecondsCounter': int(fields[12])})
        except (OSError, ValueError):
            self.unavailable.append('linux-disk-io:proc-unavailable')
        return {'architecture': platform.machine(), 'logicalCpus': os.cpu_count(),
                'virtualization': 'wsl' if 'microsoft' in platform.release().lower() else 'linux-unclassified',
                'cpuPercentTotalSincePreviousSample': cpu,
                'cpuTicksCounters': {'total': self.previous_cpu[0], 'idle': self.previous_cpu[1]} if self.previous_cpu else None,
                'memory': {key + 'Bytes': mem.get(key, 0) * 1024 if key in mem else None
                           for key in ['MemTotal', 'MemAvailable', 'MemFree', 'Cached', 'SReclaimable', 'SwapTotal', 'SwapFree']},
                'memoryUsedFromAvailableBytes': (mem['MemTotal'] - mem['MemAvailable']) * 1024
                if 'MemTotal' in mem and 'MemAvailable' in mem else None,
                'swapInPagesCounter': vm.get('pswpin'), 'swapOutPagesCounter': vm.get('pswpout'),
                'oomKillCounter': vm.get('oom_kill'),
                'guestRootFilesystem': {'capacityBytes': root.f_blocks * root.f_frsize,
                                        'availableBytes': root.f_bavail * root.f_frsize},
                'diskIoCumulativeNotSummable': disk_io}

    def cgroup(self, pid, container_id):
        if not isinstance(pid, int) or pid <= 0:
            return None
        try:
            lines = Path('/proc/' + str(pid) + '/cgroup').read_text().splitlines()
            cg = next(line[3:] for line in lines if line.startswith('0::') and container_id in line)
            root = Path('/sys/fs/cgroup').resolve()
            location = (root / cg.lstrip('/')).resolve()
            if root not in location.parents:
                return None
            memory = counters(location / 'memory.stat')
            return {'version': 2, 'memoryCurrentBytes': numeric_file(location / 'memory.current'),
                    'memoryPeakBytesSinceCgroupCreation': numeric_file(location / 'memory.peak'),
                    'memoryMaxBytes': numeric_file(location / 'memory.max'),
                    'swapCurrentBytes': numeric_file(location / 'memory.swap.current'),
                    'memoryEventsCounters': counters(location / 'memory.events'),
                    'memoryBreakdownBytes': {key: memory.get(key) for key in ['anon', 'file', 'inactive_file', 'slab']},
                    'cpuCounters': counters(location / 'cpu.stat')}
        except (OSError, StopIteration):
            # Remote/Desktop daemon PIDs cannot be mapped to this /proc safely.
            return None

    def sample(self):
        start = time.monotonic()
        started_at = timestamp()
        self.deadline = start + self.budget
        self.unavailable = []
        host = self.linux()
        info_format = '{"serverVersion":{{json .ServerVersion}},"os":{{json .OperatingSystem}},"architecture":{{json .Architecture}},"logicalCpus":{{json .NCPU}},"memoryTotalBytes":{{json .MemTotal}},"cgroupVersion":{{json .CgroupVersion}}}'
        docker = self.json_command(['docker', 'info', '--format', info_format], 'docker-info')
        if isinstance(docker, dict):
            docker = {key: str(docker.get(key)) if re.fullmatch(r'[A-Za-z0-9_.+-]{1,48}', str(docker.get(key))) else None
                      for key in ['serverVersion', 'architecture', 'cgroupVersion']} | {
                          key: number(docker.get(key)) for key in ['logicalCpus', 'memoryTotalBytes']}
        else:
            docker = None
        stats_text = self.run(['docker', 'stats', '--no-stream', '--no-trunc', '--format', '{{json .}}'], 'docker-stats')
        statistics = {}
        if stats_text:
            try:
                for line in stats_text.splitlines():
                    row = json.loads(line)
                    if re.fullmatch('[a-f0-9]{64}', row.get('ID', '')):
                        statistics[row['ID']] = row
            except (ValueError, TypeError):
                self.unavailable.append('docker-stats:invalid-response')
        ids_text = self.run(['docker', 'ps', '--all', '--quiet', '--no-trunc'], 'docker-inventory')
        ids = [value for value in (ids_text or '').splitlines() if re.fullmatch('[a-f0-9]{64}', value)]
        truncated = len(ids) > self.maximum_containers
        containers = []
        inspect_format = '{"name":{{json .Name}},"pid":{{json .State.Pid}},"imageConfigDigest":{{json .Image}},"memoryLimitBytes":{{json .HostConfig.Memory}},"memorySwapLimitBytes":{{json .HostConfig.MemorySwap}},"nanoCpuLimit":{{json .HostConfig.NanoCpus}},"oomKilled":{{json .State.OOMKilled}},"running":{{json .State.Running}},"restartCount":{{json .RestartCount}},"exitCode":{{json .State.ExitCode}}}'
        for container_id in ids[:self.maximum_containers]:
            raw = self.json_command(['docker', 'inspect', '--format', inspect_format, container_id], 'container-inspect')
            if not isinstance(raw, dict):
                continue
            identity = 'container-' + hashlib.sha256(container_id.encode()).hexdigest()[:12]
            category = role(raw.get('name', ''))
            row = {'id': identity, 'role': category, 'running': raw.get('running') if isinstance(raw.get('running'), bool) else None,
                   'imageConfigDigest': raw.get('imageConfigDigest') if re.fullmatch(r'sha256:[a-f0-9]{64}', str(raw.get('imageConfigDigest'))) else None,
                   'oomKilled': raw.get('oomKilled') if isinstance(raw.get('oomKilled'), bool) else None,
                   **{key: number(raw.get(key)) for key in ['memoryLimitBytes', 'memorySwapLimitBytes', 'nanoCpuLimit', 'restartCount', 'exitCode']},
                   'memorySwapUnlimited': raw.get('memorySwapLimitBytes') == -1}
            stat = statistics.get(container_id, {})
            memory_used, memory_limit = pair(stat.get('MemUsage'))
            row['dockerCli'] = {'memoryUsageExcludingCacheBytesApprox': memory_used, 'memoryLimitBytesApprox': memory_limit,
                                'cpuPercentOneCoreApprox': number(str(stat.get('CPUPerc', '')).rstrip('%')),
                                'pids': number(stat.get('PIDs')), 'networkRxTxBytesApprox': pair(stat.get('NetIO')),
                                'blockReadWriteBytesApprox': pair(stat.get('BlockIO'))}
            row['cgroup'] = self.cgroup(raw.get('pid'), container_id)
            if category == 'runner-manager' and raw.get('running'):
                awk = "awk '/^[[:space:]]*(concurrent|limit|request_concurrency)[[:space:]]*=[[:space:]]*[0-9]+[[:space:]]*(#.*)?$/ {sub(/#.*/, \"\"); print}' /etc/gitlab-runner/config.toml"
                settings = self.run(['docker', 'exec', container_id, 'sh', '-c', awk], 'runner-concurrency')
                row['runnerConcurrency'] = runner_settings(settings) if settings is not None else None
            containers.append(row)
        return {'startedAt': started_at, 'completedAt': timestamp(), 'durationSeconds': round(time.monotonic() - start, 3), 'linux': host,
                'docker': docker, 'containers': containers, 'inventoryTruncated': truncated,
                'unavailable': sorted(set(self.unavailable))}


def summary(samples):
    host_usage = [sample['linux']['memoryUsedFromAvailableBytes'] for sample in samples
                  if sample['linux']['memoryUsedFromAvailableBytes'] is not None]
    roles = {}
    coverage = {}
    for sample in samples:
        for category in {row['role'] for row in sample['containers']}:
            values = [row['dockerCli']['memoryUsageExcludingCacheBytesApprox']
                      for row in sample['containers'] if row['role'] == category]
            measured = [value for value in values if value is not None]
            count = coverage.setdefault(category, {'containerObservations': 0, 'measuredObservations': 0,
                                                    'incompleteSamples': 0})
            count['containerObservations'] += len(values)
            count['measuredObservations'] += len(measured)
            if len(measured) != len(values):
                count['incompleteSamples'] += 1
                roles[category] = None
            elif category not in roles or roles[category] is not None:
                roles[category] = max(roles.get(category, 0), sum(measured))
    return {'sampledLinuxUsedMemoryMaximumBytes': max(host_usage) if host_usage else None,
            'sampledRoleWorkingSetMaximumBytesApprox': roles, 'roleMemoryCoverage': coverage,
            'productionSizingReady': False,
            'missingWorkloadEvidence': ['startup', 'cold-build', 'warm-build', 'single-pipeline', 'parallel-pipelines',
                                        'runner-queue-time', 'retention-growth', 'native-linux-transfer-validation']}


def main():
    # Propagate CLI cancellation through run()'s owned-process cleanup, rather
    # than letting the collector die while its detached transport keeps going.
    def cancel(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, cancel)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=3)
    parser.add_argument('--interval', type=float, default=2)
    parser.add_argument('--budget', type=float, default=12)
    parser.add_argument('--max-containers', type=int, default=32)
    parser.add_argument('--output', default='-')
    args = parser.parse_args()
    if not 1 <= args.samples <= 30 or not 1 <= args.interval <= 60 or not 3 <= args.budget <= 30 or not 1 <= args.max_containers <= 128:
        parser.error('Bounds: samples 1..30, interval 1..60, budget 3..30 seconds, max-containers 1..128')
    collector = Collector(args.budget, args.max_containers)
    samples = []
    for index in range(args.samples):
        samples.append(collector.sample())
        if index + 1 < args.samples:
            time.sleep(args.interval)
    report = {'schemaVersion': 1, 'kind': 'passive-resource-observation', 'createdAt': timestamp(),
              'sampling': {'count': args.samples, 'delayAfterSampleSeconds': args.interval, 'sampleBudgetSeconds': args.budget,
                           'maxContainers': args.max_containers}, 'samples': samples, 'summary': summary(samples),
              'limitations': ['No workload was started; background activity is not classified as idle.',
                              'Docker CLI memory excludes cache on Linux and is rounded; cgroup memory.current includes cache.',
                              'Cgroup peak/OOM counters predate this observation; cgroup paths are never reported.',
                              'Guest df capacity is not physical Windows backing-volume capacity.',
                              'Registry is normally embedded in GitLab; Sync normally shares the controller container.',
                              'No logs, credentials, environment variables, command lines or raw inspect data are reported.']}
    text = json.dumps(report, indent=2) + '\n'
    if args.output == '-':
        print(text, end='')
    else:
        with open(args.output, 'x', encoding='utf8') as destination:
            destination.write(text)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit('Resource collection cancelled.')
