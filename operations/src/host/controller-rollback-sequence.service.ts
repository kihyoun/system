import { isDeepStrictEqual } from 'node:util';
import { record } from '../release/source-identity';
import { requireValue as ensure } from './install';
type NativeResult<T> = T | Promise<T>;
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
  journal(value: Row): NativeResult<void>;
  mainSha(): NativeResult<string>;
  pairedBaseline(baseline: Row): NativeResult<void>;
  verifySelection(checkpoint: boolean): NativeResult<void>;
  services(): NativeResult<Row>;
  stoppedIdle(): NativeResult<void>;
  repairPeers(services: Row): NativeResult<void>;
  critical(): NativeResult<void>;
  command(args: string[], reference?: string): NativeResult<void>;
  inspect(id: string): NativeResult<Row>;
  writeConfiguration(bytes: string, metadata: Row): NativeResult<void>;
  recoveredReceipt(value: Row): NativeResult<void>;
  writeSelection(): NativeResult<void>;
  reload(): NativeResult<void>;
  restoreStopped(baseline: Row): NativeResult<unknown>;
  waitReady(baseline: Row): NativeResult<unknown>;
  inspectServices(): NativeResult<Row>;
  now(): NativeResult<string>;
  verification(value: unknown): NativeResult<void>;
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
  async run(
    input: ControllerRollbackInput,
    port: ControllerRollbackPort = this.port,
  ): Promise<Row> {
    let state: Row = { ...input.record, leaseOperation: input.leaseOperation };
    const journal = async (phase?: string) => {
      if (phase) state.phase = phase;
      await port.journal(state);
    };
    await journal();
    ensure(
      [
        state.configurationBeforeSha256,
        state.configurationAfterSha256,
        state.recoveredConfigurationSha256,
      ].includes(await port.mainSha()),
      'controller-rollback-configuration-changed',
    );
    const baseline = structuredClone(input.baseline);
    await port.pairedBaseline(baseline);
    if (input.selection) {
      await port.verifySelection(false);
      await port.verifySelection(true);
    }
    const services = await port.services(),
      repair = state.repairStoppedController === true;
    const repairCheck = async (rows: Row) => {
      await port.stoppedIdle();
      await port.repairPeers(rows);
      runners(rows, state.previousRunnerContainerIds);
    };
    if (repair) {
      await repairCheck(services);
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
    await journal('rollback-started');
    await port.critical();
    if (services.system_bootstrapper_1) {
      const controller = record(services.system_bootstrapper_1),
        labels = record(record(controller.Config).Labels),
        current = record(controller.State);
      ensure(
        labels['com.docker.compose.project'] === 'system' &&
          labels['com.docker.compose.service'] === 'bootstrapper',
        'owned-core-container-required',
      );
      await port.command(['update', '--restart=no', String(controller.Id)]);
      if (current.Running) {
        ensure(!current.Paused, 'controller-update-refuses-paused-controller');
        await port.command(['stop', '--time', '30', String(controller.Id)]);
      }
      ensure(
        !record((await port.inspect(String(controller.Id))).State).Running,
        'previous-controller-did-not-stop',
      );
    }
    if (repair) {
      await port.stoppedIdle();
      const stopped = await port.services();
      await port.repairPeers(stopped);
      runners(stopped, state.previousRunnerContainerIds);
    }
    await port.writeConfiguration(input.before, record(state.configurationMetadata));
    if (state.recoveredImages) {
      await port.recoveredReceipt({
        format: 'system-public-recovered-images-v1',
        checkpoint: input.checkpoint,
        configurationSha256: state.recoveredConfigurationSha256,
        images: state.recoveredImages,
      });
      record(baseline.configurationFiles)['configuration/.docker.env'] =
        state.recoveredConfigurationSha256;
    }
    if (input.selection) await port.writeSelection();
    await port.reload();
    let receipt: unknown;
    if (repair) receipt = await port.restoreStopped(baseline);
    else {
      const previous = record(state.previousController);
      await port.command(
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
      baseline.startedAt = await port.now();
      receipt = await port.waitReady(baseline);
      const current = await port.inspectServices(),
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
      await port.command([
        'update',
        '--restart=' + restart,
        String((await port.inspect('system_bootstrapper_1')).Id),
      ]);
    }
    await port.verification(receipt);
    state = {
      ...state,
      phase: repair ? 'rolled-back-stopped' : 'rolled-back',
      rolledBackAt: await port.now(),
      databaseRewound: false,
    };
    await journal();
    return state;
  }
}
