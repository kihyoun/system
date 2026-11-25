import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ObservationFailure, ObservationProcess } from './process';
export const timestamp = () => new Date().toISOString();
export function number(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    return null;
  }

  if (
    typeof value === 'string' &&
    !/^[+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[+-]?[0-9]+)?$/i.test(value.trim())
  ) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
export function quantity(value: unknown): number | null {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\s*$/.exec(
    String(value),
  );

  if (!match) {
    return null;
  }

  const units: Record<string, number> = {
    B: 1,
    kB: 1000,
    KB: 1000,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
  };
  return number(Math.round(Number(match[1]) * units[match[2]]));
}
export function pair(value: unknown): (number | null)[] {
  const parts = String(value).split('/');
  return parts.length === 2 ? parts.map(quantity) : [null, null];
}
function numericFile(file: string): number | null {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    return /^\d+$/.test(text) ? number(text) : null;
  } catch {
    return null;
  }
}
function counters(file: string): Record<string, number> {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line) => {
          const parts = line.trim().split(/\s+/);
          return /^\d+$/.test(parts[1] || '')
            ? [[parts[0].replace(/:$/, ''), Number(parts[1])]]
            : [];
        }),
    );
  } catch {
    return {};
  }
}
export function role(value: unknown): string {
  const name = String(value).toLowerCase().replace(/^\//, '');

  if (name.startsWith('runner-') && name.includes('-project-')) {
    return 'ci-job';
  }

  if (name.includes('buildkit')) {
    return 'build-cache-worker';
  }

  if (name.includes('runner')) {
    return 'runner-manager';
  }

  for (const [fragment, result] of [
    ['gitlab', 'gitlab'],
    ['registry', 'registry'],
    ['bootstrapper', 'controller'],
    ['wizard', 'wizard'],
    ['nginx', 'nginx'],
    ['_sync_', 'sync-proxy'],
    ['_web_', 'nginx'],
  ]) {
    if (name.includes(fragment)) {
      return result;
    }
  }
  return 'other';
}
export function runnerSettings(text: string): Record<string, number[]> {
  const result: Record<string, number[]> = { concurrent: [], limit: [], request_concurrency: [] };
  for (const line of text.split('\n')) {
    const match = /^\s*(concurrent|limit|request_concurrency)\s*=\s*([0-9]+)\s*(?:#.*)?$/.exec(
      line,
    );

    if (match) {
      result[match[1]].push(Number(match[2]));
    }
  }
  return result;
}
export interface LinuxMetrics {
  memoryUsedFromAvailableBytes: number | null;
  cpuTicksCounters?: { total: number; idle: number } | null;
  cpuPercentTotalSincePreviousSample?: number | null;
  [key: string]: unknown;
}
export interface ContainerMetrics {
  id: string;
  role: string;
  dockerCli: { memoryUsageExcludingCacheBytesApprox: number | null; [key: string]: unknown };
  [key: string]: unknown;
}
export interface ResourceSample {
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  linux: LinuxMetrics;
  docker: Record<string, unknown> | null;
  containers: ContainerMetrics[];
  inventoryTruncated: boolean;
  unavailable: string[];
  windows?: unknown;
}
export interface CollectionOptions {
  samples: number;
  interval: number;
  budget: number;
  maxContainers: number;
  output?: string;
}
export function validateOptions(value: CollectionOptions): void {
  if (
    !Number.isInteger(value.samples) ||
    value.samples < 1 ||
    value.samples > 30 ||
    !Number.isFinite(value.interval) ||
    value.interval < 1 ||
    value.interval > 60 ||
    !Number.isFinite(value.budget) ||
    value.budget < 3 ||
    value.budget > 30 ||
    !Number.isInteger(value.maxContainers) ||
    value.maxContainers < 1 ||
    value.maxContainers > 128
  ) {
    throw Error('resource-options-out-of-bounds');
  }
}
export const limitations = [
  'No workload was started; background activity is not classified as idle.',
  'Docker CLI memory excludes cache on Linux and is rounded; cgroup memory.current includes cache.',
  'Cgroup peak/OOM counters predate this observation; cgroup paths are never reported.',
  'Guest df capacity is not physical Windows backing-volume capacity.',
  'Registry is normally embedded in GitLab; Sync normally shares the controller container.',
  'No logs, credentials, environment variables, command lines or raw inspect data are reported.',
];
export function summary(samples: ResourceSample[]) {
  const host = samples.flatMap((sample) =>
    sample.linux.memoryUsedFromAvailableBytes === null
      ? []
      : [sample.linux.memoryUsedFromAvailableBytes],
  );
  const roles: Record<string, number | null> = {},
    coverage: Record<
      string,
      { containerObservations: number; measuredObservations: number; incompleteSamples: number }
    > = {};
  for (const sample of samples) {
    for (const category of new Set(sample.containers.map((row) => row.role))) {
      const values = sample.containers
          .filter((row) => row.role === category)
          .map((row) => row.dockerCli.memoryUsageExcludingCacheBytesApprox),
        measured = values.filter((value): value is number => value !== null),
        count = (coverage[category] ??= {
          containerObservations: 0,
          measuredObservations: 0,
          incompleteSamples: 0,
        });
      count.containerObservations += values.length;
      count.measuredObservations += measured.length;

      if (measured.length !== values.length) {
        count.incompleteSamples++;
        roles[category] = null;
      } else if (roles[category] !== null) {
        roles[category] = Math.max(
          roles[category] || 0,
          measured.reduce((a, b) => a + b, 0),
        );
      }
    }
  }
  return {
    sampledLinuxUsedMemoryMaximumBytes: host.length ? Math.max(...host) : null,
    sampledRoleWorkingSetMaximumBytesApprox: roles,
    roleMemoryCoverage: coverage,
    productionSizingReady: false,
    missingWorkloadEvidence: [
      'startup',
      'cold-build',
      'warm-build',
      'single-pipeline',
      'parallel-pipelines',
      'runner-queue-time',
      'retention-growth',
      'native-linux-transfer-validation',
    ],
  };
}
@Injectable()
export class ResourceCollectorService {
  deadline = 0;
  unavailable: string[] = [];
  previousCpu?: [number, number];
  constructor(
    readonly transport = new ObservationProcess(),
    readonly budget = 12,
    readonly maximumContainers = 32,
    readonly proc = '/proc',
    readonly cgroups = '/sys/fs/cgroup',
  ) {}

  async run(args: string[], metric: string, signal?: AbortSignal): Promise<string | null> {
    const remaining = this.deadline - performance.now();

    if (remaining <= 0) {
      this.unavailable.push(metric + ':sample-budget');
      return null;
    }

    try {
      return await this.transport.run(args, Math.min(3000, remaining), signal);
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      this.unavailable.push(
        metric + ':' + (error instanceof ObservationFailure ? error.reason : 'command-unavailable'),
      );
      return null;
    }
  }

  async jsonCommand(
    args: string[],
    metric: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | null> {
    const text = await this.run(args, metric, signal);

    if (text === null) {
      return null;
    }

    try {
      const value: unknown = JSON.parse(text);

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw Error();
      }

      return value as Record<string, unknown>;
    } catch {
      this.unavailable.push(metric + ':invalid-response');
      return null;
    }
  }

  linux(): LinuxMetrics {
    const mem = counters(path.join(this.proc, 'meminfo')),
      vm = counters(path.join(this.proc, 'vmstat'));
    let cpu: number | null = null;
    try {
      const fields = fs
        .readFileSync(path.join(this.proc, 'stat'), 'utf8')
        .split('\n')[0]
        .trim()
        .split(/\s+/)
        .slice(1, 9)
        .map(Number);

      if (fields.length !== 8 || fields.some((value) => !Number.isFinite(value))) {
        throw Error();
      }

      const ticks = fields.reduce((a, b) => a + b, 0),
        idle = fields[3] + fields[4];

      if (this.previousCpu && ticks > this.previousCpu[0]) {
        cpu =
          Math.round(10000 * (1 - (idle - this.previousCpu[1]) / (ticks - this.previousCpu[0]))) /
          100;
      }

      this.previousCpu = [ticks, idle];
    } catch {
      this.unavailable.push('linux-cpu:proc-unavailable');
    }
    const root = fs.statfsSync('/'),
      disks: Record<string, unknown>[] = [];
    try {
      for (const line of fs.readFileSync(path.join(this.proc, 'diskstats'), 'utf8').split('\n')) {
        const fields = line.trim().split(/\s+/);

        if (fields.length >= 14 && /^(?:sd[a-z]+|vd[a-z]+|nvme[0-9]+n[0-9]+)$/.test(fields[2])) {
          disks.push({
            device: fields[2],
            readBytesCounter: Number(fields[5]) * 512,
            writtenBytesCounter: Number(fields[9]) * 512,
            ioMillisecondsCounter: Number(fields[12]),
          });
        }
      }
    } catch {
      this.unavailable.push('linux-disk-io:proc-unavailable');
    }
    return {
      architecture: os.arch() === 'x64' ? 'x86_64' : os.arch(),
      logicalCpus: os.cpus().length,
      virtualization: /microsoft/i.test(os.release()) ? 'wsl' : 'linux-unclassified',
      cpuPercentTotalSincePreviousSample: cpu,
      cpuTicksCounters: this.previousCpu
        ? { total: this.previousCpu[0], idle: this.previousCpu[1] }
        : null,
      memory: Object.fromEntries(
        [
          'MemTotal',
          'MemAvailable',
          'MemFree',
          'Cached',
          'SReclaimable',
          'SwapTotal',
          'SwapFree',
        ].map((key) => [key + 'Bytes', key in mem ? mem[key] * 1024 : null]),
      ),
      memoryUsedFromAvailableBytes:
        'MemTotal' in mem && 'MemAvailable' in mem
          ? (mem.MemTotal - mem.MemAvailable) * 1024
          : null,
      swapInPagesCounter: vm.pswpin ?? null,
      swapOutPagesCounter: vm.pswpout ?? null,
      oomKillCounter: vm.oom_kill ?? null,
      guestRootFilesystem: {
        capacityBytes: root.blocks * root.bsize,
        availableBytes: root.bavail * root.bsize,
      },
      diskIoCumulativeNotSummable: disks,
    };
  }

  cgroup(pid: unknown, id: string): Record<string, unknown> | null {
    if (!Number.isInteger(pid) || Number(pid) <= 0) {
      return null;
    }

    try {
      const line = fs
        .readFileSync(path.join(this.proc, String(pid), 'cgroup'), 'utf8')
        .split('\n')
        .find(
          (value) =>
            value.startsWith('0::') &&
            new RegExp('(?:^|[^a-f0-9])' + id + '(?:[^a-f0-9]|$)').test(value),
        );

      if (!line) {
        return null;
      }

      const root = fs.realpathSync(this.cgroups),
        location = fs.realpathSync(path.join(root, line.slice(3).replace(/^\//, '')));

      if (!location.startsWith(root + path.sep)) {
        return null;
      }

      const memory = counters(path.join(location, 'memory.stat'));
      return {
        version: 2,
        memoryCurrentBytes: numericFile(path.join(location, 'memory.current')),
        memoryPeakBytesSinceCgroupCreation: numericFile(path.join(location, 'memory.peak')),
        memoryMaxBytes: numericFile(path.join(location, 'memory.max')),
        swapCurrentBytes: numericFile(path.join(location, 'memory.swap.current')),
        memoryEventsCounters: counters(path.join(location, 'memory.events')),
        memoryBreakdownBytes: Object.fromEntries(
          ['anon', 'file', 'inactive_file', 'slab'].map((key) => [key, memory[key] ?? null]),
        ),
        cpuCounters: counters(path.join(location, 'cpu.stat')),
      };
    } catch {
      return null;
    }
  }

  async sample(signal?: AbortSignal): Promise<ResourceSample> {
    signal?.throwIfAborted();
    const start = performance.now(),
      startedAt = timestamp();
    this.deadline = start + this.budget * 1000;
    this.unavailable = [];
    const host = this.linux();
    const rawDocker = await this.jsonCommand(
      [
        'docker',
        'info',
        '--format',
        '{"serverVersion":{{json .ServerVersion}},"architecture":{{json .Architecture}},"logicalCpus":{{json .NCPU}},"memoryTotalBytes":{{json .MemTotal}},"cgroupVersion":{{json .CgroupVersion}}}',
      ],
      'docker-info',
      signal,
    );
    const docker = rawDocker
      ? {
          ...Object.fromEntries(
            ['serverVersion', 'architecture', 'cgroupVersion'].map((key) => [
              key,
              /^[A-Za-z0-9_.+-]{1,48}$/.test(String(rawDocker[key]))
                ? String(rawDocker[key])
                : null,
            ]),
          ),
          logicalCpus: number(rawDocker.logicalCpus),
          memoryTotalBytes: number(rawDocker.memoryTotalBytes),
        }
      : null;
    const statsText = await this.run(
        ['docker', 'stats', '--no-stream', '--no-trunc', '--format', '{{json .}}'],
        'docker-stats',
        signal,
      ),
      statistics: Record<string, Record<string, unknown>> = {};

    if (statsText) {
      try {
        for (const line of statsText.trim().split('\n')) {
          const row = JSON.parse(line) as Record<string, unknown>;

          if (/^[a-f0-9]{64}$/.test(String(row.ID))) {
            statistics[String(row.ID)] = row;
          }
        }
      } catch {
        this.unavailable.push('docker-stats:invalid-response');
      }
    }

    const ids = (
        (await this.run(
          ['docker', 'ps', '--all', '--quiet', '--no-trunc'],
          'docker-inventory',
          signal,
        )) || ''
      )
        .split('\n')
        .filter((id) => /^[a-f0-9]{64}$/.test(id)),
      containers: ContainerMetrics[] = [];
    const format =
      '{"name":{{json .Name}},"pid":{{json .State.Pid}},"imageConfigDigest":{{json .Image}},"memoryLimitBytes":{{json .HostConfig.Memory}},"memorySwapLimitBytes":{{json .HostConfig.MemorySwap}},"nanoCpuLimit":{{json .HostConfig.NanoCpus}},"oomKilled":{{json .State.OOMKilled}},"running":{{json .State.Running}},"restartCount":{{json .RestartCount}},"exitCode":{{json .State.ExitCode}}}';
    for (const id of ids.slice(0, this.maximumContainers)) {
      const raw = await this.jsonCommand(
        ['docker', 'inspect', '--format', format, id],
        'container-inspect',
        signal,
      );

      if (!raw) {
        continue;
      }

      const category = role(raw.name),
        stat = statistics[id] || {},
        memory = pair(stat.MemUsage);
      const row: ContainerMetrics = {
        id: 'container-' + createHash('sha256').update(id).digest('hex').slice(0, 12),
        role: category,
        running: typeof raw.running === 'boolean' ? raw.running : null,
        imageConfigDigest: /^sha256:[a-f0-9]{64}$/.test(String(raw.imageConfigDigest))
          ? raw.imageConfigDigest
          : null,
        oomKilled: typeof raw.oomKilled === 'boolean' ? raw.oomKilled : null,
        ...Object.fromEntries(
          [
            'memoryLimitBytes',
            'memorySwapLimitBytes',
            'nanoCpuLimit',
            'restartCount',
            'exitCode',
          ].map((key) => [key, number(raw[key])]),
        ),
        memorySwapUnlimited: raw.memorySwapLimitBytes === -1,
        dockerCli: {
          memoryUsageExcludingCacheBytesApprox: memory[0],
          memoryLimitBytesApprox: memory[1],
          cpuPercentOneCoreApprox: number(String(stat.CPUPerc || '').replace(/%$/, '')),
          pids: number(stat.PIDs),
          networkRxTxBytesApprox: pair(stat.NetIO),
          blockReadWriteBytesApprox: pair(stat.BlockIO),
        },
        cgroup: this.cgroup(raw.pid, id),
      };

      if (category === 'runner-manager' && raw.running) {
        const settings = await this.run(
          [
            'docker',
            'exec',
            id,
            'awk',
            '/^[[:space:]]*(concurrent|limit|request_concurrency)[[:space:]]*=[[:space:]]*[0-9]+[[:space:]]*(#.*)?$/ {sub(/#.*/, ""); print}',
            '/etc/gitlab-runner/config.toml',
          ],
          'runner-concurrency',
          signal,
        );
        row.runnerConcurrency = settings === null ? null : runnerSettings(settings);
      }

      containers.push(row);
    }
    return {
      startedAt,
      completedAt: timestamp(),
      durationSeconds: Math.round(performance.now() - start) / 1000,
      linux: host,
      docker,
      containers,
      inventoryTruncated: ids.length > this.maximumContainers,
      unavailable: [...new Set(this.unavailable)].sort(),
    };
  }

  async collect(options: CollectionOptions, signal?: AbortSignal) {
    validateOptions(options);
    const collector = new ResourceCollectorService(
        this.transport,
        options.budget,
        options.maxContainers,
        this.proc,
        this.cgroups,
      ),
      samples: ResourceSample[] = [];
    for (let index = 0; index < options.samples; index++) {
      samples.push(await collector.sample(signal));

      if (index + 1 < options.samples) {
        await delay(options.interval * 1000, undefined, { signal });
      }
    }
    return {
      schemaVersion: 1,
      kind: 'passive-resource-observation',
      createdAt: timestamp(),
      sampling: {
        count: options.samples,
        delayAfterSampleSeconds: options.interval,
        sampleBudgetSeconds: options.budget,
        maxContainers: options.maxContainers,
      },
      samples,
      summary: summary(samples),
      limitations,
    };
  }
}
