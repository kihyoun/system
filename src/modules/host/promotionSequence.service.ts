import { checkoutConfiguration } from '../../common/runtime/checkoutLayout';
import { record } from '../release/sourceIdentity';
import { requireValue as ensure } from './install';
import { ActiveMaintenanceJobs } from './coldMaintenance.service';
type Row = Record<string, unknown>;
export interface PromotionSequenceInput {
  record: Row;
  controller: Row;
  gitlab: Row;
  baseline: Row;
  release: Row;
  rawMain: string;
  updatedMain: string;
  cold: boolean;
  stagedReceipt: Row | null;
  checkout: string;
  timeout: number;
  leaseOperation: string;
}
export interface PromotionSequencePort {
  main(): string | Promise<string>;
  sha(which: 'manifest' | 'staged-operation'): string | Promise<string>;
  inspect(id: string): Row | Promise<Row>;
  assertBaseline(value: Row): void | Promise<void>;
  pipeline(): void | Promise<void>;
  critical(value: boolean): void | Promise<void>;
  journal(value: Row): void | Promise<void>;
  readJournal(): Row | Promise<Row>;
  runners(): unknown[] | Promise<unknown[]>;
  cold(value: Row, runners: unknown[]): string | Promise<string>;
  syncIdle(): void | Promise<void>;
  command(args: string[], promotionEnvironment?: boolean): void | Promise<void>;
  writeConfiguration(value: string): void | Promise<void>;
  reload(): void | Promise<void>;
  waitStaged(baseline: Row): void | Promise<void>;
  gitlabPreflight(): void | Promise<void>;
  now(): string | Promise<string>;
}
/** Destructive promotion sequence; durable outer lease remains held by its native owner. */
export class PromotionSequenceService {
  constructor(readonly port: PromotionSequencePort) {}

  async run(input: PromotionSequenceInput, port = this.port): Promise<Row> {
    ensure(
      input.record.format === 'system-controller-promotion-v1' &&
        input.record.phase === 'inputs-verified' &&
        typeof input.rawMain === 'string' &&
        typeof input.updatedMain === 'string' &&
        typeof input.checkout === 'string' &&
        input.checkout.startsWith('/') &&
        typeof input.leaseOperation === 'string' &&
        input.leaseOperation.length > 0,
      'invalid-promotion-sequence-input',
    );
    let state: Row = { ...input.record, leaseOperation: input.leaseOperation };
    const controller = input.controller,
      gitlab = input.gitlab;
    const journal = async (phase?: string) => {
      if (phase) {
        state.phase = phase;
      }

      await port.journal(state);
    };
    await journal();
    ensure(
      (await port.main()) === input.rawMain,
      'configuration-changed-before-controller-promotion',
    );

    if (input.stagedReceipt) {
      ensure(
        (await port.sha('manifest')) === input.stagedReceipt.manifestSha256,
        'staged-controller-recovery-manifest-changed',
      );
      ensure(
        (await port.sha('staged-operation')) === input.stagedReceipt.operationSha256,
        'staged-controller-operation-changed',
      );
      ensure(
        (await port.inspect('system_bootstrapper_1')).Id === controller.Id &&
          (await port.inspect('system_gitlab_1')).Image === gitlab.Image,
        'staged-controller-services-changed',
      );
      await port.assertBaseline(input.baseline);
    }

    await port.pipeline();

    if (input.cold) {
      const runners = await port.runners();
      await port.critical(true);
      await journal('cold-maintenance-started');
      try {
        const digest = await port.cold(state, runners);
        state = await port.readJournal();
        state.coldCheckpointSha256 = digest;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'new-running-jobs-refused-maintenance-old-generation-resumed'
        ) {
          state = await port.readJournal();
          await journal('deferred-active-jobs-old-generation-resumed');
          await port.critical(false);
          throw new ActiveMaintenanceJobs(error.message);
        }

        throw error;
      }
    } else {
      // The caller's Sync port checks idleness again immediately before stopping.
      await port.syncIdle();
      await port.critical(true);
      await journal('controller-stop-started');
      await port.command(['update', '--restart=no', String(controller.Id)]);
      await port.command(['stop', '--time', '30', String(controller.Id)]);
      ensure(
        !record((await port.inspect(String(controller.Id))).State).Running,
        'old-controller-did-not-stop',
      );
    }

    await journal('pre-promotion-checkpoint-complete');
    ensure((await port.main()) === input.rawMain, 'configuration-changed-during-controller-stop');
    await port.writeConfiguration(input.updatedMain);
    await journal('controller-start-started');
    await port.command(
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
      true,
    );
    await port.reload();
    const baseline = structuredClone(input.baseline),
      files = record(baseline.configurationFiles);
    files['configuration/.docker.env'] = state.configurationAfterSha256;
    baseline.hostToolsRevision = input.release.sourceRevision;
    await port.waitStaged(baseline);
    await port.gitlabPreflight();
    state = {
      ...state,
      phase: 'controller-promoted-old-GitLab-preserved',
      completedAt: await port.now(),
      newControllerId: (await port.inspect('system_bootstrapper_1')).Id,
      oldGitLabImagePreserved: true,
      configurationChangedOnlyControllerImage: true,
      managerIdentitiesPreserved: true,
      GitLabMigrationStarted: false,
    };
    await journal();
    return state;
  }
}
