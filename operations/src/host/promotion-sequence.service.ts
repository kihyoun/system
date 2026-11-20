import { record } from '../release/source-identity';
import { requireValue as ensure } from './install';
import { ActiveMaintenanceJobs } from './cold-maintenance.service';
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
  main(): string;
  sha(which: 'manifest' | 'staged-operation'): string;
  inspect(id: string): Row;
  assertBaseline(value: Row): void;
  pipeline(): void;
  critical(value: boolean): void;
  journal(value: Row): void;
  readJournal(): Row;
  runners(): unknown[];
  cold(value: Row, runners: unknown[]): string;
  syncIdle(): void;
  command(args: string[], promotionEnvironment?: boolean): void;
  writeConfiguration(value: string): void;
  reload(): void;
  waitStaged(baseline: Row): void;
  gitlabPreflight(): void;
  now(): string;
}
/** Destructive promotion sequence; durable outer lease remains held by its native owner. */
export class PromotionSequenceService {
  constructor(readonly port: PromotionSequencePort) {}
  run(input: PromotionSequenceInput): Row {
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
    const journal = (phase?: string) => {
      if (phase) state.phase = phase;
      this.port.journal(state);
    };
    journal();
    ensure(this.port.main() === input.rawMain, 'configuration-changed-before-controller-promotion');
    if (input.stagedReceipt) {
      ensure(
        this.port.sha('manifest') === input.stagedReceipt.manifestSha256,
        'staged-controller-recovery-manifest-changed',
      );
      ensure(
        this.port.sha('staged-operation') === input.stagedReceipt.operationSha256,
        'staged-controller-operation-changed',
      );
      ensure(
        this.port.inspect('system_bootstrapper_1').Id === controller.Id &&
          this.port.inspect('system_gitlab_1').Image === gitlab.Image,
        'staged-controller-services-changed',
      );
      this.port.assertBaseline(input.baseline);
    }
    this.port.pipeline();
    if (input.cold) {
      const runners = this.port.runners();
      this.port.critical(true);
      journal('cold-maintenance-started');
      try {
        const digest = this.port.cold(state, runners);
        state = this.port.readJournal();
        state.coldCheckpointSha256 = digest;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'new-running-jobs-refused-maintenance-old-generation-resumed'
        ) {
          state = this.port.readJournal();
          journal('deferred-active-jobs-old-generation-resumed');
          this.port.critical(false);
          throw new ActiveMaintenanceJobs(error.message);
        }
        throw error;
      }
    } else {
      // The caller's Sync port checks idleness again immediately before stopping.
      this.port.syncIdle();
      this.port.critical(true);
      journal('controller-stop-started');
      this.port.command(['update', '--restart=no', String(controller.Id)]);
      this.port.command(['stop', '--time', '30', String(controller.Id)]);
      ensure(
        !record(this.port.inspect(String(controller.Id)).State).Running,
        'old-controller-did-not-stop',
      );
    }
    journal('pre-promotion-checkpoint-complete');
    ensure(this.port.main() === input.rawMain, 'configuration-changed-during-controller-stop');
    this.port.writeConfiguration(input.updatedMain);
    journal('controller-start-started');
    this.port.command(
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
      true,
    );
    this.port.reload();
    const baseline = structuredClone(input.baseline),
      files = record(baseline.configurationFiles);
    files['configuration/.docker.env'] = state.configurationAfterSha256;
    baseline.hostToolsRevision = input.release.sourceRevision;
    this.port.waitStaged(baseline);
    this.port.gitlabPreflight();
    state = {
      ...state,
      phase: 'controller-promoted-old-GitLab-preserved',
      completedAt: this.port.now(),
      newControllerId: this.port.inspect('system_bootstrapper_1').Id,
      oldGitLabImagePreserved: true,
      configurationChangedOnlyControllerImage: true,
      managerIdentitiesPreserved: true,
      GitLabMigrationStarted: false,
    };
    journal();
    return state;
  }
}
