import { assertOperationActive } from './operation-cancellation';
import fs from 'node:fs';
import path from 'node:path';
import { record } from '../release/source-identity';
import {
  RuntimeVerificationService,
  serviceOrigin,
} from '../host-bootstrap/runtime-verification.service';
import { HostStorageService } from './host-storage.service';
import { requireValue as ensure, writePrivate } from './install';
import { readPrivateInput } from './private-input';
import { bytesSha, directoryBarrier } from './release-selection.service';
import { ConfigurationBackupArchive } from './configuration-backup-archive';
import type { RuntimeConfig } from './runtime-inspection';
type Row = Record<string, unknown>;
export class PublicUpgradeBackupService {
  constructor(
    readonly storage: HostStorageService,
    readonly runtime: RuntimeVerificationService,
  ) {}

  async target(
    config: RuntimeConfig,
    filename: string,
    checkout: string,
    persistenceEnv: string,
  ): Promise<string> {
    ensure(config.SEED_DIR && config.SEED_MOUNT, 'explicit-backup-filesystem-required');
    await this.storage.execute({
      operation: 'harvest',
      image: config.BOOTSTRAPPER_IMAGE,
      checkout,
      persistenceEnv,
      checkOnly: true,
    });
    const parent = path.dirname(filename),
      stat = fs.lstatSync(parent);
    ensure(
      path.isAbsolute(filename) &&
        path.resolve(filename) === filename &&
        !fs.lstatSync(filename, { throwIfNoEntry: false }) &&
        stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        fs.realpathSync(parent) === parent &&
        !filename.startsWith(config._root + path.sep) &&
        !filename.startsWith(checkout + path.sep) &&
        stat.dev === fs.statSync(config.SEED_DIR).dev,
      'new-configuration-backup-on-selected-backup-filesystem-required',
    );
    return filename;
  }

  async request(config: RuntimeConfig, route: string, body?: unknown): Promise<Row> {
    const origin = serviceOrigin(config, 'SYNC'),
      login = await this.runtime.http(origin + '/login', undefined, {
        username: config.SYNC_USER,
        password: config.SYNC_PASS,
      });
    ensure(login.status === 200, 'public-upgrade-sync-authentication-failed');
    const token = record(JSON.parse(login.body.toString())).accessToken;
    ensure(typeof token === 'string' && token, 'public-upgrade-sync-token-required');
    const response = await this.runtime.http(origin + route, undefined, body, {
      Authorization: 'Bearer ' + token,
    });
    ensure([200, 202].includes(response.status), 'public-upgrade-backup-request-failed');
    return record(JSON.parse(response.body.toString()));
  }

  async matching(
    config: RuntimeConfig,
    target: string,
    plan: Row,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<void> {
    ensure(
      Number.isInteger(timeout) && timeout >= 60 && timeout <= 7200,
      'bounded-backup-timeout-required',
    );
    assertOperationActive(signal);
    let status = await this.request(config, '/command/backup', {});
    const operation = status.id;
    ensure(
      typeof operation === 'string' && /^[a-f0-9]{32}$/.test(operation),
      'public-upgrade-backup-operation-required',
    );
    writePrivate(
      path.join(target, 'backup-operation.json'),
      Buffer.from(JSON.stringify({ id: operation }) + '\n'),
    );
    const until = performance.now() + timeout * 1000;
    while (status.state === 'working' && performance.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assertOperationActive(signal);
      status = await this.request(config, '/backup/' + operation);
    }
    assertOperationActive(signal);
    ensure(status.state === 'ready', 'matching-backup-not-complete-inspect-backup-operation');
    const configuration = record(status.configuration),
      seed = record(status.seed);
    ensure(
      status.state === 'ready' &&
        status.helperCompletedAt &&
        configuration.status === 'ready' &&
        seed.status === 'completed',
      'matching-backup-not-complete-inspect-backup-operation',
    );
    const root = path.dirname(config._main),
      raw = readPrivateInput(
        path.join(root, '.coordinated-backups', operation, 'bootstrapper.zip'),
        64 * 1024 ** 2,
      );
    ensure(bytesSha(raw) === configuration.sha256, 'matching-configuration-backup-hash-mismatch');
    const output = String(plan.configurationBackup);
    ensure(
      !fs.lstatSync(output, { throwIfNoEntry: false }) &&
        fs.statSync(path.dirname(output)).dev === fs.statSync(config.SEED_DIR).dev,
      'configuration-backup-destination-changed',
    );
    const fd = fs.openSync(
      output,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fs.writeFileSync(fd, raw);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    directoryBarrier(path.dirname(output));
    const archive = new ConfigurationBackupArchive(raw),
      association = record(record(JSON.parse(archive.read('recovery.json').toString())).seed);
    ensure(
      association.format === 'system-backup-pair-v1' &&
        association.verified === true &&
        association.status === 'matched-completed-seed' &&
        association.operation === operation &&
        ['generation', 'manifestSha256', 'gitlabImageId'].every(
          (key) => association[key] === seed[key],
        ),
      'configuration-Seed-pair-mismatch',
    );
    ensure(
      typeof seed.generation === 'string' && /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(seed.generation),
      'completed-Seed-manifest-mismatch',
    );
    const manifest = path.join(config.SEED_DIR, 'snapshots', seed.generation, 'manifest.json');
    ensure(
      !fs.lstatSync(manifest).isSymbolicLink() &&
        bytesSha(fs.readFileSync(manifest)) === seed.manifestSha256,
      'completed-Seed-manifest-mismatch',
    );
    const projects = path.join(root, '.projects.env'),
      files = association.configurationFiles,
      expected = [
        '.docker.env',
        ...(fs.existsSync(projects) ? fs.readdirSync(projects) : [])
          .filter((name) => name.endsWith('.env'))
          .sort()
          .map((name) => '.projects.env/' + name),
      ];
    ensure(
      Array.isArray(files) &&
        JSON.stringify(files.map((value) => record(value).filename)) === JSON.stringify(expected),
      'configuration-backup-file-set-mismatch',
    );
    for (const value of files) {
      const row = record(value),
        name = row.filename;
      ensure(
        typeof name === 'string' &&
          (name === '.docker.env' || /^\.projects\.env\/\.[A-Za-z0-9_.-]+\.env$/.test(name)),
        'invalid-backup-configuration-path',
      );
      ensure(
        bytesSha(archive.read(name)) === row.sha256 &&
          row.sha256 === bytesSha(fs.readFileSync(path.join(root, name))),
        'backup-no-longer-matches-live-configuration',
      );
    }
    ensure(
      bytesSha(fs.readFileSync(config._main)) === plan.configurationSha256,
      'configuration-changed-during-backup',
    );
    writePrivate(
      path.join(target, 'backup.json'),
      Buffer.from(
        JSON.stringify(
          { operation, configurationFile: output, sha256: bytesSha(raw), seed },
          null,
          2,
        ) + '\n',
      ),
    );
  }
}
