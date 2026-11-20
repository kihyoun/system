import { isDeepStrictEqual } from 'node:util';
import { record } from '../release/source-identity';
import { requireValue as ensure } from './install';
type Row = Record<string, unknown>;
export interface ControllerRollbackInput {
  record: Row;
  baseline: Row;
  before: string;
  selection: Row | null;
  leaseOperation: string;
  checkpoint: string;
  checkout: string;
}
export interface ControllerRollbackPort {
  journal(value: Row): void;
  mainSha(): string;
  pairedBaseline(baseline: Row): void;
  verifySelection(checkpoint: boolean): void;
  services(): Row;
  stoppedIdle(): void;
  repairPeers(services: Row): void;
  critical(): void;
  command(args: string[], reference?: string): void;
  inspect(id: string): Row;
  writeConfiguration(bytes: string, metadata: Row): void;
  recoveredReceipt(value: Row): void;
  writeSelection(): void;
  reload(): void;
  restoreStopped(baseline: Row): unknown;
  waitReady(baseline: Row): unknown;
  inspectServices(): Row;
  now(): string;
  verification(value: unknown): void;
}
function runners(services: Row, expected: unknown) {
  ensure(
    isDeepStrictEqual(
      Object.fromEntries(
        Object.entries(services)
          .filter(([name]) => name.startsWith('runner_docker_'))
          .map(([name, row]) => [name, record(row).Id]),
      ),
      expected,
    ),
    'repair-runner-containers-changed',
  );
}
export class ControllerRollbackSequenceService {
  constructor(readonly port: ControllerRollbackPort) {}
  run(input: ControllerRollbackInput): Row {
    let state: Row = { ...input.record, leaseOperation: input.leaseOperation };
    const journal = (phase?: string) => {
      if (phase) state.phase = phase;
      this.port.journal(state);
    };
    journal();
    ensure(
      [
        state.configurationBeforeSha256,
        state.configurationAfterSha256,
        state.recoveredConfigurationSha256,
      ].includes(this.port.mainSha()),
      'controller-rollback-configuration-changed',
    );
    const baseline = structuredClone(input.baseline);
    this.port.pairedBaseline(baseline);
    if (input.selection) {
      this.port.verifySelection(false);
      this.port.verifySelection(true);
    }
    const services = this.port.services(),
      repair = state.repairStoppedController === true;
    const repairCheck = (rows: Row) => {
      this.port.stoppedIdle();
      this.port.repairPeers(rows);
      runners(rows, state.previousRunnerContainerIds);
    };
    if (repair) {
      repairCheck(services);
      const controller = services.system_bootstrapper_1;
      ensure(
        !controller ||
          ('ExecIDs' in record(controller) &&
            (record(controller).ExecIDs === null ||
              (Array.isArray(record(controller).ExecIDs) &&
                (record(controller).ExecIDs as unknown[]).length === 0))),
        'repair-controller-active-or-unknown-execs',
      );
    }
    journal('rollback-started');
    this.port.critical();
    if (services.system_bootstrapper_1) {
      const controller = record(services.system_bootstrapper_1),
        labels = record(record(controller.Config).Labels),
        current = record(controller.State);
      ensure(
        labels['com.docker.compose.project'] === 'system' &&
          labels['com.docker.compose.service'] === 'bootstrapper',
        'owned-core-container-required',
      );
      this.port.command(['update', '--restart=no', String(controller.Id)]);
      if (current.Running) {
        ensure(!current.Paused, 'controller-update-refuses-paused-controller');
        this.port.command(['stop', '--time', '30', String(controller.Id)]);
      }
      ensure(
        !record(this.port.inspect(String(controller.Id)).State).Running,
        'previous-controller-did-not-stop',
      );
    }
    if (repair) {
      this.port.stoppedIdle();
      const stopped = this.port.services();
      this.port.repairPeers(stopped);
      runners(stopped, state.previousRunnerContainerIds);
    }
    this.port.writeConfiguration(input.before, record(state.configurationMetadata));
    if (state.recoveredImages) {
      this.port.recoveredReceipt({
        format: 'system-public-recovered-images-v1',
        checkpoint: input.checkpoint,
        configurationSha256: state.recoveredConfigurationSha256,
        images: state.recoveredImages,
      });
      record(baseline.configurationFiles)['configuration/.docker.env'] =
        state.recoveredConfigurationSha256;
    }
    if (input.selection) this.port.writeSelection();
    this.port.reload();
    let receipt: unknown;
    if (repair) receipt = this.port.restoreStopped(baseline);
    else {
      const previous = record(state.previousController);
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
        String(previous.reference),
      );
      baseline.startedAt = this.port.now();
      receipt = this.port.waitReady(baseline);
      const current = this.port.inspectServices(),
        expected = record(baseline.selectedImages);
      ensure(
        isDeepStrictEqual(Object.keys(current).sort(), Object.keys(expected).sort()),
        'controller-update-service-set-changed',
      );
      for (const [name, selected] of Object.entries(expected))
        if (name !== 'system_bootstrapper_1')
          ensure(
            record(current[name]).Image === record(selected).imageId,
            'controller-update-service-image-changed',
          );
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
      this.port.command([
        'update',
        '--restart=' + restart,
        String(this.port.inspect('system_bootstrapper_1').Id),
      ]);
    }
    this.port.verification(receipt);
    state = {
      ...state,
      phase: repair ? 'rolled-back-stopped' : 'rolled-back',
      rolledBackAt: this.port.now(),
      databaseRewound: false,
    };
    journal();
    return state;
  }
}
