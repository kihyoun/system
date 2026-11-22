import { checkoutLayout } from '../../common/runtime/checkout-layout';
import fs from 'node:fs';
import { HostPersistenceService } from '../host-lifecycle/persistence.service';
import { randomBytes } from 'node:crypto';
import { NativeHostAttachedProcess, type HostAttachedProcess } from './attached-process';
import path from 'node:path';
import { HostInstallService, HostPolicyError, privateFile, requireValue } from './install';
export interface HostStorageCommand {
  operation: 'harvest' | 'restore';
  image: string;
  checkout: string;
  persistenceEnv: string;
  configurationBackup?: string;
  checkOnly?: boolean;
}
/** Host launch boundary: the accepted image owns leases and storage mutations. */
export class HostStorageService {
  constructor(
    readonly host: HostInstallService,
    readonly attached: HostAttachedProcess = new NativeHostAttachedProcess(),
    readonly persistence = new HostPersistenceService(),
  ) {}

  private runtime(imageId: string): string[] {
    let command: unknown;
    try {
      command = JSON.parse(
        this.host.run(
          'docker',
          [
            '--host=unix:///var/run/docker.sock',
            'image',
            'inspect',
            '--format',
            '{{json .Config.Cmd}}',
            imageId,
          ],
          undefined,
          10000,
        ),
      );
    } catch {
      throw new HostPolicyError('accepted-controller-image-layout-unavailable');
    }
    const matches = (expected: readonly string[]): boolean =>
      Array.isArray(command) &&
      command.length === expected.length &&
      command.every((value, index) => value === expected[index]);
    if (matches(['/bin/bash', './start.sh'])) return ['/system/system/seed-operation.js', 'host'];
    if (matches(['system-bootstrapper', 'lifecycle', 'start', '/system']))
      return ['/system/dist/cli/main.js', 'storage', 'host'];
    throw new HostPolicyError('unsupported-controller-image-layout');
  }

  async execute(command: HostStorageCommand): Promise<void> {
    requireValue(this.host.rootUser(), 'host-storage-requires-root');
    requireValue(
      command.operation === 'harvest' || command.operation === 'restore',
      'invalid-host-storage-operation',
    );
    requireValue(
      command.image && !command.image.startsWith('-') && !/[\0\r\n]/.test(command.image),
      'accepted-controller-image-required',
    );
    requireValue(
      path.isAbsolute(command.checkout) && fs.statSync(command.checkout).isDirectory(),
      'explicit-host-checkout-required',
    );
    checkoutLayout(command.checkout);
    privateFile(command.persistenceEnv);
    const { selected } = this.host.storage(command.persistenceEnv, command.checkout);
    const id = this.host
      .run('docker', [
        '--host=unix:///var/run/docker.sock',
        'image',
        'inspect',
        '--format',
        '{{.Id}}',
        command.image,
      ])
      .trim();
    requireValue(/^sha256:[a-f0-9]{64}$/.test(id), 'accepted-controller-image-id-required');
    // During an upgrade the target checkout and installed image have different layouts.
    const runtime = this.runtime(id);
    if (!command.checkOnly)
      await this.persistence.prepare({
        ...this.host.environment,
        ...selected,
      });
    const backup = command.configurationBackup ?? '';
    if (backup) {
      const stat = fs.lstatSync(backup);
      requireValue(
        command.operation === 'restore' &&
          path.isAbsolute(backup) &&
          stat.isFile() &&
          !stat.isSymbolicLink(),
        'invalid-configuration-backup',
      );
    }
    const name = 'system-storage-launcher-' + randomBytes(12).toString('hex');
    const container = this.host
      .run('docker', [
        '--host=unix:///var/run/docker.sock',
        'create',
        '--interactive',
        '--name',
        name,
        '--label',
        `system.storage.launcher=${name}`,
        '--network',
        'none',
        '--entrypoint',
        'node',
        '--mount',
        'type=bind,src=/,dst=/host,readonly',
        '--mount',
        'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
        '--env',
        `PERSISTENCE_ENV_FILE=${command.persistenceEnv}`,
        '--env',
        `SYSTEM_SEED_CONTROLLER_IMAGE=${id}`,
        '--env',
        `SYSTEM_SEED_CONFIGURATION_BACKUP=${backup}`,
        id,
        ...runtime,
        command.operation,
        ...(command.checkOnly ? ['--check-only'] : []),
      ])
      .trim();
    requireValue(/^[a-f0-9]{64}$/.test(container), 'host-storage-launch-outcome-uncertain');
    const env = { ...this.host.environment, DOCKER_HOST: 'unix:///var/run/docker.sock' };
    for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'])
      delete (env as NodeJS.ProcessEnv)[key];
    // On interruption/disconnection retain the exact owned container and inner durable lease.
    // Never claim cancellation completed or remove a possibly running storage operation.
    await this.attached.run(
      'docker',
      ['--host=unix:///var/run/docker.sock', 'start', '--attach', '--interactive', container],
      env,
    );
    const observed = JSON.parse(
      this.host.run('docker', [
        '--host=unix:///var/run/docker.sock',
        'container',
        'inspect',
        container,
      ]),
    );
    const row = Array.isArray(observed) && observed.length === 1 ? observed[0] : null;
    requireValue(
      row?.Id === container &&
        row?.Image === id &&
        row?.Config?.Labels?.['system.storage.launcher'] === name &&
        row?.State?.Status === 'exited' &&
        row.State.Running === false &&
        row.State.ExitCode === 0,
      'host-storage-launch-outcome-uncertain',
    );
    this.host.run('docker', ['--host=unix:///var/run/docker.sock', 'rm', container]);
  }
}
