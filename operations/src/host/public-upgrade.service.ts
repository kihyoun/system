import { cancellationPort } from './operation-cancellation';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { record } from '../release/source-identity';
import { fileLock } from '../runtime/file-lock';
import { GitlabDataSampleService } from '../gitlab-preflight/gitlab-data-sample.service';
import {
  RuntimeVerificationService,
  serviceOrigin,
  type RuntimeBaseline,
} from '../host-bootstrap/runtime-verification.service';
import { HostInstallService, requireValue as ensure } from './install';
import { PublicUpgradePreparationService } from './public-upgrade-preparation.service';
import { PublicUpgradeBackupService } from './public-upgrade-backup.service';
import { PublicUpgradePlanService } from './public-upgrade-plan.service';
import { PublicUpgradeApplyService } from './public-upgrade-apply.service';
import { PairedControllerService } from './paired-controller.service';
import { PairedUpdateService } from './paired-update.service';
import { PairedRuntimeService } from './paired-runtime.service';
import { UpgradePrerequisiteService } from './upgrade-prerequisite.service';
import { UpgradeLifecycleService } from './upgrade-lifecycle.service';
import { HostSourceService } from './source';
import { RecoveryArchiveService } from './recovery-archive.service';
import { CandidateGitLabService } from './candidate-gitlab.service';
import { readPrivateInput } from './private-input';
import { bytesSha } from './release-selection.service';
import type { RuntimeConfig } from './runtime-inspection';
type Row = Record<string, unknown>;
export interface PublicUpgradeInput {
  signal?: AbortSignal;
  operation: 'plan' | 'apply' | 'status' | 'recover';
  checkout: string;
  persistenceEnv: string;
  directory: string;
  repository: string;
  target?: string;
  backupFile?: string;
  tokenFile?: string;
  gitlabCheckpoint?: string;
  confirmation?: string;
  timeout: number;
  backupTimeout: number;
}
function retainedDirectory(config: RuntimeConfig, filename: string): string {
  const boundary = path.join(config._root, 'recovery/public-upgrades'),
    stat = fs.lstatSync(filename);
  ensure(
    path.isAbsolute(filename) &&
      fs.realpathSync(filename) === filename &&
      filename.startsWith(boundary + path.sep) &&
      stat.isDirectory() &&
      !stat.isSymbolicLink(),
    'retained-public-upgrade-directory-required',
  );
  return filename;
}
const readJson = (filename: string) => record(JSON.parse(readPrivateInput(filename).toString()));
export class PublicUpgradeService {
  constructor(
    readonly host: HostInstallService,
    readonly runtime: RuntimeVerificationService,
    readonly preparation: PublicUpgradePreparationService,
    readonly backup: PublicUpgradeBackupService,
    readonly plans: PublicUpgradePlanService,
    readonly applies: PublicUpgradeApplyService,
    readonly controller: PairedControllerService,
    readonly paired: PairedUpdateService,
    readonly native: PairedRuntimeService,
    readonly prerequisite: UpgradePrerequisiteService,
    readonly lifecycle: UpgradeLifecycleService,
    readonly source: HostSourceService,
    readonly archives: RecoveryArchiveService,
    readonly data: GitlabDataSampleService,
    readonly gitlab: CandidateGitLabService,
  ) {}
  async execute(input: PublicUpgradeInput): Promise<Row> {
    ensure(
      ['plan', 'apply', 'status', 'recover'].includes(input.operation),
      'invalid-public-upgrade-operation',
    );
    ensure(
      this.host.rootUser() &&
        Number.isInteger(input.timeout) &&
        input.timeout >= 60 &&
        input.timeout <= 3600 &&
        Number.isInteger(input.backupTimeout) &&
        input.backupTimeout >= 60 &&
        input.backupTimeout <= 7200,
      'root-and-bounded-timeouts-required',
    );
    for (const filename of [input.checkout, input.persistenceEnv, input.directory])
      ensure(path.isAbsolute(filename), 'absolute-public-upgrade-input-required');
    const config = await this.runtime.settings(
      input.persistenceEnv,
      input.checkout,
      this.host.environment,
    );
    if (input.operation === 'status' || input.operation === 'recover')
      return this.status(input, config);
    ensure(input.tokenFile, 'own-installation-API-token-required');
    if (input.operation === 'plan')
      ensure(input.target && input.backupFile, 'target-backup-file-and-own-API-token-required');
    const base = {
        signal: input.signal,
        checkout: input.checkout,
        persistenceEnv: input.persistenceEnv,
        tokenFile: input.tokenFile,
        timeout: input.timeout,
      },
      context = this.native.context(base, config);
    let accepted: Awaited<ReturnType<PublicUpgradePreparationService['inputs']>> | undefined;
    const requireAccepted = () => {
      ensure(accepted, 'public-upgrade-authority-not-loaded');
      return accepted;
    };
    const publicInputs = async (repository: string, target: string) => {
      accepted = await this.preparation.inputs(repository, target, input.checkout);
      return accepted;
    };
    const prerequisite = (checkpoint: string) => {
      const value = requireAccepted();
      return this.prerequisite.verify(
        config._root,
        checkpoint,
        String(value.release.sourceRevision),
        value.security,
      );
    };
    const dataSample = async () => {
      const row = await context.inspect('system_gitlab_1'),
        api = this.gitlab.connect(serviceOrigin(config, 'GITLAB'), input.tokenFile!);
      return this.data.sample(String(row.Id), {
        command: (args, timeout, bytes) => context.docker(args, timeout, bytes),
        get: api.get,
      });
    };
    const invoke = async (
      checkOnly: boolean,
      checkpoint: string,
      metadataFile: string,
      expectedBaseline?: Row,
    ) => {
      const value = requireAccepted(),
        candidate = this.controller.publicCandidate(
          value.metadata,
          value.proofBytes,
          value.security,
        ),
        images = record(value.metadata.images);
      await this.paired.update({
        ...base,
        config,
        release: candidate.release,
        evidence: candidate.evidence,
        security: value.security,
        authority: candidate.authority,
        controller: String(record(images.controller).reference),
        wizard: String(record(images.wizard).reference),
        checkpoint,
        accepted: metadataFile,
        checkOnly,
        expectedBaseline,
      });
    };
    if (input.operation === 'plan') {
      const unlock = fileLock(path.join(path.dirname(config._main), '.public-upgrade-plan.lock'));
      const attemptId = crypto.randomBytes(16).toString('hex');
      try {
        const result = await this.plans.plan(
          {
            attemptId,
            target: input.target!,
            repository: input.repository,
            directory: input.directory,
            backupFile: input.backupFile!,
            gitlabCheckpoint: input.gitlabCheckpoint,
            root: config._root,
            checkout: input.checkout,
            backupDestination: config.SEED_DIR,
          },
          cancellationPort(
            {
              publicInputs: async (repository, target) => {
                const value = await publicInputs(repository, target);
                return {
                  raw: value.raw.toString('base64'),
                  proof: value.proofBytes.toString('base64'),
                  release: value.release,
                  metadata: value.metadata,
                  evidence: value.evidence,
                  graph: value.graph,
                };
              },
              verifyCheckout: () =>
                this.source.verifyCheckout(requireAccepted().release, input.checkout),
              installed: (repository, target) =>
                this.preparation.installed(config, repository, input.checkout, target),
              prerequisite,
              host: () => this.preparation.verifyHost(requireAccepted().metadata),
              syncIdle: () => this.preparation.syncIdle(config),
              freeBytes: async () => {
                const dockerRoot = (
                  await context.docker(['info', '--format', '{{.DockerRootDir}}'])
                ).trim();
                ensure(path.isAbsolute(dockerRoot), 'docker-root-directory-required');
                return [config._root, dockerRoot].map((filename) => {
                  const stat = fs.statfsSync(filename);
                  return stat.bavail * stat.bsize;
                });
              },
              backupTarget: (filename) =>
                this.backup.target(config, filename, input.checkout, input.persistenceEnv),
              selection: () => ({
                json: readPrivateInput(
                  path.join(path.dirname(config._main), '.release-images.json'),
                ).toString('base64'),
                environment: readPrivateInput(
                  path.join(path.dirname(config._main), '.release-images.env'),
                ).toString('base64'),
                configurationSha256: bytesSha(fs.readFileSync(config._main)),
              }),
              capture: () => this.runtime.capture(config, input.checkout, true),
              invoke: (checkpoint, metadataFile) => invoke(true, checkpoint, metadataFile),
              dataSample,
              now: () => new Date().toISOString(),
            },
            input.signal,
          ),
        );
        return { ...result.value, confirmPlanSha256: result.sha256 };
      } catch (error) {
        this.plans.interrupt(input.directory, attemptId);
        throw error;
      } finally {
        unlock();
      }
    }
    const directory = retainedDirectory(config, input.directory),
      unlock = fileLock(path.join(directory, '.coordinator.lock'));
    try {
      return await this.applies.apply(
        directory,
        input.confirmation,
        cancellationPort(
          {
            publicInputs: async (repository, target) => {
              const value = await publicInputs(repository, target);
              return {
                targetSha256: bytesSha(value.raw),
                provenanceSha256: bytesSha(value.proofBytes),
                release: value.release,
              };
            },
            prerequisite,
            installed: (repository, target) =>
              this.preparation.installed(config, repository, input.checkout, target),
            fingerprints: () => ({
              selectionSha256: bytesSha(
                readPrivateInput(path.join(config._root, 'configuration/.release-images.json')),
              ),
              configurationSha256: bytesSha(fs.readFileSync(config._main)),
            }),
            assertBaseline: (baseline) =>
              this.runtime.assertBaseline(config, baseline as unknown as RuntimeBaseline),
            dataSample,
            host: () => this.preparation.verifyHost(requireAccepted().metadata),
            backupTarget: async (filename) => {
              await this.backup.target(config, filename, input.checkout, input.persistenceEnv);
            },
            invoke: (checkOnly, checkpoint, baseline) =>
              invoke(checkOnly, checkpoint, path.join(directory, 'target.json'), baseline),
            archive: (_role, image, source) =>
              this.archives.save(
                directory,
                String(image.reference),
                String(image.imageId),
                source,
                input.signal,
              ),
            matchingBackup: (plan) =>
              this.backup.matching(config, directory, plan, input.backupTimeout, input.signal),
            waitReady: context.waitReady,
          },
          input.signal,
        ),
      );
    } catch (error) {
      this.lifecycle.interrupt(directory);
      throw error;
    } finally {
      unlock();
    }
  }
  private async status(input: PublicUpgradeInput, config: RuntimeConfig): Promise<Row> {
    const directory = retainedDirectory(config, input.directory),
      planFile = path.join(directory, 'plan.json');
    if (!fs.existsSync(planFile)) {
      ensure(
        input.operation === 'status',
        'no-reviewed-plan-recover-native-operation-before-replanning',
      );
      return readJson(path.join(directory, 'preflight.json'));
    }
    const plan = readJson(planFile),
      checkpoint = String(plan.checkpoint),
      operationFile = path.join(directory, 'operation.json');
    let state = fs.existsSync(operationFile) ? readJson(operationFile) : { phase: 'planned' };
    if (input.operation === 'recover') {
      ensure(
        input.confirmation === bytesSha(readPrivateInput(planFile)) && input.tokenFile,
        'explicit-plan-confirmation-and-own-token-required-for-recovery',
      );
      ensure(
        fs.statSync(path.join(checkpoint, 'operation.json'), { throwIfNoEntry: false })?.isFile(),
        'no-controller-update-started-inspect-backup-status-and-retained-operation',
      );
      const unlock = fileLock(path.join(directory, '.coordinator.lock'));
      try {
        state = fs.existsSync(operationFile) ? readJson(operationFile) : { phase: 'planned' };
        const retained = readJson(path.join(directory, 'previous-images.json'));
        await this.paired.rollback({
          signal: input.signal,
          checkout: input.checkout,
          persistenceEnv: input.persistenceEnv,
          checkpoint,
          tokenFile: input.tokenFile,
          timeout: input.timeout,
          config,
          retainedImages: { directory, descriptors: retained },
        });
        state = this.lifecycle.transition(
          directory,
          'rolled-back',
          {
            databaseRewound: false,
            recoveryImageSelectors: true,
            restoredVersion: plan.installedVersion,
            originalConfiguration: path.join(checkpoint, 'main-before.env'),
          },
          state.phase,
        );
      } finally {
        unlock();
      }
    }
    const backupOperationFile = path.join(directory, 'backup-operation.json'),
      backupOperation = fs.existsSync(backupOperationFile) ? readJson(backupOperationFile) : null;
    if (backupOperation) {
      ensure(
        typeof backupOperation.id === 'string' && /^[a-f0-9]{32}$/.test(backupOperation.id),
        'invalid-retained-backup-operation',
      );
      backupOperation.status = readJson(
        path.join(
          path.dirname(config._main),
          '.coordinated-backups',
          backupOperation.id,
          'status.json',
        ),
      );
    }
    const backupFile = path.join(directory, 'backup.json');
    return {
      operation: state,
      backupOperation,
      backup: fs.existsSync(backupFile) ? readJson(backupFile) : null,
      controller: fs.existsSync(path.join(checkpoint, 'operation.json'))
        ? this.paired.status(config, checkpoint).phase
        : 'not-started',
    };
  }
}
