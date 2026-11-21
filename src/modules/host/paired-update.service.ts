import { cancellationPort } from './operation-cancellation';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { record } from '../release/source-identity';
import {
  RuntimeVerificationService,
  type RuntimeBaseline,
} from '../host-bootstrap/runtime-verification.service';
import {
  HostInstallService,
  requireValue as ensure,
  reference,
  acceptedMetadata,
  writePrivate,
} from './install';
import { HostSourceService } from './source';
import { RecoveryImageService } from './recovery-images';
import { releaseInstalledSource } from './recovery-publication.service';
import { runnerCount, type RuntimeConfig, type ContainerRow } from './runtime-inspection';
import { PublicUpgradePreparationService } from './public-upgrade-preparation.service';
import {
  ReleaseSelectionService,
  imageAssignment,
  bytesSha,
  replaceOwned,
  type ReleaseSelection,
} from './release-selection.service';
import { readPrivateInput, readPrivateSnapshot } from './private-input';
import {
  PairedRuntimeService,
  repairPeers,
  ownedCore,
  type PairedRuntimeInput,
} from './paired-runtime.service';
import { ControllerUpdateSequenceService } from './controller-update-sequence.service';
import { ControllerRollbackSequenceService } from './controller-rollback-sequence.service';

type Row = Record<string, unknown>;
export interface PairedCandidateAuthority {
  pipeline(): Promise<Row>;
  pair(controller: string, wizard: string): Promise<Row>;
  evidenceSha256: string;
}
export interface PairedUpdateInput extends PairedRuntimeInput {
  config: RuntimeConfig;
  release: Row;
  evidence: Row;
  security: Row;
  authority: PairedCandidateAuthority;
  controller: string;
  wizard?: string;
  checkpoint: string;
  accepted?: string;
  checkOnly?: boolean;
  repairStoppedController?: boolean;
  expectedBaseline?: Row;
}
export function pairedCheckpoint(root: string, filename: string, fresh = false): string {
  const boundary = path.join(root, 'recovery/controller-updates');
  let ancestor = filename;
  while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor)
    ancestor = path.dirname(ancestor);
  ensure(
    path.isAbsolute(filename) &&
      path.resolve(filename) === filename &&
      filename.startsWith(boundary + path.sep) &&
      path.join(fs.realpathSync(ancestor), path.relative(ancestor, filename)) === filename,
    'retained-controller-update-directory-required',
  );
  const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
  ensure(
    fresh ? !stat : stat?.isDirectory() && !stat.isSymbolicLink(),
    'retained-controller-update-directory-required',
  );
  return filename;
}
const save = (filename: string, value: unknown) =>
  writePrivate(filename, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
export class PairedUpdateService {
  constructor(
    readonly host: HostInstallService,
    readonly source: HostSourceService,
    readonly runtime: RuntimeVerificationService,
    readonly native: PairedRuntimeService,
    readonly selections: ReleaseSelectionService,
    readonly images: RecoveryImageService,
    readonly preparation: PublicUpgradePreparationService,
    readonly updates: ControllerUpdateSequenceService,
    readonly rollbacks: ControllerRollbackSequenceService,
  ) {}

  async update(input: PairedUpdateInput): Promise<Row> {
    const { release, evidence, security, authority, checkpoint } = input;
    this.runtime.manifestAbsent(input.config);
    this.source.verifyCheckout(release, input.checkout);
    ensure(!input.accepted || input.wizard, 'release-metadata-requires-paired-update');
    ensure(
      !input.repairStoppedController || (input.wizard && input.accepted),
      'stopped-repair-requires-paired-accepted-release-metadata',
    );
    const context = this.native.context(input, input.config),
      pipeline = await authority.pipeline();
    let controller = reference(input.controller),
      wizard = input.wizard ? reference(input.wizard) : undefined;
    let publication: Row | null = null;
    if (wizard) {
      ensure(input.config.WIZARD_ENABLE === 'true', 'paired-update-requires-enabled-Wizard');
      publication = await authority.pair(controller, wizard);
    }
    // Acquire before stopped-owner checks, including read-only preflight; the exact shared guard proves no old host command is alive.
    context.acquire();
    let failed = true;
    try {
      const config = context.config;
      let stoppedId: string | undefined;
      if (input.repairStoppedController) {
        stoppedId = String((await context.inspect('system_bootstrapper_1')).Id);
        context.stoppedIdle();
      }
      if (input.expectedBaseline)
        this.runtime.assertBaseline(config, input.expectedBaseline as unknown as RuntimeBaseline);
      const original = await context.current(evidence, security, stoppedId);
      if (wizard) ownedCore(original.system_wizard_1, 'wizard');
      const baseline = this.runtime.capture(config, input.checkout, true, stoppedId);
      ensure(
        Object.keys(baseline.runnerManagerIdentitySha256).length === runnerCount(config),
        'all-current-runner-identities-required',
      );
      if (stoppedId) await context.repairBaseline(baseline as unknown as Row, original);
      else {
        await context.waitReady(baseline as unknown as Row);
        await this.preparation.syncIdle(config);
      }
      const pulled = this.host.image(controller, { sourceCommit: String(release.sourceRevision) });
      ensure(
        pulled.imageId === release.imageId && pulled.candidateJobId === release.candidateJobId,
        'public-controller-does-not-match-accepted-candidate',
      );
      const pulledWizard = wizard
        ? this.host.image(wizard, releaseInstalledSource(release), true)
        : undefined;
      if (pulledWizard)
        ensure(
          pulledWizard.imageId === release.wizardImageId &&
            pulledWizard.candidateJobId === release.candidateJobId,
          'public-Wizard-does-not-match-accepted-candidate',
        );
      let selected: ReturnType<ReleaseSelectionService['prepare']> | undefined,
        accepted: Row | undefined;
      if (input.accepted) {
        accepted = record(
          acceptedMetadata(input.accepted, releaseInstalledSource(release), controller, wizard!),
        );
        const acceptance = record(accepted.acceptance),
          images = record(accepted.images);
        ensure(
          accepted.version ===
            fs.readFileSync(path.join(input.checkout, 'VERSION'), 'utf8').trim() &&
            acceptance.evidenceSha256 === authority.evidenceSha256 &&
            record(images.controller).imageId === release.imageId &&
            record(images.wizard).imageId === release.wizardImageId,
          'public-release-metadata-differs-from-accepted-candidate',
        );
        for (const [role, image] of [
          ['controller', pulled],
          ['wizard', pulledWizard!],
        ] as const) {
          const expected = record(images[role]);
          ensure(
            [
              expected.imageId,
              expected.configDigest,
              String(expected.reference).split('@')[1],
            ].includes(image.imageId) && image.candidateJobId === acceptance.candidateJobId,
            'pulled-images-differ-from-accepted-public-attempt',
          );
        }
        selected = this.selections.prepare(
          config._main,
          accepted,
          release,
          { ...pulled },
          { ...pulledWizard! },
        );
      }
      pairedCheckpoint(config._root, checkpoint, true);
      const { bytes: raw, stat } = readPrivateSnapshot(config._main),
        metadata = { mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid };
      let updated = imageAssignment(raw, pulled.reference);
      if (pulledWizard) updated = imageAssignment(updated, pulledWizard.reference, 'WIZARD_IMAGE');
      if (input.checkOnly) {
        failed = false;
        return {
          phase: 'preflight-passed',
          controller: pulled,
          pipeline,
          ...(stoppedId ? { repairStoppedController: true } : {}),
          ...(pulledWizard ? { wizard: pulledWizard, publication } : {}),
          ...(selected
            ? {
                productRelease: { version: accepted!.version, tag: accepted!.tag },
                releaseSelectionWillRefresh: true,
              }
            : {}),
        };
      }
      fs.mkdirSync(checkpoint, { recursive: true, mode: 0o700 });
      fs.chmodSync(checkpoint, 0o700);
      writePrivate(path.join(checkpoint, 'main-before.env'), raw);
      writePrivate(path.join(checkpoint, 'main-after.env'), updated);
      save(path.join(checkpoint, 'baseline-before.json'), baseline);
      if (selected)
        for (const [phase, payloads] of [
          ['before', selected.previous],
          ['after', selected.payloads],
        ] as const)
          for (const [name, bytes] of Object.entries(payloads))
            writePrivate(path.join(checkpoint, name + '.' + phase), bytes);
      const state: Row = {
        format: 'system-public-controller-update-v1',
        phase: 'inputs-verified',
        at: new Date().toISOString(),
        release,
        pipeline,
        controller: pulled,
        configurationBeforeSha256: bytesSha(raw),
        configurationAfterSha256: bytesSha(updated),
        configurationMetadata: metadata,
        previousController: {
          reference: config.BOOTSTRAPPER_IMAGE,
          imageId: original.system_bootstrapper_1.Image,
          restartPolicy: record(original.system_bootstrapper_1.HostConfig).RestartPolicy,
        },
      };
      if (stoppedId) {
        state.repairStoppedController = true;
        Object.assign(record(state.previousController), {
          containerId: stoppedId,
          state: original.system_bootstrapper_1.State,
        });
        state.previousRunnerContainerIds = Object.fromEntries(
          Object.entries(original)
            .filter(([name]) => name.startsWith('runner_docker_'))
            .map(([name, row]) => [name, row.Id]),
        );
      }
      if (pulledWizard)
        Object.assign(state, {
          wizard: pulledWizard,
          publication,
          previousWizard: {
            reference: config.WIZARD_IMAGE,
            imageId: original.system_wizard_1.Image,
          },
        });
      if (selected) {
        save(path.join(checkpoint, 'accepted-public-release.json'), accepted);
        state.releaseSelection = selected.selection;
      }
      save(path.join(checkpoint, 'operation.json'), state);
      const result = await this.updates.run(
        {
          record: state,
          baseline: baseline as unknown as Row,
          expectedBaseline: input.expectedBaseline ?? null,
          original,
          selection: (selected?.selection as unknown as Row) ?? null,
          stoppedId: stoppedId ?? null,
          pulled: { ...pulled },
          wizard: pulledWizard ? { ...pulledWizard } : null,
          publication,
          release,
          updated: updated.toString('base64'),
          metadata,
          leaseOperation: context.operation(),
          checkout: input.checkout,
        },
        cancellationPort(
          {
            journal: (value) => save(path.join(checkpoint, 'operation.json'), value),
            assertBaseline: (value) =>
              this.runtime.assertBaseline(context.config, value as unknown as RuntimeBaseline),
            verifySelection: (checkpointed) => {
              if (selected) {
                if (checkpointed) this.selections.verifyCheckpoint(checkpoint, selected.selection);
                else this.selections.verify(context.config._main, selected.selection);
              }
            },
            publicImages: () => this.runtime.publicImages(context.config, context.services()),
            pipeline: async () => {
              await authority.pipeline();
            },
            publicPair: () => authority.pair(controller, wizard!),
            syncIdle: () => this.preparation.syncIdle(context.config),
            currentServices: () => context.current(evidence, security, stoppedId),
            repairBaseline: (rows) =>
              context.repairBaseline(
                baseline as unknown as Row,
                rows as Record<string, ContainerRow>,
              ),
            critical: () => context.critical(),
            command: async (args, reference) => {
              await context.docker(args, 300, '', reference);
            },
            inspect: context.inspect,
            writeConfiguration: (bytes, meta) =>
              replaceOwned(context.config._main, Buffer.from(bytes, 'base64'), {
                mode: Number(meta.mode),
                uid: Number(meta.uid),
                gid: Number(meta.gid),
              }),
            writeSelection: () => {
              if (selected)
                this.selections.write(
                  context.config._main,
                  checkpoint,
                  selected.selection,
                  'after',
                );
            },
            now: () => new Date().toISOString(),
            reload: context.reload,
            saveBaseline: (value) => save(path.join(checkpoint, 'baseline-after.json'), value),
            waitReady: context.waitReady,
            services: () => context.services(),
            saveVerification: (value) => save(path.join(checkpoint, 'verification.json'), value),
          },
          input.signal,
        ),
      );
      failed = false;
      return result;
    } finally {
      context.finish(failed);
    }
  }

  status(config: RuntimeConfig, checkpoint: string): Row {
    this.runtime.manifestAbsent(config);
    pairedCheckpoint(config._root, checkpoint);
    const state = record(
      JSON.parse(readPrivateInput(path.join(checkpoint, 'operation.json')).toString()),
    );
    ensure(
      state.format === 'system-public-controller-update-v1',
      'invalid-public-controller-operation',
    );
    return state;
  }

  async rollback(
    input: PairedRuntimeInput & {
      config: RuntimeConfig;
      checkpoint: string;
      retainedImages?: { directory: string; descriptors: Row };
    },
  ): Promise<Row> {
    const { checkpoint } = input,
      state = this.status(input.config, checkpoint);
    this.source.verifyCheckout(state.release, input.checkout);
    ensure(
      !['rolled-back', 'rolled-back-stopped'].includes(String(state.phase)) &&
        typeof state.leaseOperation === 'string',
      'controller-update-not-rollbackable',
    );
    const context = this.native.context(input, input.config);
    const locked = fs.existsSync(
      path.join(input.config._root, 'configuration/.gitlab-upgrade-lock'),
    );
    context.acquire(locked ? String(state.leaseOperation) : undefined);
    let failed = true;
    try {
      if (input.retainedImages) {
        ensure(state.wizard, 'retained-images-require-paired-rollback');
        const restored = await this.images.restoreRetained(
          input.retainedImages.directory,
          input.retainedImages.descriptors,
          { controller: record(state.previousController), wizard: record(state.previousWizard) },
          (args, timeout) => context.docker(args, timeout),
        );
        ensure(
          !state.recoveredImages || isDeepStrictEqual(state.recoveredImages, restored),
          'retained-image-selection-changed',
        );
        state.recoveredImages = restored;
      }
      const original = readPrivateInput(path.join(checkpoint, 'main-before.env')),
        baseline = record(
          JSON.parse(readPrivateInput(path.join(checkpoint, 'baseline-before.json')).toString()),
        );
      let before = original;
      if (state.recoveredImages) {
        for (const [role, key] of [
          ['controller', 'BOOTSTRAPPER_IMAGE'],
          ['wizard', 'WIZARD_IMAGE'],
        ])
          before = imageAssignment(
            before,
            String(record(record(state.recoveredImages)[role]).reference),
            key,
          );
        state.recoveredConfigurationSha256 = bytesSha(before);
      }
      ensure(
        bytesSha(original) === state.configurationBeforeSha256 &&
          [
            state.configurationBeforeSha256,
            state.configurationAfterSha256,
            state.recoveredConfigurationSha256,
          ].includes(bytesSha(fs.readFileSync(context.config._main))),
        'controller-rollback-configuration-changed',
      );
      const selection = state.releaseSelection as ReleaseSelection | undefined;
      if (selection) {
        this.selections.verify(context.config._main, selection, true);
        this.selections.verifyCheckpoint(checkpoint, selection);
      }
      if (state.recoveredImages)
        for (const [role, key, name] of [
          ['controller', 'previousController', 'system_bootstrapper_1'],
          ['wizard', 'previousWizard', 'system_wizard_1'],
        ]) {
          const value = record(record(state.recoveredImages)[role]);
          Object.assign(record(state[key]), {
            reference: value.reference,
            originalReference: value.originalReference,
          });
          record(record(baseline.selectedImages)[name]).reference = value.reference;
        }
      for (const key of ['previousController', ...(state.wizard ? ['previousWizard'] : [])]) {
        const image = record(state[key]);
        ensure(
          this.images.inspect(String(image.reference)).Id === image.imageId,
          'previous-controller-image-unavailable-or-retargeted',
        );
      }
      context.pairedBaseline(baseline, state);
      await context.rollbackServices(baseline, state);
      const result = await this.rollbacks.run(
        {
          record: state,
          baseline,
          before: before.toString('base64'),
          selection: (selection as unknown as Row) ?? null,
          leaseOperation: context.operation(),
          checkpoint,
          checkout: input.checkout,
        },
        cancellationPort(
          {
            journal: (value) => save(path.join(checkpoint, 'operation.json'), value),
            mainSha: () => bytesSha(fs.readFileSync(context.config._main)),
            pairedBaseline: (value) => context.pairedBaseline(value, state),
            verifySelection: (checkpointed) => {
              if (selection) {
                if (checkpointed) this.selections.verifyCheckpoint(checkpoint, selection);
                else this.selections.verify(context.config._main, selection, true);
              }
            },
            services: () => context.rollbackServices(baseline, state),
            stoppedIdle: context.stoppedIdle,
            repairPeers: (rows) => repairPeers(rows as Record<string, ContainerRow>),
            critical: context.critical,
            command: async (args, reference) => {
              await context.docker(args, 300, '', reference);
            },
            inspect: context.inspect,
            writeConfiguration: (bytes, meta) =>
              replaceOwned(context.config._main, Buffer.from(bytes, 'base64'), {
                mode: Number(meta.mode),
                uid: Number(meta.uid),
                gid: Number(meta.gid),
              }),
            recoveredReceipt: (value) =>
              save(
                path.join(path.dirname(context.config._main), '.release-images.recovered.json'),
                value,
              ),
            writeSelection: () => {
              if (selection)
                this.selections.write(context.config._main, checkpoint, selection, 'before');
            },
            reload: context.reload,
            restoreStopped: (value) => context.restoreStopped(value, state),
            waitReady: context.waitReady,
            inspectServices: () => context.services(),
            now: () => new Date().toISOString(),
            verification: (value) =>
              save(path.join(checkpoint, 'rollback-verification.json'), value),
          },
          input.signal,
        ),
      );
      failed = false;
      return result;
    } finally {
      context.finish(failed);
    }
  }
}
