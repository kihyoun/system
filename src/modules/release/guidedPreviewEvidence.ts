import * as legacy from './guidedPreviewEvidenceV1';
import {
  object,
  fields,
  positive,
  sha,
  hash,
  image,
  boolean,
  oneOf,
  identity,
  operation,
  stagesPassed,
  type EvidenceObject,
} from './evidenceValues';
import type { CiIdentity } from './types';
export { stages, requiredJobs } from './guidedPreviewEvidenceV1';
export const stagesV2 = [
  'system-beta-native-source',
  'system-beta-native-setup',
  'system-beta-contract-verifier',
  'system-beta-native-binding',
  'system-beta-native-deploy',
  'system-beta-native-stop',
  'guided-preview-production-retained',
  'guided-preview-temporary-credential-revoked',
];
function sanitizeV2(value: EvidenceObject): EvidenceObject {
  const clean: EvidenceObject = { version: 2 };
  for (const [key, expected] of Object.entries({
    fixtureNamespace: 'system-beta-contract-fixture-v1',
    sourceLayout: 'system-monorepo-v1',
    acceptanceScope: 'native-lifecycle-with-contract-verifier',
  })) {
    if (value[key] === expected) {
      clean[key] = expected;
    }
  }
  fields(value, clean, ['productionMainSha256'], hash);
  fields(value, clean, ['productionImageId'], image);
  fields(value, clean, ['credentialCleanupUncertain', 'temporaryCredentialRevoked'], boolean);

  if (value.candidate && typeof value.candidate === 'object') {
    const source = object(value.candidate),
      row: EvidenceObject = {};
    fields(
      source,
      row,
      ['projectId', 'namespaceId', 'fixturePipelineId', 'fixtureCandidateJobId'],
      positive,
    );
    fields(source, row, ['sourceCommit', 'sourceTree', 'wizardSourceTree'], sha);
    fields(
      source,
      row,
      ['helperImage', 'wizardImageId', 'helperRegistryDigest', 'wizardRegistryDigest'],
      image,
    );
    fields(source, row, ['pipelineEvidence'], oneOf('contract-fixture'));
    clean.candidate = row;
  }

  if (value.setup && typeof value.setup === 'object') {
    const source = object(value.setup),
      row: EvidenceObject = {};
    fields(source, row, ['projectId', 'namespaceId'], positive);
    fields(source, row, ['sourceCommit'], sha);
    fields(source, row, ['operation'], operation);
    fields(
      source,
      row,
      ['native', 'productionChanged', 'reviewEnabled', 'betaEnabled', 'noBuildStarted'],
      boolean,
    );
    clean.setup = row;
  }

  if (value.verifier && typeof value.verifier === 'object') {
    const source = object(value.verifier),
      row: EvidenceObject = {};
    fields(source, row, ['mode'], oneOf('contract-fixture'));
    fields(source, row, ['passed', 'negativeGatesPassed'], boolean);
    clean.verifier = row;
  }

  if (value.productionRetained) {
    const source = object(value.productionRetained),
      row: EvidenceObject = {};
    fields(source, row, ['mainSha256'], hash);
    fields(source, row, ['runningImage'], image);
    clean.productionRetained = row;
  }

  if (value.beta && typeof value.beta === 'object') {
    const source = object(value.beta),
      row: EvidenceObject = {};
    fields(
      source,
      row,
      [
        'bindingVerified',
        'imageOwnershipVerified',
        'tlsVerified',
        'containerRemoved',
        'networkRemoved',
        'helperRemoved',
        'leaseReleased',
      ],
      boolean,
    );
    fields(
      source,
      row,
      ['fixtureDeployJobId', 'fixtureStopJobId', 'stoppedThroughPipelineId'],
      positive,
    );
    for (const key of ['deployment', 'stopped']) {
      if (source[key] && typeof source[key] === 'object') {
        const item = identity(source[key]);

        if (item.mrIid !== 0) {
          delete item.mrIid;
        }

        row[key] = item;
      }
    }
    clean.beta = row;
  }

  return clean;
}
export function sanitize(input: unknown): EvidenceObject | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }

  const value = object(input);

  if (value.version === 2) {
    return sanitizeV2(value);
  }

  if (value.version !== undefined && value.version !== 1) {
    return undefined;
  }

  const clean = legacy.sanitize(value);
  return clean && value.version === 1 ? { version: 1, ...clean } : clean;
}
function validateV2(
  value: EvidenceObject,
  results: unknown,
): EvidenceObject & { productionImageId: string } {
  const p = sanitizeV2(value),
    c = object(p.candidate),
    s = object(p.setup),
    b = object(p.beta),
    verifier = object(p.verifier),
    retained = object(p.productionRetained);
  const fail = () => {
    throw Error(
      'Complete native System Beta lifecycle and explicit contract-verifier evidence are required.',
    );
  };

  if (
    p.fixtureNamespace !== 'system-beta-contract-fixture-v1' ||
    p.sourceLayout !== 'system-monorepo-v1' ||
    p.acceptanceScope !== 'native-lifecycle-with-contract-verifier' ||
    !hash(p.productionMainSha256) ||
    !image(p.productionImageId) ||
    p.credentialCleanupUncertain === true ||
    p.temporaryCredentialRevoked !== true ||
    retained.mainSha256 !== p.productionMainSha256 ||
    retained.runningImage !== p.productionImageId ||
    !stagesPassed(results, stagesV2)
  ) {
    fail();
  }

  if (
    !['projectId', 'namespaceId', 'fixturePipelineId', 'fixtureCandidateJobId'].every((key) =>
      positive(c[key]),
    ) ||
    !['sourceCommit', 'sourceTree', 'wizardSourceTree'].every((key) => sha(c[key])) ||
    !['helperImage', 'wizardImageId', 'helperRegistryDigest', 'wizardRegistryDigest'].every((key) =>
      image(c[key]),
    ) ||
    c.pipelineEvidence !== 'contract-fixture' ||
    s.projectId !== c.projectId ||
    s.namespaceId !== c.namespaceId ||
    s.sourceCommit !== c.sourceCommit ||
    s.native !== true ||
    s.productionChanged !== false ||
    s.reviewEnabled !== false ||
    s.betaEnabled !== true ||
    s.noBuildStarted !== true ||
    verifier.mode !== 'contract-fixture' ||
    verifier.passed !== true ||
    verifier.negativeGatesPassed !== true
  ) {
    fail();
  }

  if (
    ![
      'bindingVerified',
      'imageOwnershipVerified',
      'tlsVerified',
      'containerRemoved',
      'networkRemoved',
      'helperRemoved',
      'leaseReleased',
    ].every((key) => b[key] === true) ||
    !positive(b.fixtureDeployJobId) ||
    !positive(b.fixtureStopJobId) ||
    b.fixtureDeployJobId === b.fixtureStopJobId ||
    !positive(b.stoppedThroughPipelineId) ||
    !positive(c.fixturePipelineId) ||
    Number(b.stoppedThroughPipelineId) < Number(c.fixturePipelineId)
  ) {
    fail();
  }

  const a = object(b.deployment),
    z = object(b.stopped);

  if (
    a.state !== 'active' ||
    z.state !== 'stopped' ||
    a.projectId !== c.projectId ||
    a.pipelineId !== c.fixturePipelineId ||
    a.jobId !== b.fixtureDeployJobId ||
    a.mrIid !== 0 ||
    a.sourceCommit !== c.sourceCommit ||
    a.operation !== s.operation ||
    !operation(a.operation) ||
    a.generation !== 'p' + c.fixturePipelineId + '-j' + b.fixtureDeployJobId ||
    a.imageDigest !== c.wizardRegistryDigest ||
    ![
      'projectId',
      'pipelineId',
      'jobId',
      'mrIid',
      'sourceCommit',
      'operation',
      'generation',
      'imageDigest',
    ].every((key) => a[key] === z[key])
  ) {
    fail();
  }

  return p as EvidenceObject & { productionImageId: string };
}
export function validate(
  input: unknown,
  results: unknown,
): EvidenceObject & { productionImageId: string } {
  const value = object(input);

  if (value.version === 2) {
    return validateV2(value, results);
  }

  if (value.version !== undefined && value.version !== 1) {
    throw Error('Unsupported guided acceptance evidence version.');
  }

  return legacy.validate(input, results);
}
export function validateAuthority(
  input: unknown,
  results: unknown,
  context: CiIdentity & {
    candidateImageId: string;
    wizardImageId: string;
    ciIdentity?: Omit<CiIdentity, 'sourceRevision'>;
  },
): EvidenceObject & { productionImageId: string } {
  const value = object(input),
    proof = validate(input, results);

  if (proof.productionImageId !== context.wizardImageId) {
    throw Error('Guided Production baseline must match the accepted Wizard image.');
  }

  if (context.sourceLayout === 'system-monorepo-v1' || value.version === 2) {
    const candidate = object(proof.candidate);

    if (
      context.sourceLayout !== 'system-monorepo-v1' ||
      proof.version !== 2 ||
      !sha(context.sourceTree) ||
      !sha(context.wizardSourceTree) ||
      candidate.sourceCommit !== context.sourceRevision ||
      candidate.sourceTree !== context.sourceTree ||
      candidate.wizardSourceTree !== context.wizardSourceTree ||
      candidate.helperImage !== context.candidateImageId ||
      candidate.wizardImageId !== context.wizardImageId ||
      !positive(context.ciIdentity?.projectId) ||
      !positive(context.ciIdentity?.pipelineId) ||
      !positive(context.ciIdentity?.candidateJobId) ||
      candidate.fixturePipelineId !== context.ciIdentity?.pipelineId ||
      candidate.fixtureCandidateJobId !== context.ciIdentity?.candidateJobId
    ) {
      throw Error(
        'System Beta fixture evidence must match the exact accepted source, images and candidate attempt.',
      );
    }
  } else if (context.sourceLayout !== undefined) {
    throw Error('Unsupported guided source layout.');
  }

  return proof;
}
