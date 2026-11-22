import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ObservationProcess } from './process';
import { ResourceCollectorService, ResourceSample, summary, timestamp } from './collector.service';
import { cliRepositoryPath, maxCliArtifactBytes } from '../project-ci/cliFileEvidence';
import { cliArtifactFiles, selectedCliArtifact } from '../project-ci/cliArtifact';
const node =
    'node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f',
  nginx =
    'nginx:stable-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5',
  buildkit =
    'moby/buildkit:buildx-stable-1@sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea';
const digest = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function inputManifest(
  directory: string,
  cliSha256?: string,
): { path: string; sha256: string }[] {
  const output: { path: string; sha256: string }[] = [];
  function visit(folder: string) {
    for (const name of fs.readdirSync(folder).sort()) {
      const file = path.join(folder, name),
        stat = fs.lstatSync(file);

      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw Error('benchmark-input-type-refused');
      }

      if (stat.isDirectory()) {
        visit(file);
      } else {
        const relative = path.relative(directory, file).split(path.sep).join('/');
        const cliArtifact = relative === cliRepositoryPath && cliSha256 !== undefined;

        if (
          ['.env', '.docker.env', '.npmrc', '.netrc'].includes(name) ||
          stat.size > (cliArtifact ? maxCliArtifactBytes : 4_000_000)
        ) {
          throw Error('benchmark-private-or-oversized-input');
        }

        const sha256 = digest(file);

        if (cliArtifact && sha256 !== cliSha256) {
          throw Error('benchmark-input-changed');
        }

        output.push({ path: relative, sha256 });
      }
    }
  }

  if (fs.lstatSync(directory).isSymbolicLink()) {
    throw Error('benchmark-input-type-refused');
  }

  visit(directory);
  return output;
}
function checkpoint(directory: string, value: unknown) {
  const temporary = path.join(directory, 'operation.tmp'),
    fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, path.join(directory, 'operation.json'));
  const parent = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(parent);
  } finally {
    fs.closeSync(parent);
  }
}
interface BenchmarkOptions {
  case: string;
  templates: string;
  sourceRevision: string;
  output: string;
  execute: boolean;
  leaseDeadline?: number;
}
interface Image {
  Id: string;
  Config: { Labels: Record<string, string> };
}
@Injectable()
export class ResourceBenchmarkService {
  constructor(
    readonly transport = new ObservationProcess(),
    readonly collector = new ResourceCollectorService(),
  ) {}

  plan(options: BenchmarkOptions) {
    if (
      !['react', 'angular'].includes(options.case) ||
      !/^[a-f0-9]{40}$/.test(options.sourceRevision)
    ) {
      throw Error('exact-benchmark-source-required');
    }

    const source = path.resolve(options.templates, options.case),
      root = path.resolve(options.templates, '../../..'),
      inputs = inputManifest(source),
      dockerfile = fs.readFileSync(path.join(source, 'Dockerfile'), 'utf8');

    if (
      !dockerfile.includes(node) ||
      !dockerfile.includes(nginx) ||
      !dockerfile.includes('RUN npm ci') ||
      !dockerfile.includes('system-bootstrapper host-bootstrap refresh-ca')
    ) {
      throw Error('reviewed-benchmark-recipe-required');
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')) as unknown,
      lock = JSON.parse(fs.readFileSync(path.join(source, 'package-lock.json'), 'utf8')) as {
        lockfileVersion: number;
      };

    if (lock.lockfileVersion !== 3) {
      throw Error('committed-npm-lockfile-required');
    }

    const publicInputs = cliArtifactFiles(selectedCliArtifact()).map((file) => ({
      path: file.path,
      destination: file.path,
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
    }));
    return {
      version: 1,
      case: options.case,
      systemSourceRevision: options.sourceRevision,
      nodeImage: node,
      nginxImage: nginx,
      buildkitImage: buildkit,
      builderMemoryBytes: 4 * 1024 ** 3,
      builderCpus: 2,
      candidateMemoryBytes: 128 * 1024 ** 2,
      candidateCpus: 0.5,
      maxPhaseSeconds: 240,
      maxLogBytesPerPhase: 2_000_000,
      package: pkg,
      inputs,
      publicRuntimeInputs: publicInputs,
    };
  }

  private docker(
    args: string[],
    timeout = 30000,
    signal?: AbortSignal,
    output?: (chunk: Buffer) => void,
  ) {
    return this.transport
      .run(['docker', '--host=unix:///var/run/docker.sock', ...args], timeout, signal, output)
      .then((text) => text.trim());
  }

  async execute(options: BenchmarkOptions, environment = process.env, signal?: AbortSignal) {
    const plan = this.plan(options);

    if (!options.execute) {
      return plan;
    }

    if (environment.SYSTEM_RESOURCE_BENCHMARK_APPROVED !== '1') {
      throw Error('benchmark-resource-lease-required');
    }

    if (
      ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].some(
        (key) => environment[key],
      )
    ) {
      throw Error('native-local-daemon-required');
    }

    const deadline = options.leaseDeadline;

    if (
      !deadline ||
      !Number.isFinite(deadline) ||
      deadline - Date.now() / 1000 <= 75 ||
      deadline - Date.now() / 1000 > 600
    ) {
      throw Error('shared-benchmark-deadline-required');
    }

    if (process.platform !== 'linux' || process.arch !== 'x64') {
      throw Error('native-linux-amd64-required');
    }

    fs.mkdirSync(options.output, { mode: 0o700, recursive: false });
    const operation = randomUUID().replace(/-/g, ''),
      builder = 'resource-' + operation,
      tags: string[] = [],
      candidateName = 'resource-candidate-' + operation;
    let candidate: string | null = null,
      failure: unknown;
    const intent = {
      operation,
      builder,
      tags,
      candidateId: candidate as string | null,
      candidateName,
      phase: 'reserved',
      leaseDeadlineEpoch: deadline,
      cleanup: 'pending',
    };
    const report: {
      plan: typeof plan;
      operation: string;
      createdAt: string;
      builds: unknown[];
      cleanup: string;
      [key: string]: unknown;
    } = { plan, operation, createdAt: timestamp(), builds: [], cleanup: 'pending' };
    checkpoint(options.output, intent);
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'system-resource-'));
    const work = (
      args: string[],
      timeout = 30000,
      childSignal = signal,
      output?: (chunk: Buffer) => void,
    ) => {
      const remaining = deadline * 1000 - Date.now() - 60000;

      if (remaining <= 0) {
        throw Error('benchmark-cleanup-reserve-reached');
      }

      return this.docker(args, Math.min(timeout, remaining), childSignal, output);
    };
    const evidence = () =>
      fs.writeFileSync(
        path.join(options.output, 'evidence.json'),
        JSON.stringify(report, null, 2) + '\n',
        { mode: 0o600 },
      );
    try {
      const context = path.join(temporary, 'context');
      fs.cpSync(path.join(options.templates, options.case), context, { recursive: true });

      if (JSON.stringify(inputManifest(context)) !== JSON.stringify(plan.inputs)) {
        throw Error('benchmark-input-changed');
      }

      const publicFiles = new Map(
        cliArtifactFiles(selectedCliArtifact()).map((file) => [file.path, file.bytes]),
      );
      for (const item of plan.publicRuntimeInputs) {
        const target = path.join(context, item.destination);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const bytes = publicFiles.get(item.path);

        if (!bytes) {
          throw Error('benchmark-input-changed');
        }

        fs.writeFileSync(target, bytes);

        if (digest(target) !== item.sha256) {
          throw Error('benchmark-input-changed');
        }
      }

      if (
        JSON.stringify(inputManifest(path.join(options.templates, options.case))) !==
        JSON.stringify(plan.inputs)
      ) {
        throw Error('benchmark-input-changed');
      }

      await work(
        [
          'buildx',
          'create',
          '--name',
          builder,
          '--driver',
          'docker-container',
          '--driver-opt',
          'memory=4g',
          '--driver-opt',
          'cpu-period=100000',
          '--driver-opt',
          'cpu-quota=200000',
          '--driver-opt',
          'image=' + buildkit,
        ],
        30000,
        signal,
      );
      for (const phase of ['cold', 'warm']) {
        signal?.throwIfAborted();
        const remaining = deadline * 1000 - Date.now() - 60000;

        if (remaining <= 0) {
          throw Error('benchmark-cleanup-reserve-reached');
        }

        if (phase === 'warm') {
          fs.appendFileSync(
            path.join(context, options.case === 'react' ? 'src/App.tsx' : 'src/app/app.ts'),
            '\n// Resource benchmark dependency-cache reuse.\n',
          );
        }

        const tag = 'system-resource-benchmark:' + operation + '-' + phase;
        tags.push(tag);
        intent.phase = phase;
        checkpoint(options.output, intent);
        const startedAt = timestamp(),
          begin = performance.now(),
          samples: ResourceSample[] = [],
          log: Buffer[] = [];
        let done = false,
          finishedAt = '',
          elapsed = 0,
          buildFailure: unknown;
        const buildAbort = new AbortController();
        const buildSignal = signal
          ? AbortSignal.any([signal, buildAbort.signal])
          : buildAbort.signal;
        const build = work(
          [
            'buildx',
            'build',
            '--builder',
            builder,
            '--load',
            '--provenance=false',
            '--progress=plain',
            '--label',
            'system.resource.benchmark.operation=' + operation,
            '--label',
            'org.opencontainers.image.revision=' + options.sourceRevision,
            '--label',
            'system.resource.benchmark.phase=' + phase,
            '-t',
            tag,
            context,
          ],
          Math.min(240000, remaining),
          buildSignal,
          (chunk) => log.push(chunk),
        )
          .catch((error) => {
            buildFailure = error;
          })
          .finally(() => {
            done = true;
            finishedAt = timestamp();
            elapsed = (performance.now() - begin) / 1000;
          });
        try {
          while (!done) {
            if (samples.length < 30) {
              samples.push(await this.collector.sample(signal));
            } else {
              await delay(250, undefined, { signal });
            }
          }
        } finally {
          if (!done) {
            buildAbort.abort();
          }

          await build;
        }
        fs.writeFileSync(path.join(options.output, phase + '.log'), Buffer.concat(log), {
          mode: 0o600,
        });

        if (buildFailure) {
          throw buildFailure;
        }

        report.builds.push({
          phase,
          startedAt,
          finishedAt,
          commandWallSeconds: Math.round(elapsed * 1000) / 1000,
          cache:
            phase === 'cold'
              ? 'fresh-owned-builder-empty-cache'
              : 'same-builder-dependency-cache-source-rebuild',
          samples,
          summary: summary(samples),
          contextManifest: inputManifest(
            context,
            plan.publicRuntimeInputs.find((input) => input.path === cliRepositoryPath)!.sha256,
          ),
        });
        evidence();
      }
      const image = JSON.parse(
        await work(['image', 'inspect', '--format', '{{json .}}', tags.at(-1)!], 30000, signal),
      ) as Image;

      if (image.Config?.Labels?.['system.resource.benchmark.operation'] !== operation) {
        throw Error('benchmark-image-ownership-changed');
      }

      intent.phase = 'candidate-create-intent';
      checkpoint(options.output, intent);
      const createdCandidate = await work(
        [
          'create',
          '--name',
          candidateName,
          '--network',
          'none',
          '--memory',
          '128m',
          '--cpus',
          '0.5',
          '--label',
          'system.resource.benchmark.operation=' + operation,
          tags.at(-1)!,
        ],
        30000,
        signal,
      );

      if (!/^[a-f0-9]{64}$/.test(createdCandidate)) {
        throw Error('invalid-benchmark-candidate');
      }

      candidate = createdCandidate;
      intent.candidateId = candidate;
      checkpoint(options.output, intent);
      await work(['start', candidate], 30000, signal);
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          await work(
            ['exec', candidate, 'wget', '-q', '-T', '2', '-O', '/dev/null', 'http://127.0.0.1/'],
            5000,
            signal,
          );
          break;
        } catch (error) {
          if (attempt === 19 || signal?.aborted) {
            throw error;
          }

          await delay(250, undefined, { signal });
        }
      }
      report.staticHttpSmoke = true;
      report.builtImageId = image.Id;
    } catch (error) {
      failure = error;
    } finally {
      const errors: string[] = [],
        clean = (args: string[]) => {
          const remaining = deadline * 1000 - Date.now();

          if (remaining < 1000) {
            throw Error('benchmark-lease-ended');
          }

          return this.docker(args, Math.min(6000, remaining));
        };

      if (!candidate && intent.phase === 'candidate-create-intent') {
        try {
          const found = await clean([
            'ps',
            '-aq',
            '--no-trunc',
            '--filter',
            'label=system.resource.benchmark.operation=' + operation,
          ]);

          if (/^[a-f0-9]{64}$/.test(found)) {
            candidate = found;
          } else if (found) {
            throw Error();
          }
        } catch {
          errors.push('candidate-reconciliation');
        }
      }

      if (candidate) {
        try {
          const row = JSON.parse(
            await clean(['inspect', '--format', '{{json .}}', candidate]),
          ) as Image;

          if (
            row.Id !== candidate ||
            row.Config?.Labels?.['system.resource.benchmark.operation'] !== operation
          ) {
            throw Error();
          }

          await clean(['rm', '-f', candidate]);
        } catch {
          errors.push('candidate');
        }
      }

      try {
        await clean(['buildx', 'rm', '-f', builder]);
      } catch {
        errors.push('builder');
      }
      for (const tag of tags) {
        try {
          if (
            !(await clean(['image', 'ls', '--filter', 'reference=' + tag, '--format', '{{.ID}}']))
          ) {
            continue;
          }

          const row = JSON.parse(
            await clean(['image', 'inspect', '--format', '{{json .}}', tag]),
          ) as Image;

          if (row.Config?.Labels?.['system.resource.benchmark.operation'] !== operation) {
            throw Error();
          }

          await clean(['image', 'rm', tag]);
        } catch {
          errors.push('image');
        }
      }
      fs.rmSync(temporary, { recursive: true, force: true });
      report.cleanup = errors.length ? 'failed' : 'passed';
      report.cleanupErrors = errors;
      report.completedAt = timestamp();
      report.success = !failure && !errors.length;
      evidence();
      intent.phase = report.success ? 'complete' : 'failed';
      intent.cleanup = report.cleanup;
      checkpoint(options.output, intent);

      if (failure) {
        throw failure;
      }

      if (errors.length) {
        throw Error('benchmark-owned-cleanup-incomplete');
      }
    }
    return { case: options.case, success: report.success, cleanup: report.cleanup };
  }
}
