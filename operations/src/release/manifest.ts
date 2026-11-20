import { createEvidence, parseProof } from './evidence';
import { imageId, positive, readSourceIdentity, record } from './source-identity';
import { sha256 } from './successor-publication';
import type { CiIdentity, SuccessorRelease } from './types';
/** Validate exact frozen evidence bytes; a later cleanup receipt is not interchangeable. */
export function readSuccessorRelease(input: unknown, bytes: Buffer, ci: CiIdentity,
  registryImage: string, evidence: ReturnType<typeof createEvidence>): SuccessorRelease {
  const row = record(input), source = readSourceIdentity(row);
  const proof = parseProof(JSON.parse(bytes.toString('utf8')));
  if (row.format !== 'system-successor-release-v1' || source.sourceRevision !== ci.sourceRevision ||
      row.projectId !== ci.projectId || row.pipelineId !== ci.pipelineId || !positive(row.candidateJobId) ||
      row.candidateEvidencePath !== 'test-results/successor/candidate-results.json' ||
      row.candidateEvidenceSha256 !== sha256(bytes) ||
      evidence.validateEvidence(proof, { ...ci, candidateJobId: row.candidateJobId }) !== row.imageId ||
      !imageId(row.wizardImageId) || proof.images.wizard !== row.wizardImageId)
    throw Error('The exact same-pipeline passing controller and Wizard release is required.');
  for (const [field, suffix] of [['registryReference', '/successor'], ['wizardRegistryReference', '/successor-wizard']] as const) {
    const reference = row[field];
    if (typeof reference !== 'string' || !imageId(reference.split('@')[1]) ||
        reference !== registryImage + suffix + '@' + reference.split('@')[1])
      throw Error('Immutable same-project published image references are required.');
  }
  return { ...row, ...source } as SuccessorRelease;
}
