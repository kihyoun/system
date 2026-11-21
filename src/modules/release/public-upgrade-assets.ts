import { createHash } from 'node:crypto';
import { validateUpgradeGraph } from '../host/upgrade-graph';
import type { AcceptedPublicMetadata } from './github-metadata';
import type { PublicationJob } from './github-acceptance';
import type { ReleaseAssets } from './github-presentation';
import type { CandidateProof, SuccessorRelease, LifecycleEvidencePort } from './types';
import type { createEvidence } from './evidence';
import { publicationRecord as record } from './github-transport';
export interface PublicUpgradePolicy {
  evidence: Pick<ReturnType<typeof createEvidence>, 'validateEvidence' | 'sanitizeGuidedReceipt'>;
  lifecycle: Pick<LifecycleEvidencePort, 'sanitize'>;
}
const hash = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const pick = (value: unknown, keys: string[]) => {
  const row = record(value);
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
};
/** Deliberate allowlist: never publish raw candidate records or private registries. */
export function publicUpgradeAssets(
  metadata: AcceptedPublicMetadata,
  released: SuccessorRelease,
  proof: CandidateProof,
  graphInput: unknown,
  jobs: PublicationJob[],
  policy: PublicUpgradePolicy,
): ReleaseAssets {
  const graph = validateUpgradeGraph(graphInput);
  if (graph.format !== 'system-upgrade-paths-v1' || !graph.versions.includes(metadata.version))
    throw Error('Reviewed upgrade graph required.');

  for (const edge of graph.transitions.filter((row) => row.to === metadata.version)) {
    const stage = proof.results.filter((row) => row.name === edge.requiredStage);
    const tested = proof.evidence.publicUpgrade ? record(proof.evidence.publicUpgrade) : undefined;
    if (
      edge.databaseMigration &&
      (!tested?.gitlabPrerequisiteVerified ||
        !/^[a-f0-9]{64}$/.test(String(tested.gitlabCheckpointSha256 || '')) ||
        tested.gitlabFromVersion !== '19.5.3' ||
        tested.gitlabToVersion !== '19.6.1')
    )
      throw Error('Native GitLab prerequisite proof required.');
    if (
      stage.length !== 1 ||
      stage[0].status !== 'passed' ||
      tested?.fromVersion !== edge.from ||
      tested.toVersion !== edge.to ||
      !/^[a-f0-9]{40}$/.test(String(tested.fromSourceRevision || '')) ||
      ![tested.fromControllerImageId, tested.fromWizardImageId].every((value) =>
        /^sha256:[a-f0-9]{64}$/.test(String(value || '')),
      ) ||
      ![
        'dataPreserved',
        'configurationPreserved',
        'runnerRegistryVerified',
        'rollbackVerified',
      ].every((key) => tested[key] === true)
    )
      throw Error('Previous public release transition has no matching candidate proof.');
  }
  const monorepo = released.sourceLayout === 'system-monorepo-v1';
  let guidedReceipt;
  if (monorepo) {
    const publisher = policy.evidence;
    publisher.validateEvidence(proof, released);
    if (proof.guidedPreviewReceipt) {
      guidedReceipt = publisher.sanitizeGuidedReceipt(proof.guidedPreviewReceipt);
      if (!guidedReceipt) throw Error('Validated original System Beta authority is required.');
    }
  }
  const evidence = {
    ...(monorepo
      ? {
          sourceLayout: released.sourceLayout,
          sourceTree: released.sourceTree,
          wizardSourceTree: released.wizardSourceTree,
          ciIdentity: pick(proof.ciIdentity, ['projectId', 'pipelineId', 'candidateJobId']),
          ...(guidedReceipt ? { guidedPreviewReceipt: guidedReceipt } : {}),
        }
      : {}),
    sourceRevision: proof.sourceRevision,
    runId: proof.runId,
    fullAcceptance: proof.fullAcceptance,
    images: pick(proof.images, ['candidate', 'wizard', 'gitlab', 'runner', 'nginx']),
    results: proof.results.map((row) => pick(row, ['name', 'status'])),
    evidence: {
      ...(monorepo
        ? guidedReceipt
          ? { recovery: pick(proof.evidence.recovery, ['guidedBindingRestored']) }
          : { guidedPreview: policy.lifecycle.sanitize(proof.evidence.guidedPreview) }
        : {}),
      storage: pick(proof.evidence.storage, [
        'localLiveVerified',
        'externalSeedRestored',
        'backupDetached',
        'missingBackupGuardVerified',
        'globalLeaseVerified',
        'invalidRestoreGuardVerified',
      ]),
      gitlabUpgrade: pick(proof.evidence.gitlabUpgrade, [
        'fromImage',
        'toImage',
        'fromImageId',
        'toImageId',
        'checkpointVerified',
        'migrationVerified',
        'registryVerified',
        'rollbackVerified',
        'runnerImage',
        'runnerImageId',
        'fromRunnerImageId',
        'runnerVersion',
        'helperImage',
        'helperImageId',
        'fromHelperImageId',
        'jobCaBundleSha256',
        'securityTrustVerified',
        'runnerUpgradeVerified',
        'runnerManagerIdentityPreserved',
      ]),
      ...(proof.evidence.publicUpgrade
        ? {
            publicUpgrade: pick(proof.evidence.publicUpgrade, [
              'fromVersion',
              'toVersion',
              'fromSourceRevision',
              'fromControllerImageId',
              'fromWizardImageId',
              'dataPreserved',
              'configurationPreserved',
              'runnerRegistryVerified',
              'rollbackVerified',
              'gitlabPrerequisiteVerified',
              'gitlabCheckpointSha256',
              'gitlabFromVersion',
              'gitlabToVersion',
            ]),
          }
        : {}),
    },
  };
  const evidenceBytes = bytes(evidence);
  const release = {
    ...pick(released, [
      'format',
      'sourceRevision',
      'sourceTree',
      'sourceLayout',
      'wizardSourceTree',
      'wizardRevision',
      'projectId',
      'pipelineId',
      'candidateJobId',
      'imageId',
      'wizardImageId',
      'candidateEvidencePath',
    ]),
    registryRepository: metadata.images.controller.reference.split('@')[0],
    registryReference: metadata.images.controller.reference,
    wizardRegistryReference: metadata.images.wizard.reference,
    candidateEvidenceSha256: hash(evidenceBytes),
  };
  const value = {
    format: 'system-public-upgrade-provenance-v1',
    version: metadata.version,
    source: metadata.source,
    images: metadata.images,
    originalEvidenceSha256: metadata.acceptance.evidenceSha256,
    publication: {
      protectedDefaultBranch: true,
      requiredMergeGate: true,
      nativePush: true,
      jobs: jobs
        .filter((row) => row.status === 'success' && row.allow_failure === false)
        .map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          allow_failure: row.allow_failure,
          pipelineId: row.pipeline.id,
          sourceRevision: row.commit.id,
        })),
    },
    graph,
    release,
    evidence,
  };
  const payload = bytes(value),
    filename = 'system-upgrade-v' + metadata.version + '.json';
  metadata.publicUpgrade = { file: filename, sha256: hash(payload), format: value.format };
  return { [filename]: payload };
}
