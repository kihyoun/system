import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { HostInstallService, requireValue as ensure, reference } from './install';
import { HostReleaseAuthorityService } from './release-authority.service';
import { CandidateAuthorityService } from './candidate-authority.service';
import { CandidateGitLabService } from './candidate-gitlab.service';
import {
  RuntimeVerificationService,
  serviceOrigin,
} from '../host-bootstrap/runtime-verification.service';
import { PairedUpdateService, type PairedCandidateAuthority } from './paired-update.service';
import { readPrivateInput } from './private-input';
import { record } from '../release/source-identity';
import type { RuntimeConfig } from './runtime-inspection';
type Row = Record<string, unknown>;
export interface PairedControllerInput {
  signal?: AbortSignal;
  operation: 'update' | 'status' | 'rollback';
  checkout: string;
  persistenceEnv: string;
  checkpoint: string;
  timeout: number;
  tokenFile?: string;
  redirectFrom?: string;
  checkOnly?: boolean;
  repairStoppedController?: boolean;
  releaseFile?: string;
  evidenceFile?: string;
  controller?: string;
  wizard?: string;
  releaseMetadata?: string;
  gitlabUrl?: string;
}
export class PairedControllerService {
  constructor(
    readonly host: HostInstallService,
    readonly runtime: RuntimeVerificationService,
    readonly releases: HostReleaseAuthorityService,
    readonly candidates: CandidateAuthorityService,
    readonly gitlab: CandidateGitLabService,
    readonly paired: PairedUpdateService,
  ) {}
  async execute(input: PairedControllerInput): Promise<Row> {
    ensure(
      ['update', 'status', 'rollback'].includes(input.operation),
      'invalid-controller-operation',
    );
    ensure(
      this.host.rootUser() &&
        Number.isInteger(input.timeout) &&
        input.timeout >= 60 &&
        input.timeout <= 3600,
      'root-and-bounded-readiness-timeout-required',
    );
    ensure(!input.checkOnly || input.operation === 'update', 'check-only-requires-update');
    ensure(
      !input.repairStoppedController || input.operation === 'update',
      'stopped-repair-requires-update',
    );
    for (const filename of [input.checkout, input.persistenceEnv, input.checkpoint])
      ensure(path.isAbsolute(filename), 'absolute-controller-input-required');
    const config = await this.runtime.settings(
      input.persistenceEnv,
      input.checkout,
      this.host.environment,
    );
    if (input.operation === 'status') {
      const state = this.paired.status(config, input.checkpoint);
      return {
        phase: state.phase,
        controller: state.controller,
        previousControllerImageId: record(state.previousController).imageId,
        ...(state.wizard
          ? { wizard: state.wizard, previousWizardImageId: record(state.previousWizard).imageId }
          : {}),
      };
    }
    ensure(input.tokenFile, 'private-API-token-file-required');
    const context = { ...input, tokenFile: input.tokenFile, config };
    if (input.operation === 'rollback') return this.paired.rollback(context);
    ensure(
      input.releaseFile && input.evidenceFile && input.controller && input.gitlabUrl,
      'public-controller-release-inputs-required',
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
      { release, evidence } = this.releases.inputs(releaseBytes, evidenceBytes, security),
      api = this.gitlab.connect(input.gitlabUrl, input.tokenFile);
    const authority: PairedCandidateAuthority = {
      pipeline: () => this.candidates.pipeline(api, release, releaseBytes, evidenceBytes),
      pair: (controller, wizard) =>
        this.candidates.publicPair(api, release, evidence, controller, wizard),
      evidenceSha256: String(release.candidateEvidenceSha256),
    };
    return this.paired.update({
      ...context,
      release,
      evidence,
      security,
      authority,
      controller: input.controller,
      accepted: input.releaseMetadata,
    });
  }
  /** The public publisher receipt is fully validated; it never masquerades as this installation's GitLab. */
  publicCandidate(metadata: Row, proofBytes: Buffer, security: Row) {
    const accepted = this.releases.publicInputs(metadata, proofBytes, security),
      release = accepted.release,
      evidence = accepted.evidence;
    const frozen = structuredClone({ metadata, release, evidence });
    const check = () =>
      ensure(
        isDeepStrictEqual(metadata, frozen.metadata) &&
          isDeepStrictEqual(release, frozen.release) &&
          isDeepStrictEqual(evidence, frozen.evidence),
        'public-upgrade-accepted-inputs-changed',
      );
    const authority: PairedCandidateAuthority = {
      evidenceSha256: String(record(metadata.acceptance).evidenceSha256),
      pipeline: async () => {
        check();
        return {
          authority: 'public-github-release',
          version: metadata.version,
          sourceRevision: release.sourceRevision,
          pipelineId: release.pipelineId,
          candidateJobId: release.candidateJobId,
          provenanceSha256: record(metadata.publicUpgrade).sha256,
        };
      },
      pair: async (controller, wizard) => {
        check();
        const images = record(metadata.images);
        ensure(
          reference(controller) === reference(String(record(images.controller).reference)) &&
            reference(wizard) === reference(String(record(images.wizard).reference)),
          'public-upgrade-pair-changed',
        );
        return {
          authority: 'public-github-release',
          provenanceSha256: record(metadata.publicUpgrade).sha256,
        };
      },
    };
    return { ...accepted, authority };
  }
}
