import { checkoutConfiguration } from '../../common/runtime/checkout-layout';
import { cliArguments } from '../../common/runtime/installation-paths';
import { environmentAssignments } from '../../common/runtime/environment-assignments';
import { ProcessFailure } from '../../common/runtime/process';
import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managed-child';
import { HostPersistenceService, storageEnvironment } from './persistence.service';

/** Load the declarative configuration without a shell interpreter. */
export async function readEnvironment(
  _runner: LifecycleProcess,
  files: string[],
  env: NodeJS.ProcessEnv,
  _cwd: string,
  signal?: AbortSignal,
): Promise<NodeJS.ProcessEnv> {
  if (signal?.aborted) throw new ProcessFailure('configuration', null, 'SIGTERM', true);
  const result = { ...env };
  for (const file of files)
    Object.assign(result, environmentAssignments(fs.readFileSync(file, 'utf8')));
  return result;
}
export function releaseFallback(filename: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!stat) return env;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== 0)
    throw Error('invalid-private-release-image-selector');
  const values: Record<string, string> = {};
  const content = fs.readFileSync(filename, 'utf8').replace(/\n$/, '');
  for (const line of content.split('\n')) {
    const match =
      /^(BOOTSTRAPPER_IMAGE|WIZARD_IMAGE)=(docker\.io\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9._-]*@sha256:[a-f0-9]{64})$/.exec(
        line,
      );
    if (!match || values[match[1]]) throw Error('unsupported-release-image-selector');
    values[match[1]] = match[2];
  }
  if (!values.BOOTSTRAPPER_IMAGE || !values.WIZARD_IMAGE)
    throw Error('incomplete-release-image-selector');
  return {
    ...env,
    ...values,
    SYSTEM_BOOTSTRAPPER_SKIP_BUILD: env.SYSTEM_BOOTSTRAPPER_SKIP_BUILD || '1',
  };
}
const storageKeys = [
  'PERSISTENCE_MODE',
  'PERSISTENT_MOUNT',
  'PERSISTENT_DIR',
  'PERSISTENT_UUID',
] as const;
const seedKeys = ['SEED_DIR', 'SEED_MOUNT', 'SEED_UUID'] as const;
@Injectable()
export class HostLifecycleService {
  constructor(
    private readonly persistence: HostPersistenceService,
    private readonly child: LifecycleProcess = new ManagedChildProcess(),
  ) {}

  async execute(
    action: 'start' | 'stop',
    root: string,
    input: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<void> {
    const run = (binary: string, args: string[], env: NodeJS.ProcessEnv) =>
      this.child.run(binary, args, { cwd: root, env, signal, timeout: 1800000, inherit: true });
    const compose = [
      '--host=unix:///var/run/docker.sock',
      'compose',
      '--compatibility',
      '-p',
      'system',
      '-f',
      checkoutConfiguration(root, 'system', 'docker-compose.yml'),
    ];
    if (action === 'stop') {
      const configuration = checkoutConfiguration(root, 'system', '.docker.env');
      const files = fs.existsSync(configuration)
        ? [configuration]
        : [
            checkoutConfiguration(root, 'system', '.docker.env.example'),
            checkoutConfiguration(root, 'system', '.seed.env'),
          ];
      const env = await readEnvironment(this.child, files, input, root, signal);
      const active = (
        await this.child.run(
          'docker',
          [...compose, 'ps', '-q', '--status', 'running', 'bootstrapper'],
          { cwd: root, env, signal, timeout: 15000 },
        )
      ).trim();
      if (active) {
        const probe = await this.child.run(
          'docker',
          [
            ...compose,
            'exec',
            '-T',
            'bootstrapper',
            'node',
            '-e',
            'const fs=require("node:fs");process.stdout.write(JSON.stringify({version:fs.readFileSync("/system/VERSION","utf8").trim(),cli:fs.existsSync("/system/dist/cli/main.js")}));',
          ],
          { cwd: root, env, signal, timeout: 15000 },
        );
        const runtime: unknown = JSON.parse(probe);
        if (
          !runtime ||
          typeof runtime !== 'object' ||
          !('version' in runtime) ||
          typeof runtime.version !== 'string' ||
          !('cli' in runtime) ||
          typeof runtime.cli !== 'boolean'
        )
          throw new Error('invalid-controller-lifecycle-identity');
        let command: string[];
        if (runtime.version === '2.0.0' && runtime.cli)
          command = ['node', '/system/dist/cli/main.js', 'lifecycle', 'stop', '/system'];
        else if (['1.0.0', '1.1.0', '1.1.1', '1.1.2', '1.1.3', '1.2.0'].includes(runtime.version))
          command = ['bash', '/system/system/stop.sh']; // Immutable pre-Nest release only.
        else throw new Error('controller-lifecycle-cli-missing');
        await run('docker', [...compose, 'exec', '-T', 'bootstrapper', ...command], env);
      }
      await run('docker', [...compose, 'down'], env);
      return;
    }
    const selector = input.PERSISTENCE_ENV_FILE || '/etc/system-bootstrapper/persistence.env';
    let env = fs.existsSync(selector)
      ? await readEnvironment(this.child, [selector], input, root, signal)
      : { ...input };
    const selectedSeed = Object.fromEntries(
      seedKeys.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
    );
    env = storageEnvironment(env);
    const data = env.PERSISTENT_DIR;
    if (!data) throw Error('persistent-storage-directory-required');
    for (const lock of ['.storage-operation-lock', '.gitlab-upgrade-lock'])
      if (fs.lstatSync(path.join(data, 'configuration', lock), { throwIfNoEntry: false }))
        throw Error('unfinished-storage-operation-blocks-startup');
    env = await this.persistence.prepare(env, undefined, signal);
    const selectedStorage = Object.fromEntries(storageKeys.map((key) => [key, env[key]]));
    env = releaseFallback(path.join(data, 'configuration/.release-images.env'), env);
    const saved = path.join(data, 'configuration/.docker.env'),
      local = checkoutConfiguration(root, 'system', '.docker.env');
    if (fs.existsSync(saved)) env = await readEnvironment(this.child, [saved], env, root, signal);
    else if (fs.existsSync(local))
      env = await readEnvironment(this.child, [local], env, root, signal);
    else {
      const seed = env.SEED_DIR;
      env = await readEnvironment(
        this.child,
        [
          checkoutConfiguration(root, 'system', '.docker.env.example'),
          checkoutConfiguration(root, 'system', '.seed.env'),
        ],
        env,
        root,
        signal,
      );
      if (seed !== undefined) env.SEED_DIR = seed;
    }
    env = { ...env, ...selectedStorage, ...selectedSeed };
    await this.persistence.prepare(env, undefined, signal);
    if (env.SYSTEM_BOOTSTRAPPER_SKIP_BUILD !== '1')
      await run(process.execPath, cliArguments('source-prepare', [root], root), env);
    await run(
      'docker',
      [
        ...compose,
        'up',
        env.SYSTEM_BOOTSTRAPPER_SKIP_BUILD === '1' ? '--no-build' : '--build',
        '-d',
        'bootstrapper',
      ],
      env,
    );
  }
}
