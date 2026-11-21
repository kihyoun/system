import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateUpgradeGraph } from './upgrade-graph';
import { requireValue as ensure } from './install';
import { canonicalDigest, recoveryReference } from './recovery-manifest';
import {
  imageId,
  positive,
  record,
  revision,
  readSourceIdentity,
} from '../release/source-identity';
import { createEvidence, parseProof } from '../release/evidence';
import type { LifecycleEvidencePort, SecurityProfile } from '../release/types';
export const hostRequiredJobs = [
  'check:documentation',
  'prepare:wizard-source',
  'test:candidate-image',
  'test:platform-candidate',
  'build',
] as const;
export const hostComponents = [
  'gitlab',
  'sync',
  'gitlab-runner',
  'bootstrapper',
  'nginx',
  'wizard',
  'shared',
  'performance',
] as const;
const stages = [
  'gitlab-upgrade-migrated-data',
  'gitlab-upgrade-registry-ci',
  'gitlab-upgrade-restored-checkpoint',
  'storage-global-live-lease',
  'storage-refuse-nonempty-and-corrupt-restore',
  'storage-detached-backup-normal-operation',
  'cleanup',
];
const storageProofs = [
  'localLiveVerified',
  'externalSeedRestored',
  'backupDetached',
  'missingBackupGuardVerified',
  'globalLeaseVerified',
  'invalidRestoreGuardVerified',
];
export class HostReleaseAuthorityService {
  constructor(readonly lifecycle: LifecycleEvidencePort) {}

  publicInputs(metadataValue: unknown, proofBytes: Buffer, security: unknown) {
    const metadata = record(metadataValue),
      descriptor = record(metadata.publicUpgrade),
      acceptance = record(metadata.acceptance),
      source = record(metadata.source),
      images = record(metadata.images);
    ensure(
      metadata.format === 'system-accepted-release-v1' &&
        descriptor.format === 'system-public-upgrade-provenance-v1' &&
        descriptor.file === 'system-upgrade-v' + metadata.version + '.json' &&
        descriptor.sha256 === crypto.createHash('sha256').update(proofBytes).digest('hex'),
      'public-upgrade-provenance-hash-mismatch',
    );
    const value = record(JSON.parse(proofBytes.toString('utf8')));
    ensure(
      value.format === descriptor.format &&
        value.version === metadata.version &&
        isDeepStrictEqual(value.source, source) &&
        isDeepStrictEqual(value.images, images) &&
        value.originalEvidenceSha256 === acceptance.evidenceSha256 &&
        acceptance.requiredChecksPassed === true &&
        acceptance.controllerWizardSameAttempt === true,
      'public-upgrade-publisher-identity-mismatch',
    );
    const graph = validateUpgradeGraph(value.graph),
      releaseBytes = Buffer.from(JSON.stringify(value.release, null, 2) + '\n'),
      evidenceBytes = Buffer.from(JSON.stringify(value.evidence, null, 2) + '\n');
    const { release: r, evidence } = this.inputs(releaseBytes, evidenceBytes, security);
    const identities =
      r.sourceLayout === 'system-monorepo-v1'
        ? [
            ['sourceRevision', 'revision'],
            ['sourceTree', 'tree'],
            ['sourceLayout', 'sourceLayout'],
            ['wizardSourceTree', 'wizardSourceTree'],
          ]
        : [
            ['sourceRevision', 'revision'],
            ['sourceTree', 'tree'],
            ['wizardRevision', 'wizardRevision'],
          ];
    ensure(
      identities.every(([key, field]) => r[key] === source[field]) &&
        (r.sourceLayout === 'system-monorepo-v1'
          ? source.wizardRevision === undefined
          : source.sourceLayout === undefined && source.wizardSourceTree === undefined) &&
        [
          ['controller', 'imageId'],
          ['wizard', 'wizardImageId'],
        ].every(([role, key]) => {
          const image = record(images[role]);
          return r[key] === image.imageId && imageId(image.configDigest);
        }) &&
        r.registryReference === record(images.controller).reference &&
        r.wizardRegistryReference === record(images.wizard).reference &&
        r.candidateJobId === acceptance.candidateJobId,
      'public-upgrade-candidate-identity-mismatch',
    );
    const publication = record(value.publication);
    ensure(
      ['protectedDefaultBranch', 'requiredMergeGate', 'nativePush'].every(
        (key) => publication[key] === true,
      ),
      'public-upgrade-required-gates-missing',
    );
    ensure(Array.isArray(publication.jobs), 'public-upgrade-required-jobs-missing');
    const jobs = publication.jobs.map(record),
      names = jobs.map((job) => job.name);
    const required = [
      ...hostRequiredJobs,
      'test:wizard-browser',
      'test:codeql',
      'deploy:dockerhub',
      'deploy:github',
      ...hostComponents.map((component) => 'test:isolated: [' + component + ']'),
    ];
    ensure(
      new Set(names).size === names.length && required.every((name) => names.includes(name)),
      'public-upgrade-required-jobs-missing',
    );
    for (const job of jobs)
      ensure(
        positive(job.id) &&
          job.status === 'success' &&
          job.allow_failure === false &&
          job.pipelineId === r.pipelineId &&
          job.sourceRevision === r.sourceRevision,
        'public-upgrade-job-identity-mismatch',
      );
    ensure(
      jobs.find((job) => job.name === 'test:platform-candidate')!.id === r.candidateJobId,
      'public-upgrade-candidate-job-mismatch',
    );
    const results = (evidence.results as unknown[]).map(record),
      tested = record(record(evidence.evidence).publicUpgrade ?? {});
    for (const edge of graph.transitions ?? []) {
      if (edge.to !== metadata.version) continue;
      if (edge.databaseMigration)
        ensure(
          tested.gitlabPrerequisiteVerified === true &&
            typeof tested.gitlabCheckpointSha256 === 'string' &&
            /^[a-f0-9]{64}$/.test(tested.gitlabCheckpointSha256) &&
            tested.gitlabFromVersion === '19.5.3' &&
            tested.gitlabToVersion === '19.6.1',
          'public-upgrade-GitLab-prerequisite-not-tested',
        );
      const stages = results.filter((stage) => stage.name === edge.requiredStage);
      ensure(
        stages.length === 1 &&
          stages[0].status === 'passed' &&
          tested.fromVersion === edge.from &&
          tested.toVersion === edge.to &&
          revision(tested.fromSourceRevision) &&
          ['fromControllerImageId', 'fromWizardImageId'].every((key) => imageId(tested[key])) &&
          [
            'dataPreserved',
            'configurationPreserved',
            'runnerRegistryVerified',
            'rollbackVerified',
          ].every((key) => tested[key] === true),
        'public-upgrade-transition-not-tested',
      );
    }
    return {
      graph,
      proof: value,
      release: r,
      evidence,
      releaseBytes: releaseBytes.toString('base64'),
      evidenceBytes: evidenceBytes.toString('base64'),
    };
  }

  inputs(
    releaseBytes: Buffer,
    evidenceBytes: Buffer,
    securityValue: unknown,
  ): { release: Record<string, unknown>; evidence: Record<string, unknown> } {
    const release = record(JSON.parse(releaseBytes.toString('utf8'))),
      evidence = record(JSON.parse(evidenceBytes.toString('utf8'))),
      security = record(securityValue);
    ensure(release.format === 'system-successor-release-v1', 'invalid-successor-release-format');
    try {
      readSourceIdentity(release);
    } catch {
      throw Error('invalid-successor-source-identity');
    }
    for (const key of ['projectId', 'pipelineId', 'candidateJobId'])
      ensure(positive(release[key]), 'invalid-successor-CI-identity');
    ensure(
      imageId(release.imageId) &&
        recoveryReference(release.registryReference) &&
        canonicalDigest(release.registryReference) === release.registryReference &&
        release.registryReference.split('@')[0] === release.registryRepository,
      'invalid-immutable-successor-image',
    );
    ensure(
      release.candidateEvidencePath === 'test-results/successor/candidate-results.json' &&
        release.candidateEvidenceSha256 ===
          crypto.createHash('sha256').update(evidenceBytes).digest('hex'),
      'successor-evidence-hash-or-path-mismatch',
    );
    ensure(
      evidence.sourceRevision === release.sourceRevision &&
        evidence.fullAcceptance === true &&
        typeof evidence.runId === 'string' &&
        /^[a-f0-9]{24}$/.test(evidence.runId),
      'successor-full-acceptance-required',
    );
    ensure(
      Array.isArray(evidence.results) &&
        evidence.results.length > 0 &&
        evidence.results.every((value) => record(value).status === 'passed'),
      'successor-stage-did-not-pass',
    );
    const names = evidence.results.map((value) => record(value).name);
    ensure(
      stages.every((name) => names.includes(name)),
      'successor-required-migration-stage-missing',
    );
    const facts = record(evidence.evidence),
      storage = record(facts.storage),
      images = record(evidence.images),
      upgrade = record(facts.gitlabUpgrade);
    ensure(
      storageProofs.every((key) => storage[key] === true),
      'successor-storage-acceptance-required',
    );
    if (security.runner) {
      const runner = record(security.runner);
      ensure(
        upgrade.runnerImage === runner.toImage &&
          upgrade.runnerImageId === images.runner &&
          imageId(upgrade.runnerImageId) &&
          upgrade.runnerVersion === runner.toVersion &&
          upgrade.helperImage === runner.helperImage &&
          upgrade.jobCaBundleSha256 === security.jobCaBundleSha256 &&
          [
            'securityTrustVerified',
            'runnerUpgradeVerified',
            'runnerManagerIdentityPreserved',
          ].every((key) => upgrade[key] === true) &&
          ['fromRunnerImageId', 'helperImageId', 'fromHelperImageId'].every((key) =>
            imageId(upgrade[key]),
          ) &&
          upgrade.fromRunnerImageId !== upgrade.runnerImageId &&
          upgrade.fromHelperImageId !== upgrade.helperImageId &&
          names.includes('gitlab-upgrade-security-trust'),
        'successor-runner-security-evidence-mismatch',
      );
    }
    ensure(
      images.candidate === release.imageId &&
        upgrade.fromImage === security.fromImage &&
        upgrade.toImage === security.toImage &&
        ['migrationVerified', 'rollbackVerified', 'registryVerified', 'checkpointVerified'].every(
          (key) => upgrade[key] === true,
        ) &&
        imageId(upgrade.fromImageId) &&
        imageId(upgrade.toImageId) &&
        images.gitlab === upgrade.toImageId,
      'successor-migration-evidence-mismatch',
    );
    if (release.sourceLayout === 'system-monorepo-v1') {
      ensure(
        imageId(release.wizardImageId) && images.wizard === release.wizardImageId,
        'successor-Wizard-release-evidence-mismatch',
      );
      try {
        createEvidence(security as unknown as SecurityProfile, this.lifecycle).validateEvidence(
          parseProof(evidence),
          {
            sourceLayout: 'system-monorepo-v1',
            sourceRevision: String(release.sourceRevision),
            sourceTree: String(release.sourceTree),
            wizardSourceTree: String(release.wizardSourceTree),
            projectId: Number(release.projectId),
            pipelineId: Number(release.pipelineId),
            candidateJobId: Number(release.candidateJobId),
          },
        );
      } catch {
        throw Error('successor-System-Beta-authority-required');
      }
    }
    return { release, evidence };
  }
}
