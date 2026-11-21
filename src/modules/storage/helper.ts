import { environmentAssignments } from '../../common/runtime/environment-assignments';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  ProcessFailure,
  ProcessOptions,
  ProcessRunner,
  nativeProcess,
} from '../../common/runtime/process';
import { StorageError, StorageSpec, requireValue } from './types';
import { absolute } from './validation';
import { imageFromConfiguration } from './configuration';
import * as manifest from './manifest';
export type DockerRun = (args: string[], options?: ProcessOptions) => string;
const refusalCodes = [
  'seed-target-unavailable',
  'storage-operation-busy',
  'restore-target-not-empty',
  'seed-payload-invalid',
] as const;
const refusalMessages = Object.fromEntries(
  refusalCodes.map((code) => ['Seed operation failed: ' + code + '.', code]),
);
export function dockerRun(runner: ProcessRunner = nativeProcess): DockerRun {
  return (args, options = {}) => {
    const storageChild =
      (args[0] === 'run' &&
        args.at(-3) === '/system/dist/cli/main.js' &&
        args.at(-2) === 'storage' &&
        args.at(-1) === 'validate') ||
      (args[0] === 'start' &&
        args[1] === '--attach' &&
        args.length === 3 &&
        /^system-storage-(harvest|restore)-[a-f0-9]{24}$/.test(args[2]));
    try {
      return runner
        .run('docker', ['--host=unix:///var/run/docker.sock', ...args], {
          timeout: 3600000,
          ...options,
          controlledFailureCodes: storageChild ? refusalMessages : undefined,
        })
        .stdout.trim();
    } catch (error) {
      if (
        storageChild &&
        error instanceof ProcessFailure &&
        error.binary === 'docker' &&
        error.status === 1 &&
        error.signal === null &&
        !error.uncertain &&
        refusalCodes.some((code) => code === error.controlledCode)
      )
        throw new StorageError(error.controlledCode!);
      throw error;
    }
  };
}
export function helperArguments(
  spec: StorageSpec,
  image: string,
  name: string,
  operation: 'harvest' | 'restore',
  checkOnly = false,
  backup = '',
) {
  const live = absolute(spec.PERSISTENT_DIR),
    seed = absolute(spec.SEED_DIR);
  requireValue(
    /^sha256:[a-f0-9]{64}$/.test(image) &&
      /^system-storage-(harvest|restore)-[a-f0-9]{24}$/.test(name),
    'invalid-helper-identity',
  );
  const args = [
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
    'type=bind,src=' + seed + ',dst=/seed',
  ];
  if (backup)
    args.push(
      '--mount',
      'type=bind,src=' + absolute(backup) + ',dst=/system/bootstrapper.zip,readonly',
    );
  args.push(
    '--env',
    'SYSTEM_STORAGE_SPEC=' +
      JSON.stringify({
        ...spec,
        operation,
        checkOnly,
        backup: !!backup,
        helperName: name,
        imageId: image,
      }),
    image,
    '/system/dist/cli/main.js',
    'storage',
    'inside',
  );
  return args;
}
export function configurationImage(spec: StorageSpec, runner: ProcessRunner = nativeProcess) {
  let raw;
  if (spec.backup) {
    const extracted = runner.run('unzip', ['-p', '/system/bootstrapper.zip', '.docker.env'], {
      maxBuffer: 5000000,
    });
    raw = Buffer.from(extracted.stdout);
  } else raw = fs.readFileSync('/live/configuration/.docker.env');
  let image = imageFromConfiguration(raw, spec.GITLAB_IMAGE || '', runner);
  if (!image && spec.operation === 'restore') {
    // A Seed is an explicit versioned input, never a request for a default or
    // latest image. Validate every payload byte before using its recorded pin;
    // the caller separately checks that exact local image's content identity.
    const snapshot = manifest.current('/seed', false);
    image = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8')).gitlabImage;
  }
  requireValue(
    typeof image === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/.test(image),
    'matching-configuration-backup-required',
  );
  return image;
}
export function gitlabOwnership(spec: StorageSpec, image: string, run: DockerRun = dockerRun()) {
  const present = run([
    'container',
    'ls',
    '--all',
    '--filter',
    'name=^/system_gitlab_1$',
    '--format',
    '{{.Names}}',
  ]);
  if (!present) {
    requireValue(spec.operation === 'restore', 'controlled-gitlab-is-missing');
    return;
  }
  requireValue(present === 'system_gitlab_1', 'ambiguous-controlled-gitlab');
  const row = JSON.parse(run(['inspect', 'system_gitlab_1']))[0];
  requireValue(
    row.Config.Labels?.['com.docker.compose.project'] === 'system' &&
      row.Config.Labels?.['com.docker.compose.service'] === 'gitlab',
    'unowned-gitlab-container',
  );
  requireValue(
    row.Image === run(['image', 'inspect', '--format', '{{.Id}}', image]),
    'gitlab-image-does-not-match-configuration',
  );
  for (const [destination, relative] of [
    ['/etc/gitlab', 'config'],
    ['/var/log/gitlab', 'logs'],
    ['/var/opt/gitlab', 'data'],
  ]) {
    const matches = (
      row.Mounts as {
        Destination: string;
        RW: boolean;
        Source: string;
        Type: string;
        Name: string;
      }[]
    ).filter((mount) => mount.Destination === destination);
    requireValue(matches.length === 1 && matches[0].RW === true, 'gitlab-live-mount-is-missing');
    let selected = matches[0].Source;
    if (matches[0].Type === 'volume') {
      const volume = JSON.parse(run(['volume', 'inspect', matches[0].Name]))[0],
        options = volume.Options || {};
      requireValue(
        options.type === 'none' && options.o === 'bind',
        'gitlab-volume-is-not-a-live-bind',
      );
      selected = options.device;
    } else requireValue(matches[0].Type === 'bind', 'gitlab-volume-is-not-a-live-bind');
    requireValue(
      selected === spec.PERSISTENT_DIR + '/gitlab/' + relative,
      'gitlab-writers-use-different-live-storage',
    );
  }
  if (spec.operation === 'restore')
    requireValue(row.State.Running === false, 'stop-gitlab-before-restore');
}
export function statusIdle(status: Record<string, unknown>) {
  // Harvest itself is an active API operation; all other queues must already
  // have drained after the global barrier prevents accepting any new work.
  return [
    'projectOperationInProgress',
    'runnerSetupInProgress',
    'defaultWizardSetupInProgress',
    'needRestart',
  ].every((key) => status[key] === false);
}
export function controllerIdle(spec: StorageSpec, run: DockerRun = dockerRun()) {
  const output = run(
    [
      'exec',
      spec.SYSTEM_WIZARD_CANONICAL_CONTROLLER || 'system_bootstrapper_1',
      'node',
      '/system/dist/cli/main.js',
      'storage',
      'sync-status',
    ],
    { timeout: 15000 },
  );
  let status;
  try {
    status = JSON.parse(output);
  } catch {
    throw Error('controller-status-unavailable');
  }
  requireValue(status.idle === true, 'controller-operation-busy');
}
export function savedSyncEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const config = environment.SYSTEM_CONFIG_DIR || '/state';
  const result = {
    ...environment,
    ...environmentAssignments(fs.readFileSync(path.join(config, 'sync-auth.env'), 'utf8')),
  };
  const saved = path.join(config, '.docker.env');
  if (fs.existsSync(saved))
    Object.assign(result, environmentAssignments(fs.readFileSync(saved, 'utf8')));
  return result;
}
export async function syncStatus(environment: NodeJS.ProcessEnv = process.env) {
  const request = (route: string, method: string, body?: string, token?: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: 8071,
          path: route,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
          },
          signal: AbortSignal.timeout(5000),
        },
        (res) => {
          let raw = '';
          res.on('data', (part) => {
            raw += part;
            if (raw.length > 16384) req.destroy();
          });
          res.on('error', () => reject(Error('controller-status-unavailable')));
          res.on('end', () => {
            try {
              requireValue(res.statusCode === 200, 'controller-status-unavailable');
              resolve(JSON.parse(raw));
            } catch {
              reject(Error('controller-status-unavailable'));
            }
          });
        },
      );
      req.on('error', () => reject(Error('controller-status-unavailable')));
      req.end(body);
    });
  const auth = await request(
    '/login',
    'POST',
    JSON.stringify({ username: environment.SYNC_USER, password: environment.SYNC_PASS }),
  );
  requireValue(typeof auth.accessToken === 'string', 'controller-status-unavailable');
  return {
    idle: statusIdle(await request('/status', 'GET', undefined, auth.accessToken as string)),
  };
}
