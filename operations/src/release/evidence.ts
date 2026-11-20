import * as fs from 'node:fs';
import * as path from 'node:path';
import { imageId, positive, record, revision } from './source-identity';
import type { CandidateProof, CiIdentity, Environment, LifecycleEvidencePort, PublicationContext, SecurityProfile } from './types';
export interface CandidateReceipt { proof: CandidateProof; bytes: Buffer }
export function parseProof(input: unknown): CandidateProof {
  const value = record(input);
  const evidence = record(value.evidence);
  record(evidence.gitlabUpgrade);
  record(value.images);
  if (typeof value.runId !== 'string' || typeof value.sourceRevision !== 'string' ||
      !Array.isArray(value.results) || value.results.some(row => !row || typeof row !== 'object' ||
        typeof row.name !== 'string' || typeof row.status !== 'string')) throw Error('Malformed candidate receipt.');
  return value as unknown as CandidateProof;
}
export function createEvidence(release: SecurityProfile, guided: LifecycleEvidencePort) {
const upgradeKeys = ['fromImage', 'toImage', 'fromImageId', 'toImageId',
  'checkpointVerified', 'migrationVerified', 'registryVerified', 'rollbackVerified',
  'runnerImage', 'runnerImageId', 'fromRunnerImageId', 'runnerVersion', 'helperImage', 'helperImageId',
  'fromHelperImageId', 'jobCaBundleSha256', 'securityTrustVerified', 'runnerUpgradeVerified', 'runnerManagerIdentityPreserved'];
function validateLineage(restored: CandidateProof, original: CandidateProof, ci: CiIdentity) {
  validateReceipt(original, ci);
  const recovery = original.evidence?.recovery;
  if (original.runId === restored.runId || recovery?.runId !== restored.runId ||
      recovery.backupOnly !== true || recovery.originalHostRemoved !== true || recovery.guidedBindingRestored !== true ||
      restored.evidence?.recovery?.guidedBindingRestored !== true || restored.evidence?.recovery?.runId !== undefined ||
      !['candidate', 'wizard', 'runner', 'gitlab', 'nginx'].every(role => restored.images?.[role] === original.images?.[role]) ||
      !['candidate', 'wizard', 'runner'].every(role => imageId(original.images?.[role])) ||
      !upgradeKeys.every(key => original.evidence.gitlabUpgrade[key] === restored.evidence?.gitlabUpgrade?.[key]) ||
      !(['projectId', 'pipelineId', 'candidateJobId'] as const).every(key => positive(ci[key]) &&
        original.ciIdentity?.[key] === ci[key] && restored.ciIdentity?.[key] === ci[key]) ||
      !['recovery-original-host-removed', 'cleanup'].every(name => original.results.some(row => row.name === name && row.status === 'passed')))
    throw Error('Recovery summary must reference its matching complete successor receipt and same-job guided origin.');
  const lifecycle=guided.validate(original.evidence?.guidedPreview, original.results);
  if(lifecycle.productionImageId!==original.images.wizard)throw Error('Guided Production baseline must be the prepared Wizard image from the same candidate job.');
}
function guidedOrigin(original: CandidateProof): CandidateProof {
  return {format: 'system-guided-preview-origin-v1', runId: original.runId, sourceRevision: original.sourceRevision,
    fullAcceptance: true, ciIdentity: Object.fromEntries((['projectId','pipelineId','candidateJobId'] as const).map(key=>[key,original.ciIdentity?.[key]])),
    images: Object.fromEntries(['candidate', 'wizard', 'runner', 'gitlab', 'nginx'].filter(role => imageId(original.images[role])).map(role => [role, original.images[role]])),
    results: original.results.filter(row => [...guided.stages, 'recovery-original-host-removed', 'cleanup'].includes(row.name))
      .map(row => ({name: row.name, status: row.status})),
    evidence: {guidedPreview: guided.sanitize(original.evidence.guidedPreview),
      gitlabUpgrade: Object.fromEntries(upgradeKeys.filter(key => original.evidence.gitlabUpgrade[key] !== undefined && (!['fromImageId','toImageId'].includes(key)||imageId(original.evidence.gitlabUpgrade[key]))).map(key => [key, original.evidence.gitlabUpgrade[key]])),
      recovery: {runId: original.evidence.recovery!.runId, backupOnly: true, originalHostRemoved: true, guidedBindingRestored: true}}};
}

function sanitizeGuidedReceipt(input: unknown): CandidateProof | undefined {
  try {
    const value = parseProof(input);
    if(value?.format!=='system-guided-preview-origin-v1')return undefined;
    validateReceipt(value,{sourceRevision:value.sourceRevision});
    if(!revision(value.sourceRevision)||!(['projectId','pipelineId','candidateJobId'] as const).every(key=>positive(value.ciIdentity?.[key]))||
      !(typeof value.evidence?.recovery?.runId==='string'&&/^[a-f0-9]{24}$/.test(value.evidence.recovery!.runId))||value.evidence.recovery!.runId===value.runId||
      !['backupOnly','originalHostRemoved','guidedBindingRestored'].every(key=>value.evidence.recovery![key]===true))return undefined;
    guided.validate(value.evidence?.guidedPreview,value.results);
    return guidedOrigin(value);
  }catch{return undefined;}
}

function context(env: Environment): PublicationContext {
  if (!revision(env.CI_COMMIT_SHA) || !['CI_PROJECT_ID', 'CI_PIPELINE_ID', 'CI_JOB_ID']
    .every(key => /^[1-9][0-9]*$/.test(env[key] || '') && positive(Number(env[key]))) ||
    !/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(env.CI_REGISTRY || '') ||
    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(env.CI_PROJECT_PATH || '') ||
    env.CI_REGISTRY_IMAGE !== env.CI_REGISTRY + '/' + env.CI_PROJECT_PATH ||
    !['merge_request_event', 'push', 'web', 'schedule'].includes(env.CI_PIPELINE_SOURCE || ''))
    throw Error('Successor publication requires a valid same-project CI identity.');
  return {sourceRevision: env.CI_COMMIT_SHA, projectId: Number(env.CI_PROJECT_ID),
    pipelineId: Number(env.CI_PIPELINE_ID), candidateJobId: Number(env.CI_JOB_ID),
    registryRepository: env.CI_REGISTRY_IMAGE + '/successor'};
}

function validateReceipt(input: unknown, ci: CiIdentity): string {
  const proof = parseProof(input);
  const upgrade = proof.evidence.gitlabUpgrade;
  if (!/^[a-f0-9]{24}$/.test(proof.runId || '') || proof.sourceRevision !== ci.sourceRevision ||
    proof.fullAcceptance !== true || !Array.isArray(proof.results) || !proof.results.length ||
    proof.results.some(stage => stage.status !== 'passed') || !imageId(proof.images?.candidate) ||
    upgrade?.fromImage !== release.fromImage || upgrade?.toImage !== release.toImage ||
    !['migrationVerified', 'rollbackVerified', 'registryVerified', 'checkpointVerified'].every(k => upgrade[k] === true))
    throw Error('A complete passing successor migration receipt is required.');
  if (upgrade.runnerImage !== release.runner.toImage || upgrade.runnerImageId !== proof.images.runner ||
    !imageId(upgrade.runnerImageId) || upgrade.runnerVersion !== release.runner.toVersion ||
    upgrade.helperImage !== release.runner.helperImage || upgrade.jobCaBundleSha256 !== release.jobCaBundleSha256 ||
    upgrade.securityTrustVerified !== true || upgrade.runnerUpgradeVerified !== true || upgrade.runnerManagerIdentityPreserved !== true ||
    !imageId(upgrade.fromRunnerImageId) || upgrade.fromRunnerImageId === upgrade.runnerImageId || !imageId(upgrade.helperImageId) || !imageId(upgrade.fromHelperImageId) || upgrade.fromHelperImageId === upgrade.helperImageId) throw Error('Passing Runner and effective CA trust evidence is required.');
  return proof.images.candidate;
}

function validateEvidence(input: unknown, ci: CiIdentity): string {
  const proof = parseProof(input);
  const acceptedImage = validateReceipt(proof, ci);
  for (const name of ['gitlab-upgrade-migrated-data', 'gitlab-upgrade-registry-ci',
    'gitlab-upgrade-restored-checkpoint', 'gitlab-upgrade-security-trust',
    'storage-global-live-lease', 'storage-refuse-nonempty-and-corrupt-restore',
    'storage-detached-backup-normal-operation', 'cleanup']) {
    if (!proof.results.some(stage => stage.name === name && stage.status === 'passed'))
      throw Error('A required successor acceptance stage is missing.');
  }
  if (!['localLiveVerified', 'externalSeedRestored', 'backupDetached',
    'missingBackupGuardVerified', 'globalLeaseVerified', 'invalidRestoreGuardVerified']
    .every(key => proof.evidence?.storage?.[key] === true))
    throw Error('Passing local storage and external Seed recovery evidence is required.');
  if (proof.guidedPreviewReceipt !== undefined) {
    if (proof.guidedPreviewReceipt?.format !== 'system-guided-preview-origin-v1')
      throw Error('A versioned original guided preview receipt is required.');
    validateLineage(proof, proof.guidedPreviewReceipt, ci);
  } else {
    const lifecycle=guided.validate(proof.evidence?.guidedPreview, proof.results);
    if(lifecycle.productionImageId!==proof.images.wizard)throw Error('Guided Production baseline must be the prepared Wizard image from the same candidate job.');
  }
  return acceptedImage;
}

function candidates(directory: string, ci: CiIdentity): CandidateReceipt[] {
  const receipts = fs.readdirSync(directory).filter(name => /^[a-f0-9]{24}$/.test(name)).flatMap(name => {
    const dir = path.join(directory, name), filename = path.join(dir, 'results.json');
    if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink() ||
      !fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink())
      throw Error('Candidate evidence must be regular job-owned files.');
    const bytes = fs.readFileSync(filename), raw = record(JSON.parse(bytes.toString("utf8")));
    if (raw.fullAcceptance !== true || !raw.evidence || typeof raw.evidence !== 'object' ||
        !('gitlabUpgrade' in raw.evidence) || !raw.evidence.gitlabUpgrade) return [];
    const proof = parseProof(raw);
    validateReceipt(proof, ci);
    if (proof.runId !== name) throw Error('Candidate evidence directory mismatch.');
    return [{proof, bytes}];
  });
  const summaries = receipts.filter(({proof}) => proof.evidence?.recovery?.runId !== undefined);
  for (const {proof} of summaries) {
    const restoredRun = proof.evidence.recovery!.runId;
    const restored = receipts.find(item => item.proof.runId === restoredRun)?.proof;
    if (!(typeof restoredRun === 'string' && /^[a-f0-9]{24}$/.test(restoredRun)) || !restored)
      throw Error('Recovery summary must reference its matching complete successor receipt.');
    validateLineage(restored, proof, ci);
  }
  return receipts.filter(({proof}) => proof.evidence?.recovery?.runId === undefined).map(item => {
    const origins = summaries.filter(({proof}) => proof.evidence.recovery!.runId === item.proof.runId);
    if (origins.length > 1) throw Error('Exactly one original guided preview receipt must identify the restored host.');
    if (!origins.length) { validateEvidence(item.proof, ci); return item; }
    // Preserve where each stage actually ran. Only this frozen publication
    // artifact embeds the original host's sanitized proof; the restored host's
    // working receipt and migration stage results stay unchanged.
    const proof = {...item.proof, guidedPreviewReceipt: guidedOrigin(origins[0].proof)};
    validateEvidence(proof, ci);
    return {proof, bytes: Buffer.from(JSON.stringify(proof, null, 2) + '\n')};
  });
}

return { context, validateReceipt, validateEvidence, candidates, sanitizeGuidedReceipt };
}
