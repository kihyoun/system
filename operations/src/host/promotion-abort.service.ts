import crypto from 'node:crypto';
import { record } from '../release/source-identity';
import { cube } from '../storage/configuration';
import { requireValue as ensure } from './install';
import {
  ColdMaintenanceService,
  type ColdMaintenancePort,
  type ColdMaintenanceInput,
} from './cold-maintenance.service';
type Row = Record<string, unknown>;
export interface PromotionAbortInput {
  record: Row;
  before: string;
  checkout: string;
  timeout: number;
}
export interface PromotionAbortPort extends ColdMaintenancePort {
  main(): string;
  checkout(release: Row): void;
  image(id: string): Row;
  adopt(operation: string): void;
  helper(): Row | null;
  inspectOptional(id: string): Row | null;
  verifyCheckpoint(hash: string): void;
  bootId(): string;
  runners(): Row[];
  writeConfiguration(base64: string): void;
  reload(): void;
  services(): Record<string, Row>;
  mounts(rows: Record<string, Row>): void;
  routes(rows: Record<string, Row>): void;
  sync(): void;
  journal(value: Row): void;
  timestamp(): string;
  release(): void;
  compose(args: string[], previousImage: string): void;
}
/** Resumes the exact pre-migration generation; an uncertain abort retains its lease. */
export class PromotionAbortService {
  constructor(
    readonly port: PromotionAbortPort,
    readonly cold: ColdMaintenanceService,
  ) {}
  run(input: PromotionAbortInput): void {
    const state = { ...input.record };
    ensure(
      state.format === 'system-controller-promotion-v1' &&
        ![
          'controller-promoted-old-GitLab-preserved',
          'aborted',
          'deferred-active-jobs-old-generation-resumed',
        ].includes(String(state.phase)) &&
        typeof state.leaseOperation === 'string' &&
        state.leaseOperation.length > 0,
      'only-interrupted-controller-promotion-can-be-aborted',
    );
    ensure(
      Number.isFinite(input.timeout) && input.timeout > 0 && input.checkout.startsWith('/'),
      'invalid-controller-abort-input',
    );
    this.port.checkout(record(state.release));
    const before = Buffer.from(input.before, 'base64');
    const hash = (value: string) =>
      crypto.createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex');
    ensure(
      hash(input.before) === state.configurationBeforeSha256 &&
        [state.configurationBeforeSha256, state.configurationAfterSha256].includes(
          hash(this.port.main()),
        ),
      'controller-abort-configuration-hash-mismatch',
    );
    cube(before);
    const gitlab = this.port.inspect('system_gitlab_1');
    this.owned(gitlab, 'gitlab');
    ensure(
      gitlab.Image === record(state.oldGitLab).imageId,
      'controller-abort-refuses-GitLab-image-change-use-database-checkpoint-recovery',
    );
    const previous = record(state.previousController),
      old = this.port.image(String(previous.imageId));
    ensure(old.Id === previous.imageId, 'previous-controller-image-is-unavailable');
    this.port.adopt(String(state.leaseOperation));
    const helper = this.port.helper();
    if (helper) {
      const remaining = this.port.inspectOptional(String(helper.name));
      if (remaining) {
        ensure(
          record(record(remaining.Config).Labels)['org.system-bootstrapper.controller-copy'] ===
            helper.owner,
          'checkpoint-helper-ownership-changed',
        );
        this.port.command(['rm', '--force', this.id(remaining)]);
      }
    }
    if (state.coldCheckpointSha256) this.port.verifyCheckpoint(String(state.coldCheckpointSha256));
    if (state.remoteCommandDeadlineUptime && this.port.bootId() === state.remoteCommandBootId) {
      const remaining = Number(state.remoteCommandDeadlineUptime) - this.port.uptime();
      ensure(
        Number.isFinite(remaining) && remaining < 180,
        'controller-abort-remote-deadline-invalid',
      );
      if (remaining > 0) this.port.sleep(remaining + 2);
    }
    const current = this.port.inspect('system_bootstrapper_1'),
      web = this.port.inspect('system_web_1');
    this.owned(current, 'bootstrapper');
    this.owned(web, 'web');
    if (this.state(web).Running) this.port.command(['stop', '--time', '30', this.id(web)]);
    if (this.state(current).Running) {
      this.port.command(['update', '--restart=no', this.id(current)]);
      if (!this.state(current).Paused) this.port.command(['pause', this.id(current)]);
    }
    if (this.state(gitlab).Running) {
      const context: ColdMaintenanceInput = {
        controller: current,
        gitlab,
        web,
        runners: [],
        deadline: 180,
        mainHash: hash(this.port.main()),
      };
      this.cold.drain(context);
      this.cold.quiesce(context);
      const early = [
        'public-web-stop-started',
        'old-controller-freeze-started',
        'scheduling-ingress-stop-started',
        'scheduling-ingress-stopped-final-jobs-zero',
        'old-ingress-resume-started',
        'old-generation-resumed-without-database-stop',
      ].includes(String(state.coldPhase));
      if (early && current.Image === old.Id && this.port.main() === input.before) {
        const controller = {
          ...current,
          HostConfig: { ...record(current.HostConfig), RestartPolicy: previous.restartPolicy },
        };
        this.cold.resume({ ...context, controller });
        this.complete(state);
        return;
      }
      for (const runner of this.port.runners())
        this.port.command(['stop', '--time', '30', this.id(runner)]);
      this.cold.cleanStop(context);
    } else
      ensure(
        this.state(gitlab).ExitCode === 0 && !this.state(gitlab).OOMKilled,
        'controller-abort-requires-clean-old-GitLab-state',
      );
    if (this.state(current).Running) {
      this.port.command(['kill', this.id(current)]);
      ensure(
        !this.state(this.port.inspect(this.id(current))).Running,
        'controller-abort-stop-uncertain',
      );
    }
    this.port.writeConfiguration(input.before);
    this.port.compose(
      [
        'compose',
        '--compatibility',
        '-p',
        'system',
        '-f',
        input.checkout + '/system/docker-compose.yml',
        'up',
        '--no-build',
        '--no-deps',
        '--pull',
        'never',
        '-d',
        'bootstrapper',
      ],
      String(previous.imageId),
    );
    this.port.reload();
    const deadline = this.port.now() + input.timeout;
    let rows: Record<string, Row>;
    for (;;) {
      try {
        rows = this.port.services();
        ensure(
          rows.system_bootstrapper_1.Image === old.Id &&
            rows.system_gitlab_1.Image === record(state.oldGitLab).imageId,
          'controller-abort-image-mismatch',
        );
        this.port.mounts(rows);
        this.port.routes(rows);
        this.port.sync();
        ensure(this.port.main() === input.before, 'controller-abort-config-changed');
        break;
      } catch {
        if (this.port.now() >= deadline) throw Error('controller-abort-acceptance-timeout');
        this.port.sleep(3);
      }
    }
    const policy = record(previous.restartPolicy);
    ensure(
      typeof policy.Name === 'string' &&
        ['no', 'always', 'unless-stopped', 'on-failure'].includes(policy.Name),
      'invalid-original-restart-policy',
    );
    let restart = policy.Name;
    if (restart === 'on-failure' && policy.MaximumRetryCount) {
      ensure(
        Number.isInteger(policy.MaximumRetryCount) && Number(policy.MaximumRetryCount) > 0,
        'invalid-original-restart-policy',
      );
      restart += ':' + String(policy.MaximumRetryCount);
    }
    this.port.command(['update', '--restart=' + restart, this.id(rows.system_bootstrapper_1)]);
    this.complete(state);
  }
  private complete(state: Row) {
    this.port.journal({
      ...state,
      phase: 'aborted',
      abortedAt: this.port.timestamp(),
      databaseRewound: false,
    });
    this.port.release();
  }
  private state(row: Row) {
    return record(row.State);
  }
  private id(row: Row) {
    ensure(typeof row.Id === 'string' && row.Id.length > 0, 'container-identity-required');
    return row.Id;
  }
  private owned(row: Row, service: string) {
    const labels = record(record(row.Config).Labels);
    ensure(
      labels['com.docker.compose.project'] === 'system' &&
        labels['com.docker.compose.service'] === service,
      'owned-core-container-required',
    );
  }
}
