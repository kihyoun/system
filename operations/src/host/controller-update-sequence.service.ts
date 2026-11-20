import { isDeepStrictEqual } from 'node:util';
import { record } from '../release/source-identity';
import { requireValue as ensure } from './install';
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
  journal(value: Row): void;
  assertBaseline(value: Row): void;
  verifySelection(checkpoint: boolean): void;
  publicImages(): unknown;
  pipeline(): void;
  publicPair(): unknown;
  syncIdle(): void;
  currentServices(): Row;
  repairBaseline(current: Row): void;
  critical(): void;
  command(args: string[], reference?: string): void;
  inspect(id: string): Row;
  writeConfiguration(bytes: string, metadata: Row): void;
  writeSelection(): void;
  now(): string;
  reload(): void;
  saveBaseline(value: Row): void;
  waitReady(value: Row): unknown;
  services(): Row;
  saveVerification(value: unknown): void;
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
  run(input: ControllerUpdateSequenceInput): Row {
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
    const journal = (phase?: string) => {
      if (phase) state.phase = phase;
      this.port.journal(state);
    };
    journal();
    this.port.assertBaseline(input.baseline);
    if (input.expectedBaseline) this.port.assertBaseline(input.expectedBaseline);
    if (input.selection) this.port.verifySelection(false);
    if (!input.stoppedId)
      ensure(
        isDeepStrictEqual(this.port.publicImages(), input.baseline.selectedImages),
        'controller-update-images-changed-before-stop',
      );
    this.port.pipeline();
    if (input.wizard)
      ensure(
        isDeepStrictEqual(this.port.publicPair(), input.publication),
        'paired-publication-changed-before-stop',
      );
    if (!input.stoppedId) {
      this.port.syncIdle();
      this.port.currentServices();
    } else {
      const current = this.port.currentServices();
      ensure(
        isDeepStrictEqual(current.system_bootstrapper_1, input.original.system_bootstrapper_1),
        'stopped-controller-changed-before-repair',
      );
      runnerContainers(current, state.previousRunnerContainerIds);
      this.port.repairBaseline(current);
    }
    if (input.selection) {
      this.port.verifySelection(false);
      this.port.verifySelection(true);
    }
    this.port.critical();
    journal('controller-stop-started');
    const controller = record(input.original.system_bootstrapper_1),
      labels = record(record(controller.Config).Labels),
      controllerState = record(controller.State);
    ensure(
      labels['com.docker.compose.project'] === 'system' &&
        labels['com.docker.compose.service'] === 'bootstrapper',
      'owned-core-container-required',
    );
    this.port.command(['update', '--restart=no', String(controller.Id)]);
    if (controllerState.Running) {
      ensure(!controllerState.Paused, 'controller-update-refuses-paused-controller');
      this.port.command(['stop', '--time', '30', String(controller.Id)]);
    }
    ensure(
      !record(this.port.inspect(String(controller.Id)).State).Running,
      'previous-controller-did-not-stop',
    );
    this.port.assertBaseline(input.baseline);
    this.port.writeConfiguration(input.updated, input.metadata);
    if (input.selection) this.port.writeSelection();
    journal('controller-start-started');
    const restartedAt = this.port.now();
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
      String(input.pulled.reference),
    );
    this.port.reload();
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
    this.port.saveBaseline(after);
    const receipt = this.port.waitReady(after),
      services = this.port.services();
    unchangedServices(services, input.baseline, !!input.wizard);
    if (input.stoppedId) runnerContainers(services, state.previousRunnerContainerIds);
    this.port.saveVerification(receipt);
    state = {
      ...state,
      phase: 'completed',
      completedAt: this.port.now(),
      serviceImagesPreserved: !input.wizard,
      configurationChangedOnlyControllerImage: !input.wizard,
      databaseRewound: false,
      ...(input.wizard
        ? { otherServiceImagesPreserved: true, configurationChangedOnlyReleaseImages: true }
        : {}),
    };
    journal();
    return state;
  }
}
