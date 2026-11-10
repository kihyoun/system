'use strict';

// Publish the image that passed the full candidate job, without rebuilding it.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {spawnSync} = require('child_process');
const release = require('./security-release.json');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value || '');
const revision = value => /^[a-f0-9]{40}$/.test(value || '');
const guided = require('./guided-preview-evidence');
const upgradeKeys = ['fromImage', 'toImage', 'fromImageId', 'toImageId',
  'checkpointVerified', 'migrationVerified', 'registryVerified', 'rollbackVerified',
  'runnerImage', 'runnerImageId', 'fromRunnerImageId', 'runnerVersion', 'helperImage', 'helperImageId',
  'fromHelperImageId', 'jobCaBundleSha256', 'securityTrustVerified', 'runnerUpgradeVerified', 'runnerManagerIdentityPreserved'];
function validateLineage(restored, original, ci) {
  validateReceipt(original, ci);
  const recovery = original.evidence?.recovery;
  if (original.runId === restored.runId || recovery?.runId !== restored.runId ||
      recovery.backupOnly !== true || recovery.originalHostRemoved !== true || recovery.guidedBindingRestored !== true ||
      restored.evidence?.recovery?.guidedBindingRestored !== true || restored.evidence?.recovery?.runId !== undefined ||
      !['candidate', 'wizard', 'runner', 'gitlab', 'nginx'].every(role => restored.images?.[role] === original.images?.[role]) ||
      !['candidate', 'wizard', 'runner'].every(role => imageId(original.images?.[role])) ||
      !upgradeKeys.every(key => original.evidence.gitlabUpgrade[key] === restored.evidence?.gitlabUpgrade?.[key]) ||
      !['projectId', 'pipelineId', 'candidateJobId'].every(key => Number.isSafeInteger(ci[key]) && ci[key] > 0 &&
        original.ciIdentity?.[key] === ci[key] && restored.ciIdentity?.[key] === ci[key]) ||
      !['recovery-original-host-removed', 'cleanup'].every(name => original.results.some(row => row.name === name && row.status === 'passed')))
    throw Error('Recovery summary must reference its matching complete successor receipt and same-job guided origin.');
  const lifecycle=guided.validate(original.evidence?.guidedPreview, original.results);
  if(lifecycle.productionImageId!==original.images.wizard)throw Error('Guided Production baseline must be the prepared Wizard image from the same candidate job.');
}
function guidedOrigin(original) {
  return {format: 'system-guided-preview-origin-v1', runId: original.runId, sourceRevision: original.sourceRevision,
    fullAcceptance: true, ciIdentity: Object.fromEntries(['projectId','pipelineId','candidateJobId'].map(key=>[key,original.ciIdentity[key]])),
    images: Object.fromEntries(['candidate', 'wizard', 'runner', 'gitlab', 'nginx'].filter(role => imageId(original.images[role])).map(role => [role, original.images[role]])),
    results: original.results.filter(row => [...guided.stages, 'recovery-original-host-removed', 'cleanup'].includes(row.name))
      .map(row => ({name: row.name, status: row.status})),
    evidence: {guidedPreview: guided.sanitize(original.evidence.guidedPreview),
      gitlabUpgrade: Object.fromEntries(upgradeKeys.filter(key => original.evidence.gitlabUpgrade[key] !== undefined && (!['fromImageId','toImageId'].includes(key)||imageId(original.evidence.gitlabUpgrade[key]))).map(key => [key, original.evidence.gitlabUpgrade[key]])),
      recovery: {runId: original.evidence.recovery.runId, backupOnly: true, originalHostRemoved: true, guidedBindingRestored: true}}};
}

function sanitizeGuidedReceipt(value) {
  try {
    if(value?.format!=='system-guided-preview-origin-v1')return undefined;
    validateReceipt(value,{sourceRevision:value.sourceRevision});
    if(!revision(value.sourceRevision)||!['projectId','pipelineId','candidateJobId'].every(key=>Number.isSafeInteger(value.ciIdentity?.[key])&&value.ciIdentity[key]>0)||
      !/^[a-f0-9]{24}$/.test(value.evidence?.recovery?.runId||'')||value.evidence.recovery.runId===value.runId||
      !['backupOnly','originalHostRemoved','guidedBindingRestored'].every(key=>value.evidence.recovery[key]===true))return undefined;
    guided.validate(value.evidence?.guidedPreview,value.results);
    return guidedOrigin(value);
  }catch{return undefined;}
}

function context(env) {
  if (!revision(env.CI_COMMIT_SHA) || !['CI_PROJECT_ID', 'CI_PIPELINE_ID', 'CI_JOB_ID']
    .every(key => /^[1-9][0-9]*$/.test(env[key] || '')) ||
    !/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(env.CI_REGISTRY || '') ||
    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(env.CI_PROJECT_PATH || '') ||
    env.CI_REGISTRY_IMAGE !== env.CI_REGISTRY + '/' + env.CI_PROJECT_PATH ||
    !['merge_request_event', 'push', 'web', 'schedule'].includes(env.CI_PIPELINE_SOURCE))
    throw Error('Successor publication requires a valid same-project CI identity.');
  return {sourceRevision: env.CI_COMMIT_SHA, projectId: Number(env.CI_PROJECT_ID),
    pipelineId: Number(env.CI_PIPELINE_ID), candidateJobId: Number(env.CI_JOB_ID),
    registryRepository: env.CI_REGISTRY_IMAGE + '/successor'};
}

function validateReceipt(proof, ci) {
  const upgrade = proof.evidence?.gitlabUpgrade;
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

function validateEvidence(proof, ci) {
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

function candidates(directory, ci) {
  const receipts = fs.readdirSync(directory).filter(name => /^[a-f0-9]{24}$/.test(name)).flatMap(name => {
    const dir = path.join(directory, name), filename = path.join(dir, 'results.json');
    if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink() ||
      !fs.lstatSync(filename).isFile() || fs.lstatSync(filename).isSymbolicLink())
      throw Error('Candidate evidence must be regular job-owned files.');
    const bytes = fs.readFileSync(filename), proof = JSON.parse(bytes);
    if (proof.fullAcceptance !== true || !proof.evidence?.gitlabUpgrade) return [];
    validateReceipt(proof, ci);
    if (proof.runId !== name) throw Error('Candidate evidence directory mismatch.');
    return [{proof, bytes}];
  });
  const summaries = receipts.filter(({proof}) => proof.evidence?.recovery?.runId !== undefined);
  for (const {proof} of summaries) {
    const restoredRun = proof.evidence.recovery.runId;
    const restored = receipts.find(item => item.proof.runId === restoredRun)?.proof;
    if (!/^[a-f0-9]{24}$/.test(restoredRun || '') || !restored)
      throw Error('Recovery summary must reference its matching complete successor receipt.');
    validateLineage(restored, proof, ci);
  }
  return receipts.filter(({proof}) => proof.evidence?.recovery?.runId === undefined).map(item => {
    const origins = summaries.filter(({proof}) => proof.evidence.recovery.runId === item.proof.runId);
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

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {encoding: 'utf8', timeout: 600000,
    maxBuffer: 4 * 1024 ** 2, ...options});
  if (result.error || result.status !== 0) throw Error('Successor publication operation failed: ' + binary);
  return (result.stdout || '').trim();
}

function publish(env = process.env, root = process.cwd(), execute = command) {
  const ci = context(env);
  const receipts = candidates(path.join(root, 'test-results/e2e'), ci);
  if (receipts.length !== 1) throw Error('Exactly one full successor acceptance receipt is required.');
  const {proof, bytes} = receipts[0];
  const expectedId = validateEvidence(proof, ci);
  const tag = ci.registryRepository + ':pipeline-' + ci.pipelineId + '-job-' + ci.candidateJobId;
  const local = 'system-platform-candidate:ci-' + ci.projectId + '-' + ci.candidateJobId;
  const wizardRepository = ci.registryRepository + '-wizard';
  const wizardTag = wizardRepository + ':pipeline-' + ci.pipelineId + '-job-' + ci.candidateJobId;
  const wizardLocal = 'system-platform-wizard:ci-' + ci.projectId + '-' + ci.candidateJobId;
  const inspect = reference => JSON.parse(execute('docker', ['image', 'inspect', reference]))[0];
  const tree = execute('git', ['rev-parse', 'HEAD^{tree}'], {cwd: root});
  const gitlink = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(execute('git', ['ls-tree', 'HEAD', 'wizard'], {cwd: root}));
  if (execute('git', ['rev-parse', 'HEAD'], {cwd: root}) !== ci.sourceRevision || !revision(tree) || !gitlink)
    throw Error('Publication checkout/source mismatch.');
  const image = inspect(local);
  if (image.Id !== expectedId || image.Config?.Labels?.['org.system-bootstrapper.test-job'] !== String(ci.candidateJobId) ||
    image.Config?.Labels?.['org.opencontainers.image.revision'] !== ci.sourceRevision)
    throw Error('The accepted image/source/job identity does not match.');
  const wizard = inspect(wizardLocal);
  if (!imageId(proof.images.wizard) || wizard.Id !== proof.images.wizard ||
    wizard.Config?.Labels?.['org.system-bootstrapper.test-job'] !== String(ci.candidateJobId) ||
    wizard.Config?.Labels?.['org.opencontainers.image.revision'] !== gitlink[1] ||
    wizard.Config?.Labels?.['org.system-bootstrapper.source-revision'] !== ci.sourceRevision)
    throw Error('The accepted Wizard image/source/job identity does not match.');
  if (!env.CI_REGISTRY_USER || !env.CI_REGISTRY_PASSWORD) throw Error('Scoped CI registry credentials are required.');
  const output = path.join(root, 'test-results/successor');
  fs.mkdirSync(output, {recursive: true, mode: 0o700});
  // This directory MUST stay outside every artifact path. Finally cannot run
  // after SIGKILL; even then a job must never upload its registry credentials.
  const auth = fs.mkdtempSync(path.join(os.tmpdir(), 'system-successor-registry-'));
  fs.chmodSync(auth, 0o700);
  const dockerEnv = {...env, DOCKER_CONFIG: auth};
  const tagged = [];
  try {
    execute('docker', ['login', '--username', env.CI_REGISTRY_USER, '--password-stdin', env.CI_REGISTRY],
      {env: dockerEnv, input: env.CI_REGISTRY_PASSWORD});
    execute('docker', ['tag', local, tag]); tagged.push([tag, expectedId]);
    execute('docker', ['push', tag], {env: dockerEnv});
    const published = inspect(tag);
    if (published.Id !== expectedId) throw Error('Published image identity changed.');
    const refs = (published.RepoDigests || []).filter(ref => ref.startsWith(ci.registryRepository + '@') &&
      imageId(ref.split('@')[1]));
    if (refs.length !== 1) throw Error('An immutable published successor reference is required.');
    execute('docker', ['tag', wizardLocal, wizardTag]); tagged.push([wizardTag, wizard.Id]);
    execute('docker', ['push', wizardTag], {env: dockerEnv});
    const publishedWizard = inspect(wizardTag);
    const wizardRefs = (publishedWizard.RepoDigests || []).filter(ref => ref.startsWith(wizardRepository + '@') &&
      imageId(ref.split('@')[1]));
    if (publishedWizard.Id !== wizard.Id || wizardRefs.length !== 1)
      throw Error('An immutable published Wizard reference is required.');
    const receipt = {format: 'system-successor-release-v1', ...ci,
      sourceTree: tree, wizardRevision: gitlink[1], imageId: expectedId,
      registryReference: refs[0], candidateEvidenceSha256: digest(bytes),
      wizardImageId: wizard.Id, wizardRegistryReference: wizardRefs[0],
      candidateEvidencePath: 'test-results/successor/candidate-results.json'};
    // E2E after_script cleanup rewrites its working receipts. Freeze exactly
    // the accepted bytes used here so the uploaded release hash stays valid.
    fs.writeFileSync(path.join(output, 'candidate-results.json'), bytes, {mode: 0o600});
    fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(receipt, null, 2) + '\n', {mode: 0o600});
    return receipt;
  } finally {
    fs.rmSync(auth, {recursive: true, force: true});
    for (const [reference, expected] of tagged.reverse()) {
      if (inspect(reference).Id !== expected) throw Error('Cannot clean a changed successor publication alias.');
      execute('docker', ['image', 'rm', reference]);
    }
  }
}

module.exports = {context, validateEvidence, candidates, publish, sanitizeGuidedReceipt};
if (require.main === module) {
  try { const value = publish(); console.log('Published the accepted successor image: ' + value.registryReference); }
  catch (_) { console.error('Successor publication refused; inspect candidate, source and image identity checks.'); process.exitCode = 1; }
}
