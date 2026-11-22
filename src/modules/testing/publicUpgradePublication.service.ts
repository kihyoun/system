import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { record } from '../release/sourceIdentity';
import { hostRequiredJobs, hostComponents } from '../host/releaseAuthority.service';
import { requireValue as ensure } from '../host/install';
import { bytesSha } from '../host/releaseSelection.service';
import { UpgradePrerequisiteService } from '../host/upgradePrerequisite.service';
type Row = Record<string, unknown>;
/** Deterministic future publication transport, never exported as candidate evidence. */
export function fixtureEncoding(value: unknown): Buffer {
  const stable = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, stable(item)]),
          )
        : value;
  return Buffer.from(JSON.stringify(stable(value), null, 2) + '\n');
}
@Injectable()
export class PublicUpgradePublicationService {
  constructor(readonly prerequisite: UpgradePrerequisiteService) {}

  prepare(checkout: string, fixture: Row) {
    const previous = record(fixture.previous),
      spec = record(fixture.spec),
      previousSource = record(previous.source),
      previousImages = record(previous.images);
    const graph = record(
      JSON.parse(
        fs.readFileSync(path.join(checkout, 'config/releases/upgrade-paths.json'), 'utf8'),
      ),
    );
    const transitions = graph.transitions as Row[];
    const edge = fixture.edge ? record(fixture.edge) : transitions[0];
    const source: Row = {
      repository: previousSource.repository,
      revision: spec.sourceRevision,
      tree: spec.sourceTree,
    };
    const shared = spec.sourceLayout === 'system-monorepo-v1';
    Object.assign(
      source,
      shared
        ? { sourceLayout: 'system-monorepo-v1', wizardSourceTree: spec.wizardSourceTree }
        : { wizardRevision: spec.wizardSourceRevision },
    );
    const specImages = record(spec.images);
    const images = Object.fromEntries(
      [
        ['controller', 'candidate'],
        ['wizard', 'wizard'],
      ].map(([role, key]) => {
        const value = record(specImages[key]);
        return [
          role,
          {
            reference: 'system-upgrade-fixture/' + role + '@' + value.id,
            imageId: value.id,
            configDigest: value.configDigest,
          },
        ];
      }),
    );
    const upgrade = {
      ...record(fixture.gitlabUpgrade),
      ...(fixture.publicationMode === 'future-release-before-prerequisite-v1'
        ? {
            checkpointVerified: true,
            migrationVerified: true,
            registryVerified: true,
            securityTrustVerified: true,
            runnerUpgradeVerified: true,
          }
        : {}),
      rollbackVerified: true,
      runnerManagerIdentityPreserved: true,
    };
    const publicUpgrade: Row = {
      fromVersion: previous.version,
      toVersion: edge.to,
      fromSourceRevision: previousSource.revision,
      fromControllerImageId: record(previousImages.controller).imageId,
      fromWizardImageId: record(previousImages.wizard).imageId,
      dataPreserved: true,
      configurationPreserved: true,
      runnerRegistryVerified: true,
      rollbackVerified: true,
    };
    const security: unknown = JSON.parse(
      fs.readFileSync(path.join(checkout, 'config/gitlab/security-release.json'), 'utf8'),
    );

    if (transitions.some((row) => row.databaseMigration && row.to === edge.to)) {
      // The publication transport models an already accepted future release.
      // Its candidate checkpoint is not this installation's checkpoint. The
      // real public prerequisite and plan independently verify the latter.
      const proof =
        fixture.publicationMode === 'future-release-before-prerequisite-v1'
          ? {
              checkpointSha256: bytesSha(fixtureEncoding({ source, security, images })),
              fromVersion: record(security).fromVersion,
              toVersion: record(security).toVersion,
            }
          : this.prerequisite.verify(
              String(fixture.live),
              path.join(
                String(fixture.live),
                'configuration/gitlab-upgrades',
                'candidate-' + fixture.runId,
              ),
              String(spec.sourceRevision),
              security,
            );
      Object.assign(publicUpgrade, {
        gitlabPrerequisiteVerified: true,
        gitlabCheckpointSha256: proof.checkpointSha256,
        gitlabFromVersion: proof.fromVersion,
        gitlabToVersion: proof.toVersion,
      });
    }

    const stages = [
      'gitlab-upgrade-migrated-data',
      'gitlab-upgrade-registry-ci',
      'gitlab-upgrade-restored-checkpoint',
      'storage-global-live-lease',
      'storage-refuse-nonempty-and-corrupt-restore',
      'storage-detached-backup-normal-operation',
      'cleanup',
      String(edge.requiredStage),
      'gitlab-upgrade-security-trust',
    ];
    const evidence: Row = {
      runId: fixture.runId,
      sourceRevision: source.revision,
      fullAcceptance: true,
      results: stages.map((name) => ({ name, status: 'passed' })),
      images: Object.fromEntries(
        Object.entries(specImages).map(([role, value]) => [role, record(value).id]),
      ),
      evidence: {
        gitlabUpgrade: upgrade,
        publicUpgrade,
        storage: Object.fromEntries(
          [
            'localLiveVerified',
            'externalSeedRestored',
            'backupDetached',
            'missingBackupGuardVerified',
            'globalLeaseVerified',
            'invalidRestoreGuardVerified',
          ].map((key) => [key, true]),
        ),
      },
    };

    if (shared) {
      const origin = record(fixture.guidedOrigin),
        guided = record(origin.guidedPreview);
      ensure(guided.version === 2 && origin.runId !== fixture.runId, 'shared-beta-origin-required');
      Object.assign(evidence, {
        sourceLayout: 'system-monorepo-v1',
        sourceTree: spec.sourceTree,
        wizardSourceTree: spec.wizardSourceTree,
        ciIdentity: spec.ciIdentity,
      });
      record(evidence.evidence).recovery = { guidedBindingRestored: true };
      evidence.guidedPreviewReceipt = {
        format: 'system-guided-preview-origin-v1',
        runId: origin.runId,
        sourceLayout: 'system-monorepo-v1',
        sourceRevision: source.revision,
        sourceTree: spec.sourceTree,
        wizardSourceTree: spec.wizardSourceTree,
        fullAcceptance: true,
        ciIdentity: spec.ciIdentity,
        images: evidence.images,
        results: origin.results,
        evidence: {
          guidedPreview: guided,
          gitlabUpgrade: upgrade,
          recovery: {
            runId: fixture.runId,
            backupOnly: true,
            originalHostRemoved: true,
            guidedBindingRestored: true,
          },
        },
      };
    }

    const release: Row = {
      format: 'system-successor-release-v1',
      sourceRevision: source.revision,
      sourceTree: source.tree,
      ...record(spec.ciIdentity),
      ...(shared
        ? { sourceLayout: 'system-monorepo-v1', wizardSourceTree: source.wizardSourceTree }
        : { wizardRevision: source.wizardRevision }),
      imageId: images.controller.imageId,
      wizardImageId: images.wizard.imageId,
      registryRepository: 'system-upgrade-fixture/controller',
      registryReference: images.controller.reference,
      wizardRegistryReference: images.wizard.reference,
      candidateEvidencePath: 'test-results/successor/candidate-results.json',
      candidateEvidenceSha256: bytesSha(fixtureEncoding(evidence)),
    };
    const names = [
      ...hostRequiredJobs,
      'test:wizard-browser',
      'test:codeql',
      'deploy:dockerhub',
      'deploy:github',
      ...hostComponents.map((component) => 'test:isolated: [' + component + ']'),
    ];
    const jobs = names.map((name, index) => ({
      name,
      id: name === 'test:platform-candidate' ? release.candidateJobId : 100000 + index,
      status: 'success',
      allow_failure: false,
      pipelineId: release.pipelineId,
      sourceRevision: source.revision,
    }));
    const proof = {
      format: 'system-public-upgrade-provenance-v1',
      version: edge.to,
      source,
      images,
      originalEvidenceSha256: release.candidateEvidenceSha256,
      publication: {
        protectedDefaultBranch: true,
        requiredMergeGate: true,
        nativePush: true,
        jobs,
      },
      graph,
      release,
      evidence,
    };
    const bytes = fixtureEncoding(proof);
    const metadata = {
      format: 'system-accepted-release-v1',
      version: edge.to,
      tag: 'v' + edge.to,
      platform: 'linux/amd64',
      source,
      images,
      compatibility: { versions: ['24.04'], minimumMemoryGiB: 8 },
      acceptance: {
        candidateJobId: release.candidateJobId,
        evidenceSha256: release.candidateEvidenceSha256,
        requiredChecksPassed: true,
        controllerWizardSameAttempt: true,
      },
      publicUpgrade: {
        file: 'system-upgrade-v' + edge.to + '.json',
        format: proof.format,
        sha256: bytesSha(bytes),
      },
    };
    return { metadata, proof: bytes, security };
  }
}
