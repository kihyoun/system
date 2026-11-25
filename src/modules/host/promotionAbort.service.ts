import { checkoutConfiguration } from '../../common/runtime/checkoutLayout';
import crypto from 'node:crypto';
import { record } from '../release/sourceIdentity';
import { cube } from '../storage/configuration';
import { requireValue as ensure } from './install';
import {
  ColdMaintenanceService,
  type ColdMaintenancePort,
  type ColdMaintenanceInput,
} from './coldMaintenance.service';
type Row = Record<string, unknown>;
export interface PromotionAbortInput {
  record: Row;
  before: string;
  checkout: string;
  timeout: number;
}
export interface PromotionAbortPort extends ColdMaintenancePort {
  main(): string | Promise<string>;
  checkout(release: Row): void | Promise<void>;
  image(id: string): Row | Promise<Row>;
  adopt(operation: string): void | Promise<void>;
  helper(): (Row | null) | Promise<Row | null>;
  inspectOptional(id: string): (Row | null) | Promise<Row | null>;
  verifyCheckpoint(hash: string): void | Promise<void>;
  bootId(): string | Promise<string>;
  runners(): Row[] | Promise<Row[]>;
  writeConfiguration(base64: string): void | Promise<void>;
  reload(): void | Promise<void>;
  services(): Record<string, Row> | Promise<Record<string, Row>>;
  mounts(rows: Record<string, Row>): void | Promise<void>;
  routes(rows: Record<string, Row>): void | Promise<void>;
  sync(): void | Promise<void>;
  journal(value: Row): void | Promise<void>;
  timestamp(): string | Promise<string>;
  release(): void | Promise<void>;
  compose(args: string[], previousImage: string): void | Promise<void>;
}
/** Resumes the exact pre-migration generation; an uncertain abort retains its lease. */
export class PromotionAbortService {
  constructor(
    readonly port: PromotionAbortPort,
    readonly cold: ColdMaintenanceService,
  ) {}

  async run(input: PromotionAbortInput): Promise<void> {
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
    await this.port.checkout(record(state.release));
    const before = Buffer.from(input.before, 'base64');
    const hash = (value: string) =>
      crypto.createHash('sha256').update(Buffer.from(value, 'base64')).digest('hex');
    ensure(
      hash(input.before) === state.configurationBeforeSha256 &&
        [state.configurationBeforeSha256, state.configurationAfterSha256].includes(
          hash(await this.port.main()),
        ),
      'controller-abort-configuration-hash-mismatch',
    );
    cube(before);
    const gitlab = await this.port.inspect('system_gitlab_1');
    this.owned(gitlab, 'gitlab');
    ensure(
      gitlab.Image === record(state.oldGitLab).imageId,
      'controller-abort-refuses-GitLab-image-change-use-database-checkpoint-recovery',
    );
    const previous = record(state.previousController),
      old = await this.port.image(String(previous.imageId));
    ensure(old.Id === previous.imageId, 'previous-controller-image-is-unavailable');
    await this.port.adopt(String(state.leaseOperation));
    const helper = await this.port.helper();

    if (helper) {
      const remaining = await this.port.inspectOptional(String(helper.name));

      if (remaining) {
        ensure(
          record(record(remaining.Config).Labels)['org.system-bootstrapper.controller-copy'] ===
            helper.owner,
          'checkpoint-helper-ownership-changed',
        );
        await this.port.command(['rm', '--force', this.id(remaining)]);
      }
    }

    if (state.coldCheckpointSha256) {
      await this.port.verifyCheckpoint(String(state.coldCheckpointSha256));
    }

    if (
      state.remoteCommandDeadlineUptime &&
      (await this.port.bootId()) === state.remoteCommandBootId
    ) {
      const remaining = Number(state.remoteCommandDeadlineUptime) - (await this.port.uptime());
      ensure(
        Number.isFinite(remaining) && remaining < 180,
        'controller-abort-remote-deadline-invalid',
      );

      if (remaining > 0) {
        await this.port.sleep(remaining + 2);
      }
    }

    const current = await this.port.inspect('system_bootstrapper_1'),
      web = await this.port.inspect('system_web_1');
    this.owned(current, 'bootstrapper');
    this.owned(web, 'web');

    if (this.state(web).Running) {
      await this.port.command(['stop', '--time', '30', this.id(web)]);
    }

    if (this.state(current).Running) {
      await this.port.command(['update', '--restart=no', this.id(current)]);

      if (!this.state(current).Paused) {
        await this.port.command(['pause', this.id(current)]);
      }
    }

    if (this.state(gitlab).Running) {
      const context: ColdMaintenanceInput = {
        controller: current,
        gitlab,
        web,
        runners: [],
        deadline: 180,
        mainHash: hash(await this.port.main()),
      };
      await this.cold.drain(context);
      await this.cold.quiesce(context);
      const early = [
        'public-web-stop-started',
        'old-controller-freeze-started',
        'scheduling-ingress-stop-started',
        'scheduling-ingress-stopped-final-jobs-zero',
        'old-ingress-resume-started',
        'old-generation-resumed-without-database-stop',
      ].includes(String(state.coldPhase));

      if (early && current.Image === old.Id && (await this.port.main()) === input.before) {
        const controller = {
          ...current,
          HostConfig: { ...record(current.HostConfig), RestartPolicy: previous.restartPolicy },
        };
        await this.cold.resume({ ...context, controller });
        await this.complete(state);
        return;
      }

      for (const runner of await this.port.runners()) {
        await this.port.command(['stop', '--time', '30', this.id(runner)]);
      }
      await this.cold.cleanStop(context);
    } else {
      ensure(
        this.state(gitlab).ExitCode === 0 && !this.state(gitlab).OOMKilled,
        'controller-abort-requires-clean-old-GitLab-state',
      );
    }

    if (this.state(current).Running) {
      await this.port.command(['kill', this.id(current)]);
      ensure(
        !this.state(await this.port.inspect(this.id(current))).Running,
        'controller-abort-stop-uncertain',
      );
    }

    await this.port.writeConfiguration(input.before);
    await this.port.compose(
      [
        'compose',
        '--compatibility',
        '-p',
        'system',
        '-f',
        checkoutConfiguration(input.checkout, 'system', 'docker-compose.yml'),
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
    await this.port.reload();
    const deadline = (await this.port.now()) + input.timeout;
    let rows: Record<string, Row>;
    for (;;) {
      try {
        rows = await this.port.services();
        ensure(
          rows.system_bootstrapper_1.Image === old.Id &&
            rows.system_gitlab_1.Image === record(state.oldGitLab).imageId,
          'controller-abort-image-mismatch',
        );
        await this.port.mounts(rows);
        await this.port.routes(rows);
        await this.port.sync();
        ensure((await this.port.main()) === input.before, 'controller-abort-config-changed');
        break;
      } catch {
        if ((await this.port.now()) >= deadline) {
          throw Error('controller-abort-acceptance-timeout');
        }

        await this.port.sleep(3);
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

    await this.port.command([
      'update',
      '--restart=' + restart,
      this.id(rows.system_bootstrapper_1),
    ]);
    await this.complete(state);
  }

  private async complete(state: Row): Promise<void> {
    await this.port.journal({
      ...state,
      phase: 'aborted',
      abortedAt: await this.port.timestamp(),
      databaseRewound: false,
    });
    await this.port.release();
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
