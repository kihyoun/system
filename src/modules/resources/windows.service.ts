import { Injectable } from '@nestjs/common';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ObservationProcess } from './process';
import {
  CollectionOptions,
  ResourceSample,
  limitations,
  number,
  summary,
  timestamp,
  validateOptions,
} from './collector.service';
@Injectable()
export class WindowsResourceService {
  constructor(readonly transport = new ObservationProcess()) {}

  private async cim(
    className: string,
    fields: string[],
    filter: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>[]> {
    const command = `Get-CimInstance ${className} ${filter ? '-Filter "' + filter + '" ' : ''}-OperationTimeoutSec 3 | Select-Object ${fields.join(',')} | ConvertTo-Json -Compress`;
    const parsed: unknown = JSON.parse(
      await this.transport.run(
        ['pwsh', '-NoProfile', '-NonInteractive', '-Command', command],
        4000,
        signal,
      ),
    );
    const rows = Array.isArray(parsed) ? parsed : [parsed];

    if (rows.some((row) => !row || typeof row !== 'object')) {
      throw Error('windows-metric-unavailable');
    }

    return rows as Record<string, unknown>[];
  }

  async sample(signal?: AbortSignal) {
    const unavailable: string[] = [];
    let memory: unknown = null,
      logicalCpus: number | null = null,
      cpu: number | null = null,
      pageFile: unknown = null;
    const volumes: Record<string, unknown>[] = [];
    try {
      const [os] = await this.cim(
          'Win32_OperatingSystem',
          ['TotalVisibleMemorySize', 'FreePhysicalMemory'],
          '',
          signal,
        ),
        [machine] = await this.cim(
          'Win32_ComputerSystem',
          ['NumberOfLogicalProcessors'],
          '',
          signal,
        );
      memory = {
        totalBytes: scaled(os.TotalVisibleMemorySize, 1024),
        availableBytes: scaled(os.FreePhysicalMemory, 1024),
      };
      logicalCpus = number(machine.NumberOfLogicalProcessors);
    } catch {
      signal?.throwIfAborted();
      unavailable.push('windows-memory:unavailable');
    }
    try {
      const [row] = await this.cim(
        'Win32_PerfFormattedData_PerfOS_Processor',
        ['PercentProcessorTime'],
        "Name='_Total'",
        signal,
      );
      cpu = number(row.PercentProcessorTime);
    } catch {
      signal?.throwIfAborted();
      unavailable.push('windows-cpu:unavailable');
    }
    try {
      const rows = await this.cim(
        'Win32_PageFileUsage',
        ['AllocatedBaseSize', 'CurrentUsage', 'PeakUsage'],
        '',
        signal,
      );
      const total = (field: string) => {
        const values = rows.map((row) => number(row[field]));
        return values.some((value) => value === null)
          ? null
          : (values as number[]).reduce((a, b) => a + b, 0) * 1024 ** 2;
      };
      pageFile = {
        allocatedBytes: total('AllocatedBaseSize'),
        currentUsageBytes: total('CurrentUsage'),
        peakUsageBytesSinceBoot: total('PeakUsage'),
      };
    } catch {
      signal?.throwIfAborted();
      unavailable.push('windows-pagefile:unavailable');
    }
    for (const volume of ['C:', 'E:']) {
      try {
        const [row] = await this.cim(
          'Win32_LogicalDisk',
          ['Size', 'FreeSpace'],
          `DeviceID='${volume}'`,
          signal,
        );
        volumes.push({
          volume,
          capacityBytes: number(row.Size),
          availableBytes: number(row.FreeSpace),
        });
      } catch {
        signal?.throwIfAborted();
        unavailable.push('windows-volume-' + volume[0] + ':unavailable');
      }
    }
    return {
      observedAt: timestamp(),
      logicalCpus,
      memory,
      cpuPercentTotal: cpu,
      pageFile,
      physicalVolumes: volumes,
      unavailable,
    };
  }

  async collect(
    options: CollectionOptions & { distribution: string; backingVolume: string; linuxNode: string },
    signal?: AbortSignal,
  ) {
    validateOptions(options);

    if (
      !['C:', 'E:'].includes(options.backingVolume) ||
      !options.distribution ||
      /[\0\r\n]/.test(options.distribution)
    ) {
      throw Error('invalid-windows-resource-options');
    }

    const run = (args: string[], timeout: number) =>
      this.transport.run(['wsl.exe', ...args], timeout, signal);
    const running = (await run(['--list', '--running', '--quiet'], 5000))
      .replace(/\0/g, '')
      .split(/\r?\n/)
      .map((value) => value.trim());

    if (!running.includes(options.distribution)) {
      throw Error('requested-wsl-distribution-not-running');
    }

    const prefix = ['-d', options.distribution, '-u', 'root', '--exec'];
    const entry = (
      await run(
        [...prefix, 'wslpath', '-u', '-a', path.resolve(__dirname, 'entry.js').replace(/\\/g, '/')],
        5000,
      )
    ).trim();
    const samples: ResourceSample[] = [];
    let previous: { total: number; idle: number } | null = null;
    for (let index = 0; index < options.samples; index++) {
      const windows = await this.sample(signal),
        raw = JSON.parse(
          await run(
            [
              ...prefix,
              options.linuxNode,
              entry,
              'collect',
              '--samples',
              '1',
              '--budget',
              String(options.budget),
              '--max-containers',
              String(options.maxContainers),
            ],
            (options.budget + 8) * 1000,
          ),
        ) as { schemaVersion: number; samples: ResourceSample[] };

      if (raw.schemaVersion !== 1 || raw.samples?.length !== 1) {
        throw Error('invalid-linux-resource-response');
      }

      const sample = raw.samples[0],
        ticks = sample.linux.cpuTicksCounters;

      if (previous && ticks && ticks.total > previous.total) {
        sample.linux.cpuPercentTotalSincePreviousSample =
          Math.round(10000 * (1 - (ticks.idle - previous.idle) / (ticks.total - previous.total))) /
          100;
      }

      previous = ticks || null;
      sample.windows = windows;
      samples.push(sample);

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
      wslBackingPhysicalVolumeOperatorSupplied: options.backingVolume,
      samples,
      summary: summary(samples),
      limitations: [
        ...limitations,
        'Windows and Linux observations are sequential, with their own timestamps.',
        'Windows page-file peak is since boot; Linux and container counters are cumulative.',
        'The WSL backing volume is an operator assertion; no VHD paths are collected.',
      ],
    };
  }
}
function scaled(value: unknown, factor: number) {
  const parsed = number(value);
  return parsed === null ? null : parsed * factor;
}
