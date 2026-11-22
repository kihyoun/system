import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ProcessRunner, ProcessFailure } from '../../common/runtime/process';
import { StorageSpec, requireValue } from './types';
import { StorageCommandDto } from './storageCommand.dto';
import * as validation from './validation';
import * as leases from './lease';
import * as manifest from './manifest';
import * as config from './configuration';
import * as helper from './helper';
import * as coordinated from './coordinatedBackup';
import { harvest, restore, nativeCopyRuntime } from './copy';
export const storageProcessRunner = Symbol('STORAGE_PROCESS_RUNNER');
export const storagePreviewNormalizer = Symbol('STORAGE_PREVIEW_NORMALIZER');

export function storageSpec(input: unknown): StorageSpec {
  requireValue(
    !!input && typeof input === 'object' && !Array.isArray(input),
    'invalid-storage-spec',
  );
  const record = input as Record<string, unknown>;
  for (const key of [
    'PERSISTENCE_MODE',
    'PERSISTENT_MOUNT',
    'PERSISTENT_DIR',
    'PERSISTENT_UUID',
    'SEED_DIR',
    'SEED_MOUNT',
    'SEED_UUID',
    'GITLAB_IMAGE',
    'SYSTEM_WIZARD_CANONICAL_CONTROLLER',
    'helperName',
    'imageId',
    'coordinatedBackup',
  ]) {
    requireValue(
      record[key] === undefined || typeof record[key] === 'string',
      'invalid-storage-spec',
    );
  }
  requireValue(
    record.operation === undefined ||
      record.operation === 'harvest' ||
      record.operation === 'restore',
    'invalid-seed-operation',
  );
  for (const key of ['checkOnly', 'backup']) {
    requireValue(
      record[key] === undefined || typeof record[key] === 'boolean',
      'invalid-storage-spec',
    );
  }
  return record as StorageSpec;
}
@Injectable()
export class StorageService {
  constructor(
    @Inject(storageProcessRunner) private readonly runner: ProcessRunner,
    @Inject(storagePreviewNormalizer)
    private readonly normalizePreview: coordinated.PreviewNormalizer,
  ) {}

  async run(command: StorageCommandDto): Promise<unknown> {
    const environment = command.environment ?? process.env;
    const state = environment.SYSTEM_CONFIG_DIR || '/state';
    switch (command.action) {
      case 'inside':
        return this.inside(storageSpec(JSON.parse(environment.SYSTEM_STORAGE_SPEC || 'null')));
      case 'validate':
        return validation.validate(
          storageSpec(JSON.parse(environment.SYSTEM_STORAGE_SPEC || 'null')),
        );
      case 'prepare-local':
        return validation.prepareLocal(environment);
      case 'startup-check':
        return leases.startupAllowed(
          state,
          environment.SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER === '1',
        );
      case 'startup-begin':
        requireValue(command.ownerPid, 'invalid-startup-owner');
        return leases.startupBegin(state, command.ownerPid);
      case 'startup-finish':
        return leases.startupFinish(state, environment.SYSTEM_STARTUP_OPERATION);
      case 'startup-settled':
        return leases.startupSettled(
          state,
          environment.SYSTEM_STARTUP_OPERATION,
          command.exitCode ?? null,
        );
      case 'sync-status':
        return helper.syncStatus(environment);
      case 'host':
      case 'launch':
        requireValue(
          command.operation === 'harvest' || command.operation === 'restore',
          'invalid-seed-operation',
        );
        return this.launch(command.operation, {
          environment,
          host: command.action === 'host',
          checkOnly: command.checkOnly,
          backup: command.backup,
        });
      default:
        throw new Error('invalid-seed-operation');
    }
  }

  launch(
    operation: 'harvest' | 'restore',
    options: {
      environment?: NodeJS.ProcessEnv;
      host?: boolean;
      checkOnly?: boolean;
      backup?: string;
    } = {},
  ): void {
    const environment = options.environment ?? process.env,
      run = helper.dockerRun(this.runner);
    const spec = config.configuration(environment, options.host, this.runner);

    if (environment.SYSTEM_COORDINATED_BACKUP) {
      requireValue(
        operation === 'harvest' && /^[a-f0-9]{32}$/.test(environment.SYSTEM_COORDINATED_BACKUP),
        'invalid-backup-operation',
      );
      spec.coordinatedBackup = environment.SYSTEM_COORDINATED_BACKUP;
    }

    requireValue(spec.SEED_DIR, 'seed-target-unavailable');
    const image = options.host
      ? environment.SYSTEM_SEED_CONTROLLER_IMAGE
      : JSON.parse(
          run(['inspect', spec.SYSTEM_WIZARD_CANONICAL_CONTROLLER || 'system_bootstrapper_1']),
        )[0].Image;
    requireValue(
      typeof image === 'string' && /^sha256:[a-f0-9]{64}$/.test(image),
      'invalid-helper-identity',
    );
    run([
      'run',
      '--rm',
      '--network',
      'none',
      '--entrypoint',
      'node',
      '--mount',
      'type=bind,src=/,dst=/host,readonly',
      '--env',
      'SYSTEM_STORAGE_SPEC=' + JSON.stringify(spec),
      image,
      '/system/dist/cli/main.js',
      'storage',
      'validate',
    ]);
    const name = 'system-storage-' + operation + '-' + crypto.randomBytes(12).toString('hex');
    let created = false;
    try {
      run(helper.helperArguments(spec, image, name, operation, options.checkOnly, options.backup));
      created = true;
      run(['start', '--attach', name], { timeout: 3600000 });
    } finally {
      if (created) {
        const row = JSON.parse(run(['inspect', name]))[0];
        requireValue(
          row.Image === image &&
            row.Config.Labels?.['org.system-bootstrapper.storage-operation'] === name,
          'seed-helper-identity-changed',
        );
        requireValue(row.State.Running === false, 'seed-helper-still-running');
        run(['rm', name]);

        if (spec.coordinatedBackup) {
          coordinated.helperCompleted(
            environment.SYSTEM_CONFIG_DIR || '/state',
            spec.coordinatedBackup,
          );
        }
      }
    }
  }

  inside(spec: StorageSpec): void {
    const selected = validation.validate(spec),
      run = helper.dockerRun(this.runner);
    requireValue(
      spec.operation === 'harvest' || spec.operation === 'restore',
      'invalid-seed-operation',
    );
    for (const [host, container] of [
      [selected.live, '/live'],
      [selected.seed, '/seed'],
      [selected.live + '/gitlab/config', '/srv/gitlab/config'],
      [selected.live + '/gitlab/logs', '/srv/gitlab/log'],
      [selected.live + '/gitlab/data', '/srv/gitlab/data'],
    ]) {
      const expected = fs.statSync('/host' + host),
        actual = fs.statSync(container);
      requireValue(
        expected.dev === actual.dev && expected.ino === actual.ino,
        'operation-bind-source-changed',
      );
    }
    requireValue(
      fs.readFileSync('/live/.system-bootstrapper-volume', 'utf8') ===
        'system-bootstrapper-persistence-v1\n',
      'unrecognized-live-storage',
    );
    const state = '/live/configuration';
    for (const name of [
      '.storage-operation-lock',
      '.gitlab-upgrade-lock',
      '.projects.env/.wizard.env.environments.lock',
    ]) {
      requireValue(
        !fs.lstatSync(path.join(state, name), { throwIfNoEntry: false }),
        'storage-operation-busy',
      );
    }
    requireValue(
      !fs.lstatSync('/seed/.operation-lock', { throwIfNoEntry: false }),
      'storage-operation-busy',
    );

    if (spec.backup) {
      config.validateBackup('/system/bootstrapper.zip', this.runner);
    }

    const image = helper.configurationImage(spec, this.runner);
    process.env.GITLAB_IMAGE = image;
    helper.gitlabOwnership(spec, image, run);

    if (spec.operation === 'restore') {
      validation.restoreEmpty();
      const current = manifest.current('/seed'),
        recorded = manifest.verify(current);
      requireValue(
        run(['image', 'inspect', '--format', '{{.Id}}', image]) === recorded.gitlabImageId,
        'seed-image-identity-mismatch',
      );
      const size = recorded.entries.reduce((total, entry) => total + (entry.size || 0), 0),
        space = fs.statfsSync('/live');
      requireValue(
        space.bavail * space.bsize > size * 1.25 + 16 * 1024 * 1024,
        'live-target-insufficient-space',
      );
    }

    const writable = fs.statfsSync('/seed');
    requireValue(
      writable.bavail * writable.bsize > 16 * 1024 * 1024,
      'seed-target-insufficient-space',
    );

    if (spec.operation === 'harvest') {
      const size = this.runner.run('du', [
        '-sk',
        '/live/gitlab',
        '/live/ssl',
        '/live/host/letsencrypt',
      ]).stdout;
      const bytes = size
        .trim()
        .split('\n')
        .reduce((total, line) => total + Number(line.split(/\s/)[0]) * 1024, 0);
      requireValue(
        Number.isFinite(bytes) &&
          writable.bavail * writable.bsize > bytes * 1.25 + 16 * 1024 * 1024,
        'seed-target-insufficient-space',
      );
    }

    if (spec.checkOnly) {
      return;
    }

    const held = new leases.StorageLease(state, spec);
    let safeRelease = true;
    try {
      if (spec.operation === 'restore') {
        validation.restoreEmpty();
      }

      requireValue(
        !fs.lstatSync(path.join(state, '.gitlab-upgrade-lock'), { throwIfNoEntry: false }),
        'storage-operation-busy',
      );
      helper.gitlabOwnership(spec, image, run);
      held.acquireEnvironment();

      if (spec.operation === 'harvest') {
        helper.controllerIdle(spec, run);
      }

      if (spec.backup) {
        requireValue(spec.operation === 'restore', 'restore-configuration-already-exists');
        config.importFreshConfiguration('/system/bootstrapper.zip', state, this.runner);
      }

      const main = path.join(state, '.docker.env');
      requireValue(fs.existsSync(main), 'matching-configuration-backup-required');
      config.cube(fs.readFileSync(main));
      const selectedImages = config.readAssignments(
        main,
        ['GITLAB_IMAGE', 'GITLAB_RUNNER_IMAGE'],
        process.env,
        this.runner,
      );
      process.env.GITLAB_IMAGE = selectedImages.GITLAB_IMAGE || image;
      process.env.GITLAB_RUNNER_IMAGE = selectedImages.GITLAB_RUNNER_IMAGE;
      const paths = {
        seed: '/seed',
        srv: '/srv',
        ssl: '/live/ssl',
        certbot: '/live/host/letsencrypt',
        gitlab: 'system_gitlab_1',
      };
      const runtime = { ...nativeCopyRuntime, process: this.runner };
      const perform = (token?: string) => {
        try {
          if (spec.operation === 'harvest') {
            harvest(paths, runtime, token);
          } else {
            restore(paths, runtime);
          }
        } catch (error) {
          if (
            (error instanceof ProcessFailure && error.uncertain) ||
            (error instanceof Error && 'uncertain' in error && error.uncertain === true)
          ) {
            safeRelease = false;
          }

          throw error;
        }
      };

      if (spec.coordinatedBackup) {
        requireValue(spec.operation === 'harvest', 'invalid-backup-operation');
        coordinated.runWorkflow({
          state,
          seed: '/seed',
          certbot: paths.certbot,
          id: spec.coordinatedBackup,
          harvest: perform,
          exporter: (input, output) => coordinated.exportZip(input, output, this.runner),
          seedTarget: selected.seed,
          normalizePreview: this.normalizePreview,
        });
      } else {
        perform();
      }
    } finally {
      try {
        held.release(safeRelease);
      } catch (error) {
        if (spec.coordinatedBackup) {
          const root = coordinated.directory(state, spec.coordinatedBackup),
            status = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'));
          coordinated.writeStatus(root, {
            ...status,
            state: status.seed ? 'partial' : 'failed',
            phase: 'needs-inspection',
            error: 'storage-lease-cleanup-failed',
            configuration: { status: 'unavailable' },
          });
        }

        throw error;
      }
    }
  }
}
