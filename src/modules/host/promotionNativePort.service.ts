import { checkoutConfiguration } from '../../common/runtime/checkoutLayout';
import { GitlabPreflightService } from '../gitlab-preflight/gitlabPreflight.service';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { record } from '../release/sourceIdentity';
import { RuntimeVerificationService } from '../host-bootstrap/runtimeVerification.service';
import { ControllerLeaseService } from './controllerLease.service';
import { ControllerCheckpointService } from './controllerCheckpoint.service';
import { HostSourceService } from './source';
import { RecoveryImageService } from './recoveryImages';
import {
  RuntimeInspectionService,
  type RuntimeConfig,
  type ContainerRow,
} from './runtimeInspection';
import { HostInstallService, privateFile, writePrivate, requireValue as ensure } from './install';
import type { PromotionAbortPort, PromotionAbortInput } from './promotionAbort.service';
type Row = Record<string, unknown>;
export interface PromotionNativeInput {
  checkout: string;
  checkpoint: string;
  persistenceEnv: string;
  timeout: number;
}
export interface PromotionGitLabProbe {
  probe(
    container: Row,
    config: RuntimeConfig,
  ): Promise<{
    version: string;
    edition: string;
    unfinishedBackgroundMigrations: number;
    runningJobs: number;
  }>;
}
/** Direct native I/O for the same promotion/recovery services used by API and CLI. */
export class PromotionNativePortService implements PromotionAbortPort {
  private adopted = false;
  private context?: { input: PromotionNativeInput; config: RuntimeConfig };
  constructor(
    readonly host: HostInstallService,
    readonly runtime: RuntimeVerificationService,
    readonly lease: ControllerLeaseService,
    readonly checkpoints: ControllerCheckpointService,
    readonly source: HostSourceService,
    readonly images: RecoveryImageService,
    readonly inspection: RuntimeInspectionService,
    readonly gitlabProbe?: PromotionGitLabProbe,
    readonly nativeGitlabProbe?: GitlabPreflightService,
  ) {}

  private current() {
    ensure(this.context, 'promotion-native-context-required');
    return this.context!;
  }

  async prepare(input: PromotionNativeInput): Promise<PromotionAbortInput> {
    ensure(!this.context && this.host.rootUser(), 'root-and-idle-promotion-context-required');
    ensure(this.gitlabProbe || this.nativeGitlabProbe, 'native-GitLab-preflight-provider-required');
    ensure(
      Number.isInteger(input.timeout) && input.timeout >= 60 && input.timeout <= 3600,
      'bounded-promotion-readiness-timeout-required',
    );
    for (const value of [input.checkout, input.checkpoint, input.persistenceEnv]) {
      ensure(path.isAbsolute(value), 'absolute-promotion-input-required');
    }
    const config = await this.runtime.settings(
      input.persistenceEnv,
      input.checkout,
      this.host.environment,
    );
    const receipt = this.bytes(path.join(input.checkpoint, 'operation.json'));
    const before = this.bytes(path.join(input.checkpoint, 'main-before.env'));
    this.context = { input, config };
    return {
      record: record(JSON.parse(receipt.toString())),
      before: before.toString('base64'),
      checkout: input.checkout,
      timeout: input.timeout,
    };
  }

  finish(failed: boolean): void {
    try {
      if (this.adopted) {
        this.lease.finish(failed);
      }
    } finally {
      this.context = undefined;
      this.adopted = false;
    }
  }

  private bytes(filename: string): Buffer {
    privateFile(filename);
    const stat = fs.statSync(filename);
    ensure(stat.size <= 8 * 1024 ** 2, 'private-promotion-input-too-large');
    return fs.readFileSync(filename);
  }

  main(): string {
    return this.bytes(this.current().config._main).toString('base64');
  }

  checkout(release: Row): void {
    this.source.verifyCheckout(release, this.current().input.checkout);
  }

  image(id: string): Row {
    return { ...this.images.inspect(id) };
  }

  adopt(operation: string): void {
    const config = this.current().config;
    this.lease.adopt({ root: config._root, seedDirectory: config.SEED_DIR }, operation);
    this.adopted = true;
  }

  helper(): Row | null {
    const filename = path.join(this.current().input.checkpoint, 'copy-helper.json');
    return fs.existsSync(filename) ? record(JSON.parse(this.bytes(filename).toString())) : null;
  }

  async inspectOptional(id: string): Promise<Row | null> {
    try {
      return await this.inspect(id);
    } catch {
      return null;
    }
  }

  async inspect(id: string): Promise<Row> {
    // Before adoption only read-only identity probes run. Once owned, all Docker
    // commands share the descriptor inherited by the native guardian.
    const args = ['--host=unix:///var/run/docker.sock', 'inspect', id];
    let raw: string;
    try {
      this.lease.guardFd;
      raw = (await this.lease.command(['docker', ...args])).toString();
    } catch (error) {
      if (error instanceof Error && error.message === 'controller-lease-not-acquired') {
        raw = this.host.run('docker', args);
      } else {
        throw error;
      }
    }
    const rows: unknown = JSON.parse(raw);
    ensure(Array.isArray(rows) && rows.length === 1, 'exact-container-inspection-required');
    return record(rows[0]);
  }

  async command(args: string[], timeout = 300, input = ''): Promise<string> {
    return (
      await this.lease.command(
        ['docker', '--host=unix:///var/run/docker.sock', ...args],
        timeout,
        Buffer.from(input),
      )
    ).toString();
  }

  verifyCheckpoint(hash: string): void {
    this.checkpoints.verify(this.current().input.checkpoint, hash);
  }

  bootId(): string {
    return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  }

  uptime(): number {
    return Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
  }

  now(): number {
    return performance.now() / 1000;
  }

  async sleep(seconds: number): Promise<void> {
    ensure(Number.isFinite(seconds) && seconds >= 0 && seconds <= 182, 'invalid-maintenance-sleep');
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  mainHash(): string {
    return crypto.createHash('sha256').update(Buffer.from(this.main(), 'base64')).digest('hex');
  }

  async runners(): Promise<Row[]> {
    return this.runnersFor(this.current().config, (args) => this.command(args));
  }

  async runnersFor(
    config: RuntimeConfig,
    command: (args: string[]) => Promise<string>,
  ): Promise<Row[]> {
    const expected = this.images.inspect(config.GITLAB_RUNNER_IMAGE).Id;
    const ids = (await command(['ps', '-q'])).trim().split(/\s+/).filter(Boolean);

    if (!ids.length) {
      return [];
    }

    const values: unknown = JSON.parse(await command(['inspect', ...ids]));
    ensure(Array.isArray(values), 'invalid-runner-inspection');
    const selected: Row[] = [],
      root = fs.realpathSync(path.join(config._root, 'runners'));
    for (const input of values) {
      const row = record(input);

      if (row.Image !== expected) {
        continue;
      }

      ensure(Array.isArray(row.Mounts), 'invalid-runner-mounts');
      const mounts = row.Mounts.map(record).filter((mount) =>
        ['/etc/gitlab-runner', '/home/gitlab-runner'].includes(String(mount.Destination)),
      );
      const within = (mount: Row) =>
        typeof mount.Source === 'string' &&
        fs.realpathSync(mount.Source).startsWith(root + path.sep);

      if (!mounts.some(within)) {
        continue;
      }

      const labels = record(record(row.Config).Labels);
      ensure(
        labels['com.docker.compose.project'] &&
          String(labels['com.docker.compose.service']).startsWith('docker_') &&
          mounts.length === 2 &&
          mounts.every((mount) => mount.Type === 'bind' && within(mount)),
        'retained-runner-ownership-is-uncertain',
      );
      selected.push(row);
    }
    return selected;
  }

  async probe(): Promise<Row> {
    const { config, input } = this.current(),
      security = record(
        JSON.parse(
          fs.readFileSync(
            checkoutConfiguration(input.checkout, 'gitlab', 'security-release.json'),
            'utf8',
          ),
        ),
      ),
      row = await this.inspect('system_gitlab_1');
    const labels = record(record(row.Config).Labels),
      state = record(row.State);
    ensure(
      labels['com.docker.compose.project'] === 'system' &&
        labels['com.docker.compose.service'] === 'gitlab' &&
        state.Running &&
        !state.OOMKilled,
      'old-GitLab-is-not-running',
    );
    const proof = this.gitlabProbe
      ? await this.gitlabProbe.probe(row, config)
      : await this.nativeGitlabProbe!.probe(String(row.Id), {
          command: (args: string[], timeout: number, input?: string) =>
            this.command(args, timeout, input),
        });
    ensure(
      proof.version === security.fromVersion &&
        proof.edition === 'CE' &&
        Number.isInteger(proof.runningJobs) &&
        proof.unfinishedBackgroundMigrations === 0,
      'old-GitLab-version-jobs-or-migrations-block-promotion',
    );
    return proof;
  }

  phase(_value: string, _deadline?: number): void {
    /* Abort preserves the original promotion checkpoint phase. */
  }

  checkpoint(): never {
    throw Error('abort-must-not-create-database-checkpoint');
  }

  writeConfiguration(base64: string): void {
    writePrivate(this.current().config._main, Buffer.from(base64, 'base64'));
  }

  async reload(): Promise<void> {
    const { input } = this.current();
    this.current().config = await this.runtime.settings(
      input.persistenceEnv,
      input.checkout,
      this.host.environment,
    );
  }

  services(): Record<string, Row> {
    return this.runtime.services(this.current().config);
  }

  mounts(rows: Record<string, Row>): void {
    this.inspection.mounts(this.current().config, rows as Record<string, ContainerRow>);
  }

  async routes(rows: Record<string, Row>): Promise<void> {
    await this.runtime.routes(this.current().config, rows as Record<string, ContainerRow>);
  }

  async sync(): Promise<void> {
    await this.runtime.sync(this.current().config);
  }

  journal(value: Row): void {
    writePrivate(
      path.join(this.current().input.checkpoint, 'operation.json'),
      Buffer.from(JSON.stringify(value) + '\n'),
    );
  }

  timestamp(): string {
    return new Date().toISOString();
  }

  release(): void {
    this.lease.release();
    this.adopted = false;
  }

  async compose(args: string[], previousImage: string): Promise<void> {
    const config = this.current().config,
      environment: NodeJS.ProcessEnv = {
        ...this.host.environment,
        ...config,
        DOCKER_HOST: 'unix:///var/run/docker.sock',
        BOOTSTRAPPER_IMAGE: previousImage,
      };
    for (const key of [
      'DOCKER_CONTEXT',
      'DOCKER_TLS_VERIFY',
      'DOCKER_CERT_PATH',
      'SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER',
      '_root',
      '_main',
    ]) {
      delete environment[key];
    }
    await this.lease.command(
      ['docker', '--host=unix:///var/run/docker.sock', ...args],
      300,
      Buffer.alloc(0),
      environment,
    );
  }
}
