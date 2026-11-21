import { checkoutConfiguration } from '../../common/runtime/checkout-layout';
import { isDeepStrictEqual } from 'node:util';
import { record } from '../release/source-identity';
import { requireValue as ensure } from './install';
type NativeResult<T> = T | Promise<T>;
type Row = Record<string, unknown>;
export interface ControllerUpdateSequenceInput {
  record: Row;
  baseline: Row;
  expectedBaseline: Row | null;
  original: Row;
  selection: Row | null;
  stoppedId: string | null;
  pulled: Row;
  wizard: Row | null;
  publication: unknown;
  release: Row;
  updated: string;
  metadata: Row;
  leaseOperation: string;
  checkout: string;
}
export interface ControllerUpdateSequencePort {
  journal(value: Row): NativeResult<void>;
  assertBaseline(value: Row): NativeResult<void>;
  verifySelection(checkpoint: boolean): NativeResult<void>;
  publicImages(): NativeResult<unknown>;
  pipeline(): NativeResult<void>;
  publicPair(): NativeResult<unknown>;
  syncIdle(): NativeResult<void>;
  currentServices(): NativeResult<Row>;
  repairBaseline(current: Row): NativeResult<void>;
  critical(): NativeResult<void>;
  command(args: string[], reference?: string): NativeResult<void>;
  inspect(id: string): NativeResult<Row>;
  writeConfiguration(bytes: string, metadata: Row): NativeResult<void>;
  writeSelection(): NativeResult<void>;
  now(): NativeResult<string>;
  reload(): NativeResult<void>;
  saveBaseline(value: Row): NativeResult<void>;
  waitReady(value: Row): NativeResult<unknown>;
  services(): NativeResult<Row>;
  saveVerification(value: unknown): NativeResult<void>;
}
function runnerContainers(services: Row, expected: unknown): void {
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
function unchangedServices(services: Row, baseline: Row, wizard: boolean): void {
  const expected = record(baseline.selectedImages),
    names = Object.keys(services),
    required = Object.keys(expected).filter((name) => !wizard || name !== 'system_wizard_1');
  ensure(
    required.every((name) => names.includes(name)) && names.every((name) => name in expected),
    'controller-update-service-set-changed',
  );
  for (const [name, selected] of Object.entries(expected))
    if (name !== 'system_bootstrapper_1' && (!wizard || name !== 'system_wizard_1'))
      ensure(
        record(services[name]).Image === record(selected).imageId,
        'controller-update-service-image-changed',
      );
}
/** Paired update order, repair gates and completion claims, while native owner holds leases. */
export class ControllerUpdateSequenceService {
  constructor(readonly port: ControllerUpdateSequencePort) {}

  async run(
    input: ControllerUpdateSequenceInput,
    port: ControllerUpdateSequencePort = this.port,
  ): Promise<Row> {
    ensure(
      input.record.format === 'system-public-controller-update-v1' &&
        input.record.phase === 'inputs-verified' &&
        typeof input.leaseOperation === 'string',
      'invalid-controller-update-sequence-input',
    );
    let state: Row = {
      ...input.record,
      leaseOperation: input.leaseOperation,
      phase: 'lease-acquired',
    };
    const journal = async (phase?: string) => {
      if (phase) state.phase = phase;
      await port.journal(state);
    };
    await journal();
    await port.assertBaseline(input.baseline);
    if (input.expectedBaseline) await port.assertBaseline(input.expectedBaseline);
    if (input.selection) await port.verifySelection(false);
    if (!input.stoppedId)
      ensure(
        isDeepStrictEqual(await port.publicImages(), input.baseline.selectedImages),
        'controller-update-images-changed-before-stop',
      );
    await port.pipeline();
    if (input.wizard)
      ensure(
        isDeepStrictEqual(await port.publicPair(), input.publication),
        'paired-publication-changed-before-stop',
      );
    if (!input.stoppedId) {
      await port.syncIdle();
      await port.currentServices();
    } else {
      const current = await port.currentServices();
      ensure(
        isDeepStrictEqual(current.system_bootstrapper_1, input.original.system_bootstrapper_1),
        'stopped-controller-changed-before-repair',
      );
      runnerContainers(current, state.previousRunnerContainerIds);
      await port.repairBaseline(current);
    }
    if (input.selection) {
      await port.verifySelection(false);
      await port.verifySelection(true);
    }
    await port.critical();
    await journal('controller-stop-started');
    const controller = record(input.original.system_bootstrapper_1),
      labels = record(record(controller.Config).Labels),
      controllerState = record(controller.State);
    ensure(
      labels['com.docker.compose.project'] === 'system' &&
        labels['com.docker.compose.service'] === 'bootstrapper',
      'owned-core-container-required',
    );
    await port.command(['update', '--restart=no', String(controller.Id)]);
    if (controllerState.Running) {
      ensure(!controllerState.Paused, 'controller-update-refuses-paused-controller');
      await port.command(['stop', '--time', '30', String(controller.Id)]);
    }
    ensure(
      !record((await port.inspect(String(controller.Id))).State).Running,
      'previous-controller-did-not-stop',
    );
    await port.assertBaseline(input.baseline);
    await port.writeConfiguration(input.updated, input.metadata);
    if (input.selection) await port.writeSelection();
    await journal('controller-start-started');
    const restartedAt = await port.now();
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
      String(input.pulled.reference),
    );
    await port.reload();
    const after = structuredClone(input.baseline);
    record(after.configurationFiles)['configuration/.docker.env'] = state.configurationAfterSha256;
    const images = record(after.selectedImages);
    Object.assign(record(images.system_bootstrapper_1), {
      reference: input.pulled.reference,
      imageId: input.pulled.imageId,
    });
    if (input.wizard)
      Object.assign(record(images.system_wizard_1), {
        reference: input.wizard.reference,
        imageId: input.wizard.imageId,
      });
    Object.assign(after, {
      sourceCommit: input.release.sourceRevision,
      sourceTree: input.release.sourceTree,
      startedAt: restartedAt,
    });
    await port.saveBaseline(after);
    const receipt = await port.waitReady(after),
      services = await port.services();
    unchangedServices(services, input.baseline, !!input.wizard);
    if (input.stoppedId) runnerContainers(services, state.previousRunnerContainerIds);
    await port.saveVerification(receipt);
    state = {
      ...state,
      phase: 'completed',
      completedAt: await port.now(),
      serviceImagesPreserved: !input.wizard,
      configurationChangedOnlyControllerImage: !input.wizard,
      databaseRewound: false,
      ...(input.wizard
        ? { otherServiceImagesPreserved: true, configurationChangedOnlyReleaseImages: true }
        : {}),
    };
    await journal();
    return state;
  }
}
