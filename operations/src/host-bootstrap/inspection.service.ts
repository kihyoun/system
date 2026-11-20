import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ManagedChildProcess, type LifecycleProcess } from '../runtime/managed-child';
import { ProcessFailure } from '../runtime/process';
import {
  assess,
  hostFacts,
  InspectionInputError,
  logPolicy,
  version,
  type HostFacts,
  type LogPolicy,
} from './inspection-policy';
export interface Probe {
  code: string;
  exitCode?: number | null;
  mongodbVersion?: string;
}
export interface PreflightOptions {
  mongodbVersion: string;
  image?: string;
  timeout?: number;
  plannedKernel?: string;
}
const socket = ['--host', 'unix:///var/run/docker.sock'];
function optional(filename: string): string {
  try {
    return fs.readFileSync(filename, 'utf8').trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}
@Injectable()
export class HostInspectionService {
  constructor(readonly process: LifecycleProcess = new ManagedChildProcess()) {}
  facts(): HostFacts {
    return hostFacts(
      os.release(),
      optional('/proc/version_signature'),
      optional('/proc/cpuinfo'),
      os.machine(),
      /^ID=["']?ubuntu["']?$/m.test(optional('/etc/os-release')),
    );
  }
  async preflight(input: PreflightOptions, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
    const mongo = version(input.mongodbVersion),
      timeout = input.timeout ?? 30;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120)
      throw new InspectionInputError('Probe timeout must be from 1 to 120 seconds.');
    if (
      os.platform() !== 'linux' ||
      (env.DOCKER_HOST ?? 'unix:///var/run/docker.sock') !== 'unix:///var/run/docker.sock' ||
      (env.DOCKER_CONTEXT ?? 'default') !== 'default'
    )
      throw new InspectionInputError(
        'Run on the Linux Docker daemon host using the local Unix socket, without a remote Docker context.',
      );
    const facts = this.facts();
    if (input.plannedKernel) {
      version(input.plannedKernel);
      if (input.image)
        throw new InspectionInputError(
          'A running image cannot test a planned kernel. Boot and check the selected daemon host separately.',
        );
      facts.upstreamKernel = input.plannedKernel;
      facts.kernelVersionSource = 'operator-planned-upstream';
    }
    const findings = assess(facts, mongo);
    let probe: Probe | undefined;
    if (input.image && !findings.length) {
      probe = await this.probe(input.image, timeout, env, signal);
      if (probe.mongodbVersion && probe.mongodbVersion !== input.mongodbVersion)
        findings.push({
          code: 'image-version-mismatch',
          message: 'The executable version differs from the selected MongoDB version.',
        });
      if (probe.code !== 'image-probe-passed')
        findings.push({
          code: probe.code,
          message: 'Exact image execution failed; see probe diagnosis.',
        });
    }
    return {
      schemaVersion: 1,
      host: facts,
      mongodbVersion: input.mongodbVersion,
      scope: input.plannedKernel ? 'planned-kernel' : 'current-host',
      findings,
      ...(probe ? { image: input.image, probe } : {}),
      ok: !findings.length,
    };
  }
  async probe(
    image: string,
    timeout: number,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<Probe> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*@sha256:[a-f0-9]{64}$/.test(image) || /[\r\n]/.test(image))
      throw new InspectionInputError(
        'Probe requires an immutable IMAGE@sha256:<64 lowercase hex> reference, already pulled on the daemon host.',
      );
    const name = 'system-compatibility-' + randomUUID().replaceAll('-', ''),
      label = 'com.system-bootstrapper.compatibility-preflight';
    let output = '',
      exitCode: number | null = 0;
    const timer = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      timer.abort();
    }, timeout * 1000);
    try {
      try {
        const stdout = await this.process.run(
          'docker',
          [
            ...socket,
            'run',
            '--pull',
            'never',
            '--rm',
            '--name',
            name,
            '--label',
            label + '=' + name,
            '--network',
            'none',
            '--read-only',
            '--cap-drop',
            'ALL',
            '--security-opt',
            'no-new-privileges',
            '--memory',
            '512m',
            '--cpus',
            '1',
            '--pids-limit',
            '64',
            '--log-driver',
            'none',
            '--tmpfs',
            '/tmp:rw,noexec,nosuid,size=16m',
            '--entrypoint',
            'mongod',
            image,
            '--version',
          ],
          {
            cwd: '/',
            env,
            signal: signal ? AbortSignal.any([signal, timer.signal]) : timer.signal,
            timeout: null,
            maxBuffer: 65536,
            output: (chunk) => {
              output = (output + chunk.toString()).slice(0, 65536);
            },
          },
        );
        if (!output) output = stdout;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (timedOut) return { code: 'image-probe-timeout' };
        if (!(error instanceof ProcessFailure)) throw error;
        exitCode = error.signal === 'SIGILL' ? 132 : error.status;
        if (exitCode === 0) exitCode = null;
      }
      if (exitCode === 0) {
        const match = /\bdb version v(\d+\.\d+\.\d+)\b/.exec(output);
        return match
          ? { code: 'image-probe-passed', exitCode, mongodbVersion: match[1] }
          : { code: 'image-version-unrecognized', exitCode };
      }
      const code =
        output.includes('12257600') ||
        /kernel.*(incompatib|unsupported)|incompatib.*kernel/i.test(output)
          ? 'image-kernel-rejected'
          : exitCode === 132
            ? 'image-illegal-instruction'
            : 'image-execution-failed';
      return { code, exitCode };
    } finally {
      clearTimeout(deadline);
      // Cleanup is independent of the cancelled probe; inspect exact ownership first.
      let owner = '';
      try {
        owner = await this.process.run(
          'docker',
          [
            ...socket,
            'container',
            'inspect',
            '--format',
            '{{index .Config.Labels "' + label + '"}}',
            name,
          ],
          { cwd: '/', env, timeout: 15000, maxBuffer: 4096 },
        );
      } catch {}
      if (owner.trim() === name)
        await this.process.run('docker', [...socket, 'rm', '-f', name], {
          cwd: '/',
          env,
          timeout: 15000,
          maxBuffer: 4096,
        });
    }
  }
  async logging(
    containers: string[],
    size: string | undefined,
    files: string | undefined,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ) {
    const expected = logPolicy(size, files);
    if (
      containers.some((name) => !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name) || /[\r\n]/.test(name))
    )
      throw new InspectionInputError(
        'Supply exact container names or IDs, not selectors or options.',
      );
    const checked = [];
    for (const name of containers)
      checked.push(await this.verifyLogging(name, expected, env, signal));
    return {
      schemaVersion: 1,
      expected,
      containers: checked,
      ok: checked.every((item) => item.matches),
      retention: 'size-and-file-count; no maximum age guarantee',
    };
  }
  async verifyLogging(
    container: string,
    expected: LogPolicy,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ) {
    const actual: unknown = JSON.parse(
      await this.process.run(
        'docker',
        [
          ...socket,
          'container',
          'inspect',
          '--format',
          '{{json .HostConfig.LogConfig}}',
          container,
        ],
        { cwd: '/', env, signal, timeout: 15000, maxBuffer: 65536 },
      ),
    );
    if (!actual || typeof actual !== 'object' || Array.isArray(actual))
      throw new Error('Invalid Docker logging response.');
    const value = actual as Record<string, unknown>,
      config = value.Config;
    const matches =
      value.Type === expected.Type &&
      !!config &&
      typeof config === 'object' &&
      Object.entries(expected.Config).every(
        ([key, value]) =>
          String((config as Record<string, unknown>)[key] ?? '').toLowerCase() === value,
      );
    return { container, matches, actual };
  }
}
