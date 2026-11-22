import { Injectable, Inject, Optional } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const fixtureRuntime = '/opt/system-public-upgrade';
export const runtimeLibraries = [
  '/lib/ld-musl-x86_64.so.1',
  '/usr/lib/libstdc++.so.6',
  '/usr/lib/libgcc_s.so.1',
];
export function runtimeVolumes(fixture: string): string[] {
  return [
    fixture + '/runtime:' + fixtureRuntime + ':ro',
    ...runtimeLibraries.map((file) => fixture + '/runtime' + file + ':' + file + ':ro'),
    fixture + '/runtime/lib/ld-musl-x86_64.so.1:/lib/libc.musl-x86_64.so.1:ro',
  ];
}
export type TransportResult = { status: number; signal?: NodeJS.Signals };
export const PUBLIC_UPGRADE_OUTPUT = Symbol('PUBLIC_UPGRADE_OUTPUT');
class FixtureRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function ownedStorage(value: unknown): asserts value {
  if (!value)
    throw new FixtureRefusal(86, 'Seed operation failed: storage-fixture-transport-refused.');
}

function record(value: unknown): Record<string, unknown> {
  ownedStorage(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function storagePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    value !== '/' &&
    path.posix.normalize(value) === value &&
    !/[\x00-\x1f,:]/.test(value)
  );
}

/** Only the exact storage commands emitted by the owned controller inherit this adapter. */
function storageArguments(input: string[], offset: number, fixture: string): string[] {
  const args = input.slice(offset);
  if (args[0] !== 'create' && args[0] !== 'run') return input;
  const script = args.findIndex(
    (value, index) =>
      value === '/system/system/seed-operation.js' ||
      (value === '/system/dist/cli/main.js' && args[index + 1] === 'storage'),
  );
  const storageLike = args.some(
    (value) =>
      /^(SYSTEM_STORAGE_SPEC|SYSTEM_SEED_CONTROLLER_IMAGE|PERSISTENCE_ENV_FILE)=/.test(value) ||
      /^(system\.storage\.launcher|org\.system-bootstrapper\.storage-operation)=/.test(value),
  );
  if (script < 0 && !storageLike) return input;
  ownedStorage(script > 1 && storagePath(fixture));
  let data: Record<string, unknown>;
  try {
    data = record(JSON.parse(fs.readFileSync(path.join(fixture, 'fixture.json'), 'utf8')));
  } catch {
    ownedStorage(false);
  }
  const live = data.live;
  ownedStorage(storagePath(live));
  const previous = record(record(data.previous).images),
    images = record(record(data.spec).images);
  const image = args[script - 1];
  ownedStorage(
    /^sha256:[a-f0-9]{64}$/.test(image) &&
      [record(previous.controller).imageId, record(images.candidate).id].includes(image),
  );
  const runtime =
    args[script] === '/system/system/seed-operation.js'
      ? ['/system/system/seed-operation.js']
      : ['/system/dist/cli/main.js', 'storage'];
  const suffix = args.slice(script + runtime.length);
  const environment = (key: string): string => {
    const values = args
      .slice(0, script - 1)
      .flatMap((value, index) =>
        value === '--env' && args[index + 1]?.startsWith(key + '=')
          ? [args[index + 1].slice(key.length + 1)]
          : [],
      );
    ownedStorage(values.length === 1);
    return values[0];
  };
  let expected: string[];
  if (suffix[0] === 'host') {
    const name = args[args.indexOf('--name') + 1],
      backup = environment('SYSTEM_SEED_CONFIGURATION_BACKUP');
    ownedStorage(
      /^system-storage-launcher-[a-f0-9]{24}$/.test(name) &&
        ['harvest', 'restore'].includes(suffix[1]) &&
        (suffix.length === 2 || (suffix.length === 3 && suffix[2] === '--check-only')) &&
        environment('PERSISTENCE_ENV_FILE') === live + '/public-upgrade-storage.env' &&
        environment('SYSTEM_SEED_CONTROLLER_IMAGE') === image &&
        (backup === '' || (suffix[1] === 'restore' && storagePath(backup))),
    );
    expected = [
      'create',
      '--interactive',
      '--name',
      name,
      '--label',
      'system.storage.launcher=' + name,
      '--network',
      'none',
      '--entrypoint',
      'node',
      '--mount',
      'type=bind,src=/,dst=/host,readonly',
      '--mount',
      'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
      '--env',
      'PERSISTENCE_ENV_FILE=' + live + '/public-upgrade-storage.env',
      '--env',
      'SYSTEM_SEED_CONTROLLER_IMAGE=' + image,
      '--env',
      'SYSTEM_SEED_CONFIGURATION_BACKUP=' + backup,
    ];
  } else {
    const raw = environment('SYSTEM_STORAGE_SPEC');
    let spec: Record<string, unknown>;
    try {
      spec = record(JSON.parse(raw));
    } catch {
      ownedStorage(false);
    }
    ownedStorage(spec.PERSISTENT_DIR === live && storagePath(spec.SEED_DIR));
    if (suffix.length === 1 && suffix[0] === 'validate') {
      expected = [
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        'node',
        '--mount',
        'type=bind,src=/,dst=/host,readonly',
        '--env',
        'SYSTEM_STORAGE_SPEC=' + raw,
      ];
    } else {
      const name = args[args.indexOf('--name') + 1];
      ownedStorage(
        suffix.length === 1 &&
          suffix[0] === 'inside' &&
          ['harvest', 'restore'].includes(String(spec.operation)) &&
          /^system-storage-(harvest|restore)-[a-f0-9]{24}$/.test(name) &&
          name.startsWith('system-storage-' + String(spec.operation) + '-') &&
          spec.helperName === name &&
          spec.imageId === image &&
          typeof spec.checkOnly === 'boolean' &&
          typeof spec.backup === 'boolean',
      );
      expected = [
        'create',
        '--name',
        name,
        '--network',
        'none',
        '--init',
        '--pids-limit',
        '256',
        '--label',
        'org.system-bootstrapper.storage-operation=' + name,
        '--entrypoint',
        'node',
        '--mount',
        'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
        '--mount',
        'type=bind,src=/,dst=/host,readonly',
        '--mount',
        'type=bind,src=' + live + ',dst=/live',
        '--mount',
        'type=bind,src=' + live + '/gitlab/config,dst=/srv/gitlab/config',
        '--mount',
        'type=bind,src=' + live + '/gitlab/logs,dst=/srv/gitlab/log',
        '--mount',
        'type=bind,src=' + live + '/gitlab/data,dst=/srv/gitlab/data',
        '--mount',
        'type=bind,src=' + spec.SEED_DIR + ',dst=/seed',
      ];
      if (spec.backup) {
        const mount = args.find((value) =>
          value.endsWith(',dst=/system/bootstrapper.zip,readonly'),
        );
        const backup = mount?.slice(
          'type=bind,src='.length,
          -',dst=/system/bootstrapper.zip,readonly'.length,
        );
        ownedStorage(spec.operation === 'restore' && storagePath(backup));
        expected.push(
          '--mount',
          'type=bind,src=' + backup + ',dst=/system/bootstrapper.zip,readonly',
        );
      }
      expected.push('--env', 'SYSTEM_STORAGE_SPEC=' + raw);
    }
  }
  expected.push(image, ...runtime, ...suffix);
  // Existing overlays and any unknown options are ambiguous; never replace them.
  ownedStorage(
    args.length === expected.length && args.every((value, index) => value === expected[index]),
  );
  return [
    ...input.slice(0, offset),
    ...args.slice(0, script - 1),
    '--env',
    'SYSTEM_PUBLIC_UPGRADE_FIXTURE=' + fixture,
    ...[
      fixture + ':' + fixture + ':ro',
      fixture + '/source/tests/e2e/public-upgrade-docker.js:/usr/bin/docker:ro',
      ...runtimeVolumes(fixture),
    ].flatMap((volume) => ['--volume', volume]),
    ...args.slice(script - 1),
  ];
}
/** Test-only publication transport; never imported by production operation modules. */
@Injectable()
export class PublicUpgradeTransportService {
  constructor(
    @Optional()
    @Inject(PUBLIC_UPGRADE_OUTPUT)
    private readonly output: {
      write(bytes: string | Buffer): unknown;
      once?(event: 'drain', ready: () => void): unknown;
    } = process.stdout,
  ) {}

  private async execute(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    inspect?: string,
  ): Promise<TransportResult> {
    const result = await new Promise<{ status: number; signal?: NodeJS.Signals; stdout: Buffer }>(
      (resolve) => {
        const child = spawn(command, args, {
          env,
          stdio: ['inherit', 'pipe', 'inherit'],
        });
        const chunks: Buffer[] = [];
        let bytes = 0,
          failure = 0;
        const interrupt = () => child.kill('SIGINT'),
          terminate = () => child.kill('SIGTERM');
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', terminate);
        child.stdout?.on('data', (chunk: Buffer) => {
          if (!inspect) {
            try {
              if (this.output.write(chunk) === false) {
                if (!this.output.once) throw Error('fixture-output-drain-required');
                child.stdout?.pause();
                this.output.once('drain', () => child.stdout?.resume());
              }
            } catch {
              failure = 126;
              child.kill('SIGKILL');
            }
            return;
          }
          bytes += chunk.length;
          if (bytes > 64 * 1024 * 1024) {
            failure = 126;
            child.kill('SIGKILL');
          } else chunks.push(chunk);
        });
        child.on('error', (error: NodeJS.ErrnoException) => {
          failure = error.code === 'ENOENT' ? 127 : 126;
        });
        child.on('close', (status, signal) => {
          process.off('SIGINT', interrupt);
          process.off('SIGTERM', terminate);
          resolve({
            status: failure || (status ?? 1),
            signal: failure ? undefined : (signal ?? undefined),
            stdout: Buffer.concat(chunks),
          });
        });
      },
    );
    if (result.signal) return { status: 1, signal: result.signal };
    if (result.status !== 0) return { status: result.status };
    if (inspect) {
      let output = result.stdout.toString();
      try {
        const parsed: unknown = JSON.parse(output);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        for (const row of rows) {
          if (typeof row === 'object' && row !== null && Object.hasOwn(row, 'RepoDigests'))
            (row as Record<string, unknown>).RepoDigests = [inspect];
        }
        output = JSON.stringify(parsed) + '\n';
      } catch {
        /* Native formatted output that is not JSON stays byte-for-byte intact. */
      }
      this.output.write(output);
    }
    return { status: 0 };
  }

  async docker(
    program: string,
    input: string[],
    environment = process.env,
  ): Promise<TransportResult> {
    const fixture = environment.SYSTEM_PUBLIC_UPGRADE_FIXTURE;
    if (!fixture) throw Error('public-upgrade-fixture-required');
    const env = { ...environment };
    const rows = fs
      .readFileSync(path.join(fixture, 'images.tsv'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));
    const map = (value: string) => {
      const normalized = value.replace(/^docker.io\//, '');
      const row = rows.find((row) => row[0] === normalized);
      if (!row) return value;
      if (row[2] === 'previous' && fs.existsSync(path.join(fixture, 'offline-recovery')))
        throw new FixtureRefusal(87, 'Previous public registry transport is unavailable.');
      return row[1];
    };
    try {
      let args = [...input];
      const commandOffset = args[0] === '--host=unix:///var/run/docker.sock' ? 1 : 0;
      if (path.basename(program) === 'docker-compose' || args[commandOffset] === 'compose') {
        if (path.basename(program) !== 'docker-compose') args = args.slice(commandOffset + 1);
        for (const key of [
          'BOOTSTRAPPER_IMAGE',
          'WIZARD_IMAGE',
          'GITLAB_IMAGE',
          'GITLAB_RUNNER_IMAGE',
          'GITLAB_RUNNER_HELPER_IMAGE',
        ])
          if (env[key]) env[key] = map(env[key]!);
        if (args.some((value) => value.endsWith('system/docker-compose.yml'))) {
          const index = args.findIndex((value) => value === 'up' || value === 'create');
          if (index >= 0) args.splice(index, 0, '-f', path.join(fixture, 'compose.yml'));
        }
        if (
          env.BOOTSTRAPPER_IMAGE?.startsWith('system-bootstrapper-recovery:') &&
          args.at(-1) === 'bootstrapper'
        ) {
          try {
            fs.unlinkSync(path.join(fixture, 'fail-recovery-once'));
            throw new FixtureRefusal(88, 'Injected one-shot recovery transport failure.');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        return this.execute(path.join(fixture, 'docker-compose.native'), args, env);
      }
      args = storageArguments(args, commandOffset, fixture);
      let original: string | undefined;
      args = args.map((value) => {
        const mapped = map(value);
        if (mapped !== value) original = value.replace(/^docker.io\//, '');
        return mapped;
      });
      if (original && args[commandOffset] === 'pull')
        return this.execute(
          path.join(fixture, 'docker.native'),
          ['image', 'inspect', args.at(-1)!],
          env,
        );
      const inspect =
        original && args[commandOffset] === 'image' && args[commandOffset + 1] === 'inspect'
          ? original
          : undefined;
      return this.execute(path.join(fixture, 'docker.native'), args, env, inspect);
    } catch (error) {
      if (!(error instanceof FixtureRefusal)) throw error;
      process.stderr.write(error.message + '\n');
      return { status: error.status };
    }
  }

  async findmnt(args: string[], environment = process.env): Promise<TransportResult> {
    const live = environment.SYSTEM_PUBLIC_UPGRADE_LIVE;
    if (!live) throw Error('public-upgrade-live-required');
    let target = '',
      field = '';
    for (let index = 0; index < args.length; index++) {
      if (['--target', '-T'].includes(args[index])) target = args[++index] || '';
      else if (args[index] === '-o') field = args[++index] || '';
    }
    if (target === '/' || target === live || target.startsWith(live + '/')) {
      const output: Record<string, string> = { 'MAJ:MIN': '0:1\n', UUID: '\n', TARGET: '/\n' };
      if (Object.hasOwn(output, field)) {
        this.output.write(output[field]);
        return { status: 0 };
      }
    }
    return this.execute('/usr/bin/findmnt', args, environment);
  }
}
