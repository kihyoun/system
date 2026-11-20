import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { ManagedChildProcess, type LifecycleProcess } from '../runtime/managed-child';
import { HostPersistenceService, storageEnvironment } from './persistence.service';

/** Bash remains only the adapter for the existing shell configuration format. */
export async function readEnvironment(
  runner: LifecycleProcess,
  files: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  signal?: AbortSignal,
): Promise<NodeJS.ProcessEnv> {
  const raw = await runner.run(
    'bash',
    [
      '-e',
      '-c',
      'set -a; for file in "$@"; do source "$file" >&2; done; env -0',
      'configuration',
      ...files,
    ],
    { env, cwd, signal, timeout: 15000 },
  );
  const result: NodeJS.ProcessEnv = {};
  for (const entry of raw.split('\0')) {
    const separator = entry.indexOf('=');
    if (separator > 0) result[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return result;
}
export function releaseFallback(filename: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (!stat) return env;
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== 0)
    throw Error('Invalid private release image selectors.');
  const values: Record<string, string> = {};
  const content = fs.readFileSync(filename, 'utf8').replace(/\n$/, '');
  for (const line of content.split('\n')) {
    const match =
      /^(BOOTSTRAPPER_IMAGE|WIZARD_IMAGE)=(docker\.io\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9._-]*@sha256:[a-f0-9]{64})$/.exec(
        line,
      );
    if (!match || values[match[1]]) throw Error('Unsupported release image selector.');
    values[match[1]] = match[2];
  }
  if (!values.BOOTSTRAPPER_IMAGE || !values.WIZARD_IMAGE)
    throw Error('Incomplete release image selection.');
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
    const compose = ['-p', 'system', '-f', path.join(root, 'system/docker-compose.yml')];
    if (action === 'stop') {
      const configuration = path.join(root, 'system/.docker.env');
      const files = fs.existsSync(configuration)
        ? [configuration]
        : [path.join(root, 'system/.docker.env.example'), path.join(root, 'system/.seed.env')];
      const env = await readEnvironment(this.child, files, input, root, signal);
      const active = (
        await this.child.run(
          'docker-compose',
          [...compose, 'ps', '-q', '--status', 'running', 'bootstrapper'],
          { cwd: root, env, signal, timeout: 15000 },
        )
      ).trim();
      if (active)
        await run(
          'docker-compose',
          [...compose, 'exec', '-T', 'bootstrapper', 'bash', '/system/system/stop.sh'],
          env,
        );
      await run('docker-compose', [...compose, 'down'], env);
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
    if (!data) throw Error('Persistent storage directory required.');
    for (const lock of ['.storage-operation-lock', '.gitlab-upgrade-lock'])
      if (fs.lstatSync(path.join(data, 'configuration', lock), { throwIfNoEntry: false }))
        throw Error('An unfinished storage operation blocks startup.');
    env = await this.persistence.prepare(env, undefined, signal);
    const selectedStorage = Object.fromEntries(storageKeys.map((key) => [key, env[key]]));
    env = releaseFallback(path.join(data, 'configuration/.release-images.env'), env);
    const saved = path.join(data, 'configuration/.docker.env'),
      local = path.join(root, 'system/.docker.env');
    if (fs.existsSync(saved)) env = await readEnvironment(this.child, [saved], env, root, signal);
    else if (fs.existsSync(local))
      env = await readEnvironment(this.child, [local], env, root, signal);
    else {
      const seed = env.SEED_DIR;
      env = await readEnvironment(
        this.child,
        [path.join(root, 'system/.docker.env.example'), path.join(root, 'system/.seed.env')],
        env,
        root,
        signal,
      );
      if (seed !== undefined) env.SEED_DIR = seed;
    }
    env = { ...env, ...selectedStorage, ...selectedSeed };
    await this.persistence.prepare(env, undefined, signal);
    if (env.SYSTEM_BOOTSTRAPPER_SKIP_BUILD !== '1')
      await run('bash', [path.join(root, 'project-bootstrap/wizard-source/prepare.sh')], env);
    await run(
      'docker-compose',
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
