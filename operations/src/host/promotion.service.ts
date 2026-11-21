import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HostInstallService, requireValue as ensure, writePrivate } from './install';
import {
  RuntimeVerificationService,
  serviceOrigin,
  type RuntimeBaseline,
} from '../host-bootstrap/runtime-verification.service';
import { CandidateAuthorityService, type CandidateGitLabApi } from './candidate-authority.service';
import { CandidateGitLabService } from './candidate-gitlab.service';
import { HostReleaseAuthorityService } from './release-authority.service';
import { HostSourceService } from './source';
import { RecoveryImageService } from './recovery-images';
import {
  RecoveryManifestService,
  canonicalDigest,
  type RecoveryManifest,
} from './recovery-manifest';
import {
  RuntimeInspectionService,
  type RuntimeConfig,
  type ContainerRow,
} from './runtime-inspection';
import { ControllerLeaseService } from './controller-lease.service';
import { ControllerCheckpointService } from './controller-checkpoint.service';
import { PromotionNativePortService } from './promotion-native-port.service';
import { PromotionRecoveryService } from './promotion-recovery.service';
import { PromotionSequenceService, type PromotionSequencePort } from './promotion-sequence.service';
import { ColdMaintenanceService, type ColdMaintenancePort } from './cold-maintenance.service';
import { PairedRuntimeService, ownedCore } from './paired-runtime.service';
import { PublicUpgradePreparationService } from './public-upgrade-preparation.service';
import { readPrivateInput } from './private-input';
import { bytesSha, promotionAssignment } from './release-selection.service';
import { record, imageId } from '../release/source-identity';
import { assertOperationActive, cancellationPort } from './operation-cancellation';
type Row = Record<string, unknown>;
export interface PromotionInput {
  signal?: AbortSignal;
  operation: 'promote' | 'status' | 'abort';
  checkout: string;
  persistenceEnv: string;
  checkpoint: string;
  timeout: number;
  cold?: boolean;
  checkOnly?: boolean;
  stagedPromotion?: string;
  releaseFile?: string;
  evidenceFile?: string;
  gitlabUrl?: string;
  tokenFile?: string;
}
export class PromotionService {
  constructor(
    readonly host: HostInstallService,
    readonly runtime: RuntimeVerificationService,
    readonly candidates: CandidateAuthorityService,
    readonly gitlab: CandidateGitLabService,
    readonly authority: HostReleaseAuthorityService,
    readonly source: HostSourceService,
    readonly images: RecoveryImageService,
    readonly manifests: RecoveryManifestService,
    readonly inspection: RuntimeInspectionService,
    readonly lease: ControllerLeaseService,
    readonly checkpoints: ControllerCheckpointService,
    readonly nativePort: PromotionNativePortService,
    readonly recovery: PromotionRecoveryService,
    readonly sequence: PromotionSequenceService,
    readonly coldSequence: ColdMaintenanceService,
    readonly paired: PairedRuntimeService,
    readonly preparation: PublicUpgradePreparationService,
  ) {}
  async execute(input: PromotionInput): Promise<Row> {
    ensure(
      ['promote', 'status', 'abort'].includes(input.operation),
      'invalid-controller-operation',
    );
    ensure(
      this.host.rootUser() &&
        Number.isInteger(input.timeout) &&
        input.timeout >= 60 &&
        input.timeout <= 3600,
      'root-and-bounded-readiness-timeout-required',
    );
    for (const value of [input.checkout, input.persistenceEnv, input.checkpoint])
      ensure(path.isAbsolute(value), 'absolute-promotion-input-required');
    ensure(
      !input.stagedPromotion || input.operation === 'promote',
      'staged-promotion-is-only-for-promotion',
    );
    ensure(!input.checkOnly || input.operation === 'promote', 'check-only-requires-promotion');
    if (input.operation === 'abort') {
      await this.recovery.abort(input);
      return { phase: 'aborted' };
    }
    const config = await this.runtime.settings(
      input.persistenceEnv,
      input.checkout,
      this.host.environment,
    );
    if (input.operation === 'status') {
      const value = record(
        JSON.parse(readPrivateInput(path.join(input.checkpoint, 'operation.json')).toString()),
      );
      ensure(
        value.format === 'system-controller-promotion-v1',
        'invalid-controller-operation-record',
      );
      return {
        format: value.format,
        phase: value.phase,
        coldMaintenance: value.coldMaintenance,
        leaseOperation: value.leaseOperation,
        GitLabMigrationStarted: value.GitLabMigrationStarted ?? false,
        previousControllerImageId: record(value.previousController).imageId,
        oldGitLabImageId: record(value.oldGitLab).imageId,
      };
    }
    ensure(
      input.releaseFile && input.evidenceFile && input.gitlabUrl && input.tokenFile,
      'successor-release-API-inputs-required',
    );
    ensure(
      input.gitlabUrl.replace(/\/$/, '') === serviceOrigin(config, 'GITLAB'),
      'GitLab-origin-does-not-match-saved-config',
    );
    const security = record(
        JSON.parse(
          fs.readFileSync(path.join(input.checkout, 'gitlab/security-release.json'), 'utf8'),
        ),
      ),
      releaseBytes = readPrivateInput(input.releaseFile),
      evidenceBytes = readPrivateInput(input.evidenceFile),
      { release, evidence } = this.authority.inputs(releaseBytes, evidenceBytes, security),
      api = this.gitlab.connect(input.gitlabUrl, input.tokenFile),
      pipeline = () => this.candidates.pipeline(api, release, releaseBytes, evidenceBytes);
    this.source.verifyCheckout(release, input.checkout);
    const proof = await pipeline();
    if (input.checkOnly && !input.stagedPromotion) return { verified: true, pipeline: proof };
    const original = this.runtime.services(config);
    this.inspection.mounts(config, original);
    let manifest = this.manifests.load(path.join(config._root, 'recovery'), input.checkout),
      stagedReceipt: Row | null = null;
    if (input.stagedPromotion) {
      const staged = await this.staged(input, config, manifest, original, api, security, release);
      manifest = staged.manifest;
      stagedReceipt = staged.receipt;
    }
    this.inspection.images(config, manifest, original);
    if (input.checkOnly) return { verified: true, pipeline: proof, stagedReceipt };
    const controller = original.system_bootstrapper_1,
      gitlab = original.system_gitlab_1,
      web = original.system_web_1;
    ownedCore(controller, 'bootstrapper');
    const upgrade = record(record(evidence.evidence).gitlabUpgrade);
    ensure(gitlab.Image === upgrade.fromImageId, 'old-GitLab-image-mismatch');
    const context = this.paired.context({ ...input, tokenFile: input.tokenFile }, config);
    const preflight = async () => {
      const row = await context.inspect('system_gitlab_1');
      ownedCore(row, 'gitlab');
      ensure(
        record(row.State).Running && !record(row.State).OOMKilled,
        'old-GitLab-is-not-running',
      );
      const value = await this.paired.preflight.probe(String(row.Id), {
        command: (args, timeout, stdin) => context.docker(args, timeout, stdin),
      });
      ensure(
        value.version === security.fromVersion &&
          value.edition === 'CE' &&
          value.unfinishedBackgroundMigrations === 0,
        'old-GitLab-version-jobs-or-migrations-block-promotion',
      );
      return value;
    };
    ensure((await preflight()).runningJobs === 0, 'old-GitLab-running-jobs-block-promotion');
    const baseline = this.runtime.capture(config, input.checkout, false, undefined, manifest),
      raw = readPrivateInput(config._main),
      alias = 'system-successor:' + release.sourceRevision + '-job' + release.candidateJobId,
      updated = promotionAssignment(raw, alias),
      environment = context.environment(alias);
    for (const [key, expected, rows] of [
      ['GITLAB_IMAGE', upgrade.fromImageId, [gitlab]],
      ...(security.runner
        ? [
            [
              'GITLAB_RUNNER_IMAGE',
              upgrade.fromRunnerImageId,
              Object.entries(original)
                .filter(([name]) => name.startsWith('runner_docker_'))
                .map(([, row]) => row),
            ],
          ]
        : []),
    ] as [string, unknown, ContainerRow[]][]) {
      const selected = environment[key];
      ensure(selected && imageId(expected), 'controller-promotion-image-selection-required');
      const image = this.images.inspect(selected);
      ensure(image.Id === expected, 'controller-promotion-image-selection-changed');
      if (selected.includes('@sha256:'))
        ensure(
          image.RepoDigests?.includes(canonicalDigest(selected)),
          'controller-promotion-image-digest-unverified',
        );
      ensure(
        rows.every((row) => row.Image === expected),
        'controller-promotion-running-image-mismatch',
      );
    }
    if (!input.cold) await this.preparation.syncIdle(config);
    await this.pull(input, api, release);
    let existing;
    try {
      existing = this.images.inspect(alias);
    } catch {
      /* A new alias has no prior owner. */
    }
    ensure(
      !existing || existing.Id === release.imageId,
      'accepted-controller-alias-would-be-overwritten',
    );
    await context.docker(['tag', String(release.registryReference), alias]);
    ensure(this.images.inspect(alias).Id === release.imageId, 'accepted-controller-alias-mismatch');
    const boundary = path.join(config._root, 'recovery/controller-promotions');
    ensure(
      input.checkpoint.startsWith(boundary + path.sep) && !fs.existsSync(input.checkpoint),
      'new-retained-controller-checkpoint-directory-required',
    );
    fs.mkdirSync(path.dirname(input.checkpoint), { recursive: true, mode: 0o700 });
    ensure(
      fs.realpathSync(path.dirname(input.checkpoint)) === path.dirname(input.checkpoint),
      'canonical-controller-checkpoint-parent-required',
    );
    fs.mkdirSync(input.checkpoint, { mode: 0o700 });
    writePrivate(path.join(input.checkpoint, 'main-before.env'), raw);
    writePrivate(
      path.join(input.checkpoint, 'manifest-before.json'),
      fs.readFileSync(path.join(config._root, 'recovery/images.json')),
    );
    const state: Row = {
      format: 'system-controller-promotion-v1',
      at: new Date().toISOString(),
      phase: 'inputs-verified',
      release,
      pipeline: proof,
      coldMaintenance: !!input.cold,
      controllerAlias: alias,
      configurationBeforeSha256: bytesSha(raw),
      configurationAfterSha256: bytesSha(updated),
      previousController: {
        id: controller.Id,
        imageId: controller.Image,
        restartPolicy: record(controller.HostConfig).RestartPolicy,
      },
      oldGitLab: {
        id: gitlab.Id,
        imageId: gitlab.Image,
        startedAt: record(gitlab.State).StartedAt,
      },
      ...(stagedReceipt ? { previousStagedPromotion: stagedReceipt } : {}),
    };
    const journal = (value: Row) =>
      writePrivate(
        path.join(input.checkpoint, 'operation.json'),
        Buffer.from(JSON.stringify(value) + '\n'),
      );
    const readJournal = () =>
      record(
        JSON.parse(readPrivateInput(path.join(input.checkpoint, 'operation.json')).toString()),
      );
    journal(state);
    let failed = true;
    try {
      // Keep every command and the optional legacy Seed bind under the same durable guardian.
      context.acquire(undefined, controller);
      const port: PromotionSequencePort = {
        main: () => readPrivateInput(context.config._main).toString('base64'),
        sha: (which) =>
          bytesSha(
            readPrivateInput(
              which === 'manifest'
                ? path.join(config._root, 'recovery/images.json')
                : path.join(input.stagedPromotion!, 'operation.json'),
            ),
          ),
        inspect: context.inspect,
        assertBaseline: (value) =>
          this.runtime.assertBaseline(context.config, value as unknown as RuntimeBaseline),
        pipeline: async () => {
          await pipeline();
        },
        critical: (value) => {
          this.lease.critical = value;
        },
        journal,
        readJournal,
        runners: () => this.nativePort.runnersFor(config, (args) => context.docker(args)),
        cold: async (_state, runners) => {
          const coldPort: ColdMaintenancePort = {
            command: (args, timeout) => context.docker(args, timeout),
            inspect: context.inspect,
            phase: (phase, deadline) => {
              const current = readJournal();
              current.coldPhase = phase;
              if (deadline !== undefined) {
                current.remoteCommandDeadlineUptime = deadline;
                current.remoteCommandBootId = fs
                  .readFileSync('/proc/sys/kernel/random/boot_id', 'utf8')
                  .trim();
              }
              journal(current);
            },
            probe: async () => ({ ...(await preflight()) }),
            checkpoint: () =>
              this.checkpoints.copy(config._root, input.checkpoint, String(release.imageId)),
            now: () => performance.now() / 1000,
            sleep: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
            uptime: () => Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]),
            mainHash: () => bytesSha(readPrivateInput(config._main)),
          };
          return this.coldSequence.run(
            { controller, gitlab, web, runners, deadline: 180, mainHash: bytesSha(raw) },
            cancellationPort(coldPort, input.signal),
          );
        },
        syncIdle: () => this.preparation.syncIdle(context.config),
        command: async (args, promotion) => {
          await context.docker(args, 300, '', promotion ? alias : undefined);
        },
        writeConfiguration: (value) =>
          writePrivate(context.config._main, Buffer.from(value, 'base64')),
        reload: context.reload,
        waitStaged: async (value) => {
          const previousDeadline = this.host.deadline,
            deadline = Math.min(Date.now() + input.timeout * 1000, previousDeadline ?? Infinity);
          this.host.deadline = deadline;
          try {
            while (true) {
              assertOperationActive(input.signal);
              try {
                const rows = context.services();
                ensure(
                  rows.system_bootstrapper_1.Image === release.imageId,
                  'staged-controller-image-mismatch',
                );
                ensure(
                  rows.system_gitlab_1.Image === gitlab.Image,
                  'GitLab-image-changed-before-migration',
                );
                this.runtime.assertBaseline(context.config, value as unknown as RuntimeBaseline);
                this.inspection.mounts(context.config, rows);
                await this.runtime.routes(context.config, rows);
                await this.runtime.sync(context.config);
                return;
              } catch {
                assertOperationActive(input.signal);
                if (Date.now() >= deadline) throw Error('staged-controller-acceptance-timeout');
                await new Promise((resolve) =>
                  setTimeout(resolve, Math.min(3000, deadline - Date.now())),
                );
              }
            }
          } finally {
            this.host.deadline = previousDeadline;
          }
        },
        gitlabPreflight: async () => {
          ensure((await preflight()).runningJobs === 0, 'old-GitLab-running-jobs-block-promotion');
        },
        now: () => new Date().toISOString(),
      };
      const result = await this.sequence.run(
        {
          record: state,
          controller,
          gitlab,
          baseline: baseline as unknown as Row,
          release,
          rawMain: raw.toString('base64'),
          updatedMain: updated.toString('base64'),
          cold: !!input.cold,
          stagedReceipt,
          checkout: input.checkout,
          timeout: input.timeout,
          leaseOperation: context.operation(),
        },
        cancellationPort(port, input.signal),
      );
      failed = false;
      return result;
    } finally {
      context.finish(failed);
    }
  }
  private async pull(input: PromotionInput, api: CandidateGitLabApi, release: Row) {
    const username = record(await api.get('/user')).username;
    ensure(
      typeof username === 'string' && username && !/[\r\n]/.test(username),
      'registry-API-user-required',
    );
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'system-controller-registry-'));
    try {
      const credential = readPrivateInput(input.tokenFile!).toString().trim();
      ensure(credential && !/[\r\n]/.test(credential), 'invalid-GitLab-token-file');
      const environment: NodeJS.ProcessEnv = {
        ...this.host.environment,
        DOCKER_HOST: 'unix:///var/run/docker.sock',
      };
      for (const key of ['DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'])
        delete environment[key];
      const result = this.host.runner.run(
        'docker',
        [
          '--host=unix:///var/run/docker.sock',
          '--config',
          temporary,
          'login',
          '--username',
          username,
          '--password-stdin',
          String(release.registryRepository).split('/')[0],
        ],
        { env: environment, timeout: 300000, maxBuffer: 4 * 1024 ** 2, input: credential + '\n' },
      );
      ensure(result.status === 0, 'registry-login-failed');
      this.host.run('docker', [
        '--host=unix:///var/run/docker.sock',
        '--config',
        temporary,
        'pull',
        String(release.registryReference),
      ]);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    this.acceptedImage(release, { ...this.images.inspect(String(release.registryReference)) });
  }
  private acceptedImage(release: Row, image: Row) {
    const labels = record(record(image.Config).Labels);
    ensure(
      image.Id === release.imageId &&
        Array.isArray(image.RepoDigests) &&
        image.RepoDigests.includes(release.registryReference) &&
        labels['org.opencontainers.image.revision'] === release.sourceRevision &&
        labels['org.system-bootstrapper.test-job'] === String(release.candidateJobId),
      'pulled-image-does-not-match-accepted-source-job',
    );
  }
  private async staged(
    input: PromotionInput,
    config: RuntimeConfig,
    manifest: RecoveryManifest,
    services: Record<string, ContainerRow>,
    api: CandidateGitLabApi,
    security: Row,
    target: Row,
  ) {
    const checkpoint = input.stagedPromotion!,
      boundary = path.join(config._root, 'recovery/controller-promotions');
    ensure(
      path.isAbsolute(checkpoint) &&
        fs.realpathSync(checkpoint) === checkpoint &&
        checkpoint.startsWith(boundary + path.sep) &&
        fs.statSync(checkpoint).isDirectory(),
      'retained-staged-promotion-directory-required',
    );
    const bytes = readPrivateInput(path.join(checkpoint, 'operation.json')),
      state = record(JSON.parse(bytes.toString())),
      { release, evidence } = await this.candidates.completed(api, state, security);
    ensure(
      release.projectId === target.projectId &&
        release.registryRepository === target.registryRepository,
      'staged-controller-project-mismatch',
    );
    this.source.verifyObjects(release, input.checkout);
    this.source.verifyAncestry(manifest.sourceCommit, release.sourceRevision, input.checkout);
    this.source.verifyAncestry(release.sourceRevision, target.sourceRevision, input.checkout);
    const before = readPrivateInput(path.join(checkpoint, 'main-before.env')),
      current = readPrivateInput(config._main),
      alias = 'system-successor:' + release.sourceRevision + '-job' + release.candidateJobId;
    ensure(
      bytesSha(before) === state.configurationBeforeSha256 &&
        bytesSha(current) === state.configurationAfterSha256 &&
        promotionAssignment(before, alias).equals(current) &&
        config.BOOTSTRAPPER_IMAGE === alias &&
        state.controllerAlias === alias,
      'staged-controller-configuration-mismatch',
    );
    const manifestBytes = readPrivateInput(path.join(checkpoint, 'manifest-before.json'));
    ensure(
      manifestBytes.equals(fs.readFileSync(path.join(config._root, 'recovery/images.json'))),
      'staged-controller-recovery-manifest-changed',
    );
    const controller = services.system_bootstrapper_1,
      gitlab = services.system_gitlab_1;
    ownedCore(controller, 'bootstrapper');
    ownedCore(gitlab, 'gitlab');
    this.acceptedImage(release, { ...this.images.inspect(alias) });
    const stateRow = record(controller.State);
    ensure(
      controller.Id === state.newControllerId &&
        controller.Image === release.imageId &&
        stateRow.Running &&
        !stateRow.Paused &&
        !stateRow.OOMKilled,
      'staged-controller-running-image-mismatch',
    );
    ensure(
      gitlab.Image === record(record(evidence.evidence).gitlabUpgrade).fromImageId &&
        gitlab.Image === record(state.oldGitLab).imageId,
      'staged-controller-old-GitLab-image-changed',
    );
    if (state.coldMaintenance)
      this.checkpoints.verify(checkpoint, String(state.coldCheckpointSha256));
    const view = structuredClone(manifest);
    ensure(
      ![...view.publicImages, ...view.localImages].some((row) => row.tag === alias),
      'staged-controller-already-declared-in-recovery',
    );
    view.localImages.push({ tag: alias, imageId: String(release.imageId) });
    Object.assign(view.currentController!, {
      reference: alias,
      imageId: release.imageId,
      sourceCommit: release.sourceRevision,
      sourceTree: release.sourceTree,
    });
    this.manifests.validateSelected(view, config._main);
    return {
      manifest: view,
      receipt: {
        checkpoint,
        operationSha256: bytesSha(bytes),
        manifestSha256: bytesSha(manifestBytes),
        sourceRevision: release.sourceRevision,
        candidateJobId: release.candidateJobId,
      },
    };
  }
}
