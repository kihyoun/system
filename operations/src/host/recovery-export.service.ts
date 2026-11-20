import { HostReleaseAuthorityService } from './release-authority.service';
import { CandidateAuthorityService } from './candidate-authority.service';
import { CandidateGitLabService } from './candidate-gitlab.service';
import {
  RuntimeVerificationService,
  serviceOrigin,
} from '../host-bootstrap/runtime-verification.service';
import { readPrivateInput } from './private-input';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HostInstallService, requireValue as ensure, writePrivate } from './install';
import { HostSourceService } from './source';
import { RecoveryManifestService, canonicalDigest, fileSha } from './recovery-manifest';
import { RecoveryImageService } from './recovery-images';
import { RecoveryArchiveService } from './recovery-archive.service';
import { RecoveryPublicationService } from './recovery-publication.service';
import { RuntimeInspectionService, runnerCount, type RuntimeConfig } from './runtime-inspection';
import { ControllerLeaseService } from './controller-lease.service';
import { PublicUpgradePreparationService } from './public-upgrade-preparation.service';
import { record } from '../release/source-identity';

export interface RecoveryExportInput {
  checkout: string;
  persistenceEnv: string;
  release: string;
  evidence: string;
  gitlabUrl: string;
  tokenFile: string;
  output: string;
}
type Row = Record<string, unknown>;
/** Retain an accepted running controller without changing saved service selections. */
export class RecoveryExportService {
  constructor(
    readonly host: HostInstallService,
    readonly source: HostSourceService,
    readonly manifests: RecoveryManifestService,
    readonly images: RecoveryImageService,
    readonly archives: RecoveryArchiveService,
    readonly publication: RecoveryPublicationService,
    readonly inspection: RuntimeInspectionService,
    readonly lease: ControllerLeaseService,
    readonly preparation: PublicUpgradePreparationService,
    readonly runtime: RuntimeVerificationService,
    readonly authority: HostReleaseAuthorityService,
    readonly candidate: CandidateAuthorityService,
    readonly gitlab: CandidateGitLabService,
  ) {}
  async execute(input: RecoveryExportInput): Promise<Row> {
    ensure(this.host.rootUser(), 'recovery-export-requires-root');
    const checkout = path.resolve(input.checkout);
    const config = await this.runtime.settings(
      input.persistenceEnv,
      checkout,
      this.host.environment,
    );
    ensure(
      input.gitlabUrl.replace(/\/$/, '') === serviceOrigin(config, 'GITLAB'),
      'GitLab-origin-does-not-match-saved-config',
    );
    const releaseBytes = readPrivateInput(input.release),
      evidenceBytes = readPrivateInput(input.evidence);
    const { release, evidence } = this.authority.inputs(
      releaseBytes,
      evidenceBytes,
      JSON.parse(fs.readFileSync(path.join(checkout, 'gitlab/security-release.json'), 'utf8')),
    );
    await this.candidate.pipeline(
      this.gitlab.connect(input.gitlabUrl, input.tokenFile),
      release,
      releaseBytes,
      evidenceBytes,
    );
    return this.record(config, release, evidence, checkout, input.output);
  }
  private container(name: string): Row {
    const rows: unknown = JSON.parse(
      this.host.run('docker', ['--host=unix:///var/run/docker.sock', 'inspect', name]),
    );
    ensure(Array.isArray(rows) && rows.length === 1, 'running-owned-container-required');
    const value = record(rows[0]);
    ensure(record(value.State).Running === true, 'running-owned-container-required');
    return value;
  }
  private publish(
    directory: string,
    value: Row,
    checkout: string,
    configuration: string,
    previous: Buffer,
  ): void {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    const candidate = this.manifests.load(directory, checkout, undefined, false, bytes.toString());
    this.manifests.validateSelected(candidate, configuration);
    const selected = path.join(directory, 'images.json');
    ensure(
      fs.readFileSync(selected).equals(previous),
      'recovery-manifest-changed-before-publication',
    );
    const history = path.join(directory, 'manifest-history');
    fs.mkdirSync(history, { mode: 0o700, recursive: true });
    const stat = fs.lstatSync(history);
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'manifest-history-must-not-be-symlink');
    const saved = path.join(
      history,
      'images-' + crypto.createHash('sha256').update(previous).digest('hex') + '.json',
    );
    if (fs.existsSync(saved))
      ensure(fs.readFileSync(saved).equals(previous), 'previous-recovery-history-hash-mismatch');
    else writePrivate(saved, previous);
    writePrivate(selected, bytes);
  }
  async record(
    config: RuntimeConfig,
    release: Row,
    evidence: Row,
    checkout: string,
    output: string,
  ): Promise<Row> {
    this.source.verifyCheckout(release, checkout);
    const source = this.host.source(checkout),
      directory = path.join(config._root, 'recovery');
    this.lease.acquire({ root: config._root, seedDirectory: config.SEED_DIR || undefined });
    let failed = true;
    try {
      // All runtime identities and the selected manifest are observed under the shared lease.
      const previousBytes = fs.readFileSync(path.join(directory, 'images.json'));
      const previous = this.manifests.load(directory, checkout);
      const controller = this.container('system_bootstrapper_1'),
        gitlab = this.container('system_gitlab_1');
      const labels = record(record(controller.Config).Labels);
      ensure(
        labels['com.docker.compose.project'] === 'system' &&
          labels['com.docker.compose.service'] === 'bootstrapper',
        'owned-controller-required',
      );
      ensure(controller.Image === release.imageId, 'running-controller-is-not-accepted-successor');
      const reference = config.BOOTSTRAPPER_IMAGE;
      ensure(
        reference ===
          'system-successor:' + release.sourceRevision + '-job' + release.candidateJobId,
        'saved-controller-is-not-accepted-successor',
      );
      const registry = this.images.inspect(String(release.registryReference));
      ensure(
        this.images.inspect(reference).Id === controller.Image &&
          registry.Id === controller.Image &&
          registry.RepoDigests?.includes(String(release.registryReference)),
        'controller-registry-pin-mismatch',
      );
      const upgrade = record(record(evidence.evidence).gitlabUpgrade);
      ensure(
        gitlab.Image === upgrade.toImageId && config.GITLAB_IMAGE === upgrade.toImage,
        'recovery-export-requires-completed-security-migration',
      );
      const selected = this.images.inspect(config.GITLAB_IMAGE);
      ensure(
        selected.Id === gitlab.Image &&
          selected.RepoDigests?.includes(canonicalDigest(config.GITLAB_IMAGE)),
        'running-GitLab-does-not-match-pinned-config',
      );
      ensure(
        config.GITLAB_RUNNER_IMAGE === upgrade.runnerImage,
        'recovery-export-requires-completed-runner-upgrade',
      );
      const runner = this.images.inspect(config.GITLAB_RUNNER_IMAGE);
      ensure(
        runner.Id === upgrade.runnerImageId &&
          runner.RepoDigests?.includes(canonicalDigest(config.GITLAB_RUNNER_IMAGE)),
        'running-Runner-does-not-match-pinned-config',
      );
      const services = this.inspection.inspect(config);
      for (let index = 1; index <= runnerCount(config); index++)
        ensure(
          services['runner_docker_' + index]?.Image === runner.Id,
          'recovery-export-requires-completed-runner-upgrade',
        );
      this.inspection.mounts(config, services);
      await this.preparation.syncIdle(config);
      const before = fs.readFileSync(config._main);
      const archive = await this.archives.save(
        directory,
        reference,
        String(controller.Image),
        source,
      );
      const value = this.publication.refresh(
        previous,
        archive,
        source,
        reference,
        String(controller.Image),
        config.GITLAB_IMAGE,
        String(gitlab.Image),
        config.WIZARD_IMAGE,
        config.GITLAB_RUNNER_IMAGE,
        runner.Id,
      );
      record(value.currentController).registryReference = release.registryReference;
      ensure(
        fs.readFileSync(config._main).equals(before) &&
          this.container('system_gitlab_1').Image === gitlab.Image,
        'configuration-or-GitLab-changed-during-recovery-export',
      );
      this.publish(directory, value, checkout, config._main, previousBytes);
      const result = {
        format: 'system-recovery-export-v1',
        at: new Date().toISOString(),
        sourceRevision: source.sourceCommit,
        controllerImageId: controller.Image,
        GitLabImageId: gitlab.Image,
        manifestSha256: fileSha(path.join(directory, 'images.json')),
        runnerImageId: runner.Id,
        controllerArchive: archive.file,
        previousManifestRetained: true,
        savedConfigurationUnchanged: fs.readFileSync(config._main).equals(before),
      };
      writePrivate(output, Buffer.from(JSON.stringify(result, null, 2) + '\n'));
      failed = false;
      return result;
    } finally {
      this.lease.finish(failed);
    }
  }
}
